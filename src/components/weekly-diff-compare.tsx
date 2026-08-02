'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { X, Plus, Minus, ArrowRightLeft, Database } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PdbEntry, WeeklySnapshot } from '@/lib/pdb-types';
import { getMethodColor, getMethodLabel, formatDate } from '@/components/pdb-helpers';

// ─── Props ────────────────────────────────────────────────────────────────────

interface WeeklyDiffCompareProps {
  snapshots: WeeklySnapshot[];
  /** Fetch entries for a specific week */
  onFetchEntries: (weekId: string) => Promise<PdbEntry[]>;
  onClose: () => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function WeeklyDiffCompare({ snapshots, onFetchEntries, onClose }: WeeklyDiffCompareProps) {
  const [weekA, setWeekA] = useState<string>(snapshots[0]?.weekId || '');
  const [weekB, setWeekB] = useState<string>(snapshots[1]?.weekId || '');
  const [entriesA, setEntriesA] = useState<PdbEntry[]>([]);
  const [entriesB, setEntriesB] = useState<PdbEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [diffResult, setDiffResult] = useState<{
    added: PdbEntry[];
    removed: PdbEntry[];
    common: PdbEntry[];
  } | null>(null);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const runComparison = useCallback(async () => {
    if (!weekA || !weekB || weekA === weekB) return;
    setLoading(true);
    try {
      const [a, b] = await Promise.all([onFetchEntries(weekA), onFetchEntries(weekB)]);
      setEntriesA(a);
      setEntriesB(b);
      const idsA = new Set(a.map(e => e.pdbId));
      const idsB = new Set(b.map(e => e.pdbId));
      setDiffResult({
        added: b.filter(e => !idsA.has(e.pdbId)),
        removed: a.filter(e => !idsB.has(e.pdbId)),
        common: a.filter(e => idsB.has(e.pdbId)),
      });
    } catch (err) {
      console.error('Failed to compare weeks:', err);
    } finally {
      setLoading(false);
    }
  }, [weekA, weekB, onFetchEntries]);

  useEffect(() => {
    if (weekA && weekB && weekA !== weekB) {
      // Defer to next tick so any setState inside runComparison happens
      // outside the effect body (avoids set-state-in-effect cascade).
      const handle = setTimeout(() => { runComparison(); }, 0);
      return () => clearTimeout(handle);
    }
  }, [weekA, weekB]);

  const summaryStats = useMemo(() => {
    if (!diffResult) return null;
    return {
      addedCount: diffResult.added.length,
      removedCount: diffResult.removed.length,
      commonCount: diffResult.common.length,
    };
  }, [diffResult]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-[92vw] max-w-[1000px] max-h-[85vh] flex flex-col rounded-2xl shadow-xl border border-claude-border/60 dark:border-[#3d3832]/60 bg-white dark:bg-[#242220] overflow-hidden animate-in fade-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-claude-border dark:border-[#3d3832] bg-gradient-to-r from-[#faf7f4] to-[#f5f0ea] dark:from-[#242220] dark:to-[#2b2926]">
          <div className="flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4 text-claude-accent" />
            <span className="text-sm font-bold text-claude-text">Weekly Comparison</span>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose} className="h-7 w-7 p-0 text-claude-text-muted hover:text-claude-text">
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Week Selectors */}
        <div className="flex items-center gap-3 px-5 py-3 border-b border-claude-border/50 dark:border-[#3d3832]/50 bg-claude-surface dark:bg-[#242220]">
          <div className="flex items-center gap-2 flex-1">
            <span className="text-[10px] font-semibold text-claude-text-muted uppercase tracking-wider">Week A</span>
            <select
              value={weekA}
              onChange={e => setWeekA(e.target.value)}
              className="h-7 px-2 text-[11px] font-medium rounded-md border border-claude-border dark:border-[#3d3832] bg-white dark:bg-[#1a1917] text-claude-text flex-1"
            >
              {snapshots.map(s => <option key={s.weekId} value={s.weekId}>{s.weekId} ({s.totalStructures})</option>)}
            </select>
          </div>
          <ArrowRightLeft className="h-4 w-4 text-claude-text-muted flex-shrink-0" />
          <div className="flex items-center gap-2 flex-1">
            <span className="text-[10px] font-semibold text-claude-text-muted uppercase tracking-wider">Week B</span>
            <select
              value={weekB}
              onChange={e => setWeekB(e.target.value)}
              className="h-7 px-2 text-[11px] font-medium rounded-md border border-claude-border dark:border-[#3d3832] bg-white dark:bg-[#1a1917] text-claude-text flex-1"
            >
              {snapshots.map(s => <option key={s.weekId} value={s.weekId}>{s.weekId} ({s.totalStructures})</option>)}
            </select>
          </div>
        </div>

        {/* Summary Stats */}
        {summaryStats && (
          <div className="flex items-center gap-4 px-5 py-2.5 border-b border-claude-border/50 dark:border-[#3d3832]/50 bg-claude-border-light/30 dark:bg-[#1a1917]/30">
            <div className="flex items-center gap-1.5 text-[11px]">
              <Plus className="h-3.5 w-3.5 text-emerald-500" />
              <span className="font-medium text-emerald-600 dark:text-emerald-400">{summaryStats.addedCount} added</span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px]">
              <Minus className="h-3.5 w-3.5 text-red-400" />
              <span className="font-medium text-red-500 dark:text-red-400">{summaryStats.removedCount} removed</span>
            </div>
            <div className="flex items-center gap-1.5 text-[11px]">
              <Database className="h-3.5 w-3.5 text-claude-text-muted" />
              <span className="font-medium text-claude-text-secondary">{summaryStats.commonCount} common</span>
            </div>
          </div>
        )}

