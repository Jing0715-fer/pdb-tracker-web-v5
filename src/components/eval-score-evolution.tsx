'use client';

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { useTheme } from 'next-themes';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceDot,
} from 'recharts';
import { TrendingUp, Target } from 'lucide-react';
import { getChartAxisColor, getChartTickColor } from '@/components/chart-tooltips';
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

// ─── Custom Tooltip ────────────────────────────────────────────────────────────

interface EvolutionTooltipProps {
  active?: boolean;
  payload?: Array<{
    name: string;
    value: number;
    color: string;
    dataKey: string;
  }>;
  label?: string | number;
  isDark: boolean;
}

function EvolutionTooltip({ active, payload, label, isDark }: EvolutionTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg px-3 py-2 text-xs shadow-lg border bg-white dark:bg-[#2b2926] dark:border-[#4a4540] text-claude-text">
      <div className="font-semibold mb-1 text-[11px] text-claude-text">
        {label} structures
      </div>
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 py-0.5">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: p.color }} />
          <span className="text-claude-text-secondary">{p.name}</span>
          <span className="font-mono font-medium ml-auto text-claude-text">{p.value.toFixed(3)}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface EvalScoreEvolutionProps {
  evaluations: Evaluation[];
  batches?: EvalBatch[];
  batchSubTargets?: Record<string, EvalBatchSubTarget[]>;
  selectedBatchId?: string | null;
  batchName?: string | null;
  targetThreshold?: number;
}

// ─── Line Colors ──────────────────────────────────────────────────────────────

const LINE_COLORS = ['#c96442', '#2d8f8f', '#7c5cbf', '#c9872e', '#16a34a', '#e11d48', '#0ea5e9', '#f97316'];

// ─── Main Component ───────────────────────────────────────────────────────────

export function EvalScoreEvolution({
  evaluations,
  batches = [],
  batchSubTargets = {},
  selectedBatchId = null,
  batchName = null,
  targetThreshold = 0.8,
}: EvalScoreEvolutionProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  // ─── Build evolution data ──────────────────────────────────────────────────

  const { chartData, proteinLines, currentStructureCounts } = useMemo(() => {
    // Filter by selected batch
    let filtered = evaluations;
    if (selectedBatchId && batchSubTargets[selectedBatchId]) {
      const subTargetIds = new Set(
        batchSubTargets[selectedBatchId].map((st) => st.uniprotId)
      );
      filtered = evaluations.filter((e) => subTargetIds.has(e.uniprotId));
    }

    if (filtered.length === 0) {
      return { chartData: [], proteinLines: [], currentStructureCounts: {} };
    }

    // For each evaluation, compute current PDB count and current overall score
    const proteinData = filtered.map((ev) => {
      const scores = parseScores(ev.scores);
      const structuralCoverage = scores['structural_coverage']?.score ?? 0;
      const ligandBinding = scores['ligand_binding']?.score ?? 0;
      const diseaseRelevance = scores['disease_relevance']?.score ?? 0;
      const publicationImpact = scores['publication_impact']?.score ?? 0;
      const overall = (structuralCoverage + ligandBinding + diseaseRelevance + publicationImpact) / 4;
      const currentPdbCount = ev.pdbStructures?.length ?? 0;

      return {
        uniprotId: ev.uniprotId,
        proteinName: ev.geneNames?.split(',')[0] || ev.proteinName || ev.uniprotId,
        overall,
        currentPdbCount,
        coverage: ev.coverage ?? 0,
      };
    });

    // Build data points: simulate from current PDB count to 2x
    // We generate 8 data points along the x-axis
    const maxPdbCount = Math.max(...proteinData.map(p => p.currentPdbCount), 1);
    const endCount = maxPdbCount * 2;
    const steps = 8;
    const pdbCounts: number[] = [];
    for (let i = 0; i <= steps; i++) {
      pdbCounts.push(Math.round((maxPdbCount / steps) * i * (endCount / maxPdbCount)));
    }
    // Ensure current count is included
    if (!pdbCounts.includes(maxPdbCount)) {
      pdbCounts.push(maxPdbCount);
    }
    pdbCounts.sort((a, b) => a - b);

    // For each protein, simulate how score would evolve with more structures
    // The model: as more PDB structures are added, coverage and scores improve
    // using a diminishing returns curve: score(n) = score_current + (1 - score_current) * (1 - e^(-k*(n-n_current)/n_current))
    // where k controls the learning rate
    const data = pdbCounts.map(n => {
      const point: Record<string, string | number> = { structures: n };
      proteinData.forEach(p => {
        const currentN = p.currentPdbCount || 1;
        const currentScore = p.overall;
        const k = 1.5; // learning rate
        if (n <= currentN) {
          // Before current count, use linear interpolation from a lower score
          const ratio = n / currentN;
          point[p.uniprotId] = parseFloat((currentScore * ratio * 0.8 + currentScore * 0.2).toFixed(3));
        } else {
          // After current count, use diminishing returns
          const delta = (1 - currentScore) * (1 - Math.exp(-k * (n - currentN) / currentN));
          point[p.uniprotId] = parseFloat(Math.min(currentScore + delta, 0.99).toFixed(3));
        }
      });
      return point;
    });

    const currentCounts: Record<string, number> = {};
    proteinData.forEach(p => {
      currentCounts[p.uniprotId] = p.currentPdbCount;
    });

    return {
      chartData: data,
      proteinLines: proteinData,
      currentStructureCounts: currentCounts,
    };
  }, [evaluations, selectedBatchId, batchSubTargets]);

  // ─── Find current position index for marker ──────────────────────────────

  const currentMarkerStructures = useMemo(() => {
    if (proteinLines.length === 0) return null;
    // Use the average current PDB count
    const avgCount = proteinLines.reduce((sum, p) => sum + p.currentPdbCount, 0) / proteinLines.length;
    return Math.round(avgCount);
  }, [proteinLines]);

  if (chartData.length === 0 || proteinLines.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center justify-center h-48 px-4"
      >
        <TrendingUp className="h-10 w-10 text-claude-text-muted mb-2" />
        <p className="text-sm text-claude-text-secondary">No evaluation data for score evolution</p>
      </motion.div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h4 className="text-[11px] font-semibold text-claude-text uppercase tracking-wider flex items-center gap-1.5">
          <TrendingUp className="h-3 w-3 text-claude-accent" />
          Score Evolution Projection
          {batchName && (
            <span className="font-normal normal-case tracking-normal text-claude-text-muted">
              — {batchName}
            </span>
          )}
        </h4>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-[#c9872e]/10 text-[9px] font-mono text-[#c9872e]">
            <Target className="h-2.5 w-2.5" />
            Target: {targetThreshold.toFixed(1)}
          </div>
        </div>
      </div>

      {/* Chart */}
      <div className="chart-container chart-inner-shadow rounded-lg p-3 bg-claude-surface dark:bg-[#242220] border border-claude-border-light dark:border-[#2b2926]">
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 5 }}>
            <defs>
              {proteinLines.map((p, idx) => {
                const color = LINE_COLORS[idx % LINE_COLORS.length];
                return (
                  <linearGradient key={p.uniprotId} id={`gradient-${p.uniprotId}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={color} stopOpacity={0.2} />
                    <stop offset="95%" stopColor={color} stopOpacity={0.02} />
                  </linearGradient>
                );
              })}
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#3d3832' : '#e8e4dd'} />
            <XAxis
              dataKey="structures"
              tick={{ fontSize: 9, fill: getChartTickColor(isDark) }}
              axisLine={{ stroke: getChartAxisColor(isDark) }}
              tickLine={{ stroke: getChartAxisColor(isDark) }}
              label={{ value: 'PDB Structures', position: 'insideBottom', offset: -2, fontSize: 9, fill: getChartTickColor(isDark) }}
            />
            <YAxis
              domain={[0, 1]}
              tick={{ fontSize: 9, fill: getChartTickColor(isDark) }}
              axisLine={{ stroke: getChartAxisColor(isDark) }}
              tickLine={{ stroke: getChartAxisColor(isDark) }}
              tickFormatter={(v: number) => v.toFixed(1)}
            />
            <Tooltip content={<EvolutionTooltip isDark={isDark} />} />

            {/* Target threshold dashed line */}
            <ReferenceLine
              y={targetThreshold}
              stroke="#c9872e"
              strokeDasharray="6 3"
              strokeWidth={1.5}
              label={{
                value: `Target ${targetThreshold}`,
                position: 'right',
                fontSize: 9,
                fill: '#c9872e',
              }}
            />

            {/* Current position vertical marker */}
            {currentMarkerStructures != null && (
              <ReferenceLine
                x={currentMarkerStructures}
                stroke={isDark ? '#9b9590' : '#7c756e'}
                strokeDasharray="4 4"
                strokeWidth={1}
                label={{
                  value: 'Current',
                  position: 'top',
                  fontSize: 8,
                  fill: isDark ? '#9b9590' : '#7c756e',
                }}
              />
            )}

            {/* Area lines for each protein */}
            {proteinLines.map((p, idx) => {
              const color = LINE_COLORS[idx % LINE_COLORS.length];
              return (
                <Area
                  key={p.uniprotId}
                  type="monotone"
                  dataKey={p.uniprotId}
                  name={p.proteinName}
                  stroke={color}
                  strokeWidth={2}
                  fill={`url(#gradient-${p.uniprotId})`}
                  dot={false}
                  activeDot={{ r: 3, strokeWidth: 1, stroke: color, fill: isDark ? '#242220' : '#ffffff' }}
                />
              );
            })}
          </AreaChart>
        </ResponsiveContainer>

        {/* Legend */}
        <div className="flex flex-wrap gap-3 mt-2 justify-center">
          {proteinLines.map((p, idx) => {
            const color = LINE_COLORS[idx % LINE_COLORS.length];
            return (
              <div key={p.uniprotId} className="flex items-center gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                <span className="text-[10px] text-claude-text-secondary font-medium">
                  {p.proteinName}
                </span>
                <span className="text-[9px] text-claude-text-muted font-mono">
                  ({p.currentPdbCount} PDB)
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
