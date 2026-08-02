'use client';

import React, { useCallback, useMemo } from 'react';
import { BookOpen } from 'lucide-react';
import { LiteratureContent } from '@/components/literature/LiteratureView';
import type { LitPaper, LitStats, LitReport } from '@/lib/pdb-types';
import type { LiteratureViewProps } from './types';

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