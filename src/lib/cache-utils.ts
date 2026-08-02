'use client';

import { useState, useEffect } from 'react';

// ─── Constants ────────────────────────────────────────────────────────────────

const CACHE_PREFIX = 'pdb-cache-';

// ─── Cache Management Utilities ───────────────────────────────────────────────

/** Remove all PDB cache entries from localStorage */
export function clearAllCache(): void {
  try {
    const keys = Object.keys(localStorage).filter(k => k.startsWith(CACHE_PREFIX));
    keys.forEach(k => localStorage.removeItem(k));
  } catch {
    // localStorage may be unavailable (SSR, quota, etc.)
  }
}

/** Estimate total size of PDB cache entries in bytes (UTF-16 = 2 bytes per char) */
export function getCacheSize(): number {
  try {
    let size = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(CACHE_PREFIX)) {
        size += (localStorage.getItem(key)?.length ?? 0) * 2;
      }
    }
    return size;
  } catch {
    return 0;
  }
}

/** Format a byte count into a human-readable string */
export function formatCacheSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Get metadata about each PDB cache entry */
export function getCacheEntries(): { key: string; size: number; age: number }[] {
  const entries: { key: string; size: number; age: number }[] = [];
  try {
    const now = Date.now();
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(CACHE_PREFIX)) {
        const raw = localStorage.getItem(key);
        if (raw) {
          try {
            const parsed = JSON.parse(raw);
            entries.push({
              key: key.replace(CACHE_PREFIX, ''),
              size: raw.length * 2,
              age: now - (parsed.timestamp || 0),
            });
          } catch {
            // Malformed cache entry — skip
          }
        }
      }
    }
  } catch {
    // localStorage unavailable
  }
  return entries;
}

/** Save a cache entry with TTL metadata */
export function setCacheEntry<T>(key: string, data: T, ttl: number = 5 * 60 * 1000): void {
  try {
    const entry = { data, timestamp: Date.now(), ttl };
    localStorage.setItem(`${CACHE_PREFIX}${key}`, JSON.stringify(entry));
  } catch {
    // Quota exceeded or unavailable — silently ignore
  }
}

/** Read a cache entry, returning null if not found, expired, or malformed */
export function getCacheEntry<T>(key: string): { data: T; timestamp: number; ttl: number } | null {
  try {
    const raw = localStorage.getItem(`${CACHE_PREFIX}${key}`);
    if (!raw) return null;
    const entry: { data: T; timestamp: number; ttl: number } = JSON.parse(raw);
    return entry;
  } catch {
    return null;
  }
}

/** Remove a single cache entry */
export function clearCacheEntry(key: string): void {
  try {
    localStorage.removeItem(`${CACHE_PREFIX}${key}`);
  } catch {
    // ignore
  }
}

/** Check whether a cache entry exists and is not expired */
export function isCacheValid(key: string): boolean {
  const entry = getCacheEntry(key);
  if (!entry) return false;
  return Date.now() - entry.timestamp <= (entry.ttl || 5 * 60 * 1000);
}

// ─── Online / Offline Detection Hook ─────────────────────────────────────────

/**
 * React hook that tracks the browser's online status in real time.
 * Listens to `online` / `offline` window events and returns the current value
 * of `navigator.onLine`.
 */
export function useOnlineStatus(): boolean {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}
