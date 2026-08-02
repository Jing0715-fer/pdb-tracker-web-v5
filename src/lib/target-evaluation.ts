/**
 * Protein target evaluation — faithful port of the `protein-target-evaluator`
 * skill workflow.
 *
 *   1. UniProt REST API → protein metadata + canonical sequence
 *   2. RCSB REST API → all PDB structures associated with that UniProt ID
 *      (via the polymer instance / UniProt cross-ref), enriched with method,
 *      resolution, ligands, journal, journal IF.
 *   3. EBI SIFTS → sequence coverage calculation
 *   4. NCBI BLASTp (online via the BLAST REST API) → homolog PDB hits,
 *      filtered to remove ones already in the direct list. Re-enriched via
 *      RCSB PDBe.
 *   5. Scoring — feasibility scores for X-ray / Cryo-EM / NMR based on
 *      structure quality + BLAST identity boost.
 *   6. Persist everything to Evaluation / EvaluationPdbStructure /
 *      EvaluationBlastResult.
 *
 * Notes on dependencies: this module only uses fetch + a tiny XML parser for
 * BLAST. We do NOT depend on Biopython or any CLI binary at runtime, so it
 * runs inside the Next.js serverless / Node process.
 */

import { db } from './db';
import { safeJsonParse } from './utils';
import { llmComplete, LlmConfig } from './llm';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface EvaluationScores {
  xray: { score: number; maxScore: number; rating: string };
  cryoem: { score: number; maxScore: number; rating: string };
  nmr: { score: number; maxScore: number; rating: string };
  overall: { score: number; maxScore: number; rating: string };
}

export interface EvaluationRunOptions {
  /** UniProt accession, e.g. 'P00533' */
  uniprot: string;
  /** Force BLAST even if direct PDB coverage is sufficient. */
  forceBlast?: boolean;
  /** Skip the BLAST step entirely (faster, lower coverage). */
  skipBlast?: boolean;
  /** Cap on direct PDB detail fetches. Default 80 — enough to surface the
   *  high-resolution / ligand-bound structures without spending 50s on a
   *  single 388-PDB target like EGFR. Set to Infinity for "all of them". */
  maxPdb?: number;
  /** LLM config — used for both the run (none currently) and the optional
   *  downstream LLM-feasibility report. */
  llm?: LlmConfig;
  /** When true (default), run the LLM-generated feasibility report as the
   *  second stage of the same atomic task. Set to false to skip it and
   *  just do data-collection + scoring. */
  generateReport?: boolean;
  /** When true (default), write the LLM report to:
   *  /Users/lijing/Documents/my_note/LLM-Wiki/wiki/evaluations/{uid}_{name}_结构可行性评估.md */
  saveReportFile?: boolean;
  /** Optional: coarse progress callback. */
  onStage?: (stage: string, detail?: string) => void;
}

export interface EvaluationReportSubResult {
  ok: boolean;
  filename?: string;
  savedToFile: boolean;
  content?: string;
  durationMs: number;
  provider?: string;
  model?: string;
  error?: string;
}

export interface EvaluationRunResult {
  ok: boolean;
  uniprot: string;
  uniprotInfo?: {
    uniprotId: string;
    entryName: string;
    proteinName: string;
    geneNames: string;
    organism: string;
    sequenceLength: number;
  };
  directPdbCount: number;
  blastHitCount: number;
  coverage: number;
  scores: EvaluationScores;
  skippedBblast?: boolean;
  durationMs: number;
  /** When `generateReport` is enabled (default), this carries the second-stage
   *  LLM-feasibility-report sub-result. `undefined` if report was skipped. */
  report?: EvaluationReportSubResult;
  error?: string;
}

// ─── UniProt ──────────────────────────────────────────────────────────────────

interface UniProtInfo {
  uniprotId: string;
  entryName: string;
  proteinName: string;
  geneNames: string;
  organism: string;
  sequenceLength: number;
  sequence: string;
}

async function fetchUniProt(uniprotId: string): Promise<UniProtInfo> {
  const url = `https://rest.uniprot.org/uniprotkb/${encodeURIComponent(uniprotId)}?format=json&fields=id,accession,protein_name,gene_names,organism_name,length,sequence,sequence_version,cc_subcellular_location`;
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`UniProt ${res.status} for ${uniprotId}`);
  const json: any = await res.json();
  // The /uniprotkb endpoint returns either an array (list) or single object
  const entry = Array.isArray(json) ? json[0] : json.results?.[0] || json;
  if (!entry) throw new Error(`UniProt ${uniprotId}: empty response`);

  const accession = entry.primaryAccession || entry.accession || uniprotId;
  const entryName = entry.uniProtkbId || entry.id || uniprotId;
  const proteinName =
    entry.proteinDescription?.recommendedName?.fullName?.value
    || entry.proteinDescription?.submissionNames?.[0]?.fullName?.value
    || entry.protein_name
    || 'Unknown';
  const geneNames = (entry.genes?.[0]?.geneName?.value || entry.gene_names || '').toString();
  const organism = entry.organism?.scientificName || entry.organism_name || 'Unknown';
  const length = parseInt(entry.sequenceLength || entry.length || entry.sequence?.length || '0', 10);
  const sequence = entry.sequence?.value || entry.sequence || '';

  return {
    uniprotId: accession,
    entryName,
    proteinName,
    geneNames,
    organism,
    sequenceLength: length,
    sequence,
  };
}

// ─── RCSB direct PDB lookup ───────────────────────────────────────────────────

