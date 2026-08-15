'use client';

import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Atom, ExternalLink, FileText, Users, Clock, BookOpen } from 'lucide-react';
import { useI18n } from '@/lib/i18n';
import type { PdbEntry } from '@/lib/pdb-types';
import { getMethodColor, getMethodLabel, formatDate } from '@/components/pdb-helpers';

// ─── Activity Event Types ─────────────────────────────────────────────────────

interface ActivityEvent {
  id: string;
  type: 'new_structure' | 'high_if_publication' | 'weekly_summary';
  title: string;
  description: string;
  timestamp: string;
  method?: string | null;
  pdbId?: string;
  color: string;
  icon: React.ReactNode;
}

// ─── WeeklyActivityFeed Component ─────────────────────────────────────────────

interface WeeklyActivityFeedProps {
  entries: PdbEntry[];
  weekLabel?: string;
  maxEvents?: number;
}

export function WeeklyActivityFeed({ entries, weekLabel, maxEvents = 10 }: WeeklyActivityFeedProps) {
  const { t } = useI18n();
  const events = useMemo(() => {
    const eventList: ActivityEvent[] = [];

    // Sort entries by releaseDate (most recent first)
    const sorted = [...entries]
      .filter(e => e.releaseDate)
      .sort((a, b) => new Date(b.releaseDate!).getTime() - new Date(a.releaseDate!).getTime());

    for (const entry of sorted) {
      if (eventList.length >= maxEvents) break;

      const methodLabel = getMethodLabel(entry.method || '');
      const methodColors = getMethodColor(entry.method || '');
      const color = methodLabel === 'Cryo-EM' ? '#2d8f8f' : methodLabel === 'X-ray' ? '#7c5cbf' : methodLabel === 'NMR' ? '#c9872e' : '#6b7280';

      // High IF publication event
      if ((entry.journalIf ?? 0) >= 10 && entry.journal) {
        eventList.push({
          id: `pub-${entry.pdbId}`,
          type: 'high_if_publication',
          title: `${entry.pdbId} published in ${entry.journal}`,
          description: `IF: ${(entry.journalIf ?? 0).toFixed(1)}`,
          timestamp: entry.releaseDate!,
          method: entry.method,
          pdbId: entry.pdbId,
          color,
          icon: <BookOpen className="h-2.5 w-2.5" />,
        });
      }

      // New structure event
      if (eventList.length < maxEvents) {
        const resText = entry.resolution != null ? `, ${entry.resolution.toFixed(1)}Å` : '';
        eventList.push({
          id: `struct-${entry.pdbId}`,
          type: 'new_structure',
          title: `New structure ${entry.pdbId} added`,
          description: `${methodLabel}${resText}`,
          timestamp: entry.releaseDate!,
          method: entry.method,
          pdbId: entry.pdbId,
          color,
          icon: <Atom className="h-2.5 w-2.5" />,
        });
      }
    }

    // Add a weekly summary event if we have entries
    if (entries.length > 0 && weekLabel) {
      const cryoemCount = entries.filter(e => e.isCryoem).length;
      const xrayCount = entries.filter(e => e.isXray).length;
      const nmrCount = entries.length - cryoemCount - xrayCount;
      eventList.unshift({
        id: `week-${weekLabel}`,
        type: 'weekly_summary',
        title: `${weekLabel} has ${entries.length} new structures`,
        description: `EM:${cryoemCount} X:${xrayCount} N:${nmrCount}`,
        timestamp: entries[0]?.releaseDate || '',
        color: '#c96442',
        icon: <FileText className="h-2.5 w-2.5" />,
      });
    }

    // Sort by timestamp and take maxEvents
    return eventList
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, maxEvents);
  }, [entries, weekLabel, maxEvents]);

  if (events.length === 0) {
    return (
      <div className="px-3 py-4">
        <div className="text-[10px] font-semibold text-claude-text-secondary mb-2 uppercase tracking-wider">
          {t.recentActivity}
        </div>
        <div className="text-[10px] text-claude-text-muted text-center py-3">
          {t.noActivityThisWeekFull}
        </div>
      </div>
    );
  }

  return (
    <div className="px-3 py-3">
      <div className="text-[10px] font-semibold text-claude-text-secondary mb-2.5 uppercase tracking-wider">
        {t.recentActivity}
      </div>
      <div className="space-y-0 relative">
        {/* Timeline line */}
        <div className="absolute left-[5px] top-2 bottom-2 w-px bg-claude-border dark:bg-[#3d3832]" />

        <AnimatePresence>
          {events.map((event, idx) => (
            <motion.div
              key={event.id}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.3, delay: idx * 0.05 }}
              className="flex items-start gap-2.5 py-1.5 relative group"
            >
              {/* Timeline dot */}
              <div
                className="w-[11px] h-[11px] rounded-full flex-shrink-0 flex items-center justify-center mt-0.5 z-10 ring-2 ring-claude-surface dark:ring-[#242220]"
                style={{ backgroundColor: event.color + '20' }}
              >
                <div
                  className="w-[5px] h-[5px] rounded-full"
                  style={{ backgroundColor: event.color }}
                />
              </div>

              {/* Event content */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1">
                  <span className="text-[10px] font-medium text-claude-text line-clamp-1">
                    {event.title}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {event.description && (
                    <span className="text-[9px] text-claude-text-muted font-mono">
                      {event.description}
                    </span>
                  )}
                  {event.timestamp && (
                    <>
                      <span className="text-[8px] text-claude-text-muted">·</span>
                      <span className="text-[9px] text-claude-text-muted">
                        {formatDate(event.timestamp)}
                      </span>
                    </>
                  )}
                </div>
              </div>

              {/* PDB link */}
              {event.pdbId && (
                <a
                  href={`https://www.rcsb.org/structure/${event.pdbId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="opacity-0 group-hover:opacity-60 transition-opacity flex-shrink-0"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink className="h-2.5 w-2.5 text-claude-text-muted" />
                </a>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
