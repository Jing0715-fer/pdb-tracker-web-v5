'use client';

import React, { useMemo } from 'react';
import { useTheme } from 'next-themes';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from 'recharts';
import { BarChart3 } from 'lucide-react';
import { computeQualityScore } from '@/lib/pdb-utils';
import { getChartAxisColor, getChartTickColor } from '@/components/chart-tooltips';
import type { PdbEntry } from '@/lib/pdb-types';

// ─── Quality Tier Definitions ────────────────────────────────────────────────

interface QualityTier {
  name: string;
  min: number;
  max: number;
  color: string;
  darkColor: string;
  description: string;
}

const QUALITY_TIERS: QualityTier[] = [
  { name: 'Excellent', min: 80, max: 100, color: '#10b981', darkColor: '#34d399', description: 'Score ≥ 80' },
  { name: 'Good', min: 60, max: 79, color: '#14b8a6', darkColor: '#2dd4bf', description: 'Score 60–79' },
  { name: 'Average', min: 40, max: 59, color: '#f59e0b', darkColor: '#fbbf24', description: 'Score 40–59' },
  { name: 'Below Avg', min: 20, max: 39, color: '#f97316', darkColor: '#fb923c', description: 'Score 20–39' },
  { name: 'Poor', min: 0, max: 19, color: '#ef4444', darkColor: '#f87171', description: 'Score < 20' },
];

// ─── Custom Tooltip ──────────────────────────────────────────────────────────

function QualityDistTooltip({ active, payload, isDark }: {
  active?: boolean;
  payload?: Array<{ payload?: { name?: string; count?: number; percentage?: number; color?: string } }>;
  isDark: boolean;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  if (!d) return null;
  return (
    <div className={`rounded-lg px-3 py-2 text-xs shadow-lg border bg-white dark:bg-[#2b2926] dark:border-[#4a4540]`}>
      <div className="flex items-center gap-2 mb-1">
        <span
          className="w-2.5 h-2.5 rounded-full flex-shrink-0"
          style={{ backgroundColor: d.color }}
        />
        <span className="font-semibold text-[11px] text-claude-text">{d.name}</span>
      </div>
      <div className="flex items-center gap-3 text-claude-text-secondary">
        <span>Count: <span className="font-mono font-medium text-claude-text">{d.count}</span></span>
        <span>Share: <span className="font-mono font-medium text-claude-text">{d.percentage?.toFixed(1)}%</span></span>
      </div>
    </div>
  );
}

// ─── Custom Bar Shape (rounded top corners) ──────────────────────────────────

function RoundedBar(props: any) {
  const { x, y, width, height, fill } = props;
  if (height <= 0) return null;
  const r = Math.min(4, width / 2, height / 2);
  return (
    <path
      d={`M${x},${y + height} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + width - r},${y} Q${x + width},${y} ${x + width},${y + r} L${x + width},${y + height} Z`}
      fill={fill}
    />
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

interface WeeklyQualityDistributionProps {
  entries: PdbEntry[];
}

export function WeeklyQualityDistribution({ entries }: WeeklyQualityDistributionProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  // Compute distribution from entries
  const { chartData, totalScored, averageScore, topTwoCount } = useMemo(() => {
    if (!entries || entries.length === 0) {
      return { chartData: [], totalScored: 0, averageScore: 0, topTwoCount: 0 };
    }

    // Score each entry
    const scores = entries.map(e => computeQualityScore(e).score);
    const totalScored = scores.length;

    if (totalScored === 0) {
      return { chartData: [], totalScored: 0, averageScore: 0, topTwoCount: 0 };
    }

    // Count per tier
    const tierCounts = QUALITY_TIERS.map(tier => {
      const count = scores.filter(s => s >= tier.min && s <= tier.max).length;
      return {
        name: tier.name,
        count,
        percentage: totalScored > 0 ? (count / totalScored) * 100 : 0,
        color: isDark ? tier.darkColor : tier.color,
        tier,
      };
    });

    const averageScore = scores.reduce((a, b) => a + b, 0) / totalScored;
    const topTwoCount = tierCounts
      .filter(t => t.tier.min >= 60)
      .reduce((sum, t) => sum + t.count, 0);

    return { chartData: tierCounts, totalScored, averageScore, topTwoCount };
  }, [entries, isDark]);

  // Empty state
  if (!entries || entries.length === 0) {
    return (
      <div className="quality-dist-fade-in text-center py-8 text-claude-text-muted">
        <BarChart3 className="h-8 w-8 mx-auto mb-2 opacity-40" />
        <p className="text-[11px]">No entries to score</p>
        <p className="text-[10px] mt-1">Select a weekly snapshot with structures to view quality distribution</p>
      </div>
    );
  }

  const topTwoPct = totalScored > 0 ? ((topTwoCount / totalScored) * 100) : 0;

  return (
    <div className="quality-dist-fade-in">
      {/* Chart */}
      <ResponsiveContainer width="100%" height={300}>
        <BarChart
          data={chartData}
          margin={{ top: 8, right: 16, left: 0, bottom: 4 }}
        >
          <XAxis
            dataKey="name"
            tick={{ fontSize: 10, fill: getChartTickColor(isDark) }}
            axisLine={{ stroke: getChartAxisColor(isDark) }}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 10, fill: getChartTickColor(isDark) }}
            axisLine={{ stroke: getChartAxisColor(isDark) }}
            tickLine={false}
            width={32}
            allowDecimals={false}
          />
          <Tooltip
            content={<QualityDistTooltip isDark={isDark} />}
            cursor={{ fill: isDark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.04)' }}
          />
          <Bar
            dataKey="count"
            shape={<RoundedBar />}
            radius={[4, 4, 0, 0]}
          >
            {chartData.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>

      {/* Summary Stats */}
      <div className="grid grid-cols-3 gap-3 mt-3 pt-3 border-t border-claude-border dark:border-[#3d3832]">
        <div className="text-center">
          <div className="text-[10px] text-claude-text-muted mb-0.5">Total Scored</div>
          <div className="text-sm font-semibold font-mono text-claude-text">{totalScored}</div>
        </div>
        <div className="text-center">
          <div className="text-[10px] text-claude-text-muted mb-0.5">Avg Score</div>
          <div className="text-sm font-semibold font-mono text-claude-text">{averageScore.toFixed(1)}</div>
        </div>
        <div className="text-center">
          <div className="text-[10px] text-claude-text-muted mb-0.5">Top 2 Tiers</div>
          <div className="text-sm font-semibold font-mono text-emerald-600 dark:text-emerald-400">
            {topTwoPct.toFixed(0)}%
          </div>
        </div>
      </div>
    </div>
  );
}
