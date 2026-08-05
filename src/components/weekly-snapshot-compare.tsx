'use client';

import React, { useMemo } from 'react';
import { useTheme } from 'next-themes';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { Trophy, ArrowUp, ArrowDown, Minus, TrendingUp } from 'lucide-react';
import type { WeeklySnapshot } from '@/lib/pdb-types';
import { getChartAxisColor, getChartTickColor } from '@/components/chart-tooltips';
import { useI18n } from '@/lib/i18n';

// ─── Props ──────────────────────────────────────────────────────────────────

interface WeeklySnapshotCompareProps {
  currentSnapshot: WeeklySnapshot | null;
  previousSnapshot: WeeklySnapshot | null;
  allSnapshots: WeeklySnapshot[];
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface MetricData {
  label: string;
  current: number | null;
  previous: number | null;
  unit?: string;
  invertDirection?: boolean; // true = lower is better (e.g., resolution)
  formatValue: (v: number) => string;
}

type DeltaDirection = 'up' | 'down' | 'flat';

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseIfDist(ifDistStr: string | null): Record<string, number> {
  if (!ifDistStr) return {};
  try {
    return JSON.parse(ifDistStr);
  } catch {
    return {};
  }
}

function getTopIfCount(snapshot: WeeklySnapshot | null): number | null {
  if (!snapshot) return null;
  const dist = parseIfDist(snapshot.ifDist);
  return dist['IF≥20'] ?? null;
}

function computeCryoemPct(snapshot: WeeklySnapshot | null): number | null {
  if (!snapshot || snapshot.totalStructures === 0) return null;
  return (snapshot.cryoemCount / snapshot.totalStructures) * 100;
}

function computeDelta(current: number | null, previous: number | null): { pct: number | null; direction: DeltaDirection } {
  if (current === null || previous === null || previous === 0) {
    return { pct: null, direction: 'flat' };
  }
  const pctVal = ((current - previous) / Math.abs(previous)) * 100;
  const absPct = Math.abs(pctVal);
  const direction: DeltaDirection = absPct < 1 ? 'flat' : current > previous ? 'up' : current < previous ? 'down' : 'flat';
  return { pct: pctVal, direction };
}

function getBestWeek(allSnapshots: WeeklySnapshot[], metricFn: (s: WeeklySnapshot) => number | null, invertDirection?: boolean): WeeklySnapshot | null {
  let best: WeeklySnapshot | null = null;
  let bestVal: number | null = null;
  for (const s of allSnapshots) {
    const v = metricFn(s);
    if (v === null) continue;
    if (bestVal === null || (invertDirection ? v < bestVal : v > bestVal)) {
      bestVal = v;
      best = s;
    }
  }
  return best;
}

// ─── Delta Badge ────────────────────────────────────────────────────────────

function DeltaBadge({ pct, direction, invertDirection }: { pct: number | null; direction: DeltaDirection; invertDirection?: boolean }) {
  if (pct === null) return null;

  // Determine if the change is positive or negative
  // invertDirection means lower values are better (like resolution)
  const isImproving = invertDirection
    ? direction === 'down'  // lower resolution = better
    : direction === 'up';   // higher count/pct = better
  const isDeclining = invertDirection
    ? direction === 'up'
    : direction === 'down';

  let colorClass: string;
  let Icon: React.ReactNode;

  if (direction === 'flat') {
    colorClass = 'text-claude-text-muted';
    Icon = <Minus className="h-2.5 w-2.5" />;
  } else if (isImproving) {
    colorClass = 'text-emerald-600 dark:text-emerald-400';
    Icon = direction === 'up' ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />;
  } else if (isDeclining) {
    colorClass = 'text-red-500 dark:text-red-400';
    Icon = direction === 'up' ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />;
  } else {
    colorClass = 'text-claude-text-muted';
    Icon = <Minus className="h-2.5 w-2.5" />;
  }

  const sign = pct > 0 ? '+' : '';
  const displayPct = `${sign}${pct.toFixed(0)}%`;

  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold ${colorClass}`}>
      {Icon}
      {displayPct}
    </span>
  );
}

// ─── Mini Compare Bar Chart ────────────────────────────────────────────────

function MiniCompareChart({ current, previous, isDark, metricKey }: {
  current: number | null;
  previous: number | null;
  isDark: boolean;
  metricKey: string;
}) {
  if (current === null && previous === null) return null;

  const cVal = current ?? 0;
  const pVal = previous ?? 0;
  const maxVal = Math.max(cVal, pVal, 1);

  const data = [
    { name: 'Prev', value: pVal },
    { name: 'Curr', value: cVal },
  ];

  const currColor = isDark ? '#d4784f' : '#c96442';
  const prevColor = isDark ? '#4a4540' : '#d4cfc8';

  return (
    <ResponsiveContainer width="100%" height={40}>
      <BarChart data={data} margin={{ top: 2, right: 4, bottom: 0, left: 4 }}>
        <XAxis
          dataKey="name"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 8, fill: getChartTickColor(isDark) }}
          interval={0}
        />
        <YAxis hide domain={[0, maxVal * 1.1]} />
        <Tooltip
          contentStyle={{
            background: isDark ? '#2b2926' : '#ffffff',
            border: isDark ? '1px solid #4a4540' : '1px solid #e8e4dd',
            borderRadius: '6px',
            fontSize: '10px',
            color: isDark ? '#e8e4dd' : '#1a1a1a',
            padding: '4px 8px',
          }}
          formatter={((value: any) => [Number(value).toLocaleString(), '']) as any}
        />
        <Bar dataKey="value" radius={[3, 3, 0, 0]} barSize={20}>
          {data.map((entry, index) => (
            <Cell key={`${metricKey}-${index}`} fill={entry.name === 'Curr' ? currColor : prevColor} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ─── Best Week Badge ────────────────────────────────────────────────────────

function BestWeekBadge({ isBest }: { isBest: boolean }) {
  if (!isBest) return null;
  return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[8px] font-bold uppercase tracking-wider bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 border border-amber-200 dark:border-amber-700/40 snapshot-compare-badge">
      <Trophy className="h-2.5 w-2.5" />
      Best
    </span>
  );
}

// ─── Metric Card ────────────────────────────────────────────────────────────

function MetricCard({
  metric,
  isBestWeek,
  isDark,
}: {
  metric: MetricData;
  isBestWeek: boolean;
  isDark: boolean;
}) {
  const { locale } = useI18n();
  const delta = computeDelta(metric.current, metric.previous);
  const hasData = metric.current !== null || metric.previous !== null;

  return (
    <div className="snapshot-compare-card rounded-lg border border-claude-border dark:border-[#3d3832] bg-white dark:bg-[#1a1917] p-3 flex flex-col gap-2">
      {/* Header row */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-claude-text-muted">
          {metric.label}
        </span>
        <BestWeekBadge isBest={isBestWeek} />
      </div>

      {/* Side-by-side values */}
      {hasData ? (
        <div className="flex items-end gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-[9px] text-claude-text-muted mb-0.5">{locale === 'zh' ? '本周' : 'This week'}</div>
            <div className="text-lg font-bold font-mono text-claude-text leading-none">
              {metric.current !== null ? metric.formatValue(metric.current) : '—'}
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[9px] text-claude-text-muted mb-0.5">{locale === 'zh' ? '上周' : 'Last week'}</div>
            <div className="text-sm font-medium font-mono text-claude-text-secondary leading-none">
              {metric.previous !== null ? metric.formatValue(metric.previous) : '—'}
            </div>
          </div>
          <div className="flex-shrink-0 self-end pb-0.5">
            <DeltaBadge
              pct={delta.pct}
              direction={delta.direction}
              invertDirection={metric.invertDirection}
            />
          </div>
        </div>
      ) : (
        <div className="text-sm text-claude-text-muted italic">{locale === 'zh' ? '暂无数据' : 'No data'}</div>
      )}

      {/* Mini bar chart */}
      {hasData && (
        <div className="mt-1">
          <MiniCompareChart
            current={metric.current}
            previous={metric.previous}
            isDark={isDark}
            metricKey={metric.label}
          />
        </div>
      )}
    </div>
  );
}

// ─── Main Component ─────────────────────────────────────────────────────────

export function WeeklySnapshotCompare({ currentSnapshot, previousSnapshot, allSnapshots }: WeeklySnapshotCompareProps) {
  const { theme } = useTheme();
  const { locale } = useI18n();
  const isDark = theme === 'dark';

  const metrics = useMemo<MetricData[]>(() => {
    const topIfCurrent = getTopIfCount(currentSnapshot);
    const topIfPrevious = getTopIfCount(previousSnapshot);

    return [
      {
        label: locale === 'zh' ? '结构总数' : 'Total Structures',
        current: currentSnapshot?.totalStructures ?? null,
        previous: previousSnapshot?.totalStructures ?? null,
        formatValue: (v) => v.toLocaleString(),
      },
      {
        label: locale === 'zh' ? '平均分辨率' : 'Avg Resolution',
        current: currentSnapshot?.avgResolution ?? null,
        previous: previousSnapshot?.avgResolution ?? null,
        unit: 'Å',
        invertDirection: true,
        formatValue: (v) => `${v.toFixed(2)}Å`,
      },
      {
        label: locale === 'zh' ? '冷冻电镜占比' : 'Cryo-EM %',
        current: computeCryoemPct(currentSnapshot),
        previous: computeCryoemPct(previousSnapshot),
        unit: '%',
        formatValue: (v) => `${v.toFixed(1)}%`,
      },
      {
        label: locale === 'zh' ? '高 IF (≥20)' : 'Top IF (≥20)',
        current: topIfCurrent,
        previous: topIfPrevious,
        formatValue: (v) => v.toString(),
      },
    ];
  }, [currentSnapshot, previousSnapshot]);

  // Compute best week for each metric
  const bestWeekFlags = useMemo(() => {
    const metricFns = [
      (s: WeeklySnapshot) => s.totalStructures as number | null,
      (s: WeeklySnapshot) => s.avgResolution,
      (s: WeeklySnapshot) => computeCryoemPct(s),
      (s: WeeklySnapshot) => getTopIfCount(s),
    ];
    const invertDirs = [false, true, false, false];

    return metrics.map((metric, i) => {
      const best = getBestWeek(allSnapshots, metricFns[i], invertDirs[i]);
      if (!best || !currentSnapshot) return false;
      return best.weekId === currentSnapshot.weekId;
    });
  }, [metrics, allSnapshots, currentSnapshot]);

  // Compute overall summary
  const overallDirection = useMemo(() => {
    let improving = 0;
    let declining = 0;
    for (const m of metrics) {
      const d = computeDelta(m.current, m.previous);
      const isImproving = m.invertDirection ? d.direction === 'down' : d.direction === 'up';
      const isDeclining = m.invertDirection ? d.direction === 'up' : d.direction === 'down';
      if (isImproving) improving++;
      if (isDeclining) declining++;
    }
    if (improving > declining) return 'improving' as const;
    if (declining > improving) return 'declining' as const;
    return 'mixed' as const;
  }, [metrics]);

  const summaryColor = overallDirection === 'improving'
    ? 'text-emerald-600 dark:text-emerald-400'
    : overallDirection === 'declining'
      ? 'text-red-500 dark:text-red-400'
      : 'text-claude-text-muted';

  const summaryText = overallDirection === 'improving'
    ? (locale === 'zh' ? '周环比改善' : 'Week over week improvements')
    : overallDirection === 'declining'
      ? (locale === 'zh' ? '部分指标下降' : 'Some metrics declining')
      : (locale === 'zh' ? '本周变化不一' : 'Mixed changes this week');

  if (!currentSnapshot) {
    return (
      <div className="snapshot-compare-section p-4 text-center text-sm text-claude-text-muted">
        Select a week to view comparison
      </div>
    );
  }

  return (
    <div className="snapshot-compare-section">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-claude-accent" />
          <h3 className="text-[12px] font-semibold text-claude-text">{locale === 'zh' ? '周对比' : 'Week Comparison'}</h3>
          {previousSnapshot && (
            <span className="text-[9px] text-claude-text-muted bg-claude-border-light dark:bg-[#2b2926] px-1.5 py-0.5 rounded">
              {currentSnapshot.weekId} vs {previousSnapshot.weekId}
            </span>
          )}
        </div>
        <span className={`text-[10px] font-medium ${summaryColor}`}>
          {summaryText}
        </span>
      </div>

      {/* Metric cards grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {metrics.map((metric, i) => (
          <MetricCard
            key={metric.label}
            metric={metric}
            isBestWeek={bestWeekFlags[i]}
            isDark={isDark}
          />
        ))}
      </div>

      {/* No previous data note */}
      {!previousSnapshot && (
        <div className="mt-3 text-[10px] text-claude-text-muted italic text-center">
          No previous week data available for comparison
        </div>
      )}
    </div>
  );
}
