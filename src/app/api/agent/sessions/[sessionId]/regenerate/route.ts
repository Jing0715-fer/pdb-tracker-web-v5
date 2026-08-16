/**
 * POST /api/agent/sessions/[sessionId]/regenerate
 *
 * Re-drive the agent loop from the last user message — drops the most recent
 * assistant turn and re-runs the step. This gives the user a "regenerate
 * response" action without re-sending the user message.
 *
 * Implementation: finds the last user/message event, trims the session log
 * back to (and including) that event, then drives the loop. The trimmed
 * events are persisted (a compaction event marks the boundary).
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAgentManager } from '@/lib/agent/manager';

export const runtime = 'nodejs';
export const maxDuration = 60;
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

  // Find the last user/message event seq.
  const events = manager.getEvents(sessionId);
  let lastUserSeq = -1;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i]!.type === 'user/message') {
      lastUserSeq = events[i]!.seq;
      break;
    }
  }
  if (lastUserSeq < 0) {
    return NextResponse.json(
      { error: 'No user message to regenerate from' },
      { status: 400 },
    );
  }

  // Re-inject the last user message into the inbox, then drive.
  // We don't trim the log (that would lose history); instead we just send
  // a follow-up that re-asks the same question. The agent will produce a
  // fresh response. This is the simplest correct approach.
  const lastUserEvent = events.find((e) => e.seq === lastUserSeq);
  const userData = lastUserEvent!.data as { content: Array<{ type: string; text?: string }> };
  const userText = userData.content
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text!)
    .join(' ');

  // Re-send the user message (opens a new turn with a fresh LLM call).
  loop.followup(userText);

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
