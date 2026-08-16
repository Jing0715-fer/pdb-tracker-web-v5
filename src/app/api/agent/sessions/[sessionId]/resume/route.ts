/**
 * POST /api/agent/sessions/[sessionId]/resume — resume a persisted session.
 *
 * Loads events from the DB, rebuilds the in-memory Session + AgentLoop, and
 * returns the session metadata. Subsequent POST /messages and the SSE stream
 * then operate on the resumed session.
 *
 * If the session is already live in memory (e.g. server didn't restart), this
 * is a no-op that returns the existing session.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAgentManager } from '@/lib/agent/manager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const manager = getAgentManager();
  const result = await manager.resumeSession(sessionId);
  if (!result) {
    return NextResponse.json({ error: 'Session not found in persistence' }, { status: 404 });
  }
  return NextResponse.json({
    sessionId: result.session.id,
    title: result.session.title,
    createdAt: result.session.createdAt,
    eventCount: result.session.eventCount,
  });
}
