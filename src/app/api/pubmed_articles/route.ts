import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const articles = await db.$queryRaw<any[]>`
      SELECT "pubmedId", title, authors, journal, "pubYear" as "pubYear", abstract
      FROM "PubMedArticle"
      WHERE "pubmedId" IS NOT NULL AND "pubmedId" != ''
    `;

    const articleMap: Record<string, { title: string; authors: string; journal: string; pubYear: string; abstract: string }> = {};
    for (const a of articles) {
      articleMap[a.pubmedId] = {
        title: a.title || '',
        authors: a.authors || '',
        journal: a.journal || '',
        pubYear: a.pubYear || '',
        abstract: a.abstract || '',
      };
    }

    return NextResponse.json(articleMap);
  } catch (error) {
    console.error('Error fetching pubmed articles:', error);
    return NextResponse.json({ error: 'Failed to fetch pubmed articles' }, { status: 500 });
  }
}