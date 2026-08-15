'use client';

import React, { useMemo } from 'react';
import { useTheme } from 'next-themes';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Award, TrendingUp, Microscope, BookOpen, ChevronRight } from 'lucide-react';
import type { PdbEntry } from '@/lib/pdb-types';
import { computeQualityScore } from '@/lib/pdb-utils';
import { useI18n } from '@/lib/i18n';

interface QualityScoreDashboardProps {
  entries: PdbEntry[];
  onSelectEntry?: (pdbId: string) => void;
  locale?: 'zh' | 'en';
}

const TIER_CONFIG = [
  { min: 80, max: 100, labelZh: '优秀', labelEn: 'Excellent', color: '#22c55e', bg: '#22c55e20' },
  { min: 60, max: 79, labelZh: '良好', labelEn: 'Good', color: '#3b82f6', bg: '#3b82f620' },
  { min: 40, max: 59, labelZh: '一般', labelEn: 'Fair', color: '#f59e0b', bg: '#f59e0b20' },
  { min: 0, max: 39, labelZh: '较差', labelEn: 'Poor', color: '#ef4444', bg: '#ef444420' },
] as const;

export function QualityScoreDashboard({ entries, onSelectEntry, locale: propLocale }: QualityScoreDashboardProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const { locale: ctxLocale } = useI18n();
  const loc = propLocale === 'zh' ? 'zh' : (ctxLocale || 'en');

  const scored = useMemo(() => {
    return entries
      .map(e => ({ entry: e, quality: computeQualityScore(e) }))
      .sort((a, b) => b.quality.score - a.quality.score);
  }, [entries]);

  const stats = useMemo(() => {
    if (scored.length === 0) return null;
    const tiers = TIER_CONFIG.map(t => ({
      ...t,
      count: scored.filter(s => s.quality.score >= t.min && s.quality.score <= t.max).length,
    }));
    const avgScore = scored.reduce((s, x) => s + x.quality.score, 0) / scored.length;
    const avgRes = scored
      .filter(s => s.entry.resolution != null)
      .reduce((s, x) => s + (x.entry.resolution || 0), 0) / Math.max(1, scored.filter(s => s.entry.resolution != null).length);
    const avgIf = scored
      .filter(s => s.entry.journalIf != null && s.entry.journalIf > 0)
      .reduce((s, x) => s + (x.entry.journalIf || 0), 0) / Math.max(1, scored.filter(s => s.entry.journalIf != null && s.entry.journalIf > 0).length);
    const top5 = scored.slice(0, 5);
    return { tiers, avgScore, avgRes, avgIf, top5, total: scored.length };
  }, [scored]);

  if (!stats || stats.total === 0) {
    return (
      <div className="rounded-lg border border-border/40 bg-card/30 p-4 flex items-center gap-3 text-muted-foreground">
        <Award className="w-4 h-4 shrink-0" />
        <span className="text-xs">{loc === 'zh' ? '暂无质量评分数据' : 'No quality score data'}</span>
      </div>
    );
  }

  const textColor = isDark ? '#e5e5e5' : '#1f2937';
  const mutedColor = isDark ? '#9b9590' : '#6b7280';
  const borderColor = isDark ? '#3d3832' : '#e5e7eb';

  // Gauge arc for average score
  const avgScoreInt = Math.round(stats.avgScore);
  const gaugeRadius = 42;
  const gaugeCircumference = 2 * Math.PI * gaugeRadius;
  const gaugeOffset = gaugeCircumference * (1 - avgScoreInt / 100);
  const avgTier = TIER_CONFIG.find(t => avgScoreInt >= t.min && avgScoreInt <= t.max) || TIER_CONFIG[3];

  return (
    <div className="rounded-lg border border-border/60 bg-card/50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/40 bg-muted/30">
        <div className="flex items-center gap-2">
          <Award className="w-4 h-4 text-amber-500 dark:text-amber-400" />
          <span className="text-xs font-semibold text-foreground">
            {loc === 'zh' ? '结构质量评分仪表盘' : 'Structure Quality Dashboard'}
          </span>
        </div>
        <span className="text-[10px] font-mono text-muted-foreground">n={stats.total}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4">
        {/* Left: Average score gauge */}
        <div className="flex flex-col items-center justify-center">
          <div className="relative" style={{ width: 110, height: 110 }}>
            <svg width="110" height="110" viewBox="0 0 110 110">
              <circle
                cx="55" cy="55" r={gaugeRadius}
                fill="none"
                stroke={borderColor}
                strokeWidth="8"
                opacity="0.3"
              />
              <circle
                cx="55" cy="55" r={gaugeRadius}
                fill="none"
                stroke={avgTier.color}
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={gaugeCircumference}
                strokeDashoffset={gaugeOffset}
                transform="rotate(-90 55 55)"
                style={{ transition: 'stroke-dashoffset 0.8s ease-out' }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-2xl font-bold tabular-nums" style={{ color: avgTier.color }}>
                {avgScoreInt}
              </span>
              <span className="text-[9px] font-medium" style={{ color: mutedColor }}>
                {loc === 'zh' ? '平均分' : 'Avg Score'}
              </span>
            </div>
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: avgTier.color }} />
            <span className="text-[10px] font-medium" style={{ color: avgTier.color }}>
              {loc === 'zh' ? avgTier.labelZh : avgTier.labelEn}
            </span>
          </div>
        </div>

        {/* Middle: Tier distribution */}
        <div className="flex flex-col justify-center gap-1.5">
          <div className="text-[10px] font-medium mb-1" style={{ color: mutedColor }}>
            {loc === 'zh' ? '质量分布' : 'Quality Distribution'}
          </div>
          {stats.tiers.map(tier => {
            const pct = stats.total > 0 ? (tier.count / stats.total) * 100 : 0;
            return (
              <Tooltip key={tier.labelEn}>
                <TooltipTrigger asChild>
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-2 h-2 rounded-sm shrink-0" style={{ backgroundColor: tier.color }} />
                    <span className="text-[10px] w-12 shrink-0" style={{ color: textColor }}>
                      {loc === 'zh' ? tier.labelZh : tier.labelEn}
                    </span>
                    <div className="flex-1 h-3 rounded-sm overflow-hidden" style={{ backgroundColor: isDark ? '#2b2926' : '#f3f4f6' }}>
                      <div
                        className="h-full rounded-sm transition-all duration-500"
                        style={{ width: `${pct}%`, backgroundColor: tier.color, opacity: 0.85 }}
                      />
                    </div>
                    <span className="text-[10px] font-mono w-6 text-right tabular-nums" style={{ color: textColor }}>
                      {tier.count}
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="top" className="text-xs">
                  <p className="font-medium">{loc === 'zh' ? tier.labelZh : tier.labelEn} ({tier.min}-{tier.max})</p>
                  <p className="text-muted-foreground">{tier.count} / {stats.total} ({pct.toFixed(0)}%)</p>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>

        {/* Right: Average metrics */}
        <div className="grid grid-cols-3 gap-2 items-center">
          <div className="text-center">
            <div className="flex items-center justify-center mb-0.5">
              <Microscope className="w-3 h-3" style={{ color: mutedColor }} />
            </div>
            <div className="text-sm font-bold tabular-nums" style={{ color: textColor }}>
              {stats.avgRes > 0 ? stats.avgRes.toFixed(1) : '—'}
            </div>
            <div className="text-[8px]" style={{ color: mutedColor }}>
              {loc === 'zh' ? '平均分辨率' : 'Avg Res'} (Å)
            </div>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center mb-0.5">
              <BookOpen className="w-3 h-3" style={{ color: mutedColor }} />
            </div>
            <div className="text-sm font-bold tabular-nums" style={{ color: textColor }}>
              {stats.avgIf > 0 ? stats.avgIf.toFixed(1) : '—'}
            </div>
            <div className="text-[8px]" style={{ color: mutedColor }}>
              {loc === 'zh' ? '平均IF' : 'Avg IF'}
            </div>
          </div>
          <div className="text-center">
            <div className="flex items-center justify-center mb-0.5">
              <TrendingUp className="w-3 h-3" style={{ color: mutedColor }} />
            </div>
            <div className="text-sm font-bold tabular-nums" style={{ color: textColor }}>
              {stats.top5[0]?.quality.score || '—'}
            </div>
            <div className="text-[8px]" style={{ color: mutedColor }}>
              {loc === 'zh' ? '最高分' : 'Top Score'}
            </div>
          </div>
        </div>
      </div>

      {/* Top 5 structures */}
      <div className="border-t border-border/40 bg-muted/10 px-4 py-2.5">
        <div className="flex items-center gap-1.5 mb-2">
          <Award className="w-3 h-3 text-amber-500" />
          <span className="text-[10px] font-medium" style={{ color: mutedColor }}>
            {loc === 'zh' ? '质量评分 Top 5' : 'Top 5 by Quality Score'}
          </span>
        </div>
        <div className="space-y-1">
          {stats.top5.map((item, idx) => {
            const { entry, quality } = item;
            const tier = TIER_CONFIG.find(t => quality.score >= t.min && quality.score <= t.max) || TIER_CONFIG[3];
            return (
              <button
                key={entry.pdbId}
                onClick={() => onSelectEntry?.(entry.pdbId)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/60 transition-colors group"
                style={{ borderLeft: `3px solid ${tier.color}` }}
              >
                <span className="text-[10px] font-mono font-bold w-4 text-center" style={{ color: mutedColor }}>
                  {idx + 1}
                </span>
                <span className="text-[10px] font-mono font-semibold w-14 shrink-0" style={{ color: textColor }}>
                  {entry.pdbId}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] truncate text-left" style={{ color: textColor }}>
                    {(entry.title || 'Untitled').slice(0, 50)}
                  </div>
                  <div className="flex items-center gap-2 text-[9px]" style={{ color: mutedColor }}>
                    <span>{entry.method?.includes('ELECTRON') || entry.method?.includes('CRYO') ? 'Cryo-EM' : entry.method?.includes('X-RAY') ? 'X-ray' : entry.method?.includes('NMR') ? 'NMR' : 'Other'}</span>
                    {entry.resolution != null && <span>{entry.resolution.toFixed(1)}Å</span>}
                    {entry.journalIf != null && entry.journalIf > 0 && <span>IF {entry.journalIf.toFixed(1)}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-[11px] font-bold tabular-nums" style={{ color: tier.color }}>
                    {quality.score}
                  </span>
                  <ChevronRight className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: mutedColor }} />
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
