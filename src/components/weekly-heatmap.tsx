'use client';

import React, { useState, useEffect, useMemo, useCallback, useSyncExternalStore } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTheme } from 'next-themes';
import { formatDate } from '@/components/pdb-helpers';
import { X } from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────────────────

interface DailyCount {
  date: string;
  count: number;
  cryoemCount: number;
  xrayCount: number;
  nmrCount: number;
}

interface WeeklyHeatmapProps {
  selectedSnapshot?: string | null;
  onDateSelect?: (date: string | null) => void;
  currentDateFilter?: string | null;
}

// ─── Color Helpers ───────────────────────────────────────────────────────────────

function getHeatColorStyle(count: number, isDark: boolean): string {
  if (count === 0) return isDark ? '#2b2926' : '#ede9e3';
  if (count <= 2) return isDark ? 'rgba(20,184,166,0.35)' : '#99f6e4';
  if (count <= 5) return isDark ? 'rgba(20,184,166,0.6)' : '#2dd4bf';
  return isDark ? 'rgba(45,143,143,0.85)' : '#2d8f8f';
}

function getHeatGlow(count: number): string {
  if (count < 6) return 'none';
  return '0 0 4px rgba(45,143,143,0.5)';
}

// ─── Day/Week Helpers ────────────────────────────────────────────────────────────

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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
    // Stop after we've gone well past the year
    if (current.getUTCFullYear() > year + 1) break;
  }

  return weeks;
}

function dateKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
}