        {/* Diff Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">
          {loading && (
            <div className="flex items-center justify-center py-12 text-sm text-claude-text-muted">
              <div className="h-5 w-5 border-2 border-claude-accent border-t-transparent rounded-full animate-spin mr-2" />
              Comparing weeks...
            </div>
          )}

          {!loading && !diffResult && weekA && weekB && weekA === weekB && (
            <div className="py-12 text-center text-sm text-claude-text-muted">Select two different weeks to compare</div>
          )}

          {!loading && diffResult && (
            <div className="grid grid-cols-1 md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-claude-border/50 dark:divide-[#3d3832]/50">
              {/* Removed (in A but not B) */}
              <div className="min-h-0">
                <div className="sticky top-0 px-4 py-2 bg-red-50 dark:bg-red-900/10 border-b border-red-200/50 dark:border-red-800/30 flex items-center gap-2 z-10">
                  <Minus className="h-3.5 w-3.5 text-red-500" />
                  <span className="text-[11px] font-semibold text-red-600 dark:text-red-400">Removed from {weekA}</span>
                  <span className="text-[10px] text-red-400 ml-auto">{diffResult.removed.length}</span>
                </div>
                <div className="max-h-[40vh] overflow-y-auto">
                  {diffResult.removed.length === 0 ? (
                    <div className="px-4 py-6 text-center text-[11px] text-claude-text-muted">No structures removed</div>
                  ) : (
                    diffResult.removed.map(entry => (
                      <DiffEntryRow key={entry.pdbId} entry={entry} type="removed" />
                    ))
                  )}
                </div>
              </div>

              {/* Added (in B but not A) */}
              <div className="min-h-0">
                <div className="sticky top-0 px-4 py-2 bg-emerald-50 dark:bg-emerald-900/10 border-b border-emerald-200/50 dark:border-emerald-800/30 flex items-center gap-2 z-10">
                  <Plus className="h-3.5 w-3.5 text-emerald-500" />
                  <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">Added in {weekB}</span>
                  <span className="text-[10px] text-emerald-400 ml-auto">{diffResult.added.length}</span>
                </div>
                <div className="max-h-[40vh] overflow-y-auto">
                  {diffResult.added.length === 0 ? (
                    <div className="px-4 py-6 text-center text-[11px] text-claude-text-muted">No structures added</div>
                  ) : (
                    diffResult.added.map(entry => (
                      <DiffEntryRow key={entry.pdbId} entry={entry} type="added" />
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-2.5 border-t border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] flex items-center justify-between">
          <span className="text-[10px] text-claude-text-muted">Press Esc to close</span>
          <Button variant="ghost" size="sm" onClick={onClose} className="h-7 px-3 text-[11px] text-claude-text-secondary">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

// ─── Entry Row ────────────────────────────────────────────────────────────────

function DiffEntryRow({ entry, type }: { entry: PdbEntry; type: 'added' | 'removed' }) {
  const methodStyle = getMethodColor(entry.method || '');
  const borderColor = type === 'added' ? 'border-l-emerald-400' : 'border-l-red-400';

  return (
    <div className={`px-4 py-2 border-l-2 ${borderColor} border-b border-claude-border/30 dark:border-[#3d3832]/30 hover:bg-claude-border-light/30 dark:hover:bg-[#2b2926]/30 transition-colors`}>
      <div className="flex items-center gap-2">
        <a
          href={`https://www.rcsb.org/structure/${entry.pdbId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-mono font-bold text-claude-accent hover:underline"
        >
          {entry.pdbId}
        </a>
        <span className={`inline-flex px-1.5 py-0.5 rounded text-[9px] font-medium ${methodStyle.bg} ${methodStyle.text} ${methodStyle.border} border`}>
          {getMethodLabel(entry.method || '')}
        </span>
        {entry.resolution != null && (
          <span className="text-[10px] text-claude-text-muted font-mono">
            {entry.resolution.toFixed(2)}Å
          </span>
        )}
        {entry.journalIf != null && entry.journalIf > 0 && (
          <span className={`text-[10px] font-medium ${
            entry.journalIf >= 20 ? 'text-red-500' : entry.journalIf >= 10 ? 'text-orange-500' : 'text-emerald-500'
          }`}>
            IF: {entry.journalIf.toFixed(1)}
          </span>
        )}
      </div>
      <div className="text-[10px] text-claude-text-secondary mt-0.5 line-clamp-1">
        {entry.title || '—'}
      </div>
    </div>
  );
}
