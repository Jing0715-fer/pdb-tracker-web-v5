'use client';

import React, { useEffect, useMemo } from 'react';
import { X, ExternalLink, Star, BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PdbEntry } from '@/lib/pdb-types';
import { computeQualityScore } from '@/lib/pdb-utils';
import {
  getMethodColor,
  getMethodLabel,
  getResolutionColor,
  getIfTierStyle,
  formatDate,
  parseLigands,
} from '@/components/pdb-helpers';
import { StructureRadarCompare } from '@/components/structure-radar-compare';
import { useI18n } from '@/lib/i18n';

// ─── Props ────────────────────────────────────────────────────────────────────

interface WeeklyStructureCompareProps {
  entries: PdbEntry[];
  onClose: () => void;
}

// ─── Comparison Row Type ──────────────────────────────────────────────────────

interface CompareRow {
  label: string;
  key: string;
  getValues: (entries: PdbEntry[]) => (string | number | null)[];
  getBest: (values: (string | number | null)[]) => number; // index of best
  formatCell?: (value: string | number | null, entry: PdbEntry) => React.ReactNode;
}

// ─── Helper: best resolution (lowest), best IF (highest), best quality (highest) ──

function bestIndex(values: (string | number | null)[], mode: 'max' | 'min' = 'max'): number {
  let bestIdx = -1;
  let bestVal: number | null = null;
  values.forEach((v, i) => {
    if (v == null) return;
    const num = typeof v === 'number' ? v : parseFloat(String(v));
    if (isNaN(num)) return;
    if (bestVal == null || (mode === 'max' && num > bestVal) || (mode === 'min' && num < bestVal)) {
      bestVal = num;
      bestIdx = i;
    }
  });
  return bestIdx;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function WeeklyStructureCompare({
  entries,
  onClose,
}: WeeklyStructureCompareProps) {
  const { locale } = useI18n();
  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Comparison rows definition
  const compareRows: CompareRow[] = useMemo(() => [
    {
      label: locale === 'zh' ? '方法' : 'Method',
      key: 'method',
      getValues: (es) => es.map(e => e.method),
      getBest: (vals) => {
        const order: Record<string, number> = { 'CRYO-EM': 3, 'X-RAY': 2, 'NMR': 1 };
        let bestIdx = -1;
        let bestRank = -1;
        vals.forEach((v, i) => {
          if (!v) return;
          const m = String(v).toUpperCase();
          const rank = m.includes('CRYO') ? 3 : m.includes('X-RAY') ? 2 : m.includes('NMR') ? 1 : 0;
          if (rank > bestRank) { bestRank = rank; bestIdx = i; }
        });
        return bestIdx;
      },
      formatCell: (value, entry) => {
        const label = getMethodLabel(String(value || ''));
        const colors = getMethodColor(String(value || ''));
        const badgeClass =
          label === 'Cryo-EM' ? 'method-badge-cryoem' :
          label === 'X-ray' ? 'method-badge-xray' :
          label === 'NMR' ? 'method-badge-nmr' :
          'method-badge-other';
        return (
          <span className={`method-badge ${badgeClass} inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border ${colors.bg} ${colors.text} ${colors.border}`}>
            {label}
          </span>
        );
      },
    },
    {
      label: locale === 'zh' ? '分辨率' : 'Resolution',
      key: 'resolution',
      getValues: (es) => es.map(e => e.resolution),
      getBest: (vals) => bestIndex(vals, 'min'),
      formatCell: (value) => {
        if (value == null) return <span className="text-claude-text-muted text-[11px]">—</span>;
        const colorClass = getResolutionColor(value as number);
        return (
          <div className="flex items-center gap-1.5">
            <span
              className={`inline-block h-2 w-2 rounded-full flex-shrink-0 ${
                (value as number) <= 2.0 ? 'bg-emerald-500' :
                (value as number) <= 3.5 ? 'bg-amber-500' :
                'bg-red-500'
              }`}
              title={
                (value as number) <= 2.0 ? (locale === 'zh' ? '高分辨率' : 'High resolution') :
                (value as number) <= 3.5 ? (locale === 'zh' ? '中分辨率' : 'Medium resolution') :
                (locale === 'zh' ? '低分辨率' : 'Low resolution')
              }
            />
            <span className={`font-mono text-[11px] font-semibold ${colorClass}`}>
              {(value as number).toFixed(2)}Å
            </span>
          </div>
        );
      },
    },
    {
      label: locale === 'zh' ? 'IF' : 'IF',
      key: 'journalIf',
      getValues: (es) => es.map(e => e.journalIf),
      getBest: (vals) => bestIndex(vals, 'max'),
      formatCell: (value, entry) => {
        if (value == null) return <span className="text-claude-text-muted text-[11px]">—</span>;
        const style = getIfTierStyle(entry.ifTier);
        return (
          <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold ${style.bg} ${style.text}`}>
            {(value as number).toFixed(1)}
          </span>
        );
      },
    },
    {
      label: locale === 'zh' ? '物种' : 'Organism',
      key: 'organisms',
      getValues: (es) => es.map(e => e.organisms),
      getBest: () => -1,
      formatCell: (value) => (
        <span className="text-[11px] text-claude-text-secondary line-clamp-2" title={String(value || '')}>
          {value ? String(value).split('|')[0]?.trim() || value : '—'}
        </span>
      ),
    },
    {
      label: locale === 'zh' ? '配体' : 'Ligands',
      key: 'ligands',
      getValues: (es) => es.map(e => e.ligands),
      getBest: () => -1,
      formatCell: (value) => {
        const ligands = parseLigands(String(value || ''));
        if (ligands.length === 0) return <span className="text-claude-text-muted text-[11px]">—</span>;
        return (
          <div className="flex flex-wrap gap-0.5">
            {ligands.slice(0, 4).map((lig, i) => (
              <span key={i} className="ligand-chip text-[9px]">{lig}</span>
            ))}
            {ligands.length > 4 && (
              <span className="text-[9px] text-claude-text-muted self-center">+{ligands.length - 4}</span>
            )}
          </div>
        );
      },
    },
    {
      label: locale === 'zh' ? '期刊' : 'Journal',
      key: 'journal',
      getValues: (es) => es.map(e => e.journal),
      getBest: () => -1,
      formatCell: (value) => (
        <span className="text-[11px] text-claude-text-secondary line-clamp-1" title={String(value || '')}>
          {value || '—'}
        </span>
      ),
    },
    {
      label: locale === 'zh' ? '日期' : 'Date',
      key: 'releaseDate',
      getValues: (es) => es.map(e => e.releaseDate),
      getBest: () => -1,
      formatCell: (value) => (
        <span className="text-[11px] text-claude-text-muted font-mono">
          {formatDate(String(value))}
        </span>
      ),
    },
    {
      label: locale === 'zh' ? '质量评分' : 'Quality Score',
      key: 'qualityScore',
      getValues: (es) => es.map(e => computeQualityScore(e).score),
      getBest: (vals) => bestIndex(vals, 'max'),
      formatCell: (value) => {
        const score = value as number;
        const color =
          score >= 80 ? 'text-emerald-600 dark:text-emerald-400' :
          score >= 60 ? 'text-amber-600 dark:text-amber-400' :
          score >= 40 ? 'text-orange-600 dark:text-orange-400' :
          'text-red-500 dark:text-red-400';
        return (
          <div className="flex items-center gap-1.5">
            <div className="h-1.5 w-12 bg-claude-border-light dark:bg-[#2b2926] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${score}%`,
                  backgroundColor: score >= 80 ? '#2d8f8f' : score >= 60 ? '#c9872e' : '#e55a4f',
                }}
              />
            </div>
            <span className={`font-mono text-[11px] font-bold ${color}`}>{score}</span>
          </div>
        );
      },
    },
  ], []);

  // Compute values for each row
  const rowData = useMemo(() => {
    return compareRows.map(row => {
      const values = row.getValues(entries);
      const bestIdx = row.getBest(values);
      return { ...row, values, bestIdx };
    });
  }, [compareRows, entries]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm compare-overlay-in"
      onClick={onClose}
    >
      <div
        className="w-[90vw] max-w-[1100px] max-h-[85vh] flex flex-col rounded-2xl shadow-xl border border-claude-border/60 dark:border-[#3d3832]/60 bg-white dark:bg-[#242220] overflow-hidden compare-modal-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-claude-border dark:border-[#3d3832] bg-gradient-to-r from-[#faf7f4] to-[#f5f0ea] dark:from-[#242220] dark:to-[#2b2926]">
          <div className="flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-claude-accent" />
            <span className="text-sm font-bold text-claude-text">{locale === 'zh' ? '结构比较' : 'Structure Comparison'}</span>
            <span className="text-[10px] font-medium text-claude-text-muted bg-claude-border-light dark:bg-[#2b2926] px-1.5 py-0.5 rounded">
              {entries.length} structures
            </span>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-7 w-7 p-0 text-claude-text-muted hover:text-claude-text"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-auto custom-scrollbar">
          {/* Radar Chart Section */}
          <div className="compare-radar-in border-b border-claude-border-light dark:border-[#2b2926] px-5 py-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[11px] font-semibold text-claude-text-muted uppercase tracking-wider">{locale === 'zh' ? '指标比较' : 'Metric Comparison'}</span>
              <span className="text-[9px] text-claude-text-muted bg-claude-border-light dark:bg-[#2b2926] px-1.5 py-0.5 rounded">
                0–100 normalized scale
              </span>
            </div>
            <StructureRadarCompare entries={entries} />
          </div>

          {/* Comparison Table */}
          <div className="p-5">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-[11px] font-semibold text-claude-text-muted uppercase tracking-wider">{locale === 'zh' ? '详细比较' : 'Detailed Comparison'}</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-claude-border dark:border-[#4a4540]">
                    <th className="px-3 py-2 text-left text-[11px] font-semibold text-claude-text-muted w-[100px]">
                      Property
                    </th>
                    {entries.map((entry) => (
                      <th key={entry.pdbId} className="px-3 py-2 text-center">
                        <a
                          href={`https://www.rcsb.org/structure/${entry.pdbId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-mono text-[12px] font-bold text-claude-accent hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {entry.pdbId}
                          <ExternalLink className="h-2.5 w-2.5 ext-arrow" />
                        </a>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rowData.map((row, rowIdx) => (
                    <tr
                      key={row.key}
                      className={`border-b border-claude-border-light dark:border-[#2b2926] ${
                        rowIdx % 2 === 0 ? 'bg-claude-border-light/20 dark:bg-[#1a1917]/20' : ''
                      }`}
                    >
                      <td className="px-3 py-2.5 text-[11px] font-medium text-claude-text-muted">
                        {row.label}
                      </td>
                      {entries.map((entry, colIdx) => {
                        const isBest = row.bestIdx === colIdx;
                        return (
                          <td
                            key={`${row.key}-${entry.pdbId}`}
                            className={`px-3 py-2.5 text-center ${
                              isBest ? 'bg-[#2d8f8f]/8 dark:bg-[#2d8f8f]/12 rounded' : ''
                            }`}
                          >
                            <div className="flex items-center justify-center gap-1">
                              {isBest && (
                                <Star className="h-3 w-3 text-[#2d8f8f] fill-[#2d8f8f] flex-shrink-0" />
                              )}
                              {row.formatCell
                                ? row.formatCell(row.values[colIdx], entry)
                                : (row.values[colIdx] != null ? String(row.values[colIdx]) : '—')
                              }
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Footer hint */}
        <div className="px-5 py-2.5 border-t border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] flex items-center justify-between">
          <span className="text-[10px] text-claude-text-muted">
            ★ = best value in row &middot; Resolution: lower is better &middot; IF &amp; Quality: higher is better
          </span>
          <Button
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="h-7 px-3 text-[11px] text-claude-text-secondary"
          >
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
