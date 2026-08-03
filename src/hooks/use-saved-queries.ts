'use client';

import { useState, useCallback, useEffect } from 'react';

/**
 * useSavedQueries
 *
 * Manages saved search queries in localStorage.
 * Users can save and re-apply search queries across sessions.
 *
 * Stored queries include: query text, mode, filters, timestamp.
 */

export interface SavedQuery {
  id: string;
  name: string;
  query: string;
  mode: string;
  filter: string;
  createdAt: number;
}

const STORAGE_KEY = 'pdb-saved-queries';
const MAX_QUERIES = 20;

export function useSavedQueries() {
  const [queries, setQueries] = useState<SavedQuery[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) return parsed.slice(0, MAX_QUERIES);
      }
    } catch {
      // ignore
    }
    return [];
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(queries));
    } catch {
      // ignore
    }
  }, [queries]);

  const saveQuery = useCallback((name: string, query: string, mode: string, filter: string) => {
    const newQuery: SavedQuery = {
      id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: name || `Query ${new Date().toLocaleDateString()}`,
      query,
      mode,
      filter,
      createdAt: Date.now(),
    };
    setQueries(prev => [newQuery, ...prev.filter(q => q.id !== newQuery.id)].slice(0, MAX_QUERIES));
    return newQuery;
  }, []);

  const deleteQuery = useCallback((id: string) => {
    setQueries(prev => prev.filter(q => q.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setQueries([]);
  }, []);

  return { queries, saveQuery, deleteQuery, clearAll };
}
