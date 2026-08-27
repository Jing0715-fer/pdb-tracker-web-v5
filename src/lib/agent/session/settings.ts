/**
 * Session settings extraction — shared single source of truth.
 *
 * R169 (AGENT-L8): this backward-scan previously existed in TWO copies that
 * could drift apart — an inline private method on AgentLoop (loop.ts) and an
 * exported function on the settings API route. Both now delegate here.
 */

import type { SessionEvent } from './types';

export interface SessionSettings {
  model?: string;
  providerId?: string;
  temperature?: number;
  maxStepsPerTurn?: number;
  systemPromptOverride?: string;
}

/** Extract the latest settings from a session event log. */
export function extractSessionSettings(events: SessionEvent[]): SessionSettings {
  // Walk backwards to find the latest session/settings event.
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]!;
    if (ev.type === ('session/settings' as string)) {
      return ev.data as SessionSettings;
    }
  }
  return {};
}
