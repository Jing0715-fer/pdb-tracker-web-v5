'use client';

import React, { useState, useCallback, useRef } from 'react';
import { Search, SlidersHorizontal, LayoutGrid, List, Table, ChevronDown, X, BookOpen, Filter, Download, FileText, Copy, Network, BarChart3, ChevronRight, Map } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { generateBatchBibTeX, generateBatchRIS, generateCSV, downloadFile } from '@/lib/citation-utils';
import type { LitPaper } from '@/lib/pdb-types';
import { toast } from 'sonner';
import { useI18n } from '@/lib/i18n';

export type ViewMode = 'cards' | 'list' | 'table';
export type SortField = 'IF' | 'date' | 'title' | 'journal' | 'pmid';
export type DateFilter = 'all' | 'week' | 'month' | '3months';
export type IfFilter = 'all' | '5' | '10' | '20';

interface LiteratureToolbarProps {
  search: string;
  onSearchChange: (q: string) => void;
  sort: SortField;
  onSortChange: (s: SortField) => void;
  sortOrder: 'asc' | 'desc';
  onSortOrderChange: (o: 'asc' | 'desc') => void;
  dateFilter: DateFilter;
  onDateFilterChange: (f: DateFilter) => void;
  ifFilter: IfFilter;
  onIfFilterChange: (f: IfFilter) => void;
  hasPdbOnly: boolean;
  onHasPdbToggle: () => void;
  sourceFilter?: 'all' | 'daily';
  onSourceFilterChange?: () => void;
  viewMode: ViewMode;
  onViewModeChange: (m: ViewMode) => void;
  expandAll: boolean;
  onExpandAllToggle: () => void;
  resultCount: number;
  // Advanced filter props
  advancedFilterOpen?: boolean;
  onToggleAdvancedFilter?: () => void;
  advancedFilterCount?: number;
  advancedFilterBadges?: { label: string; onRemove: () => void }[];
  // Batch export props
  filteredPapers?: LitPaper[];
  // Daily papers count for the 日报 button
  dailyPapersCount?: number;
  // Network/Charts visibility (rendered next to IF filter)
  showCitationNetwork?: boolean;
  onToggleCitationNetwork?: () => void;
  showCharts?: boolean;
  onToggleCharts?: () => void;
  // Journal Map toggle
  showJournalMap?: boolean;
  onToggleJournalMap?: () => void;
}

const buildDateFilters = (locale: 'en' | 'zh'): { value: DateFilter; label: string }[] => [
  { value: 'all', label: locale === 'zh' ? '全部' : 'All' },
  { value: 'week', label: locale === 'zh' ? '本周' : 'This Week' },
  { value: 'month', label: locale === 'zh' ? '本月' : 'This Month' },
  { value: '3months', label: locale === 'zh' ? '近3个月' : '3 Months' },
];

const buildIfFilters = (locale: 'en' | 'zh'): { value: IfFilter; label: string }[] => [
  { value: 'all', label: locale === 'zh' ? '全部 IF' : 'All IF' },
  { value: '5', label: '≥5' },
  { value: '10', label: '≥10' },
  { value: '20', label: '≥20' },
];

const buildSortOptions = (locale: 'en' | 'zh'): { value: SortField; label: string }[] => [
  { value: 'date', label: locale === 'zh' ? '日期' : 'Date' },
  { value: 'IF', label: locale === 'zh' ? '影响因子' : 'Impact Factor' },
  { value: 'title', label: locale === 'zh' ? '标题' : 'Title' },
  { value: 'journal', label: locale === 'zh' ? '期刊' : 'Journal' },
  { value: 'pmid', label: 'PMID' },
];

// ─── Row 1: Main toolbar (search, sort, view mode, export) ────────────────────

