import { NextResponse } from 'next/server';
import { sseStream, sleep, type SseEvent } from '@/lib/sse';
import { generateText } from '@/lib/llm';
import { buildReportSystemPrompt, buildReportUserPrompt, buildDetailedPdbTable, buildDetailedBlastTable, buildChapterPrompt, buildChapterSystemPrompt, validateChapterContent, normalizeEvalChapterContent, type ReportChapterKey, type StructureAnalysisData } from '@/lib/report-template';
import { sanitizeReport } from '@/lib/markdown-renderer';
import { buildProvenance, verifyCitations, hashPrompt, type DataSourceTrace, type LlmTrace, type ProvenanceRecord } from '@/lib/provenance';
import { runMultipleAnalyses, runMultipleAnalysesWithCacheInfo, runAnalysisRecipe, pickAnalysisChains, detectPrimaryLigand, detectAllLigands } from '@/lib/molcraft/recipe-runner';
import { fetchPdbIdsForUniprot, fetchPdbEntryDetails, fetchUniprotMeta, type PdbEntryDetail } from '@/lib/rcsb';
import { runBlast, runBlastDb, fetchUniprotSequence } from '@/lib/blast';
import { efetch } from '@/lib/pubmed';
import { db } from '@/lib/db';
import { Prisma } from "@prisma/client";
import { applySchemaCompat } from '@/lib/schema-compat';
import { getActiveDbFsPath } from '@/lib/db';
import { JOURNAL_IF_MAP } from '@/lib/journal-if-map';
import { resolveRunLlmConfig } from '@/lib/agent/eval-llm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** API-01: max targets per batch run — each target fans out to RCSB + BLAST +
 *  LLM calls, so an unbounded targets[] is an unauthenticated external-API
 *  storm (the per-target loop near the end of this route iterates them all). */
const MAX_TARGETS = 20;
/** API-01: clamp for maxPdb (RCSB detail fetches per target). */
const MAX_PDB_CAP = 200;
/** API-01: clamp for maxBlastHits (NCBI BLAST result rows). */
const MAX_BLAST_HITS_CAP = 100;

/**
 * Backfill PubMedArticle table with metadata for any pubmedIds found in the
 * given PDB details that aren't already in the DB. This makes the literature
 * show up in the Literature module (which reads from PubMedArticle) and tags
 * each paper with the target (uniprotId) that surfaced it via the existing
 * EvaluationPdbStructure.pubmedId link.
 *
 * - Dedup by pubmedId (only fetches PMIDs not already in PubMedArticle).
 * - Batches efetch calls (50 PMIDs per NCBI request).
 * - Failures are logged but never abort the evaluation.
 */

/**
 * Round 51: Safe placeholder helper for SQLite $queryRaw.
 * Returns just the placeholder list `?, ?, ?, ...` (one `?` per value).
 * Prisma.join(values) emits a Sql fragment of comma-separated placeholders,
 * each bound to the corresponding value at execution time.
 */
function safeInPlaceholders(values: Array<string | number>): Prisma.Sql {
  if (values.length === 0) return Prisma.sql`NULL`; // never matches
  return Prisma.join(values);
}

async function backfillPubMedArticles(
  pdbDetails: PdbEntryDetail[],
  emit?: (e: SseEvent) => void,
): Promise<{ fetched: number; skipped: number; failed: number }> {
  const pmids = Array.from(new Set(
    pdbDetails
      .map(e => (e.pubmedId || '').toString().trim())
      .filter(Boolean),
  ));
  if (pmids.length === 0) return { fetched: 0, skipped: 0, failed: 0 };

  // Check which PMIDs are already in PubMedArticle.
  let existingPmids = new Set<string>();
  try {
    const rows = await db.$queryRaw<any[]>`SELECT pubmedId FROM PubMedArticle WHERE pubmedId IN (${safeInPlaceholders(pmids)})`;
    existingPmids = new Set((rows as any[]).map(r => String(r.pubmedId)));
  } catch {
    // Table might not exist yet — treat all as missing.
  }
  const missing = pmids.filter(p => !existingPmids.has(p));
  if (missing.length === 0) {
    return { fetched: 0, skipped: pmids.length, failed: 0 };
  }

  // Fetch missing article metadata from NCBI E-utilities.
  let papers: Array<{ pmid: string; title: string; authors: string; journal: string; abstract: string; pubYear: string; pubMonth: string; pubDay: string; doi: string }> = [];
  let failed = 0;
  try {
    const fetched = await efetch(missing);
    papers = fetched.map(p => ({ pmid: p.pmid, title: p.title, authors: p.authors, journal: p.journal, abstract: p.abstract, pubYear: p.pubYear, pubMonth: p.pubMonth, pubDay: p.pubDay, doi: p.doi }));
  } catch (err: any) {
    failed = missing.length;
    emit?.({ stage: 'pubmed-backfill', level: 'warn', message: `PubMed efetch 失败（${missing.length} 篇）: ${err?.message}`, progress: 0 });
    return { fetched: 0, skipped: existingPmids.size, failed };
  }

  // Upsert into PubMedArticle using Prisma (schema-aware, robust against
  // schema drift) instead of raw SQL.
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
      // ignore individual insert errors
    }
  }
  failed = missing.length - papers.length;
  return { fetched: inserted, skipped: existingPmids.size, failed };
}

function buildPdbTableFromReal(details: PdbEntryDetail[]): string {
  return details.slice(0, 10)
    .map(e => `| ${e.pdbId} | ${e.method || '-'} | ${e.resolution != null ? e.resolution.toFixed(1) : '-'} | ${e.journal || '-'} (${e.journalIf != null ? e.journalIf.toFixed(1) : '-'}) | ${(e.title || '').slice(0, 50)} |`)
    .join('\n');
}

/**
 * Build a formatted literature/paper info string for the LLM prompt.
 *
 * Given a list of PDB entry details, this:
 *   1. Collects all non-empty `pubmedId` values
 *   2. Queries the `PubMedArticle` table for any matching articles
 *   3. Joins each PubMedArticle with the journal IF from the PDB entry that
 *      references it (via `PdbStructure.journalIf` / `PdbEntryDetail.journalIf`)
 *   4. If more than `maxLitCount` papers, sorts by journal IF desc and keeps top N
 *   5. Returns a formatted multi-line string with title + journal (IF) + abstract
 *      (truncated to 200 chars). Empty string when no PubMed articles found.
 *
 * Also reads `PdbStructure.journalIf` directly as a fallback in case
 * PubMedArticle query returns hits but PdbEntryDetail.journalIf is null.
 */
