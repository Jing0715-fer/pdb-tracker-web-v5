'use client';

import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useTheme } from 'next-themes';
import { Grid3X3, ArrowUpDown, ArrowUp, ArrowDown } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ChartExportButton } from '@/components/chart-export-button';
import type { Evaluation, EvalBatch, EvalBatchSubTarget } from '@/lib/pdb-types';

// ─── Score Parsing ──────────────────────────────────────────────────────────────

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

type SortMode = 'overall' | 'name';

interface HeatmapCell {
  uniprotId: string;
  proteinName: string;
  geneName: string;
  dimension: string;
  dimensionLabel: string;
  value: number; // 0-1
  overall: number; // 0-1
}

// ─── Color Scale ──────────────────────────────────────────────────────────────

function getCellColor(value: number, isDark: boolean): string {
  // red (<0.3) → amber (0.3-0.6) → teal (0.6-0.8) → green (>0.8)
  if (value < 0.3) {
    const t = value / 0.3;
    const r = isDark ? Math.round(140 + t * 30) : Math.round(220 - t * 20);
    const g = isDark ? Math.round(30 + t * 30) : Math.round(38 + t * 40);
    const b = isDark ? Math.round(30 + t * 10) : Math.round(38 + t * 10);
    return `rgba(${r}, ${g}, ${b}, ${isDark ? 0.4 : 0.25})`;
  } else if (value < 0.6) {
    const t = (value - 0.3) / 0.3;
    const r = isDark ? Math.round(170 - t * 40) : Math.round(200 - t * 40);
    const g = isDark ? Math.round(60 + t * 50) : Math.round(78 + t * 60);
    const b = isDark ? Math.round(40 + t * 10) : Math.round(48 + t * 10);
    return `rgba(${r}, ${g}, ${b}, ${isDark ? 0.4 : 0.25})`;
  } else if (value < 0.8) {
    const t = (value - 0.6) / 0.2;
    const r = isDark ? Math.round(130 - t * 80) : Math.round(160 - t * 100);
    const g = isDark ? Math.round(110 + t * 30) : Math.round(138 + t * 10);
    const b = isDark ? Math.round(50 + t * 90) : Math.round(58 + t * 80);
    return `rgba(${r}, ${g}, ${b}, ${isDark ? 0.4 : 0.25})`;
  } else {
    const t = Math.min((value - 0.8) / 0.2, 1);
    const r = isDark ? Math.round(50 - t * 20) : Math.round(60 - t * 30);
    const g = isDark ? Math.round(140 + t * 20) : Math.round(148 + t * 12);
    const b = isDark ? Math.round(140 - t * 80) : Math.round(138 - t * 80);
    return `rgba(${r}, ${g}, ${b}, ${isDark ? 0.45 : 0.3})`;
  }
}

function getCellTextColor(value: number): string {
  if (value < 0.3) return '#dc2626';
  if (value < 0.6) return '#c9872e';
  if (value < 0.8) return '#2d8f8f';
  return '#16a34a';
}

function getCellBorderColor(value: number, isDark: boolean): string {
  if (value < 0.3) return isDark ? 'rgba(220, 38, 38, 0.15)' : 'rgba(220, 38, 38, 0.1)';
  if (value < 0.6) return isDark ? 'rgba(201, 135, 46, 0.15)' : 'rgba(201, 135, 46, 0.1)';
  if (value < 0.8) return isDark ? 'rgba(45, 143, 143, 0.2)' : 'rgba(45, 143, 143, 0.15)';
  return isDark ? 'rgba(22, 163, 74, 0.2)' : 'rgba(22, 163, 74, 0.15)';
}

// ─── Dimension Definitions ────────────────────────────────────────────────────

const SCORE_DIMENSIONS = [
  { key: 'structural_coverage', label: 'Structural\nCoverage' },
  { key: 'ligand_binding', label: 'Ligand\nBinding' },
  { key: 'disease_relevance', label: 'Disease\nRelevance' },
  { key: 'publication_impact', label: 'Publication\nImpact' },
  { key: 'overall', label: 'Overall' },
];

// ─── Props ────────────────────────────────────────────────────────────────────

