'use client';
import { useI18n } from '@/lib/i18n';

import React from 'react';
import { motion } from 'framer-motion';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import type { WeeklySnapshot } from '@/lib/pdb-types';

// ─── Delta Indicator ──────────────────────────────────────────────────────────

function DeltaIndicator({ current, previous, label, invert = false }: {
  current: number;
  previous: number;
  label: string;
  invert?: boolean; // true means lower is better (e.g., resolution)
}) {
  if (previous === 0) return null;

  const diff = current - previous;
  const pct = (diff / previous) * 100;
  const isPositive = invert ? diff < 0 : diff > 0;
  const isNeutral = Math.abs(diff) < 0.01;

  if (isNeutral) {
    return (
      <div className="flex items-center justify-between py-0.5">
        <span className="text-[10px] text-claude-text-muted">{label}</span>
        <div className="flex items-center gap-1">
          <Minus className="h-2.5 w-2.5 text-claude-text-muted" />
          <span className="text-[10px] text-claude-text-muted">0%</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-[10px] text-claude-text-muted">{label}</span>
      <div className="flex items-center gap-1">
        {isPositive ? (
          <TrendingUp className="h-2.5 w-2.5 text-green-500" />
        ) : (
          <TrendingDown className="h-2.5 w-2.5 text-red-400" />
        )}
        <span className={`text-[10px] font-mono font-medium ${isPositive ? 'text-green-600 dark:text-green-400' : 'text-red-500 dark:text-red-400'}`}>
          {diff > 0 ? '+' : ''}{pct.toFixed(0)}%
        </span>
        <span className="text-[9px] font-mono text-claude-text-muted">
          ({diff > 0 ? '+' : ''}{diff})
        </span>
      </div>
    </div>
  );
}

// ─── Sparkline ──────────────────────────────────────────────────────────────

function ComparisonSparkline({ data }: { data: number[] }) {
  if (!data || data.length < 2) return null;

  const width = 70;
  const height = 22;
  const padding = 3;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;

  const points = data.map((v, i) => {
    const x = padding + (i / (data.length - 1)) * (width - padding * 2);
    const y = height - padding - ((v - min) / range) * (height - padding * 2);
    return { x, y };
  });

  const linePath = `M${points.map(p => `${p.x},${p.y}`).join(' L')}`;
  const fillPath = `${linePath} L${points[points.length - 1].x},${height - padding} L${points[0].x},${height - padding} Z`;

  return (
    <svg width={width} height={height} className="flex-shrink-0">
      <defs>
        <linearGradient id="compSparkGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2d8f8f" stopOpacity="0.3" />
          <stop offset="100%" stopColor="#2d8f8f" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <path d={fillPath} fill="url(#compSparkGrad)" />
      <path d={linePath} fill="none" stroke="#2d8f8f" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {points.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={i === points.length - 1 ? 2.5 : 1.5} fill={i === points.length - 1 ? '#c96442' : '#2d8f8f'} />
      ))}
    </svg>
  );
}

// ─── {locale === 'zh' ? '方法分布' : 'Method Distribution'} Mini Bar ──────────────────────────────────────────

