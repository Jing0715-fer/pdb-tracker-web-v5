'use client';

import React, { useMemo } from 'react';
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { useTheme } from 'next-themes';
import type { PdbEntry } from '@/lib/pdb-types';
import { getMethodLabel } from '@/components/pdb-helpers';

// ─── Color palette for up to 4 structures ───────────────────────────────────

const STRUCTURE_COLORS = [
  { stroke: '#2d8f8f', fill: '#2d8f8f' }, // teal (cryo-em color)
  { stroke: '#7c5cbf', fill: '#7c5cbf' }, // purple (x-ray color)
  { stroke: '#c9872e', fill: '#c9872e' }, // amber (nmr color)
  { stroke: '#c96442', fill: '#c96442' }, // claude-accent
];

const STRUCTURE_COLORS_DARK = [
  { stroke: '#3db5b5', fill: '#3db5b5' }, // teal dark
  { stroke: '#9b7ed8', fill: '#9b7ed8' }, // purple dark
  { stroke: '#d9a24e', fill: '#d9a24e' }, // amber dark
  { stroke: '#d4784f', fill: '#d4784f' }, // claude-accent dark
];

// ─── Metric computation helpers ─────────────────────────────────────────────

/** Resolution Quality: lower res = higher quality. 0-100 scale */
function computeResolutionQuality(resolution: number | null): number {
  if (resolution == null) return 0;
  return Math.max(0, Math.round(100 - (resolution - 0.5) * 20));
}

/** Impact Factor: normalized to 0-100, 70 being max IF */
function computeImpactFactor(journalIf: number | null): number {
  if (journalIf == null) return 0;
  return Math.min(100, Math.round((journalIf / 70) * 100));
}

/** Method Score: Cryo-EM=70, X-ray=85, NMR=50, Other=30 */
function computeMethodScore(method: string | null): number {
  if (!method) return 0;
  const m = method.toUpperCase();
  if (m.includes('CRYO-EM') || m.includes('ELECTRON MICROSCOPY')) return 70;
  if (m.includes('X-RAY')) return 85;
  if (m.includes('NMR')) return 50;
  return 30;
}

/** Completeness: percentage of populated fields out of 6 key fields */
function computeCompleteness(entry: PdbEntry): number {
  const fields: (string | null | undefined)[] = [
    entry.title,
    entry.authors,
    entry.doi,
    entry.pubmedAbstract,
    entry.organisms,
    entry.ligands,
  ];
  const populated = fields.filter(f => f != null && f.trim().length > 0).length;
  return Math.round((populated / fields.length) * 100);
}

/** Recency: newer dates get higher scores. Max 100 for today, decays over 2 years */
function computeRecency(releaseDate: string | null): number {
  if (!releaseDate) return 0;
  try {
    const date = new Date(releaseDate + 'T00:00:00Z');
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = diffMs / (1000 * 60 * 60 * 24);
    // Full score for today, 0 for 2+ years old
    const maxDays = 730; // 2 years
    if (diffDays < 0) return 100;
    const score = Math.max(0, Math.round((1 - diffDays / maxDays) * 100));
    return score;
  } catch {
    return 0;
  }
}

// ─── Metric labels ──────────────────────────────────────────────────────────

interface MetricDefinition {
  key: string;
  label: string;
  compute: (entry: PdbEntry) => number;
  description: string;
}

const METRICS: MetricDefinition[] = [
  { key: 'resolutionQuality', label: 'Resolution', compute: (e) => computeResolutionQuality(e.resolution), description: 'Resolution quality (lower Å = higher score)' },
  { key: 'impactFactor', label: 'Impact', compute: (e) => computeImpactFactor(e.journalIf), description: 'Journal impact factor (normalized)' },
  { key: 'methodScore', label: 'Method', compute: (e) => computeMethodScore(e.method), description: 'Experimental method score' },
  { key: 'completeness', label: 'Completeness', compute: (e) => computeCompleteness(e), description: 'Data completeness (populated fields)' },
  { key: 'recency', label: 'Recency', compute: (e) => computeRecency(e.releaseDate), description: 'Release date recency (newer = higher)' },
];

// ─── Props ──────────────────────────────────────────────────────────────────

interface StructureRadarCompareProps {
  entries: PdbEntry[];
}

// ─── Custom Tooltip ─────────────────────────────────────────────────────────

interface RadarTooltipProps {
  active?: boolean;
  payload?: Array<{
    name: string;
    value: number;
    color: string;
    dataKey: string;
    payload: { metric: string; fullLabel: string; description: string; [key: string]: number | string };
  }>;
  label?: string;
  isDark: boolean;
}

