// src/lib/schema-compat.ts
//
// Field-level SQLite compatibility shim, implemented via Prisma.
//
// When /api/db-config selects or initialises a database file, we run
// `prisma db push` to reconcile the schema with prisma/schema.prisma. That
// works fine for a brand-new file, but for an *existing* legacy DB the
// push can be rejected (historical drift, missing columns referenced by
// relations, partial migration history, etc.) and even when it succeeds,
// SQLite's `ALTER TABLE ADD COLUMN` doesn't back-fill — so any consumer
// that writes through Prisma can still crash at runtime if a column that
// the rest of the app now relies on is missing.
//
// This module gives us a *targeted, additive* migration path that:
//   1. Uses `PRAGMA table_info(<table>)` to discover what columns exist.
//   2. Compares against an extendable manifest (`COMPAT_COLUMNS`).
//   3. Issues plain `ALTER TABLE ... ADD COLUMN` for each missing field,
//      preserving existing rows (SQLite stores the default for added cols).
//   4. After migration, re-verifies that the fields the runtime *must*
//      have are still present; if not, surfaces a hard error so the API
//      refuses to switch the active database.
//   5. Returns `{ ok, addedColumns, warnings, error }` so the caller can
//      report exactly what changed without swallowing details.
//
// The manifest is plain data — to add a new compat column in the future,
// append an entry to `COMPAT_COLUMNS`. No branches in the loop, no
// hard-coded table names anywhere except the manifest.
//
// Why not `node:sqlite` / `better-sqlite3`? Electron 33's bundled Node.js
// 22.22.3 omits the experimental `node:sqlite` built-in (it logs
// `No such built-in module: node:sqlite`), and `better-sqlite3` v11
// doesn't ship prebuilt binaries for Electron's ABI on macOS arm64
// (latest published prebuilds target Electron v116-v118, we run on
// Electron v132+). Prisma 6's own native binding (`libquery_engine-…`
// inside `node_modules/.prisma/client/`) IS Electron-ABI-compatible
// because it's built at Prisma build time, so we let Prisma open the
// SQLite file and route raw SQL through `$queryRaw` / `$executeRaw`.

import { PrismaClient } from '@prisma/client'
import { existsSync, statSync } from 'node:fs'

export interface CompatColumnDef {
  /** Target table name (as Prisma spells it, e.g. `"Evaluation"`). */
  table: string
  /** Column to ensure exists. */
  column: string
  /** SQLite type clause (`INTEGER`, `TEXT`, `REAL`, …). */
  type: 'INTEGER' | 'TEXT' | 'REAL' | 'BLOB' | 'BOOLEAN'
  /** Whether the column may be NULL. Normally `true` for compat adds —
   *  the only exception is a NOT NULL column WITH a non-null DEFAULT
   *  (e.g. R179's `mode TEXT NOT NULL DEFAULT 'classic'`), which SQLite
   *  accepts on existing tables without a table copy. */
  nullable: boolean
  /**
   * Produces the exact ALTER TABLE statement for this column. Parameterised
   * by the table name (we accept either the unquoted or already-quoted
   * spelling) so future migrations can quote columns with reserved names.
   */
  alterSql: (table: string) => string
}

/**
 * Extendable manifest of columns that must exist on every legacy DB so the
 * current Prisma client can write through them without runtime errors.
 *
 * Adding a new compat column = appending an entry here. The migration loop
 * picks it up automatically.
 */
