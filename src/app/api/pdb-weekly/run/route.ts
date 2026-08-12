import { sseStream, sleep, type SseEvent } from '@/lib/sse';
import { db } from '@/lib/db';
import { fetchWeeklyPdbIds, fetchPdbEntryDetails, type PdbEntryDetail } from '@/lib/rcsb';
import { generateText } from '@/lib/llm';
import { sanitizeReport } from '@/lib/markdown-renderer';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// ─── Weekly report chapter definitions ──────────────────────────────────────
// Each chapter is its own short LLM call (~1-2KB output, 10-20s) so the
// full report is never truncated by max-token limits. Chapters are merged
// in order at the end.
type WeeklyChapterKey = 'A' | 'B' | 'C' | 'D' | 'E' | 'F' | 'G' | 'H';

const WEEKLY_CHAPTERS: Array<{ key: WeeklyChapterKey; label: string; title: string; desc: string }> = [
  { key: 'A', label: 'A', title: '期刊分布与影响因子分析', desc: '本周 PDB 结构的期刊来源分布，按影响因子(IF)分层统计（IF≥20、10≤IF<20、5≤IF<10、IF<5），计算高影响力期刊贡献比例，与近4周趋势对比。使用表格呈现期刊分布，标注DOI和PMID（如有）。' },
  { key: 'B', label: 'B', title: '方法学突破与分辨率记录', desc: '本周突破性结构解析成果：最高分辨率记录、新方法应用（如MicroED、Serial Femtosecond Crystallography）、AI辅助结构解析（AlphaFold3、RoseTTAFold2）案例。标注具体PDB ID、分辨率(Å)、所用方法和技术参数。' },
  { key: 'C', label: 'C', title: '研究热点与靶点类别', desc: '按蛋白质功能分类统计本周结构（如激酶、GPCR、离子通道、病毒蛋白、膜蛋白、抗体等），标注每类结构的PDB ID和代表性靶点。分析与当前药物研发热点的关联。' },
  { key: 'D', label: 'D', title: '技术方法学评估', desc: '本周各实验方法（X-ray、Cryo-EM、NMR）的分辨率分布统计：平均值、中位数、最高/最低分辨率。使用表格列出方法分布和分辨率统计。评估结构质量指标（R-work/R-free、map resolution、B-factor分布）。' },
  { key: 'E', label: 'E', title: '代表性结构精选（Top 20）', desc: '按科学重要性排序的20个关键PDB结构。表格格式：| PDB ID | 方法 | 分辨率(Å) | 蛋白名称 | 物种 | 期刊(IF) | DOI | 简要科学意义 |。优先选择高分辨率、高IF期刊、新靶点或新折叠类型的结构。' },
  { key: 'F', label: 'F', title: '结构质量与可靠性评估', desc: '本周结构的整体质量评估：分辨率分布直方图描述、完整性检查（缺失残基比例）、配体/辅因子存在率。与上周对比质量趋势。标注需要关注的质量问题。' },
  { key: 'G', label: 'G', title: '跨学科应用与转化价值', desc: '本周结构在药物设计（靶点可成药性评估）、合成生物学（酶工程改造）、疾病机制（致病突变结构基础）等方面的应用潜力分析。标注具体PDB ID和相关药物/疾病信息。' },
  { key: 'H', label: 'H', title: '核心参考文献', desc: '本周高影响力期刊（IF≥10）已正式发表的结构相关文献精选。格式：作者 et al., *期刊名* (IF: XX.X), PDB XXXX, Y.YY Å. DOI: 10.xxxx/xxxxx. PMID: 12345678.（每条一行，5-10篇）' },
];

