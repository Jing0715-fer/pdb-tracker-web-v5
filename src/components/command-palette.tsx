'use client';

import React, { useEffect, useCallback, useState, useRef, useMemo } from 'react';
import {
  Database,
  FlaskConical,
  BookOpen,
  Sun,
  Moon,
  BarChart3,
  Search,
  Loader2,
  Microscope,
  Hexagon,
  FileText,
  Clock,
  X,
  TrendingUp,
  Zap,
  Calendar,
  ArrowRight,
  Trash2,
} from 'lucide-react';
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command';
import type { PdbEntry, Evaluation, LitPaper } from '@/lib/pdb-types';
import { getMethodLabel } from '@/components/pdb-helpers';
import { useI18n } from '@/lib/i18n';

// ─── Search Result Types ──────────────────────────────────────────────────────

interface PdbSearchResult {
  pdbId: string;
  title: string | null;
  method: string | null;
  weekId: string | null;
  resolution: number | null;
}

interface EvalSearchResult {
  uniprotId: string;
  proteinName: string | null;
  geneNames: string | null;
}

interface PaperSearchResult {
  pmid: string;
  title: string;
  journal: string;
}

interface SearchResults {
  entries: PdbSearchResult[];
  evaluations: EvalSearchResult[];
  papers: PaperSearchResult[];
}

// ─── Cached Search Results ─────────────────────────────────────────────────────

interface CachedResult {
  results: SearchResults;
  timestamp: number;
}

const SEARCH_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const searchCache = new Map<string, CachedResult>();

function getCachedResults(query: string): SearchResults | null {
  const cached = searchCache.get(query);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > SEARCH_CACHE_TTL) {
    searchCache.delete(query);
    return null;
  }
  return cached.results;
}

function setCachedResults(query: string, results: SearchResults): void {
  searchCache.set(query, { results, timestamp: Date.now() });
}

// ─── Recent Searches Hook ─────────────────────────────────────────────────────

const RECENT_SEARCHES_KEY = 'pdb-recent-searches';
const MAX_RECENT_SEARCHES = 10;

function useRecentSearches() {
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const stored = localStorage.getItem(RECENT_SEARCHES_KEY);
      if (stored) {
        const parsed: unknown = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          return parsed.slice(0, MAX_RECENT_SEARCHES);
        }
      }
    } catch {
      // ignore parse errors
    }
    return [];
  });

  const addRecentSearch = useCallback((query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;

    setRecentSearches(prev => {
      // Dedup: remove existing, add to front
      const filtered = prev.filter(s => s.toLowerCase() !== trimmed.toLowerCase());
      const next = [trimmed, ...filtered].slice(0, MAX_RECENT_SEARCHES);
      try {
        localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
      } catch {
        // ignore storage errors
      }
      return next;
    });
  }, []);

  const removeRecentSearch = useCallback((query: string) => {
    setRecentSearches(prev => {
      const next = prev.filter(s => s !== query);
      try {
        localStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const clearRecentSearches = useCallback(() => {
    setRecentSearches([]);
    try {
      localStorage.removeItem(RECENT_SEARCHES_KEY);
    } catch {
      // ignore
    }
  }, []);

  return { recentSearches, addRecentSearch, removeRecentSearch, clearRecentSearches };
}

// ─── Method Badge for search results ─────────────────────────────────────────

function MethodBadge({ method }: { method: string | null }) {
  const label = method ? getMethodLabel(method) : '';
  if (!label) return null;
  const m = method?.toUpperCase() || '';
  let colorClass = 'text-claude-other bg-claude-other-bg';
  if (m.includes('CRYO') || m.includes('ELECTRON MICROSCOPY')) colorClass = 'text-claude-cryoem bg-claude-cryoem-bg';
  else if (m.includes('X-RAY') || m.includes('XRAY')) colorClass = 'text-claude-xray bg-claude-xray-bg';
  else if (m.includes('NMR')) colorClass = 'text-claude-nmr bg-claude-nmr-bg';

  return (
    <span className={`inline-flex items-center px-1.5 py-0 rounded text-[9px] font-semibold ${colorClass}`}>
      {label}
    </span>
  );
}

// ─── Text Highlighting ─────────────────────────────────────────────────────────

function HighlightedText({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;

  const q = query.trim();
  const regex = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
  const parts = text.split(regex);

  return (
    <>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark key={i} className="bg-claude-accent-light dark:bg-claude-accent-light/30 text-claude-accent rounded-sm px-0.5">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        )
      )}
    </>
  );
}

// ─── Quick Filter Definition ──────────────────────────────────────────────────

interface QuickFilter {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  action: () => void;
}

// ─── Props ──────────────────────────────────────────────────────────────────────

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSwitchMode: (mode: 'weekly' | 'evaluation' | 'literature') => void;
  onToggleTheme: () => void;
  onToggleCharts: () => void;
  currentMode: string;
  isDark: boolean;
  // Search result navigation callbacks
  onSelectPdbEntry?: (entry: PdbSearchResult) => void;
  onSelectEvaluation?: (evalResult: EvalSearchResult) => void;
  onSelectPaper?: (paper: PaperSearchResult) => void;
  // Already-loaded evaluations for client-side search
  evaluations?: Evaluation[];
  // Quick filter callback
  onApplyQuickFilter?: (filterId: string) => void;
  // Set search query in the main view
  onSetSearchQuery?: (query: string) => void;
}

// ─── Debounce Hook ──────────────────────────────────────────────────────────────

function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debouncedValue;
}

