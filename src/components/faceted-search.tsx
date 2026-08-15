'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Filter, X, Microscope, Gauge, Award, Users, ChevronDown } from 'lucide-react';
import type { PdbEntry } from '@/lib/pdb-types';
import { getMethodLabel } from '@/components/pdb-helpers';
import { useI18n } from '@/lib/i18n';

/**
 * FacetedSearch
 *
 * Advanced faceted search filters for the Weekly structure table.
 * Provides filter chips for:
 *   - Method (Cryo-EM, X-ray, NMR, Other)
 *   - Resolution range (< 2.0Å, 2.0-3.0Å, > 3.0Å)
 *   - Impact Factor range (≥ 20, ≥ 10, ≥ 5, < 5)
 *   - Organism (top 5 organisms from data)
 *
 * Multiple facets can be combined. Active filters show as removable chips.
 */

export interface FacetFilters {
  methods: Set<string>;
  resolutionRanges: Set<string>;
  ifRanges: Set<string>;
  organisms: Set<string>;
}

interface FacetedSearchProps {
  entries: PdbEntry[];
  filters: FacetFilters;
  onFiltersChange: (filters: FacetFilters) => void;
}

const RES_RANGES = [
  { id: 'sub-2', label: '< 2.0Å', min: 0, max: 2.0 },
  { id: '2-3', label: '2.0–3.0Å', min: 2.0, max: 3.0 },
  { id: 'over-3', label: '> 3.0Å', min: 3.0, max: Infinity },
];

const IF_RANGES = [
  { id: 'if-20', label: 'IF ≥ 20', min: 20 },
  { id: 'if-10', label: 'IF ≥ 10', min: 10 },
  { id: 'if-5', label: 'IF ≥ 5', min: 5 },
];

