import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest, { params }: { params: Promise<{ uniprotId: string }> }) {
  try {
    const { uniprotId } = await params;
    const report = await db.skillEvaluationReport.findFirst({ where: { uniprotId }, orderBy: { createdAt: 'desc' } });
    if (!report || !report.report) {
      const evalRow = await db.$queryRaw<any[]>`SELECT uniprotId, proteinName, report FROM Evaluation WHERE uniprotId = ${uniprotId}`;
      if (evalRow.length > 0 && evalRow[0].report) {
        return NextResponse.json({ uniprotId, proteinName: evalRow[0].proteinName, filename: `${uniprotId}_evaluation.md`, content: evalRow[0].report, source: 'Evaluation table' });
      }
      return NextResponse.json({ error: `Evaluation report not found for ${uniprotId}` }, { status: 404 });
    }
    return NextResponse.json({ uniprotId, proteinName: report.proteinName, filename: report.filePath || `${uniprotId}_evaluation.md`, content: report.report, llmModel: report.llmModel, llmOk: report.llmOk, overallScore: report.overallScore, createdAt: report.createdAt.toISOString(), source: 'SkillEvaluationReport table' });
  } catch (error: any) {
    console.error('[eval-report-file] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch evaluation report: ' + (error?.message || 'unknown') }, { status: 500 });
  }
}
