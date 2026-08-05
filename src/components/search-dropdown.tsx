'use client';

import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  X,
  FileText,
  Hash,
  Globe,
  BookOpen,
  Clock,
  Trash2,
} from 'lucide-react';

export interface SearchSuggestionItem {
  type: 'pdbId' | 'title' | 'organism' | 'journal';
  text: string;
  subtitle?: string;
}

function HighlightMatch({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <>{text}</>;
  const q = query.trim();
  const idx = text.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <span className="text-claude-accent font-semibold">{text.slice(idx, idx + q.length)}</span>
      {text.slice(idx + q.length)}
    </>
  );
}

export function SearchDropdown({
  isOpen,
  searchQuery,
  suggestions,
  searchHistory,
  highlightIndex,
  onSelectSuggestion,
  onSelectHistory,
  onClearHistory,
}: {
  isOpen: boolean;
  searchQuery: string;
  suggestions: SearchSuggestionItem[];
  searchHistory: string[];
  highlightIndex: number;
  onSelectSuggestion: (suggestion: SearchSuggestionItem) => void;
  onSelectHistory: (term: string) => void;
  onClearHistory: () => void;
}) {
  const hasQuery = searchQuery.trim().length > 0;

  // Filter matching history items when there's a query
  const matchingHistory = useMemo(() => {
    if (!hasQuery) return [];
    const q = searchQuery.trim().toLowerCase();
    return searchHistory.filter(term => term.toLowerCase().includes(q));
  }, [hasQuery, searchQuery, searchHistory]);

  // Group suggestions by type
  const groupedSuggestions = useMemo(() => {
    const groups: { type: SearchSuggestionItem['type']; items: SearchSuggestionItem[] }[] = [];
    const types: SearchSuggestionItem['type'][] = ['pdbId', 'title', 'organism', 'journal'];
    for (const key of types) {
      const items = suggestions.filter(s => s.type === key);
      if (items.length > 0) {
        groups.push({ type: key, items });
      }
    }
    return groups;
  }, [suggestions]);

  const getIcon = (type: SearchSuggestionItem['type']) => {
    switch (type) {
      case 'pdbId': return <Hash className="h-3 w-3 text-claude-text-muted mr-2 flex-shrink-0" />;
      case 'title': return <FileText className="h-3 w-3 text-claude-text-muted mr-2 flex-shrink-0" />;
      case 'organism': return <Globe className="h-3 w-3 text-claude-text-muted mr-2 flex-shrink-0" />;
      case 'journal': return <BookOpen className="h-3 w-3 text-claude-text-muted mr-2 flex-shrink-0" />;
    }
  };

  // Determine if dropdown should be visible
  const hasContent = hasQuery
    ? suggestions.length > 0 || matchingHistory.length > 0
    : searchHistory.length > 0;

  return (
    <AnimatePresence>
      {isOpen && hasContent && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: -4 }}
          transition={{ duration: 0.12 }}
          className="absolute top-full left-0 right-0 mt-1 z-50 bg-white dark:bg-[#2b2926] border border-claude-border dark:border-[#4a4540] rounded-lg shadow-xl inner-shadow p-1 max-h-64 overflow-y-auto custom-scrollbar dark:shadow-[0_8px_24px_rgba(0,0,0,0.4)]"
        >
          {hasQuery ? (
            <>
              {/* Data-driven suggestions */}
              {(() => {
                let runningIdx = 0;
                return groupedSuggestions.map((group) => {
                  const startIdx = runningIdx;
                  const items = group.items.map((item, ii) => {
                    const flatIdx = startIdx + ii;
                    const isHighlighted = flatIdx === highlightIndex;
                    runningIdx++;
                    return (
                      <div
                        key={`${item.type}-${item.text}-${ii}`}
                        className={`flex items-center px-2 py-1.5 rounded-md cursor-pointer text-xs ${
                          isHighlighted
                            ? 'bg-claude-accent-light/50 dark:bg-claude-accent/10'
                            : 'hover:bg-claude-bg/50 dark:hover:bg-claude-border'
                        }`}
                        onClick={() => onSelectSuggestion(item)}
                      >
                        {getIcon(item.type)}
                        <span className="truncate flex-1 min-w-0">
                          <HighlightMatch text={item.text} query={searchQuery} />
                        </span>
                        {item.subtitle && (
                          <span className="text-[10px] text-claude-text-muted ml-2 flex-shrink-0 font-mono">{item.subtitle}</span>
                        )}
                      </div>
                    );
                  });
                  return (
                    <div key={group.type}>
                      <div className="text-[9px] font-semibold uppercase text-claude-text-muted px-2 py-1">
                        {group.type === 'pdbId' ? 'PDB IDs' : group.type === 'title' ? 'Titles' : group.type === 'organism' ? 'Organisms' : 'Journals'}
                      </div>
                      {items}
                    </div>
                  );
                });
              })()}

              {/* Matching history items when typing */}
              {matchingHistory.length > 0 && (
                <div className={suggestions.length > 0 ? 'mt-1 border-t border-claude-border pt-1' : ''}>
                  <div className="text-[9px] font-semibold uppercase text-claude-text-muted px-2 py-1">
                    Recent Searches
                  </div>
                  {matchingHistory.map((term, ii) => {
                    const flatIdx = suggestions.length + ii;
                    const isHighlighted = flatIdx === highlightIndex;
                    return (
                      <div
                        key={`hist-match-${term}`}
                        className={`flex items-center px-2 py-1.5 rounded-md cursor-pointer text-xs ${
                          isHighlighted
                            ? 'bg-claude-accent-light/50 dark:bg-claude-accent/10'
                            : 'hover:bg-claude-bg/50 dark:hover:bg-claude-border'
                        }`}
                        onClick={() => onSelectHistory(term)}
                      >
                        <Clock className="h-3 w-3 text-claude-text-muted mr-2 flex-shrink-0" />
                        <span className="truncate flex-1 min-w-0">
                          <HighlightMatch text={term} query={searchQuery} />
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Footer with count */}
              {suggestions.length > 0 && (
                <div className="border-t border-claude-border mt-1 pt-1 px-2 py-1">
                  <span className="text-[10px] text-claude-text-muted">
                    {suggestions.length} suggestion{suggestions.length !== 1 ? 's' : ''}
                    {matchingHistory.length > 0 && ` · ${matchingHistory.length} matching histor${matchingHistory.length !== 1 ? 'ies' : 'y'}`}
                  </span>
                </div>
              )}
            </>
          ) : (
            <>
              {/* Recent searches when no query */}
              <div className="text-[9px] font-semibold uppercase text-claude-text-muted px-2 py-1">
                Recent Searches
              </div>
              {searchHistory.map((term, ii) => {
                const isHighlighted = ii === highlightIndex;
                return (
                  <div
                    key={`hist-${term}`}
                    className={`flex items-center px-2 py-1.5 rounded-md cursor-pointer text-xs ${
                      isHighlighted
                        ? 'bg-claude-accent-light/50 dark:bg-claude-accent/10'
                        : 'hover:bg-claude-bg/50 dark:hover:bg-claude-border'
                    }`}
                    onClick={() => onSelectHistory(term)}
                  >
                    <Clock className="h-3 w-3 text-claude-text-muted mr-2 flex-shrink-0" />
                    <span className="truncate flex-1 min-w-0">{term}</span>
                  </div>
                );
              })}
              {searchHistory.length > 0 && (
                <div className="border-t border-claude-border mt-1 pt-1 px-2 py-1 flex items-center justify-between">
                  <span className="text-[10px] text-claude-text-muted">{searchHistory.length} recent search{searchHistory.length !== 1 ? 'es' : ''}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); onClearHistory(); }}
                    className="text-[10px] text-claude-accent hover:text-claude-accent/80 transition-colors"
                  >
                    Clear history
                  </button>
                </div>
              )}
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
