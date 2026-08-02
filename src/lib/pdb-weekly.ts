/**
 * PDB Weekly Report — in-process orchestrator.
 *
 * Runs the full 3-cycle adversarial pipeline directly inside the Next.js
 * process (no OpenClaw cron bridge). Same business spec as the shared
 * template (`~/.openclaw/workspace/pdb_weekly_prompt_template.md`) and the
 * OpenClaw cron job `PDB Weekly Reports` (id 7c26ab96-…).
 *
 * Pipeline:
 *   1. pdb_tracker_db.py --fetch ...              (data ingestion)
 *   1.5  ... --backfill-literature ...            (RCSB citation enrichment)
 *   1.6  populate_pubmed_articles.py              (NCBI eutils abstract fetch)
 *   2. Cycle 1 Generator  (per method)            (llmComplete)
 *   3. Cycle 2 Critic-Scientific (verdict: CONVERGED | NEEDS_REVISION)
 *      If NEEDS_REVISION, also runs Cycle 3 Critic-Analytical.
 *   4. Synthesis Generator (applies all critic mods)
 *   5. pdb_tracker_db.py --report cryoem/xray     (DB write)
 *   6. sqlite3 6-row verification
 *
 * Concurrency:
 *   - The whole run blocks for ~10–25 minutes depending on cycle count and
 *     LLM provider latency.
 *   - The route handler sets `maxDuration = 1500` so dev/standalone Node is
 *     fine; on Vercel serverless you'd need Background Functions / queue.
 *
 * Provider selection:
 *   - Same fallback chain as `/api/llm/providers` exposes to the front-end
 *     Settings panel: local CLIs (hermes/claude/codex) → Anthropic SDK →
 *     OpenAI SDK (auto-fallback). Pass `LlmConfig` from the front-end to override.
 */

import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { db } from './db';
import { llmComplete, LlmConfig, LlmResult, resolveLlmConfig } from './llm';
import { inspectProviders } from './llm';
import { StreamEvent, spawnStreamed } from './run-stream';

// ─── Constants & paths ────────────────────────────────────────────────────────

export const PDB_WEEKLY_CRON_JOB_ID = '7c26ab96-bd27-401f-9d8e-7dd142797450';

const HOME = process.env.HOME || '/Users/lijing';
const PYTHON = process.env.PDB_PYTHON || 'python3';
const PDB_TRACKER_DB_PY = process.env.PDB_TRACKER_DB_PY
  || path.join(HOME, '.openclaw/workspace/pdb_tracker_db.py');
const POPULATE_PUBMED_PY = process.env.POPULATE_PUBMED_PY
  || path.join(HOME, '.openclaw/workspace/populate_pubmed_articles.py');
const DB_PATH = process.env.PDB_DB_PATH
  || '/Users/lijing/Documents/my_note/LLM-Wiki/data/pdb_tracker.db';
const WIKI_DIR = process.env.PDB_WIKI_DIR
  || '/Users/lijing/Documents/my_note/LLM-Wiki/wiki/pdb_weekly_report';
const PROMPT_TEMPLATE = process.env.PDB_PROMPT_TEMPLATE
  || path.join(HOME, '.openclaw/workspace/pdb_weekly_prompt_template.md');

const DB_TIMEOUT_MS = 30 * 60 * 1000; // 30 min — Step 1 RCSB fetch + literature backfill can take a while
const LLM_TIMEOUT_MS = 8 * 60 * 1000; // 8 min per LLM call — generator calls may push 30k tokens

// ─── Types ────────────────────────────────────────────────────────────────────

export type ReportType = 'cryoem' | 'xray';
export type CycleVerdict = 'CONVERGED' | 'NEEDS_REVISION';

export interface WeekWindow {
  weekId: string;
  reportDate: string;
  startDate: string;
  endDate: string;
  endDateInclusive: string;
}

export interface PdbDbCounts {
  pdbStructure: number;
  weeklySnapshot: number;
  weeklyReport: number;
  withAuthors: number;
  withPubmedId: number;
  pubmedArticleMatched: number;
}

