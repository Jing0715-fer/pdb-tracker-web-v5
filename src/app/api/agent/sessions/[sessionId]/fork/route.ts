/**
 * POST /api/agent/sessions/[sessionId]/fork
 *
 * Fork a session: create a NEW session with events copied up to (and
 * including) the given `fromSeq`. Events after `fromSeq` are dropped.
 *
 * This enables "edit message → fork from here" — the user can branch a
 * conversation from any point and continue differently.
 *
 * Body: { fromSeq: number, title?: string }
 *   - fromSeq: the seq of the last event to include in the fork (inclusive)
 *   - title: optional title for the new session (defaults to "Fork of <original>")
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAgentManager } from '@/lib/agent/manager';
import type { SessionEvent } from '@/lib/agent/session/types';

export const runtime = 'nodejs';
export const maxDuration = 30;
export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const manager = getAgentManager();

  // Resume the source session if it's not in memory.
  let sourceSession = manager.getSession(sessionId);
  if (!sourceSession) {
    const resumed = await manager.resumeSession(sessionId);
    if (!resumed) {
      return NextResponse.json({ error: 'Source session not found' }, { status: 404 });
    }
    sourceSession = resumed.session;
  }

  let body: { fromSeq?: number; title?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof body.fromSeq !== 'number') {
    return NextResponse.json({ error: 'fromSeq is required' }, { status: 400 });
  }

  const sourceEvents = manager.getEvents(sessionId);
  // Take events up to and including fromSeq.
  const forkEvents = sourceEvents.filter((e) => e.seq <= body.fromSeq!);

  if (forkEvents.length === 0) {
    return NextResponse.json({ error: 'No events to fork at the given seq' }, { status: 400 });
  }

  // Create a new session with the forked events.
  const title = body.title ?? `Fork of ${sourceSession.title}`;
  const { sessionId: newSessionId, session: newSession } = manager.createSession({ title });

  // Replay the forked events into the new session. We re-append with new
  // seqs + times, preserving event type + data + surfaceOp.
  // R168 (AGENT-M9): replay the ORIGINAL surfaceOp — the previous code
  // rewrote every surface-eligible event to {op:'append'}, discarding the
  // replace ops emitted by regenerate's followupWithReplace: forking a
  // session that used regenerate resurrected the replaced-out assistant
  // turn (both stale + regenerated answers visible to the fork's LLM).
  // replace ops reference SOURCE seqs — remap them through seqMap since the
  // new session renumbers. When either endpoint is not part of the forked
  // range (defensive), degrade to append.
  const seqMap = new Map<number, number>();
  for (const ev of forkEvents) {
    const isSurfaceEligible =
      ev.type === 'user/message' || ev.type === 'assistant/message' || ev.type === 'tool/result';
    let surfaceOpExtra: { surfaceOp?: { op: 'append' } | { op: 'replace'; start: number; end: number } } = {};
    if (isSurfaceEligible) {
      const sop = (ev as { surfaceOp?: { op: string; start?: number; end?: number } }).surfaceOp;
      if (sop?.op === 'replace' && typeof sop.start === 'number' && typeof sop.end === 'number') {
        const start = seqMap.get(sop.start);
        const end = seqMap.get(sop.end);
        if (start !== undefined && end !== undefined) {
          surfaceOpExtra = { surfaceOp: { op: 'replace', start, end } };
        } else {
          surfaceOpExtra = { surfaceOp: { op: 'append' } };
        }
      } else {
        surfaceOpExtra = { surfaceOp: { op: 'append' } };
      }
    }
    const appended = newSession.append(ev.type as never, ev.data as never, surfaceOpExtra as never);
    seqMap.set(ev.seq, appended.seq);
  }

  return NextResponse.json({
    ok: true,
    sessionId: newSessionId,
    title: newSession.title,
    eventCount: newSession.eventCount,
    forkedFrom: sessionId,
    forkedAtSeq: body.fromSeq,
  });
}
