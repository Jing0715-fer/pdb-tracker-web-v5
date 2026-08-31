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
// R196:
//   - 启动前守卫：客户端在探测/迁移等待窗口内断开（499）或同一 UniProt
//     已有运行中的评估（409）时拒绝启动 —— 防孤儿运行白烧配额；
//   - SSE 心跳：评估的章节生成/终审/退避等待期间可能 30-90s 无事件，
//     20s 一帧 ping（客户端解析器忽略未知事件名）防中间层按空闲连接
//     斩断（每次斩断消耗前端重连预算之一）。
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
  preLaunchGuard,
} from '@/lib/eval-dsh/run-service';
import { attachDshRun, getDshRun } from '@/lib/eval-dsh/run-registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** R196: SSE 心跳间隔 —— 章节生成/终审等静默期保活。 */
const HEARTBEAT_MS = 20_000;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const { stream, send, progress, done, error } = sseStream();

  // R196: 心跳管理 —— 终局（done/error 帧）或客户端断开时停止。
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  const stopHeartbeat = () => {
    if (heartbeat) { clearInterval(heartbeat); heartbeat = undefined; }
  };
  const startHeartbeat = () => {
    if (heartbeat) return;
    heartbeat = setInterval(() => { send('ping', Date.now()); }, HEARTBEAT_MS);
    (heartbeat as unknown as { unref?: () => void }).unref?.();
  };

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
    const detach = attachDshRun(attachRunId, {
      after,
      onEvent: progress,
      onDone: (p) => { stopHeartbeat(); done(p); },
      onError: (msg) => { stopHeartbeat(); error(msg); },
    });
    startHeartbeat();
    // 客户端断开只 detach —— 运行继续（R195 核心语义）。
    // R196: signal 可能早已 aborted（等待 body/probe 期间断开）——
    // addEventListener 不会对已 abort 的信号触发，需补同步检查防订阅泄漏。
    req.signal.addEventListener('abort', () => { detach(); stopHeartbeat(); }, { once: true });
    if (req.signal.aborted) { detach(); stopHeartbeat(); }
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

  // R196: 重复启动守卫 —— 先于探测做（双击场景立即拒绝，不等 15s 探测）。
  const guard = preLaunchGuard(v.params, req.signal);
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.error, ...(guard.duplicate ? { duplicate: true, runId: guard.runId } : {}) },
      { status: guard.status },
    );
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

  // R196: 探测/迁移等待最长 ~15s —— 期间客户端可能已 Stop/断开。此时启动
  // 只会产出「无观察者的孤儿运行」白烧 10+ 分钟配额（前端 Stop 重试窗口
  // 覆盖不到这个时段）。启动前最后检查请求信号 + 重复守卫（探测期间并发
  // 启动的另一场同蛋白运行）。
  const guard2 = preLaunchGuard(v.params, req.signal);
  if (!guard2.ok) {
    return NextResponse.json(
      { error: guard2.error, ...(guard2.duplicate ? { duplicate: true, runId: guard2.runId } : {}) },
      { status: guard2.status },
    );
  }

  // 后台启动（init 帧在 task 内同步发出，由下面的 attach 回放给本连接）。
  const rec = launchDshRun(v.params);
  const detach = attachDshRun(rec.runId, {
    onEvent: progress,
    onDone: (p) => { stopHeartbeat(); done(p); },
    onError: (msg) => { stopHeartbeat(); error(msg); },
  });
  startHeartbeat();
  // 客户端断开只 detach —— 运行继续（R194 两连败死因根治）。
  req.signal.addEventListener('abort', () => { detach(); stopHeartbeat(); }, { once: true });
  if (req.signal.aborted) { detach(); stopHeartbeat(); }

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
