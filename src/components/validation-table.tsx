'use client';

import React, { useState } from 'react';
import {
  ChevronDown,
  AlertTriangle,
  Trophy,
  BarChart2,
  ExternalLink,
  ArrowUpRight,
  ArrowDownRight,
  ArrowRight,
} from 'lucide-react';
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from '@/components/ui/collapsible';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import { Progress } from '@/components/ui/progress';
import {
  useValidationData,
  useRamaData,
  getQualityLevel,
  getQualityColor,
  getQualityBgColor,
  TrendArrow,
  MetricBar,
  PercentileBar,
  RamachandranPlot,
} from './validation-report';

// Re-export helpers and sub-components so entity-panel.tsx can import from a single file
export {
  useValidationData,
  useRamaData,
  getQualityLevel,
  getQualityColor,
  getQualityBgColor,
  TrendArrow,
  MetricBar,
  PercentileBar,
  RamachandranPlot,
};

// ─── Quality Metrics Section ─────────────────────────────────────────────

export function QualityMetricsSection({ pdbId }: { pdbId: string }) {
  const { data, loading } = useValidationData(pdbId);
  const { data: ramaData } = useRamaData(pdbId);
  const [expanded, setExpanded] = useState(true);
  const [ramaExpanded, setRamaExpanded] = useState(true);

  return (
    <div className="border-t border-claude-border">
      <Collapsible open={expanded} onOpenChange={setExpanded}>
        <div className="px-3 py-2 flex items-center justify-between section-icon-header">
          <CollapsibleTrigger className="flex items-center gap-1 group btn-press">
            <ChevronDown
              className={`w-3 h-3 text-claude-text-muted transition-transform duration-200
                         ${expanded ? '' : '-rotate-90'}`}
            />
            <Trophy className="w-3 h-3 text-claude-accent" />
            <h3 className="text-[10px] font-semibold uppercase tracking-wider text-claude-text-muted">
              Quality Metrics
            </h3>
          </CollapsibleTrigger>
          {!loading && data && !data.error && (
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded
                             ${getQualityColor(getQualityLevel(data.molprobity_score))}
                             ${getQualityBgColor(getQualityLevel(data.molprobity_score))}`}>
              {data.molprobity_score != null ? data.molprobity_score.toFixed(1) : 'N/A'}
            </span>
          )}
        </div>

        <CollapsibleContent>
          <div className="px-3 pb-3">
            {loading ? (
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <div className="w-20 h-10 skeleton-pulse-soft" />
                  <div className="space-y-1.5 flex-1">
                    <div className="w-20 h-3 skeleton-pulse-soft" />
                    <div className="w-28 h-2 skeleton-pulse-soft" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className="space-y-1">
                      <div className="w-24 h-2 skeleton-pulse-soft" />
                      <div className="w-full h-2 skeleton-pulse-soft" />
                    </div>
                  ))}
                </div>
              </div>
            ) : data?.error ? (
              <div className="flex items-center gap-2 text-claude-text-muted">
                <AlertTriangle className="w-3 h-3" />
                <span className="text-[10px]">Could not load validation data</span>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Overall MolProbity Score */}
                <div className="flex items-center gap-3">
                  <div className="relative flex-shrink-0">
                    <svg width="80" height="50" viewBox="0 0 80 50" className="flex-shrink-0">
                      <path
                        d="M 10 42 A 30 30 0 0 1 70 42"
                        fill="none"
                        stroke="var(--claude-border-light)"
                        strokeWidth="6"
                        strokeLinecap="round"
                      />
                      <path
                        d="M 10 42 A 30 30 0 0 1 70 42"
                        fill="none"
                        stroke={data && data.molprobity_score != null ? (data.molprobity_score <= 2.0 ? '#22c55e' : data.molprobity_score <= 3.0 ? '#f59e0b' : '#ef4444') : '#9ca3af'}
                        strokeWidth="6"
                        strokeLinecap="round"
                        strokeDasharray={`${Math.PI * 30}`}
                        strokeDashoffset={data && data.molprobity_score != null ? Math.PI * 30 * (1 - Math.min(100, Math.max(0, ((5 - data.molprobity_score) / 5) * 100)) / 100) : Math.PI * 30}
                      />
                      <text x="40" y="38" textAnchor="middle" className="fill-claude-text text-[12px] font-bold">
                        {data?.molprobity_score != null ? data.molprobity_score.toFixed(1) : 'N/A'}
                      </text>
                    </svg>
                  </div>
                  <div className="flex flex-col">
                    <span className={`text-[9px] font-bold uppercase tracking-wider ${getQualityColor(getQualityLevel(data?.molprobity_score ?? null))}`}>
                      {data?.molprobity_score == null ? 'Unknown Quality' : data.molprobity_score <= 2.0 ? 'High Quality' : data.molprobity_score <= 3.0 ? 'Medium Quality' : 'Low Quality'}
                    </span>
                    <span className="text-[7px] text-claude-text-muted">MolProbity Score</span>
                  </div>
                </div>

                {/* Metrics Grid */}
                <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                  <MetricBar
                    label="Rama. Favored"
                    value={ramaData?.favored ?? data?.ramachandran_favored ?? null}
                    max={100}
                    suffix="%"
                    percentile={data?.ramachandran_percentile}
                    trend={ramaData?.favored != null && ramaData.favored >= 95 ? 'up' : ramaData?.favored != null && ramaData.favored < 90 ? 'down' : 'stable'}
                  />
                  <MetricBar
                    label="Rama. Outliers"
                    value={ramaData?.outliers ?? data?.ramachandran_outliers ?? null}
                    max={10}
                    suffix="%"
                    trend={ramaData?.outliers != null && ramaData.outliers <= 0.5 ? 'up' : ramaData?.outliers != null && ramaData.outliers > 2 ? 'down' : 'stable'}
                  />
                  <MetricBar
                    label="Clash Score"
                    value={data?.clash_score ?? null}
                    max={50}
                    percentile={data?.clash_percentile}
                    trend={data?.clash_score != null && data.clash_score <= 5 ? 'up' : data?.clash_score != null && data.clash_score > 15 ? 'down' : 'stable'}
                  />
                  <div className="space-y-0.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-claude-text-secondary">Rota. Outliers</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <span className="text-[11px] font-mono font-bold text-claude-text">
                        {data?.ramachandran_outliers ?? 'N/A'}
                      </span>
                    </div>
                    <div className="h-1.5 bg-claude-border-light rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-blue-500 transition-all"
                        style={{ width: `${Math.min(100, ((data?.ramachandran_outliers ?? 0) / 5) * 100)}%` }}
                      />
                    </div>
                  </div>
                  <MetricBar
                    label="Bond Length"
                    value={data?.rmsd_bonds ?? null}
                    max={0.2}
                    suffix="Å"
                    trend={data?.rmsd_bonds != null && data.rmsd_bonds <= 0.02 ? 'up' : data?.rmsd_bonds != null && data.rmsd_bonds > 0.05 ? 'down' : 'stable'}
                  />
                  <MetricBar
                    label="Bond Angle"
                    value={data?.rmsd_angles ?? null}
                    max={2}
                    suffix="°"
                    trend={data?.rmsd_angles != null && data.rmsd_angles <= 1 ? 'up' : data?.rmsd_angles != null && data.rmsd_angles > 2 ? 'down' : 'stable'}
                  />
                </div>

                {/* Percentile bars */}
                {data?.clash_percentile != null && (
                  <div className="space-y-1.5">
                    <span className="text-[9px] font-semibold text-claude-text-secondary">Percentile Rankings</span>
                    <PercentileBar
                      label="Clash Score"
                      percentile={data.clash_percentile}
                      icon={<BarChart2 className="w-2.5 h-2.5" />}
                    />
                    {data?.ramachandran_percentile != null && (
                      <PercentileBar
                        label="Ramachandran Plot"
                        percentile={data.ramachandran_percentile}
                        icon={<AlertTriangle className="w-2.5 h-2.5" />}
                      />
                    )}
                  </div>
                )}

                {/* Ramachandran Plot */}
                {ramaData?.points && ramaData.points.length > 0 && (
                  <div className="space-y-1.5">
                    <button
                      onClick={() => setRamaExpanded(!ramaExpanded)}
                      className="flex items-center gap-1 text-[9px] font-semibold text-claude-text-secondary hover:text-claude-text transition-colors"
                    >
                      <ChevronDown className={`w-3 h-3 transition-transform ${ramaExpanded ? '' : '-rotate-90'}`} />
                      Ramachandran Plot
                    </button>
                    {ramaExpanded && (
                      <RamachandranPlot
                        favored={ramaData.favored}
                        outliers={ramaData.outliers}
                        residueCount={ramaData.residue_count}
                        realPoints={ramaData.points}
                      />
                    )}
                  </div>
                )}

                {/* Chain-level scores */}
                {data?.chain_scores && data.chain_scores.length > 0 && (
                  <div className="space-y-1.5">
                    <span className="text-[9px] font-semibold text-claude-text-secondary">Per-Chain Scores</span>
                    <div className="overflow-x-auto">
                      <table className="w-full text-[9px]">
                        <thead>
                          <tr className="border-b border-claude-border-light">
                            <th className="text-left text-claude-text-muted font-medium pb-0.5">Chain</th>
                            <th className="text-right text-claude-text-muted font-medium pb-0.5">Favored</th>
                            <th className="text-right text-claude-text-muted font-medium pb-0.5">Outliers</th>
                          </tr>
                        </thead>
                        <tbody>
                          {data.chain_scores.map((cs, i) => (
                            <tr key={i} className="border-b border-claude-border-light/30">
                              <td className="py-0.5 font-mono text-claude-text">{cs.chain}</td>
                              <td className="py-0.5 text-right">
                                <span className={`font-mono font-bold ${cs.favored >= 95 ? 'text-green-600 dark:text-green-400' : cs.favored >= 90 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>
                                  {cs.favored.toFixed(1)}%
                                </span>
                              </td>
                              <td className="py-0.5 text-right">
                                <span className={`font-mono font-bold ${cs.outliers <= 0.5 ? 'text-green-600 dark:text-green-400' : cs.outliers > 2 ? 'text-red-600 dark:text-red-400' : 'text-amber-600 dark:text-amber-400'}`}>
                                  {cs.outliers.toFixed(1)}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* RCSB Validation Report Link */}
                <a
                  href={`https://files.rcsb.org/validation/view/${pdbId.toUpperCase()}_full_validation.pdf`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[10px] font-medium
                             text-claude-accent hover:bg-claude-accent-light transition-colors
                             border border-claude-border-light"
                >
                  <ExternalLink className="w-3 h-3" />
                  RCSB Validation Report
                </a>
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}