interface PdbEntry {
  pdbId: string;
  method: string | null;
  resolution: number | null;
  title: string | null;
  releaseDate: string | null;
  ligand: string | null;
  journal: string | null;
  journalIf: number | null;
  doi: string | null;
  pubmedId: string | null;
  organism: string | null;
  authors: string | null;
  isCryoem: boolean;
  isXray: boolean;
  isNmr: boolean;
}

async function fetchRcsbByUniProt(uniprotId: string, maxPdb = 80): Promise<PdbEntry[]> {
  // Polymer instance search via UniProt cross-ref. We use POST because the
  // query body can exceed safe GET URL length and some intermediaries
  // (including Next dev's internal fetch) silently truncate long URLs.
  const queryBody = {
    query: {
      type: 'terminal',
      service: 'text',
      parameters: {
        attribute: 'rcsb_polymer_entity_container_identifiers.reference_sequence_identifiers.database_accession',
        operator: 'exact_match',
        value: uniprotId,
      },
    },
    return_type: 'polymer_entity',
    request_options: { paginate: { start: 0, rows: Math.min(500, maxPdb * 3) } },
  };
  let ids: string[] = [];
  try {
    const r = await fetch('https://search.rcsb.org/rcsbsearch/v2/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(queryBody),
      signal: AbortSignal.timeout(45_000),
    });
    if (r.ok) {
      const j: any = await r.json();
      // RCSB polymer_entity.identifier is `{PDB_ID}_{ENTITY_ID}` (e.g. "1IVO_1").
      // We split on `_` and take the first 4-char PDB id.
      ids = (j.result_set || [])
        .map((x: any) => {
          const id = (x.identifier as string) || '';
          // Strip the "_<entity>" suffix, then strip any chain/instance suffix.
          const base = id.split('_')[0];
          return base.toUpperCase();
        })
        .filter((s: string) => /^[0-9][A-Za-z0-9]{3}$/.test(s));
      ids = Array.from(new Set(ids));
    } else {
      console.warn(`[target-eval] RCSB search returned ${r.status}`);
    }
  } catch (e: any) {
    console.warn(`[target-eval] RCSB search failed: ${e?.message}`);
  }

  if (ids.length === 0) {
    // Fallback: use the UniProt → PDB ID mapping via EBI SIFTS.
    // `dbReferences` is a mixed list (PDB / EMBL / DOI / GO / ...). We must
    // filter to type === 'PDB' to avoid picking up EMBL accessions that
    // happen to be 6-char alphanum and would pass the uppercase-uniq step.
    try {
      const siftsRes = await fetch(
        `https://www.ebi.ac.uk/proteins/api/proteins/${encodeURIComponent(uniprotId)}?cross_references=true`,
        { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) },
      );
      if (siftsRes.ok) {
        const s: any = await siftsRes.json();
        const refs: any[] = s?.dbReferences || [];
        ids = Array.from(new Set(
          refs
            .filter((r: any) => r?.type === 'PDB')
            .map((r: any) => (r.id || '').toString())
            .filter(s => /^[0-9][A-Za-z0-9]{3}$/.test(s))
            .map((s: string) => s.toUpperCase()),
        ));
      }
    } catch {/* ignore */ }
  }

  console.log(`[target-eval] ${uniprotId}: ${ids.length} direct PDB ids (sample: ${ids.slice(0, 5).join(',')})`);
  if (ids.length === 0) return [];

  // Per-entry detail fetch. We do these in parallel with a small concurrency
  // cap (8) because (a) the comma-separated batch endpoint returns 404 when
  // ANY id in the batch is obsolete, which is common for a long history
  // like EGFR's 388 entries; (b) parallel fetches finish much faster than
  // serial. We give up to 2 min total.
  const detailIds = ids.slice(0, maxPdb);
  const details: any[] = [];
  const CONCURRENCY = 8;
  let nextIdx = 0;
  async function worker() {
    while (nextIdx < detailIds.length) {
      const i = nextIdx++;
      const pdbId = detailIds[i];
      try {
        const r = await fetch(`https://data.rcsb.org/rest/v1/core/entry/${pdbId}`, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(15_000),
        });
        if (r.ok) {
          const d = await r.json();
          if (d) details.push(d);
        }
      } catch {/* skip this id */}
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, detailIds.length) }, () => worker()));

  const entries: PdbEntry[] = [];
  for (const d of details) {
    if (!d?.rcsb_entry_info?.polymer_entity_count) continue;
    const pdbId = d.rcsb_entry_container_identifiers?.entry_id || d.entry?.id;
    if (!pdbId) continue;

    const exptlMethod = (d.exptl?.[0]?.method || d.rcsb_entry_info?.experimental_method?.[0] || '').toString();
    const method = exptlMethod || null;

    // Resolution can be in rcsb_entry_info or in refine / diffrn details
    let resolution: number | null = null;
    const resStr = d.rcsb_entry_info?.resolution_combined?.[0]
      ?? d.refine?.[0]?.ls_d_res_high
      ?? d.em_3d_reconstruction?.resolution
      ?? null;
    if (typeof resStr === 'number') resolution = resStr;
    else if (typeof resStr === 'string') {
      const n = parseFloat(resStr);
      if (!Number.isNaN(n)) resolution = n;
    }

    const title = (d.struct?.title || d.rcsb_entry_info?.title || '').toString() || null;
    const releaseDate = d.rcsb_accession_info?.initial_release_date?.[0]
      || d.rcsb_accession_info?.release_date?.[0]
      || null;

    // Ligand info: first entity with non-polymer type
    let ligand: string | null = null;
    const entities = d.rcsb_entry_container_identifiers?.polymer_entity_ids || [];
    // We don't fetch entity details in batch (would multiply API calls). Use
    // the cell / assembly info as a quick proxy.
    if (d.rcsb_entry_info?.polymer_entity_count_protein > 0) {
      // try to peek into nonpolymer entities via a quick rcsb_entry_info
    }
    if (d.rcsb_entry_info?.deposited_polymer_entity_instance_count > 0) {
      // no-op; the ligand field will be filled by the per-entry enrichment
    }

    const journal = (d.citation?.[0]?.pdbx_database_id_PubMed?.title
      || d.citation?.[0]?.journal_abbrev
      || d.audit_author?.name || '') || null;
    const doi = (d.citation?.[0]?.pdbx_database_id_DOI || null);
    const pubmedId = (d.citation?.[0]?.pdbx_database_id_PubMed?.id || null)?.toString() || null;
    const organism = d.rcsb_entry_info?.source_taxonomy?.[0]?.scientific_name || null;
    const authors = (d.audit_author || []).slice(0, 10).map((a: any) => a.name).filter(Boolean).join(', ') || null;

    const isCryoem = /cryo|electron microscopy/i.test(method || '');
    const isXray = /x-ray|x ray|x-ray diffraction/i.test(method || '');
    const isNmr = /nmr|nuclear magnetic/i.test(method || '');

    // IF lookup via the journal-if-map (loaded lazily)
    let journalIf: number | null = null;
    try {
      const { matchJournalIf, buildJournalLookup } = await import('./journal-matching');
      // The matcher needs a built lookup; buildJournalLookup reads from
      // PdbStructure.journalIf. We use a minimal one-off here: scan for the
      // journal name. Performance is fine for the 1-50 row scale.
      const { journalIfMap, pdbJournals } = buildJournalLookup(
        ((await db.$queryRaw<any[]>`
          SELECT DISTINCT journal, journalIf
          FROM PdbStructure
          WHERE journalIf IS NOT NULL AND journalIf > 0
        `) as any[]).map((r: any) => ({ journal: r.journal, journalIf: r.journalIf })),
      );
      if (journal) {
        const m = matchJournalIf(journal, journalIfMap, pdbJournals);
        journalIf = typeof m === 'number' ? m : null;
      }
    } catch {/* ignore */}

    entries.push({
      pdbId: pdbId.toUpperCase(),
      method,
      resolution,
      title,
      releaseDate,
      ligand,
      journal,
      journalIf,
      doi,
      pubmedId,
      organism,
      authors,
      isCryoem,
      isXray,
      isNmr,
    });
  }

  return entries;
}

