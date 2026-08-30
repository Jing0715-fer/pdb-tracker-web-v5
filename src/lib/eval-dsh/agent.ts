// src/lib/eval-dsh/agent.ts
//
// R179 (Task 2-a): DSH 模式 agent 编排 ——
//   Phase A collect     数据收集（collect.ts，进度到 ~56%）
//   Phase B relevance   agent 先分析所有数据源与科学问题的相关性
//   Phase C outline     规划大纲（R184：基础评估章节必含 + 问题深挖章节叠加，
//                       含本地校验+自动修复）
//   Phase D figures     配图（RCSB 结构图 + web 原理图 + VLM 验证，配额上限已移除）
//   Phase E chapters    逐章撰写（chapter / chapter_done SSE 事件）
//   Phase F assemble    组装报告 + 持久化（SkillEvaluationReport + Evaluation）
//
// R184 行为变更（用户诉求）：即使写了聚焦的科学问题，报告也必须包含基本
// 评估内容（功能/PDB 资源/结构质量/成药性等基础章节由数据驱动强制必含），
// 问题相关章节只是「额外重点讨论」；配图不再设全局张数上限。
//
// 所有 LLM 调用走 src/lib/llm.ts 的 generateText（provider 由调用方传入，
// 默认 zai 在本 sandbox 可用）。JSON 输出一律经 extractJson 鲁棒解析 +
// 一次「只输出 JSON」修复重试。

import type { SseEvent } from '@/lib/sse';
import type { LlmConfig } from '@/lib/llm';
import { generateText, stripReasoning } from '@/lib/llm';
import { buildDetailedPdbTable, buildDetailedBlastTable } from '@/lib/report-template';
import { sanitizeReport } from '@/lib/markdown-renderer';
import { db, getActiveDbFsPath } from '@/lib/db';
import { applySchemaCompat } from '@/lib/schema-compat';
import { collectEvaluationData, type CollectOpts, type CollectResult, type LiteratureRow } from './collect';
import { SECTION_LIBRARY, getSection, outlineRules, type SectionTemplate, type DataHint, type OutlineDataInfo } from './section-library';
import { collectRcsbFigures, searchWebFigures, type ReportFigure } from './figures';

// ─── 类型 ───────────────────────────────────────────────────────────────────

export interface DshOutlineEntry {
  id: string;
  title: string;
  focus: string;
}

export interface DshRelevance {
  questionRestated?: string;
  findings?: Array<{ source: string; relevance: string; note: string }>;
  keyInsights?: string[];
  dataGaps?: string[];
}

export interface DshChapterResult {
  id: string;
  title: string;
  ok: boolean;
  content: string;
  attempts?: number;
  error?: string;
}

export interface DshRunResult {
  mode: 'dsh';
  uniprot: string;
  uniprotInfo: CollectResult['uniprotInfo'];
  question: string;
  relevance: DshRelevance | null;
  outline: DshOutlineEntry[];
  figures: ReportFigure[];
  report: {
    ok: boolean;
    provider: string;
    model: string;
    durationMs: number;
    contentChars: number;
    content: string;
    chapters: DshChapterResult[];
    chaptersOk: number;
    chaptersFailed: number;
    error?: string;
  };
  directPdbCount: number;
  blastHitCount: number;
  coverage: number;
  scores: CollectResult['scores'];
  dbSaved: boolean;
  durationMs: number;
}

// ─── 鲁棒 JSON 提取 ─────────────────────────────────────────────────────────

/**
 * R179 (Task 2-a): 从 LLM 文本鲁棒提取 JSON；R183 强化——
 *   - 先剥推理模型内联的 <think>…</think>（MiniMax-M3 / R1 风格；
 *     generateText 已在 maxChars 截断前剥过，这里是第二道防线）
 *   - 快路径：整串直接 JSON.parse
 *   - 代码围栏任意位置提取（```json … ```），围栏内容优先于原文
 *   - 平衡块扫描：首个块解析失败时继续找下一个块（模型输出多段 JSON 时）
 *   - 尾逗号容忍（LLM 高频错误：`[1,2,]` / `{"a":1,}`）
 * 返回 null 表示无法解析。
 */
export function extractJson(text: string): any | null {
  if (!text) return null;
  const s = stripReasoning(String(text));
  if (!s) return null;
  try { return JSON.parse(s); } catch { /* fall through */ }
  // 代码围栏：任意位置、可多段（```json … ``` / ``` … ```），围栏内容优先。
  const fenced = Array.from(s.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi), (m) => m[1]);
  for (const cand of [...fenced, s]) {
    const parsed = parseFirstBalancedJson(cand);
    if (parsed !== null) return parsed;
  }
  return null;
}

/** 扫描 s 中每个顶层平衡 {} 块并逐个尝试解析；全部失败返回 null。 */
function parseFirstBalancedJson(s: string): any | null {
  let start = s.indexOf('{');
  while (start >= 0) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    let end = -1;
    for (let i = start; i < s.length; i++) {
      const ch = s[i];
      if (inStr) {
        if (esc) { esc = false; continue; }
        if (ch === '\\') { esc = true; continue; }
        if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') { inStr = true; continue; }
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
    if (end < 0) return null; // 未闭合（输出被截断）——后续不可能再有完整块
    const parsed = parseJsonLoose(s.slice(start, end + 1));
    if (parsed !== null) return parsed;
    start = s.indexOf('{', end + 1); // 首个块非法 → 继续找下一个平衡块
  }
  return null;
}

/** JSON.parse + 尾逗号容忍（两轮均失败返回 null）。 */
function parseJsonLoose(s: string): any | null {
  try { return JSON.parse(s); } catch { /* fall through */ }
  try { return JSON.parse(s.replace(/,\s*([}\]])/g, '$1')); } catch { return null; }
}

/** generateText + extractJson + 一次「只输出 JSON」修复重试。 */
async function generateJson(
  system: string,
  user: string,
  opts: { maxChars?: number; llm?: LlmConfig; signal?: AbortSignal },
): Promise<{ parsed: any | null; provider: string; model: string; durationMs: number }> {
  const r1 = await generateText(system, user, opts);
  const totalMs = r1.durationMs;
  if (r1.ok) {
    const parsed = extractJson(r1.content);
    if (parsed) return { parsed, provider: r1.provider, model: r1.model, durationMs: totalMs };
    // 修复重试：明确要求只输出 JSON。
    const r2 = await generateText(system, user + '\n\n【重要】只输出 JSON，不要任何解释文字或代码围栏。', opts);
    const total2 = totalMs + r2.durationMs;
    if (r2.ok) {
      const parsed2 = extractJson(r2.content);
      if (parsed2) return { parsed: parsed2, provider: r2.provider, model: r2.model, durationMs: total2 };
    }
    return { parsed: null, provider: r2.ok ? r2.provider : r1.provider, model: r2.ok ? r2.model : r1.model, durationMs: total2 };
  }
  return { parsed: null, provider: r1.provider, model: r1.model, durationMs: totalMs };
}

