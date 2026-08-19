/**
 * Backend analysis API helpers — called from the browser to fetch analysis data.
 *
 * Extracted from commands.ts (R138) as part of the module split.
 */

/** Generic fetch with retry for transient network errors (502, timeout). */
export async function fetchWithRetry(url: string, options?: RequestInit, maxRetries = 2): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const res = await fetch(url, options);
      if (res.ok || res.status < 500) return res; // Don't retry 4xx errors
      lastError = new Error(`HTTP ${res.status}`);
      if (attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    } catch (err: any) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      }
    }
  }
  throw lastError || new Error("Fetch failed after retries");
}

export async function fetchMetadata(id: string, includeInterfaces: boolean) {
  const url = `/api/analyze/metadata?id=${encodeURIComponent(id)}&interfaces=${includeInterfaces ? 1 : 0}&format=markdown`;
  const res = await fetchWithRetry(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return await res.text();
}

export async function fetchInterface(id: string, assembly: number) {
  const url = `/api/analyze/interface?id=${encodeURIComponent(id)}&assembly=${assembly}`;
  const res = await fetchWithRetry(url);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `HTTP ${res.status}`);
  }
  return await res.json();
}

export async function fetchCliList() {
  const res = await fetch("/api/cli/list");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.json();
}

export async function runRecipe(
  recipe: string,
  pdbId?: string,
  params?: Record<string, unknown>
) {
  const res = await fetch("/api/analyze/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipe, pdbId, params }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || err.error || `HTTP ${res.status}`);
  }
  return await res.json();
}
