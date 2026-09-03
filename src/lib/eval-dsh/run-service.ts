// src/lib/eval-dsh/run-service.ts
//
// R195: DSH 运行的共享启动服务 —— SSE route（浏览器）与 start route
// （两段式编程调用/E2E）共用的：入参校验、LLM 配额预检、后台任务启动
// （runDshEvaluation + done 载荷 + SkillRunRecord 遥测，全部从旧 SSE
// route 迁移而来，行为保持一致）。
//
// 关键语义变化（相对旧 route）：任务跑在 run-registry 的后台上下文里，
// signal 来自注册表的 AbortController —— 客户端断开不再中止运行。

import { db, getActiveDbFsPath } from '@/lib/db';
import { applySchemaCompat } from '@/lib/schema-compat';
import { runDshEvaluation, type DshRunResult } from './agent';
import { isTransientLlmError, shortLlmErr } from './agent';
import { generateText } from '@/lib/llm';
import { resolveRunLlmConfig } from '@/lib/agent/eval-llm';
import { createDshRun, findRunningDshRunByUniprot, findRunningDshRunByAnyTarget, type DshRunRecord } from './run-registry';
import type { SseEvent } from '@/lib/sse';

/** API-01 同款钳制（与经典 route 的常量一致；R187: 200 → 500）。 */
export const MAX_PDB_CAP = 500;
export const MAX_BLAST_HITS_CAP = 100;
export const MAX_LIT_COUNT_CAP = 200;

/** R202: Agent 多靶点上限。逐靶点完整智能体流水线实测 4-10 分钟/靶，
 *  注册表 60 分钟安全网（MAX_RUN_DURATION_MS）÷ 10 分钟/靶 ≥ 6；再留
 *  限流窗口余量 → 5。超限返回 400 引导拆分。 */
export const MAX_DSH_TARGETS = 5;

const UNIPROT_RE = /^[A-Z0-9_]{3,10}$/i;

/** R196: 数值入参锢制 —— Number("abc")=NaN 会穿透 Math.min/max 双层钳制
 *  （NaN 传播），导致 maxPdb=NaN → ids.slice(0,NaN) → 0 PDB 的静默空报告。
 *  非有限数一律回退默认值。 */
function clampInt(raw: unknown, def: number, min: number, max: number): number {
  const n = Number(raw ?? def);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, Math.trunc(n))) : def;
}

/** R202: 多靶点运行中单个靶点的钳制后参数（forceBlast/skipBlast/maxPdb/
 *  maxBlastHits 支持逐靶点，与经典 batch 的 targets[] 同构）。 */
export interface DshTargetOpts {
  uniprot: string;
  forceBlast: boolean;
  skipBlast: boolean;
  maxPdb: number;
  maxBlastHits: number;
}

export interface DshLaunchParams {
  /** R200: 输入模式 —— 'uniprot'（默认）或 'sequence'（BLAST 识别）。 */
  inputMode: 'uniprot' | 'sequence';
  /** R202: UniProt 输入的靶点列表（已去重/钳制；单靶点 = [id]）。
   *  旧单靶字段 `uniprot` 保留为首元素镜像，向后兼容。 */
  uniprots: string[];
  /** 旧单靶字段（= uniprots[0] 镜像；序列输入时为空串）。 */
  uniprot: string;
  /** R202: 逐靶点钳制参数（UniProt 输入时与 uniprots 等长）。 */
  targetOpts: DshTargetOpts[];
  /** R200: 序列输入 —— 原始序列（DNA 时待转录）。 */
  sequence: string;
  /** R200: 序列类型。 */
  sequenceType: 'aa' | 'dna';
  question: string;
  hasQuestion: boolean;
  maxPdb: number;
  maxBlastHits: number;
  maxLitCount: number;
  forceBlast: boolean;
  skipBlast: boolean;
  llm: ReturnType<typeof resolveRunLlmConfig>;
}

export type DshValidateResult =
  | { ok: true; params: DshLaunchParams; force: boolean }
  | { ok: false; status: number; error: string };

/** R202: 多靶点入参解析 —— 接受两种形态：
 *  ① `uniprots: string[]`（纯 ID 列表，编程调用简洁面）；
 *  ② `targets: [{uniprot, forceBlast?, skipBlast?, maxPdb?, maxBlastHits?}]`
 *    （与经典 batch 同构的完整面，浏览器 UI 使用）。
 *  单靶旧字段 `uniprot` 继续支持（向后兼容）。三形态并存时 targets 最全、
 *  uniprots 次之、uniprot 兜底。去重保序，超上限返回 400。 */
