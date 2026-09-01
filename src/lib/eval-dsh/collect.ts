// src/lib/eval-dsh/collect.ts
//
// R179 (Task 2-a): DSH 模式数据收集 —— 方式与经典管线一致（复用同一批
// 外部数据源 helper），仅进度区间与返回结构不同。
//
// 复用（不重复实现）：
//   - src/lib/rcsb.ts        fetchUniprotMeta / fetchPdbIdsForUniprot /
//                            fetchPdbEntryDetails（内置 5/批并发）
//   - src/lib/blast.ts       runBlast / fetchUniprotSequence /
//                            PARALOG_IDENTITY_THRESHOLD
//   - src/lib/pubmed.ts      efetch（PubMedArticle 回填）
//   - src/lib/journal-if-map JOURNAL_IF_MAP（RCSB 缺失 IF 的本地补齐）
//
// 进度区间（与 agent.ts 的 Phase 划分对齐）：
//   uniprot-meta 4-10% → rcsb-pdbs 12-28% → blast 30-44%（若运行）→
//   pubmed 46-56%。Phase B（relevance）从 58% 开始。
//
// 上限：PDB ≤500（R187，对齐 UI）、BLAST hits ≤100、文献 ≤ maxLitCount（调用方钳制）。

import type { SseEvent } from '@/lib/sse';
import { fetchUniprotMeta, fetchPdbIdsForUniprot, fetchPdbEntryDetails, type PdbEntryDetail, type UniprotMeta } from '@/lib/rcsb';
import { runBlast, runBlastDb, fetchUniprotSequence, PARALOG_IDENTITY_THRESHOLD, type BlastHit } from '@/lib/blast';
import { efetch } from '@/lib/pubmed';
import { JOURNAL_IF_MAP } from '@/lib/journal-if-map';
import { db } from '@/lib/db';
import { Prisma } from '@prisma/client';

/** R179 (Task 2-a): SQLite $queryRaw 的 IN 占位符（空数组 → NULL，永不相等）。
 * 与经典 route 的 safeInPlaceholders 同一惯用法。 */
function safeInPlaceholders(values: Array<string | number>): Prisma.Sql {
  if (values.length === 0) return Prisma.sql`NULL`;
  return Prisma.join(values);
}

export interface CollectOpts {
  /** RCSB 直接检索上限（route 已钳制 ≤500，R187）。 */
  maxPdb?: number;
  /** BLAST 命中上限（route 已钳制 ≤100）。 */
  maxBlastHits?: number;
  /** 文献保留上限（按 IF 降序截断）。 */
  maxLitCount?: number;
  forceBlast?: boolean;
  skipBlast?: boolean;
  signal?: AbortSignal;
}

/** 简化文献行：PMID + 标题 + 期刊 + IF + 年份 + 200 字摘要。 */
export interface LiteratureRow {
  pmid: string;
  title: string;
  journal: string;
  journalIf: number | null;
  year: string;
  abstract: string;
}

export interface CollectScores {
  xray: { score: number; rating: string; structures: number; max: number };
  cryoem: { score: number; rating: string; structures: number; max: number };
  nmr: { score: number; rating: string; structures: number; max: number };
  overall: { score: number; rating: string; max: number };
}

export interface CollectResult {
  uniprotInfo: {
    uniprotId: string;
    entryName: string;
    proteinName: string;
    geneNames: string;
    organism: string;
    sequenceLength: number;
    /** R200: 序列输入路径 —— BLAST 识别信息（classic 序列模式同款字段）。 */
    blastIdentity?: number;
    blastPdbId?: string;
    blastSource?: string;
  };
  directPdbCount: number;
  pdbRows: PdbEntryDetail[];
  blastHitCount: number;
  blastRows: BlastHit[];
  coverage: number;
  skippedBlast: boolean;
  scores: CollectScores;
  literature: LiteratureRow[];
  dbSaved: boolean;
  /** R200: 序列输入模式的识别信息（UniProt 输入时为 undefined）。 */
  sequenceInfo?: SequenceInfo;
}

/** R200: Agent 模式序列输入 —— 先 BLAST 识别靶点蛋白，再复用收集管线。 */
export interface SequenceInput {
  sequence: string;
  seqType: 'aa' | 'dna';
}

/** R200: 序列识别结果摘要（SSE 日志、报告头、遥测可见）。 */
export interface SequenceInfo {
  inputType: 'aa' | 'dna';
  /** 原始输入长度（DNA 为 nt，氨基酸为 aa）。 */
  inputLength: number;
  /** 转录/直接使用的氨基酸长度。 */
  aaLength: number;
  transcribed: boolean;
  /** Top BLAST 命中 identity（%）。 */
  identity: number | null;
  /** BLAST 解析出的 UniProt accession（null = 未识别）。 */
  resolvedUniprot: string | null;
  usedNrFallback: boolean;
  topHitLabel: string;
}

/** R179 (Task 2-a): 评分等级 —— 与经典管线一致（≥8 优 / ≥6 良 / ≥4 中 / 其余 差）。 */
function scoreRating(s: number): string {
  return s >= 8 ? '优' : s >= 6 ? '良' : s >= 4 ? '中' : '差';
}

/**
 * R200: 评分计算（自 collectEvaluationData 提取，UniProt/序列两路共用）。
 * 公式与经典管线一致：min(10, round(sqrt(count)*2))，0 条 → 1 分。
 */
function computeCollectScores(pdbRows: PdbEntryDetail[]): CollectScores {
  const xrayCount = pdbRows.filter(e => (e.method || '').includes('X-RAY')).length;
  const cryoemCount = pdbRows.filter(e => (e.method || '').includes('ELECTRON')).length;
  const nmrCount = pdbRows.filter(e => (e.method || '').includes('NMR')).length;
  const calcScore = (count: number, max = 10) => Math.min(max, Math.max(1, Math.round(Math.sqrt(Math.max(0, count)) * 2)));
  const scores: CollectScores = {
    xray: { score: calcScore(xrayCount), rating: '', structures: xrayCount, max: 10 },
    cryoem: { score: calcScore(cryoemCount), rating: '', structures: cryoemCount, max: 10 },
    nmr: { score: calcScore(nmrCount), rating: '', structures: nmrCount, max: 10 },
    overall: { score: Math.min(10, Math.max(1, Math.round((calcScore(xrayCount) + calcScore(cryoemCount) + calcScore(nmrCount)) / 3))), rating: '', max: 10 },
  };
  scores.xray.rating = scoreRating(scores.xray.score);
  scores.cryoem.rating = scoreRating(scores.cryoem.score);
  scores.nmr.rating = scoreRating(scores.nmr.score);
  scores.overall.rating = scoreRating(scores.overall.score);
  return scores;
}

