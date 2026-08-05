// src/lib/__tests__/schemaCompat.test.ts
//
// TDD specs for src/lib/schema-compat.ts — the SQLite field-level compatibility
// shim that runs when /api/db-config selects/initialises a DB file.
//
// We deliberately test the *behaviour contract* (what migrations get applied,
// what the API returns, what happens on failure) rather than implementation
// details, so the tests stay green even if the SQL internals change.
//
// Each test creates an isolated on-disk SQLite file via Node's built-in
// `node:sqlite`, so the real user DB at ~/.hermes/db-config.json is never
// touched.

import { describe, it, before, after, afterEach } from 'node:test'
import * as assert from 'node:assert'
import { mkdtempSync, rmSync, readFileSync, writeFileSync, readdirSync, mkdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import {
  COMPAT_COLUMNS,
  inspectSqliteColumns,
  applySchemaCompat,
  ensureSchemaCompat,
} from '../schema-compat.ts'

let workdir: string

/** Write a minimal v3-style SQLite file that lacks the v4 compat columns. */
function createLegacyDb(path: string): void {
  const db = new DatabaseSync(path)
  db.exec(`
    CREATE TABLE "PdbStructure" ("pdbId" TEXT PRIMARY KEY);
    CREATE TABLE "Evaluation" (
      "uniprotId" TEXT PRIMARY KEY,
      "entryName" TEXT,
      "report" TEXT DEFAULT '',
      "createdAt" TEXT DEFAULT ''
    );
    INSERT INTO "Evaluation" ("uniprotId", "entryName")
      VALUES ('P00533', 'EGFR_HUMAN');
  `)
  db.close()
}

/** Create a brand-new empty file (test the "no schema yet" branch). */
function touchEmptyDb(path: string): void {
  writeFileSync(path, '')
}

before(() => {
  workdir = mkdtempSync(join(tmpdir(), 'schema-compat-'))
})

after(() => {
  if (workdir) rmSync(workdir, { recursive: true, force: true })
})

afterEach(() => {
  // wipe any db files left behind by individual tests
  try {
    const entries = readdirSync(workdir) as string[]
    for (const e of entries) rmSync(join(workdir, e), { force: true })
  } catch { /* ignore */ }
})

describe('COMPAT_COLUMNS — migration manifest', () => {
  it('contains the three required v4 Evaluation columns', () => {
    const evalCols = COMPAT_COLUMNS.filter((c) => c.table === 'Evaluation')
    const names = evalCols.map((c) => c.column)
    assert.ok(names.includes('maxPdbUsed'), 'missing maxPdbUsed')
    assert.ok(names.includes('blastWasSkipped'), 'missing blastWasSkipped')
    assert.ok(names.includes('pdbCountAtEval'), 'missing pdbCountAtEval')
  })

  it('all required Evaluation columns are INTEGER nullable', () => {
    const required = ['maxPdbUsed', 'blastWasSkipped', 'pdbCountAtEval']
    for (const col of required) {
      const def = COMPAT_COLUMNS.find((c) => c.table === 'Evaluation' && c.column === col)
      assert.ok(def, `column ${col} not declared`)
      assert.equal(def!.type, 'INTEGER', `${col} must be INTEGER`)
      assert.equal(def!.nullable, true, `${col} must be nullable for backward-compat`)
    }
  })

  it('every entry produces a valid ALTER TABLE statement', () => {
    for (const c of COMPAT_COLUMNS) {
      const stmt = c.alterSql(c.table)
      assert.match(stmt, /^ALTER TABLE\s+"?[\w]+"?\s+ADD COLUMN\s+/i,
        `bad ALTER for ${c.table}.${c.column}: ${stmt}`)
    }
  })

  it('manifest is extendable (defs are plain data, no hard-coded branches in tests)', () => {
    // Sanity: the array is iterable and each entry has the expected shape.
    for (const c of COMPAT_COLUMNS) {
      assert.equal(typeof c.table, 'string')
      assert.equal(typeof c.column, 'string')
      assert.equal(typeof c.type, 'string')
      assert.equal(typeof c.nullable, 'boolean')
      assert.equal(typeof c.alterSql, 'function')
    }
  })
})

describe('inspectSqliteColumns — PRAGMA table_info', () => {
  it('returns the expected columns for a legacy Evaluation table', () => {
    const dbPath = join(workdir, 'inspect-legacy.db')
    createLegacyDb(dbPath)
    const cols = inspectSqliteColumns(dbPath, 'Evaluation')
    assert.deepEqual(cols.map((c) => c.name),
      ['uniprotId', 'entryName', 'report', 'createdAt'])
  })

  it('returns empty array for a non-existent table', () => {
    const dbPath = join(workdir, 'inspect-missing.db')
    touchEmptyDb(dbPath)
    const cols = inspectSqliteColumns(dbPath, 'DoesNotExist')
    assert.deepEqual(cols, [])
  })

  it('throws when the file does not exist', () => {
    assert.throws(() => {
      inspectSqliteColumns(join(workdir, 'does-not-exist.db'), 'Evaluation')
    }, /database|file|no such/i)
  })
})

describe('applySchemaCompat — additive field migration', () => {
  it('adds the three required columns to a legacy DB and preserves existing rows', () => {
    const dbPath = join(workdir, 'apply-legacy.db')
    createLegacyDb(dbPath)

    const result = applySchemaCompat(dbPath)
    assert.equal(result.ok, true, `applySchemaCompat failed: ${result.error}`)
    assert.deepEqual(result.addedColumns.sort(), [
      'Evaluation.blastWasSkipped',
      'Evaluation.maxPdbUsed',
      'Evaluation.pdbCountAtEval',
    ])
    assert.deepEqual(result.warnings, [])

    // Existing data preserved
    const db = new DatabaseSync(dbPath)
    const rows = db.prepare(`SELECT "uniprotId", "entryName" FROM "Evaluation"`).all() as any[]
    assert.equal(rows.length, 1)
    assert.equal(rows[0].uniprotId, 'P00533')
    assert.equal(rows[0].entryName, 'EGFR_HUMAN')

    // New columns exist and default to NULL
    const cols = db.prepare(`PRAGMA table_info("Evaluation")`).all() as any[]
    const names = cols.map((c) => c.name)
    assert.ok(names.includes('maxPdbUsed'))
    assert.ok(names.includes('blastWasSkipped'))
    assert.ok(names.includes('pdbCountAtEval'))
    const nullRows = db.prepare(
      `SELECT "maxPdbUsed", "blastWasSkipped", "pdbCountAtEval" FROM "Evaluation" WHERE "uniprotId"='P00533'`,
    ).all() as any[]
    assert.equal(nullRows[0].maxPdbUsed, null)
    assert.equal(nullRows[0].blastWasSkipped, null)
    assert.equal(nullRows[0].pdbCountAtEval, null)
    db.close()
  })

  it('is idempotent — second call reports no added columns', () => {
    const dbPath = join(workdir, 'apply-idempotent.db')
    createLegacyDb(dbPath)
    const first = applySchemaCompat(dbPath)
    assert.equal(first.ok, true)
    assert.equal(first.addedColumns.length, 3)

    const second = applySchemaCompat(dbPath)
    assert.equal(second.ok, true)
    assert.deepEqual(second.addedColumns, [])
    assert.deepEqual(second.warnings, [])
  })

  it('returns ok=false and does NOT crash when the file is missing', () => {
    const missing = join(workdir, 'nope.db')
    const r = applySchemaCompat(missing)
    assert.equal(r.ok, false)
    assert.ok(typeof r.error === 'string' && r.error.length > 0)
  })

  it('records the same addedColumns shape for both schema-compat consumers (addedColumns is stable)', () => {
    const dbPath = join(workdir, 'apply-stable.db')
    createLegacyDb(dbPath)
    const r = applySchemaCompat(dbPath)
    // Each entry must be "Table.column" so the API can surface them verbatim.
    for (const entry of r.addedColumns) {
      assert.match(entry, /^\w+\.\w+$/, `bad addedColumns entry: ${entry}`)
    }
  })
})

describe('ensureSchemaCompat — required-field guard', () => {
  it('throws when the required fields are still missing after migration', () => {
    // Simulate "other historical drift" by constructing a DB that has all v3
    // tables but where one of the required columns has been intentionally
    // removed. We can't easily delete columns in SQLite, so we simulate by
    // monkey-patching the inspect function via a custom DB file lacking the
    // Evaluation table entirely — that forces ensureSchemaCompat to declare
    // missing required columns.
    const dbPath = join(workdir, 'guard-missing-eval.db')
    const db = new DatabaseSync(dbPath)
    db.exec(`CREATE TABLE "PdbStructure" ("pdbId" TEXT PRIMARY KEY);`)
    db.close()

    assert.throws(() => ensureSchemaCompat(dbPath), /Evaluation|missing/i)
  })

  it('does not throw when the required fields are present', () => {
    const dbPath = join(workdir, 'guard-ok.db')
    createLegacyDb(dbPath)
    // After applySchemaCompat, the required columns exist.
    applySchemaCompat(dbPath)
    assert.doesNotThrow(() => ensureSchemaCompat(dbPath))
  })

  it('returns the migration result (handy for the API)', () => {
    const dbPath = join(workdir, 'guard-list.db')
    createLegacyDb(dbPath)
    const result = ensureSchemaCompat(dbPath)
    assert.equal(result.ok, true)
    assert.deepEqual(result.addedColumns.sort(), [
      'Evaluation.blastWasSkipped',
      'Evaluation.maxPdbUsed',
      'Evaluation.pdbCountAtEval',
    ])
  })
})