/** Build a per-chapter LLM prompt for the weekly report. */
function buildWeeklyChapterPrompt(opts: {
  weekId: string;
  startDate: string;
  endDate: string;
  methodLabel: string; // 'X-ray 晶体学' | '冷冻电镜'
  methodKey: string;   // 'xray' | 'cryoem'
  pdbCount: number;
  pdbSummary: string;
  chapterKey: WeeklyChapterKey;
  chapterTitle: string;
  chapterDesc: string;
  chapterIndex: number;
  chapterTotal: number;
}): string {
  const { weekId, startDate, endDate, methodLabel, methodKey, pdbCount, pdbSummary, chapterKey, chapterTitle, chapterDesc, chapterIndex, chapterTotal } = opts;
  return `你是结构生物学领域的资深研究员。请生成本周（${weekId}，${startDate} 至 ${endDate}）${methodLabel} 结构周报的 **第 ${chapterIndex}/${chapterTotal} 章：${chapterKey}. ${chapterTitle}**。

**报告类型**: ${methodLabel} 周报（仅包含${methodLabel}方法解析的结构）
**PDB 入库数**: ${pdbCount} 个${methodLabel}结构
**数据来源**: RCSB PDB

## 本章要求
${chapterDesc}

## 代表性 ${methodLabel} PDB 结构数据
${pdbSummary}

请直接输出本章内容（${chapterKey}. ${chapterTitle} 标题下的正文），不要重复标题。内容充实、数据准确，使用 Markdown 格式。

格式要求：
- 表格使用 GFM pipe table 格式（| 列1 | 列2 |）
- 数据引用格式：PDB ID（4字符大写）、分辨率（X.XX Å）、DOI（10.xxxx/xxxxx）
- 文献引用格式：作者 et al., *期刊名* (IF: XX.X), PDB XXXX, Y.YY Å
- 缺失数据标注"暂无可靠数据"，不编造
- 段落3-5句，逻辑清晰`;
}

const WEEKLY_CHAPTER_SYSTEM_PROMPT = `你是结构生物学领域的资深研究员，具有丰富的学术写作经验。请用中文生成周报的某一章节内容，使用 Markdown 格式。

写作规范：
1. **学术严谨性**: 所有数据必须引用具体的 PDB ID、分辨率(Å)、DOI、PMID 等标识符
2. **量化分析**: 使用具体数字和百分比，避免模糊表述（如"约30%"而非"较多"）
3. **表格规范**: 使用 GFM pipe table 格式，表头清晰，数据对齐
4. **引用格式**: 作者 et al., *期刊名* (IF: XX.X), PDB XXXX, Y.YY Å
5. **客观中立**: 避免主观评价，基于数据给出分析结论
6. **缺失数据**: 未提供的字段标注"暂无可靠数据"，不编造
7. **段落结构**: 每段3-5句，逻辑清晰，前后衔接
8. **专业术语**: 保留英文专有名词（PDB ID、DOI、UniProt等），中文解释首次出现`

/** Generate a full method-specific weekly report via per-chapter LLM calls,
 *  streaming progress via emit(). Returns the merged markdown + per-chapter
 *  metadata. Each chapter is a separate short LLM call to avoid max-token
 *  truncation. */
