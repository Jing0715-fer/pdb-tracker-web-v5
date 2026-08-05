'use client';

import React, { useCallback, useMemo } from 'react';
import dynamic from 'next/dynamic';
import { BookOpen } from 'lucide-react';
import { LiteratureStatsCards } from '@/components/literature-stats-cards';
import type { LitPaper, LitStats, LitReport } from '@/lib/pdb-types';
import type { LiteratureViewProps } from './types';

// Lazy-load LiteratureContent (heavy component with many sub-components)
const LiteratureContent = dynamic(() => import('@/components/literature/LiteratureView').then(m => ({ default: m.LiteratureContent })), {
  ssr: false,
  loading: () => (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="flex flex-col items-center gap-2 text-claude-text-muted">
        <BookOpen className="h-6 w-6 animate-pulse" />
        <span className="text-xs">Loading Literature...</span>
      </div>
    </div>
  ),
});

export function LiteratureView({
  stats,
  papers,
  reports,
  isLoading,
  showCharts,
  selectedDate,
  externalSearch,
  readingListFilter,
  paperNotesHook,
  openNotePmid,
  paperTagsHook,
  tagFilter,
  sourceFilter,
  onSourceFilterChange,
  ifFilter,
  onIfFilterChange,
  readingProgressHook,
  readingListHook,
  totalPapersCount,
  onToggleCharts,
  onClearDateFilter,
  onSelectPaper,
  hasActiveFilters,
  onClearAllFilters,
  onClearReadingListFilter,
  onOpenNote,
  onTagFilterChange,
}: LiteratureViewProps) {
  // Filter papers by reading list and source filter
  const filteredLitPapers = useMemo(() => {
    let result = readingListFilter
      ? (() => {
          const list = readingListHook?.lists.find((l: any) => l.id === readingListFilter);
          return list ? papers.filter(p => list.paperPmids.includes(p.pmid)) : papers;
        })()
      : papers;

    if (sourceFilter === 'daily') {
      result = result.filter(p => p.source === '结构生物学文献日报');
    }
    return result;
  }, [papers, readingListFilter, sourceFilter, readingListHook]);

  return (
    <>
      {papers.length > 0 && (
        <LiteratureStatsCards papers={papers} stats={stats} />
      )}
      <LiteratureContent
        stats={stats}
        papers={filteredLitPapers}
      reports={reports}
      isLoading={isLoading}
      showCharts={showCharts}
      onToggleCharts={onToggleCharts}
      selectedDate={selectedDate}
      onClearDateFilter={onClearDateFilter}
      onSelectPaper={onSelectPaper}
      hasActiveFilters={hasActiveFilters}
      onClearAllFilters={onClearAllFilters}
      externalSearch={externalSearch}
      readingListFilter={readingListFilter}
      onClearReadingListFilter={onClearReadingListFilter}
      sourceFilter={sourceFilter}
      onSourceFilterChange={onSourceFilterChange}
      paperNotes={paperNotesHook}
      openNotePmid={openNotePmid}
      onOpenNote={onOpenNote}
      paperTagsHook={paperTagsHook}
      tagFilter={tagFilter}
      ifFilter={ifFilter}
      onIfFilterChange={onIfFilterChange}
      onTagFilterChange={onTagFilterChange}
      readingProgressHook={readingProgressHook}
      totalPapersCount={totalPapersCount}
    />
    </>
  );
}