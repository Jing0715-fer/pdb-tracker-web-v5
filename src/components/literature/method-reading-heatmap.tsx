'use client';

import React, { useMemo } from 'react';
import { useTheme } from 'next-themes';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { BookOpen, Grid3x3 } from 'lucide-react';
import type { LitPaper } from '@/lib/pdb-types';
import type { ReadingProgressMap } from '@/hooks/use-reading-progress';
import { useI18n } from '@/lib/i18n';

interface MethodReadingHeatmapProps {
  papers: LitPaper[];
  progressMap: ReadingProgressMap;
  locale?: 'zh' | 'en';
}

const METHODS = ['Cryo-EM', 'X-ray', 'NMR', 'AlphaFold'] as const;
type Method = (typeof METHODS)[number];

const STATES = [
  { key: 'unread', labelZh: '未读', labelEn: 'Unread', color: '#94a3b8', threshold: [0, 0] },
  { key: 'reading', labelZh: '阅读中', labelEn: 'Reading', color: '#f59e0b', threshold: [1, 99] },
  { key: 'read', labelZh: '已读', labelEn: 'Read', color: '#10b981', threshold: [100, 100] },
] as const;

function classifyPaper(paper: LitPaper): Method | 'Other' {
  const text = `${paper.title || ''} ${paper.abstract || ''}`.toLowerCase();
  if (/\b(cryo-?em|cryo-?electron|electron microscopy|single[- ]particle)\b/i.test(text)) return 'Cryo-EM';
  if (/\b(x[- ]ray|crystallograph|crystal structure|diffraction)\b/i.test(text)) return 'X-ray';
  if (/\b(nmr|nuclear magnetic resonance)\b/i.test(text)) return 'NMR';
  if (/\b(alphafold|esmfold|rosettafold|protein structure prediction)\b/i.test(text)) return 'AlphaFold';
  return 'Other';
}

function getProgressState(progress: number): typeof STATES[number] {
  if (progress >= 100) return STATES[2];
  if (progress > 0) return STATES[1];
  return STATES[0];
}

