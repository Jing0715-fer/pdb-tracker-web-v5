import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';

// NCBI E-utilities rate limit: max 3 req/s without API key.
// We batch PMIDs and add delays to stay safe.
const NCBI_ESUMMARY = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi';
const BATCH_SIZE = 50; // esummary supports up to 200, but we keep it conservative
const DELAY_MS = 400; // delay between batches to respect rate limits

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface PubmedArticle {
  pubmedId: string;
  title: string;
  authors: string;
  abstract: string;
  journal: string;
}

function parseSummary(article: any): PubmedArticle {
  // esummary returns authors as array of { name, authtype } objects
  let authors = '';
  if (article.authors && Array.isArray(article.authors)) {
    authors = article.authors.map((a: any) => a.name || a).join('; ');
  } else if (typeof article.authors === 'string') {
    authors = article.authors;
  }

  // Journal info is nested under article.journal or top-level
  const journal = article.fulljournalname || article.source || article.journal?.title || '';

  // Abstract may come back as an array of strings
  let abstract = '';
  if (typeof article.abstract === 'string') {
    abstract = article.abstract;
  } else if (Array.isArray(article.abstract)) {
    abstract = article.abstract.join(' ');
  }

  return {
    pubmedId: String(article.uid),
    title: article.title || '',
    authors,
    abstract,
    journal,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { pubmedIds } = body as { pubmedIds?: string[] };

    if (!pubmedIds || !Array.isArray(pubmedIds) || pubmedIds.length === 0) {
      return NextResponse.json({ error: 'pubmedIds array is required' }, { status: 400 });
    }

    // Validate and deduplicate IDs (must be numeric strings)
    const validIds = [...new Set(
      pubmedIds
        .filter((id) => id && /^\d+$/.test(id.trim()))
        .map((id) => id.trim())
    )];

    if (validIds.length === 0) {
      return NextResponse.json({ error: 'No valid PubMed IDs provided' }, { status: 400 });
    }

    // Step 1: Check which IDs are already cached
    const cachedArticles = await db.$queryRaw<any[]>`
      SELECT "pubmedId", title, authors, abstract, journal
      FROM "PubMedArticle"
      WHERE "pubmedId" IN (${Prisma.join(validIds)})
    `;

    const cachedMap = new Map<string, PubmedArticle>();
    for (const a of cachedArticles) {
      cachedMap.set(a.pubmedId, {
        pubmedId: a.pubmedId,
        title: a.title || '',
        authors: a.authors || '',
        abstract: a.abstract || '',
        journal: a.journal || '',
      });
    }

    const uncachedIds = validIds.filter((id) => !cachedMap.has(id));
    const results: PubmedArticle[] = [...cachedMap.values()];

    // Step 2: Fetch uncached IDs from NCBI in batches
    if (uncachedIds.length > 0) {
      const newlyFetched: PubmedArticle[] = [];

      for (let i = 0; i < uncachedIds.length; i += BATCH_SIZE) {
        const batch = uncachedIds.slice(i, i + BATCH_SIZE);

        try {
          // Use esummary endpoint — simplest, returns JSON directly
          const idsParam = batch.join(',');
          const url = `${NCBI_ESUMMARY}?db=pubmed&id=${idsParam}&retmode=json`;

          const response = await fetch(url, {
            headers: {
              'User-Agent': 'PDBStructureTracker/1.0 (contact@pdbtracker.app)',
            },
          });

          if (!response.ok) {
            console.error(`NCBI esummary error: ${response.status} ${response.statusText}`);
            continue;
          }

          const data = await response.json();
          const articles = data?.result;

          if (!articles) continue;

          // esummary returns: { result: { uids: [...], "12345": { ... }, ... } }
          const uids: string[] = articles.uids || [];

          for (const uid of uids) {
            const article = articles[uid];
            if (!article) continue;

            const parsed = parseSummary(article);
            newlyFetched.push(parsed);
          }
        } catch (err) {
          console.error(`Error fetching batch starting at index ${i}:`, err);
        }

        // Rate-limit delay between batches
        if (i + BATCH_SIZE < uncachedIds.length) {
          await sleep(DELAY_MS);
        }
      }

      // Step 3: Cache newly fetched articles
      if (newlyFetched.length > 0) {
        try {
          // Use a transaction to insert all at once
          const timestamp = new Date().toISOString();
          for (const article of newlyFetched) {
            await db.$executeRaw`
              INSERT OR REPLACE INTO "PubMedArticle" ("pubmedId", title, authors, abstract, journal, "pubYear", "createdAt")
              VALUES (${article.pubmedId}, ${article.title}, ${article.authors}, ${article.abstract}, ${article.journal}, NULL, ${timestamp})
            `;
          }
        } catch (err) {
          console.error('Error caching pubmed articles:', err);
          // Still return results even if caching fails
        }
      }

      results.push(...newlyFetched);
    }

    return NextResponse.json({
      total: validIds.length,
      cached: cachedMap.size,
      fetched: results.length - cachedMap.size,
      articles: results,
    });
  } catch (error) {
    console.error('Error in pubmed-fetch:', error);
    return NextResponse.json(
      { error: 'Failed to fetch PubMed metadata' },
      { status: 500 }
    );
  }
}
