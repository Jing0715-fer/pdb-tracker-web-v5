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
import { upsertSessionRow } from '@/lib/agent/persistence';
import { validateSettingsBody, type SessionSettings } from '@/lib/agent/session/settings';
import type { SessionEvent } from '@/lib/agent/session/types';

export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

// AG2-09: server-side import caps. The client's 10MB file picker limit
// (UI-022) only guards the browser path — the API accepted arbitrarily
// large imports, ballooning memory, the SQLite rows, and the event log.
const MAX_IMPORT_JSON_CHARS = 50 * 1024 * 1024; // 50MB total JSON
const MAX_IMPORT_EVENTS = 20_000;

export async function POST(request: NextRequest) {
  const manager = getAgentManager();
  // AG2-09: read the raw text first so the size cap is authoritative
  // (Content-Length can be absent or lying for chunked uploads).
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
  if (raw.length > MAX_IMPORT_JSON_CHARS) {
    return NextResponse.json(
      { error: `Import payload too large (${raw.length} chars; the maximum is 50MB)` },
      { status: 413 },
    );
  }
  let body: { title?: string; events?: SessionEvent[]; sessionId?: string };
  try {
    body = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (!body.events || !Array.isArray(body.events)) {
    return NextResponse.json({ error: 'events array is required' }, { status: 400 });
  }
  // AG2-09: event-count cap.
  if (body.events.length > MAX_IMPORT_EVENTS) {
    return NextResponse.json(
      { error: `Import contains too many events (${body.events.length}; the maximum is ${MAX_IMPORT_EVENTS})` },
      { status: 400 },
    );
  }

  // Create a new session (new ID) and replay events.
  //
  // AG2-09: replayed `session/settings` events are validated inside the
  // replay loop below with the shared R168-M10 validator — they previously
  // went straight into session.append, so a corrupted/tampered import
  // ({maxStepsPerTurn: 0, temperature: "x"}) durably broke the imported
  // session on its first drive. Chosen semantics: SKIP-AND-WARN — one bad
  // settings event must not kill the whole import (the conversation history
  // is still valuable); the session simply falls back to defaults for the
  // dropped settings. A non-object data payload is treated as invalid too
  // (it would otherwise pass validateSettingsBody vacuously and persist
  // garbage the extractor later trusts).
  const { sessionId, session } = manager.createSession({
    title: body.title ?? 'Imported session',
  });

  // AG2-09 (incidental FK race, found during smoke testing): createSession
  // persists the session row fire-and-forget while the replay below appends
  // events immediately — the event INSERTs can reach SQLite BEFORE the
  // parent AgentSession row lands, violating the FK and silently dropping
  // replayed events (observed ~1/3 of imports: row present, 0 events — the
  // imported conversation then vanished on the next server restart).
  // Await the idempotent upsert so every replayed event has its parent row.
  await upsertSessionRow(sessionId, session.title, session.createdAt);

  // Replay each event from the import into the new session.
  // We re-append with new seqs + times, preserving the event type + data.
  let skippedSettings = 0;
  for (const ev of body.events) {
    // AG2-09: also skip malformed (non-object) entries — a null/number
    // entry previously threw a TypeError mid-replay, 500ing after the
    // session had already been created.
    if (!ev || typeof ev !== 'object' || !ev.type || typeof ev.type !== 'string') continue;

    // AG2-09: validate replayed session/settings events with the shared
    // validator; SKIP (with a warn) when invalid — see the comment above
    // the replay loop. Valid events are appended with the VALIDATED value
    // (whitelisted fields only) so unknown extra fields in the import
    // don't ride along into the durable log.
    if (ev.type === 'session/settings') {
      if (ev.data === null || typeof ev.data !== 'object') {
        skippedSettings += 1;
        console.warn(
          `[agent-import] AG2-09: skipping session/settings event with non-object data — ${JSON.stringify(ev.data)?.slice(0, 200)}`,
        );
        continue;
      }
      const validated = validateSettingsBody(ev.data as Partial<SessionSettings>);
      if (!validated.ok) {
        skippedSettings += 1;
        console.warn(
          `[agent-import] AG2-09: skipping invalid session/settings event (${validated.error}) — data: ${JSON.stringify(ev.data).slice(0, 200)}`,
        );
        continue;
      }
      session.append(ev.type as never, validated.value as never);
      continue;
    }

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
      ev.type === 'request/header'
    ) {
      const surfaceOp =
        ev.type === 'user/message' || ev.type === 'assistant/message' || ev.type === 'tool/result'
          ? { surfaceOp: { op: 'append' as const } }
          : {};
      session.append(ev.type as never, ev.data as never, surfaceOp as never);
    }
  }
  if (skippedSettings > 0) {
    console.warn(
      `[agent-import] AG2-09: skipped ${skippedSettings} invalid session/settings event(s); the imported session falls back to default settings for those`,
    );
  }

  return NextResponse.json({
    ok: true,
    sessionId,
    title: session.title,
    eventCount: session.eventCount,
  });
}
