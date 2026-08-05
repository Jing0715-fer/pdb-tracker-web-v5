import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { safeJsonParse } from '@/lib/utils';
import {
  matchJournalIf,
  canonicalizeJournal,
  buildJournalLookup,
  combineDate,
  todayLocalDate,
} from '@/lib/journal-matching';

// ─── Lightweight in-memory cache for the static journal → IF lookup ──────────
//
// `ifRows` reads the full PdbStructure.journal / journalIf table on every
// stats call. The set of journals and their IFs only changes when
// PdbStructure is updated, so a 5-minute TTL cuts 1 query per request
// with no risk of stale data on a normal usage pattern.

type JournalLookup = {
  journalIfMap: Record<string, number>;
  pdbJournals: { normalized: string; journalIf: number; ngrams: Set<string> }[];
};

let journalLookupCache: { value: JournalLookup; expiresAt: number } | null = null;
const JOURNAL_LOOKUP_TTL_MS = 5 * 60 * 1000;

async function getJournalLookup(): Promise<JournalLookup> {
  const now = Date.now();
  if (journalLookupCache && journalLookupCache.expiresAt > now) {
    return journalLookupCache.value;
  }
  const ifRows = await db.$queryRaw<any[]>`
    SELECT DISTINCT journal, journalIf
    FROM PdbStructure
    WHERE journalIf IS NOT NULL AND journalIf > 0
  `;
  const value = buildJournalLookup(
    ifRows as { journal: string; journalIf: number | null }[]
  );
  journalLookupCache = { value, expiresAt: now + JOURNAL_LOOKUP_TTL_MS };
  return value;
}

