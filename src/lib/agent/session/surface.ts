/**
 * SurfaceManager — folds the append-only event log into the model-visible
 * "surface": an ordered list of seqs that project to Message[].
 *
 * Only surface-eligible events (user/message, assistant/message, tool/result)
 * carry a `surfaceOp`. `append` rewrites the surface; `deriveMessages` walks
 * the surface and projects the messages the model sees next turn.
 *
 * The surface is rebuilt incrementally from scratch on each append (simple +
 * correct), then cached. A future optimization could maintain it
 * incrementally; correctness first.
 */

import { deepFreeze } from '../types';
import type { Seq } from '../types';
import type { SessionEvent, SessionEventType } from './types';
import { isSurfaceEligible } from './types';
import type { Message, AssistantMessage, ToolResultMessage, UserMessage } from '../llm/types';

interface SurfaceEntry {
  seq: Seq;
  type: SessionEventType;
}

export class SurfaceManager {
  private surface: SurfaceEntry[] = [];
  private derivedCache: Message[] | null = null;

  /** Rebuild the surface from the full event log. Called after appends. */
  recompute(events: readonly SessionEvent[]): void {
    const next: SurfaceEntry[] = [];
    for (const ev of events) {
      if (!isSurfaceEligible(ev.type)) continue;
      if (!ev.surfaceOp || ev.surfaceOp.op === 'append') {
        next.push({ seq: ev.seq, type: ev.type });
      } else {
        // replace: drop the [start, end] range then append this seq.
        const { start, end } = ev.surfaceOp;
        for (let i = next.length - 1; i >= 0; i--) {
          if (next[i].seq >= start && next[i].seq <= end) next.splice(i, 1);
        }
        next.push({ seq: ev.seq, type: ev.type });
      }
    }
    this.surface = next;
    this.derivedCache = null;
  }

  get surfaceSeqs(): readonly Seq[] {
    return this.surface.map((s) => s.seq);
  }

  /** Project the model-visible messages from the event log. */
  deriveMessages(eventsBySeq: ReadonlyMap<Seq, SessionEvent>): Message[] {
    if (this.derivedCache) return this.derivedCache;
    const out: Message[] = [];
    for (const entry of this.surface) {
      const ev = eventsBySeq.get(entry.seq);
      if (!ev) continue;
      if (ev.type === 'user/message') {
        out.push(ev.data as UserMessage);
      } else if (ev.type === 'assistant/message') {
        const data = ev.data as { message: AssistantMessage };
        // Skip empty-content assistant messages (usage-only / max-tokens).
        if (data.message.content.length > 0) out.push(data.message);
      } else if (ev.type === 'tool/result') {
        const data = ev.data as { message: ToolResultMessage };
        out.push(data.message);
      }
    }
    this.derivedCache = deepFreeze(out);
    return this.derivedCache;
  }
}
