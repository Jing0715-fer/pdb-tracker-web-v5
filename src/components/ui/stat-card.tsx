'use client';

import React from 'react';
import { TiltCard, AnimatedNumber } from '@/components/ui/pdb-animated';
import { useI18n } from '@/lib/i18n';

// ─── Unified Stat Card Component ──────────────────────────────────────────────
// Shared across Weekly, Evaluation, and Literature modules for consistent styling.
// All 3 views must use this single component to prevent style drift.
//
// Layout:
//   ┌────────────────────────────────┐
//   │ [Icon] Title        [Indicator]│
//   │ Value                          │
//   │ Subtitle                       │
//   └────────────────────────────────┘
//
// Indicator types (passed via children):
//   - MethodDonut:    multi-segment donut for method/IF distribution
//   - CircularProgress: simple % ring
//   - MiniBar:        horizontal progress bar
//   - ResolutionGauge: colored gauge with marker
//   - TierBadge:      colored tier label
//   - FreshnessDot:   pulsing freshness indicator

export interface StatCardProps {
  title: string;
  value: number;
  suffix?: string;
  decimals?: number;
  icon: React.ReactNode;
  color: string;
  glowColor?: string;
  subtitle?: string;
  loading?: boolean;
  delay?: number;
  borderColor?: string;
  /** Indicator element — shown top-right */
  children?: React.ReactNode;
  tooltip?: string;
  /** For text-based values (e.g. journal name, date) instead of numeric */
  isText?: boolean;
  textValue?: string;
}

export function StatCard({
  title, value, suffix = '', decimals = 0, icon, color, glowColor, subtitle,
  loading, delay = 0, borderColor = '#2d8f8f', children, tooltip, isText = false, textValue,
}: StatCardProps) {
  const tooltipText = tooltip || `${title}: ${isText ? textValue : `${value}${suffix}`}`;
  return (
    <TiltCard
      className="gradient-border-wrap min-w-0 h-full"
      animationDelay={`${delay}ms`}
      style={{ '--gradient-border-color': borderColor } as React.CSSProperties}
    >
      <div className="gradient-border-inner bg-claude-surface dark:bg-[#242220] p-3 sm:p-3.5 claude-card-shadow transition-all duration-200 min-w-0 h-full flex flex-col relative overflow-hidden" title={tooltipText}>
        {/* Subtle top accent line */}
        <div className="absolute top-0 left-3 right-3 h-[2px] rounded-b opacity-20 transition-opacity duration-300 group-hover:opacity-40" style={{ background: `linear-gradient(90deg, ${borderColor}, transparent)` }} />

        {/* Row 1: Icon + Title ... Indicator */}
        <div className="flex items-center gap-2 mb-1.5">
          <div className={`flex items-center justify-center w-7 h-7 min-w-[28px] rounded-md ${color} stat-icon-float flex-shrink-0`}>
            {icon}
          </div>
          <div className="text-[10px] sm:text-[11px] font-semibold text-claude-text-muted truncate leading-tight flex-1 min-w-0">
            {title}
          </div>
          {/* Children area: indicator (top-right) */}
          {children && (
            <div className="flex items-center justify-center flex-shrink-0 stat-card-children-area">
              {children}
            </div>
          )}
        </div>

        {/* Row 2: Value */}
        <div className="text-xl sm:text-2xl font-bold text-claude-text tabular-nums leading-tight">
          {loading ? (
            <div className="w-14 sm:w-16 h-6 sm:h-7 rounded shimmer-skeleton" />
          ) : isText ? (
            <div className="text-lg sm:text-xl font-bold text-claude-text truncate max-w-full" title={textValue}>
              {textValue}
            </div>
          ) : (
            <AnimatedNumber value={value} decimals={decimals} suffix={suffix} glowColor={glowColor} />
          )}
        </div>

        {/* Row 3: Subtitle */}
        <div className={`text-[9px] sm:text-[10px] mt-0.5 line-clamp-1 ${subtitle ? 'text-claude-text-muted opacity-70' : 'invisible'}`}>
          {subtitle || '\u00A0'}
        </div>
      </div>
    </TiltCard>
  );
}

// ─── CircularProgress SVG (shared) ────────────────────────────────────────────
// Best for: simple % metrics (completion rate, coverage, reading progress)

export function CircularProgress({ value, max, color, size = 28 }: { value: number; max: number; color: string; size?: number }) {
  const radius = (size - 4) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.min(value / max, 1);
  const offset = circumference * (1 - progress);

  return (
    <svg width={size} height={size} className="transform -rotate-90 flex-shrink-0">
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        fill="none" stroke="currentColor"
        strokeWidth={2.5}
        className="text-claude-border dark:text-[#3d3832]"
      />
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        fill="none" stroke={color}
        strokeWidth={2.5}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        style={{ transition: 'stroke-dashoffset 0.6s ease-out' }}
      />
    </svg>
  );
}

// ─── MethodDonut (multi-segment donut) ────────────────────────────────────────
// Best for: showing method distribution (X-ray/Cryo-EM/NMR/Other) in one circle

export interface DonutSegment {
  label: string;
  value: number;
  color: string;
}

