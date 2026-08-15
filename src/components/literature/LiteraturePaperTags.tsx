'use client';

import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Tag, Plus, X } from 'lucide-react';

// ─── Constants ────────────────────────────────────────────────────────────────

export const PREDEFINED_TAGS = [
  'Important',
  'Review',
  'Method',
  'Drug Target',
  'Novel Structure',
  'Follow-up',
  'Key Reference',
] as const;

const TAG_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  'Important': { bg: 'bg-red-50 dark:bg-red-900/20', text: 'text-red-700 dark:text-red-300', border: 'border-red-200/60 dark:border-red-800/30' },
  'Review': { bg: 'bg-blue-50 dark:bg-blue-900/20', text: 'text-blue-700 dark:text-blue-300', border: 'border-blue-200/60 dark:border-blue-800/30' },
  'Method': { bg: 'bg-purple-50 dark:bg-purple-900/20', text: 'text-purple-700 dark:text-purple-300', border: 'border-purple-200/60 dark:border-purple-800/30' },
  'Drug Target': { bg: 'bg-orange-50 dark:bg-orange-900/20', text: 'text-orange-700 dark:text-orange-300', border: 'border-orange-200/60 dark:border-orange-800/30' },
  'Novel Structure': { bg: 'bg-teal-50 dark:bg-teal-900/20', text: 'text-teal-700 dark:text-teal-300', border: 'border-teal-200/60 dark:border-teal-800/30' },
  'Follow-up': { bg: 'bg-amber-50 dark:bg-amber-900/20', text: 'text-amber-700 dark:text-amber-300', border: 'border-amber-200/60 dark:border-amber-800/30' },
  'Key Reference': { bg: 'bg-emerald-50 dark:bg-emerald-900/20', text: 'text-emerald-700 dark:text-emerald-300', border: 'border-emerald-200/60 dark:border-emerald-800/30' },
};

const DEFAULT_TAG_COLOR = { bg: 'bg-gray-50 dark:bg-gray-800/50', text: 'text-gray-700 dark:text-gray-300', border: 'border-gray-200/60 dark:border-gray-700/30' };

const STORAGE_KEY = 'pdb-paper-tags';

// ─── Hook: usePaperTags ───────────────────────────────────────────────────────

export function usePaperTags() {
  const [tags, setTags] = useState<Record<string, string[]>>(() => {
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) return JSON.parse(stored);
      } catch { /* ignore */ }
    }
    return {};
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tags));
  }, [tags]);

  const getTags = useCallback((pmid: string): string[] => {
    return tags[pmid] || [];
  }, [tags]);

  const addTag = useCallback((pmid: string, tag: string) => {
    setTags(prev => {
      const current = prev[pmid] || [];
      if (current.includes(tag)) return prev;
      return { ...prev, [pmid]: [...current, tag] };
    });
  }, []);

  const removeTag = useCallback((pmid: string, tag: string) => {
    setTags(prev => {
      const current = prev[pmid] || [];
      return { ...prev, [pmid]: current.filter(t => t !== tag) };
    });
  }, []);

  const toggleTag = useCallback((pmid: string, tag: string) => {
    setTags(prev => {
      const current = prev[pmid] || [];
      if (current.includes(tag)) {
        return { ...prev, [pmid]: current.filter(t => t !== tag) };
      }
      return { ...prev, [pmid]: [...current, tag] };
    });
  }, []);

  const hasTag = useCallback((pmid: string, tag: string): boolean => {
    return (tags[pmid] || []).includes(tag);
  }, [tags]);

  const getAllTags = useCallback((): string[] => {
    const allTags = new Set<string>();
    for (const tagList of Object.values(tags)) {
      for (const t of tagList) allTags.add(t);
    }
    return [...allTags].sort();
  }, [tags]);

  const getPapersWithTag = useCallback((tag: string): string[] => {
    const pmids: string[] = [];
    for (const [pmid, tagList] of Object.entries(tags)) {
      if (tagList.includes(tag)) pmids.push(pmid);
    }
    return pmids;
  }, [tags]);

  return { tags, getTags, addTag, removeTag, toggleTag, hasTag, getAllTags, getPapersWithTag };
}

// ─── Component: TagPill ───────────────────────────────────────────────────────
// CSS-only animation instead of framer-motion

interface TagPillProps {
  tag: string;
  onRemove?: () => void;
  onClick?: () => void;
  size?: 'sm' | 'md';
}

