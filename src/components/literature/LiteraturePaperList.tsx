'use client';

import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ExternalLink, Link2 } from 'lucide-react';
import type { LitPaper } from '@/lib/pdb-types';
import { LiteraturePaperCard } from './LiteraturePaperCard';
import { LiteratureEmptyState } from './LiteratureEmptyState';
import type { ViewMode } from './LiteratureToolbar';
import type { ReadingList } from './LiteratureReadingList';
import { getMethodColor, getMethodLabel } from '@/components/pdb-helpers';

interface LiteraturePaperListProps {
  papers: LitPaper[];
  viewMode: ViewMode;
  expandAll: boolean;
  expandedIds: Set<string>;
  onToggleExpand: (pmid: string) => void;
  onSelectPaper: (paper: LitPaper) => void;
  sortField: string;
  sortOrder: 'asc' | 'desc';
  onSort: (field: string) => void;
  isLoading: boolean;
  // Reading list props
  readingLists?: ReadingList[];
  isPaperInList?: (listId: string, pmid: string) => boolean;
  onToggleList?: (listId: string, pmid: string) => void;
  // Notes props
  hasNote?: (pmid: string) => boolean;
  onOpenNote?: (pmid: string) => void;
  // Tags props
  tags?: ((paper: LitPaper) => string[]) | undefined;
  onTagClick?: ((tag: string) => void) | undefined;
  // Reading progress
  getReadingProgress?: (pmid: string) => number;
}

// Table columns for table view
const TABLE_COLUMNS = [
  { field: 'pmid', label: 'PMID', width: 'w-[80px]' },
  { field: 'title', label: 'Title', width: 'min-w-[240px]' },
  { field: 'journal', label: 'Journal', width: 'w-[140px]' },
  { field: 'IF', label: 'IF', width: 'w-[60px]' },
  { field: 'pubdate', label: 'Date', width: 'w-[80px]' },
  { field: 'pdbs', label: 'PDBs', width: 'w-[160px]' },
  { field: 'actions', label: '', width: 'w-[60px]' },
];

