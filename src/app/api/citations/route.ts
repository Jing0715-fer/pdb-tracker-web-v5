/**
 * Citation Network API — builds a graph of papers connected by
 * shared PDB IDs, shared keywords, or shared experimental methods.
 * -----------------------------------------------------------------
 *   GET /api/citations?pmids=12345,67890[&minWeight=1][&limit=200]
 *
 *   → { nodes: CitationNode[], edges: CitationEdge[] }
 *
 *     CitationNode: { id, title, authors, journal, year, if }
 *     CitationEdge: { source, target, type, weight }
 *       type ∈ 'shared_pdb' | 'shared_keyword' | 'shared_method'
 *
 * Edge construction (per task spec):
 *  - shared_pdb     : two papers both reference the same PDB ID
 *                     (from PdbStructure.pubmedId, with a fallback to
 *                      EvaluationBlastResult.pubmedId to capture papers
 *                      that cite a PDB structure without being its
 *                      deposition paper).
 *  - shared_method  : two papers' associated PDB structures share a
 *                     method (X-RAY / CRYO-EM / NMR / etc.).
 *  - shared_keyword : two papers share significant words extracted
 *                     from title + abstract (stopword-filtered, ≥4
 *                     chars, case-folded).
 *
 * Edge weight = the number of shared items of that type (always ≥1
 * for any emitted edge; pairs with zero shared items produce no edge).
 *
 * Impact factor (`if`) lookup uses the same approach as the literature
 * list route: first the journalIf column of PdbStructure (matched by
 * journal name), then a Crossref fallback is intentionally NOT added
 * here to keep the endpoint fast and dependency-free — `if` is left
 * `null` when no local match is found.
 *
 * All DB access is via `db.$queryRawUnsafe` with `?` placeholders —
 * never string-interpolated — to prevent SQL injection from a
 * user-supplied `pmids` list.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { safeJsonParse } from '@/lib/utils';
import { decodeJsonEscapes } from '@/lib/pdb-utils';

// ─── Types ────────────────────────────────────────────────────────────────
export interface CitationNode {
  id: string;       // pmid
  title: string;
  authors: string;
  journal: string;
  year: string | null;
  if: number | null;
}

export interface CitationEdge {
  source: string;   // pmid
  target: string;   // pmid
  type: 'shared_pdb' | 'shared_keyword' | 'shared_method';
  weight: number;
}

interface PaperAug {
  pmid: string;
  title: string;
  authors: string;
  journal: string;
  year: string | null;
  if: number | null;
  pdbIds: Set<string>;
  methods: Set<string>;
  keywords: Set<string>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Small English stopword set — kept inline so the module has zero
 * runtime dependencies. Sufficient for keyword-overlap edges; not
 * intended to be a production NLP tokenizer.
 */
const STOPWORDS = new Set<string>([
  'the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'her',
  'was', 'one', 'our', 'out', 'day', 'get', 'has', 'him', 'his', 'how',
  'man', 'new', 'now', 'old', 'see', 'two', 'way', 'who', 'boy', 'did',
  'its', 'let', 'put', 'say', 'she', 'too', 'use', 'with', 'this', 'that',
  'from', 'they', 'will', 'would', 'there', 'their', 'what', 'about',
  'which', 'when', 'make', 'can', 'like', 'time', 'just', 'him', 'know',
  'take', 'people', 'into', 'year', 'your', 'good', 'some', 'could',
  'them', 'see', 'other', 'than', 'then', 'now', 'look', 'only', 'come',
  'over', 'think', 'also', 'back', 'after', 'use', 'two', 'how', 'our',
  'work', 'first', 'well', 'way', 'even', 'new', 'want', 'because',
  'any', 'these', 'give', 'day', 'most', 'us', 'we', 'an', 'or', 'in',
  'of', 'to', 'a', 'is', 'as', 'at', 'by', 'be', 'on', 'it', 'if', 'so',
  'no', 'do', 'up', 'ab', 'et', 'al', 'using', 'based', 'show', 'shown',
  'may', 'via', 'both', 'between', 'within', 'through', 'during',
  'however', 'while', 'where', 'more', 'such', 'than', 'less', 'very',
  'high', 'low', 'further', 'among', 'these', 'those', 'each',
]);

const MIN_KEYWORD_LEN = 4;
const MAX_KEYWORDS_PER_PAPER = 40;

