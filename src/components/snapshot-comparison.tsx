'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowUp,
  ArrowDown,
  Minus,
  TrendingUp,
  TrendingDown,
  Calendar,
  Boxes,
  Microscope,
  Gauge,
} from 'lucide-react';
import type { WeeklySnapshot } from '@/lib/pdb-types';
import { MethodBadge } from '@/components/method-badge';

/**
 * SnapshotComparison
 *
 * An enhanced visual comparison between the current and previous weekly
 * snapshots. Shows:
 *   - Total structures (with up/down arrow and % change)
 *   - Method distribution comparison (Cryo-EM / X-ray / NMR)
 *   - Avg resolution comparison
 *   - Mini trend sparkline across all snapshots
 *
 * Shown in the Weekly sidebar below the snapshots list.
 */

interface SnapshotComparisonProps {
  current: WeeklySnapshot | null;
  previous: WeeklySnapshot | null;
  snapshots: WeeklySnapshot[];
}

interface DiffStat {
  label: string;
  current: number;
  previous: number;
  diff: number;
  pctChange: number;
  icon: typeof Boxes;
  color: string;
  suffix?: string;
  invertGood?: boolean; // true if lower is better (e.g. resolution)
}

function DiffArrow({ diff, invertGood = false }: { diff: number; invertGood?: boolean }) {
  if (diff === 0) return <Minus className="h-3 w-3 text-claude-text-muted" />;
  const isUp = diff > 0;
  const isGood = invertGood ? !isUp : isUp;
  return (
    <span className={`flex items-center gap-0.5 text-[9px] font-semibold ${isGood ? 'text-emerald-500' : 'text-red-500'}`}>
      {isUp ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />}
      {Math.abs(diff).toFixed(diff % 1 === 0 ? 0 : 1)}
    </span>
  );
}

