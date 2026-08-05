'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  Tooltip,
} from 'recharts';
import {
  Boxes,
  Microscope,
  TrendingUp,
  Award,
  Activity,
} from 'lucide-react';
import type { PdbEntry, WeeklySnapshot } from '@/lib/pdb-types';
import { ChartExportButton } from '@/components/chart-export-button';

/**
 * DashboardSummaryWidget
 *
 * A compact dashboard widget showing key weekly statistics with
 * mini visualizations. Designed to be shown in a grid layout.
 *
 * Widgets:
 *   1. Method Distribution (mini donut + legend)
 *   2. Resolution Distribution (mini bar chart)
 *   3. Weekly Trend (sparkline of total structures)
 *   4. Top Journal (with IF badge)
 */

interface DashboardSummaryWidgetProps {
  entries: PdbEntry[];
  snapshots: WeeklySnapshot[];
}

const METHOD_COLORS: Record<string, string> = {
  'Cryo-EM': '#2d8f8f',
  'X-ray': '#7c5cbf',
  'NMR': '#c9872e',
  'Other': '#94a3b8',
};

const RES_COLORS = ['#16a34a', '#2d8f8f', '#7c5cbf', '#c9872e', '#ea580c', '#dc2626'];

export function DashboardSummaryWidget({ entries, snapshots }: DashboardSummaryWidgetProps) {
  const data = useMemo(() => {
    const total = entries.length;

    // Method distribution
    const methodCounts: Record<string, number> = {};
    for (const e of entries) {
      const m = (e.method || 'Other').toUpperCase();
      const key = m.includes('CRYO') || m.includes('EM') ? 'Cryo-EM'
        : m.includes('X-RAY') || m.includes('XRAY') ? 'X-ray'
        : m.includes('NMR') ? 'NMR'
        : 'Other';
      methodCounts[key] = (methodCounts[key] || 0) + 1;
    }
    const methodDist = Object.entries(methodCounts).map(([name, value]) => ({
      name,
      value,
      color: METHOD_COLORS[name] || METHOD_COLORS['Other'],
    }));

    // Resolution distribution
    const resBins = [
      { label: '<1.5', min: 0, max: 1.5, value: 0 },
      { label: '1.5-2', min: 1.5, max: 2.0, value: 0 },
      { label: '2-2.5', min: 2.0, max: 2.5, value: 0 },
      { label: '2.5-3', min: 2.5, max: 3.0, value: 0 },
      { label: '3-3.5', min: 3.0, max: 3.5, value: 0 },
      { label: '>3.5', min: 3.5, max: Infinity, value: 0 },
    ];
    for (const e of entries) {
      if (e.resolution != null && e.resolution > 0) {
        for (const bin of resBins) {
          if (e.resolution >= bin.min && e.resolution < bin.max) {
            bin.value++;
            break;
          }
        }
      }
    }

    // Top journal
    const journalCounts: Record<string, { count: number; totalIf: number }> = {};
    for (const e of entries) {
      if (e.journal) {
        if (!journalCounts[e.journal]) {
          journalCounts[e.journal] = { count: 0, totalIf: 0 };
        }
        journalCounts[e.journal].count++;
        if (e.journalIf) journalCounts[e.journal].totalIf += e.journalIf;
      }
    }
    const topJournals = Object.entries(journalCounts)
      .map(([name, { count, totalIf }]) => ({ name, count, avgIf: count > 0 ? totalIf / count : 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      total,
      methodDist,
      resDist: resBins.map((b) => ({ label: b.label, value: b.value })),
      topJournals,
      sparklineData: [...snapshots].reverse().map((s) => s.totalStructures),
    };
  }, [entries, snapshots]);

  if (data.total === 0) return null;

  const widgets = [
    {
      icon: Microscope,
      label: 'Method Distribution',
      gradient: 'from-[#2d8f8f] to-[#1a6b6b]',
      delay: 0,
      content: (
        <div className="flex items-center gap-2 h-full">
          <ResponsiveContainer width={50} height={50}>
            <PieChart>
              <Pie
                data={data.methodDist}
                cx="50%"
                cy="50%"
                innerRadius={12}
                outerRadius={20}
                paddingAngle={1}
                dataKey="value"
              >
                {data.methodDist.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <div className="flex-1 space-y-0.5">
            {data.methodDist.map((m) => (
              <div key={m.name} className="flex items-center gap-1 text-[9px]">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: m.color }} />
                <span className="text-claude-text-muted truncate">{m.name}</span>
                <span className="text-claude-text-secondary ml-auto tabular-nums">
                  {((m.value / data.total) * 100).toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      ),
    },
    {
      icon: Activity,
      label: 'Resolution',
      gradient: 'from-[#c9872e] to-[#a06b1a]',
      delay: 0.05,
      content: (
        <div className="h-full">
          <ResponsiveContainer width="100%" height={50}>
            <BarChart data={data.resDist} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
              <XAxis dataKey="label" tick={{ fontSize: 7, fill: '#9a8f86' }} axisLine={false} tickLine={false} />
              <Bar dataKey="value" radius={[3, 3, 0, 0]}>
                {data.resDist.map((_, i) => (
                  <Cell key={i} fill={RES_COLORS[i]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      ),
    },
    {
      icon: TrendingUp,
      label: 'Weekly Trend',
      gradient: 'from-[#7c5cbf] to-[#5a3d99]',
      delay: 0.1,
      content: (
        <div className="h-full flex flex-col justify-center">
          <div className="sparkline-mini h-8">
            {data.sparklineData.map((val, i) => {
              const max = Math.max(...data.sparklineData, 1);
              const h = (val / max) * 100;
              return (
                <motion.div
                  key={i}
                  initial={{ height: 0 }}
                  animate={{ height: `${h}%` }}
                  transition={{ delay: 0.2 + i * 0.05, duration: 0.3 }}
                  className="sparkline-mini-bar"
                />
              );
            })}
          </div>
          <div className="text-[8px] text-claude-text-muted text-center mt-1">
            {data.sparklineData.length} weeks
          </div>
        </div>
      ),
    },
    {
      icon: Award,
      label: 'Top Journals',
      gradient: 'from-[#dc2626] to-[#ea580c]',
      delay: 0.15,
      content: (
        <div className="h-full space-y-0.5">
          {data.topJournals.slice(0, 4).map((j, i) => (
            <div key={i} className="flex items-center gap-1 text-[9px]">
              <span className="text-claude-text-muted truncate flex-1">
                {j.name.length > 15 ? j.name.substring(0, 15) + '…' : j.name}
              </span>
              <span className="text-claude-text-secondary tabular-nums">{j.count}</span>
              {j.avgIf > 0 && (
                <span
                  className="px-1 rounded text-[8px] font-bold text-white"
                  style={{
                    backgroundColor: j.avgIf >= 20 ? '#dc2626' : j.avgIf >= 10 ? '#ea580c' : '#c9872e',
                  }}
                >
                  {j.avgIf.toFixed(0)}
                </span>
              )}
            </div>
          ))}
        </div>
      ),
    },
  ];

  return (
    <div className="stats-summary-widget">
      {widgets.map((widget, i) => {
        const Icon = widget.icon;
        return (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: widget.delay, duration: 0.3 }}
            className="stats-summary-item"
          >
            {/* Header */}
            <div className="flex items-center gap-1.5 mb-2">
              <div className={`flex h-5 w-5 items-center justify-center rounded bg-gradient-to-br ${widget.gradient}`}>
                <Icon className="h-2.5 w-2.5 text-white" />
              </div>
              <span className="text-[8px] font-bold uppercase tracking-wider text-claude-text-muted flex-1">
                {widget.label}
              </span>
              <ChartExportButton chartName={`summary-${widget.label.toLowerCase().replace(/\s+/g, '-')}`} />
            </div>
            {/* Content */}
            <div className="w-full flex-1 min-h-[50px]">
              {widget.content}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
