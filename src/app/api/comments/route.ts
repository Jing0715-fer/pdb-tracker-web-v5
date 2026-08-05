/**
 * Comments API — collaboration on evaluations (and other targets).
 * -----------------------------------------------------------------
 *   GET    /api/comments?targetType=evaluation&targetId=P04626
 *          → { comments: Comment[] }
 *
 *   POST   /api/comments
 *          body: { targetType, targetId, author, content }
 *          → { comment: Comment }
 *
 *   DELETE /api/comments?id=N
 *          → { ok: true }
 *
 * Comment shape:
 *   { id, targetType, targetId, author, content, createdAt, updatedAt }
 *
 * The Comments table does NOT exist in the Prisma schema (it is a
 * collaboration feature added after the initial schema freeze), so we
 * create it lazily with `CREATE TABLE IF NOT EXISTS` on first access.
 * All access is via raw SQL through `db.$queryRawUnsafe` /
 * `db.$executeRawUnsafe` — exactly as the task spec requires.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { safeJsonParse } from '@/lib/utils';

const MAX_CONTENT_LENGTH = 8000;
const MAX_AUTHOR_LENGTH = 200;
const MAX_TARGET_TYPE_LENGTH = 64;
const MAX_TARGET_ID_LENGTH = 128;

/**
 * SQLite uses dynamic typing, but we want a stable on-disk schema so
 * external tools (and a future Prisma migration) can read it.
 *
 * NOTE: SQLite stores `TEXT` for dates — we use ISO 8601 UTC strings.
 */
const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS Comments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  targetType  TEXT NOT NULL,
  targetId    TEXT NOT NULL,
  author      TEXT NOT NULL,
  content     TEXT NOT NULL,
  createdAt   TEXT NOT NULL,
  updatedAt   TEXT NOT NULL
);
`;

const CREATE_INDEX_SQL = `
CREATE INDEX IF NOT EXISTS idx_comments_target
  ON Comments(targetType, targetId);
