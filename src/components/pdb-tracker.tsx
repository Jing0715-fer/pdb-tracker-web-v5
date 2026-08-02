'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef, useSyncExternalStore } from 'react';
import dynamic from 'next/dynamic';

import { useTheme } from 'next-themes';
import {
  Atom, Sun, Moon, Search, BookOpen, FlaskConical, FileText, ScrollText,
  ChevronRight, ChevronDown, Database, BarChart3, TrendingUp, X,
  Sparkles, Loader2, ExternalLink, Users, Link2, Copy, Check, Menu,
  Calendar, ArrowRightLeft, LayoutDashboard, Clock, FileDown, Settings,
  Microscope, ArrowUp, RefreshCw, Download, Box, Upload, ChevronLeft,
  StickyNote, Tag, Trophy, Eye, AlertTriangle, HelpCircle,
  Maximize2, Layers, Info, CheckCircle2, Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import type { Mode, PdbEntry, WeeklySnapshot, WeeklyReport, Evaluation, LitPaper, LitReport, LitStats, EvalBatch, EvalBatchSubTarget, EvalRow } from '@/lib/pdb-types';
import { useI18n } from '@/lib/i18n';

// ─── Utility: Time Ago ─────────────────────────────────────────────────────

function getTimeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 10) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

import { computeQualityScore, getQualityBorderClass } from '@/lib/pdb-utils';
import { queuedFetchWithRetry } from '@/lib/request-queue';
import { getMethodColor, getMethodLabel, formatDate, formatEvalue, parseLigands } from '@/components/pdb-helpers';
// `useReadingLists` / `usePaperNotes` are imported from dedicated hook files
// (literature/useReadingLists.ts, literature/usePaperNotes.ts) rather than
// their sibling component files, so that framer-motion + dompurify (used only
// by ReadingListSidebar / PaperNotesEditor) stay out of pdb-tracker's
// first-compile graph. See worklog task `qa-deep-lazy-load-siblings`.
import { useReadingLists } from '@/components/literature/useReadingLists';
import { usePaperNotes } from '@/components/literature/usePaperNotes';
import { usePaperTags } from '@/components/literature/LiteraturePaperTags';
import { DemoDataBanner } from '@/components/demo-data-banner';
import { QuickActions } from '@/components/quick-actions';
import { StructureStatsCards } from '@/components/structure-stats-cards';
import { LiteratureStatsCards } from '@/components/literature-stats-cards';
import { TrendingStructures } from '@/components/trending-structures';
import { SnapshotComparison } from '@/components/snapshot-comparison';
import { StructureQualityRing } from '@/components/structure-quality-ring';
import { DashboardSummaryWidget } from '@/components/dashboard-summary-widget';
import { BreadcrumbNavEnhanced } from '@/components/breadcrumb-nav-enhanced';
import { useLocalStorageSet } from '@/hooks/use-local-storage';
import { useReadingProgress } from '@/hooks/use-reading-progress';
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts';
import { toast } from 'sonner';
import { useAppSettings } from '@/hooks/use-app-settings';
import { generateBibTeX, generateRIS, generateAPA, generateVancouver, generateMLA, downloadFile } from '@/lib/citation-utils';
// fallback-data import removed — errors now surface as error messages, not demo data.
import { useTour } from '@/hooks/use-tour';
import { exportToCSV, exportToJSON, formatPdbEntryForExport, formatEvalForExport, formatLitPaperForExport } from '@/lib/export-utils';
import { useAppStore as useMolcraftStore } from '@/lib/molcraft/store';

// QuickStatsPanel and WeeklyDiffCompare loaded dynamically to avoid bundle size issues
const QuickStatsPanel = dynamic(() => import('@/components/quick-stats-panel').then(m => ({ default: m.QuickStatsPanel })), {
  ssr: false,
  loading: () => <div className="animate-pulse h-8 bg-claude-border-light rounded" />,
});
const WeeklyDiffCompare = dynamic(() => import('@/components/weekly-diff-compare').then(m => ({ default: m.WeeklyDiffCompare })), {
  ssr: false,
  loading: () => <div className="animate-pulse h-8 bg-claude-border-light rounded" />,
});

// ─── Dynamic Imports (heavy components loaded on demand) ────────────────────────

const PdbViewerModal = dynamic(() => import('@/components/PdbViewerModal').then(m => ({ default: m.PdbViewerModal })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});

const PdbThumbnailPreview = dynamic(() => import('@/components/PdbViewerModal').then(m => ({ default: m.PdbThumbnailPreview })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});

const WeeklyHeatmap = dynamic(() => import('@/components/weekly-heatmap').then(m => ({ default: m.WeeklyHeatmap })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});

const WeeklyTrendAnalysis = dynamic(() => import('@/components/weekly-trend-analysis').then(m => ({ default: m.WeeklyTrendAnalysis })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});

const EvalDashboard = dynamic(() => import('@/components/eval-dashboard').then(m => ({ default: m.EvalDashboard })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});

const EvalGanttTimeline = dynamic(() => import('@/components/eval-gantt-timeline').then(m => ({ default: m.EvalGanttTimeline })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});

const EvalReportGenerator = dynamic(() => import('@/components/eval-report-generator').then(m => ({ default: m.EvalReportGenerator })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});

const EvalBatchCompare = dynamic(() => import('@/components/EvalBatchCompare').then(m => ({ default: m.EvalBatchCompare })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});

const WeeklyStructureCompare = dynamic(() => import('@/components/weekly-structure-compare').then(m => ({ default: m.WeeklyStructureCompare })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});

const CommandPalette = dynamic(() => import('@/components/command-palette').then(m => ({ default: m.CommandPalette })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});

const DataImportDialog = dynamic(() => import('@/components/DataImportDialog').then(m => ({ default: m.DataImportDialog })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});

const SettingsPanel = dynamic(() => import('@/components/settings-panel').then(m => ({ default: m.SettingsPanel })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});
const SettingsRunPanel = dynamic(() => import('@/components/settings-run-panel').then(m => ({ default: m.SettingsRunPanel })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});

const DbSetupWizard = dynamic(() => import('@/components/db-setup-wizard').then(m => ({ default: m.DbSetupWizard })), {
  ssr: false,
  loading: () => null,
});

const LiteratureRelatedPapers = dynamic(() => import('@/components/literature/LiteratureRelatedPapers').then(m => ({ default: m.LiteratureRelatedPapers })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});

const ReportModal = dynamic(() => import('@/components/ui/pdb-ui').then(m => ({ default: m.ReportModal })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});

const HeaderParticles = dynamic(() => import('@/components/ui/pdb-animated').then(m => ({ default: m.HeaderParticles })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});

const QualityRing = dynamic(() => import('@/components/quality-components').then(m => ({ default: m.QualityRing })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});

const ScrollProgress = dynamic(() => import('@/components/scroll-progress').then(m => ({ default: m.ScrollProgress })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});

const WeekComparison = dynamic(() => import('@/components/week-comparison').then(m => ({ default: m.WeekComparison })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});

const WeeklyActivityFeed = dynamic(() => import('@/components/WeeklyActivityFeed').then(m => ({ default: m.WeeklyActivityFeed })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});

const WeeklyBulkActions = dynamic(() => import('@/components/weekly-bulk-actions').then(m => ({ default: m.WeeklyBulkActions })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});

const CustomToastContainer = dynamic(() => import('@/components/custom-toast').then(m => ({ default: m.CustomToastContainer })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});

const WeeklyDashboardCharts = dynamic(() => import('@/components/weekly-dashboard-charts').then(m => ({ default: m.WeeklyDashboardCharts })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});
const QualityScoreDashboard = dynamic(() => import('@/components/quality-score-dashboard').then(m => ({ default: m.QualityScoreDashboard })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});

const LazyMarkdown = dynamic(
  () => import('@/components/lazy-markdown').then(m => ({ default: m.LazyMarkdown })),
  { ssr: false, loading: () => <div className="animate-pulse h-20 bg-claude-border-light rounded" /> }
);

// ReportMarkdown uses the project's own markdown-renderer (supports 4 table
// formats + strips LLM tool-call leakage) instead of react-markdown, which
// silently dropped GFM tables preceded by Chinese paragraphs.
const ReportMarkdown = dynamic(
  () => import('@/components/report-markdown').then(m => ({ default: m.ReportMarkdown })),
  { ssr: false, loading: () => <div className="animate-pulse h-20 bg-claude-border-light rounded" /> }
);

// ProvenancePanel — Claude Science-inspired "trace every result" panel.
// Shows data sources, LLM call trace, and verified citations for the
// selected evaluation. Lazy-loaded because it pulls in the provenance lib.
const ProvenancePanel = dynamic(
  () => import('@/components/provenance-panel').then(m => ({ default: m.ProvenancePanel })),
  { ssr: false, loading: () => <div className="animate-pulse h-40 bg-claude-border-light rounded" /> }
);

// Skeletons are themselves lazy-loaded so their (small but non-zero) JSX stays
// out of pdb-tracker's main chunk. They render a simple pulse fallback until
// their chunk loads (a few ms — skeletons are React-only, no heavy deps).
// Declared BEFORE WeeklyView/EvaluationView/LiteratureView because those
// dynamic components reference them in `loading` callbacks — keeping the
// declaration order forward avoids any TDZ ambiguity in the closure capture.
// `ModeTransitionWrapper` was previously imported alongside these but had no
// consumers in this file, so it has been dropped rather than converted.
const WeeklyViewSkeleton = dynamic(() => import('@/components/enhanced-skeleton').then(m => ({ default: m.WeeklyViewSkeleton })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});
const EvaluationViewSkeleton = dynamic(() => import('@/components/enhanced-skeleton').then(m => ({ default: m.EvaluationViewSkeleton })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});
const LiteratureViewSkeleton = dynamic(() => import('@/components/enhanced-skeleton').then(m => ({ default: m.LiteratureViewSkeleton })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});

const WeeklyView = dynamic(() => import('@/components/pdb-tracker/weekly-view').then(m => ({ default: m.WeeklyView })), {
  ssr: false,
  loading: () => <WeeklyViewSkeleton />,
});
const EvaluationView = dynamic(() => import('@/components/pdb-tracker/evaluation-view').then(m => ({ default: m.EvaluationView })), {
  ssr: false,
  loading: () => <EvaluationViewSkeleton />,
});
const LiteratureView = dynamic(() => import('@/components/pdb-tracker/literature-view').then(m => ({ default: m.LiteratureView })), {
  ssr: false,
  loading: () => <LiteratureViewSkeleton />,
});
const StructureAnalysisView = dynamic(() => import('@/components/structure-analysis/structure-analysis-view').then(m => ({ default: m.StructureAnalysisView })), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center bg-claude-bg">
      <div className="flex flex-col items-center gap-3 text-claude-text-secondary">
        <div className="relative h-10 w-10">
          <div className="absolute inset-0 rounded-full border-2 border-claude-accent/30" />
          <div className="absolute inset-0 rounded-full border-t-2 border-claude-accent animate-spin" />
        </div>
        <p className="text-xs">Loading Structure Analysis…</p>
      </div>
    </div>
  ),
});

const WeeklyStatCards = dynamic(() => import('@/components/weekly-stat-cards').then(m => ({ default: m.WeeklyStatCards })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});
const SearchDropdownEnhanced = dynamic(() => import('@/components/search-dropdown-enhanced').then(m => ({ default: m.SearchDropdownEnhanced })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-7 w-full max-w-xs" />,
});
const SearchStatusBanner = dynamic(() => import('@/components/search-status-banner').then(m => ({ default: m.SearchStatusBanner })), {
  ssr: false,
  loading: () => null,
});
const ErrorBanner = dynamic(() => import('@/components/error-banner').then(m => ({ default: m.ErrorBanner })), {
  ssr: false,
  loading: () => null,
});
const WeeklyPdbTable = dynamic(() => import('@/components/WeeklyPdbTable').then(m => ({ default: m.WeeklyPdbTable })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});
const LiteratureDateSidebar = dynamic(() => import('@/components/literature/LiteratureDateSidebar').then(m => ({ default: m.LiteratureDateSidebar })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});
const ReadingListSidebar = dynamic(() => import('@/components/literature/LiteratureReadingList').then(m => ({ default: m.ReadingListSidebar })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});
const PaperNotesSection = dynamic(() => import('@/components/literature/LiteraturePaperNotes').then(m => ({ default: m.PaperNotesSection })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});
const TagInput = dynamic(() => import('@/components/literature/LiteraturePaperTags').then(m => ({ default: m.TagInput })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});
const EvalModeSwitcher = dynamic(() => import('@/components/EvalModeSwitcher').then(m => ({ default: m.EvalModeSwitcher })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});
const EvaluationPage = dynamic(() => import('@/components/evaluation-page').then(m => ({ default: m.EvaluationPage })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});
const EvalSummary = dynamic(() => import('@/components/eval-summary').then(m => ({ default: m.EvalSummary })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});
const EvalScoreRadarChart = dynamic(() => import('@/components/eval-score-radar').then(m => ({ default: m.EvalScoreRadarChart })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});
const EvalScoreRadar = dynamic(() => import('@/components/EvalScoreRadar').then(m => ({ default: m.EvalScoreRadar })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});
const EvalScoreBreakdown = dynamic(() => import('@/components/eval-score-breakdown').then(m => ({ default: m.EvalScoreBreakdown })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});
const EvalBatchProgressTracker = dynamic(() => import('@/components/EvalBatchProgressTracker').then(m => ({ default: m.EvalBatchProgressTracker })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});
const WelcomeStateComponent = dynamic(() => import('@/components/welcome-state').then(m => ({ default: m.WelcomeState })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});
const EvalComparison = dynamic(() => import('@/components/eval-comparison').then(m => ({ default: m.EvalComparison })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});
const NotificationBell = dynamic(() => import('@/components/notification-bell').then(m => ({ default: m.NotificationBell })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});
const ScrollToTop = dynamic(() => import('@/components/scroll-to-top').then(m => ({ default: m.ScrollToTop })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});
const BreadcrumbNav = dynamic(() => import('@/components/breadcrumb-nav').then(m => ({ default: m.BreadcrumbNav })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});
const KeyboardHints = dynamic(() => import('@/components/keyboard-hints').then(m => ({ default: m.KeyboardHints })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});
const DropdownMenu = dynamic(() => import('@/components/ui/dropdown-menu').then(m => ({ default: m.DropdownMenu })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});
const DropdownMenuContent = dynamic(() => import('@/components/ui/dropdown-menu').then(m => ({ default: m.DropdownMenuContent })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});
const DropdownMenuItem = dynamic(() => import('@/components/ui/dropdown-menu').then(m => ({ default: m.DropdownMenuItem })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});
const DropdownMenuSeparator = dynamic(() => import('@/components/ui/dropdown-menu').then(m => ({ default: m.DropdownMenuSeparator })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});
const DropdownMenuTrigger = dynamic(() => import('@/components/ui/dropdown-menu').then(m => ({ default: m.DropdownMenuTrigger })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});
const Slider = dynamic(() => import('@/components/ui/slider').then(m => ({ default: m.Slider })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});

const CitationFormatSelector = dynamic(() => import('@/components/literature/CitationFormatSelector').then(m => ({ default: m.CitationFormatSelector })), {
  ssr: false,
  loading: () => <div className="animate-pulse h-20 bg-claude-border-light dark:bg-claude-border/30 rounded" />,
});

// ─── Lazy-loaded sibling components (extracted from static imports to keep
//     pdb-tracker's first-compile graph small — see worklog task
//     `qa-deep-lazy-load-siblings`). Each pulls framer-motion / sonner /
//     ui/* only when actually rendered. ────────────────────────────────────────

const WeeklyPageControls = dynamic(() => import('@/components/weekly-page').then(m => ({ default: m.WeeklyPageControls })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-10 w-full" />,
});
const EvalPageControls = dynamic(() => import('@/components/EvalPageControls').then(m => ({ default: m.EvalPageControls })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-10 w-full" />,
});
const TourOverlay = dynamic(() => import('@/components/tour-overlay').then(m => ({ default: m.TourOverlay })), {
  ssr: false,
  loading: () => null,
});
const EnhancedFooter = dynamic(() => import('@/components/enhanced-footer').then(m => ({ default: m.EnhancedFooter })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-10 w-full" />,
});

// ─── Mode Tab Config ──────────────────────────────────────────────────────────

const MODE_TABS: { mode: Mode; label: string; labelCn: string; icon: React.ReactNode; shortcut: string }[] = [
  { mode: 'weekly', label: 'Weekly', labelCn: '周报', icon: <Database className="h-4 w-4" />, shortcut: '1' },
  { mode: 'evaluation', label: 'Evaluation', labelCn: '评估', icon: <FlaskConical className="h-4 w-4" />, shortcut: '2' },
  { mode: 'literature', label: 'Literature', labelCn: '文献', icon: <BookOpen className="h-4 w-4" />, shortcut: '3' },
  { mode: 'analysis', label: 'Analysis', labelCn: '分析', icon: <Microscope className="h-4 w-4" />, shortcut: '4' },
];

// ─── MiniSparkline Component ────────────────────────────────────────────────────

let sparklineCounter = 0;

