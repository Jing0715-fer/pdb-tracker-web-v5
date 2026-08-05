import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const idNum = parseInt(id, 10);
    
    const report = !isNaN(idNum)
      ? await db.evaluationReport.findUnique({ where: { id: idNum } })
      : await db.evaluationReport.findFirst({ where: { uniprotId: id } });

    if (!report) {
      return NextResponse.json({ error: 'Evaluation report not found' }, { status: 404 });
    }

    return NextResponse.json(report);
  } catch (error) {
    console.error('Error fetching evaluation report:', error);
    return NextResponse.json({ error: 'Failed to fetch evaluation report' }, { status: 500 });
  }
}