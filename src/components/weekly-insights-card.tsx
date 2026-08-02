'use client';

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  TrendingUp, Award, Microscope, Atom, Target, Zap, ArrowUp, ArrowDown, Minus,
} from 'lucide-react';
import type { PdbEntry, WeeklySnapshot } from '@/lib/pdb-types';
import { useI18n } from '@/lib/i18n';

/**
 * WeeklyInsightsCard
 *
 * A compact card showing key insights about the current week's PDB releases.
 * Displays 4-6 highlight metrics in a visually appealing grid:
 *
 *   - Top structure (highest IF)
 *   - Best resolution
 *   - Trending method (most common)
 *   - Unique organisms count
 *   - Ligand diversity
 *   - Avg resolution trend (vs previous week)
 *
 * Each insight has an icon, value, label, and optional trend indicator.
 */

interface WeeklyInsightsCardProps {
  entries: PdbEntry[];
  currentSnapshot?: WeeklySnapshot | null;
  previousSnapshot?: WeeklySnapshot | null;
}

interface Insight {
  icon: typeof TrendingUp;
  label: string;
  value: string;
  sublabel?: string;
  trend?: 'up' | 'down' | 'neutral';
  trendValue?: string;
  color: string;
  bgColor: string;
}

export function WeeklyInsightsCard({ entries, currentSnapshot, previousSnapshot }: WeeklyInsightsCardProps) {
  const { locale } = useI18n();

  const insights = useMemo<Insight[]>(() => {
    if (!entries.length) return [];

    const result: Insight[] = [];

    // 1. Top structure (highest IF)
    const sortedByIf = [...entries]
      .filter(e => (e.journalIf ?? 0) > 0)
      .sort((a, b) => (b.journalIf ?? 0) - (a.journalIf ?? 0));
    if (sortedByIf.length > 0) {
      const top = sortedByIf[0];
      result.push({
        icon: Award,
        label: locale === 'zh' ? '顶级期刊' : 'Top Journal',
        value: top.journal || '—',
        sublabel: `IF ${top.journalIf?.toFixed(1)} · ${top.pdbId}`,
        color: '#dc2626',
        bgColor: 'rgba(220, 38, 38, 0.08)',
      });
    }

    // 2. Best resolution
    const sortedByRes = [...entries]
      .filter(e => e.resolution != null && e.resolution > 0)
      .sort((a, b) => (a.resolution ?? 999) - (b.resolution ?? 999));
    if (sortedByRes.length > 0) {
      const best = sortedByRes[0];
      result.push({
        icon: Microscope,
        label: locale === 'zh' ? '最佳分辨率' : 'Best Resolution',
        value: `${best.resolution?.toFixed(2)}Å`,
        sublabel: best.pdbId,
        color: '#2d8f8f',
        bgColor: 'rgba(45, 143, 143, 0.08)',
      });
    }

    // 3. Trending method
    const methodCounts: Record<string, number> = {};
    entries.forEach(e => {
      const m = e.method || 'Unknown';
      methodCounts[m] = (methodCounts[m] || 0) + 1;
    });
    const sortedMethods = Object.entries(methodCounts).sort((a, b) => b[1] - a[1]);
    if (sortedMethods.length > 0) {
      const [topMethod, count] = sortedMethods[0];
      const methodLabel = topMethod.toLowerCase().includes('cryo') ? 'Cryo-EM'
        : topMethod.toLowerCase().includes('x-ray') || topMethod.toLowerCase().includes('xray') ? 'X-ray'
        : topMethod.toLowerCase().includes('nmr') ? 'NMR'
        : topMethod;
      const pct = Math.round((count / entries.length) * 100);
      result.push({
        icon: Atom,
        label: locale === 'zh' ? '主流方法' : 'Top Method',
        value: methodLabel,
        sublabel: `${count} (${pct}%)`,
        color: '#7c5cbf',
        bgColor: 'rgba(124, 92, 191, 0.08)',
      });
    }

    // 4. Unique organisms
    const organisms = new Set(entries.map(e => e.organisms).filter(Boolean));
    result.push({
      icon: Target,
      label: locale === 'zh' ? '物种多样性' : 'Organisms',
      value: String(organisms.size),
      sublabel: locale === 'zh' ? '个不同物种' : 'unique species',
      color: '#c9872e',
      bgColor: 'rgba(201, 135, 46, 0.08)',
    });

    // 5. Ligand diversity
    const ligands = new Set<string>();
    entries.forEach(e => {
      if (e.ligands) {
        e.ligands.split(',').forEach(l => {
          const trimmed = l.trim();
          if (trimmed) ligands.add(trimmed);
        });
      }
    });
    if (ligands.size > 0) {
      result.push({
        icon: Zap,
        label: locale === 'zh' ? '配体多样性' : 'Ligands',
        value: String(ligands.size),
        sublabel: locale === 'zh' ? '种不同配体' : 'unique ligands',
        color: '#ea580c',
        bgColor: 'rgba(234, 88, 12, 0.08)',
      });
    }

    // 6. Avg resolution trend (vs previous week)
    const withRes = entries.filter(e => e.resolution != null && e.resolution > 0);
    if (withRes.length > 0 && currentSnapshot && previousSnapshot) {
      const avgRes = withRes.reduce((s, e) => s + (e.resolution ?? 0), 0) / withRes.length;
      const prevAvg = previousSnapshot.avgResolution;
      if (prevAvg != null && prevAvg > 0) {
        const diff = avgRes - prevAvg;
        const trend = diff < -0.1 ? 'up' : diff > 0.1 ? 'down' : 'neutral';
        // For resolution, lower is better → "up" trend (green) means improved
        const trendLabel = trend === 'up'
          ? `↓ ${Math.abs(diff).toFixed(2)}Å ${locale === 'zh' ? '更好' : 'better'}`
          : trend === 'down'
          ? `↑ ${Math.abs(diff).toFixed(2)}Å ${locale === 'zh' ? '更差' : 'worse'}`
          : locale === 'zh' ? '持平' : 'stable';
        result.push({
          icon: TrendingUp,
          label: locale === 'zh' ? '平均分辨率' : 'Avg Resolution',
          value: `${avgRes.toFixed(2)}Å`,
          sublabel: trendLabel,
          trend,
          color: trend === 'up' ? '#16a34a' : trend === 'down' ? '#dc2626' : '#6b7280',
          bgColor: trend === 'up' ? 'rgba(22, 163, 74, 0.08)' : trend === 'down' ? 'rgba(220, 38, 38, 0.08)' : 'rgba(107, 114, 128, 0.08)',
        });
      }
    }

    return result.slice(0, 6);
  }, [entries, currentSnapshot, previousSnapshot, locale]);

  if (!insights.length) return null;

  return (
    <div className="border-b border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220]">
      <div className="px-3 sm:px-4 py-3">
        {/* Header */}
        <div className="flex items-center gap-1.5 mb-3">
          <TrendingUp className="h-3 w-3 text-claude-accent" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-claude-text-muted">
            {locale === 'zh' ? '本周洞察' : 'Weekly Insights'}
          </span>
          <span className="text-[10px] text-claude-text-muted/70 ml-1">
            · {entries.length} {locale === 'zh' ? '个结构' : 'structures'}
          </span>
        </div>

        {/* Insights grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
          {insights.map((insight, i) => {
            const Icon = insight.icon;
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                className="relative p-2.5 rounded-lg border border-claude-border/40 dark:border-[#3d3832]/40 bg-claude-bg/50 dark:bg-[#1a1917]/50 hover:border-claude-accent/30 transition-all group"
              >
                {/* Icon */}
                <div
                  className="w-6 h-6 rounded-md flex items-center justify-center mb-1.5"
                  style={{ backgroundColor: insight.bgColor }}
                >
                  <Icon className="h-3 w-3" style={{ color: insight.color }} />
                </div>

                {/* Value */}
                <div className="text-sm font-bold text-claude-text truncate" title={insight.value}>
                  {insight.value}
                </div>

                {/* Label */}
                <div className="text-[9px] text-claude-text-muted uppercase tracking-wide truncate">
                  {insight.label}
                </div>

                {/* Sublabel */}
                {insight.sublabel && (
                  <div className="flex items-center gap-0.5 mt-0.5">
                    <span
                      className="text-[9px] font-mono truncate"
                      style={{ color: insight.color }}
                    >
                      {insight.sublabel}
                    </span>
                  </div>
                )}

                {/* Trend arrow */}
                {insight.trend && insight.trend !== 'neutral' && (
                  <div className="absolute top-2 right-2">
                    {insight.trend === 'up' ? (
                      <ArrowUp className="h-2.5 w-2.5" style={{ color: insight.color }} />
                    ) : (
                      <ArrowDown className="h-2.5 w-2.5" style={{ color: insight.color }} />
                    )}
                  </div>
                )}
                {insight.trend === 'neutral' && (
                  <div className="absolute top-2 right-2">
                    <Minus className="h-2.5 w-2.5 text-claude-text-muted" />
                  </div>
                )}
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
