'use client';

import { useState, useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  X,
  Clock,
  TrendingUp,
  Microscope,
  FlaskConical,
  BookOpen,
  ArrowRight,
  History,
} from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * SearchDropdownEnhanced
 *
 * An enhanced search input with a dropdown showing:
 *   - Recent searches (from localStorage)
 *   - Trending/suggested searches (curated based on mode)
 *   - Quick category filters
 *   - Keyboard navigation (up/down/enter)
 *   - Animated dropdown entrance
 *
 * Designed to replace the basic search input in the header.
 */

interface SearchSuggestion {
  label: string;
  type: 'recent' | 'trending' | 'category';
  icon?: typeof Microscope;
  action?: () => void;
}

interface SearchDropdownEnhancedProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
  placeholder?: string;
  mode?: 'weekly' | 'evaluation' | 'literature' | 'analysis';
  recentSearchesKey?: string;
  maxRecent?: number;
  className?: string;
}

const TRENDING_BY_MODE: Record<string, string[]> = {
  weekly: ['Cryo-EM', 'SARS-CoV-2', 'hemoglobin', 'kinase', '< 2.0Å'],
  evaluation: ['EGFR', 'P00533', 'kinase', 'receptor', 'antibody'],
  literature: ['Cryo-EM', 'X-ray crystallography', 'AlphaFold', 'GPCR', 'membrane protein'],
  analysis: ['1CBS', '6LU7', '4HHB', 'hemoglobin', 'insulin'],
};

