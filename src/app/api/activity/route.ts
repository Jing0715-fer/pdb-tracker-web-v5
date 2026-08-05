import { NextResponse } from 'next/server';
import { db } from '@/lib/db';

export interface ActivityItem {
  id: string;
  type: 'new_structure' | 'new_paper' | 'new_evaluation' | 'report_published';
  title: string;
  description: string;
  timestamp: string;
  relatedId: string;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = Math.min(Math.max(parseInt(searchParams.get('limit') || '20', 10), 1), 100);

    const activities: ActivityItem[] = [];

    // 1. New structures — from PdbStructure with releaseDate
    const structures = await db.pdbStructure.findMany({
      select: {
        pdbId: true,
        title: true,
        method: true,
        releaseDate: true,
        journalIf: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    for (const s of structures) {
      const methodLabel = s.method?.includes('CRYO') ? 'Cryo-EM'
        : s.method?.includes('X-RAY') ? 'X-ray'
        : s.method?.includes('NMR') ? 'NMR'
        : s.method || 'Unknown';
      const ifNote = s.journalIf != null ? ` (IF: ${s.journalIf.toFixed(1)})` : '';
      activities.push({
        id: `struct-${s.pdbId}`,
        type: 'new_structure',
        title: `${s.pdbId} — ${methodLabel} structure`,
        description: (s.title || 'Untitled structure').slice(0, 120) + ifNote,
        timestamp: s.releaseDate || s.createdAt.toISOString(),
        relatedId: s.pdbId,
      });
    }

    // 2. New papers — from PubMedArticle (use raw query because SQLite
    //    stores datetime as "YYYY-MM-DD HH:MM:SS" which Prisma can't parse)
    const papers = await db.$queryRaw<any[]>`
      SELECT "pubmedId", title, journal, "pubYear",
             strftime('%Y-%m-%dT%H:%M:%fZ', "createdAt") as "createdAt"
      FROM "PubMedArticle"
      ORDER BY "createdAt" DESC
      LIMIT ${limit}
    `;

    for (const p of papers) {
      activities.push({
        id: `paper-${p.pubmedId}`,
        type: 'new_paper',
        title: `New paper — ${p.journal || 'Unknown Journal'}`,
        description: (p.title || 'Untitled paper').slice(0, 120),
        timestamp: p.createdAt,
        relatedId: p.pubmedId,
      });
    }

    // 3. New evaluations — from Evaluation
    const evals = await db.evaluation.findMany({
      select: {
        uniprotId: true,
        proteinName: true,
        organism: true,
        coverage: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    for (const e of evals) {
      const coverageNote = e.coverage != null ? ` (${(e.coverage * 100).toFixed(0)}% coverage)` : '';
      activities.push({
        id: `eval-${e.uniprotId}`,
        type: 'new_evaluation',
        title: `Evaluation: ${e.proteinName || e.uniprotId}`,
        description: `${e.organism || 'Unknown organism'}${coverageNote}`,
        timestamp: e.createdAt.toISOString(),
        relatedId: e.uniprotId,
      });
    }

    // 4. Published reports — from WeeklyReport (use raw SQL to handle nullable createdAt)
    const reports: any[] = await db.$queryRaw`
      SELECT id, weekId, title, reportType, createdAt
      FROM WeeklyReport
      WHERE createdAt IS NOT NULL
      ORDER BY createdAt DESC
      LIMIT ${limit}
    `;

    for (const r of reports) {
      activities.push({
        id: `report-${r.id}`,
        type: 'report_published',
        title: `Report: ${r.title || r.weekId || 'Weekly Report'}`,
        description: `${r.reportType || 'Weekly'} report for ${r.weekId || 'N/A'}`,
        timestamp: r.createdAt ? new Date(r.createdAt).toISOString() : new Date().toISOString(),
        relatedId: r.weekId || String(r.id),
      });
    }

    // Sort all activities by timestamp descending
    activities.sort((a, b) => {
      const dateA = new Date(a.timestamp).getTime();
      const dateB = new Date(b.timestamp).getTime();
      return dateB - dateA;
    });

    // Apply limit
    const result = activities.slice(0, limit);

    return NextResponse.json(result);
  } catch (error) {
    console.error('Failed to fetch activity feed:', error);
    return NextResponse.json({ error: 'Failed to fetch activity feed' }, { status: 500 });
  }
}
