'use client';

import React, { useMemo } from 'react';
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { useTheme } from 'next-themes';
import type { Evaluation } from '@/lib/pdb-types';

// ─── Metric Computation ──────────────────────────────────────────────────────

interface RadarMetric {
  metric: string;
  value: number;       // 0-100 score
  raw: string;         // raw display value for tooltip
  fullMark: number;
}

function computeMetrics(evaluation: Evaluation): RadarMetric[] {
  const metrics: RadarMetric[] = [];

  // 1. Coverage (0-100 directly — SIFTS / BLAST coverage %)
  const coverage = evaluation.coverage ?? 0;
  metrics.push({
    metric: 'Coverage',
    value: Math.round(coverage),
    raw: `${coverage.toFixed(1)}%`,
    fullMark: 100,
  });

  // 2. Structure Richness — log scale so the curve rises fast at small counts
  //    then plateaus. The old linear formula (count/5 * 100) gave 5 structures
  //    a perfect 100, making every well-studied target look identical. The
  //    log scale differentiates 1 vs 5 vs 20 vs 100 structures:
  //      c=0 → 0, c=1 → 33, c=3 → 57, c=10 → 76, c=30 → 90, c=100 → 100
  const structCount = evaluation.pdbStructures?.length ?? evaluation._count?.pdbStructures ?? 0;
  const structScore = structCount === 0 ? 0 : Math.min(100, Math.round(Math.log10(structCount + 1) / Math.log10(101) * 100));
  metrics.push({
    metric: 'Structures',
    value: structScore,
    raw: `${structCount} structure${structCount !== 1 ? 's' : ''}`,
    fullMark: 100,
  });

  // 3. Homolog Diversity — same log scale as structures. 10 homologs is NOT
  //    a perfect score (the old formula) — it's "moderate". 50+ is rich.
  const homologCount = evaluation.blastResults?.length ?? evaluation._count?.blastResults ?? 0;
  const homologScore = homologCount === 0 ? 0 : Math.min(100, Math.round(Math.log10(homologCount + 1) / Math.log10(101) * 100));
  metrics.push({
    metric: 'Homologs',
    value: homologScore,
    raw: `${homologCount} homolog${homologCount !== 1 ? 's' : ''}`,
    fullMark: 100,
  });

  // 4. Data Completeness — fraction of key metadata fields populated.
  //    Unchanged: this is already a 0-100% ratio.
  const fieldsToCheck: (string | null | undefined)[] = [
    evaluation.proteinName,
    evaluation.geneNames,
    evaluation.organism,
    evaluation.sequenceLength != null ? String(evaluation.sequenceLength) : null,
    evaluation.coverage != null ? String(evaluation.coverage) : null,
    evaluation.scores,
    evaluation.report,
    evaluation.entryName,
  ];
  const populatedFields = fieldsToCheck.filter((f) => f != null && f !== '').length;
  const completenessScore = Math.round((populatedFields / fieldsToCheck.length) * 100);
  metrics.push({
    metric: 'Completeness',
    value: completenessScore,
    raw: `${populatedFields}/${fieldsToCheck.length} fields`,
    fullMark: 100,
  });

  // 5. Research Recency — weight recent entries (≤1yr) at 12 pts each, older
  //    (1-2yr) at 5 pts. Caps at 100. The old weights (20/8) saturated at 5
  //    recent entries, over-rewarding lightly-studied targets that happened
  //    to have a couple of recent deposits.
  const allDates: string[] = [];
  for (const s of evaluation.pdbStructures ?? []) {
    if (s.releaseDate) allDates.push(s.releaseDate);
    if (s.depositionDate) allDates.push(s.depositionDate);
  }
  for (const b of evaluation.blastResults ?? []) {
    if (b.releaseDate) allDates.push(b.releaseDate);
  }
  const now = new Date();
  const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
  const twoYearsAgo = new Date(now.getFullYear() - 2, now.getMonth(), now.getDate());
  const recentCount = allDates.filter((d) => new Date(d) >= oneYearAgo).length;
  const olderCount = allDates.filter((d) => {
    const dd = new Date(d);
    return dd >= twoYearsAgo && dd < oneYearAgo;
  }).length;
  const researchScore = Math.min(100, recentCount * 12 + olderCount * 5);
  metrics.push({
    metric: 'Research',
    value: Math.round(researchScore),
    raw: `${recentCount} recent, ${olderCount} past year`,
    fullMark: 100,
  });

  // 6. Overall Quality — surface the stored Overall score (1-10 scale from
  //    the evaluation run) as a 0-100 metric so the radar reflects the
  //    actual verdict, not just the 5 proxy metrics above.
  let overallScore = 0;
  if (evaluation.scores) {
    try {
      const parsed = JSON.parse(evaluation.scores);
      const ov = parsed?.Overall?.score ?? parsed?.overall?.score;
      if (typeof ov === 'number') overallScore = Math.round((ov / 10) * 100);
    } catch { /* ignore */ }
  }
  metrics.push({
    metric: 'Overall',
    value: overallScore,
    raw: `${Math.round(overallScore / 10)}/10`,
    fullMark: 100,
  });

  return metrics;
}

// ─── Custom Tooltip ──────────────────────────────────────────────────────────

interface RadarTooltipProps {
  active?: boolean;
  payload?: Array<{
    value: number;
    name: string;
    payload: RadarMetric;
  }>;
  isDark: boolean;
}

