'use client';
import { useI18n } from '@/lib/i18n';

import React, { useMemo } from 'react';
import { Database, Aperture, Cpu, Trophy } from 'lucide-react';
import { StatCard, MethodDonut, ResolutionGauge, MiniBar, TierBadge } from '@/components/ui/stat-card';
import type { PdbEntry, WeeklySnapshot } from '@/lib/pdb-types';

// ─── WeeklyStatCards Component ────────────────────────────────────────────────

interface WeeklyStatCardsProps {
  snapshot: WeeklySnapshot | null;
  entries: PdbEntry[];
  loading: boolean;
  snapshots?: WeeklySnapshot[];
}

export function WeeklyStatCards({ snapshot, entries, loading, snapshots = [] }: WeeklyStatCardsProps) {
  const { locale } = useI18n();
  const totalStructures = snapshot?.totalStructures ?? entries.length;

  const resolutions = entries.filter(e => e.resolution != null).map(e => e.resolution!);
  const avgResolution = resolutions.length > 0
    ? resolutions.reduce((a, b) => a + b, 0) / resolutions.length
    : 0;

  const cryoemCount = snapshot?.cryoemCount ?? entries.filter(e => e.isCryoem).length;
  const xrayCount = snapshot?.xrayCount ?? entries.filter(e => e.isXray).length;
  const nmrCount = snapshot?.nmrCount ?? (totalStructures - cryoemCount - xrayCount);
  const cryoemPct = totalStructures > 0 ? (cryoemCount / totalStructures) * 100 : 0;

  const ifEntries = entries.filter(e => e.journalIf != null && e.journal);
  const topIfEntry = ifEntries.length > 0
    ? ifEntries.reduce((a, b) => (a.journalIf ?? 0) > (b.journalIf ?? 0) ? a : b)
    : null;

  // Method distribution segments for the donut
  const methodSegments = useMemo(() => {
    const segs: { label: string; value: number; color: string }[] = [];
    if (xrayCount > 0) segs.push({ label: 'X-ray', value: xrayCount, color: '#7c5cbf' });
    if (cryoemCount > 0) segs.push({ label: 'Cryo-EM', value: cryoemCount, color: '#2d8f8f' });
    if (nmrCount > 0) segs.push({ label: 'NMR', value: nmrCount, color: '#c9872e' });
    const otherCount = totalStructures - xrayCount - cryoemCount - nmrCount;
    if (otherCount > 0) segs.push({ label: 'Other', value: otherCount, color: '#6b7280' });
    return segs;
  }, [xrayCount, cryoemCount, nmrCount, totalStructures]);

  // IF tier for the top entry
  const topIfTier = useMemo(() => {
    const if_ = topIfEntry?.journalIf ?? 0;
    if (if_ >= 20) return 'top' as const;
    if (if_ >= 10) return 'high' as const;
    if (if_ >= 5) return 'mid' as const;
    if (if_ > 0) return 'low' as const;
    return 'unknown' as const;
  }, [topIfEntry?.journalIf]);

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 p-2 sm:p-3 min-w-0 stagger-list [grid-auto-rows:1fr]">
      {/* Total Structures — Method Donut showing composition */}
      <StatCard
        title={locale === "zh" ? "结构总数" : "Total Structures"}
        value={totalStructures}
        icon={<Database className="h-3.5 w-3.5 text-white" />}
        color="bg-gradient-to-br from-[#2d8f8f] to-[#1a6b6b]"
        glowColor="#2d8f8f"
        subtitle={snapshot?.weekId || ''}
        loading={loading}
        delay={0}
        borderColor="#2d8f8f"
        tooltip={`Total: ${totalStructures} (Cryo-EM: ${cryoemCount}, X-ray: ${xrayCount}, NMR: ${nmrCount})`}
      >
        <MethodDonut segments={methodSegments} size={30} strokeWidth={3.5} />
      </StatCard>

      {/* Avg Resolution — Resolution Gauge */}
      <StatCard
        title={locale === "zh" ? "平均分辨率" : "Avg Resolution"}
        value={avgResolution}
        suffix="Å"
        decimals={2}
        icon={<Aperture className="h-3.5 w-3.5 text-white" />}
        color={
          avgResolution <= 2.0 ? 'bg-gradient-to-br from-green-500 to-green-700' :
          avgResolution <= 3.5 ? 'bg-gradient-to-br from-amber-500 to-amber-700' :
          'bg-gradient-to-br from-red-500 to-red-700'
        }
        glowColor={
          avgResolution <= 2.0 ? '#16a34a' :
          avgResolution <= 3.5 ? '#c9872e' : '#dc2626'
        }
        subtitle={resolutions.length > 0 ? `${resolutions.length} entries` : ''}
        loading={loading}
        delay={80}
        borderColor={
          avgResolution <= 2.0 ? '#16a34a' :
          avgResolution <= 3.5 ? '#c9872e' : '#dc2626'
        }
        tooltip={`Avg: ${avgResolution.toFixed(2)}Å (${resolutions.length} entries)`}
      >
        <ResolutionGauge value={avgResolution} width={44} height={5} />
      </StatCard>

      {/* Cryo-EM Share — Mini Bar */}
      <StatCard
        title={locale === "zh" ? "Cryo-EM 占比" : "Cryo-EM Share"}
        value={cryoemPct}
        suffix="%"
        decimals={1}
        icon={<Cpu className="h-3.5 w-3.5 text-white" />}
        color="bg-gradient-to-br from-[#7c5cbf] to-[#5a3d99]"
        glowColor="#7c5cbf"
        subtitle={`${cryoemCount} of ${totalStructures}`}
        loading={loading}
        delay={160}
        borderColor="#7c5cbf"
        tooltip={`Cryo-EM: ${cryoemPct.toFixed(1)}% (${cryoemCount}/${totalStructures})`}
      >
        <MiniBar value={cryoemPct} max={100} color="#7c5cbf" width={44} height={5} />
      </StatCard>

      {/* Top Impact Factor — Tier Badge */}
      <StatCard
        title="Top Impact Factor"
        value={topIfEntry?.journalIf ?? 0}
        decimals={1}
        icon={<Trophy className="h-3.5 w-3.5 text-white" />}
        color="bg-gradient-to-br from-[#c9872e] to-[#a06b1a]"
        glowColor="#c9872e"
        subtitle={topIfEntry?.journal || 'No IF data'}
        loading={loading}
        delay={240}
        borderColor="#c9872e"
        tooltip={`Top IF: ${topIfEntry?.journalIf?.toFixed(1) ?? 'N/A'} (${topIfEntry?.journal || 'No data'})`}
      >
        <TierBadge tier={topIfTier} label={topIfTier === 'unknown' ? 'N/A' : undefined} />
      </StatCard>
    </div>
  );
}
