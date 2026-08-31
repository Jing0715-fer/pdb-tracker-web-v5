// src/app/api/evaluations/run-dsh/route.ts
//
// R179 (Task 2-a): DSH 模式（DeepSeek-Harness-inspired agent mode）SSE 路由。
// R195: 两段式架构 —— 运行本体在 run-registry 的后台上下文里，本路由只是
// 「订阅者 → SSE 帧」的转发层：
//
//   - POST body 不带 runId：校验 → 配额预检 → launchDshRun（后台启动）→
//     attach 订阅 → 以 SSE 流回放+实时转发事件；响应头 X-Run-Id 供客户端
//     断线重连/主动停止使用；
//   - POST body { runId, after }：重连模式 —— 回放 after 之后的事件再续看
//     （useRunStream 网络错误自动重连用同一契约）；
//   - 客户端断开（req.signal abort）只 detach 订阅，运行继续、报告照常
//     落库（R194 教训：长连接被工具/网络超时斩断 = 9.9 分钟成果归零）；
//   - 唯一中止路径 = POST /api/evaluations/run-dsh/stop { runId }。
//
// 与经典 /api/evaluations/run 的区别（沿用 R179 注释）：
//   - 请求可带 `question`（科学问题，8-1000 字；空 = 基础评估口径）；
//   - 不支持批量 targets / 序列模式 / 结构分析 recipe（宁精勿滥）；
//   - done 载荷带 relevance / outline / figures / chapters 结构。

import { NextResponse } from 'next/server';
import { sseStream } from '@/lib/sse';
import {
  validateDshRunBody,
  probeLlmQuota,
  launchDshRun,
  ensureSchemaCompatBeforeRun,
} from '@/lib/eval-dsh/run-service';
import { attachDshRun, getDshRun } from '@/lib/eval-dsh/run-registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { stream, progress, done, error } = sseStream();

  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};

  // ── 重连模式：body { runId, after } ───────────────────────────────────
  const attachRunId = typeof b.runId === 'string' ? b.runId.trim() : '';
  if (attachRunId) {
    const rec = getDshRun(attachRunId);
    if (!rec) {
      return NextResponse.json(
        { error: `Run not found: ${attachRunId}（已完成运行的记录仅保留最近若干条；服务重启后注册表清空）` },
        { status: 404 },
      );
    }
    const after = Math.max(0, Number(b.after ?? 0) || 0);
    const detach = attachDshRun(attachRunId, { after, onEvent: progress, onDone: done, onError: (msg) => error(msg) });
    // 客户端断开只 detach —— 运行继续（R195 核心语义）。
    req.signal.addEventListener('abort', () => { detach(); }, { once: true });
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
        'X-Run-Id': attachRunId,
      },
    });
  }

  // ── 新运行模式 ────────────────────────────────────────────────────────
  const v = validateDshRunBody(body);
  if (!v.ok) {
    return NextResponse.json({ error: v.error }, { status: v.status });
  }

  // 幂等 schema 迁移（含 R179 新增的 mode/outline/figures 列）。
  await ensureSchemaCompatBeforeRun();

  // R194 建议 2（配额预检）：3-token 级探测调用 —— 429/全链失败时启动即
  // 拒绝（用户看到一条明确提示，而不是 12 章逐个全灭）。force=true 跳过
  //（API 调用方显式承担风险，流水线退避/降级机制兜底）。
  if (!v.force) {
    const probe = await probeLlmQuota(v.params.llm);
    if (!probe.ok) {
      return NextResponse.json({ error: probe.message, quotaBlocked: true }, { status: probe.status });
    }
  }

  // 后台启动（init 帧在 task 内同步发出，由下面的 attach 回放给本连接）。
  const rec = launchDshRun(v.params);
  const detach = attachDshRun(rec.runId, { onEvent: progress, onDone: done, onError: (msg) => error(msg) });
  // 客户端断开只 detach —— 运行继续（R194 两连败死因根治）。
  req.signal.addEventListener('abort', () => { detach(); }, { once: true });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
      'X-Run-Id': rec.runId,
    },
  });
}
