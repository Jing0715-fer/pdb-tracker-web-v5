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
import type { SessionEvent } from '@/lib/agent/session/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface SessionSettings {
  model?: string;
  providerId?: string;
  temperature?: number;
  maxStepsPerTurn?: number;
  systemPromptOverride?: string;
}

/** Extract the latest settings from a session event log. */
export function extractSettings(events: SessionEvent[]): SessionSettings {
  // Walk backwards to find the latest session/settings event.
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]!;
    if (ev.type === 'session/settings' as string) {
      return ev.data as SessionSettings;
    }
  }
  return {};
}

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

  // Merge with existing settings (partial update).
  const events = manager.getEvents(sessionId);
  const existing = extractSettings(events);
  const merged: SessionSettings = { ...existing, ...body };

  // Append a session/settings event (durable).
  session.append('session/settings' as never, merged as never);

  return NextResponse.json({ ok: true, settings: merged });
}
