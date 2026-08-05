/**
 * 每日结构生物学文献获取 — faithful port of the user's daily Hermes workflow.
 *
 * Reproduction of the actual pipeline that has been running 5/21 → present
 * (39 days), output written to:
 *
 *   /Users/lijing/Documents/my_note/LLM-Wiki/daily-reports/structural-biology/
 *     ├── index.md                              ← master index
 *     └── YYYY-MM-DD/
 *         └── index.md                          ← daily report (all papers inline)
 *
 * Pipeline (mirrors the real one):
 *   1. **Two-path PubMed candidate search** (±3 day window around `date`):
 *      - Path A (MeSH + method keywords): ~300 candidates
 *      - Path B (high-IF journals + method keywords): ~30 candidates
 *   2. **Filter**: keep only papers with at least one of {Cryo-EM, X-ray,
 *      NMR, AlphaFold} in the method/title/abstract. Deduplicate by PMID.
 *   3. **Method classification**: parse title/abstract for explicit method
 *      mentions. Default to 'Other' if nothing found.
 *   4. **LLM 中文概要**: for each surviving paper, ask the LLM to produce
 *      a 1-paragraph Chinese research summary (中文研究概要).
 *   5. **Persist**:
 *      - PubMedArticle rows (source='结构生物学文献日报')
 *      - Daily folder index.md (stats + paper list + executive summary)
 *      - Master index.md (updated with new date at top)
 *   6. **Return** the canonical paths so the UI can show where the files
 *      were written.
 */

import { db } from './db';
import { decodeJsonEscapes } from './pdb-utils';
import { llmComplete, LlmConfig } from './llm';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

// ─── File system layout ──────────────────────────────────────────────────────

const WIKI_ROOT = '/Users/lijing/Documents/my_note/LLM-Wiki';
const SB_ROOT = path.join(WIKI_ROOT, 'daily-reports', 'structural-biology');

// ─── Search queries (faithful to the existing real-world config) ─────────────

/** Path A — MeSH + method keywords. ~300 candidates per ±3 day window. */
const PATH_A_QUERY = `(
  ("cryo-electron microscopy"[MeSH Terms] OR "cryo-EM"[Title/Abstract]
   OR "X-ray crystallography"[MeSH Terms] OR "crystallography, X-Ray"[Title/Abstract]
   OR "nuclear magnetic resonance, biomolecular"[MeSH Terms] OR "NMR"[Title/Abstract]
   OR "AlphaFold"[Title/Abstract])
  AND ("protein structure"[MeSH Terms] OR "protein conformation"[MeSH Terms]
       OR "structural biology"[Title/Abstract] OR "macromolecular structure"[Title/Abstract]
       OR "protein structure"[Title/Abstract]))
`;

/** Path B — high-IF journals + method keywords. ~30 candidates. */
const PATH_B_QUERY = `(
  ("Nature"[Journal] OR "Science"[Journal] OR "Cell"[Journal]
   OR "Nature Communications"[Journal] OR "Nature Structural & Molecular Biology"[Journal]
   OR "Nature Methods"[Journal] OR "Nature Biotechnology"[Journal]
   OR "Molecular Cell"[Journal] OR "Cell Research"[Journal]
   OR "PNAS"[Journal] OR "Proceedings of the National Academy of Sciences"[Journal]
   OR "Science Advances"[Journal] OR "Cell Host & Microbe"[Journal]
   OR "Structure"[Journal] OR "Current Biology"[Journal]
   OR "eLife"[Journal] OR "PLOS Biology"[Journal])
  AND ("cryo-EM"[Title/Abstract] OR "cryo-electron microscopy"[Title/Abstract]
       OR "X-ray crystallography"[Title/Abstract] OR "X-ray structure"[Title/Abstract]
       OR "NMR"[Title/Abstract] OR "AlphaFold"[Title/Abstract]
       OR "protein structure"[Title/Abstract] OR "structural biology"[Title/Abstract]))
`;

// ─── Method classification ────────────────────────────────────────────────────

