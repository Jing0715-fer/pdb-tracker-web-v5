'use client';

import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Calendar, ChevronRight, ExternalLink } from 'lucide-react';
import type { PdbEntry } from '@/lib/pdb-types';
import { getMethodLabel } from '@/components/pdb-helpers';
import { useI18n } from '@/lib/i18n';

/**
 * WeeklyReleaseTimeline
 *
 * A compact horizontal timeline showing PDB structure releases throughout
 * the week. Each structure is represented as a colored dot on the timeline,
 * positioned by its release date. Hovering shows a tooltip with details.
 *
 * Features:
 *   - Horizontal timeline with week start/end markers
 *   - Colored dots per structure (method-based coloring)
 *   - Hover tooltip with PDB ID, title, method, resolution
 *   - Click to select/view structure
 *   - Animated entrance (dots fade in sequentially)
 *   - Responsive: scrolls horizontally on small screens
 *   - Summary stats: total count, method breakdown
 */

interface WeeklyReleaseTimelineProps {
  entries: PdbEntry[];
  weekStart?: string;
  weekEnd?: string;
  onSelectEntry?: (entry: PdbEntry) => void;
  maxDots?: number;
}

interface TimelineDot {
  entry: PdbEntry;
  position: number; // 0-100 percentage
  color: string;
  delay: number;
}