export interface CycleRecord {
  cycle: 1 | 2 | 3 | 'synthesis';
  role: 'generator' | 'critic-scientific' | 'critic-analytical' | 'synthesis';
  reportType: ReportType;
  provider?: string;
  model?: string;
  durationMs?: number;
  promptTokens?: number;
  outputTokens?: number;
  contentChars?: number;
  verdict?: CycleVerdict;
  notes?: string;
}

export interface RunWeeklyOptions {
  /** ISO Week window. Default: compute from today's date (mirrors cron). */
  window?: Partial<WeekWindow>;
  /** Method report types to generate (default both). */
  reports?: ReportType[];
  /** Max number of full cycles (1 = single-pass, 2 = generator+critic, 3 = full). Default 3. */
  maxCycles?: 1 | 2 | 3;
  /** LLM config — overrides /api/llm/providers detection. */
  llm?: LlmConfig;
  /** Skip DB ingestion (Step 1/1.5/1.6) — useful for re-running the LLM-only pipeline. */
  skipIngestion?: boolean;
  /** Skip DB write (Step 5) — useful for dry-run / preview. */
  skipDbWrite?: boolean;
  /** Progress callback — receives structured stream events. */
  emit?: (ev: StreamEvent) => void;
}

export interface RunWeeklyResult {
  ok: boolean;
  window: WeekWindow;
  reports: ReportType[];
  /** Per-report cycle trace. */
  cycles: CycleRecord[];
  /** Files written to disk. */
  filesWritten: string[];
  /** DB row counts (after verification). */
  dbCounts?: PdbDbCounts;
  /** Verdict per report. */
  verdicts: Record<ReportType, CycleVerdict>;
  durationMs: number;
  error?: string;
}

// ─── Week window computation (mirrors pdb_weekly_prompt_lib.py) ──────────────

export function computeWeekWindow(today: Date = new Date()): WeekWindow {
  const t = new Date(today);
  const startDate = new Date(t);
  startDate.setDate(startDate.getDate() - 6);
  const endDate = new Date(t);
  endDate.setDate(endDate.getDate() + 1); // RCSB API quirk — pass today+1 to fetch "through today"
  const { year: isoYear, week: isoWeek } = isoWeekOfYear(t);
  return {
    weekId: `${isoYear}-W${String(isoWeek).padStart(2, '0')}`,
    reportDate: isoDate(t),
    startDate: isoDate(startDate),
    endDate: isoDate(endDate),
    endDateInclusive: isoDate(t),
  };
}

