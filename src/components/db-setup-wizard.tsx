'use client'

/**
 * DbSetupWizard — first-run / re-run modal that guides the user to either
 *   ① create a brand-new SQLite database file, or
 *   ② select an existing one from a clickable list.
 *
 * WHY: The bundled `./db/custom.db` is a TEST-ONLY database. Real user data
 * must live in a user-chosen file. This wizard is the single entry point
 * that ensures every downstream module (① literature / ② evaluation /
 * ③ weekly) reads from and writes to the SAME user-confirmed database.
 *
 * The wizard calls `POST /api/db-config` which:
 *   • writes `.hermes/db-config.json`
 *   • runs `prisma db push` to initialize the schema (for new DBs)
 *   • calls `recreatePrismaClient()` so all 3 modules immediately see the
 *     new DB without a server restart
 *
 * Error handling: the dev server can crash (OOM) during the POST (which
 * spawns `bunx prisma db push`), causing the gateway to return an HTML 502
 * page. We detect this and show a friendly retry prompt instead of a
 * confusing "Unexpected token '<'" JSON parse error.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Database, FilePlus2, FolderOpen, Loader2, CheckCircle2, XCircle,
  AlertTriangle, ShieldCheck, ArrowRight, ArrowLeft, FileText, FlaskConical,
  HardDrive, RefreshCw, Search,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { useI18n } from '@/lib/i18n'
import { toast } from 'sonner'

export interface DbStatus {
  configuredDbPath: string | null
  confirmed: boolean
  activeUrl: string
  activeFsPath: string
  isTest: boolean
  exists: boolean
  hasSchema: boolean
  tableCount: number
  tables: string[]
  counts: Record<string, number>
  defaultTestPath: string
  testDbAbs: string
  updatedAt: string | null
}

export interface DbSetupWizardProps {
  open: boolean
  /** Called after the user successfully confirms a database. */
  onComplete: (status: DbStatus) => void
  /** Allow closing without setup (only offered when a confirmed DB already exists). */
  onClose?: () => void
  /** Whether the user is allowed to skip (only true when DB is already confirmed). */
  allowSkip?: boolean
  /** Initial step to show when opened. Default 'choose'. */
  initialMode?: 'choose' | 'create' | 'select'
  /** Ref attached to the dialog's content element so external code (e.g. the
      onboarding tour) can spotlight it. */
  contentRef?: React.RefObject<HTMLElement | null>;
}

interface DbListEntry {
  displayPath: string
  fsPath: string
  dbUrl: string
  sizeBytes: number
  mtime: string
  isActive: boolean
  /**
   * tri-state:
   *   true  — 探测成功 + 已包含全部 PDB Tracker  tables
   *   false — 探测成功 + 真的未初始化（空 SQLite 文件）
   *   null  — 探测失败（如 dev server 在持有 db 锁、Prisma 引擎冲突等），与「未初始化」不同
   *           前端展示「探测失败」徽章并提示Retry，避免误以为空文件。
   */
  hasSchema: boolean | null
  tableCount: number
  /** 当 hasSchema=null 时存了失败原因，便于诊断。 */
  probeError?: string
  tables?: string[]
  source: string
}

type Mode = 'choose' | 'create' | 'select' | 'working' | 'done' | 'error'

const DEFAULT_NEW_DB_DIR = 'db'
const DEFAULT_NEW_DB_NAME = 'my-pdb-tracker.db'

/**
 * Safely parse a fetch response as JSON. If the body is HTML (e.g. a 502
 * gateway error page), throw a friendly error instead of letting
 * `res.json()` produce "Unexpected token '<'".
 */
async function safeJson<T = any>(res: Response): Promise<T> {
  const ct = res.headers.get('content-type') || ''
  const text = await res.text()
  if (!ct.includes('application/json') || text.trimStart().startsWith('<')) {
    // HTML error page — likely 502 from gateway or a Next.js error page.
    if (res.status === 502 || text.includes('502')) {
      throw new Error('Server temporarily unresponsive (502). This usually happens when the server is low on memory during database initialization. Click Retry to try again.')
    }
    if (res.status >= 500) {
      throw new Error(`Server internal error (HTTP ${res.status}）. Click Retry, or check dev.log for details.`)
    }
    throw new Error(`Server returned non-JSON response (HTTP ${res.status}）. Click Retry.`)
  }
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error('无法解析服务器响应. Click Retry.')
  }
}

