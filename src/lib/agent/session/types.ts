/**
 * Session event types — the durable, append-only event log.
 *
 * Every model-visible fact is reconstructable from SessionEvent[]. Only three
 * event types ("surface-eligible") project to the model's Message[] history:
 *   - user/message
 *   - assistant/message
 *   - tool/result
 * Surface-eligible events may carry a `surfaceOp` describing how they alter the
 * model-visible surface (append, or replace a prior range — used for compaction).
 *
 * Every other event (turn/step boundaries, raw assistant chunks, tool/call,
 * todos, request headers, approvals) is log-only trace data: durable for
 * replay/audit, but never projected into model history by deriveMessages().
 */

import type { CallId, Json, MessageId, Seq } from '../types';
import type {
  AssistantMessage,
  ContentBlock,
  Message,
  StreamChunk,
  ToolResultMessage,
  UserMessage,
} from '../llm/types';

export type TurnEndReason =
  | { kind: 'completed' }
  | { kind: 'aborted'; reason: string }
  | { kind: 'blocked' }
  | { kind: 'error'; error: string }
  | { kind: 'max-tokens' }
  | { kind: 'interrupted' };

export type StepEndReason =
  | { kind: 'completed' }
  | { kind: 'max-tokens' };

/** A surface operation — how an event alters the model-visible surface. */
export type SurfaceOp =
  | { op: 'append' }
  | { op: 'replace'; start: Seq; end: Seq };

export interface RequestHeader {
  provider: string;
  model: string;
  system?: string;
  tools?: string[];
  temperature?: number;
  maxTokens?: number;
}

export interface TokenUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

/** The core event map — extensible via declaration merging by plugins. */
export interface SessionEventMap {
  'turn/start': { turn: number };
  'turn/end': { turn: number; reason: TurnEndReason };
  'step/start': { turn: number; step: number };
  'step/end': { turn: number; step: number };
  'user/message': UserMessage;
  'assistant/chunk': { turn: number; step: number; chunk: StreamChunk };
  'assistant/message': {
    turn: number;
    step: number;
    message: AssistantMessage;
    usage?: TokenUsage;
  };
  'tool/call': {
    turn: number;
    step: number;
    callId: CallId;
    name: string;
    arguments: string;
  };
  'tool/result': {
    turn: number;
    step: number;
    message: ToolResultMessage;
    error?: { name: string; code: string; message: string };
    meta?: Json;
  };
  'todo/write': { todos: Array<{ content: string; status: 'pending' | 'in_progress' | 'completed' }> };
  'request/header': { header: RequestHeader; reason: 'initial' | 'resume' | 'change' };
  'session/title': { title: string };
  'approval/asked': { callId: CallId; toolName: string; summary: string };
  'approval/decided': {
    callId: CallId;
    decision: 'allowed-once' | 'rejected' | 'cancelled';
  };
  'feedback/record': { messageSeq: number; rating: 'up' | 'down'; comment?: string };
}

export type SessionEventType = keyof SessionEventMap;

export interface SessionEventBase {
  seq: Seq;
  time: number;
  surfaceOp?: SurfaceOp;
  sourceEventSeqs?: Seq[];
  ignorable?: true;
}

export type SessionEvent<T extends SessionEventType = SessionEventType> = {
  type: T;
  data: SessionEventMap[T];
} & SessionEventBase;

/** The set of event types eligible to project into the model-visible surface. */
export const SURFACE_ELIGIBLE = new Set<SessionEventType>([
  'user/message',
  'assistant/message',
  'tool/result',
]);

export function isSurfaceEligible(type: SessionEventType): boolean {
  return SURFACE_ELIGIBLE.has(type);
}

// Re-exported from llm/types via the barrel — kept here only for backward imports.
export type { Message, UserMessage, AssistantMessage, ContentBlock } from '../llm/types';
