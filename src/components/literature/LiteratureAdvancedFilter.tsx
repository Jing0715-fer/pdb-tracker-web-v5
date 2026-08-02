'use client';

import React, { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Filter, X, RotateCcw, Check, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { LitPaper } from '@/lib/pdb-types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AdvancedFilterState {
  journals: string[];
  methods: string[];
  yearStart: string;
  yearEnd: string;
  hasAbstract: boolean;
  hasPdbStructures: boolean;
}

export const DEFAULT_ADVANCED_FILTERS: AdvancedFilterState = {
  journals: [],
  methods: [],
  yearStart: '',
  yearEnd: '',
  hasAbstract: false,
  hasPdbStructures: false,
};

export function countActiveFilters(filters: AdvancedFilterState): number {
  let count = 0;
  if (filters.journals.length > 0) count++;
  if (filters.methods.length > 0) count++;
  if (filters.yearStart || filters.yearEnd) count++;
  if (filters.hasAbstract) count++;
  if (filters.hasPdbStructures) count++;
  return count;
}

export function applyAdvancedFilters(papers: LitPaper[], filters: AdvancedFilterState): LitPaper[] {
  let result = [...papers];

  if (filters.journals.length > 0) {
    const journalSet = new Set(filters.journals);
    result = result.filter(p => journalSet.has(p.journal));
  }

  if (filters.methods.length > 0) {
    result = result.filter(p => {
      const paperMethods = p.pdbs.map(pdb => {
        const m = (pdb.method || '').toLowerCase();
        if (m.includes('cryo')) return 'Cryo-EM';
        if (m.includes('x-ray') || m.includes('xray')) return 'X-ray';
        if (m.includes('nmr')) return 'NMR';
        return '';
      });
      return filters.methods.some(fm => (paperMethods as string[]).includes(fm));
    });
  }

  if (filters.yearStart) {
    const startY = parseInt(filters.yearStart, 10);
    if (!isNaN(startY)) {
      result = result.filter(p => {
        try {
          const y = new Date(p.pubdate + 'T00:00:00Z').getFullYear();
          return y >= startY;
        } catch { return true; }
      });
    }
  }

  if (filters.yearEnd) {
    const endY = parseInt(filters.yearEnd, 10);
    if (!isNaN(endY)) {
      result = result.filter(p => {
        try {
          const y = new Date(p.pubdate + 'T00:00:00Z').getFullYear();
          return y <= endY;
        } catch { return true; }
      });
    }
  }

  if (filters.hasAbstract) {
    result = result.filter(p => !!p.abstract && p.abstract.trim().length > 0);
  }

  if (filters.hasPdbStructures) {
    result = result.filter(p => p.pdbs.length > 0);
  }

  return result;
}

// ─── IF Tier grouping ─────────────────────────────────────────────────────────

function getIfTier(ifVal: number | null): string {
  if (ifVal == null) return 'No IF';
  if (ifVal >= 20) return 'Top IF ≥20';
  if (ifVal >= 10) return 'High IF ≥10';
  if (ifVal >= 5) return 'Mid IF ≥5';
  return 'Low IF <5';
}

const IF_TIER_ORDER = ['Top IF ≥20', 'High IF ≥10', 'Mid IF ≥5', 'Low IF <5', 'No IF'];

const METHOD_OPTIONS = ['Cryo-EM', 'X-ray', 'NMR'];

// ─── Component ────────────────────────────────────────────────────────────────

interface LiteratureAdvancedFilterProps {
  papers: LitPaper[];
  filters: AdvancedFilterState;
  onFiltersChange: (filters: AdvancedFilterState) => void;
  isOpen: boolean;
  onToggle: () => void;
}

