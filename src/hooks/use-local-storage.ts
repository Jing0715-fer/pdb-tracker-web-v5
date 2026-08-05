'use client';

import { useState, useCallback, useEffect } from 'react';

const MAX_STORAGE_BYTES = 2 * 1024 * 1024; // 2MB per-domain localStorage limit
const LRU_KEYS_TO_EVICT = 3;

/** Estimate localStorage usage and evict LRU keys if near quota */
function evictIfNeeded(serializedSize: number): void {
  try {
    let total = 0;
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k) {
        keys.push(k);
        total += (localStorage.getItem(k)?.length ?? 0);
      }
    }
    if (total + serializedSize > MAX_STORAGE_BYTES) {
      // Simple LRU: remove keys starting from oldest non-critical keys first
      let evicted = 0;
      for (const k of keys) {
        if (evicted >= LRU_KEYS_TO_EVICT) break;
        if (!k.startsWith('pdb-bookmarks') && !k.startsWith('pdb-imported') && !k.startsWith('pdb-session')) {
          localStorage.removeItem(k);
          evicted++;
        }
      }
    }
  } catch {
    // ignore
  }
}

/**
 * Generic hook for persisting state to localStorage with type safety.
 * Uses lazy initialization to read from localStorage on first render (client-side only),
 * avoiding SSR hydration mismatch.
 */
export function useLocalStorage<T>(
  key: string,
  defaultValue: T,
  serializer: (value: T) => string = JSON.stringify,
  deserializer: (raw: string) => T = JSON.parse,
): [T, (value: T | ((prev: T) => T)) => void] {
  // Lazy initializer: only runs once on mount
  const [storedValue, setStoredValue] = useState<T>(() => {
    // During SSR or before window is available, return default
    if (typeof window === 'undefined') return defaultValue;
    try {
      const item = localStorage.getItem(key);
      if (item !== null) {
        return deserializer(item);
      }
    } catch (error) {
      console.warn(`Error reading localStorage key "${key}":`, error);
    }
    return defaultValue;
  });

  // Persist to localStorage when value changes
  useEffect(() => {
    try {
      const serialized = serializer(storedValue);
      evictIfNeeded(serialized.length);
      localStorage.setItem(key, serialized);
    } catch (error) {
      console.warn(`Error writing localStorage key "${key}":`, error);
    }
  }, [key, storedValue, serializer]);

  // Custom setter that supports functional updates
  const setValue = useCallback(
    (value: T | ((prev: T) => T)) => {
      setStoredValue((prev) => {
        const nextValue = value instanceof Function ? value(prev) : value;
        return nextValue;
      });
    },
    [],
  );

  return [storedValue, setValue];
}

/**
 * Specialized hook for Set<string> stored in localStorage.
 * Serializes as JSON array for compactness.
 */
export function useLocalStorageSet(key: string, defaultValue: Set<string> = new Set()): [Set<string>, (updater: (prev: Set<string>) => Set<string>) => void] {
  const [stored, setStored] = useLocalStorage<string[]>(
    key,
    Array.from(defaultValue),
    (val) => JSON.stringify(val),
    (raw) => JSON.parse(raw),
  );

  const set = new Set(stored);

  const updateSet = useCallback((updater: (prev: Set<string>) => Set<string>) => {
    setStored((prevArr) => {
      const prevSet = new Set(prevArr);
      const nextSet = updater(prevSet);
      return Array.from(nextSet);
    });
  }, [setStored]);

  return [set, updateSet];
}