export function FacetedSearch({ entries, filters, onFiltersChange }: FacetedSearchProps) {
  const { locale } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Compute available facets from data
  const availableMethods = useMemo(() => {
    const counts: Record<string, number> = {};
    entries.forEach(e => {
      const m = getMethodLabel(e.method || '');
      counts[m] = (counts[m] || 0) + 1;
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [entries]);

  const availableOrganisms = useMemo(() => {
    const counts: Record<string, number> = {};
    entries.forEach(e => {
      if (e.organisms) {
        const org = e.organisms.split('|')[0]?.trim() || e.organisms;
        counts[org] = (counts[org] || 0) + 1;
      }
    });
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 5);
  }, [entries]);

  const activeCount = filters.methods.size + filters.resolutionRanges.size + filters.ifRanges.size + filters.organisms.size;

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  const toggleFilter = (category: keyof FacetFilters, value: string) => {
    const newFilters = { ...filters, [category]: new Set(filters[category]) };
    if (newFilters[category].has(value)) {
      newFilters[category].delete(value);
    } else {
      newFilters[category].add(value);
    }
    onFiltersChange(newFilters);
  };

  const clearAll = () => {
    onFiltersChange({
      methods: new Set(),
      resolutionRanges: new Set(),
      ifRanges: new Set(),
      organisms: new Set(),
    });
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium transition-all ${
          activeCount > 0
            ? 'bg-claude-accent/15 text-claude-accent border border-claude-accent/30'
            : 'text-claude-text-muted hover:text-claude-text hover:bg-claude-border-light dark:hover:bg-[#2b2926] border border-transparent'
        }`}
      >
        <Filter className="h-3 w-3" />
        <span className="hidden sm:inline">{locale === 'zh' ? '分面筛选' : 'Facets'}</span>
        {activeCount > 0 && (
          <span className="text-[9px] font-bold bg-claude-accent/20 text-claude-accent rounded-full px-1">
            {activeCount}
          </span>
        )}
        <ChevronDown className={`h-2.5 w-2.5 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.96 }}
            transition={{ duration: 0.12 }}
            className="glass-dropdown absolute right-0 top-full mt-1 w-72 max-h-[400px] overflow-y-auto rounded-lg overflow-hidden z-50 shadow-lg border border-claude-border dark:border-[#3d3832]"
          >
            {/* Method facet */}
            <div className="p-2 border-b border-claude-border/30 dark:border-[#3d3832]/30">
              <div className="flex items-center gap-1 mb-1.5">
                <Microscope className="h-3 w-3 text-claude-text-muted" />
                <span className="text-[9px] font-bold uppercase tracking-wider text-claude-text-muted">
                  {locale === 'zh' ? '方法' : 'Method'}
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {availableMethods.map(([method, count]) => (
                  <button
                    key={method}
                    onClick={() => toggleFilter('methods', method)}
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium transition-all ${
                      filters.methods.has(method)
                        ? 'bg-[#2d8f8f]/20 text-[#2d8f8f] border border-[#2d8f8f]/30'
                        : 'bg-claude-border-light dark:bg-[#2b2926] text-claude-text-muted border border-transparent hover:border-claude-border/50'
                    }`}
                  >
                    {method}
                    <span className="text-[8px] opacity-60">{count}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Resolution facet */}
            <div className="p-2 border-b border-claude-border/30 dark:border-[#3d3832]/30">
              <div className="flex items-center gap-1 mb-1.5">
                <Gauge className="h-3 w-3 text-claude-text-muted" />
                <span className="text-[9px] font-bold uppercase tracking-wider text-claude-text-muted">
                  {locale === 'zh' ? '分辨率' : 'Resolution'}
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {RES_RANGES.map(r => (
                  <button
                    key={r.id}
                    onClick={() => toggleFilter('resolutionRanges', r.id)}
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium transition-all ${
                      filters.resolutionRanges.has(r.id)
                        ? 'bg-[#7c5cbf]/20 text-[#7c5cbf] border border-[#7c5cbf]/30'
                        : 'bg-claude-border-light dark:bg-[#2b2926] text-claude-text-muted border border-transparent hover:border-claude-border/50'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            {/* IF facet */}
            <div className="p-2 border-b border-claude-border/30 dark:border-[#3d3832]/30">
              <div className="flex items-center gap-1 mb-1.5">
                <Award className="h-3 w-3 text-claude-text-muted" />
                <span className="text-[9px] font-bold uppercase tracking-wider text-claude-text-muted">
                  {locale === 'zh' ? '影响因子' : 'Impact Factor'}
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {IF_RANGES.map(r => (
                  <button
                    key={r.id}
                    onClick={() => toggleFilter('ifRanges', r.id)}
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium transition-all ${
                      filters.ifRanges.has(r.id)
                        ? 'bg-[#dc2626]/20 text-[#dc2626] border border-[#dc2626]/30'
                        : 'bg-claude-border-light dark:bg-[#2b2926] text-claude-text-muted border border-transparent hover:border-claude-border/50'
                    }`}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Organism facet */}
            {availableOrganisms.length > 0 && (
              <div className="p-2">
                <div className="flex items-center gap-1 mb-1.5">
                  <Users className="h-3 w-3 text-claude-text-muted" />
                  <span className="text-[9px] font-bold uppercase tracking-wider text-claude-text-muted">
                    {locale === 'zh' ? '物种' : 'Organism'}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {availableOrganisms.map(([org, count]) => (
                    <button
                      key={org}
                      onClick={() => toggleFilter('organisms', org)}
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium transition-all max-w-[120px] ${
                        filters.organisms.has(org)
                          ? 'bg-[#c9872e]/20 text-[#c9872e] border border-[#c9872e]/30'
                          : 'bg-claude-border-light dark:bg-[#2b2926] text-claude-text-muted border border-transparent hover:border-claude-border/50'
                      }`}
                    >
                      <span className="truncate">{org.length > 15 ? org.slice(0, 14) + '…' : org}</span>
                      <span className="text-[8px] opacity-60">{count}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Clear all */}
            {activeCount > 0 && (
              <button
                onClick={clearAll}
                className="w-full flex items-center justify-center gap-1 px-2 py-1.5 text-[10px] text-claude-text-muted hover:text-red-500 border-t border-claude-border/30 dark:border-[#3d3832]/30 transition-colors"
              >
                <X className="h-2.5 w-2.5" />
                {locale === 'zh' ? '清除所有筛选' : 'Clear all filters'}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Apply facet filters to entries.
 * Returns filtered entries.
 */
export function applyFacetFilters(entries: PdbEntry[], filters: FacetFilters): PdbEntry[] {
  return entries.filter(e => {
    // Method filter
    if (filters.methods.size > 0) {
      const method = getMethodLabel(e.method || '');
      if (!filters.methods.has(method)) return false;
    }
    // Resolution filter
    if (filters.resolutionRanges.size > 0) {
      if (e.resolution == null) return false;
      const matches = Array.from(filters.resolutionRanges).some(id => {
        const range = RES_RANGES.find(r => r.id === id);
        return range && e.resolution! >= range.min && e.resolution! < range.max;
      });
      if (!matches) return false;
    }
    // IF filter
    if (filters.ifRanges.size > 0) {
      if (e.journalIf == null || e.journalIf <= 0) return false;
      const matches = Array.from(filters.ifRanges).some(id => {
        const range = IF_RANGES.find(r => r.id === id);
        return range && e.journalIf! >= range.min;
      });
      if (!matches) return false;
    }
    // Organism filter
    if (filters.organisms.size > 0) {
      if (!e.organisms) return false;
      const org = e.organisms.split('|')[0]?.trim() || e.organisms;
      if (!filters.organisms.has(org)) return false;
    }
    return true;
  });
}