export const COMPAT_COLUMNS: CompatColumnDef[] = [
  // ── Evaluation: v4 column set ────────────────────────────────────────
  // These three were introduced after v3. Old DBs that pre-date them will
  // throw `SQLITE_ERROR: no such column: maxPdbUsed` the moment the eval
  // route writes back to the Evaluation table.
  {
    table: 'Evaluation',
    column: 'maxPdbUsed',
    type: 'INTEGER',
    nullable: true,
    alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "maxPdbUsed" INTEGER`,
  },
  {
    table: 'Evaluation',
    column: 'blastWasSkipped',
    type: 'INTEGER',
    nullable: true,
    alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "blastWasSkipped" INTEGER`,
  },
  {
    table: 'Evaluation',
    column: 'pdbCountAtEval',
    type: 'INTEGER',
    nullable: true,
    alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "pdbCountAtEval" INTEGER`,
  },
  {
    // Provenance JSON — added in the Claude-Science-inspired upgrade.
    // Nullable so legacy rows (pre-upgrade) keep working; new evaluations
    // always populate it.
    table: 'Evaluation',
    column: 'provenance',
    type: 'TEXT',
    nullable: true,
    alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "provenance" TEXT`,
  },
  {
    // isParalog — added when batch sub-target BLAST writes became supported.
    // The Prisma schema has it with @default(false), but SQLite ALTER TABLE
    // can't express a default for BOOLEAN (stored as INTEGER 0/1), so we add
    // the column as nullable and let the INSERT supply the value. Without
    // this, inserting a BLAST hit row fails with "table EvaluationBlastResult
    // has no column named isParalog" on legacy DBs.
    table: 'EvaluationBlastResult',
    column: 'isParalog',
    type: 'INTEGER',
    nullable: true,
    alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "isParalog" INTEGER`,
  },
  // ── Skill module tables (SkillRunRecord / LiteratureDigest /
  //    SkillEvaluationReport / WeeklyReportRun) ──────────────────────────
  // These tables were added when the 3 skill modules (literature / eval /
  // weekly) were introduced. Legacy DBs created before the skill system
  // existed either (a) don't have the tables at all, or (b) have an early
  // version missing columns added later (llmOk, llmFallback, llmError,
  // resultJson, log, etc.). ensureSchemaCompat() only ADDs columns — it
  // doesn't create tables — so we also need ensureTableExists() (below) to
  // CREATE TABLE IF NOT EXISTS for each skill table. The column entries here
  // guarantee that once the table exists, all expected columns are present.
  // ── SkillRunRecord ──
  { table: 'SkillRunRecord', column: 'module',      type: 'TEXT',    nullable: true, alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "module" TEXT` },
  { table: 'SkillRunRecord', column: 'status',      type: 'TEXT',    nullable: true, alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "status" TEXT` },
  { table: 'SkillRunRecord', column: 'summary',     type: 'TEXT',    nullable: true, alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "summary" TEXT` },
  { table: 'SkillRunRecord', column: 'details',     type: 'TEXT',    nullable: true, alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "details" TEXT` },
  { table: 'SkillRunRecord', column: 'provider',    type: 'TEXT',    nullable: true, alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "provider" TEXT` },
  { table: 'SkillRunRecord', column: 'model',       type: 'TEXT',    nullable: true, alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "model" TEXT` },
  { table: 'SkillRunRecord', column: 'llmOk',       type: 'INTEGER', nullable: true, alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "llmOk" INTEGER` },
  { table: 'SkillRunRecord', column: 'llmFallback', type: 'INTEGER', nullable: true, alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "llmFallback" INTEGER` },
  { table: 'SkillRunRecord', column: 'llmError',    type: 'TEXT',    nullable: true, alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "llmError" TEXT` },
  { table: 'SkillRunRecord', column: 'durationMs',  type: 'INTEGER', nullable: true, alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "durationMs" INTEGER` },
  { table: 'SkillRunRecord', column: 'resultJson',  type: 'TEXT',    nullable: true, alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "resultJson" TEXT` },
  { table: 'SkillRunRecord', column: 'log',         type: 'TEXT',    nullable: true, alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "log" TEXT` },
  { table: 'SkillRunRecord', column: 'createdAt',   type: 'TEXT',    nullable: true, alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "createdAt" TEXT` },
  // ── LiteratureDigest ──
  { table: 'LiteratureDigest', column: 'date',         type: 'TEXT',    nullable: true, alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "date" TEXT` },
  { table: 'LiteratureDigest', column: 'paperCount',   type: 'INTEGER', nullable: true, alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "paperCount" INTEGER` },
  { table: 'LiteratureDigest', column: 'methodStats',  type: 'TEXT',    nullable: true, alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "methodStats" TEXT` },
  { table: 'LiteratureDigest', column: 'digest',       type: 'TEXT',    nullable: true, alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "digest" TEXT` },
  { table: 'LiteratureDigest', column: 'llmOk',        type: 'INTEGER', nullable: true, alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "llmOk" INTEGER` },
  { table: 'LiteratureDigest', column: 'llmProvider',  type: 'TEXT',    nullable: true, alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "llmProvider" TEXT` },
  { table: 'LiteratureDigest', column: 'llmModel',     type: 'TEXT',    nullable: true, alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "llmModel" TEXT` },
  { table: 'LiteratureDigest', column: 'llmDurationMs',type: 'INTEGER', nullable: true, alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "llmDurationMs" INTEGER` },
  { table: 'LiteratureDigest', column: 'filePath',     type: 'TEXT',    nullable: true, alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "filePath" TEXT` },
  { table: 'LiteratureDigest', column: 'createdAt',    type: 'TEXT',    nullable: true, alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "createdAt" TEXT` },
  // ── SkillEvaluationReport ──
  { table: 'SkillEvaluationReport', column: 'uniprotId',      type: 'TEXT',    nullable: true, alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "uniprotId" TEXT` },
  { table: 'SkillEvaluationReport', column: 'proteinName',    type: 'TEXT',    nullable: true, alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "proteinName" TEXT` },
  { table: 'SkillEvaluationReport', column: 'overallScore',   type: 'INTEGER', nullable: true, alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "overallScore" INTEGER` },
  { table: 'SkillEvaluationReport', column: 'directPdbCount', type: 'INTEGER', nullable: true, alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "directPdbCount" INTEGER` },
  { table: 'SkillEvaluationReport', column: 'coverage',       type: 'INTEGER', nullable: true, alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "coverage" INTEGER` },
  { table: 'SkillEvaluationReport', column: 'report',         type: 'TEXT',    nullable: true, alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "report" TEXT` },
  { table: 'SkillEvaluationReport', column: 'llmOk',          type: 'INTEGER', nullable: true, alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "llmOk" INTEGER` },
  { table: 'SkillEvaluationReport', column: 'llmProvider',    type: 'TEXT',    nullable: true, alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "llmProvider" TEXT` },
  { table: 'SkillEvaluationReport', column: 'llmModel',       type: 'TEXT',    nullable: true, alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "llmModel" TEXT` },
  { table: 'SkillEvaluationReport', column: 'llmDurationMs',  type: 'INTEGER', nullable: true, alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "llmDurationMs" INTEGER` },
  { table: 'SkillEvaluationReport', column: 'filePath',       type: 'TEXT',    nullable: true, alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "filePath" TEXT` },
  { table: 'SkillEvaluationReport', column: 'createdAt',      type: 'TEXT',    nullable: true, alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "createdAt" TEXT` },
  // R179 (Task 2-a): DSH 模式新增列 —— mode（'classic' | 'dsh'，非空带默认
  // 值故可安全 ALTER）、outline（大纲 JSON）、figures（已验证配图 JSON）。
  // 重复列错误不会发生：迁移循环先 PRAGMA table_info 检查再 ALTER（本文件
  // 的既有守卫式 alter 惯用法）。
  { table: 'SkillEvaluationReport', column: 'mode',    type: 'TEXT', nullable: false, alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'classic'` },
  { table: 'SkillEvaluationReport', column: 'outline', type: 'TEXT', nullable: true,  alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "outline" TEXT` },
  { table: 'SkillEvaluationReport', column: 'figures', type: 'TEXT', nullable: true,  alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "figures" TEXT` },
  // ── WeeklyReportRun ──
  { table: 'WeeklyReportRun', column: 'weekId',       type: 'TEXT',    nullable: true, alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "weekId" TEXT` },
  { table: 'WeeklyReportRun', column: 'cycles',       type: 'INTEGER', nullable: true, alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "cycles" INTEGER` },
  { table: 'WeeklyReportRun', column: 'reportTypes',  type: 'TEXT',    nullable: true, alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "reportTypes" TEXT` },
  { table: 'WeeklyReportRun', column: 'providers',    type: 'TEXT',    nullable: true, alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "providers" TEXT` },
  { table: 'WeeklyReportRun', column: 'filesWritten', type: 'TEXT',    nullable: true, alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "filesWritten" TEXT` },
  { table: 'WeeklyReportRun', column: 'durationMs',   type: 'INTEGER', nullable: true, alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "durationMs" INTEGER` },
  { table: 'WeeklyReportRun', column: 'cyclesJson',   type: 'TEXT',    nullable: true, alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "cyclesJson" TEXT` },
  { table: 'WeeklyReportRun', column: 'createdAt',    type: 'TEXT',    nullable: true, alterSql: (t) => `ALTER TABLE ${t} ADD COLUMN "createdAt" TEXT` },
]

