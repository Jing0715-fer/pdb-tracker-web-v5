/**
 * Unit tests for the 3 markdown-renderer fixes:
 *
 *   1. Junk table rows (cells all `---` / `:` / `…` / spaces) are NOT
 *      rendered as data cells. Before: `|---|---|` and `|…|…|…|`
 *      placeholders leaked into the table as visible `---` / `…` cells.
 *
 *   2. Reports stored with bare \r (no \n) line endings are still
 *      rendered correctly — the strip + renderer both normalize to
 *      \n so block-level regexes match.
 *
 *   3. Sanitize step 2.5 collapses consecutive "API call failed …"
 *      lines into a single `_(本章生成失败：…)_` marker, so the
 *      mid-sentence trimmer (step 5) does not silently delete the
 *      fact that a chapter failed to generate.
 *
 *   4. stripMarkdownFrontmatterAndTitle uses \A anchor on the YAML
 *      frontmatter regex so mid-document `---` horizontal rules are
 *      not mistaken for the frontmatter close delimiter.
 */
import {
  renderMarkdownToHtml,
  sanitizeReport,
  stripMarkdownFrontmatterAndTitle,
} from '../src/lib/markdown-renderer';

let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fail++;
    console.log(`  ✗ ${name}${detail ? '  — ' + detail : ''}`);
  }
}

// ─── Test 1: junk rows don't leak into table cells ────────────────────────
{
  console.log('\n[1] junk row skip (was Bug 1)');
  const md = [
    '## 一、靶点概览',
    '',
    '| 属性 | 靶点 1 | 靶点 2 |',
    '|------|--------|--------|',
    '| **UniProt ID** | P00533 | P07766 |',
    '| **蛋白名称** | EGFR | CD3ε |',
    '|---|---|---|',       // ← stray separator
    '|…|…|…|',             // ← stray placeholder
    '',
  ].join('\n');
  const r = renderMarkdownToHtml(stripMarkdownFrontmatterAndTitle(sanitizeReport(md)));
  // No <td> with content `---`, `:`, or `…`
  const junkCells = (r.bodyHtml.match(/<td[^>]*>(---|…|\.{3})<\/td>/g) || []).length;
  check('no `---` / `…` data cells leaked', junkCells === 0, `found ${junkCells}`);
  // The table should still have the 2 real rows
  const trCount = (r.bodyHtml.match(/<tr>/g) || []).length;
  check('table has header + 2 data rows', trCount === 3, `trCount=${trCount}`);
}

// ─── Test 2: bare \r line endings are normalized ──────────────────────────
{
  console.log('\n[2] \\r line ending normalization (was Bug 2)');
  // P07766-shaped report stored with bare \r instead of \n
  const md = [
    '# CD3E (P07766) PDB 结构综合评估报告', '\r',
    '\r',
    '## 一、蛋白基本信息', '\r',
    '\r',
    '| 字段 | 内容 |', '\r',
    '|------|------|', '\r',
    '| UniProt ID | P07766 |', '\r',
  ].join('');  // join with '' keeps the \r
  const hasCR = md.includes('\r') && !md.includes('\n');
  check('input uses bare \\r only', hasCR);
  const r = renderMarkdownToHtml(stripMarkdownFrontmatterAndTitle(md));
  const h2s = r.bodyHtml.match(/<h2[^>]*>([^<]+)<\/h2>/g) || [];
  check('H2 rendered (not collapsed to <p>)', h2s.length === 1, `h2s=${h2s.length}`);
  check('H2 text is correct', h2s[0]?.includes('一、蛋白基本信息') === true, h2s[0]);
  // H1 should have been stripped
  const h1s = r.bodyHtml.match(/<h1[^>]*>([^<]+)<\/h1>/g) || [];
  check('H1 stripped even though not at offset 0', h1s.length === 0, `h1s=${h1s.length}`);
}

// ─── Test 3: API call failed collapse (was Bug 3) ────────────────────────
{
  console.log('\n[3] API call failed collapse (was Bug 3)');
  const md = [
    '## 7. 总结',
    '',
    'API call failed after 3 retries: HTTP 429: rate limit.',
    'API call failed after 3 retries: HTTP 429: rate limit.',
    'API call failed after 3 retries: HTTP 429: rate limit.',
    'API call failed after 3 retries: HTTP 429: rate limit.',
    'API call failed after 3 retries: HTTP 429: rate limit.',
    'API call failed after 3 retries: HTTP 429: rate limit.',
    '',
    '## 总结',
    '',
    'This is the actual surviving chapter content. It ends with a sentence。',
  ].join('\n');
  const cleaned = sanitizeReport(md);
  // The 6 failure lines should collapse to ONE error marker, not be
  // deleted silently by the mid-sentence trimmer.
  check('cleaned has error marker for failed chapter', /本章生成失败/.test(cleaned));
  check('cleaned keeps the real chapter content', cleaned.includes('This is the actual surviving chapter content'));
  // After collapse, the substring "API call failed" should NOT appear
  // at all — the 6 raw lines were replaced by a single short marker
  // (the marker itself only keeps the trailing reason text, e.g. "rate
  // limit."). If the trimmer had still been used, "API call failed"
  // would either be in the document 6 times (no collapse) or 0 times
  // (silently deleted). The middle ground is what we want to avoid.
  const failedCount = (cleaned.match(/API call failed/g) || []).length;
  check('6 raw "API call failed" lines are gone (0 occurrences)', failedCount === 0, `count=${failedCount}`);
}

// ─── Test 4: frontmatter regex does not eat mid-document `---` ─────────────
{
  console.log('\n[4] frontmatter regex uses \\A anchor');
  // This report has an H1 title + a section break `---` mid-document +
  // a ## heading after it. The buggy version would eat everything
  // between the H1 and the first `---` it finds, killing the next
  // ## heading.
  const md = [
    '# Top-level title',
    '',
    '## 一、靶点概览',
    '',
    '| 属性 | 靶点 1 | 靶点 2 |',
    '|------|--------|--------|',
    '| A | 1 | 2 |',
    '',
    '---',
    '',
    '## 二、共有结构分析',
    '',
    'Body text for the second section。',
  ].join('\n');
  const r = renderMarkdownToHtml(stripMarkdownFrontmatterAndTitle(md));
  const h2s = (r.bodyHtml.match(/<h2[^>]*>([^<]+)<\/h2>/g) || []).map((h) => h.match(/>([^<]+)</)![1]);
  check('H1 stripped', (r.bodyHtml.match(/<h1/g) || []).length === 0);
  check('both ## headings survive the strip', h2s.length === 2, `h2s=${JSON.stringify(h2s)}`);
  check('## 一、 present', h2s.includes('一、靶点概览'));
  check('## 二、 present (was being eaten by buggy regex)', h2s.includes('二、共有结构分析'));
  // `---` should still be rendered as an <hr> (it's a markdown horizontal rule)
  check('--- mid-document rendered as <hr>', (r.bodyHtml.match(/<hr/g) || []).length >= 1);
}

console.log(`\n${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
