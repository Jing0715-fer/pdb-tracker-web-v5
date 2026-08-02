'use client';

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { X, Columns2, ExternalLink, BookOpen, FileDown } from 'lucide-react';
import type { LitPaper } from '@/lib/pdb-types';
import { useI18n } from '@/lib/i18n';
import { exportComparisonReport } from '@/lib/export-report';

/**
 * PaperMultiCompare
 *
 * A side-by-side comparison panel for 2-4 literature papers.
 * Shows key metrics in a comparison table format with best values highlighted.
 *
 * Metrics:
 *   - PMID, Title, Journal, Authors
 *   - Impact Factor (best = highest)
 *   - Publication Date
 *   - PDB Count (best = most)
 *   - Method (if PDBs available)
 */

interface PaperMultiCompareProps {
  papers: LitPaper[];
  onClose: () => void;
}

export function PaperMultiCompare({ papers, onClose }: PaperMultiCompareProps) {
  const { locale } = useI18n();

  const bestIF = useMemo(() => {
    const ifs = papers.filter(p => p.IF != null && p.IF > 0).map(p => p.IF!);
    return ifs.length > 0 ? Math.max(...ifs) : 0;
  }, [papers]);

  const bestPdbCount = useMemo(() => {
    const counts = papers.map(p => p.pdbs?.length ?? 0);
    return counts.length > 0 ? Math.max(...counts) : 0;
  }, [papers]);

  if (!papers.length) return null;

  const metrics = [
    {
      label: locale === 'zh' ? 'PMID' : 'PMID',
      getValue: (p: LitPaper) => p.pmid,
    },
    {
      label: locale === 'zh' ? '期刊' : 'Journal',
      getValue: (p: LitPaper) => p.journal || '—',
    },
    {
      label: locale === 'zh' ? '影响因子' : 'Impact Factor',
      getValue: (p: LitPaper) => p.IF != null && p.IF > 0 ? p.IF.toFixed(1) : '—',
      isBest: (p: LitPaper) => p.IF === bestIF && p.IF != null && p.IF > 0,
      bestLabel: locale === 'zh' ? '最高' : 'Highest',
    },
    {
      label: locale === 'zh' ? '发布日期' : 'Publication Date',
      getValue: (p: LitPaper) => p.pubdate || '—',
    },
    {
      label: locale === 'zh' ? 'PDB 数量' : 'PDB Count',
      getValue: (p: LitPaper) => String(p.pdbs?.length ?? 0),
      isBest: (p: LitPaper) => (p.pdbs?.length ?? 0) === bestPdbCount && bestPdbCount > 0,
      bestLabel: locale === 'zh' ? '最多' : 'Most',
    },
    {
      label: locale === 'zh' ? '作者' : 'Authors',
      getValue: (p: LitPaper) => p.authors || '—',
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95 }}
        animate={{ scale: 1 }}
        exit={{ scale: 0.95 }}
        className="bg-claude-surface dark:bg-[#242220] rounded-xl shadow-2xl border border-claude-border dark:border-[#3d3832] max-w-5xl w-full max-h-[85vh] overflow-hidden flex flex-col"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-claude-border dark:border-[#3d3832]">
          <div className="flex items-center gap-2">
            <Columns2 className="h-4 w-4 text-claude-accent" />
            <h3 className="text-sm font-bold text-claude-text">
              {locale === 'zh' ? '多论文对比' : 'Multi-Paper Comparison'}
            </h3>
            <span className="text-[10px] text-claude-text-muted">
              {papers.length} {locale === 'zh' ? '篇论文' : 'papers'}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-claude-text-muted hover:text-claude-text hover:bg-claude-border-light dark:hover:bg-[#2b2926] transition-all"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Comparison Table */}
        <div className="flex-1 overflow-auto custom-scrollbar p-4">
          <div className="overflow-x-auto">
            <table data-compare-table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="text-left text-[10px] font-semibold text-claude-text-muted uppercase tracking-wider px-2 py-2 sticky left-0 bg-claude-surface dark:bg-[#242220] z-10">
                    {locale === 'zh' ? '指标' : 'Metric'}
                  </th>
                  {papers.map(p => (
                    <th key={p.pmid} className="px-3 py-2 min-w-[120px]">
                      <a
                        href={`https://pubmed.ncbi.nlm.nih.gov/${p.pmid}/`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs font-mono font-bold text-claude-accent hover:underline"
                      >
                        <BookOpen className="h-2.5 w-2.5" />
                        {p.pmid}
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {metrics.map((metric, i) => (
                  <tr key={i} className={i % 2 === 0 ? 'bg-claude-border-light/30 dark:bg-[#1a1917]/30' : ''}>
                    <td className="text-[10px] font-medium text-claude-text-muted uppercase tracking-wide px-2 py-2 sticky left-0 bg-inherit z-10">
                      {metric.label}
                    </td>
                    {papers.map(p => {
                      const value = metric.getValue(p);
                      const isBest = 'isBest' in metric && metric.isBest(p);
                      return (
                        <td key={p.pmid} className="px-3 py-2 text-xs">
                          <span className={`inline-flex items-center gap-1 ${isBest ? 'text-[#16a34a] font-bold' : 'text-claude-text-secondary'}`}>
                            {value}
                            {isBest && 'bestLabel' in metric && (
                              <span className="text-[8px] px-1 py-0 rounded bg-[#16a34a]/10 text-[#16a34a] font-semibold uppercase">
                                {metric.bestLabel}
                              </span>
                            )}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {/* Title row at bottom */}
                <tr>
                  <td className="text-[10px] font-medium text-claude-text-muted uppercase tracking-wide px-2 py-2 sticky left-0 bg-claude-surface dark:bg-[#242220] z-10">
                    {locale === 'zh' ? '标题' : 'Title'}
                  </td>
                  {papers.map(p => (
                    <td key={p.pmid} className="px-3 py-2 text-[10px] text-claude-text-secondary max-w-[200px]">
                      <span className="line-clamp-2">{p.title || '—'}</span>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-claude-border dark:border-[#3d3832] flex items-center justify-between">
          <span className="text-[10px] text-claude-text-muted">
            {locale === 'zh' ? '绿色高亮 = 最佳值' : 'Green highlight = best value'}
          </span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                const tableEl = document.querySelector('[data-compare-table]') as HTMLElement;
                if (tableEl) {
                  exportComparisonReport('Multi-Paper Comparison', tableEl.outerHTML);
                }
              }}
              className="inline-flex items-center gap-1 text-[10px] text-claude-text-muted hover:text-claude-accent transition-colors"
            >
              <FileDown className="h-3 w-3" />
              {locale === 'zh' ? '导出报告' : 'Export Report'}
            </button>
            <button
              onClick={onClose}
              className="text-[10px] text-claude-text-muted hover:text-claude-text transition-colors"
            >
              {locale === 'zh' ? '关闭' : 'Close'}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
