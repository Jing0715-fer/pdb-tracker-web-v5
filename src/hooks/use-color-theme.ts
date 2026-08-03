'use client';

import { useState, useCallback, useEffect } from 'react';

/**
 * useColorTheme
 *
 * Manages custom color themes for the PDB Tracker.
 * Users can choose from preset accent colors or define custom colors.
 * The accent color is applied as a CSS variable on :root.
 *
 * Preset themes:
 *   - claude (default): #c96442 (terracotta)
 *   - ocean: #2d8f8f (teal)
 *   - forest: #16a34a (green)
 *   - sunset: #ea580c (orange)
 *   - berry: #7c5cbf (purple)
 *   - rose: #e11d48 (rose)
 */

export interface ColorTheme {
  id: string;
  name: string;
  nameZh: string;
  accent: string;
  accentLight: string;
  accentDark: string;
}

export const COLOR_THEMES: ColorTheme[] = [
  { id: 'claude', name: 'Claude', nameZh: 'Claude', accent: '#c96442', accentLight: '#d97a5a', accentDark: '#a04e32' },
  { id: 'ocean', name: 'Ocean', nameZh: '海洋', accent: '#2d8f8f', accentLight: '#3da5a5', accentDark: '#1f6b6b' },
  { id: 'forest', name: 'Forest', nameZh: '森林', accent: '#16a34a', accentLight: '#22c55e', accentDark: '#15803d' },
  { id: 'sunset', name: 'Sunset', nameZh: '日落', accent: '#ea580c', accentLight: '#f97316', accentDark: '#c2410c' },
  { id: 'berry', name: 'Berry', nameZh: '浆果', accent: '#7c5cbf', accentLight: '#9171d4', accentDark: '#5a3d99' },
  { id: 'rose', name: 'Rose', nameZh: '玫瑰', accent: '#e11d48', accentLight: '#f43f5e', accentDark: '#be123c' },
];

const STORAGE_KEY = 'pdb-color-theme';

export function useColorTheme() {
  const [themeId, setThemeId] = useState<string>(() => {
    if (typeof window === 'undefined') return 'claude';
    try {
      return localStorage.getItem(STORAGE_KEY) || 'claude';
    } catch {
      return 'claude';
    }
  });

  const applyTheme = useCallback((id: string) => {
    const theme = COLOR_THEMES.find(t => t.id === id) || COLOR_THEMES[0];
    if (typeof document !== 'undefined') {
      const root = document.documentElement;
      // Override both light and dark mode accent variables
      root.style.setProperty('--claude-accent', theme.accent);
      root.style.setProperty('--claude-accent-hover', theme.accentDark);
      root.style.setProperty('--claude-accent-light', theme.accent + '15'); // 15% opacity for light bg usage
    }
  }, []);

  useEffect(() => {
    applyTheme(themeId);
    try {
      localStorage.setItem(STORAGE_KEY, themeId);
    } catch {
      // ignore
    }
  }, [themeId, applyTheme]);

  const changeTheme = useCallback((id: string) => {
    setThemeId(id);
  }, []);

  const currentTheme = COLOR_THEMES.find(t => t.id === themeId) || COLOR_THEMES[0];

  return { themeId, currentTheme, changeTheme, themes: COLOR_THEMES };
}