export function LiteratureToolbarMain({
  search,
  onSearchChange,
  sort,
  onSortChange,
  sortOrder,
  onSortOrderChange,
  hasPdbOnly,
  onHasPdbToggle,
  sourceFilter = 'all',
  onSourceFilterChange,
  viewMode,
  onViewModeChange,
  expandAll,
  onExpandAllToggle,
  resultCount,
  advancedFilterOpen,
  onToggleAdvancedFilter,
  advancedFilterCount = 0,
  advancedFilterBadges = [],
  filteredPapers = [],
  dailyPapersCount = 0,
}: LiteratureToolbarProps) {
  const { locale } = useI18n();
  const SORT_OPTIONS = buildSortOptions(locale);
  const [localSearch, setLocalSearch] = useState(search);
  const [prevSearch, setPrevSearch] = useState(search);
  // Adjust local state when the parent-provided `search` prop changes (e.g. on reset).
  // Set-state during render is the React-recommended alternative to a sync effect.
  if (search !== prevSearch) {
    setPrevSearch(search);
    setLocalSearch(search);
  }
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [sortOpen, setSortOpen] = useState(false);

  const dailyCount = sourceFilter === 'daily' ? (filteredPapers.length > 0 ? filteredPapers.length : dailyPapersCount) : dailyPapersCount;

  const handleSearchInput = useCallback((val: string) => {
    setLocalSearch(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onSearchChange(val), 300);
  }, [onSearchChange]);

  const clearSearch = useCallback(() => {
    setLocalSearch('');
    onSearchChange('');
  }, [onSearchChange]);

  return (
    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3">
      {/* Search input */}
      <div className="relative flex-1 min-w-0">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-claude-text-muted" />
        <input
          type="text"
          value={localSearch}
          onChange={(e) => handleSearchInput(e.target.value)}
          placeholder={locale === 'zh' ? '按标题、作者、期刊搜索论文…' : 'Search papers by title, author, journal...'}
          className="w-full h-7 pl-8 pr-8 text-[11px] rounded-lg border border-claude-border dark:border-[#3d3832] bg-white dark:bg-[#1a1917] text-claude-text placeholder:text-claude-text-muted focus:outline-none focus:ring-2 focus:ring-claude-accent/30 input-focus-glow transition-shadow"
        />
        {localSearch && (
          <button
            onClick={clearSearch}
            className="absolute right-2 top-1/2 -translate-y-1/2 h-4 w-4 rounded-full bg-claude-border-light dark:bg-[#3d3832] flex items-center justify-center hover:bg-claude-border dark:hover:bg-[#4a4540] transition-colors"
          >
            <X className="h-2.5 w-2.5 text-claude-text-muted" />
          </button>
        )}
      </div>

      {/* Sort dropdown */}
      <div className="relative">
        <button
          onClick={() => setSortOpen(!sortOpen)}
          className="h-7 px-2.5 text-[11px] font-medium rounded-lg border border-claude-border dark:border-[#3d3832] bg-white dark:bg-[#1a1917] text-claude-text-secondary hover:bg-claude-border-light dark:hover:bg-[#2b2926] transition-colors flex items-center gap-1.5 claude-focus-ring"
        >
          <SlidersHorizontal className="h-3 w-3" />
          {SORT_OPTIONS.find(o => o.value === sort)?.label ?? (locale === 'zh' ? '排序' : 'Sort')}
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onSortOrderChange(sortOrder === 'asc' ? 'desc' : 'asc'); }}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onSortOrderChange(sortOrder === 'asc' ? 'desc' : 'asc'); } }}
            className="ml-0.5 text-[10px] text-claude-text-muted hover:text-claude-accent dark:hover:text-claude-accent-hover cursor-pointer select-none"
          >
            {sortOrder === 'asc' ? '↑' : '↓'}
          </span>
          <ChevronDown className="h-3 w-3 text-claude-text-muted" />
        </button>
        {sortOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setSortOpen(false)} />
            <div className="absolute right-0 top-full mt-1 z-20 min-w-[160px] py-1 rounded-lg border border-claude-border dark:border-[#3d3832] bg-white dark:bg-[#242220] shadow-lg">
              {SORT_OPTIONS.map(opt => (
                <button
                  key={opt.value}
                  onClick={() => { onSortChange(opt.value); setSortOpen(false); }}
                  className={`w-full text-left px-3 py-1.5 text-xs hover:bg-claude-border-light dark:hover:bg-[#2b2926] transition-colors ${
                    sort === opt.value ? 'text-claude-accent font-medium' : 'text-claude-text-secondary'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Advanced Filters toggle */}
      {onToggleAdvancedFilter && (
        <div className="flex items-center gap-1.5">
          <Button
            variant={advancedFilterCount > 0 ? 'default' : 'outline'}
            size="sm"
            onClick={onToggleAdvancedFilter}
            className={`h-7 px-2.5 text-[11px] gap-1.5 ${
              advancedFilterCount > 0
                ? 'bg-claude-accent hover:bg-claude-accent-hover text-white'
                : 'border-claude-border dark:border-[#3d3832] text-claude-text-secondary hover:bg-claude-border-light dark:hover:bg-[#2b2926]'
            }`}
          >
            <Filter className="h-3 w-3" />
            {locale === 'zh' ? '筛选' : 'Filters'}
            {advancedFilterCount > 0 && (
              <span className="inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-white/20 text-[9px] font-bold">
                {advancedFilterCount}
              </span>
            )}
          </Button>
          {/* Active advanced filter badges */}
          {advancedFilterCount > 0 && !advancedFilterOpen && advancedFilterBadges.slice(0, 2).map((badge, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-medium bg-claude-accent/10 text-claude-accent dark:bg-claude-accent/20 dark:text-claude-accent-hover"
            >
              {badge.label.length > 12 ? badge.label.slice(0, 12) + '…' : badge.label}
              <button onClick={badge.onRemove} className="hover:text-claude-text transition-colors">
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
          {advancedFilterBadges.length > 2 && !advancedFilterOpen && (
            <span className="text-[9px] text-claude-text-muted">+{advancedFilterBadges.length - 2}</span>
          )}
        </div>
      )}

      {/* Has PDB toggle */}
      <Button
        variant={hasPdbOnly ? 'default' : 'outline'}
        size="sm"
        onClick={onHasPdbToggle}
        className={`h-7 px-2.5 text-[11px] gap-1.5 ${
          hasPdbOnly
            ? 'bg-claude-accent hover:bg-claude-accent-hover text-white'
            : 'border-claude-border dark:border-[#3d3832] text-claude-text-secondary hover:bg-claude-border-light dark:hover:bg-[#2b2926]'
        }`}
      >
        <BookOpen className="h-3 w-3" />
        {locale === 'zh' ? '含 PDB' : 'Has PDB'}
      </Button>

      {/* Source filter (日报) toggle */}
      {onSourceFilterChange && (
        <Button
          variant={sourceFilter === 'daily' ? 'default' : 'outline'}
          size="sm"
          onClick={onSourceFilterChange}
          className={`h-7 px-2.5 text-[11px] gap-1.5 ${
            sourceFilter === 'daily'
              ? 'bg-claude-accent hover:bg-claude-accent-hover text-white'
              : 'border-claude-border dark:border-[#3d3832] text-claude-text-secondary hover:bg-claude-border-light dark:hover:bg-[#2b2926]'
          }`}
          title={locale === 'zh' ? '仅显示日报论文' : 'Filter to Daily papers'}
        >
          <BookOpen className="h-3 w-3" />
          {locale === 'zh' ? '日报' : 'Daily'}{sourceFilter === 'daily' && dailyCount > 0 ? ` (${dailyCount})` : ''}
        </Button>
      )}

      {/* Expand toggle */}
      <Button
        variant="outline"
        size="sm"
        onClick={onExpandAllToggle}
        className="h-7 px-2.5 text-[11px] gap-1.5 border-claude-border dark:border-[#3d3832] text-claude-text-secondary hover:bg-claude-border-light dark:hover:bg-[#2b2926]"
      >
        {expandAll ? (locale === 'zh' ? '折叠' : 'Collapse') : (locale === 'zh' ? '展开' : 'Expand')}
      </Button>

      {/* View mode toggle */}
      <div className="flex rounded-lg border border-claude-border dark:border-[#3d3832] overflow-hidden">
        {([
          { mode: 'cards' as ViewMode, icon: LayoutGrid, label: locale === 'zh' ? '卡片' : 'Cards' },
          { mode: 'list' as ViewMode, icon: List, label: locale === 'zh' ? '列表' : 'List' },
          { mode: 'table' as ViewMode, icon: Table, label: locale === 'zh' ? '表格' : 'Table' },
        ]).map(({ mode, icon: Icon, label }) => (
          <button
            key={mode}
            onClick={() => onViewModeChange(mode)}
            title={label}
            className={`h-7 px-2.5 flex items-center justify-center transition-colors ${
              viewMode === mode
                ? 'bg-claude-accent/10 text-claude-accent dark:bg-claude-accent/20 dark:text-claude-accent-hover'
                : 'bg-white dark:bg-[#1a1917] text-claude-text-muted hover:bg-claude-border-light dark:hover:bg-[#2b2926]'
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
          </button>
        ))}
      </div>

      {/* Export Citations dropdown */}
      {filteredPapers.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-7 px-2.5 text-[11px] gap-1.5 border-claude-border dark:border-[#3d3832] text-claude-text-secondary hover:bg-claude-border-light dark:hover:bg-[#2b2926]"
            >
              <Download className="h-3.5 w-3.5" />
              {locale === 'zh' ? '导出' : 'Export'}
              <ChevronDown className="h-3 w-3" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem
              onClick={() => {
                const content = generateBatchBibTeX(filteredPapers);
                downloadFile(content, 'citations.bib', 'application/x-bibtex');
                toast.success(locale === 'zh' ? `已导出 ${filteredPapers.length} 篇为 BibTeX` : `Exported ${filteredPapers.length} papers as BibTeX`);
              }}
            >
              <FileText className="h-3.5 w-3.5 mr-2" />
              {locale === 'zh' ? '全部导出为 BibTeX (.bib)' : 'Export All as BibTeX (.bib)'}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => {
                const content = generateBatchRIS(filteredPapers);
                downloadFile(content, 'citations.ris', 'application/x-research-info-systems');
                toast.success(locale === 'zh' ? `已导出 ${filteredPapers.length} 篇为 RIS` : `Exported ${filteredPapers.length} papers as RIS`);
              }}
            >
              <FileText className="h-3.5 w-3.5 mr-2" />
              {locale === 'zh' ? '全部导出为 RIS (.ris)' : 'Export All as RIS (.ris)'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={async () => {
                const apaCitations = filteredPapers.map(p => {
                  const authors = p.authors || 'Unknown';
                  const year = p.pubdate ? p.pubdate.match(/\d{4}/)?.[0] || '' : '';
                  return `${authors} (${year}). ${p.title}. ${p.journal}${p.doi ? `. https://doi.org/${p.doi}` : ''}. PMID: ${p.pmid}.`;
                }).join('\n\n');
                await navigator.clipboard.writeText(apaCitations);
                toast.success(locale === 'zh' ? `已复制 ${filteredPapers.length} 条 APA 引用到剪贴板` : `Copied ${filteredPapers.length} APA citations to clipboard`);
              }}
            >
              <Copy className="h-3.5 w-3.5 mr-2" />
              {locale === 'zh' ? '复制全部 APA 引用' : 'Copy All APA Citations'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={() => {
                const content = generateCSV(filteredPapers);
                downloadFile(content, 'citations.csv', 'text/csv');
                toast.success(locale === 'zh' ? `已导出 ${filteredPapers.length} 篇为 CSV` : `Exported ${filteredPapers.length} papers as CSV`);
              }}
            >
              <Download className="h-3.5 w-3.5 mr-2" />
              {locale === 'zh' ? '全部导出为 CSV' : 'Export All as CSV'}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

// ─── Row 2: Filter chips (Date, IF, Network, Charts) ──────────────────────────
// Same ghost-button format as Weekly & Assessment modules' filter bars

export function LiteratureToolbarChips({
  dateFilter,
  onDateFilterChange,
  ifFilter,
  onIfFilterChange,
  showCitationNetwork = false,
  onToggleCitationNetwork,
  showCharts = false,
  onToggleCharts,
  showJournalMap = false,
  onToggleJournalMap,
  resultCount,
  hasPdbOnly,
  search,
  advancedFilterCount = 0,
}: LiteratureToolbarProps) {
  const { locale } = useI18n();
  const DATE_FILTERS = buildDateFilters(locale);
  const IF_FILTERS = buildIfFilters(locale);
  const hasActiveFilters = dateFilter !== 'all' || ifFilter !== 'all' || hasPdbOnly || search !== '' || advancedFilterCount > 0;

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {/* Date filter group */}
      {DATE_FILTERS.map(f => (
        <Button
          key={f.value}
          variant="ghost"
          size="sm"
          onClick={() => onDateFilterChange(f.value)}
          className={`h-7 px-2.5 text-[11px] ${
            dateFilter === f.value
              ? 'bg-claude-accent/10 text-claude-accent'
              : 'text-claude-text-muted'
          }`}
        >
          {f.label}
        </Button>
      ))}

      <span className="text-claude-border dark:text-[#3d3832] mx-1">|</span>

      {/* IF filter group */}
      {IF_FILTERS.map(f => (
        <Button
          key={f.value}
          variant="ghost"
          size="sm"
          onClick={() => onIfFilterChange(f.value)}
          className={`h-7 px-2.5 text-[11px] ${
            ifFilter === f.value
              ? 'bg-claude-accent/10 text-claude-accent'
              : 'text-claude-text-muted'
          }`}
        >
          {f.label}
        </Button>
      ))}

      <span className="text-claude-border dark:text-[#3d3832] mx-1">|</span>

      {/* Network button */}
      {onToggleCitationNetwork && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleCitationNetwork}
          className={`h-7 px-2.5 text-[11px] ${
            showCitationNetwork
              ? 'bg-claude-accent/10 text-claude-accent'
              : 'text-claude-text-muted'
          }`}
        >
          <Network className="h-3 w-3 mr-1" />
          {showCitationNetwork ? (locale === 'zh' ? '隐藏网络' : 'Hide Network') : (locale === 'zh' ? '网络' : 'Network')}
        </Button>
      )}
      {/* Charts button */}
      {onToggleCharts && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleCharts}
          className={`h-7 px-2.5 text-[11px] ${
            showCharts
              ? 'bg-claude-accent/10 text-claude-accent'
              : 'text-claude-text-muted'
          }`}
        >
          <BarChart3 className="h-3 w-3 mr-1" />
          {showCharts ? (locale === 'zh' ? '隐藏图表' : 'Hide Charts') : (locale === 'zh' ? '图表' : 'Charts')}
        </Button>
      )}
      {/* Journal Map button */}
      {onToggleJournalMap && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onToggleJournalMap}
          className={`h-7 px-2.5 text-[11px] ${
            showJournalMap
              ? 'bg-claude-accent/10 text-claude-accent'
              : 'text-claude-text-muted'
          }`}
        >
          <Map className="h-3 w-3 mr-1" />
          {showJournalMap ? (locale === 'zh' ? '隐藏地图' : 'Hide Map') : (locale === 'zh' ? '期刊地图' : 'Journal Map')}
        </Button>
      )}

      {hasActiveFilters && (
        <span className="ml-auto text-[11px] text-claude-text-muted">
          {locale === 'zh' ? `${resultCount} 条结果` : `${resultCount} result${resultCount !== 1 ? 's' : ''}`}
        </span>
      )}
    </div>
  );
}

// ─── Combined LiteratureToolbar (backward-compatible) ──────────────────────────

export function LiteratureToolbar(props: LiteratureToolbarProps) {
  return (
    <div className="space-y-3">
      <LiteratureToolbarMain {...props} />
      <LiteratureToolbarChips {...props} />
    </div>
  );
}
