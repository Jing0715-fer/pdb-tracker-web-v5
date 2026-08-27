/**
 * Session settings extraction — shared single source of truth.
 *
 * R169 (AGENT-L8): this backward-scan previously existed in TWO copies that
 * could drift apart — an inline private method on AgentLoop (loop.ts) and an
 * exported function on the settings API route. Both now delegate here.
 */

import type { SessionEvent } from './types';
import { PROVIDER_CATALOG } from '../providers/catalog';

export interface SessionSettings {
  model?: string;
  providerId?: string;
  temperature?: number;
  maxStepsPerTurn?: number;
  systemPromptOverride?: string;
}

/** Extract the latest settings from a session event log. */
export function extractSessionSettings(events: readonly SessionEvent[]): SessionSettings {
  // Walk backwards to find the latest session/settings event.
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]!;
    if (ev.type === ('session/settings' as string)) {
      return ev.data as SessionSettings;
    }
  }
  return {};
}

/**
 * R168 (AGENT-M10): validate + clamp a partial settings body before it is
 * merged into the durable `session/settings` event. Previously body fields
 * were merged verbatim — maxStepsPerTurn 0/negative made every turn hit the
 * step guard ("达到最大步数限制" on each request), a string temperature broke
 * every subsequent LLM call, and the corruption was durable.
 * Returns { ok, value } — ok=false carries a user-actionable message.
 *
 * AG2-06: moved from the settings API route into this shared module so the
 * sessions route (body.agent) and the import route (replayed settings
 * events) validate against the EXACT same rules instead of trusting
 * client/importer input.
 */
export function validateSettingsBody(
  body: Partial<SessionSettings>,
): { ok: true; value: Partial<SessionSettings> } | { ok: false; error: string } {
  const out: Partial<SessionSettings> = {};
  if (body.model !== undefined) {
    if (typeof body.model !== 'string' || body.model.length === 0 || body.model.length > 100) {
      return { ok: false, error: 'model must be a non-empty string (≤100 chars)' };
    }
    out.model = body.model;
  }
  if (body.providerId !== undefined) {
    if (typeof body.providerId !== 'string' || !PROVIDER_CATALOG.some((p) => p.id === body.providerId)) {
      return { ok: false, error: `providerId must be one of: ${PROVIDER_CATALOG.map((p) => p.id).join(', ')}` };
    }
    out.providerId = body.providerId;
  }
  if (body.temperature !== undefined) {
    const t = body.temperature;
    if (typeof t !== 'number' || !Number.isFinite(t) || t < 0 || t > 2) {
      return { ok: false, error: 'temperature must be a finite number between 0 and 2' };
    }
    out.temperature = t;
  }
  if (body.maxStepsPerTurn !== undefined) {
    const m = body.maxStepsPerTurn;
    if (typeof m !== 'number' || !Number.isInteger(m) || m < 1 || m > 50) {
      return { ok: false, error: 'maxStepsPerTurn must be an integer between 1 and 50' };
    }
    out.maxStepsPerTurn = m;
  }
  if (body.systemPromptOverride !== undefined) {
    if (typeof body.systemPromptOverride !== 'string' || body.systemPromptOverride.length > 8000) {
      return { ok: false, error: 'systemPromptOverride must be a string (≤8000 chars)' };
    }
    out.systemPromptOverride = body.systemPromptOverride;
  }
  return { ok: true, value: out };
}
