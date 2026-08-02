'use client';

import { useState, useEffect, useCallback } from 'react';

// ─── Types ─────────────────────────────────────────────────────────────────

export interface UserPreferences {
  // Table preferences
  defaultSortField: 'pdb_id' | 'resolution' | 'release_date' | 'journal_if';
  defaultSortDesc: boolean;
  defaultPageSize: 25 | 50 | 100;
  tableDensity: 'compact' | 'comfortable' | 'dense' | 'spacious';
  visibleColumns: string[];
  showRowNumbers: boolean;
  showLigandChips: boolean;

  // UI preferences
  defaultViewMode: 'table' | 'literature';
  compactTable: boolean;
  showQualityDots: boolean;
  showHoverCards: boolean;

  // Sidebar preferences
  sidebarCollapsed: boolean;
  sidebarWidth: number;

  // Advanced
  showNotifications: boolean;
  animationsEnabled: boolean;
  animationSpeed: 'slow' | 'normal' | 'fast';

  // Theme
  theme: 'light' | 'dark' | 'system';
}

export const DEFAULT_PREFERENCES: UserPreferences = {
  defaultSortField: 'release_date',
  defaultSortDesc: true,
  defaultPageSize: 25,
  tableDensity: 'comfortable',
  visibleColumns: ['pdb_id', 'method', 'resolution', 'if', 'organism', 'title', 'ligands', 'release_date', 'journal'],
  showRowNumbers: true,
  showLigandChips: true,

  defaultViewMode: 'table',
  compactTable: false,
  showQualityDots: true,
  showHoverCards: true,

  sidebarCollapsed: false,
  sidebarWidth: 280,

  showNotifications: true,
  animationsEnabled: true,
  animationSpeed: 'normal',

  theme: 'system',
};

const STORAGE_KEY = 'pdb-user-preferences';

// ─── Helpers ───────────────────────────────────────────────────────────────

function loadPreferences(): UserPreferences {
  if (typeof window === 'undefined') return DEFAULT_PREFERENCES;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_PREFERENCES;
    const parsed = JSON.parse(stored) as Partial<UserPreferences>;
    // Merge with defaults so new preference keys always have a value
    return { ...DEFAULT_PREFERENCES, ...parsed };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

function savePreferences(prefs: UserPreferences): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage full or unavailable — ignore
  }
}

// ─── Hook ──────────────────────────────────────────────────────────────────

export function useUserPreferences() {
  // Lazy initializer: read from localStorage on the very first render so we
  // never need a setState-in-effect hydration step (which triggers cascading
  // renders and the react-hooks/set-state-in-effect lint rule).
  const [preferences, setPreferences] = useState<UserPreferences>(() => loadPreferences());

  // Persist on every change. Because the lazy initializer already loaded the
  // stored value, the first render's state matches localStorage — so the
  // initial effect run is a no-op write and needs no isInitial guard.
  useEffect(() => {
    savePreferences(preferences);
  }, [preferences]);

  const updatePreference = useCallback(
    <K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => {
      setPreferences((prev) => ({ ...prev, [key]: value }));
    },
    [],
  );

  const resetPreferences = useCallback(() => {
    setPreferences(DEFAULT_PREFERENCES);
    savePreferences(DEFAULT_PREFERENCES);
  }, []);

  return { preferences, updatePreference, resetPreferences } as const;
}
