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
import { runBlast, fetchUniprotSequence, PARALOG_IDENTITY_THRESHOLD, type BlastHit } from '@/lib/blast';
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
}

/** R179 (Task 2-a): 评分等级 —— 与经典管线一致（≥8 优 / ≥6 良 / ≥4 中 / 其余 差）。 */
function scoreRating(s: number): string {
  return s >= 8 ? '优' : s >= 6 ? '良' : s >= 4 ? '中' : '差';
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
  emit({ stage: 'score', level: 'success', message: `overall=${scores.overall.score}/10 (X-ray=${scores.xray.score}/${scores.xray.structures}条, Cryo-EM=${scores.cryoem.score}/${scores.cryoem.structures}条, NMR=${scores.nmr.score}/${scores.nmr.structures}条)`, progress: 46 });

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

  // ── 7. DB 持久化（mirror 经典 route：raw-SQL upsert，schema-drift 免疫）─
  // report/provenance 留 null —— Phase F 由 agent.ts 写回。
  let dbSaved = false;
  try {
    emit({ stage: 'write-db', level: 'info', message: `写入数据库（Evaluation + ${pdbRows.length} PDB + ${blastRows.length} BLAST）`, progress: 57 });
    const scoresJson = JSON.stringify({
      'X-ray': { score: scores.xray.score, rating: scores.xray.rating, max: 10 },
      'Cryo-EM': { score: scores.cryoem.score, rating: scores.cryoem.rating, max: 10 },
      'NMR': { score: scores.nmr.score, rating: scores.nmr.rating, max: 10 },
      'Overall': { score: scores.overall.score, rating: scores.overall.rating, max: 10 },
    });
    // 先写父表（FK 约束），report/provenance 均为 null（Phase F 更新）。
    await db.$executeRaw`INSERT INTO Evaluation (uniprotId, entryName, proteinName, geneNames, organism, sequenceLength, coverage, scores, report, provenance, maxPdbUsed, blastWasSkipped, pdbCountAtEval, createdAt, updatedAt) VALUES (${uniprot}, ${uniprotInfo.entryName}, ${uniprotInfo.proteinName}, ${uniprotInfo.geneNames}, ${uniprotInfo.organism}, ${uniprotInfo.sequenceLength}, ${coverage}, ${scoresJson}, null, null, ${maxPdb}, ${shouldSkipBlast}, ${directPdbCount}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(uniprotId) DO UPDATE SET entryName = excluded.entryName, proteinName = excluded.proteinName, geneNames = excluded.geneNames, organism = excluded.organism, sequenceLength = excluded.sequenceLength, coverage = excluded.coverage, scores = excluded.scores, maxPdbUsed = excluded.maxPdbUsed, blastWasSkipped = excluded.blastWasSkipped, pdbCountAtEval = excluded.pdbCountAtEval, updatedAt = CURRENT_TIMESTAMP`;

    await db.$executeRaw`DELETE FROM EvaluationPdbStructure WHERE uniprotId = ${uniprot}`;
    for (const e of pdbRows) {
      const isCryoem = (e.method || '').includes('ELECTRON');
      const isXray = (e.method || '').includes('X-RAY');
      const isNmr = (e.method || '').includes('NMR');
      const ifTier = e.journalIf == null ? 'unknown' : e.journalIf >= 20 ? 'top' : e.journalIf >= 10 ? 'high' : e.journalIf >= 5 ? 'mid' : 'low';
      await db.$executeRaw`INSERT INTO EvaluationPdbStructure (uniprotId, pdbId, method, resolution, title, depositionDate, releaseDate, ligand, ligandNames, journal, journalIf, doi, pubmedId, organism, authors, isCryoem, isXray, isNmr, ifTier) VALUES (${uniprot}, ${e.pdbId}, ${e.method}, ${e.resolution}, ${e.title}, ${e.depositDate}, ${e.releaseDate}, ${e.ligands}, ${e.ligands}, ${e.journal}, ${e.journalIf}, ${e.doi}, ${e.pubmedId}, ${e.organisms}, ${e.authors}, ${isCryoem}, ${isXray}, ${isNmr}, ${ifTier})`;
    }

    await db.$executeRaw`DELETE FROM EvaluationBlastResult WHERE uniprotId = ${uniprot}`;
    // 去重 by pdbId（blastRows 已按 identity 降序，保留首个=最高 identity）；
    // isParalog 标记 ≥95% identity 的近缘同源。
    const seenBlastPdbIds = new Set<string>();
    for (const h of blastRows) {
      if (!h.pdbId || seenBlastPdbIds.has(h.pdbId)) continue;
      seenBlastPdbIds.add(h.pdbId);
      const isParalog = h.identity >= PARALOG_IDENTITY_THRESHOLD;
      await db.$executeRaw`INSERT INTO EvaluationBlastResult (uniprotId, pdbId, uniprotRef, description, identity, evalue, queryCoverage, method, source, isParalog) VALUES (${uniprot}, ${h.pdbId}, ${h.uniprotRef || ''}, ${h.description || ''}, ${h.identity}, ${h.evalue}, ${h.queryCoverage}, ${'BLASTp'}, ${'NCBI BLAST REST API'}, ${isParalog})`;
    }
    dbSaved = true;
    emit({ stage: 'write-db', level: 'success', message: `✓ 已写入 Evaluation + EvaluationPdbStructure(${pdbRows.length}) + EvaluationBlastResult(${seenBlastPdbIds.size})`, progress: 57 });
  } catch (err: any) {
    // DB 写失败不中止 —— 报告生成仍可继续（经典 route 同语义）。
    emit({ stage: 'write-db', level: 'warn', message: `数据收集阶段 DB 写入失败（报告仍将生成）：${err?.message?.slice(0, 120) ?? 'unknown'}`, progress: 57 });
  }

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
