'use client';

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { X, Columns2, ExternalLink, FlaskConical } from 'lucide-react';
import type { Evaluation } from '@/lib/pdb-types';
import { useI18n } from '@/lib/i18n';

/**
 * EvalMultiCompare
 *
 * A side-by-side comparison panel for 2-4 evaluation targets.
 * Shows key metrics in a comparison table format with best values highlighted.
 *
 * Metrics:
 *   - UniProt ID, Protein Name, Gene Names, Organism
 *   - Coverage (best = highest)
 *   - PDB Structures count (best = most)
 *   - BLAST Homologs count (best = most)
 *   - Has Report
 *   - Completion status
 */

interface EvalMultiCompareProps {
  evaluations: Evaluation[];
  onClose: () => void;
}

export function EvalMultiCompare({ evaluations, onClose }: EvalMultiCompareProps) {
  const { locale } = useI18n();

  const bestCoverage = useMemo(() => {
    const withCov = evaluations.filter(e => e.coverage != null);
    return withCov.length > 0 ? Math.max(...withCov.map(e => e.coverage!)) : 0;
  }, [evaluations]);

  const bestPdbCount = useMemo(() => {
    const counts = evaluations.map(e => e.pdbStructures?.length ?? 0);
    return counts.length > 0 ? Math.max(...counts) : 0;
  }, [evaluations]);

  const bestBlastCount = useMemo(() => {
    const counts = evaluations.map(e => e.blastResults?.length ?? 0);
    return counts.length > 0 ? Math.max(...counts) : 0;
  }, [evaluations]);

  if (!evaluations.length) return null;

  const metrics = [
    {
      label: locale === 'zh' ? 'UniProt ID' : 'UniProt ID',
      getValue: (e: Evaluation) => e.uniprotId,
    },
    {
      label: locale === 'zh' ? '蛋白名称' : 'Protein Name',
      getValue: (e: Evaluation) => e.proteinName || '—',
    },
    {
      label: locale === 'zh' ? '基因名' : 'Gene Names',
      getValue: (e: Evaluation) => e.geneNames || '—',
    },
    {
      label: locale === 'zh' ? '物种' : 'Organism',
      getValue: (e: Evaluation) => e.organism || '—',
    },
    {
      label: locale === 'zh' ? '覆盖率' : 'Coverage',
      getValue: (e: Evaluation) => e.coverage != null ? `${e.coverage.toFixed(0)}%` : '—',
      isBest: (e: Evaluation) => e.coverage === bestCoverage && e.coverage != null,
      bestLabel: locale === 'zh' ? '最高' : 'Highest',
    },
    {
      label: locale === 'zh' ? 'PDB 结构' : 'PDB Structures',
      getValue: (e: Evaluation) => String(e.pdbStructures?.length ?? 0),
      isBest: (e: Evaluation) => (e.pdbStructures?.length ?? 0) === bestPdbCount && bestPdbCount > 0,
      bestLabel: locale === 'zh' ? '最多' : 'Most',
    },
    {
      label: locale === 'zh' ? 'BLAST 同源' : 'BLAST Homologs',
      getValue: (e: Evaluation) => String(e.blastResults?.length ?? 0),
      isBest: (e: Evaluation) => (e.blastResults?.length ?? 0) === bestBlastCount && bestBlastCount > 0,
      bestLabel: locale === 'zh' ? '最多' : 'Most',
    },
    {
      label: locale === 'zh' ? '序列长度' : 'Sequence Length',
      getValue: (e: Evaluation) => e.sequenceLength ? String(e.sequenceLength) : '—',
    },
    {
      label: locale === 'zh' ? '有报告' : 'Has Report',
      getValue: (e: Evaluation) => e.report ? '✓' : '—',
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
              {locale === 'zh' ? '多靶点对比' : 'Multi-Target Comparison'}
            </h3>
            <span className="text-[10px] text-claude-text-muted">
              {evaluations.length} {locale === 'zh' ? '个靶点' : 'targets'}
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
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="text-left text-[10px] font-semibold text-claude-text-muted uppercase tracking-wider px-2 py-2 sticky left-0 bg-claude-surface dark:bg-[#242220] z-10">
                    {locale === 'zh' ? '指标' : 'Metric'}
                  </th>
                  {evaluations.map(e => (
                    <th key={e.uniprotId} className="px-3 py-2 min-w-[120px]">
                      <a
                        href={`https://www.uniprot.org/uniprotkb/${e.uniprotId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-xs font-mono font-bold text-claude-accent hover:underline"
                      >
                        <FlaskConical className="h-2.5 w-2.5" />
                        {e.uniprotId}
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
                    {evaluations.map(e => {
                      const value = metric.getValue(e);
                      const isBest = 'isBest' in metric && metric.isBest(e);
                      return (
                        <td key={e.uniprotId} className="px-3 py-2 text-xs">
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
              </tbody>
            </table>
          </div>
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-claude-border dark:border-[#3d3832] flex items-center justify-between">
          <span className="text-[10px] text-claude-text-muted">
            {locale === 'zh' ? '绿色高亮 = 最佳值' : 'Green highlight = best value'}
          </span>
          <button
            onClick={onClose}
            className="text-[10px] text-claude-text-muted hover:text-claude-text transition-colors"
          >
            {locale === 'zh' ? '关闭' : 'Close'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
