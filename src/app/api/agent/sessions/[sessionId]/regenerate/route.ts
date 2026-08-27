/**
 * POST /api/agent/sessions/[sessionId]/regenerate
 *
 * R164 (AGENT-003): TRUE regeneration — drops the previous assistant turn
 * from the model-visible surface (via SurfaceOp.replace carried through the
 * inbox) while preserving the full event log for audit, then re-drives
 * the agent from the last user message.
 *
 * Previous implementation just appended a duplicate user message + drove,
 * which doubled the chat on every Regenerate click and never actually
 * replaced the prior assistant answer. Now we:
 *   1. Find the last user/message seq.
 *   2. Compute the surface range to drop: [lastUserSeq + 1, lastEventSeq].
 *   3. Call loop.followupWithReplace(userText, start, end) — enqueues a
 *      user message that carries surfaceOp.replace. When drive() claims
 *      it and appends it to the session, SurfaceManager.recompute drops
 *      the prior assistant turn + tool results from the surface (LLM no
 *      longer sees them) but the events stay in the durable log.
 *   4. Drive the loop — deriveMessages() projects only the surface up to
 *      the new user message, so the LLM produces a fresh answer.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAgentManager } from '@/lib/agent/manager';

export const runtime = 'nodejs';
// R164 (AGENT-005): raised from 60 to match the messages route —
// regenerate calls loop.drive() which now retries on 429 with
// 5s / 15s / 45s backoff.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const manager = getAgentManager();
  const session = await manager.ensureSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  const loop = manager.getLoop(sessionId);
  if (!loop) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }

  // AG2-02: run the orphaned tool-call recovery BEFORE computing the
  // replace range. If the client dropped mid-turn, drive()'s entry-point
  // recovery would otherwise append synthesized tool/result events with
  // seqs GREATER than the replaceEnd computed from the pre-recovery tail —
  // those events escape the replace range while their parent assistant
  // tool_calls message is dropped, leaving dangling tool messages on the
  // surface and permanently breaking every subsequent LLM call
  // (wire-format 400). Recovery is idempotent (drive() re-runs it as a
  // no-op) and only appends tool/result + turn/end events, so the last
  // user/message seq computed below is unaffected.
  loop.recoverOrphans();

  // Find the last user/message event seq.
  const events = manager.getEvents(sessionId);
  let lastUserSeq = -1;
  let lastUserEvent = null as null | (typeof events)[number];
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i]!.type === 'user/message') {
      lastUserSeq = events[i]!.seq;
      lastUserEvent = events[i]!;
      break;
    }
  }
  if (lastUserSeq < 0 || !lastUserEvent) {
    return NextResponse.json(
      { error: 'No user message to regenerate from' },
      { status: 400 },
    );
  }

  // Compute the surface range to drop: [lastUserSeq + 1, lastEventSeq].
  const lastEvent = events[events.length - 1];
  const replaceEnd = lastEvent ? lastEvent.seq : lastUserSeq;
  const replaceStart = lastUserSeq + 1;

  // Extract the user's text from the prior user/message event.
  const userData = lastUserEvent.data as {
    content: Array<{ type: string; text?: string }>;
  };
  const userText = userData.content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text!)
    .join(' ');

  // Enqueue the user message with surfaceOp.replace — drive() will claim
  // it, open a fresh turn, and append it; SurfaceManager drops the
  // [replaceStart, replaceEnd] range from the model-visible surface
  // (the previous assistant turn + tool results) before appending this
  // new user message.
  if (replaceStart <= replaceEnd) {
    loop.followupWithReplace(userText, replaceStart, replaceEnd);
  } else {
    // No prior assistant turn to drop — just re-ask the same question.
    loop.followup(userText);
  }

  try {
    const outcome = await manager.drive(sessionId);
    if (outcome.kind === 'error') {
      return NextResponse.json({ error: outcome.error }, { status: 500 });
    }
    if (outcome.kind === 'done') {
      return NextResponse.json({
        done: true,
        finalContent: outcome.finalContent,
        turn: outcome.turn,
        steps: outcome.steps,
      });
    }
    return NextResponse.json({
      done: false,
      turn: outcome.turn,
      step: outcome.step,
      assistantText: outcome.assistantText,
      toolCalls: outcome.calls.map((c) => ({
        callId: c.callId,
        name: c.name,
        arguments: c.arguments,
      })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
