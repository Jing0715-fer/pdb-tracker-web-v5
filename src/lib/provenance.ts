/**
 * Provenance tracking — inspired by Claude Science's "every result
 * reproducible and traced to its code".
 *
 * A ProvenanceRecord captures the full lineage of a single scientific
 * conclusion in this app: which databases were queried, which LLM
 * produced the text, which PDB / PMID / DOI citations appear in the
 * output, and whether those citations actually exist.
 *
 * Provenance records are:
 *   - Generated automatically during evaluation runs (one per chapter
 *     + one aggregate per target)
 *   - Stored in the Evaluation row's `provenance` JSON column
 *   - Surfaced in the UI as a "Provenance & Reproducibility" panel
 *     alongside the report
 *
 * This module is the single source of truth for the provenance schema
 * and the citation-extraction / citation-verification logic.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DataSourceTrace {
  /** 'pdb' | 'blast' | 'uniprot' | 'pubmed' | 'rcsb' | 'ncbi-blast' */
  source: string;
  /** Query that was issued (sequence, uniprot id, pdb id — human readable). */
  query: string;
  /** Number of records returned. */
  resultCount: number;
  /** ISO timestamp of the query. */
  queriedAt: string;
  /** Endpoint or database name (e.g. 'https://blast.ncbi.nlm.nih.gov', 'pdbaa'). */
  endpoint: string;
}

export interface LlmTrace {
  provider: string;
  model: string;
  /** Duration of the LLM call in ms. */
  durationMs: number;
  /** Whether the call fell back to a different provider. */
  fallback: boolean;
  /** Max chars requested. */
  maxChars: number;
  /** The system prompt identifier (not the full prompt — that's in promptHash). */
  promptTemplate: string;
  /** SHA-256 of the full user prompt — lets us detect prompt drift without
   *  storing potentially-sensitive full prompts. */
  promptHash: string;
}

export interface CitationEntry {
  /** 'pdb' | 'pmid' | 'doi' | 'uniprot' */
  type: 'pdb' | 'pmid' | 'doi' | 'uniprot';
  /** The raw identifier as it appears in the report text. */
  id: string;
  /** Where in the report it was found (chapter key + char offset). */
  context: string;
  /** Whether we verified the identifier exists in its source database. */
  verified: boolean;
  /** Verification result detail (e.g. 'found in RCSB', 'not found', 'network error'). */
  verifyDetail?: string;
}

export interface ProvenanceRecord {
  /** Schema version — bump if the shape changes. */
  version: 1;
  /** ISO timestamp when the evaluation run completed. */
  generatedAt: string;
  /** App + node version that produced this record. */
  appVersion: string;
  /** The target this provenance describes. */
  uniprotId: string;
  /** Data sources queried during this evaluation. */
  dataSources: DataSourceTrace[];
  /** LLM calls made (one per chapter + aggregate). */
  llmCalls: LlmTrace[];
  /** Citations found in the final report + their verification status. */
  citations: CitationEntry[];
  /** Scores at the time of evaluation (snapshot, so re-reading the row
   *  after a re-eval still shows what the report was based on). */
  scoresSnapshot: Record<string, { score: number; max: number }>;
  /** BLAST hit count + direct PDB count at evaluation time. */
  structureCounts: { directPdb: number; blastHomologs: number; xray: number; cryoem: number; nmr: number };
}

// ─── Citation Extraction ─────────────────────────────────────────────────────

/**
 * Extract all scientific identifiers from a markdown report.
 *
 * Recognizes:
 *   • PDB IDs: 4 chars, 1 digit + 3 alnum, e.g. "1A27", "9QXN"
 *   • PubMed IDs: "PMID 12345678" or "PMID:12345678"
 *   • DOIs: "10.xxxx/xxxxx"
 *   • UniProt accessions: "P12345" / "Q9H4A3" (6 chars, [OPQ] + 5 alnum)
 *
 * Returns one entry per occurrence (the same PDB can be cited multiple times
 * in different chapters — each occurrence is a separate citation with its
 * own context).
 */