// ─── BLAST via NCBI REST ──────────────────────────────────────────────────────

interface BlastHit {
  pdbId: string;
  uniprotRef: string;
  description: string;
  identity: number;
  evalue: string;
  queryCoverage: number;
  targetCoverage?: number;
  taxonomyId?: string;
}

async function runBlast(sequence: string, maxHits = 20): Promise<BlastHit[]> {
  if (!sequence || sequence.length < 30) return [];

  // Submit BLAST job
  const submitUrl = 'https://blast.ncbi.nlm.nih.gov/blast/Blast.cgi';
  const submitBody = new URLSearchParams({
    CMD: 'Put',
    PROGRAM: 'blastp',
    DATABASE: 'pdbaa',
    QUERY: sequence,
    HITLIST_SIZE: String(maxHits),
    EXPECT: '1e-5',
    FILTER: 'F',
  });
  const submitRes = await fetch(submitUrl, {
    method: 'POST',
    body: submitBody,
    signal: AbortSignal.timeout(30_000),
  });
  if (!submitRes.ok) throw new Error(`BLAST submit ${submitRes.status}`);
  const submitText = await submitRes.text();
  const ridMatch = submitText.match(/RID\s*=\s*(\S+)/);
  const rtoeMatch = submitText.match(/RTOE\s*=\s*(\d+)/);
  if (!ridMatch) throw new Error('BLAST submit: no RID returned');
  const rid = ridMatch[1];
  const rtoe = parseInt(rtoeMatch?.[1] || '10', 10);

  // Poll for completion — NO attempt cap. NCBI queue times vary wildly;
  // the previous 30-attempt cap (~5 min) aborted legitimate long-running
  // jobs. We poll until the result is ready, the RID expires (Status=
  // UNKNOWN), or NCBI reports a hard failure (Status=FAILED). Progress
  // is not surfaced here because this code path runs without an
  // onProgress callback; the caller (evaluateTarget) reports status
  // independently.
  let attempts = 0;
  const startedAt = Date.now();
  while (true) {
    await new Promise(r => setTimeout(r, Math.max(2000, rtoe * 1000)));
    attempts++;
    const elapsedSec = Math.round((Date.now() - startedAt) / 1000);
    let pollRes: Response;
    try {
      pollRes = await fetch(`${submitUrl}?CMD=Get&FORMAT_TYPE=XML&RID=${rid}`, {
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      // Transient network error — keep polling.
      continue;
    }
    if (!pollRes.ok) { continue; }
    const xml = await pollRes.text();
    if (xml.includes('<BlastOutput>') || xml.includes('<BlastOutput_iterations>')) {
      return parseBlastXml(xml);
    }
    if (xml.includes('Status=FAILED')) {
      throw new Error('BLAST job failed on NCBI side');
    }
    if (xml.includes('Status=UNKNOWN')) {
      throw new Error(`BLAST RID ${rid} unknown (expired?)`);
    }
    // Status=WAITING — keep polling. elapsedSec is computed but not logged
    // here (no onProgress hook in this code path); it exists for future use.
    void elapsedSec;
  }
}

function parseBlastXml(xml: string): BlastHit[] {
  const hits: BlastHit[] = [];
  const hitRe = /<Hit>([\s\S]*?)<\/Hit>/g;
  let m: RegExpExecArray | null;
  while ((m = hitRe.exec(xml))) {
    const h = m[1];
    const def = h.match(/<Hit_def>([\s\S]*?)<\/Hit_def>/)?.[1]?.trim() || '';
    const acc = h.match(/<Hit_accession>([\s\S]*?)<\/Hit_accession>/)?.[1]?.trim() || '';
    const len = parseInt(h.match(/<Hit_len>([\s\S]*?)<\/Hit_len>/)?.[1] || '0', 10);
    if (!acc) continue;
    // The pdb chain ID is in Hit_accession (e.g. "5HT2B_HUMAN" or a PDB chain id).
    // We keep both the accession and a parsed PDB id when possible.
    const pdbIdMatch = acc.match(/^([0-9][A-Za-z0-9]{3})([A-Za-z]?)/);

    // Identity / coverage from first HSP
    const hspRe = /<Hsp>([\s\S]*?)<\/Hsp>/g;
    const firstHsp = /<Hsp>([\s\S]*?)<\/Hsp>/.exec(h);
    if (!firstHsp) continue;
    const hsp = firstHsp[1];
    const identity = parseFloat(hsp.match(/<Hsp_identity>([\s\S]*?)<\/Hsp_identity>/)?.[1] || '0');
    const alnLen = parseInt(hsp.match(/<Hsp_align-len>([\s\S]*?)<\/Hsp_align-len>/)?.[1] || '0', 10);
    const queryCoverage = alnLen > 0 ? Math.min(100, (alnLen / Math.max(1, len)) * 100) : 0;
    const evalue = hsp.match(/<Hsp_evalue>([\s\S]*?)<\/Hsp_evalue>/)?.[1] || '0';

    hits.push({
      pdbId: pdbIdMatch?.[1]?.toUpperCase() || acc.toUpperCase(),
      uniprotRef: acc,
      description: def.replace(/<[^>]+>/g, ''),
      identity,
      evalue,
      queryCoverage,
      targetCoverage: queryCoverage,
    });
    if (hits.length >= 20) break;
  }
  return hits;
}

async function enrichBlastHits(hits: BlastHit[]): Promise<Array<BlastHit & Partial<PdbEntry>>> {
  const enriched: Array<BlastHit & Partial<PdbEntry>> = [];
  for (let i = 0; i < hits.length; i += 20) {
    const batch = hits.slice(i, i + 20);
    const ids = batch.map(h => h.pdbId).filter(Boolean);
    if (ids.length === 0) continue;
    const url = `https://data.rcsb.org/rest/v1/core/entry/${ids.join(',')}`;
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      if (!r.ok) continue;
      const j: any = await r.json();
      const map: Record<string, any> = Array.isArray(j)
        ? Object.fromEntries(j.map((e: any) => [e.rcsb_entry_container_identifiers?.entry_id || e.entry?.id, e]))
        : (typeof j === 'object' ? j : {});
      for (const hit of batch) {
        const d = map[hit.pdbId];
        if (!d) { enriched.push(hit); continue; }
        const method = d.exptl?.[0]?.method || null;
        const res = parseFloat(d.rcsb_entry_info?.resolution_combined?.[0] || d.refine?.[0]?.ls_d_res_high || '');
        const journal = d.citation?.[0]?.journal_abbrev || null;
        const isCryoem = /cryo|electron microscopy/i.test(method || '');
        const isXray = /x-ray/i.test(method || '');
        const isNmr = /nmr/i.test(method || '');
        enriched.push({
          ...hit,
          method,
          resolution: Number.isNaN(res) ? null : res,
          journal,
          title: d.struct?.title || null,
          releaseDate: d.rcsb_accession_info?.initial_release_date?.[0] || null,
          isCryoem,
          isXray,
          isNmr,
        });
      }
    } catch {/* ignore batch */ }
  }
  return enriched;
}

// ─── SIFTS coverage ───────────────────────────────────────────────────────────

async function computeSiftsCoverage(uniprotId: string, sequenceLength: number): Promise<number> {
  if (!sequenceLength) return 0;
  try {
    const url = `https://www.ebi.ac.uk/proteins/api/proteins/${encodeURIComponent(uniprotId)}?cross_references=true&features=true`;
    const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) });
    if (!r.ok) return 0;
    const j: any = await r.json();
    const features: any[] = j?.protein?.['Pdb'] || j?.features || [];
    // Compute total covered positions from any PDB region feature
    const ranges: Array<[number, number]> = [];
    for (const f of features) {
      if (f.type === 'Pdb' || f.category === 'Pdb') {
        const begin = parseInt(f.begin || f.location?.start?.value || '0', 10);
        const end = parseInt(f.end || f.location?.end?.value || '0', 10);
        if (begin && end && end > begin) ranges.push([begin, end]);
      }
    }
    if (ranges.length === 0) return 0;
    ranges.sort((a, b) => a[0] - b[0]);
    let merged: Array<[number, number]> = [ranges[0]];
    for (let i = 1; i < ranges.length; i++) {
      const last = merged[merged.length - 1];
      if (ranges[i][0] <= last[1] + 1) last[1] = Math.max(last[1], ranges[i][1]);
      else merged.push(ranges[i]);
    }
    const covered = merged.reduce((s, [a, b]) => s + (b - a + 1), 0);
    return Math.min(100, (covered / sequenceLength) * 100);
  } catch {
    return 0;
  }
}

