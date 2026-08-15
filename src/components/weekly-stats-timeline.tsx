'use client';
import { useI18n } from '@/lib/i18n';

import React, { useMemo } from 'react';
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { useTheme } from 'next-themes';
import type { WeeklySnapshot } from '@/lib/pdb-types';
import { getChartAxisColor, getChartTickColor } from '@/components/chart-tooltips';

// ─── Weekly Stats Timeline Chart ──────────────────────────────────────────────

interface WeeklyStatsTimelineProps {
  snapshots: WeeklySnapshot[];
}

export function WeeklyStatsTimeline({ snapshots }: WeeklyStatsTimelineProps) {
  const { locale } = useI18n();
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const axisColor = getChartAxisColor(isDark);
  const tickColor = getChartTickColor(isDark);

  // Build chart data from last 8-12 snapshots (chronological order)
  const chartData = useMemo(() => {
    if (!snapshots.length) return [];
    // Snapshots are typically desc order (newest first), reverse for chronological
    const recent = [...snapshots].reverse().slice(-12);
    return recent.map(s => ({
      weekId: s.weekId || '',
      total: s.totalStructures,
      avgResolution: s.avgResolution ?? null,
      cryoemPct: s.totalStructures > 0 ? Math.round((s.cryoemCount / s.totalStructures) * 1000) / 10 : 0,
      cryoemCount: s.cryoemCount,
      xrayCount: s.xrayCount,
    }));
  }, [snapshots]);

  if (chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-[250px] text-[11px] text-claude-text-muted">
        No snapshot data available for timeline
      </div>
    );
  }

  // Colors from the claude palette
  const barColor = isDark ? '#d4784f' : '#c96442';    // claude-accent
  const resLineColor = isDark ? '#3db5b5' : '#2d8f8f'; // claude-cryoem (teal)
  const cryoemLineColor = isDark ? '#9b7ed8' : '#7c5cbf'; // claude-xray (purple)
  const gridColor = isDark ? '#3d3832' : '#f0ece5';

  return (
    <div className="weekly-stats-timeline">
      <ResponsiveContainer width="100%" height={250}>
        <ComposedChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 5 }}>
          <defs>
            <linearGradient id="timelineBarGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={barColor} stopOpacity={0.85} />
              <stop offset="100%" stopColor={barColor} stopOpacity={0.4} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
          {/* Left Y axis: Total structures */}
          <XAxis
            dataKey="weekId"
            tick={{ fontSize: 9, fill: tickColor }}
            axisLine={{ stroke: axisColor }}
            tickLine={{ stroke: axisColor }}
            interval={chartData.length > 8 ? 1 : 0}
            angle={-30}
            textAnchor="end"
            height={40}
          />
          <YAxis
            yAxisId="left"
            tick={{ fontSize: 9, fill: tickColor }}
            axisLine={{ stroke: axisColor }}
            tickLine={{ stroke: axisColor }}
            allowDecimals={false}
            label={{
              value: 'Structures',
              angle: -90,
              position: 'insideLeft',
              style: { fontSize: 9, fill: tickColor, textAnchor: 'middle' },
              offset: 10,
            }}
          />
          {/* Right Y axis: Resolution + Cryo-EM % */}
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={{ fontSize: 9, fill: tickColor }}
            axisLine={{ stroke: axisColor }}
            tickLine={{ stroke: axisColor }}
            domain={[0, 100]}
            label={{
              value: 'Å / %',
              angle: 90,
              position: 'insideRight',
              style: { fontSize: 9, fill: tickColor, textAnchor: 'middle' },
              offset: 10,
            }}
          />
          <Tooltip
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null;
              const data = payload[0]?.payload;
              if (!data) return null;
              return (
                <div className="rounded-lg px-3 py-2 text-xs shadow-lg border bg-white dark:bg-[#2b2926] dark:border-[#4a4540] max-w-[220px]">
                  <div className="font-semibold mb-1.5 text-[11px] text-claude-text">{label}</div>
                  {/* Total structures */}
                  <div className="flex items-center gap-2 py-0.5">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: barColor }} />
                    <span className="text-claude-text-secondary">Structures</span>
                    <span className="font-mono font-medium ml-auto text-claude-text">{data.total}</span>
                  </div>
                  {/* Avg Resolution */}
                  {data.avgResolution != null && (
                    <div className="flex items-center gap-2 py-0.5">
                      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: resLineColor }} />
                      <span className="text-claude-text-secondary">{locale === "zh" ? "平均分辨率" : "Avg Resolution"}</span>
                      <span className="font-mono font-medium ml-auto text-claude-text">{data.avgResolution.toFixed(2)}Å</span>
                    </div>
                  )}
                  {/* Cryo-EM % */}
                  <div className="flex items-center gap-2 py-0.5">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: cryoemLineColor }} />
                    <span className="text-claude-text-secondary">Cryo-EM</span>
                    <span className="font-mono font-medium ml-auto text-claude-text">{data.cryoemPct}%</span>
                  </div>
                  {/* Method breakdown */}
                  <div className="mt-1 pt-1 border-t border-claude-border/30 dark:border-[#3d3832]/30 text-[9px] text-claude-text-muted">
                    Cryo-EM: {data.cryoemCount} · X-ray: {data.xrayCount}
                  </div>
                </div>
              );
            }}
          />
          {/* Bar: Total structures */}
          <Bar
            yAxisId="left"
            dataKey="total"
            fill="url(#timelineBarGrad)"
            radius={[3, 3, 0, 0]}
            barSize={chartData.length > 8 ? 16 : 24}
            name="Structures"
          />
          {/* Line: Average resolution (right Y axis) */}
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="avgResolution"
            stroke={resLineColor}
            strokeWidth={2}
            dot={{ r: 3, fill: resLineColor, strokeWidth: 0 }}
            activeDot={{ r: 4, fill: resLineColor, stroke: isDark ? '#242220' : '#ffffff', strokeWidth: 2 }}
            connectNulls={false}
            name="Avg Resolution (Å)"
          />
          {/* Line: Cryo-EM percentage (right Y axis) */}
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="cryoemPct"
            stroke={cryoemLineColor}
            strokeWidth={2}
            strokeDasharray="4 2"
            dot={{ r: 3, fill: cryoemLineColor, strokeWidth: 0 }}
            activeDot={{ r: 4, fill: cryoemLineColor, stroke: isDark ? '#242220' : '#ffffff', strokeWidth: 2 }}
            name="Cryo-EM %"
          />
          {/* Legend */}
          <Legend
            wrapperStyle={{ fontSize: '10px', paddingTop: '8px' }}
            formatter={(value: string) => {
              const labelMap: Record<string, string> = {
                'Structures': 'Structures',
                'Avg Resolution (Å)': 'Avg Resolution',
                'Cryo-EM %': 'Cryo-EM %',
              };
              return <span className="text-claude-text-muted">{labelMap[value] || value}</span>;
            }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
