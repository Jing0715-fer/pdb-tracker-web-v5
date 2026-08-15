#!/usr/bin/env node
// Custom ESLint runner. Avoids ESLint 9's built-in `stylish` formatter which
// crashes with `RangeError: Invalid string length` for medium/large projects
// when it builds a text-table of every message. We resolve the local
// `eslint` binary directly (avoiding `npx` shimming, which behaves oddly in
// some shells when called via `spawnSync`), run it with `--format json`,
// parse the result, and print a concise summary.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const eslintBin = path.resolve('node_modules', '.bin',
  process.platform === 'win32' ? 'eslint.exe' : 'eslint');

if (!existsSync(eslintBin)) {
  console.error(`eslint binary not found at ${eslintBin} — did you run \`bun install\`?`);
  process.exit(2);
}

const r = spawnSync(eslintBin,
  ['src/', '--format', 'json', '--max-warnings', '0', '--no-warn-ignored'],
  {
    encoding: 'utf-8',
    maxBuffer: 1024 * 1024 * 200,
    // The hermes-agent sandbox ships node at /Users/lijing/.local/bin/node
    // which is NOT in $PATH, so the eslint binary's `#!/usr/bin/env node`
    // shebang can't find node when spawned directly. shell: true forces
    // the spawned process to inherit $PATH from this script's parent
    // (the wrapper), which includes the local node bin. We also pass an
    // explicit PATH that prepends the local bin so the spawn's PATH
    // contains node even when the parent shell $PATH does not.
    shell: process.platform === 'win32',
    env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH || ''}` },
  });

let reports = [];
try {
  reports = JSON.parse(r.stdout || '[]');
} catch (err) {
  console.error('lint: failed to parse eslint JSON output —', err.message);
  if (r.stderr) console.error(r.stderr.slice(0, 400));
  process.exit(2);
}

let errs = 0, warns = 0;
const detail = [];
for (const f of reports) {
  errs += f.errorCount;
  warns += f.warningCount;
  if (f.messages.length) detail.push({ file: f.filePath, msgs: f.messages.slice(0, 8) });
}

if (errs === 0 && warns === 0) {
  console.log(`PASS  ${reports.length} file(s) scanned, 0 errors, 0 warnings`);
  process.exit(0);
}

console.log(`FAIL  ${reports.length} file(s), ${errs} errors, ${warns} warnings`);
for (const d of detail.slice(0, 20)) {
  console.log(`\n${d.file}`);
  for (const m of d.msgs) {
    const sev = m.severity === 2 ? 'error' : 'warn ';
    console.log(`  ${m.line || 0}:${m.column || 0}  ${sev}  ${m.ruleId || ''}  ${String(m.message).slice(0, 240)}`);
  }
}
process.exit(1);