// ─── Scoring ──────────────────────────────────────────────────────────────────

function scoreXray(opts: { length: number; hasTransmembrane: boolean; highResXray: number; glycanRich: boolean }): number {
  let s = 5;
  if (opts.length < 500) s += 2;
  else if (opts.length > 1000) s -= 1;
  if (opts.hasTransmembrane) s -= 3;
  if (opts.highResXray > 0) s += 2;
  if (opts.glycanRich) s -= 1;
  return clamp(s, 1, 10);
}

function scoreCryoem(opts: { length: number; symmetric: boolean; highResCryoem: number }): number {
  let s = 5;
  if (opts.length > 1500) s += 3;
  else if (opts.length >= 500 && opts.length <= 1500) s += 1;
  else s -= 2;
  if (opts.symmetric) s += 2;
  if (opts.highResCryoem > 0) s += 1;
  return clamp(s, 1, 10);
}

function scoreNmr(opts: { length: number; hasTransmembrane: boolean }): number {
  let s = 5;
  if (opts.length < 300) s += 3;
  else if (opts.length < 500) s += 1;
  else s -= 2;
  if (opts.hasTransmembrane) s -= 3;
  return clamp(s, 1, 10);
}

function rating(score: number): string {
  if (score >= 9) return 'Excellent';
  if (score >= 7) return 'Good';
  if (score >= 5) return 'Fair';
  return 'Poor';
}

