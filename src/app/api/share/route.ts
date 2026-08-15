/**
 * Share Evaluation API — generate / consume share tokens.
 * -------------------------------------------------------------
 *   POST /api/share
 *        body: { uniprotId, expiresInHours?: number }
 *        → { shareId, url, expiresAt }
 *
 *   GET  /api/share/{shareId}        ← handled in [shareId]/route.ts
 *        → { evaluation, sharedAt, expiresAt }
 *        404 if not found or expired
 *
 * Design:
 *  - The Shares table is NOT in the Prisma schema (collaboration feature
 *    added after the schema freeze). We create it lazily with
 *    `CREATE TABLE IF NOT EXISTS` on first access — exactly as the
 *    Comments route does.
 *  - At share-creation time we **snapshot** the evaluation (joined with
 *    its PDB structures + BLAST results) into the `snapshotJson` column.
 *    This makes the shared view immutable: a later re-run of the
 *    evaluation does NOT change what was shared. This is the standard
 *    contract of a "share" feature (cf. Google Docs "share a snapshot"
 *    vs "live share").
 *  - Tokens are random UUIDs (`crypto.randomUUID()`).
 *  - Default expiry: 168 hours (7 days). Max: 8760 hours (1 year).
 *
 * The URL returned is a relative path (`/api/share/{shareId}`). The
 * frontend can resolve it with `window.location.origin` — exactly the
 * pattern used by `src/hooks/use-share-view.ts`.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';
import { db } from '@/lib/db';
import { safeJsonParse } from '@/lib/utils';
import { decodeJsonEscapes } from '@/lib/pdb-utils';

const DEFAULT_EXPIRES_HOURS = 168; // 7 days
const MAX_EXPIRES_HOURS = 24 * 365; // 1 year
const MAX_UNIPROT_ID_LENGTH = 64;

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS Shares (
  shareId       TEXT PRIMARY KEY,
  uniprotId     TEXT NOT NULL,
  snapshotJson  TEXT NOT NULL,
  sharedAt      TEXT NOT NULL,
  expiresAt     TEXT NOT NULL
);
`;

const CREATE_INDEX_SQL = `
CREATE INDEX IF NOT EXISTS idx_shares_expires
  ON Shares(expiresAt);
`;

async function ensureSchema(): Promise<void> {
  await db.$executeRawUnsafe(CREATE_TABLE_SQL);
  await db.$executeRawUnsafe(CREATE_INDEX_SQL);
}

function nowIso(): string {
  return new Date().toISOString();
}

function isoPlusHours(hours: number): string {
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

/**
 * Snapshot the full evaluation (Evaluation row + Pdb structures +
 * BLAST results) as a plain JSON object. Mirrors the shape returned
 * by `GET /api/evaluations/[uniprotId]` so the share-viewer can reuse
 * the same rendering code path.
 */
async function snapshotEvaluation(uniprotId: string): Promise<{
  ok: boolean;
  evaluation: any | null;
  error?: string;
}> {
  const evalRows = await db.$queryRawUnsafe<any[]>(
    `SELECT * FROM Evaluation WHERE uniprotId = ?`,
    uniprotId,
  );
  if (!evalRows || evalRows.length === 0) {
    return { ok: false, evaluation: null, error: 'Evaluation not found' };
  }
  const e = evalRows[0];

  const [pdbRows, blastRows] = await Promise.all([
    db.$queryRawUnsafe<any[]>(
      `SELECT * FROM EvaluationPdbStructure WHERE uniprotId = ? ORDER BY pdbId`,
      uniprotId,
    ),
    db.$queryRawUnsafe<any[]>(
      `SELECT * FROM EvaluationBlastResult WHERE uniprotId = ? ORDER BY id`,
      uniprotId,
    ),
  ]);

  let scoresObj: any = {};
  try {
    scoresObj = e.scores ? JSON.parse(e.scores) : {};
  } catch {
    /* ignore — leave as empty object */
  }

  const evaluation = {
    uniprotId: e.uniprotId,
    entryName: e.entryName ?? null,
    proteinName: decodeJsonEscapes(e.proteinName) ?? '',
    geneNames: e.geneNames ?? '',
    organism: e.organism ?? '',
    sequenceLength: e.sequenceLength ?? null,
    coverage: e.coverage ?? null,
    scores: scoresObj,
    report: e.report ?? '',
    batchId: e.batchId ?? null,
    createdAt: e.createdAt ?? null,
    updatedAt: e.updatedAt ?? null,
    pdbStructures: (pdbRows || []).map((p) => ({
      ...p,
      title: decodeJsonEscapes(p.title),
    })),
    blastResults: (blastRows || []).map((b) => ({
      ...b,
      description: decodeJsonEscapes(b.description),
      title: decodeJsonEscapes(b.title),
      pubmedTitle: decodeJsonEscapes(b.pubmedTitle),
      pubmedAuthors: decodeJsonEscapes(b.pubmedAuthors),
      pubmedAbstract: decodeJsonEscapes(b.pubmedAbstract),
    })),
  };

  return { ok: true, evaluation };
}

