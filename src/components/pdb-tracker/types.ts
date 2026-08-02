// Shared types for PDB Tracker views
// Extracted from pdb-tracker.tsx to enable smaller client bundles

import type { PdbEntry, WeeklySnapshot, WeeklyReport, Evaluation, LitPaper, LitStats, EvalBatch, EvalBatchSubTarget, Mode } from '@/lib/pdb-types';

// ─── Weekly View ─────────────────────────────────────────────────────────────

export interface WeeklyViewProps {
  // Data
  entries: PdbEntry[];
  snapshots: WeeklySnapshot[];
  currentSnapshot: WeeklySnapshot | null;
  loading: boolean;
  // UI state
  sortField: string;
  sortDir: 'asc' | 'desc';
  currentPage: number;
  pageSize: number;
  filteredEntries: PdbEntry[];
  paginatedEntries: PdbEntry[];
  totalPages: number;
  bookmarks: Set<string>;
  selectedEntryIds: Set<string>;
  highlightedRowId: string | null;
  showHeatmap: boolean;
  showTrend: boolean;
  showTimeline: boolean;
  showQualityDist: boolean;
  showWeekCompare: boolean;
  weeklyDateFilter: string | null;
  selectedSnapshot: string | null;
  // Callbacks
  onSort: (field: string) => void;
  onRowClick: (entry: PdbEntry) => void;
  onToggleBookmark: (pdbId: string) => void;
  onSelectEntries: (ids: Set<string>) => void;
  onHighlightRow: (id: string | null) => void;
  onSetShowHeatmap: (v: boolean) => void;
  onSetShowTrend: (v: boolean) => void;
  onSetShowTimeline: (v: boolean) => void;
  onSetShowQualityDist: (v: boolean) => void;
  onSetShowWeekCompare: (v: boolean) => void;
  onSetWeeklyDateFilter: (d: string | null) => void;
  onSetCurrentPage: (p: number | ((prev: number) => number)) => void;
  onSetPageSize: (s: number) => void;
}

// ─── Evaluation View ───────────────────────────────────────────────────────

export interface EvaluationViewProps {
  evaluations: Evaluation[];
  allEvaluations: Evaluation[];
  evalBatches: EvalBatch[];
  batchSubTargets: Record<string, EvalBatchSubTarget[]>;
  selectedEvalId: string | null;
  selectedEval: Evaluation | null;
  evalLoading: boolean;
  evalSubView: 'default' | 'compare' | 'dashboard' | 'timeline' | 'batch';
  evalDetailTab: string;
  selectedEvalStructure: any; // EvalRow
  evalReportContent: string;
  detailPanelOpen: boolean;
  onSelectEvalId: (id: string | null) => void;
  onSetEvalSubView: (v: 'default' | 'compare' | 'dashboard' | 'timeline' | 'batch') => void;
  onSetEvalDetailTab: (tab: string) => void;
  onSetSelectedEvalStructure: (s: any) => void;
  // Open the parent detail panel (used by the PDB picker when a blast row is selected).
  onSetDetailPanelOpen?: (open: boolean) => void;
  // Batch detail integration
  selectedBatchId?: string | null;
  batchFetchedEvals?: Record<string, Evaluation>;
  onSelectSubTarget?: (uniprotId: string) => void;
  onOpenBatchReport?: (batchId: string, title: string) => void;
}

// ─── Literature View ─────────────────────────────────────────────────────────

export interface LiteratureViewProps {
  stats: LitStats | null;
  papers: LitPaper[];
  reports: any[]; // LitReport[]
  isLoading: boolean;
  showCharts: boolean;
  selectedDate: string | null;
  externalSearch: string;
  readingListFilter: string | null;
  paperNotesHook: any; // ReturnType<typeof usePaperNotes>
  openNotePmid: string | null;
  paperTagsHook: any; // ReturnType<typeof usePaperTags>
  tagFilter: string | null;
  sourceFilter: 'all' | 'daily';
  onSourceFilterChange: () => void;
  ifFilter: 'all' | '5' | '10' | '20';
  onIfFilterChange: (f: 'all' | '5' | '10' | '20') => void;
  readingProgressHook: any; // ReturnType<typeof useReadingProgress>
  readingListHook: any; // ReturnType<typeof useReadingLists>
  totalPapersCount: number;
  onToggleCharts: () => void;
  onClearDateFilter: () => void;
  onSelectPaper: (paper: LitPaper) => void;
  hasActiveFilters: boolean;
  onClearAllFilters: () => void;
  onClearReadingListFilter: () => void;
  onOpenNote: (pmid: string | null) => void;
  onTagFilterChange: (tag: string | null) => void;
}

// ─── Sidebar Props ──────────────────────────────────────────────────────────────

export interface WeeklySidebarProps {
  snapshots: WeeklySnapshot[];
  selectedSnapshot: string | null;
  sidebarCollapsed: boolean;
  onSelectSnapshot: (id: string) => void;
  onToggleCollapse: () => void;
  getReportCountForWeek: (weekId: string | null) => number;
  currentSnapshot: WeeklySnapshot | null;
  prevSnapshot: WeeklySnapshot | null;
}

export interface EvalSidebarProps {
  evaluations: Evaluation[];
  evalBatches: EvalBatch[];
  selectedEvalId: string | null;
  sidebarCollapsed: boolean;
  onSelectEval: (id: string) => void;
  onToggleCollapse: () => void;
  evalLoading: boolean;
}

export interface LiteratureSidebarProps {
  stats: LitStats | null;
  litReports: any[];
  selectedDate: string | null;
  sidebarCollapsed: boolean;
  onSelectDate: (date: string) => void;
  onToggleCollapse: () => void;
}

// ─── Shared Callbacks ─────────────────────────────────────────────────────────

export interface PdbTrackerCallbacks {
  // Weekly
  toggleBookmark: (pdbId: string) => void;
  handleBookmarkAll: () => void;
  handleExportSelected: (format: 'csv' | 'json') => void;
  // Evaluation
  fetchEvalDetail: (uniprotId: string) => void;
  // Literature
  handleLitSelectPaper: (paper: LitPaper) => void;
  handleLitClearDateFilter: () => void;
  handleLitClearAllFilters: () => void;
  fetchLitPapers: (q?: string) => void;
}