export function SearchDropdownEnhanced({
  value,
  onChange,
  onSubmit,
  placeholder = 'Search…',
  mode = 'weekly',
  recentSearchesKey = 'pdb-recent-searches-header',
  maxRecent = 5,
  className,
}: SearchDropdownEnhancedProps) {
  const [focused, setFocused] = useState(false);
  // Load recent searches from localStorage (lazy init to avoid setState in effect)
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const stored = localStorage.getItem(recentSearchesKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          return parsed.slice(0, maxRecent);
        }
      }
    } catch {
      // ignore
    }
    return [];
  });
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Add to recent searches on submit
  const addToRecent = (query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    const updated = [trimmed, ...recentSearches.filter((s) => s !== trimmed)].slice(0, maxRecent);
    setRecentSearches(updated);
    try {
      localStorage.setItem(recentSearchesKey, JSON.stringify(updated));
    } catch {
      // ignore
    }
  };

  // Close on outside click
  useEffect(() => {
    if (!focused) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setFocused(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [focused]);

  const trending = useMemo(() => TRENDING_BY_MODE[mode] || [], [mode]);

  const suggestions = useMemo((): SearchSuggestion[] => {
    const items: SearchSuggestion[] = [];

    // Recent searches (only when no query)
    if (!value && recentSearches.length > 0) {
      for (const s of recentSearches) {
        items.push({ label: s, type: 'recent', icon: Clock });
      }
    }

    // Trending (only when no query)
    if (!value && trending.length > 0) {
      for (const t of trending) {
        items.push({ label: t, type: 'trending', icon: TrendingUp });
      }
    }

    return items;
  }, [value, recentSearches, trending]);

  const showDropdown = focused && (suggestions.length > 0 || value.length > 0);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => Math.min(prev + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => Math.max(prev - 1, -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIndex >= 0 && suggestions[activeIndex]) {
        const selected = suggestions[activeIndex];
        onChange(selected.label);
        addToRecent(selected.label);
        onSubmit?.(selected.label);
      } else if (value.trim()) {
        addToRecent(value);
        onSubmit?.(value);
      }
      setFocused(false);
      inputRef.current?.blur();
    } else if (e.key === 'Escape') {
      setFocused(false);
      inputRef.current?.blur();
    }
  };

  const handleSuggestionClick = (suggestion: SearchSuggestion) => {
    onChange(suggestion.label);
    addToRecent(suggestion.label);
    onSubmit?.(suggestion.label);
    setFocused(false);
    inputRef.current?.blur();
  };

  const clearRecent = () => {
    setRecentSearches([]);
    try {
      localStorage.removeItem(recentSearchesKey);
    } catch {
      // ignore
    }
  };

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      {/* Search input */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-claude-text-muted" />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setActiveIndex(-1);
          }}
          onFocus={() => setFocused(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className="h-8 w-full pl-8 pr-7 rounded-lg border border-claude-border/50 dark:border-[#3d3832]/50 bg-claude-surface/50 dark:bg-[#242220]/50 text-xs text-claude-text placeholder:text-claude-text-muted focus:outline-none focus:ring-1 focus:ring-claude-accent/30 focus:border-claude-accent/30 transition-all"
        />
        {value && (
          <button
            onClick={() => {
              onChange('');
              inputRef.current?.focus();
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-claude-text-muted hover:text-claude-text transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        )}
      </div>

      {/* Dropdown */}
      <AnimatePresence>
        {showDropdown && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.97 }}
            transition={{ duration: 0.12 }}
            className="glass-dropdown absolute left-0 top-full mt-1 w-full min-w-[240px] rounded-lg overflow-hidden z-50"
          >
            {/* Recent searches */}
            {!value && recentSearches.length > 0 && (
              <div>
                <div className="flex items-center justify-between px-2.5 py-1.5 border-b border-claude-border/20 dark:border-[#3d3832]/20">
                  <div className="flex items-center gap-1.5">
                    <History className="h-2.5 w-2.5 text-claude-text-muted" />
                    <span className="text-[9px] font-bold uppercase tracking-wider text-claude-text-muted">
                      Recent
                    </span>
                  </div>
                  <button
                    onClick={clearRecent}
                    className="text-[9px] text-claude-text-muted hover:text-claude-accent transition-colors"
                  >
                    Clear
                  </button>
                </div>
                {recentSearches.map((s, i) => {
                  const Icon = Clock;
                  const isActive = activeIndex === i;
                  return (
                    <button
                      key={s}
                      onClick={() => handleSuggestionClick({ label: s, type: 'recent', icon: Clock })}
                      onMouseEnter={() => setActiveIndex(i)}
                      className={cn(
                        'w-full flex items-center gap-2 px-2.5 py-1.5 text-[11px] transition-colors',
                        isActive ? 'bg-claude-accent/10 text-claude-accent' : 'text-claude-text-secondary hover:bg-claude-border/20'
                      )}
                    >
                      <Icon className="h-3 w-3 shrink-0" />
                      <span className="flex-1 text-left truncate">{s}</span>
                      <ArrowRight className="h-2.5 w-2.5 opacity-0 group-hover:opacity-50" />
                    </button>
                  );
                })}
              </div>
            )}

            {/* Trending */}
            {!value && trending.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 px-2.5 py-1.5 border-b border-claude-border/20 dark:border-[#3d3832]/20">
                  <TrendingUp className="h-2.5 w-2.5 text-claude-text-muted" />
                  <span className="text-[9px] font-bold uppercase tracking-wider text-claude-text-muted">
                    Trending
                  </span>
                </div>
                <div className="flex flex-wrap gap-1 p-2">
                  {trending.map((t, i) => {
                    const offset = recentSearches.length;
                    const isActive = activeIndex === offset + i;
                    return (
                      <button
                        key={t}
                        onClick={() => handleSuggestionClick({ label: t, type: 'trending' })}
                        onMouseEnter={() => setActiveIndex(offset + i)}
                        className={cn(
                          'inline-flex items-center gap-1 px-2 py-1 rounded-full text-[10px] font-medium transition-all',
                          isActive
                            ? 'bg-claude-accent/15 text-claude-accent'
                            : 'bg-claude-border/20 text-claude-text-secondary hover:bg-claude-border/30'
                        )}
                      >
                        {t}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Search results hint */}
            {value && (
              <div className="px-2.5 py-2">
                <div className="flex items-center gap-2 text-[10px] text-claude-text-muted">
                  <Search className="h-3 w-3" />
                  <span>
                    Press <kbd className="kbd-key">Enter</kbd> to search for
                    <span className="text-claude-accent font-medium"> "{value}"</span>
                  </span>
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