/** Extract a small set of significant tokens from a title + abstract. */
function extractKeywords(title: string, abstract: string): Set<string> {
  const text = `${title || ''} ${abstract || ''}`.toLowerCase();
  // Match runs of letters/digits (≥4 chars after lowercasing). This is
  // intentionally simple — the goal is overlap detection, not parsing.
  const tokens = text.match(/[a-z][a-z0-9]{3,}/g) || [];
  const out = new Set<string>();
  for (const t of tokens) {
    if (STOPWORDS.has(t)) continue;
    out.add(t);
    if (out.size >= MAX_KEYWORDS_PER_PAPER) break;
  }
  return out;
}

/** Normalize a method string ("X-RAY DIFFRACTION" → "x-ray"). */
function normalizeMethod(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const lower = String(raw).trim().toLowerCase();
  if (!lower) return null;
  // Collapse common variants onto canonical labels so that
  // "X-RAY DIFFRACTION" and "X-RAY" match.
  if (lower.includes('x-ray')) return 'x-ray';
  if (lower.includes('cryo') || lower.includes('electron microscopy')) {
    return 'cryo-em';
  }
  if (lower.includes('nmr')) return 'nmr';
  if (lower.includes('neutron')) return 'neutron';
  if (lower.includes('fiber')) return 'fiber';
  if (lower.includes('theoretical')) return 'theoretical';
  return lower;
}

