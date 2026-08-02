'use client';

import React, { useState, useMemo } from 'react';
import { Calendar } from '@/components/ui/calendar';
import { cn } from '@/lib/utils';
import type { LitPaper, LitReport } from '@/lib/pdb-types';
import { useI18n } from '@/lib/i18n';

interface LiteratureDateSidebarProps {
  reports?: LitReport[];
  allPapers: LitPaper[];
  selectedDate: string | null;
  onSelectDate: (date: string) => void | Promise<void>;
  isLoading: boolean;
  inline?: boolean;
  // When provided (and non-empty), the sidebar shows filtered counts instead of all counts
  filteredPapers?: LitPaper[];
  onClearFilter?: () => void;
}

type ViewLevel = 'years' | 'months' | 'days';

export function LiteratureDateSidebar({
  allPapers,
  selectedDate,
  onSelectDate,
  isLoading,
  inline = false,
  filteredPapers,
  onClearFilter,
}: LiteratureDateSidebarProps) {
  const { locale } = useI18n();
  // ── Data source: use filteredPapers when available, else allPapers ───
  const dataSource = filteredPapers !== undefined ? filteredPapers : allPapers;
  const isFiltered = filteredPapers !== undefined && filteredPapers.length !== allPapers.length;

  // ── Derive date ranges from data ──────────────────────────────────────
  const allYears = useMemo(() => {
    const m = new Map<string, number>();
    dataSource.forEach(p => {
      if (!p.pubdate) return;
      m.set(p.pubdate.slice(0, 4), (m.get(p.pubdate.slice(0, 4)) ?? 0) + 1);
    });
    return m;
  }, [dataSource]);

  const allMonths = useMemo(() => {
    const m = new Map<string, number>();
    dataSource.forEach(p => {
      if (!p.pubdate || p.pubdate.length < 7) return;
      m.set(p.pubdate.slice(0, 7), (m.get(p.pubdate.slice(0, 7)) ?? 0) + 1);
    });
    return m;
  }, [dataSource]);

  const allDays = useMemo(() => {
    const m = new Map<string, number>();
    dataSource.forEach(p => {
      if (!p.pubdate || p.pubdate.length < 10) return;
      m.set(p.pubdate.slice(0, 10), (m.get(p.pubdate.slice(0, 10)) ?? 0) + 1);
    });
    return m;
  }, [dataSource]);

  // ── Navigation state ─────────────────────────────────────────────────
  // viewYear / viewMonth: which year/month is currently shown in month/day view
  const [viewYear, setViewYear] = useState(() => {
    // Default to the latest year that has papers
    const years = Array.from(allYears.keys()).sort((a, b) => b.localeCompare(a));
    return parseInt(years[0] || new Date().getFullYear().toString());
  });

  const [viewMonth, setViewMonth] = useState(() => new Date().getMonth() + 1);

  // Current view level
  const [level, setLevel] = useState<ViewLevel>(() => {
    if (!selectedDate) return 'months';
    if (selectedDate.length === 4) return 'days';
    if (selectedDate.length === 7) return 'days';
    return 'days';
  });

  // ── Derived data for current view ────────────────────────────────────

  // Year view: list all years (sorted desc)
  const yearEntries = useMemo(() => {
    return Array.from(allYears.entries())
      .map(([year, count]) => ({ key: year, count }))
      .sort((a, b) => b.key.localeCompare(a.key));
  }, [allYears]);

  // Month view: 12 months of viewYear
  const monthEntries = useMemo(() => {
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return Array.from({ length: 12 }, (_, i) => {
      const m = String(i + 1).padStart(2, '0');
      const key = `${viewYear}-${m}`;
      return { key, label: names[i], count: allMonths.get(key) ?? 0 };
    });
  }, [viewYear, allMonths]);

  // Day view: calendar cells for viewYear-viewMonth
  const dayCells = useMemo(() => {
    const y = viewYear.toString();
    const m = String(viewMonth).padStart(2, '0');
    const firstDay = new Date(viewYear, viewMonth - 1, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth, 0).getDate();
    return { y, m, firstDay, daysInMonth };
  }, [viewYear, viewMonth]);

  // ── Navigation ────────────────────────────────────────────────────────

  const navigateToYear = (year: string) => {
    setViewYear(parseInt(year));
    setViewMonth(1);
    setLevel('months');
  };

  const navigateToMonth = (monthKey: string) => {
    // monthKey = "YYYY-MM"
    const parts = monthKey.split('-');
    setViewYear(parseInt(parts[0]));
    setViewMonth(parseInt(parts[1]));
    setLevel('days');
  };

  const navigateToDay = (dayKey: string) => {
    onSelectDate(dayKey);
    setLevel('days');
  };

  const goBack = () => {
    if (level === 'days') setLevel('months');
    else if (level === 'months') setLevel('years');
  };

  // ── Helpers ───────────────────────────────────────────────────────────
  const monthName = (m: number) =>
    ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1] || '';

  const isToday = (y: number, m: number, d: number) => {
    const t = new Date();
    return t.getFullYear() === y && t.getMonth() + 1 === m && t.getDate() === d;
  };

  return (
    <div className={cn(
      'flex-shrink-0 bg-claude-surface dark:bg-[#242220] flex flex-col',
      inline ? 'w-full' : 'w-full xl:w-[260px] border-r border-claude-border dark:border-[#3d3832]'
    )}>
      {/* Fixed Header */}
      <div className="px-3 py-3 border-b border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220]">
        <div className="text-xs font-semibold text-claude-text-secondary uppercase tracking-wider mb-2">
          {locale === 'zh' ? '按日期浏览论文' : 'Papers by Date'}
        </div>
        {/* Filter status indicator */}
        <div className="flex items-center gap-1 mb-1.5 px-2 py-1 rounded-md bg-claude-accent/10 border border-claude-accent/20">
          <span className="text-[10px] text-claude-accent font-medium">
            {isFiltered
              ? (locale === 'zh' ? `已筛选: ${dataSource.length} / ${allPapers.length}` : `Filtered: ${dataSource.length} / ${allPapers.length}`)
              : (locale === 'zh' ? `全部: ${allPapers.length}` : `All: ${allPapers.length}`)}
          </span>
          {onClearFilter && (
            <button
              onClick={onClearFilter}
              className="ml-auto text-claude-accent hover:text-claude-accent-hover text-[10px] shrink-0"
            >
              ✕
            </button>
          )}
        </div>
        {/* Breadcrumb / back */}
        <div className="flex items-center gap-1.5 text-xs text-claude-text-muted">
          <button
            onClick={() => setLevel('years')}
            className={cn(
              'px-2 py-1 rounded-md transition-colors font-semibold',
              level === 'years' ? 'text-claude-accent' : 'hover:text-claude-text hover:bg-claude-border-light dark:hover:bg-[#2b2926]'
            )}
          >
            {locale === 'zh' ? '所有年份' : 'All years'}
          </button>
          {level !== 'years' && (
            <>
              <span className="text-claude-text-muted/40">›</span>
              <button
                onClick={() => setLevel('months')}
                className={cn(
                  'px-2 py-1 rounded-md transition-colors font-semibold',
                  level === 'months' ? 'text-claude-accent' : 'hover:text-claude-text hover:bg-claude-border-light dark:hover:bg-[#2b2926]'
                )}
              >
                {viewYear}
              </button>
            </>
          )}
          {level === 'days' && (
            <>
              <span className="text-claude-text-muted/40">›</span>
              <span className="px-2 py-1 text-claude-accent font-semibold">{viewMonth}</span>
            </>
          )}
        </div>
      </div>

      {/* Nav bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-claude-border/50">
        {level === 'years' && (
          <span className="text-sm font-bold text-claude-text">Select year</span>
        )}
        {level === 'months' && (
          <>
            <button
              onClick={() => setViewYear(y => y - 1)}
              className="text-claude-text-muted hover:text-claude-text text-sm px-1.5 py-0.5 rounded hover:bg-claude-border-light"
            >‹</button>
            <span className="text-sm font-bold text-claude-text">{viewYear}</span>
            <button
              onClick={() => setViewYear(y => y + 1)}
              className="text-claude-text-muted hover:text-claude-text text-sm px-1.5 py-0.5 rounded hover:bg-claude-border-light"
            >›</button>
          </>
        )}
        {level === 'days' && (
          <>
            <button
              onClick={() => { if (viewMonth === 1) { setViewYear(y => y - 1); setViewMonth(12); } else setViewMonth(m => m - 1); }}
              className="text-claude-text-muted hover:text-claude-text text-sm px-1.5 py-0.5 rounded hover:bg-claude-border-light"
            >‹</button>
            <span className="text-sm font-bold text-claude-text">{viewYear} {monthName(viewMonth)}</span>
            <button
              onClick={() => { if (viewMonth === 12) { setViewYear(y => y + 1); setViewMonth(1); } else setViewMonth(m => m + 1); }}
              className="text-claude-text-muted hover:text-claude-text text-sm px-1.5 py-0.5 rounded hover:bg-claude-border-light"
            >›</button>
          </>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto sidebar-scroll">

        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-6 h-6 border-2 border-claude-accent border-t-transparent rounded-full animate-spin" />
          </div>
        ) : level === 'years' ? (
          /* ── Year grid (3×4) ── */
          <div className="p-2">
            <div className="grid grid-cols-3 gap-1.5">
              {yearEntries.map(({ key, count }) => (
                <button
                  key={key}
                  onClick={() => navigateToYear(key)}
                  className="flex flex-col items-center justify-center rounded-xl py-3 px-1 hover:bg-claude-accent/10 transition-all duration-150 border border-transparent hover:border-claude-accent/20"
                >
                  <span className="text-sm font-bold text-claude-text">{key}</span>
                  <span className="text-[10px] text-claude-accent font-semibold mt-0.5">{count} papers</span>
                </button>
              ))}
            </div>
          </div>
        ) : level === 'months' ? (
          /* ── Month grid (3×4) ── */
          <div className="p-2">
            <div className="grid grid-cols-3 gap-1.5">
              {monthEntries.map(({ key, label, count }) => (
                <button
                  key={key}
                  onClick={() => count > 0 && navigateToMonth(key)}
                  className={cn(
                    'flex flex-col items-center justify-center rounded-xl py-3 transition-all duration-150 border',
                    count > 0
                      ? 'hover:bg-claude-accent/10 hover:border-claude-accent/20 cursor-pointer'
                      : 'opacity-30 cursor-default border-transparent',
                    selectedDate === key
                      ? 'bg-claude-accent/15 border-claude-accent/40'
                      : 'border-transparent'
                  )}
                >
                  <span className={cn('text-sm font-bold', count > 0 ? 'text-claude-text' : 'text-claude-text-muted')}>{label}</span>
                  <span className={cn(
                    'text-[10px] font-semibold mt-0.5',
                    selectedDate === key ? 'text-claude-accent' : count > 0 ? 'text-claude-accent/70' : 'text-claude-text-muted/50'
                  )}>
                    {count > 0 ? `${count} papers` : ''}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          /* ── Day calendar (7-col grid) ── */
          <div className="p-2">
            {/* Day headers */}
            <div className="grid grid-cols-7 gap-0.5 mb-1">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                <div key={d} className="text-center text-[9px] text-claude-text-muted font-medium py-1">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-0.5">
              {/* Empty cells before first day */}
              {Array.from({ length: dayCells.firstDay }).map((_, i) => (
                <div key={`e-${i}`} className="h-9" />
              ))}
              {/* Day cells */}
              {Array.from({ length: dayCells.daysInMonth }).map((_, i) => {
                const d = i + 1;
                const dd = String(d).padStart(2, '0');
                const key = `${dayCells.y}-${dayCells.m}-${dd}`;
                const count = allDays.get(key) ?? 0;
                const active = selectedDate === key;
                const today = isToday(viewYear, viewMonth, d);

                return (
                  <button
                    key={key}
                    onClick={() => count > 0 && navigateToDay(key)}
                    className={cn(
                      'relative flex flex-col items-center justify-center rounded-lg h-9 transition-all duration-150',
                      count > 0
                        ? 'hover:bg-claude-accent/10 cursor-pointer'
                        : 'opacity-25 cursor-default',
                      active
                        ? 'bg-claude-accent/20 ring-1 ring-claude-accent/50'
                        : today
                        ? 'ring-1 ring-claude-accent/50'
                        : ''
                    )}
                  >
                    <span className={cn(
                      'text-[11px] font-medium',
                      active
                        ? 'text-claude-accent font-bold'
                        : count > 0
                        ? 'text-claude-text'
                        : 'text-claude-text-muted',
                      today && !active ? 'text-claude-accent font-bold' : ''
                    )}>
                      {d}
                    </span>
                    {count > 0 && (
                      <span className={cn(
                        'absolute bottom-0.5 text-[8px] font-bold',
                        active ? 'text-claude-accent' : 'text-claude-accent/70'
                      )}>
                        {count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Active filter chip */}
      {selectedDate && (
        <div className="px-3 py-2 border-t border-claude-border dark:border-[#3d3832]">
          <button
            onClick={() => onSelectDate('')}
            className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-claude-accent/10 hover:bg-claude-accent/20 transition-colors text-[11px] text-claude-accent group"
          >
            <span className="font-semibold truncate mr-1">{selectedDate}</span>
            <span className="flex-shrink-0 opacity-60 group-hover:opacity-100">×</span>
          </button>
        </div>
      )}
    </div>
  );
}