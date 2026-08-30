/**
 * Sliding-window rate limiter for the unauthenticated LLM routes (API-05).
 *
 * Mirrors the VLM route's R165 (VLM-006) limiter — 10 requests / 60s window
 * per client key — as a shared helper so /api/llm/chat,
 * /api/llm/chat/stream, /api/ai-summary and /api/ai-weekly-summary all get
 * the same guard without duplicating the pattern four times. State lives on
 * globalThis because Next.js dev bundles each route separately (a
 * module-level variable is NOT reliably shared across route instances).
 *
 * There is no auth in this sandbox app — this limiter is the only guard
 * against a caller draining the LLM quota.
 */
import type { NextRequest } from 'next/server';

const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 10;

type RateLimiter = { hits: Map<string, number[]> };
type GlobalWithLimiters = typeof globalThis & { __llmRateLimiters?: Map<string, RateLimiter> };

/** One limiter per route bucket ('llm-chat', 'llm-chat-stream', …). */
function limiterFor(bucket: string): RateLimiter {
  const g = globalThis as GlobalWithLimiters;
  if (!g.__llmRateLimiters) g.__llmRateLimiters = new Map();
  let limiter = g.__llmRateLimiters.get(bucket);
  if (!limiter) {
    limiter = { hits: new Map() };
    g.__llmRateLimiters.set(bucket, limiter);
  }
  return limiter;
}

/** Best-effort client key from proxy headers; 'global' fallback. */
export function getClientKey(req: NextRequest): string {
  const first = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (first) return first;
  return req.headers.get('x-real-ip')?.trim() || 'global';
}

/**
 * Sliding-window rate check. Timestamps older than the window are lazily
 * pruned on every access; the key set itself is opportunistically pruned
 * past 1000 entries so the Map can't leak.
 */
export function checkLlmRateLimit(bucket: string, key: string): { allowed: boolean; retryAfterSec: number } {
  const limiter = limiterFor(bucket);
  const now = Date.now();
  const windowStart = now - WINDOW_MS;
  const recent = (limiter.hits.get(key) ?? []).filter((ts) => ts > windowStart);
  if (recent.length >= MAX_REQUESTS_PER_WINDOW) {
    limiter.hits.set(key, recent); // store pruned list even when rejecting
    const oldest = recent[0] ?? now;
    const retryAfterSec = Math.max(1, Math.ceil((oldest + WINDOW_MS - now) / 1000));
    return { allowed: false, retryAfterSec };
  }
  recent.push(now);
  limiter.hits.set(key, recent);
  if (limiter.hits.size > 1000) {
    for (const [k, stamps] of limiter.hits) {
      if (!stamps.some((ts) => ts > windowStart)) limiter.hits.delete(k);
    }
  }
  return { allowed: true, retryAfterSec: 0 };
}

/** 429 response with Retry-After, matching the VLM route's error shape. */
export function rateLimitResponse(bucket: string, retryAfterSec: number): Response {
  return Response.json(
    { error: `Too many ${bucket} requests — retry after ${retryAfterSec}s` },
    { status: 429, headers: { 'Retry-After': String(retryAfterSec) } },
  );
}