async function generateMethodReport(opts: {
  weekId: string;
  startDate: string;
  endDate: string;
  methodLabel: string;
  methodKey: string;
  pdbCount: number;
  pdbSummary: string;
  llm: any;
  emit: (e: SseEvent) => void;
  methodProgressBase: number; // 0..100 base for this method's chapters
  methodProgressSpan: number; // how much progress this method gets
}): Promise<{ content: string; ok: boolean; chaptersOk: number; chaptersFailed: number; chapterDetails: any[] }> {
  const { weekId, startDate, endDate, methodLabel, methodKey, pdbCount, pdbSummary, llm, emit, methodProgressBase, methodProgressSpan } = opts;
  const chapterContents: Record<string, string> = {};
  let chaptersOk = 0;
  let chaptersFailed = 0;
  const chapterDetails: any[] = [];
  const totalChapters = WEEKLY_CHAPTERS.length;

  emit({ stage: `${methodKey}-llm`, level: 'info', message: `[${methodLabel}] 准备分 ${totalChapters} 章节生成报告… 共 ${pdbCount} 个 ${methodLabel} 结构已加载到上下文`, progress: methodProgressBase });

  // Per-chapter timeout + heartbeat. The previous implementation awaited
  // generateText() with no wall-clock cap — if the LLM CLI hung (common with
  // cli:codebuddy on large prompts) the whole weekly run froze at "[1/8] A.
  // 期刊趋势分析 — 开始生成" forever. Now each chapter is hard-capped at
  // CHAPTER_TIMEOUT_MS and emits a heartbeat every HEARTBEAT_MS so the UI
  // shows the run is alive (not stuck).
  const CHAPTER_TIMEOUT_MS = 150_000; // 2.5 min per chapter — generous but finite
  const HEARTBEAT_MS = 15_000;        // emit "still generating…" every 15s

  for (let i = 0; i < totalChapters; i++) {
    const ch = WEEKLY_CHAPTERS[i];
    const chapterIdx = i + 1;
    const chapterProgress = methodProgressBase + Math.round((i / totalChapters) * methodProgressSpan);
    emit({ stage: `${methodKey}-chapter`, level: 'info', message: `[${methodLabel}] [${chapterIdx}/${totalChapters}] ${ch.key}. ${ch.title} — 开始生成`, progress: chapterProgress, chapter: ch.key, chapterIndex: chapterIdx, chapterTotal: totalChapters, method: methodKey });
    const userPrompt = buildWeeklyChapterPrompt({
      weekId, startDate, endDate, methodLabel, methodKey, pdbCount, pdbSummary,
      chapterKey: ch.key, chapterTitle: ch.title, chapterDesc: ch.desc,
      chapterIndex: chapterIdx, chapterTotal: totalChapters,
    });
    const t0 = Date.now();
    // Each weekly chapter is a SEPARATE short LLM call (~1-5KB output
    // is realistic now that the system prompt + chapter template is well
    // scoped). 8000 chars gives the chapter room to breathe while still
    // well under any reasonable output-token cap (8-16K on most models).
    const callPromise = generateText(WEEKLY_CHAPTER_SYSTEM_PROMPT, userPrompt, { maxChars: 8000, llm });
    // Heartbeat: emit "still generating…" every HEARTBEAT_MS so the UI
    // never looks frozen during long LLM calls.
    const heartbeat = setInterval(() => {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(0);
      emit({ stage: `${methodKey}-chapter`, level: 'info', message: `[${methodLabel}] [${chapterIdx}/${totalChapters}] ${ch.key}. ${ch.title} — 生成中… ${elapsed}s`, progress: chapterProgress, chapter: ch.key, chapterIndex: chapterIdx, chapterTotal: totalChapters, method: methodKey });
    }, HEARTBEAT_MS);
    let r: { ok: boolean; content: string; text: string; provider: string; model: string; durationMs: number; fallback: boolean; error?: string };
    try {
      r = await Promise.race([
        callPromise,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`章节生成超时 (${CHAPTER_TIMEOUT_MS / 1000}s)`)), CHAPTER_TIMEOUT_MS)),
      ]) as any;
    } catch (err: any) {
      r = { ok: false, content: '', text: '', provider: '', model: '', durationMs: Date.now() - t0, fallback: false, error: err?.message ?? 'timeout' };
    } finally {
      clearInterval(heartbeat);
    }
    if (r.ok) {
      chaptersOk++;
      chapterContents[ch.key] = r.content;
      emit({ stage: `${methodKey}-chapter_done`, level: 'success', message: `[${methodLabel}] [${chapterIdx}/${totalChapters}] ${ch.key}. ${ch.title} ✓ ${r.content.length} chars · ${(r.durationMs / 1000).toFixed(1)}s`, progress: chapterProgress + Math.round(methodProgressSpan / totalChapters) - 1, chapter: ch.key, chapterIndex: chapterIdx, chapterTotal: totalChapters, chapterContent: r.content, method: methodKey });
      chapterDetails.push({ key: ch.key, title: ch.title, ok: true, chars: r.content.length, durationMs: r.durationMs });
    } else {
      chaptersFailed++;
      chapterContents[ch.key] = `_(${ch.key}. ${ch.title}: LLM 调用失败 — ${r.error?.slice(0, 120) ?? 'unknown'})_`;
      emit({ stage: `${methodKey}-chapter_done`, level: 'error', message: `[${methodLabel}] [${chapterIdx}/${totalChapters}] ${ch.key}. ${ch.title} ✗ ${r.error?.slice(0, 100) ?? 'unknown'}`, progress: chapterProgress + Math.round(methodProgressSpan / totalChapters) - 1, chapter: ch.key, chapterIndex: chapterIdx, chapterTotal: totalChapters, method: methodKey });
      chapterDetails.push({ key: ch.key, title: ch.title, ok: false, error: r.error, durationMs: r.durationMs });
    }
    // Rate-limit delay between chapters to avoid 429 from z-ai SDK.
    // Each chapter is a separate LLM call; firing them back-to-back triggers
    // "Too many requests" (429). A 10s gap gives the API time to recover.
    if (i < totalChapters - 1) {
      await new Promise(r => setTimeout(r, 10000));
    }
  }

  // Merge chapters in order — sanitize to close unclosed bold/code spans
  // and fix any mid-table truncation from individual chapters.
  const merged = sanitizeReport(WEEKLY_CHAPTERS.map(ch => `## ${ch.key}. ${ch.title}\n\n${chapterContents[ch.key] ?? ''}`).join('\n\n'));
  const allOk = chaptersFailed === 0;
  emit({ stage: `${methodKey}-llm`, level: allOk ? 'success' : 'warn', message: `✓ [${methodLabel}] 分章报告完成 · ${chaptersOk}/${totalChapters} 章 · ${merged.length} chars${allOk ? '' : ` · ${chaptersFailed} 章失败`}`, progress: methodProgressBase + methodProgressSpan });
  return { content: merged, ok: allOk, chaptersOk, chaptersFailed, chapterDetails };
}
function isoWeek(d: Date) {
  const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  const start = new Date(tmp); start.setUTCDate(tmp.getUTCDate() - 3);
  const end = new Date(start); end.setUTCDate(start.getUTCDate() + 6);
  const report = new Date(end); report.setUTCDate(end.getUTCDate() + 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return { weekId: `${tmp.getUTCFullYear()}-W${pad(weekNo)}`, startDate: start.toISOString().slice(0, 10), endDate: end.toISOString().slice(0, 10), reportDate: report.toISOString().slice(0, 10) };
}
/** Compute the week window (start/end/report dates) from an ISO week id like "2026-W28". */
function isoWeekFromId(weekId: string) {
  const m = /^(\d{4})-W(\d{2})$/.exec(weekId);
  if (!m) return isoWeek(new Date());
  const year = parseInt(m[1], 10);
  const week = parseInt(m[2], 10);
  // ISO 8601: week 1 is the week with the year's first Thursday.
  // Simple algorithm: Jan 4 is always in week 1.
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Monday = new Date(jan4);
  week1Monday.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
  const weekMonday = new Date(week1Monday);
  weekMonday.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7);
  const start = weekMonday;
  const end = new Date(start); end.setUTCDate(start.getUTCDate() + 6);
  const report = new Date(end); report.setUTCDate(end.getUTCDate() + 1);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    weekId,
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
    reportDate: report.toISOString().slice(0, 10),
  };
}
export async function GET() {
  const w = isoWeek(new Date());
  let pdbStructureCount = 0, weeklyReportCount = 0, weeklySnapshotCount = 0;
  try {
    pdbStructureCount = await db.pdbStructure.count({ where: { weekId: w.weekId } });
    weeklyReportCount = await db.weeklyReportRun.count({ where: { weekId: w.weekId } });
    weeklySnapshotCount = await db.weeklySnapshot.count({ where: { weekId: w.weekId } });
  } catch { /* ignore — table may not exist yet */ }
  return Response.json({ ...w, dbCounts: { pdbStructure: pdbStructureCount, weeklyReport: weeklyReportCount, weeklySnapshot: weeklySnapshotCount } });
}
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const maxCycles: 1 | 2 | 3 = ([1, 2, 3].includes(Number(body.maxCycles)) ? Number(body.maxCycles) : 2) as 1 | 2 | 3;
  const provider = body.llm?.provider || 'cli:hermes';
  const model = body.llm?.model || 'hermes';
  // Allow custom ISO week override (format "YYYY-Www"). Compute the week's
  // start/end/report dates from the weekId so RCSB fetch + DB writes target
  // the correct week. Falls back to current week when not provided.
  const currentWindow = isoWeek(new Date());
  const customWeekId: string | undefined = typeof body.weekId === 'string' && /^\d{4}-W\d{2}$/.test(body.weekId) ? body.weekId : undefined;
  const window = customWeekId ? isoWeekFromId(customWeekId) : currentWindow;
  const { stream, progress, done } = sseStream();
  (async () => {
    const t0 = Date.now();
    // Accumulate every SSE event into a log array so the Run Center can
    // show the full log for past runs (not just the short summary).
    const _log: string[] = [];
    const emit = (e: SseEvent) => {
      try { _log.push(JSON.stringify({ ts: new Date().toISOString(), ...e })); } catch { /* never let logging break the route */ }
      progress(e);
    };
    emit({ stage: 'init', level: 'info', message: `启动 pdb-weekly · ${window.weekId} · ${maxCycles}-cycle`, progress: 1 });
    await sleep(300);
    emit({ stage: 'fetch-rcsb', level: 'info', message: `RCSB 检索 ${window.startDate} → ${window.endDate}（真实 API）`, progress: 6 });
    const pdbIds = await fetchWeeklyPdbIds(window.startDate, window.endDate, 1000);
    const fetched = pdbIds.length;
    if (fetched === 0) emit({ stage: 'fetch-rcsb', level: 'error', message: `✗ RCSB 返回 0 条`, progress: 14 });
    else emit({ stage: 'fetch-rcsb', level: 'success', message: `✓ RCSB 返回 ${fetched} 条真实 PDB ID`, progress: 14 });
    emit({ stage: 'fetch-detail', level: 'info', message: `拉取详细元数据`, progress: 18 });
    const details: PdbEntryDetail[] = fetched > 0 ? await fetchPdbEntryDetails(pdbIds) : [];
    emit({ stage: 'fetch-detail', level: 'success', message: `✓ 获取 ${details.length} 条详细元数据`, progress: 24 });
    emit({ stage: 'write-pdb', level: 'info', message: `写入 PdbStructure 表（${details.length} 条，全部写入）`, progress: 28 });
    let pdbSaved = 0, withAuthors = 0, withPubmedId = 0;
    try {
      for (const e of details) {
        // Convert null → undefined for nullable fields. Prisma treats
        // undefined as "skip this field" but null as "set to NULL".
        // Some SQLite versions reject NULL on fields that were previously
        // non-null, causing "Null constraint violation" errors.
        const data = {
          method: e.method ?? undefined,
          releaseDate: e.releaseDate ?? undefined,
          resolution: e.resolution ?? undefined,
          title: e.title ?? undefined,
          doi: e.doi ?? undefined,
          journal: e.journal ?? undefined,
          journalIf: e.journalIf ?? undefined,
          authors: e.authors ?? undefined,
          organisms: e.organisms ?? undefined,
          ligands: e.ligands ?? undefined,
          weekId: window.weekId,
          pubmedId: e.pubmedId ?? undefined,
          fetchDate: new Date().toISOString().slice(0, 10),
        };
        await db.pdbStructure.upsert({
          where: { pdbId: e.pdbId },
          create: { pdbId: e.pdbId, ...data },
          update: data,
        });
        pdbSaved++;
        if (e.authors) withAuthors++;
        if (e.pubmedId) withPubmedId++;
      }
      emit({ stage: 'write-pdb', level: 'success', message: `✓ 已写入 ${pdbSaved} 条 PdbStructure（with_authors=${withAuthors}, with_pubmedId=${withPubmedId}）`, progress: 34 });
    } catch (err: any) { emit({ stage: 'write-pdb', level: 'error', message: `✗ PdbStructure 写入失败：${err?.message}`, progress: 34 }); }

    // ── Split PDB structures by method for method-specific reports ──
    // The user wants separate reports for X-ray and Cryo-EM (not a combined
    // report). Each report is generated via per-chapter LLM calls to avoid
    // max-token truncation.
    const cryoemDetails = details.filter(e => (e.method || '').includes('ELECTRON'));
    const xrayDetails = details.filter(e => (e.method || '').includes('X-RAY'));
    const methodBreakdown = { 'Cryo-EM': cryoemDetails.length, 'X-ray': xrayDetails.length, 'NMR': details.filter(e => (e.method || '').includes('NMR')).length };
    emit({ stage: 'method-split', level: 'info', message: `按方法分组: Cryo-EM=${cryoemDetails.length}, X-ray=${xrayDetails.length}, NMR=${methodBreakdown['NMR']}`, progress: 38 });

    // Build per-method PDB summaries (Top 25 each is enough context for the
    // LLM — Top 30 was right at the token edge and triggered input-side
    // truncation on long titles/journal names. Each Top-25 line is ~150
    // chars × 25 = ~4KB of text — well within the per-chapter context
    // budget. The LLM has the full count above so it can say "等".
    const TOP_N = 25;
    const cryoemSummary = cryoemDetails.slice(0, TOP_N).map(e => `- ${e.pdbId}: ${e.method || 'unknown'} | ${e.resolution != null ? e.resolution.toFixed(1) + 'Å' : 'N/A'} | ${(e.title || '').slice(0, 60)} | ${e.journal || 'N/A'}`).join('\n');
    const xraySummary = xrayDetails.slice(0, TOP_N).map(e => `- ${e.pdbId}: ${e.method || 'unknown'} | ${e.resolution != null ? e.resolution.toFixed(1) + 'Å' : 'N/A'} | ${(e.title || '').slice(0, 60)} | ${e.journal || 'N/A'}`).join('\n');

    // ── Generate Cryo-EM report (8 chapters, each a separate LLM call) ──
    // Progress: 40%..65% for Cryo-EM chapters
    let cryoemReport: { content: string; ok: boolean; chaptersOk: number; chaptersFailed: number; chapterDetails: any[] } | null = null;
    if (cryoemDetails.length > 0) {
      cryoemReport = await generateMethodReport({
        weekId: window.weekId, startDate: window.startDate, endDate: window.endDate,
        methodLabel: '冷冻电镜', methodKey: 'cryoem',
        pdbCount: cryoemDetails.length, pdbSummary: cryoemSummary,
        llm: body.llm, emit,
        methodProgressBase: 40, methodProgressSpan: 25,
      });
    } else {
      emit({ stage: 'cryoem-llm', level: 'warn', message: `[冷冻电镜] 本周无 Cryo-EM 结构，跳过报告生成`, progress: 65 });
    }

    // ── Generate X-ray report (8 chapters, each a separate LLM call) ──
    // Progress: 65%..90% for X-ray chapters
    let xrayReport: { content: string; ok: boolean; chaptersOk: number; chaptersFailed: number; chapterDetails: any[] } | null = null;
    if (xrayDetails.length > 0) {
      xrayReport = await generateMethodReport({
        weekId: window.weekId, startDate: window.startDate, endDate: window.endDate,
        methodLabel: 'X-ray 晶体学', methodKey: 'xray',
        pdbCount: xrayDetails.length, pdbSummary: xraySummary,
        llm: body.llm, emit,
        methodProgressBase: 65, methodProgressSpan: 25,
      });
    } else {
      emit({ stage: 'xray-llm', level: 'warn', message: `[X-ray 晶体学] 本周无 X-ray 结构，跳过报告生成`, progress: 90 });
    }

    // Build cycle-like entries for backward compat with the DB schema + UI
    // (which expects a `cycles` array). We store 2 "cycles": one per method.
    const cycles: any[] = [];
    if (cryoemReport) {
      cycles.push({ cycle: 1, role: 'cryoem', reportType: 'cryoem', provider, model, durationMs: 0, contentChars: cryoemReport.content.length, content: cryoemReport.content, llmOk: cryoemReport.ok, chaptersOk: cryoemReport.chaptersOk, chaptersFailed: cryoemReport.chaptersFailed, chapterDetails: cryoemReport.chapterDetails });
    }
    if (xrayReport) {
      cycles.push({ cycle: cryoemReport ? 2 : 1, role: 'xray', reportType: 'xray', provider, model, durationMs: 0, contentChars: xrayReport.content.length, content: xrayReport.content, llmOk: xrayReport.ok, chaptersOk: xrayReport.chaptersOk, chaptersFailed: xrayReport.chaptersFailed, chapterDetails: xrayReport.chapterDetails });
    }

    // finalContent is kept for backward compat but is no longer the primary
    // display path — the UI reads per-method content via cyclesJson.
    const finalContent = cryoemReport?.content || xrayReport?.content || '';

    emit({ stage: 'write-db', level: 'info', message: '写入 WeeklyReportRun + SkillRunRecord', progress: 92 });
    await sleep(300);
    const filesWritten = [`weekly-reports/${window.weekId}/cryoem.md`, `weekly-reports/${window.weekId}/xray.md`];
    const providers = provider;
    let dbSaved = false;
    try {
      await db.weeklyReportRun.create({ data: { weekId: window.weekId, cycles: cycles.length, reportTypes: 'cryoem+xray', providers, filesWritten: filesWritten.join('\n'), durationMs: Date.now() - t0, cyclesJson: JSON.stringify(cycles) } });
      const totalChaptersOk = (cryoemReport?.chaptersOk || 0) + (xrayReport?.chaptersOk || 0);
      const totalChaptersFailed = (cryoemReport?.chaptersFailed || 0) + (xrayReport?.chaptersFailed || 0);
      await db.skillRunRecord.create({ data: { module: 'weekly', status: totalChaptersFailed === 0 ? 'success' : 'error', summary: `完成 ${window.weekId} · ${fetched} PDB · Cryo-EM ${cryoemDetails.length} + X-ray ${xrayDetails.length} · ${totalChaptersOk} 章✓ ${totalChaptersFailed} 章✗ · ${providers}`, details: JSON.stringify({ weekId: window.weekId, pdbFetched: fetched, pdbSaved, withAuthors, withPubmedId, cryoemCount: cryoemDetails.length, xrayCount: xrayDetails.length, cryoemChaptersOk: cryoemReport?.chaptersOk, xrayChaptersOk: xrayReport?.chaptersOk, totalChaptersOk, totalChaptersFailed }), provider, model, llmOk: totalChaptersFailed === 0, durationMs: Date.now() - t0, resultJson: JSON.stringify({ weekId: window.weekId, cycles: cycles.map(c => ({ cycle: c.cycle, role: c.role, contentChars: c.contentChars, llmOk: c.llmOk, chaptersOk: c.chaptersOk, chaptersFailed: c.chaptersFailed })), pdbFetched: fetched, pdbSaved, cryoemContentChars: cryoemReport?.content.length || 0, xrayContentChars: xrayReport?.content.length || 0 }), log: _log.join('\n') } });
      dbSaved = true; emit({ stage: 'write-db', level: 'success', message: `✓ 已写入 WeeklyReportRun + SkillRunRecord（Cryo-EM ${cryoemReport?.content.length || 0} chars + X-ray ${xrayReport?.content.length || 0} chars）`, progress: 98 });
    } catch (err: any) { emit({ stage: 'write-db', level: 'error', message: `✗ 数据库写入失败：${err?.message}`, progress: 98 }); }
    const result = { window, reports: ['cryoem', 'xray'], cycles: cycles.map(c => ({ ...c, content: undefined })), cryoemContent: cryoemReport?.content || '', xrayContent: xrayReport?.content || '', finalContent, dbCounts: { pdbStructure: pdbSaved, weeklyReport: cycles.length, weeklySnapshot: 0, withAuthors, withPubmedId, pubmedArticleMatched: withPubmedId }, pdbFetched: fetched, pdbSaved, methodBreakdown, pdbSample: details.slice(0, 5).map(e => ({ pdbId: e.pdbId, method: e.method, resolution: e.resolution, title: e.title?.slice(0, 60) })), filesWritten, dbSaved, durationMs: Date.now() - t0 };
    emit({ stage: 'done', level: 'success', message: `完成 · ${fetched} PDB (Cryo-EM ${cryoemDetails.length} + X-ray ${xrayDetails.length}) · Cryo-EM 报告 ${cryoemReport?.content.length || 0} chars · X-ray 报告 ${xrayReport?.content.length || 0} chars · ${((Date.now() - t0) / 1000).toFixed(1)}s${dbSaved ? ' · DB ✓' : ' · DB ✗'}`, progress: 100 });
    await sleep(150); done(result);
  })();
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } });
}
