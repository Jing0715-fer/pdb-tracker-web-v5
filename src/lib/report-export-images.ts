/**
 * R210: 报告导出的图片内联（data URI）与 URL 反代理化。
 *
 * 背景：DSH 报告正文的图片 URL 全部是同源代理形
 * `/api/figure-proxy?url=<enc>`（R207 引入，解决用户浏览器对
 * wikimedia/rcsb CDN 的可达性）。在应用内渲染没问题；但导出的
 * 独立 HTML 文件（Blob 下载 / file:// 打开）中相对 URL 失效 →
 * 「导出的 html 报告没有图片」。修复：导出前把每张图经代理取回、
 * 转 base64 data URI 嵌入 —— 文件自包含、离线可看。
 *
 * 浏览器与 bun 均可运行（fetch + Blob.arrayBuffer + 分块 btoa），
 * 便于 bun 直跑功能验证。
 */

/** 单图下载上限（代理路由同款 4MB；再留余量）。 */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** 单图超时。 */
const FETCH_TIMEOUT_MS = 20_000;
/** 内联图片总数上限（DSH 报告典型 6-15 张，30 为护栏）。 */
const MAX_IMAGES = 30;
/** 并发（代理路由自身有排队，客户端并发 4 足够）。 */
const CONCURRENCY = 4;

/** 提取 markdown 图片 URL（`![alt](url)` 与 `![alt](url "title")` 两种形）。 */
export function extractMarkdownImageUrls(markdown: string): string[] {
  const out: string[] = [];
  const re = /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markdown)) !== null) {
    const url = m[1];
    if (url && !out.includes(url)) out.push(url);
  }
  return out;
}

/** 归一化为「可 fetch 的同源地址」：代理形原样；https 绝对地址走代理；其余 null。 */
export function fetchableImageUrl(url: string): string | null {
  if (url.startsWith('/api/figure-proxy')) return url;
  if (/^https:\/\//i.test(url)) return `/api/figure-proxy?url=${encodeURIComponent(url)}`;
  return null; // data: 已内联；http:/相对地址不入流
}

/** ArrayBuffer → data URI（分块 btoa，防大图栈溢出）。 */
export function arrayBufferToDataUri(buf: ArrayBuffer, mime: string): string {
  const bytes = new Uint8Array(buf);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

export interface InlineImagesResult {
  markdown: string;
  /** 成功内联的图片数。 */
  inlined: number;
  /** 失败/跳过（保持原 URL，导出后该图不显示但不破坏其余内容）。 */
  failed: number;
}

/**
 * 把 markdown 中的远程图片内联为 data URI。
 * 失败的图保持原 URL（导出后显示 alt 文本），绝不抛错阻断导出。
 * opts.baseUrl：非浏览器环境（bun 测试）下给相对代理地址拼基础前缀；
 * 浏览器内不传（document base 解析同源相对地址）。
 */
export async function inlineReportImages(
  markdown: string,
  onProgress?: (done: number, total: number) => void,
  opts?: { baseUrl?: string },
): Promise<InlineImagesResult> {
  const urls = extractMarkdownImageUrls(markdown)
    .map(u => ({ original: u, fetchUrl: fetchableImageUrl(u) }))
    .filter(u => u.fetchUrl != null)
    .slice(0, MAX_IMAGES);
  if (urls.length === 0) {
    onProgress?.(0, 0);
    return { markdown, inlined: 0, failed: 0 };
  }
  const base = (opts?.baseUrl || '').replace(/\/$/, '');

  const dataUris = new Map<string, string>();
  let done = 0;
  let failed = 0;

  const fetchOne = async (entry: { original: string; fetchUrl: string }) => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const res = await fetch(base ? base + entry.fetchUrl : entry.fetchUrl, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const mime = (res.headers.get('content-type') || '').split(';')[0].trim();
      if (!mime.startsWith('image/')) throw new Error(`not image: ${mime}`);
      const blob = await res.blob();
      if (blob.size > MAX_IMAGE_BYTES) throw new Error(`too large: ${blob.size}`);
      const buf = await blob.arrayBuffer();
      dataUris.set(entry.original, arrayBufferToDataUri(buf, mime));
    } catch {
      failed++;
    } finally {
      done++;
      onProgress?.(done, urls.length);
    }
  };

  // 简单并发池。
  let cursor = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, urls.length) }, async () => {
    while (cursor < urls.length) {
      const idx = cursor++;
      await fetchOne(urls[idx]);
    }
  });
  await Promise.all(workers);

  let out = markdown;
  for (const [original, dataUri] of dataUris) {
    out = out.split(original).join(dataUri);
  }
  return { markdown: out, inlined: dataUris.size, failed };
}

/**
 * 反代理化（.md 导出用）：`/api/figure-proxy?url=<enc>` → 原始 https 地址。
 * markdown 文件里代理相对地址无意义，还原成源 URL 便于溯源/二次编辑。
 */
export function decodeProxyUrlsInMarkdown(markdown: string): string {
  return markdown.replace(/\/api\/figure-proxy\?url=([^)\s]+)/g, (full, enc: string) => {
    try {
      const decoded = decodeURIComponent(enc);
      return /^https:\/\//i.test(decoded) ? decoded : full;
    } catch {
      return full;
    }
  });
}

/** markdown 是否含可内联的远程图片（决定导出按钮是否走内联流程）。 */
export function hasInlineableImages(markdown: string): boolean {
  return extractMarkdownImageUrls(markdown).some(u => fetchableImageUrl(u) != null);
}
