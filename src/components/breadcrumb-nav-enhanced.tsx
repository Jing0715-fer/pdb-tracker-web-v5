'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronRight,
  ChevronDown,
  Home,
  Calendar,
  FlaskConical,
  BookOpen,
  Microscope,
  Database,
  Clock,
} from 'lucide-react';
import type { Mode, WeeklySnapshot } from '@/lib/pdb-types';
import { cn } from '@/lib/utils';

/**
 * BreadcrumbNavEnhanced
 *
 * An enhanced breadcrumb navigation with:
 *   - Quick navigation dropdowns (click any segment to see options)
 *   - Mode switcher dropdown (Weekly/Evaluation/Literature/Analysis)
 *   - Week selector dropdown (for Weekly mode)
 *   - Animated transitions
 *   - Icon prefix per segment
 *   - Responsive truncation
 */

interface BreadcrumbNavEnhancedProps {
  mode: Mode;
  weekLabel?: string | null;
  entryId?: string | null;
  evalName?: string | null;
  snapshots?: WeeklySnapshot[];
  onModeChange?: (mode: Mode) => void;
  onWeekChange?: (weekId: string) => void;
  onHomeClick?: () => void;
}

const MODE_CONFIG: Record<Mode, { label: string; icon: typeof Database }> = {
  weekly: { label: 'Weekly', icon: Database },
  evaluation: { label: 'Evaluation', icon: FlaskConical },
  literature: { label: 'Literature', icon: BookOpen },
  analysis: { label: 'Analysis', icon: Microscope },
};

export function BreadcrumbNavEnhanced({
  mode,
  weekLabel,
  entryId,
  evalName,
  snapshots = [],
  onModeChange,
  onWeekChange,
  onHomeClick,
}: BreadcrumbNavEnhancedProps) {
  const [modeDropdownOpen, setModeDropdownOpen] = useState(false);
  const [weekDropdownOpen, setWeekDropdownOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    if (!modeDropdownOpen && !weekDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setModeDropdownOpen(false);
        setWeekDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [modeDropdownOpen, weekDropdownOpen]);

  // Close on Escape
  useEffect(() => {
    if (!modeDropdownOpen && !weekDropdownOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setModeDropdownOpen(false);
        setWeekDropdownOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [modeDropdownOpen, weekDropdownOpen]);

  const currentModeConfig = MODE_CONFIG[mode];

  return (
    <nav
      ref={containerRef}
      className="flex items-center gap-1 text-[11px] text-claude-text-muted"
      aria-label="Breadcrumb"
    >
      {/* Home */}
      <button
        onClick={onHomeClick}
        className="flex items-center gap-1 px-1.5 py-0.5 rounded-md hover:bg-claude-border/20 hover:text-claude-text transition-colors"
      >
        <Home className="h-3 w-3" />
        <span className="hidden sm:inline">PDB Tracker</span>
      </button>

      <ChevronRight className="h-3 w-3 text-claude-text-muted opacity-50" />

      {/* Mode selector with dropdown */}
      <div className="relative">
        <button
          onClick={() => {
            setModeDropdownOpen(!modeDropdownOpen);
            setWeekDropdownOpen(false);
          }}
          className="flex items-center gap-1 px-1.5 py-0.5 rounded-md hover:bg-claude-border/20 hover:text-claude-text transition-colors"
        >
          <currentModeConfig.icon className="h-3 w-3 text-claude-accent" />
          <span className="font-medium">{currentModeConfig.label}</span>
          <ChevronDown className={cn('h-2.5 w-2.5 transition-transform', modeDropdownOpen && 'rotate-180')} />
        </button>

        <AnimatePresence>
          {modeDropdownOpen && (
            <motion.div
              initial={{ opacity: 0, y: -4, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              className="glass-dropdown absolute left-0 top-full mt-1 w-40 rounded-lg overflow-hidden z-50"
            >
              {(Object.keys(MODE_CONFIG) as Mode[]).map((m) => {
                const config = MODE_CONFIG[m];
                const Icon = config.icon;
                const isActive = m === mode;
                return (
                  <button
                    key={m}
                    onClick={() => {
                      onModeChange?.(m);
                      setModeDropdownOpen(false);
                    }}
                    className={cn(
                      'w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] transition-colors',
                      isActive
                        ? 'bg-claude-accent/10 text-claude-accent font-medium'
                        : 'text-claude-text-secondary hover:bg-claude-border/20 hover:text-claude-text'
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    {config.label}
                  </button>
                );
              })}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Week selector (Weekly mode only) */}
      {mode === 'weekly' && weekLabel && (
        <>
          <ChevronRight className="h-3 w-3 text-claude-text-muted opacity-50" />
          <div className="relative">
            <button
              onClick={() => {
                setWeekDropdownOpen(!weekDropdownOpen);
                setModeDropdownOpen(false);
              }}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded-md hover:bg-claude-border/20 hover:text-claude-text transition-colors"
            >
              <Calendar className="h-3 w-3" />
              <span className="font-mono font-medium">{weekLabel}</span>
              {snapshots.length > 1 && (
                <ChevronDown className={cn('h-2.5 w-2.5 transition-transform', weekDropdownOpen && 'rotate-180')} />
              )}
            </button>

            <AnimatePresence>
              {weekDropdownOpen && snapshots.length > 1 && (
                <motion.div
                  initial={{ opacity: 0, y: -4, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.95 }}
                  transition={{ duration: 0.15 }}
                  className="glass-dropdown absolute left-0 top-full mt-1 w-48 rounded-lg overflow-hidden z-50 max-h-64 overflow-y-auto custom-scrollbar"
                >
                  {snapshots.map((snap, i) => (
                    <button
                      key={snap.weekId}
                      onClick={() => {
                        onWeekChange?.(snap.weekId);
                        setWeekDropdownOpen(false);
                      }}
                      className={cn(
                        'w-full flex items-center justify-between gap-2 px-2.5 py-1.5 text-[11px] transition-colors',
                        snap.weekId === weekLabel
                          ? 'bg-claude-accent/10 text-claude-accent font-medium'
                          : 'text-claude-text-secondary hover:bg-claude-border/20 hover:text-claude-text'
                      )}
                    >
                      <div className="flex items-center gap-1.5">
                        <Clock className="h-2.5 w-2.5" />
                        <span className="font-mono">{snap.weekId}</span>
                        {i === 0 && (
                          <span className="text-[8px] px-1 rounded bg-claude-accent/15 text-claude-accent">LATEST</span>
                        )}
                      </div>
                      <span className="text-[9px] text-claude-text-muted tabular-nums">
                        {snap.totalStructures}
                      </span>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </>
      )}

      {/* Entry ID (when a structure is selected) */}
      {entryId && (
        <>
          <ChevronRight className="h-3 w-3 text-claude-text-muted opacity-50" />
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-claude-accent/10 text-claude-accent">
            <Microscope className="h-3 w-3" />
            <span className="font-mono font-bold text-[10px]">{entryId}</span>
          </span>
        </>
      )}

      {/* Eval name (when an evaluation is selected) */}
      {mode === 'evaluation' && evalName && (
        <>
          <ChevronRight className="h-3 w-3 text-claude-text-muted opacity-50" />
          <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-claude-accent/10 text-claude-accent max-w-[200px]">
            <FlaskConical className="h-3 w-3 shrink-0" />
            <span className="font-medium text-[10px] truncate">{evalName}</span>
          </span>
        </>
      )}
    </nav>
  );
}
