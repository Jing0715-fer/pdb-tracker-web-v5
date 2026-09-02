/**
 * R207: 配图代理路由 —— 报告中的外链图（Wikimedia/RCSB CDN）经本服务转发，
 * 解决用户浏览器直连图源 CDN 不可达（大陆网络对 upload/thumb.wikimedia.org
 * 间歇阻断，实测沙箱侧 200）导致的整图空白。
 *
 * 安全与礼仪：
 * - R207 初版：静态白名单域（figure-view PROXIED_HOSTS）—— 非 https 或域外
 *   URL 一律 400，杜绝开放代理/SSRF。
 * - R209：白名单放宽为「任意公网 https 主机」—— MiniMax web_search 图源的
 *   图片来自任意站点，逐域白名单不可行。SSRF 防护改为出口侧硬校验：
 *   ① 仅 https、无显式端口；② 主机名拒绝环回/私网/链路本地/内网后缀
 *   （localhost / 127/8 / 10/8 / 172.16-31 / 192.168/16 / 169.254/16 /
 *   IPv6 等价段 / .internal / .local）；③ 响应 content-type 必须 image/*；
 *   ④ ≤4MB、20s 超时、并发 4。渲染侧（proxyFigureUrl）只产出 https 目标，
 *   旧报告里的白名单域行为不变。
 * - Wikimedia 域带联系方式 UA（其全域礼仪要求，无 URL/email 的 UA 进 403
 *   严限流桶）；RCSB CDN 无要求但不干预。
 * - 小容量内存缓存（≤24 项 / ~48MB，超出逐出最老）—— 同一报告画廊 +
 *   正文 + 懒加载会多次请求同一 URL；响应带 immutable 24h 浏览器缓存。
 */
import { NextResponse } from 'next/server';
import { FIGURE_PROXY_UA } from '@/lib/figure-view';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TIMEOUT_MS = 20_000;
const MAX_CONCURRENT = 4;
/** R209: 排队等待上限 —— 并发满时请求排队而非 429 立拒（浏览器 <img>
 * 不会自动重试，一次 429 = 永久缺图；报告打开时的图墙瞬时并发常见 >4）。 */
const SLOT_WAIT_MS = 30_000;
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

/** R209: 并发信号量（轮询式，50ms 粒度）—— 满载时排队等待空位。 */
async function withConcurrencySlot<T>(fn: () => Promise<T>): Promise<T> {
  const deadline = Date.now() + SLOT_WAIT_MS;
  while (inflight >= MAX_CONCURRENT) {
    if (Date.now() > deadline) throw new Error('concurrency queue timeout');
    await new Promise(r => setTimeout(r, 50));
  }
  inflight++;
  try {
    return await fn();
  } finally {
    inflight--;
  }
}

// ─── R209: SSRF 出口防护 ────────────────────────────────────────────────────

function isPrivateIPv4(host: string): boolean {
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const o = m.slice(1).map(Number);
  if (o.some(n => n > 255)) return false;
  if (o[0] === 127 || o[0] === 10 || o[0] === 0) return true;          // loopback / private / this-host
  if (o[0] === 169 && o[1] === 254) return true;                        // link-local
  if (o[0] === 192 && o[1] === 168) return true;                        // private
  if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true;            // private
  return false;
}

/** 主机名是否命中 SSRF 防护（环回/私网/链路本地/内网后缀/IPv6 等价段）。 */
function isBlockedProxyHost(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, ''); // IPv6 字面量去括号
  if (h === 'localhost' || h.endsWith('.localhost')) return true;
  if (h.endsWith('.internal') || h.endsWith('.local') || h.endsWith('.lan') || h.endsWith('.home')) return true;
  if (isPrivateIPv4(h)) return true;
  // IPv6：环回/唯一本地/链路本地/IPv4 映射段。
  if (h === '::1' || h === '::' ) return true;
  if (h.startsWith('fc') || h.startsWith('fd')) return true;           // fc00::/7 唯一本地
  if (h.startsWith('fe8') || h.startsWith('fe9') || h.startsWith('fea') || h.startsWith('feb')) return true; // fe80::/10
  if (h.startsWith('::ffff:')) return isPrivateIPv4(h.slice('::ffff:'.length)); // IPv4-mapped
  return false;
}

/** R209: 代理目标合法性（https + 公网主机 + 无显式端口）。 */
export function isProxyableTarget(url: string): boolean {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false;
    if (u.port && u.port !== '443') return false; // 显式非 443 端口一律拒绝
    return !isBlockedProxyHost(u.hostname);
  } catch {
    return false;
  }
}

export async function GET(req: Request) {
  const target = new URL(req.url).searchParams.get('url') || '';
  if (!target || !isProxyableTarget(target)) {
    return NextResponse.json({ error: 'url must be a public https image URL' }, { status: 400 });
  }
  const hit = cache.get(target);
  if (hit) {
    return new NextResponse(hit.buf, {
      headers: { 'Content-Type': hit.ct, 'Cache-Control': 'public, max-age=86400, immutable' },
    });
  }
  // R209: 并发信号量 —— 满载排队（30s 上限）而非 429 立拒（浏览器 <img>
  // 不重试，429 = 永久缺图）。缓存命中不经信号量（内存读取无并发压力）。
  try {
    return await withConcurrencySlot(async () => {
      // R209: 所有代理目标统一带联系方式 UA —— ① Wikimedia 全域礼仪（无
      // URL/email 的 UA 进 403 严限流桶，R205 实测）；② en.wikipedia.org 等
      // 站点 CDN 会 403 无 UA / undici 默认 UA 的请求（实测对照：直连 curl
      // 200，Node fetch 无 UA 403）；PDB-Tracker 标识 UA 实测两者皆 200。
      const resp = await fetch(target, {
        headers: { 'User-Agent': FIGURE_PROXY_UA },
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
    });
  } catch {
    return NextResponse.json({ error: 'figure fetch failed/timeout' }, { status: 502 });
  }
}