/** POST with retry — the dev server can crash mid-request during `prisma db push`. */
async function postDbConfigWithRetry(body: any, maxRetries = 2): Promise<any> {
  let lastErr: any
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch('/api/db-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await safeJson(res)
      if (!res.ok || !data.ok) {
        throw new Error(data.error || data.stderr || `HTTP ${res.status}`)
      }
      return data
    } catch (err: any) {
      lastErr = err
      // Only retry on network/502 errors (server crashed), not on validation errors.
      const msg = err?.message || ''
      const isRetryable = msg.includes('502') || msg.includes('Server') || msg.includes('Failed to fetch') || msg.includes('NetworkError')
      if (!isRetryable || attempt === maxRetries) throw err
      // Wait 2s before retrying to give the server time to recover.
      await new Promise((r) => setTimeout(r, 2000))
    }
  }
  throw lastErr
}

export function DbSetupWizard({ open, onComplete, onClose, allowSkip, initialMode = 'choose', contentRef }: DbSetupWizardProps) {
  const { t, locale } = useI18n()
  const [mode, setMode] = useState<Mode>('choose')
  const [newDbName, setNewDbName] = useState(DEFAULT_NEW_DB_NAME)
  const [newDbDir, setNewDbDir] = useState(DEFAULT_NEW_DB_DIR)
  const [existingPath, setExistingPath] = useState('')
  const [workingMsg, setWorkingMsg] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const [resultStatus, setResultStatus] = useState<DbStatus | null>(null)
  // Existing DB list for the "select" mode
  const [dbList, setDbList] = useState<DbListEntry[]>([])
  const [dbListLoading, setDbListLoading] = useState(false)
  const [dbListError, setDbListError] = useState('')
  const [dbListSearch, setDbListSearch] = useState('')
  const [selectedDbUrl, setSelectedDbUrl] = useState<string | null>(null)
  // Guard against re-entry on the loadDbList effect — without this, an
  // empty db/ directory causes an infinite re-render loop that floods the
  // dev server with /api/db-list calls until it 502s and the browser shows
  // a misleading "fail to fetch" error. Reset on wizard (re)open and on
  // explicit retry from the catch branch in loadDbList.
  const dbListAttemptedRef = useRef(false)

  // Reset to the initial step every time the wizard is (re)opened.
  // Idiomatic React: derive this from props during render via the
  // [prevOpen, prevInitialMode] tracker pattern, instead of resetting state
  // from inside an effect (which causes cascading renders).
  // The ref-reset happens in a separate effect, since React forbids writing
  // refs during render.
  const [prevOpen, setPrevOpen] = useState(open)
  const [prevInitialMode, setPrevInitialMode] = useState(initialMode)
  if (open !== prevOpen || initialMode !== prevInitialMode) {
    if (open) {
      setMode(initialMode)
      setNewDbName(DEFAULT_NEW_DB_NAME)
      setNewDbDir(DEFAULT_NEW_DB_DIR)
      setExistingPath('')
      setWorkingMsg('')
      setErrorMsg('')
      setResultStatus(null)
      setSelectedDbUrl(null)
      setDbListSearch('')
    }
    setPrevOpen(open)
    setPrevInitialMode(initialMode)
  }
  // Reset the loadDbList guard ref whenever the wizard reopens. This effect
  // does not call setState, so it does not violate the
  // react-hooks/set-state-in-effect rule.
  useEffect(() => {
    if (open) {
      dbListAttemptedRef.current = false
    }
  }, [open])

  // Fetch the list of existing databases when entering "select" mode.
    const loadDbList = useCallback(async () => {
      if (dbListAttemptedRef.current) return
      dbListAttemptedRef.current = true
      setDbListLoading(true)
      setDbListError('')
      try {
        const res = await fetch('/api/db-list')
        const data = await safeJson(res)
        setDbList(data.databases || [])
      } catch (err: any) {
        setDbListError(err?.message || (locale === 'zh' ? '加载列表失败' : 'Failed to load list'))
        setDbList([])
        // Allow a manual retry via the "刷新列表" button.
        dbListAttemptedRef.current = false
      } finally {
        setDbListLoading(false)
      }
    }, [locale])

  // Entering "select" mode should also kick off the fetch when the list is
  // empty. Done in a user-event handler (not an effect) so we don't trigger
  // cascading renders on every state update.
  const handleEnterSelectMode = useCallback(() => {
    setMode('select')
    if (dbList.length === 0 && !dbListLoading) {
      loadDbList()
    }
  }, [dbList.length, dbListLoading, loadDbList])

  const buildNewFsPath = useCallback(() => {
    const cleanDir = (newDbDir || '.').replace(/\/+$/, '')
    const cleanName = (newDbName || DEFAULT_NEW_DB_NAME).replace(/^\/+/, '')
    // Strip any accidental .db duplication.
    const name = cleanName.endsWith('.db') ? cleanName : `${cleanName}.db`
    return `${cleanDir}/${name}`
  }, [newDbDir, newDbName])

  const handleCreate = useCallback(async () => {
    const relPath = buildNewFsPath()
    const dbPath = `file:./${relPath.replace(/^\.?\//, '')}`
    setMode('working')
    setWorkingMsg(`${t.dbSetupCreating} ${relPath} and initializing schema…`)
    setErrorMsg('')
    try {
      await postDbConfigWithRetry({ dbPath, create: true, initSchema: true, confirmed: true })
      // Fetch updated status to surface to the caller.
      const sres = await fetch('/api/db-config')
      const status = await safeJson<DbStatus>(sres)
      setResultStatus(status)
      setMode('done')
      toast.success(t.dbSetupCreated, { description: relPath })
    } catch (err: any) {
      setErrorMsg(err?.message || String(err))
      setMode('error')
    }
  }, [buildNewFsPath])

  const handleSelect = useCallback(async (dbUrl?: string) => {
    const raw = (dbUrl || existingPath || '').trim()
    if (!raw) {
      setErrorMsg(t.dbSetupSelectPrompt)
      setMode('error')
      return
    }
    const dbPath = raw.startsWith('file:') ? raw : `file:${raw}`
    setMode('working')
    setWorkingMsg(`${t.dbSetupSwitching} ${raw.replace(/^file:/, '')} …`)
    setErrorMsg('')
    try {
      await postDbConfigWithRetry({ dbPath, create: false, initSchema: true, confirmed: true })
      const sres = await fetch('/api/db-config')
      const status = await safeJson<DbStatus>(sres)
      setResultStatus(status)
      setMode('done')
      toast.success(t.dbSetupSwitched, { description: raw.replace(/^file:/, '') })
    } catch (err: any) {
      setErrorMsg(err?.message || String(err))
      setMode('error')
    }
  }, [existingPath])

  const handleFinish = useCallback(() => {
    if (resultStatus) onComplete(resultStatus)
  }, [resultStatus, onComplete])

  const handleRetry = useCallback(() => {
    setMode('choose')
    setErrorMsg('')
  }, [])

  const filteredDbList = dbList.filter((e) => {
    if (!dbListSearch.trim()) return true
    return e.displayPath.toLowerCase().includes(dbListSearch.toLowerCase())
      || e.fsPath.toLowerCase().includes(dbListSearch.toLowerCase())
  })

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && allowSkip && onClose) onClose(); /* if !allowSkip, prevent closing — user must complete setup */ }}>
      <DialogContent
        ref={contentRef as React.Ref<HTMLDivElement> | undefined}
        className="max-w-2xl w-[92vw] !max-w-2xl p-0 overflow-hidden gap-0"
        /* When allowSkip is false we are in "forced setup" mode (first run,
           or post-tour with no confirmed DB). Block ALL dismiss gestures so
           the user cannot escape without creating/selecting a database:
             • Esc key
             • click on the overlay backdrop
             • the X close button (hidden via showCloseButton=false)
           Radix still fires onOpenChange(false), but our handler above
           ignores it when !allowSkip, and these interceptors stop the
           visual dismiss animation from running. */
        showCloseButton={allowSkip}
        onEscapeKeyDown={(e) => { if (!allowSkip) e.preventDefault(); }}
        onPointerDownOutside={(e) => { if (!allowSkip) e.preventDefault(); }}
        onInteractOutside={(e) => { if (!allowSkip) e.preventDefault(); }}
      >
        <DialogHeader className="px-6 pt-7 pb-5 border-b border-border/50">
          <DialogTitle className="flex items-center gap-2 text-base leading-none">
            <Database className="h-4 w-4 text-amber-500" />
            {t.dbSetupTitle}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground mt-2.5 leading-relaxed">
            {t.dbSetupDesc}
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 py-6 max-h-[70vh] overflow-y-auto">
          <AnimatePresence mode="wait">
            {/* ── Step 1: choose ─────────────────────────────────────── */}
            {mode === 'choose' && (
              <motion.div
                key="choose"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="space-y-5"
              >
                <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3.5 flex gap-2.5">
                  <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0 mt-0.5" />
                  <div className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
                    <div className="font-semibold mb-0.5">{t.dbSetupTestTitle}</div>
                    默认的 <code className="font-mono text-3xs bg-amber-500/10 px-1 rounded">db/custom.db</code> is a test database, not for real data. We recommend creating a new database for daily work.
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <button
                    onClick={() => setMode('create')}
                    className="group text-left rounded-lg border border-border hover:border-claude-accent/50 hover:bg-claude-accent/5 p-5 transition-all"
                  >
                    <div className="flex items-center gap-2 mb-2.5">
                      <div className="w-8 h-8 rounded-md bg-emerald-500/10 flex items-center justify-center">
                        <FilePlus2 className="h-4 w-4 text-emerald-600" />
                      </div>
                      <span className="text-sm font-medium">{t.dbSetupCreate}</span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Create a new empty SQLite database file and auto-initialize the schema. Recommended for first use.
                    </p>
                  </button>

                  <button
                    onClick={handleEnterSelectMode}
                    className="group text-left rounded-lg border border-border hover:border-claude-accent/50 hover:bg-claude-accent/5 p-5 transition-all"
                  >
                    <div className="flex items-center gap-2 mb-2.5">
                      <div className="w-8 h-8 rounded-md bg-sky-500/10 flex items-center justify-center">
                        <FolderOpen className="h-4 w-4 text-sky-600" />
                      </div>
                      <span className="text-sm font-medium">{t.dbSetupSelect}</span>
                    </div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Click to select an existing database file from the list. Missing tables will be auto-created.
                    </p>
                  </button>
                </div>

                {allowSkip && onClose && (
                  <div className="flex justify-end pt-1">
                    <Button variant="ghost" size="sm" className="text-xs h-7" onClick={onClose}>
                      {t.dbSetupSkip}
                    </Button>
                  </div>
                )}
              </motion.div>
            )}

            {/* ── Step 2a: create ────────────────────────────────────── */}
            {mode === 'create' && (
              <motion.div
                key="create"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="space-y-4"
              >
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">{t.dbSetupDbDir}</Label>
                  <Input
                    value={newDbDir}
                    onChange={(e) => setNewDbDir(e.target.value)}
                    placeholder="db"
                    className="h-9 text-xs font-mono mt-1"
                  />
                  <p className="text-3xs text-muted-foreground mt-1">Default location: project <code>db/</code> directory.</p>
                </div>
                <div>
                  <Label className="text-xs uppercase tracking-wider text-muted-foreground">{t.dbSetupDbName}</Label>
                  <Input
                    value={newDbName}
                    onChange={(e) => setNewDbName(e.target.value)}
                    placeholder="my-pdb-tracker.db"
                    className="h-9 text-xs font-mono mt-1"
                  />
                  <p className="text-3xs text-muted-foreground mt-1">Will create a SQLite file with <code>.db</code> extension.</p>
                </div>
                <div className="rounded-md bg-muted/40 p-3 text-xs">
                  <div className="text-muted-foreground mb-1">最终路径：</div>
                  <code className="font-mono text-[11px] break-all">./{buildNewFsPath().replace(/^\.?\//, '')}</code>
                </div>
                <div className="flex justify-between gap-2 pt-2">
                  <Button variant="ghost" size="sm" className="text-xs h-8" onClick={() => setMode('choose')}>
                    <ArrowLeft className="h-3 w-3 mr-1" /> Back
                  </Button>
                  <Button size="sm" className="h-8 text-xs" onClick={handleCreate}>
                    <FilePlus2 className="h-3 w-3 mr-1" /> {t.dbSetupCreateInit}
                  </Button>
                </div>
              </motion.div>
            )}

            {/* ── Step 2b: select ────────────────────────────────────── */}
            {mode === 'select' && (
              <motion.div
                key="select"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="space-y-4"
              >
                {/* Search box */}
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={dbListSearch}
                    onChange={(e) => setDbListSearch(e.target.value)}
                    placeholder={t.dbSetupSearchDb}
                    className="h-9 text-xs pl-8 pr-8"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 p-0"
                    onClick={loadDbList}
                    title="Refresh List"
                  >
                    <RefreshCw className={`h-3 w-3 ${dbListLoading ? 'animate-spin' : ''}`} />
                  </Button>
                </div>

                {/* Clickable list of existing databases */}
                {dbListLoading ? (
                  <div className="flex flex-col items-center justify-center py-10 gap-2">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    <p className="text-xs text-muted-foreground">{t.dbSetupScanning}</p>
                  </div>
                ) : dbListError ? (
                  <div className="rounded-md border border-rose-500/30 bg-rose-500/5 p-3 text-xs text-rose-600">
                    {dbListError}
                  </div>
                ) : filteredDbList.length === 0 ? (
                  <div className="rounded-md border border-dashed border-border/60 bg-muted/20 px-3 py-6 text-center">
                    <FolderOpen className="mx-auto h-5 w-5 text-muted-foreground/60" />
                    <p className="mt-1.5 text-xs text-muted-foreground">
                      {dbListSearch ? (locale === 'zh' ? '未找到匹配的数据库' : 'No matching databases') : (locale === 'zh' ? '未找到已有数据库文件' : 'No existing database files found')}
                    </p>
                    <p className="text-3xs text-muted-foreground/70 mt-1">
                      {locale === 'zh' ? '可在下方手动输入路径，或返回' : 'Enter a path manually below, or go back to '}{t.dbSetupCreate}
                    </p>
                  </div>
                ) : (
                  <ScrollArea className="h-[280px] rounded-md border border-border/40">
                    <div className="divide-y divide-border/30">
                      {filteredDbList.map((db) => {
                                              const isSel = selectedDbUrl === db.dbUrl
                                              return (
                                                <button
                                                  key={`${db.fsPath}#${db.dbUrl}`}
                                                  type="button"
                                                  aria-pressed={isSel}
                                                  onClick={() => setSelectedDbUrl(isSel ? null : db.dbUrl)}
                                                  className={`w-full text-left px-3 py-2.5 transition-colors flex items-start gap-2.5 ${
                                                    isSel
                                                      ? 'bg-sky-500/15 ring-2 ring-sky-500 border-l-[3px] border-l-sky-500'
                                                      : 'hover:bg-muted/40 border-l-[3px] border-l-transparent'
                                                  }`}
                                                >
                                                  <HardDrive className={`h-4 w-4 mt-0.5 shrink-0 ${db.isActive ? 'text-emerald-500' : isSel ? 'text-sky-500' : 'text-muted-foreground'}`} />
                                                  <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-1.5 flex-wrap">
                                                      <code className="text-[11px] font-mono text-foreground break-all">{db.displayPath}</code>
                                                      {db.isActive && (
                                                        <Badge variant="outline" className="text-xs font-medium px-2 h-5 gap-1 rounded-md shrink-0 border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
                                                          <CheckCircle2 className="h-2.5 w-2.5" /> Current
                                                        </Badge>
                                                      )}
                                                      {db.hasSchema === true && (
                                                        <Badge variant="outline" className="text-xs font-medium px-2 h-5 gap-1 rounded-md shrink-0 border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-300">
                                                          {db.tableCount}  tables
                                                        </Badge>
                                                      )}
                                                      {db.hasSchema === false && (
                                                        <Badge variant="outline" className="text-xs font-medium px-2 h-5 gap-1 rounded-md shrink-0 border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300">
                                                          未初始化
                                                        </Badge>
                                                      )}
                                                      {db.hasSchema === null && (
                                                        <Badge variant="outline" className="text-xs font-medium px-2 h-5 gap-1 rounded-md shrink-0 border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-300" title={db.probeError || '探测失败，请点击刷新按钮Retry'}>
                                                          探测失败
                                                        </Badge>
                                                      )}
                                                    </div>
                                                    <div className="text-3xs text-muted-foreground mt-0.5 flex items-center gap-2">
                                                      <span>{formatSize(db.sizeBytes)}</span>
                                                      <span>·</span>
                                                      <span>{new Date(db.mtime).toLocaleDateString('zh-CN')} {new Date(db.mtime).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</span>
                                                    </div>
                                                  </div>
                                                  {/* Radio indicator on the right */}
                                                  <div className={`mt-1 h-4 w-4 rounded-full border-2 shrink-0 flex items-center justify-center ${
                                                    isSel ? 'border-emerald-500 bg-emerald-500/10' : 'border-muted-foreground/30'
                                                  }`}>
                                                    {isSel && <div className="h-2 w-2 rounded-full bg-emerald-500" />}
                                                  </div>
                                                </button>
                                              )
                                            })}
                                             </div>
                  </ScrollArea>
                )}

                {/* Manual path input (fallback) */}
                <details className="text-xs">
                  <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">
                    {t.dbSetupManualPath}
                  </summary>
                  <div className="mt-2">
                    <Input
                      value={existingPath}
                      onChange={(e) => { setExistingPath(e.target.value); setSelectedDbUrl(null) }}
                      placeholder="/path/to/existing.db 或 ./db/backup.db"
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                </details>

                <div className="rounded-md bg-sky-500/5 border border-sky-500/20 p-3 text-xs text-sky-700 dark:text-sky-300">
                  <ShieldCheck className="h-3.5 w-3.5 inline mr-1" />
                  {t.dbSetupAutoCreate} <code className="font-mono text-3xs">prisma db push</code> {t.dbSetupAutoCreate2}
                </div>
                <div className="flex justify-between gap-2 pt-2">
                  <Button variant="ghost" size="sm" className="text-xs h-8" onClick={() => setMode('choose')}>
                    <ArrowLeft className="h-3 w-3 mr-1" /> Back
                  </Button>
                  <Button
                    size="sm"
                    className="h-8 text-xs"
                    onClick={() => handleSelect(selectedDbUrl || undefined)}
                    disabled={!selectedDbUrl && !existingPath.trim()}
                  >
                    <FolderOpen className="h-3 w-3 mr-1" /> {t.dbSetupSwitch}
                  </Button>
                </div>
              </motion.div>
            )}

            {/* ── Step 3: working ────────────────────────────────────── */}
            {mode === 'working' && (
              <motion.div
                key="working"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-center justify-center py-12 gap-3"
              >
                <Loader2 className="h-8 w-8 animate-spin text-claude-accent" />
                <p className="text-sm text-foreground">{workingMsg}</p>
                <p className="text-xs text-muted-foreground">正在初始化 tables结构，请稍候…</p>
              </motion.div>
            )}

            {/* ── Step 4a: done ──────────────────────────────────────── */}
            {mode === 'done' && resultStatus && (
              <motion.div
                key="done"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="space-y-4"
              >
                <div className="flex items-start gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-emerald-700 dark:text-emerald-300">数据库已就绪</div>
                    <div className="text-xs text-muted-foreground mt-1 break-all font-mono">
                      {resultStatus.activeFsPath}
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      <Badge variant="outline" className="text-xs font-medium px-2 h-5 gap-1 rounded-md shrink-0 border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">
                        <CheckCircle2 className="h-2.5 w-2.5" />  tables结构已初始化
                      </Badge>
                      <Badge variant="outline" className="text-xs font-medium px-2 h-5 gap-1 rounded-md shrink-0 border-border/60 bg-muted/40 text-muted-foreground">
                        {resultStatus.tableCount}  tables
                      </Badge>
                      {!resultStatus.isTest && (
                        <Badge variant="outline" className="text-xs font-medium px-2 h-5 gap-1 rounded-md shrink-0 border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-300">
                          <ShieldCheck className="h-2.5 w-2.5" /> 正式数据库
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>

                <div className="rounded-md border border-border/60 bg-muted/20 p-3">
                  <div className="text-xs font-medium text-foreground mb-2 flex items-center gap-1.5">
                    <Database className="h-3.5 w-3.5 text-muted-foreground" />
                    Current database内容统计
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-[11px]">
                    <CountCell label="PDB 结构" value={resultStatus.counts?.PdbStructure ?? 0} icon={<FileText className="h-3 w-3" />} />
                    <CountCell label="评估记录" value={resultStatus.counts?.Evaluation ?? 0} icon={<FlaskConical className="h-3 w-3" />} />
                    <CountCell label="PubMed 论文" value={resultStatus.counts?.PubMedArticle ?? 0} icon={<FileText className="h-3 w-3" />} />
                    <CountCell label="周报" value={resultStatus.counts?.WeeklyReport ?? 0} icon={<FileText className="h-3 w-3" />} />
                    <CountCell label="运行记录" value={resultStatus.counts?.SkillRunRecord ?? 0} icon={<Database className="h-3 w-3" />} />
                    <CountCell label="快照" value={resultStatus.counts?.WeeklySnapshot ?? 0} icon={<Database className="h-3 w-3" />} />
                  </div>
                </div>

                <div className="text-xs text-muted-foreground bg-muted/30 rounded-md p-3 leading-relaxed">
                  <Database className="h-3 w-3 inline mr-1" />
                  运行中心与 ① 文献 / ② 评估 / ③ 周报三大模块现在都读写这个数据库。运行中心写入的内容会立即在前端可读。
                </div>

                <div className="flex justify-end pt-2">
                  <Button size="sm" className="h-8 text-xs" onClick={handleFinish}>
                    开始使用 <ArrowRight className="h-3 w-3 ml-1" />
                  </Button>
                </div>
              </motion.div>
            )}

            {/* ── Step 4b: error ─────────────────────────────────────── */}
            {mode === 'error' && (
              <motion.div
                key="error"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="space-y-4"
              >
                <div className="flex items-start gap-3 rounded-lg border border-rose-500/30 bg-rose-500/5 p-4">
                  <XCircle className="h-5 w-5 text-rose-600 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-rose-700 dark:text-rose-300">{t.dbSetupOperationFailed}</div>
                    <div className="text-xs text-muted-foreground mt-1 break-all">{errorMsg}</div>
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" size="sm" className="h-8 text-xs" onClick={handleRetry}>
                    Back to Retry
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function CountCell({ label, value, icon }: { label: string; value: number; icon: React.ReactNode }) {
  return (
    <div className="flex items-center gap-1.5 px-2 py-1.5 rounded bg-background/60 border border-border/40">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-muted-foreground">{label}</span>
      <span className="ml-auto font-mono font-semibold text-foreground">{value}</span>
    </div>
  )
}

export default DbSetupWizard
