'use client';

import { useI18n } from '@/lib/i18n';
import React from 'react';
import dynamic from 'next/dynamic';
import { Calendar, TrendingUp, Activity, BarChart3, GitCompareArrows } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { StructureStatsCards } from '@/components/structure-stats-cards';
import { WeeklyPdbTable } from '@/components/WeeklyPdbTable';
import type { PdbEntry, WeeklySnapshot } from '@/lib/pdb-types';
import type { WeeklyViewProps } from './types';
import { useColumnVisibility } from '@/hooks/use-column-visibility';
import { ColumnVisibilityDropdown } from '@/components/ColumnVisibilityDropdown';

// Dynamic imports for heavy components (recharts-based)
const WeeklyHeatmapCalendar = dynamic(() => import('@/components/weekly-heatmap-calendar'), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});

const WeeklyTrendAnalysis = dynamic(() => import('@/components/weekly-trend-analysis').then(m => ({ default: m.WeeklyTrendAnalysis })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});

const WeeklyStatsTimeline = dynamic(() => import('@/components/weekly-stats-timeline').then(m => ({ default: m.WeeklyStatsTimeline })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});

const WeeklyQualityDistribution = dynamic(() => import('@/components/weekly-quality-distribution').then(m => ({ default: m.WeeklyQualityDistribution })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});

const WeeklySnapshotCompare = dynamic(() => import('@/components/weekly-snapshot-compare').then(m => ({ default: m.WeeklySnapshotCompare })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});

