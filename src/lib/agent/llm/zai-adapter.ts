/**
 * ZAI adapter — bridges z-ai-web-dev-sdk (GLM-4.6) to the StreamChunk seam.
 *
 * The z-ai SDK exposes an OpenAI-style chat.completions.create with native
 * tool/function calling. We translate our Message[] into the SDK's request
 * shape, call it, and project the response back as a minimal chunk stream:
 *   block-start(text) → text-delta → block-end(text)
 *   block-start(tool-call) → tool-call-delta → block-end(tool-call)   × N
 *   finish(stop | tool-calls)
 *
 * The adapter is intentionally simple — it does not do real token streaming
 * (the SDK call is one-shot), but the chunk vocabulary means the agent loop
 * and UI can be written against a streaming contract and a future streaming
 * adapter slots in unchanged.
 *
 * MUST be used server-side only (z-ai-web-dev-sdk is backend-only).
 */

import type { LlmAdapter, GenerateOptions, StreamChunk, Message, ToolSchema, ContentBlock } from './types';
import { newCallId } from '../types';
import { withTimeoutSignal } from './signal-utils';

interface ZaiSdk {
  chat: {
    completions: {
      create(opts: Record<string, unknown>): Promise<ZaiResponse>;
    };
  };
}

interface ZaiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface ZaiMessage {
  message: {
    content?: string;
    tool_calls?: ZaiToolCall[];
  };
  finish_reason?: string;
}

interface ZaiResponse {
  choices?: ZaiMessage[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}

/** Convert our ContentBlock[] to a plain string + tool_calls for the SDK. */
function toSdkContent(content: ContentBlock[]): {
  text: string;
  toolCallId?: string;
  toolCalls?: ZaiToolCall[];
} {
  const texts: string[] = [];
  let toolCallId: string | undefined;
  let toolCalls: ZaiToolCall[] | undefined;
  for (const block of content) {
    if (block.type === 'text') texts.push(block.text);
    else if (block.type === 'tool-call') {
      toolCalls ??= [];
      toolCalls.push({ id: block.id, type: 'function', function: { name: block.name, arguments: block.arguments } });
    } else if (block.type === 'tool-result') {
      toolCallId = block.callId;
      const inner = block.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
      texts.push(inner || '(empty)');
    }
  }
  return { text: texts.join('\n'), toolCallId, toolCalls };
}

/** Map our Message[] to the SDK's message array. */
function toSdkMessages(messages: Message[], system?: string): unknown[] {
  const out: unknown[] = [];
  if (system) out.push({ role: 'system', content: system });
  for (const m of messages) {
    const { text, toolCallId, toolCalls } = toSdkContent(m.content);
    // Tool-result messages (role 'assistant' but source.kind 'tool') → SDK 'tool'.
    if (m.source.kind === 'tool') {
      out.push({
        role: 'tool',
        tool_call_id: toolCallId,
        name: '',
        content: text,
      });
    } else if (m.role === 'assistant') {
      if (toolCalls && toolCalls.length) {
        out.push({
          role: 'assistant',
          content: text || '',
          tool_calls: toolCalls,
        });
      } else {
        out.push({ role: 'assistant', content: text });
      }
    } else {
      out.push({ role: 'user', content: text });
    }
  }
  return out;
}

function toSdkTools(tools?: ToolSchema[]): unknown[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters as Record<string, unknown>,
    },
  }));
}

export class ZaiLlmAdapter implements LlmAdapter {
  readonly provider = 'zai';
  private sdkPromise: Promise<ZaiSdk> | null = null;

  private async sdk(): Promise<ZaiSdk> {
    if (!this.sdkPromise) {
      this.sdkPromise = (async () => {
        const mod = await import('z-ai-web-dev-sdk');
        const ZAI = (mod as unknown as { default: { create: () => Promise<ZaiSdk> } }).default;
        return ZAI.create();
      })();
    }
    return this.sdkPromise;
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const sdk = await this.sdk();
    // R168 (AGENT-M6): hard per-attempt timeout — a hung provider connection
    // previously blocked the drive indefinitely (see signal-utils.ts).
    const timeout = withTimeoutSignal(options.signal);
    let resp: ZaiResponse;
    try {
      resp = await sdk.chat.completions.create({
        model: options.model || 'glm-4.6',
        messages: toSdkMessages(options.messages, options.system),
        tools: toSdkTools(options.tools),
        tool_choice: options.tools && options.tools.length ? 'auto' : undefined,
        thinking: { type: 'disabled' as const },
        temperature: options.temperature,
        max_tokens: options.maxTokens,
        signal: timeout.signal,
      } as Record<string, unknown>);
    } catch (err) {
      const msg = timeout.timedOut()
        ? `LLM request timed out after 120s (provider: zai, model: ${options.model})`
        : err instanceof Error ? err.message : String(err);
      yield { type: 'finish', reason: { kind: 'error', error: msg } };
      return;
    } finally {
      timeout.dispose();
    }

    const choice = resp.choices?.[0];
    if (!choice) {
      yield { type: 'finish', reason: { kind: 'error', error: 'No choices in LLM response' } };
      return;
    }

    const content = choice.message?.content || '';
    const toolCalls = choice.message?.tool_calls ?? [];
    const finishReason = choice.finish_reason || (toolCalls.length ? 'tool_calls' : 'stop');

    // Emit text block if present.
    if (content) {
      const idx = 0;
      yield { type: 'block-start', index: idx, blockType: 'text' };
      yield { type: 'text-delta', index: idx, text: content };
      yield {
        type: 'block-end',
        index: idx,
        block: { type: 'text', text: content },
      };
    }

    // Emit tool-call blocks.
    let toolIdx = 1;
    for (const tc of toolCalls) {
      const idx = toolIdx++;
      const id = (tc.id || newCallId()) as never;
      yield { type: 'block-start', index: idx, blockType: 'tool-call' };
      yield {
        type: 'tool-call-delta',
        index: idx,
        id,
        name: tc.function.name,
        argumentsDelta: tc.function.arguments,
      };
      yield {
        type: 'block-end',
        index: idx,
        block: {
          type: 'tool-call',
          id,
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      };
    }

    // Usage.
    if (resp.usage) {
      yield {
        type: 'usage',
        usage: {
          promptTokens: resp.usage.prompt_tokens,
          completionTokens: resp.usage.completion_tokens,
          totalTokens: resp.usage.total_tokens,
        },
      };
    }

    // Finish.
    if (finishReason === 'tool_calls' || toolCalls.length > 0) {
      yield { type: 'finish', reason: { kind: 'tool-calls' } };
    } else if (finishReason === 'length') {
      yield { type: 'finish', reason: { kind: 'max-tokens' } };
    } else {
      yield { type: 'finish', reason: { kind: 'stop' } };
    }
  }
}
