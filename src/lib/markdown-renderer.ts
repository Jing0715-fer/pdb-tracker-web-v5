/**
 * Shared markdown → HTML converter for LLM-generated reports.
 *
 * Why not react-markdown + remark-gfm?
 *   In our batch reports, the 9IP8 list (a perfectly-formed GFM pipe table
 *   with `|---|` separator) was being rendered as plain text — the parser
 *   failed to recognize the table when it was preceded by a Chinese paragraph
 *   ending in `**` (bold) + `：` (full-width colon). We could not reproduce the
 *   failure in isolation, only in the browser — suggesting a hydration or
 *   remark-gfm edge case we don't have time to track down. Our own converter
 *   is more predictable: 4 table formats supported, and it correctly renders
 *   every table in every batch report we have.
 *
 * Supported syntax:
 *   - Pipe-separated with separator:  | a | b | / |---| / | c | d |
 *   - Pipe-separated without separator (LLMs sometimes skip it)
 *   - Tab-separated (LLMs frequently use tabs in batch overviews)
 *   - Multi-space-separated (≥ 2 spaces between cells)
 *   - Headings: # / ## / ###
 *   - Lists: - * / 1.
 *   - Bold **x** / Italic *x* / Code `x` / URLs (auto-linked)
 *   - Horizontal rule: ---
 *
 * Used by:
 *   - src/components/ui/pdb-ui.tsx (ReportModal — batch cross-target reports)
 *   - src/components/eval-report-generator.tsx (single-eval LLM chapter report)
 */