// ─── Result Count Badge ────────────────────────────────────────────────────────

function ResultCountBadge({ count }: { count: number }) {
  return (
    <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[16px] px-1 rounded-full text-[9px] font-bold bg-claude-accent/10 text-claude-accent">
      {count}
    </span>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────────

export function CommandPalette({
  open,
  onOpenChange,
  onSwitchMode,
  onToggleTheme,
  onToggleCharts,
  currentMode,
  isDark,
  onSelectPdbEntry,
  onSelectEvaluation,
  onSelectPaper,
  evaluations,
  onApplyQuickFilter,
  onSetSearchQuery,
}: CommandPaletteProps) {
  const { t, locale } = useI18n();
  const [searchValue, setSearchValue] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResults>({ entries: [], evaluations: [], papers: [] });
  // Track the query that produced the current results, to derive loading state
  const [searchedQuery, setSearchedQuery] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const { recentSearches, addRecentSearch, removeRecentSearch, clearRecentSearches } = useRecentSearches();

  const debouncedQuery = useDebounce(searchValue, 300);

  // Track whether palette was open to reset state on close
  const [prevOpen, setPrevOpen] = useState(false);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (prevOpen && !open) {
      // Palette just close - reset search state synchronously during render
      setSearchValue('');
      setSearchResults({ entries: [], evaluations: [], papers: [] });
      setSearchedQuery('');
    }
  }

  // Close on Escape
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        e.preventDefault();
        onOpenChange(false);
      }
    },
    [open, onOpenChange],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Lock body scroll when open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  // ─── Fuzzy Search Logic ───────────────────────────────────────────────────

  const filterEvaluations = useCallback((query: string, evals: Evaluation[]): EvalSearchResult[] => {
    if (!query.trim() || !evals.length) return [];
    const q = query.toLowerCase();
    return evals
      .filter(e =>
        (e.proteinName?.toLowerCase().includes(q)) ||
        (e.uniprotId?.toLowerCase().includes(q)) ||
        (e.geneNames?.toLowerCase().includes(q)) ||
        (e.organism?.toLowerCase().includes(q))
      )
      .slice(0, 5)
      .map(e => ({
        uniprotId: e.uniprotId,
        proteinName: e.proteinName,
        geneNames: e.geneNames,
      }));
  }, []);

  // Fetch search results when debounced query changes
  useEffect(() => {
    if (!open || !debouncedQuery.trim()) {
      return;
    }

    const query = debouncedQuery.trim();

    // Cancel previous request
    if (abortRef.current) {
      abortRef.current.abort();
    }
    const controller = new AbortController();
    abortRef.current = controller;

    async function fetchResults() {
      // Check cache first (inside async to avoid sync setState in effect)
      const cached = getCachedResults(query);
      if (cached) {
        setSearchResults(cached);
        setSearchedQuery(query);
        return;
      }

      try {
        // Fetch PDB entries and papers in parallel
        const [entriesRes, papersRes] = await Promise.all([
          fetch(`/api/entries?q=${encodeURIComponent(query)}&limit=5`, { signal: controller.signal }),
          fetch(`/api/literature/papers?q=${encodeURIComponent(query)}`, { signal: controller.signal }),
        ]);

        let entries: PdbSearchResult[] = [];
        let papers: PaperSearchResult[] = [];

        if (entriesRes.ok) {
          const data: PdbEntry[] = await entriesRes.json();
          entries = data.slice(0, 5).map(e => ({
            pdbId: e.pdbId,
            title: e.title,
            method: e.method,
            weekId: e.weekId,
            resolution: e.resolution,
          }));
        }

        if (papersRes.ok) {
          const data: LitPaper[] = await papersRes.json();
          papers = data.slice(0, 5).map(p => ({
            pmid: p.pmid,
            title: p.title,
            journal: p.journal,
          }));
        }

        // Filter evaluations client-side
        const evalResults = filterEvaluations(query, evaluations || []);

        if (!controller.signal.aborted) {
          const results: SearchResults = { entries, evaluations: evalResults, papers };
          setCachedResults(query, results);
          setSearchResults(results);
          setSearchedQuery(query);
        }
      } catch (err: unknown) {
        const error = err as { name?: string };
        if (error?.name !== 'AbortError') {
          console.error('Search error:', err);
        }
      }
    }

    fetchResults();

    return () => {
      controller.abort();
    };
  }, [debouncedQuery, open, evaluations, filterEvaluations]);

  // Derive whether we're actively searching (query changed but results haven't arrived yet)
  const isSearching = debouncedQuery.trim().length > 0 && searchedQuery !== debouncedQuery.trim();
  const hasResults = searchResults.entries.length > 0 || searchResults.evaluations.length > 0 || searchResults.papers.length > 0;
  const showSearchResults = debouncedQuery.trim().length > 0;

  const handleSelect = useCallback(
    (callback: () => void) => {
      onOpenChange(false);
      callback();
    },
    [onOpenChange],
  );

  // Truncate helper
  const truncate = (str: string, max: number) => str.length > max ? str.slice(0, max) + '…' : str;

  // Handle recent search click
  const handleRecentSearchClick = useCallback((query: string) => {
    setSearchValue(query);
  }, []);

  // Handle performing a search and adding to recent
  const handlePerformSearch = useCallback((query: string) => {
    if (query.trim()) {
      addRecentSearch(query);
    }
  }, [addRecentSearch]);

  // Add to recent searches when a search completes with results
  useEffect(() => {
    if (searchedQuery && hasResults) {
      addRecentSearch(searchedQuery);
    }
  }, [searchedQuery, hasResults, addRecentSearch]);

  // Handle "Search all for query" link
  const handleSearchAll = useCallback(() => {
    const query = searchValue.trim();
    if (query && onSetSearchQuery) {
      onSetSearchQuery(query);
    }
    onOpenChange(false);
  }, [searchValue, onSetSearchQuery, onOpenChange]);

  // Quick filters definition
  const quickFilters: QuickFilter[] = useMemo(() => [
    {
      id: 'high-impact',
      label: 'High Impact (IF ≥ 20)',
      description: 'Show structures from high-impact journals',
      icon: <TrendingUp className="h-4 w-4 text-claude-top" />,
      action: () => {
        onApplyQuickFilter?.('high-impact');
        onOpenChange(false);
      },
    },
    {
      id: 'cryo-em',
      label: 'Cryo-EM structures',
      description: locale === 'zh' ? '仅筛选 Cryo-EM 方法' : 'Filter to Cryo-EM method only',
      icon: <Microscope className="h-4 w-4 text-claude-cryoem" />,
      action: () => {
        onApplyQuickFilter?.('cryo-em');
        onOpenChange(false);
      },
    },
    {
      id: 'recent-evaluations',
      label: locale === 'zh' ? '最近的评估' : 'Recent evaluations',
      description: locale === 'zh' ? '切换到评估视图' : 'Switch to evaluation view',
      icon: <FlaskConical className="h-4 w-4 text-claude-xray" />,
      action: () => {
        onSwitchMode('evaluation');
        onOpenChange(false);
      },
    },
    {
      id: 'top-journals',
      label: locale === 'zh' ? '顶级期刊' : 'Top journals',
      description: locale === 'zh' ? '切换到文献视图' : 'Switch to literature view',
      icon: <BookOpen className="h-4 w-4 text-claude-nmr" />,
      action: () => {
        onSwitchMode('literature');
        onOpenChange(false);
      },
    },
    {
      id: 'this-week',
      label: locale === 'zh' ? '本周结构' : 'Structures this week',
      description: locale === 'zh' ? '切换到周报（最新周）' : 'Switch to weekly with latest week',
      icon: <Calendar className="h-4 w-4 text-claude-accent" />,
      action: () => {
        onApplyQuickFilter?.('this-week');
        onOpenChange(false);
      },
    },
  ], [onApplyQuickFilter, onSwitchMode, onOpenChange, locale]);

  // Total results count
  const totalResults = searchResults.entries.length + searchResults.evaluations.length + searchResults.papers.length;

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm command-palette-backdrop"
        onClick={() => onOpenChange(false)}
      />

      {/* Command Palette Panel */}
      <div className="fixed inset-x-0 top-0 z-50 flex justify-center pt-[15vh]">
        <div className="w-full max-w-lg command-palette-panel">
          <Command
            className="rounded-xl border border-claude-border dark:border-[#3d3832] bg-claude-surface dark:bg-[#242220] shadow-2xl shadow-black/20 dark:shadow-black/40"
            loop
          >
            {/* Search Input */}
            <div className="flex items-center border-b border-claude-border dark:border-[#3d3832] px-3">
              <Search className="h-4 w-4 shrink-0 text-claude-text-muted" />
              <CommandInput
                placeholder={t.searchAll}
                className="flex h-11 w-full bg-transparent py-3 text-sm text-claude-text placeholder:text-claude-text-muted outline-none"
                value={searchValue}
                onValueChange={setSearchValue}
              />
              {isSearching && (
                <Loader2 className="h-4 w-4 shrink-0 text-claude-accent animate-spin" />
              )}
              {searchValue && !isSearching && (
                <button
                  onClick={() => setSearchValue('')}
                  className="h-5 w-5 shrink-0 flex items-center justify-center rounded-sm text-claude-text-muted hover:text-claude-text transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <CommandList className="max-h-[420px] overflow-y-auto p-1 custom-scrollbar">
              {!showSearchResults ? (
                <>
                  {/* Recent Searches */}
                  {recentSearches.length > 0 && (
                    <CommandGroup
                      heading="Recent Searches"
                      className="[&_[cmdk-group-heading]]:text-claude-text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider"
                    >
                      {recentSearches.map(query => (
                        <CommandItem
                          key={`recent-${query}`}
                          value={`recent-${query}`}
                          onSelect={() => handleRecentSearchClick(query)}
                          className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer text-claude-text-secondary data-[selected=true]:bg-claude-accent/10 data-[selected=true]:text-claude-accent group"
                        >
                          <Clock className="h-3.5 w-3.5 text-claude-text-muted shrink-0" />
                          <span className="flex-1 text-sm truncate">{query}</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              removeRecentSearch(query);
                            }}
                            className="h-5 w-5 flex items-center justify-center rounded-sm text-claude-text-muted opacity-0 group-hover:opacity-100 hover:text-claude-accent transition-all"
                            aria-label={`Remove "${query}" from recent searches`}
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </CommandItem>
                      ))}
                      <CommandItem
                        value="clear-recent-searches"
                        onSelect={clearRecentSearches}
                        className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg cursor-pointer text-claude-text-muted hover:text-claude-accent data-[selected=true]:bg-claude-accent/10 data-[selected=true]:text-claude-accent"
                      >
                        <Trash2 className="h-3 w-3 shrink-0" />
                        <span className="flex-1 text-xs">Clear all recent searches</span>
                      </CommandItem>
                    </CommandGroup>
                  )}

                  {recentSearches.length > 0 && (
                    <CommandSeparator className="bg-claude-border dark:bg-[#3d3832] my-1" />
                  )}

                  {/* Quick Filters */}
                  <CommandGroup
                    heading="Quick Filters"
                    className="[&_[cmdk-group-heading]]:text-claude-text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider"
                  >
                    {quickFilters.map(filter => (
                      <CommandItem
                        key={filter.id}
                        value={`filter-${filter.id}`}
                        onSelect={filter.action}
                        className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer text-claude-text-secondary data-[selected=true]:bg-claude-accent/10 data-[selected=true]:text-claude-accent"
                      >
                        {filter.icon}
                        <div className="flex-1 min-w-0">
                          <span className="text-sm block">{filter.label}</span>
                          <span className="text-[10px] text-claude-text-muted block">{filter.description}</span>
                        </div>
                        <Zap className="h-3 w-3 text-claude-text-muted shrink-0" />
                      </CommandItem>
                    ))}
                  </CommandGroup>

                  <CommandSeparator className="bg-claude-border dark:bg-[#3d3832] my-1" />

                  {/* Mode Switching */}
                  <CommandGroup
                    heading="Switch Mode"
                    className="[&_[cmdk-group-heading]]:text-claude-text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider"
                  >
                    <CommandItem
                      onSelect={() => handleSelect(() => onSwitchMode('weekly'))}
                      className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer text-claude-text-secondary data-[selected=true]:bg-claude-accent/10 data-[selected=true]:text-claude-accent"
                      disabled={currentMode === 'weekly'}
                    >
                      <Database className="h-4 w-4 text-claude-accent" />
                      <span className="flex-1 text-sm">
                        Switch to Weekly
                        {currentMode === 'weekly' && (
                          <span className="ml-1.5 text-[10px] text-claude-text-muted">(current)</span>
                        )}
                      </span>
                      <CommandShortcut className="text-[10px] text-claude-text-muted">1</CommandShortcut>
                    </CommandItem>

                    <CommandItem
                      onSelect={() => handleSelect(() => onSwitchMode('evaluation'))}
                      className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer text-claude-text-secondary data-[selected=true]:bg-claude-accent/10 data-[selected=true]:text-claude-accent"
                      disabled={currentMode === 'evaluation'}
                    >
                      <FlaskConical className="h-4 w-4 text-claude-accent" />
                      <span className="flex-1 text-sm">
                        Switch to Evaluation
                        {currentMode === 'evaluation' && (
                          <span className="ml-1.5 text-[10px] text-claude-text-muted">(current)</span>
                        )}
                      </span>
                      <CommandShortcut className="text-[10px] text-claude-text-muted">2</CommandShortcut>
                    </CommandItem>

                    <CommandItem
                      onSelect={() => handleSelect(() => onSwitchMode('literature'))}
                      className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer text-claude-text-secondary data-[selected=true]:bg-claude-accent/10 data-[selected=true]:text-claude-accent"
                      disabled={currentMode === 'literature'}
                    >
                      <BookOpen className="h-4 w-4 text-claude-accent" />
                      <span className="flex-1 text-sm">
                        Switch to Literature
                        {currentMode === 'literature' && (
                          <span className="ml-1.5 text-[10px] text-claude-text-muted">(current)</span>
                        )}
                      </span>
                      <CommandShortcut className="text-[10px] text-claude-text-muted">3</CommandShortcut>
                    </CommandItem>
                  </CommandGroup>

                  <CommandSeparator className="bg-claude-border dark:bg-[#3d3832] my-1" />

                  {/* Quick Actions */}
                  <CommandGroup
                    heading="Quick Actions"
                    className="[&_[cmdk-group-heading]]:text-claude-text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider"
                  >
                    <CommandItem
                      onSelect={() => handleSelect(onToggleTheme)}
                      className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer text-claude-text-secondary data-[selected=true]:bg-claude-accent/10 data-[selected=true]:text-claude-accent"
                    >
                      {isDark ? (
                        <Sun className="h-4 w-4 text-amber-500" />
                      ) : (
                        <Moon className="h-4 w-4 text-indigo-400" />
                      )}
                      <span className="flex-1 text-sm">
                        {isDark ? (locale === 'zh' ? '切换到浅色模式' : 'Switch to Light Mode') : (locale === 'zh' ? '切换到深色模式' : 'Switch to Dark Mode')}
                      </span>
                    </CommandItem>

                    <CommandItem
                      onSelect={() => handleSelect(onToggleCharts)}
                      className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer text-claude-text-secondary data-[selected=true]:bg-claude-accent/10 data-[selected=true]:text-claude-accent"
                    >
                      <BarChart3 className="h-4 w-4 text-claude-accent" />
                      <span className="flex-1 text-sm">Toggle Summary Charts</span>
                    </CommandItem>

                    <CommandItem
                      onSelect={() => handleSelect(onToggleCharts)}
                      className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer text-claude-text-secondary data-[selected=true]:bg-claude-accent/10 data-[selected=true]:text-claude-accent"
                    >
                      <BookOpen className="h-4 w-4 text-claude-accent" />
                      <span className="flex-1 text-sm">Toggle Literature Charts</span>
                    </CommandItem>
                  </CommandGroup>
                </>
              ) : (
                <>
                  {/* Search Results Mode */}
                  {/* Searching indicator */}
                  {isSearching && (
                    <div className="flex items-center gap-2 px-3 py-3 text-sm text-claude-text-muted">
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-claude-accent" />
                      <span>Searching...</span>
                    </div>
                  )}

                  {!hasResults && !isSearching && (
                    <CommandEmpty className="py-6 text-center text-sm text-claude-text-muted">
                      No results found for &quot;{searchValue}&quot;
                    </CommandEmpty>
                  )}

                  {/* PDB Structures Group */}
                  {searchResults.entries.length > 0 && (
                    <CommandGroup
                      heading={
                        <span className="flex items-center gap-1.5">
                              <Database className="h-3 w-3 text-[#2d8f8f]" />
                              PDB Structures
                              <ResultCountBadge count={searchResults.entries.length} />
                            </span>
                      }
                      className="[&_[cmdk-group-heading]]:text-claude-text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider"
                    >
                      {searchResults.entries.map(entry => (
                        <CommandItem
                          key={entry.pdbId}
                          value={`pdb-${entry.pdbId}`}
                          onSelect={() => handleSelect(() => onSelectPdbEntry?.(entry))}
                          className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer text-claude-text-secondary data-[selected=true]:bg-claude-accent/10 data-[selected=true]:text-claude-accent"
                        >
                          <Hexagon className="h-4 w-4 text-[#2d8f8f] shrink-0" />
                          <span className="font-mono text-xs text-claude-accent shrink-0">{entry.pdbId}</span>
                          <span className="flex-1 text-sm truncate">
                            <HighlightedText text={truncate(entry.title || 'Untitled', 45)} query={searchedQuery} />
                          </span>
                          <MethodBadge method={entry.method} />
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}

                  {/* Evaluations Group */}
                  {searchResults.evaluations.length > 0 && (
                    <CommandGroup
                      heading={
                        <span className="flex items-center gap-1.5">
                              <FlaskConical className="h-3 w-3 text-claude-xray" />
                              Evaluations
                              <ResultCountBadge count={searchResults.evaluations.length} />
                            </span>
                      }
                      className="[&_[cmdk-group-heading]]:text-claude-text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider"
                    >
                      {searchResults.evaluations.map(ev => (
                        <CommandItem
                          key={ev.uniprotId}
                          value={`eval-${ev.uniprotId}`}
                          onSelect={() => handleSelect(() => onSelectEvaluation?.(ev))}
                          className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer text-claude-text-secondary data-[selected=true]:bg-claude-accent/10 data-[selected=true]:text-claude-accent"
                        >
                          <Microscope className="h-4 w-4 text-claude-xray shrink-0" />
                          <span className="flex-1 text-sm truncate">
                            <HighlightedText text={ev.proteinName || ev.uniprotId} query={searchedQuery} />
                          </span>
                          <span className="text-[10px] font-mono text-claude-text-muted shrink-0">{ev.uniprotId}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}

                  {/* Papers Group */}
                  {searchResults.papers.length > 0 && (
                    <CommandGroup
                      heading={
                        <span className="flex items-center gap-1.5">
                              <FileText className="h-3 w-3 text-claude-nmr" />
                              Papers
                              <ResultCountBadge count={searchResults.papers.length} />
                            </span>
                      }
                      className="[&_[cmdk-group-heading]]:text-claude-text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider"
                    >
                      {searchResults.papers.map(paper => (
                        <CommandItem
                          key={paper.pmid}
                          value={`paper-${paper.pmid}`}
                          onSelect={() => handleSelect(() => onSelectPaper?.(paper))}
                          className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg cursor-pointer text-claude-text-secondary data-[selected=true]:bg-claude-accent/10 data-[selected=true]:text-claude-accent"
                        >
                          <BookOpen className="h-4 w-4 text-claude-nmr shrink-0" />
                          <span className="flex-1 text-sm truncate">
                            <HighlightedText text={truncate(paper.title, 50)} query={searchedQuery} />
                          </span>
                          <span className="text-[10px] text-claude-text-muted shrink-0 max-w-[80px] truncate">{paper.journal}</span>
                        </CommandItem>
                      ))}
                    </CommandGroup>
                  )}

                  {/* Search all link */}
                  {hasResults && searchedQuery && (
                    <div className="px-2.5 py-1.5">
                      <button
                        onClick={handleSearchAll}
                        className="flex items-center gap-1.5 w-full px-2.5 py-2 rounded-lg text-sm text-claude-accent hover:bg-claude-accent/10 transition-colors cursor-pointer"
                      >
                        <Search className="h-3.5 w-3.5" />
                        <span>Search all for &apos;{searchedQuery}&apos;</span>
                        <ArrowRight className="h-3 w-3 ml-auto" />
                      </button>
                    </div>
                  )}

                  {/* Also show mode switch when searching (compact) */}
                  <CommandSeparator className="bg-claude-border dark:bg-[#3d3832] my-1" />
                  <CommandGroup
                    heading="Navigate"
                    className="[&_[cmdk-group-heading]]:text-claude-text-muted [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider"
                  >
                    <CommandItem
                      onSelect={() => handleSelect(() => onSwitchMode('weekly'))}
                      className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg cursor-pointer text-claude-text-muted data-[selected=true]:bg-claude-accent/10 data-[selected=true]:text-claude-accent"
                    >
                      <Database className="h-3.5 w-3.5" />
                      <span className="flex-1 text-xs">Go to Weekly</span>
                      <CommandShortcut className="text-[10px]">1</CommandShortcut>
                    </CommandItem>
                    <CommandItem
                      onSelect={() => handleSelect(() => onSwitchMode('evaluation'))}
                      className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg cursor-pointer text-claude-text-muted data-[selected=true]:bg-claude-accent/10 data-[selected=true]:text-claude-accent"
                    >
                      <FlaskConical className="h-3.5 w-3.5" />
                      <span className="flex-1 text-xs">Go to Evaluation</span>
                      <CommandShortcut className="text-[10px]">2</CommandShortcut>
                    </CommandItem>
                    <CommandItem
                      onSelect={() => handleSelect(() => onSwitchMode('literature'))}
                      className="flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg cursor-pointer text-claude-text-muted data-[selected=true]:bg-claude-accent/10 data-[selected=true]:text-claude-accent"
                    >
                      <BookOpen className="h-3.5 w-3.5" />
                      <span className="flex-1 text-xs">Go to Literature</span>
                      <CommandShortcut className="text-[10px]">3</CommandShortcut>
                    </CommandItem>
                  </CommandGroup>
                </>
              )}
            </CommandList>

            {/* Footer hints */}
            <div className="border-t border-claude-border dark:border-[#3d3832] px-3 py-2 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5">
                  <kbd className="inline-flex items-center text-[9px] text-claude-text-muted bg-claude-border-light dark:bg-[#2b2926] px-1.5 py-0.5 rounded border border-claude-border dark:border-[#3d3832] font-mono">
                    ↑↓
                  </kbd>
                  <span className="text-[10px] text-claude-text-muted">navigate</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <kbd className="inline-flex items-center text-[9px] text-claude-text-muted bg-claude-border-light dark:bg-[#2b2926] px-1.5 py-0.5 rounded border border-claude-border dark:border-[#3d3832] font-mono">
                    ↵
                  </kbd>
                  <span className="text-[10px] text-claude-text-muted">select</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <kbd className="inline-flex items-center text-[9px] text-claude-text-muted bg-claude-border-light dark:bg-[#2b2926] px-1.5 py-0.5 rounded border border-claude-border dark:border-[#3d3832] font-mono">
                    esc
                  </kbd>
                  <span className="text-[10px] text-claude-text-muted">close</span>
                </div>
              </div>
              {showSearchResults && hasResults && (
                <span className="text-[10px] text-claude-text-muted">
                  {totalResults} result{totalResults !== 1 ? 's' : ''}
                </span>
              )}
            </div>
          </Command>
        </div>
      </div>
    </>
  );
}
