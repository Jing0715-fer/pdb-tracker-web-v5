/**
 * GET    /api/agent/sessions/[sessionId] — fetch session events (full log).
 * DELETE /api/agent/sessions/[sessionId] — delete a session.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAgentManager } from '@/lib/agent/manager';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const manager = getAgentManager();
  const session = manager.getSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  return NextResponse.json({
    sessionId: session.id,
    title: session.title,
    createdAt: session.createdAt,
    eventCount: session.eventCount,
    events: manager.getEvents(sessionId),
  });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const manager = getAgentManager();
  manager.deleteSession(sessionId);
  return NextResponse.json({ ok: true });
}
