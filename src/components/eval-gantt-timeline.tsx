'use client';
import { useI18n } from '@/lib/i18n';

import React, { useMemo, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from 'next-themes';
import { Clock, Diamond, Star, Square, Circle, Info } from 'lucide-react';
import type { Evaluation } from '@/lib/pdb-types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Milestone {
  type: 'created' | 'pdb_added' | 'blast_completed' | 'report_generated';
  date: Date;
  label: string;
}

interface GanttBarData {
  evaluation: Evaluation;
  startDate: Date;
  endDate: Date;
  coverage: number;
  milestones: Milestone[];
}

interface EvalGanttTimelineProps {
  evaluations: Evaluation[];
  onSelectEval?: (uniprotId: string) => void;
  selectedUniprotId?: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getBarColor(coverage: number): string {
  if (coverage < 30) return '#ef4444'; // red
  if (coverage < 60) return '#f59e0b'; // amber
  return '#2d8f8f'; // teal
}

function getBarColorDark(coverage: number): string {
  if (coverage < 30) return '#f87171';
  if (coverage < 60) return '#fbbf24';
  return '#3db5b5';
}

function buildMilestones(eval_: Evaluation, locale: 'en' | 'zh' = 'en'): Milestone[] {
  const milestones: Milestone[] = [];

  // Created milestone (always present)
  milestones.push({
    type: 'created',
    date: new Date(eval_.createdAt),
    label: 'Created',
  });

  // PDB structures added (use earliest structure releaseDate)
  if (eval_.pdbStructures.length > 0) {
    const dates = eval_.pdbStructures
      .map(s => s.releaseDate ? new Date(s.releaseDate) : null)
      .filter((d): d is Date => d !== null);
    const earliest = dates.length > 0 ? new Date(Math.min(...dates.map(d => d.getTime()))) : null;
    milestones.push({
      type: 'pdb_added',
      date: earliest || new Date(eval_.createdAt),
      label: `${eval_.pdbStructures.length} PDB structures`,
    });
  }

  // BLAST completed (use createdAt + small offset if BLAST results exist)
  if (eval_.blastResults.length > 0) {
    const createdDate = new Date(eval_.createdAt);
    const blastDate = new Date(createdDate.getTime() + 1000 * 60 * 60 * 2); // 2h after creation
    milestones.push({
      type: 'blast_completed',
      date: blastDate,
      label: `${eval_.blastResults.length} BLAST results`,
    });
  }

  // Report generated
  if (eval_.report) {
    const updatedDate = new Date(eval_.updatedAt);
    milestones.push({
      type: 'report_generated',
      date: updatedDate,
      label: locale === 'zh' ? '报告已生成' : 'Report generated',
    });
  }

  return milestones.sort((a, b) => a.date.getTime() - b.date.getTime());
}

function formatMonth(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

function formatDateShort(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── Milestone Symbol ─────────────────────────────────────────────────────────

function MilestoneSymbol({ type, x, y, size = 8 }: { type: Milestone['type']; x: number; y: number; size?: number }) {
  const isDark = document.documentElement.classList.contains('dark');
  const fillColor = isDark ? '#faf8f5' : '#1a1917';
  const strokeColor = isDark ? '#3d3832' : '#e8e4dd';

  switch (type) {
    case 'created':
      return <circle cx={x} cy={y} r={size / 2} fill={fillColor} stroke={strokeColor} strokeWidth={1.5} />;
    case 'pdb_added':
      // Diamond
      return (
        <polygon
          points={`${x},${y - size / 2} ${x + size / 2},${y} ${x},${y + size / 2} ${x - size / 2},${y}`}
          fill={fillColor} stroke={strokeColor} strokeWidth={1.5}
        />
      );
    case 'blast_completed':
      // Square
      return (
        <rect
          x={x - size / 2} y={y - size / 2} width={size} height={size}
          fill={fillColor} stroke={strokeColor} strokeWidth={1.5}
        />
      );
    case 'report_generated':
      // Star (5-pointed)
      return (
        <polygon
          points={Array.from({ length: 5 }, (_, i) => {
            const angle = (i * 72 - 90) * Math.PI / 180;
            const outerR = size / 2;
            return `${x + outerR * Math.cos(angle)},${y + outerR * Math.sin(angle)}`;
          }).join(' ')}
          fill={fillColor} stroke={strokeColor} strokeWidth={1.5}
        />
      );
    default:
      return null;
  }
}

// ─── Tooltip ──────────────────────────────────────────────────────────────────

function GanttTooltip({
  data,
  position,
  isDark,
}: {
  data: GanttBarData;
  position: { x: number; y: number };
  isDark: boolean;
}) {
  const eval_ = data.evaluation;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={{ duration: 0.15 }}
      className="fixed z-50 pointer-events-none"
      style={{ left: position.x + 12, top: position.y - 10 }}
    >
      <div className={`px-3 py-2.5 rounded-lg shadow-lg border text-xs max-w-[280px] ${
        isDark
          ? 'bg-[#2b2926] border-[#3d3832] text-claude-text'
          : 'bg-white border-claude-border text-claude-text'
      }`}>
        <div className="font-semibold text-sm mb-1.5" style={{ color: getBarColor(data.coverage) }}>
          {eval_.proteinName || eval_.uniprotId}
        </div>
        <div className="space-y-1 text-[11px]">
          <div className="flex justify-between gap-4">
            <span className={isDark ? 'text-[#9b9590]' : 'text-claude-text-muted'}>UniProt ID</span>
            <span className="font-mono font-medium">{eval_.uniprotId}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className={isDark ? 'text-[#9b9590]' : 'text-claude-text-muted'}>Coverage</span>
            <span className="font-mono font-semibold" style={{ color: getBarColor(data.coverage) }}>
              {data.coverage.toFixed(0)}%
            </span>
          </div>
          <div className="flex justify-between gap-4">
            <span className={isDark ? 'text-[#9b9590]' : 'text-claude-text-muted'}>PDB Structures</span>
            <span className="font-mono font-medium">{eval_.pdbStructures.length}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className={isDark ? 'text-[#9b9590]' : 'text-claude-text-muted'}>BLAST Results</span>
            <span className="font-mono font-medium">{eval_.blastResults.length}</span>
          </div>
          {eval_.organism && (
            <div className="flex justify-between gap-4">
              <span className={isDark ? 'text-[#9b9590]' : 'text-claude-text-muted'}>Organism</span>
              <span className="truncate max-w-[150px]">{eval_.organism}</span>
            </div>
          )}
        </div>
        {/* Milestones */}
        {data.milestones.length > 1 && (
          <div className="mt-2 pt-2 border-t border-claude-border/30 dark:border-[#3d3832]/30">
            <div className="text-[10px] font-medium uppercase tracking-wider text-claude-text-muted mb-1">Milestones</div>
            {data.milestones.map((m, i) => (
              <div key={i} className="flex items-center gap-1.5 text-[10px]">
                {m.type === 'created' && <Circle className="h-2.5 w-2.5 flex-shrink-0" />}
                {m.type === 'pdb_added' && <Diamond className="h-2.5 w-2.5 flex-shrink-0" />}
                {m.type === 'blast_completed' && <Square className="h-2.5 w-2.5 flex-shrink-0" />}
                {m.type === 'report_generated' && <Star className="h-2.5 w-2.5 flex-shrink-0" />}
                <span className={isDark ? 'text-[#9b9590]' : 'text-claude-text-muted'}>{formatDateShort(m.date)}</span>
                <span>{m.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─── Legend ───────────────────────────────────────────────────────────────────

function GanttLegend({ isDark }: { isDark: boolean }) {
  const items = [
    { type: 'created' as const, label: 'Created', icon: <Circle className="h-3 w-3" /> },
    { type: 'pdb_added' as const, label: 'PDB Added', icon: <Diamond className="h-3 w-3" /> },
    { type: 'blast_completed' as const, label: 'BLAST Done', icon: <Square className="h-3 w-3" /> },
    { type: 'report_generated' as const, label: 'Report', icon: <Star className="h-3 w-3" /> },
  ];

  const colorItems = [
    { color: '#ef4444', label: '<30% coverage' },
    { color: '#f59e0b', label: '30–60%' },
    { color: '#2d8f8f', label: '>60%' },
  ];

  return (
    <div className={`flex flex-wrap items-center gap-4 px-4 py-2 border-b text-[10px] ${
      isDark ? 'border-[#3d3832] bg-[#242220]' : 'border-claude-border bg-claude-surface'
    }`}>
      <div className="flex items-center gap-3">
        <span className={`font-medium uppercase tracking-wider ${isDark ? 'text-[#9b9590]' : 'text-claude-text-muted'}`}>
          Milestones:
        </span>
        {items.map(item => (
          <div key={item.type} className="flex items-center gap-1">
            {item.icon}
            <span className={isDark ? 'text-[#9b9590]' : 'text-claude-text-muted'}>{item.label}</span>
          </div>
        ))}
      </div>
      <div className={`w-px h-3 ${isDark ? 'bg-[#3d3832]' : 'bg-claude-border'}`} />
      <div className="flex items-center gap-3">
        <span className={`font-medium uppercase tracking-wider ${isDark ? 'text-[#9b9590]' : 'text-claude-text-muted'}`}>
          Coverage:
        </span>
        {colorItems.map(item => (
          <div key={item.label} className="flex items-center gap-1">
            <span className="w-3 h-2 rounded-sm flex-shrink-0" style={{ backgroundColor: item.color }} />
            <span className={isDark ? 'text-[#9b9590]' : 'text-claude-text-muted'}>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function EvalGanttTimeline({
  evaluations,
  onSelectEval,
  selectedUniprotId,
}: EvalGanttTimelineProps) {
  const { locale } = useI18n();
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [tooltipData, setTooltipData] = useState<{
    data: GanttBarData;
    position: { x: number; y: number };
  } | null>(null);

  // Build Gantt bar data
  const bars = useMemo((): GanttBarData[] => {
    if (evaluations.length === 0) return [];

    return evaluations.map(eval_ => {
      const milestones = buildMilestones(eval_, locale);
      const dates = milestones.map(m => m.date.getTime());
      const startDate = new Date(Math.min(...dates));
      const endDate = new Date(Math.max(...dates));

      // Ensure at least 1 day span
      if (endDate.getTime() === startDate.getTime()) {
        endDate.setDate(endDate.getDate() + 1);
      }

      return {
        evaluation: eval_,
        startDate,
        endDate,
        coverage: eval_.coverage ?? 0,
        milestones,
      };
    }).sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  }, [evaluations]);

  // Time range
  const { minDate, maxDate, totalMs, monthLabels } = useMemo(() => {
    if (bars.length === 0) {
      const now = new Date();
      return { minDate: now, maxDate: now, totalMs: 1, monthLabels: [] };
    }

    const allDates = bars.flatMap(b => [b.startDate, b.endDate]);
    const minDate = new Date(Math.min(...allDates.map(d => d.getTime())));
    const maxDate = new Date(Math.max(...allDates.map(d => d.getTime())));

    // Extend range by 10% on each side
    const rangeMs = maxDate.getTime() - minDate.getTime();
    const paddedMin = new Date(minDate.getTime() - rangeMs * 0.1);
    const paddedMax = new Date(maxDate.getTime() + rangeMs * 0.1);
    const totalMs = paddedMax.getTime() - paddedMin.getTime();

    // Generate month labels
    const monthLabels: { date: Date; x: number; label: string }[] = [];
    const current = new Date(paddedMin.getFullYear(), paddedMin.getMonth(), 1);
    while (current <= paddedMax) {
      const x = ((current.getTime() - paddedMin.getTime()) / totalMs) * 100;
      monthLabels.push({ date: new Date(current), x, label: formatMonth(current) });
      current.setMonth(current.getMonth() + 1);
    }

    return { minDate: paddedMin, maxDate: paddedMax, totalMs, monthLabels };
  }, [bars]);

  const dateToX = useCallback((date: Date) => {
    return ((date.getTime() - minDate.getTime()) / totalMs) * 100;
  }, [minDate, totalMs]);

  // Today marker
  const todayX = useMemo(() => {
    const today = new Date();
    if (today < minDate || today > maxDate) return null;
    return dateToX(today);
  }, [minDate, maxDate, dateToX]);

  // Handle hover
  const handleMouseEnter = useCallback((bar: GanttBarData, e: React.MouseEvent) => {
    setHoveredId(bar.evaluation.uniprotId);
    const rect = (e.currentTarget as SVGElement).closest('svg')?.getBoundingClientRect();
    if (rect) {
      setTooltipData({
        data: bar,
        position: { x: e.clientX, y: e.clientY },
      });
    }
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (tooltipData) {
      setTooltipData(prev => prev ? { ...prev, position: { x: e.clientX, y: e.clientY } } : null);
    }
  }, [tooltipData]);

  const handleMouseLeave = useCallback(() => {
    setHoveredId(null);
    setTooltipData(null);
  }, []);

  // Chart dimensions
  const rowHeight = 40;
  const labelWidth = 140;
  const headerHeight = 28;
  const chartHeight = Math.max(bars.length * rowHeight + headerHeight, 200);
  const chartWidth = Math.max(800, bars.length * 120);
  const svgWidth = labelWidth + chartWidth;

  if (evaluations.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center justify-center h-full min-h-[300px] px-4"
      >
        <Clock className="h-12 w-12 text-claude-text-muted mb-3" />
        <h3 className="text-base font-semibold text-claude-text mb-1">No Evaluations for Timeline</h3>
        <p className="text-sm text-claude-text-secondary text-center">
          Evaluation timeline will appear here once evaluations are loaded.
        </p>
      </motion.div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Legend */}
      <GanttLegend isDark={isDark} />

      {/* Chart container with horizontal scroll */}
      <div className="flex-1 overflow-auto custom-scrollbar">
        <svg
          width={svgWidth}
          height={chartHeight}
          className="select-none"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        >
          {/* Background */}
          <rect
            width={svgWidth}
            height={chartHeight}
            fill={isDark ? '#1a1917' : '#faf8f5'}
          />

          {/* Header area */}
          <rect
            x={0} y={0} width={svgWidth} height={headerHeight}
            fill={isDark ? '#242220' : '#f5f0ea'}
          />

          {/* Label column background */}
          <rect
            x={0} y={headerHeight} width={labelWidth} height={chartHeight - headerHeight}
            fill={isDark ? '#242220' : '#f5f0ea'}
          />

          {/* Month labels on time axis */}
          {monthLabels.map((ml, i) => {
            const x = labelWidth + (ml.x / 100) * chartWidth;
            return (
              <g key={i}>
                <line
                  x1={x} y1={headerHeight}
                  x2={x} y2={chartHeight}
                  stroke={isDark ? '#2b2926' : '#e8e4dd'}
                  strokeWidth={0.5}
                  strokeDasharray="4,4"
                />
                <text
                  x={x} y={headerHeight - 8}
                  textAnchor="middle"
                  className="text-[10px]"
                  fill={isDark ? '#6b6560' : '#9b9590'}
                  fontSize={10}
                >
                  {ml.label}
                </text>
              </g>
            );
          })}

          {/* Today marker */}
          {todayX !== null && (
            <line
              x1={labelWidth + (todayX / 100) * chartWidth}
              y1={headerHeight}
              x2={labelWidth + (todayX / 100) * chartWidth}
              y2={chartHeight}
              stroke="#ef4444"
              strokeWidth={1.5}
              strokeDasharray="6,3"
            >
              <animate
                attributeName="stroke-opacity"
                values="0.5;1;0.5"
                dur="2s"
                repeatCount="indefinite"
              />
            </line>
          )}

          {/* Today label */}
          {todayX !== null && (
            <text
              x={labelWidth + (todayX / 100) * chartWidth}
              y={headerHeight - 8}
              textAnchor="middle"
              fill="#ef4444"
              fontSize={9}
              fontWeight="bold"
            >
              Today
            </text>
          )}

          {/* Separator lines */}
          <line
            x1={labelWidth} y1={0} x2={labelWidth} y2={chartHeight}
            stroke={isDark ? '#3d3832' : '#e8e4dd'}
            strokeWidth={1}
          />
          <line
            x1={0} y1={headerHeight} x2={svgWidth} y2={headerHeight}
            stroke={isDark ? '#3d3832' : '#e8e4dd'}
            strokeWidth={1}
          />

          {/* Bars for each evaluation */}
          {bars.map((bar, idx) => {
            const y = headerHeight + idx * rowHeight;
            const barY = y + 8;
            const barH = 24;
            const startX = dateToX(bar.startDate);
            const endX = dateToX(bar.endDate);
            const barWidth = Math.max(endX - startX, 2);
            const barX = labelWidth + (startX / 100) * chartWidth;
            const barWidthPx = (barWidth / 100) * chartWidth;
            const isHovered = hoveredId === bar.evaluation.uniprotId;
            const isSelected = selectedUniprotId === bar.evaluation.uniprotId;
            const barColor = isDark ? getBarColorDark(bar.coverage) : getBarColor(bar.coverage);

            return (
              <g key={bar.evaluation.uniprotId}>
                {/* Row background (alternating) */}
                <rect
                  x={labelWidth} y={y} width={chartWidth} height={rowHeight}
                  fill={idx % 2 === 0
                    ? (isDark ? '#1a1917' : '#faf8f5')
                    : (isDark ? '#1e1c1a' : '#f5f0ea')
                  }
                  opacity={isHovered || isSelected ? 1 : 0.6}
                />

                {/* Hover highlight */}
                {(isHovered || isSelected) && (
                  <rect
                    x={labelWidth} y={y} width={chartWidth} height={rowHeight}
                    fill={barColor}
                    opacity={0.05}
                  />
                )}

                {/* Row separator */}
                <line
                  x1={labelWidth} y1={y + rowHeight}
                  x2={svgWidth} y2={y + rowHeight}
                  stroke={isDark ? '#2b2926' : '#e8e4dd'}
                  strokeWidth={0.5}
                />

                {/* Label */}
                <text
                  x={labelWidth - 8}
                  y={y + rowHeight / 2 + 4}
                  textAnchor="end"
                  fill={isHovered || isSelected ? barColor : (isDark ? '#9b9590' : '#6b6560')}
                  fontSize={11}
                  fontWeight={isHovered || isSelected ? 600 : 400}
                  className="truncate"
                >
                  {bar.evaluation.proteinName || bar.evaluation.uniprotId}
                </text>
                {/* UniProt ID */}
                <text
                  x={labelWidth - 8}
                  y={y + rowHeight / 2 + 15}
                  textAnchor="end"
                  fill={isDark ? '#6b6560' : '#9b9590'}
                  fontSize={8}
                  fontFamily="monospace"
                >
                  {bar.evaluation.uniprotId}
                </text>

                {/* Animated bar */}
                <motion.rect
                  x={barX}
                  y={barY}
                  width={barWidthPx}
                  height={barH}
                  rx={4}
                  ry={4}
                  fill={barColor}
                  opacity={isHovered ? 0.9 : 0.6}
                  initial={{ width: 0, opacity: 0 }}
                  animate={{ width: barWidthPx, opacity: isHovered ? 0.9 : 0.6 }}
                  transition={{ duration: 0.6, delay: idx * 0.05, ease: 'easeOut' }}
                  style={{ cursor: onSelectEval ? 'pointer' : 'default' }}
                  onClick={() => onSelectEval?.(bar.evaluation.uniprotId)}
                  onMouseEnter={(e) => handleMouseEnter(bar, e)}
                />

                {/* Coverage text on bar */}
                {barWidthPx > 40 && (
                  <text
                    x={barX + barWidthPx / 2}
                    y={barY + barH / 2 + 4}
                    textAnchor="middle"
                    fill="white"
                    fontSize={10}
                    fontWeight={600}
                    className="pointer-events-none"
                  >
                    {bar.coverage.toFixed(0)}%
                  </text>
                )}

                {/* Milestone markers */}
                {bar.milestones.map((milestone, mi) => {
                  const mx = labelWidth + (dateToX(milestone.date) / 100) * chartWidth;
                  const my = barY + barH / 2;

                  // Only render milestone if it's within the bar range
                  if (dateToX(milestone.date) < startX || dateToX(milestone.date) > endX) return null;

                  return (
                    <g key={mi}>
                      {milestone.type === 'created' && (
                        <circle cx={mx} cy={my} r={4} fill="white" stroke={barColor} strokeWidth={1.5} />
                      )}
                      {milestone.type === 'pdb_added' && (
                        <polygon
                          points={`${mx},${my - 4} ${mx + 4},${my} ${mx},${my + 4} ${mx - 4},${my}`}
                          fill="white" stroke={barColor} strokeWidth={1.5}
                        />
                      )}
                      {milestone.type === 'blast_completed' && (
                        <rect
                          x={mx - 3} y={my - 3} width={6} height={6}
                          fill="white" stroke={barColor} strokeWidth={1.5}
                        />
                      )}
                      {milestone.type === 'report_generated' && (
                        <polygon
                          points={Array.from({ length: 5 }, (_, si) => {
                            const angle = (si * 72 - 90) * Math.PI / 180;
                            const outerR = 4;
                            return `${mx + outerR * Math.cos(angle)},${my + outerR * Math.sin(angle)}`;
                          }).join(' ')}
                          fill="white" stroke={barColor} strokeWidth={1.5}
                        />
                      )}
                    </g>
                  );
                })}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Tooltip */}
      <AnimatePresence>
        {tooltipData && (
          <GanttTooltip
            data={tooltipData.data}
            position={tooltipData.position}
            isDark={isDark}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
