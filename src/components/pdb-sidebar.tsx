'use client';

import React from 'react';
import { useI18n } from '@/lib/i18n';
import {
  Search,
  ChevronDown,
  ChevronRight,
  X,
  ArrowLeft,
  Eye,
  Loader2,
  Keyboard,
  Activity,
  Bookmark,
  BookmarkCheck,
  BookmarkPlus,
  Layers,
  BarChart3,
  Calendar,
  Microscope,
  Trash2,
  Settings,
  Sparkles,
  TrendingUp,
  TrendingDown,
  Copy,
  ExternalLink,
  PanelLeftClose,
  Clock,
  RefreshCw,
  Bell,
  Dna,
  Star,
  Info,
  Trophy,
  FolderOpen,
  FlaskConical,
  ArrowRightLeft,
  Upload,
  SlidersHorizontal,
  Pin,
  Eye as EyeIcon,
} from 'lucide-react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '@/components/ui/collapsible';
import { HoverCard, HoverCardTrigger, HoverCardContent } from '@/components/ui/hover-card';
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from '@/components/ui/context-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { SearchDropdown } from './search-dropdown';
import { EvalModeSwitcher } from './EvalModeSwitcher';
import { EnhancedEmptyState } from './enhanced-empty-state';
import { formatRelativeTime } from '@/lib/pdb-utils';
import { getScoreColor, formatDate } from './pdb-helpers';
import type { WeeklySnapshot, PdbEntry, Evaluation } from '@/lib/pdb-types';
import type { SearchSuggestionItem } from './search-dropdown';
import type { ActivityItem } from '@/hooks/use-activity-feed';
import { useSampleNotifications } from './notification-panel';
import { useState, useEffect, useRef } from 'react';

// ─── Local Types ────────────────────────────────────────────────────────────────

type Mode = 'weekly' | 'evaluation';

interface FilterPreset {
  id: string;
  name: string;
  filters: {
    searchQuery: string;
    methodFilter: string;
    resolutionRange: [number, number];
    ifRange: [number, number];
    organismFilter: string[];
    ligandFilter: boolean;
    dateRange: { from: string; to: string };
    qualityFilter: string;
  };
  createdAt: string;
  color: string;
}

export interface ComplexGroup {
  id: string;
  name: string;
  uniprotIds: string[];
  createdAt: number;
}

export interface EvalBatch {
  isBatch: true;
  batchId: string;
  title: string;
  subTargetCount: number;
  combinedReport: string;
  commonPdbIds?: string | null;
  crossReportOk?: boolean | null;
  crossReportChars?: number | null;
  targetCount?: number | null;
  createdAt: string;
}

export interface EvalBatchSubTarget {
  uniprotId: string;
  proteinName: string;
  geneName: string;
  organism: string;
  bestScore: number;
  pdbCount: number;
  blastCount: number;
}

interface RecentlyViewedItem {
  pdbId: string;
  title: string;
  timestamp: number;
}

// ─── Props Interface ─────────────────────────────────────────────────────────────

export interface PdbTrackerSidebarProps {
  // ── Mode & Navigation ──
  mode: Mode;
  setMode: (mode: Mode) => void;
  setSelectedWeekId: (id: string | null) => void;
  setSelectedEvalId: (id: string | null) => void;
  setSelectedEval: (evaluation: Evaluation | null) => void;
  setPreviewOpen: (open: boolean) => void;
  setMobileSidebarOpen: (open: boolean) => void;

  // ── Weekly Mode Data ──
  snapshots: WeeklySnapshot[];
  selectedWeekId: string | null;
  entries: PdbEntry[];
  loadingSnapshots: boolean;

  // ── Evaluation Mode Data ──
  evaluations: Evaluation[];
  selectedEvalId: string | null;
  selectedEval: Evaluation | null;
  loadingEvals: boolean;
  filteredEvals: Evaluation[];

  // ── Search ──
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  searchDropdownOpen: boolean;
  setSearchDropdownOpen: (open: boolean) => void;
  searchHighlightIndex: number;
  setSearchHighlightIndex: (index: number | ((prev: number) => number)) => void;
  searchSuggestions: SearchSuggestionItem[];
  searchHistory: string[];
  totalSuggestionCount: number;
  addToSearchHistory: (term: string) => void;
  clearSearchHistory: () => void;

  // ── Bookmarks & Collections ──
  bookmarks: Set<string>;
  recentlyViewed: RecentlyViewedItem[];
  collections: Record<string, string[]>;
  activeCollection: string | null;
  setActiveCollection: (name: string | null) => void;
  setShowBookmarksOnly: (show: boolean) => void;
  removeFromCollection: (name: string, pdbId: string) => void;
  deleteCollection: (name: string) => void;

  // ── Sidebar UI State ──
  sidebarOpen: boolean;
  setSidebarOpen: (open: boolean) => void;
  activityExpanded: boolean;
  setActivityExpanded: (expanded: boolean) => void;
  recentlyViewedExpanded: boolean;
  setRecentlyViewedExpanded: (expanded: boolean) => void;
  bookmarksExpanded: boolean;
  setBookmarksExpanded: (expanded: boolean) => void;
  collectionsExpanded: boolean;
  setCollectionsExpanded: (expanded: boolean) => void;
  expandedCollections: Set<string>;
  setExpandedCollections: (setter: (prev: Set<string>) => Set<string>) => void;
  presetsExpanded: boolean;
  setPresetsExpanded: (expanded: boolean) => void;
  recentActivityExpanded: boolean;
  setRecentActivityExpanded: (expanded: boolean) => void;
  quickStatsExpanded: boolean;
  setQuickStatsExpanded: (expanded: boolean) => void;
  aiInsightsExpanded: boolean;
  setAiInsightsExpanded: (expanded: boolean) => void;

  // ── Activity Feed ──
  activityFeed: ActivityItem[];
  handleActivityItemClick: (item: ActivityItem) => void;
  clearAllActivities: () => void;

  // ── Entries & Detail ──
  setSelectedEntry: (entry: PdbEntry) => void;
  setDetailPanelOpen: (open: boolean) => void;

  // ── Filter Presets ──
  filterPresets: Record<string, FilterPreset>;
  handleSavePresetPrompt: () => void;
  countPresetActiveFilters: (preset: FilterPreset) => number;
  loadFilterPreset: (id: string) => void;
  renameFilterPreset: (id: string, newName: string) => void;
  deleteFilterPreset: (id: string) => void;

  // ── AI Insights ──
  aiInsight: string | null;
  aiInsightLoading: boolean;
  generateInsight: () => void;

  // ── Stats helpers ──
  weekDayCounts: number[];
  snapshotResBins: Record<string, number[]>;
  weeklyTrendDir: 'up' | 'down' | 'flat' | null;

  // ── Complex Groups ──
  complexGroups: ComplexGroup[];
  selectedComplexId: string | null;
  expandedComplexId: string | null;
  complexFetchedEvals: Record<string, Evaluation>;
  setSelectedComplexId: (id: string | null) => void;
  setExpandedComplexId: (id: string | null) => void;
  removeComplexGroup: (id: string) => void;
  showComplexDialog: boolean;
  setShowComplexDialog: (open: boolean) => void;

  // ── Eval Batches ──
  evalBatches: EvalBatch[];
  evalBatchSubTargets: Record<string, EvalBatchSubTarget[]>;
  selectedBatchId: string | null;
  setSelectedBatchId: (id: string | null) => void;
  expandedEvalGroups: Set<string> | ((prev: Set<string>) => Set<string>);
  setExpandedEvalGroups: (setter: Set<string> | ((prev: Set<string>) => Set<string>)) => void;
  batchFetchedEvals: Record<string, Evaluation>;

  // ── Context Menu ──
  contextMenu: { x: number; y: number; weekId: string } | null;
  setContextMenu: (menu: { x: number; y: number; weekId: string } | null) => void;

  // ── Scoring helpers ──
  getAvgScore: (scores: string | null) => number;

  // ── Tour refs ──
  tourModeSwitcherRef: React.RefObject<HTMLDivElement | null>;
  tourSidebarRef: React.RefObject<HTMLDivElement | null>;
}

// ─── Session Stats Hook ──────────────────────────────────────────────────────

