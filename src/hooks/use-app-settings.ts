'use client';

import { useCallback } from 'react';
import { useLocalStorage } from '@/hooks/use-local-storage';

// ─── Settings Types ────────────────────────────────────────────────────────────

export interface AppSettings {
  // Appearance
  theme: 'light' | 'dark' | 'system';
  compactMode: boolean;
  cardStyle: 'default' | 'glass' | 'flat';

  // Default Behavior
  defaultMode: 'weekly' | 'evaluation' | 'literature';
  defaultSortField: string;
  defaultSortDir: 'asc' | 'desc';
  defaultPageSize: number;

  // Data Display
  showNmrResolution: boolean;
  showLigandChips: boolean;
  showMethodBadges: boolean;
  abstractTruncation: number;

  // Notifications
  enableNotifications: boolean;
  notificationSound: boolean;
  activityTypes: string[];
}

export const DEFAULT_SETTINGS: AppSettings = {
  // Appearance
  theme: 'light',
  compactMode: false,
  cardStyle: 'default',

  // Default Behavior
  defaultMode: 'weekly',
  defaultSortField: 'releaseDate',
  defaultSortDir: 'desc',
  defaultPageSize: 25,

  // Data Display
  showNmrResolution: false,
  showLigandChips: true,
  showMethodBadges: true,
  abstractTruncation: 200,

  // Notifications
  enableNotifications: true,
  notificationSound: false,
  activityTypes: ['new_entry', 'weekly_report', 'evaluation_update', 'literature_update'],
};

export const ALL_ACTIVITY_TYPES = [
  { id: 'new_entry', label: 'New PDB Entry', iconKey: 'dna' },
  { id: 'weekly_report', label: 'Weekly Report', iconKey: 'bar-chart' },
  { id: 'evaluation_update', label: 'Evaluation Update', iconKey: 'microscope' },
  { id: 'literature_update', label: 'Literature Update', iconKey: 'file-text' },
] as const;

export const SORT_FIELD_OPTIONS = [
  { value: 'releaseDate', label: 'Date' },
  { value: 'pdbId', label: 'PDB ID' },
  { value: 'resolution', label: 'Resolution' },
  { value: 'journalIf', label: 'Impact Factor' },
  { value: 'method', label: 'Method' },
] as const;

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

export const ABSTRACT_TRUNCATION_OPTIONS = [
  { value: 100, label: '100 chars' },
  { value: 200, label: '200 chars' },
  { value: 300, label: '300 chars' },
  { value: 0, label: 'Full text' },
] as const;

// ─── Hook ──────────────────────────────────────────────────────────────────────

export function useAppSettings() {
  const [settings, setSettings] = useLocalStorage<AppSettings>(
    'pdb-tracker-settings',
    DEFAULT_SETTINGS,
  );

  const updateSetting = useCallback(
    <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
      setSettings((prev) => ({ ...prev, [key]: value }));
    },
    [setSettings],
  );

  const updateSettings = useCallback(
    (partial: Partial<AppSettings>) => {
      setSettings((prev) => ({ ...prev, ...partial }));
    },
    [setSettings],
  );

  const resetSettings = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
  }, [setSettings]);

  const toggleActivityType = useCallback(
    (typeId: string) => {
      setSettings((prev) => {
        const current = prev.activityTypes;
        const next = current.includes(typeId)
          ? current.filter((t) => t !== typeId)
          : [...current, typeId];
        return { ...prev, activityTypes: next };
      });
    },
    [setSettings],
  );

  return {
    settings,
    updateSetting,
    updateSettings,
    resetSettings,
    toggleActivityType,
  };
}