function parseUniprotTargets(
  b: Record<string, unknown>,
  defaults: { forceBlast: boolean; skipBlast: boolean; maxPdb: number; maxBlastHits: number },
): { ok: true; targets: DshTargetOpts[] } | { ok: false; status: number; error: string } {
  const seen = new Set<string>();
  const out: DshTargetOpts[] = [];
  let rawCount = 0;
  const push = (id: string, o?: { forceBlast?: unknown; skipBlast?: unknown; maxPdb?: unknown; maxBlastHits?: unknown }) => {
    const acc = String(id || '').trim().toUpperCase();
    if (!acc || seen.has(acc)) return;
    if (!UNIPROT_RE.test(acc)) return; // 静默跳过非法 ID（经典 batch 同语义）
    seen.add(acc);
    out.push({
      uniprot: acc,
      forceBlast: o?.forceBlast === undefined ? defaults.forceBlast : !!o.forceBlast,
      skipBlast: o?.skipBlast === undefined ? defaults.skipBlast : !!o.skipBlast,
      maxPdb: clampInt(o?.maxPdb === undefined ? defaults.maxPdb : o.maxPdb, defaults.maxPdb, 1, MAX_PDB_CAP),
      maxBlastHits: clampInt(o?.maxBlastHits === undefined ? defaults.maxBlastHits : o.maxBlastHits, defaults.maxBlastHits, 0, MAX_BLAST_HITS_CAP),
    });
  };
  if (Array.isArray(b.targets) && b.targets.length > 0) {
    rawCount = b.targets.length;
    for (const t of b.targets) {
      if (t && typeof t === 'object') push((t as Record<string, unknown>).uniprot as string, t as Record<string, unknown>);
      else push(String(t));
    }
  } else if (Array.isArray(b.uniprots) && b.uniprots.length > 0) {
    rawCount = b.uniprots.length;
    for (const id of b.uniprots) push(id);
  } else if (b.uniprot != null) {
    rawCount = 1;
    push(String(b.uniprot));
  }
  if (out.length === 0) {
    return {
      ok: false,
      status: 400,
      error: `Invalid or missing 'uniprot' / 'uniprots' / 'targets': expected at least one UniProt accession matching /^[A-Z0-9_]{3,10}$/i (got none valid), or set inputMode='sequence' with a 'sequence' field.`,
    };
  }
  if (rawCount > MAX_DSH_TARGETS) {
    return {
      ok: false,
      status: 400,
      error: `Too many targets: ${rawCount} (max ${MAX_DSH_TARGETS} for agent mode — each target runs the full agent pipeline; split into smaller runs).`,
    };
  }
  return { ok: true, targets: out };
}

/** 入参校验（400 早退逻辑，双端点共用）。
 *  R200: 支持 UniProt / 序列两种输入模式（二选一）。
 *  R202: UniProt 输入支持多靶点（targets[] / uniprots[] / 旧单字段 uniprot）。 */
export function validateDshRunBody(body: unknown): DshValidateResult {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  // R200: 序列输入模式 —— BLAST 识别靶点后进入同一评估轨道。
  const inputMode: 'uniprot' | 'sequence' = b.inputMode === 'sequence' ? 'sequence' : 'uniprot';
  let sequence = '';
  let sequenceType: 'aa' | 'dna' = 'aa';
  if (inputMode === 'sequence') {
    sequence = String(b.sequence || '').trim().toUpperCase().replace(/\s/g, '');
    sequenceType = b.sequenceType === 'dna' ? 'dna' : 'aa';
    if (sequence.length < 10) {
      return {
        ok: false,
        status: 400,
        error: `Invalid 'sequence': at least 10 residues after cleaning (got ${sequence.length}).`,
      };
    }
    if (sequence.length > 10_000) {
      return {
        ok: false,
        status: 400,
        error: `Invalid 'sequence': too long (${sequence.length} residues, max 10000).`,
      };
    }
    if (sequenceType === 'dna' && !/^[ATGCN]+$/.test(sequence)) {
      return {
        ok: false,
        status: 400,
        error: `Invalid 'sequence': DNA sequence may only contain A/T/G/C/N (got unexpected characters).`,
      };
    }
    if (sequenceType === 'aa' && !/^[ACDEFGHIKLMNPQRSTVWYBXZU]+$/.test(sequence)) {
      return {
        ok: false,
        status: 400,
        error: `Invalid 'sequence': amino-acid sequence contains invalid characters (allowed: 20 standard residues + B/X/Z/U).`,
      };
    }
    // 允许附带 uniprot 字段但忽略（以序列识别为准）。
  }
  // R189: 科学问题可选 —— 空 = 基础评估口径；非空 ≥8 字符。
  const question = String(b.question || '').trim();
  const hasQuestion = question.length > 0;
  if (question.length > 1000 || (hasQuestion && question.length < 8)) {
    return {
      ok: false,
      status: 400,
      error: `Invalid 'question': must be empty (basic evaluation) or 8-1000 characters after trim (got ${question.length}).`,
    };
  }
  const maxPdb = clampInt(b.maxPdb, 80, 1, MAX_PDB_CAP);
  const maxBlastHits = clampInt(b.maxBlastHits, 50, 0, MAX_BLAST_HITS_CAP);
  const maxLitCount = clampInt(b.maxLitCount, 20, 0, MAX_LIT_COUNT_CAP);
  const forceBlast = !!b.forceBlast;
  const skipBlast = !!b.skipBlast;
  const llm = resolveRunLlmConfig(b.llm);
  // R195: force=true 跳过启动前配额预检 —— 面向「明知探测会失败但流水线
  // 自身的退避/降级机制足以应对」的调用方（API 编程调用 / 探测误报场景）。
  // 浏览器 UI 不发送该字段（用户始终受预检保护）。
  const force = b.force === true;
  // R202: 多靶点解析（UniProt 输入时；序列输入为空列表）。
  const targetParse = inputMode === 'uniprot'
    ? parseUniprotTargets(b, { forceBlast, skipBlast, maxPdb, maxBlastHits })
    : { ok: true as const, targets: [] as DshTargetOpts[] };
  if (!targetParse.ok) return targetParse;
  const uniprots = targetParse.targets.map(t => t.uniprot);
  return {
    ok: true,
    force,
    params: {
      inputMode,
      uniprots,
      uniprot: uniprots[0] || '',
      targetOpts: targetParse.targets,
      sequence, sequenceType, question, hasQuestion, maxPdb, maxBlastHits, maxLitCount, forceBlast, skipBlast, llm
    },
  };
}

