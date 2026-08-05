'use client';

import { useState, useEffect, useCallback } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReadingList {
  id: string;
  name: string;
  color: string;
  paperPmids: string[];
}

// ─── Constants used by the hook ───────────────────────────────────────────────

const DEFAULT_LISTS: ReadingList[] = [
  { id: 'to-read', name: 'To Read', color: 'teal', paperPmids: [] },
  { id: 'reading', name: 'Reading', color: 'amber', paperPmids: [] },
  { id: 'read', name: 'Read', color: 'emerald', paperPmids: [] },
];

const STORAGE_KEY = 'pdb-reading-lists';
const LIST_ORDER_KEY = 'pdb-reading-list-order';

// ─── Hook: useReadingLists ────────────────────────────────────────────────────
//
// Extracted from `LiteratureReadingList.tsx` so that `pdb-tracker.tsx` can
// statically import the hook WITHOUT pulling `framer-motion` (which is only
// needed by the sidebar/popover components in `LiteratureReadingList.tsx`)
// into pdb-tracker's first-compile graph. The component file is loaded
// lazily via `next/dynamic` from `pdb-tracker.tsx` and `LiteratureView.tsx`.

export function useReadingLists() {
  const [lists, setLists] = useState<ReadingList[]>(() => {
    // Load from localStorage using lazy initializer
    if (typeof window !== 'undefined') {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const parsed = JSON.parse(stored);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return parsed;
          }
        }
      } catch {
        // ignore
      }
    }
    return DEFAULT_LISTS;
  });

  // Save to localStorage on change
  useEffect(() => {
    if (lists.length > 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lists));
    }
  }, [lists]);

  const createList = useCallback((name: string, color: string) => {
    const id = `list-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setLists(prev => [...prev, { id, name, color, paperPmids: [] }]);
  }, []);

  const deleteList = useCallback((id: string) => {
    setLists(prev => prev.filter(l => l.id !== id));
  }, []);

  const togglePaperInList = useCallback((listId: string, pmid: string) => {
    setLists(prev => prev.map(l => {
      if (l.id !== listId) return l;
      const pmids = new Set(l.paperPmids);
      if (pmids.has(pmid)) pmids.delete(pmid);
      else pmids.add(pmid);
      return { ...l, paperPmids: [...pmids] };
    }));
  }, []);

  const getListsForPaper = useCallback((pmid: string) => {
    return lists.filter(l => l.paperPmids.includes(pmid));
  }, [lists]);

  const isPaperInList = useCallback((listId: string, pmid: string) => {
    return lists.find(l => l.id === listId)?.paperPmids.includes(pmid) ?? false;
  }, [lists]);

  const clearList = useCallback((listId: string) => {
    setLists(prev => prev.map(l => {
      if (l.id !== listId) return l;
      return { ...l, paperPmids: [] };
    }));
  }, []);

  const reorderLists = useCallback((fromIndex: number, toIndex: number) => {
    setLists(prev => {
      const next = [...prev];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      // Store new order
      try {
        localStorage.setItem(LIST_ORDER_KEY, JSON.stringify(next.map(l => l.id)));
      } catch { /* ignore */ }
      return next;
    });
  }, []);

  const removePaperFromList = useCallback((listId: string, pmid: string) => {
    setLists(prev => prev.map(l => {
      if (l.id !== listId) return l;
      return { ...l, paperPmids: l.paperPmids.filter(p => p !== pmid) };
    }));
  }, []);

  // Add paper with timestamp tracking for "Recently Added"
  const addPaperToList = useCallback((listId: string, pmid: string) => {
    setLists(prev => prev.map(l => {
      if (l.id !== listId) return l;
      const pmids = new Set(l.paperPmids);
      if (!pmids.has(pmid)) {
        pmids.add(pmid);
      }
      return { ...l, paperPmids: [...pmids] };
    }));
    // Track when paper was added to any list
    try {
      const addedAtMap: Record<string, string> = JSON.parse(localStorage.getItem('pdb-paper-added-at') || '{}');
      if (!addedAtMap[pmid]) {
        addedAtMap[pmid] = new Date().toISOString();
        localStorage.setItem('pdb-paper-added-at', JSON.stringify(addedAtMap));
      }
    } catch { /* ignore */ }
  }, []);

  return {
    lists,
    createList,
    deleteList,
    togglePaperInList,
    getListsForPaper,
    isPaperInList,
    clearList,
    reorderLists,
    removePaperFromList,
    addPaperToList,
  };
}
