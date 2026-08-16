/**
 * BlockAssembler — the single canonical chunk → AssistantMessage algorithm.
 *
 * Accumulates streamed chunks keyed by block index. When `block-end` arrives
 * the block is frozen. After the stream ends, `finish` exposes the terminal
 * FinishReason and `blocks()` returns the ordered ContentBlock[].
 *
 * Nobody else assembles chunks — this is the one place.
 */

import { newCallId, newMessageId, deepFreeze } from '../types';
import type { AssistantMessage, ContentBlock, FinishReason, StreamChunk, TokenUsage } from './types';

interface PartialTextBlock {
  type: 'text';
  text: string;
}
interface PartialReasoningBlock {
  type: 'reasoning';
  text: string;
}
interface PartialToolCallBlock {
  type: 'tool-call';
  id: string;
  name?: string;
  arguments: string;
}
type PartialBlock = PartialTextBlock | PartialReasoningBlock | PartialToolCallBlock;

export class BlockAssembler {
  private readonly partials = new Map<number, PartialBlock>();
  private readonly finalized = new Map<number, ContentBlock>();
  private _finish: FinishReason | null = null;
  private _usage: TokenUsage | null = null;

  push(chunk: StreamChunk): void {
    switch (chunk.type) {
      case 'block-start':
        // Pre-seed an empty block of the right type.
        if (!this.partials.has(chunk.index)) {
          if (chunk.blockType === 'text') {
            this.partials.set(chunk.index, { type: 'text', text: '' });
          } else if (chunk.blockType === 'reasoning') {
            this.partials.set(chunk.index, { type: 'reasoning', text: '' });
          } else if (chunk.blockType === 'tool-call') {
            this.partials.set(chunk.index, {
              type: 'tool-call',
              id: newCallId(),
              arguments: '',
            });
          }
        }
        return;
      case 'text-delta': {
        let block = this.partials.get(chunk.index);
        if (!block) {
          block = { type: 'text', text: '' };
          this.partials.set(chunk.index, block);
        }
        if (block.type === 'text') block.text += chunk.text;
        return;
      }
      case 'reasoning-delta': {
        let block = this.partials.get(chunk.index);
        if (!block) {
          block = { type: 'reasoning', text: '' };
          this.partials.set(chunk.index, block);
        }
        if (block.type === 'reasoning') block.text += chunk.text;
        return;
      }
      case 'tool-call-delta': {
        let block = this.partials.get(chunk.index);
        if (!block) {
          block = { type: 'tool-call', id: chunk.id, arguments: '' };
          this.partials.set(chunk.index, block);
        }
        if (block.type === 'tool-call') {
          block.id = chunk.id;
          if (chunk.name !== undefined) block.name = chunk.name;
          block.arguments += chunk.argumentsDelta;
        }
        return;
      }
      case 'block-end':
        this.finalized.set(chunk.index, deepFreeze(chunk.block));
        this.partials.delete(chunk.index);
        return;
      case 'usage':
        this._usage = { ...this._usage, ...chunk.usage };
        return;
      case 'finish':
        this._finish = chunk.reason;
        return;
    }
  }

  get finish(): FinishReason {
    return this._finish ?? { kind: 'stop' };
  }

  get usage(): TokenUsage | null {
    return this._usage;
  }

  /** Ordered content blocks. Finalized blocks first, then any dangling partials. */
  blocksArray(): ContentBlock[] {
    const out: ContentBlock[] = [];
    const indices = [
      ...new Set([...this.finalized.keys(), ...this.partials.keys()]),
    ].sort((a, b) => a - b);
    for (const i of indices) {
      const finalized = this.finalized.get(i);
      if (finalized) {
        out.push(finalized);
        continue;
      }
      const partial = this.partials.get(i);
      if (!partial) continue;
      if (partial.type === 'text' && partial.text === '') continue;
      if (partial.type === 'tool-call' && partial.arguments === '' && !partial.name) continue;
      out.push(
        deepFreeze({
          type: partial.type,
          ...(partial.type === 'text'
            ? { text: partial.text }
            : partial.type === 'reasoning'
              ? { text: partial.text }
              : { id: partial.id as never, name: partial.name ?? '', arguments: partial.arguments }),
        }) as ContentBlock,
      );
    }
    return out;
  }

  /** Build the final AssistantMessage. */
  buildMessage(provider: string, model: string): AssistantMessage {
    return deepFreeze({
      id: newMessageId(),
      role: 'assistant',
      content: this.blocksArray(),
      source: { kind: 'model', provider, model },
    });
  }
}