export function LiteratureAdvancedFilter({
  papers,
  filters,
  onFiltersChange,
  isOpen,
  onToggle,
}: LiteratureAdvancedFilterProps) {
  const activeCount = countActiveFilters(filters);

  // Derive available journals grouped by IF tier
  const journalGroups = useMemo(() => {
    const journalMap = new Map<string, { name: string; ifVal: number | null; count: number }>();
    for (const p of papers) {
      const j = p.journal || 'Unknown';
      const existing = journalMap.get(j);
      if (existing) {
        existing.count++;
      } else {
        journalMap.set(j, { name: j, ifVal: p.IF, count: 1 });
      }
    }
    // Merge IF values — take max
    const ifMap = new Map<string, number | null>();
    for (const p of papers) {
      const j = p.journal || 'Unknown';
      const cur = ifMap.get(j);
      if (cur == null || (p.IF != null && p.IF > cur)) {
        ifMap.set(j, p.IF);
      }
    }

    const groups: Record<string, { name: string; count: number; ifVal: number | null }[]> = {};
    for (const [name, count] of journalMap.entries()) {
      const ifVal = ifMap.get(name) ?? null;
      const tier = getIfTier(ifVal);
      if (!groups[tier]) groups[tier] = [];
      groups[tier].push({ name, count: count.count, ifVal });
    }
    // Sort each group by count desc
    for (const tier of Object.keys(groups)) {
      groups[tier].sort((a, b) => b.count - a.count);
    }
    return groups;
  }, [papers]);

  // Derive available year range
  const yearRange = useMemo(() => {
    let minYear = 2025;
    let maxYear = 2025;
    for (const p of papers) {
      try {
        const y = new Date(p.pubdate + 'T00:00:00Z').getFullYear();
        if (y < minYear) minYear = y;
        if (y > maxYear) maxYear = y;
      } catch { /* ignore */ }
    }
    return { minYear, maxYear };
  }, [papers]);

  const yearOptions = useMemo(() => {
    const opts: number[] = [];
    for (let y = yearRange.maxYear; y >= yearRange.minYear; y--) {
      opts.push(y);
    }
    return opts;
  }, [yearRange]);

  // Toggles
  const toggleJournal = useCallback((journal: string) => {
    onFiltersChange({
      ...filters,
      journals: filters.journals.includes(journal)
        ? filters.journals.filter(j => j !== journal)
        : [...filters.journals, journal],
    });
  }, [filters, onFiltersChange]);

  const toggleMethod = useCallback((method: string) => {
    onFiltersChange({
      ...filters,
      methods: filters.methods.includes(method)
        ? filters.methods.filter(m => m !== method)
        : [...filters.methods, method],
    });
  }, [filters, onFiltersChange]);

  const handleReset = useCallback(() => {
    onFiltersChange(DEFAULT_ADVANCED_FILTERS);
  }, [onFiltersChange]);

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const toggleGroup = useCallback((tier: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(tier)) next.delete(tier);
      else next.add(tier);
      return next;
    });
  }, []);

  return (
    <>
      {/* Active filter badges only — the toggle button lives in LiteratureToolbar */}
      {activeCount > 0 && !isOpen && (
        <div className="flex items-center gap-1 flex-wrap">
            {filters.journals.slice(0, 2).map(j => (
              <span
                key={j}
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-claude-accent/10 text-claude-accent dark:bg-claude-accent/20 dark:text-claude-accent-hover"
              >
                {j.length > 15 ? j.slice(0, 15) + '…' : j}
                <button onClick={() => toggleJournal(j)} className="hover:text-claude-text transition-colors">
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
            {filters.journals.length > 2 && (
              <span className="text-[9px] text-claude-text-muted">+{filters.journals.length - 2}</span>
            )}
            {filters.methods.map(m => (
              <span
                key={m}
                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-400"
              >
                {m}
                <button onClick={() => toggleMethod(m)} className="hover:text-red-500 transition-colors">
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
            {(filters.yearStart || filters.yearEnd) && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-purple-50 dark:bg-purple-900/20 text-purple-700 dark:text-purple-400">
                {filters.yearStart || '…'}–{filters.yearEnd || '…'}
              </span>
            )}
            {filters.hasAbstract && (
              <span className="px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400">
                Abstract
              </span>
            )}
            {filters.hasPdbStructures && (
              <span className="px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400">
                PDB
              </span>
            )}
          </div>
        )}

      {/* Collapsible panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="p-4 rounded-xl border border-claude-border dark:border-[#3d3832] bg-white dark:bg-[#1a1917] shadow-sm space-y-4">
              {/* Header */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-claude-accent" />
                  <span className="text-sm font-semibold text-claude-text">Advanced Filters</span>
                  {activeCount > 0 && (
                    <span className="text-[10px] font-medium text-claude-accent dark:text-claude-accent-hover">
                      {activeCount} active
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleReset}
                    disabled={activeCount === 0}
                    className="h-7 px-2.5 text-[11px] text-claude-text-muted hover:text-claude-text"
                  >
                    <RotateCcw className="h-3 w-3 mr-1" />
                    Reset
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={onToggle}
                    className="h-7 w-7 p-0 text-claude-text-muted hover:text-claude-text"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* Journal Multi-Select */}
                <div className="space-y-2">
                  <div className="text-[10px] font-semibold text-claude-text-muted uppercase tracking-wider">
                    Journals
                  </div>
                  <div className="max-h-48 overflow-y-auto custom-scrollbar space-y-1 pr-1">
                    {IF_TIER_ORDER.filter(tier => journalGroups[tier]?.length).map(tier => {
                      const isCollapsed = collapsedGroups.has(tier);
                      const journals = journalGroups[tier] || [];
                      const allSelected = journals.every(j => filters.journals.includes(j.name));
                      const someSelected = journals.some(j => filters.journals.includes(j.name));

                      return (
                        <div key={tier} className="space-y-0.5">
                          <div
                            onClick={() => toggleGroup(tier)}
                            className="w-full flex items-center gap-1.5 py-1 text-[10px] font-bold uppercase tracking-wider cursor-pointer select-none"
                          >
                            {isCollapsed ? (
                              <ChevronRight className="h-3 w-3 text-claude-text-muted" />
                            ) : (
                              <ChevronDown className="h-3 w-3 text-claude-text-muted" />
                            )}
                            <span className={
                              tier === 'Top IF ≥20' ? 'text-red-600 dark:text-red-400' :
                              tier === 'High IF ≥10' ? 'text-orange-600 dark:text-orange-400' :
                              tier === 'Mid IF ≥5' ? 'text-emerald-600 dark:text-emerald-400' :
                              tier === 'Low IF <5' ? 'text-gray-600 dark:text-gray-400' :
                              'text-claude-text-muted'
                            }>
                              {tier}
                            </span>
                            <span className="text-claude-text-muted font-normal">({journals.length})</span>
                            {/* Select all in group */}
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const names = journals.map(j => j.name);
                                if (allSelected) {
                                  onFiltersChange({
                                    ...filters,
                                    journals: filters.journals.filter(j => !names.includes(j)),
                                  });
                                } else {
                                  onFiltersChange({
                                    ...filters,
                                    journals: [...new Set([...filters.journals, ...names])],
                                  });
                                }
                              }}
                              className={`ml-auto p-0.5 rounded transition-colors ${
                                allSelected
                                  ? 'text-claude-accent'
                                  : someSelected
                                  ? 'text-claude-accent/50'
                                  : 'text-claude-text-muted hover:text-claude-text'
                              }`}
                              title={allSelected ? 'Deselect all' : 'Select all'}
                            >
                              <Check className="h-3 w-3" />
                            </button>
                          </div>
                          {!isCollapsed && (
                            <div className="pl-5 space-y-0.5">
                              {journals.map(j => {
                                const isSelected = filters.journals.includes(j.name);
                                return (
                                  <label
                                    key={j.name}
                                    className={`flex items-center gap-2 py-0.5 px-1.5 rounded cursor-pointer transition-colors ${
                                      isSelected
                                        ? 'bg-claude-accent/10 dark:bg-claude-accent/20'
                                        : 'hover:bg-claude-border-light dark:hover:bg-[#2b2926]'
                                    }`}
                                  >
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={() => toggleJournal(j.name)}
                                      className="h-3 w-3 rounded border-claude-border text-claude-accent focus:ring-claude-accent/30"
                                    />
                                    <span className="text-[10px] text-claude-text-secondary truncate flex-1">{j.name}</span>
                                    <span className="text-[9px] text-claude-text-muted font-mono">{j.count}</span>
                                  </label>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Method Filter */}
                <div className="space-y-2">
                  <div className="text-[10px] font-semibold text-claude-text-muted uppercase tracking-wider">
                    Experimental Method
                  </div>
                  <div className="space-y-1">
                    {METHOD_OPTIONS.map(method => {
                      const isSelected = filters.methods.includes(method);
                      const methodColor =
                        method === 'Cryo-EM' ? 'bg-claude-cryoem-bg text-claude-cryoem border-claude-cryoem/30' :
                        method === 'X-ray' ? 'bg-claude-xray-bg text-claude-xray border-claude-xray/30' :
                        'bg-claude-nmr-bg text-claude-nmr border-claude-nmr/30';
                      return (
                        <label
                          key={method}
                          className={`flex items-center gap-2 py-1.5 px-2.5 rounded-lg cursor-pointer transition-all border ${
                            isSelected
                              ? `${methodColor} font-medium`
                              : 'border-claude-border dark:border-[#3d3832] hover:bg-claude-border-light dark:hover:bg-[#2b2926]'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleMethod(method)}
                            className="h-3 w-3 rounded border-claude-border text-claude-accent focus:ring-claude-accent/30"
                          />
                          <span className="text-xs">{method}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                {/* Year Range + Toggles */}
                <div className="space-y-3">
                  {/* Year Range */}
                  <div className="space-y-2">
                    <div className="text-[10px] font-semibold text-claude-text-muted uppercase tracking-wider">
                      Year Range
                    </div>
                    <div className="flex items-center gap-2">
                      <select
                        value={filters.yearStart}
                        onChange={(e) => onFiltersChange({ ...filters, yearStart: e.target.value })}
                        className="h-7 px-2 text-[11px] rounded-lg border border-claude-border dark:border-[#3d3832] bg-white dark:bg-[#242220] text-claude-text-secondary focus:outline-none focus:ring-2 focus:ring-claude-accent/30"
                      >
                        <option value="">From</option>
                        {yearOptions.map(y => (
                          <option key={y} value={String(y)}>{y}</option>
                        ))}
                      </select>
                      <span className="text-claude-text-muted text-xs">–</span>
                      <select
                        value={filters.yearEnd}
                        onChange={(e) => onFiltersChange({ ...filters, yearEnd: e.target.value })}
                        className="h-7 px-2 text-[11px] rounded-lg border border-claude-border dark:border-[#3d3832] bg-white dark:bg-[#242220] text-claude-text-secondary focus:outline-none focus:ring-2 focus:ring-claude-accent/30"
                      >
                        <option value="">To</option>
                        {yearOptions.map(y => (
                          <option key={y} value={String(y)}>{y}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Has Abstract Toggle */}
                  <div className="flex items-center justify-between py-1">
                    <span className="text-xs text-claude-text-secondary">Has Abstract</span>
                    <button
                      onClick={() => onFiltersChange({ ...filters, hasAbstract: !filters.hasAbstract })}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                        filters.hasAbstract
                          ? 'bg-claude-accent'
                          : 'bg-claude-border-light dark:bg-[#3d3832]'
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform shadow-sm ${
                          filters.hasAbstract ? 'translate-x-4' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                  </div>

                  {/* Has PDB Structures Toggle */}
                  <div className="flex items-center justify-between py-1">
                    <span className="text-xs text-claude-text-secondary">Has PDB Structures</span>
                    <button
                      onClick={() => onFiltersChange({ ...filters, hasPdbStructures: !filters.hasPdbStructures })}
                      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                        filters.hasPdbStructures
                          ? 'bg-claude-accent'
                          : 'bg-claude-border-light dark:bg-[#3d3832]'
                      }`}
                    >
                      <span
                        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform shadow-sm ${
                          filters.hasPdbStructures ? 'translate-x-4' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