/**
 * Subset of `COMPAT_COLUMNS` that the runtime absolutely cannot function
 * without. If any of these is still missing after the compat pass, we
 * *refuse* to switch the active DB.
 *
 * The list mirrors the original task scope and is intentionally narrow —
 * columns that are "nice to have but the app will still work" should live
 * only in `COMPAT_COLUMNS` so they generate a warning, not a hard error.
 */
export const REQUIRED_COMPAT_COLUMNS: ReadonlyArray<{ table: string; column: string }> = [
  { table: 'Evaluation', column: 'maxPdbUsed' },
  { table: 'Evaluation', column: 'blastWasSkipped' },
  { table: 'Evaluation', column: 'pdbCountAtEval' },
]

/** A column as returned by `PRAGMA table_info`. */
export interface SqliteColumnInfo {
  cid: number
  name: string
  type: string
  notnull: 0 | 1
  dflt_value: unknown
  pk: 0 | 1
}

/** Convert a list of unknown rows from `$queryRaw` into typed column rows. */
function coerceColumns(rows: unknown): SqliteColumnInfo[] {
  // Prisma's $queryRaw<unknown> on SQLite returns array of objects with
  // keys matching the SELECT list, but the typing is loose because
  // PRAGMA is dynamic.
  const arr = Array.isArray(rows) ? rows : []
  return arr.map((r: any) => ({
    cid: Number(r.cid ?? r[0] ?? 0),
    name: String(r.name ?? r[1] ?? ''),
    type: String(r.type ?? r[2] ?? ''),
    notnull: r.notnull === 1 || r.notnull === '1' || r[3] === 1 || r[3] === '1' ? 1 : 0,
    dflt_value: r.dflt_value ?? r[4] ?? null,
    pk: r.pk === 1 || r.pk === '1' || r[5] === 1 || r[5] === '1' ? 1 : 0,
  }))
}

