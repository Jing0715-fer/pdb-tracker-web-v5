'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { BookOpen, GitCompare, X } from 'lucide-react';
import type { LitPaper, LitReport, LitStats } from '@/lib/pdb-types';

import { LiteratureToolbar, LiteratureToolbarMain, LiteratureToolbarChips, type ViewMode, type SortField, type DateFilter, type IfFilter } from './LiteratureToolbar';
import { LiteraturePaperList } from './LiteraturePaperList';
import { LiteratureDateSidebar } from './LiteratureDateSidebar';
import { ReadingListSidebar, type ReadingList, useReadingLists } from './LiteratureReadingList';
import { PaperNotesEditor, usePaperNotes, type NoteData } from './LiteraturePaperNotes';
import { LiteratureAdvancedFilter, DEFAULT_ADVANCED_FILTERS, countActiveFilters, applyAdvancedFilters, type AdvancedFilterState } from './LiteratureAdvancedFilter';
import { usePaperTags, TagFilterBar } from './LiteraturePaperTags';
import { useReadingProgress, type ReadingProgressMap } from '@/hooks/use-reading-progress';
import { LiteratureReadingProgress } from './LiteratureReadingProgress';
// Method × Reading Status Heatmap — lazy-loaded to keep the initial bundle small
const MethodReadingHeatmap = dynamic(
  () => import('./method-reading-heatmap').then(m => ({ default: m.MethodReadingHeatmap })),
  { ssr: false },
);
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import dynamic from 'next/dynamic';

// ─── Dynamic imports for heavy components ────────────────────────────────────
// LiteratureDetailPanel statically imports PdbStructureViewer (molstar CSS +
// 2800-line 3D viewer + framer-motion + radix hover-card/collapsible). Pulling
// it in eagerly forces the entire molstar chain to be parsed whenever the
// literature-view chunk loads. Lazy-load so the detail panel + its 3D viewer
// only compile when needed.
const LiteratureDetailPanel = dynamic(
  () => import('./LiteratureDetailPanel').then(m => ({ default: m.LiteratureDetailPanel })),
  {
    ssr: false,
    loading: () => null,
  }
);

// LiteratureStatsChart pulls in recharts. Lazy-load to keep recharts out of
// the main literature-view chunk until the user actually opens the charts view.
const LiteratureStatsChart = dynamic(
  () => import('./LiteratureStatsChart').then(m => ({ default: m.LiteratureStatsChart })),
  {
    ssr: false,
    loading: () => <div className="animate-pulse h-64 bg-claude-border-light dark:bg-claude-border/30 rounded-lg" />,
  }
);
// Journal IF × Date Heatmap — lazy-loaded
const JournalIfHeatmap = dynamic(
  () => import('./journal-if-heatmap').then(m => ({ default: m.JournalIfHeatmap })),
  {
    ssr: false,
    loading: () => <div className="animate-pulse h-40 bg-claude-border-light dark:bg-claude-border/30 rounded-lg" />,
  }
);

const LiteratureJournalTreemap = dynamic(
  () => import('./LiteratureJournalTreemap').then(mod => ({ default: mod.LiteratureJournalTreemap })),
  { ssr: false }
);

// LiteratureCitationNetwork (1100 lines) statically imports framer-motion and
// is only rendered when the user enables the citation graph view. Lazy-load so
// the heavy graph rendering code only compiles on demand.
const LiteratureCitationNetwork = dynamic(
  () => import('./LiteratureCitationNetwork').then(m => ({ default: m.LiteratureCitationNetwork })),
  {
    ssr: false,
    loading: () => <div className="animate-pulse h-64 bg-claude-border-light dark:bg-claude-border/30 rounded-lg" />,
  }
);