export function WeeklyReleaseTimeline({
  entries,
  weekStart,
  weekEnd,
  onSelectEntry,
  maxDots = 30,
}: WeeklyReleaseTimelineProps) {
  const { locale } = useI18n();
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const dots = useMemo<TimelineDot[]>(() => {
    if (!entries.length) return [];

    // Parse dates and find min/max
    const dated = entries.filter(e => e.releaseDate);
    if (!dated.length) return [];

    const dates = dated.map(e => new Date(e.releaseDate!).getTime());
    const minDate = Math.min(...dates);
    const maxDate = Math.max(...dates);
    const range = maxDate - minDate || 1; // avoid division by zero

    return dated.slice(0, maxDots).map((entry, i) => {
      const date = new Date(entry.releaseDate!).getTime();
      const position = ((date - minDate) / range) * 100;
      const methodLabel = getMethodLabel(entry.method || '');
      const color = methodLabel === 'Cryo-EM' ? '#2d8f8f'
        : methodLabel === 'X-ray' ? '#7c5cbf'
        : methodLabel === 'NMR' ? '#c9872e'
        : '#6b7280';
      return { entry, position, color, delay: i * 0.03 };
    });
  }, [entries, maxDots]);

  // Method breakdown for summary
  const methodBreakdown = useMemo(() => {
    const counts: Record<string, number> = {};
    entries.forEach(e => {
      const label = getMethodLabel(e.method || '');
      counts[label] = (counts[label] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [entries]);

  if (!dots.length) return null;

  const formatDateShort = (dateStr?: string) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en-US', {
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="border-b border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220]">
      <div className="px-3 sm:px-4 py-3">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-1.5">
            <Calendar className="h-3 w-3 text-claude-accent" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-claude-text-muted">
              {locale === 'zh' ? '本周发布时间线' : 'Release Timeline'}
            </span>
            <span className="text-[10px] text-claude-text-muted/70 ml-1">
              · {dots.length} {locale === 'zh' ? '个结构' : 'structures'}
            </span>
          </div>
          {/* Method breakdown chips */}
          <div className="flex items-center gap-1.5">
            {methodBreakdown.slice(0, 3).map(([method, count]) => {
              const color = method === 'Cryo-EM' ? '#2d8f8f'
                : method === 'X-ray' ? '#7c5cbf'
                : method === 'NMR' ? '#c9872e'
                : '#6b7280';
              return (
                <div
                  key={method}
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-claude-border-light/50 dark:bg-[#2b2926]/50 text-[9px]"
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span className="text-claude-text-muted font-mono">{count}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Timeline */}
        <div className="relative h-12 overflow-x-auto custom-scrollbar">
          <div className="relative h-full min-w-[400px]">
            {/* Timeline track */}
            <div className="absolute top-1/2 left-0 right-0 h-px bg-gradient-to-r from-transparent via-claude-border dark:via-[#3d3832] to-transparent" />

            {/* Week start marker */}
            {weekStart && (
              <div className="absolute left-0 top-1/2 -translate-y-1/2">
                <div className="w-px h-3 bg-claude-border dark:bg-[#3d3832]" />
                <span className="absolute top-3 left-0 text-[8px] text-claude-text-muted whitespace-nowrap">
                  {formatDateShort(weekStart)}
                </span>
              </div>
            )}

            {/* Week end marker */}
            {weekEnd && (
              <div className="absolute right-0 top-1/2 -translate-y-1/2">
                <div className="w-px h-3 bg-claude-border dark:bg-[#3d3832]" />
                <span className="absolute top-3 right-0 text-[8px] text-claude-text-muted whitespace-nowrap">
                  {formatDateShort(weekEnd)}
                </span>
              </div>
            )}

            {/* Structure dots */}
            {dots.map((dot) => {
              const isHovered = hoveredId === dot.entry.pdbId;
              const isHighIf = (dot.entry.journalIf ?? 0) >= 20;
              return (
                <motion.button
                  key={dot.entry.pdbId}
                  initial={{ opacity: 0, scale: 0 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: dot.delay, duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                  style={{
                    left: `${Math.max(2, Math.min(96, dot.position))}%`,
                    backgroundColor: dot.color,
                  }}
                  onMouseEnter={() => setHoveredId(dot.entry.pdbId)}
                  onMouseLeave={() => setHoveredId(null)}
                  onClick={() => onSelectEntry?.(dot.entry)}
                  className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full transition-all duration-200 ${
                    isHovered ? 'scale-150 z-20 ring-2 ring-claude-accent/40' : 'z-10 hover:scale-125'
                  } ${isHighIf ? 'ring-1 ring-amber-400/50' : ''}`}
                >
                  <span
                    className="block rounded-full"
                    style={{
                      width: isHovered ? '12px' : isHighIf ? '10px' : '8px',
                      height: isHovered ? '12px' : isHighIf ? '10px' : '8px',
                      backgroundColor: dot.color,
                    }}
                  />
                </motion.button>
              );
            })}
          </div>
        </div>

        {/* Hover tooltip */}
        <AnimatePresence>
          {hoveredId && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.15 }}
              className="mt-2 p-2 rounded-lg border border-claude-border dark:border-[#3d3832] bg-claude-bg dark:bg-[#1a1917] shadow-sm"
            >
              {(() => {
                const entry = dots.find(d => d.entry.pdbId === hoveredId)?.entry;
                if (!entry) return null;
                return (
                  <div className="flex items-start gap-2">
                    <div
                      className="w-2 h-2 rounded-full mt-1 shrink-0"
                      style={{ backgroundColor: entry.method && getMethodLabel(entry.method) === 'Cryo-EM' ? '#2d8f8f' : entry.method && getMethodLabel(entry.method) === 'X-ray' ? '#7c5cbf' : entry.method && getMethodLabel(entry.method) === 'NMR' ? '#c9872e' : '#6b7280' }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono text-[11px] font-semibold text-claude-text">
                          {entry.pdbId}
                        </span>
                        <span className="text-[9px] text-claude-text-muted">
                          {getMethodLabel(entry.method || '')}
                        </span>
                        {entry.resolution != null && (
                          <span className="text-[9px] text-claude-text-muted">
                            · {entry.resolution.toFixed(1)}Å
                          </span>
                        )}
                        {(entry.journalIf ?? 0) >= 10 && (
                          <span className="text-[9px] text-amber-600 dark:text-amber-400 font-medium">
                            · IF {entry.journalIf?.toFixed(1)}
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-claude-text-secondary truncate mt-0.5">
                        {entry.title || 'Untitled'}
                      </p>
                      {entry.journal && (
                        <p className="text-[9px] text-claude-text-muted truncate">
                          {entry.journal}
                        </p>
                      )}
                    </div>
                    <ExternalLink className="h-3 w-3 text-claude-text-muted shrink-0 mt-0.5" />
                  </div>
                );
              })()}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