function getCurrentWeekId(): string {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const diff = now.getTime() - start.getTime();
  const oneWeek = 604800000;
  const weekNum = Math.ceil((diff / oneWeek) + start.getDay() / 7);
  return `${now.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

// ─── Tooltip Component ───────────────────────────────────────────────────────────

interface HeatmapTooltipProps {
  date: string;
  count: number;
  cryoemCount: number;
  xrayCount: number;
  nmrCount: number;
  x: number;
  y: number;
}

function HeatmapTooltip({ date, count, cryoemCount, xrayCount, nmrCount, x, y }: HeatmapTooltipProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.12 }}
      className="fixed z-50 pointer-events-none"
      style={{ left: x + 12, top: y - 60 }}
    >
      <div className={`px-3 py-2 rounded-lg text-[10px] shadow-lg border min-w-[140px] ${
        isDark ? 'bg-[#242220] border-[#3d3832] text-claude-text-secondary' : 'bg-white border-claude-border text-claude-text-secondary'
      }`}>
        <div className="font-semibold text-claude-text mb-1">{formatDate(date)}</div>
        <div className="flex items-center gap-1.5 mb-1">
          <span className={`inline-block h-2 w-2 rounded-sm ${count > 0 ? 'bg-[#2d8f8f]' : 'bg-gray-300 dark:bg-[#2b2926]'}`} />
          <span className="font-medium">{count} structure{count !== 1 ? 's' : ''}</span>
        </div>
        {count > 0 && (
          <div className="space-y-0.5 pl-0.5">
            {cryoemCount > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#2d8f8f]" />
                <span>{cryoemCount} Cryo-EM</span>
              </div>
            )}
            {xrayCount > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#7c5cbf]" />
                <span>{xrayCount} X-ray</span>
              </div>
            )}
            {nmrCount > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-[#c9872e]" />
                <span>{nmrCount} NMR</span>
              </div>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────────

export function WeeklyHeatmap({ selectedSnapshot, onDateSelect, currentDateFilter }: WeeklyHeatmapProps) {
  const { theme } = useTheme();
  const isDark = theme === 'dark';
  const [dailyCounts, setDailyCounts] = useState<DailyCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [tooltip, setTooltip] = useState<HeatmapTooltipProps | null>(null);
  const [year, setYear] = useState(new Date().getFullYear());
  // Only render on client to avoid SSR/CSR hydration mismatch (e.g. with next-themes).
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );
  const [animatedIn, setAnimatedIn] = useState(false);

  // Fade-in animation on first render
  useEffect(() => {
    if (!loading && !animatedIn) {
      const timer = setTimeout(() => setAnimatedIn(true), 50);
      return () => clearTimeout(timer);
    }
  }, [loading, animatedIn]);

  // Fetch daily stats
  useEffect(() => {
    async function fetchDaily() {
      setLoading(true);
      try {
        const res = await fetch('/api/stats/daily');
        if (res.ok) {
          const data = await res.json();
          setDailyCounts(data);
        }
      } catch (err) {
        console.error('Failed to fetch daily stats:', err);
      } finally {
        setLoading(false);
      }
    }
    fetchDaily();
  }, []);

  // Build lookup map
  const countMap = useMemo(() => {
    const map = new Map<string, DailyCount>();
    for (const dc of dailyCounts) {
      map.set(dc.date, dc);
    }
    return map;
  }, [dailyCounts]);

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

  // Get current week for highlighting
  const currentWeekId = useMemo(() => getCurrentWeekId(), []);

  // Build weeks grid
  const weeks = useMemo(() => getWeeksForYear(year), [year]);

  // Compute month labels positions
  const monthLabelPositions = useMemo(() => {
    const positions: { month: number; weekIdx: number }[] = [];
    let lastMonth = -1;
    weeks.forEach((week, weekIdx) => {
      // Find the first day in this week that belongs to the target year
      const dayInYear = week.find(d => d.getUTCFullYear() === year);
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

  const handleCellHover = useCallback((dayData: DailyCount, e: React.MouseEvent) => {
    const rect = (e.target as HTMLElement).getBoundingClientRect();
    setTooltip({
      date: dayData.date,
      count: dayData.count,
      cryoemCount: dayData.cryoemCount,
      xrayCount: dayData.xrayCount,
      nmrCount: dayData.nmrCount,
      x: rect.left + rect.width / 2,
      y: rect.top,
    });
  }, []);

  const handleCellLeave = useCallback(() => {
    setTooltip(null);
  }, []);

  const handleCellClick = useCallback((date: string) => {
    if (onDateSelect) {
      onDateSelect(currentDateFilter === date ? null : date);
    }
  }, [onDateSelect, currentDateFilter]);

  if (!mounted) return null;

  const cellSize = 13;
  const cellGap = 3;
  const labelWidth = 32;
  const headerHeight = 22;

  return (
    <motion.div
      initial={{ opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      transition={{ duration: 0.3 }}
      className="px-4 pb-3"
    >
      <div className={`rounded-xl border p-4 ${isDark ? 'bg-[#1a1917] border-[#3d3832]' : 'bg-white border-claude-border'}`}>
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <h4 className="text-xs font-semibold text-claude-text-secondary uppercase tracking-wider">
              Publication Heatmap
            </h4>
            <span className="text-[10px] text-claude-text-muted">
              {yearTotal} structures in {year}
            </span>
            {currentDateFilter && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium bg-[#2d8f8f]/15 text-[#2d8f8f]">
                Filtered: {formatDate(currentDateFilter)}
                <button
                  onClick={() => onDateSelect?.(null)}
                  className="hover:text-claude-accent ml-0.5"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {availableYears.map(y => (
              <button
                key={y}
                onClick={() => setYear(y)}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                  y === year
                    ? 'bg-claude-accent/15 text-claude-accent dark:text-claude-accent-hover'
                    : 'text-claude-text-muted hover:text-claude-text-secondary hover:bg-claude-border-light dark:hover:bg-[#2b2926]'
                }`}
              >
                {y}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8">
            <div className="flex items-center gap-2 text-xs text-claude-text-muted">
              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-claude-accent/30 border-t-claude-accent" />
              Loading heatmap...
            </div>
          </div>
        ) : (
          <>
            {/* Heatmap Grid - horizontally scrollable on mobile */}
            <div className="overflow-x-auto custom-scrollbar pb-1">
              <div style={{ position: 'relative' }} className={`transition-opacity duration-500 ${animatedIn ? 'opacity-100' : 'opacity-0'}`}>
                {/* Month labels */}
                <div style={{ paddingLeft: labelWidth, height: headerHeight, position: 'relative' }}>
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
                  {/* Day-of-week labels - show all days */}
                  <div style={{ width: labelWidth, flexShrink: 0 }}>
                    {[0, 1, 2, 3, 4, 5, 6].map(dayIdx => (
                      <div
                        key={dayIdx}
                        style={{ height: cellSize + cellGap, lineHeight: `${cellSize}px` }}
                        className="text-[9px] text-claude-text-muted text-right pr-2"
                      >
                        {DAY_LABELS[dayIdx]}
                      </div>
                    ))}
                  </div>

                  {/* Cells grid */}
                  <div className="flex">
                    {weeks.map((week, weekIdx) => (
                      <div key={weekIdx} className="flex flex-col" style={{ gap: cellGap }}>
                        {week.map((day, dayIdx) => {
                          const key = dateKey(day);
                          const dayData = countMap.get(key);
                          const count = dayData?.count || 0;
                          const isInYear = day.getUTCFullYear() === year;
                          const isCurrentWeek = selectedSnapshot === currentWeekId && isInYear;
                          const isDateFiltered = currentDateFilter === key && isInYear;
                          const bgColor = isInYear ? getHeatColorStyle(count, isDark) : 'transparent';
                          const glowStyle = count >= 6 && isInYear ? getHeatGlow(count) : 'none';

                          return (
                            <div
                              key={dayIdx}
                              className={`rounded-[3px] transition-all duration-150 ${
                                isInYear ? 'cursor-pointer hover:ring-1 hover:ring-[#2d8f8f]/40' : 'cursor-default'
                              } ${
                                isCurrentWeek ? 'ring-1 ring-claude-accent/50' : ''
                              } ${
                                isDateFiltered ? 'ring-2 ring-[#2d8f8f] scale-110' : ''
                              }`}
                              style={{
                                width: cellSize,
                                height: cellSize,
                                backgroundColor: bgColor,
                                boxShadow: glowStyle,
                                ...(isInYear ? {} : { backgroundColor: 'transparent' }),
                              }}
                              onMouseEnter={isInYear ? (e) => {
                                handleCellHover(dayData || { date: key, count: 0, cryoemCount: 0, xrayCount: 0, nmrCount: 0 }, e);
                              } : undefined}
                              onMouseLeave={isInYear ? handleCellLeave : undefined}
                              onClick={isInYear && count > 0 ? () => handleCellClick(key) : undefined}
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
                <div className={`h-3 w-3 rounded-[2px] ${isDark ? 'bg-[#2b2926]' : 'bg-claude-border-light'}`} title="0 structures" />
                <div className="h-3 w-3 rounded-[2px]" style={{ backgroundColor: isDark ? 'rgba(20,184,166,0.35)' : '#99f6e4' }} title="1-2 structures" />
                <div className="h-3 w-3 rounded-[2px]" style={{ backgroundColor: isDark ? 'rgba(20,184,166,0.6)' : '#2dd4bf' }} title="3-5 structures" />
                <div className="h-3 w-3 rounded-[2px]" style={{ backgroundColor: isDark ? 'rgba(45,143,143,0.85)' : '#2d8f8f', boxShadow: '0 0 4px rgba(45,143,143,0.5)' }} title="6+ structures" />
              </div>
              <span className="text-[9px] text-claude-text-muted">More</span>
              <span className="text-[9px] text-claude-text-muted ml-2">• Click a day to filter</span>
            </div>
          </>
        )}
      </div>

      {/* Tooltip */}
      <AnimatePresence>
        {tooltip && (
          <HeatmapTooltip
            date={tooltip.date}
            count={tooltip.count}
            cryoemCount={tooltip.cryoemCount}
            xrayCount={tooltip.xrayCount}
            nmrCount={tooltip.nmrCount}
            x={tooltip.x}
            y={tooltip.y}
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