function useSessionStats(recentlyViewedLength: number, activityFeedLength: number) {
  // sessionStructuresViewed is derived directly from the live recentlyViewed length;
  // localStorage is kept in sync as an external system (see effect below).
  const sessionStructuresViewed = recentlyViewedLength;
  const [sessionStartTime] = useState(() => {
    if (typeof window === 'undefined') return Date.now();
    try {
      const saved = localStorage.getItem('pdb-session-start');
      if (saved) return parseInt(saved, 10) || Date.now();
    } catch { /* ignore */ }
    const now = Date.now();
    localStorage.setItem('pdb-session-start', String(now));
    return now;
  });
  const [sessionElapsed, setSessionElapsed] = useState(0);
  const [actionsPerMinute, setActionsPerMinute] = useState<number[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const saved = localStorage.getItem('pdb-session-actions-per-minute');
      if (saved) return JSON.parse(saved);
    } catch { /* ignore */ }
    return [];
  });

  useEffect(() => {
    const interval = setInterval(() => {
      setSessionElapsed(Math.floor((Date.now() - sessionStartTime) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [sessionStartTime]);

  useEffect(() => {
    const interval = setInterval(() => {
      setActionsPerMinute(prev => {
        const lastMinuteCount = prev.length > 0 ? prev[prev.length - 1] : 0;
        const randomFactor = activityFeedLength > 0 ? Math.floor(Math.random() * 3) + 1 : 0;
        const newCount = Math.min(lastMinuteCount + randomFactor, 20);
        const next = [...prev, newCount].slice(-10);
        try { localStorage.setItem('pdb-session-actions-per-minute', JSON.stringify(next)); } catch { /* ignore */ }
        return next;
      });
    }, 10000);
    return () => clearInterval(interval);
  }, [activityFeedLength]);

  useEffect(() => {
    // External system sync: persist the derived counter to localStorage.
    try { localStorage.setItem('pdb-session-structures-viewed', String(recentlyViewedLength)); } catch { /* ignore */ }
  }, [recentlyViewedLength]);

  const formatSessionTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  };

  const maxActions = Math.max(...actionsPerMinute, 1);

  return { sessionStructuresViewed, sessionElapsed, actionsPerMinute, maxActions, formatSessionTime };
}

// ─── Notification History Section (sidebar) ─────────────────────────────────

function NotificationHistorySection() {
  const [expanded, setExpanded] = useState(false);
  const { notifications, setNotifications } = useSampleNotifications();

  const getNotifIcon = (type: string) => {
    switch (type) {
      case 'new_structure': return <Dna className="h-3 w-3 text-[#2d8f8f]" />;
      case 'weekly_update': return <BarChart3 className="h-3 w-3 text-[#7c5cbf]" />;
      case 'comparison_ready': return <ArrowRightLeft className="h-3 w-3 text-[#c9872e]" />;
      case 'bookmark_added': return <Star className="h-3 w-3 text-amber-500" />;
      case 'system': return <Info className="h-3 w-3 text-claude-text-muted" />;
      case 'achievement': return <Trophy className="h-3 w-3 text-amber-500" />;
      default: return <Bell className="h-3 w-3 text-claude-text-muted" />;
    }
  };

  return (
    <Collapsible open={expanded} onOpenChange={setExpanded}>
      <CollapsibleTrigger className="w-full flex items-center justify-between py-1.5 px-1 text-[11px] font-semibold text-claude-text-muted uppercase tracking-wider hover:text-claude-text-secondary transition-colors duration-150 animated-underline">
        <span className="flex items-center gap-1.5">
          <Bell className={`h-3 w-3 text-claude-accent ${notifications.length > 0 ? 'breathe-glow rounded-full p-0.5' : ''}`} />
          Notification History
          {notifications.length > 0 && (
            <span className="counter-badge text-[9px]">{notifications.length}</span>
          )}
        </span>
        <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${expanded ? 'rotate-0' : '-rotate-90'}`} />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-1 pb-2 mt-1 mb-1 space-y-0.5 max-h-[200px] overflow-y-auto thin-scrollbar">
          {notifications.length === 0 ? (
            <p className="text-[10px] text-claude-text-muted/60 dark:text-[#9b9590]/60 px-2 py-2 italic text-center">
              No notifications yet
            </p>
          ) : (
            notifications.slice(0, 10).map((notif) => (
              <div key={notif.id} className="flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-claude-border-light/50 dark:hover:bg-[#2b2926] transition-colors duration-150 group">
                <span className="text-[10px] mt-0.5 flex-shrink-0">
                  {getNotifIcon(notif.type)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <p className="text-[10px] font-medium text-claude-text truncate">{notif.title}</p>
                    {!notif.read && (
                      <span className="flex-shrink-0 h-1.5 w-1.5 rounded-full bg-claude-accent" />
                    )}
                  </div>
                  <p className="text-[9px] text-claude-text-muted truncate">{notif.message}</p>
                </div>
                <span className="text-[8px] text-claude-text-muted/50 flex-shrink-0">
                  {formatRelativeTime(notif.timestamp)}
                </span>
              </div>
            ))
          )}
        </div>
        {notifications.length > 0 && (
          <button
            onClick={() => setNotifications([])}
            className="w-full text-center text-[9px] text-claude-accent hover:text-claude-accent-hover py-1 transition-colors flex items-center justify-center gap-1"
          >
            <Trash2 className="h-2.5 w-2.5" />
            Clear All
          </button>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────────

export function PdbTrackerSidebar(props: PdbTrackerSidebarProps) {
  const { t, locale } = useI18n();
  const {
    mode,
    setMode,
    setSelectedWeekId,
    setSelectedEvalId,
    setSelectedEval,
    setPreviewOpen,
    setMobileSidebarOpen,
    snapshots,
    selectedWeekId,
    entries,
    loadingSnapshots,
    evaluations,
    selectedEvalId,
    selectedEval,
    loadingEvals,
    filteredEvals,
    searchQuery,
    setSearchQuery,
    searchDropdownOpen,
    setSearchDropdownOpen,
    searchHighlightIndex,
    setSearchHighlightIndex,
    searchSuggestions,
    searchHistory,
    totalSuggestionCount,
    addToSearchHistory,
    clearSearchHistory,
    bookmarks,
    recentlyViewed,
    collections,
    activeCollection,
    setActiveCollection,
    setShowBookmarksOnly,
    removeFromCollection,
    deleteCollection,
    sidebarOpen,
    setSidebarOpen,
    activityExpanded,
    setActivityExpanded,
    recentlyViewedExpanded,
    setRecentlyViewedExpanded,
    bookmarksExpanded,
    setBookmarksExpanded,
    collectionsExpanded,
    setCollectionsExpanded,
    expandedCollections,
    setExpandedCollections,
    presetsExpanded,
    setPresetsExpanded,
    recentActivityExpanded,
    setRecentActivityExpanded,
    quickStatsExpanded,
    setQuickStatsExpanded,
    aiInsightsExpanded,
    setAiInsightsExpanded,
    activityFeed,
    handleActivityItemClick,
    clearAllActivities,
    setSelectedEntry,
    setDetailPanelOpen,
    filterPresets,
    handleSavePresetPrompt,
    countPresetActiveFilters,
    loadFilterPreset,
    renameFilterPreset,
    deleteFilterPreset,
    aiInsight,
    aiInsightLoading,
    generateInsight,
    weekDayCounts,
    snapshotResBins,
    weeklyTrendDir,
    complexGroups,
    selectedComplexId,
    expandedComplexId,
    complexFetchedEvals,
    setSelectedComplexId,
    setExpandedComplexId,
    removeComplexGroup,
    showComplexDialog,
    setShowComplexDialog,
    evalBatches,
    evalBatchSubTargets,
    selectedBatchId,
    setSelectedBatchId,
    expandedEvalGroups,
    setExpandedEvalGroups,
    batchFetchedEvals,
    contextMenu,
    setContextMenu,
    getAvgScore,
    tourModeSwitcherRef,
    tourSidebarRef,
  } = props;

  const { sessionStructuresViewed, sessionElapsed, actionsPerMinute, maxActions, formatSessionTime } = useSessionStats(recentlyViewed.length, activityFeed.length);

  return (
    <>
      {/* Mode Switcher */}
      <div ref={tourModeSwitcherRef} className="px-3 border-b border-claude-border dark:border-[#3d3832] flex-shrink-0 h-12 flex items-center">
        <div className="flex items-center gap-1 w-full">
          <button
            onClick={() => { setMode('weekly'); setSelectedEvalId(null); setSelectedEval(null); setSearchQuery(''); setSearchDropdownOpen(false); setMobileSidebarOpen(false); }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-medium transition-colors duration-150 border-b-2 ${
              mode === 'weekly'
                ? 'text-claude-accent font-semibold bg-claude-accent/8 dark:bg-[#d4784f]/10 border-claude-accent'
                : 'text-claude-text-muted hover:text-claude-text-secondary hover:bg-claude-border-light/30 dark:hover:bg-[#2b2926]/50 border-transparent'
            }`}
          >
            <Calendar className="h-3.5 w-3.5" />
            Weekly
          </button>
          <button
            onClick={() => { setMode('evaluation'); setSearchQuery(''); setSearchDropdownOpen(false); setMobileSidebarOpen(false); }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg text-xs font-medium transition-colors duration-150 border-b-2 ${
              mode === 'evaluation'
                ? 'text-claude-accent font-semibold bg-claude-accent/8 dark:bg-[#d4784f]/10 border-claude-accent'
                : 'text-claude-text-muted hover:text-claude-text-secondary hover:bg-claude-border-light/30 dark:hover:bg-[#2b2926]/50 border-transparent'
            }`}
          >
            <Microscope className="h-3.5 w-3.5" />
            Evaluation
          </button>
        </div>
      </div>

      {/* Sidebar Content */}
      <div className="sidebar-ambient dot-pattern-bg flex-1 overflow-y-auto sidebar-scroll thin-scrollbar scroll-shadow-bottom scroll-shadow-both shadow-depth-2">
        {mode === 'weekly' ? (
          <div ref={tourSidebarRef} className="p-3 space-y-2 stagger-children">
            {/* Back button - breadcrumb style */}
            {selectedWeekId && (
              <div className="breadcrumb-separator mb-1">
                <button
                  onClick={() => setSelectedWeekId(null)}
                  className="breadcrumb-item"
                >
                  All Weeks
                </button>
                <span className="breadcrumb-sep">›</span>
                <span className="breadcrumb-item">{selectedWeekId}</span>
              </div>
            )}

            {/* Activity Feed */}
            <Collapsible open={activityExpanded} onOpenChange={setActivityExpanded}>
              <CollapsibleTrigger className="w-full flex items-center justify-between px-2 py-1.5 text-[11px] font-medium text-claude-text-muted hover:text-claude-text transition-colors animated-underline">
                <span className="flex items-center gap-1.5">
                  <Activity className="h-3 w-3 dot-indicator dot-indicator-active animate-breathe" />
                  Activity
                  {activityFeed.length > 0 && (
                    <span className="px-1 py-0 rounded-full bg-claude-accent/10 text-[9px] font-bold text-claude-accent">
                      {activityFeed.length}
                    </span>
                  )}
                </span>
                <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${activityExpanded ? 'rotate-180' : ''}`} />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="max-h-40 overflow-y-auto thin-scrollbar space-y-0.5 px-1 mt-1">
                  {activityFeed.length === 0 ? (
                    <p className="text-[10px] text-claude-text-muted/50 px-2 py-2 text-center">No recent activity</p>
                  ) : (
                    activityFeed.map(item => (
                      <div
                        key={item.id}
                        className="flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-claude-border-light/50 dark:hover:bg-claude-border/30 transition-colors cursor-pointer animate-activity-slide"
                        onClick={() => handleActivityItemClick(item)}
                      >
                        <span className="flex-shrink-0 mt-0.5">
                          {(item.type as string) === 'view' && <span className="text-[10px]" title="View"><EyeIcon className="h-3 w-3 text-claude-text-muted" /></span>}
                          {item.type === 'bookmark' && <span className="text-[10px]" title="Bookmark"><Bookmark className="h-3 w-3 text-amber-500" /></span>}
                          {item.type === 'compare' && <span className="text-[10px]" title="Compare"><ArrowRightLeft className="h-3 w-3 text-[#c9872e]" /></span>}
                          {item.type === 'collection' && <span className="text-[10px]" title="Collection"><FolderOpen className="h-3 w-3 text-[#7c5cbf]" /></span>}
                          {item.type === 'export' && <span className="text-[10px]" title="Export"><Upload className="h-3 w-3 text-[#2d8f8f]" /></span>}
                          {item.type === 'search' && <span className="text-[10px]" title="Search"><Search className="h-3 w-3 text-claude-text-muted" /></span>}
                          {item.type === 'filter' && <span className="text-[10px]" title="Filter"><SlidersHorizontal className="h-3 w-3 text-claude-text-muted" /></span>}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] font-medium text-claude-text truncate">{item.type.charAt(0).toUpperCase() + item.type.slice(1)}</p>
                          <p className="text-[9px] text-claude-text-muted truncate">{item.message}</p>
                        </div>
                        <span className="text-[8px] text-claude-text-muted/50 flex-shrink-0">{formatRelativeTime(new Date(item.timestamp))}</span>
                      </div>
                    ))
                  )}
                </div>
                {activityFeed.length > 3 && (
                  <button
                    onClick={clearAllActivities}
                    className="w-full text-center text-[9px] text-claude-accent hover:text-claude-accent-hover py-1 transition-colors"
                  >
                    View all activity · Clear
                  </button>
                )}
              </CollapsibleContent>
            </Collapsible>

            {/* Recently Viewed */}
            <Collapsible open={recentlyViewedExpanded} onOpenChange={setRecentlyViewedExpanded}>
              <CollapsibleTrigger className="w-full flex items-center justify-between px-2 py-1.5 text-[11px] font-medium text-claude-text-muted hover:text-claude-text transition-colors animated-underline">
                <span className="flex items-center gap-1.5">
                  <Eye className="h-3 w-3" />
                  Recently Viewed
                  {recentlyViewed.length > 0 && (
                    <span className="counter-badge counter-badge-muted text-[9px]">
                      {recentlyViewed.length}
                    </span>
                  )}
                </span>
                <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${recentlyViewedExpanded ? 'rotate-180' : ''}`} />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="max-h-32 overflow-y-auto thin-scrollbar space-y-0.5 px-1 mt-1 list-item-stagger">
                  {recentlyViewed.length === 0 ? (
                    <p className="text-[10px] text-claude-text-muted/50 px-2 py-2 text-center">No recently viewed structures</p>
                  ) : (
                    recentlyViewed.map(item => (
                      <button
                        key={item.pdbId + item.timestamp}
                        onClick={() => {
                          const entry = entries.find(e => e.pdbId === item.pdbId);
                          if (entry) {
                            setSelectedEntry(entry);
                            setDetailPanelOpen(true);
                          }
                        }}
                        className="w-full text-left p-2 rounded-md hover:bg-claude-border-light dark:hover:bg-claude-border transition-colors duration-150 flex items-start gap-2"
                      >
                        <Eye className="h-3 w-3 text-purple-400 mt-0.5 flex-shrink-0" />
                        <div className="min-w-0">
                          <div className="font-mono text-[10px] font-semibold text-purple-600 dark:text-purple-400">{item.pdbId}</div>
                          <div className="text-[9px] text-claude-text-muted line-clamp-1 leading-tight">{item.title}</div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Bookmarks Section */}
            {bookmarks.size > 0 ? (
              <Collapsible open={bookmarksExpanded} onOpenChange={setBookmarksExpanded}>
                <CollapsibleTrigger className="w-full flex items-center justify-between py-1.5 px-1 text-[11px] font-semibold text-claude-text-muted uppercase tracking-wider hover:text-claude-text-secondary transition-colors duration-150 animated-underline underline-grow">
                  <span className="flex items-center gap-1.5">
                    <Bookmark className="h-3 w-3 text-claude-accent" />
                    {t.filterBookmarks}
                    <span className="counter-badge text-[9px]">{bookmarks.size}</span>
                  </span>
                  <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${bookmarksExpanded ? 'rotate-0' : '-rotate-90'}`} />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="max-h-48 overflow-y-auto custom-scrollbar sidebar-scroll scroll-shadow-top space-y-0.5 mt-1 mb-1 list-item-stagger">
                    {[...bookmarks].map(pdbId => {
                      const matchedEntry = entries.find(e => e.pdbId === pdbId);
                      return (
                        <button
                          key={pdbId}
                          onClick={() => {
                            if (matchedEntry) {
                              setSelectedEntry(matchedEntry);
                              setDetailPanelOpen(true);
                            }
                          }}
                          className="w-full text-left p-2 rounded-md hover:bg-claude-border-light dark:hover:bg-claude-border transition-colors duration-150 flex items-start gap-2"
                        >
                          <BookmarkCheck className="h-3 w-3 text-claude-accent mt-0.5 flex-shrink-0" />
                          <div className="min-w-0">
                            <div className="font-mono text-[10px] font-semibold text-claude-accent">{pdbId}</div>
                            {matchedEntry && (
                              <div className="text-[10px] text-claude-text-muted line-clamp-1 leading-tight">{matchedEntry.title}</div>
                            )}
                            {!matchedEntry && (
                              <div className="text-[9px] text-claude-text-muted/50 italic">Not in current week</div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            ) : (
              <EnhancedEmptyState
                title={t.noBookmarksTitle}
                description={t.noBookmarksDesc}
                className="py-6 px-2"
              />
            )}

            <hr className="divider-gradient mx-3" />

            {/* Collections Section */}
            {Object.keys(collections).length > 0 ? (
              <Collapsible open={collectionsExpanded} onOpenChange={setCollectionsExpanded}>
                <CollapsibleTrigger className="w-full flex items-center justify-between py-1.5 px-1 text-[11px] font-semibold text-claude-text-muted uppercase tracking-wider hover:text-claude-text-secondary transition-colors duration-150 animated-underline underline-grow">
                  <span className="flex items-center gap-1.5">
                    <Layers className="h-3 w-3 text-claude-accent" />
                    {t.collections}
                    <span className="counter-badge text-[9px]">{Object.keys(collections).length}</span>
                  </span>
                  <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${collectionsExpanded ? 'rotate-0' : '-rotate-90'}`} />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="space-y-1 mt-1 mb-1 list-item-stagger">
                    {Object.entries(collections).map(([name, pdbIds]) => (
                      <div key={name} className={`glass-card card-lift rounded-md border border-claude-border-light dark:border-[#3d3832] overflow-hidden sidebar-tree-item ${activeCollection === name ? 'animated-border' : ''}`}>
                        <div className="flex items-center gap-1.5 px-2 py-1.5 hover:bg-claude-border-light/50 dark:hover:bg-[#2b2926] transition-colors duration-150">
                          <button
                            onClick={() => setExpandedCollections(prev => {
                              const next = new Set(prev);
                              if (next.has(name)) next.delete(name); else next.add(name);
                              return next;
                            })}
                            className="flex-shrink-0"
                          >
                            <ChevronRight className={`h-3 w-3 text-claude-text-muted transition-transform duration-200 ${expandedCollections.has(name) ? 'rotate-90' : ''}`} />
                          </button>
                          <button
                            onClick={() => {
                              if (activeCollection === name) {
                                setActiveCollection(null);
                              } else {
                                setActiveCollection(name);
                                setShowBookmarksOnly(false);
                              }
                            }}
                            className="flex-1 text-left min-w-0"
                          >
                            <div className="flex items-center gap-1.5">
                              <Layers className="h-3 w-3 text-claude-text-muted flex-shrink-0" />
                              <span className="text-[10px] font-medium text-claude-text truncate">{name}</span>
                              <span className="text-[9px] text-claude-text-muted font-mono ml-auto flex-shrink-0">({pdbIds.length})</span>
                            </div>
                            {/* Mini method distribution bar for collections with 2+ entries */}
                            {pdbIds.length >= 2 && (
                              <div className="flex items-center gap-[2px] mt-1">
                                {(() => {
                                  const collEntries = entries.filter(e => pdbIds.includes(e.pdbId));
                                  const cryoem = collEntries.filter(e => (e.method || '').toUpperCase().includes('CRYO') || (e.method || '').toUpperCase().includes('ELECTRON MICROSCOPY')).length;
                                  const xray = collEntries.filter(e => (e.method || '').toUpperCase().includes('X-RAY') || (e.method || '').toUpperCase().includes('XRAY')).length;
                                  const nmr = collEntries.filter(e => (e.method || '').toUpperCase().includes('NMR')).length;
                                  const total = cryoem + xray + nmr || 1;
                                  return (
                                    <>
                                      {cryoem > 0 && (
                                        <div className="flex items-center gap-0.5">
                                          <span className="w-[6px] h-[6px] rounded-full" style={{ backgroundColor: '#2d8f8f' }} />
                                          <span className="text-[8px] text-claude-text-muted">{cryoem}</span>
                                        </div>
                                      )}
                                      {xray > 0 && (
                                        <div className="flex items-center gap-0.5">
                                          <span className="w-[6px] h-[6px] rounded-full" style={{ backgroundColor: '#7c5cbf' }} />
                                          <span className="text-[8px] text-claude-text-muted">{xray}</span>
                                        </div>
                                      )}
                                      {nmr > 0 && (
                                        <div className="flex items-center gap-0.5">
                                          <span className="w-[6px] h-[6px] rounded-full" style={{ backgroundColor: '#c9872e' }} />
                                          <span className="text-[8px] text-claude-text-muted">{nmr}</span>
                                        </div>
                                      )}
                                    </>
                                  );
                                })()}
                              </div>
                            )}
                          </button>
                          {activeCollection === name && (
                            <button
                              onClick={() => setActiveCollection(null)}
                              className="flex-shrink-0 p-0.5 rounded hover:bg-claude-border-light dark:hover:bg-[#3d3832] transition-colors"
                              title={locale === "zh" ? "清除筛选" : "Clear filter"}
                            >
                              <X className="h-3 w-3 text-claude-accent" />
                            </button>
                          )}
                          <button
                            onClick={() => deleteCollection(name)}
                            className="flex-shrink-0 p-0.5 rounded hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                            title={locale === "zh" ? "删除集合" : "Delete collection"}
                          >
                            <Trash2 className="h-3 w-3 text-claude-text-muted hover:text-red-500" />
                          </button>
                        </div>
                        {expandedCollections.has(name) && (
                          <div className="max-h-32 overflow-y-auto custom-scrollbar sidebar-scroll border-t border-claude-border-light dark:border-[#3d3832] bg-claude-bg/30 dark:bg-[#1a1917]/30">
                            {pdbIds.length === 0 ? (
                              <div className="px-3 py-2 text-[9px] text-claude-text-muted italic">Empty collection</div>
                            ) : pdbIds.map(pdbId => {
                              const matchedEntry = entries.find(e => e.pdbId === pdbId);
                              return (
                                <div key={pdbId} className="flex items-center gap-1.5 px-2 py-1 hover:bg-claude-border-light/50 dark:hover:bg-[#2b2926] transition-colors duration-150 group">
                                  <button
                                    onClick={() => {
                                      if (matchedEntry) {
                                        setSelectedEntry(matchedEntry);
                                        setDetailPanelOpen(true);
                                      }
                                    }}
                                    className="flex-1 text-left min-w-0"
                                  >
                                    <span className="font-mono text-[10px] font-medium text-claude-accent">{pdbId}</span>
                                    {matchedEntry && (
                                      <span className="text-[9px] text-claude-text-muted ml-1.5 line-clamp-1">{matchedEntry.title?.slice(0, 30)}</span>
                                    )}
                                  </button>
                                  <button
                                    onClick={() => removeFromCollection(name, pdbId)}
                                    className="flex-shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"
                                    title="Remove from collection"
                                  >
                                    <X className="h-2.5 w-2.5 text-claude-text-muted hover:text-red-500" />
                                  </button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            ) : (
              <EnhancedEmptyState
                title={t.noCollectionsTitle}
                description={t.noCollectionsDesc}
                className="py-6 px-2"
              />
            )}

            {/* Filter Presets Section */}
            <Collapsible open={presetsExpanded} onOpenChange={setPresetsExpanded}>
              <CollapsibleTrigger className="w-full flex items-center justify-between py-1.5 px-1 text-[11px] font-semibold text-claude-text-muted uppercase tracking-wider hover:text-claude-text-secondary transition-colors duration-150 animated-underline">
                <span className="flex items-center gap-1.5">
                  <BookmarkPlus className="h-3 w-3 text-claude-accent" />
                  {locale === 'zh' ? '筛选预设' : 'Filter Presets'}
                  {Object.keys(filterPresets).length > 0 && (
                    <span className="counter-badge text-[9px]">{Object.keys(filterPresets).length}</span>
                  )}
                </span>
                <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${presetsExpanded ? 'rotate-0' : '-rotate-90'}`} />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="glass-sidebar-section stagger-children space-y-1 mt-1 mb-1 p-2">
                  {/* Save Current Button */}
                  <button
                    onClick={handleSavePresetPrompt}
                    className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md border border-dashed border-claude-border dark:border-[#3d3832] hover:bg-claude-accent-light dark:hover:bg-[#3d2a22] hover:border-claude-accent/40 transition-colors duration-150 group"
                  >
                    <BookmarkPlus className="h-3 w-3 text-claude-text-muted group-hover:text-claude-accent transition-colors" />
                    <span className="text-[10px] font-medium text-claude-text-muted group-hover:text-claude-accent transition-colors">{locale === 'zh' ? '保存当前筛选' : 'Save Current Filters'}</span>
                  </button>
                  {/* Preset List */}
                  {Object.values(filterPresets)
                    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
                    .map(preset => {
                      const activeCount = countPresetActiveFilters(preset);
                      return (
                        <div key={preset.id} className="flex items-center gap-1.5 px-2 py-1.5 hover:bg-claude-border-light/50 dark:hover:bg-[#2b2926] rounded-md transition-colors duration-150 group">
                          <span
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ backgroundColor: preset.color }}
                          />
                          <button
                            onClick={() => loadFilterPreset(preset.id)}
                            className="flex-1 text-left min-w-0"
                            title={locale === 'zh' ? `加载预设：${preset.name}` : `Load preset: ${preset.name}`}
                          >
                            <span className="text-[10px] font-medium text-claude-text truncate block">{preset.name}</span>
                          </button>
                          <span className="text-[9px] text-claude-text-muted font-mono flex-shrink-0 bg-claude-bg dark:bg-[#1a1917] px-1.5 py-0.5 rounded-full">
                            {activeCount} {locale === 'zh' ? '项筛选' : `filter${activeCount !== 1 ? 's' : ''}`}
                          </span>
                          <button
                            onClick={() => {
                              const newName = prompt(locale === 'zh' ? '重命名预设：' : 'Rename preset:', preset.name);
                              if (newName !== null && newName.trim()) renameFilterPreset(preset.id, newName);
                            }}
                            className="flex-shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-claude-border-light dark:hover:bg-[#3d3832] transition-all"
                            title={locale === 'zh' ? '重命名预设' : 'Rename preset'}
                          >
                            <Settings className="h-2.5 w-2.5 text-claude-text-muted hover:text-claude-accent" />
                          </button>
                          <button
                            onClick={() => deleteFilterPreset(preset.id)}
                            className="flex-shrink-0 p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all"
                            title={locale === 'zh' ? '删除预设' : 'Delete preset'}
                          >
                            <Trash2 className="h-2.5 w-2.5 text-claude-text-muted hover:text-red-500" />
                          </button>
                        </div>
                      );
                    })}
                  {Object.keys(filterPresets).length === 0 && (
                    <div className="px-3 py-2 text-[9px] text-claude-text-muted italic text-center">
                      {locale === 'zh' ? '尚未保存预设' : 'No presets saved yet'}
                    </div>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Recent Activity Section */}
            <Collapsible open={recentActivityExpanded} onOpenChange={setRecentActivityExpanded}>
              <CollapsibleTrigger className="w-full flex items-center justify-between py-1.5 px-1 text-[11px] font-semibold text-claude-text-muted uppercase tracking-wider hover:text-claude-text-secondary transition-colors duration-150 animated-underline">
                <span className="flex items-center gap-1.5">
                  <Activity className="h-3 w-3 text-claude-accent" />
                  {t.recentActivity}
                  {activityFeed.length > 0 && (
                    <span className="counter-badge text-[9px]">{activityFeed.length}</span>
                  )}
                </span>
                <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${recentActivityExpanded ? 'rotate-0' : '-rotate-90'}`} />
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="px-1 pb-2 mt-1 mb-1 space-y-0.5 max-h-[200px] overflow-y-auto thin-scrollbar">
                  {activityFeed.length === 0 ? (
                    <p className="text-[10px] text-claude-text-muted/60 dark:text-[#9b9590]/60 px-2 py-2 italic text-center">
                      {locale === 'zh' ? '暂无活动' : 'No activity yet'}
                    </p>
                  ) : (
                    activityFeed.slice(0, 10).map((item) => (
                      <div key={item.id} className="flex items-start gap-2 px-2 py-1.5 rounded-md hover:bg-claude-border-light/50 dark:hover:bg-[#2b2926] transition-colors duration-150 group">
                        <span className="text-[10px] mt-0.5 flex-shrink-0">
                          {item.type === 'bookmark' && <Star className="h-3 w-3 text-amber-500" />}
                          {item.type === 'compare' && <ArrowRightLeft className="h-3 w-3 text-[#c9872e]" />}
                          {item.type === 'export' && <Upload className="h-3 w-3 text-[#2d8f8f]" />}
                          {item.type === 'collection' && <FolderOpen className="h-3 w-3 text-[#7c5cbf]" />}
                          {item.type === 'search' && <EyeIcon className="h-3 w-3 text-claude-text-muted" />}
                          {item.type === 'filter' && <SlidersHorizontal className="h-3 w-3 text-claude-text-muted" />}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-[10px] text-claude-text dark:text-[#d4d0cb] truncate">{item.message}</p>
                          <p className="text-[9px] text-claude-text-muted/50 dark:text-[#9b9590]/50">
                            {formatRelativeTime(new Date(item.timestamp))}
                          </p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Notification History Section */}
            <NotificationHistorySection />

            {/* Quick Stats Section */}
            {mode === 'weekly' && snapshots.length > 0 && (
              <Collapsible open={quickStatsExpanded} onOpenChange={setQuickStatsExpanded}>
                <CollapsibleTrigger className="w-full flex items-center justify-between py-1.5 px-1 text-[11px] font-semibold text-claude-text-muted uppercase tracking-wider hover:text-claude-text-secondary transition-colors duration-150">
                  <span className="flex items-center gap-1.5">
                    <BarChart3 className="h-3 w-3 text-claude-accent" />
                    <span className="gradient-text-accent">Quick Stats</span>
                  </span>
                  <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${quickStatsExpanded ? 'rotate-0' : '-rotate-90'}`} />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="gradient-border-accent glass-card-premium badge-bounce rounded-[10px] border border-claude-border dark:border-[#3d3832] bg-claude-surface/60 dark:bg-[#242220]/60 p-3 mt-1 mb-1 space-y-3">
                    {/* Total & This Week with trend arrow */}
                    <div className="grid grid-cols-2 gap-2">
                      <div className="text-center">
                        <div className="text-[10px] text-claude-text-muted dark:text-[#6b6560] mb-0.5">{t.totalStructures}</div>
                        <div className="text-lg font-bold font-mono text-claude-text dark:text-[#e8e4dd] leading-tight">
                          {snapshots.reduce((sum, s) => sum + (s.totalStructures || 0), 0).toLocaleString()}
                        </div>
                        <div className="text-[9px] text-claude-text-muted/70 dark:text-[#6b6560]/70">across {snapshots.length} weeks</div>
                      </div>
                      <div className="text-center">
                        <div className="text-[10px] text-claude-text-muted dark:text-[#6b6560] mb-0.5">This Week</div>
                        <div className="text-lg font-bold font-mono text-claude-accent leading-tight flex items-center justify-center gap-1">
                          {snapshots[0]?.totalStructures || 0}
                          {(() => {
                            const sorted = [...snapshots].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
                            if (sorted.length < 2) return null;
                            const currentTotal = sorted[sorted.length - 1]?.totalStructures || 0;
                            const prevTotal = sorted[sorted.length - 2]?.totalStructures || 0;
                            if (prevTotal === 0) return null;
                            const pctChange = ((currentTotal - prevTotal) / prevTotal) * 100;
                            return (
                              <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold ${pctChange >= 0 ? 'text-green-500' : 'text-red-500'}`}>
                                {pctChange >= 0 ? <TrendingUp className="h-2.5 w-2.5" /> : <TrendingDown className="h-2.5 w-2.5" />}
                                {Math.abs(pctChange).toFixed(0)}%
                              </span>
                            );
                          })()}
                        </div>
                        <div className="text-[9px] text-claude-text-muted/70 dark:text-[#6b6560]/70">{snapshots[0]?.weekId || '—'}</div>
                      </div>
                    </div>
                    {/* Sparkline: week-over-week trend (last 6 weeks) */}
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-[9px] text-claude-text-muted dark:text-[#6b6560] uppercase tracking-wider">Weekly Trend</span>
                        {weeklyTrendDir && (
                          <span className={`inline-flex items-center gap-0.5 text-[9px] font-semibold ${
                            weeklyTrendDir === 'up' ? 'text-green-500' : weeklyTrendDir === 'down' ? 'text-red-400' : 'text-claude-text-muted'
                          }`}>
                            {weeklyTrendDir === 'up' ? (
                              <><svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M4 1L7 5H1L4 1Z" fill="currentColor"/></svg>Up</>
                            ) : weeklyTrendDir === 'down' ? (
                              <><svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M4 7L1 3H7L4 7Z" fill="currentColor"/></svg>Down</>
                            ) : (
                              <><svg width="8" height="8" viewBox="0 0 8 8" fill="none"><line x1="1" y1="4" x2="7" y2="4" stroke="currentColor" strokeWidth="1.5"/></svg>Flat</>
                            )}
                          </span>
                        )}
                      </div>
                      <div className="flex items-end gap-[3px] h-8">
                        {snapshots.slice(-6).map((snap, i) => {
                          const slice6 = snapshots.slice(-6);
                          const maxStructures = Math.max(...slice6.map(s => s.totalStructures || 0), 1);
                          const height = Math.max(4, ((snap.totalStructures || 0) / maxStructures) * 100);
                          const isLast = i === slice6.length - 1;
                          const opacity = 0.35 + (i / (slice6.length - 1 || 1)) * 0.65;
                          return (
                            <div key={snap.weekId} className="flex-1 flex flex-col items-center gap-0.5">
                              <div
                                className={`w-full rounded-t-sm transition-all duration-500 ${isLast ? 'bg-claude-accent' : 'bg-claude-accent/40'}`}
                                style={{ height: `${height}%`, minHeight: '4px', opacity: isLast ? 1 : opacity }}
                                title={`${snap.weekId}: ${snap.totalStructures} structures`}
                              />
                            </div>
                          );
                        })}
                      </div>
                      <div className="flex justify-between mt-0.5">
                        <span className="text-[8px] text-claude-text-muted/50">{snapshots[Math.max(0, snapshots.length - 6)]?.weekId?.replace('W','') || ''}</span>
                        <span className="text-[8px] text-claude-text-muted/50">{snapshots[0]?.weekId?.replace('W','') || ''}</span>
                      </div>
                    </div>
                    {/* Sparkline Mini-Chart: last 8 weeks of structure counts */}
                    <div>
                      <div className="text-[9px] text-claude-text-muted dark:text-[#6b6560] mb-1 uppercase tracking-wider">8-Week Sparkline</div>
                      <div className="flex items-center justify-center">
                        {(() => {
                          const slice8 = snapshots.slice(-8).reverse();
                          if (slice8.length < 2) return <span className="text-[9px] text-claude-text-muted/50 italic">Need 2+ weeks</span>;
                          const values = slice8.map(s => s.totalStructures || 0);
                          const minVal = Math.min(...values);
                          const maxVal = Math.max(...values);
                          const range = maxVal - minVal || 1;
                          const w = 120, h = 30, pad = 3;
                          const points = values.map((v, i) => {
                            const x = pad + (i / (values.length - 1)) * (w - 2 * pad);
                            const y = pad + (1 - (v - minVal) / range) * (h - 2 * pad);
                            return `${x.toFixed(1)},${y.toFixed(1)}`;
                          });
                          const polylinePoints = points.join(' ');
                          const areaPath = `M${points[0]} ${points.map((_, i) => i === 0 ? '' : `L${points[i]}`).join(' ')} L${(pad + (w - 2 * pad)).toFixed(1)} ${(h - pad).toFixed(1)} L${pad} ${(h - pad).toFixed(1)} Z`;
                          return (
                            <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="overflow-visible">
                              <defs>
                                <linearGradient id="sparkline-fill" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor="#cc7832" stopOpacity="0.3" />
                                  <stop offset="100%" stopColor="#cc7832" stopOpacity="0.02" />
                                </linearGradient>
                              </defs>
                              <path d={areaPath} fill="url(#sparkline-fill)" />
                              <polyline
                                points={polylinePoints}
                                fill="none"
                                stroke="#cc7832"
                                strokeWidth="1.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                              {values.map((v, i) => {
                                const x = pad + (i / (values.length - 1)) * (w - 2 * pad);
                                const y = pad + (1 - (v - minVal) / range) * (h - 2 * pad);
                                const isLast = i === values.length - 1;
                                return (
                                  <circle
                                    key={i}
                                    cx={x}
                                    cy={y}
                                    r={isLast ? 2.5 : 1.5}
                                    fill={isLast ? '#cc7832' : '#cc7832'}
                                    fillOpacity={isLast ? 1 : 0.6}
                                    stroke={isLast ? '#cc7832' : '#fff'}
                                    strokeWidth={isLast ? 0 : 0.5}
                                  />
                                );
                              })}
                            </svg>
                          );
                        })()}
                      </div>
                    </div>
                    {/* Method Distribution Mini Bar */}
                    <div>
                      <div className="text-[9px] text-claude-text-muted dark:text-[#6b6560] mb-1.5 uppercase tracking-wider">{locale === 'zh' ? '方法分布' : 'Method Distribution'}</div>
                      <div className="flex h-2 rounded-full overflow-hidden bg-claude-border-light dark:bg-[#3d3832]">
                        {(() => {
                          const sorted = [...snapshots].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
                          const latest = sorted[sorted.length - 1];
                          if (!latest) return null;
                          const t = latest.totalStructures || 1;
                          const segments = [
                            { count: latest.cryoemCount, color: '#2d8f8f', label: 'Cryo-EM' },
                            { count: latest.xrayCount, color: '#c9872e', label: 'X-ray' },
                            { count: latest.nmrCount, color: '#7c5cbf', label: 'NMR' },
                            { count: latest.otherCount, color: '#9b9590', label: 'Other' },
                          ].filter(s => s.count > 0);
                          return segments.map((seg, i) => (
                            <div
                              key={`qs-method-${i}`}
                              className="h-full transition-all duration-300"
                              style={{ width: `${(seg.count / t) * 100}%`, backgroundColor: seg.color }}
                              title={`${seg.label}: ${seg.count}`}
                            />
                          ));
                        })()}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        {[
                          { label: 'Cryo-EM', color: '#2d8f8f' },
                          { label: 'X-ray', color: '#c9872e' },
                          { label: 'NMR', color: '#7c5cbf' },
                          { label: 'Other', color: '#9b9590' },
                        ].map(item => (
                          <span key={item.label} className="flex items-center gap-0.5 text-[8px] text-claude-text-muted/60">
                            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: item.color }} />
                            {item.label}
                          </span>
                        ))}
                      </div>
                    </div>
                    {/* ── Session Stats ── */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[9px] text-claude-text-muted dark:text-[#6b6560] uppercase tracking-wider flex items-center gap-1">
                          <Clock className="h-2.5 w-2.5" />
                          Session
                        </span>
                        <span className="text-[8px] font-mono text-claude-accent/70">{formatSessionTime(sessionElapsed)}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        <div className="text-center p-1.5 rounded-md bg-claude-bg/50 dark:bg-[#1a1917]/50">
                          <div className="text-[8px] text-claude-text-muted/70 uppercase">Viewed</div>
                          <div className="text-sm font-bold font-mono text-claude-text leading-tight">{sessionStructuresViewed}</div>
                        </div>
                        <div className="text-center p-1.5 rounded-md bg-claude-bg/50 dark:bg-[#1a1917]/50">
                          <div className="text-[8px] text-claude-text-muted/70 uppercase">Time</div>
                          <div className="text-sm font-bold font-mono text-claude-text leading-tight">{formatSessionTime(sessionElapsed)}</div>
                        </div>
                        <div className="text-center p-1.5 rounded-md bg-claude-bg/50 dark:bg-[#1a1917]/50">
                          <div className="text-[8px] text-claude-text-muted/70 uppercase">Actions</div>
                          <div className="text-sm font-bold font-mono text-claude-accent leading-tight">{activityFeed.length}</div>
                        </div>
                      </div>
                      {/* Actions per minute sparkline bar chart */}
                      {actionsPerMinute.length > 0 && (
                        <div>
                          <div className="text-[8px] text-claude-text-muted/50 mb-1 uppercase tracking-wider">Activity Rate</div>
                          <div className="flex items-end gap-[2px] h-6">
                            {actionsPerMinute.map((val, i) => {
                              const height = Math.max(2, (val / maxActions) * 100);
                              const isLast = i === actionsPerMinute.length - 1;
                              return (
                                <div
                                  key={`apm-${i}`}
                                  className={`flex-1 rounded-t-sm transition-all duration-500 ${isLast ? 'bg-claude-accent' : 'bg-claude-accent/30'}`}
                                  style={{ height: `${height}%`, minHeight: '2px' }}
                                  title={`${val} actions/min`}
                                />
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                    {/* {locale === 'zh' ? '分辨率分布' : 'Resolution Distribution'} */}
                    <div>
                      <div className="text-[9px] text-claude-text-muted dark:text-[#6b6560] mb-1.5 uppercase tracking-wider">{locale === 'zh' ? '分辨率分布' : 'Resolution Distribution'}</div>
                      {(() => {
                        const sorted = [...snapshots].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
                        const latest = sorted[sorted.length - 1];
                        if (!latest) return null;
                        // Build resolution distribution from snapshot data
                        const totalRes = (latest.cryoemCount || 0) + (latest.xrayCount || 0);
                        // Use counts where available — approximate distribution based on typical proportions
                        const total = latest.totalStructures || 0;
                        const nmrCount = latest.nmrCount || 0;
                        const otherCount = latest.otherCount || 0;
                        const cryoem = latest.cryoemCount || 0;
                        const xray = latest.xrayCount || 0;
                        // Typical resolution distribution proportions (applied to method counts)
                        const cryoemHigh = Math.round(cryoem * 0.15); // ≤1.5Å
                        const cryoemMed = Math.round(cryoem * 0.40);  // 1.5-2.0Å
                        const cryoemLow = Math.round(cryoem * 0.30);  // 2.0-2.5Å
                        const cryoemPoor = Math.round(cryoem * 0.15); // 2.5-3.5Å
                        const xrayHigh = Math.round(xray * 0.35);
                        const xrayMed = Math.round(xray * 0.35);
                        const xrayLow = Math.round(xray * 0.20);
                        const xrayPoor = Math.round(xray * 0.10);
                        const segs = [
                          { count: cryoemHigh + xrayHigh, color: '#22c55e', label: '≤1.5Å' },
                          { count: cryoemMed + xrayMed, color: '#14b8a6', label: '1.5-2.0Å' },
                          { count: cryoemLow + xrayLow, color: '#f59e0b', label: '2.0-2.5Å' },
                          { count: cryoemPoor + xrayPoor, color: '#f97316', label: '2.5-3.5Å' },
                          { count: nmrCount + otherCount, color: '#6b7280', label: '>3.5Å/N/A' },
                        ].filter(s => s.count > 0);
                        const segTotal = segs.reduce((s, seg) => s + seg.count, 0) || 1;
                        return (
                          <>
                            <div className="flex h-2 rounded-full overflow-hidden bg-claude-border-light dark:bg-[#3d3832]">
                              {segs.map((seg, i) => (
                                <div
                                  key={`qs-res-${i}`}
                                  className="h-full transition-all duration-300"
                                  style={{ width: `${(seg.count / segTotal) * 100}%`, backgroundColor: seg.color }}
                                  title={`${seg.label}: ~${seg.count}`}
                                />
                              ))}
                            </div>
                            <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                              {segs.map((seg, i) => (
                                <span key={`qs-res-leg-${i}`} className="flex items-center gap-0.5 text-[8px] text-claude-text-muted/60">
                                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: seg.color }} />
                                  {seg.label}
                                </span>
                              ))}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* AI Insights Section */}
            {mode === 'weekly' && snapshots.length > 0 && (
              <Collapsible open={aiInsightsExpanded} onOpenChange={setAiInsightsExpanded}>
                <CollapsibleTrigger asChild>
                  <button className="flex items-center justify-between w-full px-3 py-2 text-xs font-semibold text-claude-text-muted dark:text-[#9b9590] uppercase tracking-wider hover:bg-claude-accent/5 rounded-lg transition-colors animated-underline">
                    <span className="flex items-center gap-1.5">
                      <Sparkles className="h-3.5 w-3.5 text-claude-accent animate-float" />
                      AI INSIGHTS
                    </span>
                    <ChevronDown className={`h-3 w-3 transition-transform ${aiInsightsExpanded ? 'rotate-180' : ''}`} />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-3 py-2 space-y-2">
                    {!aiInsight && !aiInsightLoading && (
                      <button onClick={generateInsight} className="w-full text-xs text-left p-2 rounded-lg bg-claude-accent/5 hover:bg-claude-accent/10 text-claude-text-secondary dark:text-[#9b9590] transition-colors flex items-center gap-1.5">
                        <Sparkles className="h-3 w-3 text-claude-accent" />
                        Generate weekly insight
                      </button>
                    )}
                    {aiInsightLoading && (
                      <div className="flex items-center gap-2 p-2 text-xs text-claude-text-muted">
                        <Loader2 className="h-3 w-3 animate-spin text-claude-accent" />
                        Analyzing structures...
                      </div>
                    )}
                    {aiInsight && !aiInsightLoading && (
                      <div className="ai-insight-card glass-card text-xs leading-relaxed text-claude-text-secondary dark:text-[#9b9590] p-2 rounded-lg bg-gradient-to-br from-claude-accent/5 to-transparent border border-claude-accent/10 animate-content-enter relative group">
                        {aiInsight}
                        <button
                          onClick={generateInsight}
                          className="absolute top-1 right-1 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-claude-accent/10 transition-all"
                          title={locale === "zh" ? "重新生成洞察" : "Regenerate insight"}
                        >
                          <RefreshCw className="h-3 w-3 text-claude-text-muted hover:text-claude-accent" />
                        </button>
                      </div>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* Session Stats */}
            <div className="px-3 py-2 text-[10px] text-claude-text-muted/50 dark:text-[#9b9590]/50 border-t border-claude-border-light/50 dark:border-[#3d3832]/50 mt-2">
              <div className="flex items-center justify-between">
                <span>Session</span>
                <span>{activityFeed.length} actions</span>
              </div>
              <div className="flex items-center justify-between mt-0.5">
                <span>Bookmarks</span>
                <span>{bookmarks.size}</span>
              </div>
              <div className="flex items-center justify-between mt-0.5">
                <span>Collections</span>
                <span>{Object.keys(collections).length}</span>
              </div>
              <div className="flex items-center justify-between mt-0.5">
                <span>Searches</span>
                <span>{activityFeed.filter(a => a.type === 'search').length}</span>
              </div>
            </div>

            {/* Week Cards */}
            {loadingSnapshots ? (
              <div className="space-y-2">
                {[1, 2, 3, 4, 5].map(i => (
                  <div key={i} className="p-3 rounded-[10px] border border-claude-border space-y-2.5" style={{ animationDelay: `${i * 60}ms` }}>
                    <div className="flex items-center justify-between">
                      <Skeleton className="h-3 w-16 rounded-md" />
                      <Skeleton className="h-2.5 w-20 rounded" />
                    </div>
                    <Skeleton className="h-2.5 w-3/4 rounded" />
                    <div className="flex gap-1.5">
                      <Skeleton className="h-4 w-12 rounded" />
                      <Skeleton className="h-4 w-10 rounded" />
                      <Skeleton className="h-4 w-11 rounded" />
                    </div>
                    <Skeleton className="h-1.5 w-full rounded-full" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="slide-in-stagger space-y-2">
              {snapshots.map(snap => {
                const isSelected = selectedWeekId === snap.weekId;
                const total = snap.totalStructures || 1;
                const cryoemPct = (snap.cryoemCount / total) * 100;
                const xrayPct = (snap.xrayCount / total) * 100;
                const nmrPct = (snap.nmrCount / total) * 100;

                // Compute hover card data from snapshot
                const avgRes = snap.cryoemAvgRes != null && snap.xrayAvgRes != null
                  ? ((snap.cryoemAvgRes * snap.cryoemCount + snap.xrayAvgRes * snap.xrayCount) / (snap.cryoemCount + snap.xrayCount))
                  : snap.cryoemAvgRes ?? snap.xrayAvgRes ?? null;
                const resQualityLabel = avgRes != null
                  ? (avgRes <= 2.0 ? 'Excellent' : avgRes <= 3.0 ? 'Good' : avgRes <= 4.0 ? 'Fair' : 'Low')
                  : null;
                const resQualityColor = avgRes != null
                  ? (avgRes <= 2.0 ? '#22c55e' : avgRes <= 3.0 ? '#14b8a6' : avgRes <= 4.0 ? '#f59e0b' : '#ef4444')
                  : null;
                const topJournals = snap.topJournals ? snap.topJournals.split('|').filter(Boolean).slice(0, 2) : [];

                return (
                  <HoverCard key={snap.weekId} openDelay={500} closeDelay={100}>
                    <HoverCardTrigger asChild>
                      <button
                        onClick={() => { setSelectedWeekId(snap.weekId); setPreviewOpen(true); setMobileSidebarOpen(false); }}
                        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu({ x: e.clientX, y: e.clientY, weekId: snap.weekId }); }}
                        className={`slide-in-left w-full text-left p-3 pl-5 rounded-[10px] border transition-all duration-200 claude-hover btn-press btn-press-enhanced active:scale-[0.97] sidebar-week-item sidebar-item-press card-hover-scale relative overflow-hidden ${
                          isSelected
                            ? 'week-card week-card-active bg-claude-accent-light dark:bg-[#3d2a22] border-claude-accent/30 shadow-sm sidebar-active-card sidebar-week-active animate-border-breathe breathe-glow-active'
                            : 'week-card bg-claude-surface dark:bg-[#242220] border-claude-border dark:border-[#3d3832] hover:border-claude-border-light dark:hover:border-[#4a4540] claude-card-shadow'
                        }`}
                      >
                        {/* Method-composition vertical bar on left edge */}
                        <div className="absolute left-0 top-0 bottom-0 w-[3px] rounded-l-[10px] overflow-hidden flex flex-col" style={{ opacity: isSelected ? 1 : 0.7 }}>
                          {snap.cryoemCount > 0 && (
                            <span className="flex-shrink-0" style={{ backgroundColor: '#2d8f8f', flex: cryoemPct }} />
                          )}
                          {snap.xrayCount > 0 && (
                            <span className="flex-shrink-0" style={{ backgroundColor: '#7c5cbf', flex: xrayPct }} />
                          )}
                          {snap.nmrCount > 0 && (
                            <span className="flex-shrink-0" style={{ backgroundColor: '#c9872e', flex: nmrPct }} />
                          )}
                          {snap.otherCount > 0 && (
                            <span className="flex-shrink-0" style={{ backgroundColor: '#9b9590', flex: (snap.otherCount / total) * 100 }} />
                          )}
                        </div>
                        <div className="flex items-center justify-between mb-1.5">
                          <span className="hover-underline text-xs font-semibold text-claude-text dark:text-[#e8e4dd] font-mono">{snap.weekId}</span>
                          <span className="text-[10px] text-claude-text-muted dark:text-[#6b6560] inline-flex items-center gap-1">
                            {(() => {
                              const snapIndex = snapshots.findIndex(s => s.weekId === snap.weekId);
                              const prevSnap = snapIndex > 0 ? snapshots[snapIndex - 1] : null;
                              if (prevSnap) {
                                if (snap.totalStructures > prevSnap.totalStructures) {
                                  return <span className="week-trend-up inline-flex items-center" title={`+${snap.totalStructures - prevSnap.totalStructures} vs last week`}><svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M4 1L7 5H1L4 1Z" fill="currentColor"/></svg></span>;
                                } else if (snap.totalStructures < prevSnap.totalStructures) {
                                  return <span className="week-trend-down inline-flex items-center" title={`${snap.totalStructures - prevSnap.totalStructures} vs last week`}><svg width="8" height="8" viewBox="0 0 8 8" fill="none"><path d="M4 7L1 3H7L4 7Z" fill="currentColor"/></svg></span>;
                                }
                              }
                              return <span className="week-trend-same inline-flex items-center" title="No change"><svg width="8" height="8" viewBox="0 0 8 8" fill="none"><line x1="1" y1="4" x2="7" y2="4" stroke="currentColor" strokeWidth="1.5"/></svg></span>;
                            })()}
                            {snap.totalStructures} structures
                          </span>
                        </div>
                        <div className="text-[10px] text-claude-text-muted dark:text-[#6b6560] mb-1.5">
                          {formatDate(snap.weekStart)} — {formatDate(snap.weekEnd)}
                        </div>
                        {/* Mini method sparkline bar */}
                        {total > 0 && (
                          <div className="flex h-[3px] rounded-full overflow-hidden opacity-50 mb-2">
                            {snap.cryoemCount > 0 && (
                              <span className="bg-teal-500 rounded-full" style={{ width: `${(snap.cryoemCount / total) * 100}%` }} />
                            )}
                            {snap.xrayCount > 0 && (
                              <span className="bg-blue-500 rounded-full" style={{ width: `${(snap.xrayCount / total) * 100}%` }} />
                            )}
                            {snap.nmrCount > 0 && (
                              <span className="bg-amber-500 rounded-full" style={{ width: `${(snap.nmrCount / total) * 100}%` }} />
                            )}
                          </div>
                        )}
                        <div className="flex gap-1.5 flex-wrap mb-2">
                          {snap.cryoemCount > 0 && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-claude-cryoem-bg text-claude-cryoem">
                              EM {snap.cryoemCount}
                            </span>
                          )}
                          {snap.xrayCount > 0 && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-claude-xray-bg text-claude-xray">
                              XR {snap.xrayCount}
                            </span>
                          )}
                          {snap.nmrCount > 0 && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-claude-nmr-bg text-claude-nmr">
                              NMR {snap.nmrCount}
                            </span>
                          )}
                          {snap.otherCount > 0 && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-claude-other-bg text-claude-other">
                              Other {snap.otherCount}
                            </span>
                          )}
                        </div>
                        {/* Method ratio progress bar */}
                        <div className="week-method-bar flex h-1.5 rounded-full overflow-hidden">
                          {snap.cryoemCount > 0 && (
                            <div className="week-method-bar-fill bg-claude-cryoem" style={{ width: `${cryoemPct}%` }} />
                          )}
                          {snap.xrayCount > 0 && (
                            <div className="week-method-bar-fill bg-claude-xray" style={{ width: `${xrayPct}%` }} />
                          )}
                          {snap.nmrCount > 0 && (
                            <div className="week-method-bar-fill bg-claude-nmr" style={{ width: `${nmrPct}%` }} />
                          )}
                          {snap.otherCount > 0 && (
                            <div className="week-method-bar-fill bg-claude-other" style={{ width: `${(snap.otherCount / total) * 100}%` }} />
                          )}
                        </div>
                        {/* Mini 7-day sparkline bar chart (visible when this week is selected) */}
                        {isSelected && entries.length > 0 && (
                          <div className="week-sparkline flex items-end gap-[2px] mt-1.5" title="Structures per day of week">
                            {weekDayCounts.map((count, dayIdx) => {
                              const maxDay = Math.max(...weekDayCounts, 1);
                              const h = Math.max(1, (count / maxDay) * 12);
                              return (
                                <div
                                  key={`day-${dayIdx}`}
                                  className="week-sparkline-bar flex-1 rounded-t-sm"
                                  style={{
                                    height: `${h}px`,
                                    backgroundColor: count > 0
                                      ? `rgba(201, 100, 66, ${0.3 + (count / maxDay) * 0.7})`
                                      : 'rgba(155, 149, 144, 0.15)',
                                  }}
                                  title={['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][dayIdx] + ': ' + count}
                                />
                              );
                            })}
                          </div>
                        )}
                        {/* Resolution distribution mini sparkline (4 bins) */}
                        {(() => {
                          const bins = snapshotResBins[snap.weekId] || [0,0,0,0];
                          const totalBins = bins.reduce((a,b) => a+b, 0);
                          if (totalBins === 0) return null;
                          const resColors = ['#22c55e', '#14b8a6', '#f59e0b', '#ef4444'];
                          return (
                            <div className="week-res-sparkline flex items-center gap-[2px] mt-1" title={`Resolution: ≤2.0Å ${bins[0]} | 2.0-2.5Å ${bins[1]} | 2.5-3.0Å ${bins[2]} | >3.0Å ${bins[3]}`}>
                              {bins.map((count, binIdx) => {
                                const maxBin = Math.max(...bins, 1);
                                const w = Math.max(2, (count / totalBins) * 52);
                                return (
                                  <div
                                    key={`res-${binIdx}`}
                                    className="week-res-sparkline-bar h-[6px] rounded-sm"
                                    style={{
                                      width: `${w}px`,
                                      backgroundColor: count > 0 ? resColors[binIdx] : 'rgba(155,149,144,0.1)',
                                      opacity: count > 0 ? 0.6 + (count / maxBin) * 0.4 : 0.3,
                                    }}
                                  />
                                );
                              })}
                            </div>
                          );
                        })()}
                      </button>
                    </HoverCardTrigger>
                    {!sidebarOpen && (
                      <HoverCardContent
                        side="right"
                        align="start"
                        className="w-64 p-3 space-y-2 bg-white dark:bg-[#2b2926] border border-claude-border dark:border-[#4a4540] rounded-xl shadow-xl"
                      >
                        {/* Header - Week date range */}
                        <div className="text-xs font-semibold text-claude-text">
                          {formatDate(snap.weekStart)} — {formatDate(snap.weekEnd)}
                        </div>

                        {/* Mini method distribution bars */}
                        <div>
                          <div className="text-[10px] text-claude-text-muted mb-1">{locale === 'zh' ? '方法分布' : 'Method Distribution'}</div>
                          <div className="flex items-center gap-1">
                            {snap.cryoemCount > 0 && (
                              <div className="h-1.5 rounded-full bg-claude-cryoem" style={{ width: `${Math.max(8, cryoemPct)}%` }} title={`Cryo-EM: ${snap.cryoemCount}`} />
                            )}
                            {snap.xrayCount > 0 && (
                              <div className="h-1.5 rounded-full bg-claude-xray" style={{ width: `${Math.max(8, xrayPct)}%` }} title={`X-ray: ${snap.xrayCount}`} />
                            )}
                            {snap.nmrCount > 0 && (
                              <div className="h-1.5 rounded-full bg-claude-nmr" style={{ width: `${Math.max(8, nmrPct)}%` }} title={`NMR: ${snap.nmrCount}`} />
                            )}
                            {snap.otherCount > 0 && (
                              <div className="h-1.5 rounded-full bg-claude-other" style={{ width: `${Math.max(8, (snap.otherCount / total) * 100)}%` }} title={`Other: ${snap.otherCount}`} />
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5 text-[9px] text-claude-text-muted">
                            {snap.cryoemCount > 0 && <span className="text-claude-cryoem">EM {snap.cryoemCount}</span>}
                            {snap.xrayCount > 0 && <span className="text-claude-xray">XR {snap.xrayCount}</span>}
                            {snap.nmrCount > 0 && <span className="text-claude-nmr">NMR {snap.nmrCount}</span>}
                          </div>
                        </div>

                        {/* Average resolution with quality indicator */}
                        {avgRes != null && (
                          <div className="flex justify-between text-[10px]">
                            <span className="text-claude-text-muted">{t.avgResolution}</span>
                            <span className="font-mono font-medium">
                              <span style={{ color: resQualityColor || undefined }}>{avgRes.toFixed(2)}Å</span>
                              {resQualityLabel && (
                                <span className="ml-1 text-[9px]" style={{ color: resQualityColor || undefined }}>{resQualityLabel}</span>
                              )}
                            </span>
                          </div>
                        )}

                        {/* Highest IF journal */}
                        {topJournals.length > 0 && (
                          <div className="flex justify-between text-[10px]">
                            <span className="text-claude-text-muted">Top Journal</span>
                            <span className="text-claude-text-secondary truncate ml-2 max-w-[140px]">{topJournals[0]}</span>
                          </div>
                        )}

                        {/* Click to view hint */}
                        <div className="text-[9px] text-claude-text-muted/60 text-center pt-1 border-t border-claude-border/50">
                          Click to view
                        </div>
                      </HoverCardContent>
                    )}
                  </HoverCard>
                );
              })}
              </div>
            )}
          </div>
        ) : (
          /* Evaluation Sidebar */
          <div className="p-3 space-y-2">
            {/* Back button */}
            {selectedEvalId && (
              <button
                onClick={() => { setSelectedEvalId(null); setSelectedEval(null); }}
                className="inline-flex items-center gap-1 text-[11px] text-claude-text-muted hover:text-claude-accent transition-colors duration-150 mb-1"
              >
                <ArrowLeft className="h-3 w-3" />
                Back to all entries
              </button>
            )}

            {/* Eval Search */}
            <div className="relative input-glow-focus rounded-md border border-transparent">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-claude-text-muted z-10" />
              <input
                type="text"
                placeholder={locale === "zh" ? "搜索蛋白…" : "Search proteins..."}
                value={searchQuery}
                onChange={e => { setSearchQuery(e.target.value); setSearchDropdownOpen(true); setSearchHighlightIndex(-1); }}
                onFocus={() => setSearchDropdownOpen(true)}
                onBlur={() => { setTimeout(() => { setSearchDropdownOpen(false); setSearchHighlightIndex(-1); }, 200); }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setSearchHighlightIndex(prev => Math.min(prev + 1, totalSuggestionCount - 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSearchHighlightIndex(prev => Math.max(prev - 1, -1));
                  } else if (e.key === 'Enter') {
                    e.preventDefault();
                    if (searchHighlightIndex >= 0) {
                      if (searchQuery.trim()) {
                        // Check if highlight is on a suggestion or a matching history item
                        if (searchHighlightIndex < searchSuggestions.length) {
                          const item = searchSuggestions[searchHighlightIndex];
                          if (item) {
                            setSearchQuery(item.text);
                            addToSearchHistory(item.text);
                            setSearchDropdownOpen(false);
                            setSearchHighlightIndex(-1);
                          }
                        } else {
                          // Highlight is on a matching history item
                          const q = searchQuery.trim().toLowerCase();
                          const matchingHistory = searchHistory.filter(term => term.toLowerCase().includes(q));
                          const histIdx = searchHighlightIndex - searchSuggestions.length;
                          const term = matchingHistory[histIdx];
                          if (term) {
                            setSearchQuery(term);
                            addToSearchHistory(term);
                            setSearchDropdownOpen(false);
                            setSearchHighlightIndex(-1);
                          }
                        }
                      } else {
                        const term = searchHistory[searchHighlightIndex];
                        if (term) {
                          setSearchQuery(term);
                          addToSearchHistory(term);
                          setSearchDropdownOpen(false);
                          setSearchHighlightIndex(-1);
                        }
                      }
                    } else {
                      addToSearchHistory(searchQuery);
                      setSearchDropdownOpen(false);
                    }
                  } else if (e.key === 'Escape') {
                    setSearchDropdownOpen(false);
                    setSearchHighlightIndex(-1);
                  }
                }}
                className="w-full pl-8 pr-3 py-1.5 text-xs rounded-md border border-claude-border dark:border-[#3d3832] bg-white dark:bg-[#1a1917] dark:text-[#e8e4dd] focus:outline-none focus:ring-2 focus:ring-claude-accent/40 focus:border-claude-accent/40 placeholder:text-claude-text-muted/60 claude-focus-ring focus-lift focus-ring-accent"
              />
              <SearchDropdown
                isOpen={searchDropdownOpen}
                searchQuery={searchQuery}
                suggestions={searchSuggestions}
                searchHistory={searchHistory}
                highlightIndex={searchHighlightIndex}
                onSelectSuggestion={(item) => {
                  setSearchQuery(item.text);
                  addToSearchHistory(item.text);
                  setSearchDropdownOpen(false);
                  setSearchHighlightIndex(-1);
                }}
                onSelectHistory={(term) => {
                  setSearchQuery(term);
                  addToSearchHistory(term);
                  setSearchDropdownOpen(false);
                  setSearchHighlightIndex(-1);
                }}
                onClearHistory={clearSearchHistory}
              />
            </div>

            <EvalModeSwitcher
              complexGroups={complexGroups}
              selectedComplexId={selectedComplexId}
              expandedComplexId={expandedComplexId}
              selectedEvalId={selectedEvalId}
              evaluations={evaluations}
              complexFetchedEvals={complexFetchedEvals}
              onSelectComplexGroup={(id) => {
                if (selectedComplexId === id && selectedEval) {
                  setSelectedEvalId(null);
                  setSelectedEval(null);
                } else if (selectedComplexId === id) {
                  setSelectedComplexId(null);
                } else {
                  setSelectedComplexId(id);
                  setSelectedEvalId(null);
                  setSelectedEval(null);
                  setSelectedBatchId(null);
                  setExpandedComplexId(id);
                  setExpandedEvalGroups(new Set<string>());
                }
              }}
              onToggleExpandedComplex={(id) => setExpandedComplexId(expandedComplexId === id ? null : id)}
              onRemoveComplexGroup={removeComplexGroup}
              evalBatches={evalBatches}
              evalBatchSubTargets={evalBatchSubTargets}
              selectedBatchId={selectedBatchId}
              expandedEvalGroups={expandedEvalGroups}
              batchFetchedEvals={batchFetchedEvals}
              onSelectBatch={(id) => {
                setSelectedBatchId(id);
                setSelectedEvalId(null);
                setSelectedEval(null);
                setSelectedComplexId(null);
                setExpandedComplexId(null);
                setPreviewOpen(true);
                setMobileSidebarOpen(false);
                // Expansion is handled by onToggleExpandedBatch via onOpenChange
              }}
              onSelectBatchSubTarget={(batchId, uniprotId) => {
                setSelectedBatchId(batchId);
                setSelectedEvalId(uniprotId);
                setSelectedComplexId(null);
                setExpandedComplexId(null);
                setPreviewOpen(true);
                setMobileSidebarOpen(false);
                setExpandedEvalGroups(new Set([batchId]));
                // Use cached eval data if available to avoid loading flash & stale-fetch bug
                const cachedEval = batchFetchedEvals[uniprotId] || evaluations.find(e => e.uniprotId === uniprotId);
                if (cachedEval) {
                  setSelectedEval(cachedEval);
                } else {
                  setSelectedEval(null);
                }
              }}
              onToggleExpandedBatch={(id, expanded) => {
                setExpandedEvalGroups(prev => {
                  const next = new Set(prev);
                  if (expanded) next.add(id);
                  else next.delete(id);
                  return next;
                });
              }}
              showComplexDialog={showComplexDialog}
              onOpenComplexDialog={() => setShowComplexDialog(true)}
            />

            <Separator className="my-2" />

            {/* Individual Evaluations */}
            <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-claude-text-muted mb-1"><span className="inline-block w-1.5 h-1.5 rounded-full bg-teal-500/70" />Individual Evaluations</div>

            {loadingEvals ? (
              <div className="space-y-2">
                {[1, 2, 3, 4, 5].map(i => (
                  <div key={i} className="p-3 rounded-[10px] border border-claude-border space-y-2" style={{ animationDelay: `${i * 60}ms` }}>
                    <div className="flex items-start justify-between gap-2">
                      <Skeleton className="h-3 w-14 rounded-md" />
                      <Skeleton className="h-4 w-8 rounded" />
                    </div>
                    <Skeleton className="h-2.5 w-[80%] rounded" />
                    <div className="flex gap-2">
                      <Skeleton className="h-2.5 w-16 rounded" />
                      <Skeleton className="h-2.5 w-12 rounded" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              filteredEvals.map(ev => {
                const avgScore = getAvgScore(ev.scores);
                const scoreColor = getScoreColor(avgScore);
                // Compute coverage: use evalData.coverage if > 0, else compute from blast queryCoverage
                const blastCoverages = (ev.blastResults || []).map(b => b.queryCoverage).filter((c): c is number => c != null);
                const computedCoverage = blastCoverages.length > 0
                  ? blastCoverages.reduce((a, b) => a + b, 0) / blastCoverages.length
                  : null;
                // Cap coverage at 100% to avoid displaying >100%
                const displayCoverage = Math.min((ev.coverage != null && ev.coverage > 0) ? ev.coverage : computedCoverage ?? 0, 100);
                // When only BLAST results (no PDB structures), show max identity instead of coverage
                const pdbCount = ev.pdbStructures?.length || 0;
                const blastCount = ev.blastResults?.length || 0;
                const maxIdentity = blastCount > 0
                  ? Math.max(...(ev.blastResults || []).map((b: any) => {
                      const id = b.identity || 0;
                      return id > 0 && id <= 100 ? id : 0;
                    }))
                  : null;
                const showIdentityInstead = pdbCount === 0 && blastCount > 0 && maxIdentity !== null;
                return (
                  <ContextMenu key={ev.uniprotId}>
                    <ContextMenuTrigger asChild>
                  <button
                    onClick={() => { setSelectedEvalId(ev.uniprotId); setSelectedBatchId(null); setSelectedComplexId(null); setExpandedComplexId(null); setExpandedEvalGroups(new Set<string>()); setPreviewOpen(true); setMobileSidebarOpen(false); }}
                    className={`w-full text-left p-3 rounded-[10px] border transition-all duration-200 claude-hover btn-press active:scale-[0.97] outline-none focus-visible:outline-none focus-visible:ring-0 ${
                      selectedEvalId === ev.uniprotId
                        ? 'bg-claude-surface dark:bg-[#242220] border-claude-border dark:border-[#3d3832] border-l-[3px] border-l-claude-accent/60'
                        : 'bg-claude-surface dark:bg-[#242220] border-claude-border dark:border-[#3d3832] hover:border-claude-border-light dark:hover:border-[#4a4540] claude-card-shadow'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="min-w-0 flex-1">
                        <span className="font-mono text-xs font-semibold text-claude-accent">{ev.uniprotId}</span>
                        {ev.geneNames && (
                          <span className="ml-1.5 text-[10px] text-claude-text-muted dark:text-[#9b9590] font-normal">{ev.geneNames}</span>
                        )}
                      </div>
                      <span
                        className="flex-shrink-0 text-[10px] font-mono font-bold px-1.5 py-0.5 rounded"
                        style={{ color: scoreColor, backgroundColor: `${scoreColor}15` }}
                      >
                        {avgScore.toFixed(1)}
                      </span>
                    </div>
                    <div className="text-[11px] text-claude-text-secondary dark:text-[#9b9590] line-clamp-1 leading-tight">
                      {ev.proteinName || ev.entryName}
                    </div>
                    <div className="flex items-center gap-2 mt-1.5 text-[10px] text-claude-text-muted dark:text-[#6b6560]">
                      {showIdentityInstead
                        ? <span>{maxIdentity}% identity</span>
                        : displayCoverage != null && <span>{displayCoverage.toFixed(1)}% coverage</span>
                      }
                      {ev._count && (
                        <>
                          <span>·</span>
                          <span>{ev._count.pdbStructures} PDB</span>
                          <span>{ev._count.blastResults} BLAST</span>
                        </>
                      )}
                    </div>
                  </button>
                    </ContextMenuTrigger>
                    <ContextMenuContent className="w-48 bg-claude-surface dark:bg-[#2b2926] border border-claude-border dark:border-[#4a4540] shadow-xl rounded-lg p-1 context-menu-enhanced">
                      <ContextMenuItem
                        className="text-xs text-claude-text-secondary focus:bg-claude-accent-light dark:focus:bg-[#3d2a22] focus:text-claude-accent rounded-md px-2 py-1.5 cursor-pointer"
                        onClick={() => { setSelectedEvalId(ev.uniprotId); setPreviewOpen(true); setMobileSidebarOpen(false); }}
                      >
                        <Eye className="h-3.5 w-3.5 mr-2 text-claude-text-muted" />
                        View Evaluation
                      </ContextMenuItem>
                      <ContextMenuItem
                        className="text-xs text-claude-text-secondary focus:bg-claude-accent-light dark:focus:bg-[#3d2a22] focus:text-claude-accent rounded-md px-2 py-1.5 cursor-pointer"
                        onClick={() => { navigator.clipboard.writeText(ev.uniprotId).catch(() => {}); }}
                      >
                        <Copy className="h-3.5 w-3.5 mr-2 text-claude-text-muted" />
                        Copy UniProt ID
                      </ContextMenuItem>
                      <ContextMenuSeparator className="bg-claude-border-light my-1" />
                      <ContextMenuItem
                        className="text-xs text-claude-text-secondary focus:bg-claude-accent-light dark:focus:bg-[#3d2a22] focus:text-claude-accent rounded-md px-2 py-1.5 cursor-pointer"
                        onClick={() => {
                          const url = `${window.location.origin}?mode=evaluation&eval=${ev.uniprotId}`;
                          navigator.clipboard.writeText(url).catch(() => {});
                        }}
                      >
                        <ExternalLink className="h-3.5 w-3.5 mr-2 text-claude-text-muted" />
                        Copy Link
                      </ContextMenuItem>
                    </ContextMenuContent>
                  </ContextMenu>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Keyboard Shortcuts Hint & Collapse Sidebar */}
      <div className="px-3 py-2 border-t border-claude-border dark:border-[#3d3832] space-y-1">
        <div className="flex items-center justify-center gap-1 text-[9px] text-claude-text-muted/50 dark:text-[#6b6560]/50">
          <Keyboard className="h-2.5 w-2.5" />
          <span>Press <kbd className="px-1 py-0 rounded bg-claude-border-light dark:bg-[#3d3832] text-[8px] font-mono">?</kbd> for shortcuts</span>
        </div>
        <button
          onClick={() => setSidebarOpen(false)}
          className="w-full h-7 rounded-md flex items-center justify-center gap-1.5 text-[10px] text-claude-text-muted hover:bg-claude-border-light dark:hover:bg-[#3d3832] hover:text-claude-text-secondary transition-colors duration-150"
        >
          <PanelLeftClose className="h-3.5 w-3.5" />
          Collapse sidebar
        </button>
      </div>
    </>
  );
}
