'use client';

import React, { useMemo, useCallback } from 'react';
import { X, GitCompare, BookOpen, Users, Calendar, Tag, Box, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import type { LitPaper } from '@/lib/pdb-types';
import { getMethodLabel } from '@/components/pdb-helpers';
import type { ReadingProgressMap } from '@/hooks/use-reading-progress';
import { useI18n } from '@/lib/i18n';

interface LiteraturePaperCompareProps {
  papers: LitPaper[];
  progressMap: ReadingProgressMap;
  onClose: () => void;
  onSelectPaper?: (paper: LitPaper) => void;
}

interface ComparisonField {
  label: string;
  icon: React.ReactNode;
  getValues: (papers: LitPaper[]) => (string | number | null)[];
  highlight?: (values: (string | number | null)[]) => boolean[];
}

const COMPARISON_FIELDS: ComparisonField[] = [
  {
    label: 'Title',
    icon: <BookOpen className="h-3 w-3" />,
    getValues: (papers) => papers.map((p) => p.title || 'Untitled'),
    highlight: () => [true, true, true], // titles always differ
  },
  {
    label: 'Journal',
    icon: <BookOpen className="h-3 w-3" />,
    getValues: (papers) => papers.map((p) => p.journal || '—'),
    highlight: (values) => {
      const allSame = values.every((v) => v === values[0]);
      return values.map(() => !allSame);
    },
  },
  {
    label: 'IF',
    icon: <Calendar className="h-3 w-3" />,
    getValues: (papers) => papers.map((p) => p.IF),
    highlight: (values) => {
      const nonNull = values.filter((v) => v != null) as number[];
      if (nonNull.length < 2) return values.map(() => false);
      const max = Math.max(...nonNull);
      const min = Math.min(...nonNull);
      return values.map((v) => v != null && max !== min);
    },
  },
  {
    label: 'Year',
    icon: <Calendar className="h-3 w-3" />,
    getValues: (papers) => papers.map((p) => p.pubdate ? p.pubdate.match(/\d{4}/)?.[0] || '—' : '—'),
    highlight: (values) => {
      const allSame = values.every((v) => v === values[0]);
      return values.map(() => !allSame);
    },
  },
  {
    label: 'Method',
    icon: <Tag className="h-3 w-3" />,
    getValues: (papers) =>
      papers.map((p) =>
        p.pdbs.length > 0 ? [...new Set(p.pdbs.map((pdb) => getMethodLabel(pdb.method || '')))].join(', ') || '—' : '—'
      ),
    highlight: (values) => {
      const allSame = values.every((v) => v === values[0]);
      return values.map(() => !allSame);
    },
  },
  {
    label: 'Authors',
    icon: <Users className="h-3 w-3" />,
    getValues: (papers) => papers.map((p) => p.authors || '—'),
    highlight: () => [true, true, true],
  },
  {
    label: 'PDB Structures',
    icon: <Box className="h-3 w-3" />,
    getValues: (papers) => papers.map((p) => p.pdbs.length),
    highlight: (values) => {
      const allSame = values.every((v) => v === values[0]);
      return values.map(() => !allSame);
    },
  },
  {
    label: 'Tags',
    icon: <Tag className="h-3 w-3" />,
    getValues: (papers) => papers.map((p) => (p.tags && p.tags.length > 0 ? p.tags.join(', ') : '—')),
    highlight: (values) => {
      const allSame = values.every((v) => v === values[0]);
      return values.map(() => !allSame);
    },
  },
  {
    label: 'Reading Status',
    icon: <BookOpen className="h-3 w-3" />,
    getValues: () => ['—'], // Will be overridden
    highlight: (values) => {
      const allSame = values.every((v) => v === values[0]);
      return values.map(() => !allSame);
    },
  },
];

export function LiteraturePaperCompare({
  papers,
  progressMap,
  onClose,
  onSelectPaper,
}: LiteraturePaperCompareProps) {
  const { t, locale } = useI18n();
  const readingStatusField: ComparisonField = {
    label: 'Reading Status',
    icon: <BookOpen className="h-3 w-3" />,
    getValues: (ps) =>
      ps.map((p) => {
        const progress = progressMap[p.pmid] ?? 0;
        if (progress >= 100) return 'Read';
        if (progress > 0) return 'Reading';
        return 'Unread';
      }),
    highlight: (values) => {
      const allSame = values.every((v) => v === values[0]);
      return values.map(() => !allSame);
    },
  };

  // Merge the reading status field into the comparison fields
  const allFields = useMemo(() => {
    return COMPARISON_FIELDS.map((f) =>
      f.label === 'Reading Status' ? readingStatusField : f
    );
  }, [progressMap, papers, readingStatusField]);

  const getStatusColor = useCallback((status: string) => {
    if (status === 'Read') return 'text-emerald-600 dark:text-emerald-400';
    if (status === 'Reading') return 'text-amber-600 dark:text-amber-400';
    return 'text-gray-500 dark:text-gray-400';
  }, []);

  const getIfColor = useCallback((ifVal: number | null) => {
    if (ifVal == null) return 'text-claude-text-muted';
    if (ifVal >= 20) return 'text-red-600 dark:text-red-400';
    if (ifVal >= 10) return 'text-orange-600 dark:text-orange-400';
    if (ifVal >= 5) return 'text-emerald-600 dark:text-emerald-400';
    return 'text-claude-text';
  }, []);

  const formatFieldValue = useCallback(
    (field: ComparisonField, value: string | number | null, paper: LitPaper) => {
      if (field.label === 'IF') {
        return value != null ? (
          <span className={`font-bold ${getIfColor(value as number)}`}>
            {(value as number).toFixed(1)}
          </span>
        ) : (
          <span className="text-claude-text-muted">—</span>
        );
      }
      if (field.label === 'PDB Structures') {
        return (
          <span className={value as number > 0 ? 'text-teal-600 dark:text-teal-400 font-bold' : 'text-claude-text-muted'}>
            {value as number}
          </span>
        );
      }
      if (field.label === 'Reading Status') {
        const progress = progressMap[paper.pmid] ?? 0;
        const status = progress >= 100 ? 'Read' : progress > 0 ? 'Reading' : 'Unread';
        return <span className={`font-medium ${getStatusColor(status)}`}>{status}</span>;
      }
      if (field.label === 'Title') {
        return (
          <span className="text-xs leading-snug line-clamp-2">{value as string}</span>
        );
      }
      if (field.label === 'Authors') {
        return (
          <span className="text-[10px] leading-snug line-clamp-2">{value as string}</span>
        );
      }
      return <span>{(value as string) || '—'}</span>;
    },
    [getIfColor, getStatusColor, progressMap]
  );

  if (papers.length < 2) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 lit-detail-backdrop-enter">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/20 dark:bg-black/40 backdrop-blur-sm" onClick={onClose} />

      {/* Dialog */}
      <div className="relative z-10 w-full max-w-4xl max-h-[85vh] bg-claude-surface dark:bg-[#242220] rounded-xl border border-claude-border dark:border-[#3d3832] shadow-2xl lit-compare-enter flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-claude-border/60 dark:border-[#3d3832]/60">
          <div className="flex items-center gap-2">
            <GitCompare className="h-4 w-4 text-claude-accent dark:text-claude-accent-hover" />
            <h3 className="text-sm font-bold text-claude-text">Paper Comparison</h3>
            <span className="text-[10px] text-claude-text-muted">({papers.length} papers)</span>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-claude-border-light dark:hover:bg-[#2b2926] text-claude-text-muted hover:text-claude-text transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t.closeBtn}</TooltipContent>
          </Tooltip>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-claude-border/60 dark:border-[#3d3832]/60">
                <th className="w-28 py-2 px-2 text-[10px] font-semibold text-claude-text-muted uppercase tracking-wider">
                  Field
                </th>
                {papers.map((paper) => (
                  <th key={paper.pmid} className="py-2 px-2 text-[10px] font-semibold text-claude-text-muted uppercase tracking-wider">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-claude-accent dark:text-claude-accent-hover">
                        {paper.pmid}
                      </span>
                      {onSelectPaper && (
                        <button
                          onClick={() => onSelectPaper(paper)}
                          className="p-0.5 rounded hover:bg-claude-border-light dark:hover:bg-[#2b2926] text-claude-text-muted hover:text-claude-accent dark:hover:text-claude-accent-hover transition-colors"
                          title="View details"
                        >
                          <ExternalLink className="h-2.5 w-2.5" />
                        </button>
                      )}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allFields.map((field) => {
                const values = field.getValues(papers);
                const highlights = field.highlight ? field.highlight(values) : values.map(() => false);
                const allSame = values.every((v) => v === values[0]);
                // Don't show "Reading Status" from COMPARISON_FIELDS if it's the placeholder
                if (field.label === 'Reading Status' && field.getValues === COMPARISON_FIELDS[8].getValues) {
                  // Use readingStatusField instead
                  const rsValues = readingStatusField.getValues(papers);
                  const rsHighlights = readingStatusField.highlight ? readingStatusField.highlight(rsValues) : rsValues.map(() => false);
                  return (
                    <tr
                      key={field.label}
                      className="border-b border-claude-border/30 dark:border-[#3d3832]/30 hover:bg-claude-border-light/30 dark:hover:bg-[#2b2926]/30 transition-colors"
                    >
                      <td className="py-2 px-2">
                        <div className="flex items-center gap-1.5">
                          {field.icon}
                          <span className="text-[10px] font-medium text-claude-text-muted">{field.label}</span>
                        </div>
                      </td>
                      {papers.map((paper, i) => (
                        <td
                          key={paper.pmid}
                          className={`py-2 px-2 text-xs ${rsHighlights[i] ? 'lit-compare-diff' : ''}`}
                        >
                          {formatFieldValue(readingStatusField, rsValues[i], paper)}
                        </td>
                      ))}
                    </tr>
                  );
                }
                return (
                  <tr
                    key={field.label}
                    className="border-b border-claude-border/30 dark:border-[#3d3832]/30 hover:bg-claude-border-light/30 dark:hover:bg-[#2b2926]/30 transition-colors"
                  >
                    <td className="py-2 px-2">
                      <div className="flex items-center gap-1.5">
                        {field.icon}
                        <span className="text-[10px] font-medium text-claude-text-muted">{field.label}</span>
                        {!allSame && values.length > 1 && (
                          <span className="inline-block w-1.5 h-1.5 rounded-full bg-orange-400" title="Values differ" />
                        )}
                      </div>
                    </td>
                    {papers.map((paper, i) => (
                      <td
                        key={paper.pmid}
                        className={`py-2 px-2 text-xs ${highlights[i] ? 'lit-compare-diff' : ''}`}
                      >
                        {formatFieldValue(field, values[i], paper)}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-claude-border/60 dark:border-[#3d3832]/60 bg-claude-border-light/30 dark:bg-[#1a1917]/30">
          <span className="text-[10px] text-claude-text-muted">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-orange-400 mr-1" />
            Highlighted cells indicate different values
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            className="h-7 px-3 text-[11px] border-claude-border dark:border-[#3d3832] text-claude-text-secondary hover:bg-claude-border-light dark:hover:bg-[#2b2926]"
          >
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