export async function GET() {
  try {
    // ──────────────────────────────────────────────────────────────────────
    // Global stats (unchanged): totalPapers, totalReports, papersWithIf,
    // methodDistribution, ifDistribution — these remain all-time aggregates
    // ──────────────────────────────────────────────────────────────────────

    // Total papers
    const totalPapersRow = await db.$queryRaw<any[]>`
      SELECT CAST(COUNT(*) AS TEXT) as cnt FROM PubMedArticle
    `;
    const totalPapers = parseInt(totalPapersRow[0]?.cnt ?? '0', 10);

    // Total reports (distinct publication years as report groups)
    const totalReportsRow = await db.$queryRaw<any[]>`
      SELECT CAST(COUNT(DISTINCT pubYear) AS TEXT) as cnt FROM PubMedArticle WHERE pubYear IS NOT NULL
    `;
    const totalReports = parseInt(totalReportsRow[0]?.cnt ?? '0', 10);

    // Papers with journal info (non-null journal)
    const papersWithIfRow = await db.$queryRaw<any[]>`
      SELECT CAST(COUNT(*) AS TEXT) as cnt FROM PubMedArticle WHERE journal IS NOT NULL AND journal != ''
    `;
    const papersWithIf = parseInt(papersWithIfRow[0]?.cnt ?? '0', 10);

    // Method distribution from related PDB structures
    const methodDistributionRows = await db.$queryRaw<any[]>`
      SELECT
        CASE
          WHEN method LIKE '%Cryo-EM%' OR method LIKE '%ELECTRON MICROSCOPY%' THEN 'Cryo-EM'
          WHEN method LIKE '%X-RAY%' OR method LIKE '%XRAY%' THEN 'X-ray'
          WHEN method LIKE '%NMR%' THEN 'NMR'
          ELSE 'Other'
        END as method,
        CAST(COUNT(*) AS TEXT) as count
      FROM PdbStructure
      WHERE pubmedId IS NOT NULL
      GROUP BY method
      ORDER BY count DESC
    `;
    const methodDistribution = methodDistributionRows.map(r => ({
      method: r.method,
      count: parseInt(r.count, 10),
    }));

    // Merge any unrecognized method variants into 'Other' (defensive: DB rows
    // may have legacy text that doesn't match the CASE above, e.g. 'EM', 'THEORY')
    const methodBuckets: Record<string, number> = { 'Cryo-EM': 0, 'X-ray': 0, 'NMR': 0, 'Other': 0 };
    for (const row of methodDistribution) {
      if (row.method in methodBuckets) {
        methodBuckets[row.method] += row.count;
      } else {
        methodBuckets['Other'] += row.count;
      }
    }
    const methodDistributionMerged = Object.entries(methodBuckets)
      .filter(([, count]) => count > 0)
      .map(([method, count]) => ({ method, count }));

    // IF distribution — count per paper (using max IF per paper), not per structure.
    // This avoids bias from papers that have many PDB structures with varying IF.
    const ifDistributionRows = await db.$queryRaw<any[]>`
      SELECT
        CASE
          WHEN max_if >= 20 THEN 'top'
          WHEN max_if >= 10 THEN 'high'
          WHEN max_if >= 5 THEN 'mid'
          WHEN max_if IS NOT NULL THEN 'low'
          ELSE 'unknown'
        END as tier,
        CAST(COUNT(*) AS TEXT) as count
      FROM (
        SELECT p.pubmedId, MAX(p.journalIf) as max_if
        FROM PdbStructure p
        WHERE p.pubmedId IS NOT NULL
        GROUP BY p.pubmedId
      )
      WHERE max_if IS NOT NULL
      GROUP BY tier
      ORDER BY count DESC
    `;
    const ifDistribution = ifDistributionRows.map(r => ({
      tier: r.tier,
      count: parseInt(r.count, 10),
    }));

    // ──────────────────────────────────────────────────────────────────────
    // Date-scoped stats: latestDate (capped at today), topJournal and avgIf
    // for papers published on the most recent valid date (includes daily
    // report papers — source = '结构生物学文献日报' or empty).
    // ──────────────────────────────────────────────────────────────────────

    // Today (server's local TZ, e.g. Asia/Shanghai) — caps latestDate so
    // we never display a future date even if a DB row has e.g.
    // pubMonth='12' with year 2026 when today is 2026-06-16.
    const today = todayLocalDate();

    // 1. Compute the most recent normalized publication date, capped at today.
    //    Some DB rows have a month name like 'Jun' or an empty pubDay, so we
    //    normalize month names to '01'..'12' and missing day to '01' to
    //    produce a sortable YYYY-MM-DD string. The cap is applied via a
    //    WHERE clause so future-dated rows (e.g. pubMonth='12' with year 2026
    //    when today is 2026-06-16) cannot push latestDate past today.
    const latestDateRow = await db.$queryRaw<any[]>`
      SELECT MAX(normDate) as latest
      FROM (
        SELECT
          CASE
            WHEN pubYear IS NOT NULL AND pubYear != ''
              THEN pubYear || '-' ||
                COALESCE(
                  CASE
                    WHEN pubMonth IS NULL OR pubMonth = '' THEN '01'
                    WHEN pubMonth GLOB '[A-Za-z]*' THEN
                      CASE upper(pubMonth)
                        WHEN 'JAN' THEN '01' WHEN 'FEB' THEN '02' WHEN 'MAR' THEN '03'
                        WHEN 'APR' THEN '04' WHEN 'MAY' THEN '05' WHEN 'JUN' THEN '06'
                        WHEN 'JUL' THEN '07' WHEN 'AUG' THEN '08' WHEN 'SEP' THEN '09'
                        WHEN 'OCT' THEN '10' WHEN 'NOV' THEN '11' WHEN 'DEC' THEN '12'
                        ELSE substr('00' || pubMonth, -2, 2)
                      END
                    ELSE substr('00' || pubMonth, -2, 2)
                  END, '01')
                || '-' ||
                COALESCE(
                  CASE
                    WHEN pubDay IS NULL OR pubDay = '' THEN '01'
                    ELSE substr('00' || pubDay, -2, 2)
                  END, '01')
            ELSE NULL
          END as normDate
        FROM PubMedArticle
        WHERE pubYear IS NOT NULL AND pubYear != ''
      )
      WHERE normDate IS NOT NULL AND normDate <= ${today}
    `;
    const latestDate: string | null = latestDateRow[0]?.latest ?? null;

    // 2. For topJournal + avgIf, fetch all papers (any source) whose
    //    normalized publication date equals `latestDate`, then resolve IF
    //    per paper via the shared matcher.
    //
    //    We do the date filter in TypeScript (not SQL) because the DB has
    //    heterogeneous formats: pubMonth may be 'Jan' or '06' or empty,
    //    pubDay may be '1', '01', or empty. Reusing combineDate() (the
    //    same normalizer used elsewhere) keeps the rule in one place.
    let topJournal: string | null = null;
    let avgIf: number | null = null;

    if (latestDate) {
      const [latestYear] = latestDate.split('-');
      const rows = await db.$queryRaw<any[]>`
        SELECT pubmedId, journal, pubYear, pubMonth, pubDay
        FROM PubMedArticle
        WHERE pubYear = ${latestYear}
      `;
      const papersOnDate = rows.filter(
        r => combineDate(r.pubYear, r.pubMonth, r.pubDay) === latestDate
      );

      if (papersOnDate.length > 0) {
        // Use the cached PdbStructure-derived journal → IF lookup (5-min TTL).
        const { journalIfMap, pdbJournals } = await getJournalLookup();

        // Compute IF per paper on the latest date.
        // Direct PdbStructure match (via pubmedId) takes priority over the
        // journal-name matcher — this avoids mismatches when a paper's
        // PubMed journal name differs from the journal its PDB structure
        // was originally categorized under.
        const pubmedIds = papersOnDate.map(p => p.pubmedId).filter(Boolean);
        const pdbByPubmed = new Map<string, number | null>();
        if (pubmedIds.length > 0) {
          // $queryRawUnsafe accepts positional '?' placeholders with
          // remaining args as parameter values — safe from SQL injection
          // since we only pass already-fetched pubmedIds (not user input).
          const placeholders = pubmedIds.map(() => '?').join(',');
          const pdbIfRows = await db.$queryRawUnsafe<any[]>(
            `SELECT pubmedId, MAX(journalIf) as max_if
             FROM PdbStructure
             WHERE pubmedId IN (${placeholders})
               AND journalIf IS NOT NULL
             GROUP BY pubmedId`,
            ...pubmedIds
          );
          for (const r of pdbIfRows) {
            pdbByPubmed.set(r.pubmedId as string, r.max_if as number | null);
          }
        }

        type Scored = { journal: string; if: number };
        const scored: Scored[] = [];
        for (const p of papersOnDate) {
          let ifVal: number | null = pdbByPubmed.has(p.pubmedId)
            ? pdbByPubmed.get(p.pubmedId) ?? null
            : null;
          if (ifVal == null && p.journal) {
            ifVal = matchJournalIf(p.journal, journalIfMap, pdbJournals);
          }
          if (ifVal != null && ifVal > 0 && p.journal) {
            scored.push({ journal: p.journal, if: ifVal });
          }
        }

        if (scored.length > 0) {
          // Average IF over all papers on the date that have an IF.
          const sumIf = scored.reduce((s, x) => s + x.if, 0);
          avgIf = Math.round((sumIf / scored.length) * 100) / 100;

          // Top journal = paper with the highest IF on the date, then
          // canonicalize the display name (e.g. "nature communications"
          // → "Nature Communications"; unknown names get title-cased).
          const top = scored.slice().sort((a, b) => b.if - a.if)[0];
          topJournal = canonicalizeJournal(top.journal);
        }
      }
    }

    return NextResponse.json(safeJsonParse({
      totalPapers,
      totalReports,
      papersWithIf,
      latestDate,
      avgIf,
      topJournal,
      methodDistribution: methodDistributionMerged,
      ifDistribution,
    }));
  } catch (error) {
    console.error('Error fetching literature stats:', error);
    return NextResponse.json({ error: 'Failed to fetch literature stats' }, { status: 500 });
  }
}
