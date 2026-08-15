/**
 * Tool definitions — the capability units the agent can call.
 *
 * A ToolDefinition declares a JSON-schema for its arguments, an output schema,
 * a pure `render` that projects the result into model-facing ContentBlocks,
 * and an `execute` that produces the canonical result. `requiresApproval`
 * escalates through the approval seam (pre-execute returns 'ask'); the
 * registry looks up ctx.approval and degrades to deny if none is mounted.
 *
 * `presentCall` / `presentResult` are pure UI projections (replay-safe).
 */

import type { CallId, Json } from '../types';
import type { ContentBlock, ToolSchema } from '../llm/types';

/** A simplified JSON-Schema node (we accept the SDK's relaxed shape). */
export type JsonSchema = Json;

export interface ToolRunContext {
  callId: CallId;
  name: string;
  arguments: unknown;
  signal: AbortSignal;
  /** Defer a context message to the next step boundary. */
  deferContext(message: string): void;
  /** Mark this success as terminal for the agent turn. */
  concludeTurn(): void;
}

export interface ToolExecutionResult {
  isError: boolean;
  value?: Json;
  content: ContentBlock[];
  error?: { name: string; code: string; message: string };
  meta?: Json;
  concludesTurn?: true;
}

export interface ToolDefinition extends ToolSchema {
  /** Output JSON-schema — enforced against every successful value. */
  output: {
    schema: JsonSchema;
    /** Pure projection → model-facing content blocks. */
    render(args: unknown, value: Json): ContentBlock[];
    /** Persisted into tool/result.meta for UI replay. */
    presentationMeta?(args: unknown, value: Json): Json;
  };
  /** Canonical execution. Returns a plain JSON value. */
  execute(args: unknown, ctx: ToolRunContext): Promise<Json>;
  /** Last-mile transform (optional, total, never throws). */
  finalizeContent?(ctx: ToolRunContext, result: ToolExecutionResult): ContentBlock[];
  /** Cooperative timeout. */
  timeoutMs?: number;
  /** Opt into parallel sibling dispatch. */
  isConcurrencySafe?(args: unknown): boolean;
  /** Pure UI for pending state. */
  presentCall?(args: unknown): ToolCallView;
  /** Pure UI for completed state. */
  presentResult?(args: unknown, result: Json): ToolResultView;
}

export interface ToolCallView {
  card: 'generic' | 'pdb' | 'measure' | 'screenshot' | 'analysis';
  title: string;
  kind?: string;
  locations?: Array<{ path?: string; line?: number }>;
}

export interface ToolResultView {
  card: 'generic' | 'pdb' | 'measure' | 'screenshot' | 'analysis' | 'read';
  title: string;
  content: ContentBlock[];
  meta?: Json;
}

/** Pre-execute decision returned by listeners. */
export type PreToolDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string }
  | { kind: 'ask'; reason?: string };

/** Post-execute decision. */
export type PostToolDecision =
  | { kind: 'accept'; content?: ContentBlock[]; value?: Json }
  | { kind: 'block'; feedback: string };
