'use client';
import { useI18n } from '@/lib/i18n';

import React, { useMemo } from 'react';
import {
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Radar,
  ResponsiveContainer,
} from 'recharts';
import { useTheme } from 'next-themes';
import { Shield, Database, Dna, CheckCircle2, Award, BarChart3 } from 'lucide-react';
import type { Evaluation } from '@/lib/pdb-types';
import { ChartExportButton } from '@/components/chart-export-button';

// ─── Props ────────────────────────────────────────────────────────────────────

interface EvalScoreBreakdownProps {
  evaluation: Evaluation | null;
  allEvaluations?: Evaluation[];
}

// ─── Metric computation helpers ───────────────────────────────────────────────

interface MetricData {
  coverage: number;
  structureCount: number;
  homologCount: number;
  completeness: number;
}

function computeMetrics(evaluation: Evaluation): MetricData {
  const coverage = evaluation.coverage ?? 0;

  const structureCount =
    evaluation.pdbStructures?.length ?? evaluation._count?.pdbStructures ?? 0;

  const homologCount =
    evaluation.blastResults?.length ?? evaluation._count?.blastResults ?? 0;

  // Data Completeness — percentage of key fields populated
  const fieldsToCheck: (string | number | null | undefined)[] = [
    evaluation.proteinName,
    evaluation.geneNames,
    evaluation.organism,
    evaluation.sequenceLength,
    evaluation.coverage,
    evaluation.scores,
    evaluation.report,
    evaluation.entryName,
  ];
  const populatedFields = fieldsToCheck.filter(
    (f) => f != null && f !== '' && f !== 0
  ).length;
  const completeness = Math.round(
    (populatedFields / fieldsToCheck.length) * 100
  );

  return { coverage, structureCount, homologCount, completeness };
}

function computeRadarData(metrics: MetricData) {
  return [
    {
      metric: 'Coverage',
      value: Math.round(metrics.coverage),
      fullMark: 100,
    },
    {
      metric: 'Structures',
      value: Math.min(100, Math.round((metrics.structureCount / 5) * 100)),
      fullMark: 100,
    },
    {
      metric: 'Homologs',
      value: Math.min(100, Math.round((metrics.homologCount / 10) * 100)),
      fullMark: 100,
    },
    {
      metric: 'Completeness',
      value: metrics.completeness,
      fullMark: 100,
    },
  ];
}

function getQualityTier(coverage: number): {
  tier: string;
  color: string;
  bgClass: string;
  textColor: string;
} {
  if (coverage >= 80)
    return {
      tier: 'Excellent',
      color: '#16a34a',
      bgClass: 'bg-emerald-100 dark:bg-emerald-900/30',
      textColor: 'text-emerald-700 dark:text-emerald-400',
    };
  if (coverage >= 60)
    return {
      tier: 'Good',
      color: '#c9872e',
      bgClass: 'bg-amber-100 dark:bg-amber-900/30',
      textColor: 'text-amber-700 dark:text-amber-400',
    };
  if (coverage >= 40)
    return {
      tier: 'Average',
      color: '#ea580c',
      bgClass: 'bg-orange-100 dark:bg-orange-900/30',
      textColor: 'text-orange-700 dark:text-orange-400',
    };
  return {
    tier: 'Poor',
    color: '#dc2626',
    bgClass: 'bg-red-100 dark:bg-red-900/30',
    textColor: 'text-red-700 dark:text-red-400',
  };
}

function computeAvgMetrics(
  allEvaluations?: Evaluation[]
): MetricData | null {
  if (!allEvaluations || allEvaluations.length === 0) return null;

  let totalCoverage = 0;
  let totalStructures = 0;
  let totalHomologs = 0;
  let totalCompleteness = 0;
  let count = 0;

  for (const ev of allEvaluations) {
    const m = computeMetrics(ev);
    totalCoverage += m.coverage;
    totalStructures += m.structureCount;
    totalHomologs += m.homologCount;
    totalCompleteness += m.completeness;
    count++;
  }

  return {
    coverage: totalCoverage / count,
    structureCount: totalStructures / count,
    homologCount: totalHomologs / count,
    completeness: totalCompleteness / count,
  };
}