interface EvalHeatmapProps {
  evaluations: Evaluation[];
  batches?: EvalBatch[];
  batchSubTargets?: Record<string, EvalBatchSubTarget[]>;
  selectedBatchId?: string | null;
  batchName?: string | null;
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function EvalHeatmap({
  evaluations,
  batches = [],
  batchSubTargets = {},
  selectedBatchId = null,
  batchName = null,
}: EvalHeatmapProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const [sortMode, setSortMode] = useState<SortMode>('overall');
  const [activeBatchId, setActiveBatchId] = useState<string | null>(selectedBatchId);

  // ─── Build heatmap data ────────────────────────────────────────────────────

  const heatmapProteins = useMemo(() => {
    // Filter by selected batch
    let filtered = evaluations;
    if (activeBatchId && batchSubTargets[activeBatchId]) {
      const subTargetIds = new Set(
        batchSubTargets[activeBatchId].map((st) => st.uniprotId)
      );
      filtered = evaluations.filter((e) => subTargetIds.has(e.uniprotId));
    }

    const proteins = filtered.map((ev) => {
      const scores = parseScores(ev.scores);
      const structuralCoverage = scores['structural_coverage']?.score ?? 0;
      const ligandBinding = scores['ligand_binding']?.score ?? 0;
      const diseaseRelevance = scores['disease_relevance']?.score ?? 0;
      const publicationImpact = scores['publication_impact']?.score ?? 0;
      const overall = (structuralCoverage + ligandBinding + diseaseRelevance + publicationImpact) / 4;

      return {
        uniprotId: ev.uniprotId,
        proteinName: ev.proteinName || ev.entryName || ev.uniprotId,
        geneName: ev.geneNames?.split(',')[0] || '',
        structuralCoverage,
        ligandBinding,
        diseaseRelevance,
        publicationImpact,
        overall,
      };
    });

    // Sort
    if (sortMode === 'overall') {
      proteins.sort((a, b) => b.overall - a.overall);
    } else {
      proteins.sort((a, b) => a.proteinName.localeCompare(b.proteinName));
    }

    return proteins;
  }, [evaluations, activeBatchId, batchSubTargets, sortMode]);

  // ─── Compute column averages ──────────────────────────────────────────────

  const columnAverages = useMemo(() => {
    if (heatmapProteins.length === 0) return null;
    const dims = ['structuralCoverage', 'ligandBinding', 'diseaseRelevance', 'publicationImpact', 'overall'] as const;
    const avgs: Record<string, number> = {};
    for (const dim of dims) {
      const vals = heatmapProteins.map(p => p[dim]);
      avgs[dim] = vals.reduce((a, b) => a + b, 0) / vals.length;
    }
    return avgs;
  }, [heatmapProteins]);

  if (heatmapProteins.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center justify-center h-48 px-4"
      >
        <Grid3X3 className="h-10 w-10 text-claude-text-muted mb-2" />
        <p className="text-sm text-claude-text-secondary">No evaluations available for heatmap</p>
      </motion.div>
    );
  }

  const dimensionKeys = ['structuralCoverage', 'ligandBinding', 'diseaseRelevance', 'publicationImpact', 'overall'] as const;

