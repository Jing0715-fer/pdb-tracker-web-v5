import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { safeJsonParse } from '@/lib/utils';

export async function GET() {
  try {
    const structureCounts = await db.$queryRaw<any[]>`
      SELECT weekId,
             CAST(COUNT(*) AS TEXT) as totalStructures,
             CAST(SUM(CASE WHEN method LIKE '%Cryo-EM%' OR method LIKE '%ELECTRON MICROSCOPY%' OR method LIKE '%CRYO-EM%' THEN 1 ELSE 0 END) AS TEXT) as cryoemCount,
             CAST(SUM(CASE WHEN method LIKE '%X-RAY%' OR method LIKE '%XRAY%' THEN 1 ELSE 0 END) AS TEXT) as xrayCount,
             CAST(SUM(CASE WHEN method LIKE '%NMR%' OR method LIKE '%SOLUTION NMR%' THEN 1 ELSE 0 END) AS TEXT) as nmrCount,
             CAST(SUM(CASE WHEN method NOT LIKE '%Cryo-EM%' AND method NOT LIKE '%ELECTRON MICROSCOPY%' AND method NOT LIKE '%CRYO-EM%' AND method NOT LIKE '%X-RAY%' AND method NOT LIKE '%XRAY%' AND method NOT LIKE '%NMR%' AND method NOT LIKE '%SOLUTION NMR%' THEN 1 ELSE 0 END) AS TEXT) as otherCount,
             MIN(releaseDate) as minDate,
             MAX(releaseDate) as maxDate
      FROM PdbStructure
      WHERE weekId IS NOT NULL
      GROUP BY weekId
    `;

    const weekNums: Record<string, number> = {};
    for (const s of structureCounts) {
      const wmatch = s.weekId.match(/W(\d+)/);
      weekNums[s.weekId] = wmatch ? parseInt(wmatch[1]) : 0;
    }

    const result = structureCounts
      .sort((a, b) => {
        const datecmp = (b.maxDate || '').localeCompare(a.minDate || '');
        if (datecmp !== 0) return datecmp;
        return (weekNums[b.weekId] || 0) - (weekNums[a.weekId] || 0);
      })
      .map(s => {
        const maxDate = s.maxDate || s.weekId;
        const endDate = new Date(maxDate);
        const startDate = new Date(endDate);
        startDate.setDate(startDate.getDate() - 6);
        const fmt = (d: Date) => d.toISOString().slice(0, 10);
        return {
          weekId: s.weekId,
          weekStart: fmt(startDate),
          weekEnd: fmt(endDate),
          totalStructures: parseInt(s.totalStructures, 10) || 0,
          cryoemCount: parseInt(s.cryoemCount, 10) || 0,
          xrayCount: parseInt(s.xrayCount, 10) || 0,
          nmrCount: parseInt(s.nmrCount, 10) || 0,
          otherCount: parseInt(s.otherCount, 10) || 0,
          createdAt: s.maxDate,
        };
      });

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error fetching snapshots:', error);
    return NextResponse.json([], { status: 500 });
  }
}
