import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    const rows = await db.$queryRaw<{
      date: string;
      count: string;
      cryoemCount: string;
      xrayCount: string;
      nmrCount: string;
    }[]>`
      SELECT
        releaseDate as date,
        CAST(COUNT(*) AS TEXT) as count,
        CAST(SUM(CASE WHEN method LIKE '%Cryo-EM%' OR method LIKE '%ELECTRON MICROSCOPY%' THEN 1 ELSE 0 END) AS TEXT) as cryoemCount,
        CAST(SUM(CASE WHEN method LIKE '%X-RAY%' OR method LIKE '%XRAY%' THEN 1 ELSE 0 END) AS TEXT) as xrayCount,
        CAST(SUM(CASE WHEN method LIKE '%NMR%' THEN 1 ELSE 0 END) AS TEXT) as nmrCount
      FROM PdbStructure
      WHERE releaseDate IS NOT NULL AND releaseDate != ''
      GROUP BY releaseDate
      ORDER BY releaseDate DESC
    `;

    const dailyCounts = rows.map(r => ({
      date: r.date,
      count: parseInt(r.count, 10),
      cryoemCount: parseInt(r.cryoemCount, 10),
      xrayCount: parseInt(r.xrayCount, 10),
      nmrCount: parseInt(r.nmrCount, 10),
    }));

    return NextResponse.json(dailyCounts);
  } catch (error) {
    console.error('Error fetching daily counts:', error);
    return NextResponse.json({ error: 'Failed to fetch daily counts' }, { status: 500 });
  }
}
