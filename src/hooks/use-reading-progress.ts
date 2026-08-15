'use client';

import { useCallback } from 'react';
import { useLocalStorage } from './use-local-storage';

/**
 * Reading progress for individual papers, stored as a map from PMID to progress (0-100).
 * Persisted in localStorage for cross-session persistence.
 */

export interface ReadingProgressMap {
  [pmid: string]: number; // 0-100
}

const STORAGE_KEY = 'pdb-reading-progress';

export function useReadingProgress() {
  const [progressMap, setProgressMap] = useLocalStorage<ReadingProgressMap>(
    STORAGE_KEY,
    {},
  );

  const getProgress = useCallback(
    (pmid: string): number => {
      return progressMap[pmid] ?? 0;
    },
    [progressMap],
  );

  const setProgress = useCallback(
    (pmid: string, value: number) => {
      const clamped = Math.max(0, Math.min(100, Math.round(value)));
      setProgressMap((prev) => {
        if (prev[pmid] === clamped) return prev;
        return { ...prev, [pmid]: clamped };
      });
    },
    [setProgressMap],
  );

  const markComplete = useCallback(
    (pmid: string) => {
      setProgress(pmid, 100);
    },
    [setProgress],
  );

  const removeProgress = useCallback(
    (pmid: string) => {
      setProgressMap((prev) => {
        const next = { ...prev };
        delete next[pmid];
        return next;
      });
    },
    [setProgressMap],
  );

  /**
   * Get average progress for a list of PMIDs.
   * Returns 0 if the list is empty.
   */
  const getAverageProgress = useCallback(
    (pmids: string[]): number => {
      if (pmids.length === 0) return 0;
      const total = pmids.reduce((sum, pmid) => sum + (progressMap[pmid] ?? 0), 0);
      return Math.round(total / pmids.length);
    },
    [progressMap],
  );

  /**
   * Get total number of papers with progress > 0.
   */
  const getInProgressCount = useCallback((): number => {
    return Object.values(progressMap).filter((p) => p > 0 && p < 100).length;
  }, [progressMap]);

  /**
   * Get total number of completed papers (progress === 100).
   */
  const getCompletedCount = useCallback((): number => {
    return Object.values(progressMap).filter((p) => p === 100).length;
  }, [progressMap]);

  return {
    progressMap,
    getProgress,
    setProgress,
    markComplete,
    removeProgress,
    getAverageProgress,
    getInProgressCount,
    getCompletedCount,
  };
}
