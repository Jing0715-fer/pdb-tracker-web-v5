/**
 * R207: 配图 URL 视图层改写（client/server 共用纯函数）。
 *
 * 背景：Wikimedia CDN（upload/thumb.wikimedia.org）与 RCSB CDN 在部分用户
 * 网络（如大陆出口）直连可达性不稳定 —— 报告正文/画廊里的 <img> 若用原始
 * 外链，用户浏览器加载失败即整图空白。沙箱服务器侧可达性良好（run #2 实测
 * 200/586KB），故经服务端代理转发是确定性修复。
 *
 * 改写只发生在「渲染出口」（markdown 嵌入、前端 img src）：ReportFigure.url
 * 恒存原始外链（下载/VLM/去重/溯源语义不变）。
 *
 * R209: 改写范围从「静态白名单域」扩大到「全部 https 图 URL」—— MiniMax
 * web_search 图源的图片来自任意公网站点（教育站/期刊站/CDN），逐域维护白
 * 名单不可行；代理路由侧以 SSRF 防护（私网/环回主机拒绝 + https-only +
 * image/* content-type + 4MB 上限）兜安全。http URL 保持原样（代理不接受
 * http，宁直连不劫持）。
 */

/** 既有静态白名单域（代理路由据此决定是否注入 Wikimedia 礼仪 UA）。 */
const PROXIED_HOSTS = [
  'upload.wikimedia.org',
  'thumb.wikimedia.org',
  'commons.wikimedia.org',
  'cdn.rcsb.org',
];

/** 代理路由的展示性 UA（与 figures.ts COMMONS_UA 同款 —— Wikimedia 全域
 * 要求 UA 带联系方式，否则 403 严限流桶；代理请求由 Next 服务端发出）。 */
export const FIGURE_PROXY_UA = 'PDB-Tracker/1.0 (+https://github.com/Jing0715-fer/pdb-tracker-web-v5)';

/** 判断 URL 是否为静态白名单图源（https + 域名后缀匹配）。
 * R209 起只用于 UA 注入判定；是否走代理见 proxyFigureUrl（全部 https）。 */
export function isProxiedFigureUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && PROXIED_HOSTS.some(h => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

/** 渲染出口统一改写：https 图 URL → /api/figure-proxy?url=<enc>；其余原样。
 * （R207：仅白名单域；R209：全部 https —— 见文件头注释。） */
export function proxyFigureUrl(url: string): string {
  if (!url) return url;
  try {
    if (new URL(url).protocol !== 'https:') return url;
  } catch {
    return url;
  }
  return `/api/figure-proxy?url=${encodeURIComponent(url)}`;
}
