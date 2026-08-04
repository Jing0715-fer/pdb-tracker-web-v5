'use client';

import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Bookmark, Search, X, Trash2, Clock, ChevronDown } from 'lucide-react';
import { useSavedQueries, type SavedQuery } from '@/hooks/use-saved-queries';
import { useI18n } from '@/lib/i18n';

/**
 * SavedQueriesDropdown
 *
 * A dropdown button that shows saved search queries.
 * Users can save the current search query and re-apply it later.
 */

interface SavedQueriesDropdownProps {
  currentQuery: string;
  currentMode: string;
  currentFilter: string;
  onApplyQuery: (query: string, filter: string) => void;
}

export function SavedQueriesDropdown({
  currentQuery,
  currentMode,
  currentFilter,
  onApplyQuery,
}: SavedQueriesDropdownProps) {
  const { locale } = useI18n();
  const { queries, saveQuery, deleteQuery, clearAll } = useSavedQueries();
  const [isOpen, setIsOpen] = useState(false);
  const [showSaveForm, setShowSaveForm] = useState(false);
  const [saveName, setSaveName] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setShowSaveForm(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  const handleSave = () => {
    if (!currentQuery.trim() && currentFilter === 'all') return;
    saveQuery(saveName || currentQuery.slice(0, 30), currentQuery, currentMode, currentFilter);
    setSaveName('');
    setShowSaveForm(false);
    setIsOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium transition-all ${
          isOpen
            ? 'bg-claude-accent/15 text-claude-accent'
            : 'text-claude-text-muted hover:text-claude-text hover:bg-claude-border-light dark:hover:bg-[#2b2926]'
        }`}
        title={locale === 'zh' ? '保存的查询' : 'Saved queries'}
      >
        <Bookmark className={`h-3 w-3 ${queries.length > 0 ? 'fill-current' : ''}`} />
        <span className="hidden sm:inline">{locale === 'zh' ? '已保存' : 'Saved'}</span>
        {queries.length > 0 && (
          <span className="text-[9px] font-bold bg-claude-accent/20 text-claude-accent rounded-full px-1">
            {queries.length}
          </span>
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.96 }}
            transition={{ duration: 0.12 }}
            className="glass-dropdown absolute right-0 top-full mt-1 w-72 rounded-lg overflow-hidden z-50 shadow-lg border border-claude-border dark:border-[#3d3832]"
          >
            {/* Save current query */}
            {(currentQuery.trim() || currentFilter !== 'all') && !showSaveForm && (
              <button
                onClick={() => setShowSaveForm(true)}
                className="w-full flex items-center gap-2 px-2.5 py-2 text-[11px] text-claude-accent hover:bg-claude-accent/10 transition-colors border-b border-claude-border/30 dark:border-[#3d3832]/30"
              >
                <Bookmark className="h-3 w-3" />
                {locale === 'zh' ? '保存当前搜索' : 'Save current search'}
              </button>
            )}

            {showSaveForm && (
              <div className="p-2 border-b border-claude-border/30 dark:border-[#3d3832]/30">
                <input
                  type="text"
                  value={saveName}
                  onChange={e => setSaveName(e.target.value)}
                  placeholder={locale === 'zh' ? '查询名称...' : 'Query name...'}
                  className="w-full h-7 px-2 rounded-md border border-claude-border dark:border-[#3d3832] bg-claude-bg dark:bg-[#1a1917] text-[11px] text-claude-text placeholder:text-claude-text-muted focus:outline-none focus:ring-1 focus:ring-claude-accent/30"
                  autoFocus
                  onKeyDown={e => {
                    if (e.key === 'Enter') handleSave();
                    if (e.key === 'Escape') { setShowSaveForm(false); setSaveName(''); }
                  }}
                />
                <div className="flex gap-1 mt-1">
                  <button
                    onClick={handleSave}
                    className="flex-1 px-2 py-1 rounded-md text-[10px] font-medium bg-claude-accent text-white hover:bg-claude-accent/80 transition-colors"
                  >
                    {locale === 'zh' ? '保存' : 'Save'}
                  </button>
                  <button
                    onClick={() => { setShowSaveForm(false); setSaveName(''); }}
                    className="px-2 py-1 rounded-md text-[10px] text-claude-text-muted hover:text-claude-text transition-colors"
                  >
                    {locale === 'zh' ? '取消' : 'Cancel'}
                  </button>
                </div>
              </div>
            )}

            {/* Saved queries list */}
            {queries.length === 0 ? (
              <div className="py-6 px-4 text-center">
                <Bookmark className="h-6 w-6 text-claude-text-muted/30 mx-auto mb-1" />
                <p className="text-[10px] text-claude-text-muted">
                  {locale === 'zh' ? '还没有保存的查询' : 'No saved queries yet'}
                </p>
              </div>
            ) : (
              <div className="max-h-64 overflow-y-auto custom-scrollbar py-1">
                {queries.map((q: SavedQuery) => (
                  <div
                    key={q.id}
                    className="group flex items-center gap-2 px-2.5 py-1.5 hover:bg-claude-border-light dark:hover:bg-[#2b2926] transition-colors"
                  >
                    <button
                      onClick={() => {
                        onApplyQuery(q.query, q.filter);
                        setIsOpen(false);
                      }}
                      className="flex-1 min-w-0 text-left"
                    >
                      <div className="text-[11px] font-medium text-claude-text-secondary truncate">
                        {q.name}
                      </div>
                      <div className="text-[9px] text-claude-text-muted flex items-center gap-1">
                        <Search className="h-2 w-2" />
                        <span className="truncate">"{q.query || '—'}"</span>
                        <span>· {q.mode}</span>
                      </div>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteQuery(q.id); }}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded text-claude-text-muted hover:text-red-500 transition-all"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {queries.length > 0 && (
                  <button
                    onClick={() => clearAll()}
                    className="w-full flex items-center gap-1 px-2.5 py-1.5 text-[10px] text-claude-text-muted hover:text-red-500 transition-colors border-t border-claude-border/30 dark:border-[#3d3832]/30 mt-1"
                  >
                    <Trash2 className="h-2.5 w-2.5" />
                    {locale === 'zh' ? '清除全部' : 'Clear all'}
                  </button>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
