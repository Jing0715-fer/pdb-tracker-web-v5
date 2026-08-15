'use client';

import React, { useMemo, useState, useCallback } from 'react';
import { Treemap, ResponsiveContainer, Tooltip } from 'recharts';
import { Map as MapIcon, X } from 'lucide-react';
import { useTheme } from 'next-themes';
import type { LitPaper } from '@/lib/pdb-types';

// ─── Props ────────────────────────────────────────────────────────────────────

export interface LiteratureJournalTreemapProps {
  papers: LitPaper[];
  onJournalClick?: (journal: string) => void;
}

// ─── Color Helpers ────────────────────────────────────────────────────────────
// IF gradient: emerald <5 → amber 5-15 → orange 15-30 → red 30+

function getIfColor(avgIf: number, isDark: boolean): string {
  if (avgIf >= 30) return isDark ? '#ef6b6b' : '#dc2626';
  if (avgIf >= 15) return isDark ? '#f09040' : '#ea580c';
  if (avgIf >= 5) return isDark ? '#d9a24e' : '#c9872e';
  return isDark ? '#3dbb5e' : '#16a34a';
}

function getIfColorFaded(avgIf: number, isDark: boolean): string {
  if (avgIf >= 30) return isDark ? '#3d2222' : '#fef2f2';
  if (avgIf >= 15) return isDark ? '#3d2e1a' : '#fff7ed';
  if (avgIf >= 5) return isDark ? '#3d3218' : '#fdf4e5';
  return isDark ? '#1a2e1e' : '#f0fdf4';
}

function getIfTierLabel(avgIf: number): string {
  if (avgIf >= 30) return 'Top (≥30)';
  if (avgIf >= 15) return 'High (15-30)';
  if (avgIf >= 5) return 'Mid (5-15)';
  return 'Low (<5)';
}

// ─── Data Aggregation ─────────────────────────────────────────────────────────

interface JournalNode {
  name: string;
  size: number;            // number of papers
  avgIf: number;           // average impact factor
  topPaperTitle: string;   // highest IF paper title
  topPaperIf: number;      // highest IF value
  color: string;           // fill color based on IF
}

interface TreemapDataItem {
  name: string;
  size: number;
  avgIf: number;
  topPaperTitle: string;
  topPaperIf: number;
  color: string;
  bgColor: string;
}

function aggregateByJournal(papers: LitPaper[], isDark: boolean): TreemapDataItem[] {
  const map = new Map<string, { count: number; ifSum: number; topTitle: string; topIf: number }>();

  for (const paper of papers) {
    const journal = paper.journal?.trim() || 'Unknown';
    const ifVal = paper.IF ?? 0;

    const existing = map.get(journal);
    if (existing) {
      existing.count++;
      existing.ifSum += ifVal;
      if (ifVal > existing.topIf) {
        existing.topIf = ifVal;
        existing.topTitle = paper.title || 'Untitled';
      }
    } else {
      map.set(journal, {
        count: 1,
        ifSum: ifVal,
        topIf: ifVal,
        topTitle: paper.title || 'Untitled',
      });
    }
  }

  const items: TreemapDataItem[] = [];
  for (const [journal, data] of map) {
    const avgIf = data.ifSum / data.count;
    items.push({
      name: journal,
      size: data.count,
      avgIf,
      topPaperTitle: data.topTitle,
      topPaperIf: data.topIf,
      color: getIfColor(avgIf, isDark),
      bgColor: getIfColorFaded(avgIf, isDark),
    });
  }

  // Sort by size descending so biggest journals get biggest rectangles
  items.sort((a, b) => b.size - a.size);
  return items;
}

// ─── Custom Treemap Content Renderer ──────────────────────────────────────────

interface CustomContentProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  name?: string;
  size?: number;
  avgIf?: number;
  color?: string;
  bgColor?: string;
  depth?: number;
  index?: number;
}