/**
 * Open a PrismaClient pointed at the given SQLite file. Caller takes
 * ownership — disconnect when done.
 *
 * This client is only used for raw `$queryRaw` / `$executeRaw` against
 * tables that may not yet be present in the Prisma schema (e.g. legacy
 * columns). The companion model methods can't touch those columns
 * because the generated Prisma client doesn't know about them.
 */
function openProbeClient(dbPath: string): PrismaClient {
  const url = dbPath.startsWith('file:') ? dbPath : `file:${dbPath}`
  return new PrismaClient({
    datasources: { db: { url } },
    log: ['error'],
  })
}

/**
 * Run `PRAGMA table_info(<table>)` against the file at `dbPath`.
 *
 * Returns the list of columns the table currently has. Returns `[]` if the
 * table is missing (a fresh DB that hasn't been initialised yet).
 *
 * Throws if the file itself is missing — that's a caller bug, not a
 * "schema drift" condition.
 */
export async function inspectSqliteColumns(dbPath: string, table: string): Promise<SqliteColumnInfo[]> {
  if (!existsSync(dbPath)) {
    throw new Error(`inspectSqliteColumns: database file not found: ${dbPath}`)
  }
  const client = openProbeClient(dbPath)
  try {
    const quoted = quoteIdent(table)
    const rows = await client.$queryRawUnsafe(`PRAGMA table_info(${quoted})`)
    return coerceColumns(rows)
  } finally {
    await client.$disconnect().catch(() => {})
  }
}

export interface SchemaCompatResult {
  ok: boolean
  /** `Table.column` for every column added during this call. */
  addedColumns: string[]
  /** Non-fatal diagnostics — e.g. drift we detected but didn't fix. */
  warnings: string[]
  /** Set when `ok === false`. Human-readable failure description. */
  error?: string
}

/**
 * Apply the additive compat migration to the file at `dbPath`.
 *
 * - If the file is missing or zero-byte, returns `{ ok: false, … }`
 *   without throwing (so the wizard can degrade gracefully).
 * - Each missing column is added individually; partial progress is fine.
 * - `addedColumns` lists only columns added during this call.
 */
