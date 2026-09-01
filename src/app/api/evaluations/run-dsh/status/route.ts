// src/app/api/evaluations/run-dsh/status/route.ts
//
// R195: 两段式轮询端点 —— GET ?runId=&after= 返回运行状态与增量事件。
//
//   - `after` = 已消费事件数（默认 0 = 全量事件）；响应含 totalEvents
//     供调用方维护游标（events.length + after = totalEvents）；
//   - 事件与 SSE progress 帧同构（含 seq/ts/stage/message/chapterContent
//     等），chapter_done 的完整章节内容可用于离线核验；
//   - 终态（done/error/aborted）附带 done 载荷或错误消息；
//   - 不带 runId → list 模式：返回当前 + 近期运行概要（调试/E2E 便利）。
//
// 每次调用都是毫秒级短请求 —— E2E 工具的 600s 超时不再威胁运行本体。

import { NextResponse } from 'next/server';
import { getDshRun, listDshRuns } from '@/lib/eval-dsh/run-registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const runId = (url.searchParams.get('runId') || '').trim();

  if (!runId) {
    return NextResponse.json({ runs: listDshRuns() });
  }

  const rec = getDshRun(runId);
  if (!rec) {
    return NextResponse.json(
      { error: `Run not found: ${runId}（已完成运行的记录仅保留最近若干条；服务重启后注册表清空）` },
      { status: 404 },
    );
  }

  const after = Math.max(0, Number(url.searchParams.get('after') ?? 0) || 0);
  const events = rec.events.slice(Math.min(after, rec.events.length));

  return NextResponse.json({
    runId,
    status: rec.status,
    uniprot: rec.meta.uniprot,
    question: rec.meta.question,
    hasQuestion: rec.meta.question.trim().length > 0,
    createdAt: rec.createdAt,
    finishedAt: rec.finishedAt ?? null,
    totalEvents: rec.events.length,
    events,
    ...(rec.donePayload !== undefined ? { done: rec.donePayload } : {}),
    ...(rec.errorMessage ? { error: rec.errorMessage } : {}),
  });
}
