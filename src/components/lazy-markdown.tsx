'use client';

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Components } from 'react-markdown';
import { useState } from 'react';

interface LazyMarkdownProps {
  children: string;
  className?: string;
}

// R198（R197 延后项④）: img onError 降级 —— 主路径（DshFigureThumb 画廊）
// R197 已修；此处的次要路径（ReactMarkdown 渲染的评估报告 / 批量对比）遇到
// 失效图 URL（RCSB 下架 / 防盗链 / OSS 过期）旧版会永久显示破图图标。
// 加载失败时静默隐藏该图（与主路径「画廊隐藏破图」同语义）。
// R207: 白名单追加 /api/figure-proxy?url= 同源代理形 —— 报告图改走服务端
// 代理（用户网络直连 wikimedia/rcsb CDN 不可达），代理路由侧再做域名白名单。
function SafeMarkdownImg({ alt, src, title }: { alt?: string; src?: string; title?: string }) {
  const [broken, setBroken] = useState(false);
  const url = typeof src === 'string' ? src : '';
  const safe = /^https:\/\//i.test(url) || /^\/api\/figure-proxy\?url=/.test(url);
  if (!safe || broken) return null;
  return (
    <img
      src={url}
      alt={alt || ''}
      title={title}
      loading="lazy"
      onError={() => setBroken(true)}
      className="max-w-full rounded-lg border border-border/40 my-3"
    />
  );
}

// R179 (Task 2-b): DSH reports embed `![caption](url)` figures — react-markdown
// renders images by default, but we apply the same allowlist used by
// src/lib/markdown-renderer.ts (renderImageHtml / isSafeImgSrc there) so unsafe
// URLs render nothing instead of a broken/mixed-content image. Idiom mirrors
// ChatPanel's safeUrlTransform defense-in-depth comment (UI-021). R207: the
// allowlist also accepts the same-origin /api/figure-proxy form.
const lazyMarkdownComponents: Components = {
  // react-markdown 的 hast 属性（src/title/alt）类型为 string | Blob | undefined
  // （hast 规范的宽类型）——传入前收窄为 string（Blob 情况实际不会出现在 LLM 报告）。
  img: ({ alt, src, title }) => (
    <SafeMarkdownImg
      alt={typeof alt === 'string' ? alt : undefined}
      src={typeof src === 'string' ? src : undefined}
      title={typeof title === 'string' ? title : undefined}
    />
  ),
};

export function LazyMarkdown({ children, className }: LazyMarkdownProps) {
  return (
    <div className={`markdown-content ${className || ''}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={lazyMarkdownComponents}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