  return (
    <div className="space-y-3">
      {/* Header with controls */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h4 className="text-[11px] font-semibold text-claude-text uppercase tracking-wider flex items-center gap-1.5">
          <Grid3X3 className="h-3 w-3 text-claude-accent" />
          Score Comparison Heatmap
          {batchName && (
            <span className="font-normal normal-case tracking-normal text-claude-text-muted">
              — {batchName}
            </span>
          )}
        </h4>

        <div className="flex items-center gap-2">
          <ChartExportButton chartName="eval-score-heatmap" />
          {/* Batch selector */}
          {batches.length > 1 && (
            <div className="flex items-center gap-1">
              <button
                onClick={() => setActiveBatchId(null)}
                className={`px-1.5 py-0.5 rounded text-[9px] font-medium transition-colors ${
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
                  className={`px-1.5 py-0.5 rounded text-[9px] font-medium transition-colors max-w-[80px] truncate ${
                    activeBatchId === batch.batchId
                      ? 'bg-claude-accent/10 text-claude-accent border border-claude-accent/30'
                      : 'text-claude-text-muted hover:text-claude-text-secondary hover:bg-claude-border-light dark:hover:bg-[#2b2926]'
                  }`}
                >
                  {batch.title || batch.batchId}
                </button>
              ))}
            </div>
          )}

          {/* Sort controls */}
          <div className="flex items-center gap-1 bg-claude-border-light dark:bg-[#2b2926] rounded-md px-1 py-0.5">
            <button
              onClick={() => setSortMode('overall')}
              className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium transition-colors ${
                sortMode === 'overall'
                  ? 'bg-claude-accent/15 text-claude-accent'
                  : 'text-claude-text-muted hover:text-claude-text-secondary'
              }`}
            >
              <ArrowUpDown className="h-2.5 w-2.5" />
              Score
            </button>
            <button
              onClick={() => setSortMode('name')}
              className={`flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium transition-colors ${
                sortMode === 'name'
                  ? 'bg-claude-accent/15 text-claude-accent'
                  : 'text-claude-text-muted hover:text-claude-text-secondary'
              }`}
            >
              A-Z
            </button>
          </div>
        </div>
      </div>

      {/* Heatmap grid */}
      <div className="chart-container chart-inner-shadow rounded-lg p-3 bg-claude-surface dark:bg-[#242220] border border-claude-border-light dark:border-[#2b2926] overflow-x-auto">
        <table className="w-full border-collapse" style={{ minWidth: 420 }}>
          <thead>
            <tr>
              {/* Empty corner cell */}
              <th className="text-left px-2 py-1.5 text-[9px] font-semibold text-claude-text-muted uppercase tracking-wider bg-claude-surface dark:bg-[#242220] sticky left-0 z-10 w-[130px]">
                Protein
              </th>
              {SCORE_DIMENSIONS.map((dim) => (
                <th
                  key={dim.key}
                  className="text-center px-1 py-1.5 text-[8px] font-semibold text-claude-text-muted uppercase tracking-wider bg-claude-surface dark:bg-[#242220]"
                  style={{ minWidth: dim.key === 'overall' ? 60 : 70 }}
                >
                  <div className="whitespace-pre-line leading-tight">{dim.label}</div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {heatmapProteins.map((protein, rowIdx) => (
              <motion.tr
                key={protein.uniprotId}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.2, delay: rowIdx * 0.03 }}
                className="border-b border-claude-border/20 dark:border-[#3d3832]/20"
              >
                {/* Protein name cell */}
                <td className="px-2 py-1.5 bg-claude-surface dark:bg-[#242220] sticky left-0 z-10">
                  <div className="min-w-[110px]">
                    <div className="text-[10px] font-medium text-claude-text truncate max-w-[120px]">
                      {protein.proteinName}
                    </div>
                    <div className="text-[8px] text-claude-text-muted font-mono">
                      {protein.geneName && `${protein.geneName} · `}{protein.uniprotId}
                    </div>
                  </div>
                </td>

                {/* Score cells */}
                {dimensionKeys.map((dimKey, colIdx) => {
                  const value = protein[dimKey];
                  const bg = getCellColor(value, isDark);
                  const textCol = getCellTextColor(value);
                  const borderCol = getCellBorderColor(value, isDark);
                  const dimLabel = SCORE_DIMENSIONS.find(d => {
                    const keyMap: Record<string, string> = {
                      structuralCoverage: 'structural_coverage',
                      ligandBinding: 'ligand_binding',
                      diseaseRelevance: 'disease_relevance',
                      publicationImpact: 'publication_impact',
                      overall: 'overall',
                    };
                    return keyMap[dimKey] === d.key;
                  })?.label.replace('\n', ' ') || dimKey;

                  return (
                    <motion.td
                      key={dimKey}
                      initial={{ opacity: 0, scale: 0.9 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.2, delay: rowIdx * 0.03 + colIdx * 0.015 }}
                      className="text-center px-1 py-1.5 heatmap-cell-hover"
                      style={{ backgroundColor: bg, borderLeft: `1px solid ${borderCol}`, borderRight: `1px solid ${borderCol}`, borderRadius: 3 }}
                    >
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="cursor-default">
                            <span
                              className="text-[10px] font-mono font-semibold"
                              style={{ color: textCol }}
                            >
                              {value.toFixed(2)}
                            </span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="text-xs">
                          <div className="font-semibold text-claude-text">
                            {protein.proteinName}
                          </div>
                          <div className="text-claude-text-secondary">
                            {dimLabel}: <span className="font-mono font-semibold" style={{ color: textCol }}>{value.toFixed(3)}</span>
                          </div>
                          <div className="text-claude-text-muted text-[10px]">
                            {value >= 0.8 ? 'Excellent' : value >= 0.6 ? 'Good' : value >= 0.3 ? 'Moderate' : 'Low'}
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </motion.td>
                  );
                })}
              </motion.tr>
            ))}

            {/* Average row */}
            {columnAverages && (
              <motion.tr
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.3 }}
                className="border-t-2 border-claude-border dark:border-[#3d3832] bg-claude-surface/50 dark:bg-[#242220]/50"
              >
                <td className="px-2 py-1.5 bg-claude-surface dark:bg-[#242220] sticky left-0 z-10">
                  <div className="text-[9px] font-semibold text-claude-text-muted uppercase tracking-wider">
                    Average
                  </div>
                </td>
                {dimensionKeys.map((dimKey) => {
                  const value = columnAverages[dimKey];
                  const bg = getCellColor(value, isDark);
                  const textCol = getCellTextColor(value);
                  return (
                    <td
                      key={`avg-${dimKey}`}
                      className="text-center px-1 py-1.5"
                      style={{ backgroundColor: bg }}
                    >
                      <span className="text-[10px] font-mono font-bold" style={{ color: textCol }}>
                        {value.toFixed(2)}
                      </span>
                    </td>
                  );
                })}
              </motion.tr>
            )}
          </tbody>
        </table>

        {/* Color legend */}
        <div className="flex items-center gap-4 mt-3 pt-2 border-t border-claude-border/30 dark:border-[#3d3832]/30">
          <span className="text-[9px] text-claude-text-muted font-medium">Score:</span>
          <div className="flex items-center gap-1">
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: getCellColor(0.15, isDark), border: `1px solid ${getCellBorderColor(0.15, isDark)}` }} />
              <span className="text-[9px] text-claude-text-muted">&lt;0.3</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: getCellColor(0.45, isDark), border: `1px solid ${getCellBorderColor(0.45, isDark)}` }} />
              <span className="text-[9px] text-claude-text-muted">0.3-0.6</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: getCellColor(0.7, isDark), border: `1px solid ${getCellBorderColor(0.7, isDark)}` }} />
              <span className="text-[9px] text-claude-text-muted">0.6-0.8</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: getCellColor(0.9, isDark), border: `1px solid ${getCellBorderColor(0.9, isDark)}` }} />
              <span className="text-[9px] text-claude-text-muted">&gt;0.8</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