export interface MarkdownRenderResult {
  /** The rendered body HTML (no <html>/<head>/<body> wrapper — caller can wrap). */
  bodyHtml: string;
  /** True if the source had at least one table. Useful for debugging. */
  hadTable: boolean;
  /** True if the source had at least one heading. */
  hadHeading: boolean;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * True if every cell in a table row is "junk" (only `---`, `:`, `…`, or
 * whitespace). LLMs sometimes append a stray separator line + placeholder
 * tail (e.g. `|---|---|---|` then `|…|…|…|`) at the end of a table when
 * running out of content. Without this filter the renderer would treat
 * those as data rows, producing visible "---" / "…" cells.
 */
function isJunkTableRow(cells: string[]): boolean {
  if (cells.length === 0) return true;
  return cells.every((c) => /^[-:\s…]+$/.test(c));
}

function renderInline(text: string): string {
  // Escape first, then apply inline markdown on the safe string. Order matters:
  // bold/italic/code replacements should not be re-escaped.
  let s = escapeHtml(text);
  // R179 (Task 2-b): images `![alt](url)` — DSH reports embed figures inline.
  // R187: alt 允许含 `]`（RCSB 化学标题如 pyrrolo[1,2-c]imidazol 带裸
  // 方括号，旧正则 [^\]]* 在第一个 ] 处失配 → 整图不渲染）。改用惰性
  // 量纲 [^\n]*? —— 在第一个 "](https…" 处停止，alt 内的 ]/[/( 均安全；
  // 生成侧（figures.ts figureImageMarkdown）也已消毒，此处为渲染侧兜底。
  // SECURITY: only absolute https:// URLs survive; anything else is dropped
  // (keeping the alt text as italic). The tag is stashed behind a \u0002
  // placeholder so the auto-link pass below cannot corrupt the src attribute.
  const imgStash: string[] = [];
  s = s.replace(
    /!\[([^\n]*?)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g,
    (_m, alt: string, url: string) => {
      imgStash.push(renderImageHtml(alt, url));
      return `\u0002${imgStash.length - 1}\u0002`;
    }
  );
  // Inline code: `code`
  s = s.replace(
    /`([^`]+)`/g,
    '<code style="background:#f5f0ea;padding:1px 4px;border-radius:3px;font-family:monospace;font-size:0.9em;color:#c96442;">$1</code>'
  );
  // Bold: **text**
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // Italic: *text* (not part of **)
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  // Auto-link http(s) URLs
  s = s.replace(
    /(https?:\/\/[^\s<]+)/g,
    '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:#c96442;text-decoration:underline;">$1</a>'
  );
  // R179 (Task 2-b): restore stashed image tags (post auto-link, so their
  // src URLs were never exposed to the linker).
  s = s.replace(/\u0002(\d+)\u0002/g, (_m, i: string) => imgStash[parseInt(i, 10)] ?? '');
  return s;
}

/** R207: 图片 src 安全校验 —— https 绝对外链或本服务代理相对路径
 * （/api/figure-proxy?url=…，目标 URL 在代理路由侧做域名白名单二次校验）。
 * 代理形用于解决用户网络直连 wikimedia/rcsb CDN 不可达（报告图全空白）。 */
function isSafeImgSrc(u: string): boolean {
  return /^https:\/\//i.test(u) || /^\/api\/figure-proxy\?url=/.test(u);
}

/**
 * R179 (Task 2-b): build a figure <img> tag from (already-escaped) alt + url.
 *
 * SECURITY allowlist: https:// 绝对外链或 /api/figure-proxy 同源代理相对
 * 路径（R207，见 isSafeImgSrc）；http:/data:/javascript: 等一律丢弃，保留
 * alt 文本作灰色斜体（读者至少能看到图注）。Both inputs MUST already be
 * HTML-escaped (via escapeHtml) — attribute injection is impossible because
 * `"` / `<` / `>` / `&` are all entity-encoded by then.
 */
function renderImageHtml(escapedAlt: string, escapedUrl: string): string {
  if (isSafeImgSrc(escapedUrl)) {
    return `<img src="${escapedUrl}" alt="${escapedAlt}" loading="lazy" class="dsh-report-figure" style="${FIGURE_IMG_STYLE}" />`;
  }
  return escapedAlt
    ? `<em style="font-size:13px;color:#6b5d4f;">${escapedAlt}</em>`
    : '';
}

// R179 (Task 2-b): DSH report figure styling — mirrors the in-app thumbnail
// card look (rounded, hairline border, block layout, responsive width).
const FIGURE_IMG_STYLE =
  'max-width:100%;height:auto;border-radius:0.5rem;border:1px solid rgba(128,128,128,0.25);margin:0.75rem 0;display:block;';

const TABLE_TH_STYLE =
  'background:#f5f0ea;font-weight:600;text-align:left;padding:8px 12px;border-bottom:2px solid #e8e4dd;word-break:break-word;overflow-wrap:anywhere;';
const TABLE_TD_STYLE =
  'padding:8px 12px;border-bottom:1px solid #f0ece6;word-break:break-word;overflow-wrap:anywhere;';
const TABLE_STYLE =
  'width:100%;border-collapse:collapse;margin:14px 0;font-size:13px;table-layout:fixed;word-break:break-word;overflow-wrap:anywhere;';

/** Render markdown to body HTML (no wrapper). Returns rich metadata. */
export function renderMarkdownToHtml(md: string): MarkdownRenderResult {
  // Normalize \r\n / \r line endings to \n so the line-based block parser
  // sees the document correctly. Some DB-stored reports come in with
  // bare \r (e.g. legacy single-call evaluations), which would otherwise
  // collapse the whole report into one <p>.
  const normalized = md.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');
  const out: string[] = [];
  let i = 0;
  let hadTable = false;
  let hadHeading = false;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // ─── Fenced code blocks（R198 / R197 延后项③） ─────────────────────
    // LLM 报告（DSH 章节 / 批量对比 / 经典分章）偶尔以 ``` 包裹命令行、JSON
    // 或序列片段。旧渲染器把围栏行当普通段落：正文出现裸 ``` 字符，且围栏
    // 内部的 `| a | b |` / `## x` / `- y` 会被表格/标题/列表分支误判。
    // 现按块级处理：开围栏（``` 可带语言标注）到闭围栏（或文档结尾）之间
    // 原样进 <pre>（仅 HTML 转义，不跑行内 markdown）；闭围栏须与开围栏
    // 同为纯反引号行且长度 ≥ 开围栏（CommonMark 语义）；未闭合时按文档
    // 截断处理并给出可见提示（与 sanitizeMarkdownReport 截断语义一致）。
    const fenceOpen = trimmed.match(/^(`{3,})([^\n]*)$/);
    if (fenceOpen) {
      const fenceLen = fenceOpen[1].length;
      const info = fenceOpen[2].trim();
      const codeLines: string[] = [];
      i++;
      let closed = false;
      while (i < lines.length) {
        const t = lines[i].trim();
        if (/^`{3,}$/.test(t) && t.length >= fenceLen) { closed = true; i++; break; }
        codeLines.push(lines[i]);
        i++;
      }
      const codeHtml = escapeHtml(codeLines.join('\n'));
      const labelHtml = info
        ? `<div style="font-size:11px;color:#6b5d4f;margin:0 0 4px 0;padding-left:2px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;">${escapeHtml(info)}</div>`
        : '';
      out.push(
        `<div style="margin:10px 0;">${labelHtml}<pre style="background:#f8f5f1;border:1px solid #e8e4dd;border-radius:6px;padding:10px 12px;margin:0;overflow-x:auto;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:12.5px;line-height:1.5;color:#3d3832;white-space:pre;">${codeHtml}${closed ? '' : '\n（围栏未闭合 — 报告可能被截断）'}</pre></div>`
      );
      continue;
    }

    // ─── Markdown table detection ─────────────────────────────────────
    // Four formats supported:
    //  1. Pipe-separated with separator: | a | b | / |---| / | c | d |
    //  2. Pipe-separated without separator
    //  3. Tab-separated (LLMs use tabs in batch overview reports)
    //  4. Multi-space-separated (≥ 2 spaces)
    // ─────────────────────────────────────────────────────────────────
    const isPipeTable = trimmed.startsWith('|');
    const hasPipeSep =
      isPipeTable &&
      i + 1 < lines.length &&
      /^\s*\|?[\s|:-]+\|?\s*$/.test(lines[i + 1]) &&
      /[\s|:-]---/.test(lines[i + 1]);
    const tabCount = (line.match(/\t/g) || []).length;
    const multiSpaceSplit =
      !isPipeTable &&
      tabCount === 0 &&
      /[^\s]\s{2,}[^\s]/.test(line) &&
      line.split(/\s{2,}/).length >= 2;
    const isTabTable =
      !isPipeTable &&
      tabCount >= 1 &&
      i + 1 < lines.length &&
      (lines[i + 1].match(/\t/g) || []).length === tabCount;

    // Pipe table (with or without separator)
    if (isPipeTable) {
      const headerCells = trimmed
        .replace(/^\|/, '')
        .replace(/\|$/, '')
        .split('|')
        .map((c) => c.trim());
      const dataRows: string[][] = [];
      if (hasPipeSep) i += 2;
      else i += 1; // no separator — first row is header
      // Collect pipe rows, allowing a single blank line between them.
      // Some LLMs emit tables with blank lines between data rows
      // (`| a |\n\n| b |\n\n| c |`); GFM is strict about no-blanks, but PDB
      // trackers often pipe MD through several LLM layers that add the
      // blanks, so we tolerate up to 1 blank between rows. More than
      // 1 blank means we're outside the table.
      const isPipeRowLine = (l: string) => l.trim().startsWith('|');
      while (i < lines.length) {
        // Consume one optional blank line between pipe rows
        if (lines[i].trim() === '') {
          // Peek: is the next non-blank line still a pipe row? If yes,
          // swallow this blank. If no, table ends here.
          let k = i + 1;
          while (k < lines.length && lines[k].trim() === '') k++;
          if (k < lines.length && isPipeRowLine(lines[k])) {
            i = k;
          } else {
            break;
          }
        }
        if (!isPipeRowLine(lines[i])) break;
        const rowCells = lines[i]
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split('|')
          .map((c) => c.trim());
        // Skip "junk" rows: cells that are all --- / : / … / spaces.
        // LLMs sometimes emit a stray separator line + placeholder tail
        // at the end of a table (e.g. `|---|---|---|` then `|…|…|…|`);
        // without this filter those render as visible `---` / `…` data cells.
        if (isJunkTableRow(rowCells)) { i++; continue; }
        dataRows.push(rowCells);
        i++;
      }
      out.push(`<table style="${TABLE_STYLE}">`);
      out.push('<thead><tr>');
      for (const h of headerCells) {
        out.push(`<th style="${TABLE_TH_STYLE}">${renderInline(h)}</th>`);
      }
      out.push('</tr></thead>');
      if (dataRows.length === 0) {
        out.push('</table>');
      } else {
        out.push('<tbody>');
        for (const row of dataRows) {
          out.push('<tr>');
          for (const c of row) {
            out.push(`<td style="${TABLE_TD_STYLE}">${renderInline(c)}</td>`);
          }
          out.push('</tr>');
        }
        out.push('</tbody></table>');
      }
      hadTable = true;
      continue;
    }

    // Tab-separated or multi-space-separated table
    if (isTabTable || multiSpaceSplit) {
      const split = (s: string) =>
        isTabTable
          ? s.split('\t').map((c) => c.trim())
          : s.split(/\s{2,}/).map((c) => c.trim());
      const headerCells = split(line);
      i++;
      const dataRows: string[][] = [];
      while (i < lines.length) {
        const next = lines[i];
        if (next.trim() === '') break;
        const nextTabs = (next.match(/\t/g) || []).length;
        const nextSplittable =
          !isTabTable && /[^\s]\s{2,}[^\s]/.test(next)
            ? next.split(/\s{2,}/)
            : null;
        if (isTabTable && nextTabs === tabCount) {
          dataRows.push(split(next));
          i++;
        } else if (
          !isTabTable &&
          nextSplittable &&
          nextSplittable.length === headerCells.length
        ) {
          dataRows.push(split(next));
          i++;
        } else {
          break;
        }
      }
      if (dataRows.length > 0) {
        out.push(`<table style="${TABLE_STYLE}">`);
        out.push('<thead><tr>');
        for (const h of headerCells) {
          out.push(`<th style="${TABLE_TH_STYLE}">${renderInline(h)}</th>`);
        }
        out.push('</tr></thead><tbody>');
        for (const row of dataRows) {
          out.push('<tr>');
          for (const c of row) {
            out.push(`<td style="${TABLE_TD_STYLE}">${renderInline(c)}</td>`);
          }
          out.push('</tr>');
        }
        out.push('</tbody></table>');
        hadTable = true;
        continue;
      }
      // Fall through to paragraph handling if no data rows
    }

    // Headings
    const h3 = line.match(/^###\s+(.*)$/);
    if (h3) {
      // Round 56: H3 sub-headings (A1, B1, §1.1 etc.) render distinctly smaller
      // than H2 chapter headings — 12.5px (vs 17px for H2), muted color, no
      // bottom border. This creates a clear visual hierarchy: report title (H1)
      // > chapter (H2) > sub-section (H3) > paragraph.
      out.push(
        `<h3 style="font-size:12.5px;font-weight:600;color:#6b5d4f;margin:14px 0 6px;padding-left:8px;border-left:3px solid #d4c4b0;line-height:1.4;">${renderInline(h3[1])}</h3>`
      );
      hadHeading = true;
      i++;
      continue;
    }
    const h2 = line.match(/^##\s+(.*)$/);
    if (h2) {
      out.push(
        `<h2 style="font-size:17px;font-weight:600;color:#c96442;margin:28px 0 14px;padding-bottom:6px;border-bottom:2px solid #e8e4dd;">${renderInline(h2[1])}</h2>`
      );
      hadHeading = true;
      i++;
      continue;
    }
    const h1 = line.match(/^#\s+(.*)$/);
    if (h1) {
      out.push(
        `<h1 style="font-size:22px;font-weight:700;color:#1a1a1a;margin:0 0 12px;">${renderInline(h1[1])}</h1>`
      );
      hadHeading = true;
      i++;
      continue;
    }
    // Horizontal rule
    if (/^---+\s*$/.test(line)) {
      out.push('<hr style="border:0;border-top:1px solid #e8e4dd;margin:20px 0;"/>');
      i++;
      continue;
    }
    // R179 (Task 2-b): blockquote `> …` lines — DSH reports open with a
    // `> 科学问题：…` quote under the title. Previously these rendered as a
    // literal "&gt;" paragraph; now consecutive `>` lines collapse into a
    // proper styled <blockquote>. Lines that merely CONTAIN `>` (e.g. the
    // auto-link pass) are unaffected — only line-start markers match.
    const bq = line.match(/^>\s?(.*)$/);
    if (bq) {
      const bqLines: string[] = [];
      while (i < lines.length) {
        const m = lines[i].match(/^>\s?(.*)$/);
        if (!m) break;
        bqLines.push(m[1]);
        i++;
      }
      out.push(
        `<blockquote style="margin:10px 0;padding:8px 14px;border-left:3px solid #d4c4b0;background:#f8f5f1;border-radius:0 6px 6px 0;color:#6b5d4f;font-size:13px;line-height:1.65;">${renderInline(bqLines.join(' ').trim())}</blockquote>`
      );
      continue;
    }
    // R179 (Task 2-b): standalone image line `![alt](url)` — DSH reports emit
    // one figure per line between chapter paragraphs. renderInline also
    // handles inline occurrences, but the block pass gives clean block-level
    // <img> markup (no surrounding <p>) for the common case.
    // R187: alt 同步允许裸 ]（化学名方括号），与 renderInline 口径一致。
    const imgBlock = trimmed.match(/^!\[([^\n]*?)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\s*$/);
    if (imgBlock) {
      out.push(renderImageHtml(escapeHtml(imgBlock[1]), escapeHtml(imgBlock[2])));
      i++;
      continue;
    }
    // Unordered list
    const ul = line.match(/^(\s*)[-*]\s+(.*)$/);
    if (ul) {
      out.push('<ul style="margin:8px 0 12px 24px;font-size:14px;">');
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)[-*]\s+(.*)$/);
        if (!m) break;
        out.push(`<li style="margin-bottom:4px;">${renderInline(m[2])}</li>`);
        i++;
      }
      out.push('</ul>');
      continue;
    }
    // Ordered list
    const ol = line.match(/^(\s*)\d+\.\s+(.*)$/);
    if (ol) {
      out.push('<ol style="margin:8px 0 12px 24px;font-size:14px;">');
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)\d+\.\s+(.*)$/);
        if (!m) break;
        out.push(`<li style="margin-bottom:4px;">${renderInline(m[2])}</li>`);
        i++;
      }
      out.push('</ol>');
      continue;
    }
    // Empty line
    if (line.trim() === '') {
      out.push('<div style="height:6px;"></div>');
      i++;
      continue;
    }
    // Plain paragraph: collect consecutive non-empty, non-block-starter lines
    const paraLines: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(\s*)[#\-|*]|\d+\.\s|^`{3}/.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    out.push(
      `<p style="margin:8px 0 12px;font-size:14px;line-height:1.65;">${renderInline(paraLines.join(' '))}</p>`
    );
  }

  return {
    bodyHtml: out.join('\n'),
    hadTable,
    hadHeading,
  };
}

