/**
 * POST /api/agent/sessions — create a new agent session.
 * GET  /api/agent/sessions — list sessions (merged: in-memory + persisted).
 *
 * A session is an append-only event log + an AgentLoop. Sessions are persisted
 * to a Prisma AgentSessionEvent table (best-effort) so they survive server
 * restarts; resume via POST /api/agent/sessions/[id]/resume.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAgentManager } from '@/lib/agent/manager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const manager = getAgentManager();
    const { sessionId, session } = manager.createSession({
      title: body?.title,
      agent: body?.agent,
    });
    return NextResponse.json({
      sessionId,
      title: session.title,
      createdAt: session.createdAt,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

export async function GET() {
  const manager = getAgentManager();
  // R169 (AGENT-L10): comment now matches the code — this returns ONLY the
  // persisted sessions (the old comment claimed an in-memory merge that the
  // implementation never performed).
  const persisted = await manager.listPersistedSessions();
  return NextResponse.json({
    sessions: persisted,
  });
}