/** ISO 8601 week-of-year with iso_year (2025-12-31 → 2026-W01). */
function isoWeekOfYear(d: Date): { year: number; week: number } {
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNr = (target.getUTCDay() + 6) % 7; // Mon=0, Sun=6
  target.setUTCDate(target.getUTCDate() - dayNr + 3); // nearest Thursday
  const isoYear = target.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const diff = (target.getTime() - firstThursday.getTime()) / 86400000;
  const week = 1 + Math.round((diff - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
  return { year: isoYear, week };
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ─── Subprocess helpers ──────────────────────────────────────────────────────

function spawnLogged(cmd: string, args: string[], label: string, emit?: (ev: StreamEvent) => void): Promise<{ code: number; stdout: string; stderr: string }> {
  const e = emit || (() => {});
  return spawnStreamed(cmd, args, { timeoutMs: DB_TIMEOUT_MS, label }, e);
}

async function stepFetch(window: WeekWindow, emit?: (ev: StreamEvent) => void): Promise<void> {
  const r = await spawnLogged(PYTHON, [
    PDB_TRACKER_DB_PY,
    '--fetch', window.startDate, window.endDate,
    '--week-id', window.weekId,
  ], 'Step1 fetch', emit);
  if (r.code !== 0) throw new Error(`Step 1 (fetch) failed (exit=${r.code}): ${r.stderr.slice(-400)}`);
}

async function stepBackfill(window: WeekWindow, emit?: (ev: StreamEvent) => void): Promise<void> {
  const r = await spawnLogged(PYTHON, [
    PDB_TRACKER_DB_PY,
    '--backfill-literature',
    '--backfill-weeks', window.weekId,
  ], 'Step1.5 backfill-literature', emit);
  // Backfill may exit non-zero if no rows match — treat as soft failure.
  if (r.code !== 0) emit?.({ kind: 'log', level: 'warn', message: `Step 1.5 backfill returned exit=${r.code}; continuing.` });
}

async function stepPopulatePubmed(window: WeekWindow, emit?: (ev: StreamEvent) => void): Promise<void> {
  const r = await spawnLogged(PYTHON, [
    POPULATE_PUBMED_PY, window.weekId,
  ], 'Step1.6 populate_pubmed_articles', emit);
  if (r.code !== 0) throw new Error(`Step 1.6 (populate_pubmed_articles) failed (exit=${r.code}): ${r.stderr.slice(-400)}`);
}

async function stepReportWrite(reportType: ReportType, filePath: string, emit?: (ev: StreamEvent) => void): Promise<void> {
  const r = await spawnLogged(PYTHON, [
    PDB_TRACKER_DB_PY,
    '--report', reportType,
    filePath,
  ], `Step5 --report ${reportType}`, emit);
  if (r.code !== 0) throw new Error(`Step 5 (--report ${reportType}) failed (exit=${r.code}): ${r.stderr.slice(-400)}`);
}

async function stepVerifyDb(window: WeekWindow): Promise<PdbDbCounts> {
  const sql = `
    SELECT 'pdb_structure' as k, COUNT(*) as n FROM PdbStructure WHERE weekId='${window.weekId}';
    SELECT 'weekly_snapshot' as k, COUNT(*) as n FROM WeeklySnapshot WHERE weekId='${window.weekId}';
    SELECT 'weekly_report' as k, COUNT(*) as n FROM WeeklyReport WHERE weekId='${window.weekId}';
    SELECT 'with_authors' as k, SUM(CASE WHEN authors != '' THEN 1 ELSE 0 END) as n FROM PdbStructure WHERE weekId='${window.weekId}';
    SELECT 'with_pubmedId' as k, SUM(CASE WHEN pubmedId != '' THEN 1 ELSE 0 END) as n FROM PdbStructure WHERE weekId='${window.weekId}';
    SELECT 'pubmed_article_matched' as k, COUNT(DISTINCT s.pubmedId) as n FROM PdbStructure s INNER JOIN PubMedArticle a ON s.pubmedId = a.pubmedId WHERE s.weekId='${window.weekId}' AND s.pubmedId != '';
  `;
  const r = await spawnLogged('sqlite3', [DB_PATH], 'Step6 verify', undefined);
  if (r.code !== 0) {
    // Fall back to Prisma since sqlite3 binary may not be on web-v3's PATH.
    return verifyDbViaPrisma(window);
  }
  // Re-run with stdin; sqlite3 supports piping.
  return new Promise((resolve, reject) => {
    const child = spawn('sqlite3', [DB_PATH], { env: process.env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', b => stdout += b.toString());
    child.stderr.on('data', b => stderr += b.toString());
    child.on('error', err => reject(err));
    child.stdin.write(sql);
    child.stdin.end();
    child.on('close', code => {
      if (code !== 0) {
        resolve(verifyDbViaPrisma(window));
        return;
      }
      try {
        resolve(parseVerifyOutput(stdout, window));
      } catch (e: any) {
        resolve(verifyDbViaPrisma(window));
      }
    });
  });
}

async function verifyDbViaPrisma(window: WeekWindow): Promise<PdbDbCounts> {
  // Web-v3 has its own Prisma client bound to the same DB; query it as a fallback
  // if `sqlite3` is not on PATH.
  const [pdbStructure, weeklySnapshot, weeklyReport, withAuthors, withPubmedId] = await Promise.all([
    db.pdbStructure.count({ where: { weekId: window.weekId } }),
    db.weeklySnapshot.count({ where: { weekId: window.weekId } }),
    db.weeklyReport.count({ where: { weekId: window.weekId } }),
    db.pdbStructure.count({ where: { weekId: window.weekId, NOT: { authors: '' } } }),
    db.pdbStructure.count({ where: { weekId: window.weekId, NOT: { pubmedId: '' } } }),
  ]);
  // PubMedArticle JOIN
  const matched = await db.pdbStructure.findMany({
    where: { weekId: window.weekId, NOT: { pubmedId: '' } },
    select: { pubmedId: true },
  });
  const pmids = new Set(matched.map(m => m.pubmedId).filter(Boolean));
  let pubmedArticleMatched = 0;
  for (const pmid of pmids) {
    const hit = await db.pubMedArticle.findUnique({ where: { pubmedId: pmid! } });
    if (hit) pubmedArticleMatched++;
  }
  return {
    pdbStructure, weeklySnapshot, weeklyReport,
    withAuthors, withPubmedId, pubmedArticleMatched,
  };
}

function parseVerifyOutput(stdout: string, window: WeekWindow): PdbDbCounts {
  // Each row: k | n  (sqlite3 default mode is `|`-separated)
  const map: Record<string, number> = {};
  for (const line of stdout.split('\n')) {
    const m = line.match(/^\s*(\w+)\s*\|\s*(\d+)/);
    if (m) map[m[1]] = parseInt(m[2], 10);
  }
  return {
    pdbStructure: map['pdb_structure'] || 0,
    weeklySnapshot: map['weekly_snapshot'] || 0,
    weeklyReport: map['weekly_report'] || 0,
    withAuthors: map['with_authors'] || 0,
    withPubmedId: map['with_pubmedId'] || 0,
    pubmedArticleMatched: map['pubmed_article_matched'] || 0,
  };
}

// ─── LLM cycle helpers ───────────────────────────────────────────────────────

function buildCyclePrompt(
  template: string,
  window: WeekWindow,
  reportType: ReportType,
  cycle: 1 | 2 | 3 | 'synthesis',
  previousOutputs: { cycle1?: string; cycle2Verdict?: CycleVerdict; cycle2Notes?: string; cycle3Notes?: string },
): string {
  // Substitute template placeholders.
  const subs: Record<string, string> = {
    '__START_DATE__': window.startDate,
    '__END_DATE__': window.endDate,
    '__END_DATE_INCLUSIVE__': window.endDateInclusive,
    '__REPORT_DATE__': window.reportDate,
    '__WEEK_NUM__': String(parseInt(window.weekId.split('W')[1], 10)),
    '__WEEK_ID__': window.weekId,
    '__TRIGGER_SOURCE__': 'web-v3 manual trigger',
  };
  let prompt = template;
  for (const [k, v] of Object.entries(subs)) prompt = prompt.split(k).join(v);

  // Append per-cycle task and per-method specifics.
  const methodName = reportType === 'cryoem' ? '冷冻电镜' : 'X射线晶体学';
  const fileName = `${reportType === 'cryoem' ? '冷冻电镜' : 'X射线晶体学'}结构周报-${window.weekId}-${window.reportDate}.md`;

  const perCycleAppendix = [
    '',
    `---`,
    `## Cycle-specific instructions for this call`,
    ``,
    `- Method: ${methodName} (${reportType})`,
    `- Output file target: ${path.join(WIKI_DIR, fileName)}`,
    cycle === 1 ? [
      ``,
      `### Your role in this call: Cycle 1 Generator`,
      `Write the FULL 8-section report (A-H) as a single markdown document.`,
      `Section H MUST include a "已正式发表文献精选" sub-section that lists`,
      `each high-IF structure's title + first author + PDB ID + resolution.`,
      `Pull from PdbStructure JOIN PubMedArticle WHERE doi/pubmedId != ''`,
      `sorted by journalIf DESC.`,
    ].join('\n') : '',
    cycle === 2 ? [
      ``,
      `### Your role in this call: Cycle 2 Critic-Scientific`,
      `Review the Cycle 1 draft below and respond with EXACTLY one of:`,
      `  VERDICT: CONVERGED`,
      `  VERDICT: NEEDS_REVISION`,
      `followed by a numbered list of concrete modifications (or "no modifications needed" if CONVERGED).`,
      ``,
      `Focus on:`,
      `- data accuracy, structure counts, IF attribution, literature completeness`,
      `- Section H 是否包含文献精选子段（不是结构列表）`,
      `- 8 章节是否齐全 (A 期刊趋势 / B 技术突破 / C 研究热点 / D 方法创新 / E 重要结构 Top20 / F 技术评估 / G 跨学科 / H 参考文献)`,
      ``,
      `--- BEGIN CYCLE 1 DRAFT ---`,
      previousOutputs.cycle1 || '(missing — cycle 1 output was empty)',
      `--- END CYCLE 1 DRAFT ---`,
    ].join('\n') : '',
    cycle === 3 ? [
      ``,
      `### Your role in this call: Cycle 3 Critic-Analytical`,
      `Cycle 2 returned: ${previousOutputs.cycle2Verdict || '?'} — ${previousOutputs.cycle2Notes || '?'}`,
      ``,
      `Apply the final layer of analytical critique:`,
      `- research hotspot identification`,
      `- trend interpretation accuracy`,
      `- cross-disciplinary application value`,
      ``,
      `Respond with EXACTLY:`,
      `  VERDICT: CONVERGED | NEEDS_REVISION`,
      `and a numbered list of concrete modifications (or "no modifications").`,
    ].join('\n') : '',
    cycle === 'synthesis' ? [
      ``,
      `### Your role in this call: Synthesis Generator`,
      `Apply the critic modifications and produce the FINAL 8-section report.`,
      ``,
      `Cycle 2 verdict: ${previousOutputs.cycle2Verdict || '?'} — ${previousOutputs.cycle2Notes || '?'}`,
      previousOutputs.cycle3Notes ? `Cycle 3 notes: ${previousOutputs.cycle3Notes}` : '',
      ``,
      `--- BEGIN CYCLE 1 DRAFT (apply modifications to this) ---`,
      previousOutputs.cycle1 || '(missing)',
      `--- END CYCLE 1 DRAFT ---`,
      ``,
      `Return the FINAL complete markdown document — ready to save to disk.`,
      `Do NOT include any meta commentary, just the markdown.`,
    ].join('\n') : '',
  ].filter(Boolean).join('\n');

  return prompt + perCycleAppendix;
}

const VERDICT_REGEX = /VERDICT:\s*(CONVERGED|NEEDS_REVISION)/i;

function parseCriticVerdict(content: string): { verdict: CycleVerdict; notes: string } {
  const m = content.match(VERDICT_REGEX);
  const verdict: CycleVerdict = m && m[1].toUpperCase() === 'CONVERGED' ? 'CONVERGED' : 'NEEDS_REVISION';
  // Strip the verdict line and treat the rest as notes.
  const notes = content.replace(VERDICT_REGEX, '').trim();
  return { verdict, notes: notes.slice(0, 2000) };
}

// ─── Main entry point ────────────────────────────────────────────────────────

export async function runPdbWeekly(opts: RunWeeklyOptions = {}): Promise<RunWeeklyResult> {
  const t0 = Date.now();
  const window: WeekWindow = { ...computeWeekWindow(), ...(opts.window || {}) };
  const reports: ReportType[] = opts.reports && opts.reports.length > 0 ? opts.reports : ['cryoem', 'xray'];
  const maxCycles = opts.maxCycles ?? 2;
  const cycles: CycleRecord[] = [];
  const filesWritten: string[] = [];
  const verdicts: Record<ReportType, CycleVerdict> = { cryoem: 'CONVERGED', xray: 'CONVERGED' };
  let dbCounts: PdbDbCounts | undefined;
  const emit = opts.emit || (() => {});

  try {
    emit?.({ kind: 'progress', stage: 'init', detail: `${window.weekId} • ${window.startDate} → ${window.endDate} • reports=${reports.join('+')} • maxCycles=${maxCycles}` });

    // Resolve LLM config (front-end config > env > detected)
    const cfg = resolveLlmConfig(opts.llm);
    const inspection = await inspectProviders();
    emit?.({ kind: 'progress', stage: 'provider', detail: `${inspection.chosen} (${inspection.available.length} candidates)` });

    // Load shared prompt template (one read at the start).
    let template: string;
    try {
      template = await fs.readFile(PROMPT_TEMPLATE, 'utf-8');
    } catch (e: any) {
      throw new Error(`Could not load prompt template from ${PROMPT_TEMPLATE}: ${e.message}`);
    }

    // ─── Step 1/1.5/1.6: data ingestion ──────────────────────────────────
    if (!opts.skipIngestion) {
      emit?.({ kind: 'progress', stage: 'ingest', detail: 'Step 1: RCSB fetch' });
      await stepFetch(window, emit);
      emit?.({ kind: 'progress', stage: 'ingest', detail: 'Step 1.5: literature backfill' });
      await stepBackfill(window, emit);
      emit?.({ kind: 'progress', stage: 'ingest', detail: 'Step 1.6: PubMed article population' });
      await stepPopulatePubmed(window, emit);
    } else {
      emit?.({ kind: 'progress', stage: 'ingest', detail: 'skipped (skipIngestion=true)' });
    }

    // ─── Step 2-4: 3-cycle per report type ───────────────────────────────
    for (const reportType of reports) {
      const methodName = reportType === 'cryoem' ? '冷冻电镜' : 'X射线晶体学';
      const fileName = `${methodName}结构周报-${window.weekId}-${window.reportDate}.md`;
      const filePath = path.join(WIKI_DIR, fileName);
      await fs.mkdir(WIKI_DIR, { recursive: true });

      emit?.({ kind: 'progress', stage: 'cycle1', detail: `${reportType}: Generator` });
      const cycle1Prompt = buildCyclePrompt(template, window, reportType, 1, {});
      const cycle1 = await llmComplete(cycle1Prompt, cfg);
      if (!cycle1.ok) throw new Error(`${reportType} cycle 1 failed: ${cycle1.error}`);
      if (!cycle1.text) throw new Error(`${reportType} cycle 1 returned no text`);
      cycles.push({
        cycle: 1, role: 'generator', reportType,
        provider: cycle1.provider, model: cycle1.model || '',
        durationMs: cycle1.durationMs, contentChars: cycle1.text.length,
        promptTokens: (cycle1.meta?.usage as any)?.input_tokens,
        outputTokens: (cycle1.meta?.usage as any)?.output_tokens,
      });
      let draft: string = cycle1.text;

      // Cycle 2
      if (maxCycles >= 2) {
        emit?.({ kind: 'progress', stage: 'cycle2', detail: `${reportType}: Critic-Scientific` });
        const cycle2Prompt = buildCyclePrompt(template, window, reportType, 2, { cycle1: draft });
        const cycle2 = await llmComplete(cycle2Prompt, cfg);
        if (!cycle2.ok) throw new Error(`${reportType} cycle 2 failed: ${cycle2.error}`);
        if (!cycle2.text) throw new Error(`${reportType} cycle 2 returned no text`);
        const { verdict, notes } = parseCriticVerdict(cycle2.text);
        cycles.push({
          cycle: 2, role: 'critic-scientific', reportType,
          provider: cycle2.provider, model: cycle2.model || '',
          durationMs: cycle2.durationMs, contentChars: cycle2.text.length,
          promptTokens: (cycle2.meta?.usage as any)?.input_tokens,
          outputTokens: (cycle2.meta?.usage as any)?.output_tokens,
          verdict,
        });
        verdicts[reportType] = verdict;

        if (verdict === 'NEEDS_REVISION' && maxCycles >= 3) {
          emit?.({ kind: 'progress', stage: 'cycle3', detail: `${reportType}: Critic-Analytical` });
          const cycle3Prompt = buildCyclePrompt(template, window, reportType, 3, {
            cycle1: draft, cycle2Verdict: verdict, cycle2Notes: notes,
          });
          const cycle3 = await llmComplete(cycle3Prompt, cfg);
          if (!cycle3.ok) throw new Error(`${reportType} cycle 3 failed: ${cycle3.error}`);
          if (!cycle3.text) throw new Error(`${reportType} cycle 3 returned no text`);
          const { verdict: v3, notes: n3 } = parseCriticVerdict(cycle3.text);
          cycles.push({
            cycle: 3, role: 'critic-analytical', reportType,
            provider: cycle3.provider, model: cycle3.model || '',
            durationMs: cycle3.durationMs, contentChars: cycle3.text.length,
            promptTokens: (cycle3.meta?.usage as any)?.input_tokens,
            outputTokens: (cycle3.meta?.usage as any)?.output_tokens,
            verdict: v3,
          });

          emit?.({ kind: 'progress', stage: 'synthesis', detail: `${reportType}: Synthesis Generator` });
          const synthPrompt = buildCyclePrompt(template, window, reportType, 'synthesis', {
            cycle1: draft, cycle2Verdict: verdict, cycle2Notes: notes, cycle3Notes: n3,
          });
          const synth = await llmComplete(synthPrompt, cfg);
          if (!synth.ok) throw new Error(`${reportType} synthesis failed: ${synth.error}`);
          if (!synth.text) throw new Error(`${reportType} synthesis returned no text`);
          cycles.push({
            cycle: 'synthesis', role: 'synthesis', reportType,
            provider: synth.provider, model: synth.model || '',
            durationMs: synth.durationMs, contentChars: synth.text.length,
            promptTokens: (synth.meta?.usage as any)?.input_tokens,
            outputTokens: (synth.meta?.usage as any)?.output_tokens,
          });
          draft = synth.text;
        } else if (verdict === 'NEEDS_REVISION') {
          // maxCycles < 3 but still needs revision — run synthesis anyway with cycle 2 notes only.
          emit?.({ kind: 'progress', stage: 'synthesis', detail: `${reportType}: Synthesis Generator (cycle 2 only)` });
          const synthPrompt = buildCyclePrompt(template, window, reportType, 'synthesis', {
            cycle1: draft, cycle2Verdict: verdict, cycle2Notes: notes,
          });
          const synth = await llmComplete(synthPrompt, cfg);
          if (!synth.ok) throw new Error(`${reportType} synthesis failed: ${synth.error}`);
          if (!synth.text) throw new Error(`${reportType} synthesis returned no text`);
          cycles.push({
            cycle: 'synthesis', role: 'synthesis', reportType,
            provider: synth.provider, model: synth.model || '',
            durationMs: synth.durationMs, contentChars: synth.text.length,
            promptTokens: (synth.meta?.usage as any)?.input_tokens,
            outputTokens: (synth.meta?.usage as any)?.output_tokens,
          });
          draft = synth.text;
        } else {
          // CONVERGED at cycle 2 — draft is final.
          emit?.({ kind: 'progress', stage: 'converged', detail: `${reportType}: cycle 2 CONVERGED, skipping synthesis` });
        }
      } else {
        // maxCycles = 1 — single-pass, draft is final.
        emit?.({ kind: 'progress', stage: 'converged', detail: `${reportType}: single-pass (maxCycles=1), no critic` });
      }

      // Write final markdown to disk.
      await fs.writeFile(filePath, draft, 'utf-8');
      filesWritten.push(filePath);
      emit?.({ kind: 'progress', stage: 'written', detail: `${reportType}: ${filePath} (${draft.length} chars)` });
    }

    // ─── Step 5: DB write ────────────────────────────────────────────────
    if (!opts.skipDbWrite) {
      for (const reportType of reports) {
        const methodName = reportType === 'cryoem' ? '冷冻电镜' : 'X射线晶体学';
        const fileName = `${methodName}结构周报-${window.weekId}-${window.reportDate}.md`;
        const filePath = path.join(WIKI_DIR, fileName);
        emit?.({ kind: 'progress', stage: 'db', detail: `Step 5: --report ${reportType}` });
        await stepReportWrite(reportType, filePath, emit);
      }
      // ─── Step 6: verification ─────────────────────────────────────────
      emit?.({ kind: 'progress', stage: 'verify', detail: 'Step 6: sqlite3 verification' });
      dbCounts = await stepVerifyDb(window);
      emit?.({ kind: 'progress', stage: 'verify-done', detail: `PdbStructure=${dbCounts.pdbStructure}, WeeklyReport=${dbCounts.weeklyReport}, with_authors=${dbCounts.withAuthors}, with_pubmedId=${dbCounts.withPubmedId}, PubMedArticle.matched=${dbCounts.pubmedArticleMatched}` });
    }

    return {
      ok: true, window, reports, cycles, filesWritten, dbCounts, verdicts,
      durationMs: Date.now() - t0,
    };
  } catch (e: any) {
    return {
      ok: false, window, reports, cycles, filesWritten, dbCounts, verdicts,
      durationMs: Date.now() - t0,
      error: e?.message || String(e),
    };
  }
}