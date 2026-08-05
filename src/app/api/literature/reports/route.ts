import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { safeJsonParse } from '@/lib/utils';

export async function GET() {
  try {
    // Group articles by pubYear to form report groups
    const reportGroups = await db.$queryRaw<any[]>`
      SELECT
        COALESCE(pubYear, CAST(substr(createdAt, 1, 4) AS TEXT)) as reportDate,
        CAST(COUNT(*) AS TEXT) as paperCount,
        MIN(createdAt) as createdAt
      FROM PubMedArticle
      GROUP BY reportDate
      ORDER BY reportDate DESC
    `;

    const reports = reportGroups.map((g, idx) => ({
      id: idx + 1,
      date: g.reportDate || '',
      paperCount: parseInt(g.paperCount, 10) || 0,
      createdAt: g.createdAt || '',
      title: `Literature Report - ${g.reportDate || 'Unknown'}`,
      summary: `${parseInt(g.paperCount, 10) || 0} articles published in ${g.reportDate || 'unknown period'}.`,
    }));

    return NextResponse.json(safeJsonParse(reports));
  } catch (error) {
    console.error('Error fetching literature reports:', error);
    return NextResponse.json([], { status: 500 });
  }
}
