import { PrismaClient } from '@prisma/client'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import { dbConfigFile, defaultTestDbPath, writableRoot } from '@/lib/paths'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

/**
 * The default / "test" database path bundled with the project.
 *
 * This file is shipped only for smoke-testing the schema — it must NOT be
 * used to store real user data. The first-run wizard will prompt the user
 * to either create a new database file or select an existing one, and the
 * chosen path is persisted to `.hermes/db-config.json` (under the writable
 * root — see src/lib/paths.ts).
 */
export const DEFAULT_TEST_DB_PATH = `file:${defaultTestDbPath()}`

/**
 * Resolve the database URL using the SAME resolution order as `PrismaClient`
 * instantiation. This is the single source of truth for "what database is
 * the app actually talking to right now".
 *
 *   1. `.hermes/db-config.json` written by the UI (`/api/db-config`)
 *   2. `DATABASE_URL` from `.env`
 *   3. The bundled test database `file:<writableRoot>/db/custom.db`
 *
 * Relative paths are anchored to the WRITABLE ROOT (userData in the packaged
 * app, project root in dev) — never to an individual API route's CWD, and
 * never to the read-only .app bundle.
 */
export function resolveDbUrl(): string {
  // 1. Try the config file written by the UI (/api/db-config).
  try {
    const cfgPath = dbConfigFile()
    if (existsSync(cfgPath)) {
      try {
        const raw = readFileSync(cfgPath, 'utf-8')
        const cfg = JSON.parse(raw)
        if (cfg && typeof cfg.dbPath === 'string' && cfg.dbPath.length > 0) {
          return normalizeDbUrl(cfg.dbPath)
        }
      } catch {
        /* malformed config — fall through to env */
      }
    }
  } catch {
    /* fs unavailable — fall through to env */
  }

  // 2. Fall back to DATABASE_URL from .env (relative paths anchored to writable root).
  const envUrl = process.env.DATABASE_URL || DEFAULT_TEST_DB_PATH
  return normalizeDbUrl(envUrl)
}

/** Convert a user-provided dbPath into a normalized `file:` URL. */
export function normalizeDbUrl(raw: string): string {
  const trimmed = (raw || '').replace(/^file:/, '').trim()
  if (!trimmed) return DEFAULT_TEST_DB_PATH
  if (!isAbsolute(trimmed)) {
    return `file:${resolve(writableRoot(), trimmed)}`
  }
  return `file:${trimmed}`
}

/** Return the absolute filesystem path (no `file:` prefix) of the active DB. */
export function getActiveDbFsPath(): string {
  return resolveDbUrl().replace(/^file:/, '')
}

/** Return true when the currently-resolved DB is the bundled test database. */
export function isActiveDbTest(): boolean {
  const active = getActiveDbFsPath()
  return active === defaultTestDbPath()
}

/**
 * Lazily create / fetch the current PrismaClient.
 *
 * On every access we call `resolveDbUrl()` and compare it with the URL the
 * cached client was created with. If the config file was updated (e.g. by
 * the setup wizard or the Run Center), we transparently disconnect the old
 * client and build a fresh one bound to the new path — no explicit
 * `recreatePrismaClient()` call needed.
 *
 * This is the key invariant that keeps the `db` Proxy, the Run Center's
 * status display, and all 3 skill modules (literature / eval / weekly)
 * reading/writing the SAME database at all times.
 */
let _cachedDbUrl: string | null = null

function getOrCreateClient(): PrismaClient {
  const resolvedUrl = resolveDbUrl()
  // Config changed since last access → rebuild the client.
  if (globalForPrisma.prisma && _cachedDbUrl !== resolvedUrl) {
    globalForPrisma.prisma.$disconnect().catch(() => {})
    globalForPrisma.prisma = undefined
  }
  if (!globalForPrisma.prisma) {
    _cachedDbUrl = resolvedUrl
    globalForPrisma.prisma = new PrismaClient({
      datasources: { db: { url: resolvedUrl } },
      log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    })
  }
  return globalForPrisma.prisma
}

/**
 * Drop the cached PrismaClient (and disconnect it) so that the next access
 * rebuilds a client bound to whatever path is currently in
 * `.hermes/db-config.json`.
 *
 * Called by `/api/db-config` POST after writing a new config.
 */
export async function recreatePrismaClient(): Promise<void> {
  const old = globalForPrisma.prisma
  globalForPrisma.prisma = undefined
  if (old) {
    try {
      await old.$disconnect()
    } catch {
      /* ignore — we're throwing it away anyway */
    }
  }
}

/** Test/clear helper — used by API routes that want to force re-read. */
export function _resetDbForTest(): void {
  if (globalForPrisma.prisma) {
    globalForPrisma.prisma.$disconnect().catch(() => {})
  }
  globalForPrisma.prisma = undefined
}

/**
 * Proxy-backed `db` export.
 *
 * Every property access is forwarded to the *current* underlying
 * `PrismaClient` instance. Methods are bound to the underlying client so
 * `this` is correct. This lets all 3 skill modules (literature / eval /
 * weekly) read & write through the same active database without anyone
 * holding a stale reference after the user switches DB.
 */
export const db = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    const client = getOrCreateClient()
    const value = Reflect.get(client, prop, receiver)
    if (typeof value === 'function') {
      return value.bind(client)
    }
    return value
  },
}) as PrismaClient

if (process.env.NODE_ENV !== 'production') {
  // Ensure the client exists on first import in dev so errors surface early.
  getOrCreateClient()
}
