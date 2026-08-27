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
import {
  extractSessionSettings,
  validateSettingsBody,
  type SessionSettings,
} from '@/lib/agent/session/settings';
import type { SessionEvent } from '@/lib/agent/session/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// R169 (AGENT-L8): SessionSettings + extraction now live in
// lib/agent/session/settings.ts (single source of truth, shared with the
// agent loop). Re-export for API-shape compatibility.
export type { SessionSettings };
export const extractSettings = (events: SessionEvent[]): SessionSettings =>
  extractSessionSettings(events);

// R168 (AGENT-M10) / AG2-06: validateSettingsBody now lives in the shared
// session/settings module (single source of truth with the sessions + import
// routes) — see the import above.

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
