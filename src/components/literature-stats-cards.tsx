'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  BookOpen,
  TrendingUp,
  Award,
  Microscope,
  Newspaper,
  Calendar,
} from 'lucide-react';
import type { LitPaper, LitStats } from '@/lib/pdb-types';

/**
 * LiteratureStatsCards
 *
 * A row of enhanced stat cards for the Literature mode, shown above the
 * paper list. Each card has an icon, big number, and mini visualization.
 *
 * Cards:
 *   1. Total Papers (with method distribution mini-bar)
 *   2. Avg Impact Factor (with top journal)
 *   3. High-IF Papers (IF ≥ 10)
 *   4. Methods Covered (Cryo-EM / X-ray / NMR count)
 */

interface LiteratureStatsCardsProps {
  papers: LitPaper[];
  stats?: LitStats | null;
}

export function LiteratureStatsCards({ papers, stats }: LiteratureStatsCardsProps) {
  const computed = useMemo(() => {
    const total = papers.length;
    if (total === 0) {
      return {
        total: 0,
        avgIf: null,
        highIfCount: 0,
        topJournal: '—',
        methodsCovered: 0,
        methodDist: [],
        dateRange: '—',
      };
    }

    // IF stats
    const ifValues = papers
      .map((p) => p.IF)
      .filter((v): v is number => v != null && v > 0);
    const avgIf = ifValues.length > 0
      ? ifValues.reduce((sum, v) => sum + v, 0) / ifValues.length
      : null;
    const highIfCount = ifValues.filter((v) => v >= 10).length;

    // Top journal
    const journalCounts: Record<string, number> = {};
    for (const p of papers) {
      if (p.journal) {
        journalCounts[p.journal] = (journalCounts[p.journal] || 0) + 1;
      }
    }
    const topJournal = Object.entries(journalCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';

    // Method distribution
    const methodCounts: Record<string, number> = {};
    for (const p of papers) {
      // Check methods field or title for method keywords
      const text = `${p.methods || ''} ${p.title || ''}`.toUpperCase();
      let method = 'Other';
      if (text.includes('CRYO-EM') || text.includes('CRYO EM') || text.includes('ELECTRON MICROSCOPY')) method = 'Cryo-EM';
      else if (text.includes('X-RAY') || text.includes('XRAY') || text.includes('CRYSTAL')) method = 'X-ray';
      else if (text.includes('NMR')) method = 'NMR';
      methodCounts[method] = (methodCounts[method] || 0) + 1;
    }
    const methodsCovered = Object.keys(methodCounts).filter((k) => k !== 'Other').length;
    const methodDist = Object.entries(methodCounts).map(([name, value]) => ({
      name,
      value,
      color: name === 'Cryo-EM' ? '#2d8f8f' : name === 'X-ray' ? '#7c5cbf' : name === 'NMR' ? '#c9872e' : '#94a3b8',
    }));

    // Date range
    const dates = papers
      .map((p) => p.pubdate)
      .filter((d): d is string => !!d)
      .sort();
    const dateRange = dates.length > 0
      ? `${dates[0].substring(0, 10)} → ${dates[dates.length - 1].substring(0, 10)}`
      : '—';

    return {
      total,
      avgIf,
      highIfCount,
      topJournal,
      methodsCovered,
      methodDist,
      dateRange,
    };
  }, [papers]);

  if (computed.total === 0) return null;

  const cards = [
    {
      icon: BookOpen,
      label: 'Total Papers',
      value: computed.total,
      gradient: 'from-[#c9872e] to-[#a06b1a]',
      delay: 0,
      mini: (
        <div className="flex items-end justify-center h-full gap-0.5">
          {computed.methodDist.map((m, i) => (
            <motion.div
              key={m.name}
              initial={{ height: 0 }}
              animate={{ height: `${(m.value / computed.total) * 100}%` }}
              transition={{ delay: 0.3 + i * 0.05, duration: 0.4 }}
              className="flex-1 max-w-[16px] rounded-sm"
              style={{ backgroundColor: m.color, minHeight: 4 }}
              title={`${m.name}: ${m.value}`}
            />
          ))}
        </div>
      ),
    },
    {
      icon: TrendingUp,
      label: 'Avg Impact Factor',
      value: computed.avgIf ? computed.avgIf.toFixed(1) : '—',
      gradient: 'from-[#7c5cbf] to-[#5a3d99]',
      delay: 0.05,
      mini: (
        <div className="flex items-center justify-center h-full text-[10px] text-claude-text-muted text-center px-1 truncate">
          {computed.topJournal.length > 25 ? computed.topJournal.substring(0, 25) + '…' : computed.topJournal}
        </div>
      ),
    },
    {
      icon: Award,
      label: 'High-IF (≥10)',
      value: computed.highIfCount,
      suffix: computed.total > 0 ? `(${((computed.highIfCount / computed.total) * 100).toFixed(0)}%)` : undefined,
      gradient: 'from-[#dc2626] to-[#ea580c]',
      delay: 0.1,
      mini: (
        <div className="flex items-center justify-center h-full">
          <div className="w-full bg-claude-border/30 dark:bg-[#3d3832]/30 rounded-full h-2 overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${(computed.highIfCount / computed.total) * 100}%` }}
              transition={{ delay: 0.4, duration: 0.6, ease: 'easeOut' }}
              className="h-full bg-gradient-to-r from-[#dc2626] to-[#ea580c] rounded-full"
            />
          </div>
        </div>
      ),
    },
    {
      icon: Microscope,
      label: 'Methods Covered',
      value: computed.methodsCovered,
      suffix: '/ 3',
      gradient: 'from-[#2d8f8f] to-[#1a6b6b]',
      delay: 0.15,
      mini: (
        <div className="flex items-center justify-center gap-1 h-full">
          {computed.methodDist
            .filter((m) => m.name !== 'Other')
            .map((m) => (
              <div key={m.name} className="flex flex-col items-center gap-0.5">
                <div
                  className="w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: m.color }}
                  title={`${m.name}: ${m.value}`}
                />
                <span className="text-[7px] text-claude-text-muted">{m.value}</span>
              </div>
            ))}
        </div>
      ),
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 px-4 py-2.5 border-b border-claude-border dark:border-[#3d3832] bg-claude-surface/50 dark:bg-[#242220]/30">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <motion.div
            key={card.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: card.delay, duration: 0.3 }}
            className="kpi-card-enhanced relative flex flex-col rounded-xl border border-claude-border/50 dark:border-[#3d3832]/50 bg-white/60 dark:bg-[#242220]/60 backdrop-blur-sm overflow-hidden"
          >
            <div className="flex items-center gap-2 px-2.5 pt-2.5 pb-1.5">
              <div className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br ${card.gradient} shadow-sm`}>
                <Icon className="h-3.5 w-3.5 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[9px] font-medium text-claude-text-muted uppercase tracking-wide truncate">
                  {card.label}
                </div>
                <div className="flex items-baseline gap-0.5">
                  <span className="text-base font-bold text-claude-text tabular-nums leading-tight">
                    {card.value}
                  </span>
                  {card.suffix && (
                    <span className="text-[9px] font-normal text-claude-text-muted">{card.suffix}</span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex-1 min-h-[40px] px-1.5 pb-1.5">
              {card.mini}
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