// ─── 章节内容校验/规范化（本地版）──────────────────────────────────────────
// report-template.ts 的 validateChapterContent/normalizeEvalChapterContent
// 以 ReportChapterKey（经典 8 章）为键，DSH 章节 id 与之不兼容，故本地
// 实现同语义的校验器/规范化器（接收期望中文标题）。

/** 校验：≥150 字符 + 含期望 H2 标题 + 非失败占位符。 */
function validateDshChapter(expectedTitle: string, content: string): { ok: boolean; reason?: string } {
  if (!content || typeof content !== 'string') return { ok: false, reason: '内容为空' };
  const trimmed = content.trim();
  // R179 (Task 2-a): 任何 `_(...)_` 斜体占位符（经典管线的 "LLM 调用失败" 或
  // 本文件的 "本章生成失败"）都不是真实正文 —— 一律拒绝。
  if (trimmed.startsWith('_(') && /失败/.test(trimmed)) {
    return { ok: false, reason: '内容是失败占位符' };
  }
  if (trimmed.length < 150) {
    return { ok: false, reason: `内容过短（${trimmed.length} chars，需 ≥150）` };
  }
  if (!trimmed.includes(expectedTitle)) {
    return { ok: false, reason: `缺少期望标题「${expectedTitle}」` };
  }
  return { ok: true };
}