function clamp(n: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, n));
}

function scoreAll(
  direct: PdbEntry[],
  blast: Array<BlastHit & Partial<PdbEntry>>,
  sequenceLength: number,
): EvaluationScores {
  const highResXray = direct.filter(d => d.isXray && d.resolution != null && d.resolution <= 2.5).length;
  const highResCryoem = direct.filter(d => d.isCryoem && d.resolution != null && d.resolution <= 3.0).length;
  const hasTransmembrane = false; // optional refinement; not in this build
  const symmetric = false;
  const glycanRich = direct.some(d => d.ligand && /sugar|nag|man|gal|glc|bma/i.test(d.ligand));

  const xray = scoreXray({ length: sequenceLength, hasTransmembrane, highResXray, glycanRich });
  const cryoem = scoreCryoem({ length: sequenceLength, symmetric, highResCryoem });
  const nmr = scoreNmr({ length: sequenceLength, hasTransmembrane });

  // BLAST identity boost
  const bestIdentity = blast.length > 0 ? Math.max(...blast.map(b => b.identity)) : 0;
  const boost = bestIdentity >= 80 ? 2 : bestIdentity >= 50 ? 1 : bestIdentity >= 30 ? 0 : -1;

  const xrayBoosted = clamp(xray + boost, 1, 10);
  const cryoemBoosted = clamp(cryoem + boost, 1, 10);

  const overall = Math.max(xrayBoosted, cryoemBoosted, nmr);
  return {
    xray: { score: xrayBoosted, maxScore: 10, rating: rating(xrayBoosted) },
    cryoem: { score: cryoemBoosted, maxScore: 10, rating: rating(cryoemBoosted) },
    nmr: { score: nmr, maxScore: 10, rating: rating(nmr) },
    overall: { score: overall, maxScore: 10, rating: rating(overall) },
  };
}

// ─── Persistence ──────────────────────────────────────────────────────────────

