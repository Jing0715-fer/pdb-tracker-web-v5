/**
 * GET /api/skill-runs/[id]/log
 *
 * Returns the full SSE log for a single SkillRunRecord (NDJSON, 1 event
 * per line). The log is accumulated by each route handler (`emit` wrapper
 * in eval/literature/weekly routes) and persisted to SkillRunRecord.log
 * when the run finishes.
 *
 * Response:
 *   { id, log: string|null, lines: number, bytes: number }
 *
 * If the run has no log (older record from before the field was added),
 * `log` is null and `lines: 0`.
 */
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const row = await db.skillRunRecord.findUnique({
      where: { id },
      select: { id: true, log: true },
    });
    if (!row) {
      return Response.json({ error: 'SkillRunRecord not found: ' + id }, { status: 404 });
    }
    const log = row.log ?? null;
    const lines = log ? log.split('\n').length : 0;
    return Response.json({ id: row.id, log, lines, bytes: log ? log.length : 0 });
  } catch (err: any) {
    return Response.json({ error: err?.message ?? 'unknown' }, { status: 500 });
  }
}
