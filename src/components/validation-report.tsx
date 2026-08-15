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

// ─── Validation Data Types ──────────────────────────────────────────────

export interface ValidationData {
  pdb_id: string;
  molprobity_score: number | null;
  ramachandran_favored: number | null;
  ramachandran_outliers: number | null;
  clash_score: number | null;
  rmsd_bonds: number | null;
  rmsd_angles: number | null;
  clash_percentile: number | null;
  ramachandran_percentile: number | null;
  chain_scores: { chain: string; favored: number; outliers: number }[] | null;
  error?: string;
}

export interface RamaData {
  favored: number | null;
  outliers: number | null;
  residue_count: number;
  points?: { phi: number; psi: number; region: string; chain?: string }[];
  chain_scores?: { chain: string; favored: number; outliers: number }[];
}

// ─── Validation Data Cache ───────────────────────────────────────────────

const MAX_VALIDATION_CACHE = 50;

function evictOldestValidationEntry(cache: Map<string, any>): void {
  const firstKey = cache.keys().next().value;
  if (firstKey !== undefined) cache.delete(firstKey);
}

const validationCache = new Map<string, ValidationData | null>();

export function useValidationData(pdbId: string): {
  data: ValidationData | null;
  loading: boolean;
} {
  const cached = validationCache.get(pdbId) ?? null;
  const isCached = validationCache.has(pdbId);
  const [data, setData] = useState<ValidationData | null>(cached);
  // Lazy initializer: a non-cached fetch is in flight from the start, so
  // loading begins true. On later pdbId changes we reset loading during render
  // (idiomatic React 19 — avoids setState synchronously inside an effect body).
  const [loading, setLoading] = useState(() => !isCached);
  const [prevPdbId, setPrevPdbId] = useState(pdbId);
  if (prevPdbId !== pdbId) {
    setPrevPdbId(pdbId);
    if (!isCached) setLoading(true);
  }

  React.useEffect(() => {
    if (isCached) return;

    let cancelled = false;

    fetch(`/api/validation/${pdbId.toUpperCase()}`)
      .then(res => {
        if (!res.ok) throw new Error('Network response was not ok');
        return res.json();
      })
      .then(json => {
        if (cancelled) return;
        const result: ValidationData = json && !json.error ? json : { pdb_id: pdbId, error: json?.error || 'Failed to fetch validation data' };
        if (validationCache.size >= MAX_VALIDATION_CACHE) {
          evictOldestValidationEntry(validationCache);
        }
        validationCache.set(pdbId, result);
        setData(result);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        const errorResult: ValidationData = { pdb_id: pdbId, error: 'Failed to fetch validation data' } as ValidationData;
        validationCache.set(pdbId, errorResult);
        setData(errorResult);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [pdbId, isCached]);

  return { data, loading };
}

// ─── Rama Data Cache ─────────────────────────────────────────────────────

const ramaCache = new Map<string, RamaData | null>();

export function useRamaData(pdbId: string): { data: RamaData | null; loading: boolean } {
  const cached = ramaCache.get(pdbId) ?? null;
  const isCached = ramaCache.has(pdbId);
  const [data, setData] = useState<RamaData | null>(cached);
  const [loading, setLoading] = useState(() => !isCached);
  const [prevPdbId, setPrevPdbId] = useState(pdbId);
  if (prevPdbId !== pdbId) {
    setPrevPdbId(pdbId);
    if (!isCached) setLoading(true);
  }

  React.useEffect(() => {
    if (isCached) return;

    let cancelled = false;

    fetch(`/api/rama/${pdbId.toUpperCase()}`)
      .then(res => {
        if (!res.ok) throw new Error('Network response was not ok');
        return res.json();
      })
      .then(json => {
        if (cancelled) return;
        // API returns object directly, not array
        const entry = Array.isArray(json) ? json[0] : json;
        if (!entry || entry.error) {
          ramaCache.set(pdbId, null);
          setData(null);
          setLoading(false);
          return;
        }
        const ramaData: RamaData = {
          favored: entry.favored ?? null,
          outliers: entry.outliers ?? null,
          residue_count: entry.residue_count ?? 0,
          points: entry.points,
          chain_scores: entry.chain_scores,
        };
        ramaCache.set(pdbId, ramaData);
        setData(ramaData);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        ramaCache.set(pdbId, null);
        setData(null);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [pdbId, isCached]);

  return { data, loading };
}

// ─── Trend Arrow ─────────────────────────────────────────────────────────

export function TrendArrow({ direction }: { direction: 'up' | 'down' | 'stable' }) {
  if (direction === 'up') return <ArrowUpRight className="w-2.5 h-2.5 text-green-500" />;
  if (direction === 'down') return <ArrowDownRight className="w-2.5 h-2.5 text-red-500" />;
  return <ArrowRight className="w-2.5 h-2.5 text-claude-text-muted" />;
}

// ─── Quality Level Helpers ────────────────────────────────────────────────

export function getQualityLevel(score: number | null): 'high' | 'medium' | 'low' | 'unknown' {
  if (score == null) return 'unknown';
  if (score <= 2.0) return 'high';
  if (score <= 3.0) return 'medium';
  return 'low';
}

export function getQualityColor(level: 'high' | 'medium' | 'low' | 'unknown'): string {
  switch (level) {
    case 'high': return 'text-green-600 dark:text-green-400';
    case 'medium': return 'text-amber-600 dark:text-amber-400';
    case 'low': return 'text-red-600 dark:text-red-400';
    default: return 'text-claude-text-muted';
  }
}

export function getQualityBgColor(level: 'high' | 'medium' | 'low' | 'unknown'): string {
  switch (level) {
    case 'high': return 'bg-green-100 dark:bg-green-900/30';
    case 'medium': return 'bg-amber-100 dark:bg-amber-900/30';
    case 'low': return 'bg-red-100 dark:bg-red-900/30';
    default: return 'bg-claude-border-light';
  }
}

function getQualityStrokeColor(level: 'high' | 'medium' | 'low' | 'unknown'): string {
  switch (level) {
    case 'high': return '#22c55e';
    case 'medium': return '#f59e0b';
    case 'low': return '#ef4444';
    default: return '#9ca3af';
  }
}

// ─── Quality Gauge ────────────────────────────────────────────────────────

export function QualityGauge({ score }: { score: number | null }) {
  const level = getQualityLevel(score);
  const pct = score != null ? Math.max(0, Math.min(100, ((5 - score) / 5) * 100)) : 0;
  const stroke = getQualityStrokeColor(level);

  const cx = 40;
  const cy = 40;
  const r = 30;
  const circumference = Math.PI * r;
  const dashOffset = circumference - (circumference * pct) / 100;

  return (
    <div className={`flex items-center gap-3 ${level === 'high' ? 'card-border-glow rounded-lg p-1' : ''}`}>
      <svg width="80" height="50" viewBox="0 0 80 50" className={`flex-shrink-0 ${level === 'high' ? 'quality-gauge-glow breathing-glow' : ''}`}>
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
          stroke={stroke}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={`${circumference}`}
          strokeDashoffset={dashOffset}
          className="validation-gauge-arc"
          style={{ '--gauge-offset': dashOffset } as React.CSSProperties}
        />
        <text x={cx} y={cy} textAnchor="middle" className={`fill-current text-[12px] font-bold ${getQualityColor(level)}`}>
          {score != null ? score.toFixed(1) : 'N/A'}
        </text>
      </svg>
      <div className="flex flex-col">
        <span className={`text-[9px] font-bold uppercase tracking-wider ${getQualityColor(level)}`}>
          {level === 'high' ? 'High Quality' : level === 'medium' ? 'Medium Quality' : level === 'low' ? 'Low Quality' : 'Unknown'}
        </span>
        <span className="text-[7px] text-claude-text-muted">MolProbity Score</span>
      </div>
    </div>
  );
}

// ─── Metric Bar ──────────────────────────────────────────────────────────

interface MetricBarProps {
  label: string;
  value: number | null;
  max?: number;
  suffix?: string;
  percentile?: number | null;
  trend?: 'up' | 'down' | 'stable';
}

export function MetricBar({ label, value, max = 100, suffix = '%', percentile, trend }: MetricBarProps) {
  const pct = value != null ? Math.min(100, (value / max) * 100) : 0;
  const isOutlier = label.toLowerCase().includes('outlier');
  const isClash = label.toLowerCase().includes('clash');
  const barColor = isOutlier || isClash
    ? (value != null && value > (isOutlier ? 2 : 10) ? '#ef4444' : value != null && value > (isOutlier ? 1 : 5) ? '#f59e0b' : '#22c55e')
    : '#3b82f6';

  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-claude-text-secondary">{label}</span>
        <div className="flex items-center gap-1">
          <span className="text-[11px] font-mono font-bold text-claude-text">
            {value != null ? value.toFixed(value < 10 ? 2 : 1) : 'N/A'}{suffix}
          </span>
          {trend && <TrendArrow direction={trend} />}
          {percentile != null && (
            <span className="text-[8px] font-semibold px-1 py-px rounded
                             bg-claude-accent-light text-claude-accent">
              {percentile}th
            </span>
          )}
        </div>
      </div>
      <div className="h-1.5 bg-claude-border-light rounded-full overflow-hidden">
        <div
          className="h-full rounded-full metric-bar-fill shimmer-highlight chart-bar-animate"
          style={{ width: `${pct}%`, backgroundColor: barColor }}
        />
      </div>
    </div>
  );
}

// ─── Percentile Bar Visualization ──────────────────────────────────────

interface PercentileBarProps {
  label: string;
  percentile: number | null;
  icon?: React.ReactNode;
}

export function PercentileBar({ label, percentile, icon }: PercentileBarProps) {
  if (percentile == null) return null;

  const color = percentile > 75 ? '#22c55e' : percentile >= 25 ? '#f59e0b' : '#ef4444';
  const textColor = percentile > 75
    ? 'text-green-700 dark:text-green-400'
    : percentile >= 25
    ? 'text-amber-700 dark:text-amber-400'
    : 'text-red-700 dark:text-red-400';

  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-claude-text-secondary flex items-center gap-0.5">
          {icon}
          {label}
        </span>
        <span className={`text-[10px] font-mono font-bold ${textColor}`}>
          {percentile}th percentile
        </span>
      </div>
      <div className="h-2 bg-claude-border-light rounded-full overflow-hidden relative">
        <div
          className="h-full rounded-full metric-bar-fill transition-all duration-500 chart-bar-animate"
          style={{ width: `${percentile}%`, backgroundColor: color }}
        />
        <div className="absolute top-0 bottom-0 w-px bg-claude-text-muted/30" style={{ left: '25%' }} />
        <div className="absolute top-0 bottom-0 w-px bg-claude-text-muted/30" style={{ left: '75%' }} />
      </div>
      <div className="flex justify-between text-[6px] text-claude-text-muted">
        <span>0th</span>
        <span>25th</span>
        <span>50th</span>
        <span>75th</span>
        <span>100th</span>
      </div>
    </div>
  );
}

// ─── Ramachandran Plot Component ─────────────────────────────────────────

interface RamachandranPlotProps {
  favored: number | null;
  outliers: number | null;
  residueCount: number;
  realPoints?: { phi: number; psi: number; region: string; chain?: string }[];
}

export function RamachandranPlot({ favored, outliers, residueCount, realPoints }: RamachandranPlotProps) {
  const svgSize = 200;
  const padding = 25;
  const plotSize = svgSize - padding * 2;
  const center = svgSize / 2;
  const [selectedRegion, setSelectedRegion] = useState<'favored' | 'allowed' | 'disallowed' | null>(null);
  const [showOutliersOnly, setShowOutliersOnly] = useState(false);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; point: { phi: number; psi: number; chain: string } } | null>(null);

  const chains = React.useMemo(() => {
    if (!realPoints || realPoints.length === 0) return [];
    const chainSet = new Set<string>();
    for (const p of realPoints) {
      if (p.chain) chainSet.add(p.chain);
    }
    return Array.from(chainSet).sort();
  }, [realPoints]);

  const [selectedChain, setSelectedChain] = React.useState<string>('all');

  const toX = (angle: number) => center + (angle / 180) * (plotSize / 2);
  const toY = (angle: number) => center - (angle / 180) * (plotSize / 2);

  const allClassifiedPoints = React.useMemo(() => {
    if (realPoints && realPoints.length > 0) {
      return realPoints.map((p) => ({
        phi: p.phi,
        psi: p.psi,
        region: p.region as 'favored' | 'allowed' | 'disallowed',
        chain: p.chain || '',
      }));
    }
    const pts: { phi: number; psi: number; region: 'favored' | 'allowed' | 'disallowed'; chain: string }[] = [];
    const count = Math.min(Math.max(residueCount, 20), 300);
    const outliersPct = outliers ?? 0;
    const favoredPct = favored ?? 97;
    const allowedPct = Math.max(0, 100 - favoredPct - outliersPct);
    const favoredCount = Math.round(count * (favoredPct / 100));
    for (let i = 0; i < favoredCount; i++) {
      const isHelix = Math.random() < 0.55;
      pts.push({
        phi: isHelix ? -60 + (Math.random() * 40 - 20) : (Math.random() * 120 - 180),
        psi: isHelix ? -45 + (Math.random() * 40 - 20) : (Math.random() * 80 + 30),
        region: 'favored',
        chain: '',
      });
    }
    const allowedCount = Math.round(count * (allowedPct / 100));
    for (let i = 0; i < allowedCount; i++) {
      pts.push({
        phi: Math.random() * 360 - 180,
        psi: Math.random() * 180 - 90,
        region: 'allowed',
        chain: '',
      });
    }
    const outlierCount = Math.round(count * (outliersPct / 100));
    for (let i = 0; i < outlierCount; i++) {
      pts.push({
        phi: Math.random() * 300 - 150,
        psi: Math.random() * 200 - 100,
        region: 'disallowed',
        chain: '',
      });
    }
    return pts;
  }, [realPoints, favored, outliers, residueCount]);

  const filteredPoints = React.useMemo(() => {
    let pts = allClassifiedPoints;
    if (selectedChain !== 'all') {
      pts = pts.filter(p => p.chain === selectedChain);
    }
    if (showOutliersOnly) {
      pts = pts.filter(p => p.region === 'disallowed');
    }
    return pts;
  }, [allClassifiedPoints, selectedChain, showOutliersOnly]);

  const regionCounts = React.useMemo(() => {
    const counts = { favored: 0, allowed: 0, disallowed: 0 };
    for (const p of allClassifiedPoints) {
      counts[p.region]++;
    }
    return counts;
  }, [allClassifiedPoints]);

  const axisStyle: React.CSSProperties = { stroke: 'var(--claude-border)', strokeWidth: 1 };
  const gridStyle: React.CSSProperties = { stroke: 'var(--claude-border-light)', strokeWidth: 0.5, strokeDasharray: '2,2' };

  return (
    <div className="relative">
      <div className="flex items-center gap-1 mb-1">
        <select
          value={selectedChain}
          onChange={e => setSelectedChain(e.target.value)}
          className="text-[8px] px-1 py-0.5 rounded border border-claude-border bg-claude-surface text-claude-text"
        >
          <option value="all">All chains</option>
          {chains.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <button
          onClick={() => setShowOutliersOnly(!showOutliersOnly)}
          className={`text-[8px] px-1 py-0.5 rounded border ${showOutliersOnly ? 'border-claude-accent bg-claude-accent-light text-claude-accent' : 'border-claude-border text-claude-text-muted'}`}
        >
          Outliers only
        </button>
        {selectedRegion && (
          <button onClick={() => setSelectedRegion(null)} className="text-[8px] text-claude-accent hover:underline">
            Clear
          </button>
        )}
      </div>
      <svg width={svgSize} height={svgSize} className="block mx-auto">
        <rect x={padding} y={padding} width={plotSize} height={plotSize} fill="var(--claude-bg)" stroke="var(--claude-border)" strokeWidth={1} />
        {/* Grid */}
        {[...Array(9)].map((_, i) => {
          const pos = padding + (plotSize / 8) * i;
          return (
            <g key={i}>
              <line x1={pos} y1={padding} x2={pos} y2={padding + plotSize} style={gridStyle} />
              <line x1={padding} y1={pos} x2={padding + plotSize} y2={pos} style={gridStyle} />
            </g>
          );
        })}
        {/* Axis labels */}
        <text x={center} y={svgSize - 2} textAnchor="middle" className="fill-claude-text-muted text-[7px]">φ (phi)</text>
        <text x={svgSize - 4} y={center} textAnchor="middle" className="fill-claude-text-muted text-[7px]" transform={`rotate(90,${svgSize - 4},${center})`}>ψ (psi)</text>
        {/* Axis lines */}
        <line x1={padding} y1={center} x2={padding + plotSize} y2={center} style={axisStyle} />
        <line x1={center} y1={padding} x2={center} y2={padding + plotSize} style={axisStyle} />
        {/* Region backgrounds */}
        <rect x={center - plotSize / 4} y={center - plotSize / 4} width={plotSize / 2} height={plotSize / 2} fill="#22c55e" fillOpacity={0.1} />
        <text x={center} y={padding + 12} textAnchor="middle" className="fill-green-600 dark:fill-green-400 text-[6px]">Favored</text>
        {/* Points */}
        {filteredPoints.map((p, i) => {
          const x = toX(p.phi);
          const y = toY(p.psi);
          const isOutlier = p.region === 'disallowed';
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={isOutlier ? 2.5 : 1.5}
              fill={
                p.region === 'favored' ? '#22c55e' :
                p.region === 'allowed' ? '#f59e0b' : '#ef4444'
              }
              opacity={selectedRegion && selectedRegion !== p.region ? 0.2 : 0.8}
              className="cursor-pointer"
              onMouseEnter={(e) => {
                setSelectedRegion(p.region);
                const svgRect = e.currentTarget.ownerSVGElement!.getBoundingClientRect();
                setTooltip({ x: e.clientX - svgRect.left, y: e.clientY - svgRect.top - 30, point: { phi: p.phi, psi: p.psi, chain: p.chain } });
              }}
              onMouseLeave={() => setTooltip(null)}
            />
          );
        })}
        {/* Axis tick labels */}
        {[-180, -90, 0, 90, 180].map(v => (
          <g key={v}>
            <text x={toX(v)} y={center + 10} textAnchor="middle" className="fill-claude-text-muted text-[5px]">{v}</text>
            <text x={center + 5} y={toY(v) + 3} textAnchor="start" className="fill-claude-text-muted text-[5px]">{v}</text>
          </g>
        ))}
      </svg>
      {tooltip && (
        <div className="absolute z-10 px-2 py-1 rounded text-[8px] pointer-events-none bg-claude-surface border border-claude-border shadow-md whitespace-nowrap"
          style={{ left: tooltip.x, top: tooltip.y }}>
          φ: {tooltip.point.phi.toFixed(1)}°, ψ: {tooltip.point.psi.toFixed(1)}°
          {tooltip.point.chain && ` (${tooltip.point.chain})`}
        </div>
      )}
      <div className="flex justify-center gap-3 mt-1">
        <div className="flex items-center gap-0.5">
          <div className="w-2 h-2 rounded-full bg-green-500" />
          <span className="text-[7px] text-claude-text-muted">Favored ({regionCounts.favored})</span>
        </div>
        <div className="flex items-center gap-0.5">
          <div className="w-2 h-2 rounded-full bg-amber-500" />
          <span className="text-[7px] text-claude-text-muted">Allowed ({regionCounts.allowed})</span>
        </div>
        <div className="flex items-center gap-0.5">
          <div className="w-2 h-2 rounded-full bg-red-500" />
          <span className="text-[7px] text-claude-text-muted">Outliers ({regionCounts.disallowed})</span>
        </div>
      </div>
    </div>
  );
}