// src/lib/eval-dsh/run-registry.ts
//
// R195: DSH 运行注册表 —— 把「运行生命周期」与「HTTP 请求生命周期」解耦。
//
// 背景（R194 实测教训）：旧架构里 runDshEvaluation 在 SSE 请求的 async
// 闭包内执行，signal 绑定 req.signal —— 客户端断开（E2E 工具 600s 超时 /
// 网络抖动 / 页面刷新）= 运行中止，9.9 分钟成果归零（R194 两连败直接死因）。
//
// 新契约：
//   - 运行在注册表中独立存活（后台任务），SSE 连接只是「订阅者」之一；
//     客户端断开只 detach 订阅，运行继续，报告照常落库；
//   - 每个事件带单调 seq（= 数组下标），支持断线重连按游标续看
//     （SSE POST body { runId, after } / GET status ?after=）；
//   - 唯一中止路径 = 显式 abortDshRun（Stop 端点）→ 注册表自己的
//     AbortController，与任何请求信号无关；
//   - 事件同时累积 NDJSON log（SkillRunRecord.log 用，与旧 route 行为一致）。
//
// 注意：Map 挂在 globalThis 上 —— Next dev 的 webpack 多入口可能为不同
// route 各自实例化模块，globalThis 单例保证 SSE route 启动的运行能被
// status/stop route 看到（与 Prisma client 单例同款模式）。

import type { SseEvent } from '@/lib/sse';

export type DshRunStatus = 'running' | 'done' | 'error' | 'aborted';

export interface DshRunMeta {
  uniprot: string;
  question: string;
  maxPdb: number;
  provider: string;
  model: string;
  /** LLM 配置来源标签（shared / run-override / explicit）。 */
  source: string;
  /** R202: 多靶点运行的全部目标 ID（含单靶点场景——守卫用逐 ID 冲突检测）。
   *  旧记录无此字段时回退 [meta.uniprot]。 */
  targetIds?: string[];
}

/** 注册表内事件 —— 在 SseEvent 基础上补单调 seq 与 ts。 */
export interface DshRunEvent extends SseEvent {
  seq: number;
  ts: string;
}

interface DshSubscriber {
  onEvent: (ev: DshRunEvent) => void;
  onDone?: (payload: unknown) => void;
  onError?: (message: string, status: DshRunStatus) => void;
}

export interface DshRunRecord {
  runId: string;
  meta: DshRunMeta;
  status: DshRunStatus;
  createdAt: number;
  finishedAt?: number;
  events: DshRunEvent[];
  /** NDJSON 行（含 ts/seq）—— SkillRunRecord.log 累积用。 */
  ndjson: string[];
  donePayload?: unknown;
  errorMessage?: string;
  abort: AbortController;
  subscribers: Set<DshSubscriber>;
  /** R196 内部字段：超时安全网 timer（finishRun 时清除）。 */
  reaper?: ReturnType<typeof setTimeout>;
}

/** 保留的已完成运行数（防内存无限增长；运行中永不淘汰）。 */
const MAX_FINISHED_RUNS = 8;

/** R196: 运行时长安全网上限 —— task 内部某个非 LLM await 点卡死（如 SQLite
 *  锁等待）时，记录会永远停留 running（状态列表/409 守卫均受污染）。
 *  60 分钟远超最长真实运行（E2E 实测 ≤17 分钟），只兜底不死循环。 */
const MAX_RUN_DURATION_MS = 60 * 60_000;

type RegistryMap = Map<string, DshRunRecord>;

/** R196: runId 防碰撞 —— 同毫秒内两次启动（脚本重试/双击）会生成相同 id，
 *  runs.set 会覆盖仍在执行的旧运行（不可观测且不可停止）。追加进程级计数器。 */
let runSeqCounter = 0;

const g = globalThis as unknown as { __dshRunRegistry?: RegistryMap };
const runs: RegistryMap = g.__dshRunRegistry ?? new Map();
if (!g.__dshRunRegistry) g.__dshRunRegistry = runs;