export function extractCitations(reportMarkdown: string): CitationEntry[] {
  const out: CitationEntry[] = [];
  if (!reportMarkdown) return out;

  // PDB IDs — 4 chars, first is a digit, next 3 are alphanumeric.
  // Word-boundary-ish: preceded by non-alnum or start, followed by non-alnum or end.
  // Avoid matching inside URLs (http://... or ftp://...) — skip if preceded by '/'.
  const pdbRe = /(?:^|[^\w/]|\()([0-9][A-Za-z0-9]{3})(?![A-Za-z0-9])/g;
  let m: RegExpExecArray | null;
  while ((m = pdbRe.exec(reportMarkdown))) {
    const id = m[1].toUpperCase();
    // Filter out things that look like years (1900-2099) or version numbers.
    if (/^[12]\d{3}$/.test(id)) continue;
    const ctx = contextAround(reportMarkdown, m.index + 1, 60);
    out.push({ type: 'pdb', id, context: ctx, verified: false });
  }

  // PubMed IDs — "PMID 12345678" or "PMID:12345678"
  const pmidRe = /PMID:?\s*(\d{5,9})/gi;
  while ((m = pmidRe.exec(reportMarkdown))) {
    const ctx = contextAround(reportMarkdown, m.index, 60);
    out.push({ type: 'pmid', id: m[1], context: ctx, verified: false });
  }

  // DOIs — "10.xxxx/xxxxx"  (escape the inner / so it's not treated as
  // the regex terminator)
  const doiRe = /\b(10\.\d{4,9}\/[^\s)"']+)/g;
  while ((m = doiRe.exec(reportMarkdown))) {
    const ctx = contextAround(reportMarkdown, m.index, 60);
    out.push({ type: 'doi', id: m[1].replace(/[.,;]$/, ''), context: ctx, verified: false });
  }

  // UniProt accessions — [OPQ]\d[A-Z0-9]{4} (6 chars). Only when preceded
  // by a word boundary and not part of a longer alphanumeric run (which
  // would be a PDB ID chain suffix or a gene name).
  const uniprotRe = /(?:^|[^\w])([OPQ][0-9][A-Z0-9]{4})(?![A-Z0-9])/g;
  while ((m = uniprotRe.exec(reportMarkdown))) {
    const ctx = contextAround(reportMarkdown, m.index + 1, 60);
    out.push({ type: 'uniprot', id: m[1], context: ctx, verified: false });
  }

  return out;
}

function contextAround(text: string, pos: number, radius: number): string {
  const start = Math.max(0, pos - radius);
  const end = Math.min(text.length, pos + radius);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

// ─── Citation Verification ───────────────────────────────────────────────────

/**
 * Verify a batch of citations against their source databases.
 *
 * PDB IDs → RCSB (HEAD request, 200 = exists).
 * PubMed IDs → NCBI eutils esummary.
 * DOIs → doi.org HEAD.
 * UniProt → rest.uniprot.org.
 *
 * We verify in parallel with a per-source timeout so one slow API doesn't
 * block the whole panel. Failures are recorded as `verified: false` with a
 * `verifyDetail` explaining why — they do NOT fail the evaluation.
 */
export async function verifyCitations(
  citations: CitationEntry[],
  opts: { timeoutMs?: number } = {},
): Promise<CitationEntry[]> {
  const timeoutMs = opts.timeoutMs ?? 8000;
  // Dedup by (type, id) so we don't hit the same API 10× for a PDB cited
  // in 10 chapters. The caller's array still gets every occurrence updated.
  const byKey = new Map<string, Promise<{ verified: boolean; detail?: string }>>();
  for (const c of citations) {
    const key = `${c.type}:${c.id}`;
    if (!byKey.has(key)) {
      byKey.set(key, verifyOne(c.type, c.id, timeoutMs));
    }
  }
  const results = await Promise.all(
    citations.map(async (c) => {
      const r = await byKey.get(`${c.type}:${c.id}`)!;
      return { ...c, verified: r.verified, verifyDetail: r.detail };
    }),
  );
  return results;
}

async function verifyOne(
  type: CitationEntry['type'],
  id: string,
  timeoutMs: number,
): Promise<{ verified: boolean; detail?: string }> {
  try {
    if (type === 'pdb') {
      const url = `https://data.rcsb.org/rest/v1/core/entry/${id}`;
      const res = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { Accept: 'application/json' },
      });
      if (res.ok) return { verified: true, detail: 'found in RCSB' };
      if (res.status === 404) return { verified: false, detail: 'not found in RCSB' };
      return { verified: false, detail: `RCSB HTTP ${res.status}` };
    }
    if (type === 'pmid') {
      const url = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${id}&retmode=json`;
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok) return { verified: false, detail: `NCBI HTTP ${res.status}` };
      const j = await res.json() as any;
      const found = j?.result?.[id]?.title != null;
      return { verified: found, detail: found ? 'found in PubMed' : 'not in PubMed' };
    }
    if (type === 'doi') {
      const url = `https://doi.org/${id}`;
      const res = await fetch(url, {
        method: 'HEAD',
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'follow',
      });
      return { verified: res.ok, detail: res.ok ? 'DOI resolves' : `DOI HTTP ${res.status}` };
    }
    if (type === 'uniprot') {
      const url = `https://rest.uniprot.org/uniprotkb/${id}.json`;
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      return { verified: res.ok, detail: res.ok ? 'found in UniProt' : `UniProt HTTP ${res.status}` };
    }
    return { verified: false, detail: 'unknown citation type' };
  } catch (err: any) {
    return { verified: false, detail: `verify error: ${err?.message ?? 'timeout'}` };
  }
}

// ─── Provenance Builder ──────────────────────────────────────────────────────

// NOTE: `node:crypto` is intentionally NOT imported at the top level.
// This module is imported (for types / summarizeProvenance) by client
// components (provenance-panel.tsx). A static `import { createHash } from
// 'node:crypto'` makes webpack try to bundle the Node built-in into the
// client chunk → "Reading from node:crypto is not handled by plugins".
// Lazy-requiring inside the function (guarded by a server check) hides
// the dependency from webpack's static analysis so only server bundles
// ever actually load it.
export function hashPrompt(prompt: string): string {
  if (typeof window !== 'undefined') return ''; // never called client-side
  const { createHash } = eval('require')('node:crypto');
  return createHash('sha256').update(prompt).digest('hex').slice(0, 16);
}

/**
 * Build a provenance record from the pieces collected during an
 * evaluation run. The caller is responsible for accumulating
 * dataSources / llmCalls / scoresSnapshot as the run progresses; this
 * just assembles them into the canonical shape.
 */
export function buildProvenance(input: {
  uniprotId: string;
  dataSources: DataSourceTrace[];
  llmCalls: LlmTrace[];
  reportMarkdown: string;
  scoresSnapshot: Record<string, { score: number; max: number }>;
  structureCounts: ProvenanceRecord['structureCounts'];
  appVersion?: string;
}): ProvenanceRecord {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    appVersion: input.appVersion || process.env.npm_package_version || 'unknown',
    uniprotId: input.uniprotId,
    dataSources: input.dataSources,
    llmCalls: input.llmCalls,
    citations: extractCitations(input.reportMarkdown),
    scoresSnapshot: input.scoresSnapshot,
    structureCounts: input.structureCounts,
  };
}

