'use client';

import React, { useMemo } from 'react';
import { useTheme } from 'next-themes';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Dna, AlertCircle } from 'lucide-react';
import type { Evaluation } from '@/lib/pdb-types';

// ─── Identity bucketing ─────────────────────────────────────────────────────

const BUCKETS = [
  { min: 0,  max: 30,  label: '<30%',  tier: 'low' },
  { min: 30, max: 50,  label: '30-50%', tier: 'low' },
  { min: 50, max: 70,  label: '50-70%', tier: 'mid' },
  { min: 70, max: 90,  label: '70-90%', tier: 'mid' },
  { min: 90, max: 95,  label: '90-95%', tier: 'high' },
  { min: 95, max: 100, label: '≥95%',   tier: 'paralog' },
] as const;

const TIER_COLORS = {
  low:     { fill: '#94a3b8', stroke: '#64748b', label: 'Distant' },
  mid:     { fill: '#f59e0b', stroke: '#d97706', label: 'Moderate' },
  high:    { fill: '#3b82f6', stroke: '#2563eb', label: 'Close' },
  paralog: { fill: '#10b981', stroke: '#059669', label: 'Paralog ≥95%' },
};

// ─── Component ───────────────────────────────────────────────────────────────

interface EvalBlastIdentityChartProps {
  evaluation: Evaluation;
  locale?: 'zh' | 'en';
  height?: number;
}