function MiniSparkline({ data, width = 60, height = 20, globalMin, globalMax }: { data: number[]; width?: number; height?: number; globalMin?: number; globalMax?: number }) {
  const [uid] = useState(() => `sg${++sparklineCounter}`);
  if (!data || data.length < 2) return null;

  // When globalMin/globalMax are provided, use them as the y-axis range so
  // neighbouring cards (sharing 4 of 5 data points) render with matching
  // y-coordinates and look visibly similar. Otherwise fall back to per-card
  // min/max (each card normalizes independently).
  const min = globalMin ?? Math.min(...data);
  const max = globalMax ?? Math.max(...data);
  const range = max - min || 1;
  const padding = 2;
  const usableH = height - padding * 2;
  const usableW = width - padding * 2;

  const points = data.map((v, i) => {
    const x = padding + (i / (data.length - 1)) * usableW;
    const y = height - padding - ((v - min) / range) * usableH;
    return `${x},${y}`;
  });

  const linePath = `M${points.join(' L')}`;

  // Gradient fill area (close the path to the bottom)
  const fillPath = `${linePath} L${padding + usableW},${height - padding} L${padding},${height - padding} Z`;

  return (
    <svg width={width} height={height} className="flex-shrink-0" style={{ overflow: 'visible' }}>
      <defs>
        <linearGradient id={uid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#c96442" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#c96442" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={fillPath} fill={`url(#${uid})`} />
      <path d={linePath} fill="none" stroke="#c96442" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── AI Analysis Types ────────────────────────────────────────────────────────

/** State machine for the first-run DB check.
 *  - "checking" — initial fetch is in flight; wait for it
 *  - "done"     — fetch has completed and we made an open/no-open decision
 *  Re-checked after the tour finishes (see useEffect below) so that an
 *  unconfirmed DB still surfaces the wizard even when the tour was skipped. */
type DbCheckState = 'checking' | 'done'

interface AiAnalysisSection {
  id: string;
  title: string;
  icon: string;
  color: string;
  content: string;
}

interface AiAnalysisResult {
  sections: AiAnalysisSection[];
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function PdbTracker() {
  const { theme, setTheme } = useTheme();
  const { t, locale } = useI18n();
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );

  // ── First-run DB setup wizard ───────────────────────────────────────────
  // On mount, fetch /api/db-config to check whether the user has confirmed a
  // non-test database. If they haven't, pop the setup wizard so they pick or
  // create one. The wizard writes to .hermes/db-config.json + recreates the
  // PrismaClient, so all 3 modules (literature / eval / weekly) and the Run
  // Center immediately read/write the same DB.
  const [dbWizardOpen, setDbWizardOpen] = useState(false);
  const [dbWizardAllowSkip, setDbWizardAllowSkip] = useState(true);
  // First-run DB check state machine:
  //   • "checking" — initial /api/db-config fetch in flight, wait
  //   • "done"     — fetch returned and we've decided whether to open wizard
  // During the tour we defer the open/no-open decision so the post-tour
  // re-check can act (covers tour-skipped and tour-closed-early cases).
  const [dbWizardChecked, setDbWizardChecked] = useState<DbCheckState>('checking');
  // True once /api/db-config reports confirmed=true AND hasSchema=true.
  // Drives `skipDbStep` for the tour and gates the "force setup on first
  // run" branch in the effect below.
  const [hasConfirmedDb, setHasConfirmedDb] = useState(false);

  // Mode state
  const [mode, setMode] = useState<Mode>('weekly');

  // Weekly data
  const [entries, setEntries] = useState<PdbEntry[]>([]);
  // DB-side total + hasMore flag. The front-end loads up to 10000 entries
  // in one shot (for sorting + heatmap), but the DB may have more. These
  // two fields drive the "共 X 条 · 已加载 Y 条 [加载更多]" affordance in
  // the pagination bar so the user knows there's more data and can fetch it.
  const [entriesTotal, setEntriesTotal] = useState(0);
  const [entriesHasMore, setEntriesHasMore] = useState(false);
  const [snapshots, setSnapshots] = useState<WeeklySnapshot[]>([]);
  const [selectedSnapshot, setSelectedSnapshot] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Evaluation data
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const [allEvaluations, setAllEvaluations] = useState<Evaluation[]>([]);
  const [evalBatches, setEvalBatches] = useState<EvalBatch[]>([]);
  const [batchSubTargets, setBatchSubTargets] = useState<Record<string, EvalBatchSubTarget[]>>({});
  const [selectedEvalId, setSelectedEvalId] = useState<string | null>(null);
  const [selectedEval, setSelectedEval] = useState<Evaluation | null>(null);
  const [evalLoading, setEvalLoading] = useState(true);
  // Batch detail integration — when a batch is selected (and no individual
  // sub-target is open) the detail panel renders EvaluationView in its
  // batch sub-view mode (see EvaluationView's `evalSubView === 'batch'`).
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  // Lazy per-batch fetched evaluations (full Evaluation objects keyed by
  // uniprotId). Currently the /api/evaluations endpoint already returns full
  // data for every evaluation (including batch members) via `allEvaluations`,
  // so this map is kept as an empty fallback for EvaluationView's optional
  // per-uniprot lookup path (see evaluation-view.tsx L509/L535/L617/L761).
  // NOTE: `BatchPreviewContent.tsx` (a previous consumer candidate) was
  // removed as dead code in task `cleanup-dead-code` — it was never wired
  // up to any render path.
  const [batchFetchedEvals] = useState<Record<string, Evaluation>>({});

  // Literature data
  const [litStats, setLitStats] = useState<LitStats | null>(null);
  const [litPapers, setLitPapers] = useState<LitPaper[]>([]);
  const [litReports, setLitReports] = useState<LitReport[]>([]);
  const [litLoading, setLitLoading] = useState(true);
  const [litSelectedPaper, setLitSelectedPaper] = useState<LitPaper | null>(null);
  const [litIsDetailOpen, setLitIsDetailOpen] = useState(false);
  const [litShowCharts, setLitShowCharts] = useState(false);
  const [litSelectedDate, setLitSelectedDate] = useState<string | null>(null);

  // UI state
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState<string>('releaseDate');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [detailPanelOpen, setDetailPanelOpen] = useState(false);
  const [selectedEntry, setSelectedEntry] = useState<PdbEntry | null>(null);
  const [litPdbSelected, setLitPdbSelected] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<string>('all');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // showSummary removed (AI Weekly Summary feature removed)
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showTrend, setShowTrend] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);
  const [showQualityDist, setShowQualityDist] = useState(false);
  const [showWeekCompare, setShowWeekCompare] = useState(false);
  const [showDashboard, setShowDashboard] = useState(false);
  const [weeklyDateFilter, setWeeklyDateFilter] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Mobile search overlay state
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);

  // Weekly detail panel AI analysis
  const [aiAnalysis, setAiAnalysis] = useState<AiAnalysisResult | null>(null);
  const [aiAnalysisLoading, setAiAnalysisLoading] = useState(false);

  // Literature detail panel AI summary
  const [litAiSummary, setLitAiSummary] = useState<string | null>(null);
  const [litAiSummaryLoading, setLitAiSummaryLoading] = useState(false);

  // Reading lists
  const readingListState = useReadingLists();
  const [litReadingListFilter, setLitReadingListFilter] = useState<string | null>(null);

  // Paper notes
  const paperNotesState = usePaperNotes();
  const [litOpenNotePmid, setLitOpenNotePmid] = useState<string | null>(null);

  // Paper tags
  const paperTagsState = usePaperTags();
  const [litTagFilter, setLitTagFilter] = useState<string | null>(null);

  // Literature source filter (日报)
  const [litSourceFilter, setLitSourceFilter] = useState<'all' | 'daily'>('all');

  // Literature IF filter
  const [litIfFilter, setLitIfFilter] = useState<'all' | '5' | '10' | '20'>('all');

  // Reading progress
  const readingProgressState = useReadingProgress();

  // Bookmarks with localStorage persistence
  const [bookmarks, updateBookmarks] = useLocalStorageSet('pdb-bookmarks');

  // Structure notes with localStorage persistence
  const [structureNotes, setStructureNotes] = useState<Record<string, string>>(() => {
    if (typeof window === 'undefined') return {};
    try { return JSON.parse(localStorage.getItem('pdb-structure-notes') || '{}'); } catch { return {}; }
  });
  const addNote = useCallback((pdbId: string, note: string) => {
    setStructureNotes(prev => {
      const next = { ...prev, [pdbId]: note };
      try { localStorage.setItem('pdb-structure-notes', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);
  const updateNote = useCallback((pdbId: string, note: string) => {
    setStructureNotes(prev => {
      const next = { ...prev, [pdbId]: note };
      try { localStorage.setItem('pdb-structure-notes', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);
  const deleteNote = useCallback((pdbId: string) => {
    setStructureNotes(prev => {
      const next = { ...prev };
      delete next[pdbId];
      try { localStorage.setItem('pdb-structure-notes', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  // Annotation tags with localStorage persistence
  const [annotations, setAnnotations] = useState<Record<string, { tags: string[]; notes: string }>>(() => {
    if (typeof window === 'undefined') return {};
    try { return JSON.parse(localStorage.getItem('pdb-annotations') || '{}'); } catch { return {}; }
  });
  const addTag = useCallback((pdbId: string, tag: string) => {
    setAnnotations(prev => {
      const existing = prev[pdbId] || { tags: [], notes: '' };
      if (existing.tags.includes(tag)) return prev;
      const next = { ...prev, [pdbId]: { ...existing, tags: [...existing.tags, tag] } };
      try { localStorage.setItem('pdb-annotations', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);
  const removeTag = useCallback((pdbId: string, tag: string) => {
    setAnnotations(prev => {
      const existing = prev[pdbId] || { tags: [], notes: '' };
      const next = { ...prev, [pdbId]: { ...existing, tags: existing.tags.filter(t => t !== tag) } };
      try { localStorage.setItem('pdb-annotations', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  // Search input ref for keyboard shortcut
  const searchInputRef = useRef<HTMLInputElement>(null);
  // Wrapper ref around the search input — used as the tour spotlight target
  // for the "Search & Shortcuts" step (step index 7).
  const searchWrapRef = useRef<HTMLDivElement>(null);

  // Mode tab refs for segmented control sliding pill
  const modeTabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const modeTabContainerRef = useRef<HTMLDivElement>(null);
  const [modePillStyle, setModePillStyle] = useState<{ left: number; width: number }>({ left: 0, width: 0 });

  // Measure active tab position for sliding pill indicator
  useEffect(() => {
    const updatePill = () => {
      const activeTab = modeTabRefs.current[mode];
      const container = modeTabContainerRef.current;
      if (activeTab && container) {
        const containerRect = container.getBoundingClientRect();
        const tabRect = activeTab.getBoundingClientRect();
        setModePillStyle({
          left: tabRect.left - containerRect.left,
          width: tabRect.width,
        });
      }
    };
    // Double rAF ensures the browser has completed reflow after font-weight change
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(updatePill);
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
    };
  }, [mode]);

  // Main content scroll container ref for scroll-to-top
  const mainContentRef = useRef<HTMLDivElement>(null);

  // Command palette state
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  // Weekly report modal state
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [selectedReport, setSelectedReport] = useState<{ title: string; content: string } | null>(null);
  const [weeklyReports, setWeeklyReports] = useState<WeeklyReport[]>([]);

  // Evaluation detail tab state
  const [evalDetailTab, setEvalDetailTab] = useState('Summary');
  const [weeklyDetailTab, setWeeklyDetailTab] = useState<'overview' | 'structure' | 'analysis' | 'notes'>('overview');
  const [selectedEvalStructure, setSelectedEvalStructure] = useState<EvalRow | null>(null);
  const [evalReportContent, setEvalReportContent] = useState<string>('');

  // Evaluation sub-view state (default / compare / dashboard / timeline)
  const [evalSubView, setEvalSubView] = useState<'default' | 'compare' | 'dashboard' | 'timeline' | 'batch'>('default');

  // Evaluation report generator state
  const [evalReportOpen, setEvalReportOpen] = useState(false);

  // Evaluation filter state
  const [evalFilter, setEvalFilter] = useState<string>('all');
  const [evalSortField, setEvalSortField] = useState<string>('uniprotId');
  const [evalSortDir, setEvalSortDir] = useState<'asc' | 'desc'>('asc');

  // Weekly batch selection state
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(new Set());
  const [compareMode, setCompareMode] = useState(false);

  // Settings panel state
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Keyboard hints overlay state
  const [keyboardHintsOpen, setKeyboardHintsOpen] = useState(false);

  // Welcome state - shown initially until user interacts
  const [showWelcome, setShowWelcome] = useState(true);

  // Data import dialog state
  const [importDialogOpen, setImportDialogOpen] = useState(false);

  // Weekly diff compare modal state
  const [weeklyDiffOpen, setWeeklyDiffOpen] = useState(false);


  // 3D viewer modal state
  const [viewerModalPdbId, setViewerModalPdbId] = useState<string | null>(null);
  const [viewerModalOpen, setViewerModalOpen] = useState(false);

  // Back-to-top visibility state
  const [showBackToTop, setShowBackToTop] = useState(false);

  // Data freshness timestamp
  const [dataFetchedAt, setDataFetchedAt] = useState<Date | null>(null);

  // Refreshing state for footer + header button
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Track which modes have had their data fetched to avoid re-fetching
  const fetchedModesRef = useRef<Set<Mode>>(new Set());

  // Keyboard navigation: highlighted row in weekly table
  const [highlightedRowId, setHighlightedRowId] = useState<string | null>(null);

  const {
    settings: appSettings,
    updateSetting,
    updateSettings,
    resetSettings,
    toggleActivityType,
  } = useAppSettings();

  const isDark = theme === 'dark';

  // ─── Keyboard Shortcuts ──────────────────────────────────────────────────

  useKeyboardShortcuts({
    onModeSwitch: (newMode) => {
      setMode(newMode);
      setCurrentPage(1);
      setActiveFilter('all');
      setSearchQuery('');
      setSelectedEvalId(null);
      setSelectedEval(null);
      setSelectedEvalStructure(null);
      setDetailPanelOpen(false);
      setLitIsDetailOpen(false);
      setLitSelectedPaper(null);
      setLitPdbSelected(null);
      setHighlightedRowId(null);
    },
    onCloseDetailPanel: () => {
      setDetailPanelOpen(false);
      setSelectedEvalStructure(null);
      setLitIsDetailOpen(false);
    },
    onOpenCommandPalette: () => {
      setCommandPaletteOpen(true);
    },
    onToggleKeyboardHints: () => {
      setKeyboardHintsOpen(prev => !prev);
    },
    onFocusSearch: () => {
      searchInputRef.current?.focus();
    },
    onNavigateRow: (direction) => {
      if (mode !== 'weekly' || paginatedEntries.length === 0) return;
      const currentIdx = paginatedEntries.findIndex(e => e.pdbId === highlightedRowId);
      let newIdx: number;
      if (currentIdx < 0) {
        newIdx = direction === 'down' ? 0 : paginatedEntries.length - 1;
      } else {
        newIdx = direction === 'down' ? Math.min(currentIdx + 1, paginatedEntries.length - 1) : Math.max(currentIdx - 1, 0);
      }
      setHighlightedRowId(paginatedEntries[newIdx].pdbId);
      // Scroll the row into view
      const rowEl = document.querySelector(`[data-pdb-id="${paginatedEntries[newIdx].pdbId}"]`);
      rowEl?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    },
    onOpenHighlightedRow: () => {
      if (highlightedRowId && mode === 'weekly') {
        const entry = paginatedEntries.find(e => e.pdbId === highlightedRowId);
        if (entry) {
          setSelectedEntry(entry);
          setDetailPanelOpen(true);
        }
      }
    },
    onToggleBookmarkHighlighted: () => {
      if (highlightedRowId && mode === 'weekly') {
        toggleBookmark(highlightedRowId);
      }
    },
    onExportCurrentView: () => {
      handleExportCurrentView();
    },
    onToggleTheme: () => {
      setTheme(isDark ? 'light' : 'dark');
    },
    onCloseAllModals: () => {
      setSettingsOpen(false);
      setImportDialogOpen(false);
      setReportModalOpen(false);
      setKeyboardHintsOpen(false);
      setCommandPaletteOpen(false);
      setEvalReportOpen(false);
      setViewerModalOpen(false);
      setWeeklyDiffOpen(false);
      setMobileSearchOpen(false);
    },
    enabled: true,
  });

  // ─── Data Fetching ────────────────────────────────────────────────────────

  // Error state for retry UI
  const [fetchError, setFetchError] = useState<string | null>(null);

  /** Check if an error is likely caused by missing/unconfigured database. */
  const isDbError = (err: any): boolean => {
    const msg = err instanceof Error ? err.message : String(err);
    return /HTTP 500|no such table|database.*not.*found|P2021|P2003/i.test(msg);
  };
  const dbErrorMsg = t.dbNotConfigured;

  // Non-intrusive toast notification for fetch errors — replaces the old
  // full-width error banners that disrupted the page layout. The toast
  // appears in the corner and auto-dismisses, with action buttons for
  // retry / open-run-center.
  useEffect(() => {
    if (!fetchError || loading || dbWizardOpen) return;
    const isDb = fetchError === dbErrorMsg;
    toast.error(isDb ? t.dbNotConfiguredShort : t.dataLoadFailed, {
      description: fetchError,
      duration: 6000,
      action: isDb ? {
        label: t.openRunCenter,
        onClick: () => { setFetchError(null); setRunCenterOpen(true); },
      } : {
        label: t.retry,
        onClick: () => { setFetchError(null); fetchSnapshots(); fetchEntries(); },
      },
    });
  }, [fetchError, loading, dbWizardOpen, dbErrorMsg, t, locale]);

  // Track whether fallback data is being used
  const [usingFallbackData, setUsingFallbackData] = useState(false);

  const fetchSnapshots = useCallback(async () => {
    try {
      const res = await queuedFetchWithRetry('/api/snapshots');
      if (res.ok) {
        const data = await res.json();
        setSnapshots(data);
        if (data.length > 0 && !selectedSnapshot) {
          setSelectedSnapshot(data[0].weekId);
        }
        setUsingFallbackData(false);
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err) {
      console.error('Failed to fetch snapshots:', err);
      setSnapshots([]);
      setUsingFallbackData(false);
      setFetchError(isDbError(err) ? dbErrorMsg : `${t.loadSnapshotsFailed}: ${err instanceof Error ? err.message : t.networkError}`);
    }
  }, [selectedSnapshot]);

  const fetchEntries = useCallback(async (week?: string, method?: string, q?: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (week) params.set('week', week);
      if (method && method !== 'all') params.set('method', method);
      if (q) params.set('q', q);
      params.set('limit', '10000');
      const res = await queuedFetchWithRetry(`/api/entries?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        // Support both wrapped {total,limit,offset,entries} and legacy array response
        const arr = Array.isArray(data) ? data : (data.entries ?? []);
        setEntries(arr);
        setEntriesTotal(typeof data.total === 'number' ? data.total : arr.length);
        setEntriesHasMore(!!data.hasMore);
        setUsingFallbackData(false);
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err) {
      console.error('Failed to fetch entries:', err);
      setEntries([]);
      setEntriesTotal(0);
      setEntriesHasMore(false);
      setUsingFallbackData(false);
      setFetchError(isDbError(err) ? dbErrorMsg : `${t.loadEntriesFailed}: ${err instanceof Error ? err.message : t.networkError}`);
    } finally {
      setLoading(false);
      setShowWelcome(false);
    }
  }, []);

  // Load the next batch of entries (append to existing). Triggered by the
  // "加载更多" button in the pagination bar when entriesHasMore is true.
  const [loadingMore, setLoadingMore] = useState(false);
  const loadMoreEntries = useCallback(async () => {
    if (loadingMore || !entriesHasMore) return;
    setLoadingMore(true);
    try {
      const params = new URLSearchParams();
      // Re-apply the same week/method/q filters used by the last fetchEntries
      // call so the appended batch is from the same result set.
      if (selectedSnapshot) params.set('week', selectedSnapshot);
      params.set('limit', '10000');
      params.set('offset', String(entries.length));
      const res = await queuedFetchWithRetry(`/api/entries?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        const arr = Array.isArray(data) ? data : (data.entries ?? []);
        setEntries(prev => [...prev, ...arr]);
        setEntriesHasMore(!!data.hasMore);
      }
    } catch (err) {
      console.error('Failed to load more entries:', err);
    } finally {
      setLoadingMore(false);
    }
  }, [loadingMore, entriesHasMore, entries.length, selectedSnapshot]);

  const fetchEvaluations = useCallback(async () => {
    setEvalLoading(true);
    try {
      const res = await queuedFetchWithRetry('/api/evaluations');
      if (res.ok) {
        const data = await res.json();
        const ensureArrays = (evals: any[]) => (evals || []).map((e: any) => ({
          ...e,
          pdbStructures: e.pdbStructures || [],
          blastResults: e.blastResults || [],
        }));
        setEvaluations(ensureArrays(data.individualEvals));
        setAllEvaluations(ensureArrays(data.allEvaluations));
        setEvalBatches(data.batches || []);
        setBatchSubTargets(data.batchSubTargets || {});
        setUsingFallbackData(false);
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err) {
      console.error('Failed to fetch evaluations:', err);
      setEvaluations([]);
      setAllEvaluations([]);
      setEvalBatches([]);
      setBatchSubTargets({});
      setUsingFallbackData(false);
      setFetchError(isDbError(err) ? dbErrorMsg : `${t.loadEvaluationsFailed}: ${err instanceof Error ? err.message : t.networkError}`);
    } finally {
      setEvalLoading(false);
    }
  }, []);

  const fetchEvalDetail = useCallback(async (uniprotId: string) => {
    try {
      const res = await queuedFetchWithRetry(`/api/evaluations/${uniprotId}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedEval({
          ...data,
          pdbStructures: data.pdbStructures || [],
          blastResults: data.blastResults || [],
        });
        return;
      }
    } catch (err) {
      console.error('Failed to fetch evaluation detail:', err);
    }
    // Fallback: try to find the evaluation in already-loaded data
    const found = allEvaluations.find(e => e.uniprotId === uniprotId);
    if (found) {
      setSelectedEval({
        ...found,
        pdbStructures: found.pdbStructures || [],
        blastResults: found.blastResults || [],
      });
    }
  }, [allEvaluations]);

  // ─── Batch selection handlers ────────────────────────────────────────────
  // Clicking a batch row in the sidebar opens the batch detail panel (instead
  // of just auto-selecting the first sub-target). The selectedBatchId is kept
  // while the user navigates into a sub-target so the "Back to batch" UX works.
  const handleSelectBatch = useCallback((batchId: string) => {
    setSelectedBatchId(batchId);
    setSelectedEvalId(null);
    setSelectedEval(null);
    setSelectedEvalStructure(null);
    setEvalSubView('default');
    setEvalDetailTab('Summary');
    setDetailPanelOpen(true);
  }, []);

  const handleSelectBatchSubTarget = useCallback((batchId: string, uniprotId: string) => {
    setSelectedBatchId(batchId);
    setSelectedEvalId(uniprotId);
    setSelectedEvalStructure(null);
    setEvalDetailTab('Summary');
    setDetailPanelOpen(true);
  }, []);

  const handleSelectSubTarget = useCallback((uniprotId: string) => {
    setSelectedEvalId(uniprotId);
    setSelectedEvalStructure(null);
    setDetailPanelOpen(true);
  }, []);

  // Open a full-screen / modal view of the batch LLM report. We piggy-back on
  // the existing `selectedReport` state used elsewhere for weekly reports so we
  // don't need a new piece of UI infrastructure.
  const handleOpenBatchReport = useCallback((batchId: string, title: string) => {
    const batch = evalBatches.find(b => b.batchId === batchId);
    if (!batch) return;
    setSelectedReport({
      title: title || batch.title || 'Batch Report',
      content: batch.combinedReport || '_(No cross-target report was generated for this batch.)_',
    });
    setReportModalOpen(true);
  }, [evalBatches]);

  // Right-click → Delete Evaluation. Calls the DELETE endpoint, then refreshes
  // the evaluation list and clears any dangling selection state.
  const handleDeleteEval = useCallback(async (uniprotId: string) => {
    const confirmed = window.confirm(
      `Delete evaluation ${uniprotId}?\n\nThis will permanently remove the evaluation row, its PDB structures, BLAST results, and any saved Skill reports.`
    );
    if (!confirmed) return;
    try {
      const res = await queuedFetchWithRetry(`/api/evaluations/${uniprotId}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody?.error || `HTTP ${res.status}`);
      }
      toast.success(`Deleted evaluation ${uniprotId}`);
      // Clear selection if we just deleted the currently-selected eval
      if (selectedEvalId === uniprotId) {
        setSelectedEvalId(null);
        setSelectedEval(null);
        setSelectedEvalStructure(null);
        setSelectedBatchId(null);
        setDetailPanelOpen(false);
      }
      // Refresh evaluation list (fetchEvaluations is defined above and is a
      // stable useCallback, so we can safely call it directly).
      await fetchEvaluations();
    } catch (err) {
      console.error('Failed to delete evaluation:', err);
      toast.error('Failed to delete evaluation', {
        description: err instanceof Error ? err.message : 'unknown error',
      });
    }
  }, [selectedEvalId, fetchEvaluations]);

  // Delete an entire batch + all its sub-target evaluations.
  const handleDeleteBatch = useCallback(async (batchId: string) => {
    const batch = evalBatches.find(b => b.batchId === batchId);
    const subTargets = batchSubTargets[batchId] || [];
    const confirmed = window.confirm(
      `Delete batch "${batch?.title || batchId}"?\n\nThis will permanently remove ${subTargets.length} evaluation(s), their PDB structures, BLAST results, and the cross-target report.`
    );
    if (!confirmed) return;
    try {
      // Delete each sub-target evaluation
      for (const sub of subTargets) {
        await queuedFetchWithRetry(`/api/evaluations/${sub.uniprotId}`, { method: 'DELETE' });
      }
      // Delete the batch record itself
      await queuedFetchWithRetry(`/api/evaluations/batch/${batchId}`, { method: 'DELETE' });
      toast.success(`Deleted batch ${batchId}`);
      setSelectedBatchId(null);
      setSelectedEvalId(null);
      setSelectedEval(null);
      setSelectedEvalStructure(null);
      setDetailPanelOpen(false);
      await fetchEvaluations();
    } catch (err) {
      console.error('Failed to delete batch:', err);
      toast.error('Failed to delete batch', {
        description: err instanceof Error ? err.message : 'unknown error',
      });
    }
  }, [evalBatches, batchSubTargets, fetchEvaluations]);

  const fetchLitStats = useCallback(async () => {
    try {
      const res = await queuedFetchWithRetry('/api/literature/stats');
      if (res.ok) {
        const data = await res.json();
        setLitStats(data);
        setUsingFallbackData(false);
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err) {
      console.error('Failed to fetch lit stats:', err);
      setLitStats(null);
      setUsingFallbackData(false);
      setFetchError(isDbError(err) ? dbErrorMsg : `${t.loadLitStatsFailed}: ${err instanceof Error ? err.message : t.networkError}`);
    }
  }, []);

  const fetchLitPapers = useCallback(async (q?: string) => {
    setLitLoading(true);
    try {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      const res = await queuedFetchWithRetry(`/api/literature/papers?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setLitPapers(Array.isArray(data) ? data : []);
        setUsingFallbackData(false);
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err) {
      console.error('Failed to fetch lit papers:', err);
      setLitPapers([]);
      setUsingFallbackData(false);
      setFetchError(isDbError(err) ? dbErrorMsg : `${t.loadPapersFailed}: ${err instanceof Error ? err.message : t.networkError}`);
    } finally {
      setLitLoading(false);
    }
  }, []);

  const fetchLitReports = useCallback(async () => {
    try {
      const res = await queuedFetchWithRetry('/api/literature/reports');
      if (res.ok) {
        const data = await res.json();
        setLitReports(Array.isArray(data) ? data : []);
        setUsingFallbackData(false);
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err) {
      console.error('Failed to fetch lit reports:', err);
      setLitReports([]);
      setUsingFallbackData(false);
      setFetchError(isDbError(err) ? dbErrorMsg : `${t.loadLitReportsFailed}: ${err instanceof Error ? err.message : t.networkError}`);
    }
  }, []);

  const fetchReports = useCallback(async () => {
    try {
      const res = await queuedFetchWithRetry('/api/reports?type=weekly_summary');
      if (res.ok) {
        const data = await res.json();
        setWeeklyReports(Array.isArray(data) ? data : []);
        setUsingFallbackData(false);
      } else {
        throw new Error(`HTTP ${res.status}`);
      }
    } catch (err) {
      console.error('Failed to fetch reports:', err);
      setWeeklyReports([]);
      setUsingFallbackData(false);
      setFetchError(isDbError(err) ? dbErrorMsg : `${t.loadWeeklyReportsFailed}: ${err instanceof Error ? err.message : t.networkError}`);
    }
  }, []);

  const fetchAiAnalysis = useCallback(async (entry: PdbEntry) => {
    setAiAnalysisLoading(true);
    setAiAnalysis(null);
    try {
      const res = await queuedFetchWithRetry('/api/ai-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pdbId: entry.pdbId,
          title: entry.title,
          method: entry.method,
          resolution: entry.resolution,
          organism: entry.organisms,
          journal: entry.journal,
          journalIf: entry.journalIf,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setAiAnalysis(data);
      }
    } catch (err) {
      console.error('Failed to fetch AI analysis:', err);
    } finally {
      setAiAnalysisLoading(false);
    }
  }, []);

  // ─── Literature AI Summary ───────────────────────────────────────────────

  const fetchLitAiSummary = useCallback(async (paper: LitPaper) => {
    setLitAiSummaryLoading(true);
    setLitAiSummary(null);
    try {
      const res = await queuedFetchWithRetry('/api/ai-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pdbId: paper.pdbs?.[0]?.pdbId || '',
          title: paper.title,
          method: paper.pdbs?.[0]?.method || '',
          abstract: paper.abstract,
          journal: paper.journal,
          journalIf: paper.IF,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setLitAiSummary(data.summary || data.content || null);
        toast.success('AI Summary generated', { description: 'Summary is ready to view' });
      }
    } catch (err) {
      console.error('Failed to fetch AI summary:', err);
    } finally {
      setLitAiSummaryLoading(false);
    }
  }, []);

  // ─── Effects ──────────────────────────────────────────────────────────────

  // ── Onboarding tour ──────────────────────────────────────────────────
  // Auto-starts on first visit (desktop only) when localStorage flag is
  // missing. The mode switcher + search input are spotlighted; all other
  // steps render as centered tooltips. The 「帮助」 button in the top bar
  // calls `startTour()` to re-trigger the tour on demand.
  const runCenterContentRef = useRef<HTMLDivElement>(null);
  const dbWizardContentRef = useRef<HTMLDivElement>(null);
  const tabContentRef = useRef<HTMLDivElement>(null);
  // Run Center controlled state (for tour integration) — declared BEFORE useTour
  const [runCenterOpen, setRunCenterOpen] = useState(false);
  const [runCenterTab, setRunCenterTab] = useState('evaluation');
  const {
    tourActive,
    tourStep,
    setTourStep,
    nextStep: tourNextStep,
    prevStep: tourPrevStep,
    finishTour,
    startTour,
    steps: tourSteps,
  } = useTour({
    mounted,
    refs: {
      modeSwitcherRef: modeTabContainerRef,
      searchRef: searchWrapRef,
      dbWizardContentRef,
      runCenterContentRef,
      tabContentRef,
    },
    onOpenDbWizard: () => setDbWizardOpen(true),
    onCloseDbWizard: () => setDbWizardOpen(false),
    onOpenRunCenter: (tab) => {
      setRunCenterOpen(true);
      // Switch to the requested tab so each module step (eval / lit /
      // weekly) shows its own panel inside the open Run Center dialog.
      if (tab) setRunCenterTab(tab);
    },
    onCloseRunCenter: () => setRunCenterOpen(false),
    onSwitchTab: (tab) => setRunCenterTab(tab),
    onSwitchEval: () => setRunCenterTab('evaluation'),
    onSwitchLit: () => setRunCenterTab('literature'),
    onSwitchWeekly: () => setRunCenterTab('weekly'),
    // Skip the "数据库配置" tour step when the user already has a confirmed
    // DB. Re-derived from `dbWizardChecked` + the cached `hasConfirmedDb`.
    // See the first-run DB check effect below.
    skipDbStep: dbWizardChecked === 'done' && hasConfirmedDb,
  });

  // ── First-run DB check ────────────────────────────────────────────────
  // We always want to make sure the user lands on a configured DB.
  //
  // Decision matrix:
  //   • dbWizardChecked === "checking"   — initial fetch in flight, wait
  //   • dbWizardChecked === "done"       — fetch finished, decision made
  //
  // During the tour we MAY skip the wizard (step 2 opens it on its own), so
  // we re-check when `tourActive` flips to false: if the tour was skipped or
  // closed early, we still need to surface the wizard for an unconfirmed DB.
  //
  // The key fix vs. the previous logic: we only flip `dbWizardChecked` from
  // "checking" → "done" when the fetch has actually returned AND we've
  // decided whether to open the wizard. During the tour, the fetch return
  // leaves the decision open so the tour-finished re-check can act.

  // Re-check the DB state whenever the tour finishes. If we deferred the
  // decision (tour was running while the initial fetch resolved) or the
  // user closed the wizard without confirming, we want to re-open it here.
  //
  // IMPORTANT: this re-check MUST run regardless of `dbWizardChecked`. The
  // previous version bailed out when `dbWizardChecked === 'checking'`, which
  // meant that if the tour finished while the initial /api/db-config fetch
  // was still in flight, the wizard never surfaced — the user was left on
  // the main UI with no confirmed DB and no way to set one up except
  // manually opening settings. We now always perform a fresh fetch here so
  // the post-tour DB gate is reliable.
  const recheckDbAfterTour = useCallback(async () => {
    try {
      const res = await fetch('/api/db-config')
      const data = await res.json()
      const confirmedOk = !!data.confirmed && !!data.hasSchema
      setHasConfirmedDb(confirmedOk)
      const needsSetup = !confirmedOk
      if (needsSetup) {
        setDbWizardAllowSkip(false) // force DB setup on first run — cannot skip
        setDbWizardOpen(true)
      }
    } catch {
      /* network error — don't block the app */
    }
  }, [])

  useEffect(() => {
    if (dbWizardChecked !== 'checking') return
    // While the tour is running we still need to read the DB state so we
    // know whether to skip step 2 — but we must NOT auto-open the wizard
    // here (the tour step 2 opens it itself).
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/db-config')
        const data = await res.json()
        if (cancelled) return
        const confirmedOk = !!data.confirmed && !!data.hasSchema
        setHasConfirmedDb(confirmedOk)
        const needsSetup = !confirmedOk
        if (tourActive) {
          // Defer: tour will either skip (already-confirmed DB) or open it
          // itself via step 2's onEnter=openDbWizard. Re-check after tour.
          return
        }
        if (needsSetup) {
          setDbWizardAllowSkip(false)
          setDbWizardOpen(true)
        }
      } catch {
        /* ignore — server may be cold-starting */
      } finally {
        if (!cancelled) setDbWizardChecked('done')
      }
    })()
    return () => { cancelled = true }
  }, [dbWizardChecked, tourActive])

  // When the tour finishes (tourActive flips false), re-check the DB state
  // and force-open the wizard if no DB is confirmed. This runs on EVERY
  // tourActive→false transition: normal completion (step 9 "完成"), skip
  // (X button / Esc / "跳过"), and the auto-start that never fired because
  // the tour was already completed. We intentionally do NOT bail on
  // dbWizardChecked==='checking' — recheckDbAfterTour does its own fresh
  // fetch, so it is safe to run at any time. A short debounce (120ms) avoids
  // racing with the tour's own dialog-cleanup setState.
  useEffect(() => {
    if (tourActive) return
    const timer = setTimeout(() => {
      void recheckDbAfterTour()
    }, 120)
    return () => clearTimeout(timer)
  }, [tourActive, recheckDbAfterTour])

  // Apply saved settings on first load
  useEffect(() => {
    if (mounted) {
      const timer = setTimeout(() => {
        setMode(appSettings.defaultMode);
        setSortField(appSettings.defaultSortField);
        setSortDir(appSettings.defaultSortDir);
        setPageSize(appSettings.defaultPageSize);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [mounted]);

  // On mount: only fetch data for the default (weekly) mode, sequentially
  useEffect(() => {
    // Fetch sequentially to avoid concurrent API requests that crash the server
    (async () => {
      await fetchSnapshots();
      await fetchEntries();
      fetchedModesRef.current.add('weekly');
      setDataFetchedAt(new Date());
    })();
  }, []);

  // Lazy-fetch evaluation data when switching to evaluation mode (sequential)
  useEffect(() => {
    if (mode === 'evaluation' && !fetchedModesRef.current.has('evaluation')) {
      fetchedModesRef.current.add('evaluation');
      (async () => {
        await fetchEvaluations();
        setDataFetchedAt(new Date());
      })();
    }
  }, [mode]);

  // Lazy-fetch literature data when switching to literature mode.
  // Use Promise.allSettled so one failed fetch doesn't block the others —
  // the user sees partial data instead of an indefinite loading state.
  useEffect(() => {
    if (mode === 'literature' && !fetchedModesRef.current.has('literature')) {
      fetchedModesRef.current.add('literature');
      (async () => {
        await Promise.allSettled([
          fetchLitStats(),
          fetchLitPapers(),
          fetchLitReports(),
        ]);
        setDataFetchedAt(new Date());
      })();
    }
  }, [mode]);

  // Retry all data fetching after an error.
  // Weekly data is fetched first (needed for the default view), then
  // evaluation + literature are fetched in parallel via Promise.allSettled
  // so a single failed endpoint doesn't block the others.
  const handleRetryAll = useCallback(async () => {
    setIsRefreshing(true);
    setFetchError(null);
    try {
      await fetchSnapshots();
      const methodFilter = activeFilter !== 'all' &&
        ['Cryo-EM', 'X-RAY DIFFRACTION', 'SOLUTION NMR'].includes(activeFilter)
        ? activeFilter : undefined;
      await fetchEntries(selectedSnapshot || undefined, methodFilter, searchQuery || undefined);
      // Fetch evaluation + literature in parallel — one failing shouldn't
      // block the other.
      await Promise.allSettled([
        (async () => { await fetchEvaluations(); fetchedModesRef.current.add('evaluation'); })(),
        (async () => {
          await Promise.allSettled([
            fetchLitStats(),
            fetchLitPapers(),
            fetchLitReports(),
          ]);
          fetchedModesRef.current.add('literature');
        })(),
      ]);
      setDataFetchedAt(new Date());
      toast.success('Data refreshed', { description: 'All data has been updated' });
    } finally {
      setIsRefreshing(false);
    }
  }, [fetchSnapshots, fetchEntries, fetchEvaluations, fetchLitStats, fetchLitPapers, fetchLitReports, fetchReports, selectedSnapshot, activeFilter, searchQuery]);

  // Refetch entries when snapshot or filter changes
  useEffect(() => {
    if (mode === 'weekly') {
      const timer = setTimeout(() => {
        const methodFilter = activeFilter !== 'all' &&
          ['Cryo-EM', 'X-RAY DIFFRACTION', 'SOLUTION NMR'].includes(activeFilter)
          ? activeFilter : undefined;
        fetchEntries(selectedSnapshot || undefined, methodFilter, searchQuery || undefined);
        setCurrentPage(1);
        setSelectedEntryIds(new Set());
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [selectedSnapshot, activeFilter, mode]);

  // Search debounce
  useEffect(() => {
    const timer = setTimeout(() => {
      if (mode === 'weekly') {
        const methodFilter = activeFilter !== 'all' &&
          ['Cryo-EM', 'X-RAY DIFFRACTION', 'SOLUTION NMR'].includes(activeFilter)
          ? activeFilter : undefined;
        fetchEntries(selectedSnapshot || undefined, methodFilter, searchQuery || undefined);
        setCurrentPage(1);
      }
    }, 350);
    return () => clearTimeout(timer);
  }, [searchQuery, mode, activeFilter, selectedSnapshot]);

  // Fetch eval detail and eval report markdown when selectedEval changes
  useEffect(() => {
    const timer = setTimeout(() => {
      if (selectedEvalId) {
        fetchEvalDetail(selectedEvalId);
        setEvalReportContent('');
      } else {
        setSelectedEval(null);
        setEvalReportContent('');
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [selectedEvalId]);

  // Auto-select the first evaluation when entering Evaluation mode with data
  // but no evaluation selected yet. This prevents the empty detail state and
  // immediately shows the score card + PDB table for the first target.
  useEffect(() => {
    if (
      mode === 'evaluation' &&
      !selectedEvalId &&
      evaluations.length > 0 &&
      !evalLoading
    ) {
      setSelectedEvalId(evaluations[0].uniprotId);
    }
  }, [mode, evaluations, selectedEvalId, evalLoading]);

  // Fetch evaluation report markdown from file when selectedEval is available
  useEffect(() => {
    if (selectedEval?.uniprotId) {
      queuedFetchWithRetry(`/api/eval-report-file/${selectedEval.uniprotId}`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (data?.content) {
            // Strip LLM-leaked Hermes/CLI preamble (e.g. "Write tool requires
            // approval which isn't available in this mode. Here's the chapter
            // content directly:\n\n---\n\n"). The naive frontmatter
            // regex below would otherwise eat the entire executive summary +
            // chapters 1-2 because the leaked `---` *opens* a fake frontmatter
            // block that swallows 2-3 KB of real content.
            //
            // Strategy: locate the first occurrence of a *known* chapter
            // heading ("## 执行摘要", "## 1. 蛋白", or just "##") and trim
            // everything before it. Then apply the original frontmatter +
            // bold-field strip. This is robust to LLM output variations.
            let raw = data.content;
            const chapterAnchors = [
              /^##\s+执行摘要/m,
              /^##\s+\d+\.\s+/m,
              /^##\s+/m,
            ];
            let firstAnchor: RegExpMatchArray | null = null;
            for (const re of chapterAnchors) {
              const m = raw.match(re);
              if (m && (!firstAnchor || (m.index ?? 0) < (firstAnchor.index ?? 0))) {
                firstAnchor = m;
              }
            }
            if (firstAnchor && (firstAnchor.index ?? 0) > 0) {
              raw = raw.slice(firstAnchor.index ?? 0);
            }
            const stripped = raw
              .replace(/^---[\s\S]*?---\s*/m, '')
              .replace(/^#\s+.+\n/, '')
              .replace(/^\*\*[^*]+\*\*:\s*[^*]+\n/gm, '')
              .replace(/^\*\*[^*]+\*\*:\s*/gm, '')
              .replace(/^(created|updated|type|tags|sources):\s*[^\n]+\n/gim, '')
              .trim();
            setEvalReportContent(stripped);
          }
        })
        .catch(() => {});
    }
  }, [selectedEval?.uniprotId]);

  // Fetch AI analysis when entry selected
  useEffect(() => {
    const timer = setTimeout(() => {
      if (selectedEntry && detailPanelOpen) {
        fetchAiAnalysis(selectedEntry);
      } else {
        setAiAnalysis(null);
        setAiAnalysisLoading(false);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, [selectedEntry, detailPanelOpen]);

  // Reset literature AI summary when detail panel closes
  useEffect(() => {
    if (!litIsDetailOpen) {
      const timer = setTimeout(() => {
        setLitAiSummary(null);
        setLitAiSummaryLoading(false);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [litIsDetailOpen]);

  // Track scroll for back-to-top button
  useEffect(() => {
    const handleScroll = () => {
      setShowBackToTop(window.scrollY > 300);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Global keyboard shortcuts: ⌘K / Ctrl+K → Command Palette, ? → Keyboard Hints
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // ⌘K (Mac) or Ctrl+K (Windows/Linux) → open command palette
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setCommandPaletteOpen((prev) => !prev);
        return;
      }
      // ? → open keyboard hints (only when not typing in an input/textarea)
      if (e.key === '?' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const target = e.target as HTMLElement;
        const tag = target.tagName.toLowerCase();
        const isInput = tag === 'input' || tag === 'textarea' || target.isContentEditable;
        if (!isInput) {
          e.preventDefault();
          setKeyboardHintsOpen((prev) => !prev);
        }
      }
      // Escape → close any open overlay
      if (e.key === 'Escape') {
        if (commandPaletteOpen) { setCommandPaletteOpen(false); return; }
        if (keyboardHintsOpen) { setKeyboardHintsOpen(false); return; }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [commandPaletteOpen, keyboardHintsOpen]);

  // ─── Filtered & Sorted Entries ────────────────────────────────────────────

  const filteredEntries = useMemo(() => {
    let result = [...entries];
    if (activeFilter === 'high-if') result = result.filter(e => (e.journalIf ?? 0) >= 10);
    else if (activeFilter === 'top-if') result = result.filter(e => (e.journalIf ?? 0) >= 20);
    else if (activeFilter === 'bookmarks') result = result.filter(e => bookmarks.has(e.pdbId));
    if (weeklyDateFilter) result = result.filter(e => e.releaseDate === weeklyDateFilter);

    result.sort((a, b) => {
      const aVal = (a as any)[sortField];
      const bVal = (b as any)[sortField];
      // null/undefined 始终排在最后（不论 asc 还是 desc）
      // 对 IF 字段：<=0 也视作"未知"——未发表文献的 IF 占位为 0，不应参与排序
      // 对其他数字字段(resolution/coverage/score 等)：0 是合法值，只看 null
      const treatZeroAsMissing = sortField === 'journalIf';
      const isMissing = (v: any) =>
        v == null || (treatZeroAsMissing && typeof v === 'number' && v <= 0);
      const aNull = isMissing(aVal);
      const bNull = isMissing(bVal);
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;
      let cmp = 0;
      if (typeof aVal === 'number' && typeof bVal === 'number') cmp = aVal - bVal;
      else cmp = String(aVal).localeCompare(String(bVal));
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return result;
  }, [entries, sortField, sortDir, activeFilter, weeklyDateFilter, bookmarks]);

  const filteredEvaluations = useMemo(() => {
    let result = [...allEvaluations];
    if (evalFilter === 'high-coverage') result = result.filter(e => (e.coverage ?? 0) >= 80);
    else if (evalFilter === 'medium-coverage') result = result.filter(e => (e.coverage ?? 0) >= 50);
    else if (evalFilter === 'low-coverage') result = result.filter(e => (e.coverage ?? 0) < 50);
    else if (evalFilter === 'has-structure') result = result.filter(e => (e.pdbStructures?.length ?? 0) > 0);
    else if (evalFilter === 'has-blast') result = result.filter(e => (e.blastResults?.length ?? 0) > 0);
    if (searchQuery && mode === 'evaluation') {
      const q = searchQuery.toLowerCase();
      result = result.filter(e =>
        (e.uniprotId?.toLowerCase().includes(q)) ||
        (e.proteinName?.toLowerCase().includes(q)) ||
        (e.organism?.toLowerCase().includes(q)) ||
        (e.entryName?.toLowerCase().includes(q)) ||
        (e.geneNames?.toLowerCase().includes(q))
      );
    }
    result.sort((a, b) => {
      const aVal = (a as any)[evalSortField];
      const bVal = (b as any)[evalSortField];
      // null/undefined 始终排在最后（不论 asc 还是 desc）
      // 对 IF 字段：<=0 也视作"未知"——未发表文献的 IF 占位为 0，不应参与排序
      // 对其他数字字段(resolution/coverage/score 等)：0 是合法值，只看 null
      const treatZeroAsMissing = evalSortField === 'journalIf';
      const isMissing = (v: any) =>
        v == null || (treatZeroAsMissing && typeof v === 'number' && v <= 0);
      const aNull = isMissing(aVal);
      const bNull = isMissing(bVal);
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;
      let cmp = 0;
      if (typeof aVal === 'number' && typeof bVal === 'number') cmp = aVal - bVal;
      else cmp = String(aVal).localeCompare(String(bVal));
      return evalSortDir === 'asc' ? cmp : -cmp;
    });
    return result;
  }, [allEvaluations, evalFilter, searchQuery, mode, evalSortField, evalSortDir]);

  const paginatedEntries = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredEntries.slice(start, start + pageSize);
  }, [filteredEntries, currentPage, pageSize]);

  const totalPages = Math.ceil(filteredEntries.length / pageSize);

  const currentSnapshot = useMemo(() => {
    return snapshots.find(s => s.weekId === selectedSnapshot) || null;
  }, [snapshots, selectedSnapshot]);

  const prevSnapshot = useMemo(() => {
    if (!selectedSnapshot) return null;
    const idx = snapshots.findIndex(s => s.weekId === selectedSnapshot);
    if (idx < 0 || idx >= snapshots.length - 1) return null;
    return snapshots[idx + 1];
  }, [snapshots, selectedSnapshot]);

  // ─── Handlers ─────────────────────────────────────────────────────────────

  const handleSort = useCallback((field: string) => {
    if (sortField === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  }, [sortField]);

  const handleEvalSort = useCallback((field: string) => {
    if (evalSortField === field) {
      setEvalSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setEvalSortField(field);
      setEvalSortDir('desc');
    }
  }, [evalSortField]);

  const handleRowClick = useCallback((entry: PdbEntry) => {
    setSelectedEntry(entry);
    setDetailPanelOpen(true);
  }, []);

  const toggleBookmark = useCallback((pdbId: string) => {
    updateBookmarks(prev => {
      const next = new Set(prev);
      if (next.has(pdbId)) {
        next.delete(pdbId);
        toast.info('Bookmark removed', { description: `${pdbId} removed from bookmarks` });
      } else {
        next.add(pdbId);
        toast.success('Bookmarked', { description: `${pdbId} added to bookmarks` });
      }
      return next;
    });
  }, [updateBookmarks]);

  const handleModeSwitch = useCallback((newMode: Mode) => {
    setMode(newMode);
    setCurrentPage(1);
    setActiveFilter('all');
    setSearchQuery('');
    setWeeklyDateFilter(null);
    setSelectedEvalId(null);
    setSelectedEval(null);
    setSelectedEvalStructure(null);
    setSelectedBatchId(null);
    setDetailPanelOpen(false);
    setLitIsDetailOpen(false);
    setLitSelectedPaper(null);
    setLitPdbSelected(null);
    setEvalSubView('default');
    setEvalFilter('all');
    setSelectedEntryIds(new Set());
    setCompareMode(false);
    // Lazy-fetch data for the new mode if not already fetched (sequential)
    if (newMode === 'evaluation' && !fetchedModesRef.current.has('evaluation')) {
      fetchedModesRef.current.add('evaluation');
      (async () => {
        await fetchEvaluations();
        setDataFetchedAt(new Date());
      })();
    }
    if (newMode === 'literature' && !fetchedModesRef.current.has('literature')) {
      fetchedModesRef.current.add('literature');
      (async () => {
        await fetchLitStats();
        await fetchLitPapers();
        await fetchLitReports();
        setDataFetchedAt(new Date());
      })();
    }
    toast(`Switched to ${newMode} mode`, { description: 'Press 1/2/3 for quick switching' });
  }, [fetchEvaluations, fetchLitStats, fetchLitPapers, fetchLitReports]);

  // Literature handlers
  const handleLitSelectDate = useCallback(async (date: string) => {
    setLitSelectedDate(date);
    if (!date) {
      await fetchLitPapers();
      return;
    }
    setLitLoading(true);
    try {
      const res = await queuedFetchWithRetry(`/api/literature/report/${date}`);
      if (res.ok) {
        const data = await res.json();
        if (data.papers) setLitPapers(data.papers);
      }
    } catch (err) {
      // Silently handle fetch errors for date filter
    } finally {
      setLitLoading(false);
    }
  }, [fetchLitPapers]);

  const handleLitClearDateFilter = useCallback(() => {
    setLitSelectedDate(null);
    fetchLitPapers();
  }, [fetchLitPapers]);

  const handleLitSelectPaper = useCallback((paper: LitPaper) => {
    setLitSelectedPaper(paper);
    setLitIsDetailOpen(true);
  }, []);

  const handleLitClearAllFilters = useCallback(() => {
    if (litSelectedDate) handleLitClearDateFilter();
  }, [litSelectedDate, handleLitClearDateFilter]);

  const litHasActiveFilters = litSelectedDate !== null || litSourceFilter !== 'all' || !!litReadingListFilter || !!litTagFilter || litIfFilter !== 'all';

  // ─── Command Palette Search Navigation Handlers ────────────────────────────

  const handleCommandSelectPdbEntry = useCallback((entry: { pdbId: string; weekId: string | null }) => {
    setMode('weekly');
    if (entry.weekId) setSelectedSnapshot(entry.weekId);
    // Find the entry in loaded data and select it
    const found = entries.find(e => e.pdbId === entry.pdbId);
    if (found) {
      setSelectedEntry(found);
      setDetailPanelOpen(true);
    } else {
      // Refetch and select
      fetchEntries(entry.weekId || undefined, undefined, entry.pdbId).then(() => {
        // After fetching, the entry should be in the entries array
        setEntries(prev => {
          const e = prev.find(x => x.pdbId === entry.pdbId);
          if (e) {
            setSelectedEntry(e);
            setDetailPanelOpen(true);
          }
          return prev;
        });
      });
    }
    toast.info('Navigated to PDB entry', { description: entry.pdbId });
  }, [entries, fetchEntries]);

  const handleCommandSelectEvaluation = useCallback((evalResult: { uniprotId: string }) => {
    setMode('evaluation');
    setSelectedEvalId(evalResult.uniprotId);
    setDetailPanelOpen(true);
    toast.info('Navigated to evaluation', { description: evalResult.uniprotId });
  }, []);

  const handleCommandSelectPaper = useCallback((paperResult: { pmid: string }) => {
    setMode('literature');
    const paper = litPapers.find(p => p.pmid === paperResult.pmid);
    if (paper) {
      handleLitSelectPaper(paper);
    }
    toast.info('Navigated to paper', { description: `PMID ${paperResult.pmid}` });
  }, [litPapers, handleLitSelectPaper]);

  // ─── Weekly Batch Selection Handlers ──────────────────────────────────────

  const handleBookmarkAll = useCallback(() => {
    updateBookmarks(prev => {
      const next = new Set(prev);
      let addedCount = 0;
      selectedEntryIds.forEach(pdbId => {
        if (!next.has(pdbId)) {
          next.add(pdbId);
          addedCount++;
        }
      });
      toast.success('Bookmarked all', { description: `${addedCount} structure${addedCount !== 1 ? 's' : ''} added to bookmarks` });
      return next;
    });
  }, [selectedEntryIds, updateBookmarks]);

  const handleExportSelected = useCallback((format: 'csv' | 'json') => {
    const selectedEntries = entries.filter(e => selectedEntryIds.has(e.pdbId));
    if (selectedEntries.length === 0) return;

    let content: string;
    let filename: string;
    let mimeType: string;

    if (format === 'json') {
      const data = selectedEntries.map(e => ({
        pdbId: e.pdbId,
        method: e.method,
        resolution: e.resolution,
        journalIf: e.journalIf,
        journal: e.journal,
        organisms: e.organisms,
        title: e.title,
        releaseDate: e.releaseDate,
        ligands: e.ligands,
        doi: e.doi,
      }));
      content = JSON.stringify(data, null, 2);
      filename = `pdb-selected-${new Date().toISOString().slice(0, 10)}.json`;
      mimeType = 'application/json';
    } else {
      const headers = ['PDB ID', 'Method', 'Resolution', 'IF', 'Journal', 'Organism', 'Title', 'Date', 'Ligands', 'DOI'];
      const rows = selectedEntries.map(e => [
        e.pdbId,
        e.method || '',
        e.resolution != null ? e.resolution.toFixed(2) : '',
        e.journalIf != null ? e.journalIf.toFixed(1) : '',
        e.journal || '',
        e.organisms || '',
        e.title || '',
        e.releaseDate || '',
        e.ligands || '',
        e.doi || '',
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
      content = [headers.join(','), ...rows].join('\n');
      filename = `pdb-selected-${new Date().toISOString().slice(0, 10)}.csv`;
      mimeType = 'text/csv';
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Export complete', { description: `${selectedEntries.length} structures exported as ${format.toUpperCase()}` });
  }, [entries, selectedEntryIds]);

  const handleCompare = useCallback(() => {
    setCompareMode(true);
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedEntryIds(new Set());
  }, []);

  // ─── Batch Tag Handler ──────────────────────────────────────────────────

  const handleBatchTag = useCallback((tag: string, pdbIds: string[]) => {
    pdbIds.forEach(pdbId => {
      addTag(pdbId, tag);
    });
    toast.success('Tag applied', { description: `Added "${tag}" to ${pdbIds.length} structure${pdbIds.length !== 1 ? 's' : ''}` });
  }, [addTag]);

  // ─── Export Current View ──────────────────────────────────────────────────

  const handleExportCurrentView = useCallback((format: 'csv' | 'json' = 'csv') => {
    if (mode === 'weekly') {
      const data = filteredEntries.map(formatPdbEntryForExport);
      if (!data.length) { toast.info('No data to export'); return; }
      if (format === 'json') {
        exportToJSON(data, `pdb-weekly-${selectedSnapshot || 'all'}`);
        toast.success('Export complete', { description: `${data.length} entries exported as JSON` });
      } else {
        exportToCSV(data, `pdb-weekly-${selectedSnapshot || 'all'}`);
        toast.success('Export complete', { description: `${data.length} entries exported as CSV` });
      }
    } else if (mode === 'evaluation') {
      const data = filteredEvaluations.map(formatEvalForExport);
      if (!data.length) { toast.info('No data to export'); return; }
      if (format === 'json') {
        exportToJSON(data, 'evaluations');
        toast.success('Export complete', { description: `${data.length} evaluations exported as JSON` });
      } else {
        exportToCSV(data, 'evaluations');
        toast.success('Export complete', { description: `${data.length} evaluations exported as CSV` });
      }
    } else if (mode === 'literature') {
      const data = litPapers.map(formatLitPaperForExport);
      if (!data.length) { toast.info('No data to export'); return; }
      if (format === 'json') {
        exportToJSON(data, 'literature-papers');
        toast.success('Export complete', { description: `${data.length} papers exported as JSON` });
      } else {
        exportToCSV(data, 'literature-papers');
        toast.success('Export complete', { description: `${data.length} papers exported as CSV` });
      }
    }
  }, [mode, filteredEntries, filteredEvaluations, litPapers, selectedSnapshot]);

  // Fetch entries for a specific week (used by weekly diff compare)
  const fetchEntriesForWeek = useCallback(async (weekId: string): Promise<PdbEntry[]> => {
    try {
      const params = new URLSearchParams();
      params.set('week', weekId);
      params.set('limit', '10000');
      const res = await queuedFetchWithRetry(`/api/entries?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        return Array.isArray(data) ? data : (data.entries ?? []);
      }
    } catch (err) {
      console.error('Failed to fetch entries for week:', err);
    }
    return [];
  }, []);

  // When PDB clicked from literature, select it for detail view
  const handleLitPdbClick = useCallback((pdbId: string) => {
    setLitPdbSelected(pdbId);
  }, []);

  const handleLitPdbBack = useCallback(() => {
    setLitPdbSelected(null);
  }, []);


  // ─── Weekly Report Viewer ────────────────────────────────────────────────

  const handleViewReport = useCallback((weekId?: string, type?: 'xray' | 'cryoem' | 'nmr') => {
    const targetWeekId = weekId || selectedSnapshot || '';
    queuedFetchWithRetry(`/api/weekly-report-file?weekId=${encodeURIComponent(targetWeekId)}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (data?.files && data.files.length > 0) {
          const targetFile = type
            ? data.files.find((f: any) => f.type === type) || data.files[0]
            : data.files[0];
          if (targetFile) {
            setSelectedReport({ title: `Weekly Report — ${targetFile.filename.replace(/\.md$/, '')}`, content: targetFile.content });
            setReportModalOpen(true);
          }
        } else {
          const report = weeklyReports.find(r => r.weekId === targetWeekId);
          if (report && report.content) {
            setSelectedReport({ title: `Weekly Report — ${report.weekId}`, content: report.content });
            setReportModalOpen(true);
          }
        }
      })
      .catch(() => {
        const report = weeklyReports.find(r => r.weekId === targetWeekId);
        if (report && report.content) {
          setSelectedReport({ title: `Weekly Report — ${report.weekId}`, content: report.content });
          setReportModalOpen(true);
        }
      });
  }, [weeklyReports, selectedSnapshot]);

  const getReportCountForWeek = useCallback((weekId: string | null) => {
    if (!weekId) return 0;
    if (/W\d+/i.test(weekId)) return 2;
    return weeklyReports.some(r => r.weekId === weekId && r.content) ? 1 : 0;
  }, [weeklyReports]);

  // ─── Snapshot Method Distribution Bar ──────────────────────────────────────

  function SnapshotMethodBar({ snap, isActive }: { snap: WeeklySnapshot; isActive: boolean }) {
    const total = snap.totalStructures || 1;
    const cryoemPct = (snap.cryoemCount / total) * 60;
    const xrayPct = (snap.xrayCount / total) * 60;
    const nmrPct = (snap.nmrCount / total) * 60;
    const barH = isActive ? 8 : 6;

    return (
      <svg width={60} height={barH} className="flex-shrink-0 mt-1">
        {/* Background track */}
        <rect x={0} y={0} width={60} height={barH} rx={barH / 2} className="fill-claude-border dark:fill-[#3d3832]" opacity={0.5} />
        {/* Cryo-EM segment */}
        {snap.cryoemCount > 0 && (
          <rect x={0} y={0} width={cryoemPct} height={barH} rx={cryoemPct >= 60 ? barH / 2 : 0} fill="#2d8f8f" opacity={0.85} style={{ clipPath: 'inset(0 0 0 0 round 4px 0 0 4px)' }} />
        )}
        {/* X-ray segment */}
        {snap.xrayCount > 0 && (
          <rect x={cryoemPct} y={0} width={xrayPct} height={barH} fill="#7c5cbf" opacity={0.85} />
        )}
        {/* NMR segment */}
        {snap.nmrCount > 0 && (
          <rect x={cryoemPct + xrayPct} y={0} width={nmrPct} height={barH} fill="#c9872e" opacity={0.85} style={{ clipPath: 'inset(0 0 0 0 round 0 4px 4px 0)' }} />
        )}
        {/* Glow for active */}
        {isActive && (
          <rect x={0} y={0} width={60} height={barH} rx={barH / 2} fill="none" stroke="#c96442" strokeWidth={0.5} opacity={0.6} />
        )}
      </svg>
    );
  }

  // ─── Render: Weekly Sidebar ──────────────────────────────────────────────

  const renderWeeklySidebar = (mobile?: boolean) => (
    <aside
      className={`${mobile ? 'w-full' : ''} ${mobile ? '' : 'hidden lg:flex'} border-r border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] flex flex-col overflow-hidden flex-shrink-0 sidebar-animated transition-all duration-300 ${!mobile && sidebarCollapsed ? 'sidebar-collapsed w-[48px]' : 'w-[260px]'}`}
    >
      <div className="px-3 py-3 border-b border-claude-border dark:border-[#3d3832]">
        <div className="flex items-center justify-between">
          {(!sidebarCollapsed || mobile) && (
            <div className="flex items-center gap-1.5">
              <h3 className="text-xs font-semibold text-claude-text-secondary uppercase tracking-wider">
                {t.weeklySnapshotsTitle}
              </h3>
            </div>
          )}
          {mobile ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-claude-text-muted hover:text-claude-text"
              onClick={() => setMobileMenuOpen(false)}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-claude-text-muted hover:text-claude-text active:scale-95 transition-transform duration-100"
                  onClick={() => setSidebarCollapsed(c => !c)}
                >
                  <ChevronRight className={`h-3.5 w-3.5 sidebar-collapse-btn ${sidebarCollapsed ? '' : 'rotated'}`} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left"><p>{sidebarCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}</p></TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto sidebar-scroll py-1 stagger-list">
        {snapshots.map((snap, snapIdx) => {
          const isActive = selectedSnapshot === snap.weekId;
          const isLatest = snapIdx === 0;
          return (
            <div
              key={snap.weekId}
              role="button"
              tabIndex={0}
              onClick={() => { setSelectedSnapshot(snap.weekId); setActiveFilter('all'); if (mobile) setMobileMenuOpen(false); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedSnapshot(snap.weekId); setActiveFilter('all'); if (mobile) setMobileMenuOpen(false); } }}
              className={`snapshot-card w-full text-left px-3 py-2.5 pl-5 mx-1.5 rounded-md mb-0.5 claude-transition claude-focus-ring sidebar-item-hover cursor-pointer relative overflow-hidden ${
                isActive
                  ? 'bg-claude-accent-light dark:bg-[#3d2a22] sidebar-active-card snapshot-card-active'
                  : 'hover:bg-claude-border-light dark:hover:bg-[#2b2926]'
              }`}
            >
              {/* Method-composition vertical bar on left edge */}
              <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-md overflow-hidden flex flex-col" style={{ opacity: isActive ? 1 : 0.7 }}>
                {snap.cryoemCount > 0 && (
                  <span className="flex-shrink-0" style={{ backgroundColor: '#2d8f8f', flex: snap.cryoemCount }} />
                )}
                {snap.xrayCount > 0 && (
                  <span className="flex-shrink-0" style={{ backgroundColor: '#7c5cbf', flex: snap.xrayCount }} />
                )}
                {snap.nmrCount > 0 && (
                  <span className="flex-shrink-0" style={{ backgroundColor: '#c9872e', flex: snap.nmrCount }} />
                )}
              </div>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className={`text-xs font-semibold ${isActive ? 'text-claude-accent' : 'text-claude-text'}`}>
                    {(sidebarCollapsed && !mobile) ? snap.weekId.replace('2025-', '') : snap.weekId}
                  </span>
                  {isLatest && (!sidebarCollapsed || mobile) && (
                    <span className="snapshot-latest-badge">Latest</span>
                  )}
                  {(!sidebarCollapsed || mobile) && getReportCountForWeek(snap.weekId) > 0 && (
                    <div className="flex items-center gap-0.5">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button onClick={(e) => { e.stopPropagation(); handleViewReport(snap.weekId, 'xray'); }} className="snapshot-method-btn snapshot-method-btn-xray">
                            <span className="snapshot-method-btn-label">X</span>
                          </button>
                        </TooltipTrigger>
                        <TooltipContent side="right"><p>{t.xrayReport}</p></TooltipContent>
                      </Tooltip>
                      {getReportCountForWeek(snap.weekId) > 1 && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button onClick={(e) => { e.stopPropagation(); handleViewReport(snap.weekId, 'cryoem'); }} className="snapshot-method-btn snapshot-method-btn-cryoem">
                              <span className="snapshot-method-btn-label">E</span>
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="right"><p>{t.cryoemReport}</p></TooltipContent>
                        </Tooltip>
                      )}
                      {getReportCountForWeek(snap.weekId) > 2 && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button onClick={(e) => { e.stopPropagation(); handleViewReport(snap.weekId, 'nmr'); }} className="snapshot-method-btn snapshot-method-btn-nmr">
                              <span className="snapshot-method-btn-label">N</span>
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="right"><p>{t.nmrReport}</p></TooltipContent>
                        </Tooltip>
                      )}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-1.5">
                  {(!sidebarCollapsed || mobile) && snapshots.length > 1 && (() => {
                    // Show a 5-week trend window. Array is descending (newest
                    // first). Take 5 items starting at snapIdx (newer → older),
                    // then reverse to ascending order so the line draws
                    // left-to-right from oldest to newest.
                    // For snapIdx=0 (newest week) with no 4 prior weeks, fall
                    // back to the last 5 of the full array (same window).
                    const trendData = snapshots
                      .slice(snapIdx, snapIdx + 5)
                      .reverse()
                      .map(s => s.totalStructures);
                    const globalMin = Math.min(...snapshots.map(s => s.totalStructures));
                    const globalMax = Math.max(...snapshots.map(s => s.totalStructures));
                    return (
                      <MiniSparkline
                        data={trendData}
                        globalMin={globalMin}
                        globalMax={globalMax}
                        width={50}
                        height={16}
                      />
                    );
                  })()}
                  <span className="text-[10px] font-mono text-claude-text-muted">
                    {snap.totalStructures}
                  </span>
                </div>
              </div>
              {(!sidebarCollapsed || mobile) && (
                <div className="mt-0.5 flex items-center gap-2">
                  <SnapshotMethodBar snap={snap} isActive={isActive} />
                  <div className="flex items-center gap-1">
                    {snap.cryoemCount > 0 && (
                      <span className="snapshot-count-chip snapshot-count-chip-cryoem" title="Cryo-EM">E{snap.cryoemCount}</span>
                    )}
                    {snap.xrayCount > 0 && (
                      <span className="snapshot-count-chip snapshot-count-chip-xray" title="X-ray">X{snap.xrayCount}</span>
                    )}
                    {snap.nmrCount > 0 && (
                      <span className="snapshot-count-chip snapshot-count-chip-nmr" title="NMR">N{snap.nmrCount}</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {/* Week Comparison & Activity Feed inside scrollable area */}
        {(!sidebarCollapsed || mobile) && currentSnapshot && (
          <div className="border-t border-claude-border dark:border-[#3d3832] p-3 mt-1">
            <WeekComparison current={currentSnapshot} previous={prevSnapshot} snapshots={snapshots} />
          </div>
        )}
        {(!sidebarCollapsed || mobile) && (
          <div className="border-t border-claude-border dark:border-[#3d3832]">
            <WeeklyActivityFeed entries={entries} weekLabel={currentSnapshot?.weekId} maxEvents={6} />
          </div>
        )}
        {/* Quick Actions panel — one-click access to Run Center, mode switching, and featured structures */}
        {(!sidebarCollapsed || mobile) && (
          <div className="border-t border-claude-border dark:border-[#3d3832] p-2.5">
            <QuickActions
              hasData={entries.length > 0 || evaluations.length > 0}
              onOpenRunCenter={() => setRunCenterOpen(true)}
              onSwitchMode={(m) => {
                if (m === 'evaluation') setMode('evaluation');
                else if (m === 'literature') setMode('literature');
                else if (m === 'analysis') setMode('analysis');
                if (mobile) setMobileMenuOpen(false);
              }}
            />
          </div>
        )}
        {/* Trending Structures — highlights notable structures in current week */}
        {(!sidebarCollapsed || mobile) && entries.length > 0 && (
          <div className="border-t border-claude-border dark:border-[#3d3832]">
            <TrendingStructures
              entries={entries}
              bookmarks={bookmarks}
              onSelectEntry={(pdbId) => {
                const entry = entries.find((e) => e.pdbId === pdbId);
                if (entry) {
                  setSelectedEntry(entry);
                  setDetailPanelOpen(true);
                  if (mobile) setMobileMenuOpen(false);
                }
              }}
            />
          </div>
        )}
        {/* Snapshot Comparison — visual diff between current and previous week */}
        {(!sidebarCollapsed || mobile) && currentSnapshot && (
          <div className="border-t border-claude-border dark:border-[#3d3832]">
            <SnapshotComparison
              current={currentSnapshot}
              previous={prevSnapshot}
              snapshots={snapshots}
            />
          </div>
        )}
      </div>
    </aside>
  );

  // ─── Render: Evaluation Sidebar ──────────────────────────────────────────

  const renderEvalSidebar = (mobile?: boolean) => (
    <aside className={`${mobile ? 'w-full' : 'w-[260px]'} ${mobile ? '' : 'hidden lg:flex'} border-r border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] flex flex-col overflow-hidden flex-shrink-0`}>
      <div className="px-3 py-3 border-b border-claude-border dark:border-[#3d3832]">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-claude-text-secondary uppercase tracking-wider">
            {t.evaluationsTitle}
          </h3>
          {mobile && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-claude-text-muted hover:text-claude-text"
              onClick={() => setMobileMenuOpen(false)}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto sidebar-scroll">
        <EvalModeSwitcher
          evaluations={evaluations}
          batches={evalBatches}
          batchSubTargets={batchSubTargets}
          selectedUniprotId={selectedEvalId}
          onSelectEval={(id) => { setSelectedEvalId(id); setDetailPanelOpen(true); setSelectedEvalStructure(null); if (mobile) setMobileMenuOpen(false); }}
          onDeleteEval={handleDeleteEval}
          loading={evalLoading}
          selectedBatchId={selectedBatchId}
          onSelectBatch={(bid) => { handleSelectBatch(bid); if (mobile) setMobileMenuOpen(false); }}
          onSelectBatchSubTarget={(bid, uid) => { handleSelectBatchSubTarget(bid, uid); if (mobile) setMobileMenuOpen(false); }}
        />
      </div>
    </aside>
  );

  // ─── Render: Literature Sidebar ──────────────────────────────────────────

  const renderLiteratureSidebar = (mobile?: boolean) => (
    <aside className={`${mobile ? 'w-full' : 'w-[260px]'} ${mobile ? '' : 'hidden lg:flex'} border-r border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] flex flex-col overflow-hidden flex-shrink-0`}>
      <div className="px-3 py-3 border-b border-claude-border dark:border-[#3d3832]">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-claude-text-secondary uppercase tracking-wider">
            {t.modeLiterature}
          </h3>
          {mobile && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0 text-claude-text-muted hover:text-claude-text"
              onClick={() => setMobileMenuOpen(false)}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto sidebar-scroll">
        <LiteratureDateSidebar
          allPapers={litPapers}
          filteredPapers={(() => {
            let filtered: typeof litPapers = litPapers;

            // Source filter (日报)
            if (litSourceFilter === 'daily') {
              filtered = filtered.filter(p => p.source === '结构生物学文献日报');
            }

            // Reading list filter
            if (litReadingListFilter) {
              const list = readingListState.lists.find(l => l.id === litReadingListFilter);
              if (list) {
                filtered = filtered.filter(p => list.paperPmids.includes(p.pmid));
              }
            }

            // Tag filter
            if (litTagFilter) {
              const papersWithTag = new Set(paperTagsState.getPapersWithTag(litTagFilter));
              filtered = filtered.filter(p => papersWithTag.has(p.pmid));
            }


            // IF filter
            if (litIfFilter !== 'all') {
              const minIf = parseInt(litIfFilter, 10);
              filtered = filtered.filter(p => p.IF != null && p.IF >= minIf);
            }

            // Date filter (show filtered count for selected date range)
            if (litSelectedDate) {
              filtered = filtered.filter(p => {
                if (!p.pubdate) return false;
                if (litSelectedDate.length === 4) {
                  return p.pubdate.startsWith(litSelectedDate);
                } else if (litSelectedDate.length === 7) {
                  return p.pubdate.startsWith(litSelectedDate);
                } else {
                  return p.pubdate === litSelectedDate;
                }
              });
            }

            return filtered;
          })()}
          onClearFilter={litSourceFilter !== 'all' || litReadingListFilter || litTagFilter || litSelectedDate || litIfFilter !== 'all' ? () => { setLitSourceFilter('all'); setLitReadingListFilter(null); setLitTagFilter(null); handleLitClearDateFilter(); setLitIfFilter('all'); } : undefined}
          selectedDate={litSelectedDate}
          onSelectDate={(date) => { handleLitSelectDate(date); if (mobile) setMobileMenuOpen(false); }}
          isLoading={litLoading && litReports.length === 0}
          inline
        />
        {/* Section Divider */}
        <div className="border-t border-claude-border dark:border-[#3d3832]" />
        {/* Reading Lists Section */}
        <div className="px-3 py-3">
          <ReadingListSidebar
            lists={readingListState.lists}
            selectedListId={litReadingListFilter}
            onSelectList={setLitReadingListFilter}
            onCreateList={readingListState.createList}
            onDeleteList={readingListState.deleteList}
            onClearList={readingListState.clearList}
            onRemovePaperFromList={readingListState.removePaperFromList}
            onReorderLists={readingListState.reorderLists}
            papersMap={(() => { const m = new Map<string, LitPaper>(); litPapers.forEach(p => m.set(p.pmid, p)); return m; })()}
            progressMap={readingProgressState.progressMap}
            onPaperClick={(pmid) => {
              const paper = litPapers.find(p => p.pmid === pmid);
              if (paper) handleLitSelectPaper(paper);
            }}
          />
        </div>
      </div>
    </aside>
  );

  // ─── Render: Weekly Content ──────────────────────────────────────────────

  const renderWeeklyContent = () => (
    <>
      <WeeklyStatCards snapshot={currentSnapshot} entries={entries} loading={loading} snapshots={snapshots} />

      {/* Structure of the Week */}
      {!loading && entries.length > 0 && (() => {
        const topEntry = entries
          .filter(e => e.journalIf != null && e.journalIf > 0)
          .sort((a, b) => (b.journalIf ?? 0) - (a.journalIf ?? 0))[0];
        if (!topEntry) return null;
        const methodLabel = getMethodLabel(topEntry.method || '');
        const methodClass = methodLabel === 'Cryo-EM' ? 'sotw-method-cryoem' : methodLabel === 'X-ray' ? 'sotw-method-xray' : methodLabel === 'NMR' ? 'sotw-method-nmr' : 'sotw-method-other';
        const methodColor = methodLabel === 'Cryo-EM' ? '#2d8f8f' : methodLabel === 'X-ray' ? '#7c5cbf' : methodLabel === 'NMR' ? '#c9872e' : '#6b7280';
        const resChipClass = topEntry.resolution != null && topEntry.resolution < 2 ? 'resolution-chip resolution-chip-high' : topEntry.resolution != null && topEntry.resolution < 3 ? 'resolution-chip resolution-chip-mid' : topEntry.resolution != null ? 'resolution-chip resolution-chip-low' : '';
        return (
          <div className="px-2 sm:px-3">
            <div className={`sotw-card ${methodClass} p-4 sm:p-5`}>
              <div className="relative z-10 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-5">
                {/* Left: Badge + PDB ID */}
                <div className="flex flex-col items-start gap-2 shrink-0">
                  <span className="sotw-badge relative">
                    <Trophy className="h-3 w-3" />
                    Structure of the Week
                  </span>
                  <a
                    href={`https://www.rcsb.org/structure/${topEntry.pdbId}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-lg sm:text-xl font-extrabold hover:underline"
                    style={{ color: methodColor }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {topEntry.pdbId}
                  </a>
                  <div className="flex items-center gap-2">
                    <span className={`method-badge method-badge-pill inline-flex items-center justify-center min-w-[62px] px-2.5 py-0.5 rounded-full text-[10px] font-semibold border ${getMethodColor(topEntry.method || '').bg} ${getMethodColor(topEntry.method || '').text} ${getMethodColor(topEntry.method || '').border}`}>
                      {methodLabel}
                    </span>
                    {topEntry.resolution != null && (
                      <span className={resChipClass}>
                        {topEntry.resolution.toFixed(2)}Å
                      </span>
                    )}
                  </div>
                </div>

                {/* Middle: Title + Journal */}
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm sm:text-base font-semibold text-claude-text line-clamp-2 leading-snug">
                    {topEntry.title || 'Untitled Structure'}
                  </h3>
                  <div className="flex flex-wrap items-center gap-2 mt-1.5">
                    {topEntry.journal && (
                      <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-white/60 dark:bg-black/20 text-[11px] font-semibold text-claude-text-secondary border border-claude-border/30 dark:border-[#3d3832]/30">
                        <BookOpen className="h-3 w-3 mr-1 opacity-50" />
                        {topEntry.journal}
                      </span>
                    )}
                    {topEntry.journalIf != null && (
                      <span className={`if-badge-enhanced ${topEntry.ifTier === 'top' ? 'if-badge-enhanced-top' : topEntry.ifTier === 'high' ? 'if-badge-enhanced-high' : topEntry.ifTier === 'mid' ? 'if-badge-enhanced-mid' : 'if-badge-enhanced-low'}`}>
                        IF {topEntry.journalIf.toFixed(1)}
                      </span>
                    )}
                    {topEntry.organisms && (
                      <span className="text-[10px] text-claude-text-muted line-clamp-1">
                        {topEntry.organisms.split('|')[0]?.trim()}
                      </span>
                    )}
                  </div>
                </div>

                {/* Right: Action */}
                <div className="shrink-0">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 px-3 text-[11px] text-claude-accent hover:bg-claude-accent/10 border border-claude-accent/20 hover:border-claude-accent/40"
                    onClick={() => handleRowClick(topEntry)}
                  >
                    <Eye className="h-3.5 w-3.5 mr-1" />
                    View Detail
                  </Button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Heatmap + Trend toggle */}
      <div className="px-4 pt-2 flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowHeatmap(!showHeatmap)}
          className={`h-7 px-2.5 text-[11px] ${showHeatmap ? 'bg-claude-accent/10 text-claude-accent' : 'text-claude-text-muted'}`}
        >
          <Calendar className="h-3 w-3 mr-1" />
          {showHeatmap ? 'Hide Heatmap' : 'Heatmap'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowTrend(!showTrend)}
          className={`h-7 px-2.5 text-[11px] ${showTrend ? 'bg-claude-accent/10 text-claude-accent' : 'text-claude-text-muted'}`}
        >
          <TrendingUp className="h-3 w-3 mr-1" />
          {showTrend ? 'Hide Trends' : 'Trend Analysis'}
        </Button>
      </div>

      {/* Trend Analysis */}
      {showTrend && (
        <div className="animate-in fade-in duration-300">
          <WeeklyTrendAnalysis snapshots={snapshots} entries={entries} />
        </div>
      )}

      {/* Heatmap Calendar */}
      {showHeatmap && (
        <div className="animate-in fade-in duration-300">
          <WeeklyHeatmap selectedSnapshot={selectedSnapshot} onDateSelect={setWeeklyDateFilter} currentDateFilter={weeklyDateFilter} />
        </div>
      )}

      {/* Data Table */}
      <div className="flex-1 overflow-auto border-t border-claude-border dark:border-[#3d3832]">
        <WeeklyPdbTable
          entries={paginatedEntries}
          loading={loading}
          sortField={sortField}
          sortDir={sortDir}
          onSort={handleSort}
          onRowClick={handleRowClick}
          bookmarks={bookmarks}
          onToggleBookmark={toggleBookmark}
          selectedEntryIds={selectedEntryIds}
          onSelectEntries={setSelectedEntryIds}
          highlightedRowId={highlightedRowId}
          onHighlightRow={setHighlightedRowId}
          onRetry={handleRetryAll}
          fetchError={!!fetchError}
        />
      </div>

      {/* Pagination */}
      <div className="flex-shrink-0">
        <div className="flex items-center justify-between px-3 sm:px-4 py-2 sm:py-3 border-t border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220]">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-[11px] text-claude-text-muted">
              Showing <span className="font-mono font-medium text-claude-text-secondary">{((currentPage - 1) * pageSize) + 1}</span>–<span className="font-mono font-medium text-claude-text-secondary">{Math.min(currentPage * pageSize, filteredEntries.length)}</span> of <span className="font-mono font-medium text-claude-text-secondary">{filteredEntries.length}</span>
              {/* When the DB has more rows than we loaded, show "已加载 X / 共 Y 条"
                  + a "加载更多" button so the user can fetch the next batch
                  instead of being silently capped. */}
              {entriesHasMore && entriesTotal > filteredEntries.length && (
                <>
                  <span className="text-claude-text-muted/60 ml-1">·</span>
                  <span className="text-amber-600 dark:text-amber-400 ml-1">
                    共 {entriesTotal} 条 · 已加载 {entries.length} 条
                  </span>
                  <button
                    onClick={loadMoreEntries}
                    disabled={loadingMore}
                    className="ml-1.5 px-2 h-5 rounded text-[10px] font-semibold bg-claude-accent/10 text-claude-accent hover:bg-claude-accent/20 transition-colors disabled:opacity-50"
                  >
                    {loadingMore ? '加载中…' : '加载更多 →'}
                  </button>
                </>
              )}
            </span>
            <select
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}
              className="h-6 px-1.5 text-[10px] font-medium rounded border border-claude-border dark:border-[#3d3832] bg-white dark:bg-[#1a1917] text-claude-text-secondary"
            >
              {[10, 25, 50, 100].map(s => <option key={s} value={s}>{s}/page</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" disabled={currentPage <= 1} onClick={() => setCurrentPage(p => p - 1)} className="h-7 px-2 text-[11px]">Prev</Button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let page: number;
              if (totalPages <= 5) page = i + 1;
              else if (currentPage <= 3) page = i + 1;
              else if (currentPage >= totalPages - 2) page = totalPages - 4 + i;
              else page = currentPage - 2 + i;
              return (
                <Button key={page} variant={currentPage === page ? 'default' : 'ghost'} size="sm"
                  onClick={() => setCurrentPage(page)}
                  className={`h-7 w-7 p-0 text-[11px] ${currentPage === page ? 'bg-claude-accent text-white shadow-sm' : ''}`}
                >{page}</Button>
              );
            })}
            <Button variant="ghost" size="sm" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(p => p + 1)} className="h-7 px-2 text-[11px]">Next</Button>
          </div>
        </div>
      </div>
    </>
  );

  // ─── Render: Evaluation Content ──────────────────────────────────────────

  const renderEvalContent = () => {
    // Sub-view: toolbar + full-width component
    if (evalSubView === 'compare' || evalSubView === 'dashboard' || evalSubView === 'timeline' || evalSubView === 'batch') {
      return (
        <div className="flex flex-col h-full">
          {/* Sub-view navigation bar */}
          <div className="px-4 py-2 flex items-center gap-2 flex-shrink-0 border-b border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220]">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEvalSubView('default')}
              className="h-7 px-2.5 text-[11px] text-claude-text-secondary hover:text-claude-text"
            >
              ← Back to Evaluation
            </Button>
            <div className="flex items-center gap-1 ml-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEvalSubView('compare')}
                className={`h-7 px-2.5 text-[11px] ${evalSubView === 'compare' ? 'bg-claude-accent/10 text-claude-accent' : 'text-claude-text-muted'}`}
              >
                <ArrowRightLeft className="h-3 w-3 mr-1" />
                Compare
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEvalSubView('dashboard')}
                className={`h-7 px-2.5 text-[11px] ${evalSubView === 'dashboard' ? 'bg-claude-accent/10 text-claude-accent' : 'text-claude-text-muted'}`}
              >
                <LayoutDashboard className="h-3 w-3 mr-1" />
                Dashboard
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEvalSubView('timeline')}
                className={`h-7 px-2.5 text-[11px] ${evalSubView === 'timeline' ? 'bg-claude-accent/10 text-claude-accent' : 'text-claude-text-muted'}`}
              >
                <Clock className="h-3 w-3 mr-1" />
                Timeline
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEvalSubView('batch')}
                className={`h-7 px-2.5 text-[11px] ${evalSubView === 'batch' ? 'bg-claude-accent/10 text-claude-accent' : 'text-claude-text-muted'}`}
              >
                <Database className="h-3 w-3 mr-1" />
                Batch Matrix
              </Button>
            </div>
          </div>
          {/* Sub-view content */}
          <div className="flex-1 min-h-0">
            {evalSubView === 'compare' && <EvalComparison evaluations={allEvaluations} />}
            {evalSubView === 'dashboard' && <EvalDashboard evaluations={allEvaluations} batches={evalBatches} batchSubTargets={batchSubTargets} onViewBatch={(batchId) => { setEvalSubView('batch'); }} />}
            {evalSubView === 'timeline' && <EvalGanttTimeline evaluations={allEvaluations} onSelectEval={(id) => { setSelectedEvalId(id); setDetailPanelOpen(true); }} selectedUniprotId={selectedEvalId} />}
            {evalSubView === 'batch' && <EvalBatchCompare evaluations={allEvaluations} batches={evalBatches} batchSubTargets={batchSubTargets} />}
          </div>
        </div>
      );
    }

    // Default: individual evaluation page with Compare/Dashboard/Timeline buttons
    return (
      <div className="flex flex-col h-full">
        {/* Compare + Dashboard + Timeline toggle buttons */}
        <div className="px-4 pt-2 flex items-center gap-2 flex-shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEvalSubView('compare')}
            className="h-7 px-2.5 text-[11px] text-claude-text-muted"
          >
            <ArrowRightLeft className="h-3 w-3 mr-1" />
            Compare
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEvalSubView('dashboard')}
            className="h-7 px-2.5 text-[11px] text-claude-text-muted"
          >
            <LayoutDashboard className="h-3 w-3 mr-1" />
            Dashboard
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEvalSubView('timeline')}
            className="h-7 px-2.5 text-[11px] text-claude-text-muted"
          >
            <Clock className="h-3 w-3 mr-1" />
            Timeline
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEvalSubView('batch')}
            className="h-7 px-2.5 text-[11px] text-claude-text-muted"
          >
            <Database className="h-3 w-3 mr-1" />
            Batch Matrix
          </Button>
          {selectedEval && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setEvalReportOpen(true)}
              className="h-7 px-2.5 text-[11px] text-claude-accent hover:text-claude-accent-hover hover:bg-claude-accent/10 ml-auto"
            >
              <FileDown className="h-3 w-3 mr-1" />
              Generate Report
            </Button>
          )}
        </div>
        <div className="flex-1 min-h-0">
          <EvaluationPage
            evaluation={selectedEval}
            loading={evalLoading}
            selectedPdbId={selectedEvalStructure?.pdbId ?? null}
            onSelectPdb={(pdbId) => {
              if (!selectedEval) return;
              // Find the matching EvalRow from pdbStructures or blastResults
              const structRow = selectedEval.pdbStructures.find(s => s.pdbId === pdbId);
              if (structRow) {
                setSelectedEvalStructure({ ...structRow, _type: 'structure' });
                setDetailPanelOpen(true);
                return;
              }
              const blastRow = selectedEval.blastResults.find(b => b.pdbId === pdbId);
              if (blastRow) {
                setSelectedEvalStructure({
                  ...blastRow,
                  _type: 'blast',
                  ifTier: blastRow.ifTier || '',
                  journalIf: blastRow.journalIf ?? null,
                  title: blastRow.title || blastRow.description || null,
                  releaseDate: blastRow.releaseDate || null,
                  pubmedId: blastRow.pubmedId || null,
                  pubmedTitle: blastRow.pubmedTitle || null,
                  pubmedAuthors: blastRow.pubmedAuthors || null,
                  pubmedAbstract: blastRow.pubmedAbstract || null,
                });
                setDetailPanelOpen(true);
              }
            }}
          />
        </div>
      </div>
    );
  };

  const renderDetailPanelWrapper = (content: React.ReactNode, closeHandler: () => void) => (
    <>
      {/* Mobile: full-screen overlay */}
      <div className="md:hidden fixed inset-0 z-50 flex flex-col bg-claude-bg dark:bg-[#1a1917]">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] flex-shrink-0">
          <span className="text-sm font-semibold text-claude-text">{locale === 'zh' ? '详情' : 'Details'}</span>
          <Button variant="ghost" size="sm" onClick={closeHandler} className="h-8 w-8 p-0">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto preview-scroll">
          {content}
        </div>
      </div>
      {/* Desktop: inline panel with responsive width */}
      <aside
        style={{ width: 'clamp(280px, 30vw, 420px)' }}
        className="hidden md:flex bg-white/80 dark:bg-[#1a1917]/80 backdrop-blur-md flex-col overflow-hidden flex-shrink-0 shadow-[inset_0_1px_1px_rgba(255,255,255,0.1)] relative animate-in slide-in-from-right-2 duration-200 h-full"
      >
        {/* Left border divider line */}
        <div className="absolute left-0 top-0 bottom-0 w-0.5 bg-claude-border dark:bg-[#3d3832] z-10 rounded-r-sm" />
        {content}
      </aside>
    </>
  );

  // ─── Render: Detail Panel ────────────────────────────────────────────────

  const renderDetailPanel = () => {
    if (!detailPanelOpen && !litIsDetailOpen && !litPdbSelected) return null;

    // PDB detail from literature mode — show same detail panel but with back button
    if (mode === 'literature' && litPdbSelected) {
      const pdbEntry = entries.find(e => e.pdbId === litPdbSelected) || (() => {
        // Try to find in blast results
        for (const row of selectedEval?.blastResults || []) {
          if (row.pdbId === litPdbSelected) {
            return {
              pdbId: row.pdbId,
              title: row.title || row.pdbId,
              method: row.method || '',
              resolution: row.resolution ?? null,
              authors: '',
              releaseDate: '',
              isCryoem: (row.method || '').toLowerCase().includes('em'),
              isXray: (row.method || '').toLowerCase().includes('x-ray'),
              isNmR: false,
              journal: '',
              organisms: '',
            };
          }
        }
        return null;
      })();

      if (!pdbEntry) return null;
      const qualityScore = computeQualityScore(pdbEntry);
      const pdbDetailContent = (
        <>
          {/* Header */}
          <div className="px-4 py-3 border-b border-claude-border dark:border-[#3d3832] flex items-center justify-between bg-gradient-to-r from-[#faf7f4] to-[#f5f0ea] dark:from-[#242220] dark:to-[#2b2926]">
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={handleLitPdbBack} className="h-7 w-7 p-0 rounded-full bg-claude-border-light/80 dark:bg-[#2b2926]/80 hover:bg-claude-accent/10 text-claude-text-muted hover:text-claude-accent transition-all duration-200">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="font-mono font-bold text-sm text-claude-accent">{pdbEntry.pdbId}</span>
            </div>
          </div>
          {/* 3D Structure Preview */}
          <div className="p-4 border-b border-claude-border/50 dark:border-[#3d3832]/50">
            <div className="flex items-center gap-1.5 mb-2">
              <Box className="h-3.5 w-3.5 text-claude-accent" />
              <span className="text-[10px] font-medium text-claude-text-muted uppercase tracking-wider">3D Structure</span>
            </div>
            <PdbThumbnailPreview
              pdbId={pdbEntry.pdbId || ''}
              title={pdbEntry.title ?? undefined}
              onClick={() => { setViewerModalPdbId(pdbEntry.pdbId); setViewerModalOpen(true); }}
            />
          </div>
          {/* Title */}
          <div className="px-4 py-3 border-b border-claude-border/50 dark:border-[#3d3832]/50">
            <div className="text-xs text-claude-text-muted mb-1">{locale === 'zh' ? '标题' : 'Title'}</div>
            <div className="text-sm text-claude-text font-medium leading-snug">{pdbEntry.title || '—'}</div>
          </div>
          {/* Method & Resolution */}
          <div className="px-4 py-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-claude-text-muted mb-1">{locale === 'zh' ? '方法' : 'Method'}</div>
                <span className={`method-badge inline-flex px-2 py-0.5 rounded text-[11px] font-medium border ${
                  pdbEntry.isCryoem ? 'method-badge-cryoem bg-claude-cryoem-bg text-claude-cryoem border-claude-cryoem/30' :
                  pdbEntry.isXray ? 'method-badge-xray bg-claude-xray-bg text-claude-xray border-claude-xray/30' :
                  'method-badge-nmr bg-claude-nmr-bg text-claude-nmr border-claude-nmr/30'
                }`}>
                  {pdbEntry.method || (locale === 'zh' ? '未知' : 'Unknown')}
                </span>
              </div>
              <div>
                <div className="text-xs text-claude-text-muted mb-1">{locale === "zh" ? "分辨率" : "Resolution"}</div>
                <div className={`text-sm font-mono font-semibold ${
                  pdbEntry.resolution != null
                    ? pdbEntry.resolution <= 2.0 ? 'text-green-600 dark:text-green-400'
                      : pdbEntry.resolution <= 3.5 ? 'text-amber-600 dark:text-amber-400'
                      : 'text-red-500 dark:text-red-400'
                    : 'text-claude-text-muted'
                }`}>
                  {pdbEntry.resolution != null ? `${pdbEntry.resolution.toFixed(2)}Å` : '—'}
                </div>
              </div>
            </div>
          </div>
        </>
      );
      return renderDetailPanelWrapper(pdbDetailContent, handleLitPdbBack);
    }

    // Literature detail panel (inline, matches sidebar+main+detail pattern)
    if (mode === 'literature' && litIsDetailOpen && litSelectedPaper) {
      const paper = litSelectedPaper;

      // IF tier color for the bar
      const ifTierColor = paper.IF != null
        ? paper.IF >= 20 ? 'bg-red-500'
          : paper.IF >= 10 ? 'bg-orange-500'
          : paper.IF >= 5 ? 'bg-emerald-500'
          : 'bg-gray-400'
        : 'bg-gray-300 dark:bg-gray-600';

      // Build citation text (shown in the panel)
      const citationYear = paper.pubdate ? new Date(paper.pubdate).getFullYear() || paper.pubdate.slice(0, 4) : '';
      const citationText = `${paper.authors || 'Unknown'} (${citationYear}). ${paper.title}. ${paper.journal}${paper.doi ? `. DOI: ${paper.doi}` : ''}. PMID: ${paper.pmid}.`;

      const litDetailContent = (<>
        {/* Accent gradient top bar */}
        <div className="glass-detail-panel-accent" />
        {/* Noise texture overlay */}
        <div className="glass-noise-overlay" />
        {/* IF Tier Color Bar */}
        <div className={`h-[2px] w-full ${ifTierColor} flex-shrink-0 relative z-[1]`} />

          {/* Reading progress bar at very top (replaces IF bar when progress > 0) */}
          {readingProgressState.getProgress(paper.pmid) > 0 && (
            <div className="h-[2px] w-full bg-claude-border-light dark:bg-[#2b2926] flex-shrink-0 relative z-[1]">
              <div
                className="h-full transition-all duration-500 ease-out"
                style={{
                  width: `${readingProgressState.getProgress(paper.pmid)}%`,
                  background: readingProgressState.getProgress(paper.pmid) >= 100
                    ? '#10b981'
                    : 'linear-gradient(90deg, #2d8f8f, #c96442)',
                }}
              />
            </div>
          )}

          {/* Header */}
          <div className="px-4 py-3 border-b border-claude-border dark:border-[#3d3832] flex items-center justify-between bg-gradient-to-r from-[#faf7f4] to-[#f5f0ea] dark:from-[#242220] dark:to-[#2b2926]">
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-claude-accent" />
              <span className="text-sm font-bold text-claude-accent font-mono">PMID: {paper.pmid}</span>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setLitIsDetailOpen(false)} className="h-7 w-7 p-0 rounded-full bg-claude-border-light/80 dark:bg-[#2b2926]/80 hover:bg-red-100 dark:hover:bg-red-900/30 text-claude-text-muted hover:text-red-500 transition-all duration-200">
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto preview-scroll p-4 space-y-4">
            {/* Title */}
            <div>
              <h3 className="text-base font-bold text-claude-text leading-snug">
                {paper.title || 'Untitled'}
              </h3>
            </div>

            {/* Reading Progress Section */}
            <div className="p-3 rounded-lg border border-claude-border/60 dark:border-[#3d3832]/60 bg-claude-border-light/30 dark:bg-[#1a1917]/30">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <BookOpen className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
                  <span className="text-[10px] font-medium text-claude-text-muted uppercase tracking-wider">
                    {locale === 'zh' ? '阅读进度' : 'Reading Progress'}
                  </span>
                </div>
                <span className={`text-sm font-bold tabular-nums ${
                  readingProgressState.getProgress(paper.pmid) >= 100
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : readingProgressState.getProgress(paper.pmid) > 0
                      ? 'text-teal-600 dark:text-teal-400'
                      : 'text-claude-text-muted'
                }`}>
                  {readingProgressState.getProgress(paper.pmid)}%
                </span>
              </div>

              {/* Progress bar visual */}
              <div className="h-1.5 w-full bg-claude-border-light dark:bg-[#2b2926] rounded-full mb-3 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500 ease-out"
                  style={{
                    width: `${readingProgressState.getProgress(paper.pmid)}%`,
                    background: readingProgressState.getProgress(paper.pmid) >= 100
                      ? '#10b981'
                      : 'linear-gradient(90deg, #2d8f8f, #c96442)',
                  }}
                />
              </div>

              {/* Slider */}
              <Slider
                value={[readingProgressState.getProgress(paper.pmid)]}
                min={0}
                max={100}
                step={5}
                onValueChange={(value) => {
                  readingProgressState.setProgress(paper.pmid, value[0]);
                }}
                className="w-full mb-2"
              />

              {/* Quick action buttons */}
              <div className="flex items-center gap-2">
                {readingProgressState.getProgress(paper.pmid) < 100 ? (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-6 px-2.5 text-[10px] font-medium border-emerald-300 dark:border-emerald-700 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20"
                    onClick={() => readingProgressState.markComplete(paper.pmid)}
                  >
                    <Check className="h-3 w-3 mr-1" />
                    {locale === 'zh' ? '标记为已完成' : 'Mark as Complete'}
                  </Button>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                    <Check className="h-3 w-3" />
                    {locale === 'zh' ? '已完成' : 'Completed'}
                  </span>
                )}
                {readingProgressState.getProgress(paper.pmid) > 0 && readingProgressState.getProgress(paper.pmid) < 100 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[10px] font-medium text-claude-text-muted hover:text-claude-text"
                    onClick={() => readingProgressState.setProgress(paper.pmid, 0)}
                  >
                    Reset
                  </Button>
                )}
              </div>
            </div>

            {/* AI Summary */}
            <div className="border border-claude-border/50 dark:border-[#3d3832]/50 rounded-lg p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5 text-claude-accent" />
                  <span className="text-[10px] font-medium text-claude-text-muted uppercase tracking-wider">{locale === 'zh' ? 'AI 摘要' : 'AI Summary'}</span>
                </div>
                {!litAiSummary && !litAiSummaryLoading && (
                  <button
                    onClick={() => fetchLitAiSummary(paper)}
                    className="text-[10px] font-medium text-claude-accent dark:text-claude-accent-hover hover:underline"
                  >
                    Generate
                  </button>
                )}
              </div>
              {litAiSummaryLoading && (
                <div className="flex items-center gap-2 text-xs text-claude-text-muted">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Generating summary...
                </div>
              )}
              {litAiSummary && (
                <p className="text-xs text-claude-text-secondary leading-relaxed">{litAiSummary}</p>
              )}
            </div>

            {/* Metadata grid */}
            <div className="grid grid-cols-2 gap-3">
              {paper.authors && (
                <div className="col-span-2">
                  <div className="flex items-start gap-2">
                    <Users className="h-3.5 w-3.5 text-claude-text-muted mt-0.5 flex-shrink-0" />
                    <div>
                      <div className="text-[10px] font-medium text-claude-text-muted uppercase tracking-wider mb-0.5">{locale === 'zh' ? '作者' : 'Authors'}</div>
                      <div className="text-xs text-claude-text-secondary leading-relaxed">{paper.authors}</div>
                    </div>
                  </div>
                </div>
              )}
              {paper.journal && (
                <div>
                  <div className="text-[10px] font-medium text-claude-text-muted uppercase tracking-wider mb-0.5">{locale === 'zh' ? '期刊' : 'Journal'}</div>
                  <div className="text-xs text-claude-text-secondary font-medium">{paper.journal}</div>
                </div>
              )}
              {paper.IF != null && (
                <div>
                  <div className="text-[10px] font-medium text-claude-text-muted uppercase tracking-wider mb-0.5">{locale === 'zh' ? '影响因子' : 'Impact Factor'}</div>
                  <div className={`text-sm font-bold ${
                    paper.IF >= 20 ? 'text-red-600 dark:text-red-400' :
                    paper.IF >= 10 ? 'text-orange-600 dark:text-orange-400' :
                    paper.IF >= 5 ? 'text-emerald-600 dark:text-emerald-400' :
                    'text-claude-text'
                  }`}>
                    {paper.IF.toFixed(1)}
                  </div>
                </div>
              )}
              {paper.pubdate && (
                <div>
                  <div className="text-[10px] font-medium text-claude-text-muted uppercase tracking-wider mb-0.5">{t.date}</div>
                  <div className="text-xs text-claude-text-secondary">{paper.pubdate}</div>
                </div>
              )}
              <div>
                <div className="text-[10px] font-medium text-claude-text-muted uppercase tracking-wider mb-0.5">{locale === 'zh' ? 'PMID' : 'PMID'}</div>
                <div className="text-xs text-claude-text-secondary font-mono">{paper.pmid}</div>
              </div>
            </div>

            {/* DOI + PubMed links */}
            <div className="flex items-center gap-2">
              <a href={`https://pubmed.ncbi.nlm.nih.gov/${paper.pmid}/`} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-claude-accent/10 text-claude-accent dark:bg-claude-accent/20 dark:text-claude-accent-hover hover:bg-claude-accent/20 dark:hover:bg-claude-accent/30 transition-colors">
                <ExternalLink className="h-3 w-3" /> PubMed
              </a>
              {paper.doi && (
                <a href={`https://doi.org/${paper.doi}`} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-claude-border-light dark:bg-[#2b2926] text-claude-text-secondary hover:bg-claude-border dark:hover:bg-[#3d3832] transition-colors">
                  <Link2 className="h-3 w-3" /> DOI
                </a>
              )}
            </div>

            {/* Abstract */}
            {paper.abstract && (
              <div>
                <div className="text-[10px] font-medium text-claude-text-muted uppercase tracking-wider mb-1.5">{locale === 'zh' ? '摘要' : 'Abstract'}</div>
                <div className="text-xs text-claude-text-secondary leading-relaxed p-3 rounded-lg bg-claude-border-light/50 dark:bg-[#1a1917]/50 border border-claude-border/50 dark:border-[#3d3832]/50">
                  {paper.abstract}
                </div>
              </div>
            )}

            {/* Visual Quality Indicators */}
            <div className="flex items-center gap-2 flex-wrap">
              {/* IF Gradient Badge */}
              {paper.IF != null && (() => {
                const ifVal = paper.IF;
                const badgeColor = ifVal >= 30 ? 'bg-red-100 text-red-700 border-red-300 dark:bg-red-900/30 dark:text-red-300 dark:border-red-700/40' :
                  ifVal >= 15 ? 'bg-orange-100 text-orange-700 border-orange-300 dark:bg-orange-900/30 dark:text-orange-300 dark:border-orange-700/40' :
                  ifVal >= 5 ? 'bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700/40' :
                  'bg-emerald-100 text-emerald-700 border-emerald-300 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700/40';
                const glowStyle = ifVal >= 30 ? { boxShadow: '0 0 8px rgba(239,68,68,0.3)' } : ifVal >= 15 ? { boxShadow: '0 0 6px rgba(249,115,22,0.2)' } : {};
                return (
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border if-gradient-badge ${badgeColor}`} style={glowStyle}>
                    IF: {ifVal.toFixed(1)}
                  </span>
                );
              })()}
              {/* Journal Prestige Badge */}
              {paper.journal && (() => {
                const j = paper.journal.toLowerCase();
                const prestige = j.includes('nature') && !j.includes('communications') && !j.includes('methods') && !j.includes('structural') ?
                  { label: 'Nature', color: 'text-red-600 dark:text-red-400', bg: 'bg-red-50 dark:bg-red-900/20', border: 'border-red-200 dark:border-red-800/30', star: '★' } :
                  j.includes('science') ?
                  { label: 'Science', color: 'text-blue-600 dark:text-blue-400', bg: 'bg-blue-50 dark:bg-blue-900/20', border: 'border-blue-200 dark:border-blue-800/30', star: '★' } :
                  j.includes('cell') && !j.includes('stem') && !j.includes('reports') ?
                  { label: 'Cell', color: 'text-green-600 dark:text-green-400', bg: 'bg-green-50 dark:bg-green-900/20', border: 'border-green-200 dark:border-green-800/30', star: '★' } :
                  null;
                if (!prestige) return null;
                return (
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold border prestige-badge ${prestige.bg} ${prestige.color} ${prestige.border}`}>
                    {prestige.star} {prestige.label}
                  </span>
                );
              })()}
              {/* Altmetric-style Donut */}
              {paper.IF != null && (() => {
                const score = Math.round(Math.min(100, (paper.IF / 70) * 80 + (paper.pdbs?.length || 0) * 5 + (paper.abstract ? 5 : 0)));
                const size = 28;
                const strokeWidth = 3;
                const radius = (size - strokeWidth) / 2;
                const circumference = 2 * Math.PI * radius;
                const offset = circumference - (score / 100) * circumference;
                const donutColor = score >= 70 ? '#ef4444' : score >= 40 ? '#f97316' : score >= 20 ? '#eab308' : '#22c55e';
                return (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="inline-flex items-center gap-1">
                        <svg width={size} height={size} className="altmetric-donut">
                          <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke="currentColor" strokeWidth={strokeWidth} className="text-claude-border-light dark:text-[#2b2926]" />
                          <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke={donutColor} strokeWidth={strokeWidth} strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" transform={`rotate(-90 ${size/2} ${size/2})`} className="altmetric-donut-arc" style={{ transition: 'stroke-dashoffset 0.6s ease-out' }} />
                          <text x={size/2} y={size/2} textAnchor="middle" dominantBaseline="central" className="text-[8px] font-bold fill-claude-text-secondary">{score}</text>
                        </svg>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>{t.attentionScore}: {score}/100</TooltipContent>
                  </Tooltip>
                );
              })()}
            </div>

            {/* Citation Format Selector */}
            <div>
              <div className="text-[10px] font-medium text-claude-text-muted uppercase tracking-wider mb-1.5">{locale === 'zh' ? '引用本文' : 'Cite this paper'}</div>
              <CitationFormatSelector paper={paper} />
            </div>

            {/* Associated PDB structures */}
            {paper.pdbs.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 mb-2">
                  <Database className="h-3.5 w-3.5 text-claude-text-muted" />
                  <span className="text-[10px] font-medium text-claude-text-muted uppercase tracking-wider">
                    Associated PDB Structures ({paper.pdbs.length})
                  </span>
                </div>
                <div className="space-y-2">
                  {paper.pdbs.map(pdb => {
                    const methodStyle = getMethodColor(pdb.method || '');
                    // Resolution quality dot
                    const resDotColor = pdb.resolution != null
                      ? pdb.resolution < 2.5 ? 'bg-emerald-500'
                        : pdb.resolution < 3.5 ? 'bg-amber-500'
                        : 'bg-red-500'
                      : null;
                    return (
                      <div key={pdb.pdbId}
                        onClick={() => handleLitPdbClick(pdb.pdbId)}
                        className="flex items-center gap-2 p-2.5 rounded-lg border border-claude-border/60 dark:border-[#3d3832]/60 bg-claude-border-light/30 dark:bg-[#1a1917]/30 hover:bg-claude-accent/10 dark:hover:bg-claude-accent/10 cursor-pointer transition-colors">
                        {/* Resolution quality dot */}
                        {resDotColor && (
                          <span className={`inline-block h-2 w-2 rounded-full flex-shrink-0 ${resDotColor}`} title={
                            pdb.resolution! < 2.5 ? (locale === 'zh' ? '高分辨率 (<2.5Å)' : 'High resolution (<2.5Å)') :
                            pdb.resolution! < 3.5 ? (locale === 'zh' ? '中分辨率 (<3.5Å)' : 'Medium resolution (<3.5Å)') :
                            (locale === 'zh' ? '低分辨率 (≥3.5Å)' : 'Low resolution (≥3.5Å)')
                          } />
                        )}
                        <button
                          onClick={() => {
                            handleLitPdbClick(pdb.pdbId);
                          }}
                          className="text-xs font-mono font-bold text-claude-accent dark:text-claude-accent-hover hover:underline cursor-pointer">
                          {pdb.pdbId}
                        </button>
                        <span className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-medium ${methodStyle.bg} ${methodStyle.text} ${methodStyle.border} border`}>
                          {getMethodLabel(pdb.method || '')}
                        </span>
                        {pdb.resolution != null && (
                          <span className="text-[10px] text-claude-text-muted font-mono">
                            {pdb.resolution.toFixed(2)}Å
                          </span>
                        )}
                        {pdb.isBlast && (
                          <span className="text-[9px] px-1 py-0.5 rounded bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400">
                            BLAST
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Keywords */}
            {paper.keywords && paper.keywords.length > 0 && (
              <div>
                <div className="text-[10px] font-medium text-claude-text-muted uppercase tracking-wider mb-1.5">{locale === 'zh' ? '关键词' : 'Keywords'}</div>
                <div className="flex flex-wrap gap-1">
                  {paper.keywords.map((kw, i) => (
                    <span key={i} className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-claude-border-light dark:bg-[#2b2926] text-claude-text-secondary border border-claude-border/50 dark:border-[#3d3832]/50">
                      {kw}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Notes Section */}
            <PaperNotesSection
              pmid={paper.pmid}
              noteText={paperNotesState.getNote(paper.pmid)}
              noteData={paperNotesState.getNoteData(paper.pmid)}
              onNoteChange={paperNotesState.setNote}
            />

            {/* Tags Section */}
            <div className="border-t border-claude-border/50 dark:border-[#3d3832]/50 pt-3">
              <TagInput
                pmid={paper.pmid}
                currentTags={paperTagsState.getTags(paper.pmid)}
                onAddTag={paperTagsState.addTag}
                onRemoveTag={paperTagsState.removeTag}
              />
            </div>

            {/* Related Papers */}
            {litPapers.length > 1 && (
              <div className="border-t border-claude-border/50 dark:border-[#3d3832]/50 pt-3">
                <LiteratureRelatedPapers
                  currentPaper={paper}
                  allPapers={litPapers}
                  onSelectPaper={handleLitSelectPaper}
                />
              </div>
            )}
          </div>
      </>);

      return renderDetailPanelWrapper(litDetailContent, () => setLitIsDetailOpen(false));
    }

    // Evaluation structure detail — individual structure/homog detail panel
    if (mode === 'evaluation' && selectedEvalStructure) {
      const row = selectedEvalStructure;
      const isStructure = row._type === 'structure';
      const methodStyle = getMethodColor(row.method || '');
      const resDotColor = row.resolution != null
        ? row.resolution < 2.5 ? 'bg-emerald-500'
          : row.resolution < 3.5 ? 'bg-amber-500'
          : 'bg-red-500'
        : null;

      // Compute quality score (reuse weekly scoring — both share resolution/method/journalIf)
      const qualityEntry: Partial<PdbEntry> = {
        resolution: row.resolution,
        method: row.method,
        journalIf: row.journalIf,
      };
      const qualityScore = computeQualityScore(qualityEntry);
      const qualityBorderClass = getQualityBorderClass(qualityEntry);

      // Parse ligands
      const ligandList = parseLigands(isStructure ? (row as any).ligand || (row as any).ligandNames : (row as any).ligand);

      const evalStructureDetailContent = (<>
          {/* Accent gradient top bar */}
          <div className="glass-detail-panel-accent" />
          {/* Noise texture overlay */}
          <div className="glass-noise-overlay" />
          {/* Header */}
          <div className="px-4 py-3 border-b border-claude-border dark:border-[#3d3832] flex items-center justify-between relative z-[1]">
            <div className="flex items-center gap-2">
              <Atom className="h-4 w-4 text-claude-accent" />
              <span className="font-mono font-bold text-sm text-claude-accent">{row.pdbId}</span>
              {/* Quality Score Ring */}
              <div className="relative">
                <QualityRing score={qualityScore.score} size={32} />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-[8px] font-bold text-claude-text">{qualityScore.score}</span>
                </div>
              </div>
              {/* Type badge */}
              <span className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-medium border ${
                isStructure
                  ? 'bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-700/50'
                  : 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-700/50'
              }`}>
                {isStructure ? 'Structure' : 'Homolog'}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {/* Back to evaluation panel */}
              <Button variant="ghost" size="sm" onClick={() => setSelectedEvalStructure(null)} className="h-7 w-7 p-0 rounded-full bg-claude-border-light/80 dark:bg-[#2b2926]/80 hover:bg-claude-accent/10 text-claude-text-muted hover:text-claude-accent transition-all duration-200" title="Back to evaluation">
                <ChevronRight className="h-4 w-4 rotate-180" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setDetailPanelOpen(false); setSelectedEvalStructure(null); }} className="h-7 w-7 p-0 rounded-full bg-claude-border-light/80 dark:bg-[#2b2926]/80 hover:bg-red-100 dark:hover:bg-red-900/30 text-claude-text-muted hover:text-red-500 transition-all duration-200">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className={`flex-1 overflow-y-auto preview-scroll p-4 space-y-4 detail-scroll-container ${qualityBorderClass}`}>

            {/* 3D Structure Preview */}
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <Box className="h-3.5 w-3.5 text-claude-accent" />
                <span className="text-[10px] font-medium text-claude-text-muted uppercase tracking-wider">3D Structure</span>
              </div>
              <PdbThumbnailPreview
                pdbId={row.pdbId}
                title={row.title || (row as any).description}
                onClick={() => { setViewerModalPdbId(row.pdbId); setViewerModalOpen(true); }}
              />
            </div>

            {/* Title */}
            <div>
              <div className="text-xs text-claude-text-muted mb-1">{locale === 'zh' ? '标题' : 'Title'}</div>
              <div className="text-sm text-claude-text font-medium leading-snug">
                {row.title || (row as any).description || '—'}
              </div>
            </div>

            {/* Quality Score Breakdown — enhanced with StructureQualityRing */}
            <div>
              <div className="text-xs text-claude-text-muted mb-2">{locale === 'zh' ? '质量评分' : 'Quality Score'}</div>
              <StructureQualityRing
                score={qualityScore.score}
                size={56}
                showLabel={true}
                showBreakdown={true}
                breakdown={{
                  resolution: qualityScore.resolution,
                  method: qualityScore.method,
                  impact: qualityScore.impact,
                  coverage: 0,
                }}
              />
            </div>

            {/* Method & Resolution */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-claude-text-muted mb-1">{locale === 'zh' ? '方法' : 'Method'}</div>
                <span className={`method-badge inline-flex px-2 py-0.5 rounded text-[11px] font-medium border ${methodStyle.bg} ${methodStyle.text} ${methodStyle.border} border`}>
                  {getMethodLabel(row.method || '')}
                </span>
              </div>
              <div>
                <div className="text-xs text-claude-text-muted mb-1">{locale === "zh" ? "分辨率" : "Resolution"}</div>
                <div className="flex items-center gap-1.5">
                  {resDotColor && <span className={`inline-block h-2 w-2 rounded-full flex-shrink-0 ${resDotColor}`} title={
                    row.resolution! < 2.5 ? (locale === 'zh' ? '高分辨率 (<2.5Å)' : 'High resolution (<2.5Å)') :
                    row.resolution! < 3.5 ? (locale === 'zh' ? '中分辨率 (<3.5Å)' : 'Medium resolution (<3.5Å)') :
                    (locale === 'zh' ? '低分辨率 (≥3.5Å)' : 'Low resolution (≥3.5Å)')
                  } />}
                  <span className={`text-sm font-mono font-semibold ${
                    row.resolution != null
                      ? row.resolution <= 2.0 ? 'text-green-600 dark:text-green-400'
                        : row.resolution <= 3.5 ? 'text-amber-600 dark:text-amber-400'
                        : 'text-red-500 dark:text-red-400'
                      : 'text-claude-text-muted'
                  }`}>
                    {row.resolution != null ? `${row.resolution.toFixed(2)}Å` : '—'}
                  </span>
                </div>
              </div>
            </div>

            {/* BLAST-specific info (only for homolog rows) */}
            {!isStructure && (
              <div className="p-3 rounded-lg border border-amber-200 dark:border-amber-700/50 bg-amber-50/50 dark:bg-amber-900/10">
                <div className="text-[10px] font-medium text-amber-700 dark:text-amber-300 uppercase tracking-wider mb-2">{locale === 'zh' ? 'BLAST 同源信息' : 'BLAST Homolog Info'}</div>
                <div className="grid grid-cols-2 gap-2">
                  {(row as any).identity != null && (
                    <div>
                      <div className="text-[10px] text-claude-text-muted">{locale === 'zh' ? '一致性' : 'Identity'}</div>
                      <span className={`text-sm font-mono font-semibold ${
                        (row as any).identity >= 90 ? 'text-green-600 dark:text-green-400'
                          : (row as any).identity >= 70 ? 'text-teal-600 dark:text-teal-400'
                          : (row as any).identity >= 50 ? 'text-amber-600 dark:text-amber-400'
                          : 'text-red-500 dark:text-red-400'
                      }`}>
                        {(row as any).identity.toFixed(1)}%
                      </span>
                    </div>
                  )}
                  {(row as any).evalue != null && (
                    <div>
                      <div className="text-[10px] text-claude-text-muted">{locale === 'zh' ? 'E 值' : 'E-value'}</div>
                      <span className="text-sm font-mono font-semibold text-claude-text">
                        {formatEvalue(parseFloat((row as any).evalue))}
                      </span>
                    </div>
                  )}
                  {(row as any).queryCoverage != null && (
                    <div>
                      <div className="text-[10px] text-claude-text-muted">{locale === 'zh' ? '查询覆盖度' : 'Query Coverage'}</div>
                      <span className="text-sm font-mono font-semibold text-claude-text">
                        {(row as any).queryCoverage.toFixed(1)}%
                      </span>
                    </div>
                  )}
                  {(row as any).targetCoverage != null && (
                    <div>
                      <div className="text-[10px] text-claude-text-muted">{locale === 'zh' ? '靶标覆盖度' : 'Target Coverage'}</div>
                      <span className="text-sm font-mono font-semibold text-claude-text">
                        {(row as any).targetCoverage.toFixed(1)}%
                      </span>
                    </div>
                  )}
                </div>
                {(row as any).description && (
                  <div className="mt-2">
                    <div className="text-[10px] text-claude-text-muted mb-0.5">{locale === 'zh' ? '描述' : 'Description'}</div>
                    <div className="text-xs text-claude-text-secondary leading-relaxed">{(row as any).description}</div>
                  </div>
                )}
              </div>
            )}

            {/* Structure-specific info: Chain mapping */}
            {isStructure && (row as any).chainId && (
              <div className="grid grid-cols-2 gap-3">
                {(row as any).chainId && (
                  <div>
                    <div className="text-xs text-claude-text-muted mb-1">{locale === 'zh' ? '链' : 'Chain'}</div>
                    <div className="text-sm text-claude-text font-mono">{(row as any).chainId}</div>
                  </div>
                )}
                {(row as any).unpStart != null && (row as any).unpEnd != null && (
                  <div>
                    <div className="text-xs text-claude-text-muted mb-1">{locale === 'zh' ? 'UniProt 范围' : 'UniProt Range'}</div>
                    <div className="text-sm text-claude-text font-mono">{(row as any).unpStart}–{(row as any).unpEnd}</div>
                  </div>
                )}
              </div>
            )}

            {/* Authors */}
            {((row as any).authors || (row as any).pubmedAuthors) && (
              <div>
                <div className="flex items-center gap-1 mb-1">
                  <Users className="h-3 w-3 text-claude-text-muted" />
                  <span className="text-xs text-claude-text-muted">{locale === 'zh' ? '作者' : 'Authors'}</span>
                </div>
                <div className="text-xs text-claude-text-secondary leading-relaxed">
                  {(row as any).authors || (row as any).pubmedAuthors}
                </div>
              </div>
            )}

            {/* Organism */}
            {(row as any).organism && (
              <div>
                <div className="text-xs text-claude-text-muted mb-1">{locale === 'zh' ? '物种' : 'Organism'}</div>
                <div className="text-sm text-claude-text">{(row as any).organism}</div>
              </div>
            )}

            {/* Journal & IF */}
            <div>
              <div className="text-xs text-claude-text-muted mb-1">{locale === 'zh' ? '期刊' : 'Journal'}</div>
              <div className="text-sm text-claude-text">{row.journal || '—'}</div>
              {row.journalIf != null && (
                <span className={`inline-flex mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                  row.ifTier === 'top' ? 'bg-claude-top-bg text-claude-top' :
                  row.ifTier === 'high' ? 'bg-claude-high-bg text-claude-high' :
                  row.ifTier === 'mid' ? 'bg-claude-mid-bg text-claude-mid' :
                  'bg-claude-low-bg text-claude-low'
                }`}>
                  IF: {row.journalIf.toFixed(1)}
                </span>
              )}
            </div>

            {/* Release Date */}
            {(row as any).releaseDate && (
              <div>
                <div className="text-xs text-claude-text-muted mb-1">{locale === 'zh' ? '发布日期' : 'Release Date'}</div>
                <div className="text-sm text-claude-text">{formatDate((row as any).releaseDate)}</div>
              </div>
            )}

            {/* DOI as clickable link */}
            {row.doi && (
              <div>
                <div className="flex items-center gap-1 mb-1">
                  <Link2 className="h-3 w-3 text-claude-text-muted" />
                  <span className="text-xs text-claude-text-muted">DOI</span>
                </div>
                <a
                  href={`https://doi.org/${row.doi}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-claude-accent dark:text-claude-accent-hover hover:underline break-all"
                >
                  {row.doi}
                </a>
              </div>
            )}

            {/* Ligands */}
            {ligandList.length > 0 && (
              <div>
                <div className="text-xs text-claude-text-muted mb-1">{locale === 'zh' ? '配体' : 'Ligands'}</div>
                <div className="flex flex-wrap gap-1">
                  {ligandList.map((lig, i) => (
                    <span key={i} className="ligand-chip">{lig}</span>
                  ))}
                </div>
              </div>
            )}

            {/* PubMed: Title + Authors + Abstract */}
            {((row as any).pubmedAbstract || (row as any).pubmedTitle || (row as any).pubmedAuthors) && (
              <div className="space-y-2">
                {(row as any).pubmedTitle && (
                  <div>
                    <div className="flex items-center gap-1 mb-0.5">
                      <BookOpen className="h-3 w-3 text-claude-text-muted" />
                      <span className="text-[10px] text-claude-text-muted font-medium">{locale === 'zh' ? 'PubMed 标题' : 'PubMed Title'}</span>
                    </div>
                    <div className="text-xs text-claude-text font-medium leading-snug pl-4">
                      {(row as any).pubmedTitle}
                    </div>
                  </div>
                )}
                {(row as any).pubmedAuthors && (
                  <div>
                    <div className="flex items-center gap-1 mb-0.5">
                      <Users className="h-3 w-3 text-claude-text-muted" />
                      <span className="text-[10px] text-claude-text-muted font-medium">{locale === 'zh' ? 'PubMed 作者' : 'PubMed Authors'}</span>
                    </div>
                    <div className="text-[10px] text-claude-text-muted leading-relaxed pl-4">
                      {(row as any).pubmedAuthors}
                    </div>
                  </div>
                )}
                {(row as any).pubmedAbstract && (
                  <div>
                    <div className="flex items-center gap-1 mb-0.5">
                      <FileText className="h-3 w-3 text-claude-text-muted" />
                      <span className="text-[10px] text-claude-text-muted font-medium">{locale === 'zh' ? 'PubMed 摘要' : 'PubMed Abstract'}</span>
                    </div>
                    <div className="text-xs text-claude-text-secondary leading-relaxed p-3 rounded-lg bg-claude-border-light/50 dark:bg-[#1a1917]/50 border border-claude-border/50 dark:border-[#3d3832]/50">
                      {(row as any).pubmedAbstract}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* External Links */}
            <div className="pt-2 border-t border-claude-border dark:border-[#3d3832] space-y-2">
              <a href={`https://www.rcsb.org/structure/${row.pdbId}`} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-xs text-claude-accent hover:underline">
                <Database className="h-3.5 w-3.5" /> View on RCSB PDB
              </a>
              {row.doi && (
                <a href={`https://doi.org/${row.doi}`} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 text-xs text-claude-accent hover:underline">
                  <FileText className="h-3.5 w-3.5" /> View DOI Publication
                </a>
              )}
              {row.pubmedId && (
                <a href={`https://pubmed.ncbi.nlm.nih.gov/${row.pubmedId}/`} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 text-xs text-claude-accent hover:underline">
                  <ExternalLink className="h-3.5 w-3.5" /> View on PubMed
                </a>
              )}
            </div>

            {/* Back to Evaluation button */}
            <div className="pt-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs"
                onClick={() => setSelectedEvalStructure(null)}
              >
                <ChevronRight className="h-3 w-3 mr-1 rotate-180" />
                Back to {selectedEval?.proteinName || selectedEval?.uniprotId || 'Evaluation'}
              </Button>
            </div>
          </div>
      </>);

      return renderDetailPanelWrapper(evalStructureDetailContent, () => { setSelectedEvalStructure(null); setDetailPanelOpen(false); });
    }

    // Batch detail — show batch's combined report in the right panel (same as
    // single eval, but with batch-level info instead of per-target info).
    if (mode === 'evaluation' && selectedBatchId && !selectedEvalId) {
      const batch = evalBatches.find(b => b.batchId === selectedBatchId);
      const subTargets = batchSubTargets[selectedBatchId] || [];
      const commonPdbIds = (() => {
        if (!batch?.commonPdbIds) return [];
        try { const p = JSON.parse(batch.commonPdbIds); return Array.isArray(p) ? p.filter(Boolean) : []; }
        catch { return batch.commonPdbIds.split(/[\s,]+/).filter(Boolean); }
      })();
      const combinedReport = batch?.combinedReport || '';
      const crossOk = batch?.crossReportOk;

      // Fetch full Evaluation objects for each sub-target (for charts, tables, etc.)
      const subTargetEvals = subTargets
        .map(st => allEvaluations.find(e => e.uniprotId === st.uniprotId))
        .filter((e): e is Evaluation => !!e);

      // Build a synthetic aggregate Evaluation for chart components that expect a single eval.
      // We average coverage, sum PDB/BLAST counts, and merge arrays.
      const aggregateEval: Evaluation | null = subTargetEvals.length > 0 ? (() => {
        const avgCoverage = subTargetEvals.reduce((s, e) => s + (e.coverage || 0), 0) / subTargetEvals.length;
        const allStructures = subTargetEvals.flatMap(e => e.pdbStructures || []);
        const allBlast = subTargetEvals.flatMap(e => e.blastResults || []);
        // Average scores across sub-targets
        const scoreAgg: Record<string, { score: number; max: number; rating: string; count: number }> = {};
        for (const e of subTargetEvals) {
          if (!e.scores) continue;
          try {
            const parsed = JSON.parse(e.scores);
            for (const [k, v] of Object.entries(parsed)) {
              const sv = v as { score: number; max: number; rating: string };
              if (!scoreAgg[k]) scoreAgg[k] = { score: 0, max: sv.max || 10, rating: sv.rating || '', count: 0 };
              scoreAgg[k].score += sv.score || 0;
              scoreAgg[k].count = (scoreAgg[k].count || 0) + 1;
            }
          } catch { /* ignore parse errors */ }
        }
        for (const k of Object.keys(scoreAgg)) {
          const cnt = scoreAgg[k].count || 1;
          scoreAgg[k].score = scoreAgg[k].score / cnt;
        }
        return {
          uniprotId: 'BATCH_AGGREGATE',
          entryName: batch?.title || 'Batch Aggregate',
          proteinName: batch?.title || 'Batch Aggregate',
          geneNames: subTargets.map(s => s.geneName).filter(Boolean).join(', '),
          organism: 'Multiple',
          sequenceLength: Math.round(subTargetEvals.reduce((s, e) => s + (e.sequenceLength || 0), 0) / subTargetEvals.length),
          coverage: avgCoverage,
          scores: Object.keys(scoreAgg).length > 0 ? JSON.stringify(scoreAgg) : null,
          report: combinedReport,
          provenance: null,
          batchId: selectedBatchId,
          createdAt: batch?.createdAt || new Date().toISOString(),
          updatedAt: batch?.createdAt || new Date().toISOString(),
          pdbStructures: allStructures,
          blastResults: allBlast,
        } as Evaluation;
      })() : null;

      const batchDetailContent = (<>
        <div className="glass-detail-panel-accent" />
        <div className="glass-noise-overlay" />
        {/* Header */}
        <div className="px-4 py-3 border-b border-claude-border dark:border-[#3d3832] flex items-center justify-between relative z-[1]">
          <div className="flex items-center gap-2 min-w-0">
            <Layers className="h-4 w-4 text-violet-500 dark:text-violet-300 flex-shrink-0" />
            <div className="min-w-0">
              <span className="text-sm font-semibold text-claude-text truncate block">{batch?.title || 'Batch'}</span>
              <span className="text-[10px] text-claude-text-muted font-mono">{selectedBatchId}</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {crossOk !== null && crossOk !== undefined && (
              <Badge variant="outline" className={`text-[9px] font-semibold h-5 ${crossOk ? 'bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800/40' : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800/40'}`}>
                {crossOk ? <CheckCircle2 className="h-2.5 w-2.5" /> : <Info className="h-2.5 w-2.5" />}
                {crossOk ? 'OK' : 'Failed'}
              </Badge>
            )}
            <Button variant="ghost" size="sm" onClick={() => handleDeleteBatch(selectedBatchId)} className="h-7 w-7 p-0 rounded-full hover:bg-red-100 dark:hover:bg-red-900/30 text-claude-text-muted hover:text-red-500 transition-all duration-200" title="Delete batch">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setDetailPanelOpen(false); setSelectedBatchId(null); }} className="h-7 w-7 p-0 rounded-full bg-claude-border-light/80 dark:bg-[#2b2926]/80 hover:bg-red-100 dark:hover:bg-red-900/30 text-claude-text-muted hover:text-red-500 transition-all duration-200">
              <X className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Tab buttons — Report moved into Summary as a button */}
        <div className="flex border-b border-claude-border dark:border-[#3d3832] overflow-x-auto">
          {(['Summary', 'Targets', 'Structures', 'BLAST', 'Analysis', 'Breakdown', 'Compare'] as const).map(tab => {
            const tabLabel = tab === 'Summary' ? t.tabSummary : tab === 'Targets' ? t.tabTargets : tab === 'Structures' ? t.tabStructures : tab === 'BLAST' ? t.tabBLAST : tab === 'Analysis' ? t.tabAnalysis : tab === 'Breakdown' ? t.tabBreakdown : t.tabCompare;
            return (
            <button
              key={tab}
              onClick={() => setEvalDetailTab(tab)}
              className={`px-3 py-2 text-[11px] font-medium transition-colors whitespace-nowrap ${
                evalDetailTab === tab
                  ? 'text-claude-accent border-b-2 border-claude-accent'
                  : 'text-claude-text-muted hover:text-claude-text-secondary'
              }`}
            >
              {tabLabel}
            </button>
          );
          })}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto preview-scroll p-4">
          {evalDetailTab === 'Summary' && (
            <div className="space-y-3">
              {/* Report button — at top, opens modal with combined report */}
              {combinedReport && (
                <button
                  onClick={() => handleOpenBatchReport(selectedBatchId, batch?.title || 'Batch')}
                  className="group w-full flex items-center gap-2.5 px-4 h-11 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-claude-accent to-[#d4784f] hover:from-[#d4784f] hover:to-claude-accent shadow-md hover:shadow-lg hover:shadow-claude-accent/20 transition-all duration-200 active:scale-[0.98]"
                >
                  <FileText className="h-4 w-4 transition-transform group-hover:scale-110" />
                  <span>View Full Report</span>
                  <Maximize2 className="h-3.5 w-3.5 ml-auto opacity-70 group-hover:opacity-100 transition-opacity" />
                </button>
              )}
              {/* Stat cards row */}
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-lg border border-claude-border/50 dark:border-[#3d3832]/50 bg-claude-border-light/30 dark:bg-[#1a1917]/30 p-3">
                  <div className="text-[10px] text-claude-text-muted uppercase tracking-wider mb-1">Targets</div>
                  <div className="text-lg font-bold text-claude-text">{subTargets.length}</div>
                </div>
                <div className="rounded-lg border border-claude-border/50 dark:border-[#3d3832]/50 bg-claude-border-light/30 dark:bg-[#1a1917]/30 p-3">
                  <div className="text-[10px] text-claude-text-muted uppercase tracking-wider mb-1">Shared PDB</div>
                  <div className="text-lg font-bold text-claude-text">{commonPdbIds.length}</div>
                </div>
                <div className="rounded-lg border border-claude-border/50 dark:border-[#3d3832]/50 bg-claude-border-light/30 dark:bg-[#1a1917]/30 p-3">
                  <div className="text-[10px] text-claude-text-muted uppercase tracking-wider mb-1">Total PDB</div>
                  <div className="text-lg font-bold text-claude-text">{subTargets.reduce((s, st) => s + st.pdbCount, 0)}</div>
                </div>
                <div className="rounded-lg border border-claude-border/50 dark:border-[#3d3832]/50 bg-claude-border-light/30 dark:bg-[#1a1917]/30 p-3">
                  <div className="text-[10px] text-claude-text-muted uppercase tracking-wider mb-1">Total BLAST</div>
                  <div className="text-lg font-bold text-claude-text">{subTargets.reduce((s, st) => s + st.blastCount, 0)}</div>
                </div>
              </div>
              {/* Avg coverage bar */}
              {aggregateEval && (
                <div className="rounded-lg border border-claude-border/50 dark:border-[#3d3832]/50 bg-claude-border-light/30 dark:bg-[#1a1917]/30 p-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[10px] text-claude-text-muted uppercase tracking-wider">Avg Coverage</span>
                    <span className="text-xs font-bold text-claude-text">{(aggregateEval.coverage || 0).toFixed(1)}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-claude-border-light/60 dark:bg-[#2b2926] overflow-hidden">
                    <div className="h-full rounded-full bg-gradient-to-r from-claude-accent/60 to-claude-accent" style={{ width: `${Math.min(100, aggregateEval.coverage || 0)}%` }} />
                  </div>
                </div>
              )}
              {/* Common PDB IDs */}
              <div className="rounded-lg border border-claude-border/50 dark:border-[#3d3832]/50 bg-claude-border-light/30 dark:bg-[#1a1917]/30 p-3">
                <div className="text-[10px] text-claude-text-muted uppercase tracking-wider mb-2">Common PDB IDs</div>
                {commonPdbIds.length === 0 ? (
                  <p className="text-xs text-claude-text-muted italic">{t.noSharedStructures}</p>
                ) : (
                  <div className="flex flex-wrap gap-1">
                    {commonPdbIds.map(id => (
                      <a key={id} href={`https://www.rcsb.org/structure/${id}`} target="_blank" rel="noopener noreferrer"
                        className="text-[10px] font-mono font-bold text-claude-accent hover:underline px-1.5 py-0.5 rounded bg-claude-accent/5">
                        {id}
                      </a>
                    ))}
                  </div>
                )}
              </div>
              {/* Score comparison radar — uses EvalScoreRadar with aggregate as primary + sub-targets as comparisons */}
              {aggregateEval && subTargetEvals.length > 0 && (
                <div className="rounded-lg border border-claude-border/50 dark:border-[#3d3832]/50 bg-claude-border-light/30 dark:bg-[#1a1917]/30 p-3">
                  <div className="text-[10px] text-claude-text-muted uppercase tracking-wider mb-2">{t.batchAvgVsTargets}</div>
                  <EvalScoreRadar evaluation={aggregateEval} comparisonEvaluations={subTargetEvals.slice(0, 4)} size={200} />
                </div>
              )}
            </div>
          )}
          {evalDetailTab === 'Targets' && (
            <div className="space-y-1.5">
              {subTargets.length === 0 ? (
                <p className="text-xs text-claude-text-muted py-4 text-center">{t.noSubTargets}</p>
              ) : (
                subTargets.map(sub => (
                  <button
                    key={sub.uniprotId}
                    onClick={() => handleSelectSubTarget(sub.uniprotId)}
                    className="w-full flex items-center gap-2 p-2 rounded-lg border border-claude-border/40 dark:border-[#3d3832]/40 hover:bg-claude-accent/5 hover:border-claude-accent/20 transition-all text-left"
                  >
                    <div className="h-8 w-8 rounded-md bg-gradient-to-br from-claude-accent/15 to-claude-accent/5 border border-claude-accent/20 flex items-center justify-center flex-shrink-0">
                      <span className="text-[9px] font-mono font-bold text-claude-accent">{sub.uniprotId.slice(0, 2)}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs font-mono font-semibold text-claude-text">{sub.uniprotId}</span>
                        <span className="text-[10px] text-claude-text-muted">{sub.geneName || sub.proteinName}</span>
                      </div>
                      <div className="text-[10px] text-claude-text-muted">{sub.pdbCount} PDB · {sub.blastCount} BLAST</div>
                    </div>
                    <div className="flex flex-col items-end flex-shrink-0">
                      <span className="text-[10px] text-claude-text-muted">Score</span>
                      <span className={`text-sm font-bold ${sub.bestScore >= 7 ? 'text-emerald-600 dark:text-emerald-400' : sub.bestScore >= 4 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>
                        {sub.bestScore.toFixed(1)}
                      </span>
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
          {evalDetailTab === 'Structures' && (
            <div className="space-y-2 max-h-full overflow-y-auto preview-scroll pr-1">
              {subTargetEvals.length === 0 ? (
                <p className="text-xs text-claude-text-muted py-4 text-center">{t.noStructureData}</p>
              ) : subTargetEvals.flatMap(e => e.pdbStructures || []).length === 0 ? (
                <p className="text-xs text-claude-text-muted py-4 text-center">{t.noStructuresInBatch}</p>
              ) : (() => {
                const allStructures = subTargetEvals.flatMap(e => (e.pdbStructures || []).map(s => ({ ...s, _uniprotId: e.uniprotId, _type: 'structure' as const })));
                const showThumbnails = allStructures.length <= 10;
                return allStructures.map((s, i) => {
                  const methodStyle = getMethodColor(s.method || '');
                  return (
                    <div key={`${s.pdbId}-${i}`} className="flex items-center gap-2 p-2 rounded-lg border border-claude-border/40 dark:border-[#3d3832]/40 hover:bg-claude-accent/5 transition-colors">
                      {showThumbnails && (
                        <div className="flex-shrink-0 w-[70px]">
                          <PdbThumbnailPreview pdbId={s.pdbId} title={s.title ?? undefined} thumbHeight={70} hideInfoBar onClick={() => { setViewerModalPdbId(s.pdbId); setViewerModalOpen(true); }} />
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                          <span className="font-mono font-bold text-xs text-claude-accent">{s.pdbId}</span>
                          <span className="text-[9px] font-mono text-claude-text-muted bg-claude-border-light/60 dark:bg-[#2b2926] px-1 rounded">{s._uniprotId}</span>
                          <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded ${methodStyle}`}>{s.method || '—'}</span>
                          {s.resolution != null && (
                            <span className={`text-[9px] font-mono ${s.resolution < 2.5 ? 'text-emerald-600 dark:text-emerald-400' : s.resolution < 3.5 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>{s.resolution.toFixed(1)}Å</span>
                          )}
                        </div>
                        <p className="text-[10px] text-claude-text-secondary truncate">{s.title || '—'}</p>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>
          )}
          {evalDetailTab === 'BLAST' && (
            <div className="space-y-2">
              {subTargetEvals.length === 0 ? (
                <p className="text-xs text-claude-text-muted py-4 text-center">{t.noBlastData}</p>
              ) : subTargetEvals.flatMap(e => e.blastResults || []).length === 0 ? (
                <p className="text-xs text-claude-text-muted py-4 text-center">{t.noBlastInBatch}</p>
              ) : (
                subTargetEvals.flatMap(e => (e.blastResults || []).map(b => ({ ...b, _uniprotId: e.uniprotId }))).map((b, i) => (
                  <div key={`${b.pdbId}-${i}`} className="flex items-center gap-2 p-2 rounded-lg border border-claude-border/40 dark:border-[#3d3832]/40 hover:bg-claude-accent/5 transition-colors">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="font-mono font-bold text-xs text-claude-accent">{b.pdbId}</span>
                        <span className="text-[9px] font-mono text-claude-text-muted bg-claude-border-light/60 dark:bg-[#2b2926] px-1 rounded">{b._uniprotId}</span>
                        {b.identity != null && (
                          <span className={`text-[9px] font-mono ${b.identity >= 95 ? 'text-emerald-600 dark:text-emerald-400' : b.identity >= 70 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>{b.identity.toFixed(0)}%</span>
                        )}
                        {b.queryCoverage != null && (
                          <span className="text-[9px] text-claude-text-muted">cov {b.queryCoverage.toFixed(0)}%</span>
                        )}
                      </div>
                      <p className="text-[10px] text-claude-text-secondary truncate">{b.description || b.title || '—'}</p>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
          {evalDetailTab === 'Analysis' && aggregateEval && (
            <div className="space-y-4">
              <EvalScoreRadarChart evaluation={aggregateEval} />
            </div>
          )}
          {evalDetailTab === 'Breakdown' && aggregateEval && (
            <EvalScoreBreakdown evaluation={aggregateEval} allEvaluations={subTargetEvals} />
          )}
          {evalDetailTab === 'Compare' && (
            <EvalBatchCompare
              evaluations={allEvaluations}
              batches={batch ? [batch] : []}
              batchSubTargets={{ [selectedBatchId]: subTargets }}
              selectedBatchId={selectedBatchId}
            />
          )}
        </div>
      </>);

      return renderDetailPanelWrapper(batchDetailContent, () => { setDetailPanelOpen(false); });
    }

    // Evaluation detail — tabbed panel
    if (mode === 'evaluation' && selectedEval) {
      const evalTabNames = ['Summary', 'Structures', 'BLAST', 'Analysis', 'Breakdown', 'Provenance'] as const;

      // Inline Structures tab content
      const evalStructuresTab = (() => {
        const structures = selectedEval.pdbStructures || [];
        const showThumbnails = structures.length <= 10;
        return (
          <div className="space-y-2 max-h-full overflow-y-auto preview-scroll pr-1">
            {structures.length === 0 ? (
              <div className="text-xs text-claude-text-muted py-4 text-center">{t.noStructures}</div>
            ) : (
              structures.map((s) => {
                const methodStyle = getMethodColor(s.method || '');
                const resDotColor = s.resolution != null
                  ? s.resolution < 2.5 ? 'bg-emerald-500'
                    : s.resolution < 3.5 ? 'bg-amber-500'
                    : 'bg-red-500'
                  : null;
                return (
                  <div key={s.id} className="flex items-start gap-2 p-2 rounded-lg border border-claude-border/40 dark:border-[#3d3832]/40 hover:bg-claude-accent/5 transition-colors cursor-pointer"
                    onClick={() => {
                      setSelectedEvalStructure({ ...s, _type: 'structure' as const });
                    }}>
                    {showThumbnails && (
                      <div className="flex-shrink-0 w-[70px]">
                        <PdbThumbnailPreview pdbId={s.pdbId} title={s.title ?? undefined} thumbHeight={70} hideInfoBar onClick={() => { setViewerModalPdbId(s.pdbId); setViewerModalOpen(true); }} />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                        {resDotColor && (
                          <span className={`inline-block h-2 w-2 rounded-full flex-shrink-0 ${resDotColor}`} title={
                            s.resolution! < 2.5 ? (locale === 'zh' ? '高分辨率 (<2.5Å)' : 'High resolution (<2.5Å)') :
                            s.resolution! < 3.5 ? (locale === 'zh' ? '中分辨率 (<3.5Å)' : 'Medium resolution (<3.5Å)') :
                            (locale === 'zh' ? '低分辨率 (≥3.5Å)' : 'Low resolution (≥3.5Å)')
                          } />
                        )}
                        <a href={`https://www.rcsb.org/structure/${s.pdbId}`} target="_blank" rel="noopener noreferrer"
                          className="text-xs font-mono font-bold text-claude-accent dark:text-claude-accent-hover hover:underline"
                          onClick={(e) => e.stopPropagation()}>
                          {s.pdbId}
                        </a>
                        <span className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-medium ${methodStyle.bg} ${methodStyle.text} ${methodStyle.border} border`}>
                          {getMethodLabel(s.method || '')}
                        </span>
                        {s.resolution != null && (
                          <span className="text-[10px] text-claude-text-muted font-mono ml-auto">
                            {s.resolution.toFixed(2)}Å
                          </span>
                        )}
                      </div>
                      {s.title && (
                        <div className="text-[11px] text-claude-text-secondary leading-snug line-clamp-2">{s.title}</div>
                      )}
                      {s.organism && (
                        <div className="text-[10px] text-claude-text-muted mt-0.5">{s.organism}</div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        );
      })();

      // Inline BLAST tab content
      const evalBlastTab = (
        <div className="space-y-2">
          {(selectedEval.blastResults || []).length === 0 ? (
            <div className="text-xs text-claude-text-muted py-4 text-center">{t.noBlastResults}</div>
          ) : (
            (selectedEval.blastResults || []).map((b) => {
              const methodStyle = getMethodColor(b.method || '');
              const identityColor = b.identity != null
                ? b.identity >= 90 ? 'text-green-600 dark:text-green-400'
                  : b.identity >= 70 ? 'text-teal-600 dark:text-teal-400'
                  : b.identity >= 50 ? 'text-amber-600 dark:text-amber-400'
                  : 'text-red-500 dark:text-red-400'
                : 'text-claude-text-muted';
              const evalueNum = b.evalue != null ? parseFloat(b.evalue) : null;
              const evalueFormatted = evalueNum != null
                ? evalueNum === 0 ? '0'
                  : evalueNum < 0.001 ? evalueNum.toExponential(1)
                  : evalueNum.toFixed(2)
                : '—';
              return (
                <div key={b.id} className="p-2.5 rounded-lg border border-claude-border/60 dark:border-[#3d3832]/60 bg-claude-border-light/30 dark:bg-[#1a1917]/30 hover:bg-claude-border-light/60 dark:hover:bg-[#2b2926]/60 transition-colors cursor-pointer"
                  onClick={() => {
                    setSelectedEvalStructure({
                      ...b,
                      _type: 'blast' as const,
                      ifTier: b.ifTier || '',
                      journalIf: b.journalIf ?? null,
                      title: b.title || b.description || null,
                      releaseDate: b.releaseDate || null,
                      pubmedId: b.pubmedId || null,
                      pubmedTitle: b.pubmedTitle || null,
                      pubmedAuthors: b.pubmedAuthors || null,
                      pubmedAbstract: b.pubmedAbstract || null,
                    });
                  }}>
                  <div className="flex items-center gap-2 mb-1">
                    <a href={`https://www.rcsb.org/structure/${b.pdbId}`} target="_blank" rel="noopener noreferrer"
                      className="text-xs font-mono font-bold text-claude-accent dark:text-claude-accent-hover hover:underline"
                      onClick={(e) => e.stopPropagation()}>
                      {b.pdbId}
                    </a>
                    {b.identity != null && (
                      <span className={`text-xs font-mono font-semibold ${identityColor}`}>
                        {b.identity.toFixed(1)}%
                      </span>
                    )}
                    <span className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-medium ${methodStyle.bg} ${methodStyle.text} ${methodStyle.border} border`}>
                      {getMethodLabel(b.method || '')}
                    </span>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-claude-text-muted">
                    <span>E-value: <span className="font-mono">{evalueFormatted}</span></span>
                    {b.resolution != null && (
                      <span>Resolution: <span className="font-mono">{b.resolution.toFixed(2)}Å</span></span>
                    )}
                  </div>
                  {b.description && (
                    <div className="text-[10px] text-claude-text-secondary mt-1 line-clamp-2">{b.description}</div>
                  )}
                </div>
              );
            })
          )}
        </div>
      );

      // Inline Report tab content — no max-h cap so it fills the available
      // detail panel height (parent flex-1 overflow-y-auto handles scroll).
      const evalReportTab = (
        <div className="space-y-3">
          {evalReportContent ? (
            <div className="text-xs text-claude-text-secondary leading-relaxed p-3 rounded-lg bg-claude-border-light/50 dark:bg-[#1a1917]/50 border border-claude-border/50 dark:border-[#3d3832]/50">
              <ReportMarkdown>{evalReportContent}</ReportMarkdown>
            </div>
          ) : selectedEval.report ? (
            <div className="text-xs text-claude-text-secondary leading-relaxed p-3 rounded-lg bg-claude-border-light/50 dark:bg-[#1a1917]/50 border border-claude-border/50 dark:border-[#3d3832]/50">
              <ReportMarkdown>{selectedEval.report}</ReportMarkdown>
            </div>
          ) : (
            <div className="text-xs text-claude-text-muted py-4 text-center">{t.noReport}</div>
          )}
        </div>
      );

      const evalDetailContent = (<>
          {/* Accent gradient top bar */}
          <div className="glass-detail-panel-accent" />
          {/* Noise texture overlay */}
          <div className="glass-noise-overlay" />
          {/* Header */}
          <div className="px-4 py-3 border-b border-claude-border dark:border-[#3d3832] flex items-center justify-between relative z-[1]">
            <div className="flex items-center gap-2 min-w-0">
              <FlaskConical className="h-4 w-4 text-claude-accent flex-shrink-0" />
              <span className="font-mono font-bold text-sm text-claude-accent truncate">{selectedEval.uniprotId}</span>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <Button variant="ghost" size="sm" onClick={() => handleDeleteEval(selectedEval.uniprotId)} className="h-7 w-7 p-0 rounded-full hover:bg-red-100 dark:hover:bg-red-900/30 text-claude-text-muted hover:text-red-500 transition-all duration-200" title="Delete evaluation">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setDetailPanelOpen(false); setSelectedEvalStructure(null); }} className="h-7 w-7 p-0 rounded-full bg-claude-border-light/80 dark:bg-[#2b2926]/80 hover:bg-red-100 dark:hover:bg-red-900/30 text-claude-text-muted hover:text-red-500 transition-all duration-200">
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Tab buttons */}
          <div className="flex border-b border-claude-border dark:border-[#3d3832]">
            {evalTabNames.map(tab => {
              const tabLabel = tab === 'Summary' ? t.tabSummary : tab === 'Structures' ? t.tabStructures : tab === 'BLAST' ? t.tabBLAST : tab === 'Analysis' ? t.tabAnalysis : tab === 'Breakdown' ? t.tabBreakdown : '溯源';
              return (
              <button
                key={tab}
                onClick={() => setEvalDetailTab(tab)}
                className={`px-3 py-2 text-[11px] font-medium transition-colors ${
                  evalDetailTab === tab
                    ? 'text-claude-accent border-b-2 border-claude-accent'
                    : 'text-claude-text-muted hover:text-claude-text-secondary'
                }`}
              >
                {tabLabel}
              </button>
              );
            })}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto preview-scroll p-4">
            {evalDetailTab === 'Summary' && (
              <div className="space-y-3">
                {/* Report button — at top, opens modal with full report */}
                {(evalReportContent || selectedEval.report) && (
                  <button
                    onClick={() => {
                      setSelectedReport({
                        title: `${selectedEval.uniprotId} — Evaluation Report`,
                        content: evalReportContent || selectedEval.report || '',
                      });
                      setReportModalOpen(true);
                    }}
                    className="group w-full flex items-center gap-2.5 px-4 h-11 rounded-xl text-sm font-semibold text-white bg-gradient-to-r from-claude-accent to-[#d4784f] hover:from-[#d4784f] hover:to-claude-accent shadow-md hover:shadow-lg hover:shadow-claude-accent/20 transition-all duration-200 active:scale-[0.98]"
                  >
                    <FileText className="h-4 w-4 transition-transform group-hover:scale-110" />
                    <span>View Full Report</span>
                    <Maximize2 className="h-3.5 w-3.5 ml-auto opacity-70 group-hover:opacity-100 transition-opacity" />
                  </button>
                )}
                {/* Score radar — primary target only. Previously this passed
                    ALL other evaluations as comparisonEvaluations, which
                    overlaid every target's polygon on every other target's
                    radar, making the chart unreadable. The batch-comparison
                    radar (in the batch detail view) is the right place for
                    multi-target overlay; the single-target detail should
                    show only the selected target. */}
                <EvalSummary evaluation={selectedEval} />
              </div>
            )}
            {evalDetailTab === 'Structures' && evalStructuresTab}
            {evalDetailTab === 'BLAST' && evalBlastTab}
            {evalDetailTab === 'Analysis' && (
              <div className="space-y-4">
                <EvalScoreRadarChart evaluation={selectedEval} />
              </div>
            )}
            {evalDetailTab === 'Breakdown' && (
              <EvalScoreBreakdown evaluation={selectedEval} allEvaluations={allEvaluations} />
            )}
            {evalDetailTab === 'Provenance' && (
              <div className="p-4">
                <ProvenancePanel evaluation={selectedEval} />
              </div>
            )}
          </div>
      </>);

      return renderDetailPanelWrapper(evalDetailContent, () => { setDetailPanelOpen(false); setSelectedEvalStructure(null); });
    }

    // Weekly detail - enhanced with AI analysis, quality ring, PubMed abstract, etc.
    if (mode === 'weekly' && selectedEntry) {
      const qualityScore = computeQualityScore(selectedEntry);
      const qualityBorderClass = getQualityBorderClass(selectedEntry);

      const weeklyDetailContent = (<>
          {/* Accent gradient top bar */}
          <div className="glass-detail-panel-accent" />
          {/* Noise texture overlay */}
          <div className="glass-noise-overlay" />
          {/* Header */}
          <div className="px-4 py-3 border-b border-claude-border dark:border-[#3d3832] flex items-center justify-between relative z-[1]">
            <div className="flex items-center gap-2">
              <Atom className="h-4 w-4 text-claude-accent" />
              <span className="font-mono font-bold text-sm text-claude-accent">{selectedEntry.pdbId}</span>
              {/* Quality Score Ring */}
              <div className="relative">
                <QualityRing score={qualityScore.score} size={32} />
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-[8px] font-bold text-claude-text">{qualityScore.score}</span>
                </div>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setDetailPanelOpen(false)} className="h-7 w-7 p-0 rounded-full bg-claude-border-light/80 dark:bg-[#2b2926]/80 hover:bg-red-100 dark:hover:bg-red-900/30 text-claude-text-muted hover:text-red-500 transition-all duration-200">
              <X className="h-4 w-4" />
            </Button>
          </div>
          <div className={`flex-1 overflow-y-auto preview-scroll p-4 space-y-4 detail-scroll-container ${qualityBorderClass}`}>

            {/* 3D Structure Preview */}
            <div>
              <div className="flex items-center gap-1.5 mb-2">
                <Box className="h-3.5 w-3.5 text-claude-accent" />
                <span className="text-[10px] font-medium text-claude-text-muted uppercase tracking-wider">3D Structure</span>
              </div>
              <PdbThumbnailPreview
                pdbId={selectedEntry.pdbId || ''}
                title={selectedEntry.title ?? undefined}
                onClick={() => { setViewerModalPdbId(selectedEntry.pdbId); setViewerModalOpen(true); }}
              />
            </div>

            {/* Title */}
            <div>
              <div className="text-xs text-claude-text-muted mb-1">{locale === 'zh' ? '标题' : 'Title'}</div>
              <div className="text-sm text-claude-text font-medium leading-snug">
                {selectedEntry.title || '—'}
              </div>
            </div>

            {/* Quality Score Breakdown — enhanced with StructureQualityRing */}
            <div>
              <div className="text-xs text-claude-text-muted mb-2">{locale === 'zh' ? '质量评分' : 'Quality Score'}</div>
              <StructureQualityRing
                score={qualityScore.score}
                size={64}
                showLabel={true}
                showBreakdown={true}
                breakdown={{
                  resolution: qualityScore.resolution,
                  method: qualityScore.method,
                  impact: qualityScore.impact,
                  coverage: 0,
                }}
              />
            </div>

            {/* Method & Resolution */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <div className="text-xs text-claude-text-muted mb-1">{locale === 'zh' ? '方法' : 'Method'}</div>
                <span className={`method-badge inline-flex px-2 py-0.5 rounded text-[11px] font-medium border ${selectedEntry.isCryoem ? 'method-badge-cryoem bg-claude-cryoem-bg text-claude-cryoem border-claude-cryoem/30' : selectedEntry.isXray ? 'method-badge-xray bg-claude-xray-bg text-claude-xray border-claude-xray/30' : 'method-badge-nmr bg-claude-nmr-bg text-claude-nmr border-claude-nmr/30'}`}>
                  {getMethodLabel(selectedEntry.method || '')}
                </span>
              </div>
              <div>
                <div className="text-xs text-claude-text-muted mb-1">{locale === "zh" ? "分辨率" : "Resolution"}</div>
                <div className="flex items-center gap-1.5">
                  {selectedEntry.resolution != null && selectedEntry.resolution < 2.5 ? <span className="inline-block h-2 w-2 rounded-full flex-shrink-0 bg-emerald-500" title="High resolution (<2.5Å)" /> : null}
                  {selectedEntry.resolution != null && selectedEntry.resolution >= 2.5 && selectedEntry.resolution < 3.5 ? <span className="inline-block h-2 w-2 rounded-full flex-shrink-0 bg-amber-500" title="Medium resolution (<3.5Å)" /> : null}
                  {selectedEntry.resolution != null && selectedEntry.resolution >= 3.5 ? <span className="inline-block h-2 w-2 rounded-full flex-shrink-0 bg-red-500" title="Low resolution (>=3.5Å)" /> : null}
                  <span className={`text-sm font-mono font-semibold ${selectedEntry.resolution != null ? selectedEntry.resolution <= 2.0 ? 'text-green-600 dark:text-green-400' : selectedEntry.resolution <= 3.5 ? 'text-amber-600 dark:text-amber-400' : 'text-red-500 dark:text-red-400' : 'text-claude-text-muted'}`}>
                    {selectedEntry.resolution != null ? `${selectedEntry.resolution.toFixed(2)}Å` : '—'}
                  </span>
                </div>
              </div>
            </div>

            {/* Authors */}
            {selectedEntry.authors && (
              <div>
                <div className="flex items-center gap-1 mb-1">
                  <Users className="h-3 w-3 text-claude-text-muted" />
                  <span className="text-xs text-claude-text-muted">{locale === 'zh' ? '作者' : 'Authors'}</span>
                </div>
                <div className="text-xs text-claude-text-secondary leading-relaxed">
                  {selectedEntry.authors}
                </div>
              </div>
            )}

            {/* Organism */}
            {selectedEntry.organisms && (
              <div>
                <div className="text-xs text-claude-text-muted mb-1">{locale === 'zh' ? '物种' : 'Organism'}</div>
                <div className="text-sm text-claude-text">{selectedEntry.organisms}</div>
              </div>
            )}

            {/* Journal & IF */}
            <div>
              <div className="text-xs text-claude-text-muted mb-1">{locale === 'zh' ? '期刊' : 'Journal'}</div>
              <div className="text-sm text-claude-text">{selectedEntry.journal || '—'}</div>
              {selectedEntry.journalIf != null && (
                <span className={`inline-flex mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${selectedEntry.ifTier === 'top' ? 'bg-claude-top-bg text-claude-top' : selectedEntry.ifTier === 'high' ? 'bg-claude-high-bg text-claude-high' : selectedEntry.ifTier === 'mid' ? 'bg-claude-mid-bg text-claude-mid' : 'bg-claude-low-bg text-claude-low'}`}>
                  IF: {selectedEntry.journalIf.toFixed(1)}
                </span>
              )}
            </div>

            {/* Release Date */}
            {selectedEntry.releaseDate && (
              <div>
                <div className="text-xs text-claude-text-muted mb-1">{locale === 'zh' ? '发布日期' : 'Release Date'}</div>
                <div className="text-sm text-claude-text">{formatDate(selectedEntry.releaseDate)}</div>
              </div>
            )}

            {/* DOI as clickable link */}
            {selectedEntry.doi && (
              <div>
                <div className="flex items-center gap-1 mb-1">
                  <Link2 className="h-3 w-3 text-claude-text-muted" />
                  <span className="text-xs text-claude-text-muted">DOI</span>
                </div>
                <a
                  href={`https://doi.org/${selectedEntry.doi}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-claude-accent dark:text-claude-accent-hover hover:underline break-all"
                >
                  {selectedEntry.doi}
                </a>
              </div>
            )}

            {/* Ligands */}
            {selectedEntry.ligands && (() => {
              const ligandList = parseLigands(selectedEntry.ligands);
              if (ligandList.length === 0) return null;
              return (
                <div>
                  <div className="text-xs text-claude-text-muted mb-1">{locale === 'zh' ? '配体' : 'Ligands'}</div>
                  <div className="flex flex-wrap gap-1">
                    {ligandList.map((lig, i) => (
                      <span key={i} className="ligand-chip">{lig}</span>
                    ))}
                  </div>
                </div>
              );
            })()}

            {/* PubMed: Title + Authors + Abstract */}
            {(selectedEntry.pubmedAbstract || selectedEntry.pubmedTitle || selectedEntry.pubmedAuthors) && (
              <div className="space-y-2">
                {selectedEntry.pubmedTitle && (
                  <div>
                    <div className="flex items-center gap-1 mb-0.5">
                      <BookOpen className="h-3 w-3 text-claude-text-muted" />
                      <span className="text-[10px] text-claude-text-muted font-medium">{locale === 'zh' ? 'PubMed 标题' : 'PubMed Title'}</span>
                    </div>
                    <div className="text-xs text-claude-text font-medium leading-snug pl-4">
                      {selectedEntry.pubmedTitle}
                    </div>
                  </div>
                )}
                {selectedEntry.pubmedAuthors && (
                  <div>
                    <div className="flex items-center gap-1 mb-0.5">
                      <Users className="h-3 w-3 text-claude-text-muted" />
                      <span className="text-[10px] text-claude-text-muted font-medium">{locale === 'zh' ? 'PubMed 作者' : 'PubMed Authors'}</span>
                    </div>
                    <div className="text-[10px] text-claude-text-muted leading-relaxed pl-4">
                      {selectedEntry.pubmedAuthors}
                    </div>
                  </div>
                )}
                {selectedEntry.pubmedAbstract && (
                  <div>
                    <div className="flex items-center gap-1 mb-0.5">
                      <FileText className="h-3 w-3 text-claude-text-muted" />
                      <span className="text-[10px] text-claude-text-muted font-medium">{locale === 'zh' ? 'PubMed 摘要' : 'PubMed Abstract'}</span>
                    </div>
                    <div className="text-xs text-claude-text-secondary leading-relaxed p-3 rounded-lg bg-claude-border-light/50 dark:bg-[#1a1917]/50 border border-claude-border/50 dark:border-[#3d3832]/50">
                      {selectedEntry.pubmedAbstract}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* External Links */}
            <div className="pt-2 border-t border-claude-border dark:border-[#3d3832] space-y-2">
              <a href={`https://www.rcsb.org/structure/${selectedEntry.pdbId}`} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2 text-xs text-claude-accent hover:underline">
                <Database className="h-3.5 w-3.5" /> View on RCSB PDB
              </a>
              {selectedEntry.doi && (
                <a href={`https://doi.org/${selectedEntry.doi}`} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 text-xs text-claude-accent hover:underline">
                  <FileText className="h-3.5 w-3.5" /> View DOI Publication
                </a>
              )}
              {selectedEntry.pubmedId && (
                <a href={`https://pubmed.ncbi.nlm.nih.gov/${selectedEntry.pubmedId}/`} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 text-xs text-claude-accent hover:underline">
                  <ExternalLink className="h-3.5 w-3.5" /> View on PubMed
                </a>
              )}
            </div>

            {/* Back to Weekly button */}
            <div className="pt-2">
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs"
                onClick={() => { setDetailPanelOpen(false); setSelectedEntry(null); }}
              >
                <ChevronRight className="h-3 w-3 mr-1 rotate-180" />
                Back to Weekly
              </Button>
            </div>
          </div>
      </>);

      return renderDetailPanelWrapper(weeklyDetailContent, () => { setDetailPanelOpen(false); setSelectedEntry(null); });
    }


    return null;
  };

  // ─── Render ──────────────────────────────────────────────────────────────

  // ALL modes now use the SAME unified layout structure
  return (
    <TooltipProvider delayDuration={300}>
    <div className="h-full w-full flex flex-col bg-claude-bg overflow-hidden mode-transition mode-transition-active">
      {/* Custom Toast Container */}
      <CustomToastContainer />
      {/* Scroll Progress */}
      <ScrollProgress mode={mode} />
      {/* Demo data banner — shows when DB is empty, offers one-click seeding */}
      <DemoDataBanner />

      {/* ─── Header ──────────────────────────────────────────────────────── */}
      <header className="header-gradient-border relative z-10 flex-shrink-0 min-w-0 header-enhanced-bg">
        <HeaderParticles />
        <div className="relative z-10 px-4 py-2.5 flex items-center gap-4 min-w-0">
          <div className="flex items-center gap-2.5 flex-shrink-0">
            {/* Mobile menu button */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="lg:hidden h-8 w-8 p-0 text-claude-text-muted hover:text-claude-text"
                  onClick={() => setMobileMenuOpen(true)}
                >
                  <Menu className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom"><p>{t.menu}</p></TooltipContent>
            </Tooltip>
            <div className="header-icon-wrap h-8 w-8 rounded-lg bg-gradient-to-br from-claude-accent via-[#d4784f] to-[#c9872e] flex items-center justify-center shadow-md shadow-claude-accent/25 ring-1 ring-claude-accent/20">
              <Atom className="h-4.5 w-4.5 text-white header-icon-spin" />
            </div>
            <div className="hidden sm:block">
              <h1 className="header-title text-[15px] font-extrabold leading-none tracking-tight header-text-gradient">
                PDB Structure Tracker
                {bookmarks.size > 0 && (
                  <span className="ml-1.5 inline-flex items-center gap-0.5 text-[10px] font-medium text-claude-accent align-middle">
                    ★ {bookmarks.size}
                  </span>
                )}
              </h1>
              <p className="text-[10px] text-claude-text-muted leading-none mt-0.5">{t.proteinDataBank}</p>
            </div>
          </div>

          {/* Mode Tabs — Segmented Control with Sliding Pill */}
          <div
            ref={modeTabContainerRef}
            className="mode-segmented-control relative flex items-center ml-4 rounded-full p-[3px]"
          >
            {/* Sliding pill indicator */}
            <div
              className="mode-segmented-pill absolute top-[3px] h-[calc(100%-6px)] rounded-full bg-claude-surface dark:bg-[#302d2a] shadow-sm"
              style={{
                left: modePillStyle.left,
                width: modePillStyle.width,
                transition: 'left 0.3s cubic-bezier(0.4, 0, 0.2, 1), width 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
              }}
            />
            {MODE_TABS.map(tab => (
              <button
                key={tab.mode}
                ref={el => { modeTabRefs.current[tab.mode] = el; }}
                onClick={() => handleModeSwitch(tab.mode)}
                className={`mode-segmented-tab relative z-10 flex items-center justify-center gap-1.5 px-3.5 py-1 rounded-full text-[12px] font-medium transition-colors duration-200 ${
                  mode === tab.mode
                    ? 'text-claude-text'
                    : 'text-claude-text-muted hover:text-claude-text-secondary'
                }`}
                title={`${tab.label} (${tab.shortcut})`}
              >
                <span className="hidden sm:inline">{tab.mode === 'weekly' ? t.modeWeeklyFull : tab.mode === 'evaluation' ? t.modeEvaluationFull : tab.mode === 'analysis' ? (t.modeAnalysisFull ?? 'Analysis') : t.modeLiteratureFull}</span>
                <span className="sm:hidden text-[11px]">{tab.mode === 'weekly' ? t.modeWeeklyShort : tab.mode === 'evaluation' ? t.modeEvaluationShort : tab.mode === 'analysis' ? (t.modeAnalysisShort ?? 'Analysis') : t.modeLiteratureShort}</span>
              </button>
            ))}
          </div>

          <div className="flex-1" />

          {/* Search (desktop) — enhanced with recent + trending dropdown */}
          <div ref={searchWrapRef} className="relative max-w-xs w-full hidden md:block">
            <SearchDropdownEnhanced
              value={searchQuery}
              onChange={setSearchQuery}
              onSubmit={(v) => { setSearchQuery(v); }}
              placeholder={
                mode === 'evaluation' ? t.searchEvaluations :
                mode === 'literature' ? 'Search literature…' :
                t.searchStructures
              }
              mode={mode}
              inputRef={searchInputRef}
              recentSearchesKey="pdb-recent-searches-header"
            />
            {/* Keyboard shortcut hint — only when no query */}
            {!searchQuery && (
              <kbd className="absolute right-2 top-1/2 -translate-y-1/2 hidden lg:inline-flex items-center gap-0.5 text-[9px] text-claude-text-muted bg-claude-border-light dark:bg-[#2b2926] px-1 py-0 rounded border border-claude-border dark:border-[#3d3832] pointer-events-none z-10">
                ⌘K
              </kbd>
            )}
          </div>

          {/* Mobile search button (visible < md) */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="md:hidden h-7 w-7 p-0 text-claude-text-muted hover:text-claude-text active:scale-95 transition-transform duration-100"
                onClick={() => setMobileSearchOpen(true)}
              >
                <Search className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom"><p>{t.search}</p></TooltipContent>
          </Tooltip>

          {mode === 'weekly' && (
            <div className="flex items-center gap-1">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="sm" onClick={() => setShowDashboard(!showDashboard)}
                    className={`h-7 w-7 p-0 active:scale-95 transition-transform duration-100 ${showDashboard ? 'text-claude-accent' : 'text-claude-text-muted hover:text-claude-text'}`}>
                    <BarChart3 className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom"><p>{t.dashboardCharts}</p></TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-claude-text-muted hover:text-claude-text active:scale-95 transition-transform duration-100">
                    <TrendingUp className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom"><p>{t.trends}</p></TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button variant="ghost" size="sm" onClick={() => setWeeklyDiffOpen(true)}
                    className="h-7 w-7 p-0 text-claude-text-muted hover:text-claude-text active:scale-95 transition-transform duration-100">
                    <ArrowRightLeft className="h-3.5 w-3.5" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom"><p>{t.compareWeeks}</p></TooltipContent>
              </Tooltip>
            </div>
          )}

          {mode === 'literature' && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm"
                  onClick={() => setLitShowCharts(!litShowCharts)}
                  className={`h-7 w-7 p-0 active:scale-95 transition-transform duration-100 ${litShowCharts ? 'text-claude-accent' : 'text-claude-text-muted hover:text-claude-text'}`}>
                  <BarChart3 className="h-3.5 w-3.5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom"><p>{t.literatureCharts}</p></TooltipContent>
            </Tooltip>
          )}

          {/* Export Button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm"
                onClick={() => handleExportCurrentView('csv')}
                className="h-7 w-7 p-0 text-claude-text-muted hover:text-claude-text active:scale-95 transition-transform duration-100"
              >
                <Download className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom"><p>{t.exportData}</p></TooltipContent>
          </Tooltip>

          {/* Import Button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm"
                onClick={() => setImportDialogOpen(true)}
                className="h-7 w-7 p-0 text-claude-text-muted hover:text-claude-text active:scale-95 transition-transform duration-100"
              >
                <Upload className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom"><p>{t.importData}</p></TooltipContent>
          </Tooltip>

          {/* Refresh Data Button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm"
                onClick={handleRetryAll}
                disabled={isRefreshing}
                className="h-7 w-7 p-0 text-claude-text-muted hover:text-claude-text active:scale-95 transition-transform duration-100 disabled:opacity-50"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`} style={isRefreshing ? { animationDuration: '1s' } : undefined} />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom"><p>{t.refreshData}</p></TooltipContent>
          </Tooltip>

          {/* Notification Bell */}
          <NotificationBell />

          {/* Skills & Manual Run Panel (literature-daily / protein-target-evaluator) */}
          <SettingsRunPanel
            onDbChanged={handleRetryAll}
            open={runCenterOpen}
            onOpenChange={(open) => { if (!open && tourActive) return; setRunCenterOpen(open); }}
            activeTab={runCenterTab}
            onTabChange={setRunCenterTab}
            contentRef={runCenterContentRef}
            tabContentRef={tabContentRef}
          />

          {/* Settings Button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="sm" onClick={() => setSettingsOpen(true)}
                className="h-7 w-7 p-0 text-claude-text-muted hover:text-claude-text active:scale-95 transition-transform duration-100">
                <Settings className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom"><p>{t.settingsTitle}</p></TooltipContent>
          </Tooltip>

          {/* Help / Restart Onboarding Tour Button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={startTour}
                className="h-7 w-7 p-0 text-claude-text-muted hover:text-claude-accent active:scale-95 transition-transform duration-100"
                aria-label={t.helpBtn}
              >
                <HelpCircle className="h-3.5 w-3.5" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom"><p>{t.helpBtn}</p></TooltipContent>
          </Tooltip>

          {mounted && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" onClick={() => setTheme(isDark ? 'light' : 'dark')}
                  className="h-7 w-7 p-0 text-claude-text-muted hover:text-claude-text active:scale-95 transition-transform duration-100">
                  {isDark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom"><p>{isDark ? (locale === 'zh' ? '浅色模式' : 'Light Mode') : (locale === 'zh' ? '深色模式' : 'Dark Mode')}</p></TooltipContent>
            </Tooltip>
          )}
        </div>
      </header>

      {/* ─── Breadcrumb Navigation (Enhanced with dropdown navigation) ────────── */}
      <BreadcrumbNavEnhanced
        mode={mode}
        weekLabel={selectedSnapshot}
        entryId={selectedEntry?.pdbId}
        evalName={selectedEval?.proteinName}
        snapshots={snapshots}
        onModeChange={(newMode) => {
          if (newMode === mode) return;
          setMode(newMode);
          setSelectedEntry(null);
          setDetailPanelOpen(false);
        }}
        onWeekChange={(weekId) => {
          setSelectedSnapshot(weekId);
          setActiveFilter('all');
          setSelectedEntry(null);
          setDetailPanelOpen(false);
        }}
        onHomeClick={() => {
          setSelectedEntry(null);
          setDetailPanelOpen(false);
          setSelectedEvalId(null);
          setSelectedEval(null);
          setLitIsDetailOpen(false);
          setLitSelectedPaper(null);
          setMode('weekly');
        }}
      />

      {/* Settings Panel */}
      <SettingsPanel
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        settings={appSettings}
        updateSetting={updateSetting}
        updateSettings={updateSettings}
        resetSettings={resetSettings}
        toggleActivityType={toggleActivityType}
      />

      {/* ─── Body ────────────────────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden min-w-0">
        {/* Structure Analysis mode — full-screen 3-pane layout, no sidebar */}
        {mode === 'analysis' ? (
          <div className="flex-1 flex flex-col min-h-0 min-w-0">
            <StructureAnalysisView />
          </div>
        ) : (
        <>
        {/* Sidebar (desktop only) */}
        {mode === 'weekly' && renderWeeklySidebar()}
        {mode === 'evaluation' && renderEvalSidebar()}
        {mode === 'literature' && renderLiteratureSidebar()}

        {/* Mobile Drawer Sidebar */}
        {mobileMenuOpen && (
          <>
            <div
              className="fixed inset-0 bg-black/50 z-40 lg:hidden animate-in fade-in duration-200"
              onClick={() => setMobileMenuOpen(false)}
            />
            <div
              className="fixed left-0 top-0 bottom-0 w-[280px] z-50 lg:hidden mobile-drawer-shadow animate-in slide-in-from-left duration-300"
            >
              {mode === 'weekly' && renderWeeklySidebar(true)}
              {mode === 'evaluation' && renderEvalSidebar(true)}
              {mode === 'literature' && renderLiteratureSidebar(true)}
            </div>
          </>
        )}

        {/* Mobile Search Overlay */}
        {mobileSearchOpen && (
          <>
            <div
              className="fixed inset-0 bg-black/30 z-40 md:hidden animate-in fade-in duration-200"
              onClick={() => setMobileSearchOpen(false)}
            />
            <div
              className="fixed top-0 left-0 right-0 z-50 md:hidden bg-claude-surface dark:bg-[#242220] border-b border-claude-border dark:border-[#3d3832] p-3 shadow-lg animate-in slide-in-from-top duration-300"
            >
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-claude-text-muted" />
                <Input
                  autoFocus
                  type="text"
                  placeholder={
                    mode === 'evaluation' ? t.searchEvaluations :
                    mode === 'literature' ? 'Search literature…' :
                    t.searchStructures
                  }
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="h-9 pl-10 pr-10 text-sm bg-claude-bg dark:bg-[#1a1917] border-claude-border dark:border-[#3d3832] input-focus-glow"
                />
                <button
                  onClick={() => { setMobileSearchOpen(false); setSearchQuery(''); }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-claude-text-muted hover:text-claude-text"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          </>
        )}

        {/* Main Content Area — z-20 ensures content stays above footer (z-10) */}
        <div ref={mainContentRef} className="flex-1 flex flex-col min-w-0 overflow-y-auto overflow-x-hidden main-content-scroll bg-pattern-dots relative z-20">
          {/* Welcome State - shown on initial load */}
          {showWelcome && !loading && entries.length === 0 && evaluations.length === 0 && litPapers.length === 0 && (
            <WelcomeStateComponent
              mode={mode}
              totalEntries={currentSnapshot?.totalStructures ?? 0}
              avgResolution={currentSnapshot?.cryoemAvgRes ?? currentSnapshot?.xrayAvgRes ?? undefined}
              cryoemPct={currentSnapshot?.cryoemCount != null && currentSnapshot?.totalStructures ? (currentSnapshot.cryoemCount / currentSnapshot.totalStructures) * 100 : undefined}
              totalEvaluations={allEvaluations.length}
              avgCoverage={allEvaluations.length > 0 ? allEvaluations.reduce((sum, e) => sum + (e.coverage ?? 0), 0) / allEvaluations.length : undefined}
              totalPapers={litPapers.length}
              avgIf={litPapers.length > 0 ? litPapers.reduce((sum, p) => sum + (p.IF ?? 0), 0) / litPapers.length : undefined}
              recentItems={[
                ...(snapshots.slice(0, 2).map(s => ({ id: s.weekId, title: `Week ${s.weekId} — ${s.totalStructures} structures`, type: 'structure' as const, date: s.date }))),
                ...(allEvaluations.slice(0, 1).map(e => ({ id: e.uniprotId, title: e.proteinName ?? 'Evaluation', type: 'evaluation' as const, date: e.createdAt }))),
              ].slice(0, 3)}
              onSelectWeekly={() => { setShowWelcome(false); setMode('weekly'); }}
              onSelectEvaluation={() => { setShowWelcome(false); setMode('evaluation'); }}
              onSelectLiterature={() => { setShowWelcome(false); setMode('literature'); }}
              onOpenSearch={() => { setShowWelcome(false); setCommandPaletteOpen(true); }}
              onShowKeyboardHints={() => { setKeyboardHintsOpen(true); }}
            />
          )}

          {/* Error Banner — persistent error display with retry + dismiss */}
          <ErrorBanner
            error={fetchError}
            loading={loading}
            isDbError={fetchError === dbErrorMsg}
            onRetry={handleRetryAll}
            onOpenRunCenter={() => { setFetchError(null); setRunCenterOpen(true); }}
            onDismiss={() => setFetchError(null)}
          />

          {/* Quick Stats Panel */}
          {!(showWelcome && !loading && entries.length === 0 && evaluations.length === 0 && litPapers.length === 0) && (
          <QuickStatsPanel
            mode={mode}
            entries={entries}
            evaluations={allEvaluations}
            papers={litPapers}
            snapshots={snapshots}
            currentSnapshot={currentSnapshot}
            loading={mode === 'weekly' ? loading : mode === 'evaluation' ? evalLoading : litLoading}
          />
          )}

          {/* Search Status Banner — shows active search/filter with result count */}
          {mode === 'weekly' && (
            <SearchStatusBanner
              searchQuery={searchQuery}
              activeFilter={activeFilter}
              resultCount={filteredEntries.length}
              totalCount={entries.length}
              onClearSearch={() => setSearchQuery('')}
              onClearFilter={() => setActiveFilter('all')}
              onClearAll={() => { setSearchQuery(''); setActiveFilter('all'); }}
              mode="weekly"
            />
          )}
          {mode === 'evaluation' && (
            <SearchStatusBanner
              searchQuery={searchQuery}
              activeFilter={evalFilter}
              resultCount={filteredEvaluations.length}
              totalCount={allEvaluations.length}
              onClearSearch={() => setSearchQuery('')}
              onClearFilter={() => setEvalFilter('all')}
              onClearAll={() => { setSearchQuery(''); setEvalFilter('all'); }}
              mode="evaluation"
            />
          )}
          {mode === 'literature' && litHasActiveFilters && (
            <SearchStatusBanner
              searchQuery=""
              activeFilter={litSourceFilter !== 'all' ? litSourceFilter : litIfFilter}
              resultCount={litPapers.length}
              totalCount={litPapers.length}
              onClearSearch={() => {}}
              onClearFilter={() => { setLitSourceFilter('all'); setLitIfFilter('all'); setLitSelectedDate(null); setLitReadingListFilter(null); setLitTagFilter(null); }}
              onClearAll={() => { setLitSourceFilter('all'); setLitIfFilter('all'); setLitSelectedDate(null); setLitReadingListFilter(null); setLitTagFilter(null); }}
              mode="literature"
            />
          )}

          {/* Enhanced Structure Stats Cards — visible in Weekly mode with data */}
          {mode === 'weekly' && entries.length > 0 && (
            <StructureStatsCards entries={entries} />
          )}

          {/* Dashboard Summary Widget — mini charts for method/resolution/trend/journals */}
          {mode === 'weekly' && entries.length > 0 && snapshots.length > 0 && (
            <DashboardSummaryWidget entries={entries} snapshots={snapshots} />
          )}

          {/* Enhanced Literature Stats Cards — visible in Literature mode with data */}
          {mode === 'literature' && litPapers.length > 0 && (
            <LiteratureStatsCards papers={litPapers} stats={litStats} />
          )}

          {/* Enhanced Weekly Dashboard Charts */}
          {mode === 'weekly' && !(showWelcome && !loading && entries.length === 0 && evaluations.length === 0 && litPapers.length === 0) && (
            <div className="border-b border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220]">
              <button
                onClick={() => setShowDashboard(!showDashboard)}
                className="w-full flex items-center gap-1.5 px-4 py-2 text-[11px] font-medium text-claude-text-muted hover:text-claude-text-secondary transition-colors"
              >
                {showDashboard ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                <LayoutDashboard className="h-3 w-3" />
                {t.dashboardCharts}
                <span className="ml-1 text-[10px] text-claude-text-muted">
                  · {entries.length} {locale === 'zh' ? '个结构' : 'structures'}
                </span>
              </button>
              <div
                className="overflow-hidden transition-all duration-300 ease-in-out"
                style={{ maxHeight: showDashboard ? 1200 : 0, opacity: showDashboard ? 1 : 0 }}
              >
                {/* Only mount charts when expanded so recharts RadarChart has
                    correct parent dimensions on first render. Mounting inside
                    a maxHeight:0 container causes recharts to compute 0-size
                    and skip rendering the Radar polygon (path.recharts-polygon). */}
                {showDashboard && (
                  <div className="space-y-3">
                    <QualityScoreDashboard entries={entries} locale={locale} />
                    <WeeklyDashboardCharts entries={entries} snapshots={snapshots} />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Toolbar (weekly only) */}
          {mode === 'weekly' && (
            <WeeklyPageControls
              activeFilter={activeFilter}
              onFilterChange={(f) => { setActiveFilter(f); setCurrentPage(1); }}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              sortField={sortField}
              sortDir={sortDir}
              onSort={handleSort}
              totalCount={filteredEntries.length}
              selectedWeek={selectedSnapshot}
              filteredEntries={filteredEntries}
            />
          )}
          {/* Toolbar (evaluation) */}
          {mode === 'evaluation' && (
            <EvalPageControls
              activeFilter={evalFilter}
              onFilterChange={(f) => { setEvalFilter(f); }}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              sortField={evalSortField}
              sortDir={evalSortDir}
              onSort={handleEvalSort}
              totalCount={filteredEvaluations.length}
              selectedEvalId={selectedEvalId}
              filteredEvaluations={filteredEvaluations}
            />
          )}

          {/* Content */}
          <div
            key={mode}
            className="flex-1 flex flex-col min-h-0 overflow-hidden relative mode-content-transition"
          >
              {mode === 'weekly' && (
                <div key="weekly" className="flex flex-col min-h-0 flex-1 custom-scrollbar">
                  <WeeklyView
                    entries={entries}
                    snapshots={snapshots}
                    currentSnapshot={currentSnapshot}
                    loading={loading}
                    sortField={sortField}
                    sortDir={sortDir}
                    currentPage={currentPage}
                    pageSize={pageSize}
                    filteredEntries={filteredEntries}
                    paginatedEntries={paginatedEntries}
                    totalPages={totalPages}
                    bookmarks={bookmarks}
                    selectedEntryIds={selectedEntryIds}
                    highlightedRowId={highlightedRowId}
                    showHeatmap={showHeatmap}
                    showTrend={showTrend}
                    showTimeline={showTimeline}
                    showQualityDist={showQualityDist}
                    showWeekCompare={showWeekCompare}
                    weeklyDateFilter={weeklyDateFilter}
                    selectedSnapshot={selectedSnapshot}
                    onSort={handleSort}
                    onRowClick={handleRowClick}
                    onToggleBookmark={toggleBookmark}
                    onSelectEntries={setSelectedEntryIds}
                    onHighlightRow={setHighlightedRowId}
                    onSetShowHeatmap={setShowHeatmap}
                    onSetShowTrend={setShowTrend}
                    onSetShowTimeline={setShowTimeline}
                    onSetShowQualityDist={setShowQualityDist}
                    onSetShowWeekCompare={setShowWeekCompare}
                    onSetWeeklyDateFilter={setWeeklyDateFilter}
                    onSetCurrentPage={setCurrentPage}
                    onSetPageSize={setPageSize}
                  />
                </div>
              )}
              {mode === 'evaluation' && (
                <div key="eval" className="flex flex-col min-h-0 flex-1 custom-scrollbar">
                  <EvaluationView
                    evaluations={evaluations}
                    allEvaluations={allEvaluations}
                    evalBatches={evalBatches}
                    batchSubTargets={batchSubTargets}
                    selectedEvalId={selectedEvalId}
                    selectedEval={selectedEval}
                    evalLoading={evalLoading}
                    evalSubView={evalSubView}
                    evalDetailTab={evalDetailTab}
                    selectedEvalStructure={selectedEvalStructure}
                    evalReportContent={evalReportContent}
                    detailPanelOpen={detailPanelOpen}
                    onSelectEvalId={(id) => {
                      if (id === null) {
                        // "Back to list" — clear batch selection too.
                        setSelectedEvalId(null);
                        setSelectedEval(null);
                        setSelectedEvalStructure(null);
                        setSelectedBatchId(null);
                        setDetailPanelOpen(false);
                      } else {
                        setSelectedEvalId(id);
                        setDetailPanelOpen(true);
                      }
                    }}
                    onSetEvalSubView={setEvalSubView}
                    onSetEvalDetailTab={setEvalDetailTab}
                    onSetSelectedEvalStructure={setSelectedEvalStructure}
                    onSetDetailPanelOpen={setDetailPanelOpen}
                    selectedBatchId={selectedBatchId}
                    batchFetchedEvals={batchFetchedEvals}
                    onSelectSubTarget={handleSelectSubTarget}
                    onOpenBatchReport={handleOpenBatchReport}
                  />
                </div>
              )}
              {mode === 'literature' && (
                <div key="lit" className="flex flex-col min-h-0 flex-1 overflow-y-auto custom-scrollbar">
                  <LiteratureView
                    stats={litStats}
                    papers={litPapers}
                    reports={litReports}
                    isLoading={litLoading}
                    showCharts={litShowCharts}
                    selectedDate={litSelectedDate}
                    externalSearch={searchQuery}
                    readingListFilter={litReadingListFilter}
                    paperNotesHook={paperNotesState}
                    openNotePmid={litOpenNotePmid}
                    paperTagsHook={paperTagsState}
                    tagFilter={litTagFilter}
                    sourceFilter={litSourceFilter}
                    onSourceFilterChange={() => setLitSourceFilter(litSourceFilter === 'all' ? 'daily' : 'all')}
                    ifFilter={litIfFilter}
                    onIfFilterChange={setLitIfFilter}
                    readingProgressHook={readingProgressState}
                    readingListHook={readingListState}
                    totalPapersCount={litPapers.length}
                    onToggleCharts={() => setLitShowCharts(!litShowCharts)}
                    onClearDateFilter={handleLitClearDateFilter}
                    onSelectPaper={handleLitSelectPaper}
                    hasActiveFilters={litHasActiveFilters || !!litReadingListFilter || !!litTagFilter}
                    onClearAllFilters={() => { handleLitClearAllFilters(); setLitReadingListFilter(null); setLitTagFilter(null); setLitSourceFilter('all'); setLitIfFilter('all'); }}
                    onClearReadingListFilter={() => setLitReadingListFilter(null)}
                    onOpenNote={setLitOpenNotePmid}
                    onTagFilterChange={setLitTagFilter}
                  />
                </div>
              )}
            </div>
        </div>

        {/* Scroll-to-Top FAB */}
        <ScrollToTop scrollContainerRef={mainContentRef} threshold={300} />

        {/* Weekly Bulk Actions Bar */}
        {mode === 'weekly' && (
          <WeeklyBulkActions
            selectedCount={selectedEntryIds.size}
            totalCount={filteredEntries.length}
            selectedEntries={entries.filter(e => selectedEntryIds.has(e.pdbId))}
            bookmarks={bookmarks}
            onBookmarkAll={handleBookmarkAll}
            onExportSelected={handleExportSelected}
            onCompare={handleCompare}
            onClearSelection={handleClearSelection}
            onBatchTag={handleBatchTag}
            canCompare={selectedEntryIds.size >= 2 && selectedEntryIds.size <= 4}
          />
        )}

        {/* Weekly Structure Compare Modal */}
        {mode === 'weekly' && compareMode && selectedEntryIds.size >= 2 && selectedEntryIds.size <= 4 && (
          <WeeklyStructureCompare
            entries={entries.filter(e => selectedEntryIds.has(e.pdbId))}
            onClose={() => setCompareMode(false)}
          />
        )}

        {/* Detail Panel */}
        {renderDetailPanel()}
        </>
        )}
      </div>

      {/* ─── Enhanced Footer ──────────────────────────────────────────────── */}
      <EnhancedFooter
        dataFetchedAt={dataFetchedAt}
        totalEntries={
          mode === 'weekly' ? filteredEntries.length :
          mode === 'evaluation' ? evaluations.length :
          mode === 'analysis' ? 0 :
          litPapers.length
        }
        apiStatus={usingFallbackData ? (fetchError ? 'offline' : 'degraded') : 'online'}
        usingFallbackData={usingFallbackData}
        onRefresh={handleRetryAll}
        isRefreshing={isRefreshing}
      />

      {/* ─── Command Palette ──────────────────────────────────────────────── */}
      <CommandPalette
        open={commandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
        onSwitchMode={handleModeSwitch}
        onToggleTheme={() => setTheme(isDark ? 'light' : 'dark')}
        onToggleCharts={() => {
          if (mode === 'literature') setLitShowCharts(!litShowCharts);
          else if (mode === 'weekly') setShowDashboard(!showDashboard);
        }}
        currentMode={mode}
        isDark={isDark}
        onSelectPdbEntry={handleCommandSelectPdbEntry}
        onSelectEvaluation={handleCommandSelectEvaluation}
        onSelectPaper={handleCommandSelectPaper}
        evaluations={allEvaluations}
        onApplyQuickFilter={(filterId) => {
          if (filterId === 'high-impact') {
            setMode('weekly');
            setActiveFilter('all');
            setLitIfFilter('20');
            toast.info('High Impact filter applied', { description: 'Showing structures from journals with IF ≥ 20' });
          } else if (filterId === 'cryo-em') {
            setMode('weekly');
            setActiveFilter('Cryo-EM');
            toast.info('Cryo-EM filter applied', { description: 'Showing Cryo-EM structures' });
          } else if (filterId === 'this-week') {
            setMode('weekly');
            if (snapshots.length > 0) {
              setSelectedSnapshot(snapshots[0].weekId);
            }
            toast.info('Latest week selected', { description: 'Showing structures from the most recent week' });
          }
        }}
        onSetSearchQuery={(query) => {
          setSearchQuery(query);
          if (mode === 'weekly') {
            fetchEntries(selectedSnapshot || undefined, activeFilter !== 'all' ? activeFilter : undefined, query);
          } else if (mode === 'literature') {
            fetchLitPapers(query);
          }
          toast.info('Search applied', { description: `Searching for "${query}"` });
        }}
      />

      {/* ─── Weekly Report Modal ───────────────────────────────────────────── */}
      <ReportModal
        isOpen={reportModalOpen}
        onClose={() => setReportModalOpen(false)}
        title={selectedReport?.title || ''}
        content={selectedReport?.content || ''}
      />

      {/* ─── Evaluation Report Generator ──────────────────────────────────── */}
      {selectedEval && (
        <EvalReportGenerator
          evaluation={selectedEval}
          isOpen={evalReportOpen}
          onClose={() => setEvalReportOpen(false)}
        />
      )}

      {/* Keyboard Hints Overlay */}
      <KeyboardHints
        open={keyboardHintsOpen}
        onClose={() => setKeyboardHintsOpen(false)}
      />

      {/* Data Import Dialog */}
      <DataImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        defaultType={mode === 'literature' ? 'pubmed' : 'pdb'}
      />

      {/* 3D Viewer Modal */}
      <PdbViewerModal
        pdbId={viewerModalPdbId}
        open={viewerModalOpen}
        onOpenChange={setViewerModalOpen}
        onOpenInAnalysis={(pdbId) => {
          // Hand off the PDB ID to the Structure Analysis module
          useMolcraftStore.getState().setPendingPdbId(pdbId);
          setMode('analysis');
        }}
      />

      {/* Weekly Diff Compare Modal */}
      {weeklyDiffOpen && (
        <WeeklyDiffCompare
          snapshots={snapshots}
          onFetchEntries={fetchEntriesForWeek}
          onClose={() => setWeeklyDiffOpen(false)}
        />
      )}

      {/* First-run DB setup wizard — ensures Run Center + 3 modules share one DB */}
      <DbSetupWizard
        open={dbWizardOpen}
        allowSkip={dbWizardAllowSkip}
        contentRef={dbWizardContentRef}
        onClose={() => setDbWizardOpen(false)}
        onComplete={() => {
          setDbWizardOpen(false);
          setHasConfirmedDb(true);
          setFetchError(null); // Auto-dismiss error banner when DB is restored
          // Re-fetch all data so the UI reflects the newly-active DB.
          (async () => {
            await fetchSnapshots();
            await fetchEntries();
            fetchedModesRef.current.delete('evaluation');
            fetchedModesRef.current.delete('literature');
            toast.success(t.dbReadyToast);
          })();
        }}
      />

      {/* Onboarding Tour Overlay — 9-step Chinese tour, spotlights the mode
          switcher (step 1) and search input (step 7); all other steps render
          as centered tooltips. Auto-starts on first visit; the 「帮助」 button
          in the top bar re-triggers it. */}
      <TourOverlay
        tourActive={tourActive}
        tourStep={tourStep}
        setTourStep={setTourStep}
        nextStep={tourNextStep}
        prevStep={tourPrevStep}
        finishTour={finishTour}
        steps={tourSteps}
      />
    </div>
    </TooltipProvider>
  );
}
