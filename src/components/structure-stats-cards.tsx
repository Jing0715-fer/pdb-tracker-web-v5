'use client';

import { useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  PieChart, Pie, Cell, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, Tooltip,
} from 'recharts';
import {
  Microscope,
  Award,
  Boxes,
  Gauge,
} from 'lucide-react';
import type { PdbEntry } from '@/lib/pdb-types';

/**
 * StructureStatsCards
 *
 * A row of enhanced stat cards shown above the structure table in Weekly mode.
 * Each card has:
 *   - An icon with gradient background
 *   - A big number (animated count-up on mount)
 *   - A label
 *   - A mini visualization (sparkline, pie, or bar)
 *
 * Cards:
 *   1. Total Structures (with method distribution mini-pie)
 *   2. Avg Resolution (with resolution histogram)
 *   3. Cryo-EM Count (with percentage badge)
 *   4. High-IF Structures (with top journal)
 *   5. Unique Organisms (with top organism)
 *   6. Ligand Diversity (with unique ligand count)
 */

const METHOD_COLORS: Record<string, string> = {
  'Cryo-EM': '#2d8f8f',
  'X-ray': '#7c5cbf',
  'NMR': '#c9872e',
  'Other': '#94a3b8',
};

const RES_COLORS = ['#16a34a', '#2d8f8f', '#7c5cbf', '#c9872e', '#ea580c', '#dc2626'];

interface StatCardProps {
  icon: typeof Microscope;
  label: string;
  value: string | number;
  suffix?: string;
  gradient: string;
  delay: number;
  children?: React.ReactNode;
}