const METHOD_KEYWORDS: Array<{ method: string; regex: RegExp }> = [
  { method: 'Cryo-EM', regex: /\b(cryo-?em|cryo-?electron|cryo electron microscopy|electron microscopy|EM structure|EM density|single[- ]particle)\b/i },
  { method: 'X-ray', regex: /\b(X[- ]ray|X-ray crystallography|crystal structure|crystallography|crystallographic|diffraction)\b/i },
  { method: 'NMR', regex: /\b(NMR|nuclear magnetic resonance|NMR spectroscopy|NMR structure)\b/i },
  { method: 'AlphaFold', regex: /\b(AlphaFold|ESMFold|RoseTTAFold|Chai-1|protein structure prediction|fold prediction)\b/i },
];

function classifyMethod(text: string): string | null {
  if (!text) return null;
  // Return the FIRST matching method (priority: Cryo-EM > X-ray > NMR > AlphaFold,
  // matching the display order in the existing reports).
  for (const { method, regex } of METHOD_KEYWORDS) {
    if (regex.test(text)) return method;
  }
  return null;
}

// ─── PubMed helpers ───────────────────────────────────────────────────────────

const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

async function esearch(query: string, date: string, windowDays: number, maxResults: number): Promise<string[]> {
  // ±N day window — matches the real workflow's "±3 天" filter.
  const center = new Date(date + 'T00:00:00Z');
  const start = new Date(center);
  start.setUTCDate(start.getUTCDate() - windowDays);
  const end = new Date(center);
  end.setUTCDate(end.getUTCDate() + windowDays);

  const fmt = (d: Date) => `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`;

  const url = new URL(`${EUTILS}/esearch.fcgi`);
  url.searchParams.set('db', 'pubmed');
  url.searchParams.set('term', query);
  url.searchParams.set('mindate', fmt(start));
  url.searchParams.set('maxdate', fmt(end));
  url.searchParams.set('datetype', 'pdat');
  url.searchParams.set('retmax', String(maxResults));
  url.searchParams.set('retmode', 'json');
  url.searchParams.set('sort', 'relevance');

  const res = await fetch(url.toString(), {
    headers: { 'User-Agent': 'pdb-tracker-web-v3/1.0' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`eSearch ${res.status}: ${await res.text().catch(() => '')}`);
  const json: any = await res.json();
  return json?.esearchresult?.idlist || [];
}

interface FetchedPaper {
  pmid: string;
  title: string;
  authors: string;
  journal: string;
  abstract: string;
  pubYear: string;
  pubMonth: string;
  pubDay: string;
  doi: string;
}

function parseArticle(xml: string): FetchedPaper | null {
  const pmid = xml.match(/<PMID[^>]*>([\s\S]*?)<\/PMID>/)?.[1]?.trim();
  if (!pmid) return null;

  const titleMatch = xml.match(/<ArticleTitle[^>]*>([\s\S]*?)<\/ArticleTitle>/);
  const title = titleMatch?.[1]?.replace(/<[^>]+>/g, '').trim() || '';

  const authorBlock = xml.match(/<AuthorList[^>]*>([\s\S]*?)<\/AuthorList>/)?.[1] || '';
  const authorRe = /<Author[^>]*>([\s\S]*?)<\/Author>/g;
  const authors: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = authorRe.exec(authorBlock))) {
    const inner = m[1];
    const collective = inner.match(/<CollectiveName[^>]*>([\s\S]*?)<\/CollectiveName>/)?.[1];
    if (collective) {
      authors.push(collective.replace(/<[^>]+>/g, '').trim());
      continue;
    }
    const last = inner.match(/<LastName[^>]*>([\s\S]*?)<\/LastName>/)?.[1]?.trim() || '';
    const fore = inner.match(/<ForeName[^>]*>([\s\S]*?)<\/ForeName>/)?.[1]?.trim() || '';
    const full = `${fore} ${last}`.trim();
    if (full) authors.push(full);
  }

  const journal = xml.match(/<Journal>[\s\S]*?<Title[^>]*>([\s\S]*?)<\/Title>/)?.[1]?.trim() || '';

  const abstractMatch = xml.match(/<Abstract[^>]*>([\s\S]*?)<\/Abstract>/);
  let abstract = '';
  if (abstractMatch) {
    const parts: string[] = [];
    const txtRe = /<AbstractText(?:\s+Label="([^"]*)")?[^>]*>([\s\S]*?)<\/AbstractText>/g;
    let mm: RegExpExecArray | null;
    while ((mm = txtRe.exec(abstractMatch[1]))) {
      const label = mm[1];
      const text = mm[2].replace(/<[^>]+>/g, '').trim();
      parts.push(label ? `${label}: ${text}` : text);
    }
    abstract = parts.join('\n\n');
  }

  const pubDateMatch =
    xml.match(/<JournalIssue>[\s\S]*?<PubDate[^>]*>([\s\S]*?)<\/PubDate>/) ||
    xml.match(/<ArticleDate[^>]*>([\s\S]*?)<\/ArticleDate>/) ||
    xml.match(/<PubDate[^>]*>([\s\S]*?)<\/PubDate>/);
  const pubXml = pubDateMatch?.[1] || '';
  const year = pubXml.match(/<Year[^>]*>([\s\S]*?)<\/Year>/)?.[1]?.trim()
    || pubXml.match(/<MedlineDate[^>]*>([\s\S]*?)<\/MedlineDate>/)?.[1]?.match(/(\d{4})/)?.[1]
    || '';
  const month = pubXml.match(/<Month[^>]*>([\s\S]*?)<\/Month>/)?.[1]?.trim() || '';
  const day = pubXml.match(/<Day[^>]*>([\s\S]*?)<\/Day>/)?.[1]?.trim() || '';

  const doi = xml.match(/<ArticleId[^>]*IdType="doi"[^>]*>([\s\S]*?)<\/ArticleId>/)?.[1]?.trim() || '';

  return { pmid, title, authors: authors.join(', '), journal, abstract, pubYear: year, pubMonth: month, pubDay: day, doi };
}

