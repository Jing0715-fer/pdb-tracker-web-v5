'use client';

import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useTheme } from 'next-themes';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Evaluation } from '@/lib/pdb-types';

// ─── Score Parsing ────────────────────────────────────────────────────────────

interface ScoreEntry {
  score: number;
  max?: number;
  description?: string;
}

function parseScores(scoresStr: string | null): Record<string, ScoreEntry> {
  if (!scoresStr) return {};
  try {
    const parsed = JSON.parse(scoresStr);
    const result: Record<string, ScoreEntry> = {};
    for (const [key, val] of Object.entries(parsed)) {
      if (typeof val === 'object' && val !== null && 'score' in (val as Record<string, unknown>)) {
        const v = val as Record<string, any>;
        // Accept both `max` (current) and `maxScore` (legacy field name) so
        // old Evaluation rows still render correctly. Default to 10 since
        // every score dimension is on a 1–10 scale — without this the radar
        // fell back to max=1, which clamped every axis to 100% radius and
        // made all targets look identical.
        result[key] = {
          score: v.score,
          max: v.max ?? v.maxScore ?? 10,
          description: v.description,
        };
      } else if (typeof val === 'number') {
        result[key] = { score: val, max: 10 };
      }
    }
    return result;
  } catch {
    return {};
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

interface RadarAxis {
  key: string;
  label: string;
  score: number;
  max: number;
}

interface RadarPolygon {
  evaluation: Evaluation;
  axes: RadarAxis[];
  color: string;
  colorLight: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const COMPARISON_COLORS = [
  { color: '#c96442', colorLight: 'rgba(201, 100, 66, 0.15)' },    // accent
  { color: '#2d8f8f', colorLight: 'rgba(45, 143, 143, 0.15)' },    // cryo-em
  { color: '#7c5cbf', colorLight: 'rgba(124, 92, 191, 0.15)' },    // xray
  { color: '#c9872e', colorLight: 'rgba(201, 135, 46, 0.15)' },    // nmr
  { color: '#16a34a', colorLight: 'rgba(22, 163, 74, 0.15)' },     // green
];

const GRID_LEVELS = [0.25, 0.50, 0.75, 1.0];
const THRESHOLD = 0.5;

// ─── Props ────────────────────────────────────────────────────────────────────

interface EvalScoreRadarProps {
  evaluation: Evaluation;
  comparisonEvaluations?: Evaluation[];
  size?: number;
}

// ─── SVG Radar Chart ──────────────────────────────────────────────────────────

export function EvalScoreRadar({
  evaluation,
  comparisonEvaluations = [],
  size = 240,
}: EvalScoreRadarProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const [hoveredAxis, setHoveredAxis] = useState<string | null>(null);

  // ─── Compute axes from primary evaluation ──────────────────────────────────

  const primaryScores = useMemo(() => parseScores(evaluation.scores), [evaluation.scores]);

  const axes: RadarAxis[] = useMemo(() => {
    const entries = Object.entries(primaryScores).filter(([key]) => key !== 'Overall');
    if (entries.length < 3) return [];
    return entries.map(([key, val]) => ({
      key,
      label: key.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
      score: val.score,
      max: val.max ?? 10,
    }));
  }, [primaryScores]);

  // ─── Build polygons ────────────────────────────────────────────────────────

  const polygons: RadarPolygon[] = useMemo(() => {
    const primary: RadarPolygon = {
      evaluation,
      axes,
      color: '#c96442',
      colorLight: 'rgba(201, 100, 66, 0.15)',
    };

    const comparisons = comparisonEvaluations.map((ev, idx) => {
      const scores = parseScores(ev.scores);
      const cAxes = axes.map((axis) => ({
        ...axis,
        score: scores[axis.key]?.score ?? 0,
        max: scores[axis.key]?.max ?? axis.max,
      }));
      const colorSet = COMPARISON_COLORS[(idx + 1) % COMPARISON_COLORS.length];
      return {
        evaluation: ev,
        axes: cAxes,
        color: colorSet.color,
        colorLight: colorSet.colorLight,
      };
    });

    return [primary, ...comparisons];
  }, [evaluation, comparisonEvaluations, axes]);

  if (axes.length < 3) {
    return null;
  }

  // ─── SVG layout calculations ──────────────────────────────────────────────

  const cx = size / 2;
  const cy = size / 2;
  const maxRadius = (size / 2) - 32; // Leave space for labels
  const numAxes = axes.length;
  const angleStep = (2 * Math.PI) / numAxes;

  // Get point on axis
  const getPoint = (axisIndex: number, value: number, max: number) => {
    const angle = axisIndex * angleStep - Math.PI / 2; // Start from top
    const normalizedValue = Math.min(value / max, 1);
    const r = normalizedValue * maxRadius;
    return {
      x: cx + r * Math.cos(angle),
      y: cy + r * Math.sin(angle),
    };
  };

  // Get axis end point (at max radius)
  const getAxisEnd = (axisIndex: number) => {
    const angle = axisIndex * angleStep - Math.PI / 2;
    return {
      x: cx + maxRadius * Math.cos(angle),
      y: cy + maxRadius * Math.sin(angle),
    };
  };

  // Get label position (outside the chart)
  const getLabelPos = (axisIndex: number) => {
    const angle = axisIndex * angleStep - Math.PI / 2;
    const labelRadius = maxRadius + 18;
    return {
      x: cx + labelRadius * Math.cos(angle),
      y: cy + labelRadius * Math.sin(angle),
    };
  };

  // Build polygon path
  const buildPolygonPath = (polygon: RadarPolygon) => {
    const points = polygon.axes.map((axis, idx) => {
      const pt = getPoint(idx, axis.score, axis.max);
      return `${pt.x},${pt.y}`;
    });
    return `M${points.join(' L')} Z`;
  };

  // Build animated polygon path (from center)
  const buildCenterPath = () => {
    const points = axes.map((_, idx) => `${cx},${cy}`);
    return `M${points.join(' L')} Z`;
  };

  // Grid colors
  const gridStroke = isDark ? '#3d3832' : '#e8e4dd';
  const axisStroke = isDark ? '#4a4540' : '#d4cfc8';
  const textColor = isDark ? '#9b9590' : '#6b6560';
  const textColorMuted = isDark ? '#6b6560' : '#9b9590';

  return (
    <div className="space-y-2">
      <h4 className="text-[11px] font-semibold text-claude-text uppercase tracking-wider">
        Score Radar
      </h4>
      <div className="chart-container chart-inner-shadow rounded-lg p-3 bg-claude-surface dark:bg-[#242220] border border-claude-border-light dark:border-[#2b2926]">
        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          className="mx-auto"
        >
          <defs>
            {/* Gradient for primary polygon fill */}
            <linearGradient id="radar-gradient-primary" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#2d8f8f" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#7c5cbf" stopOpacity="0.25" />
            </linearGradient>
            <linearGradient id="radar-gradient-primary-dark" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#3db5b5" stopOpacity="0.2" />
              <stop offset="100%" stopColor="#9b7ed8" stopOpacity="0.2" />
            </linearGradient>
          </defs>

          {/* Concentric grid circles */}
          {GRID_LEVELS.map((level, idx) => {
            const r = level * maxRadius;
            return (
              <circle
                key={`grid-${idx}`}
                cx={cx}
                cy={cy}
                r={r}
                fill="none"
                stroke={gridStroke}
                strokeWidth={0.5}
                strokeDasharray={idx === 0 ? 'none' : '2 2'}
              />
            );
          })}

          {/* Grid level labels */}
          {GRID_LEVELS.map((level, idx) => {
            const r = level * maxRadius;
            return (
              <text
                key={`grid-label-${idx}`}
                x={cx + 3}
                y={cy - r + 3}
                fontSize={7}
                fill={textColorMuted}
                fontFamily="monospace"
              >
                {level.toFixed(2)}
              </text>
            );
          })}

          {/* Threshold ring at 0.5 */}
          <circle
            cx={cx}
            cy={cy}
            r={THRESHOLD * maxRadius}
            fill="none"
            stroke="#c9872e"
            strokeWidth={1}
            strokeDasharray="4 3"
            opacity={0.6}
          />
          <text
            x={cx + THRESHOLD * maxRadius + 2}
            y={cy - 2}
            fontSize={6}
            fill="#c9872e"
            opacity={0.7}
            fontFamily="monospace"
          >
            min
          </text>

          {/* Axis lines */}
          {axes.map((_, idx) => {
            const end = getAxisEnd(idx);
            return (
              <line
                key={`axis-${idx}`}
                x1={cx}
                y1={cy}
                x2={end.x}
                y2={end.y}
                stroke={axisStroke}
                strokeWidth={0.5}
              />
            );
          })}

          {/* Comparison polygons (behind primary) */}
          {polygons.slice(1).map((polygon, pIdx) => (
            <motion.path
              key={`polygon-compare-${pIdx}`}
              d={buildCenterPath()}
              animate={{ d: buildPolygonPath(polygon) }}
              transition={{ duration: 0.8, delay: 0.2 + pIdx * 0.1, ease: 'easeOut' }}
              fill={polygon.colorLight}
              stroke={polygon.color}
              strokeWidth={1.5}
              strokeOpacity={0.7}
            />
          ))}

          {/* Primary polygon with gradient fill */}
          <motion.path
            d={buildCenterPath()}
            animate={{ d: buildPolygonPath(polygons[0]) }}
            transition={{ duration: 0.8, delay: 0.1, ease: 'easeOut' }}
            fill={isDark ? 'url(#radar-gradient-primary-dark)' : 'url(#radar-gradient-primary)'}
            stroke={isDark ? '#d4784f' : '#c96442'}
            strokeWidth={2}
          />

          {/* Data points and axis labels */}
          {axes.map((axis, idx) => {
            const labelPos = getLabelPos(idx);
            const pt = getPoint(idx, axis.score, axis.max);
            const isHovered = hoveredAxis === axis.key;

            return (
              <g key={`axis-label-${idx}`}>
                {/* Data point dot */}
                <motion.circle
                  cx={cx}
                  cy={cy}
                  r={isHovered ? 4.5 : 3}
                  animate={{
                    cx: pt.x,
                    cy: pt.y,
                  }}
                  transition={{ duration: 0.8, delay: 0.1 + idx * 0.02, ease: 'easeOut' }}
                  fill={isDark ? '#d4784f' : '#c96442'}
                  stroke={isDark ? '#242220' : '#ffffff'}
                  strokeWidth={1.5}
                  className="cursor-pointer"
                  onMouseEnter={() => setHoveredAxis(axis.key)}
                  onMouseLeave={() => setHoveredAxis(null)}
                />

                {/* Axis label */}
                <text
                  x={labelPos.x}
                  y={labelPos.y}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={8}
                  fill={isHovered ? (isDark ? '#d4784f' : '#c96442') : textColor}
                  fontWeight={isHovered ? 600 : 400}
                  className="select-none"
                >
                  {axis.label.length > 14 ? axis.label.slice(0, 12) + '…' : axis.label}
                </text>

                {/* Score value tooltip on hover */}
                {isHovered && (
                  <g>
                    <rect
                      x={pt.x - 24}
                      y={pt.y - 22}
                      width={48}
                      height={16}
                      rx={4}
                      fill={isDark ? '#2b2926' : '#ffffff'}
                      stroke={isDark ? '#3d3832' : '#e8e4dd'}
                      strokeWidth={0.5}
                    />
                    <text
                      x={pt.x}
                      y={pt.y - 12}
                      textAnchor="middle"
                      fontSize={8}
                      fill={isDark ? '#e8e4dd' : '#1a1a1a'}
                      fontWeight={600}
                      fontFamily="monospace"
                    >
                      {axis.score.toFixed(2)}
                    </text>
                  </g>
                )}
              </g>
            );
          })}
        </svg>

        {/* Legend for comparison evaluations */}
        {comparisonEvaluations.length > 0 && (
          <div className="flex flex-wrap gap-3 mt-2 justify-center">
            {polygons.map((polygon, idx) => (
              <div key={idx} className="flex items-center gap-1.5">
                <span
                  className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                  style={{ backgroundColor: polygon.color }}
                />
                <span className="text-[9px] text-claude-text-secondary font-medium">
                  {idx === 0
                    ? 'Primary'
                    : polygon.evaluation.proteinName || polygon.evaluation.uniprotId}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* Threshold legend */}
        <div className="flex items-center justify-center gap-4 mt-1.5">
          <div className="flex items-center gap-1.5">
            <span
              className="w-4 h-0 border-t-2 border-dashed"
              style={{ borderColor: '#c9872e' }}
            />
            <span className="text-[8px] text-claude-text-muted">Threshold (0.5)</span>
          </div>
        </div>
      </div>
    </div>
  );
}
