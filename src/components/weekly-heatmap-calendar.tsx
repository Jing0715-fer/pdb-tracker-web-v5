'use client';

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useTheme } from 'next-themes';
import { CalendarDays, ChevronDown, ChevronRight } from 'lucide-react';
import type { PdbEntry } from '@/lib/pdb-types';

// ─── Types ──────────────────────────────────────────────────────────────────────

interface DailyCount {
  date: string;       // YYYY-MM-DD
  count: number;
}

interface WeeklyHeatmapCalendarProps {
  entries: PdbEntry[];
  onDateSelect?: (date: string | null) => void;
  currentDateFilter?: string | null;
}

// ─── Color Helpers ───────────────────────────────────────────────────────────────

function getHeatColor(count: number, maxCount: number, isDark: boolean): string {
  if (count === 0) return isDark ? '#2b2926' : '#e8e4de';
  const ratio = Math.min(count / Math.max(maxCount, 1), 1);
  if (ratio <= 0.25) return isDark ? 'rgba(45,143,143,0.25)' : '#b2dfdb';
  if (ratio <= 0.5) return isDark ? 'rgba(45,143,143,0.45)' : '#80cbc4';
  if (ratio <= 0.75) return isDark ? 'rgba(45,143,143,0.65)' : '#4db6ac';
  return isDark ? 'rgba(45,143,143,0.9)' : '#2d8f8f';
}

function getHeatLevel(count: number, maxCount: number): number {
  if (count === 0) return 0;
  const ratio = Math.min(count / Math.max(maxCount, 1), 1);
  if (ratio <= 0.25) return 1;
  if (ratio <= 0.5) return 2;
  if (ratio <= 0.75) return 3;
  return 4;
}

// ─── Date Helpers ────────────────────────────────────────────────────────────────

const DAY_LABELS_COMPACT = ['', 'Mon', '', 'Wed', '', 'Fri', ''];
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function dateKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function getWeeksForYear(year: number): Date[][] {
  const weeks: Date[][] = [];
  const startOfYear = new Date(Date.UTC(year, 0, 1));
  const endOfYear = new Date(Date.UTC(year, 11, 31));

  // Find the first Sunday on or before Jan 1
  const firstDay = startOfYear.getUTCDay(); // 0=Sun
  const firstSunday = new Date(startOfYear);
  firstSunday.setUTCDate(startOfYear.getUTCDate() - firstDay);

  let current = new Date(firstSunday);
  while (current <= endOfYear || current.getUTCMonth() === 0) {
    const week: Date[] = [];
    for (let d = 0; d < 7; d++) {
      const day = new Date(current);
      day.setUTCDate(current.getUTCDate() + d);
      week.push(day);
    }
    weeks.push(week);
    current.setUTCDate(current.getUTCDate() + 7);
    if (current.getUTCFullYear() > year + 1) break;
  }

  return weeks;
}

