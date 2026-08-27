/**
 * POST /api/agent/sessions/[sessionId]/approval
 *
 * Resolve a pending approval. When a tool requires approval (export_snapshot,
 * clear_chat), the agent loop's pre-execute returns 'ask', the ApprovalService
 * holds a pending promise, and the server emits an 'approval/asked' session
 * event. The client renders an ApprovalPanel; when the user clicks Allow /
 * Reject, the client POSTs here to resolve the promise.
 *
 * Body: { callId, decision: 'allowed-once' | 'rejected' | 'cancelled' }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAgentManager } from '@/lib/agent/manager';
import type { CallId } from '@/lib/agent/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

  let body: { callId?: string; decision?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!body.callId || !body.decision) {
    return NextResponse.json(
      { error: 'callId and decision are required' },
      { status: 400 },
    );
  }

  const validDecisions = ['allowed-once', 'rejected', 'cancelled'] as const;
  if (!validDecisions.includes(body.decision as (typeof validDecisions)[number])) {
    return NextResponse.json({ error: 'Invalid decision' }, { status: 400 });
  }

  // AG2-11: pass the sessionId so the resolution is scoped to THIS
  // session — resolveApproval previously scanned all in-memory sessions
  // for the callId, letting one session's route decide approvals (and
  // append approval/decided events) in another session.
  const resolved = manager.resolveApproval(
    sessionId,
    body.callId as CallId,
    body.decision as (typeof validDecisions)[number],
  );
  if (!resolved) {
    return NextResponse.json(
      { error: 'No pending approval for that callId in this session' },
      { status: 404 },
    );
  }
  return NextResponse.json({ ok: true });
}