export function EvalBlastIdentityChart({
  evaluation,
  locale = 'zh',
  height = 180,
}: EvalBlastIdentityChartProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  const stats = useMemo(() => {
    const hits = (evaluation.blastResults || [])
      .filter(b => b.identity != null)
      .map(b => ({ identity: b.identity!, pdbId: b.pdbId, method: b.method }));
    const total = hits.length;

    const buckets = BUCKETS.map(b => {
      const items = hits.filter(h => h.identity >= b.min && (b.max === 100 ? h.identity >= b.min : h.identity < b.max));
      // Re-filter for the ≥95 bucket correctly
      const actual = b.min === 95
        ? hits.filter(h => h.identity >= 95)
        : hits.filter(h => h.identity >= b.min && h.identity < b.max);
      return {
        ...b,
        count: actual.length,
        items: actual,
      };
    });

    const paralogCount = buckets.find(b => b.tier === 'paralog')?.count ?? 0;
    const avgIdentity = total > 0 ? hits.reduce((s, h) => s + h.identity, 0) / total : 0;
    const maxIdentity = total > 0 ? Math.max(...hits.map(h => h.identity)) : 0;
    const minIdentity = total > 0 ? Math.min(...hits.map(h => h.identity)) : 0;

    return { buckets, total, paralogCount, avgIdentity, maxIdentity, minIdentity };
  }, [evaluation.blastResults]);

  if (stats.total === 0) {
    return (
      <div className="rounded-lg border border-border/40 bg-card/30 p-4 flex items-center gap-3 text-muted-foreground">
        <AlertCircle className="w-4 h-4 shrink-0" />
        <span className="text-xs">
          {locale === 'zh' ? '暂无 BLAST 同源命中数据' : 'No BLAST homolog data'}
        </span>
      </div>
    );
  }

  const maxCount = Math.max(...stats.buckets.map(b => b.count), 1);
  const barWidth = 100 / BUCKETS.length;
  const chartHeight = height - 50; // leave room for labels
  const paralogPct = stats.total > 0 ? (stats.paralogCount / stats.total) * 100 : 0;

  const axisColor = isDark ? '#6b6b6b' : '#d1d5db';
  const textColor = isDark ? '#9b9590' : '#6b7280';
  const labelColor = isDark ? '#e5e5e5' : '#1f2937';

  return (
    <div className="rounded-lg border border-border/60 bg-card/50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/40 bg-muted/30">
        <div className="flex items-center gap-2">
          <Dna className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          <span className="text-xs font-semibold text-foreground">
            {locale === 'zh' ? 'BLAST 同源性分布' : 'BLAST Identity Distribution'}
          </span>
        </div>
        <span className="text-[10px] font-mono text-muted-foreground">
          n={stats.total}
        </span>
      </div>

      {/* Stats row */}
      <div className="px-4 py-2 grid grid-cols-4 gap-2 border-b border-border/30 bg-muted/10">
        <div className="text-center">
          <div className="text-sm font-bold tabular-nums text-foreground">
            {stats.avgIdentity.toFixed(1)}%
          </div>
          <div className="text-[9px] text-muted-foreground">
            {locale === 'zh' ? '平均' : 'Avg'}
          </div>
        </div>
        <div className="text-center">
          <div className="text-sm font-bold tabular-nums text-foreground">
            {stats.maxIdentity.toFixed(0)}%
          </div>
          <div className="text-[9px] text-muted-foreground">
            {locale === 'zh' ? '最高' : 'Max'}
          </div>
        </div>
        <div className="text-center">
          <div className="text-sm font-bold tabular-nums text-foreground">
            {stats.minIdentity.toFixed(0)}%
          </div>
          <div className="text-[9px] text-muted-foreground">
            {locale === 'zh' ? '最低' : 'Min'}
          </div>
        </div>
        <div className="text-center">
          <div className="text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
            {stats.paralogCount}
            <span className="text-[9px] text-muted-foreground ml-0.5">
              ({paralogPct.toFixed(0)}%)
            </span>
          </div>
          <div className="text-[9px] text-muted-foreground">
            {locale === 'zh' ? '同源≥95%' : 'Paralog'}
          </div>
        </div>
      </div>

      {/* Histogram */}
      <div className="p-4">
        <svg viewBox={`0 0 100 ${chartHeight}`} preserveAspectRatio="none" className="w-full" style={{ height: chartHeight }}>
          {/* Y-axis grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map(p => (
            <line
              key={p}
              x1="0"
              x2="100"
              y1={chartHeight - p * (chartHeight - 15) - 5}
              y2={chartHeight - p * (chartHeight - 15) - 5}
              stroke={axisColor}
              strokeWidth="0.2"
              strokeDasharray="0.5 0.5"
            />
          ))}

          {/* Bars */}
          {stats.buckets.map((b, i) => {
            const barH = maxCount > 0 ? (b.count / maxCount) * (chartHeight - 20) : 0;
            const x = i * barWidth + barWidth * 0.15;
            const w = barWidth * 0.7;
            const y = chartHeight - barH - 8;
            const color = TIER_COLORS[b.tier];
            return (
              <g key={b.label}>
                <rect
                  x={x}
                  y={y}
                  width={w}
                  height={barH}
                  fill={color.fill}
                  stroke={color.stroke}
                  strokeWidth="0.3"
                  rx="0.5"
                  opacity={b.count > 0 ? 0.85 : 0.3}
                />
                {/* Count label above bar */}
                {b.count > 0 && (
                  <text
                    x={x + w / 2}
                    y={y - 1.5}
                    fontSize="3"
                    fill={labelColor}
                    textAnchor="middle"
                    fontWeight="600"
                  >
                    {b.count}
                  </text>
                )}
              </g>
            );
          })}

          {/* 95% paralog threshold line */}
          {(() => {
            const thresholdX = (5 / 6) * 100; // 95% is at the start of the last bucket
            return (
              <>
                <line
                  x1={thresholdX}
                  x2={thresholdX}
                  y1="0"
                  y2={chartHeight - 5}
                  stroke="#10b981"
                  strokeWidth="0.4"
                  strokeDasharray="1 1"
                />
                <text
                  x={thresholdX + 0.5}
                  y="3"
                  fontSize="2.5"
                  fill="#10b981"
                  fontWeight="600"
                >
                  95%
                </text>
              </>
            );
          })()}
        </svg>

        {/* X-axis labels */}
        <div className="flex justify-between mt-1 px-[3%]">
          {BUCKETS.map(b => (
            <span
              key={b.label}
              className="text-[8px] font-mono text-muted-foreground text-center"
              style={{ width: `${100 / BUCKETS.length}%` }}
            >
              {b.label}
            </span>
          ))}
        </div>
      </div>

      {/* Legend */}
      <div className="px-4 py-2 border-t border-border/30 bg-muted/10 flex flex-wrap items-center gap-x-4 gap-y-1">
        {(['low', 'mid', 'high', 'paralog'] as const).map(tier => {
          const c = TIER_COLORS[tier];
          const count = stats.buckets.filter(b => b.tier === tier).reduce((s, b) => s + b.count, 0);
          return (
            <Tooltip key={tier}>
              <TooltipTrigger asChild>
                <div className="flex items-center gap-1 cursor-default">
                  <span
                    className="inline-block w-2 h-2 rounded-sm"
                    style={{ backgroundColor: c.fill }}
                  />
                  <span className="text-[9px] text-muted-foreground">
                    {c.label} <span className="font-mono font-bold text-foreground">{count}</span>
                  </span>
                </div>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                <p className="font-medium">{c.label}</p>
                <p className="text-muted-foreground">
                  {tier === 'paralog'
                    ? (locale === 'zh' ? '同源蛋白（identity ≥ 95%），可作为直接结构参考' : 'Paralog (identity ≥ 95%), direct structural reference')
                    : locale === 'zh' ? `${c.label}同源命中` : `${c.label} homologs`}
                </p>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
