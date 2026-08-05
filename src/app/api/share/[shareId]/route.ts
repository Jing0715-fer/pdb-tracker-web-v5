/**
 * GET /api/share/{shareId} — consume a share token.
 * -------------------------------------------------------------
 * Returns:  { evaluation, sharedAt, expiresAt }
 *   404 if not found OR expired.
 *
 * The `evaluation` payload is the snapshot captured at share-creation
 * time (see `src/app/api/share/route.ts` POST handler) — it is a plain
 * JSON object stored in the `snapshotJson` TEXT column of the Shares
 * table, so this endpoint does NOT touch the Evaluation table on read.
 * That guarantees the shared view is immutable.
 *
 * The route handler signature uses the Next.js 15+ convention where
 * `params` is a Promise that must be awaited.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { safeJsonParse } from '@/lib/utils';

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS Shares (
  shareId       TEXT PRIMARY KEY,
  uniprotId     TEXT NOT NULL,
  snapshotJson  TEXT NOT NULL,
  sharedAt      TEXT NOT NULL,
  expiresAt     TEXT NOT NULL
);
`;

async function ensureSchema(): Promise<void> {
  await db.$executeRawUnsafe(CREATE_TABLE_SQL);
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ shareId: string }> },
) {
  try {
    await ensureSchema();

    const { shareId } = await params;
    if (!shareId || typeof shareId !== 'string') {
      return NextResponse.json(
        { error: 'Missing shareId in path' },
        { status: 400 },
      );
    }

    const rows = await db.$queryRawUnsafe<any[]>(
      `SELECT shareId, uniprotId, snapshotJson, sharedAt, expiresAt
       FROM Shares
       WHERE shareId = ?
       LIMIT 1`,
      shareId,
    );

    if (!rows || rows.length === 0) {
      return NextResponse.json(
        { error: 'Share not found' },
        { status: 404 },
      );
    }

    const row = rows[0];
    const expiresAt = String(row.expiresAt);
    const expiresMs = new Date(expiresAt).getTime();
    if (!Number.isFinite(expiresMs) || expiresMs < Date.now()) {
      // Expired — return 404 (not 410) so callers can treat "missing"
      // and "expired" identically with a single code path. We do NOT
      // auto-delete the row here; a periodic cleanup job can sweep
      // expired rows based on the `expiresAt` index.
      return NextResponse.json(
        { error: 'Share not found or expired' },
        { status: 404 },
      );
    }

    // Parse the immutable snapshot.
    let evaluation: unknown = null;
    try {
      evaluation = JSON.parse(String(row.snapshotJson));
    } catch {
      // Corrupt snapshot — treat as not found rather than 500.
      return NextResponse.json(
        { error: 'Share snapshot is corrupt' },
        { status: 500 },
      );
    }

    return NextResponse.json(
      safeJsonParse({
        shareId: String(row.shareId),
        uniprotId: String(row.uniprotId),
        evaluation,
        sharedAt: String(row.sharedAt),
        expiresAt,
      }),
    );
  } catch (err: any) {
    console.error('[api/share/[shareId] GET] error:', err);
    return NextResponse.json(
      { error: err?.message || 'Failed to fetch share' },
      { status: 500 },
    );
  }
}