export function SnapshotComparison({ current, previous, snapshots }: SnapshotComparisonProps) {
  const stats = useMemo((): DiffStat[] => {
    if (!current) return [];

    const cur = current;
    const prev = previous;

    const safe = (v: number | null | undefined) => v ?? 0;
    const diff = (c: number, p: number) => c - p;
    const pct = (c: number, p: number) => (p === 0 ? (c > 0 ? 100 : 0) : ((c - p) / p) * 100);

    return [
      {
        label: 'Total',
        current: safe(cur.totalStructures),
        previous: safe(prev?.totalStructures),
        diff: diff(safe(cur.totalStructures), safe(prev?.totalStructures)),
        pctChange: pct(safe(cur.totalStructures), safe(prev?.totalStructures)),
        icon: Boxes,
        color: '#2d8f8f',
      },
      {
        label: 'Cryo-EM',
        current: safe(cur.cryoemCount),
        previous: safe(prev?.cryoemCount),
        diff: diff(safe(cur.cryoemCount), safe(prev?.cryoemCount)),
        pctChange: pct(safe(cur.cryoemCount), safe(prev?.cryoemCount)),
        icon: Microscope,
        color: '#2d8f8f',
      },
      {
        label: 'X-ray',
        current: safe(cur.xrayCount),
        previous: safe(prev?.xrayCount),
        diff: diff(safe(cur.xrayCount), safe(prev?.xrayCount)),
        pctChange: pct(safe(cur.xrayCount), safe(prev?.xrayCount)),
        icon: Microscope,
        color: '#7c5cbf',
      },
      {
        label: 'NMR',
        current: safe(cur.nmrCount),
        previous: safe(prev?.nmrCount),
        diff: diff(safe(cur.nmrCount), safe(prev?.nmrCount)),
        pctChange: pct(safe(cur.nmrCount), safe(prev?.nmrCount)),
        icon: Microscope,
        color: '#c9872e',
      },
      {
        label: 'Avg Res',
        current: safe(cur.avgResolution),
        previous: safe(prev?.avgResolution),
        diff: diff(safe(cur.avgResolution), safe(prev?.avgResolution)),
        pctChange: pct(safe(cur.avgResolution), safe(prev?.avgResolution)),
        icon: Gauge,
        color: '#c9872e',
        suffix: 'Å',
        invertGood: true,
      },
    ];
  }, [current, previous]);

  // Sparkline data from all snapshots (reversed so oldest is first)
  const sparklineData = useMemo(() => {
    return [...snapshots].reverse().map((s) => s.totalStructures);
  }, [snapshots]);

  if (!current || stats.length === 0) return null;

  return (
    <div className="px-3 py-2.5">
      {/* Header */}
      <div className="flex items-center gap-1.5 mb-2">
        <TrendingUp className="h-3 w-3 text-claude-accent" />
        <span className="text-[10px] font-bold uppercase tracking-wider text-claude-text">
          Week vs Week
        </span>
        {previous && (
          <span className="text-[9px] text-claude-text-muted ml-auto">
            {current.weekId} vs {previous.weekId}
          </span>
        )}
      </div>

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-1.5 mb-2">
        {stats.map((stat, i) => {
          const Icon = stat.icon;
          return (
            <motion.div
              key={stat.label}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.04 }}
              className="rounded-lg border border-claude-border/30 dark:border-[#3d3832]/30 bg-white/40 dark:bg-[#242220]/40 p-2"
            >
              <div className="flex items-center gap-1 mb-0.5">
                <Icon className="h-2.5 w-2.5" style={{ color: stat.color }} />
                <span className="text-[8px] text-claude-text-muted uppercase tracking-wider truncate">
                  {stat.label}
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-bold text-claude-text tabular-nums">
                  {stat.current.toFixed(stat.label === 'Avg Res' ? 2 : 0)}
                  {stat.suffix && (
                    <span className="text-[8px] font-normal text-claude-text-muted ml-0.5">{stat.suffix}</span>
                  )}
                </span>
                {previous && stat.previous > 0 && (
                  <DiffArrow diff={stat.diff} invertGood={stat.invertGood} />
                )}
              </div>
              {previous && stat.previous > 0 && (
                <div className="text-[8px] text-claude-text-muted tabular-nums">
                  was {stat.previous.toFixed(stat.label === 'Avg Res' ? 2 : 0)}
                </div>
              )}
            </motion.div>
          );
        })}
      </div>

      {/* Sparkline */}
      {sparklineData.length >= 2 && (
        <div className="rounded-lg border border-claude-border/30 dark:border-[#3d3832]/30 bg-white/40 dark:bg-[#242220]/40 p-2">
          <div className="flex items-center gap-1 mb-1">
            <Calendar className="h-2.5 w-2.5 text-claude-text-muted" />
            <span className="text-[8px] text-claude-text-muted uppercase tracking-wider">
              Trend
            </span>
          </div>
          <div className="flex items-end justify-between h-8 gap-1">
            {sparklineData.map((val, i) => {
              const max = Math.max(...sparklineData, 1);
              const h = (val / max) * 100;
              const isLast = i === sparklineData.length - 1;
              return (
                <motion.div
                  key={i}
                  initial={{ height: 0 }}
                  animate={{ height: `${h}%` }}
                  transition={{ delay: 0.2 + i * 0.06, duration: 0.3 }}
                  className={`flex-1 rounded-sm min-h-[2px] ${
                    isLast
                      ? 'bg-gradient-to-t from-claude-accent to-[#d4784f]'
                      : 'bg-claude-border/50 dark:bg-[#3d3832]/50'
                  }`}
                  title={`${val} structures`}
                />
              );
            })}
          </div>
          <div className="flex justify-between mt-0.5">
            <span className="text-[7px] text-claude-text-muted">
              {sparklineData.length} weeks
            </span>
            <span className="text-[7px] text-claude-text-muted">
              max: {Math.max(...sparklineData)}
            </span>
          </div>
        </div>
      )}

      {/* Method comparison bars */}
      {current && previous && (
        <div className="mt-2 rounded-lg border border-claude-border/30 dark:border-[#3d3832]/30 bg-white/40 dark:bg-[#242220]/40 p-2">
          <div className="text-[8px] text-claude-text-muted uppercase tracking-wider mb-1.5">
            Method Share
          </div>
          {/* Current week bar */}
          <div className="mb-1.5">
            <div className="text-[8px] text-claude-text-muted mb-0.5">{current.weekId}</div>
            <div className="flex h-3 rounded-sm overflow-hidden gap-0.5">
              {current.cryoemCount > 0 && (
                <div className="bg-[#2d8f8f]" style={{ flex: current.cryoemCount }} title={`Cryo-EM: ${current.cryoemCount}`} />
              )}
              {current.xrayCount > 0 && (
                <div className="bg-[#7c5cbf]" style={{ flex: current.xrayCount }} title={`X-ray: ${current.xrayCount}`} />
              )}
              {current.nmrCount > 0 && (
                <div className="bg-[#c9872e]" style={{ flex: current.nmrCount }} title={`NMR: ${current.nmrCount}`} />
              )}
              {current.otherCount > 0 && (
                <div className="bg-[#94a3b8]" style={{ flex: current.otherCount }} title={`Other: ${current.otherCount}`} />
              )}
            </div>
          </div>
          {/* Previous week bar */}
          <div>
            <div className="text-[8px] text-claude-text-muted mb-0.5">{previous.weekId}</div>
            <div className="flex h-3 rounded-sm overflow-hidden gap-0.5 opacity-60">
              {previous.cryoemCount > 0 && (
                <div className="bg-[#2d8f8f]" style={{ flex: previous.cryoemCount }} title={`Cryo-EM: ${previous.cryoemCount}`} />
              )}
              {previous.xrayCount > 0 && (
                <div className="bg-[#7c5cbf]" style={{ flex: previous.xrayCount }} title={`X-ray: ${previous.xrayCount}`} />
              )}
              {previous.nmrCount > 0 && (
                <div className="bg-[#c9872e]" style={{ flex: previous.nmrCount }} title={`NMR: ${previous.nmrCount}`} />
              )}
              {previous.otherCount > 0 && (
                <div className="bg-[#94a3b8]" style={{ flex: previous.otherCount }} title={`Other: ${previous.otherCount}`} />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
