'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Columns2, ArrowRight, ExternalLink, FileDown } from 'lucide-react';
import type { PdbEntry } from '@/lib/pdb-types';
import { getMethodColor, getMethodLabel } from '@/components/pdb-helpers';
import { useI18n } from '@/lib/i18n';
import { exportComparisonReport } from '@/lib/export-report';

/**
 * MultiStructureCompare
 *
 * A side-by-side comparison panel for 2-4 selected PDB structures.
 * Shows key metrics in a comparison table format with best values highlighted.
 *
 * Features:
 *   - Side-by-side metric comparison (resolution, IF, method, organism, etc.)
 *   - Best value highlighting (green for best resolution, red for highest IF)
 *   - Links to RCSB for each structure
 *   - Compact, scrollable layout
 */

interface MultiStructureCompareProps {
  entries: PdbEntry[];
  onClose: () => void;
}

export function MultiStructureCompare({ entries, onClose }: MultiStructureCompareProps) {
  const { locale } = useI18n();
  if (!entries.length) return null;

  // Find best values for highlighting
  const bestResolution = Math.min(...entries.filter(e => e.resolution != null).map(e => e.resolution!));
  const bestIF = Math.max(...entries.filter(e => e.journalIf != null && e.journalIf > 0).map(e => e.journalIf!));

  const metrics = [
    {
      label: locale === 'zh' ? 'PDB ID' : 'PDB ID',
      key: 'pdbId',
      getValue: (e: PdbEntry) => e.pdbId,
      getBest: () => -1, // no best for ID
    },
    {
      label: locale === 'zh' ? '方法' : 'Method',
      key: 'method',
      getValue: (e: PdbEntry) => getMethodLabel(e.method || ''),
      getBest: () => -1,
    },
    {
      label: locale === 'zh' ? '分辨率' : 'Resolution',
      key: 'resolution',
      getValue: (e: PdbEntry) => e.resolution != null ? `${e.resolution.toFixed(2)}Å` : '—',
      isBest: (e: PdbEntry) => e.resolution === bestResolution && e.resolution != null,
      bestLabel: locale === 'zh' ? '最佳' : 'Best',
    },
    {
      label: locale === 'zh' ? '影响因子' : 'Impact Factor',
      key: 'journalIf',
      getValue: (e: PdbEntry) => e.journalIf != null && e.journalIf > 0 ? e.journalIf.toFixed(1) : '—',
      isBest: (e: PdbEntry) => e.journalIf === bestIF && e.journalIf != null && e.journalIf > 0,
      bestLabel: locale === 'zh' ? '最高' : 'Highest',
    },
    {
      label: locale === 'zh' ? '期刊' : 'Journal',
      key: 'journal',
      getValue: (e: PdbEntry) => e.journal || '—',
      getBest: () => -1,
    },
    {
      label: locale === 'zh' ? '物种' : 'Organism',
      key: 'organisms',
      getValue: (e: PdbEntry) => e.organisms || '—',
      getBest: () => -1,
    },
    {
      label: locale === 'zh' ? '配体' : 'Ligands',
      key: 'ligands',
      getValue: (e: PdbEntry) => e.ligands || '—',
      getBest: () => -1,
    },
    {
      label: locale === 'zh' ? '发布日期' : 'Release Date',
      key: 'releaseDate',
      getValue: (e: PdbEntry) => e.releaseDate || '—',
      getBest: () => -1,
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
              {locale === 'zh' ? '多结构对比' : 'Multi-Structure Comparison'}
            </h3>
            <span className="text-[10px] text-claude-text-muted">
              {entries.length} {locale === 'zh' ? '个结构' : 'structures'}
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
              {/* Header row with PDB IDs */}
              <thead>
                <tr>
                  <th className="text-left text-[10px] font-semibold text-claude-text-muted uppercase tracking-wider px-2 py-2 sticky left-0 bg-claude-surface dark:bg-[#242220] z-10">
                    {locale === 'zh' ? '指标' : 'Metric'}
                  </th>
                  {entries.map(e => (
                    <th key={e.pdbId} className="px-3 py-2 min-w-[120px]">
                      <a
                        href={`https://www.rcsb.org/structure/${e.pdbId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs font-mono font-bold text-claude-accent hover:underline"
                      >
                        {e.pdbId}
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    </th>
                  ))}
                </tr>
              </thead>
              {/* Data rows */}
              <tbody>
                {metrics.map((metric, i) => (
                  <tr key={metric.key} className={i % 2 === 0 ? 'bg-claude-border-light/30 dark:bg-[#1a1917]/30' : ''}>
                    <td className="text-[10px] font-medium text-claude-text-muted uppercase tracking-wide px-2 py-2 sticky left-0 bg-inherit z-10">
                      {metric.label}
                    </td>
                    {entries.map(e => {
                      const value = metric.getValue(e);
                      const isBest = 'isBest' in metric && metric.isBest(e);
                      return (
                        <td key={e.pdbId} className="px-3 py-2 text-xs">
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
                  {entries.map(e => (
                    <td key={e.pdbId} className="px-3 py-2 text-[10px] text-claude-text-secondary max-w-[200px]">
                      <span className="line-clamp-2">{e.title || '—'}</span>
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
                  exportComparisonReport('Multi-Structure Comparison', tableEl.outerHTML);
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
