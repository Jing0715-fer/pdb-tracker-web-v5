// src/app/api/evaluations/run-dsh/route.ts
//
// R179 (Task 2-a): DSH 模式（DeepSeek-Harness-inspired agent mode）SSE 路由。
//
// 与经典 /api/evaluations/run 的区别：
//   - 请求必须带 `question`（科学问题，8-1000 字）—— DSH 是问题驱动的
//     agent 评估模式（相关性分析 → 大纲规划 → 配图 → 逐章撰写）；
//   - 不支持批量 targets / 序列模式 / 结构分析 recipe（宁精勿滥）；
//   - done 载荷带 relevance / outline / figures / chapters 结构。
//
// 复用经典管线的全部基础设施：sseStream + withLog NDJSON 累积、
// applySchemaCompat 幂等迁移、generateText provider 解析、SkillRunRecord
// 遥测（module 'eval'，summary 前缀 'DSH：'）。

import { NextResponse } from 'next/server';
import { sseStream, withLog, type SseEvent } from '@/lib/sse';
import { db, getActiveDbFsPath } from '@/lib/db';
import { applySchemaCompat } from '@/lib/schema-compat';
import { runDshEvaluation } from '@/lib/eval-dsh/agent';
import { resolveRunLlmConfig } from '@/lib/agent/eval-llm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** API-01 同款钳制（与经典 route 的常量一致）。 */
const MAX_PDB_CAP = 200;
const MAX_BLAST_HITS_CAP = 100;
const MAX_LIT_COUNT_CAP = 200;

const UNIPROT_RE = /^[A-Z0-9_]{3,10}$/i;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));

  // ── 入参校验（400 早退，不开 SSE 流）──────────────────────────────────
  const uniprot = String(body?.uniprot || '').trim().toUpperCase();
  if (!uniprot || !UNIPROT_RE.test(uniprot)) {
    return NextResponse.json(
      { error: `Invalid or missing 'uniprot': expected a UniProt accession matching /^[A-Z0-9_]{3,10}$/i (got "${uniprot.slice(0, 20)}").` },
      { status: 400 },
    );
  }
  const question = String(body?.question || '').trim();
  if (!question || question.length < 8 || question.length > 1000) {
    return NextResponse.json(
      { error: `Invalid or missing 'question': must be 8-1000 characters after trim (got ${question.length}). DSH mode is question-driven.` },
      { status: 400 },
    );
  }
  // 钳制（clamp，不 reject —— 与经典 route 的 API-01 风格一致）。
  const maxPdb = Math.max(1, Math.min(MAX_PDB_CAP, Number(body?.maxPdb ?? 80)));
  const maxBlastHits = Math.max(0, Math.min(MAX_BLAST_HITS_CAP, Number(body?.maxBlastHits ?? 50)));
  const maxLitCount = Math.max(0, Math.min(MAX_LIT_COUNT_CAP, Number(body?.maxLitCount ?? 20)));
  const forceBlast = !!body?.forceBlast;
  const skipBlast = !!body?.skipBlast;
  // R180: DSH 模式 LLM 设置与 Agent 聊天共享（.hermes 默认 provider/model）。
  // 显式 body.llm 仍可覆盖（API 编程调用向后兼容）；Run Center UI 不再发送
  // 自身的 localStorage 配置。
  // R181: 优先级 = 显式 body.llm > Run Center CLI-agent 覆盖（.hermes/
  // run-provider.json，agent 检测选定的本地 CLI）> 共享默认。
  const llm = resolveRunLlmConfig(body?.llm);

  // ── 幂等 schema 迁移（含 R179 新增的 mode/outline/figures 列）─────────
  try {
    const dbPath = getActiveDbFsPath();
    const compat = await applySchemaCompat(dbPath);
    if (compat.addedColumns.length > 0) {
      console.log(`[eval/run-dsh] schema-compat applied: ${compat.addedColumns.join(', ')}`);
    }
  } catch (e: any) {
    console.warn(`[eval/run-dsh] schema-compat skipped: ${e?.message ?? e}`);
  }

  const { stream, progress, done, error } = sseStream();
  // withLog：每个 SSE 事件同时累积为 NDJSON（SkillRunRecord.log）。
  const log: string[] = [];
  const emit = withLog(progress, log);

  (async () => {
    const t0 = Date.now();
    try {
      // R181: 标注 LLM 来源——共享默认 / Run Center 本地 CLI Agent 覆盖 / 显式指定。
      const llmSourceLabel =
        llm.source === 'run-override' ? '（Run Center 本地 CLI Agent）'
        : llm.source === 'explicit' ? '（显式指定）'
        : '（与 Agent 聊天共享）';
      emit({ stage: 'init', level: 'info', message: `启动 DSH 模式评估 · uniprot=${uniprot} · 问题「${question.slice(0, 40)}${question.length > 40 ? '…' : ''}」· LLM=${llm.provider}/${llm.model || '(默认)'}${llmSourceLabel}`, progress: 2 });
      if (llm.source !== 'run-override' && !llm.shared.available) {
        emit({ stage: 'init', level: 'warn', message: `共享 LLM「${llm.shared.displayName}」未配置 API Key，实际调用将回退到可用 provider（zai SDK 兜底）。可在 Run Center 的 LLM 设置或 Agent 聊天供应商面板中配置。`, progress: 2 });
      }
      if (llm.source === 'run-override') {
        emit({ stage: 'init', level: 'info', message: `Run Center 使用本地 CLI Agent「${llm.provider}」执行 LLM 调用（agent 检测选定）；CLI 不可用时自动回退到可用 provider。`, progress: 2 });
      }

      const result = await runDshEvaluation({
        uniprot,
        question,
        opts: { maxPdb, maxBlastHits, maxLitCount, forceBlast, skipBlast, signal: req.signal },
        llm: { provider: llm.provider, model: llm.model, ...(llm.system ? { system: llm.system } : {}) },
        emit,
        signal: req.signal,
      });

      // done 载荷（前端 useRunStream 的同款契约）。
      done({
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
        const summary = `DSH：${result.uniprotInfo.proteinName} · ${result.directPdbCount} PDB · overall=${result.scores.overall.score}/10 · ${result.report.chaptersOk}/${result.report.chapters.length} 章${result.report.ok ? ' · LLM ✓' : ' · LLM ✗'}`;
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
        await db.$executeRaw`INSERT INTO SkillRunRecord (id, module, status, summary, details, provider, model, llmOk, llmFallback, llmError, durationMs, resultJson, log, createdAt) VALUES (${'dsh_' + uniprot + '_' + Date.now()}, ${'eval'}, ${result.report.ok ? 'success' : 'error'}, ${summary}, ${details}, ${result.report.provider || llm.provider}, ${result.report.model || llm.model || null}, ${result.report.ok ? 1 : 0}, 0, ${result.report.ok ? null : (result.report.error ?? null)}, ${durationMs}, ${resultJson}, ${log.join('\n')}, CURRENT_TIMESTAMP)`;
      } catch (srrErr: any) {
        // 遥测失败只 warn —— 评估结果已经通过 done 帧交付。
        try {
          emit({ stage: 'write-db', level: 'warn', message: `SkillRunRecord 写入跳过：${srrErr?.message?.slice(0, 80) ?? 'unknown'}`, progress: 100 });
        } catch { /* stream may already be closed */ }
      }
    } catch (err: any) {
      // 致命错误：error 帧并关流。
      try {
        error(err?.message || String(err));
      } catch { /* already closed */ }
    }
  })();

  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } });
}
