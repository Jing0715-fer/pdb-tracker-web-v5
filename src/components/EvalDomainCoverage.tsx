'use client';

import React, { useMemo, useState } from 'react';
import { useTheme } from 'next-themes';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { Evaluation, EvalPdbStructure } from '@/lib/pdb-types';
import { AnimatedNumber } from '@/components/ui/pdb-animated';

// ─── Method Color Helpers ──────────────────────────────────────────────────────

const METHOD_COLORS: Record<string, { light: string; dark: string; label: string }> = {
  cryo: { light: '#2d8f8f', dark: '#3db5b5', label: 'Cryo-EM' },
  xray: { light: '#7c5cbf', dark: '#9b7ed8', label: 'X-ray' },
  nmr: { light: '#c9872e', dark: '#d9a24e', label: 'NMR' },
};

function getMethodStyle(method: string, isDark: boolean) {
  const m = (method || '').toUpperCase();
  if (m.includes('CRYO')) return METHOD_COLORS.cryo;
  if (m.includes('X-RAY') || m.includes('XRAY')) return METHOD_COLORS.xray;
  if (m.includes('NMR')) return METHOD_COLORS.nmr;
  return { light: '#6b7280', dark: '#9b9590', label: 'Other' };
}

// ─── Per-Structure Domain Bar (SVG) ────────────────────────────────────────────

interface StructureDomain {
  pdbId: string;
  method: string | null;
  unpStart: number | null;
  unpEnd: number | null;
  resolution: number | null;
  chainId: string | null;
}