/**
 * R194 建议 2（配额预检）：启动前用一次极小 LLM 调用探测可用性。
 * zai 429 呈日级耗尽模式（R194 实测 80 分钟持续 429，让用户看 12 章全灭
 * 不如启动即告知）。规则：
 *   - 探测成功 → 放行；
 *   - 探测失败且为瞬态（429/限流/过载/5xx）→ 拒绝启动，给平静清晰的
 *     「配额暂不可用」提示；
 *   - 探测失败且非瞬态 → 拒绝启动并带原错误（整条 provider 链都失败，
 *     运行也会在第一章死掉 —— 快速失败比 12 章全灭体验好）；
 *   - 超时（12s）→ 结论不可靠（如本地 CLI 冷启动慢），放行不拦截。
 *   generateText 内部本身会尝试整条 provider 链，探测失败 = 全链失败。
 */
export async function probeLlmQuota(
  llm: DshLaunchParams['llm'],
): Promise<{ ok: true } | { ok: false; status: number; message: string }> {
  // R196: race 计时器必须清理 —— 探测提前成功时 15s 定时器仍挂着
  // （成功路径每窗口保活事件循环 + 高频探测下定时器堆积）。
  let raceTimer: ReturnType<typeof setTimeout> | undefined;
  try {
    const r = await Promise.race([
      generateText('You are a health probe. Reply with the single word: ok', 'ping', {
        maxChars: 8,
        llm: { provider: llm.provider, ...(llm.model ? { model: llm.model } : {}) },
        signal: AbortSignal.timeout(12_000),
      }),
      new Promise<'timeout'>((res) => { raceTimer = setTimeout(() => res('timeout'), 15_000); }),
    ]);
    if (r === 'timeout') return { ok: true };
    if (r.ok) return { ok: true };
    const err = r.error || '';
    // R197 bug 修复：12s 探测超时中止的错误串（'aborted due to timeout'
    // 等）不匹配 isTransientLlmError 任何模式 —— 健康但响应慢的 provider（本地 CLI 冷启动正是
    // 注释点名场景）落入非瞬态分支 → 503 硬拒，
    // 与注释声明的「超时→结论不可靠→放行」矛盾接矛盾。超时/中止特征 → 放行，
    // 让流水线的退避/降级机制兜底（UI 不发 force，此路径必须放行）。
    if (/abort|timed?[- ]?out|timeout|cancelled|timeout after/i.test(err)) return { ok: true };
    if (isTransientLlmError(err)) {
      return {
        ok: false,
        status: 503,
        message: `LLM 配额暂不可用（限流/过载窗口，通常数十分钟内恢复）—— 本次评估暂不启动，请稍后再试。探测详情：${shortLlmErr(err)}`,
      };
    }
    return {
      ok: false,
      status: 503,
      message: `LLM 调用不可用，评估无法启动（探测详情：${shortLlmErr(err)}）。请在 Run Center 的 LLM 设置中检查 provider 配置后重试。`,
    };
  } catch {
    // 探测调用自身异常（网络/超时）—— 结论不可靠，放行。
    return { ok: true };
  } finally {
    if (raceTimer) clearTimeout(raceTimer);
  }
}

/**
 * R200: 重复运行守卫的去重键 —— UniProt 输入用 acc；序列输入用
 * 序列指纹（FNV-1a 稳定哈希 + 类型 + 长度），避免空 uniprot 把不同
 * 序列的并发运行互相误判为重复，也避免同序列双击双烧配额。
 * R202: 多靶点用 MULTI-{排序后 join '-'}（runId 需 URL 安全字符）。
 */
