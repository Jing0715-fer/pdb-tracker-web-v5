/**
 * GET /api/health
 *
 * Lightweight liveness/readiness probe for orchestrators (k8s, Docker, Caddy
 * health checks, uptime monitors).
 *
 * Response (200, status="ok"):
 *   {
 *     "status": "ok",
 *     "timestamp": "2024-01-01T00:00:00.000Z",
 *     "uptime": 123.45,                    // seconds since process start
 *     "memory": { "rss": 50, "heapUsed": 10, "heapTotal": 20, "external": 3 }, // MB
 *     "db": "connected",
 *     "version": "1.0.0"
 *   }
 *
 * Response (503, status="degraded"):
 *   { ...same shape..., "status": "degraded", "db": "error" }
 *
 * The DB check runs `SELECT 1` through the existing Prisma `db` proxy so it
 * honours the active database resolved by `src/lib/db.ts` (config file →
 * DATABASE_URL → bundled test DB).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { createLogger } from '@/lib/logger';

const log = createLogger('api/health');

const APP_VERSION = '1.0.0';

/** Convert bytes → megabytes, rounded to 1 decimal place. */
function bytesToMB(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 10) / 10;
}

interface HealthResponse {
  status: 'ok' | 'degraded';
  timestamp: string;
  uptime: number;
  memory: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
  };
  db: 'connected' | 'error';
  version: string;
}

export async function GET() {
  const timestamp = new Date().toISOString();
  const uptime = Math.round(process.uptime() * 100) / 100;
  const mem = process.memoryUsage();

  // Probe DB connectivity with a trivial `SELECT 1`. Wrapped so a thrown
  // Prisma error (e.g. missing file, locked DB) degrades the probe instead of
  // crashing the route.
  let dbStatus: 'connected' | 'error' = 'connected';
  try {
    await db.$queryRaw`SELECT 1`;
  } catch (err) {
    dbStatus = 'error';
    log.error('DB health check failed', err);
  }

  const body: HealthResponse = {
    status: dbStatus === 'connected' ? 'ok' : 'degraded',
    timestamp,
    uptime,
    memory: {
      rss: bytesToMB(mem.rss),
      heapUsed: bytesToMB(mem.heapUsed),
      heapTotal: bytesToMB(mem.heapTotal),
      external: bytesToMB(mem.external),
    },
    db: dbStatus,
    version: APP_VERSION,
  };

  const httpStatus = body.status === 'ok' ? 200 : 503;
  return NextResponse.json(body, { status: httpStatus });
}
