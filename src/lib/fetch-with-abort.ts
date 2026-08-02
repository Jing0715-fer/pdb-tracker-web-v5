/**
 * Fetch utility with AbortController cancellation support.
 * Prevents stale request responses from overwriting fresh data when
 * user navigates between pages/filters or component unmounts.
 */

export interface FetchWithAbortOptions extends RequestInit {
  /** Timeout in ms before auto-abort (default 30s) */
  timeoutMs?: number;
}

/**
 * Fetch wrapper that returns [data, abort] tuple.
 * Call abort() to cancel in-flight request and avoid stale data updates.
 *
 * @example
 * const [data, abort] = await fetchWithAbort('/api/entries');
 * // Later: abort() — e.g. on component unmount or filter change
 */
export async function fetchWithAbort<T = unknown>(
  url: string,
  options: FetchWithAbortOptions = {},
): Promise<[T, () => void]> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 30000;
  let timeoutId: ReturnType<typeof setTimeout>;

  const fetchPromise = fetch(url, { ...options, signal: controller.signal })
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<T>;
    });

  timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  const abort = () => {
    clearTimeout(timeoutId);
    controller.abort();
  };

  try {
    const data = await fetchPromise;
    clearTimeout(timeoutId);
    return [data, abort];
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
}

/**
 * Fetch with automatic retry logic for server errors and network failures.
 * Retries on HTTP 500+ errors and network exceptions.
 * Client errors (4xx) are returned immediately without retry.
 *
 * @param url - The URL to fetch
 * @param options - Standard fetch options
 * @param maxRetries - Maximum number of retry attempts (default 3)
 * @param delayMs - Base delay between retries in ms; actual delay is delayMs * (attempt + 1) (default 1000)
 *
 * @example
 * const res = await fetchWithRetry('/api/entries');
 * if (res.ok) { const data = await res.json(); }
 */
export async function fetchWithRetry(
  url: string,
  options?: RequestInit,
  maxRetries = 3,
  delayMs = 1000,
): Promise<Response> {
  let lastError: Error | null = null;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url, options);
      if (res.ok || res.status < 500) return res; // Don't retry client errors
      lastError = new Error(`HTTP ${res.status}`);
    } catch (err) {
      lastError = err as Error;
    }
    if (i < maxRetries - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs * (i + 1)));
    }
  }
  throw lastError;
}