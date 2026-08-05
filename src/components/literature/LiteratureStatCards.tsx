'use client';

import React, { useMemo } from 'react';
import { FileText, BarChart3, Bookmark, Clock, BookOpen } from 'lucide-react';
import { StatCard, MethodDonut, TierBadge, FreshnessDot, CircularProgress, StatCardSkeleton } from '@/components/ui/stat-card';
import type { LitStats, LitPaper } from '@/lib/pdb-types';
import { formatRelativeTime } from '@/lib/pdb-utils';
import { useI18n } from '@/lib/i18n';

export interface ReadingProgressInfo {
  totalPapers: number;
  unreadCount: number;
  readingCount: number;
  readCount: number;
  progressPercentage: number;
}

interface LiteratureStatCardsProps {
  stats: LitStats | null;
  isLoading: boolean;
  readingProgress?: ReadingProgressInfo;
  papers?: LitPaper[];
}

// ─── IF Tier colors for donut ─────────────────────────────────────────────────

const IF_TIER_COLORS: Record<string, string> = {
  top: '#dc2626',
  high: '#ea580c',
  mid: '#16a34a',
  low: '#6b7280',
  unknown: '#9b9590',
};

// ─── Main Component ────────────────────────────────────────────────────────────

export function LiteratureStatCards({ stats, isLoading, readingProgress, papers }: LiteratureStatCardsProps) {
  const { locale } = useI18n();
  // IF tier distribution segments for the donut
  const ifTierSegments = useMemo(() => {
    if (!stats) return [];
    return stats.ifDistribution
      .filter(d => d.count > 0)
      .map(d => ({
        label: d.tier.charAt(0).toUpperCase() + d.tier.slice(1),
        value: d.count,
        color: IF_TIER_COLORS[d.tier] || '#6b7280',
      }));
  }, [stats]);

  // Method distribution segments for fallback donut
  const methodSegments = useMemo(() => {
    if (!stats) return [];
    return stats.methodDistribution
      .filter(d => d.count > 0)
      .map(d => {
        let color = '#6b7280';
        let label = d.method;
        if (d.method === 'Cryo-EM' || d.method === 'CRYO-EM' || d.method === 'ELECTRON MICROSCOPY') {
          color = '#2d8f8f'; label = 'Cryo-EM';
        } else if (d.method === 'X-RAY' || d.method === 'X-RAY DIFFRACTION') {
          color = '#7c5cbf'; label = 'X-ray';
        } else if (d.method === 'NMR' || d.method === 'SOLUTION NMR') {
          color = '#c9872e'; label = 'NMR';
        }
        return { label, value: d.count, color };
      });
  }, [stats]);

  // Freshness score for the Latest Update card
  const freshnessScore = useMemo(() => {
    if (!stats?.latestDate) return 0;
    try {
      const d = new Date(stats.latestDate as any);
      const now = new Date();
      const daysDiff = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
      if (daysDiff <= 1) return 100;
      if (daysDiff <= 7) return 80;
      if (daysDiff <= 30) return 50;
      return 25;
    } catch {
      return 0;
    }
  }, [stats]);

  // Avg IF tier
  const avgIfTier = useMemo(() => {
    const if_ = stats?.avgIf ?? 0;
    if (if_ >= 20) return 'top' as const;
    if (if_ >= 10) return 'high' as const;
    if (if_ >= 5) return 'mid' as const;
    if (if_ > 0) return 'low' as const;
    return 'unknown' as const;
  }, [stats]);

  // Top journal IF tier (must be before early return to satisfy rules-of-hooks)
  const topJournalIfTier = useMemo(() => {
    if (!stats) return 'unknown' as const;
    const topCount = stats.ifDistribution.find(d => d.tier === 'top')?.count ?? 0;
    const highCount = stats.ifDistribution.find(d => d.tier === 'high')?.count ?? 0;
    if (topCount > 0) return 'top' as const;
    if (highCount > 0) return 'high' as const;
    const midCount = stats.ifDistribution.find(d => d.tier === 'mid')?.count ?? 0;
    if (midCount > 0) return 'mid' as const;
    if (stats.totalPapers > 0) return 'low' as const;
    return 'unknown' as const;
  }, [stats]);

  // Determine which donut to use — prefer IF tier distribution
  const donutSegments = ifTierSegments.length > 0 ? ifTierSegments : methodSegments;

  if (isLoading || !stats) {
    return (
      <div className={`grid grid-cols-2 sm:grid-cols-4${readingProgress ? ' lg:grid-cols-5' : ''} gap-2 sm:gap-3 p-2 sm:p-3 [grid-auto-rows:1fr] stagger-list`}>
        {Array.from({ length: readingProgress ? 5 : 4 }).map((_, i) => (
          <div key={i} className="min-w-0 h-full">
            <StatCardSkeleton />
          </div>
        ))}
      </div>
    );
  }

  // Format latestDate
  const formatLatestDate = (date: string | number | null): { display: string; relative: string } => {
    if (!date) return { display: '—', relative: locale === 'zh' ? '暂无数据' : 'No data' };
    try {
      let d: Date;
      if (typeof date === 'number') {
        d = new Date(date);
      } else if (typeof date === 'string' && /^\d{10,13}$/.test(date.trim())) {
        d = new Date(parseInt(date.trim()));
      } else {
        d = new Date(date);
      }
      if (isNaN(d.getTime())) return { display: String(date), relative: locale === 'zh' ? '无效日期' : 'Invalid date' };
      const display = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
      const relative = formatRelativeTime(d.toISOString().slice(0, 10));
      return { display, relative };
    } catch {
      return { display: String(date), relative: locale === 'zh' ? '无效日期' : 'Invalid date' };
    }
  };

  const latestDateInfo = formatLatestDate(stats.latestDate as any);

  return (
    <div className={`grid grid-cols-2 sm:grid-cols-4${readingProgress ? ' lg:grid-cols-5' : ''} gap-2 sm:gap-3 p-2 sm:p-3 [grid-auto-rows:1fr] stagger-list`}>
      {/* Total Papers — IF Tier Distribution Donut */}
      <StatCard
        title={locale === 'zh' ? '论文总数' : 'Total Papers'}
        value={stats.totalPapers}
        icon={<FileText className="h-3.5 w-3.5 text-white" />}
        color="bg-gradient-to-br from-[#2d8f8f] to-[#1a6b6b]"
        glowColor="#2d8f8f"
        subtitle={locale === 'zh' ? `${stats.papersWithIf} 有 IF 数据` : `${stats.papersWithIf} with IF data`}
        loading={isLoading}
        delay={0}
        borderColor="#2d8f8f"
        tooltip={locale === 'zh' ? `论文总数: ${stats.totalPapers} (${stats.papersWithIf} 有 IF 数据)` : `Total Papers: ${stats.totalPapers} (${stats.papersWithIf} with IF data)`}
      >
        <MethodDonut segments={donutSegments} size={30} strokeWidth={3.5} />
      </StatCard>

      {/* Avg Impact Factor — Tier Badge */}
      <StatCard
        title={locale === 'zh' ? '平均影响因子' : 'Avg Impact Factor'}
        value={stats.avgIf ?? 0}
        decimals={2}
        icon={<BarChart3 className="h-3.5 w-3.5 text-white" />}
        color="bg-gradient-to-br from-[#c9872e] to-[#a06b1a]"
        glowColor="#c9872e"
        subtitle={locale === 'zh' ? `${stats.ifDistribution.find(d => d.tier === 'top')?.count ?? 0} 顶级` : `${stats.ifDistribution.find(d => d.tier === 'top')?.count ?? 0} top-tier`}
        loading={isLoading}
        delay={80}
        borderColor="#c9872e"
        tooltip={locale === 'zh' ? `平均 IF: ${(stats.avgIf ?? 0).toFixed(2)}` : `Avg IF: ${(stats.avgIf ?? 0).toFixed(2)}`}
      >
        <TierBadge tier={avgIfTier} />
      </StatCard>

      {/* Top Journal — Tier Badge */}
      <StatCard
        title={locale === 'zh' ? '顶级期刊' : 'Top Journal'}
        value={0}
        icon={<Bookmark className="h-3.5 w-3.5 text-white" />}
        color="bg-gradient-to-br from-[#7c5cbf] to-[#5a3d99]"
        glowColor="#7c5cbf"
        subtitle={locale === 'zh' ? `${stats.ifDistribution.find(d => d.tier === 'top')?.count ?? 0} 顶级` : `${stats.ifDistribution.find(d => d.tier === 'top')?.count ?? 0} top-tier`}
        loading={isLoading}
        delay={160}
        borderColor="#7c5cbf"
        isText
        textValue={stats.topJournal ?? '—'}
        tooltip={locale === 'zh' ? `顶级期刊: ${stats.topJournal ?? '无'}` : `Top Journal: ${stats.topJournal ?? 'None'}`}
      >
        <TierBadge tier={topJournalIfTier} compact />
      </StatCard>

      {/* Latest Update — Freshness Dot */}
      <StatCard
        title={locale === 'zh' ? '最新更新' : 'Latest Update'}
        value={0}
        icon={<Clock className="h-3.5 w-3.5 text-white" />}
        color="bg-gradient-to-br from-[#16a34a] to-[#0d7a35]"
        glowColor="#16a34a"
        subtitle={latestDateInfo.relative}
        loading={isLoading}
        delay={240}
        borderColor="#16a34a"
        isText
        textValue={latestDateInfo.display}
        tooltip={locale === 'zh' ? `最新: ${latestDateInfo.display} (${latestDateInfo.relative})` : `Latest: ${latestDateInfo.display} (${latestDateInfo.relative})`}
      >
        <FreshnessDot score={freshnessScore} />
      </StatCard>

      {/* 5th card: Reading Progress — circular progress (direct %) */}
      {readingProgress && (
        <StatCard
          title={locale === 'zh' ? '阅读进度' : 'Reading Progress'}
          value={readingProgress.progressPercentage}
          suffix="%"
          decimals={0}
          icon={<BookOpen className="h-3.5 w-3.5 text-white" />}
          color="bg-gradient-to-br from-[#2d8f8f] to-[#16a34a]"
          glowColor="#2d8f8f"
          subtitle={locale === 'zh'
            ? `${readingProgress.readCount} 已读 · ${readingProgress.readingCount} 阅读中`
            : `${readingProgress.readCount} read · ${readingProgress.readingCount} reading`}
          delay={320}
          borderColor="#2d8f8f"
          tooltip={locale === 'zh'
            ? `阅读: ${readingProgress.progressPercentage.toFixed(0)}% (${readingProgress.readCount} 已读, ${readingProgress.readingCount} 阅读中)`
            : `Reading: ${readingProgress.progressPercentage.toFixed(0)}% (${readingProgress.readCount} read, ${readingProgress.readingCount} reading)`}
        >
          <CircularProgress value={readingProgress.progressPercentage} max={100} color="#2d8f8f" size={28} />
        </StatCard>
      )}
    </div>
  );
}