/** R200: 评分 emit 行（两路共用）。 */
function scoreEmitMessage(scores: CollectScores): string {
  return `overall=${scores.overall.score}/10 (X-ray=${scores.xray.score}/${scores.xray.structures}条, Cryo-EM=${scores.cryoem.score}/${scores.cryoem.structures}条, NMR=${scores.nmr.score}/${scores.nmr.structures}条)`;
}

/**
 * R200: DB 持久化（自 collectEvaluationData 提取，UniProt/序列两路共用）。
 * mirror 经典 route：raw-SQL upsert，schema-drift 免疫；report/provenance
 * 留 null —— Phase F 由 agent.ts 写回。key = 真 UniProt acc 或 SEQ_xxx。
 */
async function persistCollectRows(args: {
  key: string;
  uniprotInfo: CollectResult['uniprotInfo'];
  pdbRows: PdbEntryDetail[];
  blastRows: BlastHit[];
  coverage: number;
  scores: CollectScores;
  maxPdb: number;
  skippedBlast: boolean;
  directPdbCount: number;
  emit: (e: SseEvent) => void;
}): Promise<boolean> {
  const { key, uniprotInfo, pdbRows, blastRows, coverage, scores, maxPdb, skippedBlast, directPdbCount, emit } = args;
  try {
    emit({ stage: 'write-db', level: 'info', message: `写入数据库（Evaluation + ${pdbRows.length} PDB + ${blastRows.length} BLAST）`, progress: 57 });
    const scoresJson = JSON.stringify({
      'X-ray': { score: scores.xray.score, rating: scores.xray.rating, max: 10 },
      'Cryo-EM': { score: scores.cryoem.score, rating: scores.cryoem.rating, max: 10 },
      'NMR': { score: scores.nmr.score, rating: scores.nmr.rating, max: 10 },
      'Overall': { score: scores.overall.score, rating: scores.overall.rating, max: 10 },
    });
    // 先写父表（FK 约束），report/provenance 均为 null（Phase F 更新）。
    await db.$executeRaw`INSERT INTO Evaluation (uniprotId, entryName, proteinName, geneNames, organism, sequenceLength, coverage, scores, report, provenance, maxPdbUsed, blastWasSkipped, pdbCountAtEval, createdAt, updatedAt) VALUES (${key}, ${uniprotInfo.entryName}, ${uniprotInfo.proteinName}, ${uniprotInfo.geneNames}, ${uniprotInfo.organism}, ${uniprotInfo.sequenceLength}, ${coverage}, ${scoresJson}, null, null, ${maxPdb}, ${skippedBlast}, ${directPdbCount}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(uniprotId) DO UPDATE SET entryName = excluded.entryName, proteinName = excluded.proteinName, geneNames = excluded.geneNames, organism = excluded.organism, sequenceLength = excluded.sequenceLength, coverage = excluded.coverage, scores = excluded.scores, maxPdbUsed = excluded.maxPdbUsed, blastWasSkipped = excluded.blastWasSkipped, pdbCountAtEval = excluded.pdbCountAtEval, updatedAt = CURRENT_TIMESTAMP`;

    await db.$executeRaw`DELETE FROM EvaluationPdbStructure WHERE uniprotId = ${key}`;
    for (const e of pdbRows) {
      const isCryoem = (e.method || '').includes('ELECTRON');
      const isXray = (e.method || '').includes('X-RAY');
      const isNmr = (e.method || '').includes('NMR');
      const ifTier = e.journalIf == null ? 'unknown' : e.journalIf >= 20 ? 'top' : e.journalIf >= 10 ? 'high' : e.journalIf >= 5 ? 'mid' : 'low';
      await db.$executeRaw`INSERT INTO EvaluationPdbStructure (uniprotId, pdbId, method, resolution, title, depositionDate, releaseDate, ligand, ligandNames, journal, journalIf, doi, pubmedId, organism, authors, isCryoem, isXray, isNmr, ifTier) VALUES (${key}, ${e.pdbId}, ${e.method}, ${e.resolution}, ${e.title}, ${e.depositDate}, ${e.releaseDate}, ${e.ligands}, ${e.ligands}, ${e.journal}, ${e.journalIf}, ${e.doi}, ${e.pubmedId}, ${e.organisms}, ${e.authors}, ${isCryoem}, ${isXray}, ${isNmr}, ${ifTier})`;
    }

    await db.$executeRaw`DELETE FROM EvaluationBlastResult WHERE uniprotId = ${key}`;
    // 去重 by pdbId（blastRows 已按 identity 降序，保留首个=最高 identity）；
    // isParalog 标记 ≥95% identity 的近缘同源。
    const seenBlastPdbIds = new Set<string>();
    for (const h of blastRows) {
      if (!h.pdbId || seenBlastPdbIds.has(h.pdbId)) continue;
      seenBlastPdbIds.add(h.pdbId);
      const isParalog = h.identity >= PARALOG_IDENTITY_THRESHOLD;
      await db.$executeRaw`INSERT INTO EvaluationBlastResult (uniprotId, pdbId, uniprotRef, description, identity, evalue, queryCoverage, method, source, isParalog) VALUES (${key}, ${h.pdbId}, ${h.uniprotRef || ''}, ${h.description || ''}, ${h.identity}, ${h.evalue}, ${h.queryCoverage}, ${'BLASTp'}, ${'NCBI BLAST REST API'}, ${isParalog})`;
    }
    emit({ stage: 'write-db', level: 'success', message: `✓ 已写入 Evaluation + EvaluationPdbStructure(${pdbRows.length}) + EvaluationBlastResult(${seenBlastPdbIds.size})`, progress: 57 });
    return true;
  } catch (err: any) {
    // DB 写失败不中止 —— 报告生成仍可继续（经典 route 同语义）。
    emit({ stage: 'write-db', level: 'warn', message: `数据收集阶段 DB 写入失败（报告仍将生成）：${err?.message?.slice(0, 120) ?? 'unknown'}`, progress: 57 });
    return false;
  }
}