function StatCard({ icon: Icon, label, value, suffix, gradient, delay, children }: StatCardProps) {
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

function MiniPie({ data }: { data: { name: string; value: number; color: string }[] }) {
  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (total === 0) return null;
  return (
    <div className="flex items-center gap-2 h-full">
      <ResponsiveContainer width={40} height={40}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={10}
            outerRadius={18}
            paddingAngle={1}
            dataKey="value"
          >
            {data.map((entry, index) => (
              <Cell key={`cell-${index}`} fill={entry.color} />
            ))}
          </Pie>
          <Tooltip
            contentStyle={{
              backgroundColor: 'rgba(36, 34, 32, 0.95)',
              border: '1px solid rgba(201, 100, 66, 0.3)',
              borderRadius: '8px',
              fontSize: '11px',
              color: '#faf8f5',
            }}
            formatter={(value: any, name: any) => [`${value} (${((value / total) * 100).toFixed(0)}%)`, name]}
          />
        </PieChart>
      </ResponsiveContainer>
      <div className="flex flex-col gap-0.5 flex-1 min-w-0">
        {data.map((d) => (
          <div key={d.name} className="flex items-center gap-1 text-[8px]">
            <span
              className="inline-block w-1.5 h-1.5 rounded-full shrink-0"
              style={{ backgroundColor: d.color }}
            />
            <span className="text-claude-text-muted truncate">{d.name}</span>
            <span className="text-claude-text-secondary ml-auto tabular-nums">
              {((d.value / total) * 100).toFixed(0)}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MiniBar({ data, color }: { data: { label: string; value: number }[]; color: string }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <ResponsiveContainer width="100%" height={50}>
      <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <XAxis dataKey="label" tick={{ fontSize: 7, fill: '#9a8f86' }} axisLine={false} tickLine={false} />
        <YAxis hide domain={[0, max]} />
        <Bar dataKey="value" fill={color} radius={[3, 3, 0, 0]} />
        <Tooltip
          contentStyle={{
            backgroundColor: 'rgba(36, 34, 32, 0.95)',
            border: '1px solid rgba(201, 100, 66, 0.3)',
            borderRadius: '8px',
            fontSize: '11px',
            color: '#faf8f5',
          }}
          cursor={{ fill: 'rgba(201, 100, 66, 0.08)' }}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function StructureStatsCards({ entries }: { entries: PdbEntry[] }) {
  const stats = useMemo(() => {
    const total = entries.length;
    if (total === 0) {
      return {
        total: 0,
        avgResolution: null,
        cryoemCount: 0,
        highIfCount: 0,
        topJournal: '—',
        uniqueOrganisms: 0,
        topOrganism: '—',
        uniqueLigands: 0,
        methodDist: [],
        resDist: [],
      };
    }

    // Method distribution
    const methodCounts: Record<string, number> = {};
    for (const e of entries) {
      const m = (e.method || 'Other') as string;
      // Normalize method names
      const key = m.includes('CRYO') || m.includes('EM') ? 'Cryo-EM'
        : m.includes('X-RAY') || m.includes('XRAY') ? 'X-ray'
        : m.includes('NMR') ? 'NMR'
        : 'Other';
      methodCounts[key] = (methodCounts[key] || 0) + 1;
    }
    const methodDist = Object.entries(methodCounts).map(([name, value]) => ({
      name,
      value,
      color: METHOD_COLORS[name] || METHOD_COLORS['Other'],
    }));

    // Resolution distribution
    const resBins = [
      { label: '<1.5', min: 0, max: 1.5, value: 0 },
      { label: '1.5-2', min: 1.5, max: 2.0, value: 0 },
      { label: '2-2.5', min: 2.0, max: 2.5, value: 0 },
      { label: '2.5-3', min: 2.5, max: 3.0, value: 0 },
      { label: '3-3.5', min: 3.0, max: 3.5, value: 0 },
      { label: '>3.5', min: 3.5, max: Infinity, value: 0 },
    ];
    const resolutions = entries
      .map((e) => e.resolution)
      .filter((r): r is number => r != null && r > 0);
    const avgResolution = resolutions.length > 0
      ? resolutions.reduce((sum, r) => sum + r, 0) / resolutions.length
      : null;
    for (const r of resolutions) {
      for (const bin of resBins) {
        if (r >= bin.min && r < bin.max) {
          bin.value++;
          break;
        }
      }
    }

    // Cryo-EM count
    const cryoemCount = methodCounts['Cryo-EM'] || 0;

    // High-IF structures (IF >= 10)
    const highIfEntries = entries.filter((e) => (e.journalIf || 0) >= 10);
    const highIfCount = highIfEntries.length;
    const journalCounts: Record<string, number> = {};
    for (const e of entries) {
      if (e.journal) {
        journalCounts[e.journal] = (journalCounts[e.journal] || 0) + 1;
      }
    }
    const topJournal = Object.entries(journalCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';

    // Unique organisms
    const organismSet = new Set<string>();
    for (const e of entries) {
      if (e.organisms) {
        const orgs = e.organisms.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
        orgs.forEach((o) => organismSet.add(o));
      }
    }
    const uniqueOrganisms = organismSet.size;
    const organismCounts: Record<string, number> = {};
    for (const e of entries) {
      if (e.organisms) {
        const orgs = e.organisms.split(/[;,]/).map((s) => s.trim()).filter(Boolean);
        for (const o of orgs) {
          organismCounts[o] = (organismCounts[o] || 0) + 1;
        }
      }
    }
    const topOrganism = Object.entries(organismCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';

    // Unique ligands
    const ligandSet = new Set<string>();
    for (const e of entries) {
      if (e.ligands) {
        const ligands = e.ligands.split(',').map((s) => s.trim()).filter(Boolean);
        ligands.forEach((l) => ligandSet.add(l));
      }
    }
    const uniqueLigands = ligandSet.size;

    return {
      total,
      avgResolution,
      cryoemCount,
      highIfCount,
      topJournal,
      uniqueOrganisms,
      topOrganism: topOrganism.length > 20 ? topOrganism.substring(0, 20) + '…' : topOrganism,
      uniqueLigands,
      methodDist,
      resDist: resBins.map((b) => ({ label: b.label, value: b.value })),
    };
  }, [entries]);

  if (stats.total === 0) return null;

  const cryoemPct = stats.total > 0 ? (stats.cryoemCount / stats.total) * 100 : 0;

  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 px-4 py-2.5 border-b border-claude-border dark:border-[#3d3832] bg-claude-surface/50 dark:bg-[#242220]/30">
      {/* Total Structures */}
      <StatCard
        icon={Boxes}
        label="Total Structures"
        value={stats.total}
        gradient="from-[#2d8f8f] to-[#1a6b6b]"
        delay={0}
      >
        <MiniPie data={stats.methodDist} />
      </StatCard>

      {/* Avg Resolution */}
      <StatCard
        icon={Gauge}
        label="Avg Resolution"
        value={stats.avgResolution ? stats.avgResolution.toFixed(2) : '—'}
        suffix={stats.avgResolution ? 'Å' : undefined}
        gradient="from-[#c9872e] to-[#a06b1a]"
        delay={0.05}
      >
        <MiniBar data={stats.resDist} color="#c9872e" />
      </StatCard>

      {/* Cryo-EM Count */}
      <StatCard
        icon={Microscope}
        label="Cryo-EM Share"
        value={stats.cryoemCount}
        suffix={`(${cryoemPct.toFixed(0)}%)`}
        gradient="from-[#2d8f8f] to-[#7c5cbf]"
        delay={0.1}
      >
        <div className="flex items-center justify-center h-full">
          <div className="w-full bg-claude-border/30 dark:bg-[#3d3832]/30 rounded-full h-2 overflow-hidden">
            <motion.div
              initial={{ width: 0 }}
              animate={{ width: `${cryoemPct}%` }}
              transition={{ delay: 0.3, duration: 0.8, ease: 'easeOut' }}
              className="h-full bg-gradient-to-r from-[#2d8f8f] to-[#7c5cbf] rounded-full"
            />
          </div>
        </div>
      </StatCard>

      {/* High-IF + Top Journal */}
      <StatCard
        icon={Award}
        label="High-IF Papers"
        value={stats.highIfCount}
        gradient="from-[#dc2626] to-[#ea580c]"
        delay={0.15}
      >
        <div className="flex items-center justify-center h-full text-[10px] text-claude-text-muted text-center px-1 truncate">
          {stats.topJournal.length > 25 ? stats.topJournal.substring(0, 25) + '…' : stats.topJournal}
        </div>
      </StatCard>
    </div>
  );
}
