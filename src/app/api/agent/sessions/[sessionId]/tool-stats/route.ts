/**
 * GET /api/agent/sessions/[sessionId]/tool-stats
 *
 * Compute per-tool execution statistics from the session event log:
 *   - callCount: number of times the tool was called
 *   - successCount: number of successful executions
 *   - errorCount: number of failed executions
 *   - successRate: successCount / callCount
 *
 * Statistics are derived from tool/call + tool/result event pairs.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAgentManager } from '@/lib/agent/manager';
import type { SessionEvent } from '@/lib/agent/session/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export interface ToolStat {
  name: string;
  callCount: number;
  successCount: number;
  errorCount: number;
  successRate: number;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const manager = getAgentManager();
  const session = await manager.ensureSession(sessionId);
  if (!session) {
    return NextResponse.json({ error: 'Session not found' }, { status: 404 });
  }
  const events = manager.getEvents(sessionId);

  // Build a map of callId → tool name from tool/call events.
  const callMap = new Map<string, string>();
  for (const ev of events) {
    if (ev.type === 'tool/call') {
      const data = ev.data as { callId: string; name: string };
      callMap.set(data.callId, data.name);
    }
  }

  // Tally results per tool name.
  const stats = new Map<string, { callCount: number; successCount: number; errorCount: number }>();
  for (const ev of events) {
    if (ev.type === 'tool/result') {
      const data = ev.data as { message: { source: { kind: string; callId?: string } }; error?: { message: string } };
      const callId = data.message.source.callId;
      if (!callId) continue;
      const name = callMap.get(callId);
      if (!name) continue;
      const stat = stats.get(name) ?? { callCount: 0, successCount: 0, errorCount: 0 };
      stat.callCount += 1;
      if (data.error) {
        stat.errorCount += 1;
      } else {
        stat.successCount += 1;
      }
      stats.set(name, stat);
    }
  }

  // Also count calls that don't have results yet (pending).
  const resultCallIds = new Set(
    events
      .filter((e) => e.type === 'tool/result')
      .map((e) => (e.data as { message: { source: { callId?: string } } }).message.source.callId),
  );
  for (const [callId, name] of callMap) {
    if (!resultCallIds.has(callId)) {
      const stat = stats.get(name) ?? { callCount: 0, successCount: 0, errorCount: 0 };
      stat.callCount += 1;
      stats.set(name, stat);
    }
  }

  const result: ToolStat[] = [...stats.entries()]
    .map(([name, s]) => ({
      name,
      callCount: s.callCount,
      successCount: s.successCount,
      errorCount: s.errorCount,
      successRate: s.callCount > 0 ? s.successCount / s.callCount : 0,
    }))
    .sort((a, b) => b.callCount - a.callCount);

  return NextResponse.json({ stats: result, totalCalls: result.reduce((sum, s) => sum + s.callCount, 0) });
}