// ─── POST /api/share ────────────────────────────────────────────────────
export async function POST(request: NextRequest) {
  try {
    await ensureSchema();

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { error: 'Request body must be a JSON object' },
        { status: 400 },
      );
    }

    const uniprotId =
      typeof body.uniprotId === 'string'
        ? body.uniprotId.trim().toUpperCase()
        : '';
    if (!uniprotId || uniprotId.length > MAX_UNIPROT_ID_LENGTH) {
      return NextResponse.json(
        { error: 'uniprotId is required (and must be ≤ 64 chars)' },
        { status: 400 },
      );
    }

    // Resolve + clamp expiry.
    const rawHours = Number(body.expiresInHours);
    const expiresHours =
      Number.isFinite(rawHours) && rawHours > 0
        ? Math.min(MAX_EXPIRES_HOURS, Math.floor(rawHours))
        : DEFAULT_EXPIRES_HOURS;

    // Snapshot the evaluation. If the evaluation does not exist, refuse
    // to create a share link (there is nothing to share).
    const snap = await snapshotEvaluation(uniprotId);
    if (!snap.ok || !snap.evaluation) {
      return NextResponse.json(
        { error: snap.error || 'Evaluation not found' },
        { status: 404 },
      );
    }

    const shareId = randomUUID();
    const sharedAt = nowIso();
    const expiresAt = isoPlusHours(expiresHours);
    const snapshotJson = JSON.stringify(snap.evaluation);

    await db.$executeRawUnsafe(
      `INSERT INTO Shares (shareId, uniprotId, snapshotJson, sharedAt, expiresAt)
       VALUES (?, ?, ?, ?, ?)`,
      shareId,
      uniprotId,
      snapshotJson,
      sharedAt,
      expiresAt,
    );

    // The URL is relative so the caller (browser) can resolve it with
    // its own origin — this works in dev, prod, and behind the sandbox
    // gateway without any host configuration.
    const url = `/api/share/${shareId}`;

    return NextResponse.json(
      safeJsonParse({ shareId, url, expiresAt, sharedAt }),
      { status: 201 },
    );
  } catch (err: any) {
    console.error('[api/share POST] error:', err);
    return NextResponse.json(
      { error: err?.message || 'Failed to create share link' },
      { status: 500 },
    );
  }
}

/**
 * GET /api/share (no shareId) — list recent share links for diagnostic
 * purposes. Optional `?uniprotId=P04626` filter. Excludes the (large)
 * snapshotJson column. Marks expired rows.
 *
 * The canonical "fetch one share" endpoint is GET /api/share/{shareId}
 * in `[shareId]/route.ts` — this list endpoint is a convenience for
 * admin/debug UIs and is intentionally read-only.
 */
export async function GET(request: NextRequest) {
  try {
    await ensureSchema();

    const sp = request.nextUrl.searchParams;
    const uniprotId = sp.get('uniprotId')?.trim().toUpperCase() || null;

    const limitRaw = Number(sp.get('limit') ?? '50');
    const limit = Number.isFinite(limitRaw)
      ? Math.min(500, Math.max(1, Math.floor(limitRaw)))
      : 50;

    let rows: any[];
    if (uniprotId) {
      rows = await db.$queryRawUnsafe<any[]>(
        `SELECT shareId, uniprotId, sharedAt, expiresAt
         FROM Shares
         WHERE uniprotId = ?
         ORDER BY sharedAt DESC
         LIMIT ?`,
        uniprotId,
        limit,
      );
    } else {
      rows = await db.$queryRawUnsafe<any[]>(
        `SELECT shareId, uniprotId, sharedAt, expiresAt
         FROM Shares
         ORDER BY sharedAt DESC
         LIMIT ?`,
        limit,
      );
    }

    const now = Date.now();
    const shares = rows.map((r) => ({
      shareId: String(r.shareId),
      uniprotId: String(r.uniprotId),
      sharedAt: String(r.sharedAt),
      expiresAt: String(r.expiresAt),
      expired: new Date(r.expiresAt).getTime() < now,
      url: `/api/share/${r.shareId}`,
    }));

    return NextResponse.json(safeJsonParse({ shares }));
  } catch (err: any) {
    console.error('[api/share GET list] error:', err);
    return NextResponse.json(
      { error: err?.message || 'Failed to list shares', shares: [] },
      { status: 500 },
    );
  }
}