export async function applySchemaCompat(dbPath: string): Promise<SchemaCompatResult> {
  if (!existsSync(dbPath)) {
    return { ok: false, addedColumns: [], warnings: [], error: `database file not found: ${dbPath}` }
  }

  // Empty file → no schema yet; the caller will run `prisma db push` to
  // create everything from scratch. We report nothing-to-do.
  let size: number
  try {
    size = statSync(dbPath).size
  } catch {
    return { ok: false, addedColumns: [], warnings: [], error: `cannot stat database file: ${dbPath}` }
  }
  if (size === 0) {
    return { ok: true, addedColumns: [], warnings: ['database file is empty — defer schema creation to prisma db push'] }
  }

  const warnings: string[] = []
  const addedColumns: string[] = []

  // Open RW via Prisma so ALTER TABLE works; this is fine because the
  // file is on disk and we want to mutate it.
  const client = openProbeClient(dbPath)
  try {
    const tableRows = await client.$queryRawUnsafe<Array<{ name: string }>>(
      `SELECT name FROM sqlite_master WHERE type='table'`,
    )
    const tables = (tableRows ?? []).map((r) => r.name)

    // ── Ensure skill module tables exist ────────────────────────────────
    // Legacy DBs created before the skill system (literature / eval /
    // weekly modules) don't have SkillRunRecord / LiteratureDigest /
    // SkillEvaluationReport / WeeklyReportRun. ALTER TABLE can't create
    // a table, so we CREATE TABLE IF NOT EXISTS here with the full column
    // set. This runs on every compat pass — the IF NOT EXISTS makes it a
    // no-op for DBs that already have the tables. Without this, the
    // `db.skillRunRecord.create()` call in evaluations/run/route.ts fails
    // with "no such table: SkillRunRecord" on legacy DBs.
    const ensureTableExists = async (tableName: string, createSql: string) => {
      if (!tables.includes(tableName)) {
        try {
          await client.$executeRawUnsafe(createSql)
          addedColumns.push(`${tableName} (table created)`)
          tables.push(tableName)
        } catch (err: any) {
          warnings.push(`failed to create table ${tableName}: ${err?.message ?? err}`)
        }
      }
    }
    await ensureTableExists('SkillRunRecord',
      `CREATE TABLE IF NOT EXISTS "SkillRunRecord" ("id" TEXT NOT NULL PRIMARY KEY, "module" TEXT NOT NULL, "status" TEXT NOT NULL, "summary" TEXT NOT NULL, "details" TEXT, "provider" TEXT, "model" TEXT, "llmOk" INTEGER, "llmFallback" INTEGER DEFAULT 0, "llmError" TEXT, "durationMs" INTEGER, "resultJson" TEXT, "log" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`)
    await ensureTableExists('LiteratureDigest',
      `CREATE TABLE IF NOT EXISTS "LiteratureDigest" ("id" TEXT NOT NULL PRIMARY KEY, "date" TEXT NOT NULL, "paperCount" INTEGER NOT NULL, "methodStats" TEXT, "digest" TEXT NOT NULL, "llmOk" INTEGER NOT NULL, "llmProvider" TEXT, "llmModel" TEXT, "llmDurationMs" INTEGER, "filePath" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`)
    await ensureTableExists('SkillEvaluationReport',
      `CREATE TABLE IF NOT EXISTS "SkillEvaluationReport" ("id" TEXT NOT NULL PRIMARY KEY, "uniprotId" TEXT NOT NULL, "proteinName" TEXT, "overallScore" INTEGER NOT NULL, "directPdbCount" INTEGER NOT NULL, "coverage" INTEGER NOT NULL, "report" TEXT NOT NULL, "llmOk" INTEGER NOT NULL, "llmProvider" TEXT, "llmModel" TEXT, "llmDurationMs" INTEGER, "filePath" TEXT, "mode" TEXT NOT NULL DEFAULT 'classic', "outline" TEXT, "figures" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`)
    await ensureTableExists('WeeklyReportRun',
      `CREATE TABLE IF NOT EXISTS "WeeklyReportRun" ("id" TEXT NOT NULL PRIMARY KEY, "weekId" TEXT NOT NULL, "cycles" INTEGER NOT NULL, "reportTypes" TEXT NOT NULL, "providers" TEXT, "filesWritten" TEXT, "durationMs" INTEGER, "cyclesJson" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`)
    // Also ensure EvaluationBatch exists (added with batch mode; legacy DBs
    // predate it and the cross-target INSERT fails without it).
    await ensureTableExists('EvaluationBatch',
      `CREATE TABLE IF NOT EXISTS "EvaluationBatch" ("batchId" TEXT NOT NULL PRIMARY KEY, "title" TEXT, "combinedReport" TEXT, "commonPdbIds" TEXT, "crossReportOk" INTEGER, "crossReportProvider" TEXT, "crossReportModel" TEXT, "crossReportDurationMs" INTEGER, "crossReportChars" INTEGER, "targetCount" INTEGER, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`)
    // EvaluationReport (child of Evaluation, added with batch chapter reports).
    await ensureTableExists('EvaluationReport',
      `CREATE TABLE IF NOT EXISTS "EvaluationReport" ("id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT, "uniprotId" TEXT NOT NULL, "title" TEXT, "content" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`)
    // PubMedArticle — literature module caches PubMed metadata here.
    await ensureTableExists('PubMedArticle',
      `CREATE TABLE IF NOT EXISTS "PubMedArticle" ("pubmedId" TEXT NOT NULL PRIMARY KEY, "title" TEXT, "authors" TEXT, "journal" TEXT, "pubYear" TEXT, "pubMonth" TEXT, "pubDay" TEXT, "abstract" TEXT, "doi" TEXT, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`)
    // Ligand — ligand metadata cache.
    await ensureTableExists('Ligand',
      `CREATE TABLE IF NOT EXISTS "Ligand" ("code" TEXT NOT NULL PRIMARY KEY, "name" TEXT, "formula" TEXT, "weight" TEXT, "type" TEXT, "description" TEXT, "imageUrl" TEXT)`)

    for (const def of COMPAT_COLUMNS) {
      if (!tables.includes(def.table)) {
        warnings.push(`table ${def.table} not present — cannot add column ${def.column} (will be created by prisma db push)`)
        continue
      }
      const cols = await inspectSqliteColumns(dbPath, def.table)
      if (cols.some((c) => c.name === def.column)) {
        continue
      }
      try {
        await client.$executeRawUnsafe(def.alterSql(quoteIdent(def.table)))
        addedColumns.push(`${def.table}.${def.column}`)
      } catch (err: any) {
        return {
          ok: false,
          addedColumns,
          warnings,
          error: `failed to add ${def.table}.${def.column}: ${err?.message || String(err)}`,
        }
      }
    }
  } catch (err: any) {
    return { ok: false, addedColumns, warnings, error: err?.message || String(err) }
  } finally {
    await client.$disconnect().catch(() => {})
  }

  return { ok: true, addedColumns: addedColumns.sort(), warnings }
}