// LiteraturePaperCompare pulls in framer-motion + comparison logic. Only shown
// when user enters compare mode. Lazy-load.
const LiteraturePaperCompare = dynamic(
  () => import('./LiteraturePaperCompare').then(m => ({ default: m.LiteraturePaperCompare })),
  {
    ssr: false,
    loading: () => <div className="animate-pulse h-64 bg-claude-border-light dark:bg-claude-border/30 rounded-lg" />,
  }
);

// ─── LiteratureContent ─────────────────────────────────────────────────────────
// The content portion of literature mode, for use inside pdb-tracker's
// unified layout. No sidebar, no header, no detail panel — just stat cards,
// charts toggle, toolbar, and paper list.

export interface LiteratureContentProps {
  stats: LitStats | null;
  papers: LitPaper[];
  reports: LitReport[];
  isLoading: boolean;
  showCharts: boolean;
  onToggleCharts: () => void;
  selectedDate: string | null;
  onClearDateFilter: () => void;
  onSelectPaper: (paper: LitPaper) => void;
  hasActiveFilters: boolean;
  onClearAllFilters: () => void;
  externalSearch?: string;
  // Reading list filter
  readingListFilter?: string | null;
  onClearReadingListFilter?: () => void;
  // Source filter (日报)
  sourceFilter?: 'all' | 'daily';
  onSourceFilterChange?: () => void;
  // Notes
  paperNotes?: ReturnType<typeof usePaperNotes>;
  // Paper notes editor open state
  openNotePmid?: string | null;
  onOpenNote?: (pmid: string | null) => void;
  // Tags
  paperTagsHook?: ReturnType<typeof usePaperTags>;
  tagFilter?: string | null;
  onTagFilterChange?: (tag: string | null) => void;
  // IF filter
  ifFilter?: IfFilter;
  onIfFilterChange?: (f: IfFilter) => void;
  // Detail panel props
  isDetailOpen?: boolean;
  onCloseDetail?: () => void;
  // Reading progress
  readingProgressHook?: ReturnType<typeof useReadingProgress>;
  // Total papers count for reading progress calculation
  totalPapersCount?: number;
}

