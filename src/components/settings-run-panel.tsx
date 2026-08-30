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
 *   • R180: shared LLM settings — one small button entry (SharedLlmButton) that
 *     manages the SAME provider/model store the Agent chat uses (.hermes);
 *     classic and DSH evaluation both consume it (server-side resolution)
 *   • Framer Motion micro-interactions for state transitions
 *
 * The three modules mirror the original backend contracts:
 *   ① POST /api/literature/daily/run  — Structure-Biology Daily Literature Report
 *   ② POST /api/evaluations/run       — Target Evaluation + LLM Report (atomic)
 *     ②' POST /api/evaluations/run-dsh — DSH question-driven evaluation (R179)
 *   ③ POST /api/pdb-weekly/run        — Manual PDB Weekly Report (SSE, 1–3 cycles)
 *
 * R180: the LLM provider/model is resolved SERVER-SIDE from the shared
 * Agent-chat settings — the client no longer sends a localStorage `llm` body.
 */

import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
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
// R180: shared LLM settings entry (same store as the Agent chat)
import { SharedLlmButton } from '@/components/agent/SharedLlmButton';
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
  Code,
  Columns2,
  // R179 (Task 2-b): DSH 模式 — relevance / outline / figure card icons
  ScanSearch,
  ListTree,
  Lightbulb,
  Info,
  Image as ImageIcon,
  // R182: emoji → Lucide（结构分析摘要卡 / 周报对比 / 互作统计）
  Microscope,
  Handshake,
  Droplets,
  Snowflake,
  Ruler,
} from 'lucide-react';
import { toast } from 'sonner';
import { DbSetupWizard, type DbStatus } from '@/components/db-setup-wizard';
import { SearchPathStats } from '@/components/search-path-stats';

/* ──────────────────────────────────────────────────────────────────────── */
/*  Types                                                                    */
/* ──────────────────────────────────────────────────────────────────────── */

interface RunLog {
  ts: string;
  module: 'literature' | 'eval' | 'weekly';
  status: 'running' | 'success' | 'error';
  summary: string;
  details?: string;
  durationMs?: number;
}

/* ──────────────────────────────────────────────────────────────────────── */
/*  R179 (Task 2-b): DSH 模式（问题驱动智能体）SSE 载荷类型                     */
/*  Aligned with the /api/evaluations/run-dsh contract — progress events    */
/*  carry `dshRelevance` / `dshOutline` / `dshFigure` extras that the       */
/*  useRunStream hook forwards into state.log entries.                      */
/* ──────────────────────────────────────────────────────────────────────── */

interface DshRelevanceFinding {
  source: 'uniprot' | 'rcsb' | 'blast' | 'literature' | 'scores';
  relevance: 'high' | 'medium' | 'low';
  note: string;
}

interface DshRelevancePayload {
  questionRestated: string;
  findings: DshRelevanceFinding[];
  keyInsights: string[];
  dataGaps: string[];
}

interface DshOutlineSection {
  id: string;
  title: string;
  focus: string;
}

interface DshOutlinePayload {
  sections: DshOutlineSection[];
  total: number;
}

interface DshFigurePayload {
  kind: 'rcsb' | 'web';
  url: string;
  caption: string;
  pdbId?: string;
  source?: string;
  sectionId: string;
  status: 'searching' | 'verified' | 'rejected' | 'failed';
  vlmReason?: string;
}

/** Extract + narrow a `dshRelevance` extra from a stream event (null-safe). */
function asDshRelevance(v: unknown): DshRelevancePayload | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Partial<DshRelevancePayload>;
  if (typeof o.questionRestated !== 'string' || !Array.isArray(o.findings)) return null;
  return {
    questionRestated: o.questionRestated,
    findings: o.findings.filter((f) => f && typeof f.note === 'string'),
    keyInsights: Array.isArray(o.keyInsights) ? o.keyInsights.filter((k) => typeof k === 'string') : [],
    dataGaps: Array.isArray(o.dataGaps) ? o.dataGaps.filter((g) => typeof g === 'string') : [],
  };
}

/** Extract + narrow a `dshOutline` extra from a stream event (null-safe). */
function asDshOutline(v: unknown): DshOutlinePayload | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Partial<DshOutlinePayload>;
  if (!Array.isArray(o.sections)) return null;
  return {
    sections: o.sections.filter((s) => s && typeof s.id === 'string' && typeof s.title === 'string'),
    total: typeof o.total === 'number' ? o.total : o.sections.length,
  };
}

/** Extract + narrow a `dshFigure` extra from a stream event (null-safe). */
function asDshFigure(v: unknown): DshFigurePayload | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Partial<DshFigurePayload>;
  if (typeof o.url !== 'string' || typeof o.caption !== 'string') return null;
  return {
    kind: o.kind === 'web' ? 'web' : 'rcsb',
    url: o.url,
    caption: o.caption,
    pdbId: typeof o.pdbId === 'string' ? o.pdbId : undefined,
    source: typeof o.source === 'string' ? o.source : undefined,
    sectionId: typeof o.sectionId === 'string' ? o.sectionId : '',
    status: o.status === 'verified' || o.status === 'rejected' || o.status === 'failed' || o.status === 'searching'
      ? o.status
      : 'searching',
    vlmReason: typeof o.vlmReason === 'string' ? o.vlmReason : undefined,
  };
}

/* ──────────────────────────────────────────────────────────────────────── */
/*  Small presentational helpers                                             */
/* ──────────────────────────────────────────────────────────────────────── */

