'use client';

import React, { useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import { useI18n } from '@/lib/i18n';
import {
  ArrowRightLeft, LayoutDashboard, Clock, Database, FlaskConical, CheckCircle2, Target,
  Layers, FileText, Share2, ExternalLink, Box, Info, ArrowUpRight, Dna, Microscope, BarChart3,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { StatCard, CircularProgress, MiniBar } from '@/components/ui/stat-card';
import { LazyMarkdown } from '@/components/lazy-markdown';
import type { Evaluation, EvalBatch, EvalBatchSubTarget, EvalPdbStructure, EvalRow } from '@/lib/pdb-types';
import type { EvaluationViewProps } from './types';
import { getMethodColor, getMethodLabel, getResolutionColor, getIfTierStyle } from '@/components/pdb-helpers';

// Dynamic imports for heavy components (recharts/cmdk-based)
const EvaluationPage = dynamic(() => import('@/components/evaluation-page').then(m => ({ default: m.EvaluationPage })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});

const EvalComparison = dynamic(() => import('@/components/eval-comparison').then(m => ({ default: m.EvalComparison })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});

const EvalBatchCompare = dynamic(() => import('@/components/EvalBatchCompare').then(m => ({ default: m.EvalBatchCompare })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});

const EvalPdbTable = dynamic(() => import('@/components/EvalPdbTable').then(m => ({ default: m.EvalPdbTable })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});

const EvalDashboard = dynamic(() => import('@/components/eval-dashboard').then(m => ({ default: m.EvalDashboard })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});

const EvalGanttTimeline = dynamic(() => import('@/components/eval-gantt-timeline').then(m => ({ default: m.EvalGanttTimeline })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});

const EvalScoreRadar = dynamic(() => import('@/components/EvalScoreRadar').then(m => ({ default: m.EvalScoreRadar })), {
  ssr: false,
  loading: () => <div className="animate-pulse bg-claude-border-light rounded h-8 w-full" />,
});

// StatCard, CircularProgress, sparkline, trend utilities now imported from @/components/ui/stat-card

// ─── Compact Eval Stat Cards ──────────────────────────────────────────────────
// Matches the same overview → separator → action bar pattern as Weekly & Literature

function EvalStatCards({ evaluations, evalBatches, evalLoading }: {
  evaluations: Evaluation[];
  evalBatches: EvalBatch[];
  evalLoading: boolean;
}) {
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

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 p-2 sm:p-3 [grid-auto-rows:1fr] min-w-0 stagger-list">
      {/* Eval Targets — completion rate ring */}
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

      {/* Batches — mini bar showing batch density */}
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

      {/* Avg Coverage — coverage ring */}
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

      {/* ≥80% Coverage — mini bar */}
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

// ─── BatchDetailView ─────────────────────────────────────────────────────────
// Two-column layout mirroring the individual-eval detail page:
//  - Left sidebar (~260px): batch title + sub-target list + common PDB list
//  - Right panel (flex-1): tabs Summary | Common Structures | Sub-Target Detail | Report

type BatchDetailTab = 'Summary' | 'Common Structures' | 'Sub-Target Detail' | 'Report';

/** Parse `commonPdbIds` (stored as a JSON-stringified array) into a string[]. */
function parseCommonPdbIds(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.filter(Boolean) as string[];
  } catch {
    return raw.split(/[\s,]+/).filter(Boolean);
  }
  return [];
}

interface BatchDetailViewProps {
  batchId: string;
  allEvals: Evaluation[];
  batchFetchedEvals: Record<string, Evaluation>;
  evalBatches: EvalBatch[];
  evalBatchSubTargets: Record<string, EvalBatchSubTarget[]>;
  onSelectSubTarget: (uniprotId: string) => void;
  onOpenBatchReport?: (batchId: string, title: string) => void;
}

// ─── BatchCommonPdbView ────────────────────────────────────────────────────
// Simplified batch view: shows the common (shared) PDB list in the middle,
// mirroring the single-eval PDB table layout. The batch's combined report
// is shown in the right detail panel (same as single eval).
function BatchCommonPdbView({
  batchId,
  allEvals,
  evalBatches,
  evalBatchSubTargets,
  onSelectSubTarget,
  onSelectPdb,
}: {
  batchId: string;
  allEvals: Evaluation[];
  evalBatches: EvalBatch[];
  evalBatchSubTargets: Record<string, EvalBatchSubTarget[]>;
  onSelectSubTarget: (uniprotId: string) => void;
  onSelectPdb?: (pdbId: string) => void;
}) {
  const { locale } = useI18n();
  const batch = evalBatches.find(b => b.batchId === batchId);
  const subTargets = evalBatchSubTargets[batchId] || [];
  const commonPdbIds = parseCommonPdbIds(batch?.commonPdbIds);

  // Build a map of pdbId → list of UniProt IDs that have it (for "Shared By" column)
  const pdbHolders = useMemo(() => {
    const map: Record<string, string[]> = {};
    for (const sub of subTargets) {
      const evalData = allEvals.find(e => e.uniprotId === sub.uniprotId);
      if (!evalData) continue;
      for (const s of evalData.pdbStructures || []) {
        if (!map[s.pdbId]) map[s.pdbId] = [];
        if (!map[s.pdbId].includes(sub.uniprotId)) {
          map[s.pdbId].push(sub.uniprotId);
        }
      }
      for (const b of evalData.blastResults || []) {
        if (!map[b.pdbId]) map[b.pdbId] = [];
        if (!map[b.pdbId].includes(sub.uniprotId)) {
          map[b.pdbId].push(sub.uniprotId);
        }
      }
    }
    return map;
  }, [subTargets, allEvals]);

  // Build rows for the common PDB table — EvalPdbTable-compatible EvalRow[].
  // For each common pdbId, find the first eval that has it (as either a
  // direct PDB structure or a BLAST hit) and surface its full RCSB fields.
  // The "shared by" info is encoded into the row's `_source` and as a tooltip
  // so EvalPdbTable can render the standard 9-column schema; we show the
  // actual holder list in a small annotation chip below the table.
  const commonPdbRows: EvalRow[] = useMemo(() => {
    return commonPdbIds.map((pdbId): EvalRow => {
      // Find the first eval that has this PDB to get full method/resolution/etc.
      let found: EvalPdbStructure | null = null;
      for (const sub of subTargets) {
        const evalData = allEvals.find(e => e.uniprotId === sub.uniprotId);
        if (!evalData) continue;
        const struct = (evalData.pdbStructures || []).find(s => s.pdbId === pdbId);
        if (struct) { found = struct; break; }
        const blast = (evalData.blastResults || []).find(b => b.pdbId === pdbId);
        if (blast) {
          // Build a minimal EvalPdbStructure from a BLAST row so EvalPdbTable
          // can render it. Missing fields are null.
          found = {
            id: -1,
            uniprotId: evalData.uniprotId,
            pdbId,
            method: blast.method || null,
            resolution: blast.resolution ?? null,
            title: blast.title || blast.description || null,
            depositionDate: null,
            releaseDate: blast.releaseDate || null,
            ligand: null,
            ligandNames: null,
            journal: null,
            journalIf: blast.journalIf ?? null,
            doi: null,
            pubmedId: null,
            organism: null,
            authors: null,
            isCryoem: false, isXray: false, isNmr: false,
            ifTier: blast.ifTier || null,
            chainId: null, unpStart: null, unpEnd: null,
          } as EvalPdbStructure;
          break;
        }
      }
      if (!found) {
        // Fallback: minimal row from pdbId only
        found = {
          id: -1, uniprotId: '', pdbId, method: null, resolution: null,
          title: null, depositionDate: null, releaseDate: null,
          ligand: null, ligandNames: null, journal: null, journalIf: null,
          doi: null, pubmedId: null, organism: null, authors: null,
          isCryoem: false, isXray: false, isNmr: false, ifTier: null,
          chainId: null, unpStart: null, unpEnd: null,
        } as EvalPdbStructure;
      }
      return {
        ...found,
        _type: 'structure' as const,
        // Tag with the holder list (sub-targets sharing this PDB) so a
        // downstream UI layer could show it. EvalPdbTable ignores unknown
        // fields, so this is safe.
        _sharedBy: pdbHolders[pdbId] || [],
      } as EvalRow;
    });
  }, [commonPdbIds, subTargets, allEvals, pdbHolders]);

  // Backward-compat: keep the old `rows` for the small "shared by" chip strip
  // below the table — it just needs pdbId + holders per row.
  const sharedByRows = useMemo(() => {
    return commonPdbIds.map(pdbId => ({
      pdbId,
      holders: pdbHolders[pdbId] || [],
    }));
  }, [commonPdbIds, pdbHolders]);

  if (!batch) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-claude-text-muted">
        <Layers className="h-8 w-8 mb-2 opacity-40" />
        <p className="text-xs">{locale === 'zh' ? '未找到批次' : 'Batch not found'}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar — batch title + stats */}
      <div className="flex items-center gap-3 px-4 py-2.5 border-b border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] flex-shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-500/15 to-violet-500/5 border border-violet-500/20 flex items-center justify-center flex-shrink-0">
            <Layers className="h-4 w-4 text-violet-600 dark:text-violet-300" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-semibold text-claude-text truncate">{batch.title || 'Batch'}</span>
              <Badge variant="outline" className="text-[9px] font-semibold px-1.5 h-4 rounded bg-violet-50 dark:bg-violet-900/20 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800/40 shrink-0">
                {subTargets.length} targets
              </Badge>
            </div>
            <div className="text-[10px] text-claude-text-muted font-mono">{batch.batchId}</div>
          </div>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-3 text-[10px] text-claude-text-muted">
          <span className="flex items-center gap-1">
            <Box className="h-3 w-3" />
            <span className="font-mono font-semibold text-claude-text-secondary">{commonPdbIds.length}</span> shared PDB
          </span>
        </div>
      </div>

      {/* Sub-target chips — clickable to open individual eval */}
      <div className="flex items-center gap-1.5 px-4 py-2 border-b border-claude-border/50 dark:border-[#3d3832]/50 overflow-x-auto flex-shrink-0">
        <span className="text-[9px] uppercase tracking-wider text-claude-text-muted font-semibold shrink-0 mr-1">{locale === 'zh' ? '靶点：' : 'Targets:'}</span>
        {subTargets.length === 0 ? (
          <span className="text-[10px] text-claude-text-muted italic">{locale === 'zh' ? '无子靶点' : 'No sub-targets'}</span>
        ) : (
          subTargets.map(sub => (
            <button
              key={sub.uniprotId}
              onClick={() => onSelectSubTarget(sub.uniprotId)}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-mono font-medium bg-claude-border-light/60 dark:bg-[#2b2926]/60 hover:bg-claude-accent/10 hover:text-claude-accent text-claude-text-secondary transition-all border border-transparent hover:border-claude-accent/20 whitespace-nowrap"
              title={`${sub.proteinName || sub.geneName || sub.uniprotId} · ${sub.pdbCount} PDB · ${sub.blastCount} BLAST`}
            >
              {sub.uniprotId}
              <span className="text-[8px] text-claude-text-muted font-sans">{sub.pdbCount}P</span>
            </button>
          ))
        )}
      </div>

      {/* Common PDB list — same 9-column schema as single eval EvalPdbTable */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {commonPdbIds.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-claude-text-muted">
            <Box className="h-8 w-8 mb-2 opacity-40" />
            <p className="text-xs">No common PDB structures found between targets</p>
            <p className="text-[10px] mt-1">Run the batch evaluation to detect shared structures.</p>
          </div>
        ) : (
          <EvalPdbTable
            rows={commonPdbRows}
            loading={false}
            compact={false}
            onSelectRow={(row) => onSelectPdb?.(row.pdbId)}
          />
        )}
      </div>

      {/* Shared-by annotation strip — shows which sub-targets share each PDB
          (kept because EvalPdbTable doesn't have a "shared by" column).
          Maps each common pdbId → its holder list. */}
      {sharedByRows.length > 0 && (
        <div className="border-t border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] px-4 py-2 max-h-[120px] overflow-y-auto custom-scrollbar flex-shrink-0">
          <div className="text-[9px] uppercase tracking-wider text-claude-text-muted font-semibold mb-1.5">
            {locale === 'zh' ? '共享子靶点' : 'Shared By'}
          </div>
          <div className="flex flex-col gap-1">
            {sharedByRows.map(({ pdbId, holders }) => (
              <div key={pdbId} className="flex items-center gap-1.5 text-[10px]">
                <span className="font-mono font-bold text-claude-accent shrink-0 w-[60px]">{pdbId}</span>
                <div className="flex items-center gap-0.5 flex-wrap">
                  {holders.length === 0 ? (
                    <span className="text-claude-text-muted italic">—</span>
                  ) : (
                    <>
                      {holders.slice(0, 6).map(h => (
                        <span key={h} className="text-[9px] font-mono px-1 py-0.5 rounded bg-claude-border-light/60 dark:bg-[#2b2926]/60 text-claude-text-muted">
                          {h}
                        </span>
                      ))}
                      {holders.length > 6 && (
                        <span className="text-[9px] text-claude-text-muted">+{holders.length - 6}</span>
                      )}
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function getScoreColor(score: number): string {
  if (score >= 80) return '#2d8f8f';
  if (score >= 50) return '#c9872e';
  if (score >= 25) return '#ea580c';
  return '#dc2626';
}

// Parse Evaluation.scores JSON into a {key: {score, max}} map.
// The DB stores scores as e.g. {"X-ray":{"score":8,"rating":"good","maxScore":10},...}
function parseEvalScores(
  scoresStr: string | null | undefined
): Record<string, { score: number; max: number; rating?: string }> {
  if (!scoresStr) return {};
  try {
    const parsed = JSON.parse(scoresStr);
    if (typeof parsed === 'object' && parsed !== null) {
      const result: Record<string, { score: number; max: number; rating?: string }> = {};
      for (const [key, val] of Object.entries(parsed)) {
        if (typeof val === 'number') {
          result[key] = { score: val, max: 10 };
        } else if (
          typeof val === 'object' &&
          val !== null &&
          'score' in (val as Record<string, unknown>)
        ) {
          const v = val as {
            score: number;
            max?: number;
            maxScore?: number;
            rating?: string;
          };
          result[key] = {
            score: v.score,
            max: v.max ?? v.maxScore ?? 10,
            rating: v.rating,
          };
        }
      }
      return result;
    }
  } catch {
    /* ignore */
  }
  return {};
}

// Average each score category across all sub-target evals (for radar chart).
function aggregateScores(
  evals: (Evaluation | undefined)[]
): Record<string, { score: number; max: number }> {
  const sums: Record<string, { total: number; count: number; max: number }> = {};
  for (const ev of evals) {
    if (!ev?.scores) continue;
    const parsed = parseEvalScores(ev.scores);
    for (const [key, val] of Object.entries(parsed)) {
      if (!sums[key]) sums[key] = { total: 0, count: 0, max: val.max || 10 };
      sums[key].total += val.score;
      sums[key].count += 1;
      if (val.max > sums[key].max) sums[key].max = val.max;
    }
  }
  const result: Record<string, { score: number; max: number }> = {};
  for (const [key, val] of Object.entries(sums)) {
    result[key] = {
      score: val.count > 0 ? val.total / val.count : 0,
      max: val.max,
    };
  }
  return result;
}

// Column definitions for the sortable common structures table
const COMMON_STRUCT_COLUMNS: {
  field: string;
  label: string;
  widthClass: string;
  sortable: boolean;
}[] = [
  { field: 'pdbId', label: 'PDB ID', widthClass: 'w-[90px]', sortable: true },
  { field: 'method', label: 'Method', widthClass: 'w-[100px]', sortable: true },
  { field: 'resolution', label: 'Res. (Å)', widthClass: 'w-[90px]', sortable: true },
  { field: 'journalIf', label: 'Journal (IF)', widthClass: 'w-[110px]', sortable: true },
  { field: 'title', label: 'Title', widthClass: 'min-w-0', sortable: true },
  { field: 'holders', label: 'Shared By', widthClass: 'w-[180px]', sortable: true },
];

function BatchDetailView({
  batchId,
  allEvals,
  batchFetchedEvals,
  evalBatches,
  evalBatchSubTargets,
  onSelectSubTarget,
  onOpenBatchReport,
}: BatchDetailViewProps) {
  const { locale } = useI18n();
  const [activeTab, setActiveTab] = useState<BatchDetailTab>('Summary');
  const [selectedSubTarget, setSelectedSubTarget] = useState<string | null>(null);
  const [sortField, setSortField] = useState<string>('pdbId');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const batch = evalBatches.find(b => b.batchId === batchId);
  const subTargets = evalBatchSubTargets[batchId] || [];

  const commonPdbIds = useMemo(
    () => parseCommonPdbIds(batch?.commonPdbIds),
    [batch?.commonPdbIds]
  );
  const combinedReport = batch?.combinedReport || '';

  // Resolve each sub-target's Evaluation object (from allEvals or batchFetchedEvals).
  const subTargetEvals = useMemo(() => {
    return subTargets.map(sub => {
      const evalObj =
        allEvals.find(e => e.uniprotId === sub.uniprotId) ||
        batchFetchedEvals[sub.uniprotId];
      return { sub, eval: evalObj };
    });
  }, [subTargets, allEvals, batchFetchedEvals]);

  // For each common PDB ID, find which sub-targets share it and grab structure details.
  // Pick the best structure (lowest non-null resolution) for display.
  const commonStructures = useMemo(() => {
    return commonPdbIds.map(pdbId => {
      const holders: { uniprotId: string; geneName: string }[] = [];
      let structure: EvalPdbStructure | undefined;
      let bestStructure: EvalPdbStructure | undefined;
      for (const { sub, eval: evalObj } of subTargetEvals) {
        if (!evalObj) continue;
        const found = (evalObj.pdbStructures || []).find(s => s.pdbId === pdbId);
        if (found) {
          holders.push({ uniprotId: sub.uniprotId, geneName: sub.geneName || '' });
          if (!structure) structure = found;
          if (
            !bestStructure ||
            (found.resolution != null &&
              (bestStructure.resolution == null ||
                found.resolution < bestStructure.resolution))
          ) {
            bestStructure = found;
          }
        }
      }
      return { pdbId, holders, structure: bestStructure || structure };
    });
  }, [commonPdbIds, subTargetEvals]);

  // Batch-level aggregate stats (computed defensively in case batch is undefined)
  const totalPdb = subTargets.reduce((sum, sub) => sum + (sub.pdbCount || 0), 0);
  const totalBlast = subTargets.reduce((sum, sub) => sum + (sub.blastCount || 0), 0);
  const avgScore =
    subTargets.length > 0
      ? subTargets.reduce((sum, sub) => sum + (sub.bestScore || 0), 0) / subTargets.length
      : 0;
  const avgCov =
    subTargetEvals.length > 0
      ? subTargetEvals.reduce((sum, { eval: ev }) => sum + (ev?.coverage ?? 0), 0) /
        subTargetEvals.length
      : 0;
  const scoreColor = getScoreColor(avgScore * 10); // bestScore is 0-10, scale to 0-100 for color
  const targetCount = batch
    ? (batch.targetCount ?? batch.subTargetCount ?? subTargets.length)
    : subTargets.length;
  const crossOk: boolean | null = batch?.crossReportOk ?? null;

  // Aggregated scores across sub-targets (for radar)
  const aggregatedScores = useMemo(
    () => aggregateScores(subTargetEvals.map(({ eval: ev }) => ev)),
    [subTargetEvals]
  );

  // Synthetic Evaluation object for the radar chart (aggregated scores).
  const syntheticEval = useMemo<Evaluation>(
    () => ({
      uniprotId: 'BATCH_AGGREGATE',
      entryName: batch?.title || 'Batch',
      proteinName: batch?.title || 'Batch Aggregate',
      geneNames: null,
      organism: null,
      sequenceLength: null,
      coverage: avgCov,
      scores: JSON.stringify(aggregatedScores),
      report: null,
      provenance: null,
      batchId,
      createdAt: batch?.createdAt || new Date().toISOString(),
      updatedAt: batch?.createdAt || new Date().toISOString(),
      pdbStructures: [],
      blastResults: [],
    }),
    [aggregatedScores, batch, batchId, avgCov]
  );

  // Selected sub-target's eval
  const selectedSubEval = useMemo(() => {
    if (!selectedSubTarget) return null;
    return (
      allEvals.find(e => e.uniprotId === selectedSubTarget) ||
      batchFetchedEvals[selectedSubTarget] ||
      null
    );
  }, [selectedSubTarget, allEvals, batchFetchedEvals]);

  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('asc');
    }
  };

  const sortedCommonStructures = useMemo(() => {
    const sorted = [...commonStructures];
    sorted.sort((a, b) => {
      let aVal: number | string;
      let bVal: number | string;
      if (sortField === 'pdbId') {
        aVal = a.pdbId;
        bVal = b.pdbId;
      } else if (sortField === 'method') {
        aVal = a.structure?.method || '';
        bVal = b.structure?.method || '';
      } else if (sortField === 'resolution') {
        aVal = a.structure?.resolution ?? 9999;
        bVal = b.structure?.resolution ?? 9999;
      } else if (sortField === 'journalIf') {
        aVal = a.structure?.journalIf ?? -1;
        bVal = b.structure?.journalIf ?? -1;
      } else if (sortField === 'title') {
        aVal = a.structure?.title || '';
        bVal = b.structure?.title || '';
      } else if (sortField === 'holders') {
        aVal = a.holders.length;
        bVal = b.holders.length;
      } else {
        return 0;
      }

      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;

      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
      }
      const aStr = String(aVal).toLowerCase();
      const bStr = String(bVal).toLowerCase();
      return sortDir === 'asc' ? aStr.localeCompare(bStr) : bStr.localeCompare(aStr);
    });
    return sorted;
  }, [commonStructures, sortField, sortDir]);

  const tabs: BatchDetailTab[] = [
    'Summary',
    'Common Structures',
    'Sub-Target Detail',
    'Report',
  ];

  // Helper: open a sub-target in the in-batch Sub-Target Detail tab
  const previewSubTarget = (uniprotId: string) => {
    setSelectedSubTarget(uniprotId);
    setActiveTab('Sub-Target Detail');
  };

  if (!batch) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-claude-text-muted">
        <Layers className="h-8 w-8 mb-2 opacity-40" />
        <p className="text-xs">{locale === 'zh' ? '未找到批次' : 'Batch not found'}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* ── Batch Header (top bar, full width) ── */}
      <div className="flex items-center gap-2 px-4 py-3 flex-shrink-0 border-b border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220]">
        <Layers className="h-4 w-4 text-claude-accent flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-claude-text truncate">
            {batch.title || 'Batch'}
          </h2>
          <p className="text-[10px] text-claude-text-muted">
            Complex Evaluation Group · {batch.batchId}
          </p>
        </div>
        <Badge
          variant="outline"
          className="bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800/40 text-[10px] font-semibold"
        >
          <Layers className="h-2.5 w-2.5" />
          {targetCount} target{targetCount !== 1 ? 's' : ''}
        </Badge>
        {crossOk !== null && (
          <Badge
            variant="outline"
            className={`text-[10px] font-semibold ${
              crossOk
                ? 'bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800/40'
                : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800/40'
            }`}
          >
            {crossOk ? <CheckCircle2 className="h-2.5 w-2.5" /> : <Info className="h-2.5 w-2.5" />}
            {crossOk ? 'cross-report OK' : 'cross-report failed'}
          </Badge>
        )}
      </div>

      {/* ── Two-column layout ── */}
      <div className="flex flex-1 min-h-0">
        {/* ── Left Sidebar (~260px) ── */}
        <div className="w-[260px] flex-shrink-0 border-r border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] flex flex-col">
          <div className="px-3 py-2.5 border-b border-claude-border dark:border-[#3d3832]">
            <div className="flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5 text-claude-accent" />
              <span className="text-[11px] font-semibold text-claude-text truncate">
                {batch.title || 'Batch'}
              </span>
            </div>
            <div className="text-[10px] text-claude-text-muted mt-0.5">
              {targetCount} target{targetCount !== 1 ? 's' : ''} · {totalPdb} PDB ·{' '}
              {commonPdbIds.length} shared
            </div>
          </div>

          <div className="flex-1 overflow-y-auto sidebar-scroll">
            {/* Sub-targets list */}
            <div className="p-2 space-y-0.5">
              <div className="text-[9px] uppercase tracking-wider text-claude-text-muted font-semibold px-2 py-1.5 flex items-center justify-between">
                <span>{locale === 'zh' ? '子靶点' : 'Sub-Targets'}</span>
                <span className="font-mono">{subTargets.length}</span>
              </div>
              {subTargets.length === 0 ? (
                <p className="text-[10px] text-claude-text-muted italic px-2 py-2">
                  {locale === 'zh' ? '暂无子靶点记录' : 'No sub-targets recorded'}
                </p>
              ) : (
                subTargets.map(sub => {
                  const subEval =
                    allEvals.find(e => e.uniprotId === sub.uniprotId) ||
                    batchFetchedEvals[sub.uniprotId];
                  const covPct = subEval?.coverage ? Math.min(subEval.coverage, 100) : 0;
                  const covColor = getScoreColor(covPct);
                  const subScore = sub.bestScore || 0;
                  const subScoreColor = getScoreColor(subScore * 10);
                  const isSelected = selectedSubTarget === sub.uniprotId;
                  return (
                    <button
                      key={sub.uniprotId}
                      onClick={() => previewSubTarget(sub.uniprotId)}
                      className={`w-full text-left p-2 rounded-md border transition-all duration-150 ${
                        isSelected
                          ? 'bg-claude-accent/10 dark:bg-[#d4784f]/10 border-claude-accent/40 dark:border-[#d4784f]/40 border-l-[3px] border-l-claude-accent/60'
                          : 'bg-transparent border-transparent hover:bg-claude-border-light/40 dark:hover:bg-[#3d3832]/30 hover:border-claude-border dark:hover:border-[#3d3832]'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-1.5">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1">
                            <span className="font-mono text-[11px] font-semibold text-claude-accent">
                              {sub.uniprotId}
                            </span>
                            {sub.geneName && (
                              <span className="text-[9px] text-claude-text-muted truncate">
                                ({sub.geneName})
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-claude-text-muted truncate mt-0.5">
                            {sub.proteinName || subEval?.proteinName || '-'}
                          </div>
                        </div>
                        {subScore > 0 && (
                          <span
                            className="text-[10px] font-mono font-bold flex-shrink-0"
                            style={{ color: subScoreColor }}
                          >
                            {subScore.toFixed(1)}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[9px] text-claude-text-muted inline-flex items-center gap-0.5">
                          <Box className="h-2.5 w-2.5" />
                          <span className="font-mono font-semibold text-claude-text">
                            {sub.pdbCount || 0}
                          </span>
                        </span>
                        <span className="text-[9px] text-claude-text-muted inline-flex items-center gap-0.5">
                          <Microscope className="h-2.5 w-2.5" />
                          <span className="font-mono font-semibold text-claude-text">
                            {sub.blastCount || 0}
                          </span>
                        </span>
                        {covPct > 0 && (
                          <span
                            className="text-[9px] font-mono ml-auto"
                            style={{ color: covColor }}
                          >
                            {covPct.toFixed(0)}%
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>

            {/* Common PDB list */}
            {commonPdbIds.length > 0 && (
              <div className="p-2 border-t border-claude-border/60 dark:border-[#3d3832]/60 space-y-0.5">
                <div className="text-[9px] uppercase tracking-wider text-claude-text-muted font-semibold px-2 py-1.5 flex items-center justify-between">
                  <span className="flex items-center gap-1">
                    <Share2 className="h-2.5 w-2.5" />
                    Common Structures
                  </span>
                  <span className="font-mono">{commonPdbIds.length}</span>
                </div>
                <div className="max-h-48 overflow-y-auto sidebar-scroll space-y-0.5">
                  {commonPdbIds.map(pdbId => (
                    <a
                      key={pdbId}
                      href={`https://www.rcsb.org/structure/${pdbId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center justify-between gap-1 px-2 py-1 rounded-md text-[10px] font-mono font-semibold text-claude-accent hover:bg-claude-border-light/40 dark:hover:bg-[#3d3832]/30 transition-colors"
                    >
                      <span className="inline-flex items-center gap-1">
                        <Box className="h-2.5 w-2.5 opacity-70" />
                        {pdbId}
                      </span>
                      <ExternalLink className="h-2.5 w-2.5 opacity-50" />
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ── Right Detail Panel ── */}
        <div className="flex-1 flex flex-col min-h-0 min-w-0">
          {/* Tab bar */}
          <div className="flex items-center gap-1 px-3 py-2 flex-shrink-0 border-b border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220]">
            {tabs.map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`h-7 px-3 text-[11px] font-medium rounded-md transition-colors whitespace-nowrap ${
                  activeTab === tab
                    ? 'bg-claude-accent/10 text-claude-accent'
                    : 'text-claude-text-muted hover:text-claude-text-secondary hover:bg-claude-border-light/40 dark:hover:bg-[#3d3832]/30'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 min-h-0 overflow-y-auto sidebar-scroll p-4 space-y-4">
            {/* ───── Summary Tab ───── */}
            {activeTab === 'Summary' && (
              <div className="space-y-4">
                {/* Overview */}
                <div className="rounded-lg border border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] p-4 space-y-2">
                  <div className="flex items-start gap-2">
                    <Box className="h-4 w-4 text-claude-accent mt-0.5 flex-shrink-0" />
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-claude-text">
                        {batch.title || 'Untitled Batch'}
                      </h3>
                      <p className="text-[11px] text-claude-text-muted mt-1 leading-relaxed">
                        This batch groups {targetCount} protein target
                        {targetCount !== 1 ? 's' : ''} for cross-target structural comparison.
                        A combined LLM relationship report{' '}
                        {combinedReport ? (
                          <span className="text-teal-600 dark:text-teal-400 font-medium">
                            is available
                          </span>
                        ) : (
                          <span className="text-claude-text-muted font-medium">
                            was not generated
                          </span>
                        )}
                        {commonPdbIds.length > 0 && (
                          <>
                            {' '}— {commonPdbIds.length} PDB structure
                            {commonPdbIds.length !== 1 ? 's are' : ' is'} shared across all
                            targets.
                          </>
                        )}
                        .
                      </p>
                    </div>
                  </div>
                </div>

                {/* Stat grid */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className="rounded-lg border border-claude-border dark:border-[#3d3832] bg-claude-border-light/30 dark:bg-[#1a1917]/30 p-3">
                    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-claude-text-muted">
                      <Layers className="h-3 w-3" /> Targets
                    </div>
                    <div className="text-lg font-bold text-claude-text font-mono mt-1">
                      {targetCount}
                    </div>
                    <div className="text-[9px] text-claude-text-muted mt-0.5">
                      {subTargets.length} listed
                    </div>
                  </div>
                  <div className="rounded-lg border border-claude-border dark:border-[#3d3832] bg-claude-border-light/30 dark:bg-[#1a1917]/30 p-3">
                    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-claude-text-muted">
                      <Database className="h-3 w-3" /> Total PDB
                    </div>
                    <div className="text-lg font-bold text-claude-text font-mono mt-1">
                      {totalPdb}
                    </div>
                    <div className="text-[9px] text-claude-text-muted mt-0.5">
                      {totalBlast} BLAST hits
                    </div>
                  </div>
                  <div className="rounded-lg border border-claude-border dark:border-[#3d3832] bg-claude-border-light/30 dark:bg-[#1a1917]/30 p-3">
                    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-claude-text-muted">
                      <Share2 className="h-3 w-3" /> Common PDB
                    </div>
                    <div className="text-lg font-bold text-claude-text font-mono mt-1">
                      {commonPdbIds.length}
                    </div>
                    <div className="text-[9px] text-claude-text-muted mt-0.5">
                      shared across targets
                    </div>
                  </div>
                  <div className="rounded-lg border border-claude-border dark:border-[#3d3832] bg-claude-border-light/30 dark:bg-[#1a1917]/30 p-3">
                    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-claude-text-muted">
                      <BarChart3 className="h-3 w-3" /> Avg Score
                    </div>
                    <div
                      className="text-lg font-bold font-mono mt-1"
                      style={{ color: scoreColor }}
                    >
                      {avgScore.toFixed(1)}
                    </div>
                    <div className="text-[9px] text-claude-text-muted mt-0.5">
                      avg cov {avgCov.toFixed(0)}%
                    </div>
                  </div>
                </div>

                {/* Per-target score breakdown table + radar */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                  {/* Score breakdown table */}
                  <div className="rounded-lg border border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] overflow-hidden">
                    <div className="px-3 py-2 border-b border-claude-border dark:border-[#3d3832] flex items-center gap-1.5">
                      <BarChart3 className="h-3.5 w-3.5 text-claude-accent" />
                      <h4 className="text-[11px] font-semibold text-claude-text">
                        Per-Target Score Breakdown
                      </h4>
                    </div>
                    <div className="overflow-x-auto sidebar-scroll">
                      <table className="w-full text-[10px]">
                        <thead className="bg-claude-border-light/40 dark:bg-[#3d3832]/30 border-b border-claude-border dark:border-[#3d3832]">
                          <tr>
                            <th className="px-2 py-1.5 text-left text-[9px] font-bold text-claude-text-muted uppercase tracking-wider">
                              UniProt
                            </th>
                            <th className="px-2 py-1.5 text-right text-[9px] font-bold text-claude-text-muted uppercase tracking-wider">
                              X-ray
                            </th>
                            <th className="px-2 py-1.5 text-right text-[9px] font-bold text-claude-text-muted uppercase tracking-wider">
                              Cryo-EM
                            </th>
                            <th className="px-2 py-1.5 text-right text-[9px] font-bold text-claude-text-muted uppercase tracking-wider">
                              NMR
                            </th>
                            <th className="px-2 py-1.5 text-right text-[9px] font-bold text-claude-text-muted uppercase tracking-wider">
                              Overall
                            </th>
                            <th className="px-2 py-1.5 text-right text-[9px] font-bold text-claude-text-muted uppercase tracking-wider">
                              Cov%
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {subTargetEvals.map(({ sub, eval: ev }) => {
                            const scores = ev ? parseEvalScores(ev.scores) : {};
                            const xray = scores['X-ray']?.score;
                            const cryoem = scores['Cryo-EM']?.score;
                            const nmr = scores['NMR']?.score;
                            const overall =
                              scores['Overall']?.score ?? sub.bestScore ?? 0;
                            const cov = ev?.coverage ?? 0;
                            return (
                              <tr
                                key={sub.uniprotId}
                                className="border-b border-claude-border/30 dark:border-[#3d3832]/30 last:border-b-0 hover:bg-claude-border-light/30 dark:hover:bg-[#3d3832]/20 cursor-pointer"
                                onClick={() => previewSubTarget(sub.uniprotId)}
                              >
                                <td className="px-2 py-1.5 font-mono font-semibold text-claude-accent">
                                  {sub.uniprotId}
                                </td>
                                <td className="px-2 py-1.5 text-right font-mono text-claude-text">
                                  {xray != null ? xray.toFixed(1) : '—'}
                                </td>
                                <td className="px-2 py-1.5 text-right font-mono text-claude-text">
                                  {cryoem != null ? cryoem.toFixed(1) : '—'}
                                </td>
                                <td className="px-2 py-1.5 text-right font-mono text-claude-text">
                                  {nmr != null ? nmr.toFixed(1) : '—'}
                                </td>
                                <td
                                  className="px-2 py-1.5 text-right font-mono font-bold"
                                  style={{ color: getScoreColor(overall * 10) }}
                                >
                                  {overall.toFixed(1)}
                                </td>
                                <td
                                  className="px-2 py-1.5 text-right font-mono"
                                  style={{ color: getScoreColor(cov) }}
                                >
                                  {cov.toFixed(0)}%
                                </td>
                              </tr>
                            );
                          })}
                          {/* Aggregate row */}
                          <tr className="bg-claude-border-light/40 dark:bg-[#3d3832]/30 font-semibold">
                            <td className="px-2 py-1.5 font-mono text-[10px] text-claude-text">
                              AVG
                            </td>
                            <td className="px-2 py-1.5 text-right font-mono text-claude-text">
                              {aggregatedScores['X-ray']?.score.toFixed(1) ?? '—'}
                            </td>
                            <td className="px-2 py-1.5 text-right font-mono text-claude-text">
                              {aggregatedScores['Cryo-EM']?.score.toFixed(1) ?? '—'}
                            </td>
                            <td className="px-2 py-1.5 text-right font-mono text-claude-text">
                              {aggregatedScores['NMR']?.score.toFixed(1) ?? '—'}
                            </td>
                            <td
                              className="px-2 py-1.5 text-right font-mono text-claude-text"
                              style={{ color: scoreColor }}
                            >
                              {aggregatedScores['Overall']?.score.toFixed(1) ??
                                avgScore.toFixed(1)}
                            </td>
                            <td className="px-2 py-1.5 text-right font-mono text-claude-text">
                              {avgCov.toFixed(0)}%
                            </td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Score Radar */}
                  <div className="rounded-lg border border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] p-3">
                    <div className="flex items-center gap-1.5 mb-2">
                      <BarChart3 className="h-3.5 w-3.5 text-claude-accent" />
                      <h4 className="text-[11px] font-semibold text-claude-text">
                        Aggregated Score Radar
                      </h4>
                    </div>
                    <div className="flex justify-center items-center min-h-[220px]">
                      <EvalScoreRadar evaluation={syntheticEval} size={220} />
                    </div>
                  </div>
                </div>

                {/* Per-target coverage bars */}
                <div className="rounded-lg border border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] p-3 space-y-2">
                  <h4 className="text-[11px] font-semibold text-claude-text flex items-center gap-1.5">
                    <Target className="h-3.5 w-3.5 text-claude-accent" />
                    Per-Target Coverage
                  </h4>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto sidebar-scroll">
                    {subTargetEvals.map(({ sub, eval: ev }) => {
                      const cov = ev?.coverage ?? 0;
                      const covColor = getScoreColor(cov);
                      return (
                        <div key={sub.uniprotId} className="flex items-center gap-2">
                          <button
                            onClick={() => previewSubTarget(sub.uniprotId)}
                            className="font-mono text-[10px] font-semibold text-claude-accent hover:underline w-16 text-left truncate"
                            title={sub.proteinName || sub.uniprotId}
                          >
                            {sub.uniprotId}
                          </button>
                          <div className="flex-1 h-2 rounded-full bg-claude-border dark:bg-[#3d3832] overflow-hidden">
                            <div
                              className="h-full rounded-full"
                              style={{
                                width: `${Math.min(cov, 100)}%`,
                                backgroundColor: covColor,
                              }}
                            />
                          </div>
                          <span className="text-[10px] font-mono font-semibold text-claude-text w-10 text-right">
                            {cov.toFixed(0)}%
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Cross-report status */}
                <div className="rounded-lg border border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] p-3 flex items-start gap-2">
                  <FileText className="h-3.5 w-3.5 text-claude-accent mt-0.5 flex-shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-claude-text">
                        Cross-Target Report
                      </span>
                      {crossOk === null ? (
                        <Badge variant="outline" className="text-[9px] text-claude-text-muted">
                          N/A
                        </Badge>
                      ) : crossOk ? (
                        <Badge
                          variant="outline"
                          className="text-[9px] bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800/40"
                        >
                          <CheckCircle2 className="h-2.5 w-2.5" /> Ready
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="text-[9px] bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800/40"
                        >
                          Failed
                        </Badge>
                      )}
                    </div>
                    <p className="text-[10px] text-claude-text-muted mt-0.5">
                      {combinedReport
                        ? `${combinedReport.length} chars · generated by LLM`
                        : 'No cross-target relationship report was generated for this batch.'}
                    </p>
                    {combinedReport && (
                      <button
                        onClick={() => setActiveTab('Report')}
                        className="text-[10px] text-claude-accent hover:underline mt-1.5 inline-flex items-center gap-1"
                      >
                        View report <ArrowUpRight className="h-2.5 w-2.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ───── Common Structures Tab ───── */}
            {activeTab === 'Common Structures' && (
              <div className="space-y-3">
                {commonPdbIds.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-claude-text-muted">
                    <Share2 className="h-8 w-8 mb-2 opacity-40" />
                    <p className="text-xs">
                      No common PDB structures recorded for this batch.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-xs font-semibold text-claude-text flex items-center gap-1.5">
                        <Share2 className="h-3.5 w-3.5 text-teal-500" />
                        Shared Structures ({commonPdbIds.length})
                      </h3>
                      <span className="text-[10px] text-claude-text-muted">
                        Click column header to sort
                      </span>
                    </div>

                    {/* Sortable common structures table — matches EvalPdbTable styling */}
                    <div className="rounded-lg border border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] overflow-hidden">
                      <div className="overflow-x-auto sidebar-scroll">
                        <table className="w-full border-collapse text-left">
                          <thead className="sticky top-0 z-10 bg-gradient-to-r from-claude-surface to-[#faf7f4] dark:from-[#242220] dark:to-[#2b2926] border-b-2 border-claude-border dark:border-[#4a4540]">
                            <tr>
                              {COMMON_STRUCT_COLUMNS.map(col => (
                                <th
                                  key={col.field}
                                  className={`px-3 py-2.5 text-[10px] font-bold text-claude-text-muted uppercase tracking-wider whitespace-nowrap ${col.widthClass} ${
                                    col.sortable
                                      ? 'cursor-pointer hover:text-claude-text select-none'
                                      : ''
                                  } ${sortField === col.field ? 'text-claude-accent' : ''}`}
                                  onClick={col.sortable ? () => handleSort(col.field) : undefined}
                                >
                                  <div className="flex items-center gap-1">
                                    {col.label}
                                    {col.sortable && sortField === col.field && (
                                      <span className="text-claude-accent">
                                        {sortDir === 'asc' ? '↑' : '↓'}
                                      </span>
                                    )}
                                    {col.sortable && sortField !== col.field && (
                                      <span className="text-claude-text-muted/40 text-[8px]">
                                        ⇅
                                      </span>
                                    )}
                                  </div>
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {sortedCommonStructures.map(({ pdbId, holders, structure }) => {
                              const methodColors = structure?.method
                                ? getMethodColor(structure.method)
                                : null;
                              const methodLabel = structure?.method
                                ? getMethodLabel(structure.method)
                                : '—';
                              const resColorClass =
                                structure?.resolution != null
                                  ? getResolutionColor(structure.resolution)
                                  : 'text-claude-text-muted';
                              const ifTierStyle = structure?.ifTier
                                ? getIfTierStyle(structure.ifTier)
                                : null;
                              return (
                                <tr
                                  key={pdbId}
                                  className="table-row-hover border-b border-claude-border/40 dark:border-[#3d3832]/40 last:border-b-0 hover:bg-claude-border-light/30 dark:hover:bg-[#3d3832]/20"
                                >
                                  {/* PDB ID */}
                                  <td className="px-3 py-2">
                                    <a
                                      href={`https://www.rcsb.org/structure/${pdbId}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="font-mono text-[11px] font-medium text-claude-accent hover:underline inline-flex items-center gap-1"
                                    >
                                      {pdbId}
                                      <ExternalLink className="h-2.5 w-2.5 opacity-60" />
                                    </a>
                                  </td>
                                  {/* Method */}
                                  <td className="px-3 py-2">
                                    {methodColors ? (
                                      <span
                                        className={`inline-flex items-center justify-center min-w-[62px] px-1.5 py-0.5 rounded text-[9px] font-medium border ${methodColors.bg} ${methodColors.text} ${methodColors.border}`}
                                      >
                                        {methodLabel}
                                      </span>
                                    ) : (
                                      <span className="text-[10px] text-claude-text-muted">—</span>
                                    )}
                                  </td>
                                  {/* Resolution */}
                                  <td className="px-3 py-2">
                                    {structure?.resolution != null ? (
                                      <span
                                        className={`inline-flex items-center gap-1 font-mono text-[10px] ${resColorClass}`}
                                      >
                                        {structure.resolution.toFixed(2)}Å
                                      </span>
                                    ) : (
                                      <span className="text-[10px] text-claude-text-muted">—</span>
                                    )}
                                  </td>
                                  {/* Journal IF */}
                                  <td className="px-3 py-2">
                                    {structure?.journalIf != null ? (
                                      <span
                                        className={`inline-flex items-center gap-1 font-mono text-[10px] ${ifTierStyle?.text || ''}`}
                                      >
                                        {structure.journalIf.toFixed(1)}
                                        {structure.ifTier && (
                                          <span className="text-[8px] uppercase opacity-70">
                                            [{structure.ifTier}]
                                          </span>
                                        )}
                                      </span>
                                    ) : (
                                      <span className="text-[10px] text-claude-text-muted">—</span>
                                    )}
                                  </td>
                                  {/* Title */}
                                  <td className="px-3 py-2 max-w-[300px]">
                                    <p
                                      className="text-[11px] text-claude-text truncate"
                                      title={structure?.title || ''}
                                    >
                                      {structure?.title || '—'}
                                    </p>
                                    {structure?.journal && (
                                      <p className="text-[9px] text-claude-text-muted truncate">
                                        {structure.journal}
                                      </p>
                                    )}
                                  </td>
                                  {/* Shared By */}
                                  <td className="px-3 py-2">
                                    <div className="flex flex-wrap gap-1">
                                      {holders.length === 0 ? (
                                        <span className="text-[10px] text-claude-text-muted italic">
                                          No matches
                                        </span>
                                      ) : (
                                        holders.map(h => (
                                          <button
                                            key={h.uniprotId}
                                            onClick={() => previewSubTarget(h.uniprotId)}
                                            className="px-1.5 py-0.5 rounded-md text-[9px] font-mono font-semibold border bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-300 border-teal-200 dark:border-teal-800/40 hover:opacity-80 transition-opacity"
                                            title={
                                              h.geneName
                                                ? `Open ${h.uniprotId} (${h.geneName})`
                                                : `Open ${h.uniprotId}`
                                            }
                                          >
                                            {h.uniprotId}
                                          </button>
                                        ))
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ───── Sub-Target Detail Tab ───── */}
            {activeTab === 'Sub-Target Detail' && (
              <div className="space-y-3 h-full flex flex-col">
                {selectedSubTarget && selectedSubEval ? (
                  <>
                    <div className="flex items-center justify-between gap-2 flex-shrink-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <Dna className="h-3.5 w-3.5 text-claude-accent flex-shrink-0" />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-xs font-semibold text-claude-accent">
                              {selectedSubTarget}
                            </span>
                            {selectedSubEval.geneNames && (
                              <span className="text-[10px] text-claude-text-muted truncate">
                                {selectedSubEval.geneNames}
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-claude-text-muted truncate">
                            {selectedSubEval.proteinName ||
                              selectedSubEval.entryName ||
                              'Individual evaluation preview'}
                          </div>
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onSelectSubTarget(selectedSubTarget)}
                        className="h-7 px-2.5 text-[11px] border-claude-accent/30 text-claude-accent hover:bg-claude-accent/10 flex-shrink-0"
                        title={locale === 'zh' ? '在完整单独评估视图中打开此评估' : 'Open this evaluation in the full individual-eval view'}
                      >
                        Open Full View <ArrowUpRight className="h-3 w-3 ml-1" />
                      </Button>
                    </div>
                    <div className="flex-1 min-h-0 rounded-lg border border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] overflow-hidden">
                      <EvaluationPage
                        evaluation={selectedSubEval}
                        loading={false}
                        onSelectPdb={() => {
                          /* in-batch preview: PDB row click is a no-op */
                        }}
                      />
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-claude-text-muted">
                    <Dna className="h-8 w-8 mb-2 opacity-40" />
                    <p className="text-xs">
                      Select a sub-target from the left sidebar to view its individual
                      evaluation.
                    </p>
                    {subTargets.length > 0 && (
                      <button
                        onClick={() => previewSubTarget(subTargets[0].uniprotId)}
                        className="mt-3 text-[11px] text-claude-accent hover:underline inline-flex items-center gap-1"
                      >
                        Open first sub-target ({subTargets[0].uniprotId}){' '}
                        <ArrowUpRight className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ───── Report Tab ───── */}
            {activeTab === 'Report' && (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-xs font-semibold text-claude-text flex items-center gap-1.5">
                    <FileText className="h-3.5 w-3.5 text-claude-accent" />
                    Cross-Target Relationship Report
                  </h3>
                  {combinedReport && onOpenBatchReport && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        onOpenBatchReport(batch.batchId, batch.title || 'Batch Report')
                      }
                      className="h-7 px-2.5 text-[11px] border-claude-accent/30 text-claude-accent hover:bg-claude-accent/10"
                    >
                      Open Full Report <ArrowUpRight className="h-3 w-3 ml-1" />
                    </Button>
                  )}
                </div>

                {combinedReport ? (
                  <div className="rounded-lg border border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] p-4">
                    <div className="text-[10px] text-claude-text-muted mb-3 flex items-center gap-2">
                      <span className="font-mono">{combinedReport.length} chars</span>
                      <span>·</span>
                      <span>generated by LLM</span>
                    </div>
                    <div className="text-[12px] text-claude-text-secondary leading-relaxed">
                      <LazyMarkdown>{combinedReport}</LazyMarkdown>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] p-8 text-center">
                    <FileText className="h-8 w-8 text-claude-text-muted mx-auto mb-2 opacity-40" />
                    <p className="text-xs text-claude-text-muted">
                      No cross-target relationship report was generated for this batch.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function EvaluationView({
  evaluations,
  allEvaluations,
  evalBatches,
  batchSubTargets,
  selectedEvalId,
  selectedEval,
  evalLoading,
  evalSubView,
  evalDetailTab,
  selectedEvalStructure,
  evalReportContent,
  detailPanelOpen,
  onSelectEvalId,
  onSetEvalSubView,
  onSetEvalDetailTab,
  onSetSelectedEvalStructure,
  onSetDetailPanelOpen,
  selectedBatchId,
  batchFetchedEvals,
  onSelectSubTarget,
  onOpenBatchReport,
}: EvaluationViewProps) {
  const { t, locale } = useI18n();
  // Sub-view: toolbar + full-width component
  const currentSubView: string = evalSubView;
  if (evalSubView === 'compare' || evalSubView === 'dashboard' || evalSubView === 'timeline' || evalSubView === 'batch') {
    return (
      <div className="flex flex-col h-full">
        {/* Sub-view navigation bar */}
        <div className="px-4 py-2 flex items-center gap-2 flex-shrink-0 border-b border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220]">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onSetEvalSubView('default')}
            className="h-7 px-2.5 text-[11px] text-claude-text-secondary hover:text-claude-text"
          >
            ← {locale === 'zh' ? '返回评估' : 'Back to Evaluation'}
          </Button>
          <div className="flex items-center gap-1 ml-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onSetEvalSubView('compare')}
              className={`h-7 px-2.5 text-[11px] ${evalSubView === 'compare' ? 'bg-claude-accent/10 text-claude-accent' : 'text-claude-text-muted'}`}
            >
              <ArrowRightLeft className="h-3 w-3 mr-1" />
              {t.compare}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onSetEvalSubView('dashboard')}
              className={`h-7 px-2.5 text-[11px] ${evalSubView === 'dashboard' ? 'bg-claude-accent/10 text-claude-accent' : 'text-claude-text-muted'}`}
            >
              <LayoutDashboard className="h-3 w-3 mr-1" />
              {t.dashboard}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onSetEvalSubView('timeline')}
              className={`h-7 px-2.5 text-[11px] ${evalSubView === 'timeline' ? 'bg-claude-accent/10 text-claude-accent' : 'text-claude-text-muted'}`}
            >
              <Clock className="h-3 w-3 mr-1" />
              {t.timeline}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onSetEvalSubView('batch')}
              className={`h-7 px-2.5 text-[11px] ${evalSubView === 'batch' ? 'bg-claude-accent/10 text-claude-accent' : 'text-claude-text-muted'}`}
            >
              <Database className="h-3 w-3 mr-1" />
              {t.batchMatrix}
            </Button>
          </div>
        </div>
        {/* Sub-view content */}
        <div className="flex-1 min-h-0">
          {evalSubView === 'compare' && <EvalComparison evaluations={allEvaluations} />}
          {evalSubView === 'dashboard' && (
            <EvalDashboard
              evaluations={allEvaluations}
              batches={evalBatches}
              batchSubTargets={batchSubTargets}
              onViewBatch={(batchId) => { onSetEvalSubView('batch'); void batchId; }}
            />
          )}
          {evalSubView === 'timeline' && (
            <EvalGanttTimeline
              evaluations={allEvaluations}
              onSelectEval={(id) => { onSelectEvalId(id); }}
              selectedUniprotId={selectedEvalId}
            />
          )}
          {evalSubView === 'batch' && (
            <EvalBatchCompare
              evaluations={allEvaluations}
              batches={evalBatches}
              batchSubTargets={batchSubTargets}
            />
          )}
        </div>
      </div>
    );
  }

  // Default: individual evaluation page with overview → separator → action bar pattern
  return (
    <div className="flex flex-col h-full">
      {/* Overview stat cards now rendered in shared area (pdb-tracker.tsx) */}

      {/* Colored separator — same gradient as Weekly & Literature: after overview, before action bar */}
      <div
        className="mx-4 mt-2 h-[2px] flex-shrink-0"
        style={{ background: 'linear-gradient(90deg, #c96442, #2d8f8f, #7c5cbf, #c9872e)' }}
      />

      {/* Compare + Dashboard + Timeline toggle buttons — white bg same as Weekly & Literature */}
      <div className="px-4 py-2 flex items-center gap-2 flex-shrink-0 border-b border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220]">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onSetEvalSubView('compare')}
          className={`h-7 px-2.5 text-[11px] ${currentSubView === 'compare' ? 'bg-claude-accent/10 text-claude-accent' : 'text-claude-text-muted'}`}
        >
          <ArrowRightLeft className="h-3 w-3 mr-1" />
          {t.compare}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onSetEvalSubView('dashboard')}
          className={`h-7 px-2.5 text-[11px] ${currentSubView === 'dashboard' ? 'bg-claude-accent/10 text-claude-accent' : 'text-claude-text-muted'}`}
        >
          <LayoutDashboard className="h-3 w-3 mr-1" />
          {t.dashboard}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onSetEvalSubView('timeline')}
          className={`h-7 px-2.5 text-[11px] ${currentSubView === 'timeline' ? 'bg-claude-accent/10 text-claude-accent' : 'text-claude-text-muted'}`}
        >
          <Clock className="h-3 w-3 mr-1" />
          {t.timeline}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onSetEvalSubView('batch')}
          className={`h-7 px-2.5 text-[11px] ${currentSubView === 'batch' ? 'bg-claude-accent/10 text-claude-accent' : 'text-claude-text-muted'}`}
        >
          <Database className="h-3 w-3 mr-1" />
          {t.batchMatrix}
        </Button>
        {selectedBatchId && !selectedEvalId && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onSelectEvalId(null)}
            className="h-7 px-2.5 text-[11px] text-claude-text-muted ml-auto"
            title={locale === 'zh' ? '退出批次详情' : 'Exit batch detail'}
          >
            ← {t.backToList}
          </Button>
        )}
      </div>
      {/* When a batch is selected and no individual sub-target is open, show
          the common PDB list in the middle (same layout as single eval).
          The batch's combined report shows in the right detail panel. */}
      {selectedBatchId && !selectedEvalId ? (
        <BatchCommonPdbView
          batchId={selectedBatchId}
          allEvals={allEvaluations}
          evalBatches={evalBatches}
          evalBatchSubTargets={batchSubTargets}
          onSelectSubTarget={(uniprotId) => {
            if (onSelectSubTarget) {
              onSelectSubTarget(uniprotId);
            } else {
              onSelectEvalId(uniprotId);
            }
          }}
        />
      ) : (
        <div className="flex-1 min-h-0">
          <EvaluationPage
            evaluation={selectedEval}
            loading={evalLoading}
            selectedPdbId={selectedEvalStructure?.pdbId ?? null}
            onSelectPdb={(pdbId) => {
              if (!selectedEval) return;
              // Find the matching EvalRow from pdbStructures or blastResults
              const structRow = selectedEval.pdbStructures.find(s => s.pdbId === pdbId);
              if (structRow) {
                onSetSelectedEvalStructure({ ...structRow, _type: 'structure' });
                return;
              }
              const blastRow = selectedEval.blastResults.find(b => b.pdbId === pdbId);
              if (blastRow) {
                onSetSelectedEvalStructure({
                  ...blastRow,
                  _type: 'blast',
                  ifTier: blastRow.ifTier || '',
                  journalIf: blastRow.journalIf ?? null,
                  title: blastRow.title || blastRow.description || null,
                  releaseDate: blastRow.releaseDate || null,
                  pubmedId: blastRow.pubmedId || null,
                  pubmedTitle: blastRow.pubmedTitle || null,
                  pubmedAuthors: blastRow.pubmedAuthors || null,
                  pubmedAbstract: blastRow.pubmedAbstract || null,
                });
                onSetDetailPanelOpen?.(true);
              }
            }}
          />
        </div>
      )}
    </div>
  );
}