export function MethodDonut({ segments, size = 28, strokeWidth = 3 }: {
  segments: DonutSegment[];
  size?: number;
  strokeWidth?: number;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = segments.reduce((sum, s) => sum + s.value, 0);

  if (total === 0) {
    return (
      <svg width={size} height={size} className="flex-shrink-0">
        <circle
          cx={size / 2} cy={size / 2} r={radius}
          fill="none" stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-claude-border dark:text-[#3d3832]"
        />
      </svg>
    );
  }

  // Pre-compute segment offsets to avoid mutation during render
  const segmentData = segments.reduce<Array<{ length: number; offset: number; color: string }>>(
    (acc, seg, i) => {
      const segLength = (seg.value / total) * circumference;
      const gap = segments.length > 1 ? 1.5 : 0;
      const actualLength = Math.max(segLength - gap, 0);
      const offset = acc.length > 0 ? acc[i - 1].offset + acc[i - 1].length : 0;
      acc.push({ length: actualLength, offset, color: seg.color });
      return acc;
    },
    []
  );

  return (
    <svg width={size} height={size} className="transform -rotate-90 flex-shrink-0">
      {/* Background track */}
      <circle
        cx={size / 2} cy={size / 2} r={radius}
        fill="none" stroke="currentColor"
        strokeWidth={strokeWidth}
        className="text-claude-border dark:text-[#3d3832]"
      />
      {/* Segments */}
      {segmentData.map((seg, i) => (
        <circle
          key={i}
          cx={size / 2} cy={size / 2} r={radius}
          fill="none"
          stroke={seg.color}
          strokeWidth={strokeWidth}
          strokeLinecap="butt"
          strokeDasharray={`${seg.length} ${circumference - seg.length}`}
          strokeDashoffset={-seg.offset}
          style={{ transition: 'stroke-dasharray 0.6s ease-out, stroke-dashoffset 0.6s ease-out' }}
        />
      ))}
    </svg>
  );
}

// ─── MiniBar (horizontal progress bar) ────────────────────────────────────────
// Best for: simple % values (Cryo-EM Share, batch density)

export function MiniBar({ value, max, color, width = 40, height = 5 }: {
  value: number;
  max: number;
  color: string;
  width?: number;
  height?: number;
}) {
  const pct = Math.min(value / max, 1);

  return (
    <svg width={width} height={height + 6} className="flex-shrink-0">
      {/* Background track */}
      <rect
        x={0} y={3}
        width={width} height={height}
        rx={height / 2}
        fill="currentColor"
        className="text-claude-border dark:text-[#3d3832]"
      />
      {/* Fill bar */}
      <rect
        x={0} y={3}
        width={Math.max(pct * width, height)} height={height}
        rx={height / 2}
        fill={color}
        style={{ transition: 'width 0.6s ease-out' }}
      />
      {/* Percentage label */}
      <text
        x={width / 2} y={height + 5}
        textAnchor="middle"
        fontSize="7"
        fontWeight="600"
        fill="currentColor"
        className="text-claude-text-muted"
      >
        {Math.round(pct * 100)}%
      </text>
    </svg>
  );
}

// ─── ResolutionGauge (colored zones with marker) ─────────────────────────────
// Best for: resolution quality display (green ≤2Å, amber ≤3.5Å, red >3.5Å)

export function ResolutionGauge({ value, width = 40, height = 5 }: {
  value: number; // resolution in Å
  width?: number;
  height?: number;
}) {
  // Gauge maps 0–6Å range, lower is better
  const maxRes = 6;
  const clampedRes = Math.max(0, Math.min(value, maxRes));
  // Invert: 0Å → right (best), 6Å → left (worst)
  const markerX = (1 - clampedRes / maxRes) * width;

  // Zone colors
  const greenEnd = (1 - 2 / maxRes) * width;   // ≤2Å zone
  const amberEnd = (1 - 3.5 / maxRes) * width;  // ≤3.5Å zone

  return (
    <svg width={width} height={height + 8} className="flex-shrink-0">
      {/* Red zone (worst, left side) */}
      <rect x={0} y={2} width={amberEnd} height={height} rx={height / 2} fill="#dc2626" opacity={0.25} />
      {/* Amber zone (middle) */}
      <rect x={amberEnd} y={2} width={greenEnd - amberEnd} height={height} fill="#c9872e" opacity={0.35} />
      {/* Green zone (best, right side) */}
      <rect x={greenEnd} y={2} width={width - greenEnd} height={height} rx={height / 2} fill="#16a34a" opacity={0.3} />
      {/* Full track outline */}
      <rect x={0} y={2} width={width} height={height} rx={height / 2} fill="none" stroke="currentColor" strokeWidth={0.5} className="text-claude-border dark:text-[#3d3832]" />
      {/* Marker */}
      <circle
        cx={markerX} cy={2 + height / 2}
        r={3}
        fill={value <= 2 ? '#16a34a' : value <= 3.5 ? '#c9872e' : '#dc2626'}
        stroke="white"
        strokeWidth={1}
        style={{ transition: 'cx 0.4s ease-out', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.2))' }}
      />
      {/* Label */}
      <text
        x={width / 2} y={height + 8}
        textAnchor="middle"
        fontSize="7"
        fontWeight="600"
        fill="currentColor"
        className="text-claude-text-muted"
      >
        {value.toFixed(1)}Å
      </text>
    </svg>
  );
}

// ─── TierBadge (colored tier label) ──────────────────────────────────────────
// Best for: IF tier, journal quality level

export function TierBadge({ tier, label, compact = false }: {
  tier: 'top' | 'high' | 'mid' | 'low' | 'unknown';
  label?: string;
  compact?: boolean;
}) {
  const config: Record<string, { bg: string; text: string; border: string; defaultLabel: string }> = {
    top:    { bg: 'rgba(220, 38, 38, 0.08)', text: '#dc2626', border: 'rgba(220, 38, 38, 0.15)', defaultLabel: 'Top' },
    high:   { bg: 'rgba(234, 88, 12, 0.08)', text: '#ea580c', border: 'rgba(234, 88, 12, 0.15)', defaultLabel: 'High' },
    mid:    { bg: 'rgba(22, 163, 74, 0.08)', text: '#16a34a', border: 'rgba(22, 163, 74, 0.15)', defaultLabel: 'Mid' },
    low:    { bg: 'rgba(107, 114, 128, 0.06)', text: '#6b7280', border: 'rgba(107, 114, 128, 0.12)', defaultLabel: 'Low' },
    unknown: { bg: 'rgba(107, 114, 128, 0.04)', text: '#9b9590', border: 'rgba(107, 114, 128, 0.1)', defaultLabel: '—' },
  };
  const c = config[tier] || config.unknown;
  const displayLabel = label || c.defaultLabel;

  return (
    <span
      className={`inline-flex items-center justify-center rounded-md font-semibold leading-none ${compact ? 'px-1.5 py-1 text-[8px]' : 'px-2 py-1 text-[9px]'}`}
      style={{ background: c.bg, color: c.text, border: `1px solid ${c.border}` }}
    >
      {displayLabel}
    </span>
  );
}

// ─── FreshnessDot (pulsing freshness indicator) ──────────────────────────────
// Best for: Latest Update card — shows data freshness at a glance

export function FreshnessDot({ score }: { score: number }) {
  const { locale } = useI18n();
  // score: 100 = fresh (≤1 day), 80 = recent (≤7 days), 50 = aging (≤30 days), 25 = stale
  const color = score >= 80 ? '#16a34a' : score >= 50 ? '#c9872e' : '#dc2626';
  const label = locale === 'zh'
    ? (score >= 80 ? '新鲜' : score >= 50 ? '近期' : '老化')
    : (score >= 80 ? 'Fresh' : score >= 50 ? 'Recent' : 'Aging');
  const pulse = score >= 80;

  return (
    <div className="flex items-center gap-1 flex-shrink-0">
      <span
        className={`inline-block w-2 h-2 rounded-full flex-shrink-0${pulse ? ' animate-pulse' : ''}`}
        style={{
          backgroundColor: color,
          boxShadow: `0 0 4px ${color}40`,
        }}
      />
      <span className="text-[8px] font-semibold leading-none" style={{ color }}>
        {label}
      </span>
    </div>
  );
}

// ─── Trend helpers (shared) ───────────────────────────────────────────────────

export function getTrendDirection(data: number[], invert = false): 'up' | 'down' | 'flat' {
  if (!data || data.length < 2) return 'flat';
  const last = data[data.length - 1];
  const prev = data[data.length - 2];
  const diff = last - prev;
  const threshold = Math.max(Math.abs(prev) * 0.02, 0.01);
  if (Math.abs(diff) < threshold) return 'flat';
  if (invert) return diff < 0 ? 'up' : 'down';
  return diff > 0 ? 'up' : 'down';
}

export function getTrendColor(direction: 'up' | 'down' | 'flat', invert = false): string {
  if (direction === 'flat') return '#6b7280';
  if (invert) return direction === 'up' ? '#dc2626' : '#16a34a';
  return direction === 'up' ? '#16a34a' : '#dc2626';
}

// ─── Stat Card Skeleton (shared) ──────────────────────────────────────────────

export function StatCardSkeleton() {
  return (
    <div className="gradient-border-wrap h-full" style={{ '--gradient-border-color': '#9b9590' } as React.CSSProperties}>
      <div className="gradient-border-inner bg-claude-surface dark:bg-[#242220] p-3 sm:p-3.5 claude-card-shadow transition-transform duration-200 min-w-0 h-full flex flex-col">
        <div className="flex items-center gap-2 mb-1.5">
          <div className="h-7 w-7 rounded-md shimmer-skeleton flex-shrink-0" />
          <div className="h-3 w-16 sm:w-20 rounded shimmer-skeleton flex-1" />
          <div className="h-7 w-7 rounded-full shimmer-skeleton flex-shrink-0" />
        </div>
        <div className="h-6 sm:h-7 w-14 sm:w-16 rounded shimmer-skeleton mb-0.5" />
        <div className="h-2.5 w-16 sm:w-20 rounded shimmer-skeleton" />
      </div>
    </div>
  );
}
