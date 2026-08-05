'use client';

import React, { useMemo } from 'react';
import { BookOpen, ChevronDown, ChevronUp, Circle, CheckCircle2, Loader2 } from 'lucide-react';
import type { LitPaper } from '@/lib/pdb-types';
import type { ReadingProgressMap } from '@/hooks/use-reading-progress';
import { useI18n } from '@/lib/i18n';

interface LiteratureReadingProgressProps {
  papers: LitPaper[];
  progressMap: ReadingProgressMap;
  totalPapersCount?: number;
  /** Whether the dashboard is initially collapsed */
  defaultCollapsed?: boolean;
}

export function LiteratureReadingProgress({
  papers,
  progressMap,
  totalPapersCount,
  defaultCollapsed = false,
}: LiteratureReadingProgressProps) {
  const { locale } = useI18n();
  const [collapsed, setCollapsed] = React.useState(defaultCollapsed);

  const stats = useMemo(() => {
    const total = totalPapersCount ?? papers.length ?? 1;
    let unreadCount = 0;
    let readingCount = 0;
    let completedCount = 0;
    for (const paper of papers) {
      const p = progressMap[paper.pmid] ?? 0;
      if (p >= 100) completedCount++;
      else if (p > 0) readingCount++;
      else unreadCount++;
    }
    const papersWithProgress = readingCount + completedCount;
    const progressPercentage = total > 0 ? Math.round((papersWithProgress / total) * 100) : 0;
    return { totalPapers: total, unreadCount, readingCount, completedCount, progressPercentage };
  }, [papers, progressMap, totalPapersCount]);

  const { totalPapers, unreadCount, readingCount, completedCount, progressPercentage } = stats;

  // Donut chart dimensions
  const size = 48;
  const strokeWidth = 6;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;

  // Donut segments: completed (green), reading (amber), unread (gray)
  const completedArc = (completedCount / totalPapers) * circumference;
  const readingArc = (readingCount / totalPapers) * circumference;
  const unreadArc = (unreadCount / totalPapers) * circumference;

  const segmentData = [
    { arc: completedArc, color: '#10b981', label: locale === 'zh' ? '已完成' : 'Completed', count: completedCount },
    { arc: readingArc, color: '#f59e0b', label: locale === 'zh' ? '阅读中' : 'Reading', count: readingCount },
    { arc: unreadArc, color: '#9b9590', label: locale === 'zh' ? '未读' : 'Unread', count: unreadCount },
  ];

  let currentOffset = 0;
  const segments = segmentData.map((seg) => {
    const startOffset = currentOffset;
    currentOffset += seg.arc;
    return { ...seg, offset: startOffset };
  });

  return (
    <div className="lit-dashboard-enter px-4 py-2 flex-shrink-0">
      <div className="rounded-lg border border-claude-border/60 dark:border-[#3d3832]/60 bg-claude-surface dark:bg-[#242220] overflow-hidden">
        {/* Header - always visible */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-full flex items-center justify-between px-3 py-2 hover:bg-claude-border-light/50 dark:hover:bg-[#2b2926]/50 transition-colors"
        >
          <div className="flex items-center gap-2">
            <BookOpen className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
            <span className="text-[11px] font-semibold text-claude-text uppercase tracking-wider">
              {locale === 'zh' ? '阅读进度' : 'Reading Progress'}
            </span>
            <span className="text-[11px] font-bold text-teal-600 dark:text-teal-400 tabular-nums">
              {progressPercentage}%
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* Mini progress bar inline */}
            <div className="w-24 h-1.5 bg-claude-border-light dark:bg-[#2b2926] rounded-full overflow-hidden">
              <div
                className="h-full rounded-full lit-progress-bar"
                style={{
                  width: `${progressPercentage}%`,
                  background: progressPercentage >= 67 ? '#10b981' : progressPercentage >= 34 ? '#f59e0b' : '#2d8f8f',
                }}
              />
            </div>
            {collapsed ? (
              <ChevronDown className="h-3.5 w-3.5 text-claude-text-muted" />
            ) : (
              <ChevronUp className="h-3.5 w-3.5 text-claude-text-muted" />
            )}
          </div>
        </button>

        {/* Expanded content */}
        {!collapsed && (
          <div className="px-3 pb-3 space-y-3 lit-fade-in-up">
            {/* Full-width progress bar */}
            <div>
              <div className="h-2 w-full bg-claude-border-light dark:bg-[#2b2926] rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full lit-progress-bar"
                  style={{
                    width: `${progressPercentage}%`,
                    background: `linear-gradient(90deg, #2d8f8f ${0}%, #f59e0b ${Math.max(0, progressPercentage - 33)}%, #10b981 ${Math.max(0, progressPercentage - 10)}%)`,
                  }}
                />
              </div>
            </div>

            {/* Stats row with donut chart */}
            <div className="flex items-center gap-3">
              {/* CSS Donut chart */}
              <div className="flex-shrink-0">
                <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
                  {segments.map((seg, i) =>
                    seg.arc > 0 ? (
                      <circle
                        key={i}
                        cx={size / 2}
                        cy={size / 2}
                        r={radius}
                        fill="none"
                        stroke={seg.color}
                        strokeWidth={strokeWidth}
                        strokeDasharray={`${seg.arc} ${circumference - seg.arc}`}
                        strokeDashoffset={-seg.offset}
                        strokeLinecap="butt"
                        className="lit-donut-segment"
                        style={{ '--segment-length': circumference } as React.CSSProperties}
                      />
                    ) : null
                  )}
                  {/* Center text */}
                  <text
                    x={size / 2}
                    y={size / 2}
                    textAnchor="middle"
                    dominantBaseline="central"
                    className="fill-claude-text dark:fill-claude-text font-bold"
                    style={{ fontSize: '11px' }}
                    transform={`rotate(90, ${size / 2}, ${size / 2})`}
                  >
                    {progressPercentage}%
                  </text>
                </svg>
              </div>

              {/* Status breakdown */}
              <div className="flex-1 space-y-1.5">
                {/* Completed */}
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 flex-shrink-0" />
                  <span className="text-[10px] font-medium text-claude-text-muted uppercase tracking-wider flex-1">
                    {locale === 'zh' ? '已完成' : 'Completed'}
                  </span>
                  <span className="text-xs font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                    {completedCount}
                  </span>
                  <div className="w-16 h-1 bg-claude-border-light dark:bg-[#2b2926] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                      style={{ width: `${totalPapers > 0 ? (completedCount / totalPapers) * 100 : 0}%` }}
                    />
                  </div>
                </div>
                {/* Reading */}
                <div className="flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" />
                  <span className="text-[10px] font-medium text-claude-text-muted uppercase tracking-wider flex-1">
                    {locale === 'zh' ? '阅读中' : 'Reading'}
                  </span>
                  <span className="text-xs font-bold text-amber-600 dark:text-amber-400 tabular-nums">
                    {readingCount}
                  </span>
                  <div className="w-16 h-1 bg-claude-border-light dark:bg-[#2b2926] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-amber-500 transition-all duration-300"
                      style={{ width: `${totalPapers > 0 ? (readingCount / totalPapers) * 100 : 0}%` }}
                    />
                  </div>
                </div>
                {/* Unread */}
                <div className="flex items-center gap-2">
                  <Circle className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                  <span className="text-[10px] font-medium text-claude-text-muted uppercase tracking-wider flex-1">
                    {locale === 'zh' ? '未读' : 'Unread'}
                  </span>
                  <span className="text-xs font-bold text-gray-500 dark:text-gray-400 tabular-nums">
                    {unreadCount}
                  </span>
                  <div className="w-16 h-1 bg-claude-border-light dark:bg-[#2b2926] rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gray-400 transition-all duration-300"
                      style={{ width: `${totalPapers > 0 ? (unreadCount / totalPapers) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Summary text */}
            <div className="text-[10px] text-claude-text-muted">
              {locale === 'zh'
                ? `${completedCount} / ${totalPapers} 篇论文已完成 (${progressPercentage}% 总体进度)`
                : `${completedCount} of ${totalPapers} papers completed (${progressPercentage}% overall progress)`}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
