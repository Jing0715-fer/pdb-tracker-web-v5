'use client';

import React, { useState, useRef, useEffect } from 'react';
import { Search, Filter, ArrowUpDown, X, Download, ChevronDown } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { exportToCSV, exportToJSON, formatPdbEntryForExport } from '@/lib/export-utils';
import { toast } from 'sonner';
import type { PdbEntry } from '@/lib/pdb-types';
import { useI18n } from '@/lib/i18n';

// ─── Filter Chip Config ───────────────────────────────────────────────────────

function useFilterChips() {
  const { t } = useI18n();
  return [
    { key: 'all', label: t.filterAll, color: '' },
    { key: 'bookmarks', label: t.filterBookmarks, color: 'border-claude-accent/40 text-claude-accent bg-claude-accent/10 dark:bg-claude-accent/20' },
    { key: 'Cryo-EM', label: t.filterCryoem, color: 'border-claude-cryoem/40 text-claude-cryoem bg-claude-cryoem-bg' },
    { key: 'X-RAY DIFFRACTION', label: t.filterXray, color: 'border-claude-xray/40 text-claude-xray bg-claude-xray-bg' },
    { key: 'SOLUTION NMR', label: t.filterNmr, color: 'border-claude-nmr/40 text-claude-nmr bg-claude-nmr-bg' },
    { key: 'high-if', label: t.filterHighIf, color: 'border-claude-high/40 text-claude-high bg-claude-high-bg' },
    { key: 'top-if', label: t.filterTopIf, color: 'border-claude-top/40 text-claude-top bg-claude-top-bg' },
  ];
}

// ─── Sort Options ──────────────────────────────────────────────────────────────

