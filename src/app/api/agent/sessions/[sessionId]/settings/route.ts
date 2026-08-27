/**
 * GET  /api/agent/sessions/[sessionId]/settings — get session settings
 * POST /api/agent/sessions/[sessionId]/settings — update session settings
 *
 * Settings are stored as a `session/settings` event in the session log (durable).
 * The agent loop reads the latest settings event when building requests.
 *
 * Currently supported: model, temperature, maxStepsPerTurn, systemPromptOverride.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAgentManager } from '@/lib/agent/manager';
import { PROVIDER_CATALOG } from '@/lib/agent/providers';
import { extractSessionSettings, type SessionSettings } from '@/lib/agent/session/settings';
import type { SessionEvent } from '@/lib/agent/session/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// R169 (AGENT-L8): SessionSettings + extraction now live in
// lib/agent/session/settings.ts (single source of truth, shared with the
// agent loop). Re-export for API-shape compatibility.
export type { SessionSettings };
export const extractSettings = (events: SessionEvent[]): SessionSettings =>
  extractSessionSettings(events);

/**
 * R168 (AGENT-M10): validate + clamp a partial settings body before it is
 * merged into the durable `session/settings` event. Previously body fields
 * were merged verbatim — maxStepsPerTurn 0/negative made every turn hit the
 * step guard ("达到最大步数限制" on each request), a string temperature broke
 * every subsequent LLM call, and the corruption was durable.
 * Returns { ok, value } — ok=false carries a user-actionable message.
 */
function validateSettingsBody(
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

/** Extract the latest settings from a session event log. (Delegates to the shared implementation.) */
// (See extractSettings re-export above — R169/AGENT-L8.)

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const manager = getAgentManager();
  const session = await manager.ensureSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  const events = manager.getEvents(sessionId);
  const settings = extractSettings(events);
  return NextResponse.json({ settings });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const manager = getAgentManager();
  const session = await manager.ensureSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  let body: Partial<SessionSettings>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  // R168 (AGENT-M10): validate before merging — bad values used to persist
  // durably and break every subsequent drive (see validateSettingsBody).
  const validated = validateSettingsBody(body);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }
  body = validated.value;

  // Merge with existing settings (partial update).
  const events = manager.getEvents(sessionId);
  const existing = extractSettings(events);
  const merged: SessionSettings = { ...existing, ...body };

  // Append a session/settings event (durable).
  session.append('session/settings' as never, merged as never);

  return NextResponse.json({ ok: true, settings: merged });
}
