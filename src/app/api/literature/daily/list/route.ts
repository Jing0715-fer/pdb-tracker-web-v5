/**
 * GET /api/literature/daily/list
 *
 * Lists previously generated daily literature reports from the LiteratureDigest
 * table. Returns dates with paper counts and LLM digest availability for the
 * Run Center's "历史报告" strip.
 */
import { db } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const rows = await db.$queryRaw<any[]>`
      SELECT date, paperCount, llmOk
      FROM LiteratureDigest
      ORDER BY date DESC
      LIMIT 30
    `;
    const reports = (rows as any[]).map(r => ({
      date: r.date,
      paperCount: r.paperCount || 0,
      hasLLMDigest: r.llmOk === 1 || r.llmOk === true,
    }));
    return Response.json({ reports });
  } catch {
    // Table might not exist yet (fresh DB) — return empty list.
    return Response.json({ reports: [] });
  }
}
