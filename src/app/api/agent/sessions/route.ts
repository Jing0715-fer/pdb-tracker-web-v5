/**
 * POST /api/agent/sessions — create a new agent session.
 * GET  /api/agent/sessions — list sessions.
 *
 * A session is an append-only event log + an AgentLoop. Sessions live in
 * process memory (module-level singleton AgentManager) for the dev server's
 * lifetime.
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
  return NextResponse.json({ sessions: manager.listSessions() });
}