function MethodMiniBar({ current, previous }: { current: WeeklySnapshot; previous: WeeklySnapshot }) {
  const barWidth = 60;
  const barHeight = 8;

  const currentTotal = current.totalStructures || 1;
  const previousTotal = previous.totalStructures || 1;

  const currentCryoemPct = (current.cryoemCount / currentTotal) * barWidth;
  const currentXrayPct = (current.xrayCount / currentTotal) * barWidth;
  const currentNmrPct = (current.nmrCount / currentTotal) * barWidth;

  const previousCryoemPct = (previous.cryoemCount / previousTotal) * barWidth;
  const previousXrayPct = (previous.xrayCount / previousTotal) * barWidth;
  const previousNmrPct = (previous.nmrCount / previousTotal) * barWidth;

  return (
    <div className="space-y-1.5 mt-1">
      <div className="flex items-center gap-1.5">
        <span className="text-[8px] font-mono text-claude-text-muted w-3">Now</span>
        <svg width={barWidth} height={barHeight} className="flex-shrink-0">
          <rect x={0} y={0} width={barWidth} height={barHeight} rx={barHeight / 2} className="fill-claude-border dark:fill-[#3d3832]" opacity={0.4} />
          {current.cryoemCount > 0 && <rect x={0} y={0} width={currentCryoemPct} height={barHeight} fill="#2d8f8f" opacity={0.85} rx={barHeight / 4} />}
          {current.xrayCount > 0 && <rect x={currentCryoemPct} y={0} width={currentXrayPct} height={barHeight} fill="#7c5cbf" opacity={0.85} />}
          {current.nmrCount > 0 && <rect x={currentCryoemPct + currentXrayPct} y={0} width={currentNmrPct} height={barHeight} fill="#c9872e" opacity={0.85} rx={barHeight / 4} />}
        </svg>
      </div>
      <div className="flex items-center gap-1.5">
        <span className="text-[8px] font-mono text-claude-text-muted w-3">Prev</span>
        <svg width={barWidth} height={barHeight} className="flex-shrink-0">
          <rect x={0} y={0} width={barWidth} height={barHeight} rx={barHeight / 2} className="fill-claude-border dark:fill-[#3d3832]" opacity={0.4} />
          {previous.cryoemCount > 0 && <rect x={0} y={0} width={previousCryoemPct} height={barHeight} fill="#2d8f8f" opacity={0.55} rx={barHeight / 4} />}
          {previous.xrayCount > 0 && <rect x={previousCryoemPct} y={0} width={previousXrayPct} height={barHeight} fill="#7c5cbf" opacity={0.55} />}
          {previous.nmrCount > 0 && <rect x={previousCryoemPct + previousXrayPct} y={0} width={previousNmrPct} height={barHeight} fill="#c9872e" opacity={0.55} rx={barHeight / 4} />}
        </svg>
      </div>
      {/* Legend */}
      <div className="flex items-center gap-2 mt-1">
        <div className="flex items-center gap-0.5">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#2d8f8f]" />
          <span className="text-[7px] text-claude-text-muted">Cryo-EM</span>
        </div>
        <div className="flex items-center gap-0.5">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#7c5cbf]" />
          <span className="text-[7px] text-claude-text-muted">X-ray</span>
        </div>
        <div className="flex items-center gap-0.5">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#c9872e]" />
          <span className="text-[7px] text-claude-text-muted">NMR</span>
        </div>
      </div>
    </div>
  );
}

// ─── Week Comparison ──────────────────────────────────────────────────────────

interface WeekComparisonProps {
  current: WeeklySnapshot;
  previous: WeeklySnapshot | null;
  snapshots?: WeeklySnapshot[];
}

export function WeekComparison({ current, previous, snapshots }: WeekComparisonProps) {
  const { locale } = useI18n();
  if (!previous) {
    return (
      <div className="text-[10px] text-claude-text-muted text-center py-2">
        No previous week for comparison
      </div>
    );
  }

  // Build sparkline data from all snapshots (last 4 weeks)
  const sparklineData = snapshots && snapshots.length > 1
    ? snapshots.slice(0, 4).reverse().map(s => s.totalStructures)
    : [previous.totalStructures, current.totalStructures];

  return (
    <div className="space-y-1">
      <div className="text-[10px] font-semibold text-claude-text-secondary mb-1.5 uppercase tracking-wider">
        Week-over-Week
      </div>

      {/* Sparkline trend */}
      {sparklineData.length >= 2 && (
        <div className="mb-2">
          <ComparisonSparkline data={sparklineData} />
        </div>
      )}

      {/* Delta indicators */}
      <DeltaIndicator
        label="Total"
        current={current.totalStructures}
        previous={previous.totalStructures}
      />
      <DeltaIndicator
        label="Cryo-EM"
        current={current.cryoemCount}
        previous={previous.cryoemCount}
      />
      <DeltaIndicator
        label="X-ray"
        current={current.xrayCount}
        previous={previous.xrayCount}
      />
      <DeltaIndicator
        label="NMR"
        current={current.nmrCount}
        previous={previous.nmrCount}
      />

      {/* Method distribution label and bars - ABOVE the border */}
      <div className="text-[9px] font-semibold text-claude-text-muted uppercase tracking-wider mb-1">
        {locale === 'zh' ? '方法分布' : 'Method Distribution'}
      </div>
      <div className="mb-2">
        <MethodMiniBar current={current} previous={previous} />
      </div>
    </div>
  );
}