// ─── SVG Arc Gauge ────────────────────────────────────────────────────────────

function CoverageGauge({
  value,
  isDark,
}: {
  value: number;
  isDark: boolean;
}) {
  const clampedValue = Math.max(0, Math.min(100, value));
  const radius = 60;
  const strokeWidth = 10;
  const cx = 80;
  const cy = 80;

  // Arc spans from -225° to 45° (270° total sweep)
  const startAngle = 135;
  const endAngle = 405;
  const sweepAngle = endAngle - startAngle; // 270 degrees
  const valueAngle = startAngle + (sweepAngle * clampedValue) / 100;

  // Convert degrees to radians
  const toRad = (deg: number) => ((deg - 90) * Math.PI) / 180;

  // Background arc
  const bgStart = toRad(startAngle);
  const bgEnd = toRad(endAngle);
  const bgX1 = cx + radius * Math.cos(bgStart);
  const bgY1 = cy + radius * Math.sin(bgStart);
  const bgX2 = cx + radius * Math.cos(bgEnd);
  const bgY2 = cy + radius * Math.sin(bgEnd);

  // Value arc
  const valEnd = toRad(valueAngle);
  const valX1 = bgX1;
  const valY1 = bgY1;
  const valX2 = cx + radius * Math.cos(valEnd);
  const valY2 = cy + radius * Math.sin(valEnd);

  // Determine color
  let arcColor = '#dc2626'; // red
  if (clampedValue >= 80) arcColor = '#16a34a'; // green
  else if (clampedValue >= 60) arcColor = '#c9872e'; // amber
  else if (clampedValue >= 40) arcColor = '#ea580c'; // orange

  const bgArcSweep = 1; // 270° > 180°
  const valArcSweep = (valueAngle - startAngle) > 180 ? 1 : 0;

  const bgPath = `M ${bgX1} ${bgY1} A ${radius} ${radius} 0 ${bgArcSweep} 1 ${bgX2} ${bgY2}`;
  const valPath =
    clampedValue > 0
      ? `M ${valX1} ${valY1} A ${radius} ${radius} 0 ${valArcSweep} 1 ${valX2} ${valY2}`
      : '';

  return (
    <svg
      width="160"
      height="140"
      viewBox="0 0 160 140"
      className="eval-breakdown-gauge"
    >
      {/* Background arc */}
      <path
        d={bgPath}
        fill="none"
        stroke={isDark ? '#3d3832' : '#e8e4dd'}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
      />
      {/* Value arc */}
      {valPath && (
        <path
          d={valPath}
          fill="none"
          stroke={arcColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          className="eval-gauge-arc-fill"
        />
      )}
      {/* Center text */}
      <text
        x={cx}
        y={cy - 2}
        textAnchor="middle"
        dominantBaseline="central"
        className="font-mono font-bold"
        fill={isDark ? '#e8e4dd' : '#1a1a1a'}
        fontSize="28"
      >
        {Math.round(clampedValue)}
      </text>
      <text
        x={cx}
        y={cy + 18}
        textAnchor="middle"
        dominantBaseline="central"
        fill={isDark ? '#6b6560' : '#9b9590'}
        fontSize="10"
      >
        % coverage
      </text>
    </svg>
  );
}

// ─── Comparison Sparkline ─────────────────────────────────────────────────────

function ComparisonSparkline({
  current,
  avg,
  isDark,
}: {
  current: MetricData;
  avg: MetricData;
  isDark: boolean;
}) {
  // Build sparkline data: current vs avg for 4 metrics
  const metrics = [
    { label: 'Cov', current: current.coverage, avg: avg.coverage },
    {
      label: 'Struct',
      current: Math.min(100, (current.structureCount / 5) * 100),
      avg: Math.min(100, (avg.structureCount / 5) * 100),
    },
    {
      label: 'Homol',
      current: Math.min(100, (current.homologCount / 10) * 100),
      avg: Math.min(100, (avg.homologCount / 10) * 100),
    },
    { label: 'Compl', current: current.completeness, avg: avg.completeness },
  ];

  const width = 200;
  const height = 50;
  const padding = 20;
  const plotWidth = width - padding * 2;
  const plotHeight = height - 12;
  const step = plotWidth / (metrics.length - 1);

  // Build paths
  const buildPath = (
    values: number[],
    color: string
  ): { path: string; dots: { x: number; y: number; color: string }[] } => {
    const points = values.map((v, i) => ({
      x: padding + i * step,
      y: plotHeight - (v / 100) * plotHeight,
    }));

    if (points.length < 2) {
      return {
        path: '',
        dots: points.map((p) => ({ x: p.x, y: p.y, color })),
      };
    }

    // Simple line path
    const pathParts = points.map((p, i) =>
      i === 0 ? `M ${p.x} ${p.y}` : `L ${p.x} ${p.y}`
    );

    return {
      path: pathParts.join(' '),
      dots: points.map((p) => ({ x: p.x, y: p.y, color })),
    };
  };

  const currentPath = buildPath(
    metrics.map((m) => m.current),
    isDark ? '#d4784f' : '#c96442'
  );
  const avgPath = buildPath(
    metrics.map((m) => m.avg),
    isDark ? '#6b6560' : '#9b9590'
  );

  return (
    <div className="eval-breakdown-sparkline">
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
      >
        {/* X axis labels */}
        {metrics.map((m, i) => (
          <text
            key={m.label}
            x={padding + i * step}
            y={height - 1}
            textAnchor="middle"
            fill={isDark ? '#6b6560' : '#9b9590'}
            fontSize="7"
          >
            {m.label}
          </text>
        ))}
        {/* Avg line */}
        {avgPath.path && (
          <path
            d={avgPath.path}
            fill="none"
            stroke={isDark ? '#6b6560' : '#9b9590'}
            strokeWidth="1.5"
            strokeDasharray="3 2"
            className="eval-sparkline-avg-line"
          />
        )}
        {/* Current line */}
        {currentPath.path && (
          <path
            d={currentPath.path}
            fill="none"
            stroke={isDark ? '#d4784f' : '#c96442'}
            strokeWidth="2"
            className="eval-sparkline-current-line"
          />
        )}
        {/* Avg dots */}
        {avgPath.dots.map((d, i) => (
          <circle
            key={`avg-${i}`}
            cx={d.x}
            cy={d.y}
            r="2"
            fill={d.color}
            className="eval-sparkline-dot"
          />
        ))}
        {/* Current dots */}
        {currentPath.dots.map((d, i) => (
          <circle
            key={`cur-${i}`}
            cx={d.x}
            cy={d.y}
            r="2.5"
            fill={d.color}
            className="eval-sparkline-dot"
          />
        ))}
      </svg>
      <div className="flex items-center gap-3 mt-1 justify-center">
        <div className="flex items-center gap-1">
          <span
            className="w-3 h-0.5 rounded"
            style={{ backgroundColor: isDark ? '#d4784f' : '#c96442' }}
          />
          <span
            className="text-[9px]"
            style={{ color: isDark ? '#9b9590' : '#6b6560' }}
          >
            This eval
          </span>
        </div>
        <div className="flex items-center gap-1">
          <span
            className="w-3 h-0.5 rounded"
            style={{
              backgroundColor: isDark ? '#6b6560' : '#9b9590',
              borderStyle: 'dashed',
            }}
          />
          <span
            className="text-[9px]"
            style={{ color: isDark ? '#9b9590' : '#6b6560' }}
          >
            Average
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Metric Card ──────────────────────────────────────────────────────────────

function MetricCard({
  icon: Icon,
  label,
  value,
  sublabel,
  progress,
  progressColor,
  delay,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  sublabel: string;
  progress: number;
  progressColor: string;
  delay: number;
}) {
  return (
    <div
      className="eval-metric-card rounded-lg p-3 border border-claude-border-light dark:border-[#2b2926] bg-white dark:bg-[#242220]"
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-3.5 w-3.5 text-claude-accent flex-shrink-0" />
        <span className="text-[10px] font-medium text-claude-text-muted uppercase tracking-wider">
          {label}
        </span>
      </div>
      <div className="font-mono font-bold text-lg text-claude-text leading-none mb-1">
        {value}
      </div>
      <div className="text-[10px] text-claude-text-muted mb-2">{sublabel}</div>
      <div className="h-1.5 rounded-full bg-claude-border/40 dark:bg-[#3d3832]/40 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700 ease-out eval-metric-progress"
          style={{
            width: `${Math.min(100, Math.max(0, progress))}%`,
            backgroundColor: progressColor,
          }}
        />
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function EvalScoreBreakdown({
  evaluation,
  allEvaluations,
}: EvalScoreBreakdownProps) {
  const { locale } = useI18n();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  // Hooks must be called before any conditional returns
  const metrics = useMemo(
    () => (evaluation ? computeMetrics(evaluation) : { coverage: 0, structureCount: 0, homologCount: 0, completeness: 0 }),
    [evaluation]
  );
  const radarData = useMemo(() => computeRadarData(metrics), [metrics]);
  const tier = useMemo(() => getQualityTier(metrics.coverage), [metrics.coverage]);
  const avgMetrics = useMemo(
    () => computeAvgMetrics(allEvaluations),
    [allEvaluations]
  );

  // ── Empty state ──
  if (!evaluation) {
    return (
      <div className="eval-breakdown-enter flex flex-col items-center justify-center py-12 px-4">
        <div className="w-14 h-14 rounded-full bg-claude-border-light/50 dark:bg-[#2b2926]/50 flex items-center justify-center mb-4">
          <BarChart3 className="h-6 w-6 text-claude-text-muted" />
        </div>
        <p className="text-sm text-claude-text-muted text-center">
          No evaluation selected
        </p>
        <p className="text-[11px] text-claude-text-muted/60 mt-1 text-center">
          Select an evaluation to view its score breakdown
        </p>
      </div>
    );
  }

  // Check if we have any meaningful data
  const hasData =
    metrics.coverage > 0 ||
    metrics.structureCount > 0 ||
    metrics.homologCount > 0 ||
    metrics.completeness > 0;

  if (!hasData) {
    return (
      <div className="eval-breakdown-enter flex flex-col items-center justify-center py-12 px-4">
        <div className="w-14 h-14 rounded-full bg-claude-border-light/50 dark:bg-[#2b2926]/50 flex items-center justify-center mb-4">
          <BarChart3 className="h-6 w-6 text-claude-text-muted" />
        </div>
        <p className="text-sm text-claude-text-muted text-center">
          No evaluation data available
        </p>
        <p className="text-[11px] text-claude-text-muted/60 mt-1 text-center">
          This evaluation has no metrics to display
        </p>
      </div>
    );
  }

  // Radar colors
  const strokeColor = isDark ? '#d4784f' : '#c96442';
  const fillColor = isDark ? 'rgba(212, 120, 79, 0.2)' : 'rgba(201, 100, 66, 0.2)';
  const gridColor = isDark ? '#3d3832' : '#e8e4dd';
  const tickColor = isDark ? '#9b9590' : '#6b6560';

  // Progress bar colors
  const getProgressColor = (value: number) => {
    if (value >= 80) return '#16a34a';
    if (value >= 60) return '#c9872e';
    if (value >= 40) return '#ea580c';
    return '#dc2626';
  };

  return (
    <div className="eval-breakdown-enter space-y-4">
      {/* Top row: Coverage Gauge + Score Radar */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Coverage Gauge */}
        <div className="eval-breakdown-gauge-container rounded-lg p-4 border border-claude-border-light dark:border-[#2b2926] bg-white dark:bg-[#242220] flex flex-col items-center">
          <h4 className="text-[11px] font-semibold text-claude-text uppercase tracking-wider mb-2 self-start">
            Coverage
          </h4>
          <CoverageGauge value={metrics.coverage} isDark={isDark} />
          {/* Quality Tier Badge */}
          <div
            className={`eval-tier-badge mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ${tier.bgClass} ${tier.textColor}`}
          >
            <Award className="h-3 w-3" />
            {tier.tier}
          </div>
        </div>

        {/* Score Radar */}
        <div className="eval-breakdown-radar-container rounded-lg p-4 border border-claude-border-light dark:border-[#2b2926] bg-white dark:bg-[#242220] flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-[11px] font-semibold text-claude-text uppercase tracking-wider">
              Score Radar
            </h4>
            <ChartExportButton chartName="eval-score-radar" />
          </div>
          {/* min-h + height raised from 180→240 so axis labels (which extend
              below the chart) are not clipped. outerRadius reduced to 65% to
              keep the polygon inside the larger canvas with room for labels. */}
          <div className="flex-1 min-h-[240px]">
            <ResponsiveContainer width="100%" height={240}>
              <RadarChart
                cx="50%"
                cy="50%"
                outerRadius="62%"
                data={radarData}
              >
                <PolarGrid stroke={gridColor} strokeDasharray="3 3" />
                <PolarAngleAxis
                  dataKey="metric"
                  tick={{ fill: tickColor, fontSize: 10, fontWeight: 500 }}
                />
                <PolarRadiusAxis
                  angle={90}
                  domain={[0, 100]}
                  tick={{ fill: gridColor, fontSize: 8 }}
                  tickCount={4}
                  axisLine={false}
                />
                <Radar
                  name="Score"
                  dataKey="value"
                  stroke={strokeColor}
                  fill={fillColor}
                  strokeWidth={2}
                  dot={{
                    r: 3,
                    fill: strokeColor,
                    stroke: isDark ? '#242220' : '#ffffff',
                    strokeWidth: 1.5,
                  }}
                />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 gap-3">
        <MetricCard
          icon={Shield}
          label={locale === "zh" ? "覆盖率" : "Coverage"}
          value={`${Math.round(metrics.coverage)}%`}
          sublabel={locale === "zh" ? "结构覆盖度" : "Structure coverage"}
          progress={metrics.coverage}
          progressColor={getProgressColor(metrics.coverage)}
          delay={100}
        />
        <MetricCard
          icon={Database}
          label="PDB Structures"
          value={`${metrics.structureCount}`}
          sublabel={`${metrics.structureCount} structure${metrics.structureCount !== 1 ? 's' : ''} found`}
          progress={Math.min(100, (metrics.structureCount / 5) * 100)}
          progressColor={getProgressColor(
            Math.min(100, (metrics.structureCount / 5) * 100)
          )}
          delay={200}
        />
        <MetricCard
          icon={Dna}
          label="BLAST Homologs"
          value={`${metrics.homologCount}`}
          sublabel={`${metrics.homologCount} homolog${metrics.homologCount !== 1 ? 's' : ''} found`}
          progress={Math.min(100, (metrics.homologCount / 10) * 100)}
          progressColor={getProgressColor(
            Math.min(100, (metrics.homologCount / 10) * 100)
          )}
          delay={300}
        />
        <MetricCard
          icon={CheckCircle2}
          label={locale === "zh" ? "完整度" : "Completeness"}
          value={`${metrics.completeness}%`}
          sublabel={locale === "zh" ? "已填充字段" : "Fields populated"}
          progress={metrics.completeness}
          progressColor={getProgressColor(metrics.completeness)}
          delay={400}
        />
      </div>

      {/* Comparison Sparkline */}
      {avgMetrics && (
        <div className="eval-breakdown-comparison rounded-lg p-4 border border-claude-border-light dark:border-[#2b2926] bg-white dark:bg-[#242220]">
          <h4 className="text-[11px] font-semibold text-claude-text uppercase tracking-wider mb-2">
            vs. Average
          </h4>
          <ComparisonSparkline
            current={metrics}
            avg={avgMetrics}
            isDark={isDark}
          />
        </div>
      )}
    </div>
  );
}
