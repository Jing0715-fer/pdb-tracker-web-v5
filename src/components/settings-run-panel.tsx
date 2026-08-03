'use client';

/**
 * SettingsRunPanel — optimized "Skills & Manual Run" popup.
 *
 * This is a faithful functional port of the pdb-tracker-web-v3 component but
 * with a substantially upgraded UI:
 *
 *   • Tabbed navigation across the three skill modules (instead of one long scroll)
 *   • Gradient-accented module cards with clear visual hierarchy
 *   • Animated SSE progress feed with color-coded levels, progress bar, auto-scroll
 *   • Polished LLM provider selector with status pills + scan animation
 *   • Collapsible LLM advanced config, full dark mode, responsive layout
 *   • Framer Motion micro-interactions for state transitions
 *
 * The three modules mirror the original backend contracts:
 *   ① POST /api/literature/daily/run  — Structure-Biology Daily Literature Report
 *   ② POST /api/evaluations/run       — Target Evaluation + LLM Report (atomic)
 *   ③ POST /api/pdb-weekly/run        — Manual PDB Weekly Report (SSE, 1–3 cycles)
 *
 * LLM config (provider / apiKey / baseUrl / model / system) is shared across
 * ① / ② and flows into ③ via the same `llm` body field.
 */

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useRunStream, type StreamEvent } from '@/lib/use-run-stream';
import { useI18n } from '@/lib/i18n';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LazyMarkdown } from '@/components/lazy-markdown';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BookOpen,
  FlaskConical,
  Sparkles,
  Settings2,
  Play,
  Loader2,
  CheckCircle2,
  XCircle,
  Plus,
  X,
  RefreshCw,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  History,
  Activity,
  Cpu,
  Database,
  Save,
  FileText,
  Zap,
  Terminal,
  Lock,
  Layers,
  Search,
  Copy,
  Check,
  AlertTriangle,
  FileDown,
  Download,
  Clock,
  FilePlus2,
  FolderOpen,
} from 'lucide-react';
import { toast } from 'sonner';
import { DbSetupWizard, type DbStatus } from '@/components/db-setup-wizard';
import { SearchPathStats } from '@/components/search-path-stats';

/* ──────────────────────────────────────────────────────────────────────── */
/*  Types                                                                    */
/* ──────────────────────────────────────────────────────────────────────── */

interface LlmInfo {
  env: {
    provider?: string;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
  };
  chosen: string;
  available: Array<{
    provider: string;
    bin?: string | null;
    icon: string;
  /** When set, render <img /> instead of emoji. */
  iconUrl?: string | null;
    label: string;
    reason: string;
    available: boolean;
    via: 'native' | 'wsl' | 'sdk';
  }>;
  totalClisScanned: number;
}

interface LlmUserConfig {
  provider: string;
  apiKey: string;
  baseUrl: string;
  model: string;
  system: string;
}

interface RunLog {
  ts: string;
  module: 'literature' | 'eval' | 'weekly';
  status: 'running' | 'success' | 'error';
  summary: string;
  details?: string;
  durationMs?: number;
}

const DEFAULT_LLM_CFG: LlmUserConfig = {
  provider: '',
  apiKey: '',
  baseUrl: '',
  model: '',
  system: '',
};

const STORAGE_KEY = 'pdb-tracker:llm-cfg:v2';
const STORAGE_PROVIDER_KEY = 'pdb-tracker:llm-provider:v2';
const AUTO_PROVIDER = '__auto__';

/* ──────────────────────────────────────────────────────────────────────── */
/*  localStorage helpers                                                     */
/* ──────────────────────────────────────────────────────────────────────── */

function loadStoredProvider(): string {
  if (typeof window === 'undefined') return AUTO_PROVIDER;
  try { return localStorage.getItem(STORAGE_PROVIDER_KEY) || AUTO_PROVIDER; } catch { return AUTO_PROVIDER; }
}
function loadStoredCfg(): LlmUserConfig {
  if (typeof window === 'undefined') return DEFAULT_LLM_CFG;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_LLM_CFG;
    return { ...DEFAULT_LLM_CFG, ...JSON.parse(raw) };
  } catch { return DEFAULT_LLM_CFG; }
}
function persistProvider(p: string) { try { localStorage.setItem(STORAGE_PROVIDER_KEY, p); } catch { /* ignore */ } }
function persistCfg(c: LlmUserConfig) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(c)); } catch { /* ignore */ } }

/* ──────────────────────────────────────────────────────────────────────── */
/*  Small presentational helpers                                             */
/* ──────────────────────────────────────────────────────────────────────── */

function levelColor(level?: string) {
  // Use standard Tailwind colors for status — guaranteed distinct from ALL 6 theme accents.
  // Theme accents: claude(#c96442), ocean(#2d8f8f), forest(#16a34a), sunset(#ea580c), berry(#7c5cbf), rose(#e11d48)
  // emerald-500(#10b981) ≠ forest(#16a34a) and ≠ ocean(#2d8f8f) — distinct hue/brightness
  // red-500(#ef4444) ≠ rose(#e11d48) — different red shade
  // amber-500(#f59e0b) ≠ sunset(#ea580c) — yellow-orange vs red-orange
  switch (level) {
    case 'error': return 'text-red-500 dark:text-red-400';
    case 'warn': return 'text-amber-500 dark:text-amber-400';
    case 'success': return 'text-emerald-500 dark:text-emerald-400';
    default: return 'text-claude-accent';
  }
}