/**
 * R179 (Task 2-a): RCSB 未返回期刊 IF 时的本地 JOURNAL_IF_MAP 补齐。
 * 与经典 route 的 Round 49 逻辑保持一致（多级规范化匹配）。
 */
function fillJournalIf(d: PdbEntryDetail): void {
  if (d.journalIf != null || !d.journal) return;
  const j = d.journal.toLowerCase().trim();
  if (JOURNAL_IF_MAP[j]) { d.journalIf = JOURNAL_IF_MAP[j]; return; }
  const stripped = j.replace(/[^a-z0-9]/g, '');
  if (JOURNAL_IF_MAP[stripped]) { d.journalIf = JOURNAL_IF_MAP[stripped]; return; }
  const expansions: Record<string, string> = {
    'plos biol': 'plos biology',
    'plos pathog': 'plos pathogens',
    'plos comput biol': 'plos computational biology',
    'pnas': 'proc natl acad sci usa',
    'j med chem': 'j med chem',
    'j biol chem': 'j biol chem',
    'j mol biol': 'j mol biol',
    'nat commun': 'nature communications',
    'sci adv': 'science advances',
  };
  const expanded = expansions[j];
  if (expanded && JOURNAL_IF_MAP[expanded]) { d.journalIf = JOURNAL_IF_MAP[expanded]; return; }
  for (const [key, val] of Object.entries(JOURNAL_IF_MAP)) {
    if (key.startsWith(j) || j.startsWith(key)) { d.journalIf = val; break; }
  }
}

/**
 * R179 (Task 2-a): PubMedArticle 回填（复刻经典 route 的 backfillPubMedArticles，
 * 后者未导出故本地实现；同为 best-effort，失败绝不中断评估）。
 * R197: signal 透传 —— Stop 在 efetch（大批量可达数分钟）期间即刻生效。
 */
async function backfillPubMedArticles(
  pdbDetails: PdbEntryDetail[],
  emit: (e: SseEvent) => void,
  signal?: AbortSignal,
): Promise<{ fetched: number; skipped: number }> {
  const pmids = Array.from(new Set(
    pdbDetails.map(e => (e.pubmedId || '').toString().trim()).filter(Boolean),
  ));
  if (pmids.length === 0) return { fetched: 0, skipped: 0 };

  let existingPmids = new Set<string>();
  try {
    const rows = await db.$queryRaw<any[]>`SELECT pubmedId FROM PubMedArticle WHERE pubmedId IN (${safeInPlaceholders(pmids)})`;
    existingPmids = new Set((rows as any[]).map(r => String(r.pubmedId)));
  } catch {
    // 表可能不存在 —— 全部视为缺失，schema-compat 会在 route 入口建表。
  }
  const missing = pmids.filter(p => !existingPmids.has(p));
  if (missing.length === 0) return { fetched: 0, skipped: pmids.length };

  let papers: Array<{ pmid: string; title: string; authors: string; journal: string; abstract: string; pubYear: string; pubMonth: string; pubDay: string; doi: string }> = [];
  try {
    const fetched = await efetch(missing, signal);
    papers = fetched.map(p => ({ pmid: p.pmid, title: p.title, authors: p.authors, journal: p.journal, abstract: p.abstract, pubYear: p.pubYear, pubMonth: p.pubMonth, pubDay: p.pubDay, doi: p.doi }));
  } catch (err: any) {
    // R197: Stop 信号不得被「efetch 失败继续」吞掉（同 BLAST catch 口径）。
    if (err?.name === 'AbortError' || signal?.aborted) throw err;
    emit({ stage: 'pubmed', level: 'warn', message: `PubMed efetch 失败（${missing.length} 篇）：${err?.message ?? 'unknown'}`, progress: 50 });
    return { fetched: 0, skipped: existingPmids.size };
  }

  let inserted = 0;
  for (const p of papers) {
    try {
      await db.pubMedArticle.upsert({
        where: { pubmedId: p.pmid },
        create: { pubmedId: p.pmid, title: p.title, authors: p.authors, journal: p.journal, pubYear: p.pubYear, pubMonth: p.pubMonth, pubDay: p.pubDay, abstract: p.abstract, doi: p.doi },
        update: { title: p.title, authors: p.authors, abstract: p.abstract, doi: p.doi },
      });
      inserted++;
    } catch {
      // 单条失败忽略
    }
  }
  return { fetched: inserted, skipped: existingPmids.size };
}

/**
 * R179 (Task 2-a): 文献 joiner（简化版 buildLiteratureInfo —— 经典版是
 * route 内部函数未导出）。从 PubMedArticle 表读回数据，用 PDB 行的
 * journal-IF map 补 IF，按 IF 降序取前 maxLitCount，摘要截 200 字。
 */
