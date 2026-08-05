/**
 * SWR-based data fetching utilities for PDB Tracker.
 * Provides caching, deduplication, and request cancellation for API calls.
 */
import useSWR, { SWRConfiguration } from 'swr';

const fetcher = (url: string) => fetch(url).then((res) => {
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
});

/**
 * Cache config for entries API (stable across sessions).
 * Stale data is revalidated in background while stale-while-revalidate.
 */
const entriesConfig: SWRConfiguration = {
  revalidateOnFocus: false,
  revalidateOnReconnect: true,
  // Keep cache for 5 minutes
  dedupingInterval: 30000,
  errorRetryCount: 2,
};

/**
 * Fetch paginated PDB entries.
 * Returns wrapped {total, limit, offset, entries} response.
 */
export function useEntriesSWR(limit = 200, offset = 0, searchParams?: {
  week?: string;
  method?: string;
  q?: string;
}) {
  const params = new URLSearchParams();
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  if (searchParams?.week) params.set('week', searchParams.week);
  if (searchParams?.method && searchParams.method !== 'all') params.set('method', searchParams.method);
  if (searchParams?.q) params.set('q', searchParams.q);

  const url = `/api/entries?${params.toString()}`;
  
  return useSWR(url, fetcher, {
    ...entriesConfig,
    // Extend TTL for entries data (stable, changes infrequently)
    revalidateOnMount: false,
  });
}

/**
 * Fetch activity feed items.
 */
export function useActivitySWR(limit = 10) {
  return useSWR(`/api/activity?limit=${limit}`, fetcher, entriesConfig);
}

/**
 * Fetch evaluation batches.
 */
export function useEvaluationsSWR() {
  return useSWR('/api/evaluations', fetcher, entriesConfig);
}

/**
 * Fetch literature stats.
 */
export function useLitStatsSWR() {
  return useSWR('/api/literature/stats', fetcher, entriesConfig);
}

/**
 * Generic fetcher export for direct use.
 */
export { fetcher };