/** 状态终局化（幂等）：通知订阅者并淘汰旧记录。 */
function finishRun(rec: DshRunRecord, status: DshRunStatus, payload?: unknown, errorMessage?: string): void {
  if (rec.status !== 'running') return;
  if (rec.reaper) { clearTimeout(rec.reaper); rec.reaper = undefined; }
  rec.status = status;
  rec.finishedAt = Date.now();
  if (payload !== undefined) rec.donePayload = payload;
  if (errorMessage) rec.errorMessage = errorMessage;
  for (const sub of rec.subscribers) {
    try {
      if (status === 'done') sub.onDone?.(payload);
      else sub.onError?.(errorMessage || status, status);
    } catch { /* subscriber stream already closed */ }
  }
  rec.subscribers.clear();
  // 淘汰：只清已结束的旧记录，运行中的不受影响。
  const finished = [...runs.values()].filter(r => r.status !== 'running');
  if (finished.length > MAX_FINISHED_RUNS) {
    finished.sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0));
    for (const old of finished.slice(0, finished.length - MAX_FINISHED_RUNS)) {
      runs.delete(old.runId);
    }
  }
}

/** 后台任务拿到的上下文。 */
export interface DshRunTaskCtx {
  /** 累积事件（seq 自动分配）并实时扇出给订阅者。 */
  emit: (ev: SseEvent) => void;
  /** 注册表级别的中止信号（Stop 端点触发；与任何请求信号无关）。 */
  signal: AbortSignal;
  /** 成功终局：done 帧载荷。 */
  succeed: (payload: unknown) => void;
  /** 失败终局：error 帧消息（status=error）。 */
  fail: (message: string) => void;
  /** 用户中止终局（status=aborted，区别于运行自身错误）。 */
  abort: (message: string) => void;
  /** NDJSON 日志行快照（SkillRunRecord.log 用，与旧 withLog 行为一致）。 */
  logLines: () => string[];
}

/**
 * 创建并启动一个后台运行。task 是 fire-and-forget 的异步函数 —— 返回的
 * record 立刻可用（事件数为 0 也合法：init 帧通常在 task 里同步发出，
 * 由 attach 回放）。
 */
export function createDshRun(meta: DshRunMeta, task: (ctx: DshRunTaskCtx) => Promise<void>): DshRunRecord {
  const runId = `dsh-${meta.uniprot}-${Date.now().toString(36)}-${(runSeqCounter++).toString(36)}`;
  const rec: DshRunRecord = {
    runId,
    meta,
    status: 'running',
    createdAt: Date.now(),
    events: [],
    ndjson: [],
    abort: new AbortController(),
    subscribers: new Set(),
  };
  runs.set(runId, rec);

  // R196: 超时安全网 —— 60 分钟未见终局强制收尾（unref 不阻进程退出）。
  const reaper = setTimeout(() => {
    finishRun(rec, 'error', undefined, '运行超时（60 分钟未见终局，注册表安全网强制收尾）');
  }, MAX_RUN_DURATION_MS);
  (reaper as unknown as { unref?: () => void }).unref?.();
  rec.reaper = reaper;

  const emit = (ev: SseEvent): void => {
    const full: DshRunEvent = { ts: new Date().toISOString(), ...ev, seq: rec.events.length };
    rec.events.push(full);
    try { rec.ndjson.push(JSON.stringify(full)); } catch { /* never break emit */ }
    for (const sub of rec.subscribers) {
      try { sub.onEvent(full); } catch { /* subscriber stream closed */ }
    }
  };

  const ctx: DshRunTaskCtx = {
    emit,
    signal: rec.abort.signal,
    succeed: (payload) => finishRun(rec, 'done', payload),
    fail: (message) => finishRun(rec, 'error', undefined, message),
    abort: (message) => finishRun(rec, 'aborted', undefined, message),
    logLines: () => [...rec.ndjson],
  };

  task(ctx)
    .then(() => {
      // R196: task 正常 resolve 却没调任何终局（succeed/fail/abort）——
      // 旧版会把记录永远留在 running。标 error 防泄漏（正常路径不触发）。
      if (rec.status === 'running') {
        finishRun(rec, 'error', undefined, '任务结束但未上报终局（注册表安全网）');
      }
    })
    .catch((err: unknown) => {
      // task 自身未捕获的异常（正常路径 task 内部已调 fail/abort）。
      const isAbort = (err as any)?.name === 'AbortError' || ctx.signal.aborted;
      const msg = err instanceof Error ? err.message : String(err);
      finishRun(rec, isAbort ? 'aborted' : 'error', undefined, isAbort ? '已中止' : msg);
    });

  return rec;
}