`;

/** Idempotently create the Comments table + index. */
async function ensureSchema(): Promise<void> {
  await db.$executeRawUnsafe(CREATE_TABLE_SQL);
  await db.$executeRawUnsafe(CREATE_INDEX_SQL);
}

interface CommentRow {
  id: number;
  targetType: string;
  targetId: string;
  author: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

/** Map a raw SQLite row to the public Comment shape. */
function toComment(row: any): CommentRow {
  return {
    id: Number(row.id),
    targetType: String(row.targetType ?? ''),
    targetId: String(row.targetId ?? ''),
    author: String(row.author ?? ''),
    content: String(row.content ?? ''),
    createdAt: String(row.createdAt ?? ''),
    updatedAt: String(row.updatedAt ?? ''),
  };
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Truncate + trim a string field, returning null if it ends up empty. */
function clean(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

// ─── GET ────────────────────────────────────────────────────────────────
export async function GET(request: NextRequest) {
  try {
    await ensureSchema();

    const sp = request.nextUrl.searchParams;
    const targetType = sp.get('targetType');
    const targetId = sp.get('targetId');

    // Optional limit (default 200, max 1000) — kept small because UIs
    // rarely render more than a few hundred comments at once.
    const limitRaw = Number(sp.get('limit') ?? '200');
    const limit = Number.isFinite(limitRaw)
      ? Math.min(1000, Math.max(1, Math.floor(limitRaw)))
      : 200;

    let rows: any[];
    if (targetType && targetId) {
      rows = await db.$queryRawUnsafe<any[]>(
        `SELECT id, targetType, targetId, author, content, createdAt, updatedAt
         FROM Comments
         WHERE targetType = ? AND targetId = ?
         ORDER BY createdAt ASC
         LIMIT ?`,
        targetType,
        targetId,
        limit,
      );
    } else if (targetType) {
      rows = await db.$queryRawUnsafe<any[]>(
        `SELECT id, targetType, targetId, author, content, createdAt, updatedAt
         FROM Comments
         WHERE targetType = ?
         ORDER BY createdAt DESC
         LIMIT ?`,
        targetType,
        limit,
      );
    } else {
      rows = await db.$queryRawUnsafe<any[]>(
        `SELECT id, targetType, targetId, author, content, createdAt, updatedAt
         FROM Comments
         ORDER BY createdAt DESC
         LIMIT ?`,
        limit,
      );
    }

    const comments = rows.map(toComment);
    return NextResponse.json(safeJsonParse({ comments }));
  } catch (err: any) {
    console.error('[api/comments GET] error:', err);
    return NextResponse.json(
      { error: err?.message || 'Failed to fetch comments', comments: [] },
      { status: 500 },
    );
  }
}

// ─── POST ───────────────────────────────────────────────────────────────
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

    const targetType = clean(body.targetType, MAX_TARGET_TYPE_LENGTH);
    const targetId = clean(body.targetId, MAX_TARGET_ID_LENGTH);
    const author = clean(body.author, MAX_AUTHOR_LENGTH) ?? 'anonymous';
    const content = clean(body.content, MAX_CONTENT_LENGTH);

    // Validate required fields.
    const missing: string[] = [];
    if (!targetType) missing.push('targetType');
    if (!targetId) missing.push('targetId');
    if (!content) missing.push('content');
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Missing required field(s): ${missing.join(', ')}` },
        { status: 400 },
      );
    }

    const now = nowIso();
    const result = await db.$executeRawUnsafe(
      `INSERT INTO Comments (targetType, targetId, author, content, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?)`,
      targetType,
      targetId,
      author,
      content,
      now,
      now,
    );

    // `result` is the number of affected rows (1 on success). Retrieve
    // the inserted row via last_insert_rowid() — this lets us return
    // the authoritative row (including any column defaults / triggers).
    const rows = await db.$queryRawUnsafe<any[]>(
      `SELECT id, targetType, targetId, author, content, createdAt, updatedAt
       FROM Comments
       WHERE id = last_insert_rowid()`,
    );
    if (!rows || rows.length === 0) {
      // Should never happen, but be defensive.
      return NextResponse.json(
        {
          comment: {
            id: Number(result) || 0,
            targetType,
            targetId,
            author,
            content,
            createdAt: now,
            updatedAt: now,
          },
        },
        { status: 201 },
      );
    }

    return NextResponse.json(
      safeJsonParse({ comment: toComment(rows[0]) }),
      { status: 201 },
    );
  } catch (err: any) {
    console.error('[api/comments POST] error:', err);
    return NextResponse.json(
      { error: err?.message || 'Failed to create comment' },
      { status: 500 },
    );
  }
}

// ─── DELETE ─────────────────────────────────────────────────────────────
export async function DELETE(request: NextRequest) {
  try {
    await ensureSchema();

    const sp = request.nextUrl.searchParams;
    const idParam = sp.get('id');
    if (!idParam) {
      return NextResponse.json(
        { error: 'Missing required query param: id' },
        { status: 400 },
      );
    }
    const id = Number(idParam);
    if (!Number.isFinite(id) || id <= 0) {
      return NextResponse.json(
        { error: 'id must be a positive integer' },
        { status: 400 },
      );
    }

    const affected = await db.$executeRawUnsafe(
      `DELETE FROM Comments WHERE id = ?`,
      id,
    );
    // `affected` is 0 if the row did not exist — we still return ok:true
    // because DELETE is idempotent and the caller's desired end state
    // (no row with that id) is achieved either way.
    return NextResponse.json(safeJsonParse({ ok: true, deleted: Number(affected) }));
  } catch (err: any) {
    console.error('[api/comments DELETE] error:', err);
    return NextResponse.json(
      { error: err?.message || 'Failed to delete comment' },
      { status: 500 },
    );
  }
}
