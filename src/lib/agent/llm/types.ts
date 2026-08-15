/**
 * LLM message & streaming vocabulary — the adapter seam.
 *
 * A Message has an immutable id, a role, and a list of ContentBlocks. Content
 * blocks are a discriminated union (text, reasoning, tool-call, tool-result).
 * The model streams `StreamChunk`s; `BlockAssembler` reconstructs the final
 * AssistantMessage from them. Tool calls survive verbatim (the raw JSON args
 * string is preserved in the tool-call block).
 */

import type { CallId, Json, MessageId } from '../types';

export type Role = 'system' | 'user' | 'assistant';

export interface TextBlock {
  type: 'text';
  text: string;
}
export interface ReasoningBlock {
  type: 'reasoning';
  text: string;
}
export interface ImageBlock {
  type: 'image';
  mimeType: string;
  /** base64-encoded image data OR a data: URL */
  data: string;
}
export interface ToolCallBlock {
  type: 'tool-call';
  id: CallId;
  name: string;
  /** Raw JSON arguments string exactly as emitted by the model. */
  arguments: string;
}
export interface ToolResultBlock {
  type: 'tool-result';
  callId: CallId;
  content: ContentBlock[];
  isError?: boolean;
}

export type ContentBlock =
  | TextBlock
  | ReasoningBlock
  | ImageBlock
  | ToolCallBlock
  | ToolResultBlock;

export type MessageSource =
  | { kind: 'user' }
  | { kind: 'model'; provider: string; model: string }
  | { kind: 'tool'; callId: CallId };

export interface BaseMessage {
  id: MessageId;
  role: Role;
  content: ContentBlock[];
  source: MessageSource;
}

export interface UserMessage extends BaseMessage {
  role: 'user';
  source: { kind: 'user' };
}
export interface AssistantMessage extends BaseMessage {
  role: 'assistant';
  source: { kind: 'model'; provider: string; model: string };
}
export interface ToolResultMessage extends BaseMessage {
  role: 'assistant';
  source: { kind: 'tool'; callId: CallId };
}
export type Message = UserMessage | AssistantMessage | ToolResultMessage;

export type FinishReason =
  | { kind: 'stop' }
  | { kind: 'tool-calls' }
  | { kind: 'max-tokens' }
  | { kind: 'aborted'; reason: string }
  | { kind: 'error'; error: string };

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

/** A single streamed chunk from the adapter. */
export type StreamChunk =
  | { type: 'block-start'; index: number; blockType: ContentBlock['type'] }
  | { type: 'text-delta'; index: number; text: string }
  | { type: 'reasoning-delta'; index: number; text: string }
  | {
      type: 'tool-call-delta';
      index: number;
      id: CallId;
      name?: string;
      argumentsDelta: string;
    }
  | { type: 'block-end'; index: number; block: ContentBlock }
  | { type: 'usage'; usage: TokenUsage }
  | { type: 'finish'; reason: FinishReason };

export interface ToolSchema {
  name: string;
  description: string;
  parameters: Json;
}

export interface GenerateOptions {
  provider: string;
  model: string;
  messages: Message[];
  system?: string;
  tools?: ToolSchema[];
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
  signal?: AbortSignal;
}

/** Config that affects cache reuse — a subset of GenerateOptions. */
export interface LlmCallConfig {
  provider: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  stop?: string[];
}

/** A prepared call — adapter resolved, defaults materialized. */
export interface PreparedLlmCall {
  config: LlmCallConfig;
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}

/** Abstract adapter — providers implement this. */
export interface LlmAdapter {
  readonly provider: string;
  listModels?(): string[];
  stream(options: GenerateOptions): AsyncIterable<StreamChunk>;
}
