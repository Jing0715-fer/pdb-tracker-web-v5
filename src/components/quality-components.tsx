'use client';

import React from 'react';
import { getScoreColor } from '@/components/pdb-helpers';

// ─── Score Bar Component ─────────────────────────────────────────────────────

export function ScoreBar({ label, score, maxScore = 10 }: { label: string; score: number; maxScore?: number }) {
  const pct = Math.min((score / maxScore) * 100, 100);
  const color = getScoreColor(score);
  const isHigh = score >= 8;

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-claude-text-secondary">{label}</span>
        <span className="font-mono font-medium" style={{ color }}>{score.toFixed(1)}</span>
      </div>
      <div className="h-2 bg-claude-border-light rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full score-bar-fill transition-all duration-500 ${isHigh ? 'shadow-sm' : ''}`}
          style={{
            width: `${pct}%`,
            backgroundColor: color,
            '--score-width': `${pct}%`,
            ...(isHigh ? { boxShadow: `0 0 6px ${color}40` } : {}),
          } as React.CSSProperties}
        />
      </div>
    </div>
  );
}

// ─── Quality Ring Component ────────────────────────────────────────────────────

export function QualityRing({ score, size = 40 }: { score: number; size?: number }) {
  const radius = (size - 6) / 2;
  const circumference = 2 * Math.PI * radius;
  const progress = Math.max(0, Math.min(1, score / 100));
  const color = score >= 80 ? '#16a34a' : score >= 60 ? '#c9872e' : score >= 40 ? '#ea580c' : '#dc2626';

  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke="currentColor" strokeWidth={3} className="text-claude-border dark:text-[#3d3832]" />
      <circle cx={size/2} cy={size/2} r={radius} fill="none" stroke={color} strokeWidth={3} strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - progress)} style={{ transition: 'stroke-dashoffset 0.6s ease-out' }} />
    </svg>
  );
}