function dshDedupKey(params: DshLaunchParams): string {
  if (params.inputMode === 'sequence') {
    let h = 0x811c9dc5;
    for (let i = 0; i < params.sequence.length; i++) {
      h ^= params.sequence.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return `SEQ${params.sequenceType === 'dna' ? 'D' : 'A'}-${h.toString(36)}-${params.sequence.length}`;
  }
  if (params.uniprots.length > 1) return `MULTI-${[...params.uniprots].sort().join('-')}`;
  return params.uniprot;
}

/** R202: 单靶点失败后是否继续下一靶点（多靶点部分成功语义）。
 *  AbortError 永远上抛（用户 Stop）；其余错误记录后继续 —— 全灭才 fail。 */
function isAbortLike(err: unknown, signal: AbortSignal): boolean {
  return (err as { name?: string })?.name === 'AbortError' || signal.aborted;
}

/** R202: 跨靶点对比报告（best-effort LLM，一次调用）。
 *  失败（限流/配额）时返回 null —— 合并文档标注跳过原因，不阻塞交付。 */
async function generateCrossTargetReport(
  results: DshRunResult[],
  question: string,
  llm: DshLaunchParams['llm'],
  signal: AbortSignal,
): Promise<{ content: string; provider: string; model: string } | null> {
  const okResults = results.filter(r => r.report.ok);
  if (okResults.length < 1) return null;
  const compact = [
    ...(question ? [`科学问题：${question}`, ``] : []),
    `## 各靶点评估摘要（${okResults.length} 个靶点）`,
    ...okResults.map(r => [
      `- ${r.uniprotInfo.proteinName}（${r.uniprotInfo.uniprotId} / ${r.uniprotInfo.entryName}）`,
      `  基因 ${r.uniprotInfo.geneNames} · ${r.uniprotInfo.organism} · ${r.uniprotInfo.sequenceLength} aa`,
      `  PDB 直接命中 ${r.directPdbCount} · BLAST 同源 ${r.blastHitCount} · 覆盖率 ${r.coverage}% · 配图 ${r.figures.filter(f => f.status === 'verified').length} 张`,
      `  评分：X-ray ${r.scores.xray.score}/10 · Cryo-EM ${r.scores.cryoem.score}/10 · NMR ${r.scores.nmr.score}/10 · Overall ${r.scores.overall.score}/10`,
      `  章节交付 ${r.report.chaptersOk}/${r.report.chapters.length} · 报告 ${r.report.contentChars} chars`,
      ...(r.report.chapters[0] ? [`  执行摘要要点：${(r.report.chapters[0].content || '').replace(/\s+/g, ' ').slice(0, 220)}`] : []),
    ].join('\n')),
  ].join('\n');
  const system = `你是一位严谨的蛋白质靶点评估分析师。请基于给定的多个靶点真实评估数据，输出跨靶点对比分析（Markdown）。只输出 Markdown 正文（以 ## 开头），不要其他说明文字。`;
  const user = `${compact}

请输出 Markdown（结构如下）：
## 跨靶点对比分析
### 对比总览
（一个 Markdown 表格：靶点 | Overall | 覆盖率 | PDB | BLAST | 文献/配图支撑，数字必须来自上方数据，不得编造）
### 各靶点优势与短板
（每个靶点 2-3 条，基于数据）
### 优先级与建议
（${question ? '结合科学问题' : '从结构生物学与可药性角度'}给出靶点优先级排序与一句话理由）`;
  try {
    const r = await generateText(system, user, { maxChars: 6000, llm: { provider: llm.provider, ...(llm.model ? { model: llm.model } : {}) }, signal });
    if (!r.ok || !r.content.trim()) return null;
    return { content: r.content.trim(), provider: r.provider || llm.provider || '', model: r.model || llm.model || '' };
  } catch {
    return null;
  }
}

/** R202: 多靶点合并报告文档（Run Center done 载荷的 report.content）。 */
function buildMultiReportDoc(
  results: DshRunResult[],
  failed: Array<{ uniprot: string; reason: string }>,
  question: string,
  cross: { content: string } | null,
): { ok: boolean; content: string; contentChars: number; durationMs: number; provider: string; model: string; chapters: DshRunResult['report']['chapters']; chaptersOk: number; chaptersFailed: number; error?: string } {
  const okResults = results.filter(r => r.report.ok);
  const parts: string[] = [
    `# Agent 多靶点评估报告（${okResults.length}/${okResults.length + failed.length} 靶点完成）`,
    ``,
    `> 科学问题：${question || '（基础评估口径，未提供科学问题）'}`,
    `> 运行模式：逐靶点智能体评估（相关性分析 → 大纲 → 逐章撰写 + 配图）+ 跨靶点对比`,
    ``,
  ];
  if (cross) {
    parts.push(cross.content, ``, `---`, ``);
  } else {
    parts.push(`> 跨靶点对比分析生成跳过（LLM 瞬态失败或配额限制），逐靶点报告见下。`, ``, `---`, ``);
  }
  for (const r of okResults) {
    parts.push(
      `## 靶点 ${r.uniprotInfo.uniprotId} · ${r.uniprotInfo.proteinName}（${r.report.chaptersOk}/${r.report.chapters.length} 章 · overall=${r.scores.overall.score}/10）`,
      ``,
      // 每靶点报告正文自带 `> 科学问题` 头行与全章内容。
      r.report.content,
      ``,
      `---`,
      ``,
    );
  }
  for (const f of failed) {
    parts.push(`## 靶点 ${f.uniprot} · 评估失败`, ``, `${f.reason}`, ``, `---`, ``);
  }
  const content = parts.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  // provider/model 取第一个成功靶点（跨靶报告可能贡献了 provider 但语义上以靶点报告为主）。
  const firstOk = okResults[0];
  const chapters = okResults.flatMap(r => r.report.chapters.map(ch => ({ ...ch, id: `${r.uniprot}:${ch.id}` })));
  return {
    ok: okResults.length > 0,
    provider: firstOk?.report.provider || '',
    model: firstOk?.report.model || '',
    durationMs: 0, // 调用方（launchDshRun）以总时长覆写。
    contentChars: content.length,
    content,
    chapters,
    chaptersOk: okResults.reduce((s, r) => s + r.report.chaptersOk, 0),
    chaptersFailed: okResults.reduce((s, r) => s + r.report.chaptersFailed, 0) + failed.length,
  };
}

/**
 * 启动一个后台 DSH 运行（SSE / start 两端点共用）。
 *
 * 任务体 = 旧 SSE route 的 async IIFE 原样迁移：init 帧 →
 * runDshEvaluation → done 载荷 → SkillRunRecord 遥测（best-effort）。
 * 区别只有：emit/signal 来自注册表 ctx；终局走 succeed/fail。
 *
 * R202: 多靶点（uniprots.length > 1）→ 逐靶点循环完整智能体流水线
 * （emit 消息加 [i/n ID] 前缀 + 进度重标定到全局段），逐靶点容错
 * （非中止错误继续下一靶点），终末跨靶点对比 + 合并报告交付；每靶点
 * 报告在 Phase F 各自落库（与单靶点同一持久化路径）。
 */
export function launchDshRun(params: DshLaunchParams): DshRunRecord {
  const { question, hasQuestion, llm } = params;
  const isMulti = params.inputMode === 'uniprot' && params.uniprots.length > 1;
  const opts = {
    maxPdb: params.maxPdb,
    maxBlastHits: params.maxBlastHits,
    maxLitCount: params.maxLitCount,
    forceBlast: params.forceBlast,
    skipBlast: params.skipBlast,
  };
  // R200/R202: 注册表/去重键 —— 序列指纹 / 单 acc / MULTI-{ids}。
  const key = dshDedupKey(params);

  return createDshRun(
    {
      uniprot: key, question, maxPdb: params.maxPdb, provider: llm.provider || '', model: llm.model || '', source: llm.source,
      // R202: 守卫逐靶点冲突检测（序列运行为空数组——回退 key 精确匹配）。
      targetIds: params.inputMode === 'uniprot' ? params.uniprots : undefined,
    },
    async (ctx) => {
      const t0 = Date.now();
      const emit = ctx.emit;
      try {
        // R181: 标注 LLM 来源 —— 共享默认 / Run Center 本地 CLI Agent 覆盖 / 显式指定。
        const llmSourceLabel =
          llm.source === 'run-override' ? '（Run Center 本地 CLI Agent）'
          : llm.source === 'explicit' ? '（显式指定）'
          : '（与 Agent 聊天共享）';
        const seqInputLabel = params.inputMode === 'sequence'
          ? `序列输入（${params.sequenceType === 'dna' ? 'DNA' : 'AA'} · ${params.sequence.length}${params.sequenceType === 'dna' ? 'nt' : 'aa'} · BLAST 识别）`
          : isMulti
            ? `多靶点 ${params.uniprots.length} 个（${params.uniprots.join('、')}）· 逐靶点智能体评估 + 跨靶点对比`
            : `uniprot=${params.uniprot}`;
        emit({ stage: 'init', level: 'info', message: hasQuestion
          ? `启动 Agent 模式评估 · ${seqInputLabel} · 问题「${question.slice(0, 40)}${question.length > 40 ? '…' : ''}」· LLM=${llm.provider}/${llm.model || '(默认)'}${llmSourceLabel}`
          : `启动 Agent 模式评估（基础评估口径，未提供科学问题）· ${seqInputLabel} · LLM=${llm.provider}/${llm.model || '(默认)'}${llmSourceLabel}`, progress: 2 });
        if (llm.source !== 'run-override' && !llm.shared.available) {
          emit({ stage: 'init', level: 'warn', message: `共享 LLM「${llm.shared.displayName}」未配置 API Key，实际调用将回退到可用 provider（zai SDK 兜底）。可在 Run Center 的 LLM 设置或 Agent 聊天供应商面板中配置。`, progress: 2 });
        }
        if (llm.source === 'run-override') {
          emit({ stage: 'init', level: 'info', message: `Run Center 使用本地 CLI Agent「${llm.provider}」执行 LLM 调用（agent 检测选定）；CLI 不可用时自动回退到可用 provider。`, progress: 2 });
        }

        // ── R202: 多靶点循环路径 ─────────────────────────────────────────
        if (isMulti) {
          const n = params.uniprots.length;
          const results: DshRunResult[] = [];
          const failed: Array<{ uniprot: string; reason: string }> = [];
          for (let i = 0; i < n; i++) {
            if (ctx.signal.aborted) throw new DOMException('aborted', 'AbortError');
            const to = params.targetOpts[i];
            const label = `[${i + 1}/${n} ${to.uniprot}]`;
            // 每靶点 emit 包装：消息前缀 + 进度重标定（本靶 0-100 → 全局
            // [i/n, (i+1)/n] 段），extras（dshRelevance/dshOutline/dshFigure/
            // chapter_done 的 chapter/chapterContent）原样透传 —— 前端的
            // LAST-wins 派生态天然展示「当前靶点」的进度卡与章节流。
            const targetEmit = (ev: SseEvent): void => {
              const base = typeof ev.progress === 'number' ? Math.max(0, Math.min(100, ev.progress)) : null;
              const scaled = base != null ? Math.min(100, Math.round((i * 100 + base) / n)) : undefined;
              emit({
                ...ev,
                ...(ev.message ? { message: `${label} ${ev.message}` } : {}),
                ...(scaled != null ? { progress: scaled } : {}),
              });
            };
            emit({ stage: 'target', level: 'info', message: `${label} 开始第 ${i + 1}/${n} 个靶点（forceBlast=${to.forceBlast} · skipBlast=${to.skipBlast} · maxPdb=${to.maxPdb} · maxBlastHits=${to.maxBlastHits}）`, progress: Math.round((i * 100) / n) });
            try {
              const result = await runDshEvaluation({
                uniprot: to.uniprot,
                question,
                opts: { ...opts, maxPdb: to.maxPdb, maxBlastHits: to.maxBlastHits, forceBlast: to.forceBlast, skipBlast: to.skipBlast, signal: ctx.signal },
                llm: { provider: llm.provider, model: llm.model, ...(llm.system ? { system: llm.system } : {}) },
                emit: targetEmit,
                signal: ctx.signal,
              });
              results.push(result);
              emit({
                stage: 'target', level: result.report.ok ? 'success' : 'warn',
                message: `${label} 靶点完成：${result.uniprotInfo.proteinName} · ${result.report.chaptersOk}/${result.report.chapters.length} 章 · overall=${result.scores.overall.score}/10 · 报告已落库`,
                progress: Math.round(((i + 1) * 100) / n),
              });
            } catch (err: any) {
              if (isAbortLike(err, ctx.signal)) throw err;
              failed.push({ uniprot: to.uniprot, reason: err?.message || String(err) });
              emit({ stage: 'target', level: 'error', message: `${label} 靶点失败（继续下一靶点）：${String(err?.message || err).slice(0, 160)}`, progress: Math.round(((i + 1) * 100) / n) });
            }
          }
          if (results.length === 0) {
            ctx.fail(`多靶点评估全灭（${failed.map(f => `${f.uniprot}: ${f.reason.slice(0, 80)}`).join('；')}）`);
            return;
          }

          // 终末跨靶点对比（best-effort）。
          if (ctx.signal.aborted) throw new DOMException('aborted', 'AbortError');
          emit({ stage: 'cross', level: 'info', message: `全部 ${results.length + failed.length} 个靶点处理完毕（成功 ${results.length} · 失败 ${failed.length}）— 生成跨靶点对比分析…`, progress: 98 });
          const cross = await generateCrossTargetReport(results, question, llm, ctx.signal);
          if (cross) {
            emit({ stage: 'cross', level: 'success', message: `✓ 跨靶点对比分析完成（${cross.content.length} chars · ${cross.provider}/${cross.model}）`, progress: 99 });
            // R202: 全文随事件入 NDJSON 日志 —— 历史/断线回看（log 详情视图）
            // 可读完整对比内容（done 载荷仅 live 订阅者可见）。
            emit({ stage: 'cross', level: 'info', message: cross.content.slice(0, 8000), progress: 99 });
          } else {
            emit({ stage: 'cross', level: 'warn', message: `跨靶点对比分析生成跳过（LLM 瞬态失败/配额限制）—— 合并报告仍含逐靶点完整报告`, progress: 99 });
          }

          const report = buildMultiReportDoc(results, failed, question, cross);
          const totalMs = Date.now() - t0;
          report.durationMs = totalMs;
          const firstOk = results.find(r => r.report.ok) ?? results[0];
          // done 载荷：多靶点形态 + 首成功靶点单字段镜像（向后兼容消费者）。
          ctx.succeed({
            mode: 'dsh',
            inputMode: 'uniprot',
            multi: true,
            targetCount: results.length + failed.length,
            uniprot: firstOk.uniprotInfo.uniprotId,
            uniprotInfo: firstOk.uniprotInfo,
            question,
            relevance: firstOk.relevance,
            outline: firstOk.outline,
            figures: results.flatMap(r => r.figures),
            report,
            targets: results.map(r => ({
              uniprot: r.uniprotInfo.uniprotId,
              proteinName: r.uniprotInfo.proteinName,
              chaptersOk: r.report.chaptersOk,
              chaptersTotal: r.report.chapters.length,
              overall: r.scores.overall.score,
              directPdbCount: r.directPdbCount,
              coverage: r.coverage,
              dbSaved: r.dbSaved,
              reportOk: r.report.ok,
            })),
            failedTargets: failed,
            directPdbCount: firstOk.directPdbCount,
            blastHitCount: firstOk.blastHitCount,
            coverage: firstOk.coverage,
            scores: firstOk.scores,
            dbSaved: results.some(r => r.dbSaved),
            durationMs: totalMs,
          });

          // ── SkillRunRecord 遥测（多靶点合并口径）────────────────────────
          try {
            const okCount = results.filter(r => r.report.ok).length;
            const nameList = results.map(r => r.uniprotInfo.proteinName).join(' / ');
            const summary = `Agent·多靶点（${results.length + failed.length}）${hasQuestion ? '' : '（基础评估）'}：${nameList} · overall=${results.map(r => r.scores.overall.score).join('/')}/10 · ${report.chaptersOk}/${report.chapters.length} 章${failed.length ? ` · 失败 ${failed.length} 靶` : ''}${cross ? ' · 跨靶对比 ✓' : ''}${okCount > 0 ? ' · LLM ✓' : ' · LLM ✗'}`;
            const details = JSON.stringify({
              mode: 'dsh', inputMode: 'uniprot', multi: true, question,
              targets: results.map(r => ({
                uniprot: r.uniprotInfo.uniprotId,
                directPdbCount: r.directPdbCount,
                blastHitCount: r.blastHitCount,
                coverage: r.coverage,
                outlineIds: r.outline.map(o => o.id),
                figuresVerified: r.figures.filter(f => f.status === 'verified').length,
                chaptersOk: r.report.chaptersOk,
                chaptersFailed: r.report.chaptersFailed,
                reportChars: r.report.contentChars,
                scores: r.scores.overall.score,
              })),
              failedTargets: failed,
              crossReport: !!cross,
            });
            const resultJson = JSON.stringify({
              mode: 'dsh', inputMode: 'uniprot', multi: true,
              targets: results.map(r => ({ uniprot: r.uniprotInfo.uniprotId, scores: r.scores.overall.score, chaptersOk: r.report.chaptersOk, chaptersTotal: r.report.chapters.length })),
              reportOk: okCount > 0,
              reportChars: report.contentChars,
            });
            const logText = ctx.logLines().join('\n');
            await db.$executeRaw`INSERT INTO SkillRunRecord (id, module, status, summary, details, provider, model, llmOk, llmFallback, llmError, durationMs, resultJson, log, createdAt) VALUES (${'dsh_' + key + '_' + Date.now()}, ${'eval'}, ${okCount > 0 ? 'success' : 'error'}, ${summary}, ${details}, ${report.provider || llm.provider}, ${report.model || llm.model || null}, ${okCount > 0 ? 1 : 0}, 0, ${okCount > 0 ? null : 'all targets failed'}, ${totalMs}, ${resultJson}, ${logText}, CURRENT_TIMESTAMP)`;
          } catch (srrErr: any) {
            try {
              emit({ stage: 'write-db', level: 'warn', message: `SkillRunRecord 写入跳过：${srrErr?.message?.slice(0, 80) ?? 'unknown'}`, progress: 100 });
            } catch { /* registry emit never throws */ }
          }
          return;
        }

        // ── 单靶点路径（UniProt 单靶 / 序列输入 —— R200 行为不变）──────────
        const result = await runDshEvaluation({
          uniprot: params.uniprot,
          ...(params.inputMode === 'sequence' ? { sequenceInput: { sequence: params.sequence, seqType: params.sequenceType } } : {}),
          question,
          opts: { ...opts, ...(params.inputMode === 'uniprot' && params.targetOpts[0] ? { maxPdb: params.targetOpts[0].maxPdb, maxBlastHits: params.targetOpts[0].maxBlastHits, forceBlast: params.targetOpts[0].forceBlast, skipBlast: params.targetOpts[0].skipBlast } : {}), signal: ctx.signal },
          llm: { provider: llm.provider, model: llm.model, ...(llm.system ? { system: llm.system } : {}) },
          emit,
          signal: ctx.signal,
        });

        // done 载荷（前端 useRunStream 的同款契约）。
        ctx.succeed({
          mode: 'dsh',
          inputMode: params.inputMode,
          uniprot: result.uniprotInfo.uniprotId,
          uniprotInfo: result.uniprotInfo,
          ...(result.sequenceInfo ? { sequenceInfo: result.sequenceInfo } : {}),
          question,
          relevance: result.relevance,
          outline: result.outline,
          figures: result.figures,
          report: result.report,
          directPdbCount: result.directPdbCount,
          blastHitCount: result.blastHitCount,
          coverage: result.coverage,
          scores: result.scores,
          dbSaved: result.dbSaved,
          durationMs: result.durationMs,
        });

        // ── SkillRunRecord 遥测（best-effort：绝不因遥测失败报 error）─────
        try {
          const durationMs = Date.now() - t0;
          const summary = `Agent${hasQuestion ? '' : '（基础评估）'}${params.inputMode === 'sequence' ? '·序列' : ''}：${result.uniprotInfo.proteinName} · ${result.directPdbCount} PDB · overall=${result.scores.overall.score}/10 · ${result.report.chaptersOk}/${result.report.chapters.length} 章${hasQuestion ? ` · 审稿 ${result.report.chapters.filter(ch => ch.reviewed).length} 章` : ''}${result.report.ok ? ' · LLM ✓' : ' · LLM ✗'}`;
          const details = JSON.stringify({
            mode: 'dsh',
            inputMode: params.inputMode,
            question,
            uniprot: result.uniprotInfo.uniprotId,
            ...(result.sequenceInfo ? { sequence: { identity: result.sequenceInfo.identity, resolvedUniprot: result.sequenceInfo.resolvedUniprot, usedNrFallback: result.sequenceInfo.usedNrFallback, aaLength: result.sequenceInfo.aaLength } } : {}),
            directPdbCount: result.directPdbCount,
            blastHitCount: result.blastHitCount,
            coverage: result.coverage,
            outlineIds: result.outline.map(o => o.id),
            figuresVerified: result.figures.filter(f => f.status === 'verified').length,
            chaptersOk: result.report.chaptersOk,
            chaptersFailed: result.report.chaptersFailed,
            reportChars: result.report.contentChars,
          });
          const resultJson = JSON.stringify({
            mode: 'dsh',
            inputMode: params.inputMode,
            uniprot: result.uniprotInfo.uniprotId,
            scores: result.scores,
            reportOk: result.report.ok,
            reportChars: result.report.contentChars,
            chapters: result.report.chapters.map(ch => ({ id: ch.id, ok: ch.ok })),
          });
          // log 行来自注册表 NDJSON 累积（与旧 withLog 行为一致）。
          const logText = ctx.logLines().join('\n');
          await db.$executeRaw`INSERT INTO SkillRunRecord (id, module, status, summary, details, provider, model, llmOk, llmFallback, llmError, durationMs, resultJson, log, createdAt) VALUES (${'dsh_' + key + '_' + Date.now()}, ${'eval'}, ${result.report.ok ? 'success' : 'error'}, ${summary}, ${details}, ${result.report.provider || llm.provider}, ${result.report.model || llm.model || null}, ${result.report.ok ? 1 : 0}, 0, ${result.report.ok ? null : (result.report.error ?? null)}, ${durationMs}, ${resultJson}, ${logText}, CURRENT_TIMESTAMP)`;
        } catch (srrErr: any) {
          // 遥测失败只 warn —— 评估结果已经通过 done 帧交付。
          try {
            emit({ stage: 'write-db', level: 'warn', message: `SkillRunRecord 写入跳过：${srrErr?.message?.slice(0, 80) ?? 'unknown'}`, progress: 100 });
          } catch { /* registry emit never throws */ }
        }
      } catch (err: any) {
        if (err?.name === 'AbortError' || ctx.signal.aborted) {
          try {
            emit({ stage: 'abort', level: 'warn', message: '运行已被中止（Stop），后台任务停止', progress: 100 });
          } catch { /* ignore */ }
          ctx.abort('已中止（用户 Stop）');
          return;
        }
        ctx.fail(err?.message || String(err));
      }
    },
  );
}

/** 启动前幂等 schema 迁移（含 R179 的 mode/outline/figures 列）。 */
export async function ensureSchemaCompatBeforeRun(): Promise<void> {
  try {
    const dbPath = getActiveDbFsPath();
    const compat = await applySchemaCompat(dbPath);
    if (compat.addedColumns.length > 0) {
      console.log(`[eval/run-dsh] schema-compat applied: ${compat.addedColumns.join(', ')}`);
    }
  } catch (e: any) {
    console.warn(`[eval/run-dsh] schema-compat skipped: ${e?.message ?? e}`);
  }
}

/**
 * R196: 启动前守卫（SSE / start 两端点共用）：
 *   ① 客户端已断开（探测/迁移等待期间 Stop/网络断开）→ 不启动，返回
 *     499（孤儿运行只会无观察者白烧 10+ 分钟配额）；
 *   ② 同一靶点（UniProt acc 或序列指纹）已有运行中的评估 → 409 拒绝
 *     （双击/刷新后重复 Run 会烧双份配额且旧运行对 UI 不可见）。
 * R202: UniProt 输入升级为逐靶点冲突检测 —— [A,B] vs [B,C] 在 B 上即
 *  冲突（旧版仅精确键匹配会漏检）；序列输入仍精确指纹键匹配。
 */
export function preLaunchGuard(
  params: DshLaunchParams,
  reqSignal: AbortSignal,
): { ok: true } | { ok: false; status: number; error: string; runId?: string; duplicate?: boolean } {
  if (reqSignal.aborted) {
    return { ok: false, status: 499, error: '客户端已断开，评估未启动。' };
  }
  const key = dshDedupKey(params);
  let running: DshRunRecord | undefined;
  if (params.inputMode === 'uniprot') {
    // R202: 逐靶点交集检测（多对多/单对多均覆盖；targetIds 已在 createDshRun
    // meta 持久化，旧记录无该字段时回退 meta.uniprot 单键）。
    running = findRunningDshRunByAnyTarget(params.uniprots);
  } else {
    running = findRunningDshRunByUniprot(key);
  }
  if (running) {
    const overlap = params.inputMode === 'uniprot'
      ? (running.meta.targetIds ?? [running.meta.uniprot]).filter(id => params.uniprots.includes(id)).join('、')
      : key;
    // R212: 附带已运行时长 —— 用户决策「等待 vs 停止」的关键信息（刚起跑
    // 1 分钟 vs 已跑 12 分钟是两种完全不同的建议倾向）。
    const runningMin = Math.max(1, Math.round((Date.now() - running.createdAt) / 60_000));
    return {
      ok: false,
      status: 409,
      duplicate: true,
      runId: running.runId,
      error: `${overlap || key} 已有一场 Agent 模式评估正在后台运行（runId: ${running.runId}，已运行约 ${runningMin} 分钟）。请等待其完成，或先停止后再启动（界面提示会提供一键停止）。`,
    };
  }
  return { ok: true };
}
