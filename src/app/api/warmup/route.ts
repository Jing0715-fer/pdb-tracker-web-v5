/**
 * GET /api/warmup
 *
 * Improvement #7: Pre-compilation warm-up endpoint.
 *
 * In the 4GB sandbox, the Next.js dev server OOM-kills when compiling heavy
 * modules (like structure-analysis which imports Molstar). This endpoint
 * triggers compilation of the most commonly used API routes by making internal
 * fetch calls to them, warming up the webpack cache.
 *
 * The frontend can call this endpoint on page load (in the background) so
 * that by the time the user navigates to a feature, its code is already
 * compiled.
 *
 * Usage:
 *   GET /api/warmup              — warm up all routes
 *   GET /api/warmup?route=chat   — warm up only the chat route
 */

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const maxDuration = 30;

const ROUTES = [
  { id: 'providers', path: '/api/llm/providers', method: 'GET' },
  { id: 'entries', path: '/api/entries?limit=1', method: 'GET' },
  { id: 'db-config', path: '/api/db-config', method: 'GET' },
  { id: 'activity', path: '/api/activity?limit=1', method: 'GET' },
  { id: 'snapshots', path: '/api/snapshots', method: 'GET' },
];

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const routeFilter = searchParams.get('route');

  const routes = routeFilter
    ? ROUTES.filter((r) => r.id === routeFilter)
    : ROUTES;

  const results: Array<{ id: string; status: number; ms: number }> = [];
  const baseUrl = `http://localhost:${process.env.PORT || 3000}`;

  // Warm up routes sequentially (to avoid memory spikes from parallel compilation)
  for (const route of routes) {
    const start = Date.now();
    try {
      const res = await fetch(`${baseUrl}${route.path}`, {
        method: route.method,
        signal: AbortSignal.timeout(15000),
      });
      results.push({ id: route.id, status: res.status, ms: Date.now() - start });
    } catch (err: any) {
      results.push({
        id: route.id,
        status: 0,
        ms: Date.now() - start,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    warmed: results.length,
    results,
    totalMs: results.reduce((sum, r) => sum + r.ms, 0),
  });
}