export function TagPill({ tag, onRemove, onClick, size = 'sm' }: TagPillProps) {
  const colors = TAG_COLORS[tag] || DEFAULT_TAG_COLOR;
  const sizeClasses = size === 'sm'
    ? 'px-1.5 py-0.5 text-[9px]'
    : 'px-2 py-0.5 text-[10px]';

  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-md font-medium border ${colors.bg} ${colors.text} ${colors.border} ${sizeClasses} lit-tag-enter ${
        onClick ? 'cursor-pointer hover:opacity-80 transition-opacity' : ''
      }`}
      onClick={onClick}
    >
      {tag}
      {onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="ml-0.5 hover:opacity-70 transition-opacity"
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </span>
  );
}

// ─── Component: TagInput ──────────────────────────────────────────────────────

interface TagInputProps {
  pmid: string;
  currentTags: string[];
  onAddTag: (pmid: string, tag: string) => void;
  onRemoveTag: (pmid: string, tag: string) => void;
  compact?: boolean;
}

export function TagInput({ pmid, currentTags, onAddTag, onRemoveTag, compact = false }: TagInputProps) {
  const [inputValue, setInputValue] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = useMemo(() => {
    const available = PREDEFINED_TAGS.filter(t => !currentTags.includes(t));
    if (!inputValue.trim()) return available;
    const q = inputValue.toLowerCase();
    return available.filter(t => t.toLowerCase().includes(q));
  }, [currentTags, inputValue]);

  const handleAdd = useCallback((tag: string) => {
    const trimmed = tag.trim();
    if (!trimmed) return;
    onAddTag(pmid, trimmed);
    setInputValue('');
    setShowSuggestions(false);
    inputRef.current?.focus();
  }, [pmid, onAddTag]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (inputValue.trim()) {
        handleAdd(inputValue);
      }
    } else if (e.key === 'Escape') {
      setShowSuggestions(false);
      setInputValue('');
    }
  }, [inputValue, handleAdd]);

  return (
    <div className="space-y-1.5">
      {!compact && (
        <div className="flex items-center gap-1.5">
          <Tag className="h-3.5 w-3.5 text-claude-text-muted" />
          <span className="text-[10px] font-medium text-claude-text-muted uppercase tracking-wider">Tags</span>
        </div>
      )}

      {/* Existing tags */}
      {currentTags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {currentTags.map(tag => (
            <TagPill
              key={tag}
              tag={tag}
              onRemove={() => onRemoveTag(pmid, tag)}
              size={compact ? 'sm' : 'md'}
            />
          ))}
        </div>
      )}

      {/* Input + suggestions */}
      <div className="relative">
        <div className="flex items-center gap-1">
          <div className="relative flex-1">
            <input
              ref={inputRef}
              type="text"
              value={inputValue}
              onChange={(e) => { setInputValue(e.target.value); setShowSuggestions(true); }}
              onFocus={() => setShowSuggestions(true)}
              onKeyDown={handleKeyDown}
              placeholder={compact ? 'Add tag…' : 'Type to add a tag…'}
              className={`w-full text-xs rounded-lg border border-claude-border dark:border-[#3d3832] bg-white dark:bg-[#242220] text-claude-text placeholder:text-claude-text-muted focus:outline-none focus:ring-2 focus:ring-claude-accent/30 ${
                compact ? 'h-6 px-2' : 'h-7 px-2.5'
              }`}
            />
          </div>
          {inputValue.trim() && (
            <button
              onClick={() => handleAdd(inputValue)}
              className="h-6 w-6 flex items-center justify-center rounded-md bg-claude-accent text-white hover:bg-claude-accent-hover transition-colors"
            >
              <Plus className="h-3 w-3" />
            </button>
          )}
        </div>

        {/* Suggestions dropdown — CSS-only animation */}
        {showSuggestions && suggestions.length > 0 && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setShowSuggestions(false)} />
            <div className="absolute left-0 top-full mt-1 z-20 w-48 max-h-40 overflow-y-auto rounded-lg border border-claude-border dark:border-[#3d3832] bg-white dark:bg-[#2b2926] shadow-lg py-1 custom-scrollbar lit-fade-in-up">
              {suggestions.map(tag => {
                const colors = TAG_COLORS[tag] || DEFAULT_TAG_COLOR;
                return (
                  <button
                    key={tag}
                    onClick={() => handleAdd(tag)}
                    className="w-full text-left px-2.5 py-1.5 text-xs flex items-center gap-2 hover:bg-claude-border-light dark:hover:bg-[#3d3832] transition-colors"
                  >
                    <span className={`inline-block h-2 w-2 rounded-full ${colors.bg} border ${colors.border}`} />
                    <span className="text-claude-text-secondary">{tag}</span>
                  </button>
                );
              })}
              {inputValue.trim() && !PREDEFINED_TAGS.includes(inputValue.trim() as typeof PREDEFINED_TAGS[number]) && (
                <button
                  onClick={() => handleAdd(inputValue)}
                  className="w-full text-left px-2.5 py-1.5 text-xs flex items-center gap-2 hover:bg-claude-border-light dark:hover:bg-[#3d3832] transition-colors border-t border-claude-border dark:border-[#3d3832] mt-0.5"
                >
                  <Plus className="h-3 w-3 text-claude-accent" />
                  <span className="text-claude-accent">Create &quot;{inputValue.trim()}&quot;</span>
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Component: TagFilterBar ──────────────────────────────────────────────────
// A compact bar showing all tags across papers for filtering

interface TagFilterBarProps {
  allTags: string[];
  activeTag: string | null;
  onTagClick: (tag: string | null) => void;
  paperCountByTag?: Record<string, number>;
}

export function TagFilterBar({ allTags, activeTag, onTagClick, paperCountByTag }: TagFilterBarProps) {
  if (allTags.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <Tag className="h-3 w-3 text-claude-text-muted flex-shrink-0" />
      {allTags.map(tag => {
        const isActive = activeTag === tag;
        const count = paperCountByTag?.[tag];
        return (
          <button
            key={tag}
            onClick={() => onTagClick(isActive ? null : tag)}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium transition-all ${
              isActive
                ? 'bg-claude-accent text-white shadow-sm'
                : 'bg-claude-border-light dark:bg-[#2b2926] text-claude-text-secondary hover:bg-claude-border dark:hover:bg-[#3d3832]'
            }`}
          >
            {tag}
            {count != null && (
              <span className={`text-[9px] ${isActive ? 'text-white/70' : 'text-claude-text-muted'}`}>
                {count}
              </span>
            )}
          </button>
        );
      })}
      {activeTag && (
        <button
          onClick={() => onTagClick(null)}
          className="text-[10px] text-claude-accent dark:text-claude-accent-hover hover:underline"
        >
          Clear
        </button>
      )}
    </div>
  );
}
