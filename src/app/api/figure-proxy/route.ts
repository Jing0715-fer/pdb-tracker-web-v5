/**
 * R207: 配图代理路由 —— 报告中的外链图（Wikimedia/RCSB CDN）经本服务转发，
 * 解决用户浏览器直连图源 CDN 不可达（大陆网络对 upload/thumb.wikimedia.org
 * 间歇阻断，实测沙箱侧 200）导致的整图空白。
 *
 * 安全与礼仪：
 * - 白名单域（figure-view.ts PROXIED_HOSTS 后缀匹配）—— 非 https 或域外
 *   URL 一律 400，杜绝开放代理/SSRF。
 * - Wikimedia 域带联系方式 UA（其全域礼仪要求，无 URL/email 的 UA 进 403
 *   严限流桶）；RCSB CDN 无要求但不干预。
 * - 并发上限 4（单报告最多 11 图，防瞬间打满）；单请求 20s 超时。
 * - 小容量内存缓存（≤24 项 / ~48MB，超出逐出最老）—— 同一报告画廊 +
 *   正文 + 懒加载会多次请求同一 URL；响应带 immutable 24h 浏览器缓存。
 */
import { NextResponse } from 'next/server';
import { isProxiedFigureUrl, FIGURE_PROXY_UA } from '@/lib/figure-view';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UA_HOST_RE = /wikimedia\.org$/i;
const TIMEOUT_MS = 20_000;
const MAX_CONCURRENT = 4;
const CACHE_MAX_ITEMS = 24;
const CACHE_MAX_BYTES = 48 * 1024 * 1024;

const cache = new Map<string, { buf: ArrayBuffer; ct: string; bytes: number }>();
let cacheBytes = 0;
let inflight = 0;

function cachePut(key: string, val: { buf: ArrayBuffer; ct: string; bytes: number }) {
  cache.set(key, val);
  cacheBytes += val.bytes;
  while (cache.size > CACHE_MAX_ITEMS || cacheBytes > CACHE_MAX_BYTES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    const hit = cache.get(oldest);
    cache.delete(oldest);
    if (hit) cacheBytes -= hit.bytes;
  }
}

export async function GET(req: Request) {
  const target = new URL(req.url).searchParams.get('url') || '';
  if (!target || !isProxiedFigureUrl(target)) {
    return NextResponse.json({ error: 'url must be an allowed figure CDN https URL' }, { status: 400 });
  }
  const hit = cache.get(target);
  if (hit) {
    return new NextResponse(hit.buf, {
      headers: { 'Content-Type': hit.ct, 'Cache-Control': 'public, max-age=86400, immutable' },
    });
  }
  if (inflight >= MAX_CONCURRENT) {
    return NextResponse.json({ error: 'figure proxy busy, retry shortly' }, { status: 429 });
  }
  inflight++;
  try {
    const host = new URL(target).hostname;
    const resp = await fetch(target, {
      headers: UA_HOST_RE.test(host) ? { 'User-Agent': FIGURE_PROXY_UA } : {},
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!resp.ok) {
      return NextResponse.json({ error: `figure origin ${resp.status}` }, { status: resp.status === 404 ? 404 : 502 });
    }
    const ct = resp.headers.get('content-type') || 'application/octet-stream';
    if (!/^image\//i.test(ct)) {
      return NextResponse.json({ error: `not an image (${ct})` }, { status: 415 });
    }
    const buf = await resp.arrayBuffer();
    if (buf.byteLength > 4 * 1024 * 1024) {
      return NextResponse.json({ error: 'figure too large' }, { status: 413 });
    }
    cachePut(target, { buf, ct, bytes: buf.byteLength });
    return new NextResponse(buf, {
      headers: { 'Content-Type': ct, 'Cache-Control': 'public, max-age=86400, immutable' },
    });
  } catch {
    return NextResponse.json({ error: 'figure fetch failed/timeout' }, { status: 502 });
  } finally {
    inflight--;
  }
}