async function buildLiteratureRows(
  pdbDetails: PdbEntryDetail[],
  maxLitCount: number,
): Promise<LiteratureRow[]> {
  // PMID → 最高 journalIf（多 PDB 引同一篇时取最大）。
  const pmidToIf = new Map<string, number | null>();
  for (const e of pdbDetails) {
    const pm = (e.pubmedId || '').toString().trim();
    if (!pm) continue;
    const cur = pmidToIf.get(pm) ?? null;
    if (e.journalIf != null && (cur == null || e.journalIf > cur)) {
      pmidToIf.set(pm, e.journalIf);
    } else if (!pmidToIf.has(pm)) {
      pmidToIf.set(pm, null);
    }
  }
  const pmids = Array.from(pmidToIf.keys());
  if (pmids.length === 0) return [];

  let articles: Array<{ pubmedId: string; title: string | null; journal: string | null; abstract: string | null; pubYear: string | null }> = [];
  try {
    const rows = await db.$queryRaw<any[]>`SELECT pubmedId, title, journal, abstract, pubYear FROM PubMedArticle WHERE pubmedId IN (${safeInPlaceholders(pmids)})`;
    articles = (rows as any[]).map((r) => ({ pubmedId: r.pubmedId, title: r.title, journal: r.journal, abstract: r.abstract, pubYear: r.pubYear }));
  } catch {
    return []; // 表不存在等 —— 优雅降级为无文献
  }
  if (articles.length === 0) return [];

  // IF 缺失时尝试从 EvaluationPdbStructure 补（经典管线的第二数据源）。
  const nullIfPmids = articles.map(a => a.pubmedId).filter(pm => pmidToIf.get(pm) == null);
  if (nullIfPmids.length > 0) {
    try {
      const ifRows = await db.$queryRaw<any[]>`SELECT pubmedId, journalIf FROM EvaluationPdbStructure WHERE pubmedId IN (${safeInPlaceholders(nullIfPmids)}) AND journalIf IS NOT NULL`;
      for (const r of ifRows as any[]) {
        const pm = r.pubmedId?.toString();
        const v = typeof r.journalIf === 'number' ? r.journalIf : Number(r.journalIf);
        if (pm && !Number.isNaN(v)) pmidToIf.set(pm, v);
      }
    } catch {
      // ignore —— IF 未知时文献仍保留（省略 IF 字段）
    }
  }

  // IF 降序 → 取前 maxLitCount。
  const sorted = articles
    .map(a => ({
      pmid: a.pubmedId,
      title: a.title || '',
      journal: a.journal || '',
      journalIf: pmidToIf.get(a.pubmedId) ?? null,
      year: a.pubYear || '',
      abstract: (a.abstract || '').slice(0, 200),
    }))
    .sort((x, y) => (y.journalIf ?? -1) - (x.journalIf ?? -1));
  return sorted.slice(0, Math.max(0, maxLitCount));
}

/**
 * R179 (Task 2-a): DSH 模式单靶点数据收集（mirror 经典 route 的
 * single-target flow，行内注释对照 route.ts 859-1130 段）。
 */
