'use client';

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  FlaskConical,
  Database,
  Target,
  CheckCircle2,
} from 'lucide-react';
import { StatCard, CircularProgress, MiniBar } from '@/components/ui/stat-card';
import type { Evaluation, EvalBatch } from '@/lib/pdb-types';
import { useI18n } from '@/lib/i18n';

/**
 * EvalStatsCards (standalone)
 *
 * A row of stat cards for the Evaluation mode, shown in the shared stats area
 * (same position as StructureStatsCards in Weekly mode).
 *
 * Cards:
 *   1. Eval Targets — with completion rate ring
 *   2. Batches — with mini bar
 *   3. Avg Coverage — with coverage ring
 *   4. ≥80% Coverage — with mini bar
 */

interface EvalStatsCardsProps {
  evaluations: Evaluation[];
  evalBatches?: EvalBatch[];
  evalLoading?: boolean;
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
  const highCoveragePct = totalEvals > 0 ? (highCoverageCount / totalEvals) * 100 : 0;

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
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 p-2 sm:p-3 [grid-auto-rows:1fr] min-w-0 stagger-list">
      <StatCard
        title={locale === 'zh' ? '评估靶点' : 'Eval Targets'}
        value={totalEvals}
        icon={<FlaskConical className="h-3.5 w-3.5 text-white" />}
        color="bg-gradient-to-br from-[#2d8f8f] to-[#1a6b6b]"
        glowColor="#2d8f8f"
        subtitle={locale === 'zh' ? `${totalBatches} 个批次 · ${completionRate.toFixed(0)}% 完成` : `${totalBatches} batch${totalBatches !== 1 ? 'es' : ''} · ${completionRate.toFixed(0)}% done`}
        loading={evalLoading}
        delay={0}
        borderColor="#2d8f8f"
        tooltip={locale === 'zh' ? `评估靶点: ${totalEvals} (${completionRate.toFixed(0)}% 完成, ${totalBatches} 个批次)` : `Eval Targets: ${totalEvals} (${completionRate.toFixed(0)}% complete, ${totalBatches} batches)`}
      >
        <CircularProgress value={completionRate} max={100} color="#2d8f8f" size={28} />
      </StatCard>

      <StatCard
        title={locale === 'zh' ? '批量评估' : 'Batches'}
        value={totalBatches}
        icon={<Database className="h-3.5 w-3.5 text-white" />}
        color="bg-gradient-to-br from-[#c9872e] to-[#a06b1a]"
        glowColor="#c9872e"
        subtitle={locale === 'zh' ? `${totalEvals} 个评估 · 平均 ${(totalEvals / Math.max(totalBatches, 1)).toFixed(1)}` : `${totalEvals} evals · ${(totalEvals / Math.max(totalBatches, 1)).toFixed(1)} avg`}
        loading={evalLoading}
        delay={80}
        borderColor="#c9872e"
        tooltip={locale === 'zh' ? `批次: ${totalBatches} (${totalEvals} 个评估, 平均 ${(totalEvals / Math.max(totalBatches, 1)).toFixed(1)} 评估/批次)` : `Batches: ${totalBatches} (${totalEvals} evaluations, avg ${(totalEvals / Math.max(totalBatches, 1)).toFixed(1)} evals/batch)`}
      >
        <MiniBar value={totalBatches > 0 ? Math.min((totalBatches / Math.max(totalEvals, 1)) * 100 * 3, 100) : 0} max={100} color="#c9872e" width={40} height={5} />
      </StatCard>

      <StatCard
        title={locale === 'zh' ? '平均覆盖率' : 'Avg Coverage'}
        value={avgCoverage}
        suffix="%"
        decimals={0}
        icon={<Target className="h-3.5 w-3.5 text-white" />}
        color="bg-gradient-to-br from-[#7c5cbf] to-[#5a3d99]"
        glowColor="#7c5cbf"
        subtitle={locale === 'zh' ? `${highCoverageCount} 高 (≥80%)` : `${highCoverageCount} high (≥80%)`}
        loading={evalLoading}
        delay={160}
        borderColor="#7c5cbf"
        tooltip={locale === 'zh' ? `平均覆盖率: ${avgCoverage.toFixed(1)}% (${highCoverageCount} 高 ≥80%)` : `Avg Coverage: ${avgCoverage.toFixed(1)}% (${highCoverageCount} high ≥80%)`}
      >
        <CircularProgress value={avgCoverage} max={100} color="#7c5cbf" size={28} />
      </StatCard>

      <StatCard
        title={locale === 'zh' ? '≥80% 覆盖率' : '≥80% Coverage'}
        value={highCoverageCount}
        icon={<CheckCircle2 className="h-3.5 w-3.5 text-white" />}
        color="bg-gradient-to-br from-[#16a34a] to-[#0d7a35]"
        glowColor="#16a34a"
        subtitle={totalEvals > 0 ? (locale === 'zh' ? `${((highCoverageCount / totalEvals) * 100).toFixed(0)}% 占比` : `${((highCoverageCount / totalEvals) * 100).toFixed(0)}% of total`) : (locale === 'zh' ? '暂无数据' : 'No data')}
        loading={evalLoading}
        delay={240}
        borderColor="#16a34a"
        tooltip={locale === 'zh' ? `高覆盖: ${highCoverageCount} 个靶点 ≥80% (${totalEvals > 0 ? ((highCoverageCount / totalEvals) * 100).toFixed(0) : 0}%)` : `High Coverage: ${highCoverageCount} targets ≥80% (${totalEvals > 0 ? ((highCoverageCount / totalEvals) * 100).toFixed(0) : 0}%)`}
      >
        <MiniBar value={highCoveragePct} max={100} color="#16a34a" width={40} height={5} />
      </StatCard>
    </div>
  );
}