/** 规范化：标题层级修正（含期望标题的标题 → H2；§N.M → H3）+ 去重标题。 */
function normalizeDshChapter(content: string, expectedTitle: string): string {
  if (!content) return content;
  let s = content.replace(/\r\n?/g, '\n');
  const titleEsc = expectedTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // 1) 含章节标题的标题行统一为 H2；重复的删除。
  const titleHeadingRe = new RegExp(`^(#{1,4})\\s+((?:\\d+[\\.\\-]\\s*)?${titleEsc}[^\\n]*)$`, 'gm');
  let firstKept = false;
  s = s.replace(titleHeadingRe, (_m, _hashes, rest) => {
    if (firstKept) return '';
    firstKept = true;
    return `## ${String(rest).trim()}`;
  });
  // 2) §N.M / N.M 子节统一为 H3 带 § 前缀。
  s = s.replace(
    /^#{1,4}\s+(§?)(\d+\.\d+)(\.\s+|\.\s+|\s+)(.+)$/gm,
    (_m, _p, num, _sep, rest) => `### §${num}. ${String(rest).trim()}`,
  );
  // 3) 剥正文里残留的 H1（H1 保留给报告总标题）。
  s = s.replace(/^#\s+[^\n]+\n?/gm, '');
  // 4) 3+ 空行折叠。
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

// ─── 数据上下文构建 ─────────────────────────────────────────────────────────

/** 共享数据上下文头部（mirror report-template.ts buildChapterPrompt 的表头风格）。 */
function buildContextHeader(c: CollectResult): string {
  return `# 数据上下文（真实数据，不得编造）

| 字段 | 值 |
|------|------|
| UniProt ID | ${c.uniprotInfo.uniprotId} |
| Entry | ${c.uniprotInfo.entryName} |
| 蛋白名 | ${c.uniprotInfo.proteinName} |
| 基因 | ${c.uniprotInfo.geneNames} |
| 物种 | ${c.uniprotInfo.organism} |
| 序列长度 | ${c.uniprotInfo.sequenceLength} aa |
| SIFTS 覆盖率 | ${c.coverage}% |
| 直接 PDB 数 | ${c.directPdbCount} |
| BLAST 同源数 | ${c.blastHitCount} |
| X-ray 评分 | ${c.scores.xray.score}/10 (${c.scores.xray.rating}) · ${c.scores.xray.structures} 条 |
| Cryo-EM 评分 | ${c.scores.cryoem.score}/10 (${c.scores.cryoem.rating}) · ${c.scores.cryoem.structures} 条 |
| NMR 评分 | ${c.scores.nmr.score}/10 (${c.scores.nmr.rating}) · ${c.scores.nmr.structures} 条 |
| Overall 评分 | ${c.scores.overall.score}/10 (${c.scores.overall.rating}) |`;
}

/** PDB 表块（按 dataHints 过滤后拼进章节 prompt）。 */
function buildPdbBlock(c: CollectResult): string {
  if (!c.pdbRows || c.pdbRows.length === 0) {
    return `## PDB 结构表（无数据 — RCSB 未返回直接结构）`;
  }
  return `## PDB 结构表（共 ${c.pdbRows.length} 条，按分辨率/IF 排序，显示前 40）

| # | PDB | 方法 | 分辨率(Å) | 来源 | 期刊 (IF) | 配体 | 作者 | 标题 |
|---|------|------|-----------|------|------|------|------|------|
${buildDetailedPdbTable(c.pdbRows, 40)}`;
}

function buildBlastBlock(c: CollectResult): string {
  if (c.skippedBlast || !c.blastRows || c.blastRows.length === 0) {
    return `## BLAST 同源表（已跳过或无命中）`;
  }
  return `## BLAST 同源表（共 ${c.blastRows.length} 条，identity 降序，显示前 40）

| # | PDB | UniProt Ref | Description | Identity% | E-value | Query Cov. |
|---|------|-----------|-------------|-----------|---------|------------|
${buildDetailedBlastTable(c.blastRows, 40)}`;
}

function buildLiteratureBlock(c: CollectResult): string {
  if (!c.literature || c.literature.length === 0) {
    return `## 相关文献（无 PubMed 文献数据）`;
  }
  const lines = c.literature.map((l: LiteratureRow) =>
    `- PMID ${l.pmid} | ${l.title} | ${l.journal}${l.journalIf != null ? ` (IF: ${l.journalIf.toFixed(1)})` : ''} | ${l.year} | 摘要：${l.abstract || '（无摘要）'}`,
  );
  return `## 相关文献（PubMed，共 ${c.literature.length} 篇，按期刊 IF 降序；摘要截 200 字）

${lines.join('\n')}`;
}

/** 按 dataHints 过滤共享数据上下文（homology 章 BLAST-heavy 等）。 */
function buildFilteredContext(c: CollectResult, hints: Array<DataHint>): string {
  const blocks: string[] = [];
  if (hints.includes('uniprot')) blocks.push(buildContextHeader(c));
  else blocks.push(`# 数据上下文（节选）\n\n| 字段 | 值 |\n|------|------|\n| UniProt ID | ${c.uniprotInfo.uniprotId} |\n| 蛋白名 | ${c.uniprotInfo.proteinName} |\n| 物种 | ${c.uniprotInfo.organism} |`);
  if (hints.includes('scores')) {
    blocks.push(`| 评分 | X-ray ${c.scores.xray.score}/10 (${c.scores.xray.structures}条) · Cryo-EM ${c.scores.cryoem.score}/10 (${c.scores.cryoem.structures}条) · NMR ${c.scores.nmr.score}/10 (${c.scores.nmr.structures}条) · Overall ${c.scores.overall.score}/10 |`);
  }
  if (hints.includes('rcsb')) blocks.push(buildPdbBlock(c));
  if (hints.includes('blast')) blocks.push(buildBlastBlock(c));
  if (hints.includes('literature')) blocks.push(buildLiteratureBlock(c));
  return blocks.join('\n\n---\n\n');
}

// ─── 大纲校验与自动修复 ─────────────────────────────────────────────────────

export interface RawOutlineSection { id?: string; focus?: string }

/**
 * R184: 关键词启发式 —— outline JSON 失败时按科学问题文本猜测「问题深挖」
 * 章节作为降级保底（用户现场曾遭 relevance + outline 双 JSON 失败，
 * 旧版降级大纲完全丢失问题视角）。最多猜 3 个；repairOutline 会自动
 * 去掉与基础章节重复/无对应模板的项。
 */
export function guessQuestionSections(question: string): string[] {
  const q = String(question || '').toLowerCase();
  const picks: string[] = [];
  const add = (re: RegExp, id: string) => { if (re.test(q)) picks.push(id); };
  add(/复合物|互作|相互作用|complex|dimer|二聚|抗体|antibody/, 'interactions');
  add(/通路|信号传导|pathway|signaling|上下游/, 'pathway');
  add(/突变|变异|mutation|variant|耐药|resistance/, 'variants');
  add(/表达|定位|expression|localization|组织|tissue/, 'expression');
  add(/口袋|配体|抑制剂|结合位点|ligand|pocket|inhibitor|结合能/, 'ligand_binding');
  add(/结构域|domain|催化|残基/, 'domains');
  return [...new Set(picks)].slice(0, 3);
}

/**
 * R179 (Task 2-a) / R184: 大纲校验 + 自动修复：
 *   - 丢弃未知 id / 非法条目；去重
 *   - force-prepend summary、force-insert question_focus 于位置 2、
 *     force-append references + conclusion
 *   - R184: 基础评估章节（数据驱动，见 baselineSectionIds）必含 ——
 *     LLM 漏选时按标准顺序补插（聚焦问题不得挤掉基本评估内容）；
 *     基础章节固定排在前面，LLM 选出的问题深挖章节排在其后
 *   - clamp 到 totalMax（溢出时从问题深挖章节尾部截断）
 */
export function repairOutline(raw: any, data?: Partial<OutlineDataInfo>): DshOutlineEntry[] {
  const rules = outlineRules(data);
  const baseline = rules.baselineIds;
  const entries: DshOutlineEntry[] = [];
  const seen = new Set<string>();
  if (Array.isArray(raw?.sections)) {
    for (const s of raw.sections as RawOutlineSection[]) {
      if (!s || typeof s !== 'object') continue;
      const id = String(s.id || '').trim();
      if (!id) continue;
      const tmpl = getSection(id);
      if (!tmpl) continue; // 未知 id —— 丢弃
      if (seen.has(id)) continue; // 去重
      seen.add(id);
      entries.push({ id, title: tmpl.titleZh, focus: String(s.focus || tmpl.purpose).slice(0, 300) });
    }
  }
  // 移除强制位章节（下面按规则重新插入到正确位置）。
  const middles = entries.filter(e => e.id !== rules.mandatoryFirst && e.id !== rules.mandatorySecond && !rules.mandatoryTail.includes(e.id));
  // R184: 基础评估章节按标准顺序必含（LLM 漏选 → 用模板 purpose 补插，
  // focus 提示撰写器「以标准评估内容为主、顺带联系科学问题」）。
  const baselineMiddles: DshOutlineEntry[] = [];
  for (const id of baseline) {
    const found = middles.find(e => e.id === id);
    if (found) { baselineMiddles.push(found); continue; }
    const tmpl = getSection(id);
    if (!tmpl) continue;
    baselineMiddles.push({
      id,
      title: tmpl.titleZh,
      focus: `${tmpl.purpose}（标准评估章节：完整覆盖常规评估内容，与科学问题自然相关处顺带联系，不因问题聚焦而收窄本章范围）`.slice(0, 300),
    });
  }
  // R184: 问题深挖章节 = LLM 选择中超出基础集合的部分（保持 LLM 给出的顺序）。
  const extras = middles.filter(e => !baseline.includes(e.id));
  // clamp：4 强制位 + 基础章节 + 深挖章节 ≤ totalMax。
  const maxExtras = Math.max(0, rules.totalMax - 4 - baselineMiddles.length);
  const allMiddles = [...baselineMiddles, ...clippedFocus(extras.slice(0, maxExtras))];

  const first = getSection(rules.mandatoryFirst)!;
  const second = getSection(rules.mandatorySecond)!;
  const result: DshOutlineEntry[] = [
    { id: first.id, title: first.titleZh, focus: first.purpose },
    { id: second.id, title: second.titleZh, focus: second.purpose },
    ...allMiddles,
  ];
  for (const tid of rules.mandatoryTail) {
    const t = getSection(tid)!;
    result.push({ id: t.id, title: t.titleZh, focus: t.purpose });
  }
  return result;
}

function clippedFocus(list: DshOutlineEntry[]): DshOutlineEntry[] {
  return list.map(e => ({ ...e, focus: e.focus.slice(0, 300) }));
}

// ─── R183: SkillEvaluationReport 三级写入 ──────────────────────────────────

/**
 * R183: 提取 Prisma 错误中真正的原因。
 *
 * Prisma 的调用错误形如
 *   "Invalid `db.x.create()` invocation in <文件路径:行:列>\n\n<真正原因>"
 * 旧代码 slice(0,120) 恰好把原因截断在文件路径处（Windows 绝对路径
 * 很长），SSE 日志里只剩无用的 invocation 头。这里取首个空行之后的部分
 * （即原因正文），并附加 Prisma 错误码（P2021 缺表 / P2022 缺列等）。
 */
function prismaErrReason(err: unknown): string {
  const e = err as { message?: unknown; code?: unknown } | null;
  if (!e) return 'unknown';
  const msg = String(e.message ?? '');
  const parts = msg.split(/\n\s*\n/);
  const body = parts.length > 1 ? parts.slice(1).join('\n\n').trim() : msg;
  const code = typeof e.code === 'string' && e.code ? `[${e.code}] ` : '';
  const out = `${code}${body || msg || 'unknown'}`.replace(/\s+/g, ' ').trim();
  return out.slice(0, 240) || 'unknown';
}

/**
 * R183: DSH 报告记录三级写入。
 *
 * 用户现场报告 `Invalid db.skillEvaluationReport.create() invocation`
 * （MiniMax-M3 完整跑完 4 章后落库失败）。两类根因：
 *   A. stale Prisma client —— client delegate 由 schema 生成，若运行中的
 *      client 生成于 R179 之前，则不认识 mode/outline/figures 三个新参数，
 *      客户端校验直接抛 Unknown argument（写库前就失败，schema-compat
 *      救不了）；
 *   B. 库表缺列/缺表（P2021/P2022）—— 运行前 compat 未跑到或失败。
 *
 * 三级策略：
 *   ① Prisma create（常规路径，client 与库都健康时零开销）
 *   ② applySchemaCompat 自愈（缺表 CREATE / 缺列 ALTER）后重试一次
 *      （治 B；run-dsh 路由启动时已跑过一次，这里兜重复/失败的场景）
 *   ③ raw SQL INSERT —— 完全绕过 client delegate（治 A；与经典管线
 *      SkillRunRecord 的 raw SQL 写入同一模式与理由，见
 *      api/evaluations/run/route.ts 的注释）
 */
async function persistDshReportRecord(
  row: {
    uniprotId: string;
    proteinName: string;
    overallScore: number;
    directPdbCount: number;
    coverage: number;
    report: string;
    llmOk: boolean;
    llmProvider: string;
    llmModel: string;
    llmDurationMs: number;
    outlineJson: string;
    figuresJson: string;
  },
  warn: (msg: string) => void,
): Promise<boolean> {
  const data = {
    uniprotId: row.uniprotId,
    proteinName: row.proteinName,
    overallScore: row.overallScore,
    directPdbCount: row.directPdbCount,
    coverage: row.coverage,
    report: row.report,
    llmOk: row.llmOk,
    llmProvider: row.llmProvider,
    llmModel: row.llmModel,
    llmDurationMs: row.llmDurationMs,
    mode: 'dsh' as const,
    outline: row.outlineJson,
    figures: row.figuresJson,
  };
  // ① 常规路径。
  try {
    await db.skillEvaluationReport.create({ data });
    return true;
  } catch (err: any) {
    warn(`SkillEvaluationReport Prisma 写入失败：${prismaErrReason(err)}`);
  }
  // ② schema-compat 自愈（缺表 CREATE / 缺列 ALTER）后重试一次。
  try {
    const compat = await applySchemaCompat(getActiveDbFsPath());
    if (!compat.ok) warn(`schema-compat 自愈未完成：${compat.error ?? 'unknown'}`);
  } catch (err: any) {
    warn(`schema-compat 自愈异常：${err?.message?.slice(0, 120) ?? 'unknown'}`);
  }
  try {
    await db.skillEvaluationReport.create({ data });
    warn('schema-compat 自愈后重试写入成功');
    return true;
  } catch {
    // 与 ① 同因（stale client 的客户端校验错误在重试中必然复现）——
    // 直接转 ③ raw SQL 兜底。
  }
  // ③ raw SQL：绕过 stale client delegate（经典管线 SkillRunRecord 同款）。
  try {
    const id = `dsh_${row.uniprotId}_${Date.now()}`;
    await db.$executeRaw`INSERT INTO SkillEvaluationReport (id, uniprotId, proteinName, overallScore, directPdbCount, coverage, report, llmOk, llmProvider, llmModel, llmDurationMs, mode, outline, figures, createdAt) VALUES (${id}, ${row.uniprotId}, ${row.proteinName}, ${row.overallScore}, ${row.directPdbCount}, ${row.coverage}, ${row.report}, ${row.llmOk ? 1 : 0}, ${row.llmProvider || null}, ${row.llmModel || null}, ${row.llmDurationMs}, ${'dsh'}, ${row.outlineJson}, ${row.figuresJson}, CURRENT_TIMESTAMP)`;
    warn('已通过 raw SQL 兜底写入 SkillEvaluationReport（当前 Prisma client 可能是旧版生成物，建议重跑 prisma generate）');
    return true;
  } catch (err: any) {
    warn(`SkillEvaluationReport raw SQL 兜底失败：${prismaErrReason(err)}`);
    return false;
  }
}


// ─── 主流程 ─────────────────────────────────────────────────────────────────

export async function runDshEvaluation(params: {
  uniprot: string;
  question: string;
  opts?: CollectOpts;
  llm?: LlmConfig;
  emit: (e: SseEvent) => void;
  signal?: AbortSignal;
}): Promise<DshRunResult> {
  const { uniprot, question, emit, signal } = params;
  const opts = params.opts ?? {};
  const t0 = Date.now();
  const sessionId = `dsh-${uniprot}-${Date.now()}`;
  const llmCfg: LlmConfig = { ...(params.llm || {}), sessionId };

  let llmProvider = '';
  let llmModel = '';
  let llmTotalMs = 0;

  // ── Phase A: 数据收集（→ 56%）─────────────────────────────────────────
  emit({ stage: 'collect', level: 'info', message: `DSH 模式启动 · 数据收集（UniProt → RCSB → BLAST → PubMed）`, progress: 3 });
  const collected = await collectEvaluationData(uniprot, opts, emit);
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
  const c = collected;

  // ── Phase B: 相关性分析（58-62%）──────────────────────────────────────
  emit({ stage: 'relevance', level: 'info', message: `Agent 分析全部数据源与科学问题的相关性…`, progress: 58 });
  const compact = [
    `科学问题：${question}`,
    ``,
    `## UniProt 元数据`,
    `${c.uniprotInfo.proteinName}（${c.uniprotInfo.uniprotId} / ${c.uniprotInfo.entryName}）· 基因 ${c.uniprotInfo.geneNames} · ${c.uniprotInfo.organism} · ${c.uniprotInfo.sequenceLength} aa`,
    ``,
    `## PDB 结构（top 10 / ${c.pdbRows.length} 条直接命中）`,
    c.pdbRows.slice(0, 10).map(e => `- ${e.pdbId} · ${e.method || '?'} · ${e.resolution != null ? e.resolution.toFixed(1) + 'Å' : '?'} · 配体: ${e.ligands || '无'} · ${(e.title || '').slice(0, 60)}`).join('\n') || '（无）',
    ``,
    `## BLAST 同源（top 10 / ${c.blastRows.length} 条）`,
    c.blastRows.slice(0, 10).map(h => `- ${h.pdbId || h.uniprotRef} · identity ${h.identity?.toFixed(1) ?? '?'}% · e=${h.evalue} · ${(h.description || '').slice(0, 50)}`).join('\n') || '（BLAST 已跳过）',
    ``,
    `## 文献（top 10 / ${c.literature.length} 篇，IF 降序）`,
    c.literature.slice(0, 10).map(l => `- PMID ${l.pmid} · ${l.journal}${l.journalIf != null ? ` (IF ${l.journalIf.toFixed(1)})` : ''} · ${l.title}`).join('\n') || '（无）',
    ``,
    `## 评分`,
    `X-ray ${c.scores.xray.score}/10 (${c.scores.xray.structures}条) · Cryo-EM ${c.scores.cryoem.score}/10 (${c.scores.cryoem.structures}条) · NMR ${c.scores.nmr.score}/10 (${c.scores.nmr.structures}条) · Overall ${c.scores.overall.score}/10 · 覆盖率 ${c.coverage}%`,
  ].join('\n');

  const relevanceSystem = `你是一位严谨的生物信息数据分析师。请基于给定的真实数据，分析与科学问题相关的证据。只输出 JSON，不要其他文字。`;
  const relevanceUser = `${compact}

请输出 JSON（字段如下）：
{
  "questionRestated": "用一句话重述科学问题",
  "findings": [{"source": "uniprot|rcsb|blast|literature|scores", "relevance": "high|medium|low", "note": "具体发现，引用数据中的具体数字/ID"}],
  "keyInsights": ["关键洞察 1", "关键洞察 2"],
  "dataGaps": ["数据缺口 1", "数据缺口 2"],
  "figureQueries": [{"sectionId": "章节id", "query": "英文图片搜索查询，如 EGFR signaling pathway diagram"}]
}

要求：
- findings 逐源给出（uniprot/rcsb/blast/literature/scores 各 1-2 条）
- figureQueries 0-6 条：每个确有配图价值的章节最多 1 条（原理图/通路图/机制图对该章确有帮助时才给，宁缺毋滥）；query 用英文（图片召回更好）；sectionId 必须是：${SECTION_LIBRARY.filter(s => !s.fixed && s.id !== 'question_focus').map(s => s.id).join(' / ')}`;

  // R183: maxChars 2500→4000 —— 推理模型 think 块已在 generateText 剥离，
  // 但 findings 等字段本身也可能超过 2500（12 条发现 × ~150 字）。
  const relevanceRun = await generateJson(relevanceSystem, relevanceUser, { maxChars: 4000, llm: llmCfg, signal });
  llmTotalMs += relevanceRun.durationMs;
  if (relevanceRun.provider) llmProvider = relevanceRun.provider;
  if (relevanceRun.model) llmModel = relevanceRun.model;

  let relevance: DshRelevance | null = null;
  let figureQueries: Array<{ sectionId: string; query: string }> = [];
  if (relevanceRun.parsed) {
    relevance = {
      questionRestated: String(relevanceRun.parsed.questionRestated || ''),
      findings: Array.isArray(relevanceRun.parsed.findings)
        ? (relevanceRun.parsed.findings as any[]).filter(f => f && typeof f === 'object').slice(0, 12).map(f => ({
            source: String(f.source || ''), relevance: String(f.relevance || ''), note: String(f.note || '').slice(0, 300),
          }))
        : [],
      keyInsights: Array.isArray(relevanceRun.parsed.keyInsights) ? (relevanceRun.parsed.keyInsights as any[]).map(String).slice(0, 8) : [],
      dataGaps: Array.isArray(relevanceRun.parsed.dataGaps) ? (relevanceRun.parsed.dataGaps as any[]).map(String).slice(0, 8) : [],
    };
    if (Array.isArray(relevanceRun.parsed.figureQueries)) {
      // R184: 2→8 —— 每个有配图价值的章节各一条（searchWebFigures 内部再
      // 按 query 去重；数量实际由相关性分析的质量决定，不再硬性限制 2 条）。
      figureQueries = (relevanceRun.parsed.figureQueries as any[])
        .filter(q => q && typeof q === 'object' && q.query && q.sectionId)
        .slice(0, 8)
        .map(q => ({ sectionId: String(q.sectionId), query: String(q.query).slice(0, 120) }));
    }
    emit({
      stage: 'relevance',
      level: 'success',
      message: `✓ 相关性分析完成：${(relevance.findings || []).length} 条发现 · ${(relevance.keyInsights || []).length} 个洞察 · ${(relevance.dataGaps || []).length} 个数据缺口`,
      progress: 62,
      dshRelevance: relevance,
    });
  } else {
    emit({ stage: 'relevance', level: 'warn', message: `⚠ 相关性分析 JSON 解析失败（用问题本身作为 relevance 上下文继续）`, progress: 62 });
    relevance = { questionRestated: question, findings: [], keyInsights: [], dataGaps: [] };
  }
  // 此处 relevance 一定非空（两个分支都赋值）。
  const rel: DshRelevance = relevance;
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');

  // ── Phase C: 大纲规划（62-64%）────────────────────────────────────────
  // R184: 基础评估章节（数据驱动）必含 + 问题深挖章节叠加 —— 聚焦的科学
  // 问题不再挤掉基本评估内容，只是「额外重点讨论」。
  const dataInfo: OutlineDataInfo = {
    hasPdb: (c.pdbRows?.length ?? 0) > 0,
    hasBlast: !c.skippedBlast && (c.blastRows?.length ?? 0) > 0,
    hasLiterature: (c.literature?.length ?? 0) > 0,
  };
  const rules = outlineRules(dataInfo);
  const baselineListing = rules.baselineIds
    .map(id => getSection(id))
    .filter((s): s is SectionTemplate => !!s)
    .map(s => `- ${s.id} | ${s.titleZh} | ${s.purpose}`)
    .join('\n');
  emit({ stage: 'outline', level: 'info', message: `规划报告大纲（基础评估章节必含 + 问题深挖章节，共 ${rules.totalMin}-${rules.totalMax} 章）…`, progress: 62 });
  const libraryListing = SECTION_LIBRARY.map(s => `- ${s.id} | ${s.titleZh} | ${s.purpose}`).join('\n');
  const outlineSystem = `你是结构生物学报告的大纲规划器。必须遵守的格式稳定性规则：
${rules.formatStability.map((r, i) => `${i + 1}. ${r}`).join('\n')}

可用章节库（id | 中文标题 | 用途）：
${libraryListing}

硬性约束：
- 总章节数 ${rules.totalMin}-${rules.totalMax}
- 第 1 章固定 summary，第 2 章固定 question_focus，倒数第 2 章 references，最后 conclusion
- 基础评估章节（下方「必含基础章节」清单的全部）必须包含——无论科学问题多聚焦，功能背景/PDB 资源/结构质量/成药性等标准评估内容都不可省略，只在自然相关处顺带联系问题
- 在基础章节之外，从章节库其余 optional id 中按与科学问题的相关性额外选 ${rules.questionExtraMin}-${rules.questionExtraMax} 个「问题深挖」章节，重点展开问题本身
- 排列顺序：基础评估章节在前，问题深挖章节在后
- 同一章节不得重复；只能使用上面的章节 id，不得发明新 id
- 只输出 JSON：{"sections": [{"id": "章节id", "focus": "本章要回答什么/用哪些数据，1-2 句"}]}`;
  const outlineUser = `科学问题：${question}

相关性分析：
- 问题重述：${rel.questionRestated}
- 关键发现：${(rel.findings || []).map(f => `[${f.source}/${f.relevance}] ${f.note}`).join('；').slice(0, 800) || '（无）'}
- 数据缺口：${(rel.dataGaps || []).join('；') || '（无）'}

数据清单：UniProt 元数据 ✓、PDB 结构 ${c.pdbRows.length} 条、BLAST 同源 ${c.blastRows.length} 条（${c.skippedBlast ? '已跳过' : '已运行'}）、文献 ${c.literature.length} 篇、评分 Overall ${c.scores.overall.score}/10。

本次必含的基础评估章节（数据驱动，不可省略；本地校验会自动补齐遗漏）：
${baselineListing}
${figureQueries.length > 0 ? `\n配图建议（相关性分析认为这些章节放一张原理图/通路图确有帮助，规划时可优先考虑）：${figureQueries.map(q => `${q.sectionId}（${q.query}）`).join('、')}` : ''}

请规划报告大纲（question_focus 固定第 2 位、基础章节必含；你重点决定问题深挖章节的选择与顺序，并为每章写一句 focus）。`;

  // R184: maxChars 2400→3600 —— 大纲最多 14 章，JSON 变长。
  const outlineRun = await generateJson(outlineSystem, outlineUser, { maxChars: 3600, llm: llmCfg, signal });
  llmTotalMs += outlineRun.durationMs;
  if (outlineRun.provider) llmProvider = outlineRun.provider;
  if (outlineRun.model) llmModel = outlineRun.model;

  let outline = repairOutline(outlineRun.parsed, dataInfo);
  if (outlineRun.parsed) {
    emit({
      stage: 'outline',
      level: 'success',
      message: `✓ 大纲确定：${outline.length} 章（基础 ${rules.baselineIds.length} 章 + 问题深挖 ${Math.max(0, outline.length - 4 - rules.baselineIds.length)} 章；${outline.map(o => o.title).join(' → ')}）`,
      progress: 64,
      dshOutline: { sections: outline, total: outline.length },
    });
  } else {
    // JSON 完全失败 → 数据驱动降级大纲（R184：基础章节自动补齐 + 按问题
    // 文本关键词猜测问题深挖章节，双 JSON 失败时仍保有完整评估内容与
    // 问题视角；repairOutline 负责 4 个强制位与 clamp）。
    outline = repairOutline({
      sections: guessQuestionSections(question).map(id => ({ id })),
    }, dataInfo);
    emit({
      stage: 'outline',
      level: 'warn',
      message: `⚠ 大纲 JSON 解析失败，使用数据驱动默认大纲（${outline.length} 章：${outline.map(o => o.title).join(' → ')}）`,
      progress: 64,
      dshOutline: { sections: outline, total: outline.length },
    });
  }
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');

  // ── Phase D: 配图（64-72%）────────────────────────────────────────────
  const sectionIds = outline.map(o => o.id);
  const figures: ReportFigure[] = [];
  try {
    // RCSB 结构图（图事件由 wrapper 注入 64-66% 区间进度）。
    const rcsbFigs = await collectRcsbFigures(c.pdbRows, (e) => {
      emit({ ...e, progress: e.progress ?? 65 });
    }, sectionIds);
    figures.push(...rcsbFigs);
  } catch (err: any) {
    emit({ stage: 'figure-rcsb', level: 'warn', message: `⚠ RCSB 配图收集失败（跳过）：${err?.message ?? 'unknown'}`, progress: 65 });
  }
  try {
    // web 原理图/通路图（VLM 校验；图事件 66-72% 区间，逐步递增）。
    let webStep = 0;
    const webFigs = await searchWebFigures(figureQueries, (e) => {
      webStep++;
      emit({ ...e, progress: e.progress ?? Math.min(72, 66 + webStep) });
    });
    figures.push(...webFigs);
  } catch (err: any) {
    emit({ stage: 'figure-web', level: 'warn', message: `⚠ web 配图搜索失败（宁缺毋滥，跳过）：${err?.message ?? 'unknown'}`, progress: 71 });
  }
  emit({
    stage: 'figures',
    level: figures.length > 0 ? 'success' : 'info',
    message: figures.length > 0
      ? `✓ 配图就绪：${figures.filter(f => f.status === 'verified').length} 张已验证（RCSB ${figures.filter(f => f.kind === 'rcsb').length} + web ${figures.filter(f => f.kind === 'web').length}）`
      : `本次无配图（宁缺毋滥）`,
    progress: 72,
  });
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');

  // ── Phase E: 逐章撰写（72-96%）────────────────────────────────────────
  const chapterSystem = `你是结构生物学领域的资深研究员，为一份蛋白靶点评估报告撰写某一章节（DSH 模式，逐章生成）。

全局格式约束（必须逐条遵守）：
1. 章节标题：第一行必须是该章的 H2 标题，精确使用指定的中文标题（一字不差），如 \`## 执行摘要\`
2. 开头 1-2 句小结：直接给出本章核心结论
3. 正文字数：${250}-${500} 字（references 参考文献章除外，按其列表格式输出）
4. 子节：可用 §N.M 三级小节（\`### §N.1 ...\`），N 为本章在报告中的章序号
5. 禁止 emoji：标题、表格、列表中均不使用
6. 只使用给定数据，不得编造：未在数据上下文出现的 PDB ID / PMID / 数字一律不写
7. 引用真实 ID：结论尽量引用具体 PDB ID / PMID / 分辨率 / IF / Identity%
8. 缺失数据写"暂无可靠数据"，不要假装有信息
9. 中文输出（专有名词保留英文）`;

  const chapters: DshChapterResult[] = [];
  const chapterTotal = outline.length;
  for (let i = 0; i < outline.length; i++) {
    const entry = outline[i];
    const tmpl = getSection(entry.id)!;
    const chapterIndex = i + 1;
    const pct = 72 + Math.round((i / Math.max(1, chapterTotal)) * 24);

    // R179 (Task 2-a): stage `chapter-<id>`（spec）+ `chapter` 字段（客户端
    // StreamEvent.chapter 的同款契约，经典管线也用它携带章节 key）。
    emit({
      stage: `chapter-${entry.id}`,
      level: 'info',
      message: `撰写第 ${chapterIndex}/${chapterTotal} 章：${tmpl.titleZh}`,
      progress: pct,
      chapter: entry.id,
      chapterIndex,
      chapterTotal,
      chapterId: entry.id,
      chapterTitle: tmpl.titleZh,
    });

    // 该章可用配图（kind 任意，status verified）。R184: 正文嵌入建议最多
    // 取 3 张（其余统一进报告末尾配图附录，避免配图增多后把章节 prompt
    // 撑爆 / 正文变成图片堆砌）。
    const figsForSection = figures.filter(f => f.status === 'verified' && f.sectionId === entry.id);
    const figsToEmbed = figsForSection.slice(0, 3);
    const figuresNote = figsToEmbed.length > 0
      ? `\n\n## 本章可用配图（从中选 1-3 张嵌入正文；其余配图会统一出现在报告末尾的配图附录，无需重复嵌入）\n${figsToEmbed.map(f => `- ${f.url} ｜ ${f.caption}`).join('\n')}\n\n嵌入格式（单独一行，放在本章合适位置）：\n${figsToEmbed.map(f => `![${f.caption}](${f.url})`).join('\n')}`
      : '';

    // R184: 基础评估章节与问题深挖章节的科学问题定位不同 ——
    //   基础章节：以标准评估内容为主体，问题仅作背景参考（防聚焦收窄，
    //   这正是「即使写了聚焦问题也要包含基本评估内容」的写作侧约束）；
    //   深挖章节（含 question_focus / summary / conclusion 等强制位）：
    //   重点服务科学问题。
    const isBaseline = rules.baselineIds.includes(entry.id);
    const questionBlock = isBaseline
      ? `## 科学问题（背景参考）\n${question}\n\n说明：本章是标准评估章节 —— 以本章内容要求为主体、完整覆盖常规评估口径；与上述问题自然相关处可顺带联系，但不要让问题聚焦收窄或替换本章的标准评估内容。`
      : `## 科学问题（本章须重点服务于该问题）\n${question}`;

    const userPrompt = `# 当前任务：撰写第 ${chapterIndex}/${chapterTotal} 章「${tmpl.titleZh}」

${buildFilteredContext(c, tmpl.dataHints)}

---

${questionBlock}

## 本章焦点（大纲规划器指定）
${entry.focus}

## 本章内容要求
${tmpl.contentSpec}
${figuresNote}

---

请输出本章 Markdown（第一行必须是：\`## ${tmpl.titleZh}\`，前后不要空行；之后是正文）。`;

    // 生成 + 校验 + ≤2 次重试。
    let ok = false;
    let content = '';
    let lastErr = '';
    let attempts = 0;
    const chapterT0 = Date.now();
    for (let attempt = 0; attempt <= 2 && !ok; attempt++) {
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
      attempts++;
      const prompt = attempt === 0
        ? userPrompt
        : `${userPrompt}\n\n【重试】上次输出未通过校验（${lastErr || '格式不符'}）。请严格输出：第一行为 \`## ${tmpl.titleZh}\`，正文 ≥150 字符，不得包含失败占位符。`;
      const r = await generateText(chapterSystem, prompt, { maxChars: 6000, llm: llmCfg, signal });
      llmTotalMs += r.durationMs;
      if (r.provider) llmProvider = r.provider;
      if (r.model) llmModel = r.model;
      if (!r.ok) {
        lastErr = r.error || 'LLM 调用失败';
        continue;
      }
      const v = validateDshChapter(tmpl.titleZh, r.content);
      if (v.ok) {
        content = normalizeDshChapter(r.content, tmpl.titleZh);
        ok = true;
      } else {
        lastErr = v.reason || '校验失败';
      }
    }

    // 救援 pass：简化 prompt（最小上下文，只要标题+基础要求）。
    if (!ok) {
      try {
        const rescuePrompt = `请为蛋白靶点评估报告撰写章节「${tmpl.titleZh}」。

靶点：${c.uniprotInfo.proteinName}（${c.uniprotInfo.uniprotId}，${c.uniprotInfo.organism}）
科学问题：${question}
本章要求：${tmpl.contentSpec}
可用数据要点：直接 PDB ${c.directPdbCount} 条、BLAST ${c.blastHitCount} 条、文献 ${c.literature.length} 篇、Overall 评分 ${c.scores.overall.score}/10。

第一行必须是：\`## ${tmpl.titleZh}\`。正文中文 250-500 字。只输出本章内容。`;
        const r = await generateText(chapterSystem, rescuePrompt, { maxChars: 6000, llm: llmCfg, signal });
        llmTotalMs += r.durationMs;
        if (r.provider) llmProvider = r.provider;
        if (r.model) llmModel = r.model;
        if (r.ok) {
          const v = validateDshChapter(tmpl.titleZh, r.content);
          if (v.ok) {
            content = normalizeDshChapter(r.content, tmpl.titleZh);
            ok = true;
          } else {
            lastErr = `rescue: ${v.reason}`;
          }
        }
      } catch {
        // 救援也失败 —— 记录失败章节，不中止整体。
      }
    }

    chapters.push({
      id: entry.id,
      title: tmpl.titleZh,
      ok,
      content: ok ? content : `_(本章生成失败：${lastErr || 'LLM 调用失败'})_`,
      attempts,
      error: ok ? undefined : lastErr,
    });
    // R179 (Task 2-a): done 事件的 stage 统一为 `chapter_done`（spec + 经典
    // 管线同名约定），章节 id 经 `chapter`/`chapterId` 字段携带。
    emit({
      stage: 'chapter_done',
      level: ok ? 'success' : 'warn',
      message: ok
        ? `✓ 第 ${chapterIndex}/${chapterTotal} 章完成（${content.length} chars）`
        : `✗ 第 ${chapterIndex}/${chapterTotal} 章失败：${lastErr}`,
      progress: 72 + Math.round(((i + 1) / Math.max(1, chapterTotal)) * 24),
      chapter: entry.id,
      chapterIndex,
      chapterTotal,
      chapterId: entry.id,
      chapterTitle: tmpl.titleZh,
      chapterContent: ok ? content : '',
      ...(ok ? {} : { chapterError: lastErr || 'LLM 调用失败' }),
      chapterDurationMs: Date.now() - chapterT0,
    });
  }
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');

  // ── Phase F: 组装 + 持久化（96-100%）─────────────────────────────────
  emit({ stage: 'assemble', level: 'info', message: `组装 DSH 报告并持久化…`, progress: 96 });
  const verifiedFigures = figures.filter(f => f.status === 'verified');
  const chaptersOk = chapters.filter(ch => ch.ok).length;
  const chaptersFailed = chapters.length - chaptersOk;

  const gallery = verifiedFigures.length > 0
    ? `\n\n## 附：报告配图\n\n${verifiedFigures.map(f => `![${f.caption}](${f.url})\n\n- ${f.caption}（来源：${f.source || (f.kind === 'rcsb' ? 'RCSB PDB' : 'web image search')}）`).join('\n\n')}`
    : '';
  const header = `# ${c.uniprotInfo.proteinName}（${uniprot}）靶点评估报告 — DSH 模式\n\n> 科学问题：${question}\n\n`;
  const rawReport = header + chapters.map(ch => ch.content).join('\n\n') + gallery;
  const finalReport = sanitizeReport(rawReport);
  const reportOk = chaptersOk > 0;

  // 持久化 1/2：SkillEvaluationReport。R183 三级写入（Prisma → compat
  // 自愈重试 → raw SQL 兜底）——治 stale client 的 Unknown argument 与
  // 缺表/缺列两类 Invalid invocation（见 persistDshReportRecord 注释）。
  let dbSaved = false;
  const persistOk = await persistDshReportRecord(
    {
      uniprotId: uniprot,
      proteinName: c.uniprotInfo.proteinName,
      overallScore: c.scores.overall.score,
      directPdbCount: c.directPdbCount,
      coverage: c.coverage,
      report: finalReport,
      llmOk: reportOk,
      llmProvider,
      llmModel,
      llmDurationMs: llmTotalMs,
      outlineJson: JSON.stringify(outline),
      figuresJson: JSON.stringify(verifiedFigures),
    },
    (msg) => emit({ stage: 'write-db', level: 'warn', message: msg, progress: 97 }),
  );
  if (persistOk) {
    dbSaved = true;
  } else {
    emit({ stage: 'write-db', level: 'warn', message: 'SkillEvaluationReport 三级写入均失败（报告内容仍随 done 帧交付并回写 Evaluation）', progress: 97 });
  }

  // 持久化 2/2：Evaluation.report + provenance-lite（raw SQL，schema-drift 免疫）。
  try {
    const provenanceLite = JSON.stringify({
      mode: 'dsh',
      question,
      sessionId,
      phases: {
        collect: { directPdbCount: c.directPdbCount, blastHitCount: c.blastHitCount, literatureCount: c.literature.length },
        relevance: { ok: !!relevanceRun.parsed, findings: relevance?.findings?.length ?? 0 },
        outline: { total: outline.length, ids: outline.map(o => o.id) },
        figures: { verified: verifiedFigures.length },
        chapters: { ok: chaptersOk, failed: chaptersFailed },
      },
      llm: { provider: llmProvider, model: llmModel, durationMs: llmTotalMs },
      generatedAt: new Date().toISOString(),
    });
    await db.$executeRaw`UPDATE Evaluation SET report = ${reportOk ? finalReport : null}, provenance = ${provenanceLite}, updatedAt = CURRENT_TIMESTAMP WHERE uniprotId = ${uniprot}`;
    dbSaved = true;
  } catch (err: any) {
    emit({ stage: 'write-db', level: 'warn', message: `Evaluation 报告回写失败：${prismaErrReason(err)}`, progress: 97 });
  }

  emit({
    stage: 'done',
    level: reportOk ? 'success' : 'error',
    message: reportOk
      ? `✓ DSH 报告完成：${chaptersOk}/${chapters.length} 章 · ${finalReport.length} chars · 配图 ${verifiedFigures.length} 张`
      : `✗ 全部章节生成失败`,
    progress: 100,
  });

  return {
    mode: 'dsh',
    uniprot,
    uniprotInfo: c.uniprotInfo,
    question,
    relevance,
    outline,
    figures,
    report: {
      ok: reportOk,
      provider: llmProvider,
      model: llmModel,
      durationMs: llmTotalMs,
      contentChars: finalReport.length,
      content: finalReport,
      chapters,
      chaptersOk,
      chaptersFailed,
      error: reportOk ? undefined : `${chaptersFailed} chapter(s) failed`,
    },
    directPdbCount: c.directPdbCount,
    blastHitCount: c.blastHitCount,
    coverage: c.coverage,
    scores: c.scores,
    dbSaved,
    durationMs: Date.now() - t0,
  };
}