export async function collectEvaluationData(
  uniprot: string,
  opts: CollectOpts = {},
  emit: (e: SseEvent) => void = () => {},
): Promise<CollectResult> {
  const maxPdb = Math.max(1, Math.min(500, opts.maxPdb ?? 80)); // R187: 200→500，对齐 UI
  const maxBlastHits = Math.max(0, Math.min(100, opts.maxBlastHits ?? 50));
  const maxLitCount = Math.max(0, Math.min(200, opts.maxLitCount ?? 20));
  const forceBlast = !!opts.forceBlast;
  const skipBlast = !!opts.skipBlast;

  // ── 1. UniProt 元数据（4-10%）──────────────────────────────────────────
  emit({ stage: 'uniprot-meta', level: 'info', message: `拉取 UniProt 元数据 (${uniprot})`, progress: 4 });
  // R197: signal 接线 —— R196 给 rcsb/blast/pubmed helper 全部加了 signal 形参，
  // 但本编排层 5 处调用点未传（Stop 在 Phase A 的长拉取期间无效，最长数分钟）。
  const meta: UniprotMeta | null = await fetchUniprotMeta(uniprot, opts.signal);
  const uniprotInfo = meta
    ? {
        uniprotId: uniprot,
        entryName: meta.entryName,
        proteinName: meta.proteinName,
        geneNames: meta.geneNames || '—',
        organism: meta.organism || '—',
        sequenceLength: meta.sequenceLength || 0,
      }
    : {
        // UniProt 拉取失败时的显式降级（不静默撒谎，与经典 route 一致）。
        uniprotId: uniprot,
        entryName: uniprot,
        proteinName: `Unknown (UniProt fetch failed)`,
        geneNames: '—',
        organism: '—',
        sequenceLength: 0,
      };
  emit({
    stage: 'uniprot-meta',
    level: meta ? 'success' : 'warn',
    message: `${uniprotInfo.proteinName} · ${uniprotInfo.sequenceLength || '?'} aa`,
    progress: 10,
  });

  // ── 2. RCSB 直接 PDB（12-28%）─────────────────────────────────────────
  emit({ stage: 'rcsb-pdbs', level: 'info', message: `RCSB 检索 UniProt=${uniprot}（真实 API · 上限 ${maxPdb}）`, progress: 12 });
  const pdbIds = await fetchPdbIdsForUniprot(uniprot, maxPdb, opts.signal); // R197: signal
  const directPdbCount = pdbIds.length;
  if (directPdbCount === 0) {
    emit({ stage: 'rcsb-pdbs', level: 'warn', message: `RCSB 返回 0 条`, progress: 20 });
  } else {
    emit({ stage: 'rcsb-pdbs', level: 'success', message: `✓ RCSB 返回 ${directPdbCount} 条真实 PDB`, progress: 16 });
  }
  let pdbRows: PdbEntryDetail[] = [];
  if (directPdbCount > 0) {
    emit({ stage: 'rcsb-pdbs', level: 'info', message: `拉取详细元数据（5/批并发）…`, progress: 18 });
    // R192: 大批量（>100 条）时细分拉取进度 —— maxPdb=500 → 100 批 ≈
    // 数分钟，此前全程静默停在 18%（用户侧表现为「卡住」）。每 25 条或
    // 完成时发一条，进度映射到 18-28% 区间。
    const metaT0 = Date.now();
    // R197: signal（第 4 形参）—— maxPdb=500 → 100 批数分钟期间 Stop 即刻生效。
    pdbRows = await fetchPdbEntryDetails(pdbIds, undefined, (done, total) => {
      if (total > 100 && (done % 25 === 0 || done === total)) {
        const pctDone = Math.round((done / total) * 100);
        emit({
          stage: 'rcsb-pdbs',
          level: 'info',
          message: `结构元数据拉取中 ${done}/${total}（${pctDone}% · 已用 ${Math.round((Date.now() - metaT0) / 1000)}s）`,
          progress: 18 + Math.floor((done / total) * 10),
        });
      }
    }, opts.signal);
    for (const d of pdbRows) fillJournalIf(d);
    emit({ stage: 'rcsb-pdbs', level: 'success', message: `✓ 获取 ${pdbRows.length} 条结构元数据（含 IF 补齐）`, progress: 28 });
  }

  // ── 3. 启发式覆盖率（同经典 route：每结构 ~5%，封顶 100%）────────────
  const coverage = directPdbCount > 0 ? Math.min(100, directPdbCount * 5) : 0;

  // ── 4. BLAST 自动判定（30-44%，若运行）───────────────────────────────
  // 与经典 route 相同：directPdbCount < 5 或 coverage < 50 时运行；
  // forceBlast 覆盖一切；skipBlast 保留向后兼容。
  const MIN_PDB_FOR_SKIP = 5;
  const MIN_COVERAGE_FOR_SKIP = 50;
  const autoShouldSkip = directPdbCount >= MIN_PDB_FOR_SKIP && coverage >= MIN_COVERAGE_FOR_SKIP;
  const shouldSkipBlast = !forceBlast && (skipBlast || autoShouldSkip);

  let blastRows: BlastHit[] = [];
  let skippedBlast = false;
  if (shouldSkipBlast) {
    if (autoShouldSkip && !skipBlast) {
      emit({ stage: 'blast', level: 'info', message: `BLAST 自动跳过：直接 PDB ${directPdbCount} ≥ ${MIN_PDB_FOR_SKIP} 且覆盖率 ${coverage}% ≥ ${MIN_COVERAGE_FOR_SKIP}%（forceBlast 可覆盖）`, progress: 30 });
    } else {
      emit({ stage: 'blast', level: 'warn', message: `BLAST 已跳过 (skipBlast=true)`, progress: 30 });
    }
    skippedBlast = true;
  } else {
    emit({ stage: 'blast', level: 'info', message: forceBlast
      ? `强制 BLAST（forceBlast=true，忽略自动跳过：PDB=${directPdbCount}, 覆盖率=${coverage}%）`
      : `自动判定需要 BLAST：直接 PDB ${directPdbCount} < ${MIN_PDB_FOR_SKIP} 或覆盖率 ${coverage}% < ${MIN_COVERAGE_FOR_SKIP}%`, progress: 30 });
    try {
      emit({ stage: 'blast', level: 'info', message: `从 UniProt 拉取 ${uniprot} 蛋白序列…`, progress: 31 });
      const sequence = await fetchUniprotSequence(uniprot, opts.signal); // R197: signal
      emit({ stage: 'blast', level: 'info', message: `序列长度 ${sequence.length} aa，提交 BLASTp（上限 ${maxBlastHits} 条）…`, progress: 32 });
      blastRows = await runBlast(sequence, maxBlastHits, (msg) => {
        emit({ stage: 'blast', level: 'info', message: msg, progress: 33 });
      }, opts.signal);
      if (blastRows.length > 0) {
        const top = blastRows[0];
        emit({ stage: 'blast', level: 'success', message: `✓ BLAST 命中 ${blastRows.length}/${maxBlastHits} 条同源（最高 identity=${top.identity}% · ${top.pdbId || top.uniprotRef}）`, progress: 44 });
      } else {
        emit({ stage: 'blast', level: 'warn', message: `BLAST 完成，无同源命中`, progress: 44 });
      }
    } catch (err: any) {
      // R195: 用户 Stop（AbortError）不得被「BLAST 失败继续」吞掉 —— 直接上抛。
      if (err?.name === 'AbortError') throw err;
      // BLAST 失败绝不中止评估（与经典 route 一致）。
      emit({ stage: 'blast', level: 'error', message: `✗ BLAST 失败：${err?.message}（继续后续评分）`, progress: 44 });
      skippedBlast = true;
      blastRows = [];
    }
  }
  const blastHitCount = blastRows.length;

  // ── 5. 评分（同经典公式：min(10, round(sqrt(count)*2))）───────────────
  emit({ stage: 'score', level: 'info', message: `综合可成药性评分`, progress: 45 });
  const scores = computeCollectScores(pdbRows);
  emit({ stage: 'score', level: 'success', message: scoreEmitMessage(scores), progress: 46 });

  // ── 6. PubMed 文献（46-56%）──────────────────────────────────────────
  emit({ stage: 'pubmed', level: 'info', message: `PubMed 文献回填与按 IF 排序（上限 ${maxLitCount}）…`, progress: 48 });
  let literature: LiteratureRow[] = [];
  try {
    const pmRes = await backfillPubMedArticles(pdbRows, emit, opts.signal); // R197: signal
    if (pmRes.fetched > 0) {
      emit({ stage: 'pubmed', level: 'info', message: `PubMed 文献回填：${pmRes.fetched} 篇新获取，${pmRes.skipped} 篇已存在`, progress: 50 });
    }
    literature = await buildLiteratureRows(pdbRows, maxLitCount);
    emit({
      stage: 'pubmed',
      level: literature.length > 0 ? 'success' : 'warn',
      message: literature.length > 0
        ? `✓ 附着 ${literature.length} 篇文献（按期刊 IF 降序，摘要截 200 字）`
        : `无 PubMed 文献数据（这些 PDB 结构无对应文献或 efetch 失败）`,
      progress: 56,
    });
  } catch (err: any) {
    // R197: Stop 信号上抛（否则要等 write-db 后 agent 的下一检查点才生效）。
    if (err?.name === 'AbortError' || opts.signal?.aborted) throw err;
    emit({ stage: 'pubmed', level: 'warn', message: `文献收集失败（不影响评估）：${err?.message ?? 'unknown'}`, progress: 56 });
  }

  // ── 7. DB 持久化（R200 提取为 persistCollectRows，两路共用）──────────
  const dbSaved = await persistCollectRows({
    key: uniprot,
    uniprotInfo,
    pdbRows,
    blastRows,
    coverage,
    scores,
    maxPdb,
    skippedBlast: shouldSkipBlast,
    directPdbCount,
    emit,
  });

  return {
    uniprotInfo,
    directPdbCount,
    pdbRows,
    blastHitCount,
    blastRows,
    coverage,
    skippedBlast,
    scores,
    literature,
    dbSaved,
  };
}

