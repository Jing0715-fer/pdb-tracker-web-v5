/**
 * POST /api/agent/sessions/[sessionId]/tool-results
 *
 * Submit client-side (Molstar) tool execution results, then drive the next
 * step. The body is a list of { callId, name, ok, result?, error? }. The
 * manager appends tool/result events to the session log and continues the
 * loop.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAgentManager } from '@/lib/agent/manager';
import type { CallId } from '@/lib/agent/types';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

interface ToolResultInput {
  callId: string;
  name: string;
  ok: boolean;
  result?: unknown;
  error?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const manager = getAgentManager();
  // If the session isn't in memory, try to resume it from the DB.
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

  let body: { results?: ToolResultInput[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body.results || !Array.isArray(body.results)) {
    return NextResponse.json({ error: 'results array is required' }, { status: 400 });
  }

  // Security gate: verify approval-required tools have a corresponding
  // approval/decided event before accepting the result. This prevents a
  // malicious client from bypassing approval by POSTing tool-results directly.
  const { requiresApproval } = await import('@/lib/agent/pdb-tools');
  const events = manager.getEvents(sessionId);
  const decidedCallIds = new Set<string>();
  for (const ev of events) {
    if (ev.type === 'approval/decided') {
      const data = ev.data as { callId: string; decision: string };
      if (data.decision === 'allowed-once') {
        decidedCallIds.add(data.callId);
      }
    }
  }
  for (const r of body.results) {
    if (requiresApproval(r.name) && !decidedCallIds.has(r.callId)) {
      return NextResponse.json(
        { error: `Tool "${r.name}" requires approval before results can be submitted` },
        { status: 403 },
      );
    }
  }

  try {
    const outcome = await manager.submitResults(
      sessionId,
      body.results.map((r) => ({
        callId: r.callId as CallId,
        name: r.name,
        ok: r.ok,
        result: r.result,
        error: r.error,
      })),
    );
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
