'use client';

import { useState, useCallback, useEffect } from 'react';

/**
 * useChartPresets
 *
 * Saves and restores chart visualization configurations.
 * Users can save the current chart settings (e.g., dashboard expanded,
 * quality distribution visible, etc.) and restore them later.
 *
 * Stored presets include: name, settings object, timestamp.
 */

export interface ChartPreset {
  id: string;
  name: string;
  settings: Record<string, boolean | string | number>;
  createdAt: number;
}

const STORAGE_KEY = 'pdb-chart-presets';
const MAX_PRESETS = 10;

export function useChartPresets() {
  const [presets, setPresets] = useState<ChartPreset[]>(() => {
    if (typeof window === 'undefined') return [];
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) return parsed.slice(0, MAX_PRESETS);
      }
    } catch {
      // ignore
    }
    return [];
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
    } catch {
      // ignore
    }
  }, [presets]);

  const savePreset = useCallback((name: string, settings: Record<string, boolean | string | number>) => {
    const preset: ChartPreset = {
      id: `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: name || `Preset ${new Date().toLocaleDateString()}`,
      settings,
      createdAt: Date.now(),
    };
    setPresets(prev => [preset, ...prev].slice(0, MAX_PRESETS));
    return preset;
  }, []);

  const deletePreset = useCallback((id: string) => {
    setPresets(prev => prev.filter(p => p.id !== id));
  }, []);

  const clearAll = useCallback(() => {
    setPresets([]);
  }, []);

  return { presets, savePreset, deletePreset, clearAll };
}
