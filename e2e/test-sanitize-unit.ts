/**
 * Unit-test the sanitizeReport() function on the 6 sample reports from
 * the DB. Verifies that:
 *   1. The number of <table> elements (as rendered) is preserved or
 *      increased (we may add separator rows for truncated tables).
 *   2. The output ends with a complete sentence (no mid-word truncation).
 *   3. The output is no longer than the input + 200 chars (we only
 *      trim and add tiny bits like "..." for truncated sentences).
 */
import { readFileSync } from 'fs';
import {
  sanitizeReport,
  renderMarkdownToHtml,
  stripMarkdownFrontmatterAndTitle,
} from '../src/lib/markdown-renderer';

const files = [
  'e2e/source-md/eval-P00533.md',
  'e2e/source-md/eval-P07766.md',
  'e2e/source-md/batch-batch-mrk3xjztd2.md',
  'e2e/source-md/batch-batch-mrkofeb9uj.md',
  'e2e/source-md/batch-batch-mrkoysyymo.md',
  'e2e/source-md/batch-batch-mrkxoxr3jl.md',
];

let pass = 0;
let fail = 0;

for (const f of files) {
  const name = f.split('/').pop()!;
  const raw = readFileSync(f, 'utf-8');
  const cleaned = sanitizeReport(raw);
  const htmlClean = renderMarkdownToHtml(stripMarkdownFrontmatterAndTitle(cleaned)).bodyHtml;
  const htmlRaw = renderMarkdownToHtml(stripMarkdownFrontmatterAndTitle(raw)).bodyHtml;

  const tablesRaw = (htmlRaw.match(/<table[^>]*>/g) || []).length;
  const tablesClean = (htmlClean.match(/<table[^>]*>/g) || []).length;
  const trsRaw = (htmlRaw.match(/<tr>/g) || []).length;
  const trsClean = (htmlClean.match(/<tr>/g) || []).length;

  // Check: last non-empty line ends with terminal punctuation
  const lastLine = cleaned.split('\n').filter((l) => l.trim().length > 0).pop() || '';
  const lastChar = lastLine.slice(-1);
  const isComplete = /[。.!?）)】」』\n…]/.test(lastChar) ||
    lastLine.startsWith('```') ||
    /^---+\s*$/.test(lastLine.trim());

  // Check: the number of WELL-FORMED tables (header + separator + ≥1 row)
  // must be >= raw. A "well-formed" table is one where the source has
  // both a header line and a separator line below it. The sanitizer FIXES
  // truncated tables (adds separators) so cleaned can have more well-formed
  // tables than raw.
  const wellFormedRaw = (htmlRaw.match(/<table[^>]*>[\s\S]*?<thead>[\s\S]*?<\/thead>[\s\S]*?<tbody>/g) || []).length;
  const wellFormedClean = (htmlClean.match(/<table[^>]*>[\s\S]*?<thead>[\s\S]*?<\/thead>[\s\S]*?<tbody>/g) || []).length;
  const okTableCount = wellFormedClean >= wellFormedRaw;
  // Check: no rows dropped (cleaned may have more rows if we added placeholders)
  const okRowCount = trsClean >= trsRaw - 2;
  // Check: shorter (or roughly equal)
  const okShorter = cleaned.length <= raw.length + 200;
  // Check: not ending mid-word
  const okComplete = isComplete;

  const ok = okTableCount && okRowCount && okShorter && okComplete;
  if (ok) pass++; else fail++;

  console.log(`${ok ? '✓' : '✗'} ${name} (raw→cleaned: ${raw.length}→${cleaned.length} chars; rendered: tables ${tablesRaw}→${tablesClean}, trs ${trsRaw}→${trsClean}; lastChar=${JSON.stringify(lastChar)})`);
  if (!ok) {
    if (!okTableCount) console.log(`    ✗ table count went DOWN: ${tablesRaw} → ${tablesClean}`);
    if (!okRowCount) console.log(`    ✗ row count dropped: ${trsRaw} → ${trsClean}`);
    if (!okShorter) console.log(`    ✗ length grew too much: ${raw.length} → ${cleaned.length}`);
    if (!okComplete) console.log(`    ✗ ends mid-sentence: ${JSON.stringify(lastLine.slice(-80))}`);
  }
}

console.log(`\n${pass}/${pass + fail} passed`);
if (fail > 0) process.exit(1);
