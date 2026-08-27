/**
 * GET  /api/db-config              — read current database config + live status
 * POST /api/db-config              — update database path (recreates client immediately)
 *        body: { dbPath: string, create?: boolean, initSchema?: boolean }
 * POST /api/db-config?action=init  — initialize schema on the active DB (prisma db push)
 *
 * The path written here is the SINGLE source of truth consumed by
 * `src/lib/db.ts` → `resolveDbUrl()`. All 3 skill modules (literature /
 * eval / weekly) and all 510+ read-only components read through the same
 * `db` Proxy, so once the path is swapped + client recreated, every module
 * sees the same database.
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextRequest, NextResponse } from 'next/server'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import {
  DEFAULT_TEST_DB_PATH,
  normalizeDbUrl,
  resolveDbUrl,
  getActiveDbFsPath,
  isActiveDbTest,
  recreatePrismaClient,
} from '@/lib/db'
import { db } from '@/lib/db'
import { ensureSchemaCompat, type SchemaCompatResult } from '@/lib/schema-compat'
import { dbConfigFile, dbDir, defaultTestDbPath, writableRoot } from '@/lib/paths'

const execAsync = promisify(exec)
const CONFIG_FILE = dbConfigFile()
const TEST_DB_ABS = defaultTestDbPath()

interface DbConfig {
  dbPath: string
  /** ISO timestamp of last write — purely informational. */
  updatedAt?: string
  /** Whether this path was user-confirmed (passed the setup wizard). */
  confirmed?: boolean
}