/** R182: 客户端 Blob 导出下载 — 原先在 3 个导出按钮 + exportLogs 里重复 4 份。 */
function downloadBlob(content: string, mime: string, filename: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

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
  const { locale } = useI18n();
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
            title={autoScroll ? (locale === 'zh' ? '自动滚动中，点击暂停' : 'Auto-scrolling, click to pause') : (locale === 'zh' ? '已暂停，点击恢复' : 'Paused, click to resume')}
          >
            {autoScroll ? (locale === 'zh' ? '自动' : 'auto') : (locale === 'zh' ? '暂停' : 'paused')}
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
              <span className={`text-xs font-mono font-semibold tabular-nums inline-flex items-center gap-1 ${ok ? 'text-emerald-500 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                {ok ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />} {(elapsed / 1000).toFixed(1)}s
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
 * R179 (Task 2-b): bilingual display labels for DSH-mode stages (and the
 * shared `chapter` / `chapter_done` milestones). Unknown stages fall through
 * unchanged — the timeline stays forward-compatible for future pipelines.
 */
function dshStageLabel(stage: string, locale: string): string {
  const zh = locale === 'zh';
  switch (stage) {
    case 'relevance': return zh ? '相关性分析' : 'Relevance';
    case 'outline': return zh ? '大纲规划' : 'Outline';
    case 'figure-rcsb': return zh ? '配图·RCSB' : 'Figures·RCSB';
    case 'figure-web': return zh ? '配图·Web' : 'Figures·Web';
    case 'figures': return zh ? '配图检索' : 'Figures';
    case 'assemble': return zh ? '报告组装' : 'Assemble';
    case 'write-db': return zh ? '写入数据库' : 'Write DB';
    case 'chapter': return zh ? '章节' : 'Chapters';
    case 'chapter_done': return zh ? '章节完成' : 'Chapters done';
    default: return stage;
  }
}

/**
 * StageTimeline — a horizontal strip of milestone "chips" derived from the SSE
 * event stream. Collapses repeated stages (e.g. multiple `llm-digest` events)
 * into a single chip, colour-coding by the latest level seen for that stage.
 */
function StageTimeline({ events }: { events: StreamEvent[] }) {
  const { locale } = useI18n();
  // Build an ordered list of unique stages with their latest level + progress.
  // R179 (Task 2-b): no stage whitelist here — unknown stages render as plain
  // chips (forward-compatible). DSH-specific stages get bilingual display
  // labels via dshStageLabel(), and DSH per-chapter stages (`chapter-<id>`, one
  // per outline section) collapse into a single `chapter` chip so a 9-chapter
  // DSH run doesn't spam 9 near-identical chips (mirrors classic, whose running
  // events all use the literal stage `chapter`).
  const stageMap = new Map<string, { level?: string; progress?: number; count: number }>();
  const order: string[] = [];
  for (const e of events) {
    const rawStage = e.stage || e.level || 'info';
    const stage = /^chapter-.+/.test(rawStage) ? 'chapter' : rawStage;
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
                <span className="text-3xs font-mono text-claude-text-muted dark:text-[#9b9590] whitespace-nowrap">{dshStageLabel(stage, locale)}</span>
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
  figures,
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
  /** R179 (Task 2-b): DSH 模式 — 最终配图画廊（done 后渲染于 Markdown 正文之下）。 */
  figures?: DshFigurePayload[];
}) {
  const [expanded, setExpanded] = useState(true);
  const [copied, setCopied] = useState(false);
  const { locale, t } = useI18n();

  // Failure case: no content but we have an error — show a failure card.
  const isFailure = ok === false || (fallback && !content);

  // Claude-themed accent — ALL variants use the theme accent to avoid color
  // collisions across the 6 preset themes (R182: collapsed the former 8-key
  // accentMap whose values were all identical). Status badges use standard
  // Tailwind colors.
  const ACCENT = {
    ring: 'border-claude-accent/40',
    bg: 'from-claude-accent/8',
    icon: 'text-claude-accent',
    badge: 'border-claude-accent/40 text-claude-accent bg-claude-accent-light',
  };
  const a = ACCENT;
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
            {/* R179 (Task 2-b): DSH 模式 — done 后的最终配图画廊（正文下方），
                每张卡：缩略图 + 说明 + 来源/类型行。rejected 配图降透明度。
                R182: 缩略卡抽取为 DshFigureThumb（与 DshFiguresStrip 共用）。 */}
            {figures && figures.length > 0 && (
              <div className="px-3 py-2 border-t border-claude-border/40 dark:border-[#3d3832]/40">
                <div className="flex items-center gap-1.5 mb-2">
                  <ImageIcon className="h-3 w-3 text-claude-cryoem shrink-0" />
                  <span className="text-3xs font-semibold uppercase tracking-wider text-claude-text-muted dark:text-[#9b9590]">{t.evalDshFigures}</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {figures.map((f, i) => (
                    <DshFigureThumb key={`${f.url}-${i}`} figure={f} labels={{ searching: t.evalDshFigureSearching, verified: t.evalDshFigureVerified, rejected: t.evalDshFigureRejected }} />
                  ))}
                </div>
              </div>
            )}
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
      <div className="px-3 py-2 flex items-center gap-2 text-xs text-claude-text-muted/70 dark:text-[#9b9590]/70 border-t border-claude-border/40 dark:border-[#3d3832]/40 bg-claude-bg/30 dark:bg-[#1a1917]/30">
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
    <div className="px-3 py-2 border-t border-claude-border/40 dark:border-[#3d3832]/40 bg-claude-bg/30 dark:bg-[#1a1917]/30">
      <div className="flex items-center gap-2 mb-1.5">
        <History className="h-3 w-3 text-claude-text-muted/70 dark:text-[#9b9590]/70" />
        <span className="text-xs font-semibold uppercase tracking-wider text-claude-text-muted/70 dark:text-[#9b9590]/70">
          Recent {rows.length} runs
        </span>
      </div>
      <div className="space-y-0.5">
        {rows.map((r) => {
          const isOk = r.status === 'success';
          const isErr = r.status === 'error';
          const isOpen = expandedId === r.id;
          return (
            <div key={r.id} className="border border-claude-border/40 dark:border-[#3d3832]/40 rounded-md bg-claude-surface/40 dark:bg-[#242220]/40 overflow-hidden">
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
                className="w-full px-2 py-1 flex items-center gap-2 text-left hover:bg-claude-bg/60 dark:hover:bg-[#1a1917]/60 transition-colors"
              >
                {isOk ? (
                  <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500 shrink-0" />
                ) : isErr ? (
                  <XCircle className="h-3 w-3 text-rose-500 shrink-0" />
                ) : (
                  <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
                )}
                <span className="text-xs font-mono text-claude-text-muted dark:text-[#9b9590] shrink-0">{fmtTime(r.createdAt)}</span>
                <span className="text-xs truncate flex-1 text-claude-text/90 dark:text-[#e8e4dd]/90" title={r.summary}>{r.summary}</span>
                {r.provider && (
                  <span className="text-3xs font-mono text-claude-text-muted/70 dark:text-[#9b9590]/70 shrink-0 hidden sm:inline truncate max-w-[100px]" title={`${r.provider}/${r.model}`}>
                    {r.provider}/{r.model}
                  </span>
                )}
                <span className="text-3xs text-claude-text-muted/60 dark:text-[#9b9590]/60 font-mono shrink-0">{fmtDur(r.durationMs)}</span>
                {(r.logBytes ?? 0) > 0 && (
                  <span className="text-3xs font-mono text-claude-text-muted/60 dark:text-[#9b9590]/60 shrink-0 hidden sm:inline" title="SSE log size in bytes">
                    log {(r.logBytes! / 1024).toFixed(1)}KB
                  </span>
                )}
                <ChevronRight className={`h-3 w-3 text-claude-text-muted/60 dark:text-[#9b9590]/60 transition-transform shrink-0 ${isOpen ? 'rotate-90' : ''}`} />
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
                    <div className="px-2 pb-2 pt-1 space-y-1 border-t border-claude-border/30 dark:border-[#3d3832]/30">
                      {r.llmError && (
                        <div className="rounded border border-rose-500/30 bg-rose-500/5 px-2 py-1 text-xs font-mono text-rose-600 dark:text-rose-300 break-all">
                          {r.llmError}
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-1 text-xs">
                        <div className="text-claude-text-muted/70 dark:text-[#9b9590]/70">status: <span className="font-mono">{r.status}</span></div>
                        <div className="text-claude-text-muted/70 dark:text-[#9b9590]/70">provider: <span className="font-mono">{r.provider || '—'}</span></div>
                        <div className="text-claude-text-muted/70 dark:text-[#9b9590]/70">model: <span className="font-mono">{r.model || '—'}</span></div>
                        <div className="text-claude-text-muted/70 dark:text-[#9b9590]/70">llmOk: <span className="font-mono">{r.llmOk === true ? 'true' : r.llmOk === false ? 'false' : '—'}</span></div>
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
                            <pre className="max-h-60 overflow-y-auto rounded border border-claude-border/40 dark:border-[#3d3832]/40 bg-claude-bg/40 dark:bg-[#1a1917]/40 p-1.5 text-3xs font-mono leading-snug text-claude-text-muted/80 dark:text-[#9b9590]/80 whitespace-pre-wrap break-all">
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
 * Round 43/44: AnalysisSummaryCard — displays the structural analysis results
 * from the 'structure-analysis-summary' SSE event as a compact card.
 * Shows binding pocket, interactions, H-bonds, druggability, and virtual
 * screening results in a visually organized format.
 * Round 44: Also displays batch target summaries (batch-N-structure-analysis-summary).
 */
function AnalysisSummaryCard({ events, locale }: { events: StreamEvent[]; locale: 'zh' | 'en' }) {
  // Find all structure-analysis-summary events (primary + batch targets)
  const allSummaries = events.filter(
    (e) => (e.stage === 'structure-analysis-summary' || (e.stage as string)?.startsWith('batch-') && (e.stage as string).endsWith('-structure-analysis-summary')) && e.analysisSummary
  );

  if (allSummaries.length === 0) return null;

  const zh = locale === 'zh';

  return (
    <div className="mt-2 space-y-2">
      {allSummaries.map((summaryEvent, idx) => {
        const s = summaryEvent.analysisSummary as any;
        const isBatch = (summaryEvent.stage as string)?.startsWith('batch-');
        const targetLabel = isBatch && summaryEvent.targetUniprot
          ? `[Target ${(summaryEvent.targetIndex as number) + 1}] ${summaryEvent.targetUniprot}`
          : null;

        return (
          <div key={idx} className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
            <div className="flex items-center gap-2 mb-2">
              <Microscope className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                {zh ? '结构分析摘要' : 'Structure Analysis Summary'}
              </span>
              {targetLabel && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-mono">
                  {targetLabel}
                </span>
              )}
              <span className="text-[10px] text-muted-foreground ml-auto">
                PDB: <span className="font-mono font-semibold">{s.pdbId}</span>
              </span>
              {/* Round 45/46/47: Export buttons (JSON + CSV + Markdown) — R182 共用 downloadBlob */}
              <button
                onClick={() => {
                  const json = JSON.stringify(s, null, 2);
                  downloadBlob(json, 'application/json', `analysis-summary-${s.pdbId}-${Date.now()}.json`);
                }}
                className="grid h-5 w-5 place-items-center rounded text-emerald-600/60 hover:text-emerald-600 hover:bg-emerald-500/10 transition-colors"
                title={zh ? '导出为 JSON' : 'Export as JSON'}
              >
                <Download className="h-3 w-3" />
              </button>
              {/* Round 46: CSV export */}
              <button
                onClick={() => {
                  const rows: string[] = [];
                  rows.push('Category,Metric,Value');
                  if (s.bindingPocket) {
                    rows.push(`Binding Pocket,Ligand,${s.bindingPocket.ligand}`);
                    rows.push(`Binding Pocket,Residue Count,${s.bindingPocket.residueCount}`);
                    rows.push(`Binding Pocket,Volume (Å³),${s.bindingPocket.volume}`);
                  }
                  if (s.allInteractions) {
                    rows.push(`Interactions,Chains,${s.allInteractions.chains}`);
                    rows.push(`Interactions,Total,${s.allInteractions.total}`);
                    rows.push(`Interactions,H-bonds,${s.allInteractions.hbonds}`);
                    rows.push(`Interactions,Salt Bridges,${s.allInteractions.saltBridges}`);
                    rows.push(`Interactions,Hydrophobic,${s.allInteractions.hydrophobic}`);
                  }
                  if (s.hbonds) {
                    rows.push(`Intra-chain H-bonds,Total,${s.hbonds.total}`);
                  }
                  if (s.druggability) {
                    rows.push(`Druggability,Score,${s.druggability.score}/10`);
                    rows.push(`Druggability,Category,${s.druggability.category}`);
                  }
                  if (s.virtualScreening) {
                    rows.push(`Virtual Screening,Fragments Screened,${s.virtualScreening.fragmentsScreened}`);
                    rows.push(`Virtual Screening,Top Hit,${s.virtualScreening.topHit || '—'}`);
                    rows.push(`Virtual Screening,Best Ki (μM),${s.virtualScreening.bestKi_uM}`);
                  }
                  rows.push(`PDB,ID,${s.pdbId}`);
                  const csv = rows.join('\n');
                  downloadBlob(csv, 'text/csv', `analysis-summary-${s.pdbId}-${Date.now()}.csv`);
                }}
                className="grid h-5 w-5 place-items-center rounded text-emerald-600/60 hover:text-emerald-600 hover:bg-emerald-500/10 transition-colors"
                title={zh ? '导出为 CSV' : 'Export as CSV'}
              >
                <FileText className="h-3 w-3" />
              </button>
              {/* Round 47: Markdown export */}
              <button
                onClick={() => {
                  const lines: string[] = [];
                  lines.push(`# 结构分析摘要 — PDB ${s.pdbId}`);
                  lines.push('');
                  lines.push(`> 生成时间: ${new Date().toLocaleString()}`);
                  lines.push('');
                  if (s.bindingPocket) {
                    lines.push('## 结合口袋 (Binding Pocket)');
                    lines.push('');
                    lines.push('| 属性 | 值 |');
                    lines.push('|------|------|');
                    lines.push(`| 配体 | ${s.bindingPocket.ligand} |`);
                    lines.push(`| 残基数 | ${s.bindingPocket.residueCount} |`);
                    lines.push(`| 体积 (Å³) | ${s.bindingPocket.volume} |`);
                    lines.push('');
                  }
                  if (s.allInteractions) {
                    lines.push('## 链间互作 (Interactions)');
                    lines.push('');
                    lines.push('| 属性 | 值 |');
                    lines.push('|------|------|');
                    lines.push(`| 链 | ${s.allInteractions.chains} |`);
                    lines.push(`| 总互作数 | ${s.allInteractions.total} |`);
                    lines.push(`| 氢键 | ${s.allInteractions.hbonds} |`);
                    lines.push(`| 盐桥 | ${s.allInteractions.saltBridges} |`);
                    lines.push(`| 疏水接触 | ${s.allInteractions.hydrophobic} |`);
                    lines.push('');
                  }
                  if (s.hbonds) {
                    lines.push('## 链内氢键 (Intra-chain H-bonds)');
                    lines.push('');
                    lines.push(`- 总数: **${s.hbonds.total}**`);
                    lines.push('');
                  }
                  if (s.druggability) {
                    lines.push('## 可成药性 (Druggability)');
                    lines.push('');
                    lines.push('| 属性 | 值 |');
                    lines.push('|------|------|');
                    lines.push(`| 评分 | ${s.druggability.score}/10 |`);
                    lines.push(`| 分类 | ${s.druggability.category} |`);
                    lines.push('');
                  }
                  if (s.virtualScreening) {
                    lines.push('## 虚拟筛选 (Virtual Screening)');
                    lines.push('');
                    lines.push('| 属性 | 值 |');
                    lines.push('|------|------|');
                    lines.push(`| 筛选片段数 | ${s.virtualScreening.fragmentsScreened} |`);
                    lines.push(`| 最佳命中 | ${s.virtualScreening.topHit || '—'} |`);
                    lines.push(`| 最佳 Ki (μM) | ${s.virtualScreening.bestKi_uM} |`);
                    lines.push('');
                  }
                  const md = lines.join('\n');
                  downloadBlob(md, 'text/markdown', `analysis-summary-${s.pdbId}-${Date.now()}.md`);
                }}
                className="grid h-5 w-5 place-items-center rounded text-emerald-600/60 hover:text-emerald-600 hover:bg-emerald-500/10 transition-colors"
                title={zh ? '导出为 Markdown' : 'Export as Markdown'}
              >
                <Code className="h-3 w-3" />
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {s.bindingPocket && (
                <div className="rounded-md bg-background/60 p-2 border border-border/40">
                  <div className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">
                    {zh ? '结合口袋' : 'Binding Pocket'}
                  </div>
                  <div className="text-sm font-bold text-foreground">{s.bindingPocket.residueCount}</div>
                  <div className="text-[9px] text-muted-foreground">
                    {zh ? '残基' : 'residues'} · {s.bindingPocket.volume} Å³
                  </div>
                  <div className="text-[8px] text-muted-foreground/60 mt-0.5">
                    {zh ? '配体' : 'Ligand'}: <span className="font-mono">{s.bindingPocket.ligand}</span>
                  </div>
                </div>
              )}
              {s.allInteractions && (
                <div className="rounded-md bg-background/60 p-2 border border-border/40">
                  <div className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">
                    {zh ? '链间互作' : 'Interactions'}
                  </div>
                  <div className="text-sm font-bold text-foreground">{s.allInteractions.total}</div>
                  <div className="text-[9px] text-muted-foreground">
                    {zh ? '个 · 链' : 'total · chains'} {s.allInteractions.chains}
                  </div>
                  {/* R182: 🤝⚡💧 → Lucide 微型图标（H-bonds / 盐桥 / 疏水） */}
                  <div className="flex items-center gap-2 text-[8px] text-muted-foreground/80 mt-0.5">
                    <span className="inline-flex items-center gap-0.5" title={zh ? '氢键' : 'H-bonds'}>
                      <Handshake className="h-2.5 w-2.5" />{s.allInteractions.hbonds}
                    </span>
                    <span className="inline-flex items-center gap-0.5" title={zh ? '盐桥' : 'Salt bridges'}>
                      <Zap className="h-2.5 w-2.5" />{s.allInteractions.saltBridges}
                    </span>
                    <span className="inline-flex items-center gap-0.5" title={zh ? '疏水接触' : 'Hydrophobic'}>
                      <Droplets className="h-2.5 w-2.5" />{s.allInteractions.hydrophobic}
                    </span>
                  </div>
                </div>
              )}
              {s.hbonds && (
                <div className="rounded-md bg-background/60 p-2 border border-border/40">
                  <div className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">
                    {zh ? '链内氢键' : 'Intra-chain H-bonds'}
                  </div>
                  <div className="text-sm font-bold text-foreground">{s.hbonds.total}</div>
                  <div className="text-[9px] text-muted-foreground">
                    {zh ? '个氢键' : 'H-bonds'}
                  </div>
                </div>
              )}
              {s.druggability && (
                <div className="rounded-md bg-background/60 p-2 border border-border/40">
                  <div className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">
                    {zh ? '可成药性' : 'Druggability'}
                  </div>
                  <div className="text-sm font-bold text-foreground">
                    {s.druggability.score}<span className="text-[9px] text-muted-foreground">/10</span>
                  </div>
                  <div className="text-[9px] text-muted-foreground">
                    {s.druggability.category}
                  </div>
                </div>
              )}
              {s.virtualScreening && (
                <div className="rounded-md bg-background/60 p-2 border border-border/40">
                  <div className="text-[9px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">
                    {zh ? '虚拟筛选' : 'Virtual Screening'}
                  </div>
                  <div className="text-sm font-bold text-foreground">
                    {s.virtualScreening.topHit || '—'}
                  </div>
                  <div className="text-[9px] text-muted-foreground">
                    {zh ? '最佳片段' : 'top hit'} · Ki {s.virtualScreening.bestKi_uM} μM
                  </div>
                  <div className="text-[8px] text-muted-foreground/60 mt-0.5">
                    {s.virtualScreening.fragmentsScreened} {zh ? '个片段筛选' : 'fragments screened'}
                  </div>
                </div>
              )}
            </div>
          </div>
        );
      })}
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
  // R182: 运行结束后自动折叠章节流——逐章过程视图让位给下方的完整报告预览，
  // 避免同一批章节内容重复展示两遍（用户仍可手动展开回看单章）。
  // React 官方"渲染期间调整状态"模式（props→state 同步，替代 effect+setState）。
  const [prevDone, setPrevDone] = useState(false);
  if (done !== prevDone) {
    setPrevDone(done);
    if (done) setCollapsed(true);
  }
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
    // R179 (Task 2-b): DSH 章节库 id — 事件携带 chapterTitle（中文标题）时
    // 优先用事件标题，这里仅作兜底（事件缺 chapterTitle 的旧流）。
    question_focus: 'Question Focus（问题聚焦）',
    pathway: 'Pathway Context（通路背景）',
    domains: 'Domain Architecture（结构域）',
    structure_quality: 'Structure Quality（结构质量）',
    ligand_binding: 'Ligand Binding（配体结合）',
    interactions: 'Interactions（相互作用）',
    variants: 'Variants & Mutations（变异）',
    expression: 'Expression & Purification（表达纯化）',
    homology: 'Homology & Orthologs（同源）',
    druggability: 'Druggability（成药性）',
    literature: 'Literature（文献）',
    risks: 'Risks & Caveats（风险）',
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
    // ── R179 (Task 2-b): DSH 逐章运行事件 ──
    // DSH 管线以 `chapter-<sectionId>`（如 chapter-ligand_binding）标记章节
    // 开始（完成事件仍是 chapter_done）。归入 primary 组，显示 running 行。
    // 注意 chapter_done 用下划线，不会被该分支误匹配。
    if (!groupKey && /^chapter-.+/.test(stage)) {
      groupKey = 'primary';
      isDone = false;
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
    // R179 (Task 2-b): DSH 章节事件携带 chapterTitle（章节库中文标题）——
    // 优先于 labels 兜底映射，让行标题与报告大纲一致。
    const evTitle = (e as { chapterTitle?: unknown }).chapterTitle;
    if (typeof evTitle === 'string' && evTitle.trim()) cur.label = evTitle.trim();
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
      <CollapsibleCardHeader
        collapsed={collapsed}
        onToggle={() => setCollapsed((v) => !v)}
        ariaLabel="Collapse/Expand LLM chapter stream list"
        accentColor="text-claude-accent"
        title="LLM Chapter Stream"
      >
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
              <CheckCircle2 className="h-2 w-2" /> All OK
            </Badge>
          )}
          {failCount > 0 && (
            <Badge variant="outline" className="text-xs font-medium px-2 h-5 gap-1 rounded-md shrink-0 border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400">
              <XCircle className="h-2 w-2" /> {failCount} failed
            </Badge>
          )}
          {running && completedCount < totalCount && (
            <span className="text-3xs text-claude-accent flex items-center gap-1 shrink-0">
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              Generating…
            </span>
          )}
      </CollapsibleCardHeader>
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
                      <XCircle className="h-2 w-2" /> {gFail}
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
/*  R179 (Task 2-b): DSH 模式卡片 — 数据相关性 / 报告大纲 / 配图条              */
/*  Styling mirrors ChapterStream: collapsible card, muted header, text-xs.  */
/* ──────────────────────────────────────────────────────────────────────── */

/** Relevance level → Tailwind text color (high=emerald / medium=amber / low=muted). */
function dshRelevanceColor(relevance: string): string {
  if (relevance === 'high') return 'text-emerald-600 dark:text-emerald-400';
  if (relevance === 'medium') return 'text-amber-600 dark:text-amber-400';
  return 'text-muted-foreground';
}

/** 数据相关性分析卡 — renders the agent's question-restatement, per-source
 *  relevance findings, key insights and data gaps from the `relevance` stage. */
function DshRelevanceCard({ data }: { data: DshRelevancePayload }) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-3 rounded-lg border border-claude-cryoem/40 bg-gradient-to-br from-claude-cryoem/8 via-transparent to-transparent overflow-hidden claude-card-shadow"
    >
      <CollapsibleCardHeader
        collapsed={collapsed}
        onToggle={() => setCollapsed((v) => !v)}
        ariaLabel="Collapse/Expand DSH relevance analysis card"
        accentColor="text-claude-cryoem"
        accentIcon={<ScanSearch className="h-3.5 w-3.5 text-claude-cryoem shrink-0" />}
        title={t.evalDshRelevance}
      >
        <Badge variant="outline" className="text-xs font-medium px-2 h-5 gap-1 rounded-md shrink-0 border-claude-cryoem/40 bg-claude-cryoem/10 text-claude-cryoem">
          {data.findings.length} sources
        </Badge>
      </CollapsibleCardHeader>
      {!collapsed && (
        <div className="p-3 space-y-2.5">
          {/* Question restatement — italic quote */}
          {data.questionRestated && (
            <blockquote className="border-l-2 border-claude-cryoem/50 pl-2.5 text-xs italic text-claude-text-secondary dark:text-[#9b9590] leading-relaxed">
              <span className="sr-only">{t.evalDshQuestionRestated}: </span>
              {data.questionRestated}
            </blockquote>
          )}
          {/* Per-source findings */}
          {data.findings.length > 0 && (
            <ul className="space-y-1" aria-label={t.evalDshRelevance}>
              {data.findings.map((f, i) => (
                <li key={`${f.source}-${i}`} className="flex items-start gap-1.5 text-xs leading-relaxed">
                  <Badge variant="outline" className="text-4xs font-mono px-1.5 h-4 rounded shrink-0 mt-0.5 uppercase border-claude-border/60 dark:border-[#3d3832]/60 bg-claude-surface/60 dark:bg-[#242220]/60 text-claude-text-muted dark:text-[#9b9590]">
                    {f.source}
                  </Badge>
                  {/* R182: ●●● 字符等级 → 三点微型信号条（颜色继承父级着色 class） */}
                  <span
                    className={`flex items-center gap-0.5 shrink-0 mt-1.5 ${dshRelevanceColor(f.relevance)}`}
                    title={f.relevance}
                    aria-label={`${f.relevance} relevance`}
                  >
                    {[0, 1, 2].map((d) => {
                      const filled = f.relevance === 'high' ? 3 : f.relevance === 'medium' ? 2 : 1;
                      return <span key={d} className={`h-1 w-1 rounded-full ${d < filled ? 'bg-current' : 'bg-current opacity-20'}`} />;
                    })}
                  </span>
                  <span className="text-claude-text/80 dark:text-[#e8e4dd]/80 min-w-0 break-words">{f.note}</span>
                </li>
              ))}
            </ul>
          )}
          {/* Key insights */}
          {data.keyInsights.length > 0 && (
            <div>
              <div className="flex items-center gap-1 mb-1">
                <Lightbulb className="h-3 w-3 text-claude-cryoem shrink-0" />
                <span className="text-3xs font-semibold uppercase tracking-wider text-claude-text-muted dark:text-[#9b9590]">{t.evalDshKeyInsights}</span>
              </div>
              <ul className="space-y-0.5">
                {data.keyInsights.map((k, i) => (
                  <li key={i} className="text-xs text-claude-text/80 dark:text-[#e8e4dd]/80 leading-relaxed flex gap-1.5">
                    <span className="text-claude-cryoem shrink-0">·</span>
                    <span className="min-w-0 break-words">{k}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {/* Data gaps */}
          {data.dataGaps.length > 0 && (
            <div>
              <div className="flex items-center gap-1 mb-1">
                <AlertTriangle className="h-3 w-3 text-amber-500 shrink-0" />
                <span className="text-3xs font-semibold uppercase tracking-wider text-amber-600 dark:text-amber-400">{t.evalDshDataGaps}</span>
              </div>
              <ul className="space-y-0.5">
                {data.dataGaps.map((g, i) => (
                  <li key={i} className="text-xs text-claude-text/70 dark:text-[#e8e4dd]/70 leading-relaxed flex gap-1.5">
                    <span className="text-amber-500 shrink-0">·</span>
                    <span className="min-w-0 break-words">{g}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}

/** 报告大纲卡 — numbered outline sections selected by the agent from the
 *  section library (id + title + focus per section, total count badge). */
function DshOutlineCard({ data }: { data: DshOutlinePayload }) {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-3 rounded-lg border border-claude-accent/40 bg-gradient-to-br from-claude-accent/8 via-transparent to-transparent overflow-hidden claude-card-shadow"
    >
      <CollapsibleCardHeader
        collapsed={collapsed}
        onToggle={() => setCollapsed((v) => !v)}
        ariaLabel="Collapse/Expand DSH outline card"
        accentColor="text-claude-accent"
        accentIcon={<ListTree className="h-3.5 w-3.5 text-claude-accent shrink-0" />}
        title={t.evalDshOutline}
      >
        <Badge variant="outline" className="text-xs font-medium px-2 h-5 gap-1 rounded-md shrink-0 border-claude-accent/40 bg-claude-accent/10 text-claude-accent">
          {data.sections.length}/{data.total || data.sections.length}
        </Badge>
      </CollapsibleCardHeader>
      {!collapsed && (
        <ol className="p-3 space-y-1.5 list-none" aria-label={t.evalDshOutline}>
          {data.sections.map((s, i) => (
            <li key={s.id || i} className="flex items-start gap-2">
              <span className="text-xs font-mono font-semibold text-claude-accent shrink-0 mt-0.5 tabular-nums">{i + 1}.</span>
              <div className="min-w-0">
                <div className="text-xs font-medium text-claude-text/90 dark:text-[#e8e4dd]/90 leading-snug break-words">{s.title}</div>
                {s.focus && (
                  <div className="text-3xs text-claude-text-muted dark:text-[#9b9590] leading-relaxed mt-0.5 break-words">{s.focus}</div>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}
    </motion.div>
  );
}

/** 配图状态角标 — searching (spinner+amber) / verified (emerald) / rejected+failed (muted). */
function DshFigureStatusBadge({ status, label }: { status: DshFigurePayload['status']; label: { searching: string; verified: string; rejected: string } }) {
  if (status === 'searching') {
    return (
      <Badge variant="outline" className="text-4xs font-medium px-1.5 h-4 gap-1 rounded shrink-0 border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400">
        <Loader2 className="h-2 w-2 animate-spin" /> {label.searching}
      </Badge>
    );
  }
  if (status === 'verified') {
    return (
      <Badge variant="outline" className="text-4xs font-medium px-1.5 h-4 gap-1 rounded shrink-0 border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
        <CheckCircle2 className="h-2 w-2" /> {label.verified}
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-4xs font-medium px-1.5 h-4 gap-1 rounded shrink-0 border-claude-border/60 dark:border-[#3d3832]/60 bg-claude-border-light/40 dark:bg-[#2b2926]/40 text-claude-text-muted dark:text-[#9b9590]">
      <XCircle className="h-2 w-2" /> {label.rejected}
    </Badge>
  );
}

/** R182: 配图缩略卡 — LLMPreview 画廊与 DshFiguresStrip 共用（原先两处 ~40 行重复）。 */
function DshFigureThumb({
  figure: f,
  labels,
  imageHeight = 'h-28',
}: {
  figure: DshFigurePayload;
  labels: { searching: string; verified: string; rejected: string };
  imageHeight?: string;
}) {
  const { t } = useI18n();
  const rejected = f.status === 'rejected' || f.status === 'failed';
  return (
    <div
      className={`rounded-md border border-claude-border/40 dark:border-[#3d3832]/40 bg-claude-surface/60 dark:bg-[#242220]/60 overflow-hidden ${rejected ? 'opacity-50' : ''}`}
      title={rejected && f.vlmReason ? `${t.evalDshVlmReason}: ${f.vlmReason}` : f.caption}
    >
      {/* SECURITY: https-only figure URLs (mirrors markdown-renderer allowlist). */}
      {/^https:\/\//i.test(f.url) ? (
        <img src={f.url} alt={f.caption} loading="lazy" className={`${imageHeight} w-full object-cover bg-muted/30`} />
      ) : (
        <div className={`${imageHeight} w-full flex items-center justify-center bg-muted/30`} aria-hidden="true">
          <ImageIcon className="h-4 w-4 text-muted-foreground/40" />
        </div>
      )}
      <div className="p-1.5 space-y-0.5">
        <DshFigureStatusBadge status={f.status} label={labels} />
        <p className="text-3xs text-claude-text-secondary dark:text-[#9b9590] leading-snug line-clamp-2 break-words">{f.caption}</p>
        <p className="text-4xs font-mono text-claude-text-muted/60 dark:text-[#9b9590]/60 uppercase truncate">
          {f.kind}{f.source ? ` · ${f.source}` : ''}{f.pdbId ? ` · ${f.pdbId}` : ''}
        </p>
      </div>
    </div>
  );
}

/** R182: 可折叠卡片头 — ChapterStream / DshRelevanceCard / DshOutlineCard 三处逐字重复的
 *  role=button + ChevronRight 旋转 + Expand/Collapse 尾标签，收敛为一个组件。 */
function CollapsibleCardHeader({
  collapsed,
  onToggle,
  ariaLabel,
  accentIcon,
  title,
  accentColor,
  children,
}: {
  collapsed: boolean;
  onToggle: () => void;
  ariaLabel: string;
  /** 头部主图标（如 ScanSearch / ListTree）。 */
  accentIcon?: React.ReactNode;
  title: string;
  /** ChevronRight 的着色 class（如 text-claude-accent）。 */
  accentColor: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(); } }}
      className="flex items-center justify-between gap-2 px-3 py-2 border-b border-claude-border/40 dark:border-[#3d3832]/40 bg-claude-surface/60 dark:bg-[#242220]/60 cursor-pointer hover:bg-claude-surface dark:hover:bg-[#242220] transition-colors select-none"
      aria-expanded={!collapsed}
      aria-label={ariaLabel}
    >
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <ChevronRight className={`h-3 w-3 shrink-0 transition-transform ${collapsed ? '' : 'rotate-90'} ${accentColor}`} />
        {accentIcon}
        <span className="text-xs font-semibold truncate text-claude-text dark:text-[#e8e4dd]">{title}</span>
        {children}
      </div>
      <span className="text-3xs text-claude-text-muted/70 dark:text-[#9b9590]/70 shrink-0">{collapsed ? 'Expand' : 'Collapse'}</span>
    </div>
  );
}

/** 报告配图条 — horizontally-scrollable strip of figure thumbnails. Multiple
 *  events per figure (searching → verified/rejected) are deduped by url with
 *  latest status winning before reaching this component.
 *  R182: done 后仅展示被拒/失败配图（带 VLM 判定理由）——已验证配图由报告正文
 *  下方的 LLMPreview 画廊呈现，避免同一批图重复展示两遍。 */
function DshFiguresStrip({ figures, done }: { figures: DshFigurePayload[]; done: boolean }) {
  const { t } = useI18n();
  const labels = { searching: t.evalDshFigureSearching, verified: t.evalDshFigureVerified, rejected: t.evalDshFigureRejected };
  // After the run finishes, verified figures move to the report gallery —
  // the strip keeps only rejected/failed ones (VLM reasons). No leftovers → hide.
  const stripFigures = done ? figures.filter((f) => f.status === 'rejected' || f.status === 'failed') : figures;
  // Empty state only after the run finished with zero figures at all.
  if (figures.length === 0) {
    if (!done) return null;
    return (
      <div className="mt-3 rounded-lg border border-dashed border-claude-border/60 dark:border-[#3d3832]/60 bg-claude-bg/40 dark:bg-[#1a1917]/40 px-3 py-3 flex items-center gap-2">
        <Info className="h-3.5 w-3.5 text-claude-text-muted/60 dark:text-[#9b9590]/60 shrink-0" />
        <p className="text-xs text-claude-text-muted dark:text-[#9b9590]">{t.evalDshFiguresEmpty}</p>
      </div>
    );
  }
  if (stripFigures.length === 0) return null;
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-3 rounded-lg border border-claude-border/60 dark:border-[#3d3832]/60 bg-claude-bg/40 dark:bg-[#1a1917]/40 overflow-hidden"
      aria-label={t.evalDshFigures}
    >
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-claude-border/40 dark:border-[#3d3832]/40 bg-claude-surface/60 dark:bg-[#242220]/60">
        <ImageIcon className="h-3.5 w-3.5 text-claude-cryoem shrink-0" />
        <span className="text-xs font-semibold truncate text-claude-text dark:text-[#e8e4dd]">{t.evalDshFigures}</span>
        <Badge variant="outline" className="text-xs font-medium px-2 h-5 gap-1 rounded-md shrink-0 border-claude-cryoem/40 bg-claude-cryoem/10 text-claude-cryoem">
          {figures.filter((f) => f.status === 'verified').length}/{figures.length}
        </Badge>
      </div>
      <div className="flex gap-2 overflow-x-auto thin-scroll p-2" role="list">
        {stripFigures.map((f, i) => (
          <div key={`${f.url}-${i}`} role="listitem" className="w-40 shrink-0">
            <DshFigureThumb figure={f} labels={labels} imageHeight="h-24" />
          </div>
        ))}
      </div>
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
          // All steps use the theme accent — no per-step color distinction
          // (avoids collisions, e.g. Ocean accent=cryoem, Berry accent=xray).
          // R182: collapsed the former 3-key colorMap whose values were all identical.
          const c = { dot: 'bg-claude-accent', ring: 'border-claude-accent/40', bg: 'bg-claude-accent/8', text: 'text-claude-accent' };
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
  const [logs, setLogs] = useState<RunLog[]>([]);
  const [logFilter, setLogFilter] = useState<'all' | 'literature' | 'eval' | 'weekly'>('all');
  const [logSearch, setLogSearch] = useState('');
  // R182: 过滤链只第一遍（原先渲染端 + 空态判断各算一次，共 3 遍/渲染）。
  const filteredLogs = useMemo(
    () => logs
      .filter(l => logFilter === 'all' || l.module === logFilter)
      .filter(l => !logSearch || l.summary.toLowerCase().includes(logSearch.toLowerCase()) || (l.details || '').toLowerCase().includes(logSearch.toLowerCase())),
    [logs, logFilter, logSearch],
  );
  /** Modules currently running — supports parallel execution. */
  const [running, setRunning] = useState<Set<string>>(new Set());
  const isRunning = (m: string) => running.has(m);
  const markRunning = (m: string) => setRunning(s => new Set(s).add(m));
  const markDone = (m: string) => setRunning(s => { const n = new Set(s); n.delete(m); return n; });

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

  // R179 (Task 2-b): 评估流水线模式 — 'classic'（经典多靶点/序列评估）vs
  // 'dsh'（问题驱动智能体：相关性分析 → 大纲规划 → 逐章撰写 + 配图）。
  // Persisted like the other eval settings (default 'classic').
  const [evalPipeline, setEvalPipeline] = useState<'classic' | 'dsh'>(() => {
    if (typeof window === 'undefined') return 'classic';
    return window.localStorage.getItem('evalPipeline') === 'dsh' ? 'dsh' : 'classic';
  });
  useEffect(() => {
    try { window.localStorage.setItem('evalPipeline', evalPipeline); } catch {}
  }, [evalPipeline]);
  // DSH 科学问题（必填，≤1000 字符）。切换模式不清空，方便用户对比两种流水线。
  const [evalDshQuestion, setEvalDshQuestion] = useState('');
  // Inline validation hint under the question textarea (set on failed run attempt).
  const [dshQuestionError, setDshQuestionError] = useState(false);
  // Pipeline of the CURRENT/LAST eval stream run — DSH cards render off this
  // (not off evalPipeline) so toggling the UI mode doesn't hide a finished
  // DSH run's results until the next run resets the stream.
  const [evalRunPipeline, setEvalRunPipeline] = useState<'classic' | 'dsh' | null>(null);
  // Remembers the input mode the user was in before DSH forced 'uniprot', so
  // switching back to classic restores it (DSH mode only supports UniProt input).
  const prevEvalInputModeRef = useRef<'uniprot' | 'sequence'>('uniprot');
  /** Pipeline toggle handler — forces/ restores the input mode around DSH. */
  const switchEvalPipeline = useCallback((p: 'classic' | 'dsh') => {
    if (p === evalPipeline) return;
    if (p === 'dsh') {
      // Entering DSH: remember the current input mode, force UniProt UI.
      prevEvalInputModeRef.current = evalInputMode;
      setEvalInputMode('uniprot');
    } else {
      // Leaving DSH: restore the input mode the user had before.
      setEvalInputMode(prevEvalInputModeRef.current);
    }
    setDshQuestionError(false);
    setEvalPipeline(p);
  }, [evalPipeline, evalInputMode]);
  // Database path config
  const [dbPath, setDbPath] = useState('file:./db/custom.db');
  /** Full DB status object from `/api/db-config` GET — surfaces active
   *  path, schema status, row counts, and isTest flag so the Run Center and
   *  the wizard can stay in lock-step with whatever the 3 modules are
   *  actually reading/writing. */
  const [dbStatus, setDbStatus] = useState<DbStatus | null>(null);
  const [dbPathSaving, setDbPathSaving] = useState(false);
  // R182: ✓/✗ 前缀字符串改为结构化状态（原先渲染端用 startsWith('✓') 判断颜色）。
  const [dbPathStatus, setDbPathStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [dbWizardOpen, setDbWizardOpen] = useState(false);
  const [dbWizardMode, setDbWizardMode] = useState<'choose' | 'create' | 'select'>('choose');

  const loadDbPath = useCallback(async () => {
    try {
      const res = await fetch('/api/db-config');
      // Guard against HTML error pages (502 from gateway when server crashes)
      const ct = res.headers.get('content-type') || '';
      if (!ct.includes('application/json')) {
        setDbPathStatus({ ok: false, text: locale === 'zh' ? '服务器无响应，请重试' : 'Server not responding, please retry' });
        return;
      }
      const data = await res.json() as DbStatus;
      setDbStatus(data);
      // Always sync the input field to the ACTIVE path (single source of truth).
      // This keeps the Run Center display in lock-step with the setup wizard:
      // whichever path the wizard just confirmed is what we show here.
      setDbPath(data.configuredDbPath || data.activeUrl || 'file:./db/custom.db');
      setDbPathStatus({ ok: true, text: locale === 'zh' ? '已加载' : 'Loaded' });
    } catch {
      setDbPathStatus({ ok: false, text: locale === 'zh' ? '加载失败' : 'Load failed' });
    }
  }, [locale]);

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
        setDbPathStatus({ ok: false, text: locale === 'zh' ? '初始化期间服务器无响应，请重试' : 'Server not responding during initialization, please retry' });
        setDbPathSaving(false);
        return;
      }
      const data = await res.json();
      if (data.ok) {
        setDbPathStatus({ ok: true, text: locale === 'zh' ? '已切换，立即生效（无需重启）' : 'Switched and effective immediately (no restart needed)' });
        // Refresh status so the UI reflects the new active path + counts.
        await loadDbPath();
        // Notify parent (pdb-tracker) so it re-fetches all data from the
        // newly-active database — keeps the dashboard in sync.
        onDbChanged?.();
      } else {
        setDbPathStatus({ ok: false, text: data.error || (locale === 'zh' ? '保存失败' : 'Save failed') });
      }
    } catch (err: any) {
      setDbPathStatus({ ok: false, text: err?.message || (locale === 'zh' ? '网络错误' : 'Network error') });
    } finally {
      setDbPathSaving(false);
    }
  }, [dbPath, loadDbPath, onDbChanged, locale]);

  // Load DB path on mount
  useEffect(() => { Promise.resolve().then(() => loadDbPath()); }, [loadDbPath]);
  // Reload DB status when the Run Center dialog is opened (in case DB was changed externally)
  useEffect(() => { if (open) Promise.resolve().then(() => loadDbPath()); }, [open, loadDbPath]);
  const [evalGenerateReport, setEvalGenerateReport] = useState(true);
  const [evalSaveReportFile, setEvalSaveReportFile] = useState(true);
  // Round 36: Toggle for structural analysis (binding pocket, interactions, druggability, virtual screening)
  const [evalSkipStructureAnalysis, setEvalSkipStructureAnalysis] = useState(false);

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
  // Round 58: Weekly report comparison view state
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareData, setCompareData] = useState<{ cryoem: string; xray: string; weekId: string; loading: boolean } | null>(null);
  useEffect(() => {
    if (litStream.state.done) Promise.resolve().then(() => setLitRunCount(c => c + 1));
  }, [litStream.state.done]);
  useEffect(() => {
    if (evalStream.state.done) Promise.resolve().then(() => setEvalRunCount(c => c + 1));
  }, [evalStream.state.done]);
  useEffect(() => {
    if (weeklyStream.state.done) Promise.resolve().then(() => setWeeklyRunCount(c => c + 1));
  }, [weeklyStream.state.done]);

  // ── R179 (Task 2-b): DSH derived state from evalStream.state.log ──────
  // Progress events carry `dshRelevance` / `dshOutline` / `dshFigure`
  // extras (useRunStream forwards unknown payload fields into log entries).
  //   • dshRelevance — LAST event carrying it wins (single payload).
  //   • dshOutline   — LAST event carrying it wins (may be re-planned).
  //   • dshFigures   — accumulated map keyed by url, latest status wins
  //     (figures emit multiple events: searching → verified/rejected).
  const dshRelevance = useMemo(() => {
    for (let i = evalStream.state.log.length - 1; i >= 0; i--) {
      const r = asDshRelevance(evalStream.state.log[i].dshRelevance);
      if (r) return r;
    }
    return null;
  }, [evalStream.state.log]);

  const dshOutline = useMemo(() => {
    for (let i = evalStream.state.log.length - 1; i >= 0; i--) {
      const o = asDshOutline(evalStream.state.log[i].dshOutline);
      if (o) return o;
    }
    return null;
  }, [evalStream.state.log]);

  const dshFiguresFromLog = useMemo(() => {
    const byUrl = new Map<string, DshFigurePayload>();
    for (const e of evalStream.state.log) {
      const f = asDshFigure(e.dshFigure);
      if (f) byUrl.set(f.url, f); // latest event for a url wins
    }
    return Array.from(byUrl.values());
  }, [evalStream.state.log]);

  // ── Effective DSH figures: MERGE the log-derived accumulation (searching →
  // verified/rejected, per-url latest-wins — keeps rejected figures visible
  // with their VLM verdicts after done) with the final `done` payload's list
  // (authoritative + status-final, and immune to the 300-event log cap on
  // very long runs). Done-payload entries win per url.
  const effectiveDshFigures = useMemo(() => {
    if (evalStream.state.done && Array.isArray(evalStream.state.result?.figures)) {
      const narrowed = (evalStream.state.result.figures as unknown[])
        .map((f) => asDshFigure(f))
        .filter((f): f is DshFigurePayload => !!f);
      if (narrowed.length > 0 || dshFiguresFromLog.length === 0) {
        const byUrl = new Map<string, DshFigurePayload>(dshFiguresFromLog.map((f) => [f.url, f]));
        for (const f of narrowed) byUrl.set(f.url, f);
        return Array.from(byUrl.values());
      }
    }
    return dshFiguresFromLog;
  }, [evalStream.state.done, evalStream.state.result, dshFiguresFromLog]);

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
    const chapterOrder: string[] = []; // first-seen order (DSH outline ids are arbitrary)
    let totalMs = 0;
    let allOk = true;
    for (const e of chapterDones) {
      const key = e.chapter as string;
      if (!(key in chapters)) chapterOrder.push(key);
      chapters[key] = e.chapterContent as string;
      if (e.chapterDurationMs) totalMs += e.chapterDurationMs as number;
      if (e.level !== 'success') allOk = false;
    }
    // R179 (Task 2-b): DSH 模式 — chapter ids come from the agent-planned
    // outline (arbitrary section-library ids), so order chapters by the
    // dshOutline event when present (unknown/extra chapters append after,
    // in first-seen order). Classic mode keeps the canonical 8-chapter order.
    let orderedKeys: string[];
    if (dshOutline && dshOutline.sections.length > 0) {
      const known = new Set(dshOutline.sections.map((s) => s.id));
      orderedKeys = [
        ...dshOutline.sections.map((s) => s.id).filter((k) => k in chapters),
        ...chapterOrder.filter((k) => !known.has(k)),
      ];
    } else {
      orderedKeys = canonical.filter((ck) => ck in chapters);
      // Keep non-canonical chapters (sequence-mode / future section ids) too.
      const canonicalSet = new Set(canonical);
      orderedKeys.push(...chapterOrder.filter((k) => !canonicalSet.has(k)));
    }
    const content = orderedKeys.map((k) => chapters[k] ?? '').filter(Boolean).join('\n\n');
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
  }, [evalStream.state.log, dshOutline]);

  // ── Effective primary report: prefer the final result once the stream is
  // done; otherwise fall back to the streaming-derived synthetic report so
  // the LLMPreview renders incrementally during batch mode.
  const effectivePrimaryReport = evalStream.state.done
    ? evalStream.state.result?.report
    : primaryReportFromStream;

  /* ── data fetch on open ─────────────────────────────────────────────── */
  useEffect(() => {
    if (!open) return;
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

  const log = (entry: RunLog) => setLogs(l => {
    // If this is a success/error entry for a module that has a 'running'
    // entry, UPDATE the running entry in-place instead of adding a new one.
    // This prevents the executing log from showing both a spinning 'running'
    // row AND a completed 'success' row for the same task.
    if (entry.status !== 'running') {
      const runningIdx = l.findIndex(x => x.module === entry.module && x.status === 'running');
      if (runningIdx >= 0) {
        const updated = [...l];
        updated[runningIdx] = { ...updated[runningIdx], status: entry.status, summary: entry.summary, details: entry.details, durationMs: entry.durationMs };
        return updated;
      }
    }
    return [entry, ...l].slice(0, 50);
  });

  /** Export the current (filtered) logs as a Markdown/JSON file download (R182: shared downloadBlob + filteredLogs). */
  const exportLogs = (format: 'md' | 'json') => {
    const filtered = filteredLogs;
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
    downloadBlob(content, mime, `runcenter-logs-${ts}.${ext}`);
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
    // R179 (Task 2-b): DSH 模式 — 问题驱动智能体流水线（单靶点 + 必填科学问题）。
    // Posts to /api/evaluations/run-dsh with the same SSE frame contract as
    // classic; progress events additionally carry dshRelevance/dshOutline/
    // dshFigure extras that the derived-state memos above consume.
    if (evalPipeline === 'dsh') {
      const uniprot = (evalTargets[0]?.uniprot || '').trim().toUpperCase();
      if (!uniprot) {
        toast.error(locale === 'zh' ? '请输入至少一个 UniProt ID' : 'Please enter a UniProt ID');
        return;
      }
      // R189: 科学问题改为可选 —— 空问题 = 基础评估口径（与 classic 一致，
      // 后端跳过 relevance/深挖章节/审稿环）。仅保留非空时的最短长度提示。
      const question = evalDshQuestion.trim();
      if (question.length > 0 && question.length < 8) {
        setDshQuestionError(true);
        toast.error(locale === 'zh' ? '科学问题至少需要 8 个字符（留空则执行基础评估）' : 'Scientific question must be at least 8 characters (leave empty for basic evaluation)');
        return;
      }
      setDshQuestionError(false);
      markRunning('eval');
      evalStream.reset();
      setEvalRunPipeline('dsh');
      const t0 = evalTargets[0] || { maxPdb: 80, maxBlastHits: 50, forceBlast: false, skipBlast: false };
      log({
        ts: new Date().toISOString(),
        module: 'eval',
        status: 'running',
        summary: locale === 'zh'
          ? `DSH 模式评估 ${uniprot} — 相关性分析 → 大纲 → 逐章撰写 + 配图 — SSE streaming…`
          : `DSH-mode eval ${uniprot} — relevance → outline → chapter-by-chapter + figures — SSE streaming…`,
      });
      evalStream.start('/api/evaluations/run-dsh', {
        uniprot,
        question,
        maxPdb: t0.maxPdb,
        maxBlastHits: t0.maxBlastHits,
        maxLitCount: evalMaxLitCount,
        forceBlast: t0.forceBlast,
        skipBlast: t0.skipBlast,
      });
      return;
    }
    setEvalRunPipeline('classic');
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
          skipStructureAnalysis: evalSkipStructureAnalysis,
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
          skipStructureAnalysis: evalSkipStructureAnalysis,
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
      skipStructureAnalysis: evalSkipStructureAnalysis,
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
        details: d.files?.dailyIndex ? `${d.files.dailyIndex}\n${d.digest ? `摘要:\n${d.digest.slice(0, 1500)}${d.digest.length > 1500 ? '…' : ''}` : ''}` : '无文件系统输出 (skipWikiFiles)',
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
    // NOTE: we intentionally do NOT call onDbChanged?.() here — same reason
    // as the weekly completion handler. See comment there.
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
    // NOTE: we intentionally do NOT call onDbChanged?.() here. Calling it
    // triggers handleRetryAll in the parent, which refetches ALL data
    // (snapshots + entries + evaluations + literature) simultaneously.
    // This causes a cascade of state updates that makes the page appear to
    // "frequently refresh" — the data tables flicker as they empty and
    // refill. Instead, show a toast prompting the user to refresh manually.
    if (s.ok) {
      import('sonner').then(({ toast }) => {
        toast.success('Weekly report completed', {
          description: 'Click "Refresh data" to load the new structures',
          duration: 8000,
        });
      });
    }
  }, [weeklyStream.state.done]);

  /* ──────────────────────────────────────────────────────────────────── */
  /*  Render                                                               */
  /* ──────────────────────────────────────────────────────────────────── */

  return (
    <>
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

        {/* ── R180: shared LLM settings — small button entry (replaces the old
            LLM provider status bar + advanced config block). The provider/model
            store is SHARED with the Agent chat; classic and DSH evaluation,
            literature and weekly modules all resolve it server-side. ─────── */}
        <div className="px-6 py-2 border-b border-claude-border dark:border-[#3d3832] bg-claude-bg/40 dark:bg-[#1a1917]/40 flex-shrink-0">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 min-w-0">
              <span className="text-xs text-claude-text-muted dark:text-[#9b9590] truncate">
                {locale === 'zh' ? '评估（经典 / DSH）· 文献 · 周报与 Agent 聊天共用 LLM 设置' : 'Evaluations (classic / DSH) · literature · weekly share LLM settings with the Agent chat'}
              </span>
            </div>
            <SharedLlmButton />
          </div>
        </div>

        <div className="px-6 py-2.5 border-b border-claude-border dark:border-[#3d3832] bg-claude-bg/40 dark:bg-[#1a1917]/40 flex-shrink-0">
          {/* ── Database config (always visible) ──────────────────────── */}
          <div>
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
                <span className={`text-xs font-medium ml-auto shrink-0 inline-flex items-center gap-1 ${dbPathStatus.ok ? 'text-emerald-500 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                  {dbPathStatus.ok ? <CheckCircle2 className="h-2.5 w-2.5" /> : <XCircle className="h-2.5 w-2.5" />}
                  {dbPathStatus.text}
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
                endpoint={evalPipeline === 'dsh' ? 'POST /api/evaluations/run-dsh' : 'POST /api/evaluations/run'}
                description={locale === 'zh' ? 'UniProt → 元数据 + 序列 → RCSB 直接 PDB → SIFTS 覆盖度 → NCBI BLASTp 同源 → 评分 → 原子任务包含 LLM 报告生成（写入 Evaluation.report + EvaluationReport 表 + 可选 LLM-Wiki）。支持多个 UniProt ID 批量评估，含跨靶点结构与关联分析。' : 'UniProt → metadata + sequence → RCSB direct PDB → SIFTS coverage → NCBI BLASTp homology → scoring → atomic tasks include LLM report generation (writes to Evaluation.report + EvaluationReport table + optional LLM-Wiki). Supports multiple UniProt IDs for batch evaluation with cross-target structure and correlation analysis.'}
                headerBadge={evalPipeline !== 'dsh' && evalTargets.length > 1 ? (
                  <Badge variant="outline" className="text-xs font-medium px-2 h-5 gap-1 rounded-md shrink-0 border-claude-xray/40 bg-claude-xray-bg text-claude-xray" title={locale === 'zh' ? '多靶点批量评估 + 关联分析' : 'Multi-target batch evaluation + correlation analysis'}>
                    <Layers className="h-2 w-2" /> {locale === 'zh' ? '批量' : 'Batch'} · {evalTargets.length} {locale === 'zh' ? '靶点' : 'targets'}
                  </Badge>
                ) : null}
              >
                {/* R179 (Task 2-b): Pipeline mode toggle — 经典模式 vs DSH 模式
                    （问题驱动智能体）。 Same pill idiom as the input-mode toggle
                    below; DSH pill uses the claude-cryoem accent + Sparkles icon. */}
                <div className="flex items-center gap-1.5 mb-2 flex-wrap">
                  {/* R182: pill 容器统一 claude token（与 Tabs 同源），避免 shadcn muted 混搭 */}
                  <div className="flex items-center gap-0.5 rounded-md bg-claude-bg/60 dark:bg-[#1a1917]/60 border border-claude-border/40 dark:border-[#3d3832]/40 p-0.5" role="group" aria-label={locale === 'zh' ? '评估流水线模式' : 'Evaluation pipeline mode'}>
                    <button
                      type="button"
                      onClick={() => switchEvalPipeline('classic')}
                      aria-pressed={evalPipeline === 'classic'}
                      className={`px-2.5 py-1 rounded text-xs font-medium transition-colors inline-flex items-center gap-1 ${evalPipeline === 'classic' ? 'bg-claude-accent/15 text-claude-accent' : 'text-claude-text-muted dark:text-[#9b9590] hover:text-claude-text dark:hover:text-[#e8e4dd]'}`}
                    >
                      {t.evalModeClassic}
                    </button>
                    <button
                      type="button"
                      onClick={() => switchEvalPipeline('dsh')}
                      aria-pressed={evalPipeline === 'dsh'}
                      className={`px-2.5 py-1 rounded text-xs font-medium transition-colors inline-flex items-center gap-1 ${evalPipeline === 'dsh' ? 'bg-claude-cryoem/10 text-claude-cryoem' : 'text-claude-text-muted dark:text-[#9b9590] hover:text-claude-text dark:hover:text-[#e8e4dd]'}`}
                    >
                      <Sparkles className="h-3 w-3" /> {t.evalModeDsh}
                    </button>
                  </div>
                  {evalPipeline === 'dsh' && evalTargets.length > 1 && (
                    <span className="text-3xs text-amber-600 dark:text-amber-400" title={t.evalDshSingleOnly}>
                      {t.evalDshSingleOnly}
                    </span>
                  )}
                </div>
                {evalPipeline === 'dsh' && (
                  <p className="text-xs text-muted-foreground mb-3 leading-relaxed">{t.evalModeDshHint}</p>
                )}

                {/* Input mode toggle: UniProt ID vs Sequence — hidden in DSH mode
                    (DSH only supports UniProt input for now). */}
                {evalPipeline !== 'dsh' && (
                <div className="flex items-center gap-1.5 mb-3">
                  <div className="flex items-center gap-0.5 rounded-md bg-claude-bg/60 dark:bg-[#1a1917]/60 border border-claude-border/40 dark:border-[#3d3832]/40 p-0.5">
                    <button type="button" onClick={() => setEvalInputMode('uniprot')} className={`px-2 py-1 rounded text-xs font-medium transition-colors ${evalInputMode === 'uniprot' ? 'bg-claude-accent/15 text-claude-accent' : 'text-claude-text-muted dark:text-[#9b9590] hover:text-claude-text dark:hover:text-[#e8e4dd]'}`}>{locale === 'zh' ? 'UniProt ID' : 'UniProt ID'}</button>
                    <button type="button" onClick={() => setEvalInputMode('sequence')} className={`px-2 py-1 rounded text-xs font-medium transition-colors ${evalInputMode === 'sequence' ? 'bg-claude-accent/15 text-claude-accent' : 'text-claude-text-muted dark:text-[#9b9590] hover:text-claude-text dark:hover:text-[#e8e4dd]'}`}>{t.evalInputModeSequence}</button>
                  </div>
                  {evalInputMode === 'sequence' && (
                    <div className="flex items-center gap-0.5 rounded-md bg-claude-bg/60 dark:bg-[#1a1917]/60 border border-claude-border/40 dark:border-[#3d3832]/40 p-0.5">
                      <button type="button" onClick={() => setEvalSeqType('aa')} className={`px-2 py-1 rounded text-xs font-medium transition-colors ${evalSeqType === 'aa' ? 'bg-sky-500/10 text-sky-600 dark:text-sky-300' : 'text-claude-text-muted dark:text-[#9b9590] hover:text-claude-text dark:hover:text-[#e8e4dd]'}`}>{t.evalSeqTypeAA}</button>
                      <button type="button" onClick={() => setEvalSeqType('dna')} className={`px-2 py-1 rounded text-xs font-medium transition-colors ${evalSeqType === 'dna' ? 'bg-sky-500/10 text-sky-600 dark:text-sky-300' : 'text-claude-text-muted dark:text-[#9b9590] hover:text-claude-text dark:hover:text-[#e8e4dd]'}`}>DNA</button>
                    </div>
                  )}
                </div>
                )}

                {evalInputMode === 'sequence' && evalPipeline !== 'dsh' ? (
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
                /* UniProt ID input mode (original). In DSH mode only the FIRST
                    target row renders (single-target pipeline) and the add /
                    remove buttons are hidden. */
                <div className="space-y-2 mb-3">
                  {(evalPipeline === 'dsh' ? evalTargets.slice(0, 1) : evalTargets).map((t, i) => (
                    <div key={i} className="flex items-end gap-1.5 flex-wrap">
                      {/* Left slot: + (add) on row 1, remove (×) on rows 2+ — both
                          hidden in DSH mode (single target only, kept as spacer). */}
                      {evalPipeline === 'dsh' ? (
                        <span className="h-8 w-8 shrink-0" aria-hidden="true" />
                      ) : i === 0 ? (
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
                  {/* R179 (Task 2-b): DSH 科学问题输入（必填，≤1000 字符）。
                      Styling matches the sequence textarea idiom; char counter
                      warns (amber) near the limit; failed validation leaves an
                      inline red hint (plus a sonner toast from runEvaluation). */}
                  {evalPipeline === 'dsh' && (
                    <div>
                      <Label htmlFor="dsh-question-input" className="text-xs uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                        <Sparkles className="h-3 w-3 text-claude-cryoem" />
                        {t.evalDshQuestion}
                        <span className="text-muted-foreground/70 font-normal normal-case">（{locale === 'zh' ? '可选 · 留空则执行基础评估' : 'optional · empty = basic evaluation'}）</span>
                      </Label>
                      <textarea
                        id="dsh-question-input"
                        value={evalDshQuestion}
                        onChange={e => { setEvalDshQuestion(e.target.value.slice(0, 1000)); if (dshQuestionError && e.target.value.trim()) setDshQuestionError(false); }}
                        placeholder={t.evalDshQuestionPlaceholder}
                        rows={3}
                        maxLength={1000}
                        aria-required="false"
                        aria-invalid={dshQuestionError}
                        aria-describedby={dshQuestionError ? 'dsh-question-error' : undefined}
                        className={`mt-1 w-full px-2 py-1.5 rounded-md border bg-background text-xs resize-y thin-scroll ${dshQuestionError ? 'border-red-500/60' : 'border-border/60'}`}
                      />
                      <div className="flex items-center justify-between gap-2 mt-0.5">
                        {dshQuestionError ? (
                          <p id="dsh-question-error" className="text-3xs text-red-500" role="alert">{t.evalDshQuestionRequired}</p>
                        ) : (
                          /* R179 (Task 2-b): compact phase-flow helper (avoids duplicating
                             the long evalModeDshHint shown under the pipeline pill). */
                          <span className="text-3xs text-muted-foreground/80 truncate">{t.evalDshRelevance} → {t.evalDshOutline} → {t.evalDshChapterProgress}</span>
                        )}
                        <span className={`text-3xs font-mono tabular-nums shrink-0 ${evalDshQuestion.length > 900 ? 'text-amber-500 dark:text-amber-400' : 'text-muted-foreground/70'}`}>
                          {evalDshQuestion.length}/1000
                        </span>
                      </div>
                    </div>
                  )}
                </div>
                ) /* end UniProt ID mode */}

                <StreamFeed
                  events={evalStream.state.log}
                  running={evalStream.state.running}
                  done={evalStream.state.done}
                  ok={evalStream.state.ok}
                  emptyHint={locale === 'zh' ? '输入 UniProt ID 并点击 “执行” 启动评估流水线' : 'Enter a UniProt ID and click Run to start the evaluation pipeline'}
                />

                {/* R179 (Task 2-b): DSH 模式进度卡 — 相关性分析 → 报告大纲 →
                    配图条（ChapterStream / LLMPreview 之前）。仅在当前/最近一次
                    评估流为 DSH 且数据已到时渲染；配图条在 done 且零配图时
                    显示「宁缺毋滥」空态。 */}
                {evalRunPipeline === 'dsh' && dshRelevance && <DshRelevanceCard data={dshRelevance} />}
                {evalRunPipeline === 'dsh' && dshOutline && <DshOutlineCard data={dshOutline} />}
                {evalRunPipeline === 'dsh' && (effectiveDshFigures.length > 0 || evalStream.state.done) && (
                  <DshFiguresStrip figures={effectiveDshFigures} done={evalStream.state.done} />
                )}

                {/* Per-chapter streamed LLM output (collapsible "thinking process") */}
                <ChapterStream
                  events={evalStream.state.log}
                  running={evalStream.state.running}
                  done={evalStream.state.done}
                />

                {/* Round 43: Structural analysis summary card — shows pocket/interactions/druggability/VS results */}
                <AnalysisSummaryCard events={evalStream.state.log} locale={locale} />

                {/* LLM report inline preview (module ①) — shows real LLM output or failure.
                    Uses `effectivePrimaryReport` so the preview appears as soon as the
                    primary target's chapters finish streaming (via chapter_done SSE
                    events), WITHOUT waiting for the entire batch run to complete. */}
                {effectivePrimaryReport && (
                  <LLMPreview
                    content={effectivePrimaryReport.content}
                    title={`${(evalRunPipeline === 'dsh' || dshOutline)
                      ? (locale === 'zh' ? 'DSH 模式 · LLM 评估报告' : 'DSH Mode · LLM Report')
                      : (locale === 'zh' ? 'LLM 可行性报告' : 'LLM Feasibility Report')} · ${evalStream.state.result?.uniprotInfo?.proteinName || evalStream.state.result?.uniprot || (evalStream.state.running ? (locale === 'zh' ? '生成中…' : 'Generating…') : (locale === 'zh' ? '主靶点' : 'Primary target'))}`}
                    provider={effectivePrimaryReport.provider}
                    model={effectivePrimaryReport.model}
                    durationMs={effectivePrimaryReport.durationMs}
                    fallback={effectivePrimaryReport.fallback}
                    error={effectivePrimaryReport.error}
                    ok={effectivePrimaryReport.ok}
                    dbSaved={evalStream.state.done ? evalStream.state.result?.dbSaved : undefined}
                    chars={effectivePrimaryReport.contentChars}
                    accent="cryoem"
                    /* R179 (Task 2-b): done 后在正文下方渲染最终配图画廊（仅已验证
                       配图 —— 与报告正文内嵌的配图一致；被拒配图保留在上方检索条
                       中以 VLM 判定理由呈现）。 */
                    figures={evalRunPipeline === 'dsh' && evalStream.state.done && effectiveDshFigures.some((f) => f.status === 'verified')
                      ? effectiveDshFigures.filter((f) => f.status === 'verified')
                      : undefined}
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

                {/* Classic-pipeline report switches — hidden in DSH mode (the
                    DSH agent ALWAYS generates + persists a report; these flags
                    are not part of the /api/evaluations/run-dsh contract, so
                    showing them there would be dead controls). */}
                {evalPipeline !== 'dsh' && (
                <div className="mt-3 flex items-center gap-3 flex-wrap">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                    <Switch checked={evalGenerateReport} onCheckedChange={setEvalGenerateReport} className="scale-90" />
                    {locale === 'zh' ? '生成 LLM 报告' : 'Generate LLM report'}
                  </label>
                  <label className={`flex items-center gap-2 text-xs cursor-pointer ${evalGenerateReport ? 'text-muted-foreground' : 'text-muted-foreground/40 pointer-events-none'}`}>
                    <Switch checked={evalSaveReportFile} onCheckedChange={setEvalSaveReportFile} disabled={!evalGenerateReport} className="scale-90" />
                    {locale === 'zh' ? '保存为 LLM-Wiki 文件' : 'Save to LLM-Wiki file'}
                  </label>
                  <label className={`flex items-center gap-2 text-xs cursor-pointer ${evalGenerateReport ? 'text-muted-foreground' : 'text-muted-foreground/40 pointer-events-none'}`} title={locale === 'zh' ? '跳过结构分析（结合口袋、互作、可药性、虚拟筛选）以加快报告生成' : 'Skip structural analysis (binding pocket, interactions, druggability, virtual screening) for faster report generation'}>
                    <Switch checked={evalSkipStructureAnalysis} onCheckedChange={setEvalSkipStructureAnalysis} disabled={!evalGenerateReport} className="scale-90" />
                    {locale === 'zh' ? '跳过结构分析' : 'Skip structure analysis'}
                  </label>
                </div>
                )}
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
                      <Input
                        type="week"
                        value={weeklyCustomWeek || (weeklyWindow?.weekId || '')}
                        onChange={e => setWeeklyCustomWeek(e.target.value)}
                        className="h-8 px-2 text-xs font-mono flex-1 min-w-0"
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
                            ? 'border-claude-accent/50 bg-claude-accent/10 text-claude-accent font-medium'
                            : 'border-claude-border/60 dark:border-[#3d3832]/60 text-claude-text-muted dark:text-[#9b9590] hover:text-claude-text dark:hover:text-[#e8e4dd] hover:border-claude-border dark:hover:border-[#3d3832]'
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

                  {/* Round 58: Compare Cryo-EM vs X-ray reports side-by-side */}
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 gap-1 text-xs"
                    disabled={isRunning('weekly')}
                    onClick={async () => {
                      const wid = weeklyCustomWeek || weeklyWindow?.weekId || '';
                      setCompareOpen(true);
                      setCompareData({ cryoem: '', xray: '', weekId: wid, loading: true });
                      try {
                        const r = await fetch(`/api/weekly-report-file?weekId=${encodeURIComponent(wid)}`);
                        if (!r.ok) throw new Error(`HTTP ${r.status}`);
                        const d = await r.json();
                        setCompareData({
                          cryoem: d.cryoemContent || '',
                          xray: d.xrayContent || '',
                          weekId: wid,
                          loading: false,
                        });
                      } catch (err: any) {
                        setCompareData({ cryoem: '', xray: '', weekId: wid, loading: false });
                        toast.error(locale === 'zh' ? '加载报告失败' : 'Failed to load report', { description: err?.message });
                      }
                    }}
                    title={locale === 'zh' ? '对比 Cryo-EM 与 X-ray 周报' : 'Compare Cryo-EM vs X-ray reports'}
                  >
                    <Columns2 className="h-3.5 w-3.5" />
                    {locale === 'zh' ? '对比报告' : 'Compare'}
                  </Button>

                  {/* R180: the old "LLM → provider" hint was removed — the provider
                      is resolved server-side from the shared Agent-chat settings;
                      the SharedLlmButton at the top of the dialog is the single
                      source of truth. */}
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
                <div className="rounded-lg border border-claude-border/60 dark:border-[#3d3832]/60 bg-claude-bg/40 dark:bg-[#1a1917]/40 overflow-hidden">
                  {/* header with filter pills + search */}
                  <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-claude-border/60 dark:border-[#3d3832]/60 bg-claude-surface/60 dark:bg-[#242220]/60 flex-wrap">
                    <div className="flex items-center gap-2">
                      <Activity className="h-3.5 w-3.5 text-claude-text-muted dark:text-[#9b9590]" />
                      <span className="text-xs font-semibold text-claude-text dark:text-[#e8e4dd]">{t.execLog}</span>
                      <Badge variant="outline" className="text-xs font-medium px-2 h-5 gap-1 rounded-md shrink-0 border-claude-border/60 dark:border-[#3d3832]/60 bg-claude-border-light/60 dark:bg-[#2b2926]/60 text-claude-text-muted dark:text-[#9b9590]">
                        {filteredLogs.length}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {/* module filter pills — R182: 编号与 Tabs 对齐（① 评估 ② 文献 ③ 周报） */}
                      <div className="flex items-center gap-0.5 rounded-md bg-claude-bg/60 dark:bg-[#1a1917]/60 border border-claude-border/40 dark:border-[#3d3832]/40 p-0.5">
                        {([
                          { k: 'all', label: locale === 'zh' ? '全部' : 'All' },
                          { k: 'eval', label: '①' },
                          { k: 'literature', label: '②' },
                          { k: 'weekly', label: '③' },
                        ] as const).map(f => (
                          <button
                            key={f.k}
                            type="button"
                            onClick={() => setLogFilter(f.k)}
                            className={`px-1.5 py-0.5 rounded text-xs font-medium transition-colors ${
                              logFilter === f.k ? 'bg-claude-accent/15 text-claude-accent' : 'text-claude-text-muted dark:text-[#9b9590] hover:text-claude-text dark:hover:text-[#e8e4dd]'
                            }`}
                            title={f.k === 'all' ? t.execLogFilterAll : f.k === 'literature' ? t.tabLit : f.k === 'eval' ? t.tabEval : t.tabWeekly}
                          >
                            {f.label}
                          </button>
                        ))}
                      </div>
                      {/* search box */}
                      <div className="flex items-center h-6 rounded-md border border-claude-border/40 dark:border-[#3d3832]/40 bg-claude-surface/60 dark:bg-[#242220]/60 px-1.5 gap-1">
                        <Search className="h-2.5 w-2.5 text-claude-text-muted/60 dark:text-[#9b9590]/60" />
                        <input
                          type="text"
                          value={logSearch}
                          onChange={e => setLogSearch(e.target.value)}
                          placeholder={t.execLogSearch}
                          className="w-16 bg-transparent text-xs outline-none placeholder:text-claude-text-muted/50 dark:placeholder:text-[#9b9590]/50 text-claude-text dark:text-[#e8e4dd]"
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
                      {filteredLogs.map((l, i) => {
                        // R182: 三模块徽章共用同一 accent 样式；编号与 Tabs 对齐。
                        const MODULE_BADGE_CLS = 'border-claude-accent/40 text-claude-accent bg-claude-accent/10';
                        const moduleBadge = l.module === 'literature'
                          ? { txt: '② Lit', cls: MODULE_BADGE_CLS }
                          : l.module === 'eval'
                          ? { txt: '① Eval', cls: MODULE_BADGE_CLS }
                          : { txt: '③ Weekly', cls: MODULE_BADGE_CLS };
                        return (
                          <div
                            key={i}
                            className={`text-xs border-l-2 pl-2.5 py-1 ${
                              l.status === 'success'
                                ? 'border-emerald-500'
                                : l.status === 'error'
                                ? 'border-red-500'
                                : 'border-claude-accent'
                            }`}
                          >
                            <div className="flex items-center gap-1.5">
                              {l.status === 'success' && <CheckCircle2 className="h-2.5 w-2.5 text-emerald-500 shrink-0" />}
                              {l.status === 'error' && <XCircle className="h-3 w-3 text-red-500 shrink-0" />}
                              {l.status === 'running' && <Loader2 className="h-3 w-3 animate-spin text-claude-accent shrink-0" />}
                              <span className="text-claude-text-muted dark:text-[#9b9590] font-mono text-xs shrink-0">{l.ts.slice(11, 19)}</span>
                              <Badge variant="outline" className={`text-xs font-medium px-2 h-5 gap-1 rounded-md shrink-0 ${moduleBadge.cls}`}>{moduleBadge.txt}</Badge>
                              <span className="font-medium flex-1 leading-tight text-claude-text/90 dark:text-[#e8e4dd]/90">{l.summary}</span>
                              {l.durationMs != null && <span className="text-claude-text-muted dark:text-[#9b9590] text-xs shrink-0">{Math.round(l.durationMs / 100) / 10}s</span>}
                            </div>
                            {l.details && (
                              <pre className="mt-1 text-xs whitespace-pre-wrap text-claude-text-muted dark:text-[#9b9590] max-h-32 overflow-y-auto font-mono leading-relaxed">
                                {l.details}
                              </pre>
                            )}
                          </div>
                        );
                      })}
                      {filteredLogs.length === 0 && (
                        <div className="text-xs text-claude-text-muted/60 dark:text-[#9b9590]/60 text-center py-3">{locale === 'zh' ? '没有匹配的日志' : 'No matching logs'}</div>
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

      {/* ── Round 58: Weekly Report Comparison Modal ─────────────────────── */}
      <AnimatePresence>
        {compareOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={() => setCompareOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.97, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.97, y: 8 }}
              transition={{ duration: 0.2 }}
              className="bg-claude-surface dark:bg-[#242220] rounded-[10px] shadow-xl max-w-[90vw] w-full max-h-[90vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-center justify-between px-5 py-3 border-b border-claude-border dark:border-[#3d3832] bg-gradient-to-r from-claude-accent-light/60 via-claude-surface to-claude-surface dark:from-[#2a1f1a] dark:via-[#242220] dark:to-[#242220]">
                <div className="flex items-center gap-2">
                  <Columns2 className="h-4 w-4 text-claude-accent" />
                  <h2 className="text-sm font-bold text-claude-text">
                    {locale === 'zh' ? '周报对比' : 'Report Comparison'} — {compareData?.weekId || '…'}
                  </h2>
                  {compareData && !compareData.loading && (
                    <Badge variant="outline" className="text-xs font-medium px-2 h-5 gap-1 rounded-md shrink-0 border-claude-accent/30 bg-claude-accent/10 text-claude-accent">
                      Cryo-EM vs X-ray
                    </Badge>
                  )}
                </div>
                <Button variant="ghost" size="sm" onClick={() => setCompareOpen(false)} className="h-7 w-7 p-0">
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {/* Body — side-by-side comparison */}
              <div className="flex-1 overflow-hidden p-4">
                {compareData?.loading ? (
                  <div className="flex items-center justify-center h-full min-h-[300px]">
                    <Loader2 className="h-5 w-5 animate-spin text-claude-accent mr-2" />
                    <span className="text-sm text-muted-foreground">{locale === 'zh' ? '加载报告中…' : 'Loading reports…'}</span>
                  </div>
                ) : compareData && (compareData.cryoem || compareData.xray) ? (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 h-full max-h-[calc(90vh-100px)]">
                    {/* Cryo-EM panel */}
                    <div className="flex flex-col rounded-lg border border-claude-border/60 dark:border-[#3d3832]/60 overflow-hidden bg-white/50 dark:bg-[#1a1917]/50">
                      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-claude-border/40 dark:border-[#3d3832]/40 bg-claude-accent/8">
                        <Snowflake className="h-3.5 w-3.5 text-claude-accent shrink-0" />
                        <span className="text-xs font-semibold text-claude-accent">Cryo-EM</span>
                        <span className="text-[10px] text-muted-foreground ml-auto">{compareData.cryoem.length} chars</span>
                      </div>
                      <div className="flex-1 overflow-y-auto p-3 thin-scroll text-xs leading-relaxed">
                        {compareData.cryoem ? (
                          <LazyMarkdown>{compareData.cryoem}</LazyMarkdown>
                        ) : (
                          <div className="text-muted-foreground text-center py-8">{locale === 'zh' ? '本周无 Cryo-EM 报告' : 'No Cryo-EM report this week'}</div>
                        )}
                      </div>
                    </div>

                    {/* X-ray panel */}
                    <div className="flex flex-col rounded-lg border border-claude-border/60 dark:border-[#3d3832]/60 overflow-hidden bg-white/50 dark:bg-[#1a1917]/50">
                      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-claude-border/40 dark:border-[#3d3832]/40 bg-claude-accent/8">
                        <Ruler className="h-3.5 w-3.5 text-claude-accent shrink-0" />
                        <span className="text-xs font-semibold text-claude-accent">X-ray</span>
                        <span className="text-[10px] text-muted-foreground ml-auto">{compareData.xray.length} chars</span>
                      </div>
                      <div className="flex-1 overflow-y-auto p-3 thin-scroll text-xs leading-relaxed">
                        {compareData.xray ? (
                          <LazyMarkdown>{compareData.xray}</LazyMarkdown>
                        ) : (
                          <div className="text-muted-foreground text-center py-8">{locale === 'zh' ? '本周无 X-ray 报告' : 'No X-ray report this week'}</div>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full min-h-[300px] gap-2">
                    <AlertTriangle className="h-6 w-6 text-amber-500" />
                    <div className="text-sm font-medium text-muted-foreground">
                      {locale === 'zh' ? '未找到该周的周报数据' : 'No report data found for this week'}
                    </div>
                    <div className="text-xs text-muted-foreground/70">
                      {locale === 'zh' ? '请先生成周报后再使用对比功能' : 'Please generate a weekly report first'}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/* ──────────────────────────────────────────────────────────────────────── */
/*  Module card wrapper with gradient accent                                 */
/* ──────────────────────────────────────────────────────────────────────── */

// Claude-themed accent tokens.
// IMPORTANT: All module cards/tabs use the SAME theme accent (`claude-accent`)
// to avoid color collisions when the user switches themes (6 preset themes map
// their accents onto the claude-* scale — see the theme table in globals.css).
// Modules are distinguished by ICON + NUMBER (①②③), not by color.
// Status colors (success/error/warn) use standard Tailwind colors that are
// guaranteed distinct from ALL 6 theme accents.
// R182: the former 8-key ACCENT_CLASSES (7 legacy aliases, all identical values)
// collapsed to a single MODULE_ACCENT constant. The `accent` prop is kept for
// API compatibility but no longer selects different styles.
const MODULE_ACCENT = {
  ring: 'before:from-claude-accent/70',
  chip: 'bg-claude-accent-light text-claude-accent border-claude-accent/30',
  icon: 'bg-gradient-to-br from-claude-accent/20 to-claude-accent/5 text-claude-accent',
  glow: 'from-claude-accent/8',
  shadow: 'claude-card-shadow',
};
const ACCENT_CLASSES: Record<string, typeof MODULE_ACCENT> = { accent: MODULE_ACCENT };

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
  const a = ACCENT_CLASSES[accent] || MODULE_ACCENT;
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