function CustomTreemapContent(props: CustomContentProps) {
  const { x = 0, y = 0, width = 0, height = 0, name, size, avgIf, color, bgColor } = props;

  if (width < 2 || height < 2) return null;

  const showText = width > 50 && height > 28;
  const showCount = width > 35 && height > 16;
  const isSmall = width < 80 || height < 40;

  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={bgColor || '#f5f0ea'}
        stroke={color || '#c96442'}
        strokeWidth={1.5}
        rx={4}
        ry={4}
        className="treemap-cell"
        style={{ cursor: 'pointer', transition: 'opacity 0.15s ease' }}
      />
      {/* Color accent bar at the top */}
      <rect
        x={x}
        y={y}
        width={width}
        height={3}
        fill={color || '#c96442'}
        rx={4}
        ry={4}
        style={{ opacity: 0.8 }}
      />
      {showText && (
        <>
          <text
            x={x + 6}
            y={y + (isSmall ? 16 : 20)}
            fontSize={isSmall ? 8 : 10}
            fontWeight={600}
            fill="var(--claude-text)"
            className="pointer-events-none select-none"
            style={{ maxWidth: width - 12 }}
          >
            {(name || '').length > (isSmall ? 15 : 25) ? (name || '').slice(0, isSmall ? 15 : 25) + '…' : name}
          </text>
          {showCount && (
            <text
              x={x + 6}
              y={y + (isSmall ? 28 : 34)}
              fontSize={8}
              fontWeight={400}
              fill="var(--claude-text-muted)"
              className="pointer-events-none select-none"
            >
              {size} paper{size !== 1 ? 's' : ''} · IF {avgIf?.toFixed(1) ?? '—'}
            </text>
          )}
        </>
      )}
    </g>
  );
}

// ─── Custom Tooltip ───────────────────────────────────────────────────────────

function TreemapTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: TreemapDataItem }>;
}) {
  if (!active || !payload?.length || !payload[0]?.payload) return null;
  const d = payload[0].payload;

  return (
    <div className="rounded-lg px-3 py-2 text-xs shadow-lg border bg-white dark:bg-[#2b2926] dark:border-[#4a4540] text-claude-text max-w-[280px]">
      <div className="flex items-center gap-2 mb-1">
        <span
          className="w-2.5 h-2.5 rounded-sm flex-shrink-0"
          style={{ backgroundColor: d.color }}
        />
        <span className="font-semibold text-[11px] text-claude-text truncate">{d.name}</span>
      </div>
      <div className="space-y-0.5">
        <div className="flex items-center justify-between gap-4">
          <span className="text-claude-text-muted">Papers</span>
          <span className="font-mono font-medium text-claude-text">{d.size}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-claude-text-muted">Avg IF</span>
          <span className="font-mono font-medium" style={{ color: d.color }}>
            {d.avgIf.toFixed(1)}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="text-claude-text-muted">IF Tier</span>
          <span className="font-medium text-[10px]" style={{ color: d.color }}>
            {getIfTierLabel(d.avgIf)}
          </span>
        </div>
      </div>
      {d.topPaperTitle && (
        <div className="mt-1.5 pt-1.5 border-t border-claude-border dark:border-[#3d3832]">
          <div className="text-[9px] text-claude-text-muted mb-0.5">Top paper (IF {d.topPaperIf.toFixed(1)})</div>
          <div className="text-[10px] text-claude-text-secondary line-clamp-2">{d.topPaperTitle}</div>
        </div>
      )}
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function LiteratureJournalTreemap({ papers, onJournalClick }: LiteratureJournalTreemapProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const [selectedJournal, setSelectedJournal] = useState<string | null>(null);

  // Aggregate papers by journal
  const journalData = useMemo(() => aggregateByJournal(papers, isDark), [papers, isDark]);

  // Summary stats
  const summary = useMemo(() => {
    if (journalData.length === 0) return null;
    const totalJournals = journalData.length;
    const topJournal = journalData[0]; // already sorted by size
    const totalIf = journalData.reduce((sum, j) => sum + j.avgIf * j.size, 0);
    const totalCount = journalData.reduce((sum, j) => sum + j.size, 0);
    const avgIf = totalCount > 0 ? totalIf / totalCount : 0;
    return { totalJournals, topJournal, avgIf };
  }, [journalData]);

  // Handle click on a treemap cell
  const handleCellClick = useCallback(
    (_data: TreemapDataItem | undefined) => {
      if (!_data) return;
      const journal = _data.name;
      if (selectedJournal === journal) {
        setSelectedJournal(null);
        onJournalClick?.('');
      } else {
        setSelectedJournal(journal);
        onJournalClick?.(journal);
      }
    },
    [onJournalClick, selectedJournal]
  );

  // Wrap data for recharts Treemap (needs children structure)
  const treemapData = useMemo(() => {
    return [
      {
        name: 'journals',
        children: journalData,
      },
    ];
  }, [journalData]);

  // Empty state
  if (!papers || papers.length === 0) {
    return (
      <div className="journal-treemap-section rounded-xl border border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] p-6">
        <div className="flex items-center gap-2 mb-4">
          <MapIcon className="h-4 w-4 text-claude-accent" />
          <h3 className="text-sm font-semibold text-claude-text">Journal Impact Treemap</h3>
        </div>
        <div className="flex flex-col items-center justify-center py-10 text-claude-text-muted">
          <MapIcon className="h-8 w-8 mb-2 opacity-30" />
          <p className="text-xs">No papers available to generate treemap</p>
        </div>
      </div>
    );
  }

  return (
    <div className="journal-treemap-section rounded-xl border border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <MapIcon className="h-4 w-4 text-claude-accent" />
          <h3 className="text-sm font-semibold text-claude-text">Journal Impact Treemap</h3>
          <span className="text-[10px] text-claude-text-muted">
            Size = paper count · Color = avg impact factor
          </span>
        </div>
        {selectedJournal && (
          <button
            onClick={() => {
              setSelectedJournal(null);
              onJournalClick?.('');
            }}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium bg-claude-accent/10 text-claude-accent hover:bg-claude-accent/20 transition-colors"
          >
            Filtered: {selectedJournal}
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* IF color legend */}
      <div className="flex items-center gap-3 mb-3">
        <span className="text-[9px] text-claude-text-muted">Impact Factor:</span>
        {[
          { label: '<5', color: getIfColor(2, isDark), range: 'Low' },
          { label: '5-15', color: getIfColor(8, isDark), range: 'Mid' },
          { label: '15-30', color: getIfColor(20, isDark), range: 'High' },
          { label: '30+', color: getIfColor(40, isDark), range: 'Top' },
        ].map((item) => (
          <div key={item.label} className="flex items-center gap-1">
            <span
              className="w-3 h-2 rounded-sm"
              style={{ backgroundColor: item.color }}
            />
            <span className="text-[9px] text-claude-text-muted">{item.label}</span>
          </div>
        ))}
      </div>

      {/* Treemap Chart */}
      <div className="h-[350px]">
        <ResponsiveContainer width="100%" height="100%">
          <Treemap
            data={treemapData as any}
            dataKey="size"
            nameKey="name"
            stroke="none"
            aspectRatio={4 / 3}
            content={<CustomTreemapContent />}
            onClick={(data: any) => {
              if (data?.name) {
                handleCellClick(data as TreemapDataItem);
              }
            }}
          >
            <Tooltip content={<TreemapTooltip />} />
          </Treemap>
        </ResponsiveContainer>
      </div>

      {/* Summary row */}
      {summary && (
        <div className="flex items-center gap-4 mt-3 pt-3 border-t border-claude-border dark:border-[#3d3832]">
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-claude-text-muted">Total journals</span>
            <span className="text-[11px] font-semibold text-claude-text">{summary.totalJournals}</span>
          </div>
          <div className="w-px h-3 bg-claude-border dark:bg-[#3d3832]" />
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-claude-text-muted">Top journal</span>
            <span className="text-[11px] font-semibold text-claude-accent truncate max-w-[200px]">
              {summary.topJournal.name}
            </span>
            <span className="text-[9px] text-claude-text-muted">({summary.topJournal.size} papers)</span>
          </div>
          <div className="w-px h-3 bg-claude-border dark:bg-[#3d3832]" />
          <div className="flex items-center gap-1.5">
            <span className="text-[9px] text-claude-text-muted">Avg IF</span>
            <span className="text-[11px] font-semibold text-claude-text">{summary.avgIf.toFixed(1)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
