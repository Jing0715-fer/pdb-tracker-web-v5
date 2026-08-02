/**
 * GET /api/skill-runs/digests
 *
 * Returns persisted LiteratureDigest rows (module ① LLM digests) from Prisma,
 * most recent first. Used by the "历史记录" panel to show real DB-persisted
 * LLM output.
 */
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const rows = await db.literatureDigest.findMany({
      orderBy: { date: 'desc' },
      take: 20,
    });
    return Response.json({
      digests: rows.map(r => ({
        id: r.id,
        date: r.date,
        paperCount: r.paperCount,
        methodStats: r.methodStats,
        digest: r.digest,
        llmOk: r.llmOk,
        llmProvider: r.llmProvider,
        llmModel: r.llmModel,
        llmDurationMs: r.llmDurationMs,
        filePath: r.filePath,
        createdAt: r.createdAt.toISOString(),
      })),
    });
  } catch (err: any) {
    console.error('[skill-runs/digests] prisma read failed:', err);
    return Response.json({ digests: [], error: err?.message });
  }
}
