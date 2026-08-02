/**
 * GET /api/skill-runs/history
 *
 * Returns recent SkillRunRecord rows from Prisma, optionally filtered by module.
 * Query: ?module=literature|eval|weekly  &limit=50
 */
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mod = url.searchParams.get('module') || undefined;
  const limit = Math.min(Number(url.searchParams.get('limit') || 50), 200);

  try {
    const where = mod && ['literature', 'eval', 'weekly'].includes(mod) ? { module: mod } : undefined;
    const rows = await db.skillRunRecord.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return Response.json({
      runs: rows.map(r => ({
        id: r.id,
        module: r.module,
        status: r.status,
        summary: r.summary,
        provider: r.provider,
        model: r.model,
        llmOk: r.llmOk,
        llmFallback: r.llmFallback,
        llmError: r.llmError,
        durationMs: r.durationMs,
        // Surface log size so the Run Center UI can show a "View Log"
        // button only when the run actually persisted a log. The full
        // log itself is fetched lazily from /api/skill-runs/[id]/log.
        logBytes: r.log ? r.log.length : 0,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (err: any) {
    console.error('[skill-runs/history] prisma read failed:', err);
    return Response.json({ runs: [], error: err?.message });
  }
}