// ─── Helpers for the UI ──────────────────────────────────────────────────────

export function summarizeProvenance(p: ProvenanceRecord | null): {
  totalCitations: number;
  verifiedCitations: number;
  unverifiedCitations: number;
  sourcesQueried: number;
  llmCallsMade: number;
  reproducibilityScore: number; // 0-100
} {
  if (!p) {
    return { totalCitations: 0, verifiedCitations: 0, unverifiedCitations: 0, sourcesQueried: 0, llmCallsMade: 0, reproducibilityScore: 0 };
  }
  const total = p.citations.length;
  const verified = p.citations.filter((c) => c.verified).length;
  const unverified = total - verified;
  // Reproducibility score: weighted blend of citation verification rate +
  // whether all data sources are recorded + whether LLM calls are logged.
  const citationRate = total > 0 ? verified / total : 0.5;
  const sourceRate = p.dataSources.length > 0 ? 1 : 0;
  const llmRate = p.llmCalls.length > 0 ? 1 : 0;
  const score = Math.round((citationRate * 0.5 + sourceRate * 0.25 + llmRate * 0.25) * 100);
  return {
    totalCitations: total,
    verifiedCitations: verified,
    unverifiedCitations: unverified,
    sourcesQueried: p.dataSources.length,
    llmCallsMade: p.llmCalls.length,
    reproducibilityScore: score,
  };
}
