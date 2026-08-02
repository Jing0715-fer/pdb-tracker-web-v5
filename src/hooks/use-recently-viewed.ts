'use client';

import { useState, useCallback, useEffect } from 'react';

/**
 * useRecentlyViewed
 *
 * Tracks recently viewed PDB structures in localStorage.
 * Used by the Command Palette to show a "Recently Viewed" section.
 *
 * - Stores up to `maxItems` (default 8) recent PDB entries
 * - Each item: { pdbId, title, method, timestamp }
 * - Most recent first
 * - Deduplicates by pdbId
 * - Persists to localStorage key 'pdb-recently-viewed'
 */

export interface RecentlyViewedItem {
  pdbId: string;
  title: string;
  method: string | null;
  timestamp: number;
}

const STORAGE_KEY = 'pdb-recently-viewed';
const MAX_ITEMS = 8;

export function useRecentlyViewed(maxItems: number = MAX_ITEMS) {
  const [recentItems, setRecentItems] = useState<RecentlyViewedItem[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          return parsed.slice(0, maxItems);
        }
      }
    } catch {
      // ignore
    }
    return [];
  });

  // Persist to localStorage whenever items change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(recentItems));
    } catch {
      // ignore
    }
  }, [recentItems]);

  const addRecentlyViewed = useCallback((item: Omit<RecentlyViewedItem, 'timestamp'>) => {
    setRecentItems(prev => {
      // Remove existing entry with same pdbId
      const filtered = prev.filter(i => i.pdbId !== item.pdbId);
      // Add new item at the beginning with current timestamp
      const newItem: RecentlyViewedItem = { ...item, timestamp: Date.now() };
      return [newItem, ...filtered].slice(0, maxItems);
    });
  }, [maxItems]);

  const removeRecentlyViewed = useCallback((pdbId: string) => {
    setRecentItems(prev => prev.filter(i => i.pdbId !== pdbId));
  }, []);

  const clearRecentlyViewed = useCallback(() => {
    setRecentItems([]);
  }, []);

  return { recentItems, addRecentlyViewed, removeRecentlyViewed, clearRecentlyViewed };
}
