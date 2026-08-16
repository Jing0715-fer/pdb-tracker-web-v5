/**
 * OpenAICompatAdapter — a generic adapter for any OpenAI-compatible
 * `/chat/completions` endpoint. Handles DeepSeek, OpenAI, Qwen, Moonshot,
 * Zhipu, SiliconFlow, Together, Ollama, and any custom OpenAI-compatible
 * gateway.
 *
 * Unlike the ZAI adapter (which uses the z-ai SDK), this adapter makes direct
 * `fetch` calls to the provider's REST API — exactly like dsh's
 * `llm-deepseek` adapter. This means it works with any provider that speaks
 * the OpenAI wire format, without depending on a specific SDK.
 *
 * Anthropic uses a slightly different wire format (x-api-key header, no
 * Bearer prefix), handled via the profile's authHeader/authPrefix fields.
 */

import type { LlmAdapter, GenerateOptions, StreamChunk, Message, ToolSchema, ContentBlock } from '../llm/types';
import { newCallId } from '../types';
import type { ProviderProfile } from './catalog';
import { resolveApiKey, resolveBaseURL } from './credentials';

interface OpenAIChoice {
  message?: {
    content?: string | null;
    tool_calls?: Array<{
      id: string;
      type: 'function';
      function: { name: string; arguments: string };
    }>;
  };
  finish_reason?: string;
}

interface OpenAIResponse {
  choices?: OpenAIChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/** Convert our ContentBlock[] to the OpenAI message content format. */
function toOpenAIMessageContent(content: ContentBlock[]): {
  text: string;
  toolCallId?: string;
  toolCalls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
} {
  const texts: string[] = [];
  let toolCallId: string | undefined;
  let toolCalls: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> | undefined;
  for (const block of content) {
    if (block.type === 'text') texts.push(block.text);
    else if (block.type === 'tool-call') {
      toolCalls ??= [];
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: { name: block.name, arguments: block.arguments },
      });
    } else if (block.type === 'tool-result') {
      toolCallId = block.callId;
      const inner = block.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
      texts.push(inner || '(empty)');
    }
  }
  return { text: texts.join('\n'), toolCallId, toolCalls };
}

/** Map our Message[] to the OpenAI message array. */
function toOpenAIMessages(messages: Message[], system?: string): unknown[] {
  const out: unknown[] = [];
  if (system) out.push({ role: 'system', content: system });
  for (const m of messages) {
    const { text, toolCallId, toolCalls } = toOpenAIMessageContent(m.content);
    if (m.source.kind === 'tool' && toolCallId) {
      out.push({ role: 'tool', tool_call_id: toolCallId, content: text });
    } else if (m.role === 'assistant') {
      if (toolCalls && toolCalls.length) {
        out.push({ role: 'assistant', content: text || '', tool_calls: toolCalls });
      } else {
        out.push({ role: 'assistant', content: text });
      }
    } else {
      out.push({ role: 'user', content: text });
    }
  }
  return out;
}

/** Convert our ToolSchema[] to the OpenAI tools format. */
function toOpenAITools(tools?: ToolSchema[]): unknown[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));
}

export class OpenAICompatAdapter implements LlmAdapter {
  readonly provider: string;
  private readonly profile: ProviderProfile;

  constructor(profile: ProviderProfile) {
    this.profile = profile;
    this.provider = profile.id;
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const apiKey = resolveApiKey(this.profile.id);
    if (!apiKey) {
      yield {
        type: 'finish',
        reason: { kind: 'error', error: `No API key configured for provider "${this.profile.id}". Set it in the provider settings or the ${this.profile.apiKeyEnv} env var.` },
      };
      return;
    }

    const baseURL = resolveBaseURL(this.profile.id) ?? this.profile.baseURL;
    const url = `${baseURL}/chat/completions`;

    // Build auth headers.
    const authHeader = this.profile.authHeader ?? 'Authorization';
    const authPrefix = this.profile.authPrefix ?? 'Bearer ';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      [authHeader]: `${authPrefix}${apiKey}`,
      ...this.profile.extraHeaders,
    };

    const body: Record<string, unknown> = {
      model: options.model || this.profile.defaultModel,
      messages: toOpenAIMessages(options.messages, options.system),
      tools: toOpenAITools(options.tools),
      tool_choice: options.tools && options.tools.length ? 'auto' : undefined,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
      stream: false,
    };
    // Remove undefined fields.
    Object.keys(body).forEach((k) => body[k] === undefined && delete body[k]);

    let resp: Response;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: options.signal,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      yield { type: 'finish', reason: { kind: 'error', error: `Fetch failed: ${msg}` } };
      return;
    }

    if (!resp.ok) {
      const errText = await resp.text().catch(() => resp.statusText);
      yield {
        type: 'finish',
        reason: { kind: 'error', error: `${this.profile.displayName} API error ${resp.status}: ${errText.slice(0, 500)}` },
      };
      return;
    }

    const json = (await resp.json()) as OpenAIResponse;
    const choice = json.choices?.[0];
    if (!choice) {
      yield { type: 'finish', reason: { kind: 'error', error: 'No choices in response' } };
      return;
    }

    const content = choice.message?.content || '';
    const toolCalls = choice.message?.tool_calls ?? [];
    const finishReason = choice.finish_reason || (toolCalls.length ? 'tool_calls' : 'stop');

    // Emit text block.
    if (content) {
      const idx = 0;
      yield { type: 'block-start', index: idx, blockType: 'text' };
      yield { type: 'text-delta', index: idx, text: content };
      yield { type: 'block-end', index: idx, block: { type: 'text', text: content } };
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
    if (json.usage) {
      yield {
        type: 'usage',
        usage: {
          promptTokens: json.usage.prompt_tokens,
          completionTokens: json.usage.completion_tokens,
          totalTokens: json.usage.total_tokens,
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
