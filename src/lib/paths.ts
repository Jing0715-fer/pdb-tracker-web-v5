/**
 * Central resolver for runtime-writable filesystem locations.
 *
 * Why this exists:
 *   In the packaged Electron .app, the Next.js standalone server runs with
 *   `cwd = <app>/.next/standalone/` — INSIDE the .app bundle, which macOS
 *   mounts read-only. Any code that writes to `resolve(process.cwd(), ...)`
 *   (`.hermes/db-config.json`, user-created SQLite files, logs) fails with
 *   `EROFS: read-only file system`.
 *
 *   `electron/main.js` sets `PDB_USER_DATA_DIR` to `app.getPath('userData')`
 *   before spawning the server. This module reads that env var and anchors
 *   ALL writable paths to it. In dev (env var unset) we fall back to
 *   `process.cwd()` (the project root), preserving the original dev behaviour.
 */
import { resolve, isAbsolute } from 'node:path'
import { mkdirSync } from 'node:fs'

/** The writable root: userData in packaged app, project root in dev. */
export function writableRoot(): string {
  const ud = process.env.PDB_USER_DATA_DIR
  if (ud && ud.length > 0) return ud
  return process.cwd()
}

/** True when running inside the packaged Electron app. */
export function isPackaged(): boolean {
  return !!process.env.PDB_USER_DATA_DIR
}

/** The `.hermes/` dir (db-config.json + LLM cache). Created if missing. */
export function hermesDir(): string {
  const d = resolve(writableRoot(), '.hermes')
  mkdirSync(d, { recursive: true })
  return d
}

/** The `db/` dir (user SQLite files). Created if missing. */
export function dbDir(): string {
  const d = resolve(writableRoot(), 'db')
  mkdirSync(d, { recursive: true })
  return d
}

/** Absolute path to `.hermes/db-config.json` (the single source of truth). */
export const dbConfigFile = (): string => resolve(hermesDir(), 'db-config.json')

/**
 * The bundled test database path. In dev this is `<cwd>/db/custom.db`
 * (shipped for smoke-testing). In the packaged app there is no bundled test
 * DB, so we point at `<userData>/db/custom.db` — which the wizard can create
 * on demand.
 */
export const defaultTestDbPath = (): string => resolve(dbDir(), 'custom.db')

/**
 * Resolve a user-supplied dbPath (may be relative or absolute, may or may
 * not have a `file:` prefix) to an absolute `file:` URL anchored to the
 * writable root.
 */
export function normalizeToWritableUrl(raw: string): string {
  const trimmed = (raw || '').replace(/^file:/, '').trim()
  if (!trimmed) return `file:${defaultTestDbPath()}`
  const abs = isAbsolute(trimmed) ? trimmed : resolve(writableRoot(), trimmed)
  return `file:${abs}`
}
