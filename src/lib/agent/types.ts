/**
 * Agent core — shared primitive types.
 *
 * This subsystem implements an agent harness inspired by the DeepSeek Harness
 * (dsh) architecture: an append-only session log of durable events, a
 * turn/step agent loop, a tool registry with a pre/execute/post pipeline and
 * permission gating, an LLM adapter seam with streaming chunk assembly, and a
 * composable system-prompt assembler. Every capability is a "plugin" that
 * registers services/effects on a shared context and can be swapped.
 *
 * This is an original implementation — the patterns follow dsh's design
 * philosophy, but the code is written from scratch for a Next.js/TypeScript
 * app with no Cordis dependency.
 */

export type SessionId = string & { readonly __brand: 'SessionId' };
export type CallId = string & { readonly __brand: 'CallId' };
export type MessageId = string & { readonly __brand: 'MessageId' };

export const newSessionId = (): SessionId =>
  crypto.randomUUID() as SessionId;
export const newCallId = (): CallId => crypto.randomUUID() as CallId;
export const newMessageId = (): MessageId => crypto.randomUUID() as MessageId;

/** A monotonic seq number identifying one event in the session log. */
export type Seq = number;

/** Deep-freeze a value and everything reachable. Throws on later mutation. */
export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  if (Object.isFrozen(value)) return value;
  if (Array.isArray(value)) {
    for (const item of value) deepFreeze(item);
  } else {
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return Object.freeze(value);
}

/** Structural snapshot of a JSON-serializable value (lossless only). */
export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [key: string]: Json };

export function snapshotJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