async function efetch(pmids: string[]): Promise<FetchedPaper[]> {
  if (pmids.length === 0) return [];
  const out: FetchedPaper[] = [];
  for (let i = 0; i < pmids.length; i += 50) {
    const batch = pmids.slice(i, i + 50);
    const url = new URL(`${EUTILS}/efetch.fcgi`);
    url.searchParams.set('db', 'pubmed');
    url.searchParams.set('id', batch.join(','));
    url.searchParams.set('rettype', 'xml');
    url.searchParams.set('retmode', 'xml');
    const res = await fetch(url.toString(), {
      headers: { 'User-Agent': 'pdb-tracker-web-v3/1.0' },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) throw new Error(`eFetch ${res.status}: ${await res.text().catch(() => '')}`);
    const xml = await res.text();
    const articleChunks = xml.split('<PubmedArticle>').slice(1);
    for (const chunk of articleChunks) {
      const end = chunk.indexOf('</PubmedArticle>');
      if (end < 0) continue;
      const articleXml = '<PubmedArticle>' + chunk.slice(0, end);
      const paper = parseArticle(articleXml);
      if (paper) out.push(paper);
    }
    if (i + 50 < pmids.length) await new Promise(r => setTimeout(r, 350));
  }
  return out;
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

// ─── Database persistence ─────────────────────────────────────────────────────

async function upsertPapers(papers: FetchedPaper[]): Promise<{ inserted: number; updated: number }> {
  let inserted = 0, updated = 0;
  for (const p of papers) {
    const titleJson = JSON.stringify(p.title);
    const authorsJson = JSON.stringify(p.authors);
    const abstractJson = JSON.stringify(p.abstract);

    await db.$executeRaw`
      INSERT INTO PubMedArticle (pubmedId, title, authors, journal, pubYear, pubMonth, pubDay, abstract, createdAt)
      VALUES (${p.pmid}, ${titleJson}, ${authorsJson}, ${p.journal}, ${p.pubYear}, ${p.pubMonth}, ${p.pubDay}, ${abstractJson}, CURRENT_TIMESTAMP)
      ON CONFLICT(pubmedId) DO UPDATE SET
        title = excluded.title,
        authors = excluded.authors,
        journal = excluded.journal,
        pubYear = COALESCE(NULLIF(excluded.pubYear, ''), PubMedArticle.pubYear),
        pubMonth = COALESCE(NULLIF(excluded.pubMonth, ''), PubMedArticle.pubMonth),
        pubDay = COALESCE(NULLIF(excluded.pubDay, ''), PubMedArticle.pubDay),
        abstract = COALESCE(NULLIF(excluded.abstract, ''), PubMedArticle.abstract)
    `;
    // The DB has no `source` column in the production schema (despite
    // prisma advertising it). We still attempt the UPDATE and silently
    // ignore if the column doesn't exist.
    try {
      await db.$executeRawUnsafe(`UPDATE PubMedArticle SET source = ? WHERE pubmedId = ?`, '结构生物学文献日报', p.pmid);
    } catch {/* column may not exist; ignore */}

    const row = await db.$queryRawUnsafe<any[]>(`SELECT createdAt FROM PubMedArticle WHERE pubmedId = ?`, p.pmid);
    const isFresh = row[0] && row[0].createdAt && (Date.now() - new Date(row[0].createdAt).getTime()) < 5000;
    if (isFresh) inserted++; else updated++;
  }
  return { inserted, updated };
}

// ─── LLM Chinese summary generation ──────────────────────────────────────────

interface SummarizedPaper extends FetchedPaper {
  method: string;
  summaryCn: string;
  doi: string;
  isHighIF: boolean;
}

async function generateSummaries(papers: FetchedPaper[], llmCfg?: LlmConfig): Promise<SummarizedPaper[]> {
  const out: SummarizedPaper[] = [];
  // Process in small batches of 5 to keep prompts manageable. The LLM
  // returns one summary per line (in the same order).
  const BATCH = 5;
  for (let i = 0; i < papers.length; i += BATCH) {
    const batch = papers.slice(i, i + BATCH);
    const lines = batch.map((p, idx) => `[${idx + 1}] PMID:${p.pmid}\n标题: ${p.title}\n期刊: ${p.journal}\n摘要: ${(p.abstract || '').slice(0, 1200)}`).join('\n\n');

    const system = 'You are a structural biology expert who writes concise Chinese research summaries (中文研究概要) for daily literature digests. Each summary should be 2-4 sentences, focus on the structural mechanism / methodology, and avoid hedging language. Output exactly N lines, each starting with the paper number in brackets, no extra commentary.';
    const prompt = `请为下面 ${batch.length} 篇结构生物学论文分别撰写中文研究概要。每篇 2-4 句话，重点说明：①研究问题 ②关键结构/方法发现 ③创新点。

${lines}

输出格式（每篇一行，不要其他内容）：
[1] 中文概要
[2] 中文概要
...`;

    const r = await llmComplete(prompt, { ...llmCfg, system });
    const summaries: string[] = [];
    if (r.ok && r.text) {
      // Parse [N] summary lines from the LLM output.
      const re = /\[(\d+)\]\s*([\s\S]*?)(?=\[\d+\]|$)/g;
      let mm: RegExpExecArray | null;
      while ((mm = re.exec(r.text))) {
        const idx = parseInt(mm[1], 10) - 1;
        summaries[idx] = mm[2].trim();
      }
    }

    for (let j = 0; j < batch.length; j++) {
      const p = batch[j];
      const text = `${p.title}\n${p.abstract}`;
      const method = classifyMethod(text) || 'Other';
      const isHighIF = /^(Nature|Science|Cell|Nature Communications|Nature Structural|Nature Methods|Nature Biotechnology|Molecular Cell|Cell Research|Science Advances|Structure|Current Biology|eLife|PLOS Biology|Proceedings of the National Academy of Sciences)/i.test(p.journal);
      out.push({
        ...p,
        method,
        summaryCn: summaries[j] || '（摘要生成中或失败）',
        doi: p.doi,
        isHighIF,
      });
    }
  }
  return out;
}

// ─── Markdown generation ──────────────────────────────────────────────────────

function formatDateLabel(date: string): string {
  return date;
}

function formatPaperSection(p: SummarizedPaper, index: number, highlightStar: boolean): string {
  const journalDisplay = p.isHighIF ? `**${p.journal}**` : p.journal;
  const star = highlightStar ? ' ⭐' : '';
  const doiLine = p.doi ? `\n**DOI**: ${p.doi}` : '';
  return `### ${index}. ${p.title}${star}

📖 **PMID**: ${p.pmid} | ${journalDisplay} | 🔬 **${p.method}**${doiLine}
🔗 [PubMed](https://pubmed.ncbi.nlm.nih.gov/${p.pmid}/)

**研究概要**: ${p.summaryCn}

---

`;
}

function buildDailyReport(papers: SummarizedPaper[], date: string, windowDays: number, stats: { pathACount: number; pathBCount: number }): string {
  const methodStats: Record<string, number> = {};
  const journalStats: Record<string, number> = {};
  for (const p of papers) {
    methodStats[p.method] = (methodStats[p.method] || 0) + 1;
    journalStats[p.journal] = (journalStats[p.journal] || 0) + 1;
  }

  const totalCandidates = stats.pathACount + stats.pathBCount;
  const methodTable = Object.entries(methodStats)
    .sort((a, b) => b[1] - a[1])
    .map(([m, c]) => `| ${m} | ${c} |`).join('\n');
  const journalTable = Object.entries(journalStats)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([j, c]) => `| ${j} | ${c} |`).join('\n');

  // High-IF highlights: papers from Nature/Science/Cell family.
  const highlights = papers
    .filter(p => p.isHighIF)
    .slice(0, 6)
    .map(p => `- **[${p.journal.split(' ')[0]}]** ${p.title} (PMID: ${p.pmid}) — ${p.method}`)
    .join('\n');

  const paperSections = papers.map((p, idx) => {
    const isHighlight = p.isHighIF && idx < 8; // stars on the first batch of high-IF
    return formatPaperSection(p, idx + 1, isHighlight);
  }).join('\n');

  // Build a stub executive summary — this gets overwritten by LLM in stage 2.
  // Note: no `## 执行摘要` heading here — the LLM stage adds its own.
  const placeholderExec = `今日（${date}）筛选窗口（±${windowDays} 天）共纳入 ${papers.length} 篇结构生物学论文，方法分布：${Object.entries(methodStats).map(([m, c]) => `${m} ${c} 篇`).join('、')}。\n\n_执行摘要将由 LLM 在生成阶段填入（本节为占位文本）。_`;

  return `# 结构生物学文献日报 — ${date}

**报告日期**: ${date}
**筛选窗口**: ±${windowDays} 天（2026-${date.slice(5, 7)} 月前后 ±${windowDays} 天浮动）
**检索策略**: 双路径 PubMed 检索（MeSH+方法关键词 / 高 IF 期刊+方法关键词）
**最终入选**: ${papers.length} 篇结构生物学论文

## 方法分布

| 方法 | 数量 |
|------|------|
${methodTable || '| — | 0 |'}
| **合计** | **${papers.length}** |

## 期刊分布（前 12）

| 期刊 | 数量 |
|------|------|
${journalTable || '| — | 0 |'}

${highlights ? `## 高亮论文（Nature/Science/Cell 系刊）\n\n${highlights}\n\n---\n\n## 论文列表\n\n` : `## 论文列表\n\n`}${paperSections}
${placeholderExec}
`;
}

function buildExecutiveSummary(papers: SummarizedPaper[], date: string, llmCfg?: LlmConfig): Promise<string> {
  if (papers.length === 0) {
    return Promise.resolve(`## 执行摘要\n\n今日（${date}）未检索到符合条件的结构生物学论文。`);
  }
  // Top 5 papers by IF / by length, give LLM enough context to write
  // a thematic synthesis.
  const top = papers.slice(0, 8);
  const system = 'You are a structural biology expert writing a Chinese executive summary for a daily literature digest. Output ONLY the markdown section content (no surrounding headers unless needed), 3-5 paragraphs, ~500 字. Highlight thematic groupings, structural method breakthroughs, and any disease/drug relevance. Do not invent data — be precise and brief.';
  const prompt = `今日（${date}）共纳入 ${papers.length} 篇结构生物学论文（按方法分布略）。请基于以下 8 篇代表论文撰写中文执行摘要（500 字，3-5 段）：

${top.map((p, i) => `[${i + 1}] PMID ${p.pmid} (${p.journal}, ${p.method}): ${p.title}\n   概要: ${p.summaryCn.slice(0, 200)}`).join('\n\n')}

请按主题分类撰写（不要逐篇罗列），重点强调：
- 本批次最突出的结构/方法学亮点
- 跨论文的方法学趋势或主题聚类
- 与疾病机制或药物设计的关联（如有）

直接以 ## 执行摘要 开头。`;

  return llmComplete(prompt, { ...llmCfg, system }).then(r => {
    if (r.ok && r.text) {
      // Strip ALL `## 执行摘要` headings anywhere in the LLM output — we
      // always add exactly one at the top. Hermes in particular tends to
      // echo the heading inside the body, producing duplicates.
      const body = r.text
        .replace(/^#{1,3}\s*执行摘要\s*\n+/i, '')       // leading
        .replace(/\n#{1,3}\s*执行摘要\s*\n+/g, '\n\n')  // in-body echoes
        .trim();
      console.log(`[lit-daily] buildExecutiveSummary body length: ${body.length}, preview: ${body.slice(0, 200).replace(/\n/g, ' ')}`);
      return `## 执行摘要\n\n${body}\n\n_本报告由 pdb-tracker-web-v3 自动生成于 ${new Date().toISOString().replace('T', ' ').slice(0, 19)}_`;
    }
    return `## 执行摘要\n\n> ⚠️ 执行摘要生成失败: ${r.error || 'unknown'}\n\n今日（${date}）共纳入 ${papers.length} 篇结构生物学论文。详细列表见上文。\n\n_本报告由 pdb-tracker-web-v3 自动生成于 ${new Date().toISOString().replace('T', ' ').slice(0, 19)}_`;
  });
}

// ─── Master index management ──────────────────────────────────────────────────

async function updateMasterIndex(date: string): Promise<void> {
  const masterPath = path.join(SB_ROOT, 'index.md');
  let existing = '';
  try {
    existing = await fs.readFile(masterPath, 'utf-8');
  } catch {/* master doesn't exist yet */}

  // Parse out existing rows: lines of the form `| YYYY-MM-DD | [日报](...) |`.
  const rowRe = /^\|\s*(\d{4}-\d{2}-\d{2})\s*\|\s*\[日报\]\(daily-reports\/structural-biology\/(\d{4}-\d{2}-\d{2})\/index\.md\)\s*\|\s*$/gm;
  const existingDates = new Map<string, string>();
  let mm: RegExpExecArray | null;
  while ((mm = rowRe.exec(existing))) {
    existingDates.set(mm[1], mm[2]);
  }
  existingDates.set(date, date);

  const sorted = Array.from(existingDates.keys()).sort((a, b) => b.localeCompare(a));
  const rows = sorted.map(d => `| ${d} | [日报](daily-reports/structural-biology/${d}/index.md) |`).join('\n');

  const master = `# 结构生物学文献日报 - 主索引

| 日期 | 链接 |
|------|------|
${rows}
`;
  await fs.mkdir(SB_ROOT, { recursive: true });
  await fs.writeFile(masterPath, master, 'utf-8');
}

// ─── Public entry point ───────────────────────────────────────────────────────

export interface LiteratureDailyOptions {
  /** Target date (YYYY-MM-DD). Defaults to today. */
  date?: string;
  /** ±N day window. Default 3. */
  windowDays?: number;
  /** Per-path candidate cap. Default 400 (Path A) / 80 (Path B). */
  maxPathA?: number;
  maxPathB?: number;
  /** Final paper cap (after dedup + filter). Default 30. */
  maxPapers?: number;
  /** LLM config. If absent, no per-paper summary / no executive summary. */
  llm?: LlmConfig;
  /** Skip writing files to the wiki (DB only). Default false (write files). */
  skipWikiFiles?: boolean;
  /** Optional: coarse progress callback. Receives human-readable stage
   *  markers like 'esearch', 'efetch', 'persist', 'digest'. */
  onStage?: (stage: string, detail?: string) => void;
}

export interface LiteratureDailyResult {
  ok: boolean;
  date: string;
  windowDays: number;
  pathACount: number;
  pathBCount: number;
  totalCandidates: number;
  finalCount: number;
  inserted: number;
  updated: number;
  methodStats: Record<string, number>;
  files: {
    dailyDir: string;
    dailyIndex: string;
    masterIndex: string;
  };
  durationMs: number;
  error?: string;
}

export async function runLiteratureDaily(opts: LiteratureDailyOptions = {}): Promise<LiteratureDailyResult> {
  const t0 = Date.now();
  const date = opts.date || new Date().toISOString().slice(0, 10);
  const windowDays = opts.windowDays ?? 3;
  const maxA = opts.maxPathA ?? 400;
  const maxB = opts.maxPathB ?? 80;
  const maxPapers = opts.maxPapers ?? 30;
  const stage = opts.onStage || (() => {});

  try {
    stage('init', `${date} window=±${windowDays}d maxA=${maxA} maxB=${maxB} maxPapers=${maxPapers}`);
    // ─── Step 1: Two-path PubMed search ────────────────────────────────────
    stage('esearch', `PubMed path A + B for ${date}`);
    const [pathAIds, pathBIds] = await Promise.all([
      esearch(PATH_A_QUERY, date, windowDays, maxA).catch(() => [] as string[]),
      esearch(PATH_B_QUERY, date, windowDays, maxB).catch(() => [] as string[]),
    ]);
    stage('esearch-done', `pathA=${pathAIds.length} pathB=${pathBIds.length}`);

    // Dedupe, preserve Path B priority (high-IF).
    const seen = new Set<string>();
    const candidates: string[] = [];
    for (const id of [...pathBIds, ...pathAIds]) {
      if (!seen.has(id)) { seen.add(id); candidates.push(id); }
    }

    if (candidates.length === 0) {
      return {
        ok: true, date, windowDays,
        pathACount: pathAIds.length, pathBCount: pathBIds.length,
        totalCandidates: 0, finalCount: 0, inserted: 0, updated: 0,
        methodStats: {},
        files: { dailyDir: '', dailyIndex: '', masterIndex: '' },
        durationMs: Date.now() - t0,
      };
    }

    // ─── Step 2: eFetch ────────────────────────────────────────────────────
    await sleep(350);
    const rawPapers = await efetch(candidates);

    // ─── Step 3: Filter to structural biology methods ──────────────────────
    const sbPapers = rawPapers.filter(p => {
      const text = `${p.title}\n${p.abstract}`;
      return classifyMethod(text) !== null;
    });

    // Cap to top N (sort by journal IF as a proxy for relevance).
    sbPapers.sort((a, b) => {
      const aJ = highIFJournals.has(a.journal) ? 1 : 0;
      const bJ = highIFJournals.has(b.journal) ? 1 : 0;
      if (aJ !== bJ) return bJ - aJ;
      return a.title.length - b.title.length;
    });
    const limited = sbPapers.slice(0, maxPapers);

    // ─── Step 4: Persist to DB ─────────────────────────────────────────────
    stage('persist', `upserting ${limited.length} papers`);
    const { inserted, updated } = await upsertPapers(limited);
    stage('persist-done', `inserted=${inserted} updated=${updated}`);

    // ─── Step 5: LLM summaries (per-paper Chinese summaries + exec summary) ─
    stage(opts.llm ? 'llm-summarize' : 'summarize-skip', opts.llm ? `summarizing ${limited.length} papers` : 'no LLM configured');
    const summarized = opts.llm
      ? await generateSummaries(limited, opts.llm)
      : limited.map(p => {
          const text = `${p.title}\n${p.abstract}`;
          const method = classifyMethod(text) || 'Other';
          const isHighIF = /^(Nature|Science|Cell|Nature Communications|Nature Structural|Nature Methods|Nature Biotechnology|Molecular Cell|Cell Research|Science Advances|Structure|Current Biology|eLife|PLOS Biology|Proceedings of the National Academy of Sciences)/i.test(p.journal);
          return { ...p, method, summaryCn: '（未生成中文概要，未提供 LLM 配置）', doi: p.doi, isHighIF };
        });

    // ─── Step 6: Markdown output ───────────────────────────────────────────
    let dailyDir = '';
    let dailyIndex = '';
    let masterIndex = '';

    if (!opts.skipWikiFiles) {
      dailyDir = path.join(SB_ROOT, date);
      await fs.mkdir(dailyDir, { recursive: true });
      dailyIndex = path.join(dailyDir, 'index.md');
      masterIndex = path.join(SB_ROOT, 'index.md');

      let report = buildDailyReport(summarized, date, windowDays, { pathACount: pathAIds.length, pathBCount: pathBIds.length });

      if (opts.llm) {
        stage('llm-exec-summary', `executive summary for ${summarized.length} papers`);
        const exec = await buildExecutiveSummary(summarized, date, opts.llm);
        // The placeholder is a one-line italic stub ending with `_`. Strip it
        // along with anything after it, then insert the LLM-generated
        // `## 执行摘要` section.
        const placeholderLine = '_执行摘要将由 LLM 在生成阶段填入（本节为占位文本）。_';
        const phIdx = report.indexOf(placeholderLine);
        if (phIdx >= 0) {
          report = report.slice(0, phIdx).trimEnd() + '\n\n' + exec + '\n';
        } else if (report.includes('## 执行摘要')) {
          report = report.replace(/## 执行摘要[\s\S]*$/, exec);
        } else {
          report = report.trimEnd() + '\n\n' + exec + '\n';
        }
      }

      await fs.writeFile(dailyIndex, report, 'utf-8');
      await updateMasterIndex(date);
    }

    // ─── Step 7: Method stats for return ───────────────────────────────────
    const methodStats: Record<string, number> = {};
    for (const p of summarized) {
      methodStats[p.method] = (methodStats[p.method] || 0) + 1;
    }

    return {
      ok: true, date, windowDays,
      pathACount: pathAIds.length,
      pathBCount: pathBIds.length,
      totalCandidates: candidates.length,
      finalCount: summarized.length,
      inserted,
      updated,
      methodStats,
      files: { dailyDir, dailyIndex, masterIndex },
      durationMs: Date.now() - t0,
    };
  } catch (e: any) {
    return {
      ok: false, date, windowDays,
      pathACount: 0, pathBCount: 0, totalCandidates: 0, finalCount: 0,
      inserted: 0, updated: 0, methodStats: {},
      files: { dailyDir: '', dailyIndex: '', masterIndex: '' },
      durationMs: Date.now() - t0,
      error: e?.message || String(e),
    };
  }
}

const highIFJournals = new Set([
  'Nature', 'Science', 'Cell', 'Nature Communications', 'Nature Structural & Molecular Biology',
  'Nature Methods', 'Nature Biotechnology', 'Molecular Cell', 'Cell Research',
  'Science Advances', 'Cell Host & Microbe', 'Structure', 'Current Biology',
  'eLife', 'PLOS Biology', 'Proceedings of the National Academy of Sciences',
  'Nature Medicine', 'Nature Genetics', 'Nature Immunology', 'Nature Neuroscience',
  'Nature Cell Biology', 'Nature Chemical Biology',
]);