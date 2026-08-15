'use client';

import React, { useMemo } from 'react';
import { useTheme } from 'next-themes';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Calendar, Flame } from 'lucide-react';
import type { LitPaper } from '@/lib/pdb-types';
import { useI18n } from '@/lib/i18n';

interface JournalIfHeatmapProps {
  papers: LitPaper[];
  locale?: 'zh' | 'en';
}

// IF tier buckets (rows)
const IF_TIERS = [
  { min: 40, max: Infinity, label: '≥40', color: '#dc2626', labelZh: '顶级', labelEn: 'Top' },
  { min: 20, max: 40, label: '20-40', color: '#ea580c', labelZh: '高', labelEn: 'High' },
  { min: 10, max: 20, label: '10-20', color: '#f59e0b', labelZh: '中高', labelEn: 'Mid-High' },
  { min: 5, max: 10, label: '5-10', color: '#16a34a', labelZh: '中', labelEn: 'Mid' },
  { min: 0, max: 5, label: '<5', color: '#6b7280', labelZh: '低', labelEn: 'Low' },
  { min: -1, max: -1, label: 'N/A', color: '#9b9590', labelZh: '未知', labelEn: 'Unknown' },
] as const;

function parseDate(pubdate: string): string | null {
  if (!pubdate) return null;
  // Try YYYY-MM-DD or YYYY-MM or YYYY
  const m = pubdate.match(/(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (m) return `${m[1]}-${m[2]}`;
  const y = pubdate.match(/(\d{4})/);
  if (y) return `${y[1]}-01`;
  return null;
}

function getIfTier(ifVal: number | null): typeof IF_TIERS[number] {
  if (ifVal == null || ifVal <= 0) return IF_TIERS[5];
  return IF_TIERS.find(t => ifVal >= t.min && ifVal < t.max) || IF_TIERS[4];
}

export function JournalIfHeatmap({ papers, locale: propLocale }: JournalIfHeatmapProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const { locale: ctxLocale } = useI18n();
  const loc = propLocale === 'zh' ? 'zh' : (ctxLocale || 'en');

  const { matrix, dates, maxCount } = useMemo(() => {
    // Group papers by month + IF tier
    const dateSet = new Set<string>();
    const grid: Record<string, Record<string, LitPaper[]>> = {};

    for (const paper of papers) {
      const month = parseDate(paper.pubdate);
      if (!month) continue;
      dateSet.add(month);
      const tier = getIfTier(paper.IF);
      if (!grid[month]) grid[month] = {};
      if (!grid[month][tier.label]) grid[month][tier.label] = [];
      grid[month][tier.label].push(paper);
    }

    const sortedDates = Array.from(dateSet).sort().slice(-12); // last 12 months
    const maxC = Math.max(
      1,
      ...Object.values(grid).flatMap(monthData => Object.values(monthData).map(arr => arr.length)),
    );

    return { matrix: grid, dates: sortedDates, maxCount: maxC };
  }, [papers]);

  if (dates.length === 0) {
    return (
      <div className="rounded-lg border border-border/40 bg-card/30 p-4 flex items-center gap-3 text-muted-foreground">
        <Calendar className="w-4 h-4 shrink-0" />
        <span className="text-xs">{loc === 'zh' ? '暂无日期数据' : 'No date data available'}</span>
      </div>
    );
  }

  const textColor = isDark ? '#e5e5e5' : '#1f2937';
  const mutedColor = isDark ? '#9b9590' : '#6b7280';
  const borderColor = isDark ? '#3d3832' : '#e5e7eb';
  const cellBg = isDark ? '#242220' : '#fafafa';

  const formatMonth = (m: string) => {
    const [y, mo] = m.split('-');
    const monthNames = loc === 'zh'
      ? ['1月', '2月', '3月', '4月', '5月', '6月', '7月', '8月', '9月', '10月', '11月', '12月']
      : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${monthNames[parseInt(mo) - 1] || mo} ${y.slice(2)}`;
  };

  const totalPapers = papers.length;
  const papersInGrid = Object.values(matrix).flatMap(m => Object.values(m).flat()).length;

  return (
    <div className="rounded-lg border border-border/60 bg-card/50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/40 bg-muted/30">
        <div className="flex items-center gap-2">
          <Flame className="w-4 h-4 text-orange-500 dark:text-orange-400" />
          <span className="text-xs font-semibold text-foreground">
            {loc === 'zh' ? '期刊影响力 × 日期热力图' : 'Journal Impact × Date Heatmap'}
          </span>
        </div>
        <span className="text-[10px] font-mono text-muted-foreground">
          {papersInGrid}/{totalPapers} {loc === 'zh' ? '篇' : 'papers'}
        </span>
      </div>

      {/* Heatmap grid */}
      <div className="p-4 overflow-x-auto">
        <table className="border-collapse" style={{ minWidth: dates.length * 36 + 80 }}>
          <thead>
            <tr>
              <th style={{ width: 70 }} className="text-left pr-2 pb-2">
                <span className="text-[9px] font-medium" style={{ color: mutedColor }}>
                  {loc === 'zh' ? 'IF 区间' : 'IF Tier'}
                </span>
              </th>
              {dates.map(d => (
                <th key={d} className="pb-2 px-0.5 text-center">
                  <span className="text-[8px] font-mono whitespace-nowrap" style={{ color: mutedColor }}>
                    {formatMonth(d)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {IF_TIERS.map(tier => {
              const rowTotal = dates.reduce((s, d) => s + (matrix[d]?.[tier.label]?.length || 0), 0);
              if (rowTotal === 0) return null;
              return (
                <tr key={tier.label}>
                  <td className="pr-2 py-0.5">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="inline-block w-1.5 h-4 rounded-sm shrink-0"
                        style={{ backgroundColor: tier.color }}
                      />
                      <span className="text-[9px] font-medium whitespace-nowrap" style={{ color: textColor }}>
                        {tier.label}
                      </span>
                    </div>
                  </td>
                  {dates.map(d => {
                    const cellPapers = matrix[d]?.[tier.label] || [];
                    const count = cellPapers.length;
                    const intensity = count / maxCount;
                    const bg = count > 0
                      ? `${tier.color}${Math.round(intensity * 255).toString(16).padStart(2, '0')}`
                      : 'transparent';
                    return (
                      <td key={d} className="px-0.5 py-0.5 text-center">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div
                              className="mx-auto flex items-center justify-center rounded transition-all hover:scale-110 cursor-default"
                              style={{
                                width: 30,
                                height: 24,
                                backgroundColor: count > 0 ? bg : cellBg,
                                border: `1px solid ${borderColor}`,
                                opacity: count > 0 ? 0.9 : 0.4,
                              }}
                            >
                              {count > 0 && (
                                <span className="text-[9px] font-bold" style={{ color: '#fff' }}>
                                  {count}
                                </span>
                              )}
                            </div>
                          </TooltipTrigger>
                          {count > 0 && (
                            <TooltipContent side="top" className="text-xs max-w-60">
                              <p className="font-medium">{formatMonth(d)} · IF {tier.label}</p>
                              <p className="text-muted-foreground">{count} {loc === 'zh' ? '篇' : 'papers'}</p>
                              {cellPapers.slice(0, 3).map(p => (
                                <p key={p.pmid} className="text-[9px] text-muted-foreground truncate">
                                  · {p.title?.slice(0, 40)} ({p.journal})
                                </p>
                              ))}
                              {count > 3 && <p className="text-[9px] text-muted-foreground">+{count - 3} more</p>}
                            </TooltipContent>
                          )}
                        </Tooltip>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="px-4 py-2 border-t border-border/30 bg-muted/10 flex items-center justify-between">
        <div className="flex items-center gap-3">
          {IF_TIERS.filter(t => dates.some(d => matrix[d]?.[t.label]?.length)).map(tier => (
            <div key={tier.label} className="flex items-center gap-1">
              <span className="inline-block w-2 h-2 rounded-sm" style={{ backgroundColor: tier.color }} />
              <span className="text-[9px] text-muted-foreground">
                IF {tier.label} ({loc === 'zh' ? tier.labelZh : tier.labelEn})
              </span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] text-muted-foreground">{loc === 'zh' ? '密度' : 'Density'}:</span>
          <span className="inline-block w-3 h-2 rounded-sm" style={{ backgroundColor: cellBg, border: `1px solid ${borderColor}` }} />
          <span className="text-[9px] text-muted-foreground">→</span>
          <span className="inline-block w-3 h-2 rounded-sm" style={{ backgroundColor: '#dc2626' }} />
        </div>
      </div>
    </div>
  );
}
