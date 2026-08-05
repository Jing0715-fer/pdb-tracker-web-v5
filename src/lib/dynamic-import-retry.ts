/**
 * Dynamic import with retry logic for dev-mode ChunkLoadError resilience.
 *
 * When the dev server recompiles (after a file change), webpack rewrites
 * chunk files. During the ~5-40 second compilation window, old chunk URLs
 * return 404 and new chunk URLs may not exist yet. This causes
 * ChunkLoadError when a dynamic import is triggered mid-compile.
 *
 * This utility wraps the import() call with automatic retry:
 *   1. Try the import
 *   2. If it fails with ChunkLoadError, wait `delayMs` and retry
 *   3. Repeat up to `maxRetries` times
 *   4. If all retries fail, throw the last error (the ErrorBoundary will
 *      then do a full page reload as a last resort)
 *
 * Usage:
 *   const MyComp = dynamic(
 *     () => importWithRetry(() => import('@/components/MyComp')),
 *     { ssr: false }
 *   );
 */

interface ImportWithRetryOptions {
  maxRetries?: number;
  delayMs?: number;
  backoff?: number;
}

function isChunkError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: string; message?: string };
  return (
    e.name === 'ChunkLoadError' ||
    (e.message?.includes('Loading chunk') ?? false) ||
    (e.message?.includes('Failed to load chunk') ?? false) ||
    (e.message?.includes('dynamically imported module') ?? false)
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function importWithRetry<T>(
  importer: () => Promise<T>,
  options: ImportWithRetryOptions = {}
): Promise<T> {
  const { maxRetries = 5, delayMs = 1000, backoff = 1.5 } = options;

  return new Promise<T>((resolve, reject) => {
    let attempt = 0;

    const tryImport = async () => {
      try {
        const result = await importer();
        resolve(result);
      } catch (err) {
        attempt++;
        if (isChunkError(err) && attempt <= maxRetries) {
          // Wait with exponential backoff, then retry
          const delay = delayMs * Math.pow(backoff, attempt - 1);
          setTimeout(tryImport, delay);
        } else {
          // Not a chunk error, or max retries exceeded
          reject(err);
        }
      }
    };

    tryImport();
  });
}