// ─── R200: Agent 模式序列输入收集 ─────────────────────────────────────────
//
// 流程 mirror 经典 route 的 evaluateOneSequence 数据段（BLAST 识别 →
// UniProt 元数据 → RCSB 反查合并 → 评分 → 文献 → 入库），差异点：
//   - BLAST 必然运行（它是「序列 → 靶点身份」的识别机制，forceBlast/
//     skipBlast 对序列输入无意义 —— 设置了会 emit 一条提示后忽略）；
//   - 识别出 UniProt acc 后无论 pdbaa/nr 路径都做 RCSB 反查合并
//     （Agent 模式吃 full RCSB 元数据：配体/日期/文献，宁多勿缺）；
//   - 未识别（0 命中）时仍产出可评估的 CollectResult（proteinName=
//     Input Sequence (Naa)，PDB 仅 BLAST 命中行），报告照常生成；
//   - 入库 key = 识别出的 UniProt acc（与已有评估行自然归并）或
//     SEQ_xxx 占位（与经典序列模式同款）。

/** R200: DNA → 氨基酸转录（codon 表与经典 route 完全一致）。 */
const CODON_TABLE: Record<string, string> = {
  'TTT':'F','TTC':'F','TTA':'L','TTG':'L','CTT':'L','CTC':'L','CTA':'L','CTG':'L',
  'ATT':'I','ATC':'I','ATA':'I','ATG':'M','GTT':'V','GTC':'V','GTA':'V','GTG':'V',
  'TCT':'S','TCC':'S','TCA':'S','TCG':'S','CCT':'P','CCC':'P','CCA':'P','CCG':'P',
  'ACT':'T','ACC':'T','ACA':'T','ACG':'T','GCT':'A','GCC':'A','GCA':'A','GCG':'A',
  'TAT':'Y','TAC':'Y','TAA':'*','TAG':'*','CAT':'H','CAC':'H','CAA':'Q','CAG':'Q',
  'AAT':'N','AAC':'N','AAA':'K','AAG':'K','GAT':'D','GAC':'D','GAA':'E','GAG':'E',
  'TGT':'C','TGC':'C','TGA':'*','TGG':'W','CGT':'R','CGC':'R','CGA':'R','CGG':'R',
  'AGT':'S','AGC':'S','AGA':'R','AGG':'R','GGT':'G','GGC':'G','GGA':'G','GGG':'G',
};

/** R200: 父 signal + 超时合成（fetch 类调用 15s 兜底，Stop 即刻生效）。 */
function withTimeout(sig: AbortSignal | undefined, ms = 15_000): AbortSignal {
  return AbortSignal.any([sig ?? new AbortController().signal, AbortSignal.timeout(ms)]);
}

/**
 * R200: Agent 模式序列输入数据收集（单序列）。
 * 进度区间与 UniProt 路对齐（blast 4-28 → identify 28-34 → rcsb 34-44 →
 * score 45-46 → pubmed 48-56 → write-db 57），Phase B 起与 UniProt 路
 * 完全同轨（agent.ts 不感知差异，只读 CollectResult）。
 */
