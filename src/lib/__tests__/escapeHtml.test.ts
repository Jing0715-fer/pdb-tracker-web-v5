import { describe, it } from 'node:test';
import assert from 'node:assert';

// Inline escapeHtml to test in isolation (same logic as pdb-utils.ts)
function escapeHtml(str: unknown): string {
  if (str == null) return '';
  const s = String(str);
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

describe('escapeHtml', () => {
  it('pass-through for plain text', () => {
    assert.equal(escapeHtml('hello world'), 'hello world');
  });

  it('escapes &', () => {
    assert.equal(escapeHtml('a & b'), 'a &amp; b');
  });

  it('escapes <', () => {
    assert.equal(escapeHtml('<script>'), '&lt;script&gt;');
  });

  it('escapes >', () => {
    assert.equal(escapeHtml('a > b'), 'a &gt; b');
  });

  it('escapes double quotes', () => {
    assert.equal(escapeHtml('say "hello"'), 'say &quot;hello&quot;');
  });

  it('escapes single quotes', () => {
    assert.equal(escapeHtml("it's fine"), 'it&#x27;s fine');
  });

  it('escapes XSS payload', () => {
    assert.equal(
      escapeHtml('<script>alert("XSS")</script>'),
      '&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;'
    );
  });

  it('returns empty string for null', () => {
    assert.equal(escapeHtml(null), '');
  });

  it('returns empty string for undefined', () => {
    assert.equal(escapeHtml(undefined), '');
  });

  it('converts numbers to string', () => {
    assert.equal(escapeHtml(42), '42');
  });

  it('handles unicode', () => {
    assert.equal(escapeHtml('你好世界'), '你好世界');
  });

  it('escapes mixed content', () => {
    const input = 'User "admin" said: <hello> & goodbye';
    const expected = 'User &quot;admin&quot; said: &lt;hello&gt; &amp; goodbye';
    assert.equal(escapeHtml(input), expected);
  });
});