export function getDshRun(runId: string): DshRunRecord | undefined {
  return runs.get(runId);
}

/** R196: 查找同一 UniProt 正在运行的记录（重复启动守卫用）。 */
export function findRunningDshRunByUniprot(uniprot: string): DshRunRecord | undefined {
  for (const r of runs.values()) {
    if (r.status === 'running' && r.meta.uniprot === uniprot) return r;
  }
  return undefined;
}

/** R202: 逐靶点冲突检测 —— 新运行的任一目标 ID 与任何运行中记录的目标集合
 *  有交集即冲突（含多对多：[A,B] vs [B,C] 在 B 上冲突；旧记录无 targetIds
 *  时回退其 meta.uniprot 单键）。序列运行（SEQ* 指纹键）不在此检测 —— 调用
 *  方对序列先做精确键比对。 */
export function findRunningDshRunByAnyTarget(targetIds: string[]): DshRunRecord | undefined {
  if (targetIds.length === 0) return undefined;
  const wanted = new Set(targetIds);
  for (const r of runs.values()) {
    if (r.status !== 'running') continue;
    const existing = r.meta.targetIds ?? [r.meta.uniprot];
    for (const id of existing) {
      if (wanted.has(id)) return r;
    }
  }
  return undefined;
}

/** 概要列表（status 端点 list 模式 / 调试用）。 */
export function listDshRuns(): Array<{
  runId: string; uniprot: string; status: DshRunStatus;
  createdAt: number; finishedAt?: number; totalEvents: number;
}> {
  return [...runs.values()]
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(r => ({
      runId: r.runId,
      uniprot: r.meta.uniprot,
      status: r.status,
      createdAt: r.createdAt,
      ...(r.finishedAt !== undefined ? { finishedAt: r.finishedAt } : {}),
      totalEvents: r.events.length,
    }));
}

export interface DshAttachOptions {
  /** 已消费事件数（跳过前 after 条）—— 断线重连续看用。 */
  after?: number;
  onEvent: (ev: DshRunEvent) => void;
  onDone?: (payload: unknown) => void;
  onError?: (message: string, status: DshRunStatus) => void;
}

/**
 * 订阅一个运行：先同步回放 `after` 之后的事件，再实时扇出；若运行已
 * 结束则直接投递终局。返回 detach 函数。
 *
 * 回放与订阅注册之间无 await —— 单线程下 emit 不可能插入，无事件丢失
 * 竞态。
 */
export function attachDshRun(runId: string, opts: DshAttachOptions): () => void {
  const rec = runs.get(runId);
  if (!rec) return () => { /* not found — nothing to detach */ };
  const after = Math.max(0, Math.min(Number(opts.after ?? 0) || 0, rec.events.length));
  for (const ev of rec.events.slice(after)) {
    try { opts.onEvent(ev); } catch { /* replay target closed */ }
  }
  if (rec.status !== 'running') {
    if (rec.status === 'done') opts.onDone?.(rec.donePayload);
    else opts.onError?.(rec.errorMessage || rec.status, rec.status);
    return () => { /* already finished */ };
  }
  const sub: DshSubscriber = { onEvent: opts.onEvent, onDone: opts.onDone, onError: opts.onError };
  rec.subscribers.add(sub);
  return () => { rec.subscribers.delete(sub); };
}

/** 显式中止（Stop 端点）。返回运行当时状态。 */
export function abortDshRun(runId: string): { ok: boolean; status?: DshRunStatus } {
  const rec = runs.get(runId);
  if (!rec) return { ok: false };
  if (rec.status !== 'running') return { ok: true, status: rec.status };
  rec.abort.abort();
  return { ok: true, status: 'running' };
}
