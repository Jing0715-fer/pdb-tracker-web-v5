/**
 * R198（R197 延后项③）: ``` 围栏代码块渲染测试
 * 覆盖：基本围栏 / 语言标注 / 围栏内表格语法保护 / 未闭合截断 / 四反引号嵌套 /
 * 内容 HTML 转义 / 段落后紧跟围栏（无空行）断段。
 */
import { describe, expect, it } from 'bun:test';
import { renderMarkdownToHtml } from '../markdown-renderer';

describe('renderMarkdownToHtml fenced code blocks', () => {
  it('basic fence renders <pre> and strips the fence lines', () => {
    const md = 'before\n\n```\nSELECT 1;\nSELECT 2;\n```\n\nafter';
    const r = renderMarkdownToHtml(md);
    expect(r.bodyHtml).toContain('<pre');
    expect(r.bodyHtml).toContain('SELECT 1;');
    expect(r.bodyHtml).toContain('SELECT 2;');
    expect(r.bodyHtml).not.toContain('```');
    expect(r.bodyHtml).toContain('before');
    expect(r.bodyHtml).toContain('after');
  });

  it('language label is rendered escaped', () => {
    const md = '```json\n{"a": 1}\n```';
    const r = renderMarkdownToHtml(md);
    expect(r.bodyHtml).toContain('json');
    expect(r.bodyHtml).toContain('&quot;a&quot;: 1');
  });

  it('pipe-table syntax inside a fence is NOT parsed as a table', () => {
    const md = '```\n| a | b |\n| 1 | 2 |\n```';
    const r = renderMarkdownToHtml(md);
    expect(r.hadTable).toBe(false);
    expect(r.bodyHtml).toContain('| a | b |');
    expect(r.bodyHtml).not.toContain('<table');
  });

  it('heading syntax inside a fence is NOT parsed as a heading', () => {
    const md = '```\n## not a heading\n```';
    const r = renderMarkdownToHtml(md);
    expect(r.hadHeading).toBe(false);
    expect(r.bodyHtml).not.toContain('<h2');
    expect(r.bodyHtml).toContain('## not a heading');
  });

  it('unclosed fence renders content + truncation hint', () => {
    const md = 'para\n\n```bash\ncurl -s https://example.com';
    const r = renderMarkdownToHtml(md);
    expect(r.bodyHtml).toContain('curl -s https://example.com');
    expect(r.bodyHtml).toContain('围栏未闭合');
  });

  it('closing fence must be >= opening length (4 backticks swallows a ``` line)', () => {
    const md = '````\n```\ninner\n```\n````';
    const r = renderMarkdownToHtml(md);
    // The ``` lines are CONTENT inside the ```` fence.
    expect(r.bodyHtml).toContain('inner');
    expect(r.bodyHtml).not.toContain('围栏未闭合');
    // Inner fences preserved as literal text.
    expect(r.bodyHtml).toContain('```');
  });

  it('fence content is HTML-escaped (XSS)', () => {
    const md = '```\n<script>alert(1)</script>\n```';
    const r = renderMarkdownToHtml(md);
    expect(r.bodyHtml).not.toContain('<script>');
    expect(r.bodyHtml).toContain('&lt;script&gt;');
  });

  it('paragraph directly followed by a fence (no blank line) breaks the paragraph', () => {
    const md = 'intro text\n```js\ncode();\n```';
    const r = renderMarkdownToHtml(md);
    expect(r.bodyHtml).toContain('intro text');
    expect(r.bodyHtml).toContain('code();');
    expect(r.bodyHtml).toContain('<pre');
  });

  it('trailing spaces on fence lines are tolerated', () => {
    const md = '```   \ncode\n```   ';
    const r = renderMarkdownToHtml(md);
    expect(r.bodyHtml).toContain('code');
    expect(r.bodyHtml).not.toContain('围栏未闭合');
  });

  it('regular inline code and existing blocks are unaffected', () => {
    const md = '# Title\n\n`inline` code\n\n| a | b |\n|---|---|\n| 1 | 2 |';
    const r = renderMarkdownToHtml(md);
    expect(r.hadHeading).toBe(true);
    expect(r.hadTable).toBe(true);
    expect(r.bodyHtml).toContain('<code');
    expect(r.bodyHtml).not.toContain('<pre');
  });
});