/** Pre-process: strip YAML frontmatter (---\n…\n---) and the first H1 heading. */
export function stripMarkdownFrontmatterAndTitle(md: string): string {
  // Normalize line endings — DB-stored reports sometimes arrive as \r\n
  // (the route handler concatenates chapter-mode LLM output that may
  // include CR). The renderer splits on \n only, so any \r in the input
  // causes a single long line that no block-level regex will match —
  // the whole report collapses to a single <p>.
  return md
    .replace(/\r\n?/g, '\n')
    // Strip YAML frontmatter: must be at the very start of the document,
    // bounded by `---` on its own line. Markdown horizontal rules are
    // also `---` but they appear mid-document, so the `\A` anchor
    // (string start, not line start) is what makes this safe.
    .replace(/\A---\n[\s\S]*?\n---\s*/m, '')
    // Strip the FIRST H1 heading, wherever it is. LLMs often open the
    // report with a chatty preamble ("我来为 ... 生成完整的结构评估报告。")
    // before the actual H1 title, so the H1 may not be at offset 0.
    // Use the `m` flag so ^ matches any line start, and `g` would be
    // wrong (we only want the first H1 — leaving subsequent ## headings
    // intact). Do the substitution once with .replace and a /m regex.
    .replace(/^# [^\n]*\n?/m, '');
}

/**
 * Sanitize an LLM-generated markdown report for safe rendering.
 *
 * Background: the LLM may be cut off mid-generation by the API's token
 * limit. The 6 reports we have in our DB all show this — eval-P07766 ends
 * with `| # | PDB | 分辨率 | 内容 | 期刊 |` (table header, no separator, no
 * data rows); the 4 batch reports end mid-sentence (`Exon20 插入突变的差异
 * 化结合模式开`, `— 考`, `— 这` etc.).
 *
 * This function:
 *   1. Closes unclosed `**` bold spans (LLM may have produced odd count
 *      if cut off mid-token).
 *   2. (Backtick code-span fix skipped.)
 *   2.5. Collapses runs of "API call failed …" lines (chapter-mode HTTP
 *      429 errors) into a single `_(本章生成失败：…)_` marker, so step 5
 *      doesn't silently delete the fact that a chapter failed.
 *   3. Detects mid-table truncation: if the last line is a pipe header
 *      with no separator/data below, append a "..." row so the table
 *      stays well-formed.
 *   4. Detects mid-sentence truncation in the trailing paragraph:
 *      cuts back to the last full sentence-ending punctuation, so the
 *      report doesn't end with a half-word like `开` or `考`.
 *   5. Removes orphan JSON/object fragments (lines like `{"Primar`).
 *
 * Applied at the INGESTION point (just before writing to Evaluation.report
 * or EvaluationBatch.combinedReport) so the DB stores clean, complete
 * reports. The renderer doesn't have to handle the half-written edge
 * cases anymore.
 */
export function sanitizeReport(md: string): string {
  if (!md) return md;
  // Normalize line endings before anything else. Some upstream callers
  // (legacy single-call LLM output, or reports concat'd in route handlers
  // that didn't strip CR) may pass in \r\n or bare \r. Downstream
  // regexes all assume \n.
  let s = md.replace(/\r\n?/g, '\n');
  // 1) Close unclosed bold spans. Count `**` (non-overlapping).
  // 2) Close unclosed backtick code spans. Pair-counting is harder
  //    because of triple-backtick blocks, but for our case the LLM
  //    only ever produces inline single-backticks. If odd count, append
  //    a closing backtick.
  //    Skip the backtick-fix for now (the 6 sample reports don't have
  //    any truncated code spans).
  // 2.4) Strip LLM tool-call leakage. Some CLI LLMs (codebuddy, hermes)
  //      internally attempt to call a write_file / save tool when asked to
  //      "generate" a chapter, then — when the tool is refused — emit the
  //      refusal message AS report text. The user sees lines like:
  //        "Write permission is not available in this context. Here is the
  //         chapter content directly:"
  //      embedded in the rendered report. These lines are never part of
  //      the intended report body, so we drop them (and the trailing
  //      "Here is ... directly:" lead-in that sometimes precedes real
  //      content). We match a few common phrasings; the real chapter
  //      markdown always follows on the next lines.
  s = s.replace(
    /[^\n]*(?:Write permission is not available|write_file.*denied|cannot write to (?:file|disk)|tool.*not available in this context)[^\n]*\n?/gi,
    ''
  );
  s = s.replace(
    /[^\n]*Here is the (?:chapter|report|content) directly:?\s*\n/gi,
    ''
  );
  // 2.5) Collapse runs of "API call failed" lines into a single error
  //      marker per chapter, so subsequent mid-sentence trimming doesn't
  //      silently delete the fact that a chapter failed to generate.
  //      Background: in chapter-mode the route loop tries each chapter
  //      independently; if 6/8 fail with HTTP 429 we end up with 6 lines
  //      of "API call failed after 3 retries: ..." in the concatenated
  //      report. The old behavior was to cut back to the last "。" in
  //      step 4 — which deleted all 6 error lines along with everything
  //      before the surviving chapter. The user couldn't tell that 6
  //      chapters were missing.
  s = s.replace(
    /(?:\n|^)([^\n]*API call failed[^\n]*\n)+/g,
    (block) => {
      // Count the number of failure lines
      const lines = block.trim().split('\n');
      const firstLine = lines[0];
      // Extract a short reason from the first line (the part after the last `:`)
      const colonIdx = firstLine.lastIndexOf(':');
      const reason = colonIdx > 0 ? firstLine.substring(colonIdx + 1).trim() : firstLine;
      return `\n\n_(本章生成失败：${reason})_\n\n`;
    }
  );
  // 3) Close unclosed backtick code spans. (Skipped for now.)
  // 4) Detect mid-table truncation. Walk line-by-line. The pattern:
  //    Don't count `***` (bold-italic) — it uses 3 `*` chars.
  //    We do that by replacing `***` with a placeholder first.
  const BOLD_PLACEHOLDER = '\u0001BOLDSTAR\u0001';
  const ITALIC_PLACEHOLDER = '\u0001ITALIC\u0001';
  let sCount = s.replace(/\*\*\*/g, () => '\u0001BOLDITALIC\u0001');
  // Now in sCount, `**` is always a bold marker, never part of ***.
  const boldMatches = sCount.match(/\*\*/g) || [];
  if (boldMatches.length % 2 !== 0) {
    // Odd number of ** → append a closing ** at the end of the last
    // paragraph (don't tack on a stray ** at the very end of the doc,
    // which would look weird in rendered HTML).
    s = s + '**';
  }
  // (Backtick code-span fix is intentionally skipped — the 6 sample
  // reports don't have any truncated code spans.)
  void ITALIC_PLACEHOLDER; void BOLD_PLACEHOLDER;

  // 4) Detect mid-table truncation. Walk line-by-line. The pattern:
  //      | a | b |
  //      (no separator line below)
  //    OR
  //      | a | b |
  //      |---|
  //    (separator present but no data row)
  //    Either means a table was started but not finished. Fix by
  //    ensuring there's a separator line after the header.
  //
  //    Important: skip blank lines when looking for the "next" row.
  //    Without this, an LLM that emits `| header |\n\n|---|` (with a
  //    blank line between header and separator) would be mis-detected
  //    as a truncated table and we'd insert a duplicate separator +
  //    placeholder row between them — corrupting the data rows that
  //    come after.
  const lines = s.split('\n');
  const isPipeRow = (l: string | undefined) => !!l && l.trim().startsWith('|') && l.trim().endsWith('|');
  const isSepRow = (l: string | undefined) => !!l && /^\s*\|?[-:\s|]+\|?\s*$/.test(l);
  // A "real" pipe table row has at least one cell with non-junk content
  // (not all `---` / `:` / `…` / whitespace). Otherwise an LLM's stray
  // `|---|---|` or `|…|…|` placeholder would itself look like a header
  // and we'd insert another separator after it.
  const isRealTableContent = (l: string | undefined): boolean => {
    if (!l || !isPipeRow(l)) return false;
    const cells = l.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    if (cells.length === 0) return false;
    return cells.some((c) => !/^[-:\s…]+$/.test(c));
  };
  for (let i = 0; i < lines.length - 1; i++) {
    const line = lines[i];
    if (!isRealTableContent(line)) continue;
    // Find the next non-blank line
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === '') j++;
    const next = j < lines.length ? lines[j] : '';
    // Only insert a separator + placeholder when this is a HEADER row
    // (i.e. a pipe row whose immediate next non-blank line is NOT a
    // separator and NOT another table row). This means the table was
    // truncated right after the header. For a normal table where `line`
    // is a DATA row (followed by a separator or more data), we must NOT
    // insert a placeholder — otherwise every well-formed table gets a
    // spurious `|---|\n|…|…|` appended after its last data row.
    //
    // To distinguish header-from-data: a header is the FIRST pipe row in
    // a contiguous block of pipe rows. If the PREVIOUS non-blank line is
    // also a pipe row (or separator), then `line` is a data row and we
    // skip it.
    let prevIdx = i - 1;
    while (prevIdx >= 0 && lines[prevIdx].trim() === '') prevIdx--;
    const prevNonBlank = prevIdx >= 0 ? lines[prevIdx] : '';
    const isInTableBlock = isPipeRow(prevNonBlank) || isSepRow(prevNonBlank);
    if (
      !isInTableBlock && // only act on the first row of a table block
      !isSepRow(next) && !isPipeRow(next) // header not followed by sep/data
    ) {
      // Insert a separator line + "..." placeholder row to make the
      // table valid. Compute the column count from the header.
      const cols = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').length;
      const sep = '|' + Array(cols).fill('---').join('|') + '|';
      const placeholder = '|' + Array(cols).fill('…').join('|') + '|';
      lines.splice(i + 1, 0, sep, placeholder);
      i += 2; // skip the two we just inserted
    }
  }
  s = lines.join('\n');

  // 5) Detect mid-sentence / mid-word truncation in the trailing
  //    paragraph. If the very last non-empty line ends with a partial
  //    word or no terminal punctuation, walk back to the last full
  //    sentence boundary. Strategy (conservative — only cut when we're
  //    sure we won't lose content):
  //      a. If the last line ends with `。` / `!` / `?` / `！` / `？` /
  //         `）` / `】` / `」` / `』` / a Chinese full-width
  //         parentheses — it's complete, do nothing.
  //      b. If the last line is a Markdown list marker (`- foo`, `* foo`,
  //         `1. foo`) and ends with a word but no list terminator, it
  //         may be a cut list — keep the line; the renderer will
  //         gracefully show an unfinished bullet.
  //      c. Otherwise (mid-sentence or mid-word in a paragraph):
  //         cut back to the last `。` if it's within the last ~500
  //         characters, OR append `…` if no good cut point exists.
  //      d. NEVER drop a complete section just because the last
  //         sentence is short.
  const lastNonEmpty = s.split('\n').filter((l) => l.trim().length > 0).pop() || '';
  const lastChar = lastNonEmpty.slice(-1);
  const isComplete = /[。.!?）)】」』\n]/.test(lastChar) ||
    // Code-block / hr / table-row endings are fine
    lastNonEmpty.startsWith('```') ||
    /^---+\s*$/.test(lastNonEmpty.trim());
  if (!isComplete) {
    const sClean = s.replace(/\r\n/g, '\n');
    // Heuristic: if the last line starts with `-` / `*` / digit+`.` /
    // `数字.` and has no terminal punctuation, it's a list bullet
    // that was likely cut mid-word. The whole preceding paragraph is
    // still valid — don't cut, just append `…` so the user knows it
    // was truncated.
    const isListBullet = /^\s*([-*]|\d+[.、)])\s/.test(lastNonEmpty);
    if (isListBullet) {
      s = sClean.trimEnd() + '…\n';
    } else {
      // Find the last sentence-terminal punctuation. If the cut would
      // discard more than half the document, just append `…` instead.
      // R179 (Task 2-b): image-aware scan — `![` opens a markdown image and
      // its ASCII `!` must NOT count as a sentence terminator, otherwise a
      // truncated trailing paragraph cuts the report back to the last
      // embedded figure, silently deleting everything after it.
      const lastTerminator = (() => {
        for (let p = sClean.length - 1; p > 0; p--) {
          const ch = sClean[p];
          if (ch === '。' || ch === '！' || ch === '？' || ch === '】') return p;
          if (ch === '!' && sClean[p + 1] !== '[') return p;
          if (ch === '?') return p;
        }
        return -1;
      })();
      const candidates = lastTerminator > 0 ? [lastTerminator] : [];
      if (candidates.length === 0) {
        s = sClean.trimEnd() + '…\n';
      } else {
        const lastPunct = Math.max(...candidates);
        // Only cut if the cut candidate is reasonably close to the end
        // (within 800 chars) — otherwise the cut would discard a huge
        // amount of legitimate content. In that case just append `…`.
        if (sClean.length - lastPunct < 800) {
          s = sClean.substring(0, lastPunct + 1).trimEnd() + '\n';
        } else {
          s = sClean.trimEnd() + '…\n';
        }
      }
    }
  }

  // 6) Strip orphan JSON / object fragments. If a line starts with `{`
  //    or `["Primar` patterns, drop it. The LLM sometimes embeds a
  //    partial JSON dump of its next action.
  s = s
    .split('\n')
    .filter((l) => {
      const t = l.trim();
      if (t.startsWith('{') && !t.endsWith('}')) return false; // partial obj
      if (t.startsWith('[') && !t.endsWith(']')) return false; // partial arr
      if (/^["{[]["']?\w{0,8}$/.test(t) && t.length < 30) return false; // short fragment
      return true;
    })
    .join('\n');

  // 7) Round 56: Deduplicate consecutive identical headings.
  //    The LLM sometimes echoes the chapter heading at the start of its
  //    output (e.g. "## B. 方法学突破..." followed by the same "## B. 方法学突破..."
  //    from the merge step). normalizeWeeklyChapterContent handles the known
  //    cases, but this is a safety net for any residual duplicates.
  s = deduplicateConsecutiveHeadings(s);

  return s;
}

/**
 * Round 56: Remove consecutive duplicate markdown headings.
 *
 * Handles two patterns:
 *   1. Exact duplicate: `## B. Foo\n\n## B. Foo` → `## B. Foo`
 *   2. Near-duplicate (same heading text, different level): `## B. Foo` followed
 *      by `# B. Foo` or `### B. Foo` within 2 lines → keep only the first.
 *
 * Also collapses runs of 3+ blank lines that result from heading removal.
 */
export function deduplicateConsecutiveHeadings(md: string): string {
  if (!md) return md;
  const lines = md.split('\n');
  const out: string[] = [];
  /** Track the last heading line we kept (text without the # prefix). */
  let lastHeadingText: string | null = null;
  let lastHeadingIdx = -10; // index in `out` of the last heading we kept

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^(#{1,4})\s+(.+?)\s*$/);
    if (m) {
      const text = m[2].trim().toLowerCase();
      // If this heading's text matches the last heading we kept AND they're
      // close together (within 3 lines, allowing for blank lines between),
      // skip this duplicate.
      if (lastHeadingText && lastHeadingText === text && (i - lastHeadingIdx) <= 4) {
        // Skip the duplicate. Also skip a trailing blank line if present
        // so we don't leave a double-blank.
        continue;
      }
      lastHeadingText = text;
      lastHeadingIdx = i;
      out.push(line);
    } else {
      out.push(line);
    }
  }
  // Collapse 3+ consecutive blank lines to exactly 2.
  let result = out.join('\n').replace(/\n{3,}/g, '\n\n');
  return result;
}

/**
 * Convenience: render markdown to a complete self-contained HTML page
 * (with <!DOCTYPE>, <html>, <head>, <body>). Used by EvalReportGenerator's
 * iframe srcDoc and by the ReportModal HTML export.
 *
 * Round 57: Added print-optimized CSS (@media print) so exported HTML prints
 * cleanly — page breaks before H2 chapters, no background colors, smaller
 * margins. Also added consistent heading/table/blockquote styles that match
 * the in-app ReportMarkdown renderer.
 */
export function renderMarkdownToFullPage(
  md: string,
  options: { title?: string; bodyClassName?: string; maxWidth?: number } = {}
): { html: string; hadTable: boolean; hadHeading: boolean } {
  const stripped = stripMarkdownFrontmatterAndTitle(md);
  const { bodyHtml, hadTable, hadHeading } = renderMarkdownToHtml(stripped);
  const maxWidth = options.maxWidth ?? 820;
  const title = options.title ? escapeHtml(options.title) : 'Report';
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif;
      color: #2d2d2d;
      line-height: 1.7;
      max-width: ${maxWidth}px;
      margin: 0 auto;
      padding: 32px 28px;
      background: #fff;
      overflow-x: auto;
    }
    a { color: #c96442; text-decoration: none; }
    a:hover { text-decoration: underline; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 14px 0;
      font-size: 13px;
      table-layout: fixed;
      word-break: break-word;
      overflow-wrap: anywhere;
    }
    th {
      background: #f5f0ea;
      font-weight: 600;
      text-align: left;
      padding: 8px 12px;
      border-bottom: 2px solid #e8e4dd;
      word-break: break-word;
      overflow-wrap: anywhere;
    }
    td {
      padding: 8px 12px;
      border-bottom: 1px solid #f0ece6;
      word-break: break-word;
      overflow-wrap: anywhere;
    }
    h1 {
      font-size: 22px;
      font-weight: 700;
      color: #1a1a1a;
      margin: 0 0 12px;
    }
    h2 {
      font-size: 17px;
      font-weight: 600;
      color: #c96442;
      margin: 28px 0 14px;
      padding-bottom: 6px;
      border-bottom: 2px solid #e8e4dd;
    }
    h3 {
      font-size: 12.5px;
      font-weight: 600;
      color: #6b5d4f;
      margin: 14px 0 6px;
      padding-left: 8px;
      border-left: 3px solid #d4c4b0;
      line-height: 1.4;
    }
    p { margin: 8px 0 12px; font-size: 14px; line-height: 1.65; }
    ul, ol { margin: 8px 0 12px 24px; font-size: 14px; }
    li { margin-bottom: 4px; }
    blockquote {
      margin: 12px 0;
      padding: 8px 16px;
      border-left: 4px solid #d4c4b0;
      background: #faf7f4;
      color: #6b5d4f;
      font-size: 13px;
    }
    hr { border: 0; border-top: 1px solid #e8e4dd; margin: 20px 0; }
    /* R179 (Task 2-b): DSH report figures — inline-style twins of the in-app
       .dsh-report-figure look (kept here for the standalone HTML export). */
    img.dsh-report-figure {
      max-width: 100%;
      height: auto;
      border-radius: 0.5rem;
      border: 1px solid rgba(128, 128, 128, 0.25);
      margin: 0.75rem 0;
      display: block;
    }
    code {
      background: #f5f0ea;
      padding: 1px 4px;
      border-radius: 3px;
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 0.9em;
      color: #c96442;
    }

    /* Round 57: Print-optimized styles */
    @media print {
      body {
        max-width: none;
        padding: 0;
        font-size: 11pt;
        line-height: 1.5;
      }
      h1 { font-size: 18pt; page-break-after: avoid; }
      h2 {
        font-size: 14pt;
        page-break-before: auto;
        page-break-after: avoid;
        border-bottom: 1px solid #ccc;
      }
      h3 { font-size: 11pt; page-break-after: avoid; }
      table { font-size: 9pt; page-break-inside: avoid; }
      tr { page-break-inside: avoid; }
      a { color: #333; text-decoration: underline; }
      blockquote { page-break-inside: avoid; }
      /* Avoid page break right after the metadata header table */
      table:first-of-type { page-break-after: avoid; }
    }
  </style>
</head>
<body>
  ${bodyHtml}
</body>
</html>`;
  return { html, hadTable, hadHeading };
}