async function readConfig(): Promise<DbConfig | null> {
  try {
    const raw = await fs.readFile(CONFIG_FILE, 'utf-8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function writeConfig(cfg: DbConfig): Promise<void> {
  await fs.mkdir(path.dirname(CONFIG_FILE), { recursive: true })
  await fs.writeFile(CONFIG_FILE, JSON.stringify({ ...cfg, updatedAt: new Date().toISOString() }, null, 2), 'utf-8')
}

/** Return true if the SQLite file at `fsPath` contains all expected tables. */
async function checkSchema(fsPath: string): Promise<{ exists: boolean; hasSchema: boolean; tableCount: number; tables: string[]; error?: string }> {
  const exists = await fs.access(fsPath).then(() => true).catch(() => false)
  if (!exists) return { exists: false, hasSchema: false, tableCount: 0, tables: [] }
  // Use Prisma to query the schema — this avoids spawning sqlite3 CLI.
  // We point a throwaway client at the file and read sqlite_master.
  try {
    const { PrismaClient } = await import('@prisma/client')
    const probe = new PrismaClient({
      datasources: { db: { url: `file:${fsPath}` } },
      log: ['error'],
    })
    try {
      const rows = await probe.$queryRaw<{ name: string }[]>`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%'
        ORDER BY name
      `
      const tables = rows.map((r: any) => String(r.name))
      const expected = [
        'PdbStructure', 'Evaluation', 'PubMedArticle',
        'WeeklyReport', 'WeeklySnapshot', 'SkillRunRecord',
      ]
      const hasSchema = expected.every((t) => tables.includes(t))
      return { exists: true, hasSchema, tableCount: tables.length, tables }
    } finally {
      await probe.$disconnect().catch(() => {})
    }
  } catch (err: any) {
    return { exists: true, hasSchema: false, tableCount: 0, tables: [], error: err?.message }
  }
}

/** Run `prisma db push` against the given URL to create all tables. */
async function initSchema(dbUrl: string): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  // Use bunx so we don't depend on a global prisma binary.
  const env = { ...process.env, DATABASE_URL: dbUrl }
  try {
    const { stdout, stderr } = await execAsync('bunx prisma db push --skip-generate --accept-data-loss', {
      env: { ...env, NODE_OPTIONS: '--max-old-space-size=4096' },
      cwd: writableRoot(),
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60_000,
    })
    return { ok: true, stdout, stderr }
  } catch (err: any) {
    return { ok: false, stdout: err?.stdout || '', stderr: err?.stderr || err?.message || String(err) }
  }
}

async function prepareSchema(
  dbUrl: string,
  fsPath: string,
  runPrismaPush: boolean,
): Promise<{
  compat: SchemaCompatResult
  initSchema: { ok: boolean; stdout: string; stderr: string } | null
  warnings: string[]
}> {
  const warnings: string[] = []
  const wasEmpty = (await fs.stat(fsPath)).size === 0
  let initResult: { ok: boolean; stdout: string; stderr: string } | null = null

  // Safe additive migration first for legacy databases. Empty files need
  // Prisma to create tables before required-column validation.
  if (!wasEmpty) {
    const preCompat = await ensureSchemaCompat(fsPath)
    warnings.push(...preCompat.warnings)
  }

  if (runPrismaPush || wasEmpty) {
    // Disconnect the active PrismaClient BEFORE spawning `prisma db push`.
    // SQLite allows only one writer; if the server's client holds a
    // connection, the push can fail or produce a half-written file that
    // checkSchema later reports as "not initialized".
    try {
      const { recreatePrismaClient } = await import('@/lib/db')
      await recreatePrismaClient()
    } catch { /* best-effort */ }
    initResult = await initSchema(dbUrl)
    if (!initResult.ok) {
      warnings.push(`prisma db push failed; compatible existing schema retained: ${initResult.stderr}`)
    }
  }

  // Hard gate: callers persist/switch only after required columns verify.
  // (ensureSchemaCompat now gracefully skips the required-column check when
  // the file is empty or has no tables, so a failed push no longer throws.)
  const compat = await ensureSchemaCompat(fsPath)
  warnings.push(...compat.warnings)
  return { compat, initSchema: initResult, warnings: Array.from(new Set(warnings)) }
}

/**
 * API-02: peek at an existing file to decide whether it is safe to truncate.
 * Returns null when the file doesn't exist or is empty (both safe to create
 * over); otherwise returns its size and whether it starts with the SQLite
 * magic header (first 16 bytes).
 */
async function readExistingHeader(fsPath: string): Promise<{ size: number; isSqlite: boolean } | null> {
  try {
    const fh = await fs.open(fsPath, 'r')
    try {
      const { size } = await fh.stat()
      if (size === 0) return null
      const header = Buffer.alloc(16)
      await fh.read(header, 0, 16, 0)
      return { size, isSqlite: header.toString('latin1').startsWith('SQLite format 3') }
    } finally {
      await fh.close()
    }
  } catch {
    return null // doesn't exist (or unreadable) — treat as creatable
  }
}

/** Quick row counts on the active DB to surface in the UI. */
async function sampleCounts(): Promise<Record<string, number>> {
  try {
    // Whitelist of allowed table names — prevents SQL injection even though
    // the array is hardcoded. Any table not in this set is silently skipped.
    const ALLOWED_TABLES = new Set([
      'PdbStructure', 'Evaluation', 'PubMedArticle', 'WeeklyReport',
      'WeeklySnapshot', 'SkillRunRecord', 'LiteratureDigest',
      'SkillEvaluationReport', 'WeeklyReportRun',
    ]);
    const tables = Array.from(ALLOWED_TABLES);
    const out: Record<string, number> = {}
    for (const t of tables) {
      // Double-check: only query if t is in the whitelist (defense in depth)
      if (!ALLOWED_TABLES.has(t)) continue;
      try {
        const rows = await (db as any).$queryRawUnsafe(`SELECT COUNT(*) AS c FROM "${t}"`)
        out[t] = Number((rows as any[])[0]?.c ?? 0)
      } catch {
        out[t] = 0
      }
    }
    return out
  } catch {
    return {}
  }
}

export async function GET() {
  const cfg = await readConfig()
  const activeUrl = resolveDbUrl()
  const activeFs = getActiveDbFsPath()
  const isTest = isActiveDbTest()
  const schemaInfo = await checkSchema(activeFs)
  const counts = schemaInfo.hasSchema ? await sampleCounts() : {}
  return NextResponse.json({
    /** Path stored in .hermes/db-config.json (may be null if never set). */
    configuredDbPath: cfg?.dbPath ?? null,
    confirmed: cfg?.confirmed ?? false,
    updatedAt: cfg?.updatedAt ?? null,
    /** The URL Prisma is actually using right now (after resolution). */
    activeUrl,
    activeFsPath: activeFs,
    isTest,
    /** File-existence + schema status for the active DB. */
    exists: schemaInfo.exists,
    hasSchema: schemaInfo.hasSchema,
    tableCount: schemaInfo.tableCount,
    tables: schemaInfo.tables,
    /** Sample row counts (empty if schema not initialized). */
    counts,
    /** The default test path, surfaced so the wizard can compare. */
    defaultTestPath: DEFAULT_TEST_DB_PATH,
    testDbAbs: TEST_DB_ABS,
    env: process.env.DATABASE_URL || '(not set)',
    configFile: CONFIG_FILE,
  })
}

export async function POST(request: NextRequest) {
  try {
    const url = new URL(request.url)
    const action = url.searchParams.get('action')
    const body = await request.json().catch(() => ({}))

    // ── action=init → run prisma db push on the ACTIVE db ──────────────
    if (action === 'init') {
      const activeUrl = resolveDbUrl()
      const activeFs = getActiveDbFsPath()
      let prepared: Awaited<ReturnType<typeof prepareSchema>>
      try {
        prepared = await prepareSchema(activeUrl, activeFs, true)
      } catch (err: any) {
        return NextResponse.json({
          ok: false,
          error: err?.message || 'schema compatibility migration failed',
        }, { status: 500 })
      }
      await recreatePrismaClient()
      const schemaInfo = await checkSchema(activeFs)
      return NextResponse.json({
        ok: true,
        message: 'Schema initialized and compatibility fields verified on active database.',
        activeUrl,
        initSchema: prepared.initSchema,
        addedColumns: prepared.compat.addedColumns,
        warnings: prepared.warnings,
        ...schemaInfo,
      })
    }

    // ── default action: set / switch database path ─────────────────────
    const rawPath = (body.dbPath || '').trim()
    if (!rawPath) {
      return NextResponse.json({ error: 'dbPath is required' }, { status: 400 })
    }
    const create = !!body.create
    const initSchemaFlag = body.initSchema !== false // default true
    const confirmed = !!body.confirmed

    const normalizedUrl = normalizeDbUrl(rawPath)
    const fsPath = normalizedUrl.replace(/^file:/, '')

    // ── API-02: anchor the path ──────────────────────────────────────────
    // The POST body's dbPath is fully client-controlled and is used for
    // fs.mkdir + fs.writeFile(Buffer.alloc(0)) + `bunx prisma db push
    // --accept-data-loss` — before this check, create:true zeroed ANY
    // absolute path (arbitrary file truncation primitive). Require the
    // resolved target to be a `.db` file INSIDE the app's own db/ directory
    // (writableRoot()/db in dev, userData/db in the packaged app — the same
    // anchor the default test DB uses).
    const dbRoot = dbDir()
    const resolvedFsPath = path.resolve(fsPath)
    if (
      !resolvedFsPath.endsWith('.db') ||
      !(resolvedFsPath === dbRoot || resolvedFsPath.startsWith(dbRoot + path.sep))
    ) {
      return NextResponse.json({
        error: `dbPath must be a .db file inside the app database directory (${dbRoot}). Received: ${fsPath}`,
        dbDir: dbRoot,
      }, { status: 400 })
    }

    // If create=true, create a TRULY NEW empty file. If the file already
    // exists (e.g. from a previous run), we overwrite it with an empty file
    // so the user gets a fresh database — this is the expected behavior when
    // they explicitly click "Create new database" in the wizard.
    if (create) {
      // API-02: refuse to zero out an existing non-empty file that is not a
      // SQLite database — a mistyped path must not truncate arbitrary user
      // data (e.g. a document that happens to live under db/).
      const existing = await readExistingHeader(resolvedFsPath)
      if (existing && !existing.isSqlite) {
        return NextResponse.json({
          error: `Refusing to overwrite ${resolvedFsPath}: file exists, is non-empty (${existing.size} bytes), and is not a SQLite database`,
          fsPath: resolvedFsPath,
        }, { status: 400 })
      }
      await fs.mkdir(path.dirname(resolvedFsPath), { recursive: true })
      // Overwrite with empty file — prisma db push will create the schema.
      // The user explicitly asked for a NEW database, so any existing data
      // in this file is replaced.
      await fs.writeFile(resolvedFsPath, Buffer.alloc(0))
    } else {
      // Switching to an existing path — verify it exists.
      const fileExists = await fs.access(fsPath).then(() => true).catch(() => false)
      if (!fileExists) {
        return NextResponse.json({
          error: `Database file does not exist: ${fsPath}. Use create=true to create a new one.`,
          fsPath,
        }, { status: 404 })
      }
    }

    let prepared: Awaited<ReturnType<typeof prepareSchema>>
    try {
      prepared = await prepareSchema(normalizedUrl, fsPath, initSchemaFlag)
    } catch (err: any) {
      return NextResponse.json({
        ok: false,
        error: err?.message || 'schema compatibility migration failed',
        fsPath,
      }, { status: 500 })
    }

    // Persist only after required compatibility fields have been verified.
    await writeConfig({ dbPath: normalizedUrl, confirmed })

    // Recreate the PrismaClient so all 3 modules see the new DB immediately.
    await recreatePrismaClient()

    const schemaInfo = await checkSchema(fsPath)
    const counts = schemaInfo.hasSchema ? await sampleCounts() : {}

    return NextResponse.json({
      ok: true,
      dbPath: normalizedUrl,
      fsPath,
      create,
      initSchema: prepared.initSchema,
      addedColumns: prepared.compat.addedColumns,
      warnings: prepared.warnings,
      confirmed,
      message: prepared.initSchema?.ok
        ? `Database switched to ${fsPath} and schema initialized. All modules now read/write here.`
        : `Database switched to ${fsPath}; required compatibility fields were verified.`,
      ...schemaInfo,
      counts,
    })
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || 'unknown' }, { status: 500 })
  }
}