function RadarTooltip({ active, payload, isDark }: RadarTooltipProps) {
  if (!active || !payload?.length) return null;
  const metricLabel = payload[0]?.payload?.fullLabel || payload[0]?.payload?.metric || '';
  const description = payload[0]?.payload?.description || '';
  return (
    <div
      className={`rounded-lg px-3 py-2 text-xs shadow-lg border ${
        isDark ? 'bg-[#2b2926] border-[#4a4540]' : 'bg-white border-[#e7e0d8]'
      }`}
    >
      <div className={`font-semibold mb-0.5 text-[11px] ${isDark ? 'text-[#e8e0d8]' : 'text-[#3d3530]'}`}>
        {metricLabel}
      </div>
      {description && (
        <div className={`text-[9px] mb-1.5 ${isDark ? 'text-[#9b9590]' : 'text-[#7c756e]'}`}>
          {description}
        </div>
      )}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center gap-2 py-0.5">
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{ backgroundColor: p.color || STRUCTURE_COLORS[i]?.stroke }}
          />
          <span className={isDark ? 'text-[#c4b8a8]' : 'text-[#5c524a]'}>{p.name}</span>
          <span className={`font-mono font-medium ml-auto ${isDark ? 'text-[#e8e0d8]' : 'text-[#3d3530]'}`}>
            {p.value}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── Component ──────────────────────────────────────────────────────────────

export function StructureRadarCompare({ entries }: StructureRadarCompareProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';

  // Build radar data: one object per metric, with each entry's score as a key
  const radarData = useMemo(() => {
    return METRICS.map((metric) => {
      const point: Record<string, number | string> = {
        metric: metric.key,
        fullLabel: metric.label,
        description: metric.description,
      };
      entries.forEach((entry, idx) => {
        point[entry.pdbId] = metric.compute(entry);
      });
      return point;
    });
  }, [entries]);

  // Choose color palette based on theme
  const colors = isDark ? STRUCTURE_COLORS_DARK : STRUCTURE_COLORS;

  // Build legend payload
  const legendPayload = useMemo(() => {
    return entries.map((entry, idx) => ({
      value: `${entry.pdbId} (${getMethodLabel(entry.method)})`,
      color: colors[idx % colors.length].stroke,
      id: entry.pdbId,
    }));
  }, [entries, colors]);

  // Axis tick style
  const axisTickStyle = useMemo(() => ({
    fill: isDark ? '#9b9590' : '#7c756e',
    fontSize: 11,
    fontWeight: 500 as const,
  }), [isDark]);

  return (
    <div className="radar-compare-container">
      <div className="w-full" style={{ height: 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart
            cx="50%"
            cy="50%"
            outerRadius="70%"
            data={radarData}
            margin={{ top: 10, right: 10, bottom: 10, left: 10 }}
          >
            <PolarGrid
              stroke={isDark ? '#3d3832' : '#e7e0d8'}
              strokeDasharray="3 3"
            />
            <PolarAngleAxis
              dataKey="fullLabel"
              tick={axisTickStyle}
            />
            <PolarRadiusAxis
              angle={90}
              domain={[0, 100]}
              tick={false}
              axisLine={false}
            />
            {entries.map((entry, idx) => {
              const colorSet = colors[idx % colors.length];
              return (
                <Radar
                  key={entry.pdbId}
                  name={entry.pdbId}
                  dataKey={entry.pdbId}
                  stroke={colorSet.stroke}
                  fill={colorSet.fill}
                  fillOpacity={0.12}
                  strokeWidth={2}
                  dot={{
                    r: 3,
                    fill: colorSet.fill,
                    stroke: colorSet.stroke,
                    strokeWidth: 1,
                  }}
                  activeDot={{
                    r: 5,
                    fill: colorSet.fill,
                    stroke: colorSet.stroke,
                    strokeWidth: 2,
                  }}
                />
              );
            })}
            <Tooltip
              content={<RadarTooltip isDark={isDark} />}
            />
            <Legend
              {...({
                payload: legendPayload.map(item => ({
                  value: item.value,
                  color: item.color,
                  id: item.id,
                })),
                wrapperStyle: {
                  fontSize: 11,
                  paddingTop: 8,
                  color: isDark ? '#c4b8a8' : '#5c524a',
                },
                iconType: 'circle',
                iconSize: 8,
              } as any)}
            />
          </RadarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
