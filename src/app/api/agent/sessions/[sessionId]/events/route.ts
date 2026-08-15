/**
 * GET /api/agent/sessions/[sessionId]/events
 *
 * Server-Sent Events stream of session events. The client subscribes to
 * reconstruct the conversation UI in real time: assistant/chunk for streaming
 * tokens, assistant/message for the final message, tool/call + tool/result
 * for tool cards, turn/step boundaries for layout.
 *
 * On connect, the server replays the existing event log, then streams new
 * appends as they happen.
 */

import { NextRequest } from 'next/server';
import { getAgentManager } from '@/lib/agent/manager';
import type { SessionEvent } from '@/lib/agent/session/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const manager = getAgentManager();
  const session = manager.getSession(sessionId);
  if (!session) {
    return new Response('Session not found', { status: 404 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let closed = false;
      const send = (event: string, data: unknown) => {
        if (closed) return;
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        try {
          controller.enqueue(encoder.encode(payload));
        } catch {
          closed = true;
        }
      };

      // Replay existing events.
      for (const ev of manager.getEvents(sessionId)) {
        send('event', ev);
      }
      send('replay-done', { count: manager.getEvents(sessionId).length });

      // Subscribe to new appends.
      const unsubscribe = manager.context.on('session/event', (payload) => {
        if (payload.sessionId === sessionId) {
          send('event', payload.event as SessionEvent);
        }
      });

      // Heartbeat every 25s to keep the connection alive.
      const heartbeat = setInterval(() => send('heartbeat', { time: Date.now() }), 25_000);

      request.signal.addEventListener('abort', () => {
        closed = true;
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
