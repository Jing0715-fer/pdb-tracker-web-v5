// src/app/api/evaluations/run-dsh/start/route.ts
//
// R195: 两段式启动端点 —— 校验 + 配额预检 + 后台启动，立即返回 runId。
// 与 SSE 路由共用 launchDshRun（同一后台任务、同一事件注册表）。
//
// 用途：
//   - E2E / 编程调用：POST 返回 runId 后用 GET status?runId=&after= 轮询，
//     每次调用都是短请求 —— 免疫 SSE 长连接被工具/网络超时斩断的问题
//     （R194 两轮 E2E 的直接死因）；
//   - 断线续看：SSE 端点 POST { runId, after } 重连，或本端点返回的
//     runId 配 status 轮询。
//
// 配额预检失败（503）时启动被拒绝 —— 消息面向用户可直接展示。

import { NextResponse } from 'next/server';
import {
  validateDshRunBody,
  probeLlmQuota,
  launchDshRun,
  ensureSchemaCompatBeforeRun,
  preLaunchGuard,
} from '@/lib/eval-dsh/run-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));

  const v = validateDshRunBody(body);
  if (!v.ok) {
    return NextResponse.json({ error: v.error }, { status: v.status });
  }

  // R196: 重复启动守卫（先于探测，双击/并发启动立即拒绝）。
  const guard = preLaunchGuard(v.params, req.signal);
  if (!guard.ok) {
    return NextResponse.json(
      { error: guard.error, ...(guard.duplicate ? { duplicate: true, runId: guard.runId } : {}) },
      { status: guard.status },
    );
  }

  await ensureSchemaCompatBeforeRun();

  // R195: force=true 跳过配额预检（API 调用方显式承担风险，流水线退避/
  // 降级机制兜底）；浏览器 UI 不发送该字段。
  if (!v.force) {
    const probe = await probeLlmQuota(v.params.llm);
    if (!probe.ok) {
      return NextResponse.json({ error: probe.message, quotaBlocked: true }, { status: probe.status });
    }
  }

  // R196: 探测等待期间调用方可能已断开/并发启动了同蛋白运行 —— 启动前
  // 最后检查（同 SSE 路由）。
  const guard2 = preLaunchGuard(v.params, req.signal);
  if (!guard2.ok) {
    return NextResponse.json(
      { error: guard2.error, ...(guard2.duplicate ? { duplicate: true, runId: guard2.runId } : {}) },
      { status: guard2.status },
    );
  }

  const rec = launchDshRun(v.params);

  return NextResponse.json({
    runId: rec.runId,
    status: rec.status,
    uniprot: rec.meta.uniprot,
    hasQuestion: rec.meta.question.trim().length > 0,
    createdAt: rec.createdAt,
    streamUrl: '/api/evaluations/run-dsh',
    pollUrl: `/api/evaluations/run-dsh/status?runId=${rec.runId}`,
    stopUrl: '/api/evaluations/run-dsh/stop',
    note: '运行已在后台启动（与 SSE 连接解耦）。用 status 轮询进度（after=已消费事件数）或 SSE POST { runId, after } 续看。',
  });
}