export function LiteraturePaperList({
  papers,
  viewMode,
  expandAll,
  expandedIds,
  onToggleExpand,
  onSelectPaper,
  sortField,
  sortOrder,
  onSort,
  isLoading,
  readingLists,
  isPaperInList,
  onToggleList,
  hasNote,
  onOpenNote,
  tags,
  onTagClick,
  getReadingProgress,
}: LiteraturePaperListProps) {
  if (isLoading) {
    return <PaperListSkeleton viewMode={viewMode} />;
  }

  if (papers.length === 0) {
    return <LiteratureEmptyState />;
  }

  if (viewMode === 'cards') {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4 [grid-auto-rows:1fr]">
        <AnimatePresence mode="popLayout">
          {papers.map((paper, index) => (
            <LiteraturePaperCard
              key={paper.pmid}
              paper={paper}
              index={index}
              isExpanded={expandAll || expandedIds.has(paper.pmid)}
              onSelect={onSelectPaper}
              onToggleExpand={() => onToggleExpand(paper.pmid)}
              readingLists={readingLists}
              isPaperInList={isPaperInList}
              onToggleList={onToggleList}
              hasNote={hasNote?.(paper.pmid)}
              onOpenNotes={onOpenNote}
              tags={tags?.(paper)}
              onTagClick={onTagClick}
              readingProgress={getReadingProgress?.(paper.pmid) ?? 0}
            />
          ))}
        </AnimatePresence>
      </div>
    );
  }

  if (viewMode === 'list') {
    return (
      <div className="space-y-1">
        {papers.map((paper, index) => (
          <motion.div
            key={paper.pmid}
            id={`paper-${paper.pmid}`}
            data-pmid={paper.pmid}
            initial={{ opacity: 0, x: -8 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.2, delay: Math.min(index * 0.02, 0.4) }}
            onClick={() => onSelectPaper(paper)}
            className="flex items-center gap-3 px-3 py-2 border-b border-claude-border-light/60 dark:border-[#2b2926]/60 hover:border-claude-border dark:hover:border-[#3d3832] hover:bg-claude-border-light/50 dark:hover:bg-[#2b2926]/50 cursor-pointer transition-all duration-150 group last:border-b-0"
          >
            <span className="text-[10px] font-mono text-claude-text-muted w-[70px] flex-shrink-0">{paper.pmid}</span>
            <span className="text-xs text-claude-text font-medium truncate flex-1 min-w-0 group-hover:text-claude-accent dark:group-hover:text-claude-accent-hover transition-colors">
              {paper.title || 'Untitled'}
            </span>
            <span className="text-[10px] text-claude-text-secondary truncate max-w-[120px] flex-shrink-0 hidden sm:block">{paper.journal}</span>
            {paper.IF != null && (
              <span className={`text-[10px] font-bold flex-shrink-0 ${
                paper.IF >= 20 ? 'text-red-600 dark:text-red-400' :
                paper.IF >= 10 ? 'text-orange-600 dark:text-orange-400' :
                paper.IF >= 5 ? 'text-emerald-600 dark:text-emerald-400' :
                'text-claude-text-muted'
              }`}>
                {paper.IF.toFixed(1)}
              </span>
            )}
            <span className="text-[10px] text-claude-text-muted w-[60px] flex-shrink-0 hidden md:block">{paper.pubdate}</span>
            {paper.pdbs.length > 0 && (
              <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-400 flex-shrink-0">
                {paper.pdbs.length} PDB
              </span>
            )}
          </motion.div>
        ))}
      </div>
    );
  }

  // Table view
  return (
    <div className="rounded-xl border border-claude-border dark:border-[#3d3832] overflow-hidden">
      <div className="overflow-x-auto overflow-y-auto custom-scrollbar max-h-[calc(100vh-280px)]">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-claude-border dark:border-[#3d3832] bg-gradient-to-r from-[#faf7f4] to-[#f5f0ea] dark:from-[#242220] dark:to-[#2b2926]">
              {TABLE_COLUMNS.map(col => (
                <th
                  key={col.field}
                  className={`px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-claude-text-muted table-header-cell ${col.width} ${
                    col.field !== 'actions' && col.field !== 'pdbs' ? 'cursor-pointer hover:text-claude-accent dark:hover:text-claude-accent-hover' : ''
                  } ${sortField === col.field ? 'sort-active' : ''}`}
                  onClick={() => col.field !== 'actions' && col.field !== 'pdbs' && onSort(col.field)}
                >
                  {col.label}
                  {sortField === col.field && (
                    <span className="ml-0.5">{sortOrder === 'asc' ? '↑' : '↓'}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {papers.map((paper, index) => (
              <tr
                key={paper.pmid}
                id={`paper-${paper.pmid}`}
                data-pmid={paper.pmid}
                onClick={() => onSelectPaper(paper)}
                className={`border-b border-claude-border-light dark:border-[#2b2926] cursor-pointer table-row-hover transition-colors ${
                  index % 2 === 0 ? 'table-row-even' : 'table-row-odd'
                }`}
              >
                <td className="px-3 py-2 font-mono text-claude-text-secondary">{paper.pmid}</td>
                <td className="px-3 py-2 text-claude-text font-medium max-w-[300px]">
                  <div className="truncate" title={paper.title || ''}>{paper.title || 'Untitled'}</div>
                </td>
                <td className="px-3 py-2 text-claude-text-secondary truncate max-w-[140px]">{paper.journal}</td>
                <td className="px-3 py-2">
                  {paper.IF != null ? (
                    <span className={`font-bold ${
                      paper.IF >= 20 ? 'text-red-600 dark:text-red-400' :
                      paper.IF >= 10 ? 'text-orange-600 dark:text-orange-400' :
                      paper.IF >= 5 ? 'text-emerald-600 dark:text-emerald-400' :
                      'text-claude-text-muted'
                    }`}>
                      {paper.IF.toFixed(1)}
                    </span>
                  ) : (
                    <span className="text-claude-text-muted">—</span>
                  )}
                </td>
                <td className="px-3 py-2 text-claude-text-muted">{paper.pubdate}</td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1 flex-wrap">
                    {paper.pdbs.slice(0, 3).map(pdb => {
                      const mc = getMethodColor(pdb.method || '');
                      const ml = getMethodLabel(pdb.method || '');
                      const methodKey = ml.toLowerCase().replace('-', '') as 'cryoem' | 'xray' | 'nmr' | 'other';
                      return (
                        <span key={pdb.pdbId} className={`inline-flex items-center justify-center min-w-[62px] px-1.5 py-0.5 rounded text-[9px] font-medium border ${mc.bg} ${mc.text} ${mc.border} method-badge method-badge-${methodKey}`}>
                          {pdb.pdbId}
                        </span>
                      );
                    })}
                    {paper.pdbs.length > 3 && (
                      <span className="text-[9px] text-claude-text-muted">+{paper.pdbs.length - 3}</span>
                    )}
                  </div>
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-1">
                    <a
                      href={`https://pubmed.ncbi.nlm.nih.gov/${paper.pmid}/`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="p-1 rounded hover:bg-claude-border-light dark:hover:bg-[#2b2926] text-claude-text-muted hover:text-claude-accent dark:hover:text-claude-accent-hover transition-colors"
                      title="Open in PubMed"
                    >
                      <ExternalLink className="h-3 w-3" />
                    </a>
                    {paper.doi && (
                      <a
                        href={`https://doi.org/${paper.doi}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="p-1 rounded hover:bg-claude-border-light dark:hover:bg-[#2b2926] text-claude-text-muted hover:text-claude-accent dark:hover:text-claude-accent-hover transition-colors"
                        title="Open DOI"
                      >
                        <Link2 className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Loading skeleton
function PaperListSkeleton({ viewMode }: { viewMode: ViewMode }) {
  if (viewMode === 'cards') {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4 [grid-auto-rows:1fr]">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] p-4 space-y-3 h-full">
            <div className="flex items-center gap-2">
              <div className="h-5 w-20 rounded shimmer-skeleton" />
              <div className="h-5 w-12 rounded shimmer-skeleton" />
            </div>
            <div className="h-4 w-full rounded shimmer-skeleton" />
            <div className="h-4 w-3/4 rounded shimmer-skeleton" />
            <div className="h-3 w-1/2 rounded shimmer-skeleton" />
            <div className="h-12 w-full rounded shimmer-skeleton" />
          </div>
        ))}
      </div>
    );
  }

  if (viewMode === 'list') {
    return (
      <div className="space-y-1">
        {Array.from({ length: 10 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-3 py-2">
            <div className="h-3 w-16 rounded shimmer-skeleton" />
            <div className="h-3 flex-1 rounded shimmer-skeleton" />
            <div className="h-3 w-12 rounded shimmer-skeleton" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-claude-border dark:border-[#3d3832] overflow-hidden">
      <div className="overflow-x-auto overflow-y-auto custom-scrollbar max-h-[calc(100vh-280px)]">
        <table className="w-full">
          <thead>
            <tr className="border-b border-claude-border dark:border-[#3d3832] bg-gradient-to-r from-[#faf7f4] to-[#f5f0ea] dark:from-[#242220] dark:to-[#2b2926]">
              {TABLE_COLUMNS.map(col => (
                <th key={col.field} className={`px-3 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-claude-text-muted ${col.width}`}>
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 8 }).map((_, i) => (
              <tr key={i} className="border-b border-claude-border-light dark:border-[#2b2926]">
                {TABLE_COLUMNS.map((_, j) => (
                  <td key={j} className="px-3 py-2.5">
                    <div className="h-3 w-16 rounded shimmer-skeleton" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
