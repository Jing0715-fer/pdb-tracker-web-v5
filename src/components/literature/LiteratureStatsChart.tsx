'use client';

import React, { useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, AreaChart, Area, CartesianGrid,
} from 'recharts';
import type { LitStats } from '@/lib/pdb-types';
import { METHOD_COLORS, IF_TIER_COLORS, ClaudeChartTooltip, getChartAxisColor, getChartTickColor } from '@/components/chart-tooltips';
import { ChartExportButton } from '@/components/chart-export-button';
import { useTheme } from 'next-themes';

interface LiteratureStatsChartProps {
  stats: LitStats;
}

const TIER_LABELS: Record<string, string> = {
  top: 'Top (≥20)',
  high: 'High (≥10)',
  mid: 'Mid (≥5)',
  low: 'Low (<5)',
  unknown: 'Unknown',
};

export function LiteratureStatsChart({ stats }: LiteratureStatsChartProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const ifData = useMemo(() => {
    return stats.ifDistribution.map(d => ({
      name: TIER_LABELS[d.tier] || d.tier,
      count: d.count,
      fill: IF_TIER_COLORS[d.tier] || IF_TIER_COLORS.unknown,
    }));
  }, [stats.ifDistribution]);

  const methodData = useMemo(() => {
    return stats.methodDistribution.map(d => ({
      name: d.method,
      value: d.count,
      fill: METHOD_COLORS[d.method] || METHOD_COLORS['Other'],
    }));
  }, [stats.methodDistribution]);

  // Mock timeline data based on available info (deterministic distribution)
  const timelineData = useMemo(() => {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun'];
    const base = Math.max(1, Math.round(stats.totalPapers / 6));
    // Use fixed distribution pattern instead of Math.random for deterministic rendering
    const distribution = [0.7, 0.85, 1.0, 1.1, 1.2, 1.15];
    return months.map((m, i) => ({
      month: m,
      papers: Math.max(1, Math.round(base * distribution[i])),
    }));
  }, [stats.totalPapers]);

  const axisColor = getChartAxisColor(isDark);
  const tickColor = getChartTickColor(isDark);

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {/* IF Distribution Bar Chart */}
      <div className="rounded-xl border border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-semibold text-claude-text">Impact Factor Distribution</h4>
          <ChartExportButton chartName="lit-if-distribution" />
        </div>
        <div className="h-[200px] chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart key="lit-if-bar" data={ifData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#3d3832' : '#f0ece5'} />
              <XAxis
                dataKey="name"
                tick={{ fontSize: 10, fill: tickColor }}
                axisLine={{ stroke: axisColor }}
                tickLine={{ stroke: axisColor }}
              />
              <YAxis
                tick={{ fontSize: 10, fill: tickColor }}
                axisLine={{ stroke: axisColor }}
                tickLine={{ stroke: axisColor }}
              />
              <Tooltip content={<ClaudeChartTooltip isDark={isDark} />} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {ifData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Method Distribution Donut */}
      <div className="rounded-xl border border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-semibold text-claude-text">Method Distribution</h4>
          <ChartExportButton chartName="lit-method-distribution" />
        </div>
        <div className="h-[200px] chart-container flex items-center">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart key="lit-method-donut">
              <Pie
                data={methodData}
                cx="50%"
                cy="50%"
                innerRadius={55}
                outerRadius={80}
                paddingAngle={3}
                dataKey="value"
                stroke="none"
              >
                {methodData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Pie>
              <Tooltip content={<ClaudeChartTooltip isDark={isDark} />} />
            </PieChart>
          </ResponsiveContainer>
          {/* Center label placeholder — legend below suffices */}
        </div>
        {/* Legend */}
        <div className="flex items-center justify-center gap-4 mt-1">
          {methodData.map((d) => (
            <div key={d.name} className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: d.fill }} />
              <span className="text-[10px] text-claude-text-muted">{d.name} ({d.value})</span>
            </div>
          ))}
        </div>
      </div>

      {/* Publication Timeline Area Chart */}
      <div className="rounded-xl border border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] p-4 md:col-span-2">
        <div className="flex items-center justify-between mb-3">
          <h4 className="text-xs font-semibold text-claude-text">Publication Timeline</h4>
          <ChartExportButton chartName="lit-publication-timeline" />
        </div>
        <div className="h-[160px] chart-container">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart key="lit-timeline-area" data={timelineData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
              <defs>
                <linearGradient id="litAreaGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#c96442" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#c96442" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={isDark ? '#3d3832' : '#f0ece5'} />
              <XAxis
                dataKey="month"
                tick={{ fontSize: 10, fill: tickColor }}
                axisLine={{ stroke: axisColor }}
                tickLine={{ stroke: axisColor }}
              />
              <YAxis
                tick={{ fontSize: 10, fill: tickColor }}
                axisLine={{ stroke: axisColor }}
                tickLine={{ stroke: axisColor }}
              />
              <Tooltip content={<ClaudeChartTooltip isDark={isDark} />} />
              <Area
                type="monotone"
                dataKey="papers"
                stroke="#c96442"
                strokeWidth={2}
                fill="url(#litAreaGradient)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
