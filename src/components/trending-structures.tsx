'use client';

import { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  TrendingUp,
  Award,
  Sparkles,
  ArrowRight,
  Microscope,
  Atom,
  Eye,
  Flame,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { MethodBadge } from '@/components/method-badge';
import type { PdbEntry } from '@/lib/pdb-types';

/**
 * TrendingStructures
 *
 * A sidebar widget showing notable structures from the current week:
 *   - Highest Impact Factor (most cited journal)
 *   - Best Resolution (highest detail)
 *   - Newest Method (Cryo-EM trend)
 *   - Bookmarked (user saved)
 *
 * Each item is clickable to select the structure in the table.
 * Shown in the Weekly sidebar below the QuickActions panel.
 */

interface TrendingStructuresProps {
  entries: PdbEntry[];
  bookmarks?: Set<string>;
  onSelectEntry?: (pdbId: string) => void;
}

interface TrendingItem {
  pdbId: string;
  title: string;
  method: string | null;
  resolution: number | null;
  journalIf: number | null;
  journal: string | null;
  reason: string;
  reasonIcon: typeof TrendingUp;
  accentColor: string;
}

export function TrendingStructures({
  entries,
  bookmarks,
  onSelectEntry,
}: TrendingStructuresProps) {
  const trending = useMemo((): TrendingItem[] => {
    if (entries.length === 0) return [];

    const items: TrendingItem[] = [];

    // 1. Highest Impact Factor
    const sortedByIf = [...entries]
      .filter((e) => e.journalIf != null && e.journalIf > 0)
      .sort((a, b) => (b.journalIf ?? 0) - (a.journalIf ?? 0));
    if (sortedByIf.length > 0) {
      const top = sortedByIf[0];
      items.push({
        pdbId: top.pdbId,
        title: top.title || top.pdbId,
        method: top.method,
        resolution: top.resolution,
        journalIf: top.journalIf,
        journal: top.journal,
        reason: `Top IF: ${top.journalIf?.toFixed(1)}`,
        reasonIcon: Award,
        accentColor: '#dc2626',
      });
    }

    // 2. Best Resolution
    const sortedByRes = [...entries]
      .filter((e) => e.resolution != null && e.resolution > 0)
      .sort((a, b) => (a.resolution ?? 999) - (b.resolution ?? 999));
    if (sortedByRes.length > 0) {
      const top = sortedByRes[0];
      items.push({
        pdbId: top.pdbId,
        title: top.title || top.pdbId,
        method: top.method,
        resolution: top.resolution,
        journalIf: top.journalIf,
        journal: top.journal,
        reason: `Best resolution: ${top.resolution?.toFixed(2)}Å`,
        reasonIcon: Microscope,
        accentColor: '#2d8f8f',
      });
    }

    // 3. Latest Cryo-EM (trending method)
    const cryoemEntries = entries.filter(
      (e) => e.method && e.method.toUpperCase().includes('CRYO')
    );
    if (cryoemEntries.length > 0) {
      // Pick the one with best resolution among Cryo-EM
      const sortedCryoem = [...cryoemEntries].sort(
        (a, b) => (a.resolution ?? 999) - (b.resolution ?? 999)
      );
      const top = sortedCryoem[0];
      // Avoid duplicate
      if (!items.find((i) => i.pdbId === top.pdbId)) {
        items.push({
          pdbId: top.pdbId,
          title: top.title || top.pdbId,
          method: top.method,
          resolution: top.resolution,
          journalIf: top.journalIf,
          journal: top.journal,
          reason: `Cryo-EM at ${top.resolution?.toFixed(1)}Å`,
          reasonIcon: Atom,
          accentColor: '#7c5cbf',
        });
      }
    }

    // 4. Bookmarked structures
    if (bookmarks && bookmarks.size > 0) {
      const bookmarked = entries.filter((e) => bookmarks.has(e.pdbId));
      if (bookmarked.length > 0) {
        const top = bookmarked[0];
        if (!items.find((i) => i.pdbId === top.pdbId)) {
          items.push({
            pdbId: top.pdbId,
            title: top.title || top.pdbId,
            method: top.method,
            resolution: top.resolution,
            journalIf: top.journalIf,
            journal: top.journal,
            reason: `Bookmarked by you`,
            reasonIcon: Sparkles,
            accentColor: '#c9872e',
          });
        }
      }
    }

    // 5. Fill with most recent if we have fewer than 3
    if (items.length < 3 && entries.length > 0) {
      const existing = new Set(items.map((i) => i.pdbId));
      const remaining = entries.filter((e) => !existing.has(e.pdbId));
      if (remaining.length > 0) {
        const top = remaining[0];
        items.push({
          pdbId: top.pdbId,
          title: top.title || top.pdbId,
          method: top.method,
          resolution: top.resolution,
          journalIf: top.journalIf,
          journal: top.journal,
          reason: 'New this week',
          reasonIcon: Flame,
          accentColor: '#ea580c',
        });
      }
    }

    return items.slice(0, 4);
  }, [entries, bookmarks]);

  if (trending.length === 0) return null;

  return (
    <div className="px-2.5 py-2">
      {/* Header */}
      <div className="flex items-center gap-1.5 mb-2 px-1">
        <TrendingUp className="h-3 w-3 text-claude-accent" />
        <span className="text-[10px] font-bold uppercase tracking-wider text-claude-text">
          Trending
        </span>
      </div>

      {/* Trending items */}
      <div className="space-y-1">
        {trending.map((item, i) => {
          const ReasonIcon = item.reasonIcon;
          return (
            <motion.div
              key={item.pdbId}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.06 }}
            >
              <button
                onClick={() => onSelectEntry?.(item.pdbId)}
                className="structure-tile-hover group w-full flex items-start gap-2 p-2 rounded-lg border border-claude-border/30 dark:border-[#3d3832]/30 bg-white/30 dark:bg-[#242220]/30 text-left transition-all"
              >
                {/* PDB ID badge */}
                <div
                  className="flex h-8 w-12 shrink-0 items-center justify-center rounded-md font-mono text-[9px] font-bold text-white shadow-sm"
                  style={{ backgroundColor: item.accentColor }}
                >
                  {item.pdbId}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] font-medium text-claude-text line-clamp-2 leading-tight">
                    {item.title}
                  </div>
                  <div className="flex items-center gap-1 mt-1">
                    <MethodBadge method={item.method} size="sm" showIcon={false} showLabel={true} />
                    {item.resolution != null && (
                      <span className="text-[9px] text-claude-text-muted tabular-nums">
                        {item.resolution.toFixed(1)}Å
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 mt-1">
                    <ReasonIcon
                      className="h-2.5 w-2.5 shrink-0"
                      style={{ color: item.accentColor }}
                    />
                    <span className="text-[9px] text-claude-text-muted truncate">
                      {item.reason}
                    </span>
                  </div>
                </div>

                {/* Arrow on hover */}
                <ArrowRight className="h-3 w-3 text-claude-text-muted opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition-all shrink-0 mt-1" />
              </button>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
