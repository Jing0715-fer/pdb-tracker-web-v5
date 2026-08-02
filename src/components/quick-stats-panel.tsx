'use client';

import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, BarChart3 } from 'lucide-react';
import type { PdbEntry, WeeklySnapshot, Evaluation, LitPaper } from '@/lib/pdb-types';
import { useI18n } from '@/lib/i18n';

// ─── Props ────────────────────────────────────────────────────────────────────

interface QuickStatsPanelProps {
  mode: 'weekly' | 'evaluation' | 'literature';
  entries?: PdbEntry[];
  evaluations?: Evaluation[];
  papers?: LitPaper[];
  snapshots?: WeeklySnapshot[];
  currentSnapshot?: WeeklySnapshot | null;
}

// ─── SVG Pie Chart Slice ──────────────────────────────────────────────────────

function SvgPieChart({ data }: { data: { label: string; value: number; color: string }[] }) {
  const { locale } = useI18n();
  const total = data.reduce((s, d) => s + d.value, 0);
  if (total === 0) return <div className="text-[10px] text-claude-text-muted py-4 text-center">{locale === 'zh' ? '暂无数据' : 'No data'}</div>;

  const cx = 40, cy = 40, r = 32;
  // Pre-compute cumulative values to avoid mutation in render
  const cumulatives = data.reduce<number[]>((acc, d, i) => {
    acc.push((acc[i - 1] ?? 0) + d.value);
    return acc;
  }, []);
  const slices = data.map((d, i) => {
    const prevCum = i > 0 ? cumulatives[i - 1] : 0;
    const startAngle = (prevCum / total) * 2 * Math.PI - Math.PI / 2;
    const endAngle = (cumulatives[i] / total) * 2 * Math.PI - Math.PI / 2;
    const largeArc = d.value / total > 0.5 ? 1 : 0;
    const x1 = cx + r * Math.cos(startAngle);
    const y1 = cy + r * Math.sin(startAngle);
    const x2 = cx + r * Math.cos(endAngle);
    const y2 = cy + r * Math.sin(endAngle);
    const path = d.value === total
      ? `M ${cx},${cy - r} A ${r},${r} 0 1,1 ${cx - 0.01},${cy - r} Z`
      : `M ${cx},${cy} L ${x1},${y1} A ${r},${r} 0 ${largeArc},1 ${x2},${y2} Z`;
    return { ...d, path, pct: ((d.value / total) * 100).toFixed(0) };
  });

  return (
    <div className="flex items-center gap-3">
      <svg width={80} height={80} viewBox="0 0 80 80" className="flex-shrink-0">
        {slices.map((s, i) => (
          <path key={i} d={s.path} fill={s.color} opacity={0.85} stroke="white" strokeWidth={1} className="transition-opacity duration-200 hover:opacity-100" />
        ))}
        <circle cx={cx} cy={cy} r={14} fill="white" className="dark:fill-[#242220]" />
        <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" className="text-[10px] font-bold fill-claude-text">{total}</text>
      </svg>
      <div className="space-y-1 min-w-0">
        {slices.map((s, i) => (
          <div key={i} className="flex items-center gap-1.5 text-[10px]">
            <span className="inline-block h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
            <span className="text-claude-text-secondary truncate">{s.label}</span>
            <span className="ml-auto font-mono font-medium text-claude-text">{s.value}</span>
            <span className="text-claude-text-muted">({s.pct}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── SVG Bar Chart ────────────────────────────────────────────────────────────

function SvgBarChart({ data, maxBars = 6, defaultColor }: { data: { label: string; value: number; color?: string }[]; maxBars?: number; defaultColor?: string }) {
  const { locale } = useI18n();
  if (!data.length) return <div className="text-[10px] text-claude-text-muted py-4 text-center">{locale === 'zh' ? '暂无数据' : 'No data'}</div>;

  const topData = data.slice(0, maxBars);
  const maxVal = Math.max(...topData.map(d => d.value), 1);
  const barH = 14;
  const gap = 4;
  const labelW = 90;
  const chartW = 120;
  const totalH = topData.length * (barH + gap);

  return (
    <svg width={labelW + chartW + 30} height={totalH + 4} className="flex-shrink-0">
      {topData.map((d, i) => {
        const y = i * (barH + gap) + 2;
        const barW = Math.max((d.value / maxVal) * chartW, 2);
        const color = d.color || defaultColor || '#c96442';
        return (
          <g key={i}>
            <text x={labelW - 4} y={y + barH / 2 + 1} textAnchor="end" dominantBaseline="central" className="text-[9px] fill-claude-text-muted font-medium" style={{ overflow: 'hidden' }}>
              {d.label.length > 14 ? d.label.slice(0, 13) + '…' : d.label}
            </text>
            <rect x={labelW} y={y} width={barW} height={barH} rx={3} fill={color} opacity={0.75} className="transition-all duration-300" />
            <text x={labelW + barW + 4} y={y + barH / 2 + 1} dominantBaseline="central" className="text-[9px] fill-claude-text-secondary font-mono font-medium">
              {d.value}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ─── Resolution Distribution ──────────────────────────────────────────────────

function ResolutionDistribution({ entries }: { entries: PdbEntry[] }) {
  const dist = useMemo(() => {
    const bins = [
      { label: '<1.5Å', min: 0, max: 1.5, count: 0, color: '#2d8f8f' },
      { label: '1.5-2.0Å', min: 1.5, max: 2.0, count: 0, color: '#3d9f9f' },
      { label: '2.0-2.5Å', min: 2.0, max: 2.5, count: 0, color: '#7c5cbf' },
      { label: '2.5-3.0Å', min: 2.5, max: 3.0, count: 0, color: '#c9872e' },
      { label: '3.0-3.5Å', min: 3.0, max: 3.5, count: 0, color: '#c96442' },
      { label: '>3.5Å', min: 3.5, max: Infinity, count: 0, color: '#e55a4f' },
    ];
    entries.forEach(e => {
      if (e.resolution != null) {
        for (const bin of bins) {
          if (e.resolution >= bin.min && e.resolution < bin.max) {
            bin.count++;
            break;
          }
        }
      }
    });
    return bins;
  }, [entries]);

  const maxCount = Math.max(...dist.map(b => b.count), 1);

  return (
    <div className="space-y-1">
      {dist.map((bin, i) => (
        <div key={i} className="flex items-center gap-2 text-[10px]">
          <span className="w-14 text-right text-claude-text-muted font-mono">{bin.label}</span>
          <div className="flex-1 h-3 bg-claude-border-light dark:bg-[#2b2926] rounded-sm overflow-hidden">
            <div
              className="h-full rounded-sm transition-all duration-500 ease-out"
              style={{ width: `${(bin.count / maxCount) * 100}%`, backgroundColor: bin.color, opacity: 0.8 }}
            />
          </div>
          <span className="w-6 text-right font-mono font-medium text-claude-text">{bin.count}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export function QuickStatsPanel({ mode, entries = [], evaluations = [], papers = [], snapshots = [], currentSnapshot }: QuickStatsPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const { t, locale } = useI18n();

  // Weekly stats
  const weeklyStats = useMemo(() => {
    if (mode !== 'weekly') return null;
    const methodDist = [
      { label: 'Cryo-EM', value: entries.filter(e => e.isCryoem).length, color: '#2d8f8f' },
      { label: 'X-ray', value: entries.filter(e => e.isXray).length, color: '#7c5cbf' },
      { label: 'NMR', value: entries.filter(e => !e.isCryoem && !e.isXray && e.method?.toLowerCase().includes('nmr')).length, color: '#c9872e' },
      { label: locale === 'zh' ? '其他' : 'Other', value: entries.filter(e => !e.isCryoem && !e.isXray && !(e.method?.toLowerCase().includes('nmr'))).length, color: '#94a3b8' },
    ].filter(d => d.value > 0);

    const journalMap = new Map<string, number>();
    entries.forEach(e => {
      if (e.journal) journalMap.set(e.journal, (journalMap.get(e.journal) || 0) + 1);
    });
    const topJournals = Array.from(journalMap.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);

    const withRes = entries.filter(e => e.resolution != null);
    const avgRes = withRes.length > 0 ? withRes.reduce((s, e) => s + e.resolution!, 0) / withRes.length : null;
    const withIf = entries.filter(e => e.journalIf != null && e.journalIf > 0);
    const avgIf = withIf.length > 0 ? withIf.reduce((s, e) => s + e.journalIf!, 0) / withIf.length : null;

    return { methodDist, topJournals, avgRes, avgIf, total: entries.length, withRes: withRes.length, withIf: withIf.length };
  }, [mode, entries]);

  // Evaluation stats
  const evalStats = useMemo(() => {
    if (mode !== 'evaluation') return null;
    const withStruct = evaluations.filter(e => (e.pdbStructures?.length ?? 0) > 0).length;
    const withBlast = evaluations.filter(e => (e.blastResults?.length ?? 0) > 0).length;
    const avgCov = evaluations.length > 0 ? evaluations.reduce((s, e) => s + (e.coverage ?? 0), 0) / evaluations.length : 0;

    const orgMap = new Map<string, number>();
    evaluations.forEach(e => {
      if (e.organism) orgMap.set(e.organism, (orgMap.get(e.organism) || 0) + 1);
    });
    const topOrgs = Array.from(orgMap.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);

    return { total: evaluations.length, withStruct, withBlast, avgCov, topOrgs };
  }, [mode, evaluations]);

  // Literature stats
  const litStats = useMemo(() => {
    if (mode !== 'literature') return null;
    const methodDist: { label: string; value: number; color: string }[] = [];
    const methodMap = new Map<string, number>();
    papers.forEach(p => p.pdbs?.forEach(pdb => {
      if (pdb.method) methodMap.set(pdb.method, (methodMap.get(pdb.method) || 0) + 1);
    }));
    const colors = ['#2d8f8f', '#7c5cbf', '#c9872e', '#c96442', '#94a3b8'];
    let ci = 0;
    methodMap.forEach((value, label) => {
      methodDist.push({ label, value, color: colors[ci++ % colors.length] });
    });
    methodDist.sort((a, b) => b.value - a.value);

    const journalMap = new Map<string, number>();
    papers.forEach(p => {
      if (p.journal) journalMap.set(p.journal, (journalMap.get(p.journal) || 0) + 1);
    });
    const topJournals = Array.from(journalMap.entries())
      .map(([label, value]) => ({ label, value }))
      .sort((a, b) => b.value - a.value);

    const withIf = papers.filter(p => p.IF != null);
    const avgIf = withIf.length > 0 ? withIf.reduce((s, p) => s + p.IF!, 0) / withIf.length : null;

    return { methodDist, topJournals, avgIf, total: papers.length, withIf: withIf.length };
  }, [mode, papers]);

  if (mode === 'weekly' && !weeklyStats) return null;
  if (mode === 'evaluation' && !evalStats) return null;
  if (mode === 'literature' && !litStats) return null;

  return (
    <div className="border-b border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220]">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-1.5 px-4 py-2 text-[11px] font-medium text-claude-text-muted hover:text-claude-text-secondary transition-colors"
      >
        {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <BarChart3 className="h-3 w-3" />
        {t.quickStats}
        {mode === 'weekly' && weeklyStats && (
          <span className="ml-1 text-[10px] text-claude-text-muted">
            · {weeklyStats.total} {locale === 'zh' ? '个结构' : 'structures'}
            {weeklyStats.avgRes != null && ` · avg ${weeklyStats.avgRes.toFixed(2)}Å`}
          </span>
        )}
        {mode === 'evaluation' && evalStats && (
          <span className="ml-1 text-[10px] text-claude-text-muted">
            · {evalStats.total} {locale === 'zh' ? '个靶点' : 'targets'} · {locale === 'zh' ? '平均' : 'avg'} {evalStats.avgCov.toFixed(0)}% {locale === 'zh' ? '覆盖率' : 'coverage'}
          </span>
        )}
        {mode === 'literature' && litStats && (
          <span className="ml-1 text-[10px] text-claude-text-muted">
            · {litStats.total} {locale === 'zh' ? '篇论文' : 'papers'}
            {litStats.avgIf != null && (locale === 'zh' ? ` · 平均 IF ${litStats.avgIf.toFixed(1)}` : ` · avg IF ${litStats.avgIf.toFixed(1)}`)}
          </span>
        )}
      </button>
      <div
        className="overflow-hidden transition-all duration-300 ease-in-out"
        style={{ maxHeight: expanded ? 400 : 0, opacity: expanded ? 1 : 0 }}
      >
        <div className="px-4 pb-3">
          {mode === 'weekly' && weeklyStats && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Method Distribution Pie */}
              <div className="p-3 rounded-lg border border-claude-border/50 dark:border-[#3d3832]/50 bg-claude-border-light/20 dark:bg-[#1a1917]/20">
                <div className="text-[10px] font-semibold text-claude-text-muted uppercase tracking-wider mb-2">{locale === 'zh' ? '方法分布' : 'Method Distribution'}</div>
                <SvgPieChart data={weeklyStats.methodDist} />
              </div>
              {/* Resolution Distribution */}
              <div className="p-3 rounded-lg border border-claude-border/50 dark:border-[#3d3832]/50 bg-claude-border-light/20 dark:bg-[#1a1917]/20">
                <div className="text-[10px] font-semibold text-claude-text-muted uppercase tracking-wider mb-2">{locale === 'zh' ? '分辨率分布' : 'Resolution Distribution'}</div>
                <ResolutionDistribution entries={entries} />
              </div>
              {/* Top Journals */}
              <div className="p-3 rounded-lg border border-claude-border/50 dark:border-[#3d3832]/50 bg-claude-border-light/20 dark:bg-[#1a1917]/20">
                <div className="text-[10px] font-semibold text-claude-text-muted uppercase tracking-wider mb-2">{locale === 'zh' ? '顶级期刊' : 'Top Journals'}</div>
                <SvgBarChart data={weeklyStats.topJournals} />
              </div>
            </div>
          )}
          {mode === 'evaluation' && evalStats && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Coverage Overview */}
              <div className="p-3 rounded-lg border border-claude-border/50 dark:border-[#3d3832]/50 bg-claude-border-light/20 dark:bg-[#1a1917]/20">
                <div className="text-[10px] font-semibold text-claude-text-muted uppercase tracking-wider mb-2">{locale === 'zh' ? '覆盖率概览' : 'Coverage Overview'}</div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-claude-text-secondary">{locale === 'zh' ? '有 PDB 结构' : 'With PDB structures'}</span>
                    <span className="font-mono font-medium text-claude-text">{evalStats.withStruct}/{evalStats.total}</span>
                  </div>
                  <div className="h-2 bg-claude-border-light dark:bg-[#2b2926] rounded-full overflow-hidden">
                    <div className="h-full bg-[#2d8f8f] rounded-full transition-all duration-500" style={{ width: `${evalStats.total > 0 ? (evalStats.withStruct / evalStats.total) * 100 : 0}%` }} />
                  </div>
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-claude-text-secondary">{locale === 'zh' ? '有 BLAST 命中' : 'With BLAST hits'}</span>
                    <span className="font-mono font-medium text-claude-text">{evalStats.withBlast}/{evalStats.total}</span>
                  </div>
                  <div className="h-2 bg-claude-border-light dark:bg-[#2b2926] rounded-full overflow-hidden">
                    <div className="h-full bg-[#7c5cbf] rounded-full transition-all duration-500" style={{ width: `${evalStats.total > 0 ? (evalStats.withBlast / evalStats.total) * 100 : 0}%` }} />
                  </div>
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="text-claude-text-secondary">{locale === 'zh' ? '平均覆盖率' : 'Avg coverage'}</span>
                    <span className="font-mono font-medium text-claude-text">{evalStats.avgCov.toFixed(1)}%</span>
                  </div>
                </div>
              </div>
              {/* Top Organisms */}
              <div className="p-3 rounded-lg border border-claude-border/50 dark:border-[#3d3832]/50 bg-claude-border-light/20 dark:bg-[#1a1917]/20">
                <div className="text-[10px] font-semibold text-claude-text-muted uppercase tracking-wider mb-2">{locale === 'zh' ? '热门物种' : 'Top Organisms'}</div>
                <SvgBarChart data={evalStats.topOrgs} defaultColor="#7c5cbf" />
              </div>
              {/* Summary */}
              <div className="p-3 rounded-lg border border-claude-border/50 dark:border-[#3d3832]/50 bg-claude-border-light/20 dark:bg-[#1a1917]/20">
                <div className="text-[10px] font-semibold text-claude-text-muted uppercase tracking-wider mb-2">{locale === 'zh' ? '摘要' : 'Summary'}</div>
                <div className="space-y-1.5 text-[11px]">
                  <div className="flex justify-between"><span className="text-claude-text-secondary">{locale === 'zh' ? '靶点总数' : 'Total targets'}</span><span className="font-mono font-medium text-claude-text">{evalStats.total}</span></div>
                  <div className="flex justify-between"><span className="text-claude-text-secondary">{locale === 'zh' ? '有结构' : 'With structures'}</span><span className="font-mono font-medium text-[#2d8f8f]">{evalStats.withStruct}</span></div>
                  <div className="flex justify-between"><span className="text-claude-text-secondary">{locale === 'zh' ? '有同源' : 'With homologs'}</span><span className="font-mono font-medium text-[#7c5cbf]">{evalStats.withBlast}</span></div>
                  <div className="flex justify-between"><span className="text-claude-text-secondary">{locale === 'zh' ? '平均覆盖率' : 'Avg coverage'}</span><span className="font-mono font-medium text-[#c9872e]">{evalStats.avgCov.toFixed(1)}%</span></div>
                </div>
              </div>
            </div>
          )}
          {mode === 'literature' && litStats && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {/* Method Distribution Pie */}
              <div className="p-3 rounded-lg border border-claude-border/50 dark:border-[#3d3832]/50 bg-claude-border-light/20 dark:bg-[#1a1917]/20">
                <div className="text-[10px] font-semibold text-claude-text-muted uppercase tracking-wider mb-2">{locale === 'zh' ? '方法分布' : 'Method Distribution'}</div>
                {litStats.methodDist.length > 0 ? (
                  <SvgPieChart data={litStats.methodDist} />
                ) : (
                  <div className="text-[10px] text-claude-text-muted py-4 text-center">{locale === 'zh' ? '暂无 PDB 方法' : 'No PDB methods'}</div>
                )}
              </div>
              {/* Top Journals */}
              <div className="p-3 rounded-lg border border-claude-border/50 dark:border-[#3d3832]/50 bg-claude-border-light/20 dark:bg-[#1a1917]/20">
                <div className="text-[10px] font-semibold text-claude-text-muted uppercase tracking-wider mb-2">{locale === 'zh' ? '顶级期刊' : 'Top Journals'}</div>
                <SvgBarChart data={litStats.topJournals} defaultColor="#c9872e" />
              </div>
              {/* Summary */}
              <div className="p-3 rounded-lg border border-claude-border/50 dark:border-[#3d3832]/50 bg-claude-border-light/20 dark:bg-[#1a1917]/20">
                <div className="text-[10px] font-semibold text-claude-text-muted uppercase tracking-wider mb-2">{locale === 'zh' ? '摘要' : 'Summary'}</div>
                <div className="space-y-1.5 text-[11px]">
                  <div className="flex justify-between"><span className="text-claude-text-secondary">{locale === 'zh' ? '论文总数' : 'Total papers'}</span><span className="font-mono font-medium text-claude-text">{litStats.total}</span></div>
                  <div className="flex justify-between"><span className="text-claude-text-secondary">{locale === 'zh' ? '有 IF' : 'With IF'}</span><span className="font-mono font-medium text-[#c9872e]">{litStats.withIf}</span></div>
                  {litStats.avgIf != null && (
                    <div className="flex justify-between"><span className="text-claude-text-secondary">{locale === 'zh' ? '平均 IF' : 'Avg IF'}</span><span className="font-mono font-medium text-[#c96442]">{litStats.avgIf.toFixed(1)}</span></div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