export function WeeklyView({
  entries,
  snapshots,
  currentSnapshot,
  loading,
  sortField,
  sortDir,
  currentPage,
  pageSize,
  filteredEntries,
  paginatedEntries,
  totalPages,
  bookmarks,
  selectedEntryIds,
  highlightedRowId,
  showHeatmap,
  showTrend,
  showTimeline,
  showQualityDist,
  showWeekCompare,
  weeklyDateFilter,
  selectedSnapshot,
  onSort,
  onRowClick,
  onToggleBookmark,
  onSelectEntries,
  onHighlightRow,
  onSetShowHeatmap,
  onSetShowTrend,
  onSetShowTimeline,
  onSetShowQualityDist,
  onSetShowWeekCompare,
  onSetWeeklyDateFilter,
  onSetCurrentPage,
  onSetPageSize,
}: WeeklyViewProps) {
  const { t, locale } = useI18n();
  const {
    columnVisibility,
    toggleColumn,
    resetToDefault,
    visibleColumns,
  } = useColumnVisibility();

  return (
    <>
      {entries.length > 0 && <StructureStatsCards entries={entries} />}

      {/* Colored separator — same gradient as Evaluation & Literature: after overview, before action bar */}
      <div
        className="mx-4 mt-2 h-[2px] flex-shrink-0"
        style={{ background: 'linear-gradient(90deg, #c96442, #2d8f8f, #7c5cbf, #c9872e)' }}
      />

      {/* Heatmap + Timeline + Trend toggle (filter bar) — white bg same as Evaluation & Literature */}
      <div className="px-4 py-2 flex items-center gap-2 flex-shrink-0 border-b border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220]">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onSetShowHeatmap(!showHeatmap)}
          className={`h-7 px-2.5 text-[11px] filter-chip ${showHeatmap ? 'active' : ''}`}
        >
          <Calendar className="h-3 w-3 mr-1" />
          {showHeatmap ? 'Hide Activity Heatmap' : 'Activity Heatmap'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onSetShowTrend(!showTrend)}
          className={`h-7 px-2.5 text-[11px] filter-chip ${showTrend ? 'active' : ''}`}
        >
          <TrendingUp className="h-3 w-3 mr-1" />
          {showTrend ? (locale === 'zh' ? '隐藏趋势' : 'Hide Trends') : (locale === 'zh' ? '趋势分析' : 'Trend Analysis')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onSetShowTimeline(!showTimeline)}
          className={`h-7 px-2.5 text-[11px] filter-chip ${showTimeline ? 'active' : ''}`}
        >
          <Activity className="h-3 w-3 mr-1" />
          {showTimeline ? (locale === 'zh' ? '隐藏时间线' : 'Hide Timeline') : (locale === 'zh' ? '统计时间线' : 'Stats Timeline')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onSetShowQualityDist(!showQualityDist)}
          className={`h-7 px-2.5 text-[11px] filter-chip ${showQualityDist ? 'active' : ''}`}
        >
          <BarChart3 className="h-3 w-3 mr-1" />
          {showQualityDist ? (locale === 'zh' ? '隐藏质量分布' : 'Hide Quality Dist') : (locale === 'zh' ? '质量分布' : 'Quality Distribution')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onSetShowWeekCompare(!showWeekCompare)}
          className={`h-7 px-2.5 text-[11px] filter-chip ${showWeekCompare ? 'active' : ''}`}
        >
          <GitCompareArrows className="h-3 w-3 mr-1" />
          {showWeekCompare ? 'Hide Comparison' : 'Week Comparison'}
        </Button>
        <ColumnVisibilityDropdown
          columnVisibility={columnVisibility}
          onToggleColumn={toggleColumn}
          onResetToDefault={resetToDefault}
        />

      </div>

      {/* Weekly Stats Timeline */}
      {showTimeline && (
        <div className="weekly-timeline-section animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="p-4 border-b border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220]">
            <div className="flex items-center gap-2 mb-3">
              <Activity className="h-4 w-4 text-claude-accent" />
              <h3 className="text-[12px] font-semibold text-claude-text">Weekly Stats Timeline</h3>
              <span className="text-[9px] text-claude-text-muted bg-claude-border-light dark:bg-[#2b2926] px-1.5 py-0.5 rounded">
                Last {Math.min(snapshots.length, 12)} weeks
              </span>
            </div>
            <WeeklyStatsTimeline snapshots={snapshots} />
          </div>
        </div>
      )}

      {/* Week Comparison */}
      {showWeekCompare && (
        <div className="snapshot-compare-section snapshot-compare-enter p-4 border-b border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220]">
          <WeeklySnapshotCompare
            currentSnapshot={currentSnapshot}
            previousSnapshot={snapshots.length > 1 ? snapshots[snapshots.indexOf(currentSnapshot!) + 1] || null : null}
            allSnapshots={snapshots}
          />
        </div>
      )}

      {/* Quality Distribution */}
      {showQualityDist && (
        <div className="quality-dist-section quality-dist-fade-in">
          <div className="p-4 border-b border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220]">
            <div className="flex items-center gap-2 mb-3">
              <BarChart3 className="h-4 w-4 text-claude-accent" />
              <h3 className="text-[12px] font-semibold text-claude-text">Quality Score Distribution</h3>
              <span className="text-[9px] text-claude-text-muted bg-claude-border-light dark:bg-[#2b2926] px-1.5 py-0.5 rounded">
                {entries.length} structures
              </span>
            </div>
            <WeeklyQualityDistribution entries={entries} />
          </div>
        </div>
      )}

      {/* Trend Analysis */}
      {showTrend && (
        <div className="animate-in fade-in slide-in-from-top-2 duration-300">
          <WeeklyTrendAnalysis snapshots={snapshots} entries={entries} />
        </div>
      )}

      {/* Activity Heatmap Calendar */}
      {showHeatmap && (
        <div className="heatmap-calendar-section heatmap-calendar-enter border-b border-claude-border dark:border-[#3d3832]">
          <WeeklyHeatmapCalendar
            entries={entries}
            onDateSelect={onSetWeeklyDateFilter}
            currentDateFilter={weeklyDateFilter}
          />
        </div>
      )}

      {/* Data Table */}
      <div data-table-container className="flex-1 overflow-auto border-t border-claude-border dark:border-[#3d3832]">
        <WeeklyPdbTable
          entries={paginatedEntries}
          loading={loading}
          sortField={sortField}
          sortDir={sortDir}
          onSort={onSort}
          onRowClick={onRowClick}
          bookmarks={bookmarks}
          onToggleBookmark={onToggleBookmark}
          selectedEntryIds={selectedEntryIds}
          onSelectEntries={onSelectEntries}
          highlightedRowId={highlightedRowId}
          onHighlightRow={onHighlightRow}
          visibleColumns={visibleColumns}
        />
      </div>

      {/* Pagination */}
      <div className="flex-shrink-0">
        <div className="flex items-center justify-between px-3 sm:px-4 py-2 sm:py-3 border-t border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220]">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-claude-text-muted">
              Showing <span className="font-mono font-medium text-claude-text-secondary">{((currentPage - 1) * pageSize) + 1}</span>–<span className="font-mono font-medium text-claude-text-secondary">{Math.min(currentPage * pageSize, filteredEntries.length)}</span> of <span className="font-mono font-medium text-claude-text-secondary">{filteredEntries.length}</span>
            </span>
            <select
              value={pageSize}
              onChange={(e) => { onSetPageSize(Number(e.target.value)); onSetCurrentPage(1); }}
              className="h-6 px-1.5 text-[10px] font-medium rounded border border-claude-border dark:border-[#3d3832] bg-white dark:bg-[#1a1917] text-claude-text-secondary"
            >
              {[10, 25, 50, 100].map(s => <option key={s} value={s}>{s}/page</option>)}
            </select>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" disabled={currentPage <= 1} onClick={() => onSetCurrentPage(p => p - 1)} className="h-7 px-2 text-[11px]">Prev</Button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let page: number;
              if (totalPages <= 5) page = i + 1;
              else if (currentPage <= 3) page = i + 1;
              else if (currentPage >= totalPages - 2) page = totalPages - 4 + i;
              else page = currentPage - 2 + i;
              return (
                <Button key={page} variant={currentPage === page ? 'default' : 'ghost'} size="sm"
                  onClick={() => onSetCurrentPage(page)}
                  className={`h-7 w-7 p-0 text-[11px] ${currentPage === page ? 'bg-claude-accent text-white shadow-sm' : ''}`}
                >{page}</Button>
              );
            })}
            <Button variant="ghost" size="sm" disabled={currentPage >= totalPages} onClick={() => onSetCurrentPage(p => p + 1)} className="h-7 px-2 text-[11px]">Next</Button>
          </div>
        </div>
      </div>
    </>
  );
}
