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
import { runDshEvaluation } from './agent';
import { isTransientLlmError, shortLlmErr } from './agent';
import { generateText } from '@/lib/llm';
import { resolveRunLlmConfig } from '@/lib/agent/eval-llm';
import { createDshRun, type DshRunRecord } from './run-registry';

/** API-01 同款钳制（与经典 route 的常量一致；R187: 200 → 500）。 */
export const MAX_PDB_CAP = 500;
export const MAX_BLAST_HITS_CAP = 100;
export const MAX_LIT_COUNT_CAP = 200;

const UNIPROT_RE = /^[A-Z0-9_]{3,10}$/i;

export interface DshLaunchParams {
  uniprot: string;
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

/** 入参校验（400 早退逻辑，与旧 SSE route 完全一致，双端点共用）。 */
export function validateDshRunBody(body: unknown): DshValidateResult {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const uniprot = String(b.uniprot || '').trim().toUpperCase();
  if (!uniprot || !UNIPROT_RE.test(uniprot)) {
    return {
      ok: false,
      status: 400,
      error: `Invalid or missing 'uniprot': expected a UniProt accession matching /^[A-Z0-9_]{3,10}$/i (got "${uniprot.slice(0, 20)}").`,
    };
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
  const maxPdb = Math.max(1, Math.min(MAX_PDB_CAP, Number(b.maxPdb ?? 80)));
  const maxBlastHits = Math.max(0, Math.min(MAX_BLAST_HITS_CAP, Number(b.maxBlastHits ?? 50)));
  const maxLitCount = Math.max(0, Math.min(MAX_LIT_COUNT_CAP, Number(b.maxLitCount ?? 20)));
  const forceBlast = !!b.forceBlast;
  const skipBlast = !!b.skipBlast;
  const llm = resolveRunLlmConfig(b.llm);
  // R195: force=true 跳过启动前配额预检 —— 面向「明知探测会失败但流水线
  // 自身的退避/降级机制足以应对」的调用方（API 编程调用 / 探测误报场景）。
  // 浏览器 UI 不发送该字段（用户始终受预检保护）。
  const force = b.force === true;
  return {
    ok: true,
    force,
    params: { uniprot, question, hasQuestion, maxPdb, maxBlastHits, maxLitCount, forceBlast, skipBlast, llm },
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
  try {
    const r = await Promise.race([
      generateText('You are a health probe. Reply with the single word: ok', 'ping', {
        maxChars: 8,
        llm: { provider: llm.provider, ...(llm.model ? { model: llm.model } : {}) },
        signal: AbortSignal.timeout(12_000),
      }),
      new Promise<'timeout'>((res) => setTimeout(() => res('timeout'), 15_000)),
    ]);
    if (r === 'timeout') return { ok: true };
    if (r.ok) return { ok: true };
    const err = r.error || '';
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
  }
}

/**
 * 启动一个后台 DSH 运行（SSE / start 两端点共用）。
 *
 * 任务体 = 旧 SSE route 的 async IIFE 原样迁移：init 帧 →
 * runDshEvaluation → done 载荷 → SkillRunRecord 遥测（best-effort）。
 * 区别只有：emit/signal 来自注册表 ctx；终局走 succeed/fail。
 */
export function launchDshRun(params: DshLaunchParams): DshRunRecord {
  const { uniprot, question, hasQuestion, llm } = params;
  const opts = {
    maxPdb: params.maxPdb,
    maxBlastHits: params.maxBlastHits,
    maxLitCount: params.maxLitCount,
    forceBlast: params.forceBlast,
    skipBlast: params.skipBlast,
  };

  return createDshRun(
    { uniprot, question, maxPdb: params.maxPdb, provider: llm.provider || '', model: llm.model || '', source: llm.source },
    async (ctx) => {
      const t0 = Date.now();
      const emit = ctx.emit;
      try {
        // R181: 标注 LLM 来源 —— 共享默认 / Run Center 本地 CLI Agent 覆盖 / 显式指定。
        const llmSourceLabel =
          llm.source === 'run-override' ? '（Run Center 本地 CLI Agent）'
          : llm.source === 'explicit' ? '（显式指定）'
          : '（与 Agent 聊天共享）';
        emit({ stage: 'init', level: 'info', message: hasQuestion
          ? `启动 DSH 模式评估 · uniprot=${uniprot} · 问题「${question.slice(0, 40)}${question.length > 40 ? '…' : ''}」· LLM=${llm.provider}/${llm.model || '(默认)'}${llmSourceLabel}`
          : `启动 DSH 模式评估（基础评估口径，未提供科学问题）· uniprot=${uniprot} · LLM=${llm.provider}/${llm.model || '(默认)'}${llmSourceLabel}`, progress: 2 });
        if (llm.source !== 'run-override' && !llm.shared.available) {
          emit({ stage: 'init', level: 'warn', message: `共享 LLM「${llm.shared.displayName}」未配置 API Key，实际调用将回退到可用 provider（zai SDK 兜底）。可在 Run Center 的 LLM 设置或 Agent 聊天供应商面板中配置。`, progress: 2 });
        }
        if (llm.source === 'run-override') {
          emit({ stage: 'init', level: 'info', message: `Run Center 使用本地 CLI Agent「${llm.provider}」执行 LLM 调用（agent 检测选定）；CLI 不可用时自动回退到可用 provider。`, progress: 2 });
        }

        const result = await runDshEvaluation({
          uniprot,
          question,
          opts: { ...opts, signal: ctx.signal },
          llm: { provider: llm.provider, model: llm.model, ...(llm.system ? { system: llm.system } : {}) },
          emit,
          signal: ctx.signal,
        });

        // done 载荷（前端 useRunStream 的同款契约）。
        ctx.succeed({
          mode: 'dsh',
          uniprot,
          uniprotInfo: result.uniprotInfo,
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
          const summary = `DSH${hasQuestion ? '' : '（基础评估）'}：${result.uniprotInfo.proteinName} · ${result.directPdbCount} PDB · overall=${result.scores.overall.score}/10 · ${result.report.chaptersOk}/${result.report.chapters.length} 章${hasQuestion ? ` · 审稿 ${result.report.chapters.filter(ch => ch.reviewed).length} 章` : ''}${result.report.ok ? ' · LLM ✓' : ' · LLM ✗'}`;
          const details = JSON.stringify({
            mode: 'dsh',
            question,
            uniprot,
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
            uniprot,
            scores: result.scores,
            reportOk: result.report.ok,
            reportChars: result.report.contentChars,
            chapters: result.report.chapters.map(ch => ({ id: ch.id, ok: ch.ok })),
          });
          // log 行来自注册表 NDJSON 累积（与旧 withLog 行为一致）。
          const logText = ctx.logLines().join('\n');
          await db.$executeRaw`INSERT INTO SkillRunRecord (id, module, status, summary, details, provider, model, llmOk, llmFallback, llmError, durationMs, resultJson, log, createdAt) VALUES (${'dsh_' + uniprot + '_' + Date.now()}, ${'eval'}, ${result.report.ok ? 'success' : 'error'}, ${summary}, ${details}, ${result.report.provider || llm.provider}, ${result.report.model || llm.model || null}, ${result.report.ok ? 1 : 0}, 0, ${result.report.ok ? null : (result.report.error ?? null)}, ${durationMs}, ${resultJson}, ${logText}, CURRENT_TIMESTAMP)`;
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
