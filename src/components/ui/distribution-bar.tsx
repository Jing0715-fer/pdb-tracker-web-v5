'use client';

import React, { useState, useEffect, useMemo } from 'react';

// ─── Unified Distribution Bar Component ──────────────────────────────────────
// Shared across Literature, Weekly, and Evaluation modules for consistent styling.

export interface DistributionSegment {
  label: string;
  count: number;
  color: string;
}

export interface DistributionBarProps {
  /** Array of segments to display in the bar */
  segments: DistributionSegment[];
  /** SVG width in px (default 90) */
  width?: number;
  /** SVG height in px (default 6) */
  height?: number;
  /** Whether to show the background track (default true) */
  showTrack?: boolean;
  /** Whether to show the legend row below the bar (default true) */
  showLegend?: boolean;
  /** Segment fill opacity (default 0.8) */
  fillOpacity?: number;
  /** Whether to filter out segments with count === 0 from legend (default true) */
  hideZeroInLegend?: boolean;
}

export function DistributionBar({
  segments,
  width = 90,
  height = 6,
  showTrack = true,
  showLegend = true,
  fillOpacity = 0.8,
  hideZeroInLegend = true,
}: DistributionBarProps) {
  const [animated, setAnimated] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setAnimated(true), 300);
    return () => clearTimeout(timer);
  }, []);

  const total = useMemo(() => {
    return segments.reduce((sum, s) => sum + s.count, 0) || 1;
  }, [segments]);

  const computed = useMemo(() => {
    return segments.map(seg => ({
      ...seg,
      pct: seg.count / total,
    }));
  }, [segments, total]);

  const cumulativeX = computed.reduce<number[]>((acc, seg, i) => {
    const prev = i === 0 ? 0 : acc[i - 1] + computed[i - 1].pct * width;
    acc.push(prev);
    return acc;
  }, []);

  // Determine which segments are visible (non-zero) for rx rounding
  const visibleIndices = computed
    .map((s, i) => (s.count > 0 ? i : -1))
    .filter(i => i >= 0);
  const firstVisibleIdx = visibleIndices[0] ?? 0;
  const lastVisibleIdx = visibleIndices[visibleIndices.length - 1] ?? computed.length - 1;

  const legendSegments = hideZeroInLegend
    ? computed.filter(s => s.count > 0)
    : computed;

  return (
    <div className="flex flex-col gap-1">
      <svg width={width} height={height} className="flex-shrink-0">
        {/* Background track */}
        {showTrack && (
          <rect
            x={0}
            y={0}
            width={width}
            height={height}
            rx={height / 2}
            className="fill-claude-border dark:fill-[#3d3832]"
            opacity={0.35}
          />
        )}
        {/* Segments - CSS-only animated with transition */}
        {computed.map((seg, i) => {
          if (seg.count === 0) return null;
          const segWidth = seg.pct * width;
          const startX = cumulativeX[i];
          const isFirst = i === firstVisibleIdx;
          const isLast = i === lastVisibleIdx;
          const rx = isFirst || isLast ? height / 2 : 0;

          return (
            <rect
              key={`${seg.label}-${i}`}
              x={startX}
              y={0}
              width={animated ? segWidth : 0}
              height={height}
              rx={rx}
              fill={seg.color}
              opacity={fillOpacity}
              style={{
                transition: `width 0.5s ease-out ${0.3 + i * 0.08}s`,
              }}
            />
          );
        })}
      </svg>
      {/* Legend */}
      {showLegend && legendSegments.length > 0 && (
        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
          {legendSegments.map((seg, i) => (
            <div key={`${seg.label}-${i}`} className="flex items-center gap-0.5">
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ backgroundColor: seg.color }}
              />
              <span className="text-[8px] text-claude-text-muted font-mono leading-none">
                {seg.label} {seg.count}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
