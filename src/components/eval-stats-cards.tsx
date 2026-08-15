'use client';

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  FlaskConical,
  Database,
  Target,
  CheckCircle2,
  Microscope,
} from 'lucide-react';
import type { Evaluation, EvalBatch } from '@/lib/pdb-types';
import { useI18n } from '@/lib/i18n';

/**
 * EvalStatsCards (standalone)
 *
 * A row of stat cards for the Evaluation mode, using the SAME style as
 * StructureStatsCards (kpi-card-enhanced) for visual consistency.
 *
 * Cards:
 *   1. Eval Targets — with completion percentage
 *   2. Batches — with batch count
 *   3. Avg Coverage — with coverage percentage
 *   4. ≥80% Coverage — with count
 */

interface EvalStatsCardsProps {
  evaluations: Evaluation[];
  evalBatches?: EvalBatch[];
  evalLoading?: boolean;
}

// Same StatCard component as StructureStatsCards for visual consistency
function StatCard({ icon: Icon, label, value, suffix, gradient, delay, children }: {
  icon: typeof Microscope;
  label: string;
  value: string | number;
  suffix?: string;
  gradient: string;
  delay: number;
  children?: React.ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
      className="kpi-card-enhanced relative flex flex-col rounded-xl border border-claude-border/50 dark:border-[#3d3832]/50 bg-white/60 dark:bg-[#242220]/60 backdrop-blur-sm overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center gap-2 px-2.5 pt-2.5 pb-1.5">
        <div
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${gradient} shadow-sm`}
        >
          <Icon className="h-3.5 w-3.5 text-white" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[9px] font-medium text-claude-text-muted uppercase tracking-wide truncate">
            {label}
          </div>
          <div className="flex items-baseline gap-0.5">
            <span className="text-base font-bold text-claude-text tabular-nums leading-tight">{value}</span>
            {suffix && (
              <span className="text-[9px] font-normal text-claude-text-muted">{suffix}</span>
            )}
          </div>
        </div>
      </div>
      {/* Mini visualization */}
      {children && (
        <div className="flex-1 min-h-[48px] px-1.5 pb-1.5">
          {children}
        </div>
      )}
    </motion.div>
  );
}

// Mini progress bar (same style as StructureStatsCards MiniBar)
function MiniBar({ value, max, color }: { value: number; max: number; color: string }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="w-full h-1.5 rounded-full bg-claude-border-light dark:bg-[#2b2926] overflow-hidden">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.5, ease: 'easeOut' }}
        className="h-full rounded-full"
        style={{ backgroundColor: color }}
      />
    </div>
  );
}

// Circular progress (simplified, same visual style)
function MiniRing({ value, max, color, size = 40 }: { value: number; max: number; color: string; size?: number }) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  const radius = (size - 6) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;
  return (
    <div className="flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" strokeWidth={3} className="text-claude-border-light dark:text-[#2b2926]" />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
        />
      </svg>
      <span className="absolute text-[9px] font-bold text-claude-text tabular-nums">
        {pct.toFixed(0)}%
      </span>
    </div>
  );
}

export function EvalStatsCards({
  evaluations,
  evalBatches = [],
  evalLoading = false,
}: EvalStatsCardsProps) {
  const { locale } = useI18n();
  const totalEvals = evaluations.length;
  const totalBatches = evalBatches.length;

  const avgCoverage = useMemo(() => {
    const withCoverage = evaluations.filter(e => e.coverage != null);
    if (withCoverage.length === 0) return 0;
    return withCoverage.reduce((sum, e) => sum + (e.coverage ?? 0), 0) / withCoverage.length;
  }, [evaluations]);

  const highCoverageCount = evaluations.filter(e => (e.coverage ?? 0) >= 80).length;

  const completionRate = useMemo(() => {
    if (totalEvals === 0) return 0;
    const completedCount = evaluations.filter(e => {
      const hasPdb = (e.pdbStructures?.length ?? 0) > 0;
      const hasBlast = (e.blastResults?.length ?? 0) > 0;
      const hasReport = !!e.report;
      return hasPdb && hasBlast && hasReport;
    }).length;
    return (completedCount / totalEvals) * 100;
  }, [evaluations, totalEvals]);

  if (totalEvals === 0 && !evalLoading) return null;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 p-2 sm:p-3 [grid-auto-rows:1fr] min-w-0">
      {/* Eval Targets — completion ring */}
      <StatCard
        icon={FlaskConical}
        label={locale === 'zh' ? '评估靶点' : 'Eval Targets'}
        value={totalEvals}
        gradient="from-[#2d8f8f] to-[#1a6b6b]"
        delay={0}
      >
        <div className="flex items-center justify-center h-full">
          <MiniRing value={completionRate} max={100} color="#2d8f8f" size={40} />
        </div>
      </StatCard>

      {/* Batches — mini bar */}
      <StatCard
        icon={Database}
        label={locale === 'zh' ? '批量评估' : 'Batches'}
        value={totalBatches}
        gradient="from-[#c9872e] to-[#a06b1a]"
        delay={0.08}
      >
        <div className="flex items-center gap-2 h-full px-1">
          <MiniBar value={totalBatches} max={Math.max(totalEvals, 1)} color="#c9872e" />
          <span className="text-[9px] text-claude-text-muted shrink-0">
            {totalEvals > 0 ? (totalEvals / Math.max(totalBatches, 1)).toFixed(1) : '0'} avg
          </span>
        </div>
      </StatCard>

      {/* Avg Coverage — coverage ring */}
      <StatCard
        icon={Target}
        label={locale === 'zh' ? '平均覆盖率' : 'Avg Coverage'}
        value={avgCoverage.toFixed(0)}
        suffix="%"
        gradient="from-[#7c5cbf] to-[#5a3d99]"
        delay={0.16}
      >
        <div className="flex items-center justify-center h-full">
          <MiniRing value={avgCoverage} max={100} color="#7c5cbf" size={40} />
        </div>
      </StatCard>

      {/* ≥80% Coverage — mini bar */}
      <StatCard
        icon={CheckCircle2}
        label={locale === 'zh' ? '≥80% 覆盖率' : '≥80% Coverage'}
        value={highCoverageCount}
        gradient="from-[#16a34a] to-[#0d7a35]"
        delay={0.24}
      >
        <div className="flex items-center gap-2 h-full px-1">
          <MiniBar value={highCoverageCount} max={Math.max(totalEvals, 1)} color="#16a34a" />
          <span className="text-[9px] text-claude-text-muted shrink-0">
            {totalEvals > 0 ? ((highCoverageCount / totalEvals) * 100).toFixed(0) : 0}%
          </span>
        </div>
      </StatCard>
    </div>
  );
}