/**
 * Idempotent guard: apply the compat migration, then assert every
 * `REQUIRED_COMPAT_COLUMNS` entry is present.
 *
 * Returns the list of `Table.column` entries that the runtime requires
 * (after applying migrations), so the caller can surface them in the API
 * response and on the client.
 *
 * Throws an `Error` whose message lists the missing columns if a required
 * column is still missing after the migration pass.
 */
export async function ensureSchemaCompat(dbPath: string): Promise<SchemaCompatResult> {
  const r = await applySchemaCompat(dbPath)
  if (!r.ok) {
    throw new Error(`schema compat migration failed: ${r.error}`)
  }

  // If the database file is empty (no tables yet — prisma db push hasn't
  // run or failed), skip the required-column check. The caller will see
  // `hasSchema: false` from checkSchema() and can decide whether to retry
  // init. Throwing here would block DB creation entirely.
  if (!existsSync(dbPath)) return r
  let size = 0
  try { size = statSync(dbPath).size } catch { return r }
  if (size === 0) return r
  // Also skip if the file has no tables at all (prisma push may have
  // partially written the header but not created tables).
  try {
    const probe = openProbeClient(dbPath)
    try {
      const r2 = await probe.$queryRawUnsafe<Array<{ c: number | string }>>(
        `SELECT COUNT(*) AS c FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%'`,
      )
      const count = Number((r2 as any)?.[0]?.c ?? 0)
      if (!count) return r
    } finally {
      await probe.$disconnect().catch(() => {})
    }
  } catch {
    // Can't probe — don't block, let checkSchema report the real status.
    return r
  }

  const missing: string[] = []
  for (const req of REQUIRED_COMPAT_COLUMNS) {
    try {
      const cols = await inspectSqliteColumns(dbPath, req.table)
      if (cols.some((c) => c.name === req.column)) continue
    } catch {
      /* reported as missing below */
    }
    missing.push(`${req.table}.${req.column}`)
  }

  if (missing.length > 0) {
    throw new Error(`required schema columns missing after migration: ${missing.join(', ')}`)
  }

  return r
}

/** Quote a SQLite identifier with double quotes, escaping any embedded quote. */
function quoteIdent(name: string): string {
  return `"${String(name).replace(/"/g, '""')}"`
}