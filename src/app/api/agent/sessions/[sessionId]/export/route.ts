/**
 * GET /api/agent/sessions/[sessionId]/export?format=md|json
 *
 * Export a session as Markdown (human-readable transcript) or JSON (raw event
 * log). The Markdown format renders user/assistant messages and tool call
 * summaries — ideal for sharing or archiving a conversation.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAgentManager } from '@/lib/agent/manager';
import type { SessionEvent } from '@/lib/agent/session/types';
import type { ContentBlock } from '@/lib/agent/llm/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function blocksToText(blocks: ContentBlock[]): string {
  return blocks
    .filter((b): b is Extract<ContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('');
}

function blocksToToolCalls(blocks: ContentBlock[]): Array<{ id: string; name: string; arguments: string }> {
  return blocks.filter(
    (b): b is Extract<ContentBlock, { type: 'tool-call' }> => b.type === 'tool-call',
  ).map((b) => ({ id: b.id, name: b.name, arguments: b.arguments }));
}

function formatToolResult(content: ContentBlock[]): string {
  return content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('')
    .slice(0, 500);
}

/** Render the session event log as a Markdown transcript. */
function eventsToMarkdown(sessionId: string, title: string, events: SessionEvent[]): string {
  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`> Session ID: \`${sessionId}\``);
  lines.push(`> Events: ${events.length}`);
  const msgCount = events.filter((e) => e.type === 'user/message' || e.type === 'assistant/message').length;
  const toolCount = events.filter((e) => e.type === 'tool/call').length;
  lines.push(`> Messages: ${msgCount} · Tool calls: ${toolCount}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  let currentTurn = 0;
  for (const ev of events) {
    switch (ev.type) {
      case 'turn/start': {
        const data = ev.data as { turn: number };
        if (data.turn > 1) {
          lines.push('');
          lines.push('---');
          lines.push('');
        }
        currentTurn = data.turn;
        lines.push(`## Turn ${data.turn}`);
        lines.push('');
        break;
      }
      case 'user/message': {
        const data = ev.data as { content: ContentBlock[] };
        const text = blocksToText(data.content);
        lines.push(`### 👤 User`);
        lines.push('');
        lines.push(text);
        lines.push('');
        break;
      }
      case 'assistant/message': {
        const data = ev.data as { message: { content: ContentBlock[] }; usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } };
        const text = blocksToText(data.message.content);
        const toolCalls = blocksToToolCalls(data.message.content);
        lines.push(`### 🤖 Assistant`);
        lines.push('');
        if (text) {
          lines.push(text);
          lines.push('');
        }
        for (const tc of toolCalls) {
          lines.push(`**Tool Call:** \`${tc.name}\``);
          lines.push('```json');
          lines.push(tc.arguments);
          lines.push('```');
          lines.push('');
        }
        if (data.usage) {
          lines.push(`<sub>Tokens: ${data.usage.totalTokens ?? 0} (prompt ${data.usage.promptTokens ?? 0} + completion ${data.usage.completionTokens ?? 0})</sub>`);
          lines.push('');
        }
        break;
      }
      case 'tool/result': {
        const data = ev.data as { message: { content: ContentBlock[]; source: { callId: string } }; error?: { message: string } };
        const result = formatToolResult(data.message.content);
        const status = data.error ? '❌ Error' : '✅ Result';
        lines.push(`<details><summary><b>${status}</b></summary>`);
        lines.push('');
        lines.push('```');
        lines.push(result || (data.error?.message ?? '(empty)'));
        lines.push('```');
        lines.push('');
        lines.push('</details>');
        lines.push('');
        break;
      }
      case 'turn/end': {
        const data = ev.data as { turn: number; reason: { kind: string } };
        if (data.reason.kind !== 'completed') {
          lines.push(`<sub>Turn ${data.turn} ended: ${data.reason.kind}</sub>`);
          lines.push('');
        }
        break;
      }
    }
  }
  return lines.join('\n');
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const { sessionId } = await params;
  const format = request.nextUrl.searchParams.get('format') ?? 'md';
  const manager = getAgentManager();
  // If the session isn't in memory (e.g. server restarted), resume it from DB.
  let session = manager.getSession(sessionId);
  if (!session) {
    const resumed = await manager.resumeSession(sessionId);
    if (!resumed) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }
    session = resumed.session;
  }
  const events = manager.getEvents(sessionId);

  if (format === 'json') {
    return NextResponse.json({
      sessionId,
      title: session.title,
      createdAt: session.createdAt,
      events,
    });
  }

  // Default: markdown
  const md = eventsToMarkdown(sessionId, session.title, events);
  // Strip ALL non-ASCII for the filename (HTTP headers must be ByteString).
  const safeTitle = session.title.replace(/[^\x20-\x7E]+/g, '').replace(/\s+/g, '_').slice(0, 40) || 'session';
  return new Response(md, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${safeTitle}.md"`,
    },
  });
}