export function LiteratureContent({
  stats,
  papers,
  reports,
  isLoading,
  showCharts,
  onToggleCharts,
  selectedDate,
  onClearDateFilter,
  onSelectPaper,
  hasActiveFilters,
  onClearAllFilters,
  externalSearch,
  readingListFilter,
  onClearReadingListFilter,
  sourceFilter: externalSourceFilter,
  onSourceFilterChange: externalOnSourceFilterChange,
  paperNotes,
  openNotePmid,
  onOpenNote,
  paperTagsHook,
  tagFilter,
  ifFilter: externalIfFilter,
  onIfFilterChange: externalOnIfFilterChange,
  onTagFilterChange,
  isDetailOpen,
  onCloseDetail,
  readingProgressHook,
  totalPapersCount,
}: LiteratureContentProps) {
  // Internal UI state (not shared with pdb-tracker)
  // Source filter: use external prop if provided, otherwise internal state
  const [internalSourceFilter, setInternalSourceFilter] = useState<'all' | 'daily'>('all');
  const sourceFilter = externalSourceFilter !== undefined ? externalSourceFilter : internalSourceFilter;
  const handleSourceFilterToggle = externalOnSourceFilterChange ?? (() => setInternalSourceFilter(prev => prev === 'all' ? 'daily' : 'all'));
  const handleSourceFilterClear = externalOnSourceFilterChange ? (() => externalOnSourceFilterChange()) : (() => setInternalSourceFilter('all'));

  const [internalSearch, setInternalSearch] = useState('');

  // Derive effective search: external (header) takes priority when provided
  const search = externalSearch !== undefined ? externalSearch : internalSearch;

  const [sort, setSort] = useState<SortField>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [internalIfFilter, setInternalIfFilter] = useState<IfFilter>('all');
  const [hasPdbOnly, setHasPdbOnly] = useState(false);
  const ifFilter = externalIfFilter ?? internalIfFilter;
  const onIfFilterChange = externalOnIfFilterChange ?? setInternalIfFilter;
  const [viewMode, setViewMode] = useState<ViewMode>('cards');
  const [expandAll, setExpandAll] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [showCitationNetwork, setShowCitationNetwork] = useState(false);

  // Advanced filter state
  const [advancedFilters, setAdvancedFilters] = useState<AdvancedFilterState>(DEFAULT_ADVANCED_FILTERS);
  const [advancedFilterOpen, setAdvancedFilterOpen] = useState(false);

  // Paper compare state
  const [comparePapers, setComparePapers] = useState<LitPaper[]>([]);
  const [showCompare, setShowCompare] = useState(false);

  // Journal Map state
  const [showJournalMap, setShowJournalMap] = useState(false);
  const [journalFilter, setJournalFilter] = useState<string | null>(null);

  // Filter and sort papers
  const filteredPapers = useMemo(() => {
    let result = [...papers];

    // Reading list filter
    if (readingListFilter) {
      // This filter is handled externally via readingListFilter prop
      // The papers prop should already be filtered by the parent
    }

    // Tag filter
    if (tagFilter && paperTagsHook) {
      const papersWithTag = new Set(paperTagsHook.getPapersWithTag(tagFilter));
      result = result.filter(p => papersWithTag.has(p.pmid));
    }

    // Date filter
    if (dateFilter !== 'all') {
      const now = new Date();
      let cutoff: Date;
      switch (dateFilter) {
        case 'week':
          cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          break;
        case 'month':
          cutoff = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          break;
        case '3months':
          cutoff = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
          break;
        default:
          cutoff = new Date(0);
      }
      result = result.filter(p => {
        try {
          const d = new Date(p.pubdate + 'T00:00:00Z');
          return d >= cutoff;
        } catch {
          return true;
        }
      });
    }

    // IF filter
    if (ifFilter !== 'all') {
      const minIf = parseInt(ifFilter, 10);
      result = result.filter(p => p.IF != null && p.IF >= minIf);
    }

    // Has PDB filter
    if (hasPdbOnly) {
      result = result.filter(p => p.pdbs.length > 0);
    }

    // Source filter: show only "结构生物学文献日报" papers
    if (sourceFilter === 'daily') {
      result = result.filter(p => p.source === '结构生物学文献日报');
    }

    // Advanced filters
    result = applyAdvancedFilters(result, advancedFilters);

    // Sort
    result.sort((a, b) => {
      let cmp: number | null = null;
      switch (sort) {
        case 'IF': {
          const aNull = a.IF == null;
          const bNull = b.IF == null;
          if (aNull && bNull) return 0;
          if (aNull) return 1;
          if (bNull) return -1;
          cmp = (a.IF as number) - (b.IF as number);
          break;
        }
        case 'date':
          cmp = a.pubdate.localeCompare(b.pubdate);
          break;
        case 'title':
          cmp = (a.title || '').localeCompare(b.title || '');
          break;
        case 'journal':
          cmp = (a.journal || '').localeCompare(b.journal || '');
          break;
        case 'pmid':
          cmp = a.pmid.localeCompare(b.pmid);
          break;
      }
      return sortOrder === 'asc' ? (cmp ?? 0) : -(cmp ?? 0);
    });

    return result;
  }, [papers, sourceFilter, dateFilter, ifFilter, hasPdbOnly, sort, sortOrder, readingListFilter, tagFilter, paperTagsHook, advancedFilters]);

  const handleToggleExpand = useCallback((pmid: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(pmid)) next.delete(pmid);
      else next.add(pmid);
      return next;
    });
  }, []);

  const handleSort = useCallback((field: string) => {
    if (sort === field) {
      setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSort(field as SortField);
      setSortOrder('desc');
    }
  }, [sort]);

  const activeFiltersCount = [
    dateFilter !== 'all',
    ifFilter !== 'all',
    hasPdbOnly,
    !!readingListFilter,
    !!selectedDate,
    !!tagFilter,
    sourceFilter === 'daily',
    countActiveFilters(advancedFilters) > 0,
  ].filter(Boolean).length;

  // Advanced filter badges for toolbar
  const advancedFilterBadges = useMemo(() => {
    const badges: { label: string; onRemove: () => void }[] = [];
    for (const j of advancedFilters.journals.slice(0, 3)) {
      badges.push({
        label: j,
        onRemove: () => setAdvancedFilters(prev => ({ ...prev, journals: prev.journals.filter(x => x !== j) })),
      });
    }
    for (const m of advancedFilters.methods) {
      badges.push({
        label: m,
        onRemove: () => setAdvancedFilters(prev => ({ ...prev, methods: prev.methods.filter(x => x !== m) })),
      });
    }
    if (advancedFilters.yearStart || advancedFilters.yearEnd) {
      badges.push({
        label: `${advancedFilters.yearStart || '…'}–${advancedFilters.yearEnd || '…'}`,
        onRemove: () => setAdvancedFilters(prev => ({ ...prev, yearStart: '', yearEnd: '' })),
      });
    }
    if (advancedFilters.hasAbstract) {
      badges.push({
        label: 'Abstract',
        onRemove: () => setAdvancedFilters(prev => ({ ...prev, hasAbstract: false })),
      });
    }
    if (advancedFilters.hasPdbStructures) {
      badges.push({
        label: 'PDB',
        onRemove: () => setAdvancedFilters(prev => ({ ...prev, hasPdbStructures: false })),
      });
    }
    return badges;
  }, [advancedFilters]);

  // Tag-related data for filtering
  const tagPaperCounts = useMemo(() => {
    if (!paperTagsHook) return {};
    const counts: Record<string, number> = {};
    const allTags = paperTagsHook.getAllTags();
    for (const tag of allTags) {
      counts[tag] = paperTagsHook.getPapersWithTag(tag).length;
    }
    return counts;
  }, [paperTagsHook]);

  const handleTagClickOnCard = useCallback((tag: string) => {
    if (onTagFilterChange) {
      onTagFilterChange(tagFilter === tag ? null : tag);
    }
  }, [onTagFilterChange, tagFilter]);

  // Compare handler
  const handleOpenCompare = useCallback(() => {
    // Take the top 2-3 papers from the filtered list
    const selected = filteredPapers.slice(0, Math.min(3, filteredPapers.length));
    if (selected.length >= 2) {
      setComparePapers(selected);
      setShowCompare(true);
    }
  }, [filteredPapers]);

  // Shared toolbar props object for consistency
  const toolbarProps = {
    search,
    onSearchChange: setInternalSearch,
    sort,
    onSortChange: setSort,
    sortOrder,
    onSortOrderChange: setSortOrder,
    dateFilter,
    onDateFilterChange: setDateFilter,
    ifFilter,
    onIfFilterChange: onIfFilterChange,
    hasPdbOnly,
    onHasPdbToggle: () => setHasPdbOnly(!hasPdbOnly),
    sourceFilter,
    onSourceFilterChange: () => handleSourceFilterToggle(),
    viewMode,
    onViewModeChange: setViewMode,
    expandAll,
    onExpandAllToggle: () => setExpandAll(!expandAll),
    resultCount: filteredPapers.length,
    dailyPapersCount: papers.filter(p => p.source === '结构生物学文献日报').length,
    advancedFilterOpen,
    onToggleAdvancedFilter: () => setAdvancedFilterOpen(!advancedFilterOpen),
    advancedFilterCount: countActiveFilters(advancedFilters),
    advancedFilterBadges,
    filteredPapers,
    showCitationNetwork,
    onToggleCitationNetwork: () => setShowCitationNetwork(!showCitationNetwork),
    showCharts,
    onToggleCharts,
    showJournalMap,
    onToggleJournalMap: () => setShowJournalMap(!showJournalMap),
  };

  return (
    <>
      {/* Toolbar Row 1 — search, sort, view mode, export (above stat cards) */}
      <div className="px-4 py-2 flex-shrink-0 border-b border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220]">
        <LiteratureToolbarMain {...toolbarProps} />
      </div>

      {/* Active filter info */}
      <div className="px-4 flex items-center gap-2 flex-wrap flex-shrink-0">
        {selectedDate && (
          <span className="text-xs text-claude-text-muted">
            Filtered by:{' '}
            <button onClick={onClearDateFilter} className="text-claude-accent dark:text-claude-accent-hover hover:underline">
              {selectedDate}
            </button>
            <button onClick={onClearDateFilter} className="ml-1 text-claude-text-muted hover:text-claude-text" aria-label="Clear date filter"><X className="h-3 w-3" aria-hidden="true" /></button>
          </span>
        )}
        {readingListFilter && onClearReadingListFilter && (
          <span className="text-xs text-claude-text-muted">
            List filter:{' '}
            <button onClick={onClearReadingListFilter} className="text-claude-accent dark:text-claude-accent-hover hover:underline">
              Reading list
            </button>
            <button onClick={onClearReadingListFilter} className="ml-1 text-claude-text-muted hover:text-claude-text" aria-label="Clear reading list filter"><X className="h-3 w-3" aria-hidden="true" /></button>
          </span>
        )}
        {tagFilter && onTagFilterChange && (
          <span className="text-xs text-claude-text-muted">
            Tag filter:{' '}
            <button onClick={() => onTagFilterChange(null)} className="text-claude-accent dark:text-claude-accent-hover hover:underline">
              {tagFilter}
            </button>
            <button onClick={() => onTagFilterChange(null)} className="ml-1 text-claude-text-muted hover:text-claude-text" aria-label="Clear tag filter"><X className="h-3 w-3" aria-hidden="true" /></button>
          </span>
        )}
        {sourceFilter === 'daily' && (
          <span className="text-xs text-claude-accent dark:text-claude-accent-hover">
            <BookOpen className="h-3 w-3 inline" /> 日报 ({filteredPapers.length}){' '}
            <button onClick={() => handleSourceFilterClear()} className="hover:underline" aria-label="Clear daily filter"><X className="h-3 w-3 inline" aria-hidden="true" /></button>
          </span>
        )}
        <div className="flex-1" />
        {activeFiltersCount > 0 && (
          <button
            onClick={onClearAllFilters}
            className="text-[10px] font-medium text-claude-accent dark:text-claude-accent-hover hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Stat cards — now rendered by LiteratureView (literature-view.tsx) to avoid duplication */}

      {/* Reading Progress Dashboard — below stat cards, above separator */}
      {readingProgressHook && (
        <LiteratureReadingProgress
          papers={papers}
          progressMap={readingProgressHook.progressMap}
          totalPapersCount={totalPapersCount}
        />
      )}

      {/* Method × Reading Status Heatmap — shows reading progress breakdown by method */}
      {readingProgressHook && papers.length > 0 && (
        <div className="px-4 pt-2">
          <MethodReadingHeatmap
            papers={papers}
            progressMap={readingProgressHook.progressMap}
          />
        </div>
      )}

      {/* Colored separator — same logic as Weekly & Evaluation: after overview, before action bar */}
      <div
        className="mx-4 mt-2 h-[2px] flex-shrink-0"
        style={{ background: 'linear-gradient(90deg, #c96442, #2d8f8f, #7c5cbf, #c9872e)' }}
      />

      {/* Toolbar Row 2 — Date/IF filter chips, Network, Charts, Compare (after separator) */}
      <div className="px-4 py-2 flex-shrink-0 border-b border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220]">
        <div className="flex items-center gap-1 flex-wrap">
          <LiteratureToolbarChips {...toolbarProps} />
          <span className="text-claude-border dark:text-[#3d3832] mx-1">|</span>
          {/* Compare button */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleOpenCompare}
                disabled={filteredPapers.length < 2}
                className="h-7 px-2.5 text-[11px] text-claude-text-muted hover:text-claude-accent dark:hover:text-claude-accent-hover disabled:opacity-40"
              >
                <GitCompare className="h-3 w-3 mr-1" />
                Compare
              </Button>
            </TooltipTrigger>
            <TooltipContent>Compare top 2-3 papers side by side</TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* Advanced Filter Panel */}
      <div className="px-4 flex-shrink-0">
        <LiteratureAdvancedFilter
          papers={papers}
          filters={advancedFilters}
          onFiltersChange={setAdvancedFilters}
          isOpen={advancedFilterOpen}
          onToggle={() => setAdvancedFilterOpen(!advancedFilterOpen)}
        />
      </div>

      {/* Tag filter bar */}
      {paperTagsHook && paperTagsHook.getAllTags().length > 0 && (
        <div className="px-4 flex-shrink-0">
          <TagFilterBar
            allTags={paperTagsHook.getAllTags()}
            activeTag={tagFilter ?? null}
            onTagClick={onTagFilterChange ?? (() => {})}
            paperCountByTag={tagPaperCounts}
          />
        </div>
      )}

      {/* Citation Network — CSS-only animation instead of framer-motion */}
      {showCitationNetwork && (
        <div className="px-4 flex-shrink-0 max-h-[60vh] overflow-y-auto custom-scrollbar lit-section-enter">
          <LiteratureCitationNetwork
            papers={papers}
            onClose={() => setShowCitationNetwork(false)}
            onSelectPaper={(pmid) => {
              const el = document.getElementById(`paper-${pmid}`);
              if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el.classList.add('ring-2', 'ring-claude-accent');
                setTimeout(() => el.classList.remove('ring-2', 'ring-claude-accent'), 1800);
              }
            }}
          />
        </div>
      )}

      {/* Charts section — CSS-only animation instead of framer-motion */}
      {showCharts && stats && (
        <div className="px-4 flex-shrink-0 max-h-[60vh] overflow-y-auto custom-scrollbar lit-section-enter space-y-3">
          <LiteratureStatsChart stats={stats} />
          {papers.length > 0 && <JournalIfHeatmap papers={papers} />}
        </div>
      )}

      {/* Journal Impact Treemap */}
      {showJournalMap && (
        <div className="px-4 flex-shrink-0">
          <LiteratureJournalTreemap
            papers={filteredPapers}
            onJournalClick={(journal: string) => {
              if (journal) {
                setJournalFilter(journal);
                // Add the journal to advanced filters
                setAdvancedFilters(prev => {
                  if (prev.journals.includes(journal)) return prev;
                  return { ...prev, journals: [...prev.journals, journal] };
                });
                // Open the advanced filter panel so user sees it
                setAdvancedFilterOpen(true);
              } else {
                setJournalFilter(null);
              }
            }}
          />
        </div>
      )}

      {/* Paper notes editor overlay — CSS-only animation */}
      {openNotePmid && paperNotes && onOpenNote && (
        <div className="px-4 flex-shrink-0 lit-fade-in-up">
          <PaperNotesEditor
            pmid={openNotePmid}
            noteText={paperNotes.getNote(openNotePmid)}
            noteData={paperNotes.getNoteData(openNotePmid)}
            onNoteChange={paperNotes.setNote}
            onClose={() => onOpenNote(null)}
          />
        </div>
      )}

      {/* Paper list */}
      <div className="flex-1 overflow-y-auto px-4 min-h-0 mt-2 custom-scrollbar">
        <LiteraturePaperList
          papers={filteredPapers}
          viewMode={viewMode}
          expandAll={expandAll}
          expandedIds={expandedIds}
          onToggleExpand={handleToggleExpand}
          onSelectPaper={onSelectPaper}
          sortField={sort}
          sortOrder={sortOrder}
          onSort={handleSort}
          isLoading={isLoading}
          readingLists={undefined}
          isPaperInList={undefined}
          onToggleList={undefined}
          hasNote={paperNotes?.hasNote}
          onOpenNote={onOpenNote || undefined}
          tags={paperTagsHook ? (paper: LitPaper) => paperTagsHook.getTags(paper.pmid) : undefined}
          onTagClick={onTagFilterChange ? handleTagClickOnCard : undefined}
          getReadingProgress={readingProgressHook?.getProgress}
        />
      </div>

      {/* Paper Comparison Dialog */}
      {showCompare && comparePapers.length >= 2 && readingProgressHook && (
        <LiteraturePaperCompare
          papers={comparePapers}
          progressMap={readingProgressHook.progressMap}
          onClose={() => { setShowCompare(false); setComparePapers([]); }}
          onSelectPaper={(paper) => {
            setShowCompare(false);
            setComparePapers([]);
            onSelectPaper(paper);
          }}
        />
      )}
    </>
  );
}

