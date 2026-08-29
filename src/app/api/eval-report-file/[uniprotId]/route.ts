import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** R179 (Task 2-a): 安全解析 JSON 列（outline / figures），失败返回 null。 */
function tryParseJson(raw: unknown): unknown | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ uniprotId: string }> }) {
  try {
    const { uniprotId } = await params;
    const report = await db.skillEvaluationReport.findFirst({ where: { uniprotId }, orderBy: { createdAt: 'desc' } });
    if (!report || !report.report) {
      const evalRow = await db.$queryRaw<any[]>`SELECT uniprotId, proteinName, report FROM Evaluation WHERE uniprotId = ${uniprotId}`;
      if (evalRow.length > 0 && evalRow[0].report) {
        return NextResponse.json({ uniprotId, proteinName: evalRow[0].proteinName, filename: `${uniprotId}_evaluation.md`, content: evalRow[0].report, source: 'Evaluation table', mode: 'classic' });
      }
      return NextResponse.json({ error: `Evaluation report not found for ${uniprotId}` }, { status: 404 });
    }
    // R179 (Task 2-a): 返回 mode / outline / figures（向后兼容 —— Prisma
    // client 过旧未含新列时 fallback 读 'classic'；outline/figures 解析失败
    // 返回 null 而非报错）。
    const mode = (report as any).mode || 'classic';
    const outline = tryParseJson((report as any).outline);
    const figures = tryParseJson((report as any).figures);
    return NextResponse.json({
      uniprotId,
      proteinName: report.proteinName,
      filename: report.filePath || `${uniprotId}_evaluation.md`,
      content: report.report,
      llmModel: report.llmModel,
      llmOk: report.llmOk,
      overallScore: report.overallScore,
      createdAt: report.createdAt.toISOString(),
      source: 'SkillEvaluationReport table',
      mode,
      ...(outline != null ? { outline } : {}),
      ...(figures != null ? { figures } : {}),
    });
  } catch (error: any) {
    console.error('[eval-report-file] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch evaluation report: ' + (error?.message || 'unknown') }, { status: 500 });
  }
}