function formatDateNice(dateStr: string): string {
  try {
    const d = new Date(dateStr + 'T00:00:00Z');
    return d.toLocaleDateString('en-US', {
      weekday: 'short',
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
  } catch {
    return dateStr;
  }
}

// ─── Tooltip Component ───────────────────────────────────────────────────────────

interface HeatmapTooltipData {
  date: string;
  count: number;
  x: number;
  y: number;
}

function HeatmapCalendarTooltip({ date, count, x, y }: HeatmapTooltipData) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <div
      className="heatmap-calendar-tooltip fixed z-50 pointer-events-none"
      style={{ left: x + 12, top: y - 56 }}
    >
      <div
        className={`px-3 py-2 rounded-lg text-[10px] shadow-lg border min-w-[150px] ${
          isDark
            ? 'bg-[#242220] border-[#3d3832] text-claude-text-secondary'
            : 'bg-white border-claude-border text-claude-text-secondary'
        }`}
      >
        <div className="font-semibold text-claude-text mb-1">
          {formatDateNice(date)}
        </div>
        <div className="flex items-center gap-1.5">
          <span
            className={`inline-block h-2 w-2 rounded-sm ${
              count > 0 ? 'bg-[#2d8f8f]' : isDark ? 'bg-[#2b2926]' : 'bg-gray-300'
            }`}
          />
          <span className="font-medium">
            {count} structure{count !== 1 ? 's' : ''} released
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────────

export default function WeeklyHeatmapCalendar({
  entries,
  onDateSelect,
  currentDateFilter,
}: WeeklyHeatmapCalendarProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [year, setYear] = useState(new Date().getFullYear());
  const [tooltip, setTooltip] = useState<HeatmapTooltipData | null>(null);
  const [collapsed, setCollapsed] = useState(true); // default collapsed
  const containerRef = useRef<HTMLDivElement>(null);

  // Group entries by releaseDate to get daily counts
  const dailyCounts = useMemo(() => {
    const countMap = new Map<string, number>();
    for (const entry of entries) {
      if (entry.releaseDate) {
        // releaseDate is ISO format, extract YYYY-MM-DD
        const dateStr = entry.releaseDate.slice(0, 10);
        countMap.set(dateStr, (countMap.get(dateStr) || 0) + 1);
      }
    }
    return Array.from(countMap.entries()).map(([date, count]) => ({ date, count }));
  }, [entries]);

  // Build lookup map
  const countMap = useMemo(() => {
    const map = new Map<string, DailyCount>();
    for (const dc of dailyCounts) {
      map.set(dc.date, dc);
    }
    return map;
  }, [dailyCounts]);

  // Compute max count for color scaling
  const maxCount = useMemo(() => {
    let max = 0;
    for (const dc of dailyCounts) {
      if (new Date(dc.date).getFullYear() === year && dc.count > max) {
        max = dc.count;
      }
    }
    return max;
  }, [dailyCounts, year]);

  // Compute available years
  const availableYears = useMemo(() => {
    const years = new Set<number>();
    for (const dc of dailyCounts) {
      const y = new Date(dc.date).getFullYear();
      if (!isNaN(y)) years.add(y);
    }
    if (years.size === 0) years.add(new Date().getFullYear());
    return Array.from(years).sort((a, b) => b - a);
  }, [dailyCounts]);

  // Total structures in year
  const yearTotal = useMemo(() => {
    let total = 0;
    for (const dc of dailyCounts) {
      if (new Date(dc.date).getFullYear() === year) {
        total += dc.count;
      }
    }
    return total;
  }, [dailyCounts, year]);

  // Build weeks grid
  const weeks = useMemo(() => getWeeksForYear(year), [year]);

  // Compute month label positions
  const monthLabelPositions = useMemo(() => {
    const positions: { month: number; weekIdx: number }[] = [];
    let lastMonth = -1;
    weeks.forEach((week, weekIdx) => {
      const dayInYear = week.find((d) => d.getUTCFullYear() === year);
      if (dayInYear) {
        const m = dayInYear.getUTCMonth();
        if (m !== lastMonth) {
          positions.push({ month: m, weekIdx });
          lastMonth = m;
        }
      }
    });
    return positions;
  }, [weeks, year]);

  // Find the "today" date key for highlighting
  const todayKey = useMemo(() => {
    const now = new Date();
    return dateKey(now);
  }, []);

  const handleCellHover = useCallback(
    (dateStr: string, count: number, e: React.MouseEvent) => {
      const rect = (e.target as HTMLElement).getBoundingClientRect();
      setTooltip({
        date: dateStr,
        count,
        x: rect.left + rect.width / 2,
        y: rect.top,
      });
    },
    []
  );

  const handleCellLeave = useCallback(() => {
    setTooltip(null);
  }, []);

  const handleCellClick = useCallback(
    (dateStr: string, count: number) => {
      if (onDateSelect && count > 0) {
        onDateSelect(currentDateFilter === dateStr ? null : dateStr);
      }
    },
    [onDateSelect, currentDateFilter]
  );

  // Click outside to dismiss tooltip
  useEffect(() => {
    if (!tooltip) return;
    const handleDismiss = () => setTooltip(null);
    document.addEventListener('scroll', handleDismiss, true);
    return () => document.removeEventListener('scroll', handleDismiss, true);
  }, [tooltip]);

  const cellSize = 12;
  const cellGap = 3;
  const labelWidth = 30;
  const headerHeight = 18;

  return (
    <div
      ref={containerRef}
      className={`heatmap-calendar-container ${
        isDark ? 'bg-[#1a1917] border-[#3d3832]' : 'bg-white border-claude-border'
      }`}
    >
      {/* Header with collapse toggle */}
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="w-full flex items-center gap-1.5 px-4 py-2 text-[11px] font-medium text-claude-text-muted hover:text-claude-text-secondary transition-colors"
      >
        {collapsed ? (
          <ChevronRight className="h-3 w-3" />
        ) : (
          <ChevronDown className="h-3 w-3" />
        )}
        <CalendarDays className="h-3 w-3" />
        <span className="font-semibold text-claude-text-secondary uppercase tracking-wider text-[10px]">
          Activity Heatmap
        </span>
        <span className="text-[10px] text-claude-text-muted ml-1">
          · {yearTotal} structures in {year}
        </span>
        {currentDateFilter && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium bg-[#2d8f8f]/15 text-[#2d8f8f] ml-1">
            Filtered: {currentDateFilter}
          </span>
        )}
      </button>

      {/* Expandable content */}
      <div
        className="heatmap-calendar-content overflow-hidden transition-all duration-300 ease-in-out"
        style={{
          maxHeight: collapsed ? 0 : 400,
          opacity: collapsed ? 0 : 1,
        }}
      >
        <div className="px-4 pb-4">
          {/* Year selector */}
          <div className="flex items-center gap-1 mb-3">
            {availableYears.map((y) => (
              <button
                key={y}
                onClick={(e) => {
                  e.stopPropagation();
                  setYear(y);
                }}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                  y === year
                    ? 'bg-claude-accent/15 text-claude-accent'
                    : 'text-claude-text-muted hover:text-claude-text-secondary hover:bg-claude-border-light dark:hover:bg-[#2b2926]'
                }`}
              >
                {y}
              </button>
            ))}
          </div>

          {dailyCounts.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <span className="text-[11px] text-claude-text-muted">
                No release date data available
              </span>
            </div>
          ) : (
            <>
              {/* Heatmap Grid - horizontally scrollable */}
              <div className="overflow-x-auto custom-scrollbar pb-1">
                <div style={{ position: 'relative' }}>
                  {/* Month labels */}
                  <div
                    style={{
                      paddingLeft: labelWidth,
                      height: headerHeight,
                      position: 'relative',
                    }}
                  >
                    {monthLabelPositions.map(({ month, weekIdx }) => (
                      <span
                        key={`${month}-${weekIdx}`}
                        className="text-[9px] text-claude-text-muted absolute top-0"
                        style={{ left: weekIdx * (cellSize + cellGap) }}
                      >
                        {MONTH_LABELS[month]}
                      </span>
                    ))}
                  </div>

                  {/* Grid with day labels */}
                  <div className="flex">
                    {/* Day-of-week labels: Mon, Wed, Fri only */}
                    <div style={{ width: labelWidth, flexShrink: 0 }}>
                      {[0, 1, 2, 3, 4, 5, 6].map((dayIdx) => (
                        <div
                          key={dayIdx}
                          style={{
                            height: cellSize + cellGap,
                            lineHeight: `${cellSize}px`,
                          }}
                          className="text-[9px] text-claude-text-muted text-right pr-2"
                        >
                          {DAY_LABELS_COMPACT[dayIdx]}
                        </div>
                      ))}
                    </div>

                    {/* Cells grid */}
                    <div className="flex">
                      {weeks.map((week, weekIdx) => (
                        <div
                          key={weekIdx}
                          className="flex flex-col heatmap-calendar-week"
                          style={{ gap: cellGap }}
                        >
                          {week.map((day, dayIdx) => {
                            const key = dateKey(day);
                            const dayData = countMap.get(key);
                            const count = dayData?.count || 0;
                            const isInYear = day.getUTCFullYear() === year;
                            const isToday = key === todayKey && isInYear;
                            const isDateFiltered =
                              currentDateFilter === key && isInYear;
                            const level = isInYear
                              ? getHeatLevel(count, maxCount)
                              : 0;
                            const bgColor = isInYear
                              ? getHeatColor(count, maxCount, isDark)
                              : 'transparent';

                            return (
                              <div
                                key={dayIdx}
                                className={`heatmap-calendar-cell heatmap-cell-hover rounded-[2px] ${
                                  isInYear
                                    ? 'cursor-pointer'
                                    : 'cursor-default'
                                } ${
                                  isToday
                                    ? 'ring-1 ring-claude-accent/60'
                                    : ''
                                } ${
                                  isDateFiltered
                                    ? 'ring-2 ring-[#2d8f8f] scale-110 z-10 relative'
                                    : ''
                                } heatmap-level-${level}`}
                                style={{
                                  width: cellSize,
                                  height: cellSize,
                                  backgroundColor: bgColor,
                                  transition:
                                    'transform 100ms ease, box-shadow 100ms ease, background-color 200ms ease',
                                  ...(isInYear
                                    ? {}
                                    : { backgroundColor: 'transparent' }),
                                }}
                                onMouseEnter={
                                  isInYear
                                    ? (e) => handleCellHover(key, count, e)
                                    : undefined
                                }
                                onMouseLeave={
                                  isInYear ? handleCellLeave : undefined
                                }
                                onClick={
                                  isInYear
                                    ? () => handleCellClick(key, count)
                                    : undefined
                                }
                                role={isInYear ? 'button' : undefined}
                                tabIndex={isInYear ? 0 : undefined}
                                aria-label={
                                  isInYear
                                    ? `${formatDateNice(key)}: ${count} structure${count !== 1 ? 's' : ''}`
                                    : undefined
                                }
                                onKeyDown={
                                  isInYear
                                    ? (e) => {
                                        if (
                                          e.key === 'Enter' ||
                                          e.key === ' '
                                        ) {
                                          e.preventDefault();
                                          handleCellClick(key, count);
                                        }
                                      }
                                    : undefined
                                }
                              />
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {/* Legend */}
              <div className="flex items-center justify-between mt-3 pt-2 border-t border-claude-border/50 dark:border-[#3d3832]/50">
                <span className="text-[9px] text-claude-text-muted">Less</span>
                <div className="flex items-center gap-1">
                  <div
                    className={`h-3 w-3 rounded-[2px] ${
                      isDark ? 'bg-[#2b2926]' : 'bg-[#e8e4de]'
                    }`}
                    title="0 structures"
                  />
                  <div
                    className="h-3 w-3 rounded-[2px]"
                    style={{
                      backgroundColor: isDark
                        ? 'rgba(45,143,143,0.25)'
                        : '#b2dfdb',
                    }}
                    title="Low"
                  />
                  <div
                    className="h-3 w-3 rounded-[2px]"
                    style={{
                      backgroundColor: isDark
                        ? 'rgba(45,143,143,0.45)'
                        : '#80cbc4',
                    }}
                    title="Medium"
                  />
                  <div
                    className="h-3 w-3 rounded-[2px]"
                    style={{
                      backgroundColor: isDark
                        ? 'rgba(45,143,143,0.65)'
                        : '#4db6ac',
                    }}
                    title="High"
                  />
                  <div
                    className="h-3 w-3 rounded-[2px]"
                    style={{
                      backgroundColor: isDark
                        ? 'rgba(45,143,143,0.9)'
                        : '#2d8f8f',
                    }}
                    title="Very high"
                  />
                </div>
                <span className="text-[9px] text-claude-text-muted">More</span>
                <span className="text-[9px] text-claude-text-muted ml-2">
                  · Click a day to filter
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Tooltip */}
      {tooltip && (
        <HeatmapCalendarTooltip
          date={tooltip.date}
          count={tooltip.count}
          x={tooltip.x}
          y={tooltip.y}
        />
      )}
    </div>
  );
}