// ─── LiteratureView (standalone) ────────────────────────────────────────────────
// Convenience wrapper for standalone use (e.g., full-page literature view).
// Manages its own data fetching, sidebar, detail panel.

export function LiteratureView() {
  // Data state
  const [stats, setStats] = useState<LitStats | null>(null);
  const [papers, setPapers] = useState<LitPaper[]>([]);
  const [reports, setReports] = useState<LitReport[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // UI state
  const [selectedPaper, setSelectedPaper] = useState<LitPaper | null>(null);
  const [isDetailOpen, setIsDetailOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showCharts, setShowCharts] = useState(false);
  const [showSidebar, setShowSidebar] = useState(true);

  // Reading lists
  const readingListState = useReadingLists();
  const [readingListFilter, setReadingListFilter] = useState<string | null>(null);

  // Paper notes
  const paperNotesState = usePaperNotes();
  const [openNotePmid, setOpenNotePmid] = useState<string | null>(null);

  // Paper tags
  const paperTagsState = usePaperTags();
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<'all' | 'daily'>('all');

  // Reading progress
  const readingProgressState = useReadingProgress();

  // Fetch stats
  useEffect(() => {
    fetch('/api/literature/stats')
      .then(res => res.json())
      .then(data => setStats(data))
      .catch(err => console.error('Failed to fetch lit stats:', err));
  }, []);

  // Fetch papers
  useEffect(() => {
    const params = new URLSearchParams();
    fetch(`/api/literature/papers?${params.toString()}`)
      .then(res => res.json())
      .then(data => {
        setPapers(Array.isArray(data) ? data : []);
        setIsLoading(false);
      })
      .catch(() => setIsLoading(false));
  }, []);

  // Fetch reports
  useEffect(() => {
    fetch('/api/literature/reports')
      .then(res => res.json())
      .then(data => setReports(Array.isArray(data) ? data : []))
      .catch(err => console.error('Failed to fetch reports:', err));
  }, []);

  // Handle date selection from sidebar
  const handleSelectDate = useCallback(async (date: string) => {
    setSelectedDate(date);
    setIsLoading(true);
    try {
      const res = await fetch(`/api/literature/report/${date}`);
      const data = await res.json();
      if (data.papers) setPapers(data.papers);
    } catch (err) {
      console.error('Failed to fetch report by date:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  const handleClearDateFilter = useCallback(() => {
    setSelectedDate(null);
    setIsLoading(true);
    fetch('/api/literature/papers')
      .then(res => res.json())
      .then(data => { setPapers(Array.isArray(data) ? data : []); setIsLoading(false); })
      .catch(() => setIsLoading(false));
  }, []);

  const handleSelectPaper = useCallback((paper: LitPaper) => {
    setSelectedPaper(paper);
    setIsDetailOpen(true);
  }, []);

  const clearAllFilters = useCallback(() => {
    if (selectedDate) handleClearDateFilter();
    setReadingListFilter(null);
    setTagFilter(null);
    setSourceFilter('all');
  }, [selectedDate, handleClearDateFilter]);

  const hasActiveFilters = selectedDate !== null || readingListFilter !== null || tagFilter !== null;

  // Filter papers by reading list + daily source filter
  const filteredPapers = useMemo(() => {
    let result = readingListFilter
      ? (() => {
          const list = readingListState.lists.find(l => l.id === readingListFilter);
          return list ? papers.filter(p => list.paperPmids.includes(p.pmid)) : papers;
        })()
      : papers;
    if (sourceFilter === 'daily') {
      result = result.filter(p => p.source === '结构生物学文献日报');
    }
    return result;
  }, [papers, readingListFilter, sourceFilter, readingListState.lists]);

  return (
    <div className="flex h-full min-h-screen bg-claude-bg">
      {/* Sidebar — CSS-only animation instead of framer-motion */}
      {showSidebar && (
        <aside className="hidden lg:block flex-shrink-0 w-[220px] lit-sidebar-enter">
          <LiteratureDateSidebar
            allPapers={papers}
            filteredPapers={filteredPapers}
            onClearFilter={sourceFilter !== 'all' ? () => setSourceFilter('all') : undefined}
            selectedDate={selectedDate}
            onSelectDate={handleSelectDate}
            isLoading={isLoading && reports.length === 0}
          />
        </aside>
      )}

      {/* Main content */}
      <main className="flex-1 min-w-0 overflow-y-auto flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-claude-border dark:border-[#3d3832]">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowSidebar(!showSidebar)}
              className="hidden lg:flex p-1.5 rounded-lg hover:bg-claude-border-light dark:hover:bg-[#2b2926] text-claude-text-muted hover:text-claude-text transition-colors"
              title={showSidebar ? 'Hide sidebar' : 'Show sidebar'}
            >
              <BookOpen className="h-4 w-4" />
            </button>
            <h1 className="text-lg font-bold text-claude-text header-title">
              Literature Tracker
            </h1>
          </div>
        </div>

        {/* Content */}
        <LiteratureContent
          stats={stats}
          papers={filteredPapers}
          reports={reports}
          isLoading={isLoading}
          showCharts={showCharts}
          onToggleCharts={() => setShowCharts(!showCharts)}
          selectedDate={selectedDate}
          onClearDateFilter={handleClearDateFilter}
          onSelectPaper={handleSelectPaper}
          hasActiveFilters={hasActiveFilters}
          onClearAllFilters={clearAllFilters}
          readingListFilter={readingListFilter}
          onClearReadingListFilter={() => setReadingListFilter(null)}
          paperNotes={paperNotesState}
          openNotePmid={openNotePmid}
          onOpenNote={setOpenNotePmid}
          paperTagsHook={paperTagsState}
          tagFilter={tagFilter}
          onTagFilterChange={setTagFilter}
          readingProgressHook={readingProgressState}
          totalPapersCount={papers.length}
        />
      </main>

      {/* Detail panel */}
      <LiteratureDetailPanel
        paper={selectedPaper}
        isOpen={isDetailOpen}
        onClose={() => setIsDetailOpen(false)}
        paperTags={selectedPaper ? paperTagsState.getTags(selectedPaper.pmid) : []}
        onAddTag={paperTagsState.addTag}
        onRemoveTag={paperTagsState.removeTag}
        allPapers={papers}
        onSelectPaper={handleSelectPaper}
        readingProgress={selectedPaper ? readingProgressState.getProgress(selectedPaper.pmid) : 0}
        onProgressChange={readingProgressState.setProgress}
        onMarkComplete={readingProgressState.markComplete}
      />
    </div>
  );
}
