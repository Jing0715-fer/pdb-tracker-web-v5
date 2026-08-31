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
import { Prisma } from '@prisma/client';
import { db, getActiveDbFsPath } from '@/lib/db';
import { applySchemaCompat } from '@/lib/schema-compat';
import { collectEvaluationData, type CollectOpts, type CollectResult, type LiteratureRow } from './collect';
import { SECTION_LIBRARY, getSection, outlineRules, type SectionTemplate, type DataHint, type OutlineDataInfo } from './section-library';
import { collectRcsbFigures, searchWebFigures, figureImageMarkdown, repairFigureUrls, type ReportFigure } from './figures';

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
  /** R189: 重点数据挑选 —— 相关性 agent 从全量数据中点名必须充分讨论的
   * 重点结构（PDB ID + 一句话理由），逐章注入深挖章节 prompt。 */
  keyPicks?: Array<{ pdbId: string; why: string }>;
  /** R189: 重点文献 PMID（与 keyPicks 同理，限真实存在于文献数据）。 */
  keyLiterature?: string[];
}

export interface DshChapterResult {
  id: string;
  title: string;
  ok: boolean;
  content: string;
  attempts?: number;
  error?: string;
  /** R189: 审查环 —— 本章是否经过审稿 agent 审查。 */
  reviewed?: boolean;
  /** R189: 审查后是否触发过重写（最终内容为重写版）。 */
  rewritten?: boolean;
  /** R192: 本章实际经历的审稿轮数（含通过的那轮；0 = 未进入审查环）。 */
  reviewRounds?: number;
  /** R192: 确定性生成（未经 LLM —— 目前仅 references 章）。 */
  deterministic?: boolean;
  /** R195: 审稿环达到轮次上限仍未通过（保留当前版继续）—— 复审锚效果
   * 度量用（provenance.review.trajectory 会汇总）。 */
  reviewCapped?: boolean;
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
  // R196: 整体优先（含顶层 JSON 数组）—— 旧版只扫 { 平衡块，顶层数组
  // 会被截断成首个元素（[{a},{b}] → {a} 静默丢数据）或解析失败。
  const direct = parseJsonLoose(s);
  if (direct !== null) return direct;
  // 代码围栏：任意位置、可多段（```json … ``` / ``` … ```），围栏内容优先。
  const fenced = Array.from(s.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/gi), (m) => m[1]);
  for (const cand of [...fenced, s]) {
    const whole = parseJsonLoose(cand); // R196: 围栏内的完整对象/数组整块优先
    if (whole !== null) return whole;
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
): Promise<{ parsed: any | null; provider: string; model: string; durationMs: number; error?: string }> {
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
      // 两次调用都成功但 JSON 均解析失败。
      return { parsed: null, provider: r2.provider, model: r2.model, durationMs: total2, error: 'json-parse' };
    }
    // 第二次调用失败（首次成功后限流窗口可能已打开）—— 暴露原始错误。
    return { parsed: null, provider: r1.provider, model: r1.model, durationMs: total2, error: r2.error || 'json-parse' };
  }
  // R193: 首次调用即失败 —— 暴露原始错误（多为 429/5xx 瞬态，E2E 实测
  // 限流被误报为「JSON 解析失败」且未计入配额压力计数器，导致降级
  // 机制对该场景失效）。调用方可据此区分「LLM 调用失败」与「解析失败」
  // 并喂给 noteTransient。
  return { parsed: null, provider: r1.provider, model: r1.model, durationMs: totalMs, error: r1.error || 'llm-failed' };
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

// ─── R192: 参考文献章确定性生成 ─────────────────────────────────────────────

/**
 * R192: references 章从真实文献数据直接构建（零 LLM、零幻觉、零配额、
 * 零延迟）。此前该章由 LLM 从文献表「转抄」，存在漏抄/错抄 PMID 风险
 * （R191 还需专门把它排除出审稿环，防止审稿人要求列表章改成讨论章）。
 *
 * 排序：keyLiterature（relevance agent 点名的重点文献，保持点名顺序）
 * 置顶加 ★ 标记，其余按期刊 IF 降序、同年份新者优先；PMID 去重。
 * 纯函数（可单测）：literature 行、重点 PMID 清单 → 完整章节 Markdown。
 */