async function persistEvaluation(args: {
  info: UniProtInfo;
  direct: PdbEntry[];
  blast: Array<BlastHit & Partial<PdbEntry>>;
  coverage: number;
  scores: EvaluationScores;
}) {
  const { info, direct, blast, coverage, scores } = args;

  // Upsert evaluation row
  await db.$executeRaw`
    INSERT INTO Evaluation (
      uniprotId, entryName, proteinName, geneNames, organism,
      sequenceLength, coverage, scores, report, createdAt, updatedAt
    ) VALUES (
      ${info.uniprotId}, ${info.entryName}, ${info.proteinName}, ${info.geneNames}, ${info.organism},
      ${info.sequenceLength}, ${coverage}, ${JSON.stringify(scores)}, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
    ON CONFLICT(uniprotId) DO UPDATE SET
      entryName = excluded.entryName,
      proteinName = excluded.proteinName,
      geneNames = excluded.geneNames,
      organism = excluded.organism,
      sequenceLength = excluded.sequenceLength,
      coverage = excluded.coverage,
      scores = excluded.scores,
      updatedAt = CURRENT_TIMESTAMP
  `;

  // Replace direct PDB rows
  await db.$executeRaw`DELETE FROM EvaluationPdbStructure WHERE uniprotId = ${info.uniprotId}`;
  for (const d of direct) {
    const ifTier = d.journalIf ? (d.journalIf >= 20 ? 'top' : d.journalIf >= 10 ? 'high' : d.journalIf >= 5 ? 'mid' : 'low') : null;
    await db.$executeRaw`
      INSERT INTO EvaluationPdbStructure (
        uniprotId, pdbId, method, resolution, title,
        depositionDate, releaseDate, ligand, ligandNames,
        journal, journalIf, doi, pubmedId, organism, authors,
        isCryoem, isXray, isNmr, ifTier
      ) VALUES (
        ${info.uniprotId}, ${d.pdbId}, ${d.method}, ${d.resolution}, ${d.title ? JSON.stringify(d.title) : null},
        ${null}, ${d.releaseDate}, ${d.ligand ? JSON.stringify(d.ligand) : null}, ${null},
        ${d.journal}, ${d.journalIf}, ${d.doi}, ${d.pubmedId}, ${d.organism}, ${d.authors ? JSON.stringify(d.authors) : null},
        ${d.isCryoem}, ${d.isXray}, ${d.isNmr}, ${ifTier}
      )
    `;
  }

  // Replace BLAST rows
  await db.$executeRaw`DELETE FROM EvaluationBlastResult WHERE uniprotId = ${info.uniprotId}`;
  for (const b of blast) {
    const ifTier = (b as any).journalIf
      ? ((b as any).journalIf >= 20 ? 'top' : (b as any).journalIf >= 10 ? 'high' : (b as any).journalIf >= 5 ? 'mid' : 'low')
      : null;
    await db.$executeRaw`
      INSERT INTO EvaluationBlastResult (
        uniprotId, pdbId, uniprotRef, description, identity, evalue,
        queryCoverage, targetCoverage, method, resolution, releaseDate,
        source, taxonomyId, journal, journalIf, ifTier, ligand, title
      ) VALUES (
        ${info.uniprotId}, ${b.pdbId}, ${b.uniprotRef}, ${b.description ? JSON.stringify(b.description) : null},
        ${b.identity}, ${b.evalue}, ${b.queryCoverage}, ${b.targetCoverage ?? null},
        ${(b as any).method ?? null}, ${(b as any).resolution ?? null}, ${(b as any).releaseDate ?? null},
        'blastp-pdbaa', ${b.taxonomyId ?? null},
        ${(b as any).journal ?? null}, ${(b as any).journalIf ?? null}, ${ifTier},
        ${(b as any).ligand ?? null}, ${(b as any).title ? JSON.stringify((b as any).title) : null}
      )
    `;
  }
}

// ─── Public entry point ───────────────────────────────────────────────────────

export async function runTargetEvaluation(opts: EvaluationRunOptions): Promise<EvaluationRunResult> {
  const t0 = Date.now();
  const uniprot = opts.uniprot.trim().toUpperCase();
  const stage = opts.onStage || (() => {});
  stage('init', `uniprot=${uniprot} maxPdb=${opts.maxPdb ?? 80} forceBlast=${opts.forceBlast ?? false} skipBlast=${opts.skipBlast ?? false}`);
  if (!/^[A-Z][A-Z0-9]{5}$/.test(uniprot)) {
    return {
      ok: false,
      uniprot,
      directPdbCount: 0,
      blastHitCount: 0,
      coverage: 0,
      scores: {
        xray: { score: 0, maxScore: 10, rating: 'Unknown' },
        cryoem: { score: 0, maxScore: 10, rating: 'Unknown' },
        nmr: { score: 0, maxScore: 10, rating: 'Unknown' },
        overall: { score: 0, maxScore: 10, rating: 'Unknown' },
      },
      durationMs: Date.now() - t0,
      error: 'Invalid UniProt ID format (expected 6-char alphanum like P00533)',
    };
  }

  try {
    stage('uniprot', `fetching UniProt info for ${uniprot}`);
    const info = await fetchUniProt(uniprot);
    // RCSB direct lookup is the most important — race it against SIFTS
    // coverage so a slow SIFTS doesn't block the whole run.
    stage('pdb-lookup', `RCSB lookup + SIFTS coverage for ${uniprot}`);
    const [direct, coverage] = await Promise.all([
      fetchRcsbByUniProt(uniprot, opts.maxPdb ?? 80),
      computeSiftsCoverage(uniprot, info.sequenceLength).catch(() => 0),
    ]);
    stage('pdb-lookup-done', `direct=${direct.length} coverage=${coverage}%`);

    let blast: Array<BlastHit & Partial<PdbEntry>> = [];
    let skippedBblast = false;
    const shouldBlast = !opts.skipBlast && (opts.forceBlast || direct.length < 5 || coverage < 50);
    if (shouldBlast) {
      stage('blast', 'running BLAST…');
      try {
        const raw = await runBlast(info.sequence);
        // Filter out hits already in direct
        const directSet = new Set(direct.map(d => d.pdbId));
        const filtered = raw.filter(h => !directSet.has(h.pdbId));
        blast = await enrichBlastHits(filtered);
      } catch (e: any) {
        console.warn('[target-eval] BLAST failed:', e?.message);
        skippedBblast = true;
      }
      stage('blast-done', `blastHits=${blast.length} skipped=${skippedBblast}`);
    } else {
      skippedBblast = true;
    }

    stage('score', 'scoring…');
    const scores = scoreAll(direct, blast, info.sequenceLength);
    stage('score-done', `overall=${scores.overall.score}/${scores.overall.maxScore} rating=${scores.overall.rating}`);
    await persistEvaluation({ info, direct, blast, coverage, scores });

    const result: EvaluationRunResult = {
      ok: true,
      uniprot: info.uniprotId,
      uniprotInfo: {
        uniprotId: info.uniprotId,
        entryName: info.entryName,
        proteinName: info.proteinName,
        geneNames: info.geneNames,
        organism: info.organism,
        sequenceLength: info.sequenceLength,
      },
      directPdbCount: direct.length,
      blastHitCount: blast.length,
      coverage: Math.round(coverage * 100) / 100,
      scores,
      skippedBblast,
      durationMs: Date.now() - t0,
    };

    // Stage 2 (atomic): LLM feasibility report. Default on — this is the
    // single-task workflow the user asked for: "evaluation + report in one
    // run". Set opts.generateReport === false to skip.
    if (opts.generateReport !== false) {
      stage('llm-report', `generating feasibility report for ${uniprot}`);
      try {
        const r = await generateEvaluationReport({
          uniprot: info.uniprotId,
          saveToFile: opts.saveReportFile !== false,
          llm: opts.llm,
        });
        result.report = {
          ok: r.ok,
          filename: r.filename,
          savedToFile: r.savedToFile,
          content: r.content,
          durationMs: r.meta.durationMs,
          provider: r.meta.provider,
          model: r.meta.model,
          error: r.error,
        };
      } catch (e: any) {
        // Don't fail the whole task if the LLM report step errors — eval data
        // is already saved. Surface the error in `report`.
        result.report = {
          ok: false,
          savedToFile: false,
          durationMs: 0,
          error: e?.message || String(e),
        };
      }
    }

    return result;
  } catch (e: any) {
    return {
      ok: false,
      uniprot,
      directPdbCount: 0,
      blastHitCount: 0,
      coverage: 0,
      scores: {
        xray: { score: 0, maxScore: 10, rating: 'Unknown' },
        cryoem: { score: 0, maxScore: 10, rating: 'Unknown' },
        nmr: { score: 0, maxScore: 10, rating: 'Unknown' },
        overall: { score: 0, maxScore: 10, rating: 'Unknown' },
      },
      durationMs: Date.now() - t0,
      error: e?.message || String(e),
    };
  }
}