/** Parse + dedupe + clamp the pmids query param. Returns [] on bad input. */
function parsePmids(raw: string | null): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const piece of raw.split(/[\s,]+/)) {
    const trimmed = piece.trim();
    if (!trimmed) continue;
    // Accept numeric PMIDs (and the occasional "pmc" prefix, lowercased).
    const normalized = trimmed.replace(/^PMC/i, '').toLowerCase();
    if (!/^\d+$/.test(normalized)) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

/** Build an SQL `IN (?, ?, ...)` placeholder list of the right length. */
function inPlaceholders(ids: string[]): string {
  return ids.map(() => '?').join(',');
}

/** Compute the size of the intersection of two Sets. */
function intersectionSize<T>(a: Set<T>, b: Set<T>): number {
  if (a.size === 0 || b.size === 0) return 0;
  // Iterate the smaller set for efficiency.
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let n = 0;
  for (const x of small) if (large.has(x)) n++;
  return n;
}

// ─── Route handler ─────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  try {
    const sp = request.nextUrl.searchParams;
    const pmids = parsePmids(sp.get('pmids'));
    if (pmids.length === 0) {
      return NextResponse.json(
        { error: 'Query param `pmids` is required (comma-separated PubMed IDs)' },
        { status: 400 },
      );
    }
    if (pmids.length > 200) {
      return NextResponse.json(
        { error: 'Too many pmids (max 200 per request)' },
        { status: 400 },
      );
    }

    const minWeightRaw = Number(sp.get('minWeight') ?? '1');
    const minWeight =
      Number.isFinite(minWeightRaw) && minWeightRaw > 0
        ? Math.floor(minWeightRaw)
        : 1;

    // ── Fetch the paper rows from PubMedArticle ──────────────────────────
    const ph = inPlaceholders(pmids);
    const articles = await db.$queryRawUnsafe<any[]>(
      `SELECT pubmedId, title, authors, journal, pubYear, pubMonth, pubDay, abstract
       FROM PubMedArticle
       WHERE pubmedId IN (${ph})`,
      ...pmids,
    );

    if (!articles || articles.length === 0) {
      // No papers found — return an empty graph rather than 404, so the
      // caller can render an empty state uniformly.
      return NextResponse.json(safeJsonParse({ nodes: [], edges: [] }));
    }

    // ── Fetch associated PDB structures for the found papers ─────────────
    // (and use them both for shared_pdb edges and for journal-IF lookup.)
    const foundPmids = articles.map((a) => String(a.pubmedId));
    const phFound = inPlaceholders(foundPmids);
    const pdbRows = await db.$queryRawUnsafe<any[]>(
      `SELECT pubmedId, pdbId, method, journal, journalIf
       FROM PdbStructure
       WHERE pubmedId IN (${phFound})`,
      ...foundPmids,
    );

    // ── Fetch any extra PDB associations from EvaluationBlastResult ──────
    // (Captures papers that cite a PDB structure without being its
    // deposition paper — they show up here via the eval pipeline.)
    const blastPdbRows = await db.$queryRawUnsafe<any[]>(
      `SELECT DISTINCT pubmedId, pdbId, method
       FROM EvaluationBlastResult
       WHERE pubmedId IS NOT NULL
         AND pubmedId != ''
         AND pubmedId IN (${phFound})`,
      ...foundPmids,
    ).catch(() => [] as any[]); // table may not exist on a fresh DB

    // ── Build per-paper PDB / method / IF maps ───────────────────────────
    const pdbIdsByPmid = new Map<string, Set<string>>();
    const methodsByPmid = new Map<string, Set<string>>();
    const ifByPmid = new Map<string, number | null>();

    function pushPdb(pmid: string, pdbId: string | null, method: string | null) {
      if (!pmid || !pdbId) return;
      const pdbSet = pdbIdsByPmid.get(pmid) ?? new Set<string>();
      pdbSet.add(String(pdbId).toUpperCase());
      pdbIdsByPmid.set(pmid, pdbSet);

      const m = normalizeMethod(method);
      if (m) {
        const mSet = methodsByPmid.get(pmid) ?? new Set<string>();
        mSet.add(m);
        methodsByPmid.set(pmid, mSet);
      }
    }

    for (const row of pdbRows || []) {
      const pmid = String(row.pubmedId);
      pushPdb(pmid, row.pdbId, row.method);
      // Prefer the highest journalIf among the paper's PDB rows.
      if (row.journalIf != null) {
        const v = Number(row.journalIf);
        if (Number.isFinite(v)) {
          const cur = ifByPmid.get(pmid);
          if (cur == null || v > cur) ifByPmid.set(pmid, v);
        }
      }
    }
    for (const row of blastPdbRows || []) {
      pushPdb(String(row.pubmedId), row.pdbId, row.method);
    }

    // ── Build nodes ──────────────────────────────────────────────────────
    const nodes: CitationNode[] = articles.map((a) => {
      const pmid = String(a.pubmedId);
      const title = decodeJsonEscapes(a.title) || '';
      const authors = decodeJsonEscapes(a.authors) || '';
      const journal = a.journal || '';
      const year = a.pubYear ? String(a.pubYear) : null;
      return {
        id: pmid,
        title,
        authors,
        journal,
        year,
        if: ifByPmid.has(pmid) ? ifByPmid.get(pmid)! : null,
      };
    });

    // ── Augment each paper with its keyword + pdb + method sets ──────────
    const augByPmid = new Map<string, PaperAug>();
    for (const n of nodes) {
      const articleRow = articles.find((a) => String(a.pubmedId) === n.id);
      const abstract = articleRow ? decodeJsonEscapes(articleRow.abstract) || '' : '';
      augByPmid.set(n.id, {
        pmid: n.id,
        title: n.title,
        authors: n.authors,
        journal: n.journal,
        year: n.year,
        if: n.if,
        pdbIds: pdbIdsByPmid.get(n.id) ?? new Set<string>(),
        methods: methodsByPmid.get(n.id) ?? new Set<string>(),
        keywords: extractKeywords(n.title, abstract),
      });
    }

    // ── Build edges by pairwise comparison ───────────────────────────────
    // O(N²) where N = number of found papers (≤200). Worst case ≈ 20k
    // comparisons, each doing a small Set intersection — well within
    // budget for a single API call.
    const edges: CitationEdge[] = [];
    const orderedIds = nodes.map((n) => n.id);
    for (let i = 0; i < orderedIds.length; i++) {
      const a = augByPmid.get(orderedIds[i])!;
      for (let j = i + 1; j < orderedIds.length; j++) {
        const b = augByPmid.get(orderedIds[j])!;

        // shared_pdb
        const sharedPdb = intersectionSize(a.pdbIds, b.pdbIds);
        if (sharedPdb >= minWeight) {
          edges.push({
            source: a.pmid,
            target: b.pmid,
            type: 'shared_pdb',
            weight: sharedPdb,
          });
        }

        // shared_method
        const sharedMethod = intersectionSize(a.methods, b.methods);
        if (sharedMethod >= minWeight) {
          edges.push({
            source: a.pmid,
            target: b.pmid,
            type: 'shared_method',
            weight: sharedMethod,
          });
        }

        // shared_keyword
        const sharedKw = intersectionSize(a.keywords, b.keywords);
        if (sharedKw >= minWeight) {
          edges.push({
            source: a.pmid,
            target: b.pmid,
            type: 'shared_keyword',
            weight: sharedKw,
          });
        }
      }
    }

    return NextResponse.json(
      safeJsonParse({
        nodes,
        edges,
        stats: {
          nodeCount: nodes.length,
          edgeCount: edges.length,
          edgesByType: {
            shared_pdb: edges.filter((e) => e.type === 'shared_pdb').length,
            shared_method: edges.filter((e) => e.type === 'shared_method').length,
            shared_keyword: edges.filter((e) => e.type === 'shared_keyword').length,
          },
        },
      }),
    );
  } catch (err: any) {
    console.error('[api/citations GET] error:', err);
    return NextResponse.json(
      {
        error: err?.message || 'Failed to build citation network',
        nodes: [],
        edges: [],
      },
      { status: 500 },
    );
  }
}