function StructureDomainBars({
  structures,
  seqLength,
  isDark,
}: {
  structures: StructureDomain[];
  seqLength: number;
  isDark: boolean;
}) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  // Filter structures that have domain position data
  const domainsWithPositions = useMemo(() => {
    return structures
      .map((s, idx) => ({
        ...s,
        idx,
        start: s.unpStart ?? 1,
        end: s.unpEnd ?? seqLength,
      }))
      .filter(d => d.start > 0 && d.end > 0 && d.start <= d.end);
  }, [structures, seqLength]);

  if (domainsWithPositions.length === 0) {
    return (
      <div className="text-[10px] text-claude-text-muted italic py-2 text-center">
        No residue mapping data available for individual structures
      </div>
    );
  }

  const barHeight = 14;
  const gap = 3;
  const svgWidth = 400;
  const padding = 30; // left for labels, right for margin
  const trackWidth = svgWidth - padding - 10;
  const svgHeight = domainsWithPositions.length * (barHeight + gap) + 10;

  // Scale function: residue number -> x position
  const toX = (residue: number) => padding + (residue / seqLength) * trackWidth;

  return (
    <div className="eval-domain-svg-container">
      <svg
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        className="w-full domain-coverage-fade-in"
        style={{ maxHeight: `${Math.min(domainsWithPositions.length * 20 + 20, 250)}px` }}
      >
        {/* Ruler at top */}
        <line
          x1={padding} y1={4} x2={padding + trackWidth} y2={4}
          stroke={isDark ? '#3d3832' : '#d4cfc8'}
          strokeWidth={0.5}
        />
        <text x={padding} y={2} fontSize={6} fill={isDark ? '#6b6560' : '#9b9590'} fontFamily="monospace" textAnchor="start">1</text>
        {seqLength > 100 && (
          <text x={toX(seqLength / 2)} y={2} fontSize={6} fill={isDark ? '#6b6560' : '#9b9590'} fontFamily="monospace" textAnchor="middle">{Math.round(seqLength / 2)}</text>
        )}
        <text x={padding + trackWidth} y={2} fontSize={6} fill={isDark ? '#6b6560' : '#9b9590'} fontFamily="monospace" textAnchor="end">{seqLength}</text>

        {/* Structure bars */}
        {domainsWithPositions.map((domain, i) => {
          const methodStyle = getMethodStyle(domain.method || '', isDark);
          const fillColor = isDark ? methodStyle.dark : methodStyle.light;
          const barY = 8 + i * (barHeight + gap);
          const x1 = toX(Math.max(1, domain.start));
          const x2 = toX(Math.min(seqLength, domain.end));
          const barW = Math.max(x2 - x1, 4);
          const isHovered = hoveredIdx === i;
          const opacity = hoveredIdx !== null ? (isHovered ? 1 : 0.3) : 0.75;

          return (
            <Tooltip key={i}>
              <TooltipTrigger asChild>
                <g
                  onMouseEnter={() => setHoveredIdx(i)}
                  onMouseLeave={() => setHoveredIdx(null)}
                  className="domain-bar-group"
                >
                  {/* Background track */}
                  <rect
                    x={padding} y={barY}
                    width={trackWidth} height={barHeight}
                    rx={3} ry={3}
                    fill={isDark ? '#2b2926' : '#f0ece5'}
                    opacity={0.5}
                  />
                  {/* Domain bar */}
                  <rect
                    x={x1} y={barY}
                    width={barW} height={barHeight}
                    rx={3} ry={3}
                    fill={fillColor}
                    opacity={opacity}
                    className="domain-bar-fill"
                  />
                  {/* PDB ID label (left) */}
                  <text
                    x={padding - 3} y={barY + barHeight / 2 + 1}
                    fontSize={7} fontFamily="monospace" fontWeight="bold"
                    fill={isDark ? '#9b9590' : '#6b6560'}
                    textAnchor="end"
                  >
                    {domain.pdbId.slice(0, 4)}
                  </text>
                  {/* Chain label inside bar if wide enough */}
                  {barW > 40 && domain.chainId && (
                    <text
                      x={x1 + barW / 2} y={barY + barHeight / 2 + 1}
                      fontSize={6} fontFamily="monospace"
                      fill="white" textAnchor="middle" opacity={0.9}
                    >
                      {domain.chainId}:{domain.start}-{domain.end}
                    </text>
                  )}
                </g>
              </TooltipTrigger>
              <TooltipContent side="top" className="bg-claude-surface dark:bg-[#242220] border border-claude-border dark:border-[#3d3832] shadow-lg">
                <div className="text-[11px] space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: fillColor }} />
                    <span className="font-medium font-mono">{domain.pdbId}</span>
                    <span className="text-claude-text-muted text-[10px]">{methodStyle.label}</span>
                  </div>
                  <div className="text-[10px] text-claude-text-secondary">
                    Chain {domain.chainId || '?'}: residues {domain.start}–{domain.end}
                  </div>
                  {domain.resolution != null && (
                    <div className="text-[10px] text-claude-text-muted">
                      Resolution: {domain.resolution.toFixed(2)}Å
                    </div>
                  )}
                </div>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </svg>
    </div>
  );
}

// ─── Props & Main Component ────────────────────────────────────────────────────

interface EvalDomainCoverageProps { evaluation: Evaluation; }

export function EvalDomainCoverage({ evaluation }: EvalDomainCoverageProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const [hoveredMethod, setHoveredMethod] = useState<string | null>(null);

  const seqLength = evaluation.sequenceLength || 1;
  const pdbCoveragePct = evaluation.coverage ?? 0;
  const structures = evaluation.pdbStructures || [];
  const blastResults = evaluation.blastResults || [];

  // ─── Derived data ────────────────────────────────────────────────────────────

  const methodCounts = useMemo(() => {
    const counts = new Map<string, number>();
    structures.forEach((s) => {
      const key = s.method || 'Other';
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
  }, [structures]);

  const methodLegend = useMemo(() => {
    const seen = new Set<string>();
    return structures
      .filter((s) => s.method && !seen.has(s.method) && seen.add(s.method))
      .map((s) => ({ method: s.method!, style: getMethodStyle(s.method!, isDark) }));
  }, [structures, isDark]);

  const blastCount = blastResults.length;
  const avgIdentity = blastCount > 0
    ? blastResults.reduce((sum, b) => sum + (b.identity ?? 0), 0) / blastCount : 0;

  // ─── BLAST-derived coverage ────────────────────────────────────────────────
  const bestBlastCoveragePct = useMemo(() => {
    if (blastResults.length === 0) return 0;
    const maxQueryCov = Math.max(
      ...blastResults
        .map((b) => b.queryCoverage ?? 0)
        .filter((c) => c > 0)
    );
    if (maxQueryCov === 0) return 0;
    return Math.min((maxQueryCov / seqLength) * 100, 100);
  }, [blastResults, seqLength]);

  const coveragePct = Math.max(pdbCoveragePct, bestBlastCoveragePct);
  const coverageSource = bestBlastCoveragePct > pdbCoveragePct ? 'homolog' : 'pdb';

  const hasPdbData = structures.length > 0;
  const hasBlastData = blastCount > 0;
  const hasData = hasPdbData || hasBlastData;

  const bgPattern = isDark ? '#4a4540' : '#d4cfc8';
  const grayFill = isDark ? '#6b7280' : '#9ca3af';

  // Check if any structure has domain position data (unpStart/unpEnd)
  const hasDomainPositions = structures.some(s => s.unpStart != null && s.unpEnd != null);

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h4 className="text-[11px] font-semibold text-claude-text uppercase tracking-wider">
          Domain Coverage
        </h4>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-claude-text-muted">
            {structures.length} structure{structures.length !== 1 ? 's' : ''}
            {hasBlastData && ` · ${blastCount} homolog${blastCount !== 1 ? 's' : ''}`}
          </span>
          <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-claude-accent/10 dark:bg-claude-accent/20">
            <span className="text-[10px] font-medium text-claude-accent">Coverage</span>
            <span className="text-xs font-bold text-claude-accent">
              <AnimatedNumber value={coveragePct} decimals={0} suffix="%" />
            </span>
            {coverageSource === 'homolog' && (
              <span className="text-[8px] font-medium text-claude-text-muted" title="Estimated from best BLAST homolog">via homolog</span>
            )}
          </div>
        </div>
      </div>

      {/* Overall coverage bar */}
      <div className="relative">
        <div className="relative h-10 bg-claude-border-light/60 dark:bg-[#2b2926]/60 rounded-lg overflow-hidden border border-claude-border/30 dark:border-[#3d3832]/30">
          {/* Dashed background */}
          <div className="absolute inset-0 opacity-20" style={{ backgroundImage: `repeating-linear-gradient(90deg, transparent, transparent 8px, ${bgPattern} 8px, ${bgPattern} 10px)` }} />

          {/* No data */}
          {!hasData && (
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-[10px] text-claude-text-muted italic">No PDB or BLAST data available</span>
            </div>
          )}

          {/* Method segments (PDB coverage) */}
          {hasPdbData && pdbCoveragePct > 0 && (
            <div
              className="absolute left-0 top-0 h-full flex domain-bar-animate"
              style={{ width: `${pdbCoveragePct}%`, transformOrigin: 'left' }}
            >
              {Array.from(methodCounts.entries()).map(([method, count], idx) => {
                const fraction = count / structures.length;
                const { light: fillColor } = getMethodStyle(method, false);
                const isHovered = hoveredMethod === method;
                return (
                  <Tooltip key={idx}>
                    <TooltipTrigger asChild>
                      <div
                        className="relative cursor-pointer domain-bar-segment-animate"
                        style={{ width: `${fraction * 100}%`, height: '100%', animationDelay: `${idx * 50}ms` }}
                        onMouseEnter={() => setHoveredMethod(method)}
                        onMouseLeave={() => setHoveredMethod(null)}
                      >
                        <div className="w-full h-full transition-opacity duration-150" style={{ backgroundColor: fillColor, opacity: isHovered ? 0.95 : 0.75 }} />
                        {fraction > 0.15 && (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <span className="text-[8px] font-medium text-white/90 drop-shadow-sm">{count}</span>
                          </div>
                        )}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="bg-claude-surface dark:bg-[#242220] border border-claude-border dark:border-[#3d3832] shadow-lg">
                      <div className="text-[11px] flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: fillColor }} />
                        <span className="font-medium">{getMethodStyle(method, false).label}</span>
                        <span className="text-claude-text-muted">× {count}</span>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          )}

          {/* BLAST homolog coverage (extends from PDB coverage to total coverage) */}
          {hasBlastData && bestBlastCoveragePct > pdbCoveragePct && (
            <Tooltip>
              <TooltipTrigger asChild>
                <div
                  className="absolute cursor-help domain-bar-blast-animate"
                  style={{
                    left: `${pdbCoveragePct}%`,
                    width: `${bestBlastCoveragePct - pdbCoveragePct}%`,
                    height: '100%',
                    transformOrigin: 'left',
                    backgroundColor: grayFill,
                    opacity: 0.35,
                    backgroundImage: `repeating-linear-gradient(45deg, transparent, transparent 4px, ${isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)'} 4px, ${isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)'} 6px)`,
                    borderLeft: `1px dashed ${isDark ? '#9b9590' : '#6b7280'}`,
                  }}
                />
              </TooltipTrigger>
              <TooltipContent side="top" className="bg-claude-surface dark:bg-[#242220] border border-claude-border dark:border-[#3d3832] shadow-lg">
                <div className="text-[11px] space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: grayFill, opacity: 0.5 }} />
                    <span className="font-medium">BLAST Homolog Extension</span>
                  </div>
                  <div className="text-[10px] text-claude-text-muted">
                    {(bestBlastCoveragePct - pdbCoveragePct).toFixed(0)}% modeled by best homolog
                  </div>
                </div>
              </TooltipContent>
            </Tooltip>
          )}

          {/* BLAST indicator */}
          {hasBlastData && bestBlastCoveragePct <= pdbCoveragePct && (
            <div
              className="absolute right-0 top-[20%] h-[60%] w-[3px] rounded-sm domain-bar-blast-indicator"
              style={{ backgroundColor: grayFill, opacity: 0.6 }}
            />
          )}
        </div>

        {/* Ruler */}
        <div className="flex items-center justify-between mt-1 px-0.5">
          <span className="text-[8px] text-claude-text-muted font-mono">1</span>
          {seqLength > 100 && <span className="text-[8px] text-claude-text-muted font-mono">{Math.round(seqLength / 2)}</span>}
          <span className="text-[8px] text-claude-text-muted font-mono">{seqLength}</span>
        </div>
      </div>

      {/* Per-Structure Domain Coverage (SVG) */}
      {hasDomainPositions && (
        <div className="space-y-1.5">
          <h5 className="text-[10px] font-semibold text-claude-text-secondary uppercase tracking-wider">
            Per-Structure Coverage Regions
          </h5>
          <StructureDomainBars
            structures={structures.map(s => ({
              pdbId: s.pdbId,
              method: s.method,
              unpStart: s.unpStart,
              unpEnd: s.unpEnd,
              resolution: s.resolution,
              chainId: s.chainId,
            }))}
            seqLength={seqLength}
            isDark={isDark}
          />
        </div>
      )}

      {/* BLAST stats */}
      {hasBlastData && (
        <div className="flex items-center gap-3 text-[9px] text-claude-text-muted flex-wrap">
          <span className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: grayFill }} />
            {blastCount} BLAST homolog{blastCount !== 1 ? 's' : ''}
          </span>
          <span>avg {avgIdentity.toFixed(1)}% identity</span>
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-claude-border-light/60 dark:bg-[#2b2926] border border-claude-border/40">
            <span className="text-claude-text-secondary dark:text-[#9b9590]">Best homolog covers</span>
            <span className="font-mono font-semibold text-claude-accent">{bestBlastCoveragePct.toFixed(0)}%</span>
            <span className="text-claude-text-muted">of sequence</span>
          </span>
        </div>
      )}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3">
        {methodLegend.map((item, idx) => (
          <div key={idx} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: item.style.light, opacity: 0.8 }} />
            <span className="text-[9px] text-claude-text-muted font-medium">{item.style.label} ×{methodCounts.get(item.method) || 0}</span>
          </div>
        ))}
        {hasBlastData && (
          <>
            {bestBlastCoveragePct > pdbCoveragePct && (
              <div className="flex items-center gap-1.5">
                <span
                  className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
                  style={{
                    backgroundColor: grayFill,
                    opacity: 0.35,
                    backgroundImage: `repeating-linear-gradient(45deg, transparent, transparent 1px, ${isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)'} 1px, ${isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)'} 2px)`,
                  }}
                />
                <span className="text-[9px] text-claude-text-muted font-medium">Homolog Extension</span>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0 bg-claude-cryoem/20 border border-claude-cryoem/30" />
              <span className="text-[9px] text-claude-text-muted font-medium">BLAST Homologs</span>
            </div>
          </>
        )}
        <div className="flex items-center gap-1.5">
          <div className="w-2.5 h-2.5 rounded-sm flex-shrink-0 opacity-20" style={{ backgroundImage: `repeating-linear-gradient(90deg, ${bgPattern}, ${bgPattern} 2px, transparent 2px, transparent 4px)` }} />
          <span className="text-[9px] text-claude-text-muted font-medium">Uncovered</span>
        </div>
      </div>
    </div>
  );
}
