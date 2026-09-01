// src/app/api/evaluations/run-dsh/stop/route.ts
//
// R195: 显式中止端点 —— POST { runId } 触发注册表级 AbortController。
//
// 为什么需要它：运行已与 SSE 连接解耦（客户端断开 ≠ 中止），浏览器
// Stop 按钮必须通过本端点真正停止后台任务；useRunStream 的 cancel()
// 只断开视图连接。调用后运行在数秒内停止（信号在下一次 await 边界
// 生效），最终状态可在 status 端点看到（aborted）。

import { NextResponse } from 'next/server';
import { abortDshRun } from '@/lib/eval-dsh/run-registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const runId = String(body?.runId || '').trim();
  if (!runId) {
    return NextResponse.json({ error: "Missing 'runId' in request body." }, { status: 400 });
  }
  const r = abortDshRun(runId);
  if (!r.ok) {
    return NextResponse.json(
      { error: `Run not found: ${runId}（可能已完成并被淘汰，或服务已重启）` },
      { status: 404 },
    );
  }
  return NextResponse.json({
    ok: true,
    runId,
    statusAtRequest: r.status,
    note: '中止信号已发送，后台任务将在下一个检查点停止（通常数秒内；外部 API 轮询等 await 点最多数十秒）；最终状态通过 status 端点确认（aborted）。',
  });
}