export function MethodReadingHeatmap({ papers, progressMap, locale = 'zh' }: MethodReadingHeatmapProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === 'dark';
  const { locale: ctxLocale } = useI18n();
  const loc = locale === 'zh' ? 'zh' : (ctxLocale || 'en');

  const matrix = useMemo(() => {
    const grid: Record<string, Record<string, number>> = {};
    for (const m of [...METHODS, 'Other']) {
      grid[m] = { unread: 0, reading: 0, read: 0, total: 0 };
    }
    for (const paper of papers) {
      const method = classifyPaper(paper);
      const progress = progressMap[paper.pmid] ?? 0;
      const state = getProgressState(progress);
      grid[method][state.key]++;
      grid[method].total++;
    }
    return grid;
  }, [papers, progressMap]);

  const maxCount = Math.max(
    1,
    ...Object.values(matrix).flatMap((row) => [row.unread, row.reading, row.read]),
  );

  const textColor = isDark ? '#e5e5e5' : '#1f2937';
  const mutedColor = isDark ? '#9b9590' : '#6b7280';
  const borderColor = isDark ? '#3d3832' : '#e5e7eb';
  const cellBg = isDark ? '#242220' : '#fafafa';

  const totalPapers = papers.length;
  const totalRead = Object.values(matrix).reduce((s, r) => s + r.read, 0);
  const totalReading = Object.values(matrix).reduce((s, r) => s + r.reading, 0);

  if (totalPapers === 0) {
    return (
      <div className="rounded-lg border border-border/40 bg-card/30 p-4 flex items-center gap-3 text-muted-foreground">
        <Grid3x3 className="w-4 h-4 shrink-0" />
        <span className="text-xs">
          {loc === 'zh' ? '暂无论文数据' : 'No paper data available'}
        </span>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border/60 bg-card/50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/40 bg-muted/30">
        <div className="flex items-center gap-2">
          <Grid3x3 className="w-4 h-4 text-indigo-500 dark:text-indigo-400" />
          <span className="text-xs font-semibold text-foreground">
            {loc === 'zh' ? '方法 × 阅读状态热力图' : 'Method × Reading Status Heatmap'}
          </span>
        </div>
        <span className="text-[10px] font-mono text-muted-foreground">
          {totalRead + totalReading}/{totalPapers} {loc === 'zh' ? '已处理' : 'processed'}
        </span>
      </div>

      {/* Heatmap grid */}
      <div className="p-4 overflow-x-auto">
        <table className="w-full border-collapse" style={{ minWidth: 320 }}>
          <thead>
            <tr>
              <th style={{ width: 90 }}></th>
              {STATES.map((s) => (
                <th key={s.key} className="text-center pb-2 px-1">
                  <div className="flex flex-col items-center gap-0.5">
                    <span
                      className="inline-block w-2 h-2 rounded-sm"
                      style={{ backgroundColor: s.color }}
                    />
                    <span className="text-[9px] font-medium" style={{ color: mutedColor }}>
                      {loc === 'zh' ? s.labelZh : s.labelEn}
                    </span>
                  </div>
                </th>
              ))}
              <th className="text-center pb-2 px-1">
                <span className="text-[9px] font-medium" style={{ color: mutedColor }}>
                  {loc === 'zh' ? '合计' : 'Total'}
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {[...METHODS, 'Other'].filter((m) => matrix[m].total > 0).map((method) => {
              const row = matrix[method];
              const methodColor =
                method === 'Cryo-EM' ? '#2d8f8f' :
                method === 'X-ray' ? '#7c5cbf' :
                method === 'NMR' ? '#c9872e' :
                method === 'AlphaFold' ? '#3b82f6' : '#94a3b8';
              return (
                <tr key={method}>
                  <td className="pr-2 py-1">
                    <div className="flex items-center gap-1.5">
                      <span
                        className="inline-block w-1.5 h-4 rounded-sm"
                        style={{ backgroundColor: methodColor }}
                      />
                      <span className="text-[10px] font-medium" style={{ color: textColor }}>
                        {method}
                      </span>
                    </div>
                  </td>
                  {STATES.map((s) => {
                    const count = row[s.key];
                    const intensity = count / maxCount;
                    const bg = count > 0
                      ? `${s.color}${Math.round(intensity * 255).toString(16).padStart(2, '0')}`
                      : 'transparent';
                    return (
                      <td key={s.key} className="px-1 py-1 text-center">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div
                              className="mx-auto flex items-center justify-center rounded-md transition-all hover:scale-105 cursor-default"
                              style={{
                                width: 44,
                                height: 32,
                                backgroundColor: count > 0 ? bg : cellBg,
                                border: `1px solid ${borderColor}`,
                                opacity: count > 0 ? 0.9 : 0.5,
                              }}
                            >
                              <span
                                className="text-[11px] font-bold tabular-nums"
                                style={{ color: count > 0 ? '#fff' : mutedColor }}
                              >
                                {count > 0 ? count : '·'}
                              </span>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="top" className="text-xs">
                            <p className="font-medium">{method} · {loc === 'zh' ? s.labelZh : s.labelEn}</p>
                            <p className="text-muted-foreground">{count} {loc === 'zh' ? '篇' : 'papers'}</p>
                            <p className="text-muted-foreground">
                              {row.total > 0 ? Math.round((count / row.total) * 100) : 0}% {loc === 'zh' ? '占该方法' : 'of method'}
                            </p>
                          </TooltipContent>
                        </Tooltip>
                      </td>
                    );
                  })}
                  <td className="px-1 py-1 text-center">
                    <span className="text-[11px] font-bold tabular-nums" style={{ color: textColor }}>
                      {row.total}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Summary bar */}
      <div className="px-4 py-2 border-t border-border/30 bg-muted/10 flex items-center gap-3">
        <BookOpen className="w-3 h-3 text-muted-foreground" />
        <div className="flex-1 h-2 rounded-full overflow-hidden flex bg-muted">
          <div style={{ width: `${(totalRead / totalPapers) * 100}%`, backgroundColor: STATES[2].color }} />
          <div style={{ width: `${(totalReading / totalPapers) * 100}%`, backgroundColor: STATES[1].color }} />
        </div>
        <span className="text-[10px] font-mono text-muted-foreground">
          {Math.round(((totalRead + totalReading) / totalPapers) * 100)}%
        </span>
      </div>
    </div>
  );
}
