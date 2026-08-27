/**
 * Agent persistence — mirrors session appends to a Prisma AgentSessionEvent
 * table so sessions survive server restarts.
 *
 * The in-memory Session is still authoritative (fast reads, the surface fold,
 * live subscribers). This layer drains appends to SQLite asynchronously: a
 * background promise per append never blocks the agent loop.
 *
 * Resume: on manager init, load all AgentSession rows + their events in seq
 * order and rebuild the in-memory Session via Session.fromJSON().
 */

import { db } from '@/lib/db';
import type { SessionEvent } from './session/types';

/** Persist (or update) a session row. */
export async function upsertSessionRow(sessionId: string, title: string, createdAt: number): Promise<void> {
  try {
    await db.agentSession.upsert({
      where: { id: sessionId },
      create: { id: sessionId, title, createdAt: new Date(createdAt) },
      update: { title, updatedAt: new Date() },
    });
  } catch (err) {
    // Persistence is best-effort — never break the agent loop over a DB write.
    console.error('[agent-persistence] upsertSessionRow failed:', err);
  }
}

/** Append one event row. */
export async function appendEventRow(sessionId: string, event: SessionEvent): Promise<void> {
  try {
    await db.agentSessionEvent.create({
      data: {
        sessionId,
        seq: event.seq,
        type: event.type,
        data: JSON.stringify(event.data),
        time: new Date(event.time),
      },
    });
    // Touch the session's updatedAt so it sorts to the top of the history list.
    await db.agentSession.update({
      where: { id: sessionId },
      data: { updatedAt: new Date() },
    });
  } catch (err) {
    console.error('[agent-persistence] appendEventRow failed:', err);
  }
}

/** Load all sessions (for the history sidebar). */
export async function listSessionRows(): Promise<
  Array<{ id: string; title: string; createdAt: Date; updatedAt: Date; _count: { events: number } }>
> {
  try {
    return await db.agentSession.findMany({
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { events: true } } },
    });
  } catch (err) {
    console.error('[agent-persistence] listSessionRows failed:', err);
    return [];
  }
}

/** Load one session's events in seq order (for resume). */
export async function loadSessionEvents(sessionId: string): Promise<SessionEvent[]> {
  try {
    const rows = await db.agentSessionEvent.findMany({
      where: { sessionId },
      orderBy: { seq: 'asc' },
    });
    // R168 (AGENT-M3): a single malformed row used to fail the WHOLE load
    // (the function-wide catch returned []) — the session then looked wiped
    // on resume while the DB still held its events, and subsequent appends
    // created duplicate (sessionId, seq) rows. Parse per-row instead: skip +
    // warn on bad rows so one corrupt entry can at most lose itself.
    const events: SessionEvent[] = [];
    let skipped = 0;
    for (const r of rows) {
      try {
        events.push({
          type: r.type,
          seq: r.seq,
          time: r.time.getTime(),
          data: JSON.parse(r.data),
        } as SessionEvent);
      } catch (rowErr) {
        skipped++;
        console.warn(
          `[agent-persistence] skipping corrupt event row (session=${sessionId} seq=${r.seq}):`,
          rowErr instanceof Error ? rowErr.message : rowErr
        );
      }
    }
    if (skipped > 0) {
      console.warn(`[agent-persistence] loadSessionEvents: skipped ${skipped}/${rows.length} corrupt rows for session ${sessionId}`);
    }
    return events;
  } catch (err) {
    console.error('[agent-persistence] loadSessionEvents failed:', err);
    return [];
  }
}

/** Load one session row (title + createdAt). */
export async function getSessionRow(sessionId: string): Promise<{
  id: string;
  title: string;
  createdAt: Date;
} | null> {
  try {
    return await db.agentSession.findUnique({ where: { id: sessionId } });
  } catch (err) {
    // R168 (AGENT-L3): log like every sibling — a transient DB failure was
    // indistinguishable from "session not found" (resume 404'd without a trace).
    console.error('[agent-persistence] getSessionRow failed:', err);
    return null;
  }
}

/** Delete a session + its events (cascade). */
export async function deleteSessionRow(sessionId: string): Promise<void> {
  try {
    await db.agentSession.delete({ where: { id: sessionId } });
  } catch (err) {
    console.error('[agent-persistence] deleteSessionRow failed:', err);
  }
}
