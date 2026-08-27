/**
 * POST /api/agent/sessions/[sessionId]/messages
 *
 * Send a user message and drive the agent loop one step. Returns either:
 *   - { done: true, finalContent, turn, steps } — the turn is complete
 *   - { done: false, toolCalls: [...], turn, step, assistantText } — the client
 *     must execute each toolCall against Molstar, then POST the results to
 *     /tool-results.
 *
 * Server-side tools (fetch_metadata) execute inline during the step; only
 * client-side (Molstar) tool calls are returned to the caller.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAgentManager } from '@/lib/agent/manager';

export const runtime = 'nodejs';
// R164 (AGENT-005): raised from 60 — the LLM stream now retries on 429
// with 5s / 15s / 45s backoff (mirroring the VLM route), so a single
// drive() can take up to 65s of backoff + 60s+ of streaming per attempt.
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const manager = getAgentManager();
  // If the session isn't in memory (e.g. server restarted), try to resume it
  // from the persisted DB before proceeding.
  let loop = manager.getLoop(sessionId);
  if (!loop) {
    const resumed = await manager.resumeSession(sessionId);
    if (!resumed) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    loop = manager.getLoop(sessionId);
    if (!loop) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
  }

  let body: { content?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  const content = body?.content?.trim();
  if (!content) {
    return NextResponse.json({ error: 'content is required' }, { status: 400 });
  }

  // Queue the user follow-up.
  loop.followup(content);

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
    // tool-calls — client executes against Molstar.
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