function StatusPill({ running, done, ok }: { running: boolean; done: boolean; ok: boolean }) {
  if (running) {
    return (
      <Badge variant="outline" className="text-xs font-medium px-2 h-5 gap-1 rounded-md shrink-0 bg-claude-accent/10 text-claude-accent border-claude-accent/30">
        <Loader2 className="h-2.5 w-2.5 animate-spin" /> streaming
      </Badge>
    );
  }
  if (done) {
    return ok ? (
      <Badge variant="outline" className="text-xs font-medium px-2 h-5 gap-1 rounded-md shrink-0 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30">
        <CheckCircle2 className="h-3 w-3" /> done
      </Badge>
    ) : (
      <Badge variant="outline" className="text-xs font-medium px-2 h-5 gap-1 rounded-md shrink-0 bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/30">
        <XCircle className="h-3 w-3" /> failed
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-xs font-medium px-2 h-5 gap-1 rounded-md shrink-0 bg-claude-border-light/60 dark:bg-[#2b2926]/60 text-claude-text-muted dark:text-[#9b9590] border-claude-border/60 dark:border-[#3d3832]/60">
      <Activity className="h-3 w-3" /> idle
    </Badge>
  );
}

/** Animated SSE event feed used by all three modules. */
function StreamFeed({
  events,
  running,
  done,
  ok,
  emptyHint,
}: {
  events: StreamEvent[];
  running: boolean;
  done: boolean;
  ok: boolean;
  emptyHint: string;
}) {
  const lastProgress = events.filter(e => typeof e.progress === 'number').slice(-1)[0]?.progress ?? null;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const startTime = events[0]?.ts;
  const [elapsed, setElapsed] = useState(0);

  // live elapsed timer while running
  useEffect(() => {
    if (!running || !startTime) return;
    const tick = () => setElapsed(Date.now() - new Date(startTime).getTime());
    tick();
    const id = setInterval(tick, 200);
    return () => clearInterval(id);
  }, [running, startTime]);

  // auto-scroll to bottom when new events arrive (unless user paused)
  useEffect(() => {
    if (running && autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events.length, running, autoScroll]);

  if (events.length === 0) {
    return (
      <div className="mt-3 rounded-lg border border-dashed border-claude-border/60 dark:border-[#3d3832]/60 bg-claude-bg/40 dark:bg-[#1a1917]/40 px-3 py-4 text-center">
        <Terminal className="mx-auto h-4 w-4 text-claude-text-muted/60 dark:text-[#9b9590]/60" />
        <p className="mt-1.5 text-sm text-claude-text-muted dark:text-[#9b9590]">{emptyHint}</p>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-claude-border/60 dark:border-[#3d3832]/60 bg-claude-bg/40 dark:bg-[#1a1917]/40 overflow-hidden">
      {/* header */}
      <div className="flex items-center justify-between gap-2 px-3 py-1.5 border-b border-claude-border/60 dark:border-[#3d3832]/60 bg-claude-surface/60 dark:bg-[#242220]/60">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-claude-text-muted dark:text-[#9b9590]">Live Progress</span>
          <span className="text-xs text-claude-text-muted/70 dark:text-[#9b9590]/70">({events.length} events)</span>
          {running && startTime && (
            <span className="text-xs font-mono text-claude-cryoem tabular-nums flex items-center gap-0.5">
              <Clock className="h-2.5 w-2.5" />{(elapsed / 1000).toFixed(1)}s
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setAutoScroll(a => !a)}
            className={`text-xs font-medium px-2 h-5 gap-1 rounded-md border transition-colors inline-flex items-center ${autoScroll ? 'border-claude-accent/40 text-claude-accent bg-claude-accent/10' : 'border-claude-border/60 dark:border-[#3d3832]/60 text-claude-text-muted dark:text-[#9b9590] hover:text-claude-text dark:hover:text-[#e8e4dd] bg-claude-border-light/40 dark:bg-[#2b2926]/40'}`}
            title={autoScroll ? 'Auto-scrolling, click to pause' : 'Paused, click to resume'}
          >
            {autoScroll ? 'auto' : 'paused'}
          </button>
          <StatusPill running={running} done={done} ok={ok} />
        </div>
      </div>

      {/* progress bar with percentage label */}
      {typeof lastProgress === 'number' && (
        <div className="px-3 pt-2.5 pb-1.5">
          <div className="flex items-center justify-between mb-1">
            <span className="text-3xs font-mono text-claude-text-muted dark:text-[#9b9590] tabular-nums">
              {lastProgress < 100 ? 'processing' : 'complete'} · {lastProgress}%
            </span>
            {done && (
              <span className={`text-xs font-mono font-semibold tabular-nums ${ok ? 'text-emerald-500 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                {ok ? '✓' : '✗'} {(elapsed / 1000).toFixed(1)}s
              </span>
            )}
          </div>
          <div className="relative h-1.5 rounded-full bg-claude-border-light dark:bg-[#3d3832] overflow-hidden">
            <motion.div
              className={`absolute inset-y-0 left-0 rounded-full ${
                done ? (ok ? 'bg-emerald-500' : 'bg-red-500') : 'bg-claude-accent'
              }`}
              initial={{ width: 0 }}
              animate={{ width: `${lastProgress}%` }}
              transition={{ type: 'spring', stiffness: 120, damping: 20 }}
            >
              {running && (
                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-[shimmer_1.5s_infinite]" />
              )}
            </motion.div>
          </div>
        </div>
      )}

      {/* stage timeline strip — collapses repeated stages into milestones */}
      <StageTimeline events={events} />

      {/* log lines */}
      <div ref={scrollRef} className="max-h-44 overflow-y-auto px-3 py-2 space-y-1">
        {events.map((e, i) => {
          const txt = (e.detail || e.message || e.stage || '').toString().trim();
          if (!txt) return null;
          return (
            <div key={i} className="text-xs font-mono flex gap-2 leading-relaxed">
              <span className="text-claude-text-muted/60 dark:text-[#9b9590]/60 shrink-0 tabular-nums">
                {new Date(e.ts).toLocaleTimeString('en-GB', { hour12: false })}
              </span>
              <span className={`shrink-0 font-semibold ${levelColor(e.level)}`}>
                {e.stage || e.level || 'info'}
              </span>
              <span className="flex-1 text-claude-text/80 dark:text-[#e8e4dd]/80 truncate" title={txt}>{txt}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * StageTimeline — a horizontal strip of milestone "chips" derived from the SSE
 * event stream. Collapses repeated stages (e.g. multiple `llm-digest` events)
 * into a single chip, colour-coding by the latest level seen for that stage.
 */
function StageTimeline({ events }: { events: StreamEvent[] }) {
  // Build an ordered list of unique stages with their latest level + progress.
  const stageMap = new Map<string, { level?: string; progress?: number; count: number }>();
  const order: string[] = [];
  for (const e of events) {
    const stage = e.stage || e.level || 'info';
    if (!stageMap.has(stage)) {
      stageMap.set(stage, { level: e.level, progress: e.progress, count: 1 });
      order.push(stage);
    } else {
      const cur = stageMap.get(stage)!;
      cur.level = e.level || cur.level;
      cur.progress = e.progress ?? cur.progress;
      cur.count += 1;
    }
  }
  if (order.length === 0) return null;

  return (
    <div className="px-3 pb-2 pt-1 border-b border-claude-border/40 dark:border-[#3d3832]/40">
      <div className="flex items-center gap-1 overflow-x-auto pb-1 thin-scroll">
        {order.map((stage, i) => {
          const info = stageMap.get(stage)!;
          const isLast = i === order.length - 1;
          const dotColor = info.level === 'error' ? 'bg-red-500' : info.level === 'warn' ? 'bg-amber-500' : info.level === 'success' ? 'bg-emerald-500' : isLast ? 'bg-claude-accent' : 'bg-claude-text-muted/40';
          return (
            <div key={stage} className="flex items-center shrink-0">
              <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-claude-surface/80 dark:bg-[#242220]/80 border border-claude-border/40 dark:border-[#3d3832]/40">
                <span className={`h-1.5 w-1.5 rounded-full ${dotColor} ${isLast && !info.level ? 'animate-pulse' : ''}`} />
                <span className="text-3xs font-mono text-claude-text-muted dark:text-[#9b9590] whitespace-nowrap">{stage}</span>
                {info.count > 1 && <span className="text-3xs text-muted-foreground/50">×{info.count}</span>}
              </div>
              {!isLast && <span className="text-muted-foreground/30 mx-0.5">→</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * LLMPreview — collapsible inline preview of real LLM-generated content
 * (module ② report / module ① digest). Renders Markdown, shows fallback
 * warning when the LLM SDK failed, and lets the user copy the raw text.
 */
function LLMPreview({
  content,
  title,
  provider,
  model,
  durationMs,
  fallback,
  error,
  ok,
  dbSaved,
  chars,
  accent = 'cryoem',
}: {
  content?: string;
  title: string;
  provider?: string;
  model?: string;
  durationMs?: number;
  fallback?: boolean;
  error?: string;
  ok?: boolean;
  dbSaved?: boolean;
  chars?: number;
  accent?: 'cryoem' | 'nmr' | 'xray' | 'accent' | 'emerald' | 'sky' | 'violet' | 'amber';
}) {
  const [expanded, setExpanded] = useState(true);
  const [copied, setCopied] = useState(false);
  const { locale } = useI18n();

  // Failure case: no content but we have an error — show a failure card.
  const isFailure = ok === false || (fallback && !content);

  // Claude-themed accent map — ALL variants now use the theme accent to avoid
  // color collisions across the 6 preset themes. The accent prop is kept for
  // API backward compat but all values produce the same accent styling.
  // Status badges (LLM Generated/Failed/Saved) use standard Tailwind colors.
  const accentMap: Record<string, { ring: string; bg: string; icon: string; badge: string }> = {
    cryoem: { ring: 'border-claude-accent/40', bg: 'from-claude-accent/8', icon: 'text-claude-accent', badge: 'border-claude-accent/40 text-claude-accent bg-claude-accent-light' },
    nmr: { ring: 'border-claude-accent/40', bg: 'from-claude-accent/8', icon: 'text-claude-accent', badge: 'border-claude-accent/40 text-claude-accent bg-claude-accent-light' },
    xray: { ring: 'border-claude-accent/40', bg: 'from-claude-accent/8', icon: 'text-claude-accent', badge: 'border-claude-accent/40 text-claude-accent bg-claude-accent-light' },
    accent: { ring: 'border-claude-accent/40', bg: 'from-claude-accent/8', icon: 'text-claude-accent', badge: 'border-claude-accent/40 text-claude-accent bg-claude-accent-light' },
    // Legacy aliases
    emerald: { ring: 'border-claude-accent/40', bg: 'from-claude-accent/8', icon: 'text-claude-accent', badge: 'border-claude-accent/40 text-claude-accent bg-claude-accent-light' },
    sky: { ring: 'border-claude-accent/40', bg: 'from-claude-accent/8', icon: 'text-claude-accent', badge: 'border-claude-accent/40 text-claude-accent bg-claude-accent-light' },
    violet: { ring: 'border-claude-accent/40', bg: 'from-claude-accent/8', icon: 'text-claude-accent', badge: 'border-claude-accent/40 text-claude-accent bg-claude-accent-light' },
    amber: { ring: 'border-claude-accent/40', bg: 'from-claude-accent/8', icon: 'text-claude-accent', badge: 'border-claude-accent/40 text-claude-accent bg-claude-accent-light' },
  };
  const a = accentMap[accent] || accentMap.cryoem;
  // Override styling for failure state.
  const ringCls = isFailure ? 'border-red-500/40' : a.ring;
  const bgCls = isFailure ? 'from-red-500/8' : a.bg;
  const iconCls = isFailure ? 'text-red-500' : a.icon;

  const copy = async () => {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`mt-3 rounded-lg border ${ringCls} bg-gradient-to-br ${bgCls} via-transparent to-transparent overflow-hidden claude-card-shadow`}
    >
      {/* header */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-claude-border/40 dark:border-[#3d3832]/40 bg-claude-surface/60 dark:bg-[#242220]/60">
        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          className="flex items-center gap-2 min-w-0 flex-1"
        >
          {isFailure ? (
            <XCircle className={`h-3.5 w-3.5 ${iconCls} shrink-0`} />
          ) : (
            <FileText className={`h-3.5 w-3.5 ${iconCls} shrink-0`} />
          )}
          <span className="text-xs font-semibold truncate text-claude-text dark:text-[#e8e4dd]">{title}</span>
          {/* LLM status badge — clearly shows real success vs failure */}
          {ok === true && (
            <Badge variant="outline" className="text-xs font-medium px-2 h-5 gap-1 rounded-md shrink-0 border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-2 w-2" /> LLM Generated
            </Badge>
          )}
          {isFailure && (
            <Badge variant="outline" className="text-xs font-medium px-2 h-5 gap-1 rounded-md shrink-0 border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400">
              <XCircle className="h-2 w-2" /> LLM Failed
            </Badge>
          )}
          {/* DB persistence badge */}
          {dbSaved === true && (
            <Badge variant="outline" className="text-xs font-medium px-2 h-5 gap-1 rounded-md shrink-0 border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Database className="h-2.5 w-2.5" /> Saved
            </Badge>
          )}
          {dbSaved === false && (
            <Badge variant="outline" className="text-xs font-medium px-2 h-5 gap-1 rounded-md shrink-0 border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400">
              <Database className="h-2.5 w-2.5" /> Save Failed
            </Badge>
          )}
          {!isFailure && (
            <Badge variant="outline" className={`text-xs font-medium px-2 h-5 gap-1 rounded-md shrink-0 ${a.badge}`}>
              <Sparkles className="h-2 w-2" /> {provider}/{model}
            </Badge>
          )}
          {chars != null && <span className="text-3xs text-claude-text-muted/60 dark:text-[#9b9590]/60 font-mono shrink-0">{chars} chars</span>}
          {durationMs != null && <span className="text-3xs text-muted-foreground/60 font-mono shrink-0 hidden sm:inline">{(durationMs / 1000).toFixed(1)}s</span>}
        </button>
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={copy} title="Copy original text">
            {copied ? <Check className="h-3 w-3 text-emerald-500" /> : <Copy className="h-3 w-3" />}
          </Button>
          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setExpanded(e => !e)}>
            <ChevronDown className={`h-3 w-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
          </Button>
        </div>
      </div>
      {/* body */}
      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            {isFailure ? (
              // Failure body — show the error message clearly, no fake content.
              <div className="px-3 py-3 bg-rose-500/5">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-rose-500 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-rose-600 dark:text-rose-300 mb-1">LLM Call Failed</div>
                    <div className="text-sm text-muted-foreground font-mono break-all">
                      {error || (locale === 'zh' ? '未知错误' : 'Unknown error')}
                    </div>
                    <div className="text-xs text-muted-foreground/70 mt-2">
                      No report text was generated for this run (fallback skipped, no fabricated content). Please verify that hermes / claude / codex CLI is on PATH, or set ANTHROPIC_API_KEY / OPENAI_API_KEY and retry.
                    </div>
                  </div>
                </div>
              </div>
            ) : content ? (
              <div className="px-3 py-2 max-h-72 overflow-y-auto thin-scroll text-xs leading-relaxed prose prose-sm dark:prose-invert max-w-none">
                <LazyMarkdown>{content}</LazyMarkdown>
              </div>
            ) : null}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/**
 * RunHistoryPanel — a slim strip at the top of each module showing the most
 * recent N runs for that module. Loads from `/api/skill-runs/history` with a
 * client-side refresh trigger when a fresh run completes. Compact rows; click
 * a row to expand its `details` JSON.
 */
function RunHistoryPanel({
  moduleKey,
  refreshKey,
  limit = 5,
}: {
  moduleKey: 'literature' | 'eval' | 'weekly';
  refreshKey: number;
  limit?: number;
}) {
  const [rows, setRows] = useState<Array<{
    id: string;
    module: string;
    status: string;
    summary: string;
    provider?: string | null;
    model?: string | null;
    llmOk?: boolean | null;
    llmFallback?: boolean | null;
    llmError?: string | null;
    durationMs?: number | null;
    logBytes?: number;
    createdAt: string;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // The full SSE log for the currently-expanded row. Loaded lazily from
  // /api/skill-runs/[id]/log so the panel doesn't fetch 100KB of NDJSON
  // for every row in the history list.
  const [expandedLog, setExpandedLog] = useState<{ id: string; lines: number; bytes: number; text: string } | null>(null);
  const [expandedLogLoading, setExpandedLogLoading] = useState(false);
  const [expandedLogError, setExpandedLogError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Defer initial loading state to a microtask so it doesn't trigger
    // the synchronous-setState-in-effect warning.
    Promise.resolve().then(() => {
      if (!cancelled) setLoading(true);
    });
    fetch(`/api/skill-runs/history?module=${moduleKey}&limit=${limit}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setRows(Array.isArray(d?.runs) ? d.runs : []);
      })
      .catch(() => { if (!cancelled) setRows([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [moduleKey, limit, refreshKey]);

  if (loading) {
    return (
      <div className="px-3 py-2 flex items-center gap-2 text-xs text-muted-foreground/60 border-t border-border/40 bg-background/30">
        <Loader2 className="h-2.5 w-2.5 animate-spin" />
        Loading run history…
      </div>
    );
  }
  if (rows.length === 0) return null;

  const fmtDur = (ms?: number | null) => {
    if (!ms || ms <= 0) return '—';
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1000)}s`;
  };
  const fmtTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleString('zh-CN', {
        month: 'numeric', day: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false,
      });
    } catch { return iso; }
  };

  return (
    <div className="px-3 py-2 border-t border-border/40 bg-background/30">
      <div className="flex items-center gap-2 mb-1.5">
        <History className="h-3 w-3 text-muted-foreground/70" />
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground/70">
          Recent {rows.length} runs
        </span>
      </div>
      <div className="space-y-0.5">
        {rows.map((r) => {
          const isOk = r.status === 'success';
          const isErr = r.status === 'error';
          const isOpen = expandedId === r.id;
          return (
            <div key={r.id} className="border border-border/40 rounded-md bg-background/40 overflow-hidden">
              <button
                type="button"
                onClick={() => {
                  // Collapse if already open; otherwise expand and lazily
                  // fetch the full SSE log for this run.
                  if (isOpen) {
                    setExpandedId(null);
                    setExpandedLog(null);
                    setExpandedLogError(null);
                  } else {
                    setExpandedId(r.id);
                    setExpandedLog(null);
                    setExpandedLogError(null);
                    if ((r.logBytes ?? 0) > 0) {
                      setExpandedLogLoading(true);
                      fetch(`/api/skill-runs/${r.id}/log`)
                        .then((res) => res.ok ? res.json() : Promise.reject(new Error(`HTTP ${res.status}`)))
                        .then((d) => {
                          setExpandedLog({ id: d.id, lines: d.lines, bytes: d.bytes, text: d.log ?? '' });
                        })
                        .catch((err) => setExpandedLogError(err?.message ?? 'fetch failed'))
                        .finally(() => setExpandedLogLoading(false));
                    }
                  }
                }}
                className="w-full px-2 py-1 flex items-center gap-2 text-left hover:bg-background/60 transition-colors"
              >
                {isOk ? (
                  <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500 shrink-0" />
                ) : isErr ? (
                  <XCircle className="h-3 w-3 text-rose-500 shrink-0" />
                ) : (
                  <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
                )}
                <span className="text-xs font-mono text-muted-foreground shrink-0">{fmtTime(r.createdAt)}</span>
                <span className="text-xs truncate flex-1" title={r.summary}>{r.summary}</span>
                {r.provider && (
                  <span className="text-3xs font-mono text-muted-foreground/70 shrink-0 hidden sm:inline truncate max-w-[100px]" title={`${r.provider}/${r.model}`}>
                    {r.provider}/{r.model}
                  </span>
                )}
                <span className="text-3xs text-muted-foreground/60 font-mono shrink-0">{fmtDur(r.durationMs)}</span>
                {(r.logBytes ?? 0) > 0 && (
                  <span className="text-3xs font-mono text-muted-foreground/60 shrink-0 hidden sm:inline" title="SSE log size in bytes">
                    log {(r.logBytes! / 1024).toFixed(1)}KB
                  </span>
                )}
                <ChevronRight className={`h-3 w-3 text-muted-foreground/60 transition-transform shrink-0 ${isOpen ? 'rotate-90' : ''}`} />
              </button>
              <AnimatePresence initial={false}>
                {isOpen && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.15 }}
                    className="overflow-hidden"
                  >
                    <div className="px-2 pb-2 pt-1 space-y-1 border-t border-border/30">
                      {r.llmError && (
                        <div className="rounded border border-rose-500/30 bg-rose-500/5 px-2 py-1 text-xs font-mono text-rose-600 dark:text-rose-300 break-all">
                          {r.llmError}
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-1 text-xs">
                        <div className="text-muted-foreground/70">status: <span className="font-mono">{r.status}</span></div>
                        <div className="text-muted-foreground/70">provider: <span className="font-mono">{r.provider || '—'}</span></div>
                        <div className="text-muted-foreground/70">model: <span className="font-mono">{r.model || '—'}</span></div>
                        <div className="text-muted-foreground/70">llmOk: <span className="font-mono">{r.llmOk === true ? '✓' : r.llmOk === false ? '✗' : '—'}</span></div>
                      </div>
                      {/* Full SSE log viewer. Shows a loading indicator while
                          fetching, the log text once loaded, or a hint
                          when the run predates log persistence. */}
                      {(r.logBytes ?? 0) > 0 && (
                        <div className="pt-1">
                          <div className="flex items-center justify-between text-3xs text-muted-foreground/70 mb-0.5">
                            <span>SSE log</span>
                            {expandedLog && (
                              <span className="font-mono">{expandedLog.lines} lines · {(expandedLog.bytes / 1024).toFixed(1)}KB</span>
                            )}
                          </div>
                          {expandedLogLoading && (
                            <div className="text-3xs text-muted-foreground/60 flex items-center gap-1">
                              <Loader2 className="h-2.5 w-2.5 animate-spin" /> Loading…
                            </div>
                          )}
                          {expandedLogError && (
                            <div className="text-3xs text-rose-600 dark:text-rose-300">log fetch failed: {expandedLogError}</div>
                          )}
                          {expandedLog && (
                            <pre className="max-h-60 overflow-y-auto rounded border border-border/40 bg-background/40 p-1.5 text-3xs font-mono leading-snug text-muted-foreground/80 whitespace-pre-wrap break-all">
                              {expandedLog.text}
                            </pre>
                          )}
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/**
 * ChapterStream — per-chapter collapsible viewer for SSE `chapter_done`
 * events emitted by /api/evaluations/run. Each finished chapter becomes a
 * `<details>` row showing its Markdown content; chapters in flight show a
 * skeleton with the current `chapter_start` message.
 *
 * Supports BOTH the primary target's chapter events (`stage === 'chapter'`
 * / `'chapter_done'`) AND batch target chapter events (`stage ===
 * 'batch-N-chapter'` / `'batch-N-chapter_done'`). Each target's chapters
 * are rendered as a separate section so the user can watch the LLM think
 * through every target in the batch incrementally.
 */
function ChapterStream({
  events,
  running,
  done,
}: {
  events: StreamEvent[];
  running: boolean;
  done: boolean;
}) {
  // Collapse state for the whole chapter list — click header to toggle.
  const [collapsed, setCollapsed] = useState(false);
  const { locale } = useI18n();
  // Pull ordered chapters from the event stream.
  // Two flavors:
  //   chapter_done    — finalised, has chapterContent (real Markdown)
  //   chapter (only)  — started but no chapter_done yet → show 'in flight'
  // We dedupe by chapter key, prefer the latest version.
  type ChapterRow = {
    key: string;
    label: string;
    index: number;
    total: number;
    status: 'running' | 'success' | 'error';
    content?: string;
    error?: string;
    durationMs?: number;
    startedAt?: string;
    finishedAt?: string;
  };
  type GroupKey = 'primary' | `batch-${number}` | 'cryoem' | 'xray';
  type Group = { key: GroupKey; title: string; order: number; chapters: Map<string, ChapterRow> };
  const labels: Record<string, string> = {
    summary: 'Executive Summary',
    function: 'Protein Function & Biological Context',
    topology: 'Sequence & Topology',
    pdb_analysis: 'Existing PDB Structure Analysis',
    feasibility: 'Structure Determination Feasibility',
    experimental: 'Experimental Plan',
    references: 'Key References',
    conclusion: 'Conclusion',
    // Weekly report chapters (A-H)
    A: 'A. 期刊趋势分析',
    B: 'B. 技术突破',
    C: 'C. 研究热点',
    D: 'D. 方法创新',
    E: 'E. 重要结构 Top 20',
    F: 'F. 技术评估',
    G: 'G. 跨学科应用',
    H: 'H. 参考文献',
  };

  // Group events by target — primary (stage 'chapter' / 'chapter_done') gets
  // its own group; each batch target (stage 'batch-N-chapter' /
  // 'batch-N-chapter_done') gets its own group. This lets the user watch
  // every target's chapter stream render incrementally as the run proceeds.
  const groupMap = new Map<GroupKey, Group>();
  const ensureGroup = (k: GroupKey, title: string, order: number): Group => {
    let g = groupMap.get(k);
    if (!g) {
      g = { key: k, title, order, chapters: new Map() };
      groupMap.set(k, g);
    }
    return g;
  };
  for (const e of events) {
    const stage = e.stage || '';
    let groupKey: GroupKey | null = null;
    let isDone = false;
    if (stage === 'chapter') {
      groupKey = 'primary';
      isDone = false;
    } else if (stage === 'chapter_done') {
      groupKey = 'primary';
      isDone = true;
    } else {
      const m = stage.match(/^batch-(\d+)-chapter(_done)?$/);
      if (m) {
        const bi = parseInt(m[1], 10);
        groupKey = `batch-${bi}` as GroupKey;
        isDone = !!m[2];
      }
    }
    // ── Weekly report method-specific chapters ──
    // The weekly route emits 'cryoem-chapter'/'cryoem-chapter_done' and
    // 'xray-chapter'/'xray-chapter_done'. Group them under method labels.
    if (!groupKey) {
      const wm = stage.match(/^(cryoem|xray)-chapter(_done)?$/);
      if (wm) {
        groupKey = wm[1] as GroupKey;
        isDone = !!wm[2];
      }
    }
    if (!groupKey || !e.chapter) continue;
    // All targets are equal — label them uniformly as "Target N · Chapter Stream".
    // 'primary' (legacy single-mode stage names) → Target 1 (order 0).
    // 'batch-N' → Target N+1 (order N+1).
    // Weekly method chapters → 'Cryo-EM · Chapter Stream' / 'X-ray · Chapter Stream'
    let group: Group;
    if (groupKey === 'primary') {
      group = ensureGroup('primary', 'Target 1 · Chapter Stream', 0);
    } else if (groupKey === 'cryoem') {
      group = ensureGroup('cryoem' as GroupKey, 'Cryo-EM · Chapter Stream', 100);
    } else if (groupKey === 'xray') {
      group = ensureGroup('xray' as GroupKey, 'X-ray · Chapter Stream', 101);
    } else {
      group = ensureGroup(groupKey, `Target ${parseInt(groupKey.replace('batch-', ''), 10) + 1} · Chapter Stream`, parseInt(groupKey.replace('batch-', ''), 10) + 1);
    }
    const k = e.chapter as string;
    const cur = group.chapters.get(k) || { key: k, label: labels[k] || k, index: 0, total: 0, status: 'running' as const };
    if (!isDone) {
      cur.status = 'running';
      cur.index = (e.chapterIndex as number) ?? cur.index;
      cur.total = (e.chapterTotal as number) ?? cur.total;
      cur.startedAt = e.ts;
    } else {
      const isSuccess = e.level === 'success';
      cur.status = isSuccess ? 'success' : 'error';
      cur.index = (e.chapterIndex as number) ?? cur.index;
      cur.total = (e.chapterTotal as number) ?? cur.total;
      cur.content = (e.chapterContent as string) ?? cur.content;
      cur.error = (e.chapterError as string) ?? cur.error;
      cur.durationMs = (e.chapterDurationMs as number) ?? cur.durationMs;
      cur.finishedAt = e.ts;
    }
    group.chapters.set(k, cur);
  }
  const groups = Array.from(groupMap.values())
    .filter((g) => g.chapters.size > 0)
    .sort((a, b) => a.order - b.order);
  if (groups.length === 0) return null;

  // Aggregate stats across all groups for the top-level header.
  const allRows = groups.flatMap((g) => Array.from(g.chapters.values()));
  const totalCount = allRows.length;
  const completedCount = allRows.filter((r) => r.status !== 'running').length;
  const okCount = allRows.filter((r) => r.status === 'success').length;
  const failCount = allRows.filter((r) => r.status === 'error').length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-3 rounded-lg border border-claude-accent/40 bg-gradient-to-br from-claude-accent/8 via-transparent to-transparent overflow-hidden claude-card-shadow"
    >
      <div
        role="button"
        tabIndex={0}
        onClick={() => setCollapsed((v) => !v)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCollapsed((v) => !v); } }}
        className="flex items-center justify-between gap-2 px-3 py-2 border-b border-claude-border/40 dark:border-[#3d3832]/40 bg-claude-surface/60 dark:bg-[#242220]/60 cursor-pointer hover:bg-claude-surface dark:hover:bg-[#242220] transition-colors select-none"
        aria-expanded={!collapsed}
        aria-label="Collapse/Expand LLM chapter stream list"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <ChevronRight className={`h-3 w-3 text-claude-accent shrink-0 transition-transform ${collapsed ? '' : 'rotate-90'}`} />
          <span className="text-3xs font-semibold truncate text-claude-text dark:text-[#e8e4dd]">LLM Chapter Stream</span>
          {groups.length > 1 && (
            <Badge variant="outline" className="text-xs font-medium px-2 h-5 gap-1 rounded-md shrink-0 border-claude-accent/40 bg-claude-accent/10 text-claude-accent">
              <Layers className="h-2 w-2" /> {groups.length} targets
            </Badge>
          )}
          <Badge variant="outline" className="text-xs font-medium px-2 h-5 gap-1 rounded-md shrink-0 border-claude-accent/40 bg-claude-accent/10 text-claude-accent">
            <Sparkles className="h-2 w-2" /> {completedCount}/{totalCount} chapters
          </Badge>
          {okCount > 0 && failCount === 0 && (
            <Badge variant="outline" className="text-xs font-medium px-2 h-5 gap-1 rounded-md shrink-0 border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              ✓ All OK
            </Badge>
          )}
          {failCount > 0 && (
            <Badge variant="outline" className="text-xs font-medium px-2 h-5 gap-1 rounded-md shrink-0 border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400">
              ✗ {failCount} failed
            </Badge>
          )}
          {running && completedCount < totalCount && (
            <span className="text-3xs text-claude-accent flex items-center gap-1 shrink-0">
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              Generating…
            </span>
          )}
        </div>
        <span className="text-3xs text-claude-text-muted/70 dark:text-[#9b9590]/70 shrink-0">{collapsed ? 'Expand' : 'Collapse'}</span>
      </div>
      {!collapsed && (
      <div className="max-h-[40rem] overflow-y-auto thin-scroll p-2 space-y-2">
        {groups.map((g) => {
          const rows = Array.from(g.chapters.values()).sort((a, b) => (a.index || 0) - (b.index || 0));
          const gCompleted = rows.filter((r) => r.status !== 'running').length;
          const gFail = rows.filter((r) => r.status === 'error').length;
          return (
            <div key={g.key} className="rounded-md border border-claude-border/40 dark:border-[#3d3832]/40 bg-claude-surface/40 dark:bg-[#242220]/40 overflow-hidden">
              {/* Sub-header for each target group (only show when there are
                  multiple groups — for single-target runs the top-level
                  header is enough). */}
              {groups.length > 1 && (
                <div className="flex items-center gap-2 px-3 py-1.5 border-b border-claude-border/40 dark:border-[#3d3832]/40 bg-claude-bg/40 dark:bg-[#1a1917]/40">
                  <span className="text-3xs font-semibold text-claude-text/80 dark:text-[#e8e4dd]/80 truncate">{g.title}</span>
                  <Badge variant="outline" className="text-4xs font-mono px-1.5 h-4 rounded shrink-0 border-claude-border/60 dark:border-[#3d3832]/60 bg-claude-surface/60 dark:bg-[#242220]/60 text-claude-text-muted dark:text-[#9b9590]">
                    {gCompleted}/{rows.length}
                  </Badge>
                  {gFail > 0 && (
                    <Badge variant="outline" className="text-4xs font-mono px-1.5 h-4 rounded shrink-0 border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400">
                      ✗ {gFail}
                    </Badge>
                  )}
                </div>
              )}
              <div className="p-1.5 space-y-1.5">
                {rows.map((r) => {
                  const isRunning = r.status === 'running';
                  const isError = r.status === 'error';
                  return (
                    <details
                      key={r.key}
                      open={isRunning}
                      className={`group rounded-md border ${
                        isRunning ? 'border-claude-accent/40 bg-claude-accent/8' :
                        isError ? 'border-red-500/30 bg-red-500/5' :
                        'border-emerald-500/30 bg-emerald-500/5'
                      }`}
                    >
                      <summary className="cursor-pointer list-none px-3 py-2 flex items-center gap-2 select-none">
                        <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90 text-claude-text-muted dark:text-[#9b9590] shrink-0" />
                        <span className="text-sm font-semibold text-claude-text/90 dark:text-[#e8e4dd]/90 shrink-0">
                          {r.index || '?'}/{r.total || '?'}
                        </span>
                        <span className="text-sm font-medium text-claude-text/80 dark:text-[#e8e4dd]/80 truncate">{r.label || r.key}</span>
                        {isRunning && <Loader2 className="h-2.5 w-2.5 animate-spin text-claude-accent shrink-0" />}
                        {isError && <XCircle className="h-3 w-3 text-red-500 shrink-0" />}
                        {!isRunning && !isError && <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500 shrink-0" />}
                        {r.durationMs != null && (
                          <span className="text-3xs text-muted-foreground/60 font-mono ml-auto shrink-0">
                            {(r.durationMs / 1000).toFixed(1)}s · {r.content?.length ?? 0} chars
                          </span>
                        )}
                      </summary>
                      <div className="px-3 pb-3 pt-1">
                        {r.content ? (
                          <div className="rounded border border-border/30 bg-background/40 p-3 max-h-72 overflow-y-auto thin-scroll text-xs leading-relaxed prose prose-sm dark:prose-invert max-w-none">
                            <LazyMarkdown>{r.content}</LazyMarkdown>
                          </div>
                        ) : isError ? (
                          <div className="rounded border border-rose-500/30 bg-rose-500/5 p-3 text-sm text-rose-600 dark:text-rose-300 font-mono break-all">
                            {r.error || (locale === 'zh' ? '未知错误' : 'Unknown error')}
                          </div>
                        ) : (
                          <div className="rounded border border-border/30 bg-background/40 p-3 text-sm text-muted-foreground italic">
                            <Loader2 className="h-3 w-3 animate-spin inline-block mr-2" />
                            Waiting for LLM response…
                          </div>
                        )}
                      </div>
                    </details>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      )}
    </motion.div>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */
/*  Main component                                                           */
/* ──────────────────────────────────────────────────────────────────────── */

/**
 * CycleTimeline — module ③专属的可视化时间轴。把对抗式生成器的
 * Generator → Critic-Scientific → Synthesis 三阶段渲染成带状态点的横向轨道，
 * 当前运行阶段带 pulse 动画，已完成阶段显示 ✓ + 耗时。
 */
function CycleTimeline({
  events,
  maxCycles,
  running,
  result,
}: {
  events: StreamEvent[];
  maxCycles: 1 | 2 | 3;
  running: boolean;
  result?: any;
}) {
  // Fix: locale was previously referenced as a free variable here but never
  // bound — ReferenceError crashed the whole Home page on first render.
  // CycleTimeline is a top-level function component, so it has its own
  // useI18n() scope (the parent SettingsRunPanel's locale is in a different
  // closure and not accessible).
  const { locale } = useI18n();
  const roles = [
    { key: 'generator', label: 'Generator', desc: locale === 'zh' ? '初版周报生成' : 'Initial report generation', color: 'sky' },
    { key: 'critic-scientific', label: 'Critic-Sci', desc: locale === 'zh' ? '科学性评审' : 'Scientific review', color: 'amber' },
    { key: 'synthesis', label: 'Synthesis', desc: locale === 'zh' ? '综合终稿' : 'Final synthesis', color: 'emerald' },
  ].slice(0, maxCycles);

  // Derive per-role status from the event stream + result payload.
  const roleStatus = roles.map((r) => {
    const roleEvents = events.filter(e => (e.stage || '').includes(r.key));
    const started = roleEvents.length > 0;
    const cycleResult = result?.cycles?.find((c: any) => c.role === r.key);
    const completed = roleEvents.some(e => e.level === 'success') || !!cycleResult;
    const verdict = cycleResult?.verdict;
    const durationMs = cycleResult?.durationMs;
    const contentChars = cycleResult?.contentChars;
    const reportType = cycleResult?.reportType;
    return { ...r, started, completed, verdict, durationMs, contentChars, reportType, eventCount: roleEvents.length };
  });

  const hasAnyActivity = roleStatus.some(r => r.started);
  if (!hasAnyActivity && !running) return null;

  return (
    <div className="mt-3 rounded-lg border border-claude-border/60 dark:border-[#3d3832]/60 bg-gradient-to-br from-claude-accent/8 via-transparent to-transparent p-3">
      <div className="flex items-center gap-2 mb-2.5">
        <Layers className="h-3 w-3 text-claude-accent" />
        <span className="text-xs font-semibold uppercase tracking-wider text-claude-text-muted dark:text-[#9b9590]">Cycle Orchestration</span>
        <span className="text-xs text-claude-text-muted/60 dark:text-[#9b9590]/60">· {maxCycles}-step pipeline</span>
      </div>

      {/* horizontal track */}
      <div className="flex items-stretch gap-1">
        {roleStatus.map((r, i) => {
          const isLast = i === roleStatus.length - 1;
          // All steps use the theme accent — no per-step color distinction.
          // This avoids collisions (e.g. Ocean accent=cryoem, Berry accent=xray).
          const colorMap: Record<string, { dot: string; ring: string; bg: string; text: string }> = {
            sky: { dot: 'bg-claude-accent', ring: 'border-claude-accent/40', bg: 'bg-claude-accent/8', text: 'text-claude-accent' },
            amber: { dot: 'bg-claude-accent', ring: 'border-claude-accent/40', bg: 'bg-claude-accent/8', text: 'text-claude-accent' },
            emerald: { dot: 'bg-claude-accent', ring: 'border-claude-accent/40', bg: 'bg-claude-accent/8', text: 'text-claude-accent' },
          };
          const c = colorMap[r.color] || colorMap.sky;
          return (
            <div key={r.key} className="flex items-stretch flex-1 min-w-0">
              <div className={`flex-1 rounded-lg border ${r.completed ? c.ring : 'border-claude-border/60 dark:border-[#3d3832]/60'} ${r.completed ? c.bg : 'bg-claude-surface/40 dark:bg-[#242220]/40'} p-2 transition-all`}>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="relative flex h-2 w-2 shrink-0">
                    {r.started && !r.completed && (
                      <span className={`absolute inline-flex h-full w-full rounded-full ${c.dot} opacity-60`} style={{ animation: 'pulse-ring 1.5s ease-out infinite' }} />
                    )}
                    <span className={`relative inline-flex h-2 w-2 rounded-full ${r.completed ? c.dot : r.started ? c.dot : 'bg-claude-text-muted/30'}`} />
                  </span>
                  <span className="text-xs font-semibold truncate text-claude-text dark:text-[#e8e4dd]">{r.label}</span>
                  {r.completed && <CheckCircle2 className={`h-3 w-3 ${c.text} shrink-0`} />}
                  {r.verdict && (
                    <Badge variant="outline" className={`text-xs font-medium px-2 h-5 gap-1 rounded-md shrink-0 ${r.verdict === 'pass' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' : 'border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400'}`}>
                      {r.verdict}
                    </Badge>
                  )}
                </div>
                <div className="text-3xs text-muted-foreground truncate">{r.desc}</div>
                <div className="text-3xs font-mono text-muted-foreground/60 mt-0.5 flex items-center gap-1.5 flex-wrap">
                  {r.completed ? (
                    <>
                      <span className="flex items-center gap-0.5"><Clock className="h-2 w-2" />{((r.durationMs || 0) / 1000).toFixed(1)}s</span>
                      {r.contentChars != null && <span className="flex items-center gap-0.5"><FileText className="h-2 w-2" />{r.contentChars > 1000 ? `${(r.contentChars / 1000).toFixed(1)}k` : r.contentChars}</span>}
                      <span>· {r.eventCount}ev</span>
                    </>
                  ) : r.started ? (
                    <span className="flex items-center gap-0.5"><Loader2 className="h-2 w-2 animate-spin" />running…</span>
                  ) : 'pending'}
                </div>
              </div>
              {!isLast && (
                <div className="flex items-center px-0.5 shrink-0">
                  <ChevronDown className="h-3 w-3 text-muted-foreground/40 -rotate-90" />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function SettingsRunPanel({
  onDbChanged,
  open: externalOpen,
  onOpenChange: externalOnOpenChange,
  activeTab: externalTab,
  onTabChange: externalOnTabChange,
  contentRef,
  tabContentRef,
}: {
  onDbChanged?: () => void;
  /** Controlled open state (for tour integration). When provided, overrides internal state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Controlled active tab (for tour integration). */
  activeTab?: string;
  onTabChange?: (tab: string) => void;
  /** Ref attached to the dialog's content element so external code (e.g. the
      onboarding tour) can spotlight it. */
  contentRef?: React.RefObject<HTMLElement | null>;
  /** Ref attached to the tab content panel (below the TabsList) so the tour
      can spotlight the module panel area for steps 4/5/6. */
  tabContentRef?: React.RefObject<HTMLElement | null>;
} = {}) {
  const { t, locale } = useI18n();
  const [internalOpen, setInternalOpen] = useState(false);
  const [internalTab, setInternalTab] = useState('evaluation');
  const open = externalOpen ?? internalOpen;
  const setOpen = externalOnOpenChange ?? setInternalOpen;
  const activeTab = externalTab ?? internalTab;
  const setActiveTab = externalOnTabChange ?? setInternalTab;
  const [llmInfo, setLlmInfo] = useState<LlmInfo | null>(null);
  const [chosenProvider, setChosenProvider] = useState<string>(() => loadStoredProvider());
  const [llmCfg, setLlmCfg] = useState<LlmUserConfig>(() => loadStoredCfg());
  const [showLlmCfg, setShowLlmCfg] = useState(false);
  const [logs, setLogs] = useState<RunLog[]>([]);
  const [logFilter, setLogFilter] = useState<'all' | 'literature' | 'eval' | 'weekly'>('all');
  const [logSearch, setLogSearch] = useState('');
  /** Modules currently running — supports parallel execution. */
  const [running, setRunning] = useState<Set<string>>(new Set());
  const isRunning = (m: string) => running.has(m);
  const markRunning = (m: string) => setRunning(s => new Set(s).add(m));
  const markDone = (m: string) => setRunning(s => { const n = new Set(s); n.delete(m); return n; });
  const [scanning, setScanning] = useState(false);

  // ① Daily literature params
  const [litDate, setLitDate] = useState(new Date().toISOString().slice(0, 10));
  const [litWindowDays, setLitWindowDays] = useState(3);
  const [litMaxPathA, setLitMaxPathA] = useState(300);
  const [litMaxPathB, setLitMaxPathB] = useState(50);
  const [litMaxPathC, setLitMaxPathC] = useState(200);
  const [litMaxPapers, setLitMaxPapers] = useState(20);
  const [litSkipWikiFiles, setLitSkipWikiFiles] = useState(false);
  const [litExistingReports, setLitExistingReports] = useState<Array<{ date: string; paperCount: number; hasLLMDigest: boolean }>>([]);
  // Viewing a past day's LLM digest (fetched on history report click)
  const [litViewingDigest, setLitViewingDigest] = useState<{ date: string; content: string; loading: boolean; error?: string } | null>(null);

  // ① Eval params — multi-target batch support
  const [evalUniprot, setEvalUniprot] = useState('P00533');
  const [evalForceBlast, setEvalForceBlast] = useState(false);
  // Default skipBlast=false so the backend auto-decides whether BLAST is
  // needed (runs when PDB<5 or coverage<50%, skips otherwise). The user
  // can still force-skip or force-run via the two toggles below.
  const [evalSkipBlast, setEvalSkipBlast] = useState(false);
  const [evalMaxPdb, setEvalMaxPdb] = useState(80);
  // BLAST homolog cap. Persisted to localStorage so users can keep their preferred number.
  const [evalMaxBlastHits, setEvalMaxBlastHits] = useState<number>(() => {
    if (typeof window === 'undefined') return 50;
    const v = window.localStorage.getItem('evalMaxBlastHits');
    const parsed = v ? parseInt(v, 10) : NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 50;
  });
  useEffect(() => {
    try { window.localStorage.setItem('evalMaxBlastHits', String(evalMaxBlastHits)); } catch {}
  }, [evalMaxBlastHits]);
  // Max literature count for LLM report context. Cap of PubMed articles
  // surfaced alongside PDB details (sorted by journal IF desc). Persisted.
  const [evalMaxLitCount, setEvalMaxLitCount] = useState<number>(() => {
    if (typeof window === 'undefined') return 20;
    const v = window.localStorage.getItem('evalMaxLitCount');
    const parsed = v ? parseInt(v, 10) : NaN;
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : 20;
  });
  useEffect(() => {
    try { window.localStorage.setItem('evalMaxLitCount', String(evalMaxLitCount)); } catch {}
  }, [evalMaxLitCount]);

  // Multi-target evaluation state — each target has independent params.
  // When more than one target is present, the run is treated as a batch
  // (grouped under EvaluationBatch) and a cross-target relationship
  // analysis (common structures, similarity) is performed after the
  // per-target evaluations complete.
  interface EvalTarget {
    uniprot: string;
    maxPdb: number;
    maxBlastHits: number;
    forceBlast: boolean;
    skipBlast: boolean;
  }
  // Input mode: 'uniprot' (default) or 'sequence'
  const [evalInputMode, setEvalInputMode] = useState<'uniprot' | 'sequence'>('uniprot');
  // Sequence input state
  const [evalSequence, setEvalSequence] = useState('');
  const [evalSeqType, setEvalSeqType] = useState<'aa' | 'dna'>('aa');
  const [evalTargets, setEvalTargets] = useState<EvalTarget[]>([
    { uniprot: 'P00533', maxPdb: 80, maxBlastHits: 50, forceBlast: false, skipBlast: false },
  ]);
  const addEvalTarget = useCallback(() => {
    setEvalTargets(prev => [...prev, { uniprot: '', maxPdb: 80, maxBlastHits: 50, forceBlast: false, skipBlast: false }]);
  }, []);
  const removeEvalTarget = useCallback((idx: number) => {
    setEvalTargets(prev => prev.filter((_, i) => i !== idx));
  }, []);
  const updateEvalTarget = useCallback((idx: number, key: keyof EvalTarget, value: any) => {
    setEvalTargets(prev => prev.map((t, i) => i === idx ? { ...t, [key]: value } : t));
  }, []);
  // Database path config
  const [dbPath, setDbPath] = useState('file:./db/custom.db');
  /** Full DB status object from `/api/db-config` GET — surfaces active
   *  path, schema status, row counts, and isTest flag so the Run Center and
   *  the wizard can stay in lock-step with whatever the 3 modules are
   *  actually reading/writing. */
  const [dbStatus, setDbStatus] = useState<DbStatus | null>(null);
  const [dbPathSaving, setDbPathSaving] = useState(false);
  const [dbPathStatus, setDbPathStatus] = useState<string | null>(null);
  const [dbWizardOpen, setDbWizardOpen] = useState(false);
  const [dbWizardMode, setDbWizardMode] = useState<'choose' | 'create' | 'select'>('choose');

  const loadDbPath = useCallback(async () => {
    try {
      const res = await fetch('/api/db-config');
      // Guard against HTML error pages (502 from gateway when server crashes)
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        setDbPathStatus('✗ Server not responding, please retry');
        return;
      }
      const data = await res.json() as DbStatus;
      setDbStatus(data);
      // Always sync the input field to the ACTIVE path (single source of truth).
      // This keeps the Run Center display in lock-step with the setup wizard:
      // whichever path the wizard just confirmed is what we show here.
      setDbPath(data.configuredDbPath || data.activeUrl || 'file:./db/custom.db');
      setDbPathStatus('✓ Loaded');
    } catch {
      setDbPathStatus('✗ Load failed');
    }
  }, []);

  const saveDbPath = useCallback(async () => {
    setDbPathSaving(true);
    setDbPathStatus(null);
    try {
      const res = await fetch('/api/db-config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dbPath, create: false, initSchema: true, confirmed: true }),
      });
      // Guard against HTML error pages (502 when server crashes during prisma db push)
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        setDbPathStatus('✗ Server not responding during initialization, please retry');
        setDbPathSaving(false);
        return;
      }
      const data = await res.json();
      if (data.ok) {
        setDbPathStatus('✓ Switched and effective immediately (no restart needed)');
        // Refresh status so the UI reflects the new active path + counts.
        await loadDbPath();
        // Notify parent (pdb-tracker) so it re-fetches all data from the
        // newly-active database — keeps the dashboard in sync.
        onDbChanged?.();
      } else {
        setDbPathStatus(`✗ ${data.error || (locale === 'zh' ? '保存失败' : 'Save failed')}`);
      }
    } catch (err: any) {
      setDbPathStatus(`✗ ${err?.message || (locale === 'zh' ? '网络错误' : 'Network error')}`);
    } finally {
      setDbPathSaving(false);
    }
  }, [dbPath, loadDbPath, onDbChanged]);

  // Load DB path on mount
  useEffect(() => { Promise.resolve().then(() => loadDbPath()); }, [loadDbPath]);
  // Reload DB status when the Run Center dialog is opened (in case DB was changed externally)
  useEffect(() => { if (open) Promise.resolve().then(() => loadDbPath()); }, [open, loadDbPath]);
  const [evalGenerateReport, setEvalGenerateReport] = useState(true);
  const [evalSaveReportFile, setEvalSaveReportFile] = useState(true);

  // ③ Weekly report state
  const [weeklyWindow, setWeeklyWindow] = useState<{ weekId: string; reportDate: string; startDate: string; endDate: string } | null>(null);
  const [weeklyDbCounts, setWeeklyDbCounts] = useState<{ pdbStructure: number; weeklySnapshot: number; weeklyReport: number } | null>(null);
  const [weeklyCycles, setWeeklyCycles] = useState<1 | 2 | 3>(2);
  // Custom ISO week override — when set, the weekly run targets this week
  // instead of the server-detected current week. Format: "YYYY-Www" (e.g. "2026-W28").
  const [weeklyCustomWeek, setWeeklyCustomWeek] = useState<string>('');

  const weeklyStream = useRunStream();
  const litStream = useRunStream();
  const evalStream = useRunStream();

  // Refresh keys force `<RunHistoryPanel>` to reload when a run completes.
  const [litRunCount, setLitRunCount] = useState(0);
  const [evalRunCount, setEvalRunCount] = useState(0);
  const [weeklyRunCount, setWeeklyRunCount] = useState(0);
  useEffect(() => {
    if (litStream.state.done) Promise.resolve().then(() => setLitRunCount(c => c + 1));
  }, [litStream.state.done]);
  useEffect(() => {
    if (evalStream.state.done) Promise.resolve().then(() => setEvalRunCount(c => c + 1));
  }, [evalStream.state.done]);
  useEffect(() => {
    if (weeklyStream.state.done) Promise.resolve().then(() => setWeeklyRunCount(c => c + 1));
  }, [weeklyStream.state.done]);

  // ── Synthetic primary report derived from chapter_done SSE events ──────
  // The actual SSE `done` event is only sent at the very end of the run —
  // AFTER batch mode finishes (which can take minutes for multi-target
  // runs). To surface the primary target's report to the user as soon as
  // its 8 chapters have streamed in (well before the batch loop ends), we
  // synthesise a report object here from the chapter_done events already
  // in the log. Once the run completes, the final `result.report` payload
  // (which has the real provider/model metadata) takes precedence.
  const primaryReportFromStream = useMemo(() => {
    const chapterDones = evalStream.state.log.filter(
      (e) => e.stage === 'chapter_done' && e.chapter && e.chapterContent,
    );
    if (chapterDones.length === 0) return null;
    const canonical = ['summary', 'function', 'topology', 'pdb_analysis', 'feasibility', 'experimental', 'references', 'conclusion'];
    const chapters: Record<string, string> = {};
    let totalMs = 0;
    let allOk = true;
    for (const e of chapterDones) {
      chapters[e.chapter as string] = e.chapterContent as string;
      if (e.chapterDurationMs) totalMs += e.chapterDurationMs as number;
      if (e.level !== 'success') allOk = false;
    }
    const content = canonical.map((ck) => chapters[ck] ?? '').filter(Boolean).join('\n\n');
    if (!content) return null;
    return {
      ok: allOk,
      content,
      provider: '(streaming)',
      model: '(streaming)',
      durationMs: totalMs,
      contentChars: content.length,
      fallback: false,
    };
  }, [evalStream.state.log]);

  // ── Effective primary report: prefer the final result once the stream is
  // done; otherwise fall back to the streaming-derived synthetic report so
  // the LLMPreview renders incrementally during batch mode.
  const effectivePrimaryReport = evalStream.state.done
    ? evalStream.state.result?.report
    : primaryReportFromStream;

  /* ── data fetch on open ─────────────────────────────────────────────── */
  useEffect(() => {
    if (!open) return;
    if (!llmInfo) {
      Promise.resolve().then(() => setScanning(true));
      fetch('/api/llm/providers')
        .then(r => r.json())
        .then((d: LlmInfo) => {
          setLlmInfo(d);
          setLlmCfg(prev => ({
            ...prev,
            provider: prev.provider || d.chosen || '',
            model: prev.model || d.env.model || '',
            baseUrl: prev.baseUrl || d.env.baseUrl || '',
          }));
        })
        .catch(() => { /* ignore */ })
        .finally(() => setScanning(false));
    }
    if (litExistingReports.length === 0) {
      fetch('/api/literature/daily/list')
        .then(r => r.json())
        .then((d: any) => setLitExistingReports(d.reports || []))
        .catch(() => { /* ignore */ });
    }
    if (!weeklyWindow) {
      fetch('/api/pdb-weekly/run', { method: 'GET' })
        .then(r => r.json())
        .then((d: any) => {
          if (d && d.weekId) {
            setWeeklyWindow({ weekId: d.weekId, reportDate: d.reportDate, startDate: d.startDate, endDate: d.endDate });
          }
          if (d?.dbCounts) setWeeklyDbCounts(d.dbCounts);
        })
        .catch(() => { /* ignore */ });
    }
     
  }, [open]);

  /* ── provider picker ────────────────────────────────────────────────── */
  const pickProvider = (providerId: string) => {
    setChosenProvider(providerId);
    persistProvider(providerId);
    if (providerId === AUTO_PROVIDER) {
      setLlmCfg(prev => ({ ...prev, provider: '' }));
    } else {
      setLlmCfg(prev => ({ ...prev, provider: providerId }));
    }
  };

  const effectiveProviderId = chosenProvider === AUTO_PROVIDER ? (llmInfo?.chosen || '') : chosenProvider;

  const rescan = () => {
    setScanning(true);
    fetch('/api/llm/providers')
      .then(r => r.json())
      .then((d: LlmInfo) => setLlmInfo(d))
      .catch(() => { /* ignore */ })
      .finally(() => setScanning(false));
  };

  const llmBody = useCallback(() => {
    const out: any = {};
    if (chosenProvider && chosenProvider !== AUTO_PROVIDER) {
      out.provider = chosenProvider;
    } else if (llmCfg.provider) {
      out.provider = llmCfg.provider;
    }
    if (llmCfg.apiKey) out.apiKey = llmCfg.apiKey;
    if (llmCfg.baseUrl) out.baseUrl = llmCfg.baseUrl;
    if (llmCfg.model) out.model = llmCfg.model;
    if (llmCfg.system) out.system = llmCfg.system;
    return Object.keys(out).length > 0 ? out : undefined;
  }, [chosenProvider, llmCfg]);

  useEffect(() => { persistCfg(llmCfg); }, [llmCfg]);

  const log = (entry: RunLog) => setLogs(l => [entry, ...l].slice(0, 50));

  /** Export the current (filtered) logs as a Markdown file download. */
  const exportLogs = (format: 'md' | 'json') => {
    const filtered = logs
      .filter(l => logFilter === 'all' || l.module === logFilter)
      .filter(l => !logSearch || l.summary.toLowerCase().includes(logSearch.toLowerCase()) || (l.details || '').toLowerCase().includes(logSearch.toLowerCase()));
    if (filtered.length === 0) return;
    const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    let content: string;
    let mime: string;
    let ext: string;
    if (format === 'json') {
      content = JSON.stringify(filtered, null, 2);
      mime = 'application/json';
      ext = 'json';
    } else {
      content = [
        `# ${t.execLogExportTitle}`,
        ``,
        `Exported: ${new Date().toISOString()}`,
        `Filter: ${logFilter} · Search: "${logSearch}" · ${filtered.length} entries`,
        ``,
        `---`,
        ``,
        ...filtered.map((l, i) => [
          `## ${i + 1}. [${l.module}] ${l.status} · ${l.ts}`,
          ``,
          `**Summary**: ${l.summary}`,
          l.durationMs != null ? `` : ``,
          ...(l.details ? [``, `### Details`, ``, '```', l.details, '```'] : []),
          ``,
        ].filter(Boolean).join('\n')),
      ].join('\n');
      mime = 'text/markdown';
      ext = 'md';
    }
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `runcenter-logs-${ts}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  /* ── run triggers ───────────────────────────────────────────────────── */
  const runLiterature = () => {
    markRunning('lit');
    litStream.reset();
    setLitViewingDigest(null);
    log({ ts: new Date().toISOString(), module: 'literature', status: 'running', summary: `Daily structural biology literature ${litDate} (±${litWindowDays}d) — SSE streaming…` });
    litStream.start('/api/literature/daily/run', {
      date: litDate,
      windowDays: litWindowDays,
      maxPathA: litMaxPathA,
      maxPathB: litMaxPathB,
      maxPathC: litMaxPathC,
      maxPapers: litMaxPapers,
      skipWikiFiles: litSkipWikiFiles,
      llm: llmBody(),
    });
  };

  /** Fetch a past day's LLM digest from the literature reports API and show it inline. */
  const viewLitDigest = useCallback(async (date: string) => {
    setLitViewingDigest({ date, content: '', loading: true });
    try {
      const res = await fetch('/api/literature/daily/reports');
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        setLitViewingDigest({ date, content: '', loading: false, error: (locale === 'zh' ? '服务器无响应' : 'Server not responding') });
        return;
      }
      const data = await res.json();
      // API returns an array of reports (or {reports: [...]} for backward compat)
      const reports: any[] = Array.isArray(data) ? data : (data.reports || []);
      const found = reports.find((r: any) => (r.weekId || r.date) === date);
      if (found && found.content) {
        setLitViewingDigest({ date, content: found.content, loading: false });
      } else {
        setLitViewingDigest({ date, content: '', loading: false, error: `No LLM digest archived for ${date}. Run a literature search to generate a digest first.` });
      }
    } catch (err: any) {
      setLitViewingDigest({ date, content: '', loading: false, error: err?.message || (locale === 'zh' ? '网络错误' : 'Network error') });
    }
  }, []);

  const runEvaluation = () => {
    if (evalInputMode === 'sequence') {
      // Sequence-based evaluation: no UniProt ID, use sequence(s) directly for BLAST.
      // Multi-sequence mode: split by blank line (one or more empty lines between
      // sequences). Each non-empty chunk is one sequence. When more than one
      // sequence is provided, the backend loops through them and produces a
      // cross-sequence comparison report (similar to batch mode).
      const rawSeqs = evalSequence
        .split(/\n\s*\n+/) // split on blank-line separators
        .map(s => s.trim())
        .filter(s => s.length > 0);
      if (rawSeqs.length === 0) {
        toast.error('请输入至少一条有效序列');
        return;
      }
      // Basic length validation per sequence.
      const tooShort = rawSeqs.find(s => s.replace(/\s/g, '').length < 10);
      if (tooShort) {
        toast.error('每条序列至少需要 10 个残基');
        return;
      }
      markRunning('eval');
      evalStream.reset();
      if (rawSeqs.length === 1) {
        // Single sequence — backward compatible single-string payload.
        const seq = rawSeqs[0].replace(/\s/g, '');
        const seqLabel = evalSeqType === 'dna' ? `DNA seq (${seq.length}nt)→transcribe→AA` : `AA seq (${seq.length}aa)`;
        log({ ts: new Date().toISOString(), module: 'eval', status: 'running', summary: `Sequence eval ${seqLabel} — BLASTp search — SSE streaming…` });
        evalStream.start('/api/evaluations/run', {
          inputMode: 'sequence',
          sequence: seq,
          sequenceType: evalSeqType,
          maxBlastHits: evalTargets[0]?.maxBlastHits || 50,
          maxLitCount: evalMaxLitCount,
          generateReport: evalGenerateReport,
          saveReportFile: evalSaveReportFile,
          llm: llmBody(),
        });
      } else {
        // Multiple sequences — send as `sequences` array; backend runs BLAST
        // for each + generates a cross-sequence comparison report.
        const cleaned = rawSeqs.map(s => s.replace(/\s/g, '').toUpperCase());
        const seqLabel = evalSeqType === 'dna' ? `DNA seq` : 'AA seq';
        log({ ts: new Date().toISOString(), module: 'eval', status: 'running', summary: `Multi-sequence batch eval (${cleaned.length} ${seqLabel}) — independent BLASTp per seq + cross-sequence correlation — SSE streaming…` });
        evalStream.start('/api/evaluations/run', {
          inputMode: 'sequence',
          sequenceType: evalSeqType,
          sequences: cleaned,
          maxBlastHits: evalTargets[0]?.maxBlastHits || 50,
          maxLitCount: evalMaxLitCount,
          generateReport: evalGenerateReport,
          saveReportFile: evalSaveReportFile,
          llm: llmBody(),
        });
      }
      return;
    }
    // Collect valid (non-empty) targets from the multi-target list.
    const valid = evalTargets.filter(t => t.uniprot.trim());
    if (valid.length === 0) {
      toast.error('请输入至少一个 UniProt ID');
      return;
    }
    const targets = valid.map(t => ({
      uniprot: t.uniprot.trim().toUpperCase(),
      forceBlast: t.forceBlast,
      skipBlast: t.skipBlast,
      maxPdb: t.maxPdb,
      maxBlastHits: t.maxBlastHits,
    }));
    markRunning('eval');
    evalStream.reset();
    const isBatch = targets.length > 1;
    const summary = isBatch
      ? `Batch eval ${targets.length} targets (${targets.map(t => t.uniprot).join(', ')}) — includes correlation analysis — SSE streaming…`
      : `Eval ${targets[0].uniprot} — SSE streaming…`;
    log({ ts: new Date().toISOString(), module: 'eval', status: 'running', summary });
    evalStream.start('/api/evaluations/run', {
      // Always send flat fields (from first target) for backward compat,
      // plus targets[] array for batch mode.
      uniprot: targets[0].uniprot,
      forceBlast: targets[0].forceBlast,
      skipBlast: targets[0].skipBlast,
      maxPdb: targets[0].maxPdb,
      maxBlastHits: targets[0].maxBlastHits,
      maxLitCount: evalMaxLitCount,
      targets,
      isBatch,
      generateReport: evalGenerateReport,
      saveReportFile: evalSaveReportFile,
      llm: llmBody(),
    });
  };

  const runWeekly = (maxCycles: 1 | 2 | 3) => {
    markRunning('weekly');
    weeklyStream.reset();
    const weekLabel = weeklyCustomWeek || weeklyWindow?.weekId || '?';
    log({ ts: new Date().toISOString(), module: 'weekly', status: 'running', summary: `Triggered PDB weekly report (${weekLabel}) • ${maxCycles}-cycle • SSE stream active… (est. 5–15 min)` });
    weeklyStream.start('/api/pdb-weekly/run', {
      maxCycles,
      ...(weeklyCustomWeek ? { weekId: weeklyCustomWeek } : {}),
      llm: llmBody(),
    });
  };

  /* ── completion hooks ───────────────────────────────────────────────── */
  useEffect(() => {
    if (!litStream.state.done) return;
    const s = litStream.state;
    if (s.ok && s.result) {
      const d = s.result;
      Promise.resolve().then(() => log({
        ts: new Date().toISOString(),
        module: 'literature',
        status: 'success',
        summary: `${d.date}: 候选 ${d.totalCandidates} (Path A=${d.pathACount}, Path B=${d.pathBCount}, Path C=${d.pathCCount ?? 0}) → 最终入选 ${d.finalCount} 篇 [${Object.entries(d.methodStats || {}).map(([m, c]: [string, any]) => `${m}:${c}`).join(', ')}]`,
        details: d.files?.dailyIndex ? `📁 ${d.files.dailyIndex}\n${d.digest ? `摘要:\n${d.digest.slice(0, 1500)}${d.digest.length > 1500 ? '…' : ''}` : ''}` : '无文件系统输出 (skipWikiFiles)',
        durationMs: d.durationMs,
      }));
      fetch('/api/literature/daily/list')
        .then(r => r.json())
        .then((d: any) => setLitExistingReports(d.reports || []))
        .catch(() => { /* ignore */ });
    } else if (s.error) {
      Promise.resolve().then(() => log({ ts: new Date().toISOString(), module: 'literature', status: 'error', summary: s.error || 'Unknown error' }));
    }
    Promise.resolve().then(() => markDone('lit'));
     
  }, [litStream.state.done]);

  useEffect(() => {
    if (!evalStream.state.done) return;
    const s = evalStream.state;
    if (s.ok && s.result) {
      const d = s.result;
      const uid = d.uniprot || '';
      const repInfo = d.report
        ? (d.report.ok
            ? ` + report ${d.report.savedToFile ? `saved to ${d.report.filename}` : 'generated'} (${d.report.provider}/${d.report.model}, ${Math.round((d.report.durationMs || 0) / 100) / 10}s)`
            : ` [!] report generation failed: ${d.report.error}`)
        : ' (report skipped)';
      Promise.resolve().then(() => log({
        ts: new Date().toISOString(),
        module: 'eval',
        status: d.report && !d.report.ok && evalGenerateReport ? 'error' : 'success',
        summary: `${d.uniprotInfo?.proteinName || uid}: direct=${d.directPdbCount}, blast=${d.blastHitCount}, cov=${d.coverage ?? 0}%, overall=${d.scores?.overall?.score ?? '?'}/10${repInfo}`,
        details: `Scores: X-ray ${d.scores?.xray?.score ?? '?'}, Cryo-EM ${d.scores?.cryoem?.score ?? '?'}, NMR ${d.scores?.nmr?.score ?? '?'}${d.skippedBblast ? ' (BLAST skipped)' : ''}`,
        durationMs: d.durationMs,
      }));
    } else if (s.error) {
      Promise.resolve().then(() => log({ ts: new Date().toISOString(), module: 'eval', status: 'error', summary: s.error || 'Unknown error' }));
    }
    Promise.resolve().then(() => markDone('eval'));
    // ★ Notify parent so the evaluation list (including new batch entries) is
    // refetched immediately — fixes "first target appears in single evals
    // instead of under the batch" caused by stale UI data.
    if (s.ok) onDbChanged?.();
  }, [evalStream.state.done]);

  const weeklyLogThrottle = useRef(0);
  useEffect(() => {
    const s = weeklyStream.state;
    if (s.log.length > 0) {
      const latest = s.log[s.log.length - 1];
      const summary = (latest.detail || latest.message || latest.stage || '').toString();
      if (summary && Date.now() - weeklyLogThrottle.current > 800) {
        weeklyLogThrottle.current = Date.now();
        log({ ts: new Date().toISOString(), module: 'weekly', status: 'running', summary });
      }
    }
     
  }, [weeklyStream.state.log.length]);

  useEffect(() => {
    if (!weeklyStream.state.done) return;
    const s = weeklyStream.state;
    if (s.ok && s.result) {
      const r = s.result;
      const cycles = r.cycles || [];
      const providers = [...new Set(cycles.map((c: any) => c.provider).filter(Boolean))].join(', ');
      Promise.resolve().then(() => log({
        ts: new Date().toISOString(),
        module: 'weekly',
        status: 'success',
        summary: `Completed ${r.window?.weekId} (${(r.reports || []).join('+')}) • ${cycles.length} cycles • ${providers} • ${(r.durationMs / 1000).toFixed(0)}s`,
        details: [
          `DB rows: PdbStructure=${r.dbCounts?.pdbStructure}, WeeklyReport=${r.dbCounts?.weeklyReport}, with_authors=${r.dbCounts?.withAuthors}/${r.dbCounts?.pdbStructure}, with_pubmedId=${r.dbCounts?.withPubmedId}/${r.dbCounts?.pdbStructure}, PubMedArticle.matched=${r.dbCounts?.pubmedArticleMatched}`,
          `Files:`,
          ...(r.filesWritten || []).map((f: string) => `  • ${f}`),
          `Cycles:`,
          ...cycles.map((c: any) => `  • C${c.cycle}${c.role === 'critic-scientific' ? ' (critic-sci)' : c.role === 'synthesis' ? ' (synthesis)' : ''} ${c.reportType} via ${c.provider}/${c.model} → ${((c.durationMs || 0) / 1000).toFixed(1)}s, ${c.contentChars || 0} chars${c.verdict ? `, verdict=${c.verdict}` : ''}`),
        ].join('\n'),
        durationMs: r.durationMs,
      }));
      fetch('/api/pdb-weekly/run', { method: 'GET' })
        .then(r => r.json())
        .then((d: any) => { if (d?.dbCounts) setWeeklyDbCounts(d.dbCounts); })
        .catch(() => { /* ignore */ });
    } else if (s.error) {
      Promise.resolve().then(() => log({ ts: new Date().toISOString(), module: 'weekly', status: 'error', summary: s.error || 'Unknown error' }));
    }
    Promise.resolve().then(() => markDone('weekly'));
     
  }, [weeklyStream.state.done]);

  /* ──────────────────────────────────────────────────────────────────── */
  /*  Render                                                               */
  /* ──────────────────────────────────────────────────────────────────── */

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 text-xs font-medium border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] text-claude-text-secondary dark:text-[#9b9590] hover:border-claude-accent/40 hover:bg-claude-accent-light dark:hover:bg-[#3d2a22] hover:text-claude-accent transition-all relative"
        >
          <Settings2 className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">{t.runCenter}</span>
          {running.size > 0 && (
            <span className="absolute -top-1 -right-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-claude-accent text-white text-4xs font-bold px-1 shadow-sm ring-2 ring-claude-surface dark:ring-[#242220]">
              {running.size}
            </span>
          )}
        </Button>
      </DialogTrigger>

      <DialogContent ref={contentRef as React.Ref<HTMLDivElement>} className="max-w-6xl sm:!max-w-6xl w-[95vw] max-h-[92vh] p-0 gap-0 overflow-hidden flex flex-col bg-claude-surface dark:bg-[#242220] border-claude-border dark:border-[#3d3832]">
        {/* ── Header band (compact, warm claude gradient) ──────────── */}
        <div className="relative px-6 pt-4 pb-3 border-b border-claude-border dark:border-[#3d3832] bg-gradient-to-br from-claude-accent-light via-claude-surface to-claude-surface dark:from-[#2a1f1a] dark:via-[#242220] dark:to-[#242220] flex-shrink-0">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,var(--tw-gradient-stops))] from-claude-accent/8 via-transparent to-transparent pointer-events-none" />
          <DialogHeader className="relative">
            <DialogTitle className="flex items-center gap-2.5 text-lg">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-claude-accent/20 to-claude-accent/5 border border-claude-accent/25 shadow-sm">
                <Sparkles className="h-4.5 w-4.5 text-claude-accent" />
              </div>
              <span className="text-claude-text dark:text-[#e8e4dd]">{t.runCenter}</span>
              <Badge variant="outline" className="ml-1 text-xs font-medium px-2 h-5 gap-1 rounded-md shrink-0 border-claude-border/60 dark:border-[#3d3832]/60 bg-claude-border-light/60 dark:bg-[#2b2926]/60 text-claude-text-muted dark:text-[#9b9590]">
                <Layers className="h-2.5 w-2.5" /> {locale === 'zh' ? '3 个模块' : '3 modules'}
              </Badge>
              {running.size > 0 && (
                <Badge variant="outline" className="ml-1 text-xs font-medium px-2 h-5 gap-1 rounded-md shrink-0 border-claude-accent/40 bg-claude-accent/10 text-claude-accent">
                  <Loader2 className="h-2.5 w-2.5 animate-spin" /> {running.size} {locale === 'zh' ? '运行中' : 'running'}
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription className="text-sm leading-relaxed pt-1 text-claude-text-muted dark:text-[#9b9590]">
              {t.runCenterDesc}
            </DialogDescription>
          </DialogHeader>
        </div>

        {/* ── LLM provider status bar — 2-column compact layout ──────────── */}
        <div className="px-6 py-2.5 border-b border-claude-border dark:border-[#3d3832] bg-claude-bg/40 dark:bg-[#1a1917]/40 flex-shrink-0">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2.5 min-w-0 flex-wrap">
              <div className="flex items-center gap-1.5 shrink-0">
                <Cpu className="h-3.5 w-3.5 text-claude-text-muted dark:text-[#9b9590]" />
                <span className="text-sm font-medium text-claude-text dark:text-[#e8e4dd]">{t.llmProvider}</span>
              </div>
              <code className="px-2 py-0.5 rounded bg-claude-surface dark:bg-[#1a1917] border border-claude-border dark:border-[#3d3832] font-mono text-sm text-claude-text dark:text-[#e8e4dd] shrink-0">
                {effectiveProviderId || (scanning ? (locale === 'zh' ? '扫描中…' : 'Scanning…') : (locale === 'zh' ? '未检测到' : 'Not detected'))}
              </code>
              <div className="hidden sm:flex items-center gap-2 text-xs text-claude-text-muted/70 dark:text-[#9b9590]/70">
                <span>
                  {chosenProvider === AUTO_PROVIDER ? (locale === 'zh' ? 'auto · ' : 'auto · ') : (locale === 'zh' ? '🔒 已锁定 · ' : '🔒 Locked · ')}
                  <span className="font-mono">
                    {llmInfo?.available?.length ?? 0}
                  </span>
                  {locale === 'zh' ? ' 可用' : ' available'}
                </span>
                <span className="opacity-50">/</span>
                <span className="font-mono">{llmInfo?.totalClisScanned ?? 0} {locale === 'zh' ? '个 CLI' : 'CLI'}</span>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <TooltipProvider delayDuration={300}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="sm" className="h-7 w-7 p-0 hover:bg-claude-border-light dark:hover:bg-[#2b2926]" onClick={rescan} disabled={scanning}>
                      <RefreshCw className={`h-3.5 w-3.5 ${scanning ? 'animate-spin' : ''}`} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">{locale === 'zh' ? '重新扫描 CLI / SDK' : 'Re-scan CLI / SDK'}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <Button variant="ghost" size="sm" className="h-7 text-sm gap-1 hover:bg-claude-border-light dark:hover:bg-[#2b2926]" onClick={() => setShowLlmCfg(s => !s)}>
                <ChevronDown className={`h-3 w-3 transition-transform ${showLlmCfg ? 'rotate-180' : ''}`} />
                {showLlmCfg ? (locale === 'zh' ? '隐藏配置' : 'Hide Config') : (locale === 'zh' ? 'LLM 配置' : 'LLM Config')}
              </Button>
            </div>
          </div>

          {/* provider pills — always show at least auto + z.ai SDK; backend providers appended when available */}
          <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => pickProvider(AUTO_PROVIDER)}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs border transition-all ${
                  chosenProvider === AUTO_PROVIDER
                    ? 'border-claude-accent/50 bg-claude-accent/10 text-claude-accent font-medium shadow-sm'
                    : 'border-claude-border dark:border-[#3d3832] text-claude-text-muted dark:text-[#9b9590] hover:text-claude-text dark:hover:text-[#e8e4dd] hover:border-claude-accent/40'
                }`}
                title={locale === 'zh' ? '让服务器按 CLI → SDK 顺序自动选择' : 'Let server auto-select in CLI → SDK order'}
              >
                <Sparkles className="h-2 w-2" />
                <span>auto</span>
              </button>
              {llmInfo?.available && llmInfo.available.length > 0 && llmInfo.available.map((a, i) => {
                const isPinned = chosenProvider === a.provider;
                const isEffective = effectiveProviderId === a.provider;
                // Hover-only tooltip: provider name (left), then full bin path (right).
                // Path is suppressed from the visible label to keep pills compact.
                return (
                  <TooltipProvider key={i} delayDuration={250}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          onClick={() => pickProvider(a.provider)}
                          className={`group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                            isPinned
                              ? 'border-primary/50 bg-primary/10 text-foreground shadow-sm'
                              : isEffective
                              ? 'border-emerald-500/40 bg-emerald-500/5 text-foreground'
                              : 'border-border/60 text-muted-foreground hover:text-foreground hover:border-primary/40'
                          }`}
                        >
                          {a.iconUrl ? (
                            <img
                              src={`/api/llm/icon?provider=${encodeURIComponent(a.provider)}&bin=${encodeURIComponent(a.bin || '')}`}
                              alt={a.label}
                              width={14}
                              height={14}
                              className="h-3.5 w-3.5 object-contain shrink-0"
                              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                            />
                          ) : (
                            <span className="text-[12px] leading-none">{a.icon || '·'}</span>
                          )}
                          <span className="font-mono text-sm">{a.label || a.provider}</span>
                          {a.via === 'wsl' && <span className="px-1.5 h-5 inline-flex items-center rounded-md bg-violet-500/15 text-violet-600 dark:text-violet-300 text-xs font-medium font-mono">WSL</span>}
                          {a.via === 'sdk' && <span className="px-1.5 h-5 inline-flex items-center rounded-md bg-sky-500/15 text-sky-600 dark:text-sky-300 text-xs font-medium font-mono">SDK</span>}
                          {isPinned && <Lock className="h-2.5 w-2.5 opacity-70" />}
                          {isEffective && !isPinned && (
                            <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          )}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-xs whitespace-pre-line text-left">
                        <div className="font-mono text-xs">{a.label || a.provider}</div>
                        {a.bin && (
                          <div className="font-mono text-xs opacity-80 mt-0.5 break-all">📁 {a.bin}</div>
                        )}
                        <div className="text-xs opacity-70 mt-0.5">{a.reason}</div>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                );
              })}
              {/* z.ai SDK — temporary option for LLM testing using z-ai-web-dev-sdk */}
              <TooltipProvider delayDuration={250}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      onClick={() => pickProvider('zai')}
                      className={`group inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all ${
                        chosenProvider === 'zai'
                          ? 'border-claude-accent/50 bg-claude-accent/10 text-claude-accent shadow-sm'
                          : 'border-claude-accent/30 bg-claude-accent/5 text-claude-accent hover:border-claude-accent/50'
                      }`}
                      title="z.ai SDK (z-ai-web-dev-sdk) — temporary LLM test option"
                    >
                      <Sparkles className="h-3 w-3" />
                      <span className="font-mono text-sm">z.ai</span>
                      <span className="px-1.5 h-5 inline-flex items-center rounded-md bg-claude-accent/15 text-claude-accent text-xs font-medium font-mono">SDK</span>
                      {chosenProvider === 'zai' && <Lock className="h-2.5 w-2.5 opacity-70" />}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs whitespace-pre-line text-left">
                    <div className="font-mono text-xs">z.ai SDK (z-ai-web-dev-sdk)</div>
                    <div className="text-xs text-muted-foreground mt-1">Temporary LLM test option using built-in z-ai-web-dev-sdk to call GLM models. No extra API key configuration needed.</div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

          <div className="mt-1.5 text-xs text-muted-foreground/60">
            {chosenProvider === AUTO_PROVIDER
              ? (locale === 'zh' ? '自动模式：服务器按 CLI → SDK 顺序自动选，锁定的 provider 显示 🔒' : 'Auto mode: server auto-selects in CLI → SDK order. Locked provider shows 🔒')
              : `Locked to ${chosenProvider}. Click auto or another provider to switch.`}
          </div>

          {/* advanced LLM config (collapsible) */}
          <AnimatePresence>
            {showLlmCfg && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="overflow-hidden"
              >
                <div className="mt-3 pt-3 border-t border-border/40 grid grid-cols-2 gap-2.5">
                  <div className="col-span-2">
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">{locale === 'zh' ? '提供方' : 'Provider'}</Label>
                    <Input
                      placeholder={locale === 'zh' ? 'cli:hermes | cli:claude | cli:codex | anthropic | openai | (空=自动)' : 'cli:hermes | cli:claude | cli:codex | anthropic | openai | (empty=auto)'}
                      value={llmCfg.provider}
                      onChange={e => setLlmCfg({ ...llmCfg, provider: e.target.value })}
                      className="h-8 px-2 text-xs md:text-xs font-mono mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">{locale === 'zh' ? 'API 密钥' : 'API Key'}</Label>
                    <Input
                      type="password"
                      placeholder="sk-…"
                      value={llmCfg.apiKey}
                      onChange={e => setLlmCfg({ ...llmCfg, apiKey: e.target.value })}
                      className="h-8 px-2 text-xs md:text-xs font-mono mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">{locale === 'zh' ? 'Base URL' : 'Base URL'}</Label>
                    <Input
                      placeholder="https://api.openai.com/v1"
                      value={llmCfg.baseUrl}
                      onChange={e => setLlmCfg({ ...llmCfg, baseUrl: e.target.value })}
                      className="h-8 px-2 text-xs md:text-xs font-mono mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">{locale === 'zh' ? '模型' : 'Model'}</Label>
                    <Input
                      placeholder="claude-sonnet-4-20250514 / gpt-4o-mini"
                      value={llmCfg.model}
                      onChange={e => setLlmCfg({ ...llmCfg, model: e.target.value })}
                      className="h-8 px-2 text-xs md:text-xs font-mono mt-1"
                    />
                  </div>
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground">{locale === 'zh' ? 'System' : 'System'}</Label>
                    <Input
                      placeholder={locale === 'zh' ? '(可选) System 提示词' : '(optional) System prompt'}
                      value={llmCfg.system}
                      onChange={e => setLlmCfg({ ...llmCfg, system: e.target.value })}
                      className="h-8 px-2 text-xs md:text-xs font-mono mt-1"
                    />
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ── Database config (always visible) ──────────────────────── */}
          <div className="mt-3 border-t border-claude-border/40 dark:border-[#3d3832]/40 pt-2">
            {/* Title + active path + schema badges + loaded status — single dense line */}
            <div className="flex items-center gap-1.5 flex-wrap mb-3">
              <Database className="h-3.5 w-3.5 text-claude-text-muted dark:text-[#9b9590] shrink-0" />
              <span className="text-sm font-medium text-claude-text dark:text-[#e8e4dd] shrink-0">{t.database}</span>
              {dbStatus?.activeFsPath && (
                <code className="text-xs font-mono text-claude-text-muted dark:text-[#9b9590] truncate min-w-0" title={dbStatus.activeFsPath}>
                  {dbStatus.activeFsPath}
                </code>
              )}
              {dbStatus?.isTest && (
                <Badge variant="outline" className="text-xs font-medium px-2 h-5 gap-1 rounded-md shrink-0 border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="h-2 w-2" /> {locale === 'zh' ? '测试库' : 'Test DB'}
                </Badge>
              )}
              {dbStatus?.hasSchema ? (
                <Badge variant="outline" className="text-xs font-medium px-2 h-5 gap-1 rounded-md shrink-0 border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-2 w-2" /> {locale === 'zh' ? 'Schema' : 'Schema'} {dbStatus.tableCount}
                </Badge>
              ) : dbStatus ? (
                <Badge variant="outline" className="text-xs font-medium px-2 h-5 gap-1 rounded-md shrink-0 border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400">
                  <XCircle className="h-2 w-2" /> {locale === 'zh' ? '未初始化' : 'Not initialized'}
                </Badge>
              ) : null}
              {dbStatus?.hasSchema && (dbStatus.counts?.PdbStructure || 0) > 0 && (
                <Badge variant="outline" className="text-xs font-medium px-2 h-5 gap-1 rounded-md shrink-0 border-claude-border/60 dark:border-[#3d3832]/60 bg-claude-border-light/60 dark:bg-[#2b2926]/60 text-claude-text-muted dark:text-[#9b9590]">
                  PDB {dbStatus.counts?.PdbStructure}
                </Badge>
              )}
              {dbStatus?.hasSchema && (dbStatus.counts?.Evaluation || 0) > 0 && (
                <Badge variant="outline" className="text-xs font-medium px-2 h-5 gap-1 rounded-md shrink-0 border-claude-border/60 dark:border-[#3d3832]/60 bg-claude-border-light/60 dark:bg-[#2b2926]/60 text-claude-text-muted dark:text-[#9b9590]">
                  Eval {dbStatus.counts?.Evaluation}
                </Badge>
              )}
              {dbStatus?.hasSchema && (dbStatus.counts?.PubMedArticle || 0) > 0 && (
                <Badge variant="outline" className="text-xs font-medium px-2 h-5 gap-1 rounded-md shrink-0 border-claude-border/60 dark:border-[#3d3832]/60 bg-claude-border-light/60 dark:bg-[#2b2926]/60 text-claude-text-muted dark:text-[#9b9590]">
                  Papers {dbStatus.counts?.PubMedArticle}
                </Badge>
              )}
              {dbPathStatus && (
                <span className={`text-xs font-medium ml-auto shrink-0 ${dbPathStatus.startsWith('✓') ? 'text-emerald-500 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                  {dbPathStatus}
                </span>
              )}
            </div>

            {/* Input + switch + new + select — single tight row */}
            <div className="flex items-center gap-1.5">
              <Input
                value={dbPath}
                onChange={e => setDbPath(e.target.value)}
                placeholder="file:./db/custom.db"
                className="h-8 px-2 text-xs md:text-xs font-mono flex-1 min-w-0 bg-claude-surface dark:bg-[#1a1917] border-claude-border dark:border-[#3d3832]"
              />
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs shrink-0 px-2 border-claude-border dark:border-[#3d3832] hover:bg-claude-border-light dark:hover:bg-[#2b2926]"
                onClick={saveDbPath}
                disabled={dbPathSaving}
              >
                {dbPathSaving ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Save className="h-3 w-3" />}
                <span className="ml-1">{t.dbSwitch}</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs shrink-0 px-2 border-claude-accent/40 text-claude-accent hover:bg-claude-accent/10"
                onClick={() => { setDbWizardMode('create'); setDbWizardOpen(true); }}
              >
                <FilePlus2 className="h-3 w-3" /> {t.dbNew}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs shrink-0 px-2 border-claude-accent/40 text-claude-accent hover:bg-claude-accent/10"
                onClick={() => { setDbWizardMode('select'); setDbWizardOpen(true); }}
              >
                <FolderOpen className="h-3 w-3" /> {t.dbSelect}
              </Button>
            </div>

            {dbStatus?.isTest && (
              <div className="mt-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-xs text-amber-700 dark:text-amber-400 leading-relaxed">
                <AlertTriangle className="h-3 w-3 inline mr-1" />
                {t.dbTestWarning}
              </div>
            )}
          </div>

          {/* DB setup wizard (shared with first-run flow) */}
          <DbSetupWizard
            open={dbWizardOpen}
            allowSkip
            initialMode={dbWizardMode}
            onClose={() => setDbWizardOpen(false)}
            onComplete={() => {
              setDbWizardOpen(false);
              loadDbPath();
              // ★ Notify parent so dashboard data refreshes from the new DB.
              onDbChanged?.();
              toast.success('数据库已就绪，运行中心与三大模块已同步');
            }}
          />
        </div>

        {/* ── Tabbed module panels ─────────────────────────────────────── */}
        <div className="px-6 pt-3 pb-6 flex-1 min-h-0 overflow-y-auto sidebar-scroll">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="gap-2">
            <TabsList className="grid w-full grid-cols-3 h-10 bg-claude-bg/60 dark:bg-[#1a1917]/60 rounded-lg p-1 gap-1 border border-claude-border/40 dark:border-[#3d3832]/40">
              <TabsTrigger value="evaluation" className="text-xs gap-1.5 rounded-md font-medium data-[state=active]:bg-claude-accent/15 data-[state=active]:text-claude-accent data-[state=active]:shadow-sm data-[state=active]:border data-[state=active]:border-claude-accent/30 text-claude-text-muted dark:text-[#9b9590] hover:text-claude-text dark:hover:text-[#e8e4dd] border border-transparent transition-all">
                <FlaskConical className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">① {t.tabEval}</span>
                <span className="sm:hidden">① {t.tabEvalShort}</span>
                {isRunning('eval') && <Loader2 className="h-3 w-3 animate-spin text-claude-accent" />}
              </TabsTrigger>
              <TabsTrigger value="literature" className="text-xs gap-1.5 rounded-md font-medium data-[state=active]:bg-claude-accent/15 data-[state=active]:text-claude-accent data-[state=active]:shadow-sm data-[state=active]:border data-[state=active]:border-claude-accent/30 text-claude-text-muted dark:text-[#9b9590] hover:text-claude-text dark:hover:text-[#e8e4dd] border border-transparent transition-all">
                <BookOpen className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">② {t.tabLit}</span>
                <span className="sm:hidden">② {t.tabLitShort}</span>
                {isRunning('lit') && <Loader2 className="h-3 w-3 animate-spin text-claude-accent" />}
              </TabsTrigger>
              <TabsTrigger value="weekly" className="text-xs gap-1.5 rounded-md font-medium data-[state=active]:bg-claude-accent/15 data-[state=active]:text-claude-accent data-[state=active]:shadow-sm data-[state=active]:border data-[state=active]:border-claude-accent/30 text-claude-text-muted dark:text-[#9b9590] hover:text-claude-text dark:hover:text-[#e8e4dd] border border-transparent transition-all">
                <CalendarClock className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">③ {t.tabWeekly}</span>
                <span className="sm:hidden">③ {t.tabWeeklyShort}</span>
                {isRunning('weekly') && <Loader2 className="h-3 w-3 animate-spin text-claude-accent" />}
              </TabsTrigger>
            </TabsList>

            {/* Tab content panel — spotlighted by the tour (steps 4/5/6) */}
            <div ref={tabContentRef as React.Ref<HTMLDivElement>} className="mt-2">
            {/* ═══ Module ① Target Evaluation ═══════════════════════════ */}
            <TabsContent value="evaluation" className="mt-0">
              <ModuleCard
                icon={<FlaskConical className="h-4 w-4" />}
                accent="cryoem"
                index="①"
                title={t.moduleEvalTitle}
                endpoint="POST /api/evaluations/run"
                description={locale === 'zh' ? 'UniProt → 元数据 + 序列 → RCSB 直接 PDB → SIFTS 覆盖度 → NCBI BLASTp 同源 → 评分 → 原子任务包含 LLM 报告生成（写入 Evaluation.report + EvaluationReport 表 + 可选 LLM-Wiki）。支持多个 UniProt ID 批量评估，含跨靶点结构与关联分析。' : 'UniProt → metadata + sequence → RCSB direct PDB → SIFTS coverage → NCBI BLASTp homology → scoring → atomic tasks include LLM report generation (writes to Evaluation.report + EvaluationReport table + optional LLM-Wiki). Supports multiple UniProt IDs for batch evaluation with cross-target structure and correlation analysis.'}
                headerBadge={evalTargets.length > 1 ? (
                  <Badge variant="outline" className="text-xs font-medium px-2 h-5 gap-1 rounded-md shrink-0 border-claude-xray/40 bg-claude-xray-bg text-claude-xray" title={locale === 'zh' ? '多靶点批量评估 + 关联分析' : 'Multi-target batch evaluation + correlation analysis'}>
                    <Layers className="h-2 w-2" /> {locale === 'zh' ? '批量' : 'Batch'} · {evalTargets.length} {locale === 'zh' ? '靶点' : 'targets'}
                  </Badge>
                ) : null}
              >
                {/* Input mode toggle: UniProt ID vs Sequence */}
                <div className="flex items-center gap-1.5 mb-3">
                  <div className="flex items-center gap-0.5 rounded-md bg-muted/40 border border-border/40 p-0.5">
                    <button type="button" onClick={() => setEvalInputMode('uniprot')} className={`px-2 py-1 rounded text-xs font-medium transition-colors ${evalInputMode === 'uniprot' ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>{locale === 'zh' ? 'UniProt ID' : 'UniProt ID'}</button>
                    <button type="button" onClick={() => setEvalInputMode('sequence')} className={`px-2 py-1 rounded text-xs font-medium transition-colors ${evalInputMode === 'sequence' ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:text-foreground'}`}>{t.evalInputModeSequence}</button>
                  </div>
                  {evalInputMode === 'sequence' && (
                    <div className="flex items-center gap-0.5 rounded-md bg-muted/40 border border-border/40 p-0.5">
                      <button type="button" onClick={() => setEvalSeqType('aa')} className={`px-2 py-1 rounded text-xs font-medium transition-colors ${evalSeqType === 'aa' ? 'bg-sky-500/10 text-sky-600 dark:text-sky-300' : 'text-muted-foreground hover:text-foreground'}`}>{t.evalSeqTypeAA}</button>
                      <button type="button" onClick={() => setEvalSeqType('dna')} className={`px-2 py-1 rounded text-xs font-medium transition-colors ${evalSeqType === 'dna' ? 'bg-sky-500/10 text-sky-600 dark:text-sky-300' : 'text-muted-foreground hover:text-foreground'}`}>DNA</button>
                    </div>
                  )}
                </div>

                {evalInputMode === 'sequence' ? (
                  /* Sequence input mode */
                  <div className="space-y-2 mb-3">
                    <div>
                      <Label className="text-xs uppercase tracking-wider text-muted-foreground">
                        {evalSeqType === 'dna'
                          ? (locale === 'zh' ? 'DNA 序列（自动转录为氨基酸）' : 'DNA sequence (auto-transcribed to amino acid)')
                          : (locale === 'zh' ? '氨基酸序列' : 'Amino acid sequence')}
                      </Label>
                      <textarea
                        value={evalSequence}
                        onChange={e => setEvalSequence(e.target.value)}
                        placeholder={evalSeqType === 'dna'
                          ? (locale === 'zh'
                              ? '支持多条序列输入，以空行分隔。每条序列独立进行 BLAST 与评估。\n\n示例：\nATGGCGAGC...\n\nATGTTACGT...'
                              : 'Supports multiple sequence inputs, separated by blank lines. Each sequence is independently BLASTed and evaluated.\n\nExample:\nATGGCGAGC...\n\nATGTTACGT...')
                          : (locale === 'zh'
                              ? '支持多条序列输入，以空行分隔。每条序列独立进行 BLAST 与评估。\n\n示例：\nMAGSCKLP...\n\nMKLTVFGV...'
                              : 'Supports multiple sequence inputs, separated by blank lines. Each sequence is independently BLASTed and evaluated.\n\nExample:\nMAGSCKLP...\n\nMKLTVFGV...')}
                        className="mt-1 w-full h-24 px-2 py-1.5 rounded-md border border-border/60 bg-background text-xs font-mono resize-y thin-scroll"
                        spellCheck={false}
                      />
                      <p className="text-3xs text-muted-foreground mt-0.5">
                        {evalSequence.trim().length > 0
                          ? (() => {
                              const cnt = evalSequence.split(/\n\s*\n+/).map(s => s.trim()).filter(s => s.length > 0).length;
                              const totalLen = evalSequence.replace(/\s/g, '').length;
                              const seqWord = locale === 'zh' ? '条序列' : 'sequences';
                              const totalWord = locale === 'zh' ? '总数' : 'total';
                              const multiWord = locale === 'zh' ? '多序列批量模式（含跨序列关联分析）' : 'multi-sequence batch mode (with cross-sequence analysis)';
                              return `${cnt} ${seqWord} · ${totalLen} ${evalSeqType === 'dna' ? 'nt' : 'aa'} ${totalWord}${cnt > 1 ? ' · ' + multiWord : ''}`;
                            })()
                          : (locale === 'zh'
                              ? `输入${evalSeqType === 'dna' ? 'DNA' : '氨基酸'}序列进行 BLASTp 同源搜索（多条序列以空行分隔）`
                              : `Enter ${evalSeqType === 'dna' ? 'DNA' : 'amino acid'} sequence for BLASTp homology search (separate multiple sequences with blank lines)`)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <div className="w-20 shrink-0">
                        <Field label="BLAST">
                          <Input type="number" min={1} max={500} value={evalTargets[0]?.maxBlastHits || 50} onChange={e => updateEvalTarget(0, 'maxBlastHits', parseInt(e.target.value || '50'))} className="h-8 px-2 text-xs md:text-xs font-mono" />
                        </Field>
                      </div>
                      <div className="ml-auto shrink-0">
                        <RunButton running={isRunning('eval')} onClick={runEvaluation} onCancel={() => evalStream.cancel()} />
                      </div>
                    </div>
                  </div>
                ) : (
                /* UniProt ID input mode (original) */
                <div className="space-y-2 mb-3">
                  {evalTargets.map((t, i) => (
                    <div key={i} className="flex items-end gap-1.5">
                      {/* Left slot: + (add) on row 1, remove (×) on rows 2+, placeholder on row 1 if single */}
                      {i === 0 ? (
                        <Button variant="outline" size="sm" className="h-8 w-8 p-0 shrink-0" onClick={addEvalTarget} title={locale === 'zh' ? '新增靶点' : 'Add target'}>
                          <Plus className="h-3.5 w-3.5" />
                        </Button>
                      ) : (
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-muted-foreground hover:text-rose-500 shrink-0" onClick={() => removeEvalTarget(i)} title={locale === 'zh' ? '移除该靶点' : 'Remove this target'}>
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      )}
                      <div className="w-28 shrink-0">
                        <Field label={evalTargets.length > 1 ? (locale === 'zh' ? `UniProt ID ${i + 1}` : `UniProt ID ${i + 1}`) : 'UniProt ID'}>
                          <Input value={t.uniprot} onChange={e => updateEvalTarget(i, 'uniprot', e.target.value)} placeholder="P00533" className="h-8 px-2 text-xs md:text-xs font-mono" />
                        </Field>
                      </div>
                      <div className="w-16 shrink-0">
                        <Field label={locale === 'zh' ? 'PDB上限' : 'maxPdb'}>
                          <Input type="number" min={1} max={500} value={t.maxPdb} onChange={e => updateEvalTarget(i, 'maxPdb', parseInt(e.target.value || '80'))} className="h-8 px-2 text-xs md:text-xs font-mono" />
                        </Field>
                      </div>
                      <div className="w-16 shrink-0">
                        <Field label="BLAST">
                          <Input type="number" min={1} max={500} value={t.maxBlastHits} onChange={e => updateEvalTarget(i, 'maxBlastHits', parseInt(e.target.value || '50'))} className="h-8 px-2 text-xs md:text-xs font-mono" />
                        </Field>
                      </div>
                      {i === 0 && (
                        <div className="w-20 shrink-0" title={locale === 'zh' ? '附加到 LLM 报告上下文的最大 PubMed 文献数（按期刊 IF 降序排序）' : 'Max PubMed literature count attached to LLM report context (sorted by journal IF descending)'}>
                          <Field label={locale === 'zh' ? '上限' : 'Max Lit'}>
                            <Input type="number" min={0} max={200} value={evalMaxLitCount} onChange={e => setEvalMaxLitCount(Math.max(0, Math.min(200, parseInt(e.target.value || '20') || 0)))} className="h-8 px-2 text-xs md:text-xs font-mono" />
                          </Field>
                        </div>
                      )}
                      {/* BLAST mode: two independent toggles. Neither checked =
                          "auto" (backend runs BLAST when PDB<5 or coverage<50%).
                          Force BLAST = always run. Skip BLAST = never run. */}
                      <ToggleChip checked={t.forceBlast} onCheckedChange={(v) => { updateEvalTarget(i, 'forceBlast', v); if (v) updateEvalTarget(i, 'skipBlast', false); }} label={locale === 'zh' ? '强制 BLAST' : 'Force BLAST'} />
                      <ToggleChip checked={t.skipBlast} onCheckedChange={(v) => { updateEvalTarget(i, 'skipBlast', v); if (v) updateEvalTarget(i, 'forceBlast', false); }} label={locale === 'zh' ? '跳过 BLAST' : 'Skip BLAST'} />
                      {!t.forceBlast && !t.skipBlast && (
                        <span className="text-[9px] text-claude-text-muted italic shrink-0" title={locale === 'zh' ? 'PDB<5 或覆盖率<50% 时自动执行 BLAST' : 'Auto: runs BLAST when PDB<5 or coverage<50%'}>
                          {locale === 'zh' ? '自动' : 'Auto'}
                        </span>
                      )}
                      {i === 0 && (
                        <div className="ml-auto shrink-0">
                          <RunButton
                            running={isRunning('eval')}
                            onClick={runEvaluation}
                            onCancel={() => evalStream.cancel()}
                          />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
                ) /* end UniProt ID mode */}

                <StreamFeed
                  events={evalStream.state.log}
                  running={evalStream.state.running}
                  done={evalStream.state.done}
                  ok={evalStream.state.ok}
                  emptyHint={locale === 'zh' ? '输入 UniProt ID 并点击 “执行” 启动评估流水线' : 'Enter a UniProt ID and click Run to start the evaluation pipeline'}
                />

                {/* Per-chapter streamed LLM output (collapsible "thinking process") */}
                <ChapterStream
                  events={evalStream.state.log}
                  running={evalStream.state.running}
                  done={evalStream.state.done}
                />

                {/* LLM report inline preview (module ①) — shows real LLM output or failure.
                    Uses `effectivePrimaryReport` so the preview appears as soon as the
                    primary target's chapters finish streaming (via chapter_done SSE
                    events), WITHOUT waiting for the entire batch run to complete. */}
                {effectivePrimaryReport && (
                  <LLMPreview
                    content={effectivePrimaryReport.content}
                    title={`${locale === 'zh' ? 'LLM 可行性报告' : 'LLM Feasibility Report'} · ${evalStream.state.result?.uniprotInfo?.proteinName || evalStream.state.result?.uniprot || (evalStream.state.running ? (locale === 'zh' ? '生成中…' : 'Generating…') : (locale === 'zh' ? '主靶点' : 'Primary target'))}`}
                    provider={effectivePrimaryReport.provider}
                    model={effectivePrimaryReport.model}
                    durationMs={effectivePrimaryReport.durationMs}
                    fallback={effectivePrimaryReport.fallback}
                    error={effectivePrimaryReport.error}
                    ok={effectivePrimaryReport.ok}
                    dbSaved={evalStream.state.done ? evalStream.state.result?.dbSaved : undefined}
                    chars={effectivePrimaryReport.contentChars}
                    accent="cryoem"
                  />
                )}

                {/* Batch-mode: per-target LLM report previews (one card per
                    non-primary batch target). The primary target's report is
                    rendered by the block above. Each subsequent target's report
                    is surfaced as its own collapsible LLMPreview so the user
                    can review every individual evaluation produced during a
                    batch run without leaving the Run Center. */}
                {evalStream.state.done && evalStream.state.result?.batchResults
                  && Array.isArray(evalStream.state.result.batchResults)
                  && evalStream.state.result.batchResults
                      // Preserve the original index so the "Batch N/M" label is
                      // accurate (primary = Batch 1, subsequent = Batch 2/3…).
                      .map((br: any, idx: number) => ({ br, idx }))
                      // Skip the primary target (already shown above) and any
                      // entries that didn't produce a report.
                      .filter(({ br, idx }) => idx > 0 && br?.report?.content)
                      .map(({ br, idx }) => (
                        <LLMPreview
                          key={`batch-report-${br.uniprot}-${idx}`}
                          content={br.report.content}
                          title={`LLM 报告 · ${br.proteinName || br.uniprot}（Batch ${idx + 1}/${evalStream.state.result.batchResults.length}）${br.cached ? ' · 缓存' : ''}`}
                          provider={br.report.provider}
                          model={br.report.model}
                          durationMs={br.report.durationMs}
                          fallback={false}
                          error={br.report.error}
                          ok={br.report.ok}
                          dbSaved={!!br.report.ok}
                          chars={br.report.contentChars}
                          accent="xray"
                        />
                      ))}

                {/* Cross-target relationship LLM report preview (batch mode only).
                    Surfaced as its own LLMPreview so the user can review the
                    cross-target analysis alongside the per-target reports. */}
                {evalStream.state.done
                  && evalStream.state.result?.crossAnalysis?.crossReport?.content && (
                  <LLMPreview
                    content={evalStream.state.result.crossAnalysis.crossReport.content}
                    title={locale === 'zh' ? '跨靶点关联报告 · 批量' : 'Cross-Target Correlation Report · Batch'}
                    provider={evalStream.state.result.crossAnalysis.crossReport.provider}
                    model={evalStream.state.result.crossAnalysis.crossReport.model}
                    durationMs={evalStream.state.result.crossAnalysis.crossReport.durationMs}
                    fallback={false}
                    error={evalStream.state.result.crossAnalysis.crossReport.error}
                    ok={evalStream.state.result.crossAnalysis.crossReport.ok}
                    dbSaved={!!evalStream.state.result.crossAnalysis.crossReport.ok}
                    chars={evalStream.state.result.crossAnalysis.crossReport.contentChars}
                    accent="nmr"
                  />
                )}

                <div className="mt-3 flex items-center gap-3 flex-wrap">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                    <Switch checked={evalGenerateReport} onCheckedChange={setEvalGenerateReport} className="scale-90" />
                    {locale === 'zh' ? '生成 LLM 报告' : 'Generate LLM report'}
                  </label>
                  <label className={`flex items-center gap-2 text-xs cursor-pointer ${evalGenerateReport ? 'text-muted-foreground' : 'text-muted-foreground/40 pointer-events-none'}`}>
                    <Switch checked={evalSaveReportFile} onCheckedChange={setEvalSaveReportFile} disabled={!evalGenerateReport} className="scale-90" />
                    {locale === 'zh' ? '保存为 LLM-Wiki 文件' : 'Save to LLM-Wiki file'}
                  </label>
                </div>
                <RunHistoryPanel moduleKey="eval" refreshKey={evalRunCount} limit={5} />
              </ModuleCard>
            </TabsContent>

            {/* ═══ Module ② Daily Literature ═══════════════════════════ */}
            <TabsContent value="literature" className="mt-2">
              <ModuleCard
                icon={<BookOpen className="h-4 w-4" />}
                accent="nmr"
                index="②"
                title={t.moduleLitTitle}
                endpoint="POST /api/literature/daily/run"
                description={locale === 'zh' ? '三通路 PubMed 检索（Path A：MeSH+方法关键词 / Path B：高 IF 期刊+方法关键词 / Path C：方法关键词+MeSH 索引日期前瞻）→ ±N 天窗口 → 方法过滤（冷冻电镜 / X 射线 / NMR / AlphaFold）→ 去重+排序 → 单篇 LLM 摘要 → 可选执行摘要 → 写入 PubMedArticle + daily-reports 索引。' : 'Triple-pathway PubMed search (Path A: MeSH+method keywords / Path B: high-IF journals+method keywords / Path C: method keywords + MeSH-date forward-looking) → ±N day window → method filter (Cryo-EM / X-ray / NMR / AlphaFold) → dedup+sort → per-paper LLM summary → optional executive summary → writes to PubMedArticle + daily-reports index.'}
              >
                <div className="grid grid-cols-2 sm:grid-cols-6 gap-2 mb-3">
                  <Field label={locale === 'zh' ? '日期' : 'Date'}>
                    <Input type="date" value={litDate} onChange={e => setLitDate(e.target.value)} className="h-8 px-2 text-xs md:text-xs font-mono" />
                  </Field>
                  <Field label={locale === 'zh' ? '±天数' : '±Days'}>
                    <Input type="number" min={0} max={7} value={litWindowDays} onChange={e => setLitWindowDays(parseInt(e.target.value || '3'))} className="h-8 px-2 text-xs md:text-xs font-mono" />
                  </Field>
                  <Field label={locale === 'zh' ? 'Path A 上限' : 'Path A Max'}>
                    <Input type="number" min={10} max={1000} value={litMaxPathA} onChange={e => setLitMaxPathA(parseInt(e.target.value || '300'))} className="h-8 px-2 text-xs md:text-xs font-mono" />
                  </Field>
                  <Field label={locale === 'zh' ? 'Path B 上限' : 'Path B Max'}>
                    <Input type="number" min={5} max={200} value={litMaxPathB} onChange={e => setLitMaxPathB(parseInt(e.target.value || '50'))} className="h-8 px-2 text-xs md:text-xs font-mono" />
                  </Field>
                  <Field label={locale === 'zh' ? 'Path C 上限' : 'Path C Max'}>
                    <Input type="number" min={10} max={500} value={litMaxPathC} onChange={e => setLitMaxPathC(parseInt(e.target.value || '200'))} className="h-8 px-2 text-xs md:text-xs font-mono" />
                  </Field>
                  <Field label={locale === 'zh' ? '上限' : 'Max Papers'}>
                    <Input type="number" min={1} max={100} value={litMaxPapers} onChange={e => setLitMaxPapers(parseInt(e.target.value || '20'))} className="h-8 px-2 text-xs md:text-xs font-mono" />
                  </Field>
                </div>

                <div className="flex items-center justify-between gap-2 mb-1">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                    <Switch checked={litSkipWikiFiles} onCheckedChange={setLitSkipWikiFiles} className="scale-90" />
                    {locale === 'zh' ? '仅入库（不生成 LLM-Wiki 文件）' : 'DB only (no LLM-Wiki file)'}
                  </label>
                  <RunButton
                    running={isRunning('lit')}
                    onClick={runLiterature}
                    onCancel={() => litStream.cancel()}
                  />
                </div>

                <StreamFeed
                  events={litStream.state.log}
                  running={litStream.state.running}
                  done={litStream.state.done}
                  ok={litStream.state.ok}
                  emptyHint={locale === 'zh' ? '点击 “执行” 启动 PubMed 三通路检索 + LLM 摘要流水线' : 'Click Run to start PubMed triple-pathway search + LLM summary pipeline'}
                />

                {/* Search path statistics — shows triple-path PubMed hit breakdown */}
                {litStream.state.done && litStream.state.result && (
                  <SearchPathStats
                    pathACount={litStream.state.result.pathACount ?? 0}
                    pathBCount={litStream.state.result.pathBCount ?? 0}
                    pathCCount={litStream.state.result.pathCCount ?? 0}
                    finalCount={litStream.state.result.finalCount ?? 0}
                    totalCandidates={litStream.state.result.totalCandidates ?? 0}
                    methodStats={litStream.state.result.methodStats}
                    durationMs={litStream.state.result.durationMs}
                    pubmedSaved={litStream.state.result.pubmedSaved}
                    locale={locale}
                  />
                )}

                {/* LLM digest inline preview (module ②) — shows real LLM output or failure */}
                {litStream.state.done && litStream.state.result && (
                  <LLMPreview
                    content={litStream.state.result.digest}
                    title={`LLM 每日精选摘要 · ${litStream.state.result.date}`}
                    provider={litStream.state.result.provider}
                    model={litStream.state.result.llmModel || litStream.state.result.model}
                    durationMs={litStream.state.result.llmDurationMs}
                    fallback={litStream.state.result.llmFallback}
                    error={litStream.state.result.llmError}
                    ok={litStream.state.result.llmOk}
                    dbSaved={litStream.state.result.dbSaved}
                    chars={litStream.state.result.digest?.length || 0}
                    accent="nmr"
                  />
                )}

                {litExistingReports.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-border/40">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground mb-1.5 flex items-center gap-1.5">
                      <FileText className="h-3 w-3" /> History ({litExistingReports.length} days)
                      <span className="normal-case tracking-normal text-muted-foreground/60 flex items-center gap-0.5 ml-1" title="Dates with star icon have LLM digest generated">
                        <Sparkles className="h-2.5 w-2.5 text-purple-400" /> = Has LLM digest (click to view)
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                      {litExistingReports.slice(0, 30).map(r => {
                        const isActive = litViewingDigest?.date === r.date;
                        return (
                          <button
                            key={r.date}
                            type="button"
                            onClick={() => viewLitDigest(r.date)}
                            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs border transition-colors ${
                              isActive
                                ? 'border-claude-accent/50 bg-claude-accent/10 text-claude-accent'
                                : 'border-claude-border/60 dark:border-[#3d3832]/60 hover:bg-claude-border-light dark:hover:bg-[#2b2926] text-claude-text-muted dark:text-[#9b9590] hover:text-claude-text dark:hover:text-[#e8e4dd]'
                            }`}
                            title={`${r.date} — ${r.paperCount} papers${r.hasLLMDigest ? ' · has LLM digest' : ''} (click to view digest)`}
                          >
                            <span className="font-mono">{r.date.slice(5)}</span>
                            <span className="opacity-60">{r.paperCount || '?'}</span>
                            {r.hasLLMDigest && <Sparkles className="h-2.5 w-2.5 text-claude-accent" />}
                          </button>
                        );
                      })}
                    </div>
                    {/* Inline digest viewer — shows the fetched LLM digest for the clicked date */}
                    {litViewingDigest && (
                      <div className="mt-2 rounded-lg border border-claude-accent/40 bg-claude-accent/8 overflow-hidden">
                        <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-claude-accent/40 bg-claude-accent/10">
                          <div className="flex items-center gap-1.5">
                            <FileText className="h-3.5 w-3.5 text-claude-accent" />
                            <span className="text-xs font-semibold text-claude-text dark:text-[#e8e4dd]">LLM Digest · {litViewingDigest.date}</span>
                          </div>
                          <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setLitViewingDigest(null)} title="Close">
                            <X className="h-3 w-3" />
                          </Button>
                        </div>
                        <div className="px-3 py-2 max-h-64 overflow-y-auto thin-scroll text-xs leading-relaxed prose prose-sm dark:prose-invert max-w-none">
                          {litViewingDigest.loading ? (
                            <div className="flex items-center gap-2 text-muted-foreground">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading digest…
                            </div>
                          ) : litViewingDigest.error ? (
                            <div className="text-amber-600 dark:text-amber-400 text-xs flex items-start gap-1.5">
                              <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                              <span>{litViewingDigest.error}</span>
                            </div>
                          ) : (
                            <LazyMarkdown>{litViewingDigest.content}</LazyMarkdown>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <RunHistoryPanel moduleKey="literature" refreshKey={litRunCount} limit={5} />
              </ModuleCard>
            </TabsContent>

            {/* ═══ Module ③ PDB Weekly ═════════════════════════════════ */}
            <TabsContent value="weekly" className="mt-2">
              <ModuleCard
                icon={<CalendarClock className="h-4 w-4" />}
                accent="accent"
                index="③"
                title={t.moduleWeeklyTitle}
                endpoint="POST /api/pdb-weekly/run"
                description="web-v3 in-process 2-step adversarial generator: fetch → backfill → PubMed → Generator → Critic-Scientific → (Synthesis) → write DB. Uses the currently selected LLM provider. SSE streaming progress, non-blocking. Estimated 5-15 min."
              >
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                  <div>
                    <Label className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                      <CalendarClock className="h-3 w-3" />{locale === 'zh' ? 'ISO 周' : 'ISO Week'}
                    </Label>
                    <div className="mt-1 flex items-center gap-1">
                      <input
                        type="week"
                        value={weeklyCustomWeek || (weeklyWindow?.weekId || '')}
                        onChange={e => setWeeklyCustomWeek(e.target.value)}
                        className="h-8 px-2 rounded-md border border-border/60 bg-background text-xs font-mono text-foreground flex-1 min-w-0"
                        title="Custom ISO week selection (leave empty for current week)"
                      />
                      {weeklyCustomWeek && (
                        <Button variant="ghost" size="sm" className="h-8 w-8 p-0 shrink-0" onClick={() => setWeeklyCustomWeek('')} title="Reset to current week">
                          <X className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                  <InfoTile label={locale === 'zh' ? '报告日期' : 'Report Date'} value={weeklyCustomWeek ? `${weeklyCustomWeek}-5` : (weeklyWindow?.reportDate || '…')} />
                  <InfoTile label={locale === 'zh' ? '起始' : 'Start'} value={weeklyWindow?.startDate || '…'} />
                  <InfoTile label={locale === 'zh' ? '截止 (RCSB)' : 'End (RCSB)'} value={weeklyWindow?.endDate || '…'} />
                </div>

                {weeklyDbCounts && (
                  <div className="mb-3 flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                    <Database className="h-3 w-3" />
                    <span>{locale === 'zh' ? '本周入库：' : 'In DB this week:'}</span>
                    <code className="px-1.5 py-0.5 rounded bg-muted/60 font-mono">PdbStructure {weeklyDbCounts.pdbStructure}</code>
                    <code className="px-1.5 py-0.5 rounded bg-muted/60 font-mono">WeeklyReport {weeklyDbCounts.weeklyReport}</code>
                    <code className="px-1.5 py-0.5 rounded bg-muted/60 font-mono">WeeklySnapshot {weeklyDbCounts.weeklySnapshot}</code>
                  </div>
                )}

                <div className="flex items-center gap-2 flex-wrap mb-2">
                  <div className="flex items-center gap-1 text-xs">
                    <span className="text-muted-foreground mr-1">{locale === 'zh' ? '周期：' : 'Cycle:'}</span>
                    {([1, 2, 3] as const).map(c => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setWeeklyCycles(c)}
                        className={`h-8 px-2 rounded-md text-xs border transition-all ${
                          weeklyCycles === c
                            ? 'border-primary/50 bg-primary/10 text-foreground font-medium'
                            : 'border-border/60 text-muted-foreground hover:text-foreground hover:border-border'
                        }`}
                        title={c === 1 ? (locale === 'zh' ? '约 5 分钟' : '~5 min') : c === 2 ? (locale === 'zh' ? '约 10 分钟' : '~10 min') : (locale === 'zh' ? '约 15 分钟' : '~15 min')}
                      >
                        {c}
                        <span className="opacity-50 ml-1 hidden sm:inline">
                          {c === 1 ? (locale === 'zh' ? '(单步)' : '(single)') : c === 2 ? (locale === 'zh' ? '(生成+评审)' : '(Gen+Critic)') : (locale === 'zh' ? '(完整)' : '(full)')}
                        </span>
                      </button>
                    ))}
                  </div>

                  <RunButton
                    running={isRunning('weekly')}
                    onClick={() => runWeekly(weeklyCycles)}
                    onCancel={() => weeklyStream.cancel()}
                    label={isRunning('weekly') ? (locale === 'zh' ? '运行中…' : 'Running…') : (locale === 'zh' ? '立即执行' : 'Run Now')}
                  />

                  <span className="text-xs text-muted-foreground ml-auto flex items-center gap-1">
                    <Cpu className="h-3 w-3" />
                    {locale === 'zh' ? 'LLM →' : 'LLM →'} <code className="px-1 py-0.5 rounded bg-muted/60 font-mono">{effectiveProviderId || 'auto'}</code>
                  </span>
                </div>

                {/* Cycle timeline — visualises the Generator → Critic → Synthesis orchestration */}
                <CycleTimeline
                  events={weeklyStream.state.log}
                  maxCycles={weeklyCycles}
                  running={isRunning('weekly')}
                  result={weeklyStream.state.result}
                />

                <StreamFeed
                  events={weeklyStream.state.log}
                  running={weeklyStream.state.running}
                  done={weeklyStream.state.done}
                  ok={weeklyStream.state.ok}
                  emptyHint={locale === 'zh' ? '选择周期数并点击 “立即执行” 启动对抗式周报生成器' : 'Select cycles and click Run Now to start the adversarial weekly report generator'}
                />
                <RunHistoryPanel moduleKey="weekly" refreshKey={weeklyRunCount} limit={5} />
              </ModuleCard>
              </TabsContent>
            </div>
          </Tabs>

          {/* ── Execution log (shared) ─────────────────────────────────── */}
          <AnimatePresence>
            {logs.length > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-4"
              >
                <div className="rounded-lg border border-border/60 bg-muted/20 overflow-hidden">
                  {/* header with filter pills + search */}
                  <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border/60 bg-muted/40 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Activity className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-xs font-semibold">{t.execLog}</span>
                      <Badge variant="outline" className="text-xs font-medium px-2 h-5 gap-1 rounded-md shrink-0 border-border/60 bg-muted/40 text-muted-foreground">
                        {logFilter === 'all' ? logs.length : logs.filter(l => l.module === logFilter).length}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {/* module filter pills */}
                      <div className="flex items-center gap-0.5 rounded-md bg-background/60 border border-border/40 p-0.5">
                        {([
                          { k: 'all', label: 'All' },
                          { k: 'literature', label: '①' },
                          { k: 'eval', label: '②' },
                          { k: 'weekly', label: '③' },
                        ] as const).map(f => (
                          <button
                            key={f.k}
                            type="button"
                            onClick={() => setLogFilter(f.k)}
                            className={`px-1.5 py-0.5 rounded text-xs font-medium transition-colors ${
                              logFilter === f.k ? 'bg-primary/10 text-foreground' : 'text-muted-foreground hover:text-foreground'
                            }`}
                            title={f.k === 'all' ? t.execLogFilterAll : f.k === 'literature' ? t.tabLit : f.k === 'eval' ? t.tabEval : t.tabWeekly}
                          >
                            {f.label}
                          </button>
                        ))}
                      </div>
                      {/* search box */}
                      <div className="flex items-center h-6 rounded-md border border-border/40 bg-background/60 px-1.5 gap-1">
                        <Search className="h-2.5 w-2.5 text-muted-foreground/60" />
                        <input
                          type="text"
                          value={logSearch}
                          onChange={e => setLogSearch(e.target.value)}
                          placeholder={t.execLogSearch}
                          className="w-16 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50"
                        />
                      </div>
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => exportLogs('md')} title={locale === 'zh' ? '导出 Markdown' : 'Export Markdown'} disabled={logs.length === 0}>
                        <FileDown className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => exportLogs('json')} title={locale === 'zh' ? '导出 JSON' : 'Export JSON'} disabled={logs.length === 0}>
                        <Download className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground px-2" onClick={() => setLogs([])}>
                        {t.execLogClear}
                      </Button>
                    </div>
                  </div>
                  <div className="max-h-72 overflow-y-auto thin-scroll">
                    <div className="px-3 py-2 space-y-2">
                      {logs
                        .filter(l => logFilter === 'all' || l.module === logFilter)
                        .filter(l => !logSearch || l.summary.toLowerCase().includes(logSearch.toLowerCase()) || (l.details || '').toLowerCase().includes(logSearch.toLowerCase()))
                        .map((l, i) => {
                          const moduleBadge = l.module === 'literature'
                            ? { txt: '② Lit', cls: 'border-claude-accent/40 text-claude-accent bg-claude-accent/10' }
                            : l.module === 'eval'
                            ? { txt: '① Eval', cls: 'border-claude-accent/40 text-claude-accent bg-claude-accent/10' }
                            : { txt: '③ Weekly', cls: 'border-claude-accent/40 text-claude-accent bg-claude-accent/10' };
                          return (
                            <div
                              key={i}
                              className="text-xs border-l-2 pl-2.5 py-1"
                              style={{
                                borderColor: l.status === 'success' ? '#10b981' : l.status === 'error' ? '#ef4444' : 'var(--claude-accent)',
                              }}
                            >
                              <div className="flex items-center gap-1.5">
                                {l.status === 'success' && <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500 shrink-0" />}
                                {l.status === 'error' && <XCircle className="h-3 w-3 text-red-500 shrink-0" />}
                                {l.status === 'running' && <Loader2 className="h-3 w-3 animate-spin text-claude-accent shrink-0" />}
                                <span className="text-muted-foreground font-mono text-xs shrink-0">{l.ts.slice(11, 19)}</span>
                                <Badge variant="outline" className={`text-xs font-medium px-2 h-5 gap-1 rounded-md shrink-0 ${moduleBadge.cls}`}>{moduleBadge.txt}</Badge>
                                <span className="font-medium flex-1 leading-tight">{l.summary}</span>
                                {l.durationMs != null && <span className="text-muted-foreground text-xs shrink-0">{Math.round(l.durationMs / 100) / 10}s</span>}
                              </div>
                              {l.details && (
                                <pre className="mt-1 text-xs whitespace-pre-wrap text-muted-foreground max-h-32 overflow-y-auto font-mono leading-relaxed">
                                  {l.details}
                                </pre>
                              )}
                            </div>
                          );
                        })}
                      {logs.filter(l => logFilter === 'all' || l.module === logFilter).filter(l => !logSearch || l.summary.toLowerCase().includes(logSearch.toLowerCase()) || (l.details || '').toLowerCase().includes(logSearch.toLowerCase())).length === 0 && (
                        <div className="text-xs text-muted-foreground/60 text-center py-3">{locale === 'zh' ? '没有匹配的日志' : 'No matching logs'}</div>
                      )}
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

      </DialogContent>
    </Dialog>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */
/*  Module card wrapper with gradient accent                                 */
/* ──────────────────────────────────────────────────────────────────────── */

// Claude-themed accent tokens.
// IMPORTANT: All module cards/tabs now use the SAME theme accent (`claude-accent`)
// to avoid color collisions when the user switches themes. The 6 preset themes
// map their accent to: claude(#c96442), ocean(#2d8f8f=claude-cryoem!),
// forest(#16a34a=claude-mid!), sunset(#ea580c=claude-high!), berry(#7c5cbf=claude-xray!),
// rose(#e11d48≈claude-top). So if we used cryoem/xray/nmr for different modules,
// 4 of 6 themes would produce exact color duplicates.
// Modules are distinguished by ICON + NUMBER (①②③), not by color.
// Status colors (success/error/warn) use standard Tailwind colors that are
// guaranteed distinct from ALL 6 theme accents.
const ACCENT_CLASSES: Record<string, { ring: string; chip: string; icon: string; glow: string; shadow: string }> = {
  accent: {
    ring: 'before:from-claude-accent/70',
    chip: 'bg-claude-accent-light text-claude-accent border-claude-accent/30',
    icon: 'bg-gradient-to-br from-claude-accent/20 to-claude-accent/5 text-claude-accent',
    glow: 'from-claude-accent/8',
    shadow: 'claude-card-shadow',
  },
  // Legacy aliases — ALL map to accent now (no per-module color distinction)
  cryoem: {
    ring: 'before:from-claude-accent/70',
    chip: 'bg-claude-accent-light text-claude-accent border-claude-accent/30',
    icon: 'bg-gradient-to-br from-claude-accent/20 to-claude-accent/5 text-claude-accent',
    glow: 'from-claude-accent/8',
    shadow: 'claude-card-shadow',
  },
  nmr: {
    ring: 'before:from-claude-accent/70',
    chip: 'bg-claude-accent-light text-claude-accent border-claude-accent/30',
    icon: 'bg-gradient-to-br from-claude-accent/20 to-claude-accent/5 text-claude-accent',
    glow: 'from-claude-accent/8',
    shadow: 'claude-card-shadow',
  },
  xray: {
    ring: 'before:from-claude-accent/70',
    chip: 'bg-claude-accent-light text-claude-accent border-claude-accent/30',
    icon: 'bg-gradient-to-br from-claude-accent/20 to-claude-accent/5 text-claude-accent',
    glow: 'from-claude-accent/8',
    shadow: 'claude-card-shadow',
  },
  sky: {
    ring: 'before:from-claude-accent/70',
    chip: 'bg-claude-accent-light text-claude-accent border-claude-accent/30',
    icon: 'bg-gradient-to-br from-claude-accent/20 to-claude-accent/5 text-claude-accent',
    glow: 'from-claude-accent/8',
    shadow: 'claude-card-shadow',
  },
  emerald: {
    ring: 'before:from-claude-accent/70',
    chip: 'bg-claude-accent-light text-claude-accent border-claude-accent/30',
    icon: 'bg-gradient-to-br from-claude-accent/20 to-claude-accent/5 text-claude-accent',
    glow: 'from-claude-accent/8',
    shadow: 'claude-card-shadow',
  },
  amber: {
    ring: 'before:from-claude-accent/70',
    chip: 'bg-claude-accent-light text-claude-accent border-claude-accent/30',
    icon: 'bg-gradient-to-br from-claude-accent/20 to-claude-accent/5 text-claude-accent',
    glow: 'from-claude-accent/8',
    shadow: 'claude-card-shadow',
  },
  violet: {
    ring: 'before:from-claude-accent/70',
    chip: 'bg-claude-accent-light text-claude-accent border-claude-accent/30',
    icon: 'bg-gradient-to-br from-claude-accent/20 to-claude-accent/5 text-claude-accent',
    glow: 'from-claude-accent/8',
    shadow: 'claude-card-shadow',
  },
};

function ModuleCard({
  icon,
  accent,
  index,
  title,
  endpoint,
  description,
  children,
  headerBadge,
}: {
  icon: React.ReactNode;
  accent: keyof typeof ACCENT_CLASSES;
  index: string;
  title: string;
  endpoint: string;
  description: string;
  children: React.ReactNode;
  headerBadge?: React.ReactNode;
}) {
  const a = ACCENT_CLASSES[accent] || ACCENT_CLASSES.cryoem;
  return (
    <div
      className={`group relative rounded-xl border border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] ${a.shadow} overflow-hidden transition-all duration-200 hover:border-claude-accent/30 hover:-translate-y-px before:absolute before:left-0 before:top-0 before:bottom-0 before:w-[3px] before:bg-gradient-to-b ${a.ring} before:to-transparent`}
    >
      {/* Subtle accent glow in the top-right corner */}
      <div className={`absolute inset-0 bg-gradient-to-br ${a.glow} via-transparent to-transparent pointer-events-none opacity-60`} />
      {/* Top hairline accent bar (animates on hover) */}
      <div className={`absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r ${a.ring.replace('before:from-', 'from-')} to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none`} />
      <div className="relative p-4">
        <div className="flex items-start gap-3 mb-3">
          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-claude-border/60 dark:border-[#3d3832]/60 ${a.icon} transition-transform duration-200 group-hover:scale-105`}>
            {icon}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold leading-tight text-claude-text dark:text-[#e8e4dd]">
                <span className="text-claude-text-muted/60 mr-1 font-mono">{index}</span>
                {title}
              </h3>
              {headerBadge}
            </div>
            <code className="text-[11px] text-claude-text-muted dark:text-[#9b9590] font-mono">{endpoint}</code>
          </div>
        </div>
        <p className="text-xs text-claude-text-secondary dark:text-[#9b9590] leading-relaxed mb-3">{description}</p>
        <Separator className="mb-3 bg-claude-border/40 dark:bg-[#3d3832]/40" />
        {children}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */
/*  Small field/tile/button primitives                                       */
/* ──────────────────────────────────────────────────────────────────────── */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</Label>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function InfoTile({ label, value, icon }: { label: string; value: string; icon?: React.ReactNode }) {
  return (
    <div>
      <Label className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1">
        {icon}{label}
      </Label>
      <div className="mt-1 h-8 px-2 rounded-md border border-border/60 bg-background flex items-center font-mono text-xs text-foreground truncate">
        {value}
      </div>
    </div>
  );
}

function RunButton({
  running,
  disabled,
  onClick,
  onCancel,
  label = 'Run',
}: {
  running: boolean;
  disabled?: boolean;
  onClick: () => void;
  onCancel?: () => void;
  label?: string;
}) {
  const { locale } = useI18n();
  return (
    <div className="flex items-center gap-1.5">
      <Button
        onClick={onClick}
        disabled={disabled}
        size="sm"
        className="h-8 text-xs gap-1.5 min-w-[88px] bg-gradient-to-br from-claude-accent to-claude-accent-hover hover:from-claude-accent-hover hover:to-claude-accent text-white border-0 shadow-sm hover:shadow-md transition-all"
      >
        {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
        {running ? (locale === 'zh' ? '运行中…' : 'Running…') : (label === 'Run' ? (locale === 'zh' ? '执行' : 'Run') : label)}
      </Button>
      {running && onCancel && (
        <Button
          onClick={onCancel}
          variant="outline"
          size="sm"
          className="h-8 text-xs gap-1 border-claude-top/40 text-claude-top hover:bg-claude-top-bg dark:border-claude-top/50 dark:text-claude-top"
          title={locale === 'zh' ? '停止当前任务（后端可能需要几秒钟才能真正停止）' : 'Stop current task (backend may take a few seconds to actually stop)'}
        >
          <XCircle className="h-3.5 w-3.5" /> {locale === 'zh' ? '停止' : 'Stop'}
        </Button>
      )}
    </div>
  );
}

function ToggleChip({
  checked,
  onCheckedChange,
  label,
  disabled,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className={`flex items-center gap-1.5 text-xs text-muted-foreground pb-1.5 ${disabled ? 'opacity-40 pointer-events-none' : 'cursor-pointer'}`}>
      <Switch checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} className="scale-90" />
      <span className="font-mono text-sm">{label}</span>
    </label>
  );
}
