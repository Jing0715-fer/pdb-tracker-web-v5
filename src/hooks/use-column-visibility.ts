'use client';

import { useState, useCallback } from 'react';
import { WEEKLY_TABLE_COLUMNS } from '@/lib/pdb-utils';

const STORAGE_KEY = 'pdb-column-visibility';

export type ColumnVisibility = Record<string, boolean>;

function getDefaultVisibility(): ColumnVisibility {
  const vis: ColumnVisibility = {};
  for (const col of WEEKLY_TABLE_COLUMNS) {
    vis[col.field] = true;
  }
  return vis;
}

function loadVisibility(): ColumnVisibility | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as ColumnVisibility;
      // Ensure all current columns exist in the stored state
      const defaults = getDefaultVisibility();
      for (const col of WEEKLY_TABLE_COLUMNS) {
        if (!(col.field in parsed)) {
          parsed[col.field] = defaults[col.field];
        }
      }
      // PDB ID is always visible
      parsed.pdbId = true;
      return parsed;
    }
  } catch {
    // localStorage error — use defaults
  }
  return null;
}

function saveVisibility(vis: ColumnVisibility): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(vis));
  } catch {
    // localStorage error — silently ignore
  }
}

function getInitialVisibility(): ColumnVisibility {
  const loaded = loadVisibility();
  return loaded ?? getDefaultVisibility();
}

export function useColumnVisibility() {
  // Use a lazy initializer to read from localStorage only once on mount
  const [columnVisibility, setColumnVisibilityState] = useState<ColumnVisibility>(getInitialVisibility);

  const toggleColumn = useCallback((field: string) => {
    setColumnVisibilityState(prev => {
      // PDB ID cannot be hidden
      if (field === 'pdbId') return prev;
      const next = { ...prev, [field]: !prev[field] };
      saveVisibility(next);
      return next;
    });
  }, []);

  const resetToDefault = useCallback(() => {
    const defaults = getDefaultVisibility();
    saveVisibility(defaults);
    setColumnVisibilityState(defaults);
  }, []);

  const visibleColumns = WEEKLY_TABLE_COLUMNS.filter(
    col => columnVisibility[col.field] !== false
  );

  return {
    columnVisibility,
    toggleColumn,
    resetToDefault,
    visibleColumns,
  };
}