// ─── LLM report generation (Module 3) ─────────────────────────────────────────

export interface ReportRunOptions {
  uniprot: string;
  llm?: LlmConfig;
  /** Also save to /Users/lijing/Documents/my_note/LLM-Wiki/wiki/evaluations/ */
  saveToFile?: boolean;
}

export interface ReportRunResult {
  ok: boolean;
  uniprot: string;
  filename?: string;
  savedToFile: boolean;
  content: string;
  meta: { provider: string; model: string; durationMs: number };
  error?: string;
}

const REPORT_DIR = '/Users/lijing/Documents/my_note/LLM-Wiki/wiki/evaluations';

export async function generateEvaluationReport(opts: ReportRunOptions): Promise<ReportRunResult> {
  const uniprot = opts.uniprot.trim().toUpperCase();
  const rows = await db.$queryRawUnsafe<any[]>(`SELECT * FROM Evaluation WHERE uniprotId = ?`, uniprot);
  if (!rows || rows.length === 0) {
    return {
      ok: false,
      uniprot,
      savedToFile: false,
      content: '',
      meta: { provider: 'none', model: 'none', durationMs: 0 },
      error: `Evaluation not found for ${uniprot}. Run the evaluation first.`,
    };
  }
  const eval_ = rows[0];
  const pdb = await db.$queryRawUnsafe<any[]>(`SELECT * FROM EvaluationPdbStructure WHERE uniprotId = ? ORDER BY resolution ASC`, uniprot);
  const blast = await db.$queryRawUnsafe<any[]>(`SELECT * FROM EvaluationBlastResult WHERE uniprotId = ? ORDER BY identity DESC`, uniprot);

  const scores = eval_.scores ? JSON.parse(eval_.scores) : {};

  // Build prompt
  const pdbTable = (pdb as any[]).slice(0, 10).map(p =>
    `| ${p.pdbId} | ${p.method || ''} | ${p.resolution ?? 'N/A'} | ${p.journal || ''} (IF ${p.journalIf ?? '—'}) | ${p.title || ''} |`,
  ).join('\n');
  const blastTable = (blast as any[]).slice(0, 10).map(b =>
    `| ${b.pdbId} | ${b.uniprotRef || ''} | ${b.identity?.toFixed?.(1) ?? b.identity}% | ${b.evalue} | ${b.description || ''} |`,
  ).join('\n');

  const system = `You are a structural biology expert generating a feasibility report for a protein target. Output in Chinese, follow the markdown template strictly, no emoji in headings/tables.`;
  const prompt = `Generate a Chinese protein structure feasibility report for:

UniProt: ${uniprot}
Entry: ${eval_.entryName}
Protein: ${eval_.proteinName}
Gene: ${eval_.geneNames}
Organism: ${eval_.organism}
Sequence length: ${eval_.sequenceLength} aa
Coverage: ${eval_.coverage?.toFixed?.(2) ?? eval_.coverage}%
Direct PDB count: ${(pdb as any[]).length}
BLAST hit count: ${(blast as any[]).length}

Scores (1-10):
- X-ray: ${scores.xray?.score} (${scores.xray?.rating})
- Cryo-EM: ${scores.cryoem?.score} (${scores.cryoem?.rating})
- NMR: ${scores.nmr?.score} (${scores.nmr?.rating})
- Overall: ${scores.overall?.score} (${scores.overall?.rating})

Top direct PDB structures:
| PDB | Method | Resolution (Å) | Journal (IF) | Title |
|-----|--------|----------------|--------------|-------|
${pdbTable}

Top BLAST homologs:
| PDB | Subject | Identity | E-value | Description |
|-----|---------|----------|---------|-------------|
${blastTable}

Output strictly in this markdown structure (Chinese):

---
title: 蛋白结构解析可行性评估报告
created: ${new Date().toISOString().slice(0, 10)}
updated: ${new Date().toISOString().slice(0, 10)}
type: evaluation
tags: []
sources: []
---

# 蛋白结构解析可行性评估报告

**蛋白名称:** ${eval_.proteinName}
**UniProt ID:** ${uniprot} (${eval_.entryName})
**基因名称:** ${eval_.geneNames}
**物种:** ${eval_.organism}
**序列长度:** ${eval_.sequenceLength} 氨基酸
**报告生成日期:** ${new Date().toISOString().slice(0, 10)}

---

## 执行摘要

(2-4 段：蛋白功能 + 关键发现 + 推荐方向)

| 评估项目 | 结果 |
|---------|------|
| 蛋白类型 | (基于序列特征推断) |
| 序列长度 | ${eval_.sequenceLength} aa |
| 已有结构覆盖 | ${(pdb as any[]).length} 个直接 PDB，${(blast as any[]).length} 个 BLAST 同源 |
| 推荐结构解析方法 | (基于评分给出) |

## 1. 蛋白功能与生物学背景

### 1.1 基本功能
### 1.2 调控机制
### 1.3 疾病关联
(基于蛋白名称和物种推断;无信息则说"暂无可靠数据")

## 2. 序列与拓扑结构

### 2.1 拓扑模型
(简短的拓扑描述;如膜蛋白/球状/酶)
### 2.2 结构域解析
(基于 UniProt 注释;无信息时简略)

## 3. 现有 PDB 结构分析

### 3.1 结构生物学里程碑
(挑 3-5 个重要 PDB 列出)
### 3.2 代表性 PDB 结构
(基于上面 PDB 表生成)
### 3.3 研究空白与发表机会
(3 个具体方向)

## 4. 结构解析可行性评估

### 4.1 方法比较
| 评估维度 | Cryo-EM | X-ray 结晶 | NMR |
|---------|---------|-----------|-----|
| 分子量适配性 | | | |
| 构象异质性处理 | | | |
| 已有成功先例 | | | |
| 总体评分 | ${scores.cryoem?.score}/10 | ${scores.xray?.score}/10 | ${scores.nmr?.score}/10 |

### 4.2 综合结论
(2-3 段:推荐方法 + 理由 + 备选方案)

## 5. 实验方案（可选）

### 5.1 构建设计
### 5.2 表达与样品制备流程
### 5.3 时间规划
| 阶段 | 预计时间 | 预期结果 |
|------|---------|---------|
| 表达纯化 | 2-3 月 | 高纯度样品 |
| 结构解析 | 3-6 月 | 原子模型 |
| **总计** | **6-12 个月** | |

## 6. 重要参考文献
(基于 PDB 表中的 DOI/PMID 列出)

## 7. 总结
(3-4 段总结)

---
*本报告由 pdb-tracker-web-v3 自动生成 | 数据来源：UniProt, RCSB PDB, NCBI BLAST*
*报告生成时间: ${new Date().toISOString()}*`;

  const r = await llmComplete(prompt, { ...opts.llm, system });
  const fallback = `# 蛋白结构解析可行性评估报告 (草稿)\n\n**UniProt:** ${uniprot}\n**蛋白:** ${eval_.proteinName}\n**评分:** X-ray ${scores.xray?.score} | Cryo-EM ${scores.cryoem?.score} | NMR ${scores.nmr?.score}\n\n> ⚠️ LLM 报告生成失败: ${r.error}\n\n## 关键数据\n- 直接 PDB 结构数: ${(pdb as any[]).length}\n- BLAST 同源数: ${(blast as any[]).length}\n- 覆盖率: ${eval_.coverage?.toFixed?.(2) ?? eval_.coverage}%\n`;
  const content = r.ok && r.text ? r.text : fallback;

  const title = `Evaluation Report — ${uniprot} ${eval_.proteinName}`;
  const filename = `${uniprot}_${(eval_.proteinName || 'protein').replace(/[\\/:*?"<>|\s]/g, '_')}_结构可行性评估.md`;

  // Update Evaluation.report (the parent record).
  await db.$executeRawUnsafe(`UPDATE Evaluation SET report = ? WHERE uniprotId = ?`, content, uniprot);
  // Also persist to EvaluationReport (history table; production schema has
  // uniprotId UNIQUE so re-runs must use INSERT OR REPLACE).
  await db.$executeRawUnsafe(
    `INSERT OR REPLACE INTO EvaluationReport (uniprotId, title, content, createdAt)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
    uniprot, title, content,
  );

  let savedToFile = false;
  if (opts.saveToFile) {
    try {
      const fs = await import('node:fs/promises');
      const path = await import('node:path');
      await fs.mkdir(REPORT_DIR, { recursive: true });
      const fp = path.join(REPORT_DIR, filename);
      await fs.writeFile(fp, content, 'utf-8');
      savedToFile = true;
    } catch (e: any) {
      console.warn('[report-gen] file save failed:', e?.message);
    }
  }

  return {
    ok: !!r.ok,
    uniprot,
    filename,
    savedToFile,
    content,
    meta: { provider: r.provider || 'none', model: r.model || 'none', durationMs: r.durationMs ?? 0 },
    error: r.ok ? undefined : r.error,
  };
}
