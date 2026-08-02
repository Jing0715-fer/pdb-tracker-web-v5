'use client';

import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useTheme } from 'next-themes';
import { Star, ArrowUpDown } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Evaluation, EvalBatch, EvalBatchSubTarget } from '@/lib/pdb-types';
import { truncateOrganism } from '@/components/pdb-helpers';

// ─── Score Parsing ────────────────────────────────────────────────────────────

interface ScoreEntry {
  score: number;
  max?: number;
  description?: string;
}

function parseScores(scoresStr: string | null): Record<string, ScoreEntry> {
  if (!scoresStr) return {};
  try {
    const parsed = JSON.parse(scoresStr);
    const result: Record<string, ScoreEntry> = {};
    for (const [key, val] of Object.entries(parsed)) {
      if (typeof val === 'object' && val !== null && 'score' in (val as Record<string, unknown>)) {
        result[key] = val as ScoreEntry;
      } else if (typeof val === 'number') {
        result[key] = { score: val };
      }
    }
    return result;
  } catch {
    return {};
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface MatrixRow {
  uniprotId: string;
  proteinName: string;
  organism: string;
  coverage: number;        // 0-100
  ligandBinding: number;   // 0-1
  diseaseRelevance: number; // 0-1
  publicationImpact: number; // 0-1
  pdbCount: number;
  blastCount: number;
}

type SortField = 'proteinName' | 'coverage' | 'ligandBinding' | 'diseaseRelevance' | 'publicationImpact' | 'pdbCount' | 'blastCount';
type SortDir = 'asc' | 'desc';

// ─── Heat Map Color ───────────────────────────────────────────────────────────

function getHeatColor(value: number, max: number, isDark: boolean): string {
  const ratio = max > 0 ? Math.min(value / max, 1) : 0;

  // Red → Yellow → Green
  let r: number, g: number, b: number;
  if (ratio < 0.5) {
    // Red to Yellow
    const t = ratio * 2;
    r = 220;
    g = Math.round(60 + t * 160);
    b = 40;
  } else {
    // Yellow to Green
    const t = (ratio - 0.5) * 2;
    r = Math.round(220 - t * 180);
    g = Math.round(220 - t * 30);
    b = Math.round(40 + t * 20);
  }

  if (isDark) {
    r = Math.round(r * 0.7);
    g = Math.round(g * 0.7);
    b = Math.round(b * 0.7);
  }

  return `rgba(${r}, ${g}, ${b}, 0.35)`;
}

function getHeatTextColor(value: number, max: number): string {
  const ratio = max > 0 ? Math.min(value / max, 1) : 0;
  if (ratio >= 0.7) return '#16a34a';
  if (ratio >= 0.4) return '#c9872e';
  return '#dc2626';
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface EvalBatchCompareProps {
  evaluations: Evaluation[];
  batches?: EvalBatch[];
  batchSubTargets?: Record<string, EvalBatchSubTarget[]>;
  selectedBatchId?: string | null;
}

// ─── Column Definitions ───────────────────────────────────────────────────────

const COLUMNS: { key: SortField; label: string; format: (v: number) => string; maxVal: number }[] = [
  { key: 'coverage', label: 'Coverage', format: (v) => `${v.toFixed(0)}%`, maxVal: 100 },
  { key: 'ligandBinding', label: 'Ligand Binding', format: (v) => v.toFixed(2), maxVal: 1 },
  { key: 'diseaseRelevance', label: 'Disease Rel.', format: (v) => v.toFixed(2), maxVal: 1 },
  { key: 'publicationImpact', label: 'Pub. Impact', format: (v) => v.toFixed(2), maxVal: 1 },
  { key: 'pdbCount', label: 'PDB Count', format: (v) => v.toString(), maxVal: 20 },
  { key: 'blastCount', label: 'BLAST Count', format: (v) => v.toString(), maxVal: 20 },
];

// ─── Main Component ───────────────────────────────────────────────────────────

export function EvalBatchCompare({
  evaluations,
  batches = [],
  batchSubTargets = {},
  selectedBatchId = null,
}: EvalBatchCompareProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const [sortField, setSortField] = useState<SortField>('coverage');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  // ─── Build matrix rows ─────────────────────────────────────────────────────

  const rows: MatrixRow[] = useMemo(() => {
    // Filter by selected batch if provided
    let filtered = evaluations;
    if (selectedBatchId && batchSubTargets[selectedBatchId]) {
      const subTargetIds = new Set(
        batchSubTargets[selectedBatchId].map((st) => st.uniprotId)
      );
      filtered = evaluations.filter((e) => subTargetIds.has(e.uniprotId));
    }

    return filtered.map((ev) => {
      const scores = parseScores(ev.scores);
      return {
        uniprotId: ev.uniprotId,
        proteinName: ev.proteinName || ev.entryName || ev.uniprotId,
        organism: ev.organism || '',
        coverage: ev.coverage ?? 0,
        ligandBinding: scores['ligand_binding']?.score ?? 0,
        diseaseRelevance: scores['disease_relevance']?.score ?? 0,
        publicationImpact: scores['publication_impact']?.score ?? 0,
        pdbCount: ev.pdbStructures?.length ?? 0,
        blastCount: ev.blastResults?.length ?? 0,
      };
    });
  }, [evaluations, selectedBatchId, batchSubTargets]);

  // ─── Sort rows ─────────────────────────────────────────────────────────────

  const sortedRows = useMemo(() => {
    const sorted = [...rows].sort((a, b) => {
      const aVal = a[sortField];
      const bVal = b[sortField];
      const cmp = typeof aVal === 'string'
        ? String(aVal).localeCompare(String(bVal))
        : (aVal as number) - (bVal as number);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [rows, sortField, sortDir]);

  // ─── Find best in each category ────────────────────────────────────────────

  const bestValues: Record<string, number> = useMemo(() => {
    const best: Record<string, number> = {};
    COLUMNS.forEach((col) => {
      const values = rows.map((r) => r[col.key] as number);
      best[col.key] = Math.max(...values);
    });
    return best;
  }, [rows]);

  // ─── Compute averages ──────────────────────────────────────────────────────

  const averages = useMemo(() => {
    if (rows.length === 0) return null;
    const avg: Record<string, number> = {};
    COLUMNS.forEach((col) => {
      const values = rows.map((r) => r[col.key] as number);
      avg[col.key] = values.reduce((a, b) => a + b, 0) / values.length;
    });
    return avg;
  }, [rows]);

  // ─── Sort handler ──────────────────────────────────────────────────────────

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  // ─── Batch selector ────────────────────────────────────────────────────────

  const [activeBatchId, setActiveBatchId] = useState<string | null>(selectedBatchId);

  if (rows.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center justify-center h-full min-h-[300px] px-4"
      >
        <Star className="h-12 w-12 text-claude-text-muted mb-3" />
        <h3 className="text-base font-semibold text-claude-text mb-1">No Evaluations</h3>
        <p className="text-sm text-claude-text-secondary text-center">
          Evaluations are needed for batch comparison.
        </p>
      </motion.div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] flex-shrink-0">
        <div className="flex items-center gap-2 mb-2">
          <Star className="h-4 w-4 text-claude-accent" />
          <h2 className="text-sm font-bold text-claude-text">Batch Comparison Matrix</h2>
          <span className="text-[10px] text-claude-text-muted font-medium ml-auto">
            {rows.length} evaluations
          </span>
        </div>

        {/* Batch selector */}
        {batches.length > 1 && (
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-claude-text-muted font-medium">Batch:</span>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setActiveBatchId(null)}
                className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                  !activeBatchId
                    ? 'bg-claude-accent/10 text-claude-accent border border-claude-accent/30'
                    : 'text-claude-text-muted hover:text-claude-text-secondary hover:bg-claude-border-light dark:hover:bg-[#2b2926]'
                }`}
              >
                All
              </button>
              {batches.map((batch) => (
                <button
                  key={batch.batchId}
                  onClick={() => setActiveBatchId(batch.batchId)}
                  className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
                    activeBatchId === batch.batchId
                      ? 'bg-claude-accent/10 text-claude-accent border border-claude-accent/30'
                      : 'text-claude-text-muted hover:text-claude-text-secondary hover:bg-claude-border-light dark:hover:bg-[#2b2926]'
                  }`}
                >
                  {batch.title || batch.batchId}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Matrix table */}
      <div className="flex-1 overflow-auto custom-scrollbar p-4">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr>
              <th className="text-left px-2 py-2 text-[10px] font-semibold text-claude-text-muted uppercase tracking-wider bg-claude-surface dark:bg-[#242220] sticky top-0 z-10 border-b border-claude-border dark:border-[#3d3832]">
                Protein
              </th>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  className="text-center px-2 py-2 text-[10px] font-semibold text-claude-text-muted uppercase tracking-wider bg-claude-surface dark:bg-[#242220] sticky top-0 z-10 border-b border-claude-border dark:border-[#3d3832] cursor-pointer hover:text-claude-text transition-colors"
                  onClick={() => handleSort(col.key)}
                >
                  <div className="flex items-center justify-center gap-1">
                    <span>{col.label}</span>
                    {sortField === col.key && (
                      <ArrowUpDown className="h-2.5 w-2.5 text-claude-accent" />
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row, rowIdx) => (
              <motion.tr
                key={row.uniprotId}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.2, delay: rowIdx * 0.03 }}
                className="border-b border-claude-border/30 dark:border-[#3d3832]/30 hover:bg-claude-border-light/30 dark:hover:bg-[#2b2926]/30 transition-colors"
              >
                {/* Protein name cell */}
                <td className="px-2 py-2.5">
                  <div className="min-w-[100px]">
                    <div className="text-[11px] font-medium text-claude-text truncate max-w-[140px]">
                      {row.proteinName}
                    </div>
                    <div className="text-[9px] text-claude-text-muted font-mono">
                      {row.uniprotId}
                    </div>
                    <div className="text-[8px] text-claude-text-muted truncate max-w-[140px]">
                      {truncateOrganism(row.organism, 25)}
                    </div>
                  </div>
                </td>

                {/* Data cells */}
                {COLUMNS.map((col, colIdx) => {
                  const value = row[col.key] as number;
                  const isBest = value === bestValues[col.key] && value > 0;
                  const heatBg = getHeatColor(value, col.maxVal, isDark);
                  const heatText = getHeatTextColor(value, col.maxVal);

                  return (
                    <motion.td
                      key={col.key}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{
                        duration: 0.2,
                        delay: rowIdx * 0.03 + colIdx * 0.02,
                      }}
                      className="text-center px-2 py-2.5"
                      style={{ backgroundColor: heatBg }}
                    >
                      <div className="flex flex-col items-center">
                        <div className="flex items-center gap-0.5">
                          {isBest && (
                            <Star className="h-2.5 w-2.5 text-amber-500 fill-amber-500 flex-shrink-0" />
                          )}
                          <span
                            className="text-[10px] font-mono font-semibold"
                            style={{ color: heatText }}
                          >
                            {col.format(value)}
                          </span>
                        </div>
                      </div>
                    </motion.td>
                  );
                })}
              </motion.tr>
            ))}

            {/* Summary averages row */}
            {averages && (
              <motion.tr
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3 }}
                className="border-t-2 border-claude-border dark:border-[#3d3832] bg-claude-surface/50 dark:bg-[#242220]/50 font-medium"
              >
                <td className="px-2 py-2.5">
                  <div className="text-[10px] font-semibold text-claude-text-muted uppercase tracking-wider">
                    Batch Average
                  </div>
                  <div className="text-[9px] text-claude-text-muted">
                    {rows.length} evaluations
                  </div>
                </td>
                {COLUMNS.map((col) => {
                  const avgVal = averages[col.key];
                  const heatBg = getHeatColor(avgVal, col.maxVal, isDark);
                  const heatText = getHeatTextColor(avgVal, col.maxVal);

                  return (
                    <td
                      key={`avg-${col.key}`}
                      className="text-center px-2 py-2.5"
                      style={{ backgroundColor: heatBg }}
                    >
                      <span
                        className="text-[10px] font-mono font-bold"
                        style={{ color: heatText }}
                      >
                        {col.format(avgVal)}
                      </span>
                    </td>
                  );
                })}
              </motion.tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