export async function collectEvaluationDataForSequence(
  seq: SequenceInput,
  opts: CollectOpts = {},
  emit: (e: SseEvent) => void = () => {},
): Promise<CollectResult> {
  const maxPdb = Math.max(1, Math.min(500, opts.maxPdb ?? 80));
  const maxBlastHits = Math.max(0, Math.min(100, opts.maxBlastHits ?? 50));
  const maxLitCount = Math.max(0, Math.min(200, opts.maxLitCount ?? 20));

  // ── 1. 清洗 + DNA 转录（4-10%）─────────────────────────────────────────
  let sequence = String(seq.sequence || '').trim().toUpperCase().replace(/\s/g, '');
  const inputLength = sequence.length;
  const inputType = seq.seqType === 'dna' ? 'dna' : 'aa';
  if (sequence.length < 10) {
    throw new Error(`序列过短（${sequence.length} ${inputType === 'dna' ? 'nt' : 'aa'}）—— 至少需要 10 个残基`);
  }
  emit({ stage: 'init', level: 'info', message: `序列输入 · ${inputType === 'dna' ? 'DNA' : 'AA'} 序列（${inputLength} ${inputType === 'dna' ? 'nt' : 'aa'}）`, progress: 4 });
  let transcribed = false;
  if (inputType === 'dna') {
    emit({ stage: 'transcribe', level: 'info', message: `DNA → 氨基酸转录中…`, progress: 6 });
    const cleanDna = sequence.replace(/[^ATGC]/g, '');
    let aaSeq = '';
    for (let i = 0; i + 2 < cleanDna.length; i += 3) {
      const aa = CODON_TABLE[cleanDna.slice(i, i + 3)] || 'X';
      if (aa === '*') break; // stop codon
      aaSeq += aa;
    }
    sequence = aaSeq;
    transcribed = true;
    emit({ stage: 'transcribe', level: 'success', message: `转录完成: ${cleanDna.length}nt → ${aaSeq.length}aa`, progress: 10 });
    if (aaSeq.length < 10) {
      throw new Error(`DNA 转录后氨基酸序列过短（${aaSeq.length}aa）—— 请检查序列或改用氨基酸输入`);
    }
  }

  // ── 2. BLAST 识别（pdbaa → nr 回退，8-28%）────────────────────────────
  if (opts.forceBlast || opts.skipBlast) {
    emit({ stage: 'blast', level: 'info', message: `序列输入模式下 BLAST 是身份识别步骤，forceBlast/skipBlast 不适用（已忽略）`, progress: 8 });
  }
  emit({ stage: 'blast', level: 'info', message: `BLASTp 同源检索 — pdbaa 数据库（序列 ${sequence.length}aa, 上限 ${maxBlastHits}）`, progress: 8 });
  let blastRows: BlastHit[] = [];
  let usedNrFallback = false;
  try {
    blastRows = await runBlast(sequence, maxBlastHits, (msg) => {
      emit({ stage: 'blast', level: 'info', message: msg, progress: 12 });
    }, opts.signal);
    const topIdentity = blastRows.length > 0 ? blastRows[0].identity : 0;
    if (blastRows.length === 0) {
      emit({ stage: 'blast', level: 'warn', message: `pdbaa 数据库无命中，回退搜索 nr 数据库…`, progress: 18 });
    } else if (topIdentity < 95) {
      emit({ stage: 'blast', level: 'warn', message: `pdbaa 最高同源度 ${topIdentity}% < 95%，回退搜索 nr 数据库…`, progress: 18 });
    } else {
      emit({ stage: 'blast', level: 'success', message: `✓ pdbaa 命中 ${blastRows.length}/${maxBlastHits} 条同源（最高 identity=${topIdentity}% · ${blastRows[0].pdbId}）`, progress: 26 });
    }
    if (blastRows.length === 0 || topIdentity < 95) {
      emit({ stage: 'blast-nr', level: 'info', message: `BLASTp 同源检索 — nr 数据库（非冗余库, 上限 ${maxBlastHits}）`, progress: 20 });
      try {
        const nrHits = await runBlastDb(sequence, maxBlastHits, 'nr', (msg) => {
          emit({ stage: 'blast-nr', level: 'info', message: msg, progress: 22 });
        }, opts.signal);
        if (nrHits.length > 0) {
          usedNrFallback = true;
          blastRows = nrHits;
          emit({ stage: 'blast-nr', level: 'success', message: `✓ nr 命中 ${nrHits.length}/${maxBlastHits} 条同源（最高 identity=${nrHits[0].identity}% · ${nrHits[0].uniprotRef}）`, progress: 26 });
        } else {
          emit({ stage: 'blast-nr', level: 'warn', message: `nr 数据库也无命中`, progress: 26 });
        }
      } catch (nrErr: any) {
        if (nrErr?.name === 'AbortError' || opts.signal?.aborted) throw nrErr;
        emit({ stage: 'blast-nr', level: 'error', message: `nr 搜索失败：${nrErr?.message}`, progress: 26 });
      }
    }
  } catch (err: any) {
    // Stop 信号上抛；BLAST 自身失败继续（报告降级为无同源数据）。
    if (err?.name === 'AbortError' || opts.signal?.aborted) throw err;
    emit({ stage: 'blast', level: 'error', message: `✗ BLAST 失败：${err?.message}（继续后续评估）`, progress: 26 });
    blastRows = [];
  }
  const blastHitCount = blastRows.length;
  const topHit = blastRows[0] ?? null;
  const identity = topHit ? topHit.identity : null;
  const topHitLabel = topHit ? (topHit.pdbId || topHit.uniprotRef || '?') : '';

  // ── 3. pdbaa 命中 → PDB 行（含 IF 补齐）───────────────────────────────
  let pdbRows: PdbEntryDetail[] = blastRows
    .filter(h => h.pdbId) // nr 命中无 pdbId（不造假）
    .map(h => ({
      pdbId: h.pdbId, method: h.method || 'X-RAY DIFFRACTION', resolution: h.resolution ?? null,
      title: h.description || h.title || '', journal: h.journal || '', journalIf: h.journalIf ?? null,
      doi: null, pubmedId: h.pubmedId || null, organisms: h.organism || '',
      authors: '', ligands: '', depositDate: null, releaseDate: h.releaseDate || null,
    }));
  for (const d of pdbRows) fillJournalIf(d);

  // ── 4. 靶点身份解析（top 命中 → UniProt acc，28-34%）───────────────────
  const seqKey = `SEQ_${Date.now().toString(36)}_1`;
  let uniprotAcc: string | null = null;
  if (topHit) {
    emit({ stage: 'uniprot-lookup', level: 'info', message: `从最高同源性命中（${usedNrFallback ? topHit.uniprotRef : topHit.pdbId}, identity=${topHit.identity}%）解析 UniProt 身份…`, progress: 28 });
    try {
      if (usedNrFallback) {
        const acc = topHit.uniprotRef;
        const uniMatch = (topHit.description || '').match(/sp\|([A-Z0-9]+)\|/);
        if (uniMatch) {
          uniprotAcc = uniMatch[1];
        } else if (/^[A-NR-Z][0-9][A-Z0-9]{3}[0-9]/i.test(acc) || /^([A-Z0-9]{6,10})$/i.test(acc)) {
          uniprotAcc = acc;
        } else {
          emit({ stage: 'uniprot-lookup', level: 'info', message: `通过 NCBI accession ${acc} 搜索 UniProt…`, progress: 30 });
          const uniSearchRes = await fetch(`https://rest.uniprot.org/uniprotkb/search?query=xref:${acc}&fields=accession&format=json&size=1`, { signal: withTimeout(opts.signal) });
          if (uniSearchRes.ok) {
            const uniSearchData = await uniSearchRes.json();
            uniprotAcc = uniSearchData?.results?.[0]?.primaryAccession || null;
          }
        }
      } else {
        // pdbaa 命中：RCSB polymer entity → UniProt accession。
        const rcsbRes = await fetch(`https://data.rcsb.org/rest/v1/core/polymer_entity/${topHit.pdbId}/1`, { headers: { Accept: 'application/json' }, signal: withTimeout(opts.signal) });
        if (rcsbRes.ok) {
          const rcsbData = await rcsbRes.json();
          const uniProts = rcsbData?.rcsb_polymer_entity_container_identifiers?.reference_sequence_identifiers || [];
          uniprotAcc = uniProts.find((r: any) => r.database_name === 'UniProt')?.database_accession || null;
        }
      }
      if (uniprotAcc) {
        emit({ stage: 'uniprot-lookup', level: 'info', message: `识别为 UniProt ${uniprotAcc}，获取元数据…`, progress: 32 });
      } else {
        emit({ stage: 'uniprot-lookup', level: 'warn', message: `未找到关联的 UniProt accession（按序列输入口径继续）`, progress: 32 });
      }
    } catch (err: any) {
      if (err?.name === 'AbortError' || opts.signal?.aborted) throw err;
      emit({ stage: 'uniprot-lookup', level: 'warn', message: `UniProt 身份解析失败: ${err?.message}`, progress: 32 });
    }
  }

  // ── 5. UniProt 元数据 + RCSB 反查合并（32-44%）────────────────────────
  let uniprotInfo: CollectResult['uniprotInfo'];
  let directPdbCount = 0;
  if (uniprotAcc) {
    const meta: UniprotMeta | null = await fetchUniprotMeta(uniprotAcc, opts.signal);
    if (meta) {
      uniprotInfo = {
        uniprotId: uniprotAcc,
        entryName: meta.entryName,
        proteinName: meta.proteinName,
        geneNames: meta.geneNames || '—',
        organism: meta.organism || '—',
        sequenceLength: meta.sequenceLength || 0,
        ...(identity != null ? { blastIdentity: identity } : {}),
        ...(topHit?.pdbId ? { blastPdbId: topHit.pdbId } : {}),
        blastSource: usedNrFallback ? 'nr' : 'pdbaa',
      };
      emit({ stage: 'uniprot-meta', level: 'success', message: `✓ 识别结果：${meta.proteinName} · ${meta.organism} · ${meta.sequenceLength}aa（BLAST identity=${identity}% via ${usedNrFallback ? 'nr' : 'pdbaa'}）`, progress: 34 });
    } else {
      uniprotInfo = {
        uniprotId: uniprotAcc,
        entryName: uniprotAcc,
        proteinName: `Unknown (UniProt fetch failed)`,
        geneNames: '—',
        organism: '—',
        sequenceLength: 0,
      };
      emit({ stage: 'uniprot-meta', level: 'warn', message: `UniProt 元数据获取失败（${uniprotAcc}）`, progress: 34 });
    }
    // RCSB 反查合并（UniProt 源优先 —— full 元数据：配体/日期/文献）。
    try {
      emit({ stage: 'rcsb-pdbs', level: 'info', message: `从 UniProt ${uniprotAcc} 反查 RCSB 真实 PDB（上限 ${maxPdb}）…`, progress: 36 });
      const rcsbPdbIds = await fetchPdbIdsForUniprot(uniprotAcc, maxPdb, opts.signal);
      directPdbCount = rcsbPdbIds.length;
      if (rcsbPdbIds.length > 0) {
        const rcsbRows = await fetchPdbEntryDetails(rcsbPdbIds, undefined, (done, total) => {
          if (total > 100 && (done % 25 === 0 || done === total)) {
            emit({ stage: 'rcsb-pdbs', level: 'info', message: `结构元数据拉取中 ${done}/${total}…`, progress: 36 + Math.floor((done / total) * 6) });
          }
        }, opts.signal);
        for (const d of rcsbRows) fillJournalIf(d);
        const seen = new Set(rcsbRows.map(e => e.pdbId));
        pdbRows = [...rcsbRows, ...pdbRows.filter(e => !seen.has(e.pdbId))];
        emit({ stage: 'rcsb-pdbs', level: 'success', message: `✓ RCSB 反查 ${rcsbRows.length} 条真实 PDB（与 BLAST 命中合并后 ${pdbRows.length} 条）`, progress: 44 });
      } else {
        emit({ stage: 'rcsb-pdbs', level: 'warn', message: `UniProt ${uniprotAcc} 在 RCSB 中无关联 PDB（保留 BLAST 命中 ${pdbRows.length} 条）`, progress: 44 });
      }
    } catch (err: any) {
      if (err?.name === 'AbortError' || opts.signal?.aborted) throw err;
      emit({ stage: 'rcsb-pdbs', level: 'warn', message: `RCSB 反查失败: ${err?.message}（保留 BLAST 命中 ${pdbRows.length} 条）`, progress: 44 });
    }
  } else {
    // 未识别 —— 序列输入口径（classic 同款 fallback）。
    uniprotInfo = {
      uniprotId: seqKey,
      entryName: 'Sequence Input',
      proteinName: `Input Sequence (${sequence.length}aa)`,
      geneNames: '—',
      organism: '—',
      sequenceLength: sequence.length,
    };
    emit({ stage: 'uniprot-meta', level: 'warn', message: `未识别出靶点蛋白 —— 按纯序列输入口径评估（BLAST 命中 ${blastRows.length} 条）`, progress: 34 });
  }

  // ── 6. 覆盖率启发式（与经典序列模式一致：min(100, rows*5)）────────────
  const coverage = Math.min(100, pdbRows.length * 5);

  // ── 7. 评分（45-46%）─────────────────────────────────────────────────
  emit({ stage: 'score', level: 'info', message: `综合可成药性评分`, progress: 45 });
  const scores = computeCollectScores(pdbRows);
  emit({ stage: 'score', level: 'success', message: scoreEmitMessage(scores), progress: 46 });

  // ── 8. PubMed 文献（48-56%）───────────────────────────────────────────
  emit({ stage: 'pubmed', level: 'info', message: `PubMed 文献回填与按 IF 排序（上限 ${maxLitCount}）…`, progress: 48 });
  let literature: LiteratureRow[] = [];
  try {
    const pmRes = await backfillPubMedArticles(pdbRows, emit, opts.signal);
    if (pmRes.fetched > 0) {
      emit({ stage: 'pubmed', level: 'info', message: `PubMed 文献回填：${pmRes.fetched} 篇新获取，${pmRes.skipped} 篇已存在`, progress: 50 });
    }
    literature = await buildLiteratureRows(pdbRows, maxLitCount);
    emit({
      stage: 'pubmed',
      level: literature.length > 0 ? 'success' : 'warn',
      message: literature.length > 0
        ? `✓ 附着 ${literature.length} 篇文献（按期刊 IF 降序，摘要截 200 字）`
        : `无 PubMed 文献数据（这些 PDB 结构无对应文献或 efetch 失败）`,
      progress: 56,
    });
  } catch (err: any) {
    if (err?.name === 'AbortError' || opts.signal?.aborted) throw err;
    emit({ stage: 'pubmed', level: 'warn', message: `文献收集失败（不影响评估）：${err?.message ?? 'unknown'}`, progress: 56 });
  }

  // ── 9. DB 持久化（key = 识别 acc 或 SEQ_xxx）────────────────────────
  const dbSaved = await persistCollectRows({
    key: uniprotAcc || seqKey,
    uniprotInfo,
    pdbRows,
    blastRows,
    coverage,
    scores,
    maxPdb,
    skippedBlast: false,
    directPdbCount,
    emit,
  });

  return {
    uniprotInfo,
    directPdbCount,
    pdbRows,
    blastHitCount,
    blastRows,
    coverage,
    skippedBlast: false,
    scores,
    literature,
    dbSaved,
    sequenceInfo: {
      inputType,
      inputLength,
      aaLength: sequence.length,
      transcribed,
      identity,
      resolvedUniprot: uniprotAcc,
      usedNrFallback,
      topHitLabel,
    },
  };
}
