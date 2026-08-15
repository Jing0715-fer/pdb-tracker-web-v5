/**
 * GET /api/db-list — list SQLite databases found in the project.
 *
 * Scans the `db/` directory (default location) for any `.db` files and returns
 * their absolute paths + display metadata so the DbSetupWizard can show them
 * in its "select existing database" step.
 *
 * For each file we also probe the schema via a throwaway PrismaClient to read
 * sqlite_master, so the wizard can show "X tables / not initialized" badges
 * next to each entry.
 *
 * Response:
 *   {
 *     databases: [
 *       { displayPath, fsPath, dbUrl, sizeBytes, mtime, isActive, hasSchema,
 *         tableCount, source }
 *     ],
 *     scannedDirs: string[],
 *     totalFound: number,
 *     activeDbPath: string | null,
 *   }
 */
export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { promises as fs, existsSync } from 'node:fs'
import * as path from 'node:path'
import { dbDir, isPackaged, dbConfigFile, writableRoot } from '@/lib/paths'

// Where to scan for existing .db files the user might want to switch to.
// In the packaged app only the userData db/ dir is scanned (the user's own
// databases). In dev we also scan the project db/ dir. The legacy
// `~/Documents/my_note/LLM-Wiki/data` path is dev-only and gated behind
// !isPackaged() so end users never see a developer-specific scan path.
const SCAN_DIRS: string[] = isPackaged()
  ? [dbDir()]
  : [dbDir(), path.resolve(process.env.HOME || '', 'Documents/my_note/LLM-Wiki/data')].filter(
      (d) => existsSync(d),
    )
const MAX_DEPTH = 2

async function scanDir(root: string, prefix: string, depth = 0): Promise<any[]> {
  if (depth > MAX_DEPTH) return []
  const entries: any[] = []
  try {
    const items = await fs.readdir(root, { withFileTypes: true })
    for (const item of items) {
      const full = path.join(root, item.name)
      const rel = prefix ? `${prefix}/${item.name}` : item.name
      if (item.isDirectory()) {
        if (['node_modules', '.next', '.git', 'download', '.zscripts'].includes(item.name)) continue
        const nested = await scanDir(full, rel, depth + 1)
        entries.push(...nested)
      } else if (item.isFile() && item.name.endsWith('.db')) {
        try {
          const stat = await fs.stat(full)
          entries.push({
            displayPath: rel,
            fsPath: full,
            dbUrl: `file:${full}`,
            sizeBytes: stat.size,
            mtime: stat.mtime.toISOString(),
            source: 'scan',
            // Filled in below
            isActive: false,
            hasSchema: false,
            tableCount: 0,
            tables: [],
          })
        } catch { /* ignore */ }
      }
    }
  } catch { /* dir missing or unreadable */ }
  return entries
}

async function probeSchema(fileUrl: string): Promise<{ hasSchema: boolean | null; tableCount: number; tables: string[]; probeError?: string }> {
  try {
    const { PrismaClient } = await import('@prisma/client')
    const probe = new PrismaClient({
      datasources: { db: { url: fileUrl } },
      log: ['error'],
    })
    try {
      const rows = await probe.$queryRaw<{ name: string }[]>`
        SELECT name FROM sqlite_master
        WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_prisma%'
        ORDER BY name
      `
      const tables = rows.map((r: any) => String(r.name))
      const expected = ['PdbStructure', 'Evaluation', 'PubMedArticle', 'WeeklyReport', 'WeeklySnapshot', 'SkillRunRecord']
      const hasSchema = expected.every((t) => tables.includes(t))
      return { hasSchema, tableCount: tables.length, tables }
    } finally {
      await probe.$disconnect().catch(() => {})
    }
  } catch (err: any) {
    // Distinguish "探测失败"(如文件被锁 / 引擎拒绝连接)from "真的空数据库"。
    // 前端用 hasSchema=null 显示"探测失败, 请重试",避免被误读为"未初始化"。
    return { hasSchema: null, tableCount: 0, tables: [], probeError: err?.message || String(err) }
  }
}

async function getActiveDbPath(): Promise<string | null> {
  try {
    const cfgPath = dbConfigFile()
    const raw = await fs.readFile(cfgPath, 'utf-8')
    const cfg = JSON.parse(raw)
    const raw0 = (cfg?.dbPath || '').replace(/^file:/, '')
    if (!raw0) return null
    if (!path.isAbsolute(raw0)) return path.resolve(writableRoot(), raw0)
    return raw0
  } catch {
    return null
  }
}

export async function GET() {
  const all: any[] = []
  const scanned: string[] = []
  for (const dir of SCAN_DIRS) {
    scanned.push(dir)
    const found = await scanDir(dir, path.basename(dir))
    all.push(...found)
  }
  // De-duplicate by absolute path.
  const seen = new Set<string>()
  const unique = all.filter((e) => {
    if (seen.has(e.fsPath)) return false
    seen.add(e.fsPath)
    return true
  })

  const activeAbs = await getActiveDbPath()

  // Probe schema for each (in parallel, with timeout).
  await Promise.all(unique.map(async (entry) => {
    if (activeAbs && entry.fsPath.toLowerCase() === activeAbs.toLowerCase()) {
      entry.isActive = true
    }
    const schema = await probeSchema(entry.dbUrl)
    entry.hasSchema = schema.hasSchema
    entry.tableCount = schema.tableCount
    entry.tables = schema.tables
  }))

  unique.sort((a, b) => {
    if (a.isActive && !b.isActive) return -1
    if (!a.isActive && b.isActive) return 1
    return (b.mtime || '').localeCompare(a.mtime || '')
  })

  return NextResponse.json({
    databases: unique,
    scannedDirs: scanned,
    totalFound: unique.length,
    activeDbPath: activeAbs,
  })
}