export function buildDeterministicReferences(
  literature: LiteratureRow[],
  keyLiterature: string[] | undefined,
): string {
  const keySet = new Set((keyLiterature || []).map(String));
  const seen = new Set<string>();
  const rows = (literature || []).filter(l => {
    const k = String(l.pmid);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  if (rows.length === 0) {
    return `## 参考文献

暂无可靠文献数据 —— 本次 PubMed 检索未返回任何记录（可能原因：该靶点文献覆盖稀疏，或检索词与收录库无交集）。本报告的结论均基于 RCSB PDB 结构元数据与 UniProt 功能注释，未引用具体文献；如需文献支撑，建议补充检索策略后重跑评估。`;
  }
  const line = (l: LiteratureRow, star: boolean) =>
    `- PMID ${l.pmid} | ${l.title} — ${l.journal || '未知期刊'}${l.journalIf != null ? ` (IF ${l.journalIf.toFixed(1)})` : ''} (${l.year || '?'})${star ? ' ★' : ''}`;
  // 重点文献按 relevance agent 的点名顺序（重要性序）排列，而非文献表
  // 顺序；点名但不在文献表中的 PMID 直接丢弃（上游已消毒，防御双重保险）。
  const keyed = keySet.size > 0
    ? (keyLiterature || [])
        .map(String)
        .map(pmid => rows.find(l => String(l.pmid) === pmid))
        .filter((l): l is LiteratureRow => !!l)
    : [];
  const rest = rows
    .filter(l => !keySet.has(String(l.pmid)))
    .sort((a, b) =>
      (b.journalIf ?? -1) - (a.journalIf ?? -1)
      || String(b.year || '').localeCompare(String(a.year || '')));
  if (keyed.length > 0 && rest.length > 0) {
    return `## 参考文献

### 与科学问题最相关的文献（相关性分析点名）

${keyed.map(l => line(l, true)).join('\n')}

### 其他文献（按期刊影响因子排序）

${rest.map(l => line(l, false)).join('\n')}`;
  }
  return `## 参考文献

${(keyed.length > 0 ? keyed : rest).map(l => line(l, keyed.length > 0)).join('\n')}`;
}

/** R192: 章节图片维护 —— URL 突变修复（R191）+ 章末确定性补挂（R187）。
 * 逐章环与终审外科修正（Phase E+）共用；返回维护后的正文与自愈统计。 */
function maintainChapterFigures(
  content: string,
  figsToEmbed: ReportFigure[],
  allFigures: ReportFigure[],
): { content: string; fixed: number; removed: number } {
  let out = content;
  let fixed = 0;
  let removed = 0;
  const verified = allFigures.filter(f => f.status === 'verified');
  if (verified.length > 0) {
    const rep = repairFigureUrls(out, verified.map(f => f.url));
    out = rep.content;
    fixed = rep.fixed;
    removed = rep.removed;
  }
  if (figsToEmbed.length > 0) {
    const missing = figsToEmbed.filter(f => !out.includes(f.url));
    if (missing.length > 0) {
      const appendix = missing
        .map(f => `${figureImageMarkdown(f)}\n\n- ${f.caption}（来源：${f.source || (f.kind === 'rcsb' ? 'RCSB PDB' : 'web image search')}）`)
        .join('\n\n');
      out = `${out.trimEnd()}\n\n${appendix}\n`;
    }
  }
  return { content: out, fixed, removed };
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
 * R179 (Task 2-a) / R184 / R189: 大纲校验 + 自动修复：
 *   - 丢弃未知 id / 非法条目；去重
 *   - force-prepend summary；有问题时 force-insert question_focus 于位置 2；
 *     force-append references + conclusion
 *   - R184: 基础评估章节（数据驱动，见 baselineSectionIds）必含 ——
 *     LLM 漏选时按标准顺序补插（聚焦问题不得挤掉基本评估内容）；
 *     基础章节固定排在前面，LLM 选出的问题深挖章节排在其后
 *   - R189: opts.noQuestion —— 空科学问题模式不插 question_focus（基础评估
 *     口径）；extras 仍只来自 LLM raw（无问题时调用方传空 sections）
 *   - clamp 到 totalMax（溢出时从问题深挖章节尾部截断）
 */
export function repairOutline(raw: any, data?: Partial<OutlineDataInfo>, opts?: { noQuestion?: boolean }): DshOutlineEntry[] {
  const rules = outlineRules(data, opts);
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
  // 移除强制位章节（下面按规则重新插入到正确位置；无问题模式 mandatorySecond 为空）。
  const middles = entries.filter(e => e.id !== rules.mandatoryFirst && (!rules.mandatorySecond || e.id !== rules.mandatorySecond) && !rules.mandatoryTail.includes(e.id));
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
  // clamp：固定位（3 或 4）+ 基础章节 + 深挖章节 ≤ totalMax，且深挖数 ≤
  // questionExtraMax（R189：两者独立约束，取 min——曾出现 16-4-5=7 > 上限 6）。
  const fixedCount = rules.mandatorySecond ? 4 : 3;
  const maxExtras = Math.max(0, Math.min(rules.questionExtraMax, rules.totalMax - fixedCount - baselineMiddles.length));
  const allMiddles = [...baselineMiddles, ...clippedFocus(extras.slice(0, maxExtras))];

  const first = getSection(rules.mandatoryFirst)!;
  const result: DshOutlineEntry[] = [
    { id: first.id, title: first.titleZh, focus: first.purpose },
  ];
  if (rules.mandatorySecond) {
    const second = getSection(rules.mandatorySecond)!;
    result.push({ id: second.id, title: second.titleZh, focus: second.purpose });
  }
  result.push(...allMiddles);
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
 * 很长），SSE 日志里只剩无用的 invocation 头。Prisma 6 校验错误还会在
 * invocation 头后嵌入代码帧（行号 + webpack 模块名），真正原因在末段。
 * 这里优先提取原因行（Unknown argument 等），并附加 Prisma 错误码
 * （P2021 缺表 / P2022 缺列等）。
 */
function prismaErrReason(err: unknown): string {
  const e = err as { message?: unknown; code?: unknown } | null;
  if (!e) return 'unknown';
  const msg = String(e.message ?? '');
  const code = typeof e.code === 'string' && e.code ? `[${e.code}] ` : '';
  // R188: Prisma 6 校验错误在 invocation 头之后先嵌【代码帧】（行号 +
  // WEBPACK_IMPORTED_MODULE 名），真正的 "Unknown argument …" 原因在末段。
  // 旧逻辑取首个空行后的正文再 slice(0,240)，恰好截在代码帧上——SSE 日志
  // 只剩 "2761 }; 2762 …" 这类行号噪音。这里优先提取原因行（Unknown
  // argument/field、missing、did not match 等语义锚点），退化为取最后一段。
  const lines = msg.split('\n').map(l => l.trim()).filter(Boolean);
  const reasonIdx = lines.findIndex(l =>
    /Unknown (argument|field|input)/i.test(l)
    || /^Argument [`']/.test(l)
    || /did not match/i.test(l)
    || /^missing/i.test(l)
    || /is missing/i.test(l)
  );
  let body: string;
  if (reasonIdx >= 0) {
    // 原因行 + 紧随的 "Available …" 行（合起来才是完整可读的原因）。
    const next = lines[reasonIdx + 1] || '';
    body = /^Available/i.test(next) ? `${lines[reasonIdx]} ${next}` : lines[reasonIdx];
  } else {
    const parts = msg.split(/\n\s*\n/);
    body = parts.length > 1 ? parts[parts.length - 1].trim() : msg;
  }
  const out = `${code}${body || msg || 'unknown'}`.replace(/\s+/g, ' ').trim();
  return out.slice(0, 240) || 'unknown';
}

/**
 * R190: 运行时检测本地 Prisma client 是否认识指定 model 的字段
 * （stale client 预检测）。
 *
 * 生成物把 DMMF（全部 model 的字段清单）内嵌在 Prisma.dmmf 里；旧版
 * client（R179 之前生成）的 SkillEvaluationReport 没有 mode/outline/
 * figures。据此可在写库前就识别 stale，把注定失败的 ①② 直接跳到 ③
 * raw SQL，避免一条吓人的「Prisma 写入失败」warn（用户现场 19:05 /
 * 21:36 两次询问该 warn「怎么回事」——实际数据全程无损）。检测本身
 * 失败/不可用时返回 true（按健康处理，保持原有 ①→②→③ 流程）。
 */
export function prismaClientKnows(model: string, fields: string[]): boolean {
  try {
    const models = (
      Prisma as unknown as {
        dmmf?: { datamodel?: { models?: Array<{ name?: string; fields?: Array<{ name?: string }> }> } };
      }
    ).dmmf?.datamodel?.models;
    return modelsKnowFields(models, model, fields);
  } catch {
    return true;
  }
}

/** R190: prismaClientKnows 的纯逻辑部分（独立导出便于单测——Prisma.dmmf
 * 是只读命名空间属性，测试里无法 monkey-patch，只能从这一层注入假 DMMF）。 */
export function modelsKnowFields(
  models: Array<{ name?: string; fields?: Array<{ name?: string }> }> | undefined | null,
  model: string,
  fields: string[],
): boolean {
  if (!models || !Array.isArray(models)) return true;
  const m = models.find(x => x?.name === model);
  if (!m || !Array.isArray(m.fields)) return false;
  const names = new Set(m.fields.map(f => String(f?.name)));
  return fields.every(f => names.has(f));
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
 *
 * R190 增设 ⓪ stale 预检测（prismaClientKnows，治 A 的日志噪音）：
 * 写库前查运行时 client 内嵌的 DMMF，SkillEvaluationReport 缺
 * mode/outline/figures 即判为旧版生成物——跳过 ①② 直接 raw SQL，
 * SSE 日志用平静的 info 环境提示替代「Prisma 写入失败」的 warn。
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
  notify: (msg: string, level?: 'info' | 'warn') => void,
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
  // ⓪ R190: stale-client 预检测 —— 旧版 client 的 create 在客户端校验
  // 阶段必然抛 Unknown argument（与数据库无关，② 的 schema-compat 自愈
  // 对它无效）。提前识别后直接走 ③ raw SQL，SSE 日志以平静的 info 环境
  // 提示替代「Prisma 写入失败」的 warn 噪音。
  const staleClient = !prismaClientKnows('SkillEvaluationReport', ['mode', 'outline', 'figures']);
  if (!staleClient) {
    // ① 常规路径。
    try {
      await db.skillEvaluationReport.create({ data });
      return true;
    } catch (err: any) {
      notify(`SkillEvaluationReport Prisma 写入失败：${prismaErrReason(err)}`);
    }
    // ② schema-compat 自愈（缺表 CREATE / 缺列 ALTER）后重试一次。
    try {
      const compat = await applySchemaCompat(getActiveDbFsPath());
      if (!compat.ok) notify(`schema-compat 自愈未完成：${compat.error ?? 'unknown'}`);
    } catch (err: any) {
      notify(`schema-compat 自愈异常：${err?.message?.slice(0, 120) ?? 'unknown'}`);
    }
    try {
      await db.skillEvaluationReport.create({ data });
      notify('schema-compat 自愈后重试写入成功');
      return true;
    } catch {
      // 与 ① 同因（stale client 的客户端校验错误在重试中必然复现）——
      // 直接转 ③ raw SQL 兜底。
    }
  } else {
    notify(
      '检测到本地 Prisma client 为旧版生成物（缺少 mode/outline/figures 字段）——非代码错误、报告数据不受影响，本次改用 raw SQL 直接写入（数据无损）。一次性修复：执行 `bun install`（触发 postinstall 自动 generate）或 `bun run db:generate`，删除 .next 缓存后重启 dev server，此提示即消失',
      'info',
    );
    // 库表列仍按 ② 的逻辑尽力确保一次（路由启动时已跑过，正常为 no-op；
    // 防极端叠加：启动时 compat 失败 + 旧 client 同时出现时 ③ 无列可写）。
    try {
      const compat = await applySchemaCompat(getActiveDbFsPath());
      if (!compat.ok) notify(`schema-compat 自愈未完成：${compat.error ?? 'unknown'}`);
    } catch (err: any) {
      notify(`schema-compat 自愈异常：${err?.message?.slice(0, 120) ?? 'unknown'}`);
    }
  }
  // ③ raw SQL：绕过 stale client delegate（经典管线 SkillRunRecord 同款）。
  try {
    const id = `dsh_${row.uniprotId}_${Date.now()}`;
    await db.$executeRaw`INSERT INTO SkillEvaluationReport (id, uniprotId, proteinName, overallScore, directPdbCount, coverage, report, llmOk, llmProvider, llmModel, llmDurationMs, mode, outline, figures, createdAt) VALUES (${id}, ${row.uniprotId}, ${row.proteinName}, ${row.overallScore}, ${row.directPdbCount}, ${row.coverage}, ${row.report}, ${row.llmOk ? 1 : 0}, ${row.llmProvider || null}, ${row.llmModel || null}, ${row.llmDurationMs}, ${'dsh'}, ${row.outlineJson}, ${row.figuresJson}, CURRENT_TIMESTAMP)`;
    notify(
      staleClient
        ? '已通过 raw SQL 写入 SkillEvaluationReport（数据无损；旧版 client 只影响日志观感，不影响落库结果）'
        : '已通过 raw SQL 兜底写入 SkillEvaluationReport（数据无损）。常规路径失败多为本地 Prisma client 旧版生成物：执行 `bun install`（触发 postinstall 自动 generate）或 `bun run db:generate` 后重启 dev server 即可恢复',
    );
    return true;
  } catch (err: any) {
    notify(`SkillEvaluationReport raw SQL 兜底失败：${prismaErrReason(err)}`);
    return false;
  }
}


// ─── R191: 瞬态 LLM 错误退避 + 短占位符 ───────────────────────────────

/** R191: 判定 LLM 错误是否瞬态（429 限流/过载/5xx）——值得退避后重试。
 * 真实 E2E 实测：连续跑三轮评估后 zai provider 进入 429 窗口，第 11-15
 * 章 3 连试 + rescue 全部秒败（同一窗口内连发必然全败）；等几十秒窗口
 * 滑过即可恢复。 */
export function isTransientLlmError(err: string): boolean {
  return /\b429\b|too many requests|rate ?limit|overloaded|temporarily|status 5\d\d/i.test(err);
}

/** R191: 提取首个 provider 的错误段并压到 120 字符 —— 报告占位符不需要
 * 17-provider 全量堆栈（旧占位符约 800 字/章，5 章失败灌 4KB 噪音进
 * 正文）；完整错误已在 SSE chapterError 字段与日志中。 */
export function shortLlmErr(err: string): string {
  const first = err.split(';')[0].trim();
  return (first || err || 'LLM 调用失败').replace(/\s+/g, ' ').slice(0, 120);
}

/** R193 建议 3: termFixes 确定性术语统一 —— LLM 只出 from→to 清单，替换
 * 由代码全局执行（零幻觉、可控、可统计）。安全规则：跳过图片行（防误伤
 * URL）、from≥2 字符、from/to 不得含 URL、from!==to。chapters 就地修改，
 * 返回逐条应用结果（count=0 的项不返回，便于上层只 emit 有效替换）。 */
export function applyTermFixes(
  chapters: Array<{ ok: boolean; content: string }>,
  termFixes: unknown,
): { applied: Array<{ from: string; to: string; count: number }>; replacements: number } {
  const applied: Array<{ from: string; to: string; count: number }> = [];
  let replacements = 0;
  if (!Array.isArray(termFixes)) return { applied, replacements };
  for (const tf of termFixes.slice(0, 5)) {
    if (!tf || typeof tf !== 'object') continue;
    const from = String((tf as Record<string, unknown>).from ?? '').trim();
    const to = String((tf as Record<string, unknown>).to ?? '').trim();
    if (!from || !to || from === to || from.length < 2) continue;
    if (/https?:\/\//i.test(from) || /https?:\/\//i.test(to)) continue;
    // R196: 短纯 ASCII 术语（KD/EG/TK 等 2-3 字母）无词边界概念，
    // split/join 会命中无关单词内部（SKD5/AKT1KD）；中文术语无子串歧义不受影响。
    if (from.length < 4 && /^[a-z0-9]+$/i.test(from)) continue;
    let count = 0;
    for (const ch of chapters) {
      if (!ch.ok) continue;
      const lines = ch.content.split('\n');
      for (let li = 0; li < lines.length; li++) {
        const t = lines[li];
        // R196: 图片行保护升级 —— 旧版只保护行首 ![，列表前缀/缩进/行内
        // 混排的图片语法（- ![alt](url)）不受保护，from 是 URL 路径段或
        // alt 片段时会改坏图片行。
        if (/!\[[^\]]*\]\(https?:\/\//.test(t)) continue;
        if (!t.includes(from)) continue;
        count += t.split(from).length - 1;
        lines[li] = t.split(from).join(to);
      }
      ch.content = lines.join('\n');
    }
    if (count > 0) {
      applied.push({ from, to, count });
      replacements += count;
    }
  }
  return { applied, replacements };
}

/** R193 建议 5: 深挖篇幅占比统计 —— 口径明确为「深挖章 /（全部 ok 章 −
 * 参考文献）」：references 确定性生成后列表动辄 3-4k chars，混入分母会把
 * 真实占比从 ~66% 拉低到 ~49%（R192 实测）。hasQuestion=false 时 deepShare
 * 为 null（基础评估无深挖章概念）。 */
export function deepShareStats(
  chapters: Array<{ ok: boolean; id: string; content: string }>,
  baselineIds: string[],
  hasQuestion: boolean,
): { deepChars: number; bodyChars: number; deepShare: number | null } {
  const refChars = chapters.filter(ch => ch.ok && ch.id === 'references').reduce((s, ch) => s + ch.content.length, 0);
  const bodyChars = Math.max(1, chapters.filter(ch => ch.ok).reduce((s, ch) => s + ch.content.length, 0) - refChars);
  // references 是确定性生成的列表章 —— 既不进分母，也不算深挖章（单测
  // 曾抓到它混进 deepChars 把占比从 65% 抬到 98% 的 bug）。
  const deepChars = hasQuestion
    ? chapters.filter(ch => ch.ok && ch.id !== 'references' && !baselineIds.includes(ch.id)).reduce((s, ch) => s + ch.content.length, 0)
    : 0;
  return { deepChars, bodyChars, deepShare: hasQuestion ? Math.round((deepChars / bodyChars) * 100) : null };
}

/** R191: 可中止的退避等待（每秒检查 signal；退避前向 SSE 发一条可见
 * 事件，防止客户端长时间无数据误判断流）。 */
async function backoffWait(
  ms: number,
  signal: AbortSignal | undefined,
  reason: string,
  emitEvent: (msg: string) => void,
): Promise<void> {
  emitEvent(reason);
  const t1 = Date.now();
  while (Date.now() - t1 < ms) {
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
    await new Promise(res => setTimeout(res, Math.min(1000, ms - (Date.now() - t1))));
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
  // R189: 科学问题可为空 —— 空问题 = 基础评估口径（无 relevance 阶段、
  // 无 question_focus 章、无深挖章节、无审查环），与 classic 模式对齐。
  const hasQuestion = question.trim().length > 0;

  let llmProvider = '';
  let llmModel = '';
  let llmTotalMs = 0;
  // R193: 配额压力计数 —— 每次瞬态（429/5xx/overloaded）错误 +1，用于分级
  // 降级审查深度（LLM 调用数已从 22 涨到 27+，连续两轮完整评估即触 429，
  // R192 实测一轮白等 ~130s 退避）：≥2 重写后跳过复审；≥4 跳过整章审查环；
  // ≥6 跳过终审。降级保「章节交付」主目标，牺牲部分审查质量。
  let transientHits = 0;
  const noteTransient = (err: string) => {
    if (isTransientLlmError(err || '')) transientHits++;
  };

  // ── Phase A: 数据收集（→ 56%）─────────────────────────────────────────
  emit({ stage: 'collect', level: 'info', message: `DSH 模式启动 · 数据收集（UniProt → RCSB → BLAST → PubMed）`, progress: 3 });
  const collected = await collectEvaluationData(uniprot, opts, emit);
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
  const c = collected;

  // ── Phase B: 相关性分析（58-62%）──────────────────────────────────────
  // R189: ① 空问题跳过（基础评估模式）；② 有问题时数据样本扩大（PDB
  // top10→top20、文献 top10→top15）+ 新增 keyPicks / keyLiterature 重点
  // 数据挑选（后续注入深挖章节 prompt，确保重点数据被充分讨论）。
  let relevance: DshRelevance | null = null;
  let figureQueries: Array<{ sectionId: string; query: string }> = [];
  let relevanceRunParsed = false;
  if (!hasQuestion) {
    emit({ stage: 'relevance', level: 'info', message: `未提供科学问题 — 跳过相关性分析，按基础评估口径执行（功能/PDB/质量/成药性等标准章节）`, progress: 58 });
  } else {
  emit({ stage: 'relevance', level: 'info', message: `Agent 分析全部数据源与科学问题的相关性…`, progress: 58 });
  const compact = [
    `科学问题：${question}`,
    ``,
    `## UniProt 元数据`,
    `${c.uniprotInfo.proteinName}（${c.uniprotInfo.uniprotId} / ${c.uniprotInfo.entryName}）· 基因 ${c.uniprotInfo.geneNames} · ${c.uniprotInfo.organism} · ${c.uniprotInfo.sequenceLength} aa`,
    ``,
    `## PDB 结构（top 20 / ${c.pdbRows.length} 条直接命中）`,
    c.pdbRows.slice(0, 20).map(e => `- ${e.pdbId} · ${e.method || '?'} · ${e.resolution != null ? e.resolution.toFixed(1) + 'Å' : '?'} · 配体: ${e.ligands || '无'} · ${(e.title || '').slice(0, 50)}`).join('\n') || '（无）',
    ``,
    `## BLAST 同源（top 10 / ${c.blastRows.length} 条）`,
    c.blastRows.slice(0, 10).map(h => `- ${h.pdbId || h.uniprotRef} · identity ${h.identity?.toFixed(1) ?? '?'}% · e=${h.evalue} · ${(h.description || '').slice(0, 50)}`).join('\n') || '（BLAST 已跳过）',
    ``,
    `## 文献（top 15 / ${c.literature.length} 篇，IF 降序）`,
    c.literature.slice(0, 15).map(l => `- PMID ${l.pmid} · ${l.journal}${l.journalIf != null ? ` (IF ${l.journalIf.toFixed(1)})` : ''} · ${l.title}`).join('\n') || '（无）',
    ``,
    `## 评分`,
    `X-ray ${c.scores.xray.score}/10 (${c.scores.xray.structures}条) · Cryo-EM ${c.scores.cryoem.score}/10 (${c.scores.cryoem.structures}条) · NMR ${c.scores.nmr.score}/10 (${c.scores.nmr.structures}条) · Overall ${c.scores.overall.score}/10 · 覆盖率 ${c.coverage}%`,
  ].join('\n');

  const relevanceSystem = `你是一位严谨的生物信息数据分析师。请基于给定的真实数据，分析与科学问题相关的证据，并从全量数据中挑选「回答该问题最重要的重点数据」。只输出 JSON，不要其他文字。`;
  const relevanceUser = `${compact}

请输出 JSON（字段如下）：
{
  "questionRestated": "用一句话重述科学问题",
  "findings": [{"source": "uniprot|rcsb|blast|literature|scores", "relevance": "high|medium|low", "note": "具体发现，引用数据中的具体数字/ID"}],
  "keyInsights": ["关键洞察 1", "关键洞察 2"],
  "dataGaps": ["数据缺口 1", "数据缺口 2"],
  "keyPicks": [{"pdbId": "PDB ID", "why": "该结构对回答科学问题的价值，一句话"}],
  "keyLiterature": ["PMID1", "PMID2"],
  "figureQueries": [{"sectionId": "章节id", "query": "英文图片搜索查询，如 EGFR signaling pathway diagram"}]
}

要求：
- findings 逐源给出（uniprot/rcsb/blast/literature/scores 各 1-2 条）
- keyPicks 4-12 条：从上方 PDB 表中挑选对回答问题最重要的结构（代表性复合物/最高分辨率/关键配体态/关键方法学），why 必须点明它与问题的具体关系；pdbId 只能来自表中真实存在的 ID，不得编造
- keyLiterature 0-8 条：与问题最直接相关的 PMID，必须来自上方文献清单
- figureQueries 0-6 条：每个确有配图价值的章节最多 1 条（原理图/通路图/机制图对该章确有帮助时才给，宁缺毋滥）；query 用英文（图片召回更好）；sectionId 必须是：${SECTION_LIBRARY.filter(s => !s.fixed && s.id !== 'question_focus').map(s => s.id).join(' / ')}`;

  // R183: maxChars 2500→4000 —— 推理模型 think 块已在 generateText 剥离，
  // 但 findings 等字段本身也可能超过 2500（12 条发现 × ~150 字）。
  // R189: 4000→5000 —— 新增 keyPicks/keyLiterature 字段后 JSON 变长。
  const relevanceRun = await generateJson(relevanceSystem, relevanceUser, { maxChars: 5000, llm: llmCfg, signal });
  llmTotalMs += relevanceRun.durationMs;
  if (relevanceRun.provider) llmProvider = relevanceRun.provider;
  if (relevanceRun.model) llmModel = relevanceRun.model;

  if (relevanceRun.parsed) {
    relevanceRunParsed = true;
    relevance = {
      questionRestated: String(relevanceRun.parsed.questionRestated || ''),
      findings: Array.isArray(relevanceRun.parsed.findings)
        ? (relevanceRun.parsed.findings as any[]).filter(f => f && typeof f === 'object').slice(0, 12).map(f => ({
            source: String(f.source || ''), relevance: String(f.relevance || ''), note: String(f.note || '').slice(0, 300),
          }))
        : [],
      keyInsights: Array.isArray(relevanceRun.parsed.keyInsights) ? (relevanceRun.parsed.keyInsights as any[]).map(String).slice(0, 8) : [],
      dataGaps: Array.isArray(relevanceRun.parsed.dataGaps) ? (relevanceRun.parsed.dataGaps as any[]).map(String).slice(0, 8) : [],
      // R189: 重点数据挑选 —— 注入前过滤到真实存在于收集数据中的条目
      // （LLM 可能幻觉出不存在的 PDB ID / PMID，宁缺毋滥）。
      keyPicks: Array.isArray(relevanceRun.parsed.keyPicks)
        ? (relevanceRun.parsed.keyPicks as any[])
            .filter(k => k && typeof k === 'object' && k.pdbId)
            .map(k => ({ pdbId: String(k.pdbId).trim().toUpperCase().slice(0, 4), why: String(k.why || '').slice(0, 200) }))
            .filter(k => c.pdbRows.some(e => e.pdbId.toUpperCase() === k.pdbId))
            .slice(0, 12)
        : [],
      keyLiterature: Array.isArray(relevanceRun.parsed.keyLiterature)
        ? (relevanceRun.parsed.keyLiterature as any[]).map(String)
            .filter(pmid => c.literature.some(l => String(l.pmid) === pmid))
            .slice(0, 8)
        : [],
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
      message: `✓ 相关性分析完成：${(relevance.findings || []).length} 条发现 · ${(relevance.keyInsights || []).length} 个洞察 · 重点结构 ${(relevance.keyPicks || []).length} 个 · 重点文献 ${(relevance.keyLiterature || []).length} 篇 · ${(relevance.dataGaps || []).length} 个数据缺口`,
      progress: 62,
      dshRelevance: relevance,
    });
  } else {
    // R196: 429 归因喂入配额压力计数器（与审稿环/终审同口径 —— 此前
    // relevance 死于限流不计入，会延迟三级降级的触发时机）。
    const relTransient = isTransientLlmError(relevanceRun.error || '');
    if (relTransient) noteTransient(relevanceRun.error || '');
    emit({ stage: 'relevance', level: 'warn', message: relTransient ? `⚠ 相关性分析 LLM 调用失败（限流/瞬态，已计入配额压力），用问题本身作为上下文继续` : `⚠ 相关性分析 JSON 解析失败（用问题本身作为 relevance 上下文继续）`, progress: 62 });
    relevance = { questionRestated: question, findings: [], keyInsights: [], dataGaps: [], keyPicks: [], keyLiterature: [] };
  }
  } // end hasQuestion（Phase B else 块闭合）
  const rel: DshRelevance | null = relevance;
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');

  // ── Phase C: 大纲规划（62-64%）────────────────────────────────────────
  // R184: 基础评估章节（数据驱动）必含 + 问题深挖章节叠加 —— 聚焦的科学
  // 问题不再挤掉基本评估内容，只是「额外重点讨论」。
  const dataInfo: OutlineDataInfo = {
    hasPdb: (c.pdbRows?.length ?? 0) > 0,
    hasBlast: !c.skippedBlast && (c.blastRows?.length ?? 0) > 0,
    hasLiterature: (c.literature?.length ?? 0) > 0,
  };
  const rules = outlineRules(dataInfo, { noQuestion: !hasQuestion });
  const baselineListing = rules.baselineIds
    .map(id => getSection(id))
    .filter((s): s is SectionTemplate => !!s)
    .map(s => `- ${s.id} | ${s.titleZh} | ${s.purpose}`)
    .join('\n');
  let outline: DshOutlineEntry[];
  if (!hasQuestion) {
    // R189: 基础评估模式 —— 大纲确定性生成（不调 LLM）：summary + 基础章节
    // + references + conclusion，与 classic 口径对齐。
    emit({ stage: 'outline', level: 'info', message: `规划报告大纲（基础评估模式，共 ${rules.totalMin} 章）…`, progress: 62 });
    outline = repairOutline({ sections: [] }, dataInfo, { noQuestion: true });
    emit({
      stage: 'outline',
      level: 'success',
      message: `✓ 大纲确定（基础评估模式，未提供科学问题）：${outline.length} 章（${outline.map(o => o.title).join(' → ')}）`,
      progress: 64,
      dshOutline: { sections: outline, total: outline.length },
    });
  } else {
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
- 问题重述：${rel?.questionRestated || question}
- 关键发现：${(rel?.findings || []).map(f => `[${f.source}/${f.relevance}] ${f.note}`).join('；').slice(0, 800) || '（无）'}
- 数据缺口：${(rel?.dataGaps || []).join('；') || '（无）'}
- 重点结构（相关性分析点名，深挖章节必须充分讨论）：${(rel?.keyPicks || []).map(k => k.pdbId).join('、') || '（无）'}

数据清单：UniProt 元数据 ✓、PDB 结构 ${c.pdbRows.length} 条、BLAST 同源 ${c.blastRows.length} 条（${c.skippedBlast ? '已跳过' : '已运行'}）、文献 ${c.literature.length} 篇、评分 Overall ${c.scores.overall.score}/10。

本次必含的基础评估章节（数据驱动，不可省略；本地校验会自动补齐遗漏）：
${baselineListing}
${figureQueries.length > 0 ? `\n配图建议（相关性分析认为这些章节放一张原理图/通路图确有帮助，规划时可优先考虑）：${figureQueries.map(q => `${q.sectionId}（${q.query}）`).join('、')}` : ''}

请规划报告大纲（question_focus 固定第 2 位、基础章节必含；你重点决定问题深挖章节的选择与顺序，并为每章写一句 focus）。`;

  // R184: maxChars 2400→3600 —— 大纲最多 14 章，JSON 变长。
  // R189: 3600→4000 —— 深挖章节上限 6 后 JSON 变长。
  const outlineRun = await generateJson(outlineSystem, outlineUser, { maxChars: 4000, llm: llmCfg, signal });
  llmTotalMs += outlineRun.durationMs;
  if (outlineRun.provider) llmProvider = outlineRun.provider;
  if (outlineRun.model) llmModel = outlineRun.model;

  outline = repairOutline(outlineRun.parsed, dataInfo);
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
    // R196: 429 归因喂入配额压力计数器（同 relevance/审稿环/终审口径）。
    const outTransient = isTransientLlmError(outlineRun.error || '');
    if (outTransient) noteTransient(outlineRun.error || '');
    outline = repairOutline({
      sections: guessQuestionSections(question).map(id => ({ id })),
    }, dataInfo);
    emit({
      stage: 'outline',
      level: 'warn',
      message: `⚠ 大纲${outTransient ? ' LLM 调用失败（限流/瞬态，已计入配额压力）' : ' JSON 解析失败'}，使用数据驱动默认大纲（${outline.length} 章：${outline.map(o => o.title).join(' → ')}）`,
      progress: 64,
      dshOutline: { sections: outline, total: outline.length },
    });
  }
  } // end hasQuestion（Phase C else 块闭合）
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');

  // ── Phase D: 配图（64-72%）────────────────────────────────────────────
  const sectionIds = outline.map(o => o.id);
  const figures: ReportFigure[] = [];
  try {
    // RCSB 结构图（图事件由 wrapper 注入 64-66% 区间进度）。
    // R197: signal 透传 —— 配图是可选产物，中止返回已收集图（不抛错）。
    const rcsbFigs = await collectRcsbFigures(c.pdbRows, (e) => {
      emit({ ...e, progress: e.progress ?? 65 });
    }, sectionIds, signal);
    figures.push(...rcsbFigs);
  } catch (err: any) {
    // R197: Stop 信号上抛（不被「配图失败跳过」吞掉）。
    if (err?.name === 'AbortError' || signal?.aborted) throw err;
    emit({ stage: 'figure-rcsb', level: 'warn', message: `⚠ RCSB 配图收集失败（跳过）：${err?.message ?? 'unknown'}`, progress: 65 });
  }
  try {
    // web 原理图/通路图（VLM 校验；图事件 66-72% 区间，逐步递增）。
    let webStep = 0;
    const webFigs = await searchWebFigures(figureQueries, (e) => {
      webStep++;
      emit({ ...e, progress: e.progress ?? Math.min(72, 66 + webStep) });
    }, signal);
    figures.push(...webFigs);
  } catch (err: any) {
    // R197: Stop 信号上抛（同上）。
    if (err?.name === 'AbortError' || signal?.aborted) throw err;
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
3. 正文字数：按任务中的「本章字数要求」执行（references 参考文献章除外，按其列表格式输出）
4. 子节：可用 §N.M 三级小节（\`### §N.1 ...\`），N 为本章在报告中的章序号
5. 禁止 emoji：标题、表格、列表中均不使用
6. 只使用给定数据，不得编造：未在数据上下文出现的 PDB ID / PMID / 数字一律不写
7. 引用真实 ID：结论尽量引用具体 PDB ID / PMID / 分辨率 / IF / Identity%
8. 缺失数据写"暂无可靠数据"，不要假装有信息
9. 中文输出（专有名词保留英文）`;

  const chapters: DshChapterResult[] = [];
  const chapterTotal = outline.length;
  // R192: 审查环轮次上限 —— 重写版会再次送审（复审），达此上限后不再重写
  // （防「怎么改都不满意」的章节吃掉整条流水线的时间与配额预算）。
  const MAX_REVIEW_ROUNDS = 2;
  // R194 建议 6: 审查环配额降级痕迹计数（provenance / done 消息共用）——
  // skippedReviewChapters = 整章审查环被跳过（level-2，≥4 次瞬态）；
  // skippedReReviewChapters = 重写完成后不复审（level-1，≥2 次）。
  // 事后质量归因时可区分「没审」与「审了但没复审」。
  let skippedReviewChapters = 0;
  // R195 建议 3/4（度量补强）：① 每章篇幅比 chars/maxWords（观察「深挖
  // 章膨胀」趋势，ratio > 1.6 计为膨胀章）；② 审稿轮次轨迹在 provenance
  // 汇总（复用 DshChapterResult.reviewRounds/reviewCapped，无需循环内
  // 单独累计）。
  const lengthStats: Array<{ id: string; chars: number; ratio: number }> = [];
  let skippedReReviewChapters = 0;
  for (let i = 0; i < outline.length; i++) {
    const entry = outline[i];
    const tmpl = getSection(entry.id)!;
    const chapterIndex = i + 1;
    const pct = 72 + Math.round((i / Math.max(1, chapterTotal)) * 22);

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

    // ── R192: references 章确定性生成（零 LLM）──────────────────────
    // 固定格式列表章直接从真实文献数据构建：零幻觉（不可能出现编造
    // PMID）、零配额、零延迟；也不再需要「审稿环排除 references」的特判
    // 之外的其余豁免逻辑（字数/格式校验天然满足）。
    if (entry.id === 'references') {
      const refT0 = Date.now();
      const refContent = buildDeterministicReferences(c.literature, rel?.keyLiterature);
      chapters.push({
        id: entry.id,
        title: tmpl.titleZh,
        ok: true,
        content: refContent,
        attempts: 0,
        reviewed: false,
        rewritten: false,
        reviewRounds: 0,
        deterministic: true,
      });
      emit({
        stage: 'chapter_done',
        level: 'success',
        message: `✓ 第 ${chapterIndex}/${chapterTotal} 章完成（${refContent.length} chars · 确定性生成：${c.literature.length} 篇真实文献，未经 LLM）`,
        progress: 72 + Math.round(((i + 1) / Math.max(1, chapterTotal)) * 22),
        chapter: entry.id,
        chapterIndex,
        chapterTotal,
        chapterId: entry.id,
        chapterTitle: tmpl.titleZh,
        chapterContent: refContent,
        chapterDurationMs: Date.now() - refT0,
      });
      continue;
    }

    // 该章可用配图（kind 任意，status verified）。R184: 正文嵌入建议最多
    // 取 3 张。R187: 措辞从「从中选 1-3 张」改为「必须全部嵌入」+
    // 章末确定性补挂（下方 missingAppendix）——杜绝配图只出现在附录、
    // 不进正文（用户现场反馈的第二个问题）；alt 已消毒（figureImageMarkdown）。
    const figsForSection = figures.filter(f => f.status === 'verified' && f.sectionId === entry.id);
    const figsToEmbed = figsForSection.slice(0, 3);
    const figuresNote = figsToEmbed.length > 0
      ? `\n\n## 本章配图（以下 ${figsToEmbed.length} 张必须全部嵌入正文，分别放在本章最合适的小节；漏嵌的图会被自动补挂到章末）\n${figsToEmbed.map(f => `- ${f.url} ｜ ${f.caption}`).join('\n')}\n\n嵌入格式（单独一行，必须原样复制，不要改动方括号内的文本）：\n${figsToEmbed.map(f => figureImageMarkdown(f)).join('\n')}`
      : '';

    // R184: 基础评估章节与问题深挖章节的科学问题定位不同 ——
    //   基础章节：以标准评估内容为主体，问题仅作背景参考（防聚焦收窄，
    //   这正是「即使写了聚焦问题也要包含基本评估内容」的写作侧约束）；
    //   深挖章节（含 question_focus / summary / conclusion 等强制位）：
    //   重点服务科学问题。
    // R189: deep = 有问题且非基础章 —— 字数用模板 deepWords（加大聚焦问题
    // 的回答篇幅）；isExtra = 真正的「问题深挖」中间章节 —— 额外注入重点
    // 数据与深度要求（summary/question_focus/conclusion 有各自的职责约束，
    // 不注入重点清单以免与其内容要求冲突）。无问题时均为 false。
    const isBaseline = rules.baselineIds.includes(entry.id);
    const deep = hasQuestion && !isBaseline;
    const isExtra = deep && entry.id !== 'question_focus' && !tmpl.fixed;
    const questionBlock = !hasQuestion
      ? ''
      : isBaseline
        ? `## 科学问题（背景参考）\n${question}\n\n说明：本章是标准评估章节 —— 以本章内容要求为主体、完整覆盖常规评估口径；与上述问题自然相关处可顺带联系，但不要让问题聚焦收窄或替换本章的标准评估内容。`
        // R187: 深挖章节加「结论先行」硬性要求 —— 用户反馈聚焦问题的讨论
        // 太简略、不直接回答问题；深挖章必须开篇给答案再展开证据。
        : `## 科学问题（本章须重点服务于该问题）\n${question}\n\n硬性要求：开篇必须先用 2-4 句话或要点清单/表格「直接回答」该问题（结论先行 —— 先给答案，再展开证据与细节），不得只做背景铺垫、范围界定或泛泛而谈。`;

    // R189: 重点数据注入（仅 isExtra 章）—— 相关性 agent 点名的结构/文献
    // 必须逐一充分讨论（keyPicks 已在解析时消毒到真实存在的条目）。
    const keyPicksBlock = isExtra && rel && rel.keyPicks && rel.keyPicks.length > 0
      ? `\n\n## 重点结构（相关性分析点名，本章必须逐一充分讨论）\n${rel.keyPicks.map(k => {
          const row = c.pdbRows.find(e => e.pdbId.toUpperCase() === k.pdbId);
          return row
            ? `- ${row.pdbId} · ${row.method || '?'} · ${row.resolution != null ? row.resolution.toFixed(1) + 'Å' : '?'} · 配体: ${row.ligands || '无'} · ${(row.title || '').slice(0, 70)} ｜ 挑选理由：${k.why}`
            : `- ${k.pdbId} ｜ 挑选理由：${k.why}`;
        }).join('\n')}`
      : '';
    const keyLitBlock = isExtra && rel && rel.keyLiterature && rel.keyLiterature.length > 0
      ? (() => {
          const rows = rel.keyLiterature
            .map(pmid => c.literature.find(l => String(l.pmid) === pmid))
            .filter((l): l is LiteratureRow => !!l)
            .slice(0, 8);
          return rows.length > 0
            ? `\n\n## 重点文献（相关性分析点名，本章必须引用讨论）\n${rows.map(l => `- PMID ${l.pmid} | ${l.title} | ${l.journal}${l.journalIf != null ? ` (IF: ${l.journalIf.toFixed(1)})` : ''} | ${l.year}`).join('\n')}`
            : '';
        })()
      : '';
    // R189: 深度要求（仅 isExtra 章）—— 用户要求「所有讨论都要有深度」。
    const depthBlock = isExtra
      ? `\n\n## 深度要求（问题深挖章节，必须全部满足）\n- 论证链完整：每个结论按「结论 → 证据 → 机制解释 → 含义」展开，不得只罗列条目\n- 多证据交叉：关键论点至少两条独立证据（不同结构 / 结构+文献 / 不同方法学），并说明证据间是否一致\n- 量化对比：用分辨率、identity%、IF、年份等具体数字支撑判断\n- 主动指出证据冲突或数据空白，给出你的裁决与理由，而非回避`
      : '';
    // R189: 深挖字数（模板 deepWords，缺失则 1.6x/1.8x 兜底）。
    const minW = deep ? (tmpl.deepWords?.min ?? Math.round(tmpl.minWords * 1.6)) : tmpl.minWords;
    const maxW = deep ? (tmpl.deepWords?.max ?? Math.round(tmpl.maxWords * 1.8)) : tmpl.maxWords;

    const userPrompt = `# 当前任务：撰写第 ${chapterIndex}/${chapterTotal} 章「${tmpl.titleZh}」

${buildFilteredContext(c, tmpl.dataHints)}

---

${questionBlock}${keyPicksBlock}${keyLitBlock}${depthBlock}

## 本章焦点（大纲规划器指定）
${entry.focus}

## 本章内容要求
${tmpl.contentSpec}
${!hasQuestion ? '\n（本次未提供科学问题 —— 按标准评估口径撰写，内容要求中提及「科学问题/用户问题」的条目按靶点整体评估理解）' : ''}

## 本章字数要求
正文 ${minW}-${maxW} 字
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
      // R191: 瞬态错误退避 —— 429 限流窗口内连发必然全败，等窗口滑过再试。
      if (attempt > 0 && isTransientLlmError(lastErr)) {
        const waitMs = Math.min(45000, 20000 + attempt * 10000);
        await backoffWait(waitMs, signal, `LLM 瞬态错误（${shortLlmErr(lastErr)}），${Math.round(waitMs / 1000)}s 后退避重试（第 ${attempts + 1} 次尝试）`, (message) => emit({ stage: `chapter-${entry.id}`, level: 'warn', message, progress: pct, chapter: entry.id }));
      }
      attempts++;
      const prompt = attempt === 0
        ? userPrompt
        : `${userPrompt}\n\n【重试】上次输出未通过校验（${lastErr || '格式不符'}）。请严格输出：第一行为 \`## ${tmpl.titleZh}\`，正文 ≥150 字符，不得包含失败占位符。`;
      const r = await generateText(chapterSystem, prompt, { maxChars: deep ? 9000 : 6000, llm: llmCfg, signal });
      llmTotalMs += r.durationMs;
      if (r.provider) llmProvider = r.provider;
      if (r.model) llmModel = r.model;
      if (!r.ok) {
        lastErr = r.error || 'LLM 调用失败';
        noteTransient(lastErr); // R193: 配额压力计数
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
        // R191: rescue 前同样退避 —— 限流窗口未过时 rescue 也是白打。
        if (isTransientLlmError(lastErr)) {
          await backoffWait(30000, signal, `LLM 瞬态错误持续（${shortLlmErr(lastErr)}），30s 后用简化 prompt 最后救援`, (message) => emit({ stage: `chapter-${entry.id}`, level: 'warn', message, progress: pct, chapter: entry.id }));
        }
        const rescuePrompt = `请为蛋白靶点评估报告撰写章节「${tmpl.titleZh}」。

靶点：${c.uniprotInfo.proteinName}（${c.uniprotInfo.uniprotId}，${c.uniprotInfo.organism}）
${hasQuestion ? `科学问题：${question}\n` : ''}本章要求：${tmpl.contentSpec}
可用数据要点：直接 PDB ${c.directPdbCount} 条、BLAST ${c.blastHitCount} 条、文献 ${c.literature.length} 篇、Overall 评分 ${c.scores.overall.score}/10。

第一行必须是：\`## ${tmpl.titleZh}\`。正文中文 250-500 字。只输出本章内容。`;
        const r = await generateText(chapterSystem, rescuePrompt, { maxChars: 6000, llm: llmCfg, signal });
        llmTotalMs += r.durationMs;
        if (r.provider) llmProvider = r.provider;
        if (r.model) llmModel = r.model;
        if (!r.ok) noteTransient(r.error || ''); // R193: 配额压力计数
        if (r.ok) {
          const v = validateDshChapter(tmpl.titleZh, r.content);
          if (v.ok) {
            content = normalizeDshChapter(r.content, tmpl.titleZh);
            ok = true;
          } else {
            lastErr = `rescue: ${v.reason}`;
          }
        }
      } catch (err: any) {
        // R196: Stop 信号不得被救援 catch 吞掉（旧行为：backoffWait 抛的
        // AbortError 被吞、章节误记为失败且多发一条 chapterError 事件；
        // 运行虽会在下一检查点中止，但状态/日志口径已失真）。
        if (err?.name === 'AbortError') throw err;
        // 救援也失败 —— 记录失败章节，不中止整体。
      }
    }

    // ── R189/R192/R193: 审查环（agent 式多轮审查与思考）───────────────
    // 有问题模式下，非基础章节（深挖章 + question_focus/summary/
    // conclusion）在初稿通过格式校验后，由「审稿 agent」评估三维度：
    // 问题相关度 / 论证深度 / 数据支撑。任一不达标 → 注入审稿
    // 意见重写。R192: 由「一轮为限」升级为多轮 —— 重写版会再次送审，
    // 达标即止（常态 1 轮通过，1 轮重写后复审通过也很常见）；轮次上限
    // MAX_REVIEW_ROUNDS=2（防 ping-pong 与配额失控）。重写版只做格式
    // 校验；校验/调用失败保留原版，绝不倒退。空问题模式跳过整个审查环
    // （无问题可审）。
    // R193 建议 1（审稿口径与章节职责对齐）：审稿 prompt 注入本章职责
    // （模板 purpose + contentSpec）——R192 实测「实验策略建议/总结与
    // 展望」连续 2 轮被判 directlyAnswers=false，hints 甚至要求删除职责
    // 内容，与 R191 references 被污染同根：固定职责章被按「通篇直答问题」
    // 的深挖口径审。现改为：question_focus/summary 保持严格直答口径（其
    // 职责就是直答），其余被审章的 directlyAnswers 口径改为「与问题相关
    // 的部分是否在职责范围内做到位」，不要求全章直答。
    // R193 建议 2（配额感知降级）：transientHits ≥4 时跳过整章审查环
    // （限流持续时保章节交付主目标）；≥2 时重写后不再复审。
    // R191: references 为固定格式列表章不适用该审稿口径（R192 起该章
    // 已确定性生成、根本不走 LLM，此处的 id 判断仅为防御性保留）。
    let reviewed = false;
    let rewritten = false;
    let reviewRounds = 0;
    let reviewCapped = false;
    if (ok && deep && entry.id !== 'references') {
      if (transientHits >= 4) {
        skippedReviewChapters++;
        emit({ stage: 'chapter-review', level: 'info', message: `配额降级：已遇 ${transientHits} 次限流/瞬态错误，跳过「${tmpl.titleZh}」审查环（保留原稿，终审仍会通读全文）`, progress: pct, chapter: entry.id });
      } else {
      // R193: 本章职责注入 —— question_focus/summary 的职责就是直答问题，
      // 保持严格口径；其余章（实验策略建议/总结展望/各深挖章）以自身职责
      // 为主体，directlyAnswers 按职责范围内的问题相关部分评估。
      const strictAnswer = entry.id === 'question_focus' || entry.id === 'summary';
      const roleBlock = strictAnswer
        ? `本章职责（必须直接回答科学问题）：${tmpl.purpose}`
        : `本章职责：${tmpl.purpose}
本章内容要求（职责范围）：
${tmpl.contentSpec}

注意：本章以其自身职责为主体，不要求通篇直接回答科学问题 —— directlyAnswers 应评估「与科学问题相关的部分是否在职责范围内做到位」（问题相关内容缺失/错误/该答未答才判 false），而非要求全章直答。`;
      const reviewSystem = `你是结构生物学报告的严格审稿人。评估某一章草稿在其章节职责范围内是否达到「服务于科学问题 + 论证有深度 + 数据支撑充分」的标准。只输出 JSON，不要其他文字。`;
      // R194 建议 1（复审锚）：记录上一轮审稿意见，复审轮注入「上轮意见 +
      // 只评估解决程度」—— R193 实测第 8/9 章连续 2 轮 rewrite 的根因是
      // 审稿人每轮重新全量评估、每轮换一套意见（第 1 轮要求删直答段落、
      // 第 2 轮又要求补拓扑细节），意见漂移导致永远审不完。锚定上轮意见
      // 后，复审只判断「上轮问题是否解决」，达标即 pass。
      let lastRoundHints: string[] = [];
      roundLoop:
      for (let round = 1; round <= MAX_REVIEW_ROUNDS; round++) {
        try {
          if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
          emit({ stage: 'chapter-review', level: 'info', message: `审稿 agent 审查第 ${chapterIndex}/${chapterTotal} 章「${tmpl.titleZh}」${round > 1 ? `（第 ${round} 轮 —— 复审重写版）` : ''}…`, progress: pct, chapter: entry.id });
          // R194 建议 1: 复审轮注入上轮意见锚（详见循环前注释）。
          const reanchorBlock = round > 1 && lastRoundHints.length > 0
            ? `【复审锚】上一轮审稿意见（针对重写前的版本）：
${lastRoundHints.map((h, idx) => `${idx + 1}. ${h}`).join('\n')}

本次是第 ${round} 轮复审：只需评估上述上一轮意见是否已在当前草稿中解决 ——
- 上轮意见全部解决且未引入新的严重问题 → verdict=pass
- 仍有未解决项 → verdict=rewrite，rewriteHints 只列仍未解决的项（或当前草稿新引入的严重问题），不要提出与上一轮意见无关的新要求

`
            : '';
          // R194 建议 2（篇幅带宽·软性）：深挖章超出模板字数上限约 60%
          //（余量吸收 markdown 语法/表格线）时给审稿人一条篇幅观察 ——
          // 是否可无损压缩由审稿人判断（存在明显冗余才给压缩建议，有效
          // 论证不因篇幅判 rewrite），不设硬性字数墙。R193 实测：深挖章
          // 膨胀 ~80%（2783 chars vs 1600 字上限），挤占报告整体篇幅平衡。
          const deepMaxWords = tmpl.deepWords?.max ?? 0;
          const lengthNote = deep && deepMaxWords > 0 && content.length > deepMaxWords * 1.6
            ? `【篇幅观察】本章 ${content.length} chars，超出模板字数上限（${deepMaxWords} 字）约 ${Math.round((content.length / deepMaxWords - 1) * 100)}%。若存在明显冗余（重复论证/无效罗列/可合并表格），在 rewriteHints 中给出压缩建议；若均为有效论证则忽略本观察，不因篇幅单独判 rewrite。\n\n`
            : '';
          const reviewUser = `科学问题：${question}

${roleBlock}

章节标题：${tmpl.titleZh}

${reanchorBlock}${lengthNote}章节草稿：
${content.slice(0, 4500)}${content.length > 4500 ? '\n（草稿已截断，按已见内容评估）' : ''}

请输出 JSON：
{
  "directlyAnswers": true/false,
  "depth": "deep"|"adequate"|"shallow",
  "dataGrounded": true/false,
  "verdict": "pass"|"rewrite",
  "rewriteHints": ["改进要点 1", "改进要点 2", "改进要点 3"]
}

判定规则：
- directlyAnswers=${strictAnswer ? 'false（未直接回答问题，只做背景铺垫/罗列）' : 'false（与科学问题相关的部分未在本章职责范围内做到位 —— 问题相关内容缺失/错误/该答未答；本章以其自身职责为主体，不要求全章直答）'}→ rewrite
- depth=shallow（论证链不完整、只有罗列无机制解释、无量化对比）→ rewrite
- dataGrounded=false（结论未引用具体 PDB ID/PMID/数字）→ rewrite
- verdict 必须与三维度一致：三个维度全部达标（directlyAnswers=true 且 dataGrounded=true 且 depth≠shallow）时 verdict 必须为 pass，不得 rewrite
${reanchorBlock ? '- 复审轮：评估口径以【复审锚】为准 —— 上轮意见已解决即 pass，不引入新要求\n' : ''}- rewriteHints 最多 3 条，每条必须是具体可执行的指令（如「补充 X 与 Y 的分辨率对比」），不得要求删除或改名本章的职责性内容`;
          const reviewRun = await generateJson(reviewSystem, reviewUser, { maxChars: 1200, llm: llmCfg, signal });
          llmTotalMs += reviewRun.durationMs;
          const rv = reviewRun.parsed;
          if (!(rv && typeof rv === 'object')) {
            // R193: 区分归因 —— 429/瞬态错误（喂给配额压力计数器，后续章节
            // 自动降级）与真解析失败（不计入，属 prompt/输出格式问题）。
            const transient = isTransientLlmError(reviewRun.error || '');
            if (transient) noteTransient(reviewRun.error || '');
            emit({ stage: 'chapter-review', level: 'info', message: transient ? `审稿 LLM 调用失败（限流/瞬态，已计入配额压力），跳过本章审查（保留原稿）` : `审稿 JSON 解析失败，跳过本章审查（保留原稿）`, progress: pct, chapter: entry.id });
            break;
          }
          reviewed = true;
          reviewRounds = round;
          const verdict = String(rv.verdict || 'pass');
          const depth = String(rv.depth || 'adequate');
          const hints = Array.isArray(rv.rewriteHints)
            ? (rv.rewriteHints as any[]).map(String).filter(h => h.trim()).slice(0, 3)
            : [];
          const dimsLabel = `深度=${depth} · 直接回答=${rv.directlyAnswers ? '是' : '否'} · 数据支撑=${rv.dataGrounded ? '是' : '否'}`;
          // R191: verdict 合理性钳制 —— 真实 E2E 实测 2/9 章「深度=adequate ·
          // 直接回答=是 · 数据支撑=是」仍被 LLM 审稿人给了 rewrite（自相
          // 矛盾），白白多一轮重写（+1 LLM 调用/章）。三维度全部达标时
          // 以维度为准覆盖 verdict，只对真不达标的章节重写。
          const dimsPass = (rv.directlyAnswers === true || rv.directlyAnswers === 'true')
            && (rv.dataGrounded === true || rv.dataGrounded === 'true')
            && depth !== 'shallow';
          // R196: 对称钳制 —— R191 只覆盖「三维度全达标仍判 rewrite」的自相
          // 矛盾；镜像情形（verdict=pass 但三维度全不达标且给了意见）同样
          // 自相矛盾，旧版会以「✓ 审稿通过（三维度全否）」收工。按维度为准。
          const dimsFail = (rv.directlyAnswers === false || rv.directlyAnswers === 'false')
            && (rv.dataGrounded === false || rv.dataGrounded === 'false')
            && depth === 'shallow';
          const needRewrite = hints.length > 0 && !dimsPass && (verdict === 'rewrite' || dimsFail);
          if (!needRewrite) {
            emit({
              stage: 'chapter-review',
              level: 'success',
              message: `✓ 审稿通过${round > 1 ? `（第 ${round} 轮复审）` : ''}（${dimsLabel}${verdict === 'rewrite' && dimsPass ? '；三维度达标，覆盖审稿人矛盾的 rewrite 判定' : ''}）`,
              progress: pct,
              chapter: entry.id,
            });
            break;
          }
          emit({ stage: 'chapter-review', level: 'warn', message: `⚠ 审稿未通过（${dimsLabel}）→ 按意见重写：${hints.join('；').slice(0, 160)}`, progress: pct, chapter: entry.id });
          // R192: 达到轮次上限时不再重写（第 MAX_REVIEW_ROUNDS 轮复审仍
          // 不达标 → 保留重写版或原稿，把配额留给后续章节），避免个别
          // 「怎么改都不满意」的章节吃掉整条流水线的时间预算。
          if (round >= MAX_REVIEW_ROUNDS) {
            reviewCapped = true;
            emit({ stage: 'chapter-review', level: 'info', message: `已达到审查轮次上限（${MAX_REVIEW_ROUNDS} 轮），保留当前版本继续（后续终审还会通读全文）`, progress: pct, chapter: entry.id });
            break;
          }
          emit({ stage: 'chapter-rewrite', level: 'info', message: `按审稿意见重写第 ${chapterIndex}/${chapterTotal} 章「${tmpl.titleZh}」（第 ${round} 轮）…`, progress: pct, chapter: entry.id });
          const rewritePrompt = `${userPrompt}

---

【审稿意见】上一版草稿未通过审查，问题：
${hints.map((h, idx) => `${idx + 1}. ${h}`).join('\n')}

请重写本章：逐条解决上述问题${strictAnswer ? '，开篇直接回答科学问题' : '（在保持本章职责性内容的前提下，只改进与科学问题相关的部分；不得删除或替换本章的职责内容）'}、论证链完整（结论→证据→机制→含义）、关键论点至少两条独立证据交叉验证、引用具体 PDB ID/PMID/数字。第一行仍必须是\`## ${tmpl.titleZh}\`。`;
          // R192: 重写调用同样抗瞬态（429/5xx）—— 多轮化后调用数上升，
          // 限流窗口内直接放弃重写会浪费掉整轮审查成果，退避一次再试。
          let rewriteDone = false;
          let rewriteSucceeded = false; // R196: 本轮重写是否产出了可用新版
          for (let rwAttempt = 0; rwAttempt <= 1 && !rewriteDone; rwAttempt++) {
            if (rwAttempt > 0) {
              await backoffWait(25000, signal, `重写调用遇瞬态错误，25s 后退避重试`, (message) => emit({ stage: 'chapter-rewrite', level: 'warn', message, progress: pct, chapter: entry.id }));
            }
            const r2 = await generateText(chapterSystem, rewritePrompt, { maxChars: deep ? 9000 : 6000, llm: llmCfg, signal });
            llmTotalMs += r2.durationMs;
            if (r2.provider) llmProvider = r2.provider;
            if (r2.model) llmModel = r2.model;
            if (!r2.ok) noteTransient(r2.error || ''); // R193: 配额压力计数
            if (r2.ok) {
              const v2 = validateDshChapter(tmpl.titleZh, r2.content);
              if (v2.ok) {
                content = normalizeDshChapter(r2.content, tmpl.titleZh);
                rewritten = true;
                attempts++;
                rewriteDone = true; // 进入下一轮复审
                rewriteSucceeded = true;
                lastRoundHints = hints; // R194 建议 1: 复审锚 —— 下轮复审只评这份意见的解决程度
                // R193 建议 2（配额感知降级 level-1）：重写已完成，但限流
                // 压力高（≥2 次瞬态错误）时不再复审 —— 重写成果直接采用，
                // 把剩余配额留给后续章节的初稿（主目标）。
                // R196 bug 修复：旧版 break 只跳出 rwAttempt 重试循环，没
                // 跳出 round 复审循环 —— 「不再复审」承诺实际未兑现，复审
                // LLM 调用照发，且 skippedReReview/trajectory/quota 痕迹全部
                // 失真（需 roundLoop 标签 break）。
                if (transientHits >= 2) {
                  skippedReReviewChapters++;
                  emit({ stage: 'chapter-review', level: 'info', message: `配额降级：已遇 ${transientHits} 次限流/瞬态错误，重写完成但不再复审（直接采用重写版）`, progress: pct, chapter: entry.id });
                  break roundLoop;
                }
              } else {
                emit({ stage: 'chapter-rewrite', level: 'warn', message: `⚠ 重写版未通过格式校验（${v2.reason}），保留原版`, progress: pct, chapter: entry.id });
                rewriteDone = true; // 校验失败不是瞬态 —— 重试无意义，保留原版收工
              }
            } else if (isTransientLlmError(r2.error || '')) {
              continue; // 退避后重试一次
            } else {
              emit({ stage: 'chapter-rewrite', level: 'warn', message: `⚠ 重写调用失败，保留原版`, progress: pct, chapter: entry.id });
              rewriteDone = true;
            }
          }
          if (!rewriteDone) {
            emit({ stage: 'chapter-rewrite', level: 'warn', message: `⚠ 重写退避重试后仍失败，保留原版`, progress: pct, chapter: entry.id });
          }
          // R196: 本轮重写未产出可用新版（校验失败/调用失败/退避耗尽）→
          // 保留原版收工，不再对未变化的同一份原稿做第 2 轮全量复审 ——
          // 旧版会白烧一次审稿调用且无复审锚（lastRoundHints 只在成功重写
          // 时更新），R192 注释「保留原版收工」的设计意图实际未生效。
          if (!rewriteSucceeded) break roundLoop;
        } catch (err: any) {
          // 审查环绝不能阻截章节交付 —— 任何异常都降级为保留原稿。
          if (err?.name === 'AbortError') throw err;
          emit({ stage: 'chapter-review', level: 'warn', message: `⚠ 审查环异常（保留原稿）：${err?.message?.slice(0, 100) ?? 'unknown'}`, progress: pct, chapter: entry.id });
          break;
        }
      }
      } // end else（R193: 配额降级 —— transientHits ≥4 时跳过审查环）
    }

    // ── R191/R192: 图片维护（URL 突变修复 + 章末确定性补挂）─────────
    // LLM 在「原样复制」指令下仍会抄错哈希 1 个字符（真实 E2E 实测：
    // 867ea614c6a7 → 867ea61Rc6a7），突变 URL 大概率 404 且骗过补挂的
    // includes 检查造成同图重复；幻觉 URL（清单无近邻）整图剔除。修复后
    // includes 命中 → 不再追加正确版 → 无重复。
    // 章末补挂（R187）：挂到该章的图（≤3 张/章）必须出现在正文；附录只
    // 收未嵌入任何章节的溢出图（见 Phase F gallery 过滤）。
    // R192: 抽为 maintainChapterFigures 共用 —— 终审外科修正（见 Phase
    // E+）重写某章后同样需要过这两道维护。
    if (ok) {
      const maint = maintainChapterFigures(content, figsToEmbed, figures);
      content = maint.content;
      if (maint.fixed > 0 || maint.removed > 0) {
        emit({ stage: 'figures', level: 'info', message: `配图 URL 自愈（${tmpl.titleZh}）：纠正 ${maint.fixed} 处字符突变、剔除 ${maint.removed} 张幻觉图片`, progress: pct, chapter: entry.id });
      }
    }

    chapters.push({
      id: entry.id,
      title: tmpl.titleZh,
      ok,
      content: ok ? content : `_(本章生成失败：${shortLlmErr(lastErr || 'LLM 调用失败')})_`,
      attempts,
      error: ok ? undefined : lastErr,
      reviewed,
      rewritten,
      reviewRounds,
      reviewCapped,
    });
    // R195 建议 4: 篇幅比入度量（ratio = chars / 模板字数上限；references
    // 确定性章不参与 —— 其长度由文献数决定，与模板上限不可比）。
    if (ok && maxW > 0) {
      lengthStats.push({ id: entry.id, chars: content.length, ratio: Math.round((content.length / maxW) * 100) / 100 });
    }
    // R179 (Task 2-a): done 事件的 stage 统一为 `chapter_done`（spec + 经典
    // 管线同名约定），章节 id 经 `chapter`/`chapterId` 字段携带。
    emit({
      stage: 'chapter_done',
      level: ok ? 'success' : 'warn',
      message: ok
        ? `✓ 第 ${chapterIndex}/${chapterTotal} 章完成（${content.length} chars${rewritten ? ` · 审稿后重写${reviewRounds > 1 ? `（${reviewRounds} 轮）` : ''}` : reviewed ? ` · 审稿通过${reviewRounds > 1 ? `（${reviewRounds} 轮）` : ''}` : ''}）`
        : `✗ 第 ${chapterIndex}/${chapterTotal} 章失败：${lastErr}`,
      progress: 72 + Math.round(((i + 1) / Math.max(1, chapterTotal)) * 22),
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

  // ── Phase E+: 终审 pass（全文一致性，R192/R193）─────────────────────
  // 逐章审稿只看单章三维度；章节是独立生成的，跨章问题（术语/缩写不一致、
  // 章间结论矛盾、同一 PDB/文献两章给出不同数字、内容大段重复）只有通读
  // 全文才能发现。终审 agent 一次通读 → 高严重度问题（矛盾/数字冲突）
  // 触发「外科修正」（最小化重写该章，保标题保图片行，上限 2 章）；
  // 低严重度（术语统一建议）R193 起升级为 termFixes 确定性全局替换
  // （LLM 只给 from→to 清单，替换由代码执行：零幻觉、可控、可统计）。
  // 基础评估模式同样适用（跨章一致性与是否有科学问题无关）；章节数
  // <3 时不值得终审（跨章问题无从谈起）。
  // R193 建议 2（配额感知降级 level-3）：transientHits ≥6 时跳过终审
  //（章节交付优先，全文一致性检查让位）。
  // R193 建议 4（外科目标多数派共识）：终审把 chapterTitle 指向「与多
  // 数章节矛盾的少数派章」并给出 consensus（多数派确切表述）—— 修少数
  // 派即对齐全局；同一章涉及的多条意见合并为一次外科修正（防多次重写
  // 互相覆盖，也省配额）。
  const finalReview = { ok: false, issues: 0, high: 0, rewrites: 0, termFixes: 0, termReplacements: 0 };
  if (transientHits >= 6) {
    emit({ stage: 'final-review', level: 'info', message: `配额降级：已遇 ${transientHits} 次限流/瞬态错误，跳过终审（直接组装交付）`, progress: 94 });
  } else if (chapters.filter(ch => ch.ok).length >= 3) {
    try {
      emit({ stage: 'final-review', level: 'info', message: `终审 agent 通读全部章节，检查跨章一致性（术语统一 / 结论矛盾 / 数字冲突）…`, progress: 94 });
      const docForReview = chapters
        .filter(ch => ch.ok)
        .map(ch => `【${ch.title}】\n${ch.content.slice(0, 2600)}${ch.content.length > 2600 ? '\n（本章已截断）' : ''}`)
        .join('\n\n')
        .slice(0, 26000);
      const frSystem = `你是结构生物学报告的终审编辑。报告各章已由逐章审稿人把关过单章质量，你只负责「章间一致性」—— 通读全文找跨章问题。只输出 JSON，不要其他文字。`;
      const frUser = `${hasQuestion ? `科学问题：${question}\n\n` : ''}报告全文（每章可能被截断）：

${docForReview}

请检查并输出 JSON：
{
  "verdict": "pass"|"issues",
  "issues": [{"chapterTitle": "需要修正的章节标题（=与多数章节矛盾的少数派章；必须与上文【】内标题完全一致）", "severity": "high"|"low", "note": "问题描述 + 具体修正指令", "consensus": "多数章节一致的确切表述（矛盾/数字冲突类必填，如某 PDB 的正确突变型/分辨率/方法）"}],
  "termFixes": [{"from": "文中实际出现的不统一叫法（精确字符串）", "to": "统一后的叫法"}]
}

检查范围（只查跨章问题，单章深度/论证已有审稿人负责）：
- 术语/缩写不一致：同一概念两种叫法混用（如某章用缩写、另一章用全称且未对照）
- 章间结论矛盾：A 章与 B 章对同一事实给出相反判断
- 数字冲突：同一 PDB 结构/文献/评分在两章给出不同数字
- 内容大段重复：两章讲同一件事且篇幅均不小

规则：
- 最多 5 条 issue；只报确实存在的问题，拿不准的不报
- high = 必须修正（矛盾 / 数字冲突）；low = 建议性（术语统一）
- 章间矛盾/数字冲突时：chapterTitle 必须指向「与多数章节说法不一致的少数派章节」（修正少数派即对齐全局），并在 consensus 给出多数派的确切表述（含具体数字/ID）
- low 的术语不统一若可全局安全替换（纯术语字符串、无歧义、不是句子片段），额外给出 termFixes；from 必须是文中出现过的精确字符串；termFixes 最多 5 条
- termFixes 示例：全文中「奥希替尼」与「Osimertinib」两种叫法混用时 → {"from": "奥希替尼", "to": "奥希替尼（Osimertinib）"}（from 逐字取自文中实际出现的写法，to 是统一后的写法）
- 没有跨章问题时 verdict=pass、issues=[]、termFixes=[]`;
      const frRun = await generateJson(frSystem, frUser, { maxChars: 1600, llm: llmCfg, signal });
      llmTotalMs += frRun.durationMs;
      if (frRun.provider) llmProvider = frRun.provider;
      if (frRun.model) llmModel = frRun.model;
      const fr = frRun.parsed;
      if (fr && typeof fr === 'object' && Array.isArray(fr.issues)) {
        finalReview.ok = true;
        const issues = (fr.issues as any[])
          .filter(it => it && typeof it === 'object' && typeof it.note === 'string' && it.note.trim())
          .slice(0, 5)
          .map(it => ({
            chapterTitle: String(it.chapterTitle || '').trim(),
            severity: String(it.severity || 'low') === 'high' ? 'high' : 'low',
            note: String(it.note).slice(0, 400),
            // R193 建议 4: 多数派确切表述 —— 注入外科修正 prompt，防修正
            // 方向猜错（修少数派时必须对齐到多数派说法）。
            consensus: typeof it.consensus === 'string' ? it.consensus.slice(0, 300) : '',
          }));
        finalReview.issues = issues.length;
        finalReview.high = issues.filter(it => it.severity === 'high').length;
        // R193 建议 3: termFixes 解析（low 术语统一的确定性 from→to 清单，
        // 替换在外科修正之后统一执行 —— 外科重写可能重新引入旧叫法）。
        const termFixesRaw = Array.isArray((fr as Record<string, unknown>).termFixes)
          ? ((fr as Record<string, unknown>).termFixes as unknown[])
          : [];
        if (issues.length === 0 && termFixesRaw.length === 0) {
          emit({ stage: 'final-review', level: 'success', message: `✓ 终审通过：未发现跨章一致性问题`, progress: 95 });
        } else {
          if (issues.length > 0) {
            emit({
              stage: 'final-review',
              level: finalReview.high > 0 ? 'warn' : 'info',
              message: `终审发现 ${issues.length} 个跨章问题（high ${finalReview.high} / low ${issues.length - finalReview.high}）：${issues.map(it => `「${it.chapterTitle || '未指明章节'}」${it.note.slice(0, 60)}`).join('；').slice(0, 300)}`,
              progress: 95,
            });
          }
          // 外科修正（R193 建议 4 升级）：只处理 high（矛盾/数字冲突），
          // 按「修正目标章」分组 —— 同一章涉及的多条矛盾合并为一次外科
          // 修正（共享 consensus、防多次重写互相覆盖、省配额）；组数上限
          // 2。修正是「最小化编辑」而非重写（保标题/保论证结构/保图片行
          // 原样），失败保留原文，绝不倒退。
          const highIssues = issues.filter(it => it.severity === 'high');
          const surgGroups = new Map<string, { ch: DshChapterResult; notes: string[]; consensusList: string[] }>();
          for (const it of highIssues) {
            // R196 bug 修复：chapterTitle 为空时 `''.includes` 语义会命中
            // 第一个 ok 章（任何 s.includes('') 恒真）—— 无关章节被外科
            // 重写。空标题直接跳过（issues filter 只验 note 非空）。
            if (!it.chapterTitle) {
              emit({ stage: 'final-review', level: 'info', message: `终审意见未指明章节（chapterTitle 为空），跳过该条修正`, progress: 95 });
              continue;
            }
            const ch = chapters.find(x => x.ok && (x.title === it.chapterTitle || x.title.includes(it.chapterTitle) || it.chapterTitle.includes(x.title)));
            if (!ch) {
              emit({ stage: 'final-review', level: 'info', message: `终审意见未匹配到章节（「${it.chapterTitle}」），跳过该条修正`, progress: 95 });
              continue;
            }
            const g = surgGroups.get(ch.title) || { ch, notes: [], consensusList: [] };
            g.notes.push(it.note);
            if (it.consensus) g.consensusList.push(it.consensus);
            surgGroups.set(ch.title, g);
          }
          let surgDone = 0;
          // R194 建议 4（外科上限动态化）：R193 实测 4 个 high 修 2 章后余
          // 2 条仅记录。若 high 矛盾分散在互不相同的少数派章（分组 ≥3），
          // 每修一章消一条矛盾 —— 上限放宽到 3；矛盾集中（分组 ≤2）保持
          // 2，防连环外科吃配额。
          const surgCap = surgGroups.size >= 3 ? 3 : 2;
          for (const [, g] of surgGroups) {
            if (surgDone >= surgCap) {
              emit({ stage: 'final-review', level: 'info', message: `外科修正章数达上限（${surgCap}${surgCap === 3 ? ' · 矛盾分散已放宽' : ''}），其余意见仅记录（终审意见已存 provenance）`, progress: 95 });
              break;
            }
            if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
            const ch = g.ch;
            emit({ stage: 'final-review', level: 'info', message: `按终审意见外科修正「${ch.title}」（${g.notes.length} 条意见合并处理）…`, progress: 95 });
            const surgSystem = `你是结构生物学报告的资深编辑，做最小化外科修正 —— 只解决指定问题，绝不重写全文。`;
            const surgPrompt = `报告终审发现章节「${ch.title}」存在跨章一致性问题，需要最小化修正。

终审意见（必须全部解决）：
${g.notes.map((n, i) => `${i + 1}. ${n}`).join('\n')}${g.consensusList.length > 0 ? `\n\n全文多数章节的一致表述（修正后必须与之对齐）：${g.consensusList.join('；')}` : ''}

当前章节内容：
${ch.content}

修正要求：
- 只修正终审意见指出的问题及其直接关联句，其余内容（论证结构、数据引用、图片行）原样保留
- 若给出了「全文多数章节的一致表述」，修正后的表述必须与之完全一致（含具体数字/ID）
- 第一行仍必须是 \`## ${ch.title}\`
- 图片 Markdown 行（以 ! 开头的行）必须逐字原样保留，不得改动任何 URL
- 只输出修正后的完整章节（不要解释你改了什么）`;
            try {
              const rs = await generateText(surgSystem, surgPrompt, { maxChars: Math.min(14000, Math.max(6000, ch.content.length + 2000)), llm: llmCfg, signal });
              llmTotalMs += rs.durationMs;
              if (rs.provider) llmProvider = rs.provider;
              if (rs.model) llmModel = rs.model;
              if (!rs.ok) noteTransient(rs.error || ''); // R193: 配额压力计数
              if (rs.ok) {
                const vs = validateDshChapter(ch.title, rs.content);
                if (vs.ok) {
                  let newContent = normalizeDshChapter(rs.content, ch.title);
                  const figsForCh = figures.filter(f => f.status === 'verified' && f.sectionId === ch.id).slice(0, 3);
                  newContent = maintainChapterFigures(newContent, figsForCh, figures).content;
                  ch.content = newContent;
                  ch.rewritten = true;
                  finalReview.rewrites++;
                  surgDone++;
                  emit({ stage: 'final-review', level: 'success', message: `✓ 「${ch.title}」外科修正完成（${newContent.length} chars）`, progress: 95 });
                } else {
                  emit({ stage: 'final-review', level: 'warn', message: `⚠ 「${ch.title}」修正版未通过格式校验（${vs.reason}），保留原文`, progress: 95 });
                }
              } else {
                emit({ stage: 'final-review', level: 'warn', message: `⚠ 「${ch.title}」修正调用失败，保留原文`, progress: 95 });
              }
            } catch (err: any) {
              if (err?.name === 'AbortError') throw err;
              emit({ stage: 'final-review', level: 'warn', message: `⚠ 「${ch.title}」外科修正异常（保留原文）：${err?.message?.slice(0, 80) ?? 'unknown'}`, progress: 95 });
            }
          }
          // R193 建议 3（termFixes 确定性术语统一）：外科修正之后收尾执行
          // —— 全局 from→to 替换由代码完成（LLM 只出清单，见 applyTermFixes
          // 的安全规则：图片行逐字保护、URL 防御、from≥2）。
          const fixResult = applyTermFixes(chapters, termFixesRaw);
          for (const a of fixResult.applied) {
            finalReview.termFixes++;
            finalReview.termReplacements += a.count;
            emit({ stage: 'final-review', level: 'info', message: `术语统一（确定性替换）：「${a.from}」→「${a.to}」，全文 ${a.count} 处`, progress: 95 });
          }
          // termFixes 全部无效且无 issues 时补一条通过消息（消息流完整性）。
          if (issues.length === 0 && finalReview.termFixes === 0) {
            emit({ stage: 'final-review', level: 'success', message: `✓ 终审通过：未发现跨章一致性问题`, progress: 95 });
          }
        }
      } else {
        // R193: 区分归因 —— 429/瞬态错误计入配额压力（E2E 实测终审死于
        // 429 却被误报为「JSON 解析失败」，且未触发配额降级计数）。
        const frTransient = isTransientLlmError(frRun.error || '');
        if (frTransient) noteTransient(frRun.error || '');
        emit({ stage: 'final-review', level: 'info', message: frTransient ? `终审 LLM 调用失败（限流/瞬态，已计入配额压力），跳过终审（保留全文原稿）` : `终审 JSON 解析失败，跳过终审（保留全文原稿）`, progress: 95 });
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') throw err;
      // 终审绝不阻截报告交付 —— 任何异常降级为跳过。
      emit({ stage: 'final-review', level: 'warn', message: `⚠ 终审异常（跳过终审，保留全文原稿）：${err?.message?.slice(0, 100) ?? 'unknown'}`, progress: 95 });
    }
  }
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');

  // ── Phase F: 组装 + 持久化（96-100%）─────────────────────────────────
  emit({ stage: 'assemble', level: 'info', message: `组装 DSH 报告并持久化…`, progress: 96 });
  const verifiedFigures = figures.filter(f => f.status === 'verified');
  const chaptersOk = chapters.filter(ch => ch.ok).length;
  const chaptersFailed = chapters.length - chaptersOk;

  // R187: 附录只收「未嵌入任何章节正文」的溢出配图（每章 ≤3 张之外的），
  // 且图片语法统一走消毒后的 figureImageMarkdown —— 旧版把全部图无条件
  // 堆进附录，造成「附录有、正文无」的错位感；alt 含化学名方括号时还会
  // 整图渲染失败（markdown 图片语法不允许裸 ]）。
  const embeddedUrls = new Set(
    chapters.flatMap(ch => (ch.content.match(/https:\/\/[^\s)]+/g) || []) as string[]),
  );
  const galleryFigs = verifiedFigures.filter(f => !embeddedUrls.has(f.url));
  const gallery = galleryFigs.length > 0
    ? `\n\n## 附：其余报告配图（未嵌入正文）\n\n${galleryFigs.map(f => `${figureImageMarkdown(f)}\n\n- ${f.caption}（来源：${f.source || (f.kind === 'rcsb' ? 'RCSB PDB' : 'web image search')}）`).join('\n\n')}`
    : '';
  // R189: 空问题时标题不含「科学问题」引用块，标注基础评估口径。
  const header = hasQuestion
    ? `# ${c.uniprotInfo.proteinName}（${uniprot}）靶点评估报告 — DSH 模式\n\n> 科学问题：${question}\n\n`
    : `# ${c.uniprotInfo.proteinName}（${uniprot}）靶点评估报告 — DSH 模式（基础评估）\n\n`;
  const rawReport = header + chapters.map(ch => ch.content).join('\n\n') + gallery;
  const finalReport = sanitizeReport(rawReport);
  const reportOk = chaptersOk > 0;

  // 持久化 1/2：SkillEvaluationReport。R183 三级写入 + R190 stale 预检测
  // （⓪ 预检测 → ① Prisma → ② compat 自愈重试 → ③ raw SQL 兜底）——治
  // stale client 的 Unknown argument 与缺表/缺列两类 Invalid invocation
  // （见 persistDshReportRecord 注释）。
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
    (msg, level) => emit({ stage: 'write-db', level: level ?? 'warn', message: msg, progress: 97 }),
  );
  if (persistOk) {
    dbSaved = true;
  } else {
    emit({ stage: 'write-db', level: 'warn', message: 'SkillEvaluationReport 三级写入均失败（报告内容仍随 done 帧交付并回写 Evaluation）', progress: 97 });
  }

  // 持久化 2/2：Evaluation.report + provenance-lite（raw SQL，schema-drift 免疫）。
  // R189: 审查环统计（done 消息 / provenance 共用）；relevanceRun 已移入
  // hasQuestion 分支，这里用 relevanceRunParsed 标量替代作用域外的引用。
  const reviewedCount = chapters.filter(ch => ch.reviewed).length;
  const rewrittenCount = chapters.filter(ch => ch.rewritten).length;
  const reviewRoundsTotal = chapters.reduce((s, ch) => s + (ch.reviewRounds || 0), 0);
  // R195 建议 3: 审稿轮次轨迹（复审锚效果度量 —— capped 占比高 = 锚没
  // 把「2 轮 rewrite 保留」比例压下来，是下轮迭代信号）。
  const reviewTrajectory = chapters
    .filter(ch => (ch.reviewRounds || 0) > 0)
    .map(ch => ({ id: ch.id, rounds: ch.reviewRounds || 0, rewritten: !!ch.rewritten, capped: !!ch.reviewCapped }));
  // R195 建议 4: 篇幅膨胀率（ratio > 1.6 的章数；references 确定性章不在
  // lengthStats 内）。
  const inflatedChapters = lengthStats.filter(s => s.ratio > 1.6).length;
  // R193 建议 5: 深挖篇幅占比 —— 口径「深挖章 /（全部章 − 参考文献）」
  //（见 deepShareStats：references 列表章不进分母）。done 消息与
  // provenance 统一用新口径。
  const ds = deepShareStats(chapters, rules.baselineIds, hasQuestion);
  const deepShare = ds.deepShare;
  try {
    const provenanceLite = JSON.stringify({
      mode: 'dsh',
      questionDriven: hasQuestion,
      question,
      sessionId,
      phases: {
        collect: { directPdbCount: c.directPdbCount, blastHitCount: c.blastHitCount, literatureCount: c.literature.length },
        relevance: { ok: relevanceRunParsed, findings: relevance?.findings?.length ?? 0, keyPicks: relevance?.keyPicks?.length ?? 0 },
        outline: { total: outline.length, ids: outline.map(o => o.id) },
        figures: { verified: verifiedFigures.length },
        chapters: { ok: chaptersOk, failed: chaptersFailed, deepChars: ds.deepChars, bodyChars: ds.bodyChars, deepShare: ds.deepShare, lengthStats: { inflated: inflatedChapters, entries: lengthStats } },
        review: { reviewed: reviewedCount, rewritten: rewrittenCount, rounds: chapters.reduce((s, ch) => s + (ch.reviewRounds || 0), 0), skippedReview: skippedReviewChapters, skippedReReview: skippedReReviewChapters, trajectory: reviewTrajectory },
        finalReview: { ...finalReview },
        // R193 建议 2: 配额压力与降级痕迹入 provenance（事后可追溯哪次运行
        // 被降级、降了哪几档）。
        quota: { transientHits, degradedReview: transientHits >= 2, skippedReview: transientHits >= 4, skippedFinalReview: transientHits >= 6 },
      },
      llm: { provider: llmProvider, model: llmModel, durationMs: llmTotalMs, transientHits },
      generatedAt: new Date().toISOString(),
    });
    // R196 bug 修复：全灭场景（配额耗尽 12 章全败）不再把 report 置 NULL
    // —— 旧行为会清空该 UniProt 此前成功评估保存的报告（collect 阶段的
    // upsert 特意保留 report/provenance，此处必须同口径）；provenance
    // 照常回写供事后归因。
    if (reportOk) {
      await db.$executeRaw`UPDATE Evaluation SET report = ${finalReport}, provenance = ${provenanceLite}, updatedAt = CURRENT_TIMESTAMP WHERE uniprotId = ${uniprot}`;
    } else {
      await db.$executeRaw`UPDATE Evaluation SET provenance = ${provenanceLite}, updatedAt = CURRENT_TIMESTAMP WHERE uniprotId = ${uniprot}`;
    }
    dbSaved = true;
  } catch (err: any) {
    emit({ stage: 'write-db', level: 'warn', message: `Evaluation 报告回写失败：${prismaErrReason(err)}`, progress: 97 });
  }

  emit({
    stage: 'done',
    level: reportOk ? 'success' : 'error',
    message: reportOk
      ? `✓ DSH 报告完成：${chaptersOk}/${chapters.length} 章 · ${finalReport.length} chars · 配图 ${verifiedFigures.length} 张${hasQuestion ? ` · 审稿 ${reviewedCount} 章（重写 ${rewrittenCount} · 共 ${reviewRoundsTotal} 轮${skippedReviewChapters + skippedReReviewChapters > 0 ? ` · 配额降级跳过 ${skippedReviewChapters + skippedReReviewChapters} 章` : ''}）· 深挖占比 ${deepShare}%（排除参考文献口径）${inflatedChapters > 0 ? ` · 篇幅超限 ${inflatedChapters} 章（观察项）` : ''}` : ' · 基础评估模式'}${finalReview.ok ? ` · 终审 ${finalReview.issues ? `${finalReview.issues} 项问题（外科修正 ${finalReview.rewrites} 章${finalReview.termFixes > 0 ? ` · 术语统一 ${finalReview.termFixes} 项（${finalReview.termReplacements} 处）` : ''}）` : '通过'}` : ''}${transientHits > 0 ? ` · 限流退避 ${transientHits} 次${transientHits >= 2 ? '（已自动降级审查深度）' : ''}` : ''}`
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
