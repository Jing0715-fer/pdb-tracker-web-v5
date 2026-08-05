import { describe, it } from 'node:test';
import assert from 'node:assert';

// Minimal reimplementation of fetchWithAbort for unit testing
// (tests the logic, not the actual API call)
async function fetchWithAbort<T>(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {},
): Promise<[T, () => void]> {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? 30000;

  let timeoutId: ReturnType<typeof setTimeout>;

  const doFetch = async (): Promise<T> => {
    const res = await fetch(url, { ...options, signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json() as Promise<T>;
  };

  let resolvePromise: (v: T) => void;
  let rejectPromise: (e: Error) => void;

  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  doFetch()
    .then(resolvePromise!)
    .catch(rejectPromise!)
    .finally(() => { if (timeoutId !== undefined) clearTimeout(timeoutId); });

  const abort = () => {
    clearTimeout(timeoutId);
    controller.abort();
  };

  timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  return [await promise, abort];
}

describe('fetchWithAbort', () => {
  it('returns data on successful fetch', async () => {
    global.fetch = async () =>
      ({
        ok: true,
        json: () => Promise.resolve({ entries: [{ pdbId: '1ABC' }] }),
      }) as unknown as Response;

    const [data, abort] = await fetchWithAbort('/api/entries');
    assert.deepEqual(data, { entries: [{ pdbId: '1ABC' }] });
    assert.equal(typeof abort, 'function');
    abort();
  });

  it('throws on HTTP error', async () => {
    global.fetch = async () =>
      ({
        ok: false,
        status: 404,
        json: () => Promise.resolve({}),
      }) as unknown as Response;

    await assert.rejects(
      async () => fetchWithAbort('/api/nonexistent'),
      /HTTP 404/
    );
  });

  it('abort function is callable without throwing', async () => {
    // Test that abort() can be called even after the promise resolved
    global.fetch = async () =>
      ({
        ok: true,
        json: () => Promise.resolve({ foo: 'bar' }),
      }) as unknown as Response;

    const [, abort] = await fetchWithAbort('/api/test');
    assert.equal(typeof abort, 'function');
    // Should not throw
    abort();
    // Calling again should also not throw
    abort();
  });
});