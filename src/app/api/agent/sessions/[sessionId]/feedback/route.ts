/**
 * POST /api/agent/sessions/[sessionId]/feedback
 *
 * Record user feedback (thumbs up/down) on an assistant message. Appends a
 * `feedback/record` session event so the rating is durable + queryable.
 *
 * Body: { messageSeq: number, rating: 'up' | 'down', comment?: string }
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAgentManager } from '@/lib/agent/manager';

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

  let body: { messageSeq?: number; rating?: string; comment?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  if (typeof body.messageSeq !== 'number') {
    return NextResponse.json({ error: 'messageSeq is required' }, { status: 400 });
  }
  if (body.rating !== 'up' && body.rating !== 'down') {
    return NextResponse.json({ error: 'rating must be "up" or "down"' }, { status: 400 });
  }

  session.append('feedback/record', {
    messageSeq: body.messageSeq,
    rating: body.rating,
    comment: body.comment,
  });

  return NextResponse.json({ ok: true });
}
