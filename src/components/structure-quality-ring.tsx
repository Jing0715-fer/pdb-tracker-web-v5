'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';

/**
 * StructureQualityRing
 *
 * A circular progress ring showing a quality score (0-100) with
 * color-coded segments and animated fill.
 *
 * Used in structure cards and detail views to give an at-a-glance
 * quality assessment based on resolution, method, and impact factor.
 */

interface QualityBreakdown {
  resolution: number; // 0-35
  method: number; // 0-25
  impact: number; // 0-30
  coverage: number; // 0-10
}

interface StructureQualityRingProps {
  score: number; // 0-100
  breakdown?: QualityBreakdown;
  size?: number; // px diameter
  showLabel?: boolean;
  showBreakdown?: boolean;
  animate?: boolean;
}

function getScoreColor(score: number): string {
  if (score >= 80) return '#16a34a'; // green
  if (score >= 60) return '#2d8f8f'; // teal
  if (score >= 40) return '#c9872e'; // amber
  if (score >= 20) return '#ea580c'; // orange
  return '#dc2626'; // red
}

function getScoreLabel(score: number): string {
  if (score >= 80) return 'Excellent';
  if (score >= 60) return 'Good';
  if (score >= 40) return 'Fair';
  if (score >= 20) return 'Poor';
  return 'Very Poor';
}

export function StructureQualityRing({
  score,
  breakdown,
  size = 56,
  showLabel = true,
  showBreakdown = false,
  animate = true,
}: StructureQualityRingProps) {
  const color = useMemo(() => getScoreColor(score), [score]);
  const label = useMemo(() => getScoreLabel(score), [score]);

  const strokeWidth = size * 0.1; // 10% of size
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const fillLength = (score / 100) * circumference;
  const center = size / 2;

  // Breakdown segments (if provided)
  const segments = useMemo(() => {
    if (!breakdown) return null;
    const total = breakdown.resolution + breakdown.method + breakdown.impact + breakdown.coverage;
    if (total === 0) return null;

    const segs = [
      { value: breakdown.resolution, color: '#2d8f8f', label: 'Resolution' },
      { value: breakdown.method, color: '#7c5cbf', label: 'Method' },
      { value: breakdown.impact, color: '#c9872e', label: 'Impact' },
      { value: breakdown.coverage, color: '#16a34a', label: 'Coverage' },
    ].filter((s) => s.value > 0);

    let offset = 0;
    return segs.map((s) => {
      const length = (s.value / 100) * circumference;
      const segment = { ...s, length, offset };
      offset += length;
      return segment;
    });
  }, [breakdown, circumference]);

  return (
    <div className="flex items-center gap-3">
      {/* Ring */}
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="flex-shrink-0">
          {/* Background circle */}
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth={strokeWidth}
            className="text-claude-border-light dark:text-[#2b2926]"
          />
          {/* Score fill */}
          {segments ? (
            // Multi-segment breakdown
            segments.map((seg, i) => (
              <motion.circle
                key={i}
                cx={center}
                cy={center}
                r={radius}
                fill="none"
                stroke={seg.color}
                strokeWidth={strokeWidth}
                strokeDasharray={`${seg.length} ${circumference - seg.length}`}
                strokeDashoffset={-seg.offset}
                strokeLinecap="butt"
                transform={`rotate(-90 ${center} ${center})`}
                initial={animate ? { strokeDasharray: `0 ${circumference}` } : false}
                animate={{ strokeDasharray: `${seg.length} ${circumference - seg.length}` }}
                transition={{ delay: 0.2 + i * 0.1, duration: 0.5 }}
              />
            ))
          ) : (
            // Single color fill
            <motion.circle
              cx={center}
              cy={center}
              r={radius}
              fill="none"
              stroke={color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${fillLength} ${circumference - fillLength}`}
              strokeLinecap="round"
              transform={`rotate(-90 ${center} ${center})`}
              initial={animate ? { strokeDasharray: `0 ${circumference}` } : false}
              animate={{ strokeDasharray: `${fillLength} ${circumference - fillLength}` }}
              transition={{ duration: 0.8, ease: 'easeOut' }}
            />
          )}
        </svg>
        {/* Center text */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span
            className="font-bold tabular-nums leading-none"
            style={{ fontSize: size * 0.28, color }}
          >
            {score}
          </span>
          {showLabel && size >= 48 && (
            <span
              className="text-claude-text-muted uppercase mt-0.5"
              style={{ fontSize: size * 0.1 }}
            >
              /100
            </span>
          )}
        </div>
      </div>

      {/* Label + breakdown */}
      {showLabel && (
        <div className="flex flex-col">
          <span className="text-xs font-semibold" style={{ color }}>
            {label}
          </span>
          {showBreakdown && segments && (
            <div className="mt-1 space-y-0.5">
              {segments.map((seg, i) => (
                <div key={i} className="flex items-center gap-1.5 text-[9px]">
                  <span
                    className="inline-block w-2 h-2 rounded-full"
                    style={{ backgroundColor: seg.color }}
                  />
                  <span className="text-claude-text-muted">{seg.label}</span>
                  <span className="text-claude-text-secondary font-mono tabular-nums ml-auto">
                    {seg.value}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
