import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(request: NextRequest) {
  try {
    // Probe: if the table doesn't exist yet (first run), return empty array
    try {
      await db.$queryRaw`SELECT 1 FROM EvaluationReport LIMIT 1`;
    } catch {
      return NextResponse.json([]);
    }

    const reports = await db.evaluationReport.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        uniprotId: true,
        title: true,
        createdAt: true,
      },
    });

    return NextResponse.json(reports);
  } catch (error) {
    console.error('Error fetching evaluation reports:', error);
    return NextResponse.json([]);
  }
}