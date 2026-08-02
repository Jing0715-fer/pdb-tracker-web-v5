'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Star, X, ExternalLink, Trash2, Search, ArrowRight } from 'lucide-react';
import type { PdbEntry } from '@/lib/pdb-types';
import { useI18n } from '@/lib/i18n';

/**
 * BookmarkQuickAccess
 *
 * A popover that appears when clicking the bookmark badge in the header.
 * Shows all bookmarked structures in a compact, searchable list with:
 *   - Search/filter input
 *   - PDB ID + title + method badge + resolution
 *   - Click to view structure details
 *   - Remove bookmark button (per-item)
 *   - "Clear all" button
 *   - "View all in table" link (switches to bookmark filter)
 *   - Empty state when no bookmarks
 *
 * Animated entrance with glass morphism styling.
 */

interface BookmarkQuickAccessProps {
  bookmarks: Set<string>;
  entries: PdbEntry[];
  onViewEntry: (entry: PdbEntry) => void;
  onRemoveBookmark: (pdbId: string) => void;
  onClearAll: () => void;
  onViewAll: () => void;
}

export function BookmarkQuickAccess({
  bookmarks,
  entries,
  onViewEntry,
  onRemoveBookmark,
  onClearAll,
  onViewAll,
}: BookmarkQuickAccessProps) {
  const { locale } = useI18n();
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on outside click
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

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen]);

  // Get bookmarked entries
  const bookmarkedEntries = useMemo(() => {
    return entries.filter(e => bookmarks.has(e.pdbId));
  }, [entries, bookmarks]);

  // Filter by search query
  const filteredBookmarks = useMemo(() => {
    if (!searchQuery.trim()) return bookmarkedEntries;
    const q = searchQuery.toLowerCase();
    return bookmarkedEntries.filter(e =>
      e.pdbId.toLowerCase().includes(q) ||
      e.title?.toLowerCase().includes(q) ||
      e.journal?.toLowerCase().includes(q) ||
      e.organisms?.toLowerCase().includes(q)
    );
  }, [bookmarkedEntries, searchQuery]);

  const getMethodColor = (method: string | null) => {
    const m = (method || '').toLowerCase();
    if (m.includes('cryo')) return { bg: '#2d8f8f', label: 'Cryo-EM' };
    if (m.includes('x-ray') || m.includes('xray')) return { bg: '#7c5cbf', label: 'X-ray' };
    if (m.includes('nmr')) return { bg: '#c9872e', label: 'NMR' };
    return { bg: '#6b7280', label: 'Other' };
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Trigger button — the bookmark badge */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`inline-flex items-center gap-0.5 text-[10px] font-medium transition-all rounded-md px-1 py-0.5 ${
          isOpen
            ? 'bg-claude-accent/15 text-claude-accent'
            : 'text-claude-accent hover:bg-claude-accent/10'
        }`}
        aria-label={locale === 'zh' ? '查看收藏' : 'View bookmarks'}
      >
        <motion.div
          animate={isOpen ? { rotate: 15 } : { rotate: 0 }}
          transition={{ duration: 0.2 }}
        >
          <Star className={`h-3 w-3 ${bookmarks.size > 0 ? 'fill-current' : ''}`} />
        </motion.div>
        <span className="font-mono">{bookmarks.size}</span>
      </button>

      {/* Popover */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="glass-dropdown absolute right-0 top-full mt-2 w-80 max-w-[calc(100vw-2rem)] rounded-xl overflow-hidden z-50 shadow-xl border border-claude-border dark:border-[#3d3832]"
          >
            {/* Header */}
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-claude-border/50 dark:border-[#3d3832]/50 bg-claude-surface dark:bg-[#242220]">
              <div className="flex items-center gap-1.5">
                <Star className="h-3 w-3 text-claude-accent fill-current" />
                <span className="text-[11px] font-semibold text-claude-text">
                  {locale === 'zh' ? '收藏的结构' : 'Bookmarked Structures'}
                </span>
                <span className="text-[10px] text-claude-text-muted font-mono">
                  ({bookmarkedEntries.length})
                </span>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="text-claude-text-muted hover:text-claude-text transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </div>

            {/* Search input */}
            {bookmarkedEntries.length > 0 && (
              <div className="p-2 border-b border-claude-border/30 dark:border-[#3d3832]/30">
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-claude-text-muted" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={locale === 'zh' ? '搜索收藏…' : 'Search bookmarks…'}
                    className="w-full h-7 pl-7 pr-2 rounded-md border border-claude-border dark:border-[#3d3832] bg-claude-bg dark:bg-[#1a1917] text-[11px] text-claude-text placeholder:text-claude-text-muted focus:outline-none focus:ring-1 focus:ring-claude-accent/30 focus:border-claude-accent/30 transition-all"
                  />
                </div>
              </div>
            )}

            {/* Bookmark list */}
            <div className="max-h-64 overflow-y-auto custom-scrollbar">
              {bookmarkedEntries.length === 0 ? (
                /* Empty state */
                <div className="flex flex-col items-center justify-center py-8 px-4">
                  <motion.div
                    animate={{ scale: [1, 1.1, 1] }}
                    transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
                  >
                    <Star className="h-8 w-8 text-claude-text-muted/30" />
                  </motion.div>
                  <p className="text-[11px] text-claude-text-muted mt-2 text-center">
                    {locale === 'zh' ? '还没有收藏的结构' : 'No bookmarked structures yet'}
                  </p>
                  <p className="text-[10px] text-claude-text-muted/70 mt-1 text-center">
                    {locale === 'zh' ? '点击表格中的星标按钮来收藏' : 'Click the star icon in the table to bookmark'}
                  </p>
                </div>
              ) : filteredBookmarks.length === 0 ? (
                /* No search results */
                <div className="py-6 px-4 text-center">
                  <p className="text-[11px] text-claude-text-muted">
                    {locale === 'zh' ? `未找到 "${searchQuery}"` : `No matches for "${searchQuery}"`}
                  </p>
                </div>
              ) : (
                /* Bookmark items */
                <div className="py-1">
                  {filteredBookmarks.map((entry, i) => {
                    const method = getMethodColor(entry.method);
                    return (
                      <motion.div
                        key={entry.pdbId}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.02, duration: 0.15 }}
                        className="group flex items-center gap-2 px-2 py-1.5 hover:bg-claude-border-light dark:hover:bg-[#2b2926] transition-colors cursor-pointer"
                        onClick={() => {
                          onViewEntry(entry);
                          setIsOpen(false);
                        }}
                      >
                        {/* Method color dot */}
                        <div
                          className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: method.bg }}
                        />

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono text-[11px] font-semibold text-claude-text">
                              {entry.pdbId}
                            </span>
                            <span className="text-[9px] text-claude-text-muted">
                              {method.label}
                            </span>
                            {entry.resolution != null && (
                              <span className="text-[9px] text-claude-text-muted">
                                · {entry.resolution.toFixed(1)}Å
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-claude-text-secondary truncate">
                            {entry.title || 'Untitled'}
                          </p>
                        </div>

                        {/* Remove bookmark button */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onRemoveBookmark(entry.pdbId);
                          }}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded text-claude-text-muted hover:text-red-500 transition-all"
                          aria-label={locale === 'zh' ? '移除收藏' : 'Remove bookmark'}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            {bookmarkedEntries.length > 0 && (
              <div className="flex items-center justify-between px-2 py-2 border-t border-claude-border/50 dark:border-[#3d3832]/50 bg-claude-surface dark:bg-[#242220]">
                <button
                  onClick={() => {
                    onClearAll();
                    setSearchQuery('');
                  }}
                  className="text-[10px] text-claude-text-muted hover:text-red-500 transition-colors inline-flex items-center gap-1"
                >
                  <Trash2 className="h-2.5 w-2.5" />
                  {locale === 'zh' ? '清除全部' : 'Clear all'}
                </button>
                <button
                  onClick={() => {
                    onViewAll();
                    setIsOpen(false);
                  }}
                  className="text-[10px] text-claude-accent hover:text-claude-accent/80 transition-colors inline-flex items-center gap-1 font-medium"
                >
                  {locale === 'zh' ? '在表格中查看' : 'View all in table'}
                  <ArrowRight className="h-2.5 w-2.5" />
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