function useSortOptions() {
  const { t, locale } = useI18n();
  return [
    { value: 'releaseDate', label: t.date },
    { value: 'pdbId', label: 'PDB ID' },
    { value: 'resolution', label: locale === 'zh' ? '分辨率' : 'Resolution' },
    { value: 'journalIf', label: 'IF' },
    { value: 'method', label: locale === 'zh' ? '方法' : 'Method' },
  ];
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface WeeklyPageControlsProps {
  activeFilter: string;
  onFilterChange: (filter: string) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  sortField: string;
  sortDir: 'asc' | 'desc';
  onSort: (field: string) => void;
  totalCount: number;
  selectedWeek: string | null;
  filteredEntries: PdbEntry[];
}

// ─── Component ────────────────────────────────────────────────────────────────

export function WeeklyPageControls({
  activeFilter,
  onFilterChange,
  searchQuery,
  onSearchChange,
  sortField,
  sortDir,
  onSort,
  totalCount,
  selectedWeek,
  filteredEntries,
}: WeeklyPageControlsProps) {
  const [exportOpen, setExportOpen] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement>(null);

  const FILTER_CHIPS = useFilterChips();
  const SORT_OPTIONS = useSortOptions();
  const { locale } = useI18n();

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!exportOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [exportOpen]);

  const handleExportCSV = () => {
    if (!filteredEntries.length) return;
    const formatted = filteredEntries.map(formatPdbEntryForExport);
    const weekSuffix = selectedWeek ? `-${selectedWeek}` : '';
    exportToCSV(formatted, `pdb-entries${weekSuffix}`);
    setExportOpen(false);
    toast.success('Export complete', { description: `${formatted.length} entries exported as CSV` });
  };

  const handleExportJSON = () => {
    if (!filteredEntries.length) return;
    const formatted = filteredEntries.map(formatPdbEntryForExport);
    const weekSuffix = selectedWeek ? `-${selectedWeek}` : '';
    exportToJSON(formatted, `pdb-entries${weekSuffix}`);
    setExportOpen(false);
    toast.success('Export complete', { description: `${formatted.length} entries exported as JSON` });
  };

  return (
    <div className="flex-shrink-0 border-b border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] px-4 py-2 min-w-0">
      <div className="flex items-center gap-3 flex-wrap min-w-0">
        {/* Filter Chips */}
        <div className="flex items-center gap-1.5">
          <Filter className="h-3.5 w-3.5 text-claude-text-muted flex-shrink-0" />
          {FILTER_CHIPS.map(chip => {
            const isActive = activeFilter === chip.key;
            return (
              <button
                key={chip.key}
                onClick={() => onFilterChange(chip.key)}
                className={`inline-flex items-center px-2 py-1 rounded-md text-[11px] font-medium border transition-all duration-100 claude-focus-ring ${
                  isActive
                    ? chip.color || 'bg-claude-accent-light dark:bg-[#3d2a22] border-claude-accent/40 text-claude-accent'
                    : 'border-claude-border dark:border-[#3d3832] text-claude-text-muted bg-transparent hover:bg-claude-border-light dark:hover:bg-[#2b2926]'
                }`}
              >
                {chip.label}
              </button>
            );
          })}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Mobile Search */}
        <div className="relative w-full md:hidden mt-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-claude-text-muted" />
          <Input
            type="text"
            placeholder="Search..."
            value={searchQuery}
            onChange={e => onSearchChange(e.target.value)}
            className="h-7 pl-8 pr-7 text-xs bg-claude-bg dark:bg-[#1a1917] border-claude-border dark:border-[#3d3832]"
          />
          {searchQuery && (
            <button
              onClick={() => onSearchChange('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-claude-text-muted hover:text-claude-text"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Sort Controls */}
        <div className="hidden sm:flex items-center gap-1.5">
          <ArrowUpDown className="h-3 w-3 text-claude-text-muted" />
          <select
            value={sortField}
            onChange={e => onSort(e.target.value)}
            className="h-6 px-1.5 text-[10px] font-medium rounded border border-claude-border dark:border-[#3d3832] bg-white dark:bg-[#1a1917] text-claude-text-secondary cursor-pointer"
          >
            {SORT_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onSort(sortField)}
            className="h-6 px-1.5 text-[10px] text-claude-text-muted"
          >
            {sortDir === 'asc' ? '↑' : '↓'}
          </Button>
        </div>

        {/* Export Dropdown */}
        <div className="relative hidden sm:block" ref={exportMenuRef}>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setExportOpen(!exportOpen)}
            disabled={!filteredEntries.length}
            className="h-6 px-1.5 text-[10px] text-claude-text-muted hover:text-claude-text hover:bg-claude-border-light dark:hover:bg-[#2b2926] gap-1"
            title="Export data"
          >
            <Download className="h-3 w-3" />
            <ChevronDown className={`h-2.5 w-2.5 transition-transform ${exportOpen ? 'rotate-180' : ''}`} />
          </Button>
          {exportOpen && (
            <div className="absolute right-0 top-full mt-1 z-50 bg-white dark:bg-[#2b2926] border border-claude-border dark:border-[#3d3832] rounded-md shadow-lg py-1 min-w-[140px]">
              <button
                onClick={handleExportCSV}
                className="w-full text-left px-3 py-1.5 text-[11px] text-claude-text-secondary hover:bg-claude-border-light dark:hover:bg-[#3d3832] hover:text-claude-text transition-colors"
              >
                Export as CSV
              </button>
              <button
                onClick={handleExportJSON}
                className="w-full text-left px-3 py-1.5 text-[11px] text-claude-text-secondary hover:bg-claude-border-light dark:hover:bg-[#3d3832] hover:text-claude-text transition-colors"
              >
                Export as JSON
              </button>
            </div>
          )}
        </div>

        {/* Count */}
        <div className="text-[11px] text-claude-text-muted hidden sm:block">
          <span className="font-mono font-semibold text-claude-text-secondary">{totalCount}</span> {locale === 'zh' ? '条' : 'entries'}
          {selectedWeek && <span className="ml-1">· {selectedWeek}</span>}
        </div>
      </div>
    </div>
  );
}
