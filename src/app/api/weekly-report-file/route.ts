import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const weekId = searchParams.get('weekId');
    if (!weekId) return NextResponse.json({ error: 'weekId is required' }, { status: 400 });
    const run = await db.weeklyReportRun.findFirst({ where: { weekId }, orderBy: { createdAt: 'desc' } });
    if (!run) return NextResponse.json({ error: 'Weekly report not found for ' + weekId }, { status: 404 });
    let cycles: any[] = [];
    try { cycles = run.cyclesJson ? JSON.parse(run.cyclesJson) : []; } catch { cycles = []; }
    const filesWritten = (run.filesWritten || '').split('\n').filter(Boolean);
    const providers = run.providers || 'cli:hermes';
    const duration = run.durationMs ? `${(run.durationMs / 1000).toFixed(1)}s` : 'unknown';

    // ── Extract per-method report content from cycles ──
    // New format: cycles contain entries with role='cryoem' or role='xray',
    // each with a full 8-chapter merged report in .content.
    // Old format: cycles contain role='generator'/'synthesis' — fall back to
    // that for backward compat with runs created before the refactor.
    const cryoemCycle = cycles.find((c: any) => c.role === 'cryoem' && c.content);
    const xrayCycle = cycles.find((c: any) => c.role === 'xray' && c.content);

    // Backward compat: old runs used 'synthesis'/'generator' roles with a
    // single combined report. If no per-method content, use that for both.
    const synthesisCycle = cycles.find((c: any) => c.role === 'synthesis' && c.content);
    const generatorCycle = cycles.find((c: any) => c.role === 'generator' && c.content);
    const legacyContent = synthesisCycle?.content || generatorCycle?.content || (cycles.length > 0 ? (cycles[cycles.length - 1].content || cycles[0]?.content || '') : '');

    const cryoemContent = cryoemCycle?.content || legacyContent || '';
    const xrayContent = xrayCycle?.content || legacyContent || '';

    // Build method-specific report wrappers with metadata header
    const buildReportHeader = (type: string, label: string) =>
      `# ${label} 结构解析周报 — ${weekId}\n\n**报告日期**: ${weekId}\n**类型**: ${label}\n**LLM 提供方**: ${providers}\n**耗时**: ${duration}\n**生成时间**: ${run.createdAt.toISOString()}\n\n---\n\n`;
    const buildReportFooter = `\n\n---\n\n*本报告由 PDB Tracker 运行中心自动生成 · 数据来源: RCSB PDB*\n*生成时间: ${run.createdAt.toISOString()}*\n`;

    const files = [
      { filename: `${weekId}_xray_report.md`, content: buildReportHeader('xray', 'X-ray') + (xrayContent || '（无报告内容 — LLM 生成失败或本周无 X-ray 结构）') + buildReportFooter, type: 'xray' },
      { filename: `${weekId}_cryoem_report.md`, content: buildReportHeader('cryoem', 'Cryo-EM') + (cryoemContent || '（无报告内容 — LLM 生成失败或本周无 Cryo-EM 结构）') + buildReportFooter, type: 'cryoem' },
    ];

    return NextResponse.json({
      weekId,
      files,
      cycles: cycles.length,
      cryoemContent,
      xrayContent,
      finalContent: cryoemContent || xrayContent, // backward compat
      cryoemChaptersOk: cryoemCycle?.chaptersOk,
      cryoemChaptersFailed: cryoemCycle?.chaptersFailed,
      xrayChaptersOk: xrayCycle?.chaptersOk,
      xrayChaptersFailed: xrayCycle?.chaptersFailed,
      createdAt: run.createdAt.toISOString(),
    });
  } catch (error: any) {
    console.error('[weekly-report-file] Error:', error);
    return NextResponse.json({ error: 'Failed to fetch weekly report: ' + (error?.message || 'unknown') }, { status: 500 });
  }
}