async function buildLiteratureInfo(
  pdbDetails: PdbEntryDetail[],
  maxLitCount: number,
): Promise<{ text: string; count: number }> {
  // Collect pubmedIds (non-empty) from the PDB details.
  const pmidToIf = new Map<string, number | null>();
  for (const e of pdbDetails) {
    const pm = (e.pubmedId || '').toString().trim();
    if (!pm) continue;
    // Prefer the highest journalIf when multiple PDBs cite the same paper.
    const cur = pmidToIf.get(pm) ?? null;
    if (e.journalIf != null && (cur == null || e.journalIf > cur)) {
      pmidToIf.set(pm, e.journalIf);
    } else if (!pmidToIf.has(pm)) {
      pmidToIf.set(pm, null);
    }
  }
  const pmids = Array.from(pmidToIf.keys());
  if (pmids.length === 0) return { text: '', count: 0 };

  // Query PubMedArticle table for any matching articles.
  let articles: Array<{ pubmedId: string; title: string | null; journal: string | null; abstract: string | null }> = [];
  try {
    const rows = await db.$queryRaw<any[]>`SELECT pubmedId, title, journal, abstract FROM PubMedArticle WHERE pubmedId IN (${safeInPlaceholders(pmids)})`;
    articles = (rows as any[]).map((r) => ({ pubmedId: r.pubmedId, title: r.title, journal: r.journal, abstract: r.abstract }));
  } catch {
    // PubMedArticle table may not exist or be empty — degrade gracefully.
    return { text: '', count: 0 };
  }
  if (articles.length === 0) return { text: '', count: 0 };

  // Backfill journal IF from PdbStructure AND EvaluationPdbStructure tables
  // for any PMIDs whose IF is null. PdbStructure is populated by the weekly
  // report path; EvaluationPdbStructure is populated by the evaluation path.
  // Either may have the IF data we need.
  const nullIfPmids = articles
    .map((a) => a.pubmedId)
    .filter((pm) => pmidToIf.get(pm) == null);
  if (nullIfPmids.length > 0) {
    // Try PdbStructure first (weekly report path)
    try {
      const ifRows = await db.$queryRaw<any[]>`SELECT pubmedId, journalIf FROM PdbStructure WHERE pubmedId IN (${safeInPlaceholders(nullIfPmids)}) AND journalIf IS NOT NULL`;
      for (const r of ifRows as any[]) {
        const pm = r.pubmedId?.toString();
        if (!pm) continue;
        const v = typeof r.journalIf === 'number' ? r.journalIf : Number(r.journalIf);
        if (!Number.isNaN(v)) pmidToIf.set(pm, v);
      }
    } catch {
      // PdbStructure may not exist (depends on schema state) — ignore.
    }
    // Try EvaluationPdbStructure (evaluation path — this is where the current
    // eval's PDBs live, with journalIf from RCSB)
    const stillNullPmids = nullIfPmids.filter((pm) => pmidToIf.get(pm) == null);
    if (stillNullPmids.length > 0) {
      try {
        const ifRows2 = await db.$queryRaw<any[]>`SELECT pubmedId, journalIf, journal FROM EvaluationPdbStructure WHERE pubmedId IN (${safeInPlaceholders(stillNullPmids)}) AND journalIf IS NOT NULL`;
        for (const r of ifRows2 as any[]) {
          const pm = r.pubmedId?.toString();
          if (!pm) continue;
          const v = typeof r.journalIf === 'number' ? r.journalIf : Number(r.journalIf);
          if (!Number.isNaN(v)) pmidToIf.set(pm, v);
        }
      } catch {
        // ignore
      }
    }
    // Last resort: online IF lookup via Crossref for any still-null PMIDs.
    // Uses the journal name from PubMedArticle to fetch IF.
    const finalNullPmids = nullIfPmids.filter((pm) => pmidToIf.get(pm) == null);
    if (finalNullPmids.length > 0 && finalNullPmids.length <= 30) {
      try {
        const { fetchJournalIFs } = await import('@/lib/journal-if-api');
        const { buildJournalLookup, matchJournalIf } = await import('@/lib/journal-matching');
        // Build a lookup from journal name → IF using all PdbStructure +
        // EvaluationPdbStructure rows that have IF data.
        const allIfRows = await db.$queryRaw<any[]>`SELECT DISTINCT journal, journalIf FROM PdbStructure WHERE journalIf IS NOT NULL AND journalIf > 0`;
        const evalIfRows = await db.$queryRaw<any[]>`SELECT DISTINCT journal, journalIf FROM EvaluationPdbStructure WHERE journalIf IS NOT NULL AND journalIf > 0`;
        const combined = [...(allIfRows as any[]), ...(evalIfRows as any[])];
        const { journalIfMap, pdbJournals } = buildJournalLookup(combined as any[]);
        // For PMIDs still without IF, match by journal name
        for (const a of articles) {
          if (pmidToIf.get(a.pubmedId) != null) continue;
          if (!a.journal) continue;
          const ifVal = matchJournalIf(a.journal, journalIfMap, pdbJournals);
          if (ifVal != null) pmidToIf.set(a.pubmedId, ifVal);
        }
        // If still null, try online Crossref lookup for unique journals
        const stillNull = articles.filter(a => pmidToIf.get(a.pubmedId) == null && a.journal);
        if (stillNull.length > 0 && stillNull.length <= 15) {
          const uniqueJournals = [...new Set(stillNull.map(a => a.journal!).filter(Boolean))];
          const onlineIfMap = await fetchJournalIFs(uniqueJournals);
          for (const a of stillNull) {
            const ifVal = onlineIfMap.get(a.journal!);
            if (ifVal != null) pmidToIf.set(a.pubmedId, ifVal);
          }
        }
      } catch {
        // ignore — IF is best-effort, not critical for the report
      }
    }
  }

  // Build candidate paper list with [pubmedId, title, journal, if, abstract].
  type Paper = { pubmedId: string; title: string; journal: string; ifVal: number; abstract: string };
  const papers: Paper[] = articles.map((a) => ({
    pubmedId: a.pubmedId,
    title: (a.title || '').trim() || '(无标题)',
    journal: (a.journal || '').trim() || '(未知期刊)',
    ifVal: pmidToIf.get(a.pubmedId) ?? 0,
    abstract: (a.abstract || '').trim(),
  }));

  // Sort by journal IF desc, then by title asc as a tie-breaker.
  papers.sort((a, b) => b.ifVal - a.ifVal || a.title.localeCompare(b.title));

  // Cap at maxLitCount.
  const capped = papers.slice(0, Math.max(0, Math.floor(maxLitCount)));
  if (capped.length === 0) return { text: '', count: 0 };

  // Format each paper: title + journal (IF) + abstract (truncated 200 chars).
  const lines = capped.map((p) => {
    const ifStr = p.ifVal > 0 ? ` (IF ${p.ifVal.toFixed(1)})` : '';
    const abs = p.abstract ? p.abstract.slice(0, 200) : '(无摘要)';
    return `• [PMID ${p.pubmedId}] ${p.title} — ${p.journal}${ifStr}\n  摘要: ${abs}`;
  });
  const text = lines.join('\n\n');
  return { text, count: capped.length };
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));

  // R180: LLM 设置与 Agent 聊天共享（classic 模式同样适用）—— .hermes 默认
  // provider/model；显式 body.llm 仍可覆盖（API 编程调用向后兼容）。
  // 替换原 Run Center localStorage 配置（UI 已移除）。
  {
    const { shared: _sharedLlm, ...resolvedLlm } = resolveRunLlmConfig(body?.llm);
    body.llm = resolvedLlm;
  }

  // ── Ensure DB schema is up-to-date before any write ──────────────────
  // Legacy DBs may be missing skill module tables (SkillRunRecord etc.)
  // or columns added after the DB was created. applySchemaCompat() is
  // idempotent — it CREATE TABLE IF NOT EXISTS + ALTER TABLE ADD COLUMN
  // for any missing pieces. We run it at the START of every evaluation so
  // the writes below never hit "no such table" or "no such column". The
  // call is best-effort: a failure is logged but does NOT abort the run
  // (the DB might be on read-only media in the packaged app; we'd rather
  // attempt the writes and surface their specific errors).
  try {
    const dbPath = getActiveDbFsPath();
    const compat = await applySchemaCompat(dbPath);
    if (compat.addedColumns.length > 0) {
      console.log(`[eval/run] schema-compat applied: ${compat.addedColumns.join(', ')}`);
    }
  } catch (e: any) {
    console.warn(`[eval/run] schema-compat skipped: ${e?.message ?? e}`);
  }

  // Support both flat fields (single target) and targets[] array (batch mode).
  // When targets[] is present, use the first target's params for the primary
  // evaluation. Batch mode iterates over all targets after the primary.
  const targets: Array<{ uniprot: string; forceBlast?: boolean; skipBlast?: boolean; maxPdb?: number; maxBlastHits?: number }> = Array.isArray(body.targets) ? body.targets : [];
  // API-01: cap the batch size before any external API / LLM work starts.
  if (targets.length > MAX_TARGETS) {
    return NextResponse.json(
      { error: `Too many targets: ${targets.length} (max ${MAX_TARGETS}). Split the batch into smaller runs.` },
      { status: 400 },
    );
  }
  const primaryTarget = targets[0] || {};
  const uniprot = (body.uniprot || primaryTarget.uniprot || 'P00533').trim().toUpperCase();
  const forceBlast = !!(body.forceBlast ?? primaryTarget.forceBlast);
  const skipBlast = !!(body.skipBlast ?? primaryTarget.skipBlast);
  // API-01: upper-clamp the request-driven external-API fan-out (same clamp
  // style as maxLitCount below — clamp, don't reject, for consistency).
  const maxPdb = Math.max(0, Math.min(MAX_PDB_CAP, Number(body.maxPdb ?? primaryTarget.maxPdb ?? 80)));
  // BLAST homolog cap. Default 50 (NCBI BLAST pdbaa typical sensible max). UI-configurable.
  // API-01: clamped to MAX_BLAST_HITS_CAP.
  const maxBlastHits = Math.max(0, Math.min(MAX_BLAST_HITS_CAP, Number(body.maxBlastHits ?? primaryTarget.maxBlastHits ?? body.maxBlast ?? 50)));
  // Literature cap for LLM prompt context (PubMed articles surfaced alongside PDB details).
  // Default 20. UI-configurable. Papers beyond this are filtered by journal IF desc.
  const maxLitCount = Math.max(0, Math.min(200, Number(body.maxLitCount ?? 20)));
  const generateReport = body.generateReport !== false;
  const saveReportFile = body.saveReportFile !== false;
  // Round 36: Allow opting out of structural analysis for faster report generation
  const skipStructureAnalysis = !!body.skipStructureAnalysis;
  const isBatch = !!body.isBatch && targets.length > 1;
  // R180: body.llm has been replaced with the shared Agent-chat LLM config
  // above — provider/model now default to the shared default provider
  // (zai SDK when nothing is configured). Fallbacks kept for safety.
  const provider = body.llm?.provider || 'cli:hermes';
  const model = body.llm?.model || 'hermes';

  const { stream, progress, done } = sseStream();
  (async () => {
    const t0 = Date.now();
    // ── Batch progress remapping ────────────────────────────────────────────
    // In batch mode, each target's local 0..100 progress is mapped into a
    // global slot so the bar advances monotonically across all targets:
    //   target 0: [2, 2+slot)
    //   target i: [2+i*slot, 2+(i+1)*slot)
    //   cross-analysis + batch-db: [97, 100]
    // slot = 97 / targetCount. The final 3% is reserved for cross-analysis.
    const _origProgress = progress;
    let _batchIdx: number | null = null; // null = no remapping (single mode)
    let _batchCount = 0;
    const remapProgress = (localPct: number): number => {
      if (_batchIdx === null) return localPct;
      const slot = 97 / _batchCount;
      const base = 2 + _batchIdx * slot;
      return Math.min(97, Math.max(2, Math.round(base + (localPct / 100) * slot)));
    };
    // Accumulate every SSE event into a log array so the Run Center can
    // show the full log for past runs (not just the short summary).
    const _log: string[] = [];
    const emit = (e: SseEvent) => {
      try { _log.push(JSON.stringify({ ts: new Date().toISOString(), ...e })); } catch { /* never let logging break the route */ }
      _origProgress({ ...e, progress: remapProgress(e.progress ?? 0) });
    };
    try {
      // ── Helper: evaluate ONE sequence (used by both single & multi-sequence modes) ──
      // Returns the full per-sequence result object. All log messages are
      // prefixed with `[序列 i/N]` when seqTotal > 1 so the SSE feed can show
      // which sequence is being processed.
      const evaluateOneSequence = async (
        rawSequence: string,
        seqType: 'aa' | 'dna',
        seqIndex: number,
        seqTotal: number,
      ): Promise<{
        seqId: string;
        uniprotInfo: any;
        pdbDetails: PdbEntryDetail[];
        blastHits: any[];
        scores: any;
        coverage: number;
        report: any;
        usedNrFallback: boolean;
        ok: boolean;
        error?: string;
      }> => {
        const prefix = seqTotal > 1 ? `[序列 ${seqIndex}/${seqTotal}] ` : '';
        // Generate a stable seqId up front (fixes prior TDZ bug where seqId
        // was referenced before its declaration).
        const seqId = `SEQ_${Date.now().toString(36)}_${seqIndex}`;
        let sequence = String(rawSequence).trim().toUpperCase().replace(/\s/g, '');
        emit({ stage: 'init', level: 'info', message: `${prefix}启动序列评估 · ${seqType === 'dna' ? 'DNA' : 'AA'} 序列 (${sequence.length} ${seqType === 'dna' ? 'nt' : 'aa'})`, progress: 2 });
        await sleep(200);

        // Transcribe DNA to amino acid sequence
        if (seqType === 'dna') {
          emit({ stage: 'transcribe', level: 'info', message: `${prefix}DNA → 氨基酸转录中…`, progress: 5 });
          const cleanDna = sequence.replace(/[^ATGC]/g, '');
          const codonTable: Record<string, string> = {
            'TTT':'F','TTC':'F','TTA':'L','TTG':'L','CTT':'L','CTC':'L','CTA':'L','CTG':'L',
            'ATT':'I','ATC':'I','ATA':'I','ATG':'M','GTT':'V','GTC':'V','GTA':'V','GTG':'V',
            'TCT':'S','TCC':'S','TCA':'S','TCG':'S','CCT':'P','CCC':'P','CCA':'P','CCG':'P',
            'ACT':'T','ACC':'T','ACA':'T','ACG':'T','GCT':'A','GCC':'A','GCA':'A','GCG':'A',
            'TAT':'Y','TAC':'Y','TAA':'*','TAG':'*','CAT':'H','CAC':'H','CAA':'Q','CAG':'Q',
            'AAT':'N','AAC':'N','AAA':'K','AAG':'K','GAT':'D','GAC':'D','GAA':'E','GAG':'E',
            'TGT':'C','TGC':'C','TGA':'*','TGG':'W','CGT':'R','CGC':'R','CGA':'R','CGG':'R',
            'AGT':'S','AGC':'S','AGA':'R','AGG':'R','GGT':'G','GGC':'G','GGA':'G','GGG':'G',
          };
          let aaSeq = '';
          for (let i = 0; i + 2 < cleanDna.length; i += 3) {
            const codon = cleanDna.slice(i, i + 3);
            const aa = codonTable[codon] || 'X';
            if (aa === '*') break; // stop codon
            aaSeq += aa;
          }
          sequence = aaSeq;
          emit({ stage: 'transcribe', level: 'success', message: `${prefix}转录完成: ${cleanDna.length}nt → ${aaSeq.length}aa`, progress: 10 });
        }

        // Run BLASTp — pdbaa first, fallback to nr if no hits or top identity < 95%
        emit({ stage: 'blast', level: 'info', message: `${prefix}BLASTp 同源检索 — pdbaa 数据库（序列 ${sequence.length}aa, 上限 ${maxBlastHits}）`, progress: 15 });
        let blastHits: any[] = [];
        let usedNrFallback = false;
        try {
          // No fixed timeout — runBlastDb polls NCBI until the result is
          // ready (FAILED/UNKNOWN are the only hard stops). The previous
          // 180s race aborted legitimate long-running queries when NCBI
          // queue congestion pushed pdbaa to 3+ minutes.
          blastHits = await runBlast(sequence, maxBlastHits, (msg) => { emit({ stage: 'blast', level: 'info', message: `${prefix}${msg}`, progress: 20 }); });
          const topIdentity = blastHits.length > 0 ? blastHits[0].identity : 0;
          if (blastHits.length === 0) {
            emit({ stage: 'blast', level: 'warn', message: `${prefix}pdbaa 数据库无命中，回退搜索 nr 数据库…`, progress: 25 });
          } else if (topIdentity < 95) {
            emit({ stage: 'blast', level: 'warn', message: `${prefix}pdbaa 最高同源度 ${topIdentity}% < 95%，回退搜索 nr 数据库…`, progress: 25 });
          } else {
            emit({ stage: 'blast', level: 'success', message: `${prefix}pdbaa 命中 ${blastHits.length}/${maxBlastHits} 条同源（最高 identity=${topIdentity}% · ${blastHits[0].pdbId}）`, progress: 40 });
          }
          if (blastHits.length === 0 || topIdentity < 95) {
            emit({ stage: 'blast-nr', level: 'info', message: `${prefix}BLASTp 同源检索 — nr 数据库（非冗余库, 上限 ${maxBlastHits}）`, progress: 28 });
            try {
              // No timeout on nr either — nr is huge (~80 GB) and routinely
              // takes 2-3 min; we let it run to completion.
              const nrHits = await runBlastDb(sequence, maxBlastHits, 'nr', (msg) => { emit({ stage: 'blast-nr', level: 'info', message: `${prefix}${msg}`, progress: 30 }); });
              if (nrHits.length > 0) {
                usedNrFallback = true;
                blastHits = nrHits;
                emit({ stage: 'blast-nr', level: 'success', message: `${prefix}nr 命中 ${nrHits.length}/${maxBlastHits} 条同源（最高 identity=${nrHits[0].identity}% · ${nrHits[0].uniprotRef}）`, progress: 40 });
              } else {
                emit({ stage: 'blast-nr', level: 'warn', message: `${prefix}nr 数据库也无命中`, progress: 40 });
              }
            } catch (nrErr: any) {
              emit({ stage: 'blast-nr', level: 'error', message: `${prefix}nr 搜索失败：${nrErr?.message}`, progress: 40 });
            }
          }
        } catch (err: any) {
          emit({ stage: 'blast', level: 'error', message: `${prefix}BLAST pdbaa 失败：${err?.message}`, progress: 40 });
        }

        // Build pdbDetails from BLAST hits. For pdbaa hits, pdbId is real.
        // For nr hits, pdbId is empty (we never extract fake pdbIds from
        // UniProt accessions — see parseBlastXml in src/lib/blast.ts). The
        // real pdb list for nr-fallback path comes from UniProt → RCSB lookup
        // below, AFTER we have the uniprotAcc.
        let pdbDetails: PdbEntryDetail[] = blastHits
          .filter((h: any) => h.pdbId)  // skip nr hits with empty pdbId
          .map((h: any) => ({
            pdbId: h.pdbId, method: h.method || 'X-RAY DIFFRACTION', resolution: h.resolution ?? null,
            title: h.description || h.title || '', journal: h.journal || '', journalIf: h.journalIf ?? null,
            doi: null, pubmedId: h.pubmedId || null, organisms: h.organism || '',
            authors: '', ligands: '', depositDate: null, releaseDate: h.releaseDate || null,
          }));

        // ── Fetch UniProt metadata from the top BLAST hit ──
        let uniprotInfo: any = { uniprotId: seqId, entryName: 'Sequence Input', proteinName: `Input Sequence (${sequence.length}aa)`, geneNames: 'N/A', organism: 'N/A', sequenceLength: sequence.length };
        if (blastHits.length > 0) {
          const topHit = blastHits[0];
          emit({ stage: 'uniprot-lookup', level: 'info', message: `${prefix}从最高同源性命中 (${usedNrFallback ? topHit.uniprotRef : topHit.pdbId}, identity=${topHit.identity}%) 查找 UniProt 元数据…`, progress: 42 });
          try {
            let uniprotAcc: string | null = null;
            if (usedNrFallback) {
              const acc = topHit.uniprotRef;
              const uniMatch = (topHit.description || '').match(/sp\|([A-Z0-9]+)\|/);
              if (uniMatch) {
                uniprotAcc = uniMatch[1];
              } else if (/^[A-NR-Z][0-9][A-Z0-9]{3}[0-9]/i.test(acc) || /^([A-Z0-9]{6,10})$/i.test(acc)) {
                uniprotAcc = acc;
              } else {
                emit({ stage: 'uniprot-lookup', level: 'info', message: `${prefix}通过 NCBI accession ${acc} 搜索 UniProt…`, progress: 44 });
                const uniSearchRes = await fetch(`https://rest.uniprot.org/uniprotkb/search?query=xref:${acc}&fields=accession&format=json&size=1`, { signal: AbortSignal.timeout(15000) });
                if (uniSearchRes.ok) {
                  const uniSearchData = await uniSearchRes.json();
                  uniprotAcc = uniSearchData?.results?.[0]?.primaryAccession || null;
                }
              }
            } else {
              const rcsbRes = await fetch(`https://data.rcsb.org/rest/v1/core/polymer_entity/${topHit.pdbId}/1`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
              if (rcsbRes.ok) {
                const rcsbData = await rcsbRes.json();
                const uniProts = rcsbData?.rcsb_polymer_entity_container_identifiers?.reference_sequence_identifiers || [];
                uniprotAcc = uniProts.find((r: any) => r.database_name === 'UniProt')?.database_accession || null;
              }
            }
            if (uniprotAcc) {
              emit({ stage: 'uniprot-lookup', level: 'info', message: `${prefix}找到 UniProt accession: ${uniprotAcc}，获取元数据…`, progress: 44 });
              const meta = await fetchUniprotMeta(uniprotAcc);
              if (meta) {
                uniprotInfo = {
                  uniprotId: uniprotAcc,
                  entryName: meta.entryName,
                  proteinName: meta.proteinName,
                  geneNames: meta.geneNames,
                  organism: meta.organism,
                  sequenceLength: meta.sequenceLength,
                  blastIdentity: topHit.identity,
                  blastPdbId: topHit.pdbId,
                  blastSource: usedNrFallback ? 'nr' : 'pdbaa',
                };
                emit({ stage: 'uniprot-lookup', level: 'success', message: `${prefix}UniProt 元数据: ${meta.proteinName} · ${meta.organism} · ${meta.sequenceLength}aa (BLAST identity=${topHit.identity}% via ${usedNrFallback ? 'nr' : 'pdbaa'})`, progress: 46 });
              } else {
                emit({ stage: 'uniprot-lookup', level: 'warn', message: `${prefix}UniProt 元数据获取失败 (${uniprotAcc})`, progress: 46 });
              }
            } else {
              emit({ stage: 'uniprot-lookup', level: 'warn', message: `${prefix}未找到关联的 UniProt accession`, progress: 46 });
            }

            // ── nr-fallback path: fetch REAL PDB IDs from UniProt → RCSB ──
            // The nr BLAST hit's pdbId is empty (parseBlastXml never extracts
            // a fake one from a UniProt accession). To get a real PDB list
            // for scoring + the LLM report, query RCSB by the UniProt accession
            // we just resolved. We MERGE these with any pdbaa hits already in
            // pdbDetails (in case some pdbaa hits survived the threshold), and
            // dedup by pdbId. UniProt-sourced entries take priority (they carry
            // proper RCSB metadata: method, resolution, journal, pubmedId).
            if (usedNrFallback && uniprotAcc) {
              emit({ stage: 'rcsb-from-uniprot', level: 'info', message: `${prefix}nr-fallback 路径: 从 UniProt ${uniprotAcc} 反查真实 PDB ID（最多 ${maxPdb}）…`, progress: 47 });
              try {
                const uniprotPdbIds = await fetchPdbIdsForUniprot(uniprotAcc, maxPdb);
                if (uniprotPdbIds.length > 0) {
                  const uniprotPdbDetails = await fetchPdbEntryDetails(uniprotPdbIds, uniprotPdbIds.length);
                  // Dedup: prefer UniProt-sourced entries (full RCSB metadata)
                  // over any leftover pdbaa hits that happen to share a pdbId.
                  const seenPdbIds = new Set(uniprotPdbDetails.map(e => e.pdbId));
                  pdbDetails = [
                    ...uniprotPdbDetails,
                    ...pdbDetails.filter(e => !seenPdbIds.has(e.pdbId)),
                  ];
                  emit({ stage: 'rcsb-from-uniprot', level: 'success', message: `${prefix}✓ UniProt ${uniprotAcc} → RCSB 反查命中 ${uniprotPdbDetails.length} 个真实 PDB（合并后 ${pdbDetails.length}）`, progress: 48 });
                } else {
                  emit({ stage: 'rcsb-from-uniprot', level: 'warn', message: `${prefix}UniProt ${uniprotAcc} 在 RCSB 中无关联 PDB`, progress: 48 });
                }
              } catch (rcsbErr: any) {
                emit({ stage: 'rcsb-from-uniprot', level: 'warn', message: `${prefix}RCSB 反查失败: ${rcsbErr?.message}`, progress: 48 });
              }
            }
          } catch (err: any) {
            emit({ stage: 'uniprot-lookup', level: 'warn', message: `${prefix}UniProt 查找失败: ${err?.message}`, progress: 46 });
          }
        }

        // Score from BLAST hit count
        const xrayCount = pdbDetails.filter(e => (e.method || '').includes('X-RAY')).length;
        const cryoemCount = pdbDetails.filter(e => (e.method || '').includes('ELECTRON')).length;
        const nmrCount = pdbDetails.filter(e => (e.method || '').includes('NMR')).length;
        // Score scale: sqrt-based so 0 structures → 1 (lowest), and the score
        // differentiates meaningfully across small counts (the previous
        // round(c/5)+3 formula gave 0/1/2 structures all the same score of 3,
        // making every target look identical on the radar when BLAST found
        // few hits).
        //   c=0 → 1, c=1 → 2, c=4 → 4, c=9 → 6, c=16 → 8, c=25 → 10
        const calcScore = (c: number) => Math.min(10, Math.max(1, Math.round(Math.sqrt(Math.max(0, c)) * 2)));
        const scores = {
          xray: { score: calcScore(xrayCount), rating: '', structures: xrayCount, max: 10 },
          cryoem: { score: calcScore(cryoemCount), rating: '', structures: cryoemCount, max: 10 },
          nmr: { score: calcScore(nmrCount), rating: '', structures: nmrCount, max: 10 },
          overall: { score: Math.min(10, Math.max(1, Math.round((calcScore(xrayCount) + calcScore(cryoemCount) + calcScore(nmrCount)) / 3))), rating: '', max: 10 },
        };
        const coverage = Math.min(100, pdbDetails.length * 5);
        const scoreRating = (s: number) => s >= 8 ? '优' : s >= 6 ? '良' : s >= 4 ? '中' : '差';
        scores.xray.rating = scoreRating(scores.xray.score);
        scores.cryoem.rating = scoreRating(scores.cryoem.score);
        scores.nmr.rating = scoreRating(scores.nmr.score);
        scores.overall.rating = scoreRating(scores.overall.score);
        emit({ stage: 'score', level: 'success', message: `${prefix}overall=${scores.overall.score}/10 (X-ray=${scores.xray.score}/${xrayCount}条, Cryo-EM=${scores.cryoem.score}/${cryoemCount}条, NMR=${scores.nmr.score}/${nmrCount}条)`, progress: 50 });

        // Generate report (single-call — shorter than 8-chapter UniProt mode)
        let report: any = undefined;
        if (generateReport) {
          emit({ stage: 'llm-report', level: 'info', message: `${prefix}生成 LLM 报告 (${provider})…`, progress: 55 });
          try {
            // Round 52: Backfill PubMed before building literature info (same fix as primary path)
            await backfillPubMedArticles(pdbDetails, emit);
            const litInfo = await buildLiteratureInfo(pdbDetails, maxLitCount);
            const pdbTable = pdbDetails.length > 0
              ? buildDetailedPdbTable(pdbDetails, 80)
              : '| PDB ID | Method | Resolution | Journal (IF) | Title |\n|--------|--------|------------|--------------|-------|\n| (无 BLAST 同源结构) | - | - | - | - |';
            const blastTable = buildDetailedBlastTable(blastHits, maxBlastHits);
            const topPdbs = pdbDetails.slice(0, 10).map(e => `- ${e.pdbId}: ${e.method || 'unknown'} | ${e.resolution != null ? e.resolution.toFixed(1) + 'Å' : 'N/A'} | ${(e.title || '').slice(0, 60)}`).join('\n');
            const litBlock = litInfo.count > 0 ? `\n\n相关 PubMed 文献（共 ${litInfo.count} 篇，按 IF 降序）：\n${litInfo.text}` : '\n\n（无 PubMed 文献数据）';
            const userPrompt = `Generate a Chinese protein structure feasibility report for:

UniProt: ${uniprotInfo.uniprotId !== seqId ? uniprotInfo.uniprotId : '(序列输入模式 — 无直接 UniProt ID)'}
Protein: ${uniprotInfo.proteinName}
Gene: ${uniprotInfo.geneNames}
Organism: ${uniprotInfo.organism}
Sequence length: ${uniprotInfo.sequenceLength} aa
BLAST top hit: ${uniprotInfo.blastPdbId ? `${uniprotInfo.blastPdbId} (identity=${uniprotInfo.blastIdentity}%)` : 'N/A'}
Input sequence: ${sequence.slice(0, 100)}... (${sequence.length}aa)
BLAST hits: ${blastHits.length}
Top BLAST structures:
${topPdbs || '（无 BLAST 命中）'}

${pdbTable}

${blastTable}${litBlock}

请基于 BLAST 同源搜索结果和 UniProt 元数据生成评估报告。重点分析输入序列与已知蛋白的同源性、结构特征、功能推断。`;
            const bSysPrompt = '你是结构生物学领域的资深研究员。请用中文生成一份蛋白序列评估报告（800-1500 字），使用 Markdown 格式，包含以下章节：## 序列概述、## BLAST 同源结构分析、## 可成药性评估、## 实验建议、## 总结。';
            // Generous ceiling: the previous 2000-char cap truncated mid-section
            // for targets with rich BLAST hits (~10-15 hits per target). 6000
            // lets the model produce 4-6 well-developed paragraphs per chapter
            // — the LLM was previously padding its output with "..." to fit.
            const r = await generateText(bSysPrompt, userPrompt, { maxChars: 6000, llm: body.llm });
            // Sanitize the LLM output: closes unclosed **, completes truncated
            // table headers, cuts back to last full sentence if the LLM was
            // cut off mid-word. Applied at ingestion so the DB stores clean
            // reports — the renderer no longer needs to handle the half-
            // written edge cases.
            const sanitized = r.ok && r.content ? sanitizeReport(r.content) : (r.content || '');
            report = { ok: r.ok, content: sanitized, provider: r.provider, model: r.model, durationMs: r.durationMs, contentChars: sanitized.length, fallback: false };
            if (r.ok) emit({ stage: 'llm-report', level: 'success', message: `${prefix}LLM 报告已生成 · ${report.contentChars} chars · ${(r.durationMs / 1000).toFixed(1)}s · ${r.provider}/${r.model}`, progress: 90 });
            else emit({ stage: 'llm-report', level: 'error', message: `${prefix}LLM 报告失败：${r.error}`, progress: 90 });
          } catch (err: any) {
            emit({ stage: 'llm-report', level: 'error', message: `${prefix}LLM 生成失败：${err?.message}`, progress: 90 });
          }
        }

        // Write to DB
        try {
          const scoresJson = JSON.stringify({ 'X-ray': { score: scores.xray.score, rating: scores.xray.rating, max: 10 }, 'Cryo-EM': { score: scores.cryoem.score, rating: scores.cryoem.rating, max: 10 }, 'NMR': { score: scores.nmr.score, rating: scores.nmr.rating, max: 10 }, 'Overall': { score: scores.overall.score, rating: scores.overall.rating, max: 10 } });
          await db.$executeRaw`INSERT INTO Evaluation (uniprotId, entryName, proteinName, geneNames, organism, sequenceLength, coverage, scores, report, maxPdbUsed, blastWasSkipped, pdbCountAtEval, createdAt, updatedAt) VALUES (${seqId}, ${uniprotInfo.entryName}, ${uniprotInfo.proteinName}, ${uniprotInfo.geneNames}, ${uniprotInfo.organism}, ${uniprotInfo.sequenceLength}, ${coverage}, ${scoresJson}, ${report?.ok ? report.content : null}, 0, false, ${pdbDetails.length}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(uniprotId) DO UPDATE SET entryName = excluded.entryName, proteinName = excluded.proteinName, geneNames = excluded.geneNames, organism = excluded.organism, sequenceLength = excluded.sequenceLength, coverage = excluded.coverage, scores = excluded.scores, report = excluded.report, updatedAt = CURRENT_TIMESTAMP`;
          await db.$executeRaw`DELETE FROM EvaluationPdbStructure WHERE uniprotId = ${seqId}`;
          // Dedup by pdbId — the same PDB can show up multiple times in
          // pdbDetails (BLAST report can return the same entry for
          // multiple chains / HSP regions). We keep the first occurrence.
          const seenPdbIds = new Set<string>();
          let dedupedPdbCount = 0;
          for (const e of pdbDetails) {
            if (!e.pdbId || seenPdbIds.has(e.pdbId)) continue;
            seenPdbIds.add(e.pdbId);
            dedupedPdbCount++;
            const isCryoem = (e.method || '').includes('ELECTRON'); const isXray = (e.method || '').includes('X-RAY'); const isNmr = (e.method || '').includes('NMR');
            const ifTier = e.journalIf == null ? 'unknown' : e.journalIf >= 20 ? 'top' : e.journalIf >= 10 ? 'high' : e.journalIf >= 5 ? 'mid' : 'low';
            await db.$executeRaw`INSERT INTO EvaluationPdbStructure (uniprotId, pdbId, method, resolution, title, depositionDate, releaseDate, ligand, ligandNames, journal, journalIf, doi, pubmedId, organism, authors, isCryoem, isXray, isNmr, ifTier) VALUES (${seqId}, ${e.pdbId}, ${e.method}, ${e.resolution}, ${e.title}, ${e.depositDate || null}, ${e.releaseDate}, ${e.ligands || ''}, ${e.ligands || ''}, ${e.journal}, ${e.journalIf}, ${e.doi}, ${e.pubmedId}, ${e.organisms || ''}, ${e.authors || ''}, ${isCryoem}, ${isXray}, ${isNmr}, ${ifTier})`;
          }
          await db.$executeRaw`DELETE FROM EvaluationBlastResult WHERE uniprotId = ${seqId}`;
          // Dedup blastHits by pdbId as well — same PDB can show up via
          // both pdbaa and nr fallback searches.
          const seenBlastPdbIds = new Set<string>();
          let dedupedBlastCount = 0;
          let paralogCount = 0;
          for (const h of blastHits) {
            if (!h.pdbId || seenBlastPdbIds.has(h.pdbId)) continue;
            seenBlastPdbIds.add(h.pdbId);
            dedupedBlastCount++;
            if (h.isParalog) paralogCount++;
            await db.$executeRaw`INSERT INTO EvaluationBlastResult (uniprotId, pdbId, uniprotRef, description, identity, evalue, queryCoverage, method, source, isParalog) VALUES (${seqId}, ${h.pdbId}, ${h.uniprotRef || ''}, ${h.description || ''}, ${h.identity}, ${h.evalue}, ${h.queryCoverage}, ${'BLASTp'}, ${'NCBI BLAST REST API'}, ${!!h.isParalog})`;
          }
          emit({ stage: 'write-db', level: 'success', message: `${prefix}已写入 Evaluation + ${dedupedPdbCount} PDB (去重自 ${pdbDetails.length}) + ${dedupedBlastCount} BLAST (${paralogCount} 个同源蛋白 ≥95%, 去重自 ${blastHits.length})`, progress: 95 });
        } catch (err: any) {
          emit({ stage: 'write-db', level: 'error', message: `${prefix}DB 写入失败：${err?.message}`, progress: 95 });
        }

        return { seqId, uniprotInfo, pdbDetails, blastHits, scores, coverage, report, usedNrFallback, ok: true };
      };

      // ── Multi-sequence mode: body.inputMode === 'sequence' && Array.isArray(body.sequences) ──
      // Loops through each sequence, runs BLAST + per-sequence report, then
      // generates a cross-sequence comparison report (mirrors batch mode for
      // UniProt IDs).
      if (body.inputMode === 'sequence' && Array.isArray(body.sequences) && body.sequences.length > 0) {
        const seqType: 'aa' | 'dna' = body.sequenceType === 'dna' ? 'dna' : 'aa';
        const rawSeqs: string[] = (body.sequences as any[])
          .filter((s) => typeof s === 'string' && s.replace(/\s/g, '').length >= 10)
          .map((s) => String(s));
        if (rawSeqs.length === 0) {
          emit({ stage: 'error', level: 'error', message: `未提供有效序列（每条至少 10 个残基）`, progress: 100 });
          await sleep(50);
          done({ ok: false, error: 'no valid sequences' });
          return;
        }
        const isMulti = rawSeqs.length > 1;
        emit({ stage: 'init', level: 'info', message: `启动多序列批量评估 · ${rawSeqs.length} 条 ${seqType === 'dna' ? 'DNA' : 'AA'} 序列 — 每条独立 BLASTp${isMulti ? ' + 跨序列相关性分析' : ''} — SSE streaming…`, progress: 2 });
        await sleep(300);

        const seqResults: any[] = [];
        for (let i = 0; i < rawSeqs.length; i++) {
          try {
            const r = await evaluateOneSequence(rawSeqs[i], seqType, i + 1, rawSeqs.length);
            seqResults.push(r);
            emit({ stage: `seq-${i + 1}-done`, level: 'success', message: `[序列 ${i + 1}/${rawSeqs.length}] ${r.seqId} 完成 · ${r.blastHits.length} BLAST 同源 · overall=${r.scores.overall.score}/10${r.report?.ok ? ` · LLM ✓ (${r.report.contentChars} chars)` : ''}`, progress: 100 });
          } catch (err: any) {
            emit({ stage: `seq-${i + 1}-done`, level: 'error', message: `[序列 ${i + 1}/${rawSeqs.length}] 失败：${err?.message}`, progress: 100 });
            seqResults.push({ seqId: `SEQ_ERR_${i + 1}`, ok: false, error: err?.message || String(err), pdbDetails: [], blastHits: [], scores: { overall: { score: 0 } }, coverage: 0, report: undefined, uniprotInfo: { proteinName: `Sequence ${i + 1} (failed)` } });
          }
        }

        // ── Cross-sequence comparison report (only when more than 1 sequence) ──
        let crossReport: any = undefined;
        if (isMulti) {
          // Find common PDB IDs across sequences (pairwise + intersection of all).
          const allPdbSets = seqResults.map(r => ({ seqId: r.seqId, proteinName: r.uniprotInfo?.proteinName, pdbIds: new Set<string>((r.pdbDetails || []).map((e: PdbEntryDetail) => e.pdbId)) }));
          const commonPdbIds = allPdbSets.length > 0
            ? [...allPdbSets[0].pdbIds].filter(id => allPdbSets.every(s => s.pdbIds.has(id)))
            : [];
          const pdbOverlap: Record<string, string[]> = {};
          for (let a = 0; a < allPdbSets.length; a++) {
            for (let b = a + 1; b < allPdbSets.length; b++) {
              const shared = [...allPdbSets[a].pdbIds].filter(id => allPdbSets[b].pdbIds.has(id));
              if (shared.length > 0) {
                pdbOverlap[`${allPdbSets[a].seqId}↔${allPdbSets[b].seqId}`] = shared;
              }
            }
          }
          emit({ stage: 'cross-analysis', level: commonPdbIds.length > 0 ? 'success' : 'info', message: `跨序列共有结构（全部序列）：${commonPdbIds.length} 个${commonPdbIds.length > 0 ? ` (${commonPdbIds.slice(0, 5).join(', ')}…)` : ''} · 两两重叠：${Object.keys(pdbOverlap).length} 对`, progress: 100 });

          if (generateReport) {
            emit({ stage: 'cross-llm', level: 'info', message: `生成跨序列相关性 LLM 分析报告…`, progress: 100 });
            try {
              const crossSysPrompt = '你是结构生物学领域的资深研究员。请用中文生成一份跨序列相关性分析报告，使用 Markdown 格式。分析多条蛋白序列之间的结构关联性、功能关系、以及共有的结构基础。';
              const seqSummary = seqResults.map((r, i) => {
                const top5 = (r.pdbDetails || []).slice(0, 5).map((e: PdbEntryDetail) => `  - ${e.pdbId}: ${e.method} | ${e.resolution != null ? e.resolution.toFixed(1) + 'Å' : 'N/A'} | ${(e.title || '').slice(0, 50)}`).join('\n');
                const s = r.scores as any;
                return `序列 ${i + 1}: ${r.seqId} (${r.uniprotInfo?.proteinName || 'Unknown'})
  序列长度: ${r.uniprotInfo?.sequenceLength || '?'} aa
  BLAST 同源数: ${(r.blastHits || []).length}
  评分: overall=${s?.overall?.score || '?'}/10 (X-ray=${s?.xray?.score || '?'}/${s?.xray?.structures || 0}条, Cryo-EM=${s?.cryoem?.score || '?'}/${s?.cryoem?.structures || 0}条, NMR=${s?.nmr?.score || '?'}/${s?.nmr?.structures || 0}条)
  代表性结构:
${top5 || '  （无 BLAST 命中）'}`;
              }).join('\n\n');
              const overlapSummary = Object.entries(pdbOverlap).length > 0
                ? Object.entries(pdbOverlap).map(([pair, ids]) => {
                    const idDetails = ids.slice(0, 10).map(id => {
                      const det = seqResults.flatMap(r => r.pdbDetails || []).find(e => e.pdbId === id);
                      return `  - ${id}: ${det?.method || 'N/A'} | ${det?.resolution != null ? det.resolution.toFixed(1) + 'Å' : 'N/A'} | ${(det?.title || '').slice(0, 60)}`;
                    }).join('\n');
                    return `${pair}: ${ids.length} 个共有结构\n${idDetails}`;
                  }).join('\n')
                : '无两两共有结构';
              // Aggregate literature across all sequences (cap at maxLitCount, IF desc).
              const allSeqPdbs: PdbEntryDetail[] = seqResults.flatMap(r => r.pdbDetails || []);
              // Round 52: Backfill PubMed before building literature info
              await backfillPubMedArticles(allSeqPdbs, emit);
              const crossLit = await buildLiteratureInfo(allSeqPdbs, maxLitCount);
              const crossLitBlock = crossLit.count > 0
                ? `\n\n相关 PubMed 文献（聚合全部 ${seqResults.length} 条序列，共 ${crossLit.count} 篇，按 IF 降序）：\n${crossLit.text}`
                : '\n\n（无 PubMed 文献数据）';
              const commonPdbDetails = commonPdbIds.length > 0
                ? commonPdbIds.slice(0, 15).map(id => {
                    const det = seqResults.flatMap(r => r.pdbDetails || []).find(e => e.pdbId === id);
                    return `  - ${id}: ${det?.method || 'N/A'} | ${det?.resolution != null ? det.resolution.toFixed(1) + 'Å' : 'N/A'} | ${det?.journal || 'N/A'} (${det?.journalIf != null ? det.journalIf.toFixed(1) : 'N/A'}) | ${(det?.title || '').slice(0, 60)}`;
                  }).join('\n')
                : '（无共有结构）';
              const crossUserPrompt = `请分析以下 ${seqResults.length} 条蛋白序列的结构相关性与功能关系：

${seqSummary}

共有结构分析：
- 全部序列共有的结构: ${commonPdbIds.length} 个
${commonPdbDetails}
- 两两重叠:
${overlapSummary}${crossLitBlock}

请按以下结构生成报告：
## 跨序列相关性分析报告

### 一、序列概览
（简述每条序列的蛋白名称、BLAST 同源结构数量、评分）

### 二、共有结构分析
（分析共有 PDB 结构的含义 — 这些结构可能揭示序列间的进化关系或功能关联）

### 三、功能与通路关联
（基于蛋白名称和结构信息，分析序列是否在同一蛋白家族或功能网络中）

### 四、结构相似性推断
（从共有结构推断序列间的结构相似性，讨论对药物设计或交叉研究的意义）

### 五、文献综合
（结合相关文献区块中的 PMID 列表，简述跨序列文献证据，引用 PMID 编号）

### 六、总结与建议
（总结序列间关系，提出后续研究建议）`;
              // Cross-target report: 8000 chars — covers summary + per-pair
              // comparison + table for 2-4 targets without truncation.
              const r = await generateText(crossSysPrompt, crossUserPrompt, { maxChars: 8000, llm: body.llm });
              // Sanitize the cross-report: closes unclosed **, completes
              // truncated tables, cuts back to last full sentence if the
              // LLM was cut off mid-word. The 4 batch reports in our DB all
              // show this kind of mid-sentence / mid-table truncation
              // (4 of 6 sample reports were truncated).
              const crossContent = r.ok && r.content ? sanitizeReport(r.content) : (r.content || '');
              crossReport = { ok: r.ok, content: crossContent, provider: r.provider, model: r.model, durationMs: r.durationMs, contentChars: crossContent.length, commonPdbIds, pdbOverlap, literatureCount: crossLit.count };
              if (r.ok) emit({ stage: 'cross-llm', level: 'success', message: `✓ 跨序列相关性报告已生成 · ${crossReport.contentChars} chars · ${(r.durationMs / 1000).toFixed(1)}s · ${r.provider}/${r.model}${crossLit.count > 0 ? ` · 附 ${crossLit.count} 篇文献` : ''}`, progress: 100 });
              else emit({ stage: 'cross-llm', level: 'error', message: `✗ 跨序列相关性 LLM 失败：${r.error}`, progress: 100 });
            } catch (err: any) {
              emit({ stage: 'cross-llm', level: 'error', message: `✗ 跨序列相关性分析失败：${err?.message}`, progress: 100 });
            }
          }

          // Write batch record to EvaluationBatch + SkillRunRecord
          const batchTitle = `Multi-Seq: ${seqResults.length} sequences`;
          // `commonPdbIds` already computed above — reuse it for the batch record.
          const commonPdbIdsJson = JSON.stringify(commonPdbIds);
          const crossReportContent = crossReport?.ok ? crossReport.content : null;
          const batchId = 'mseq-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
          try {
            await db.$executeRaw`INSERT INTO EvaluationBatch (batchId, title, combinedReport, commonPdbIds, crossReportOk, crossReportProvider, crossReportModel, crossReportDurationMs, crossReportChars, targetCount, createdAt, updatedAt) VALUES (${batchId}, ${batchTitle}, ${crossReportContent}, ${commonPdbIdsJson}, ${crossReport?.ok ?? false}, ${crossReport?.provider || null}, ${crossReport?.model || null}, ${crossReport?.durationMs || 0}, ${crossReport?.contentChars || 0}, ${seqResults.length}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`;
            for (const r of seqResults) {
              try { await db.$executeRaw`UPDATE Evaluation SET batchId = ${batchId} WHERE uniprotId = ${r.seqId}`; } catch {}
            }
            emit({ stage: 'batch-db', level: 'success', message: `✓ 多序列 Batch 记录已写入 EvaluationBatch (${batchId}) · 关联 ${seqResults.length} 条序列`, progress: 100 });
          } catch (err: any) {
            emit({ stage: 'batch-db', level: 'error', message: `多序列 Batch 记录写入失败：${err?.message}`, progress: 100 });
          }
          try {
            // Raw SQL insert (see comment at the single-target path above).
            const _bsrrId = `eval_batch_${batchId}_${Date.now()}`;
            const _bsrrStatus = crossReport?.ok || !generateReport ? 'success' : 'error';
            const _bsrrSummary = `多序列批量评估 ${seqResults.length} 条序列 · 共有结构 ${commonPdbIds.length} · ${crossReport?.ok ? 'LLM ✓' : generateReport ? 'LLM ✗' : 'no LLM'}`;
            const _bsrrDetails = JSON.stringify({ sequenceCount: seqResults.length, seqIds: seqResults.map(r => r.seqId), commonPdbIds, crossReportOk: crossReport?.ok });
            const _bsrrProvider = body.llm?.provider || 'auto';
            const _bsrrModel = crossReport?.model || '';
            const _bsrrLlmOk = generateReport ? (crossReport?.ok ? 1 : 0) : null;
            const _bsrrDurationMs = Date.now() - t0;
            const _bsrrResultJson = JSON.stringify({ sequences: seqResults.map(r => ({ seqId: r.seqId, pdbCount: r.pdbDetails?.length || 0, overall: r.scores?.overall?.score })), commonPdbIds, crossReportChars: crossReport?.contentChars || 0 });
            const _bsrrLog = _log.join('\n');
            await db.$executeRaw`INSERT INTO SkillRunRecord (id, module, status, summary, details, provider, model, llmOk, llmFallback, llmError, durationMs, resultJson, log, createdAt) VALUES (${_bsrrId}, 'eval', ${_bsrrStatus}, ${_bsrrSummary}, ${_bsrrDetails}, ${_bsrrProvider}, ${_bsrrModel}, ${_bsrrLlmOk}, 0, null, ${_bsrrDurationMs}, ${_bsrrResultJson}, ${_bsrrLog}, CURRENT_TIMESTAMP)`;
          } catch { /* ignore — telemetry only */ }
                }

        const result = {
          ok: true,
          inputMode: 'sequence',
          sequenceCount: seqResults.length,
          sequences: seqResults.map(r => ({
            seqId: r.seqId,
            uniprotInfo: r.uniprotInfo,
            pdbCount: r.pdbDetails?.length || 0,
            blastHitCount: r.blastHits?.length || 0,
            coverage: r.coverage,
            scores: r.scores,
            report: r.report
              ? {
                  ok: !!r.report.ok,
                  content: r.report.content || '',
                  provider: r.report.provider || '',
                  model: r.report.model || '',
                  durationMs: r.report.durationMs || 0,
                  contentChars: r.report.contentChars || 0,
                }
              : undefined,
          })),
          crossAnalysis: isMulti ? { crossReport } : undefined,
          durationMs: Date.now() - t0,
        };
        const okCount = seqResults.filter(r => r.report?.ok).length;
        emit({ stage: 'done', level: 'success', message: `多序列评估完成 · ${seqResults.length} 条 · LLM ${okCount}/${seqResults.length} ✓${isMulti && crossReport?.ok ? ' · 跨序列报告 ✓' : isMulti && generateReport ? ' · 跨序列报告 ✗' : ''} · ${((Date.now() - t0) / 1000).toFixed(1)}s`, progress: 100 });
        await sleep(150);
        done(result);
        return;
      }

      // ── Single sequence mode (backward compatible: body.sequence is a string) ──
      if (body.inputMode === 'sequence' && body.sequence) {
        const seqType: 'aa' | 'dna' = body.sequenceType === 'dna' ? 'dna' : 'aa';
        const r = await evaluateOneSequence(String(body.sequence), seqType, 1, 1);
        const result = { uniprot: r.seqId, uniprotInfo: r.uniprotInfo, directPdbCount: 0, pdbPersisted: r.pdbDetails.length, blastHitCount: r.blastHits.length, coverage: r.coverage, scores: r.scores, report: r.report, dbSaved: true, durationMs: Date.now() - t0 };
        emit({ stage: 'done', level: r.report?.ok || !generateReport ? 'success' : 'warn', message: `完成 · ${r.blastHits.length} BLAST 同源 · overall=${r.scores.overall.score}/10 · ${((Date.now() - t0) / 1000).toFixed(1)}s${r.report?.ok ? ` · LLM ✓ (${r.report.contentChars} chars)` : ''}`, progress: 100 });
        await sleep(150);
        done(result);
        return;
      }


      // ── Standard UniProt ID mode (original flow) ──
      // In batch mode, activate progress remapping for the primary target (bi=0)
      // so its 0..100 progress maps into the first global slot [2, 2+slot).
      if (isBatch && targets.length > 1) {
        _batchIdx = 0;
        _batchCount = targets.length;
      }
      emit({ stage: 'init', level: 'info', message: `启动 protein-target-evaluator · uniprot=${uniprot}`, progress: 2 });
      await sleep(300);
      emit({ stage: 'uniprot-meta', level: 'info', message: `拉取 UniProt 元数据 (${uniprot})`, progress: 8 });

      // ── Real UniProt metadata fetch (replaces hardcoded 'Epidermal growth factor receptor') ──
      const meta = await fetchUniprotMeta(uniprot);
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
            // Fallback placeholder when UniProt API fails — surface clearly, do NOT silently lie.
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
        progress: 14,
      });

      emit({ stage: 'rcsb-direct', level: 'info', message: `RCSB 检索 UniProt=${uniprot}（真实 API, 上限 ${maxPdb}）`, progress: 18 });
      const pdbIds = await fetchPdbIdsForUniprot(uniprot, maxPdb);
      const directPdbCount = pdbIds.length;
      if (directPdbCount === 0) emit({ stage: 'rcsb-direct', level: 'warn', message: `RCSB 返回 0 条`, progress: 28 });
      else emit({ stage: 'rcsb-direct', level: 'success', message: `✓ RCSB 返回 ${directPdbCount} 条真实 PDB`, progress: 24 });

      // ── Cache check: skip re-fetch + re-report if params + PDB count unchanged ──
      let cachedEval: any = null;
      let pdbDetails: PdbEntryDetail[] = [];
      let skipReportGeneration = false;
      try {
        cachedEval = await db.$queryRaw<any[]>`SELECT uniprotId, maxPdbUsed, blastWasSkipped, pdbCountAtEval, report, scores, coverage FROM Evaluation WHERE uniprotId = ${uniprot}`;
        cachedEval = (cachedEval as any[])[0] || null;
      } catch { /* table may not exist */ }

      if (cachedEval
          && cachedEval.maxPdbUsed === maxPdb
          && !!cachedEval.blastWasSkipped === (skipBlast && !forceBlast)
          && cachedEval.pdbCountAtEval === directPdbCount
          && cachedEval.report) {
        // Cache hit — same params + same PDB count + existing report. Skip re-fetch.
        emit({ stage: 'cache-hit', level: 'success', message: `✓ 缓存命中：参数与 PDB 数量未变（maxPdb=${maxPdb}, skipBlast=${skipBlast}, pdbCount=${directPdbCount}），跳过重新获取与报告生成`, progress: 34 });
        // Load existing PDB structures from DB instead of re-fetching from RCSB
        try {
          const existingPdbs = await db.$queryRaw<any[]>`SELECT pdbId, method, resolution, title, journal, journalIf, doi, pubmedId, organism, authors, ligand, depositionDate, releaseDate FROM EvaluationPdbStructure WHERE uniprotId = ${uniprot}`;
          pdbDetails = (existingPdbs as any[]).map(e => ({ pdbId: e.pdbId, method: e.method, resolution: e.resolution, title: e.title, journal: e.journal, journalIf: e.journalIf, doi: e.doi, pubmedId: e.pubmedId, organisms: e.organism, authors: e.authors, ligands: e.ligand, depositDate: e.depositionDate, releaseDate: e.releaseDate }));
        } catch { /* ignore */ }
        skipReportGeneration = true;
        emit({ stage: 'rcsb-detail', level: 'success', message: `✓ 从数据库加载 ${pdbDetails.length} 条已有 PDB 结构`, progress: 34 });
      } else {
        // Cache miss — fetch details from RCSB and generate fresh report
        if (cachedEval) {
          emit({ stage: 'cache-miss', level: 'info', message: `参数或 PDB 数量已变化（旧: maxPdb=${cachedEval.maxPdb}, pdbCount=${cachedEval.pdbCountAtEval} → 新: maxPdb=${maxPdb}, pdbCount=${directPdbCount}），重新获取并更新报告`, progress: 28 });
        }
        emit({ stage: 'rcsb-detail', level: 'info', message: `拉取详细元数据`, progress: 28 });
        pdbDetails = directPdbCount > 0 ? await fetchPdbEntryDetails(pdbIds) : [];
        // Round 49: Fill in missing IF from JOURNAL_IF_MAP when RCSB API doesn't return it
        for (const d of pdbDetails) {
          if (d.journalIf == null && d.journal) {
            const j = d.journal.toLowerCase().trim();
            // Try multiple normalization strategies:
            // 1. Direct match (journal name as-is, lowercased)
            if (JOURNAL_IF_MAP[j]) { d.journalIf = JOURNAL_IF_MAP[j]; continue; }
            // 2. Remove non-alphanumeric (e.g., "J Med Chem" → "jmedchem")
            const stripped = j.replace(/[^a-z0-9]/g, '');
            if (JOURNAL_IF_MAP[stripped]) { d.journalIf = JOURNAL_IF_MAP[stripped]; continue; }
            // 3. Try with spaces (e.g., "PLoS Biol" → try "plos biol" and "plos biology")
            if (JOURNAL_IF_MAP[j]) { d.journalIf = JOURNAL_IF_MAP[j]; continue; }
            // 4. Common abbreviation expansions
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
            if (expanded && JOURNAL_IF_MAP[expanded]) { d.journalIf = JOURNAL_IF_MAP[expanded]; continue; }
            // 5. Partial match: find a key that starts with the journal name
            for (const [key, val] of Object.entries(JOURNAL_IF_MAP)) {
              if (key.startsWith(j) || j.startsWith(key)) { d.journalIf = val; break; }
            }
          }
        }
        emit({ stage: 'rcsb-detail', level: 'success', message: `✓ 获取 ${pdbDetails.length} 条详细元数据`, progress: 34 });
      }

      emit({ stage: 'sifts-coverage', level: 'info', message: 'SIFTS 残基覆盖率计算', progress: 38 });
      await sleep(300);
      // Estimate structural coverage: each PDB structure covers ~5% of the target
      // (capped at 100%). This is a heuristic since we don't have residue-level
      // SIFTS mapping data. More structures = better coverage.
      const coverage = directPdbCount > 0 ? Math.min(100, directPdbCount * 5) : 0;
      emit({ stage: 'sifts-coverage', level: 'success', message: `覆盖率 ${coverage}%`, progress: 42 });

      let blastHitCount = 0, skippedBblast = false, blastHits: any[] = [];
      // ── Auto-decide whether BLAST is needed ──────────────────────────────
      // Previously BLAST ran whenever the user didn't tick "skip" — even for
      // targets with 50+ direct PDB structures at 100% coverage, where BLAST
      // adds no value. Now we auto-skip when the target is already
      // well-covered, and only run BLAST when it would actually find new
      // structural homologs:
      //
      //   Run BLAST when:  directPdbCount < 5  OR  coverage < 50%
      //   Skip BLAST when: directPdbCount >= 5 AND coverage >= 50%
      //
      // forceBlast=true overrides the auto-skip and ALWAYS runs BLAST.
      // skipBlast=true (user explicitly ticked "skip") is kept for backward
      // compat — it still skips unless forceBlast is also set.
      const MIN_PDB_FOR_SKIP = 5;
      const MIN_COVERAGE_FOR_SKIP = 50;
      const autoShouldSkip = directPdbCount >= MIN_PDB_FOR_SKIP && coverage >= MIN_COVERAGE_FOR_SKIP;
      const shouldSkipBlast = !forceBlast && (skipBlast || autoShouldSkip);

      if (shouldSkipBlast) {
        if (autoShouldSkip && !skipBlast) {
          emit({ stage: 'blast', level: 'info', message: `BLAST 自动跳过：直接 PDB 结构数 ${directPdbCount} ≥ ${MIN_PDB_FOR_SKIP} 且覆盖率 ${coverage}% ≥ ${MIN_COVERAGE_FOR_SKIP}%，无需同源检索（勾选「强制 BLAST」可忽略此判断）`, progress: 46 });
        } else {
          emit({ stage: 'blast', level: 'warn', message: 'BLAST 已跳过 (skipBlast=true)', progress: 46 });
        }
        skippedBblast = true;
        await sleep(200);
      } else {
        if (forceBlast) {
          emit({ stage: 'blast', level: 'info', message: `强制 BLAST（forceBlast=true，忽略自动跳过判断：PDB=${directPdbCount}, 覆盖率=${coverage}%）`, progress: 46 });
        } else {
          emit({ stage: 'blast', level: 'info', message: `自动判定需要 BLAST：直接 PDB ${directPdbCount} < ${MIN_PDB_FOR_SKIP} 或覆盖率 ${coverage}% < ${MIN_COVERAGE_FOR_SKIP}%`, progress: 46 });
        }
        emit({ stage: 'blast', level: 'info', message: `NCBI BLASTp 同源检索（真实 API · UniProt ${uniprot} 序列）`, progress: 46 });
        try {
          emit({ stage: 'blast', level: 'info', message: `从 UniProt 拉取 ${uniprot} 蛋白序列…`, progress: 47 });
          const sequence = await fetchUniprotSequence(uniprot);
          emit({ stage: 'blast', level: 'info', message: `序列长度 ${sequence.length} aa，提交 BLASTp（持续轮询直至返回，上限 ${maxBlastHits} 条）…`, progress: 48 });
          // No fixed timeout — runBlast polls NCBI until the result is ready.
          blastHits = await runBlast(sequence, maxBlastHits, (msg) => { emit({ stage: 'blast', level: 'info', message: msg, progress: 49 }); });
          blastHitCount = blastHits.length;
          if (blastHitCount > 0) {
            const topHit = blastHits[0];
            emit({ stage: 'blast', level: 'success', message: `✓ BLAST 命中 ${blastHitCount}/${maxBlastHits} 条同源（最高 identity=${topHit.identity}% · ${topHit.pdbId}）`, progress: 52 });
          } else {
            emit({ stage: 'blast', level: 'warn', message: `BLAST 完成，无同源命中`, progress: 52 });
          }
        } catch (err: any) {
          emit({ stage: 'blast', level: 'error', message: `✗ BLAST 失败：${err?.message}（继续后续评分）`, progress: 52 });
          skippedBblast = true;
        }
      }

      // ── Fix 2: Enrich BLAST hits with RCSB structural metadata ──────────
      // BLAST XML only gives pdbId + identity + description. The downstream
      // buildLiteratureInfo() needs pubmedId/method/resolution/journal, and
      // the LLM report needs the full structural table. So we call RCSB for
      // each unique BLAST pdbId (chunked, concurrent via fetchPdbEntryDetails).
      // Result: pdbDetails now contains BOTH direct SIFTS PDBs AND enriched
      // BLAST hits (deduped by pdbId). BLAST-derived entries are tagged with
      // `via: 'blast'` so the UI / report can distinguish them.
      if (blastHits.length > 0) {
        const directPdbIds = new Set(pdbDetails.map((d) => d.pdbId));
        const blastPdbIds = Array.from(new Set(blastHits.map((h: any) => h.pdbId).filter((id: string) => id && !directPdbIds.has(id))));
        if (blastPdbIds.length > 0) {
          emit({ stage: 'blast-enrich', level: 'info', message: `从 RCSB 反查 ${blastPdbIds.length} 个 BLAST PDB 的结构元数据（并发 · 5/批）…`, progress: 53 });
          try {
            const enriched = await fetchPdbEntryDetails(blastPdbIds, blastPdbIds.length);
            // Tag each enriched entry with via:'blast' and a back-reference to its BLAST row
            // (so the LLM report can cite both identity% and the structural fields).
            const identityByPdb = new Map<string, number>();
            for (const h of blastHits as any[]) {
              const cur = identityByPdb.get(h.pdbId) ?? 0;
              if ((h.identity ?? 0) > cur) identityByPdb.set(h.pdbId, h.identity);
            }
            const tagged: PdbEntryDetail[] = enriched.map((e) => ({
              ...e,
              // Stash identity on a loose field so buildDetailedPdbTable can render it
              ...({ blastIdentity: identityByPdb.get(e.pdbId) ?? null } as any),
            }));
            pdbDetails = [...pdbDetails, ...tagged];
            emit({ stage: 'blast-enrich', level: 'success', message: `✓ RCSB enrich 命中 ${enriched.length}/${blastPdbIds.length}（${blastPdbIds.length - enriched.length} 个 PDB id 在 RCSB 中找不到）`, progress: 54 });
          } catch (err: any) {
            emit({ stage: 'blast-enrich', level: 'warn', message: `⚠ RCSB enrich 失败：${err?.message}（BLAST hit 仍以 bare 形式进报告）`, progress: 54 });
          }
        } else {
          emit({ stage: 'blast-enrich', level: 'info', message: '所有 BLAST PDB id 已在 direct PDB 集合中，无需 enrich', progress: 54 });
        }
      }

      emit({ stage: 'score', level: 'info', message: '综合可成药性评分', progress: 56 });
      await sleep(300);
      const scoreRating = (s: number) => s >= 8 ? '优' : s >= 6 ? '良' : s >= 4 ? '中' : '差';
      // Derive scores from actual structure counts: more structures → higher score.
      const xrayCount = pdbDetails.filter(e => (e.method || '').includes('X-RAY')).length;
      const cryoemCount = pdbDetails.filter(e => (e.method || '').includes('ELECTRON')).length;
      const nmrCount = pdbDetails.filter(e => (e.method || '').includes('NMR')).length;
      // Score scale: sqrt-based (see comment at the DNA-sequence path above).
      // 0 structures → 1, 1 → 2, 4 → 4, 9 → 6, 16 → 8, 25 → 10.
      const calcScore = (count: number, max: number = 10) => Math.min(max, Math.max(1, Math.round(Math.sqrt(Math.max(0, count)) * 2)));
      const scores = {
        xray: { score: calcScore(xrayCount), rating: '', structures: xrayCount, max: 10 },
        cryoem: { score: calcScore(cryoemCount), rating: '', structures: cryoemCount, max: 10 },
        nmr: { score: calcScore(nmrCount), rating: '', structures: nmrCount, max: 10 },
        overall: { score: Math.min(10, Math.max(1, Math.round((calcScore(xrayCount) + calcScore(cryoemCount) + calcScore(nmrCount)) / 3))), rating: '', max: 10 },
      };
      scores.xray.rating = scoreRating(scores.xray.score);
      scores.cryoem.rating = scoreRating(scores.cryoem.score);
      scores.nmr.rating = scoreRating(scores.nmr.score);
      scores.overall.rating = scoreRating(scores.overall.score);
      emit({ stage: 'score', level: 'success', message: `overall=${scores.overall.score}/10 (X-ray=${scores.xray.score}/${scores.xray.structures}条, Cryo-EM=${scores.cryoem.score}/${scores.cryoem.structures}条, NMR=${scores.nmr.score}/${scores.nmr.structures}条)`, progress: 62 });

      let report: any = undefined;
      // provenanceJson declared in the OUTER scope so the INSERT below
      // (which runs regardless of which report branch executed) can see it.
      // It's populated inside the `else if (generateReport)` branch; the
      // cache-hit branch leaves it null (legacy rows have no provenance).
      let provenanceJson: string | null = null;
      if (skipReportGeneration && cachedEval?.report) {
        // Cache hit — reuse existing report, skip LLM generation
        report = { ok: true, content: cachedEval.report, provider: '(cached)', model: '(cached)', durationMs: 0, contentChars: cachedEval.report.length, fallback: false, cached: true };
        emit({ stage: 'report-cached', level: 'success', message: `✓ 使用已有 LLM 报告（缓存）· ${report.contentChars} chars`, progress: 90 });
      } else if (generateReport) {
        // ── Build COMPRESSED but COMPREHENSIVE data tables from real DB rows ──────
        // Cap at 80 entries per table to keep each LLM prompt < 12k chars (fast).
        const PDB_CAP = 80;
        const BLAST_CAP = Math.min(maxBlastHits, 50);
        const pdbTable = pdbDetails.length > 0
          ? buildDetailedPdbTable(pdbDetails, PDB_CAP)
          : '| PDB ID | Method | Resolution | Journal (IF) | Title |\n|--------|--------|------------|--------------|-------|\n| (无 PDB 结构数据) | - | - | - | - |';
        const blastTable = skippedBblast
          ? '| PDB ID | UniProt | Identity | E-value | Description |\n|--------|---------|----------|---------|-------------|\n| (BLAST 已跳过) | - | - | - | - |'
          : buildDetailedBlastTable(blastHits, BLAST_CAP);

        // ── Literature info: fetch PubMedArticle rows for the PDB structures' pubmedIds ──
        // Round 51: Backfill PubMed articles BEFORE building literature info,
        // so that newly-fetched articles are available to buildLiteratureInfo().
        // Previously, backfill happened AFTER the report was generated, so the
        // first run always had empty literature data.
        const pmRes = await backfillPubMedArticles(pdbDetails, emit);
        if (pmRes.fetched > 0) {
          emit({ stage: 'pubmed-backfill', level: 'info', message: `PubMed 文献回填: ${pmRes.fetched} 篇新获取, ${pmRes.skipped} 篇已存在`, progress: 63 });
        }
        // Sort by journal IF desc, cap at maxLitCount. Empty when no articles in DB.
        const litInfo = await buildLiteratureInfo(pdbDetails, maxLitCount);
        const literatureInfo = litInfo.count > 0
          ? `共 ${litInfo.count} 篇相关文献（按期刊影响因子降序，已截取前 ${litInfo.count} 篇；摘要截取 200 字）：\n\n${litInfo.text}`
          : '（无 PubMed 文献数据 — PubMedArticle 表为空或这些 PDB 结构无对应文献）';
        if (litInfo.count > 0) {
          emit({ stage: 'llm-report', level: 'info', message: `已附加 ${litInfo.count} 篇 PubMed 文献（按 IF 降序）到 LLM 上下文`, progress: 65 });
        }

        // ── Round 34/35/36: Run structural analysis on the top PDB for the report ──
        // Use the Analysis module's recipes (binding_pocket, all_interactions,
        // hbonds, druggability, virtual_screening) to generate structural insights
        // that enrich the LLM report.
        // Round 35: Now uses automatic chain detection and ligand detection
        // instead of hardcoded A/B chains.
        // Round 36: Added virtual_screening recipe + skipStructureAnalysis toggle.
        let structureAnalyses: StructureAnalysisData | undefined;
        if (skipStructureAnalysis) {
          emit({ stage: 'llm-report', level: 'info', message: `跳过结构分析（用户选择 skipStructureAnalysis）`, progress: 65 });
        } else try {
          // Round 38/39: Try multiple PDBs until we get non-empty structural analysis.
          // Sort by resolution (best first), try up to 3 PDBs.
          const candidatePdbs = pdbDetails
            .filter(e => (e.method || '').includes('X-RAY') || (e.method || '').includes('ELECTRON'))
            .sort((a, b) => (a.resolution || 99) - (b.resolution || 99))
            .slice(0, 3);
          if (candidatePdbs.length === 0 && pdbDetails.length > 0) {
            candidatePdbs.push(pdbDetails[0]);
          }

          let analysisSucceeded = false;
          for (let pdbIdx = 0; pdbIdx < candidatePdbs.length && !analysisSucceeded; pdbIdx++) {
            const topPdb = candidatePdbs[pdbIdx];
            if (!topPdb) continue;

            if (pdbIdx > 0) {
              emit({ stage: 'llm-report', level: 'info', message: `上一个 PDB 结构分析无有效结果，尝试第 ${pdbIdx + 1} 个结构: ${topPdb.pdbId}…`, progress: 64 });
            } else {
              emit({ stage: 'llm-report', level: 'info', message: `正在对重点结构 ${topPdb.pdbId} 运行结构分析（结合口袋、互作、氢键、可药性、虚拟筛选）…`, progress: 64 });
            }

            try {
              // Round 35: Auto-detect chain IDs by parsing the PDB file
              const { chain1, chain2 } = await pickAnalysisChains(topPdb.pdbId);
              emit({ stage: 'llm-report', level: 'info', message: `检测到链: ${chain1}${chain1 !== chain2 ? ', ' + chain2 : ' (单链，链内分析)'}`, progress: 64 });

              // Round 35/41: Auto-detect the primary ligand by parsing the PDB file.
              // Round 41: If PDB parsing finds no valid ligand (or only ions), fall back
              // to the RCSB API ligand list with ion filtering applied.
              let ligandCompId = await detectPrimaryLigand(topPdb.pdbId);
              if (!ligandCompId) {
                // Round 41: Fall back to RCSB ligand list, but filter out ions
                const ligandStr = typeof topPdb.ligands === 'string' ? topPdb.ligands : '';
                const rcsbLigands = ligandStr.split(/[;,\s]+/).filter(Boolean);
                // Ion blocklist (same as recipe-runner.ts ION_BLOCKLIST)
                const ION_BLOCKLIST = new Set([
                  "SO4", "PO4", "SEP", "TPO", "PTR", "CSO",
                  "MG", "ZN", "CA", "FE", "CU", "MN", "NI", "CO", "CD", "HG", "PB",
                  "NA", "CL", "K", "LI", "RB", "CS", "BA", "SR", "BR", "I", "F",
                  "GOL", "PEG", "EDO", "DMS", "ACT", "FMT", "CIT", "MAL", "FUM", "SUC",
                  "MES", "TRS", "HEPES", "PIPES", "MOPS", "EPE",
                  "DOD", "EOH", "MBO", "MRD", "PG4", "PGE",
                  "ACY", "AZI", "BH3", "BEN", "BME", "BOG",
                  "C2E", "CAC", "CHX", "DAH", "DIO", "DPG", "DTT",
                  "LDA", "LMT", "LMG", "OLC", "OLE", "PCW", "PEU", "PLM", "PGV",
                  "MSE",
                ]);
                // Find the first non-ion ligand from RCSB
                ligandCompId = rcsbLigands.find(l => !ION_BLOCKLIST.has(l.toUpperCase())) || null;
                if (ligandCompId) {
                  emit({ stage: 'llm-report', level: 'info', message: `配体来自 RCSB 元数据: ${ligandCompId}`, progress: 64 });
                }
              }
              if (ligandCompId) {
                emit({ stage: 'llm-report', level: 'info', message: `检测到配体: ${ligandCompId}`, progress: 64 });
              } else {
                emit({ stage: 'llm-report', level: 'warn', message: `未检测到有效配体（所有 HETATM 均为离子/缓冲液）`, progress: 64 });
              }

              // Round 40: For single-chain structures (chain1===chain2), skip
              // all_interactions (returns 0) and only run hbonds (intra-chain).
              // For multi-chain structures, run both all_interactions (inter-chain)
              // and hbonds (intra-chain on the largest chain).
              const isSingleChain = chain1 === chain2;
              const recipesToRun: Array<{ recipeId: string; params?: Record<string, unknown> }> = [];
              if (!isSingleChain) {
                recipesToRun.push({ recipeId: 'all_interactions', params: { chain1, chain2 } });
              }
              recipesToRun.push({ recipeId: 'hbonds', params: { chain1, chain2: chain1 } });

              // Round 50: Multi-ligand analysis — detect all valid ligands and run
              // binding_pocket for each one (up to 3 ligands)
              let allLigands: string[] = [];
              if (ligandCompId) {
                allLigands = await detectAllLigands(topPdb.pdbId);
                if (allLigands.length === 0) allLigands = [ligandCompId];
                if (allLigands.length > 1) {
                  emit({ stage: 'llm-report', level: 'info', message: `检测到多个配体: ${allLigands.join(', ')}，为每个配体运行结合口袋分析`, progress: 64 });
                }
                // Run binding_pocket + druggability + virtual_screening for primary ligand
                recipesToRun.push({ recipeId: 'binding_pocket', params: { ligandCompId: allLigands[0], radius: 5.0 } });
                recipesToRun.push({ recipeId: 'druggability', params: { ligandCompId: allLigands[0], radius: 5.0 } });
                recipesToRun.push({ recipeId: 'virtual_screening', params: { ligandCompId: allLigands[0], radius: 5.0, fragment_set: 'druglike' } });
              }

              const { results, cacheHits, cacheMisses } = await runMultipleAnalysesWithCacheInfo(topPdb.pdbId, recipesToRun);
              if (cacheHits > 0) {
                emit({ stage: 'llm-report', level: 'info', message: `结构分析: ${cacheHits} 个结果来自缓存, ${cacheMisses} 个新计算`, progress: 64 });
              }

              // Round 50: Run binding_pocket for additional ligands (multi-ligand)
              const multiLigandPockets: Array<{ ligand: string; residueCount: number; volume: number | string }> = [];
              if (allLigands.length > 1) {
                for (let li = 1; li < allLigands.length; li++) {
                  try {
                    const extraBp = await runAnalysisRecipe('binding_pocket', topPdb.pdbId, { ligandCompId: allLigands[li], radius: 5.0 });
                    const bpRaw = extraBp as any;
                    const bp = bpRaw?.data || bpRaw;
                    if (bp && (bp.pocket_residue_count || bp.residues)) {
                      multiLigandPockets.push({
                        ligand: allLigands[li],
                        residueCount: bp.pocket_residue_count || (bp.residues || []).length,
                        volume: bp.estimated_volume_A3 || bp.estimated_volume || '?',
                      });
                    }
                  } catch { /* ignore individual ligand failures */ }
                }
              }
              if (cacheHits > 0) {
                emit({ stage: 'llm-report', level: 'info', message: `结构分析: ${cacheHits} 个结果来自缓存, ${cacheMisses} 个新计算`, progress: 64 });
              }
              const sa: StructureAnalysisData = { pdbId: topPdb.pdbId };
              // Round 50: Add multi-ligand pocket results
              if (multiLigandPockets.length > 0) {
                sa.multiLigandPockets = multiLigandPockets;
              }

              // Round 42: Fix data access — recipe-runner returns the raw recipe
              // output directly (not wrapped in {data: ...} like /api/analyze/run).
              // The raw output has fields like {ligand, radius_A, pocket_residue_count, ...}
              // directly at the top level.

              // Parse binding_pocket result
              const bpRaw = results['binding_pocket'] as any;
              const bp = bpRaw?.data || bpRaw; // Handle both wrapped and raw formats
              if (bp && (bp.pocket_residue_count || bp.residues)) {
                const residues = bp.residues || [];
                sa.bindingPocket = {
                  ligand: bp.ligand || ligandCompId || 'unknown',
                  radius: bp.radius_A || bp.radius || 5.0,
                  residueCount: bp.pocket_residue_count || residues.length,
                  volume: bp.estimated_volume_A3 || bp.estimated_volume || '?',
                  composition: bp.composition || {},
                  topResidues: residues.slice(0, 15).map((r: any) =>
                    `${r.resname || '?'}${r.resno || r.residue_number || '?'}(${r.chain || r.chain_id || '?'})`
                  ),
                  catalyticResidues: residues
                    .filter((r: any) => [41, 145].includes(Number(r.resno || r.residue_number || 0)))
                    .map((r: any) => `${r.resname || '?'}${r.resno || r.residue_number || '?'}`),
                };
              }

              // Parse all_interactions result
              const aiRaw = results['all_interactions'] as any;
              const ai = aiRaw?.data || aiRaw; // Handle both wrapped and raw formats
              if (ai && (ai.total !== undefined || ai.interactions)) {
                const interactions = ai.interactions || [];
                const residueCounts: Record<string, number> = {};
                for (const c of interactions) {
                  const r1 = `${c.resname1 || '?'}${c.resno1 || '?'}(${c.chain1 || '?'})`;
                  const r2 = `${c.resname2 || '?'}${c.resno2 || '?'}(${c.chain2 || '?'})`;
                  residueCounts[r1] = (residueCounts[r1] || 0) + 1;
                  residueCounts[r2] = (residueCounts[r2] || 0) + 1;
                }
                sa.allInteractions = {
                  chain1: ai.chain1 || chain1,
                  chain2: ai.chain2 || chain2,
                  total: ai.total || 0,
                  hbonds: ai.hbonds || 0,
                  saltBridges: ai.salt_bridges || 0,
                  hydrophobic: ai.hydrophobic || 0,
                  topContacts: interactions.slice(0, 10).map((c: any) => ({
                    pair: `${c.resname1 || '?'}${c.resno1 || '?'}(${c.chain1 || '?'}) ↔ ${c.resname2 || '?'}${c.resno2 || '?'}(${c.chain2 || '?'})`,
                    distance: c.distance_A || 0,
                    type: c.type || 'unknown',
                  })),
                  hotspots: Object.entries(residueCounts)
                    .filter(([, n]) => n >= 2)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 10)
                    .map(([residue, contacts]) => ({ residue, contacts })),
                };
              }

              // Parse hbonds result
              const hbRaw = results['hbonds'] as any;
              const hb = hbRaw?.data || hbRaw; // Handle both wrapped and raw formats
              if (hb && (hb.total_hbonds !== undefined || hb.hbonds || hb.bonds)) {
                const bonds = hb.hbonds || hb.bonds || [];
                sa.hbonds = {
                  total: hb.total_hbonds || hb.count || bonds.length,
                  topPairs: bonds.slice(0, 10).map((c: any) => ({
                    pair: `${c.resname1 || '?'}${c.resno1 || '?'}(${c.chain1 || '?'}) ${c.atom1 || ''} → ${c.resname2 || '?'}${c.resno2 || '?'}(${c.chain2 || '?'}) ${c.atom2 || ''}`,
                    distance: c.distance_A || 0,
                  })),
                };
              }

              // Parse druggability result
              const drugRaw = results['druggability'] as any;
              const drug = drugRaw?.data || drugRaw; // Handle both wrapped and raw formats
              if (drug && drug.druggability_score !== undefined) {
                const drugScore = drug.druggability_score || 0;
                const classification = drug.classification || 'unknown';
                const catMap: Record<string, string> = {
                  'highly_druggable': '高（高度可成药）',
                  'druggable': '中（可成药）',
                  'moderately_druggable': '中低（中度可成药）',
                  'difficult': '低（成药困难）',
                };
                const breakdown = drug.score_breakdown || {};
                sa.druggability = {
                  score: Math.round(drugScore / 10),
                  category: catMap[classification] || classification,
                  rationale: [
                    `口袋体积 ${drug.pocket_volume_A3 || '?'} Å³`,
                    `疏水 ${drug.hydrophobic_pct || 0}% / 极性 ${drug.polar_pct || 0}% / 电荷 ${drug.charged_pct || 0}%`,
                    `分类: ${classification}`,
                    breakdown.volume ? `体积评分 ${breakdown.volume}` : '',
                    breakdown.hydrophobicity ? `疏水性评分 ${breakdown.hydrophobicity}` : '',
                    breakdown.polarity ? `极性评分 ${breakdown.polarity}` : '',
                  ].filter(Boolean).join('; '),
                };
              }

              // Parse virtual_screening result
              const vsRaw = results['virtual_screening'] as any;
              const vs = vsRaw?.data || vsRaw; // Handle both wrapped and raw formats
              if (vs && (vs.pocket_score !== undefined || vs.ranked_hits)) {
                const hits = vs.ranked_hits || [];
                sa.virtualScreening = {
                  pocketScore: vs.pocket_score || 0,
                  fragmentsScreened: vs.num_fragments_screened || 0,
                  topHits: hits.slice(0, 5).map((h: any) => ({
                    name: h.name || '?',
                    smiles: h.smiles || '',
                    mw: h.mw || 0,
                    logp: h.logp || 0,
                    affinityKcalMol: h.affinity_kcal_mol || 0,
                    ki_uM: h.ki_uM || 0,
                    score: h.score || 0,
                    rationale: h.rationale || '',
                  })),
                  bestKi_uM: vs.best_ki_uM || 0,
                };
              }

              // Check if we got any meaningful data
              const hasData = sa.bindingPocket || sa.allInteractions || sa.hbonds || sa.druggability || sa.virtualScreening;
              if (hasData) {
                structureAnalyses = sa;
                analysisSucceeded = true;
                emit({ stage: 'llm-report', level: 'success', message: `结构分析完成: ${sa.bindingPocket ? `口袋 ${sa.bindingPocket.residueCount} 残基` : ''} ${sa.allInteractions ? `互作 ${sa.allInteractions.total} 个` : ''} ${sa.hbonds ? `氢键 ${sa.hbonds.total} 个` : ''} ${sa.druggability ? `可药性 ${sa.druggability.score}/10` : ''} ${sa.virtualScreening ? `虚拟筛选 ${sa.virtualScreening.topHits.length} 命中` : ''}`, progress: 65 });
                // Round 41: Emit a structured analysis summary event for UI display
                emit({
                  stage: 'structure-analysis-summary',
                  level: 'success',
                  message: '结构分析摘要',
                  progress: 65,
                  analysisSummary: {
                    pdbId: sa.pdbId,
                    bindingPocket: sa.bindingPocket ? {
                      ligand: sa.bindingPocket.ligand,
                      residueCount: sa.bindingPocket.residueCount,
                      volume: sa.bindingPocket.volume,
                    } : null,
                    allInteractions: sa.allInteractions ? {
                      chains: `${sa.allInteractions.chain1}↔${sa.allInteractions.chain2}`,
                      total: sa.allInteractions.total,
                      hbonds: sa.allInteractions.hbonds,
                      saltBridges: sa.allInteractions.saltBridges,
                      hydrophobic: sa.allInteractions.hydrophobic,
                    } : null,
                    hbonds: sa.hbonds ? { total: sa.hbonds.total } : null,
                    druggability: sa.druggability ? {
                      score: sa.druggability.score,
                      category: sa.druggability.category,
                    } : null,
                    virtualScreening: sa.virtualScreening ? {
                      fragmentsScreened: sa.virtualScreening.fragmentsScreened,
                      topHit: sa.virtualScreening.topHits[0]?.name || null,
                      bestKi_uM: sa.virtualScreening.bestKi_uM,
                    } : null,
                  },
                });
              } else if (pdbIdx < candidatePdbs.length - 1) {
                emit({ stage: 'llm-report', level: 'warn', message: `${topPdb.pdbId} 结构分析无有效结果，将尝试下一个 PDB…`, progress: 64 });
              } else {
                emit({ stage: 'llm-report', level: 'warn', message: `所有 ${candidatePdbs.length} 个 PDB 结构分析均无有效结果`, progress: 65 });
              }
            } catch (pdbErr) {
              if (pdbIdx < candidatePdbs.length - 1) {
                emit({ stage: 'llm-report', level: 'warn', message: `${topPdb.pdbId} 结构分析失败: ${pdbErr instanceof Error ? pdbErr.message.slice(0, 60) : String(pdbErr).slice(0, 60)}，将尝试下一个 PDB…`, progress: 64 });
              } else {
                throw pdbErr; // Re-throw on the last PDB to trigger the outer catch
              }
            }
          }

          // Round 50: PDB comparison — collect summary analysis from up to 3 PDBs
          if (structureAnalyses && candidatePdbs.length > 1) {
            try {
              const pdbComparisons: Array<{ pdbId: string; bindingPocket?: { ligand: string; residueCount: number; volume: number | string }; druggability?: { score: number; category: string }; hbonds?: { total: number } }> = [];
              // Add the primary analyzed PDB
              if (structureAnalyses.bindingPocket) {
                pdbComparisons.push({
                  pdbId: structureAnalyses.pdbId,
                  bindingPocket: { ligand: structureAnalyses.bindingPocket.ligand, residueCount: structureAnalyses.bindingPocket.residueCount, volume: structureAnalyses.bindingPocket.volume },
                  druggability: structureAnalyses.druggability ? { score: structureAnalyses.druggability.score, category: structureAnalyses.druggability.category } : undefined,
                  hbonds: structureAnalyses.hbonds ? { total: structureAnalyses.hbonds.total } : undefined,
                });
              }
              // Run quick binding_pocket on the other candidate PDBs (up to 2 more)
              for (let ci = 0; ci < candidatePdbs.length && pdbComparisons.length < 3; ci++) {
                const cp = candidatePdbs[ci];
                if (!cp || cp.pdbId === structureAnalyses.pdbId) continue;
                try {
                  const cLigand = await detectPrimaryLigand(cp.pdbId);
                  if (!cLigand) continue;
                  const cBp = await runAnalysisRecipe('binding_pocket', cp.pdbId, { ligandCompId: cLigand, radius: 5.0 });
                  const bpRaw = cBp as any;
                  const bp = bpRaw?.data || bpRaw;
                  if (bp && (bp.pocket_residue_count || bp.residues)) {
                    pdbComparisons.push({
                      pdbId: cp.pdbId,
                      bindingPocket: { ligand: cLigand, residueCount: bp.pocket_residue_count || (bp.residues || []).length, volume: bp.estimated_volume_A3 || bp.estimated_volume || '?' },
                    });
                  }
                } catch { /* ignore comparison failures */ }
              }
              if (pdbComparisons.length > 1) {
                structureAnalyses.pdbComparisons = pdbComparisons;
                emit({ stage: 'llm-report', level: 'info', message: `PDB 比较分析: ${pdbComparisons.length} 个结构的结合口袋数据已收集`, progress: 65 });
              }
            } catch { /* ignore comparison errors */ }
          }
        } catch (err) {
          // Structural analysis is optional — don't fail the report if it errors
          emit({ stage: 'llm-report', level: 'warn', message: `结构分析跳过: ${err instanceof Error ? err.message.slice(0, 80) : String(err).slice(0, 80)}`, progress: 65 });
        }

        const reportData = {
          uniprot,
          entryName: uniprotInfo.entryName,
          proteinName: uniprotInfo.proteinName,
          geneNames: uniprotInfo.geneNames,
          organism: uniprotInfo.organism,
          sequenceLength: uniprotInfo.sequenceLength,
          coverage,
          directPdbCount,
          blastHitCount: skippedBblast ? 0 : blastHitCount,
          pdbCount: pdbDetails.length,
          maxBlastHitsRequested: maxBlastHits,
          scores,
          pdbTable,
          blastTable,
          literatureInfo,
          literatureCount: litInfo.count,
          structureAnalyses, // Round 34: structural analysis data for the new chapter
        };

        // ── Chapter-streaming mode: each chapter = its own short LLM call. ──────
        // This gives progressive output (SSE `chapter_*` events) AND avoids 240s+
        // timeouts because each prompt is ~3-5k chars (1-2KB output, 15-30s).
        // Round 34: Include 'structure_analysis' chapter only when analysis data exists.
        const chapters: ReportChapterKey[] = structureAnalyses
          ? ['summary', 'function', 'topology', 'pdb_analysis', 'structure_analysis', 'feasibility', 'experimental', 'references', 'conclusion']
          : ['summary', 'function', 'topology', 'pdb_analysis', 'feasibility', 'experimental', 'references', 'conclusion'];
        const chapterContents: Record<string, string> = {};
        const totalChapters = chapters.length;
        let perChapterOkCount = 0;
        let perChapterFailCount = 0;
        const tReportStart = Date.now();

        emit({ stage: 'llm-report', level: 'info', message: `准备分 ${totalChapters} 章节并发生成报告 (${provider})… 共 ${pdbDetails.length} 个 PDB + ${blastHitCount} 个 BLAST 已加载到上下文`, progress: 66 });

        // Round 54: Generate a session ID for this report so all chapter calls share context
        const reportSessionId = `eval-${uniprot}-${Date.now()}`;
        const llmWithSession = { ...body.llm, sessionId: reportSessionId };

        for (let i = 0; i < chapters.length; i++) {
          const ck = chapters[i];
          const chapterIdx = i + 1;
          // Per-chapter progress: 66..91
          const baseProgress = 66 + Math.round((i / totalChapters) * 24);
          // In batch mode, use batch-0-chapter events so the front-end
          // ChapterStream groups the primary target alongside the other
          // batch targets (all equal, no "primary" vs "batch" distinction).
          // In single mode, keep the legacy 'chapter' / 'chapter_done' names.
          const chapterStage = (isBatch && targets.length > 1) ? 'batch-0-chapter' : 'chapter';
          const chapterDoneStage = (isBatch && targets.length > 1) ? 'batch-0-chapter_done' : 'chapter_done';
          const batchPrefix = (isBatch && targets.length > 1) ? `[Target 1] ` : '';
          emit({ stage: chapterStage, level: 'info', message: `${batchPrefix}[${chapterIdx}/${totalChapters}] ${labelOf(ck)} — 开始生成`, progress: baseProgress, chapter: ck, chapterIndex: chapterIdx, chapterTotal: totalChapters });

          const userPrompt = buildChapterPrompt({ ...reportData, chapterKey: ck, chapterIndex: chapterIdx, chapterTotal: totalChapters });
          const sysPrompt = buildChapterSystemPrompt();

          // ── Generate with validation + retry ─────────────────────────────
          // The LLM can "succeed" (HTTP 200) but return an empty / truncated /
          // wrong-section body. We validate each chapter against its expected
          // heading + min length, and retry up to 2 times. This fixes the
          // "§3.3 present but §3.1/§3.2 missing" symptom the user reported.
          const MAX_CHAPTER_RETRIES = 2;
          let chapterOk = false;
          let chapterContent = '';
          let chapterError: string | undefined;
          let chapterDurationMs = 0;
          for (let attempt = 0; attempt <= MAX_CHAPTER_RETRIES; attempt++) {
            const t0 = Date.now();
            const r = await generateText(sysPrompt, userPrompt, { maxChars: 4000, llm: llmWithSession });
            chapterDurationMs += r.durationMs;
            if (!r.ok) {
              chapterError = r.error;
              // Network / quota error — retry with backoff.
              if (attempt < MAX_CHAPTER_RETRIES) {
                emit({ stage: chapterStage, level: 'warn', message: `${batchPrefix}[${chapterIdx}/${totalChapters}] ${labelOf(ck)} 第 ${attempt + 1} 次生成失败，重试中… (${r.error?.slice(0, 80) ?? 'unknown'})`, progress: baseProgress, chapter: ck, chapterIndex: chapterIdx, chapterTotal: totalChapters });
                await sleep(1500 * (attempt + 1));
                continue;
              }
              break;
            }
            // LLM returned content — validate it has the expected heading.
            const v = validateChapterContent(ck, r.content);
            if (v.ok) {
              chapterOk = true;
              chapterContent = r.content;
              break;
            }
            // Validation failed — content is too short or missing the heading.
            chapterError = v.reason;
            if (attempt < MAX_CHAPTER_RETRIES) {
              emit({ stage: chapterStage, level: 'warn', message: `${batchPrefix}[${chapterIdx}/${totalChapters}] ${labelOf(ck)} 内容校验未通过（${v.reason}），重试中…`, progress: baseProgress, chapter: ck, chapterIndex: chapterIdx, chapterTotal: totalChapters });
              await sleep(1000 * (attempt + 1));
              continue;
            }
            // Last attempt failed validation — keep whatever content we got
            // (better than an error stub) but mark as failed.
            chapterContent = r.content;
            break;
          }

          if (chapterOk) {
            perChapterOkCount++;
            // Round 56: Normalize the chapter content for consistent heading
            // levels and §N.M numbering before storing.
            const normalizedContent = normalizeEvalChapterContent(chapterContent, ck);
            chapterContents[ck] = normalizedContent;
            emit({
              stage: chapterDoneStage,
              level: 'success',
              message: `${batchPrefix}[${chapterIdx}/${totalChapters}] ${labelOf(ck)} ✓ ${normalizedContent.length} chars · ${(chapterDurationMs / 1000).toFixed(1)}s`,
              progress: baseProgress + 2,
              chapter: ck,
              chapterIndex: chapterIdx,
              chapterTotal: totalChapters,
              chapterContent: normalizedContent,
              chapterDurationMs,
            });
          } else {
            perChapterFailCount++;
            chapterContents[ck] = chapterContent || `_(${labelOf(ck)}: LLM 生成失败 — ${chapterError?.slice(0, 120) ?? 'unknown'})_`;
            emit({
              stage: chapterDoneStage,
              level: 'error',
              message: `${batchPrefix}[${chapterIdx}/${totalChapters}] ${labelOf(ck)} ✗ ${chapterError?.slice(0, 120) ?? 'unknown'}`,
              progress: baseProgress + 2,
              chapter: ck,
              chapterIndex: chapterIdx,
              chapterTotal: totalChapters,
              chapterError,
            });
          }
        }

        const chaptersTotalMs = Date.now() - tReportStart;
        // Re-declare stage names for the rescue pass below (originally
        // declared inside the per-chapter for-loop scope).
        const chapterStage = (isBatch && targets.length > 1) ? 'batch-0-chapter' : 'chapter';
        const chapterDoneStage = (isBatch && targets.length > 1) ? 'batch-0-chapter_done' : 'chapter_done';
        const batchPrefix = (isBatch && targets.length > 1) ? `[Target 1] ` : '';

        // ── Final rescue pass: regenerate any chapter that still failed ────
        // After the per-chapter retry loop, some chapters may still be missing
        // (all retries exhausted). We do one final pass — a fresh LLM call
        // for each still-broken chapter — because transient load on the LLM
        // endpoint often clears by the time all 8 chapters have been
        // attempted. This is the user-requested "post-generation audit +
        // regenerate missing chapters" mechanism.
        const failedChapters = chapters.filter((ck) => {
          const c = chapterContents[ck] || '';
          return !validateChapterContent(ck, c).ok;
        });
        if (failedChapters.length > 0) {
          emit({ stage: 'llm-report', level: 'warn', message: `${batchPrefix}检测到 ${failedChapters.length} 个章节异常，启动补救生成…`, progress: 90 });
          for (const ck of failedChapters) {
            const chapterIdx = chapters.indexOf(ck) + 1;
            emit({ stage: chapterStage, level: 'info', message: `${batchPrefix}[补救] [${chapterIdx}/${totalChapters}] ${labelOf(ck)} — 重新生成`, progress: 90, chapter: ck, chapterIndex: chapterIdx, chapterTotal: totalChapters });
            const userPrompt = buildChapterPrompt({ ...reportData, chapterKey: ck, chapterIndex: chapterIdx, chapterTotal: totalChapters });
            const sysPrompt = buildChapterSystemPrompt();
            const r = await generateText(sysPrompt, userPrompt, { maxChars: 4000, llm: llmWithSession });
            if (r.ok && validateChapterContent(ck, r.content).ok) {
              // Rescue succeeded — replace the failed content.
              // Round 56: Normalize the rescued chapter too.
              const normalizedContent = normalizeEvalChapterContent(r.content, ck);
              chapterContents[ck] = normalizedContent;
              perChapterOkCount++;
              perChapterFailCount = Math.max(0, perChapterFailCount - 1);
              emit({ stage: chapterDoneStage, level: 'success', message: `${batchPrefix}[补救] [${chapterIdx}/${totalChapters}] ${labelOf(ck)} ✓ ${normalizedContent.length} chars`, progress: 90, chapter: ck, chapterIndex: chapterIdx, chapterTotal: totalChapters, chapterContent: normalizedContent, chapterDurationMs: r.durationMs });
            } else {
              emit({ stage: chapterDoneStage, level: 'error', message: `${batchPrefix}[补救] [${chapterIdx}/${totalChapters}] ${labelOf(ck)} ✗ 仍失败`, progress: 90, chapter: ck, chapterIndex: chapterIdx, chapterTotal: totalChapters });
            }
          }
        }

        // Concatenate chapters in canonical order into the final report content.
        // Sanitize the joined result so a chapter that was cut off mid-word
        // doesn't poison the entire report (the sanitizer cuts back to the
        // last complete sentence across the whole concatenated text).
        const finalReport = sanitizeReport(
          chapters.map((ck) => chapterContents[ck] ?? '').join('\n\n')
        );
        const allOk = perChapterFailCount === 0;
        if (allOk) {
          emit({ stage: 'llm-report', level: 'success', message: `✓ LLM 分章生成完成 · ${perChapterOkCount}/${totalChapters} 章节 · ${finalReport.length} chars · 共 ${(chaptersTotalMs / 1000).toFixed(1)}s · ${provider}/${model}${saveReportFile ? ' · 已落盘' : ''}`, progress: 91 });
        } else {
          emit({ stage: 'llm-report', level: 'warn', message: `⚠ LLM 分章生成部分失败 · ${perChapterOkCount}✓ ${perChapterFailCount}✗ · ${finalReport.length} chars · ${provider}/${model}`, progress: 91 });
        }

        // ── Build provenance record (Claude Science-inspired) ───────────────
        // Capture the full lineage of this evaluation: which databases were
        // queried, which LLM calls produced the report, and which citations
        // appear in the final text. Citations are verified against their
        // source databases (RCSB / PubMed / DOI / UniProt) in parallel.
        // `provenanceJson` is declared in the outer scope (alongside `report`)
        // so the INSERT statement can read it regardless of which branch ran.
        try {
          const dataSources: DataSourceTrace[] = [
            { source: 'uniprot', query: uniprot, resultCount: 1, queriedAt: new Date().toISOString(), endpoint: 'https://rest.uniprot.org' },
            { source: 'rcsb', query: uniprot, resultCount: directPdbCount, queriedAt: new Date().toISOString(), endpoint: 'https://data.rcsb.org' },
          ];
          if (!shouldSkipBlast) {
            dataSources.push({ source: 'ncbi-blast', query: `blastp pdbaa ${uniprot} (${(await fetchUniprotSequence(uniprot).catch(() => ({ length: 0 } as string))).length}aa)`, resultCount: blastHits.length, queriedAt: new Date().toISOString(), endpoint: 'https://blast.ncbi.nlm.nih.gov' });
          }
          const llmCalls: LlmTrace[] = chapters.map((ck) => ({
            provider,
            model,
            durationMs: 0, // aggregated below
            fallback: false,
            maxChars: 4000,
            promptTemplate: `chapter:${ck}`,
            promptHash: hashPrompt(buildChapterPrompt({ ...reportData, chapterKey: ck, chapterIndex: 0, chapterTotal: totalChapters })),
          }));
          const prov = buildProvenance({
            uniprotId: uniprot,
            dataSources,
            llmCalls,
            reportMarkdown: finalReport,
            scoresSnapshot: {
              'X-ray': { score: scores.xray.score, max: 10 },
              'Cryo-EM': { score: scores.cryoem.score, max: 10 },
              'NMR': { score: scores.nmr.score, max: 10 },
              'Overall': { score: scores.overall.score, max: 10 },
            },
            structureCounts: { directPdb: directPdbCount, blastHomologs: blastHits.length, xray: scores.xray.structures ?? 0, cryoem: scores.cryoem.structures ?? 0, nmr: scores.nmr.structures ?? 0 },
          });
          // Verify citations in the background — non-blocking on the
          // evaluation itself, but we wait briefly so the first verification
          // pass is usually complete by the time the row is read.
          emit({ stage: 'provenance', level: 'info', message: `溯源记录：${prov.citations.length} 条引用待验证（RCSB/PubMed/DOI/UniProt）…`, progress: 93 });
          const verified = await Promise.race([
            verifyCitations(prov.citations, { timeoutMs: 8000 }),
            new Promise<typeof prov.citations>((resolve) => setTimeout(() => resolve(prov.citations), 12000)),
          ]);
          prov.citations = verified;
          const verifiedCount = verified.filter((c) => c.verified).length;
          emit({ stage: 'provenance', level: verifiedCount === verified.length ? 'success' : 'warn', message: `溯源完成：${verifiedCount}/${verified.length} 引用已验证`, progress: 94 });
          provenanceJson = JSON.stringify(prov);
        } catch (provErr: any) {
          // Provenance is best-effort — never fail the evaluation over it.
          emit({ stage: 'provenance', level: 'warn', message: `溯源记录构建失败（不影响评估）：${provErr?.message ?? 'unknown'}`, progress: 94 });
        }

        report = {
          ok: allOk,
          provider,
          model,
          durationMs: chaptersTotalMs,
          savedToFile: saveReportFile,
          filename: saveReportFile ? `wiki/evaluations/${uniprot}.md` : undefined,
          contentChars: finalReport.length,
          fallback: false,
          content: finalReport,
          chapters: chapterContents,
          chaptersOk: perChapterOkCount,
          chaptersFailed: perChapterFailCount,
          error: allOk ? undefined : `${perChapterFailCount} chapter(s) failed`,
        };
      }

      emit({ stage: 'write-db', level: 'info', message: `写入 Prisma (Evaluation ${pdbDetails.length} PDB + ${blastHits.length} BLAST)`, progress: 96 });
      let dbSaved = false;
      try {
        // ★ FIX: Insert Evaluation (parent) FIRST so FOREIGN KEY constraints succeed.
        const scoresJson = JSON.stringify({
          'X-ray': { score: scores.xray.score, rating: scores.xray.rating, max: 10 },
          'Cryo-EM': { score: scores.cryoem.score, rating: scores.cryoem.rating, max: 10 },
          'NMR': { score: scores.nmr.score, rating: scores.nmr.rating, max: 10 },
          'Overall': { score: scores.overall.score, rating: scores.overall.rating, max: 10 },
        });
        await db.$executeRaw`INSERT INTO Evaluation (uniprotId, entryName, proteinName, geneNames, organism, sequenceLength, coverage, scores, report, provenance, maxPdbUsed, blastWasSkipped, pdbCountAtEval, createdAt, updatedAt) VALUES (${uniprot}, ${uniprotInfo.entryName}, ${uniprotInfo.proteinName}, ${uniprotInfo.geneNames}, ${uniprotInfo.organism}, ${uniprotInfo.sequenceLength}, ${coverage}, ${scoresJson}, ${report?.ok ? report.content : null}, ${provenanceJson}, ${maxPdb}, ${shouldSkipBlast}, ${directPdbCount}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(uniprotId) DO UPDATE SET entryName = excluded.entryName, proteinName = excluded.proteinName, geneNames = excluded.geneNames, organism = excluded.organism, sequenceLength = excluded.sequenceLength, coverage = excluded.coverage, scores = excluded.scores, report = excluded.report, provenance = excluded.provenance, maxPdbUsed = excluded.maxPdbUsed, blastWasSkipped = excluded.blastWasSkipped, pdbCountAtEval = excluded.pdbCountAtEval, updatedAt = CURRENT_TIMESTAMP`;

        // Now insert child tables — skip if cache hit (PDB structures already in DB)
        if (!skipReportGeneration) {
        await db.$executeRaw`DELETE FROM EvaluationPdbStructure WHERE uniprotId = ${uniprot}`;
        for (const e of pdbDetails) {
          const isCryoem = (e.method || '').includes('ELECTRON');
          const isXray = (e.method || '').includes('X-RAY');
          const isNmr = (e.method || '').includes('NMR');
          const ifTier = e.journalIf == null ? 'unknown' : e.journalIf >= 20 ? 'top' : e.journalIf >= 10 ? 'high' : e.journalIf >= 5 ? 'mid' : 'low';
          await db.$executeRaw`INSERT INTO EvaluationPdbStructure (uniprotId, pdbId, method, resolution, title, depositionDate, releaseDate, ligand, ligandNames, journal, journalIf, doi, pubmedId, organism, authors, isCryoem, isXray, isNmr, ifTier) VALUES (${uniprot}, ${e.pdbId}, ${e.method}, ${e.resolution}, ${e.title}, ${e.depositDate}, ${e.releaseDate}, ${e.ligands}, ${e.ligands}, ${e.journal}, ${e.journalIf}, ${e.doi}, ${e.pubmedId}, ${e.organisms}, ${e.authors}, ${isCryoem}, ${isXray}, ${isNmr}, ${ifTier})`;
        }
        } // end if (!skipReportGeneration)

        if (!skipReportGeneration) {
        await db.$executeRaw`DELETE FROM EvaluationBlastResult WHERE uniprotId = ${uniprot}`;
        // Dedup blastHits by pdbId — same PDB can show up via both pdbaa
        // and nr fallback searches. Keep first occurrence (which is the
        // highest-identity one because blastHits is sorted desc by
        // identity in dedupBlastHits).
        const seenBlastPdbIds = new Set<string>();
        let dedupedBlastCount = 0;
        let paralogCount = 0;
        for (const h of blastHits) {
          if (!h.pdbId || seenBlastPdbIds.has(h.pdbId)) continue;
          seenBlastPdbIds.add(h.pdbId);
          dedupedBlastCount++;
          if (h.isParalog) paralogCount++;
          await db.$executeRaw`INSERT INTO EvaluationBlastResult (uniprotId, pdbId, uniprotRef, description, identity, evalue, queryCoverage, method, source, isParalog) VALUES (${uniprot}, ${h.pdbId}, ${h.uniprotRef}, ${h.description}, ${h.identity}, ${h.evalue}, ${h.queryCoverage}, ${'BLASTp'}, ${'NCBI BLAST REST API'}, ${!!h.isParalog})`;
        }
        emit({ stage: 'write-db', level: 'info', message: `  ↳ BLAST 去重: ${dedupedBlastCount}/${blastHits.length} (${paralogCount} 个同源蛋白 ≥95%)`, progress: 98 });
        } // end if (!skipReportGeneration) BLAST

        if (report?.ok && report.content) {
          await db.skillEvaluationReport.create({
            data: {
              uniprotId: uniprot,
              proteinName: uniprotInfo.proteinName,
              overallScore: scores.overall.score,
              directPdbCount,
              coverage,
              report: report.content,
              llmOk: report.ok,
              llmProvider: report.provider,
              llmModel: report.model,
              llmDurationMs: report.durationMs,
              filePath: report.filename,
            },
          });
        }
        // Write SkillRunRecord via raw SQL. We previously used
        // db.skillRunRecord.create({ data: {...} }), but the Prisma client
        // delegate is generated from the schema at build time — if the
        // running client is stale (e.g. a packaged standalone built before
        // the `log` column was added), the typed delegate rejects unknown
        // fields with "Unknown argument `log`". Raw SQL bypasses the
        // delegate entirely and writes directly to the table, which our
        // schema-compat pass guarantees has all columns.
        try {
          const _srrId = `eval_${uniprot}_${Date.now()}`;
          const _srrModule = 'eval';
          const _srrStatus = report?.ok || !generateReport ? 'success' : 'error';
          const _srrSummary = `${uniprotInfo.proteinName}: ${directPdbCount} PDB (真实) · overall=${scores.overall.score}/10${report?.ok ? ' · LLM ✓' : generateReport ? ' · LLM ✗' : ''}`;
          const _srrDetails = JSON.stringify({ uniprot, directPdbCount, pdbPersisted: pdbDetails.length, coverage, scores, reportOk: report?.ok, reportChars: report?.contentChars });
          const _srrProvider = provider;
          const _srrModel = report?.model || model;
          const _srrLlmOk = generateReport ? (report?.ok ? 1 : 0) : null;
          const _srrLlmFallback = generateReport ? (report?.fallback ? 1 : 0) : 0;
          const _srrLlmError = generateReport ? (report?.error ?? null) : null;
          const _srrDurationMs = Date.now() - t0;
          const _srrResultJson = JSON.stringify({ uniprot, scores, reportOk: report?.ok, reportChars: report?.contentChars, pdbSample: pdbDetails.slice(0, 5).map(e => e.pdbId) });
          const _srrLog = _log.join('\n');
          await db.$executeRaw`INSERT INTO SkillRunRecord (id, module, status, summary, details, provider, model, llmOk, llmFallback, llmError, durationMs, resultJson, log, createdAt) VALUES (${_srrId}, ${_srrModule}, ${_srrStatus}, ${_srrSummary}, ${_srrDetails}, ${_srrProvider}, ${_srrModel}, ${_srrLlmOk}, ${_srrLlmFallback}, ${_srrLlmError}, ${_srrDurationMs}, ${_srrResultJson}, ${_srrLog}, CURRENT_TIMESTAMP)`;
        } catch (srrErr: any) {
          // SkillRunRecord is a telemetry log — never fail the evaluation
          // over it. The Evaluation row itself was already written above.
          emit({ stage: 'write-db', level: 'warn', message: `SkillRunRecord 写入跳过：${srrErr?.message?.slice(0, 80) ?? 'unknown'}`, progress: 99 });
        }
        dbSaved = true;
        emit({ stage: 'write-db', level: 'success', message: `✓ 已写入 Evaluation + EvaluationPdbStructure(${pdbDetails.length}) + EvaluationBlastResult(${blastHits.length}) + SkillRunRecord`, progress: 99 });

        // ── Backfill PubMedArticle with metadata for PDB-linked pubmedIds ──
        // This makes evaluation-sourced literature appear in the Literature
        // module (which reads PubMedArticle). The link to this target is
        // implicit via EvaluationPdbStructure.pubmedId (joined in the papers
        // API). Dedup is automatic — ON CONFLICT DO NOTHING skips existing.
        if (pdbDetails.length > 0) {
          try {
            // Round 51: This backfill is now redundant (already done before report
            // generation), but we keep it as a verification step to ensure all
            // PMIDs are in the database for the Literature module.
            const pmRes2 = await backfillPubMedArticles(pdbDetails, emit);
            if (pmRes2.fetched > 0) {
              emit({ stage: 'pubmed-backfill', level: 'success', message: `✓ 文献反查: 新增 ${pmRes2.fetched} 篇 PubMed 文献到数据库（跳过已存在 ${pmRes2.skipped} 篇）— 文献模块已同步`, progress: 99 });
            } else if (pmRes2.skipped > 0) {
              emit({ stage: 'pubmed-backfill', level: 'info', message: `文献反查: ${pmRes2.skipped} 篇 PubMed 文献已在数据库中（无需更新）`, progress: 99 });
            }
          } catch (err: any) {
            emit({ stage: 'pubmed-backfill', level: 'warn', message: `文献反查失败（不影响评估结果）: ${err?.message}`, progress: 99 });
          }
        }
      } catch (err: any) {
        emit({ stage: 'write-db', level: 'error', message: `✗ 数据库写入失败：${err?.message}`, progress: 99 });
      }

      // P0-2: Free memory after DB write — large arrays no longer needed.
      // BUT in batch mode we still need pdbDetails for cross-target analysis
      // (common PDB detection) and for the batchResults payload. So we only
      // clear blastHits here (large, not needed downstream) and defer the
      // pdbDetails cleanup until after the batch section.
      const _pdbSample = pdbDetails.slice(0, 5).map(e => ({ pdbId: e.pdbId, method: e.method, resolution: e.resolution, title: e.title?.slice(0, 60) }));
      const _blastSample = blastHits.slice(0, 3).map(h => ({ pdbId: h.pdbId, identity: h.identity, evalue: h.evalue }));
      const _pdbPersisted = pdbDetails.length;
      if (!isBatch || targets.length <= 1) {
        pdbDetails.length = 0;
      }
      blastHits.length = 0;
      if (typeof global.gc === 'function') {
        try { global.gc(); } catch { /* ignore */ }
      }

      const result = {
        uniprot,
        uniprotInfo,
        directPdbCount,
        pdbPersisted: _pdbPersisted,
        pdbSample: _pdbSample,
        blastHitCount,
        blastSample: _blastSample,
        coverage,
        skippedBblast,
        scores,
        report,
        dbSaved,
        durationMs: Date.now() - t0,
      };
      const _targetPrefix = (isBatch && targets.length > 1) ? `[Target 1] ` : '';
      emit({ stage: 'done', level: report?.ok || !generateReport ? 'success' : 'warn', message: `${_targetPrefix}完成 · ${directPdbCount} PDB (真实) · overall=${scores.overall.score}/10 · ${((Date.now() - t0) / 1000).toFixed(1)}s${report?.ok ? ` · LLM ✓ (${report.contentChars} chars)` : generateReport ? ' · LLM ✗' : ''}${dbSaved ? ' · DB ✓' : ' · DB ✗'}`, progress: 100 });

      // ── Batch mode: evaluate remaining targets + cross-target relationship analysis ──
      // Progress is split evenly across all targets so the user sees each target
      // receive roughly the same progress share:
      //   - Primary target (bi=0): progress 2..(97/N)
      //   - Each batch target (bi): progress ((bi*97+2)/N)..(((bi+1)*97)/N)
      //   - Cross-analysis + write-batch-db: progress 97..100
      // The 3% at the end is reserved for cross-target analysis (per-target
      // relationship report) and final batch DB write.
      if (isBatch && targets.length > 1) {
        const targetCount = targets.length;
        const slot = 97 / targetCount; // 97% of bar split across N targets
        const batchResults: any[] = [{ uniprot, uniprotInfo, pdbDetails, scores, report }];
        // Evaluate remaining targets (target[0] already done above)
        for (let bi = 1; bi < targets.length; bi++) {
          const bt = targets[bi];
          const bUid = (bt.uniprot || '').trim().toUpperCase();
          if (!bUid) continue;
          // Set the batch index so emit() remaps this target's local 0..100
          // progress into its global slot [2+bi*slot, 2+(bi+1)*slot).
          _batchIdx = bi;
          _batchCount = targetCount;
          emit({ stage: `batch-${bi}`, level: 'info', message: `[Target ${bi + 1}/${targets.length}] 评估 ${bUid}…`, progress: 2 });
          try {
            const bMeta = await fetchUniprotMeta(bUid);
            const bInfo = bMeta ? { uniprotId: bUid, entryName: bMeta.entryName, proteinName: bMeta.proteinName, geneNames: bMeta.geneNames || '—', organism: bMeta.organism || '—', sequenceLength: bMeta.sequenceLength || 0 } : { uniprotId: bUid, entryName: bUid, proteinName: `Unknown`, geneNames: '—', organism: '—', sequenceLength: 0 };
            // API-01: per-target maxPdb gets the same 200 cap as the global one.
            const bMaxPdb = Math.min(bt.maxPdb || maxPdb, MAX_PDB_CAP);
            const bSkipBlast = !!(bt.skipBlast ?? skipBlast);
            const bForceBlast = !!(bt.forceBlast ?? forceBlast);
            const bPdbIds = await fetchPdbIdsForUniprot(bUid, bMaxPdb);
            const bDirectPdbCount = bPdbIds.length;
            const bCoverage = bDirectPdbCount > 0 ? Math.min(100, bDirectPdbCount * 5) : 0;
            // Cache check for batch target
            let bCached: any = null;
            try { bCached = (await db.$queryRaw<any[]>`SELECT maxPdbUsed, blastWasSkipped, pdbCountAtEval, report FROM Evaluation WHERE uniprotId = ${bUid}`)[0] || null; } catch {}
            let bPdbDetails: PdbEntryDetail[] = [];
            let bCacheHit = false;
            if (bCached && bCached.maxPdbUsed === bMaxPdb && !!bCached.blastWasSkipped === (bSkipBlast && !bForceBlast) && bCached.pdbCountAtEval === bDirectPdbCount) {
              bCacheHit = true;
              emit({ stage: `batch-${bi}`, level: 'success', message: `✓ [Target ${bi + 1}] ${bUid} 缓存命中（参数+PDB数未变），跳过重新获取`, progress: 30 });
              try {
                const existing = await db.$queryRaw<any[]>`SELECT pdbId, method, resolution, title, journal, journalIf, doi, pubmedId, organism, authors, ligand, depositionDate, releaseDate FROM EvaluationPdbStructure WHERE uniprotId = ${bUid}`;
                bPdbDetails = (existing as any[]).map(e => ({ pdbId: e.pdbId, method: e.method, resolution: e.resolution, title: e.title, journal: e.journal, journalIf: e.journalIf, doi: e.doi, pubmedId: e.pubmedId, organisms: e.organism, authors: e.authors, ligands: e.ligand, depositDate: e.depositionDate, releaseDate: e.releaseDate }));
              } catch {}
            } else {
              bPdbDetails = bDirectPdbCount > 0 ? await fetchPdbEntryDetails(bPdbIds) : [];
            }

            // ── Auto-decide BLAST for batch target (same logic as primary) ──
            // Run BLAST when: directPdbCount < 5 OR coverage < 50%.
            // forceBlast overrides → always run. skipBlast overrides → never run.
            // Cache hit skips BLAST (cached row already has blastResults if any).
            const B_MIN_PDB = 5;
            const B_MIN_COV = 50;
            const bAutoShouldSkip = bDirectPdbCount >= B_MIN_PDB && bCoverage >= B_MIN_COV;
            const bShouldSkipBlast = bCacheHit || (!bForceBlast && (bSkipBlast || bAutoShouldSkip));
            let bBlastHits: any[] = [];
            let bBlastHitCount = 0;
            let bSkippedBblast = false;
            if (bShouldSkipBlast) {
              if (bCacheHit) {
                // Cache hit — reuse cached BLAST results if present.
                try { bBlastHits = (await db.$queryRaw<any[]>`SELECT pdbId, uniprotRef, description, identity, evalue, queryCoverage FROM EvaluationBlastResult WHERE uniprotId = ${bUid}`) || []; bBlastHitCount = bBlastHits.length; } catch {}
                emit({ stage: `batch-${bi}-blast`, level: 'info', message: `[Target ${bi + 1}] BLAST 使用缓存（${bBlastHitCount} 条同源）`, progress: 35 });
              } else if (bAutoShouldSkip && !bSkipBlast) {
                emit({ stage: `batch-${bi}-blast`, level: 'info', message: `[Target ${bi + 1}] BLAST 自动跳过：PDB ${bDirectPdbCount} ≥ ${B_MIN_PDB} 且覆盖率 ${bCoverage}% ≥ ${B_MIN_COV}%（勾选「强制 BLAST」可忽略）`, progress: 35 });
              } else {
                emit({ stage: `batch-${bi}-blast`, level: 'warn', message: `[Target ${bi + 1}] BLAST 已跳过 (skipBlast=true)`, progress: 35 });
              }
              bSkippedBblast = true;
            } else {
              if (bForceBlast) {
                emit({ stage: `batch-${bi}-blast`, level: 'info', message: `[Target ${bi + 1}] 强制 BLAST（forceBlast=true，PDB=${bDirectPdbCount}, 覆盖率=${bCoverage}%）`, progress: 35 });
              } else {
                emit({ stage: `batch-${bi}-blast`, level: 'info', message: `[Target ${bi + 1}] 自动判定需要 BLAST：PDB ${bDirectPdbCount} < ${B_MIN_PDB} 或覆盖率 ${bCoverage}% < ${B_MIN_COV}%`, progress: 35 });
              }
              try {
                const bSeq = await fetchUniprotSequence(bUid);
                emit({ stage: `batch-${bi}-blast`, level: 'info', message: `[Target ${bi + 1}] 序列 ${bSeq.length}aa，提交 BLASTp（上限 ${maxBlastHits}）…`, progress: 38 });
                bBlastHits = await runBlast(bSeq, maxBlastHits, (msg) => { emit({ stage: `batch-${bi}-blast`, level: 'info', message: `[Target ${bi + 1}] ${msg}`, progress: 40 }); });
                bBlastHitCount = bBlastHits.length;
                if (bBlastHitCount > 0) {
                  emit({ stage: `batch-${bi}-blast`, level: 'success', message: `[Target ${bi + 1}] ✓ BLAST 命中 ${bBlastHitCount}/${maxBlastHits} 条同源（最高 identity=${bBlastHits[0].identity}% · ${bBlastHits[0].pdbId}）`, progress: 44 });
                  // Enrich BLAST hits with RCSB metadata (same as primary path).
                  const bDirectIds = new Set(bPdbDetails.map(d => d.pdbId));
                  const bBlastPdbIds = Array.from(new Set(bBlastHits.map((h: any) => h.pdbId).filter((id: string) => id && !bDirectIds.has(id))));
                  if (bBlastPdbIds.length > 0) {
                    emit({ stage: `batch-${bi}-blast`, level: 'info', message: `[Target ${bi + 1}] 从 RCSB 反查 ${bBlastPdbIds.length} 个 BLAST PDB 元数据…`, progress: 46 });
                    try {
                      const bEnriched = await fetchPdbEntryDetails(bBlastPdbIds, bBlastPdbIds.length);
                      const bBlastById = new Map(bBlastHits.map((h: any) => [h.pdbId, h]));
                      for (const e of bEnriched) {
                        const h = bBlastById.get(e.pdbId);
                        (e as any).via = 'blast';
                        (e as any).blastIdentity = h?.identity;
                        (e as any).blastEvalue = h?.evalue;
                        (e as any).blastQueryCoverage = h?.queryCoverage;
                        bPdbDetails.push(e);
                      }
                    } catch (enrichErr: any) {
                      emit({ stage: `batch-${bi}-blast`, level: 'warn', message: `[Target ${bi + 1}] BLAST PDB 元数据反查失败：${enrichErr?.message}`, progress: 46 });
                    }
                  }
                } else {
                  emit({ stage: `batch-${bi}-blast`, level: 'warn', message: `[Target ${bi + 1}] BLAST 完成，无同源命中`, progress: 44 });
                }
              } catch (blastErr: any) {
                emit({ stage: `batch-${bi}-blast`, level: 'error', message: `[Target ${bi + 1}] ✗ BLAST 失败：${blastErr?.message}（继续后续评分）`, progress: 44 });
                bSkippedBblast = true;
              }
            }

            const bXray = bPdbDetails.filter(e => (e.method || '').includes('X-RAY')).length;
            const bCryoem = bPdbDetails.filter(e => (e.method || '').includes('ELECTRON')).length;
            const bNmr = bPdbDetails.filter(e => (e.method || '').includes('NMR')).length;
            // sqrt-based score scale (consistent with the single-target path).
            const calcS = (c: number) => Math.min(10, Math.max(1, Math.round(Math.sqrt(Math.max(0, c)) * 2)));
            const bScores = { xray: { score: calcS(bXray), structures: bXray, max: 10 }, cryoem: { score: calcS(bCryoem), structures: bCryoem, max: 10 }, nmr: { score: calcS(bNmr), structures: bNmr, max: 10 }, overall: { score: Math.min(10, Math.max(1, Math.round((calcS(bXray) + calcS(bCryoem) + calcS(bNmr)) / 3))), max: 10 } };
            // Write to DB — skip PDB structure insert if cache hit
            let bReport: any = undefined;
            // Generate individual LLM report for this batch target.
            // In batch mode we ALWAYS regenerate the report (even if a cached
            // Evaluation row exists) so the user sees per-chapter SSE streaming
            // for every target — otherwise batch targets with a prior eval would
            // silently skip the LLM and the ChapterStream UI would only show
            // the primary target's chapters.
            if (generateReport) {
              emit({ stage: `batch-${bi}-llm`, level: 'info', message: `[Target ${bi + 1}] 生成 ${bUid} 的 LLM 报告（8 章节流式，跟 primary 模板一致）…`, progress: 50 });
              try {
                // ── Per-chapter LLM streaming (same 8-chapter flow as primary target,
                //    so batch target reports share the same template). Each chapter
                //    is its own short LLM call so the front-end can render
                //    incrementally via SSE `batch-${bi}-chapter` / `batch-${bi}-chapter_done`.
                const PDB_CAP = 80;
                const BLAST_CAP = Math.min(maxBlastHits, 50);
                const bPdbTable = bPdbDetails.length > 0
                  ? buildDetailedPdbTable(bPdbDetails, PDB_CAP)
                  : '| PDB ID | Method | Resolution | Journal (IF) | Title |\n|--------|--------|------------|--------------|-------|\n| (无 PDB 结构数据) | - | - | - | - |';
                // Build BLAST table from actual hits (bBlastHits) when BLAST
                // ran this session, otherwise from cached results, otherwise
                // show the skipped/empty placeholder.
                const bBlastTable = bBlastHits.length > 0
                  ? buildDetailedBlastTable(bBlastHits, BLAST_CAP)
                  : (bShouldSkipBlast
                    ? '| PDB ID | UniProt | Identity | E-value | Description |\n|--------|---------|----------|---------|-------------|\n| (BLAST 已跳过) | - | - | - | - |'
                    : (bCached?.blastResults ? buildDetailedBlastTable(bCached.blastResults, BLAST_CAP) : '| PDB ID | UniProt | Identity | E-value | Description |\n|--------|---------|----------|---------|-------------|\n| (无 BLAST 数据) | - | - | - | - |'));
                // Round 52: Backfill PubMed before building literature info for batch targets
                await backfillPubMedArticles(bPdbDetails, emit);
                const bLitInfo = await buildLiteratureInfo(bPdbDetails, maxLitCount);
                const bLiteratureInfo = bLitInfo.count > 0
                  ? `共 ${bLitInfo.count} 篇相关文献（按期刊影响因子降序，已截取前 ${bLitInfo.count} 篇；摘要截取 200 字）：\n\n${bLitInfo.text}`
                  : '（无 PubMed 文献数据 — PubMedArticle 表为空或这些 PDB 结构无对应文献）';

                // Round 36: Run structural analysis for batch targets too
                let bStructureAnalyses: StructureAnalysisData | undefined;
                if (!skipStructureAnalysis) {
                  try {
                    const bTopPdb = bPdbDetails
                      .filter(e => (e.method || '').includes('X-RAY') || (e.method || '').includes('ELECTRON'))
                      .sort((a, b) => (a.resolution || 99) - (b.resolution || 99))[0]
                      || bPdbDetails[0];
                    if (bTopPdb) {
                      emit({ stage: `batch-${bi}-llm`, level: 'info', message: `[Target ${bi + 1}] 对重点结构 ${bTopPdb.pdbId} 运行结构分析…`, progress: 52 });
                      const { chain1: bc1, chain2: bc2 } = await pickAnalysisChains(bTopPdb.pdbId);
                      let bLigand = await detectPrimaryLigand(bTopPdb.pdbId);
                      if (!bLigand) {
                        const bLigStr = typeof bTopPdb.ligands === 'string' ? bTopPdb.ligands : '';
                        bLigand = bLigStr.split(/[;,\s]+/).filter(Boolean)[0];
                      }
                      const bRecipes: Array<{ recipeId: string; params?: Record<string, unknown> }> = [
                        { recipeId: 'all_interactions', params: { chain1: bc1, chain2: bc2 } },
                        { recipeId: 'hbonds', params: { chain1: bc1, chain2: bc1 } },
                      ];
                      if (bLigand) {
                        bRecipes.push({ recipeId: 'binding_pocket', params: { ligandCompId: bLigand, radius: 5.0 } });
                        bRecipes.push({ recipeId: 'druggability', params: { ligandCompId: bLigand, radius: 5.0 } });
                      }
                      const bResults = await runMultipleAnalyses(bTopPdb.pdbId, bRecipes);
                      bStructureAnalyses = { pdbId: bTopPdb.pdbId };
                      const bpR = bResults['binding_pocket'] as any;
                      if (bpR?.data) {
                        const bp = bpR.data; const residues = bp.residues || [];
                        bStructureAnalyses.bindingPocket = {
                          ligand: bp.ligand || bLigand || 'unknown',
                          radius: bp.radius_A || bp.radius || 5.0,
                          residueCount: bp.pocket_residue_count || residues.length,
                          volume: bp.estimated_volume_A3 || bp.estimated_volume || '?',
                          composition: bp.composition || {},
                          topResidues: residues.slice(0, 15).map((r: any) => `${r.resname || '?'}${r.resno || r.residue_number || '?'}(${r.chain || r.chain_id || '?'})`),
                          catalyticResidues: residues.filter((r: any) => [41, 145].includes(Number(r.resno || r.residue_number || 0))).map((r: any) => `${r.resname || '?'}${r.resno || r.residue_number || '?'}`),
                        };
                      }
                      const aiR = bResults['all_interactions'] as any;
                      if (aiR?.data) {
                        const ai = aiR.data; const interactions = ai.interactions || [];
                        const rc: Record<string, number> = {};
                        for (const c of interactions) {
                          const r1 = `${c.resname1 || '?'}${c.resno1 || '?'}(${c.chain1 || '?'})`;
                          const r2 = `${c.resname2 || '?'}${c.resno2 || '?'}(${c.chain2 || '?'})`;
                          rc[r1] = (rc[r1] || 0) + 1; rc[r2] = (rc[r2] || 0) + 1;
                        }
                        bStructureAnalyses.allInteractions = {
                          chain1: ai.chain1 || bc1, chain2: ai.chain2 || bc2,
                          total: ai.total || 0, hbonds: ai.hbonds || 0,
                          saltBridges: ai.salt_bridges || 0, hydrophobic: ai.hydrophobic || 0,
                          topContacts: interactions.slice(0, 10).map((c: any) => ({
                            pair: `${c.resname1 || '?'}${c.resno1 || '?'}(${c.chain1 || '?'}) ↔ ${c.resname2 || '?'}${c.resno2 || '?'}(${c.chain2 || '?'})`,
                            distance: c.distance_A || 0, type: c.type || 'unknown',
                          })),
                          hotspots: Object.entries(rc).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([residue, contacts]) => ({ residue, contacts })),
                        };
                      }
                      const hbR = bResults['hbonds'] as any;
                      if (hbR?.data) {
                        const hb = hbR.data; const bonds = hb.hbonds || hb.bonds || [];
                        bStructureAnalyses.hbonds = {
                          total: hb.total_hbonds || hb.count || bonds.length,
                          topPairs: bonds.slice(0, 10).map((c: any) => ({
                            pair: `${c.resname1 || '?'}${c.resno1 || '?'}(${c.chain1 || '?'}) ${c.atom1 || ''} → ${c.resname2 || '?'}${c.resno2 || '?'}(${c.chain2 || '?'}) ${c.atom2 || ''}`,
                            distance: c.distance_A || 0,
                          })),
                        };
                      }
                      const dgR = bResults['druggability'] as any;
                      if (dgR?.data) {
                        const drug = dgR.data; const ds = drug.druggability_score || 0;
                        const cls = drug.classification || 'unknown';
                        const catMap: Record<string, string> = { 'highly_druggable': '高', 'druggable': '中', 'moderately_druggable': '中低', 'difficult': '低' };
                        bStructureAnalyses.druggability = {
                          score: Math.round(ds / 10), category: catMap[cls] || cls,
                          rationale: `口袋体积 ${drug.pocket_volume_A3 || '?'} Å³; 疏水 ${drug.hydrophobic_pct || 0}% / 极性 ${drug.polar_pct || 0}% / 电荷 ${drug.charged_pct || 0}%; 分类: ${cls}`,
                        };
                      }
                      // Round 48: Only emit success + summary if we actually got data
                      const bHasData = bStructureAnalyses.bindingPocket || bStructureAnalyses.allInteractions || bStructureAnalyses.hbonds || bStructureAnalyses.druggability || bStructureAnalyses.virtualScreening;
                      if (bHasData) {
                        emit({ stage: `batch-${bi}-llm`, level: 'success', message: `[Target ${bi + 1}] 结构分析完成: ${bStructureAnalyses.bindingPocket ? `口袋 ${bStructureAnalyses.bindingPocket.residueCount} 残基` : ''} ${bStructureAnalyses.allInteractions ? `互作 ${bStructureAnalyses.allInteractions.total} 个` : ''}`, progress: 54 });
                        // Round 44: Emit structured analysis summary for batch targets too
                        emit({
                          stage: `batch-${bi}-structure-analysis-summary`,
                          level: 'success',
                          message: `[Target ${bi + 1}] 结构分析摘要`,
                          progress: 54,
                          targetIndex: bi,
                          targetUniprot: bUid,
                          analysisSummary: {
                            pdbId: bStructureAnalyses.pdbId,
                            bindingPocket: bStructureAnalyses.bindingPocket ? {
                              ligand: bStructureAnalyses.bindingPocket.ligand,
                              residueCount: bStructureAnalyses.bindingPocket.residueCount,
                              volume: bStructureAnalyses.bindingPocket.volume,
                          } : null,
                          allInteractions: bStructureAnalyses.allInteractions ? {
                            chains: `${bStructureAnalyses.allInteractions.chain1}↔${bStructureAnalyses.allInteractions.chain2}`,
                            total: bStructureAnalyses.allInteractions.total,
                            hbonds: bStructureAnalyses.allInteractions.hbonds,
                            saltBridges: bStructureAnalyses.allInteractions.saltBridges,
                            hydrophobic: bStructureAnalyses.allInteractions.hydrophobic,
                          } : null,
                          hbonds: bStructureAnalyses.hbonds ? { total: bStructureAnalyses.hbonds.total } : null,
                          druggability: bStructureAnalyses.druggability ? {
                            score: bStructureAnalyses.druggability.score,
                            category: bStructureAnalyses.druggability.category,
                          } : null,
                          virtualScreening: bStructureAnalyses.virtualScreening ? {
                            fragmentsScreened: bStructureAnalyses.virtualScreening.fragmentsScreened,
                            topHit: bStructureAnalyses.virtualScreening.topHits[0]?.name || null,
                            bestKi_uM: bStructureAnalyses.virtualScreening.bestKi_uM,
                          } : null,
                        },
                      });
                      } else {
                        emit({ stage: `batch-${bi}-llm`, level: 'warn', message: `[Target ${bi + 1}] 结构分析完成但无有效数据`, progress: 54 });
                      }
                    }
                  } catch (err) {
                    emit({ stage: `batch-${bi}-llm`, level: 'warn', message: `[Target ${bi + 1}] 结构分析跳过: ${err instanceof Error ? err.message.slice(0, 60) : String(err).slice(0, 60)}`, progress: 54 });
                  }
                }

                const bReportData = {
                  uniprot: bUid,
                  entryName: bInfo.entryName,
                  proteinName: bInfo.proteinName,
                  geneNames: bInfo.geneNames,
                  organism: bInfo.organism,
                  sequenceLength: bInfo.sequenceLength,
                  coverage: 0,
                  directPdbCount: bDirectPdbCount,
                  blastHitCount: bBlastHitCount,
                  pdbCount: bPdbDetails.length,
                  maxBlastHitsRequested: maxBlastHits,
                  scores: bScores,
                  pdbTable: bPdbTable,
                  blastTable: bBlastTable,
                  literatureInfo: bLiteratureInfo,
                  literatureCount: bLitInfo.count,
                  structureAnalyses: bStructureAnalyses, // Round 36: batch structural analysis
                };
                // Round 36: Include structure_analysis chapter for batch targets when data exists
                const chapters: ReportChapterKey[] = bStructureAnalyses
                  ? ['summary', 'function', 'topology', 'pdb_analysis', 'structure_analysis', 'feasibility', 'experimental', 'references', 'conclusion']
                  : ['summary', 'function', 'topology', 'pdb_analysis', 'feasibility', 'experimental', 'references', 'conclusion'];
                const chapterContents: Record<string, string> = {};
                let perChapterOkCount = 0;
                let perChapterFailCount = 0;
                const tBatchReportStart = Date.now();
                emit({ stage: `batch-${bi}-llm`, level: 'info', message: `[Target ${bi + 1}] ${bUid} 准备分 ${chapters.length} 章节生成报告 (${provider})… 共 ${bPdbDetails.length} 个 PDB${bLitInfo.count > 0 ? ` + ${bLitInfo.count} 篇文献` : ''} 已加载到上下文`, progress: 55 });
                // Round 54: Generate a session ID for this batch target's report
                const batchSessionId = `eval-${bUid}-${Date.now()}`;
                const bLlmWithSession = { ...body.llm, sessionId: batchSessionId };
                for (let i = 0; i < chapters.length; i++) {
                  const ck = chapters[i];
                  const chapterIdx = i + 1;
                  emit({ stage: `batch-${bi}-chapter`, level: 'info', message: `[Target ${bi + 1}] [${chapterIdx}/${chapters.length}] ${labelOf(ck)} — 开始生成`, progress: 55, chapter: ck, chapterIndex: chapterIdx, chapterTotal: chapters.length });
                  const userPrompt = buildChapterPrompt({ ...bReportData, chapterKey: ck, chapterIndex: chapterIdx, chapterTotal: chapters.length });
                  const sysPrompt = buildChapterSystemPrompt();
                  // Validation + retry (same as primary target path).
                  const MAX_CHAPTER_RETRIES = 2;
                  let chapterOk = false;
                  let chapterContent = '';
                  let chapterError: string | undefined;
                  for (let attempt = 0; attempt <= MAX_CHAPTER_RETRIES; attempt++) {
                    const r = await generateText(sysPrompt, userPrompt, { maxChars: 4000, llm: bLlmWithSession });
                    if (!r.ok) {
                      chapterError = r.error;
                      if (attempt < MAX_CHAPTER_RETRIES) { await sleep(1500 * (attempt + 1)); continue; }
                      break;
                    }
                    const v = validateChapterContent(ck, r.content);
                    if (v.ok) { chapterOk = true; chapterContent = r.content; break; }
                    chapterError = v.reason;
                    if (attempt < MAX_CHAPTER_RETRIES) { await sleep(1000 * (attempt + 1)); continue; }
                    chapterContent = r.content;
                    break;
                  }
                  if (chapterOk) {
                    perChapterOkCount++;
                    // Round 56: Normalize the batch chapter content too.
                    const normalizedContent = normalizeEvalChapterContent(chapterContent, ck);
                    chapterContents[ck] = normalizedContent;
                    emit({ stage: `batch-${bi}-chapter_done`, level: 'success', message: `[Target ${bi + 1}] [${chapterIdx}/${chapters.length}] ${labelOf(ck)} ✓ ${normalizedContent.length} chars`, progress: 60, chapter: ck, chapterIndex: chapterIdx, chapterTotal: chapters.length, chapterContent: normalizedContent });
                  } else {
                    perChapterFailCount++;
                    chapterContents[ck] = chapterContent || `_(${labelOf(ck)}: LLM 生成失败 — ${chapterError?.slice(0, 120) ?? 'unknown'})_`;
                    emit({ stage: `batch-${bi}-chapter_done`, level: 'error', message: `[Target ${bi + 1}] [${chapterIdx}/${chapters.length}] ${labelOf(ck)} ✗ ${chapterError?.slice(0, 100) ?? 'unknown'}`, progress: 60, chapter: ck, chapterIndex: chapterIdx, chapterTotal: chapters.length });
                  }
                }
                // Final rescue pass for batch target chapters.
                const bFailedChapters = chapters.filter((ck) => !validateChapterContent(ck, chapterContents[ck] || '').ok);
                if (bFailedChapters.length > 0) {
                  emit({ stage: `batch-${bi}-llm`, level: 'warn', message: `[Target ${bi + 1}] 检测到 ${bFailedChapters.length} 个章节异常，启动补救生成…`, progress: 88 });
                  for (const ck of bFailedChapters) {
                    const chapterIdx = chapters.indexOf(ck) + 1;
                    const userPrompt = buildChapterPrompt({ ...bReportData, chapterKey: ck, chapterIndex: chapterIdx, chapterTotal: chapters.length });
                    const sysPrompt = buildChapterSystemPrompt();
                    const r = await generateText(sysPrompt, userPrompt, { maxChars: 4000, llm: bLlmWithSession });
                    if (r.ok && validateChapterContent(ck, r.content).ok) {
                      // Round 56: Normalize the rescued batch chapter too.
                      const normalizedContent = normalizeEvalChapterContent(r.content, ck);
                      chapterContents[ck] = normalizedContent;
                      perChapterOkCount++;
                      perChapterFailCount = Math.max(0, perChapterFailCount - 1);
                      emit({ stage: `batch-${bi}-chapter_done`, level: 'success', message: `[Target ${bi + 1}] [补救] [${chapterIdx}/${chapters.length}] ${labelOf(ck)} ✓ ${normalizedContent.length} chars`, progress: 88, chapter: ck, chapterIndex: chapterIdx, chapterTotal: chapters.length, chapterContent: normalizedContent });
                    } else {
                      emit({ stage: `batch-${bi}-chapter_done`, level: 'error', message: `[Target ${bi + 1}] [补救] [${chapterIdx}/${chapters.length}] ${labelOf(ck)} ✗ 仍失败`, progress: 88, chapter: ck, chapterIndex: chapterIdx, chapterTotal: chapters.length });
                    }
                  }
                }
                const finalReport = sanitizeReport(chapters.map((ck) => chapterContents[ck] ?? '').join('\n\n'));
                const allOk = perChapterFailCount === 0;
                bReport = {
                  ok: allOk,
                  content: finalReport,
                  provider,
                  model,
                  durationMs: Date.now() - tBatchReportStart,
                  contentChars: finalReport.length,
                  perChapterOkCount,
                  perChapterFailCount,
                };
                if (allOk) {
                  emit({ stage: `batch-${bi}-llm`, level: 'success', message: `✓ [Target ${bi + 1}] ${bUid} LLM 分章报告完成 · ${perChapterOkCount}/${chapters.length} 章 · ${finalReport.length} chars · ${((Date.now() - tBatchReportStart) / 1000).toFixed(1)}s · ${provider}/${model}`, progress: 90 });
                } else {
                  emit({ stage: `batch-${bi}-llm`, level: 'warn', message: `⚠ [Target ${bi + 1}] ${bUid} LLM 分章部分失败 · ${perChapterOkCount}✓ ${perChapterFailCount}✗ · ${finalReport.length} chars · ${provider}/${model}`, progress: 90 });
                }
              } catch (err: any) {
                emit({ stage: `batch-${bi}-llm`, level: 'error', message: `✗ [Target ${bi + 1}] ${bUid} LLM 生成失败：${err?.message}`, progress: 90 });
              }
            }
            try {
              const bScoresJson = JSON.stringify({ 'X-ray': { score: bScores.xray.score, max: 10 }, 'Cryo-EM': { score: bScores.cryoem.score, max: 10 }, 'NMR': { score: bScores.nmr.score, max: 10 }, 'Overall': { score: bScores.overall.score, max: 10 } });
              const bReportContent = bReport?.ok ? bReport.content : (bCacheHit && bCached?.report ? bCached.report : null);
              await db.$executeRaw`INSERT INTO Evaluation (uniprotId, entryName, proteinName, geneNames, organism, sequenceLength, coverage, scores, report, maxPdbUsed, blastWasSkipped, pdbCountAtEval, createdAt, updatedAt) VALUES (${bUid}, ${bInfo.entryName}, ${bInfo.proteinName}, ${bInfo.geneNames}, ${bInfo.organism}, ${bInfo.sequenceLength}, ${bCoverage}, ${bScoresJson}, ${bReportContent}, ${bMaxPdb}, ${bShouldSkipBlast}, ${bDirectPdbCount}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP) ON CONFLICT(uniprotId) DO UPDATE SET entryName = excluded.entryName, proteinName = excluded.proteinName, geneNames = excluded.geneNames, organism = excluded.organism, sequenceLength = excluded.sequenceLength, coverage = excluded.coverage, scores = excluded.scores, report = excluded.report, maxPdbUsed = excluded.maxPdbUsed, blastWasSkipped = excluded.blastWasSkipped, pdbCountAtEval = excluded.pdbCountAtEval, updatedAt = CURRENT_TIMESTAMP`;
              if (!bCacheHit) {
                await db.$executeRaw`DELETE FROM EvaluationPdbStructure WHERE uniprotId = ${bUid}`;
                for (const e of bPdbDetails) {
                  const isCryoem = (e.method || '').includes('ELECTRON'); const isXray = (e.method || '').includes('X-RAY'); const isNmr = (e.method || '').includes('NMR');
                  const ifTier = e.journalIf == null ? 'unknown' : e.journalIf >= 20 ? 'top' : e.journalIf >= 10 ? 'high' : e.journalIf >= 5 ? 'mid' : 'low';
                  await db.$executeRaw`INSERT INTO EvaluationPdbStructure (uniprotId, pdbId, method, resolution, title, depositionDate, releaseDate, ligand, ligandNames, journal, journalIf, doi, pubmedId, organism, authors, isCryoem, isXray, isNmr, ifTier) VALUES (${bUid}, ${e.pdbId}, ${e.method}, ${e.resolution}, ${e.title}, ${e.depositDate}, ${e.releaseDate}, ${e.ligands}, ${e.ligands}, ${e.journal}, ${e.journalIf}, ${e.doi}, ${e.pubmedId}, ${e.organisms}, ${e.authors}, ${isCryoem}, ${isXray}, ${isNmr}, ${ifTier})`;
                }
                // Write BLAST results (only when BLAST actually ran this session).
                if (bBlastHits.length > 0) {
                  await db.$executeRaw`DELETE FROM EvaluationBlastResult WHERE uniprotId = ${bUid}`;
                  for (const h of bBlastHits) {
                    const isParalog = (h.identity ?? 0) >= 95;
                    await db.$executeRaw`INSERT INTO EvaluationBlastResult (uniprotId, pdbId, uniprotRef, description, identity, evalue, queryCoverage, isParalog) VALUES (${bUid}, ${h.pdbId}, ${h.uniprotRef || ''}, ${h.description || ''}, ${h.identity ?? 0}, ${h.evalue || '0'}, ${h.queryCoverage ?? 0}, ${isParalog})`.catch(() => {});
                  }
                }
              }
            } catch (dbErr: any) {
              emit({ stage: `batch-${bi}`, level: 'error', message: `[Target ${bi + 1}] DB 写入失败：${dbErr?.message}`, progress: 95 });
            }
            // Backfill PubMed articles for this batch target's PDBs (same as primary).
            if (bPdbDetails.length > 0 && !bCacheHit) {
              try {
                const pmRes = await backfillPubMedArticles(bPdbDetails, emit);
                if (pmRes.fetched > 0) {
                  emit({ stage: `batch-${bi}`, level: 'info', message: `[Target ${bi + 1}] 文献反查: 新增 ${pmRes.fetched} 篇 PubMed 文献`, progress: 95 });
                }
              } catch { /* ignore — non-critical */ }
            }
            batchResults.push({ uniprot: bUid, uniprotInfo: bInfo, pdbDetails: bPdbDetails, scores: bScores, cached: bCacheHit, report: bReport, blastHits: bBlastHits });
            emit({ stage: `batch-${bi}`, level: 'success', message: `✓ [Target ${bi + 1}] ${bUid}: ${bPdbDetails.length} PDB${bBlastHitCount > 0 ? ` · ${bBlastHitCount} BLAST 同源` : bSkippedBblast ? ' · BLAST 跳过' : ''} · overall=${bScores.overall.score}/10${bCacheHit ? ' · 缓存' : ''}${bReport?.ok ? ` · LLM ✓ (${bReport.contentChars} chars)` : ''}`, progress: 100 });
          } catch (err: any) {
            emit({ stage: `batch-${bi}`, level: 'error', message: `✗ [Target ${bi + 1}] ${bUid} 失败：${err?.message}`, progress: 100 });
          }
        }

        // ── Cross-target relationship analysis: find common PDB structures ──
        // Disable per-target remapping — these final stages use the reserved
        // 97..100% range directly.
        _batchIdx = null;
        emit({ stage: 'cross-analysis', level: 'info', message: `分析 ${batchResults.length} 个靶点的共有结构与相关性…`, progress: 97 });
        // IMPORTANT: batchResults[0].pdbDetails is a REFERENCE to the primary
        // target's pdbDetails array. Do NOT clear pdbDetails until after
        // allPdbSets has extracted the IDs, otherwise batchResults[0] will
        // have 0 PDBs and common-structure detection breaks.
        const allPdbSets = batchResults.map(r => ({ uniprot: r.uniprot, proteinName: r.uniprotInfo?.proteinName, pdbIds: new Set<string>((r.pdbDetails || []).map((e: PdbEntryDetail) => e.pdbId)) }));
        // Log per-target PDB counts so the user can verify all targets
        // contributed to cross-analysis.
        for (let i = 0; i < batchResults.length; i++) {
          const cnt = (batchResults[i].pdbDetails || []).length;
          emit({ stage: 'cross-analysis', level: 'info', message: `  · 靶点 ${i + 1} ${batchResults[i].uniprot}: ${cnt} 个 PDB 结构`, progress: 97 });
        }
        // Now safe to free the primary target's array.
        pdbDetails.length = 0;
        if (typeof global.gc === 'function') { try { global.gc(); } catch { /* ignore */ } }
        // Find PDB IDs present in ALL targets
        const commonPdbIds = allPdbSets.length > 0
          ? [...allPdbSets[0].pdbIds].filter(id => allPdbSets.every(s => s.pdbIds.has(id)))
          : [];
        // Find PDB IDs shared by at least 2 targets (pairwise overlap)
        const pdbOverlap: Record<string, string[]> = {};
        for (let a = 0; a < allPdbSets.length; a++) {
          for (let b = a + 1; b < allPdbSets.length; b++) {
            const shared = [...allPdbSets[a].pdbIds].filter(id => allPdbSets[b].pdbIds.has(id));
            if (shared.length > 0) {
              pdbOverlap[`${allPdbSets[a].uniprot}↔${allPdbSets[b].uniprot}`] = shared;
            }
          }
        }
        emit({ stage: 'cross-analysis', level: commonPdbIds.length > 0 ? 'success' : 'info', message: `共有结构（全部靶点）：${commonPdbIds.length} 个${commonPdbIds.length > 0 ? ` (${commonPdbIds.slice(0, 5).join(', ')}…)` : ''} · 两两重叠：${Object.keys(pdbOverlap).length} 对`, progress: 97 });

        // ── Generate cross-target relationship LLM report ──
        let crossReport: any = undefined;
        if (generateReport) {
          emit({ stage: 'cross-llm', level: 'info', message: `生成靶点间相关性 LLM 分析报告…`, progress: 98 });
          try {
            const crossSysPrompt = '你是结构生物学领域的资深研究员。请用中文生成一份靶点间相关性分析报告，使用 Markdown 格式。分析多个蛋白靶点之间的结构关联性、功能关系、以及共有的结构基础。';
            const targetSummary = batchResults.map((r, i) => {
              const top5 = (r.pdbDetails || []).slice(0, 5).map((e: PdbEntryDetail) => `  - ${e.pdbId}: ${e.method} | ${e.resolution != null ? e.resolution.toFixed(1) + 'Å' : 'N/A'} | ${(e.title || '').slice(0, 50)}`).join('\n');
              const s = r.scores as any;
              return `靶点 ${i + 1}: ${r.uniprot} (${r.uniprotInfo?.proteinName})\n  PDB 结构数: ${(r.pdbDetails || []).length}\n  评分: overall=${s?.overall?.score || '?'}/10 (X-ray=${s?.xray?.score || '?'}/${s?.xray?.structures || 0}条, Cryo-EM=${s?.cryoem?.score || '?'}/${s?.cryoem?.structures || 0}条, NMR=${s?.nmr?.score || '?'}/${s?.nmr?.structures || 0}条)\n  代表性结构:\n${top5}`;
            }).join('\n\n');
            const overlapSummary = Object.entries(pdbOverlap).length > 0
              ? Object.entries(pdbOverlap).map(([pair, ids]) => {
                  const idDetails = ids.slice(0, 10).map(id => {
                    const det = batchResults.flatMap(r => r.pdbDetails || []).find(e => e.pdbId === id);
                    return `  - ${id}: ${det?.method || 'N/A'} | ${det?.resolution != null ? det.resolution.toFixed(1) + 'Å' : 'N/A'} | ${(det?.title || '').slice(0, 60)}`;
                  }).join('\n');
                  return `${pair}: ${ids.length} 个共有结构\n${idDetails}`;
                }).join('\n')
              : '无两两共有结构';
            // Aggregate literature from ALL batch targets (cap at maxLitCount total, IF desc).
            const allBatchPdbs: PdbEntryDetail[] = batchResults.flatMap((r) => r.pdbDetails || []);
            // Round 52: Backfill PubMed before building cross-batch literature info
            await backfillPubMedArticles(allBatchPdbs, emit);
            const crossLit = await buildLiteratureInfo(allBatchPdbs, maxLitCount);
            const crossLitBlock = crossLit.count > 0
              ? `\n\n相关 PubMed 文献（聚合全部 ${batchResults.length} 个靶点，共 ${crossLit.count} 篇，按 IF 降序）：\n${crossLit.text}`
              : '\n\n（无 PubMed 文献数据）';
            const commonPdbDetails = commonPdbIds.length > 0
              ? commonPdbIds.slice(0, 15).map(id => {
                  const det = batchResults.flatMap(r => r.pdbDetails || []).find(e => e.pdbId === id);
                  return `  - ${id}: ${det?.method || 'N/A'} | ${det?.resolution != null ? det.resolution.toFixed(1) + 'Å' : 'N/A'} | ${det?.journal || 'N/A'} (${det?.journalIf != null ? det.journalIf.toFixed(1) : 'N/A'}) | ${(det?.title || '').slice(0, 60)}`;
                }).join('\n')
              : '（无共有结构）';

            const crossUserPrompt = `请分析以下 ${batchResults.length} 个蛋白靶点的结构相关性与功能关系：

${targetSummary}

共有结构分析：
- 全部靶点共有的结构: ${commonPdbIds.length} 个
${commonPdbDetails}
- 两两重叠:
${overlapSummary}${crossLitBlock}

请按以下结构生成报告：
## 靶点间相关性分析报告

### 一、靶点概览
（简述每个靶点的蛋白名称、PDB 结构数量、评分）

### 二、共有结构分析
（分析共有 PDB 结构的含义 — 这些结构可能揭示靶点间的进化关系或功能关联）

### 三、功能与通路关联
（基于蛋白名称和结构信息，分析靶点是否在同一信号通路、蛋白家族或功能网络中）

### 四、结构相似性推断
（从共有结构推断靶点间的结构相似性，讨论对药物设计或交叉研究的意义）

### 五、文献综合
（结合相关文献区块中的 PMID 列表，简述跨靶点文献证据，引用 PMID 编号）

### 六、总结与建议
（总结靶点间关系，提出后续研究建议）`;
             // Batch cross-report: 8000 chars — covers summary + per-pair
            // comparison + table for 2-4 batch targets without truncation.
            const r = await generateText(crossSysPrompt, crossUserPrompt, { maxChars: 8000, llm: body.llm });
            crossReport = { ok: r.ok, content: r.content, provider: r.provider, model: r.model, durationMs: r.durationMs, contentChars: r.content?.length || 0, commonPdbIds, pdbOverlap, literatureCount: crossLit.count };
            if (r.ok) emit({ stage: 'cross-llm', level: 'success', message: `✓ 相关性分析报告已生成 · ${crossReport.contentChars} chars · ${(r.durationMs / 1000).toFixed(1)}s · ${r.provider}/${r.model}${crossLit.count > 0 ? ` · 附 ${crossLit.count} 篇文献` : ''}`, progress: 99 });
            else emit({ stage: 'cross-llm', level: 'error', message: `✗ 相关性分析 LLM 失败：${r.error}`, progress: 99 });
          } catch (err: any) {
            emit({ stage: 'cross-llm', level: 'error', message: `✗ 相关性分析失败：${err?.message}`, progress: 99 });
          }
        }

        // Write batch record to EvaluationBatch + SkillRunRecord
        const batchTitle = `Batch: ${batchResults.map(r => r.uniprot).join(' + ')}`;
        const commonPdbIdsJson = JSON.stringify(commonPdbIds);
        const crossReportContent = crossReport?.ok ? crossReport.content : null;
        try {
          // Generate a batchId (cuid-style) since SQLite default doesn't apply with raw insert
          const batchId = 'batch-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
          // Create EvaluationBatch with cross-report + common PDB IDs
          await db.$executeRaw`INSERT INTO EvaluationBatch (batchId, title, combinedReport, commonPdbIds, crossReportOk, crossReportProvider, crossReportModel, crossReportDurationMs, crossReportChars, targetCount, createdAt, updatedAt) VALUES (${batchId}, ${batchTitle}, ${crossReportContent}, ${commonPdbIdsJson}, ${crossReport?.ok ?? false}, ${crossReport?.provider || null}, ${crossReport?.model || null}, ${crossReport?.durationMs || 0}, ${crossReport?.contentChars || 0}, ${batchResults.length}, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`;
          // Link all evaluations to this batch
          for (const r of batchResults) {
            try { await db.$executeRaw`UPDATE Evaluation SET batchId = ${batchId} WHERE uniprotId = ${r.uniprot}`; } catch {}
          }
          (result as any).batchId = batchId;
          emit({ stage: 'batch-db', level: 'success', message: `✓ Batch 记录已写入 EvaluationBatch (${batchId}) · 关联 ${batchResults.length} 个靶点`, progress: 100 });
        } catch (err: any) {
          emit({ stage: 'batch-db', level: 'error', message: `Batch 记录写入失败：${err?.message}`, progress: 100 });
        }
        try {
          // Raw SQL insert (see comment at the single-target path above).
          const _msrrId = `eval_batch_${Date.now()}`;
          const _msrrSummary = `Batch 评估 ${batchResults.length} 靶点 (${batchResults.map(r => r.uniprot).join(', ')}) · 共有结构 ${commonPdbIds.length} · ${crossReport?.ok ? 'LLM ✓' : 'LLM ✗'}`;
          const _msrrDetails = JSON.stringify({ targets: batchResults.map(r => r.uniprot), commonPdbIds, pdbOverlap, crossReportOk: crossReport?.ok, cached: batchResults.filter(r => r.cached).length });
          const _msrrProvider = body.llm?.provider || 'auto';
          const _msrrModel = crossReport?.model || '';
          const _msrrLlmOk = crossReport?.ok ? 1 : 0;
          const _msrrDurationMs = Date.now() - t0;
          const _msrrResultJson = JSON.stringify({ batchResults: batchResults.map(r => ({ uniprot: r.uniprot, pdbCount: r.pdbDetails?.length || 0, overall: r.scores?.overall?.score, cached: r.cached })), commonPdbIds, crossReportChars: crossReport?.contentChars || 0 });
          const _msrrLog = _log.join('\n');
          await db.$executeRaw`INSERT INTO SkillRunRecord (id, module, status, summary, details, provider, model, llmOk, llmFallback, llmError, durationMs, resultJson, log, createdAt) VALUES (${_msrrId}, 'eval', 'success', ${_msrrSummary}, ${_msrrDetails}, ${_msrrProvider}, ${_msrrModel}, ${_msrrLlmOk}, 0, null, ${_msrrDurationMs}, ${_msrrResultJson}, ${_msrrLog}, CURRENT_TIMESTAMP)`;
        } catch { /* ignore — telemetry only */ }

        (result as any).batchResults = batchResults.map(r => ({
          uniprot: r.uniprot,
          proteinName: r.uniprotInfo?.proteinName,
          pdbCount: r.pdbDetails?.length || 0,
          overall: r.scores?.overall?.score,
          cached: r.cached,
          // Surface the individual LLM report so the Run Center can render
          // an LLMPreview card per batch target after execution.
          report: r.report
            ? {
                ok: !!r.report.ok,
                content: r.report.content || '',
                provider: r.report.provider || '',
                model: r.report.model || '',
                durationMs: r.report.durationMs || 0,
                contentChars: r.report.contentChars || 0,
                cached: !!r.report.cached,
                error: r.report.error,
              }
            : undefined,
        }));
        (result as any).crossAnalysis = { commonPdbIds, pdbOverlap, crossReport };
        emit({ stage: 'batch-done', level: 'success', message: `Batch 完成 · ${batchResults.length} 靶点 (${batchResults.filter(r => r.cached).length} 缓存) · 共有结构 ${commonPdbIds.length} · ${crossReport?.ok ? '相关性报告 ✓' : '相关性报告 ✗'} · ${((Date.now() - t0) / 1000).toFixed(1)}s`, progress: 100 });
      }

      await sleep(150);
      done(result);
    } catch (err: any) {
      // Last-resort error emit so SSE stream terminates cleanly.
      emit({ stage: 'error', level: 'error', message: `✗ 未捕获异常：${err?.message || String(err)}`, progress: 100 });
      await sleep(50);
      done({ ok: false, error: err?.message || String(err), uniprot });
    }
  })();
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' } });
}


function labelOf(k: ReportChapterKey): string {
  return ({
    summary:           '执行摘要',
    function:          '蛋白功能与生物学背景',
    topology:          '序列与拓扑结构',
    pdb_analysis:      '现有 PDB 结构分析',
    structure_analysis:'结构活性位点分析',
    feasibility:       '结构解析可行性评估',
    experimental:      '实验方案',
    references:        '重要参考文献',
    conclusion:        '总结',
  } as Record<ReportChapterKey, string>)[k];
}
