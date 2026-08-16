/**
 * POST /api/agent/sessions/import
 *
 * Import a session from a JSON export (format=json from the export route).
 * Creates a new session + replays all events from the JSON. The imported
 * session gets a new session ID (to avoid collisions) but preserves the
 * original title, events, and timestamps.
 *
 * Body: { title: string, events: SessionEvent[] }  (from export?format=json)
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAgentManager } from '@/lib/agent/manager';
import type { SessionEvent } from '@/lib/agent/session/types';

export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const manager = getAgentManager();
  let body: { title?: string; events?: SessionEvent[]; sessionId?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.events || !Array.isArray(body.events)) {
    return NextResponse.json({ error: 'events array is required' }, { status: 400 });
  }

  // Create a new session (new ID) and replay events.
  const { sessionId, session } = manager.createSession({
    title: body.title ?? 'Imported session',
  });

  // Replay each event from the import into the new session.
  // We re-append with new seqs + times, preserving the event type + data.
  for (const ev of body.events) {
    if (!ev.type || typeof ev.type !== 'string') continue;
    // Skip turn/step boundary events — they'll be recreated naturally
    // as the user continues the conversation. Keep user/assistant/tool
    // messages + feedback + settings.
    if (
      ev.type === 'user/message' ||
      ev.type === 'assistant/message' ||
      ev.type === 'tool/call' ||
      ev.type === 'tool/result' ||
      ev.type === 'session/title' ||
      ev.type === 'feedback/record' ||
      ev.type === 'session/settings' ||
      ev.type === 'request/header'
    ) {
      const surfaceOp =
        ev.type === 'user/message' || ev.type === 'assistant/message' || ev.type === 'tool/result'
          ? { surfaceOp: { op: 'append' as const } }
          : {};
      session.append(ev.type as never, ev.data as never, surfaceOp as never);
    }
  }

  return NextResponse.json({
    ok: true,
    sessionId,
    title: session.title,
    eventCount: session.eventCount,
  });
}