function EvalRadarTooltip({ active, payload, isDark }: RadarTooltipProps) {
  if (!active || !payload?.length) return null;
  const data = payload[0]?.payload;
  if (!data) return null;

  return (
    <div
      className={`rounded-lg px-3 py-2 text-xs shadow-lg border ${
        isDark
          ? 'bg-[#2b2926] border-[#4a4540] text-[#e8e4dd]'
          : 'bg-white border-[#e8e4dd] text-[#1a1a1a]'
      }`}
    >
      <div className={`font-semibold mb-1 text-[11px] ${isDark ? 'text-[#e8e4dd]' : 'text-[#1a1a1a]'}`}>
        {data.metric}
      </div>
      <div className="flex items-center gap-2 py-0.5">
        <span
          className="w-2 h-2 rounded-full flex-shrink-0"
          style={{ backgroundColor: isDark ? '#d4784f' : '#c96442' }}
        />
        <span className={isDark ? 'text-[#9b9590]' : 'text-[#6b6560]'}>Score</span>
        <span className={`font-mono font-medium ml-auto ${isDark ? 'text-[#e8e4dd]' : 'text-[#1a1a1a]'}`}>
          {data.value}/100
        </span>
      </div>
      <div className={`text-[10px] mt-0.5 ${isDark ? 'text-[#6b6560]' : 'text-[#9b9590]'}`}>
        {data.raw}
      </div>
    </div>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

interface EvalScoreRadarChartProps {
  evaluation: Evaluation;
}

export function EvalScoreRadarChart({ evaluation }: EvalScoreRadarChartProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const data = useMemo(() => computeMetrics(evaluation), [evaluation]);

  // Check if we have any meaningful data
  const hasData = data.some((d) => d.value > 0);

  if (!hasData) {
    return (
      <div className="eval-radar-fade-in space-y-2">
        <h4 className="text-[11px] font-semibold text-claude-text uppercase tracking-wider">
          Evaluation Metrics
        </h4>
        <div className="chart-container chart-inner-shadow rounded-lg p-6 bg-claude-surface dark:bg-[#242220] border border-claude-border-light dark:border-[#2b2926] flex flex-col items-center justify-center min-h-[200px]">
          <div className="text-claude-text-muted text-xs text-center">
            No evaluation data available to display metrics.
          </div>
        </div>
      </div>
    );
  }

  // Colors matching the claude-* scheme
  const strokeColor = isDark ? '#d4784f' : '#c96442';
  const fillColor = isDark ? 'rgba(212, 120, 79, 0.2)' : 'rgba(201, 100, 66, 0.2)';
  const gridColor = isDark ? '#3d3832' : '#e8e4dd';
  const axisColor = isDark ? '#6b6560' : '#9b9590';
  const tickColor = isDark ? '#9b9590' : '#6b6560';

  return (
    <div className="eval-radar-fade-in space-y-2">
      <h4 className="text-[11px] font-semibold text-claude-text uppercase tracking-wider">
        Evaluation Metrics
      </h4>
      <div className="chart-container chart-inner-shadow rounded-lg p-3 bg-claude-surface dark:bg-[#242220] border border-claude-border-light dark:border-[#2b2926]">
        <ResponsiveContainer width="100%" height={300}>
          <RadarChart cx="50%" cy="50%" outerRadius="70%" data={data}>
            <PolarGrid
              stroke={gridColor}
              strokeDasharray="3 3"
            />
            <PolarAngleAxis
              dataKey="metric"
              tick={{ fill: tickColor, fontSize: 11, fontWeight: 500 }}
            />
            <PolarRadiusAxis
              angle={90}
              domain={[0, 100]}
              tick={{ fill: axisColor, fontSize: 9 }}
              tickCount={5}
              axisLine={false}
            />
            <Radar
              name="Score"
              dataKey="value"
              stroke={strokeColor}
              fill={fillColor}
              strokeWidth={2}
              dot={{
                r: 3.5,
                fill: strokeColor,
                stroke: isDark ? '#242220' : '#ffffff',
                strokeWidth: 1.5,
              }}
              activeDot={{
                r: 5,
                fill: strokeColor,
                stroke: isDark ? '#242220' : '#ffffff',
                strokeWidth: 2,
              }}
            />
            <Tooltip
              content={<EvalRadarTooltip isDark={isDark} />}
            />
          </RadarChart>
        </ResponsiveContainer>

        {/* Metric summary bars */}
        <div className="mt-3 space-y-1.5">
          {data.map((metric) => (
            <div key={metric.metric} className="flex items-center gap-2">
              <span className="text-[10px] text-claude-text-muted w-[72px] text-right flex-shrink-0">
                {metric.metric}
              </span>
              <div className="flex-1 h-1.5 rounded-full bg-claude-border/40 dark:bg-[#3d3832]/40 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700 ease-out"
                  style={{
                    width: `${metric.value}%`,
                    backgroundColor: metric.value >= 80
                      ? '#16a34a'
                      : metric.value >= 50
                      ? '#c9872e'
                      : metric.value >= 25
                      ? '#ea580c'
                      : '#dc2626',
                  }}
                />
              </div>
              <span className="text-[10px] font-mono text-claude-text-secondary w-7 text-right flex-shrink-0">
                {metric.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
