/**
 * GET /api/literature/daily/reports
 *
 * List past daily literature digests. Fetches from the LiteratureDigest table
 * (where the literature module writes its LLM digests) so the Run Center's
 * history-report click can display the stored digest content.
 */

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const rows = await db.$queryRaw<any[]>`
      SELECT date, paperCount, digest, llmOk, llmProvider, llmModel
      FROM LiteratureDigest
      ORDER BY date DESC
      LIMIT 90
    `;
    const reports = (rows as any[]).map(r => ({
      date: r.date,
      weekId: r.date,
      content: r.digest || '',
      paperCount: r.paperCount,
      hasLLMDigest: r.llmOk === 1 || r.llmOk === true,
      provider: r.llmProvider,
      model: r.llmModel,
    }));
    return NextResponse.json(reports);
  } catch (e: any) {
    console.error('[literature/daily/reports] error', e);
    return NextResponse.json({ error: e?.message || 'fetch failed' }, { status: 500 });
  }
}

