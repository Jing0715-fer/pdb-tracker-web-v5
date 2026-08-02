#!/usr/bin/env node
/**
 * Dead code scanner for src/components/
 *
 * Strategy:
 *   1. Walk every .ts/.tsx file under src/components/
 *   2. For each file, extract:
 *        - default export identifier (e.g. `export default function Foo()`)
 *        - named exports (e.g. `export function Foo`, `export const Bar`, `export { Baz }`)
 *        - the file's "module path" (the path segment after `@/components/` or `components/`)
 *   3. Read every .ts/.tsx/.mjs file under src/ (one pass) and collect:
 *        - import statements `import ... from '...'`
 *        - dynamic imports `import('...')` and `dynamic(() => import('...'))`
 *   4. A file is "alive" if ANY of:
 *        - its module path appears as an import target (handles alias + relative)
 *        - one of its exported identifiers appears in `import X` / `import { X }` form
 *        - it's referenced via dynamic import path string
 *   5. Files with zero references are reported as candidate dead code.
 *
 * Whitelist (never reported):
 *   - index.ts / index.tsx (barrel files)
 *   - pdb-tracker.tsx, evaluation-page.tsx, evaluation-view.tsx
 *   - literature/LiteratureView.tsx
 *
 * Notes:
 *   - Path-based detection is robust to alias/relative mismatches.
 *   - Identifier-based detection catches re-exports / barrel-file consumers.
 *   - We do NOT delete anything; this script only produces a report.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = '/home/z/my-project';
const COMPONENTS_DIR = path.join(ROOT, 'src', 'components');
const SRC_DIR = path.join(ROOT, 'src');

// --- Whitelist (never reported as dead) -------------------------------
const WHITELIST_BASENAMES = new Set([
  'index.ts',
  'index.tsx',
  'pdb-tracker.tsx',
  'evaluation-page.tsx',
  'evaluation-view.tsx',
]);
const WHITELIST_REL = new Set([
  'literature/LiteratureView.tsx',
]);

// --- Step 1: collect all component files ------------------------------
function walk(dir, acc = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(full, acc);
    } else if (/\.(ts|tsx)$/.test(e.name)) {
      acc.push(full);
    }
  }
  return acc;
}

const componentFiles = walk(COMPONENTS_DIR);
console.error(`[scan] found ${componentFiles.length} .ts/.tsx files under src/components/`);

// --- Step 2: extract exports + module path for each component file ----
function extractExports(source) {
  const exports = { default: null, named: new Set() };

  // Default export with identifier:
  //   export default function Foo
  //   export default class Bar
  //   export default const Baz  (invalid syntax but cover loosely)
  //   export default Foo        (identifier reference)
  let m;
  const reDefaultFn = /export\s+default\s+(?:async\s+)?(?:function|class)\s+([A-Za-z_$][\w$]*)/g;
  while ((m = reDefaultFn.exec(source))) exports.named.add(m[1]); // also as named identifier
  const reDefaultIdent = /export\s+default\s+([A-Za-z_$][\w$]*)\s*[,;\n]/g;
  while ((m = reDefaultIdent.exec(source))) {
    if (!['function', 'class', 'const', 'let', 'var'].includes(m[1])) {
      exports.default = m[1];
    }
  }
  if (exports.default == null) {
    // default function/class without a name OR anonymous arrow — use a sentinel.
    if (/export\s+default\s+(?:async\s+)?(?:function|class)\b/.test(source)) {
      exports.default = '__anonymous_default__';
    } else if (/export\s+default\s*\(/.test(source)) {
      exports.default = '__anonymous_default__';
    }
  }

  // Named exports:
  //   export function Foo / export const Bar / export class Baz
  const reNamedDecl = /export\s+(?:async\s+)?(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g;
  while ((m = reNamedDecl.exec(source))) exports.named.add(m[1]);

  // export { Foo, Bar }  /  export { Foo as Bar }
  const reExportBlock = /export\s*\{([^}]+)\}\s*(?:from\s+['"][^'"]+['"])?/g;
  while ((m = reExportBlock.exec(source))) {
    for (let raw of m[1].split(',')) {
      raw = raw.trim();
      if (!raw) continue;
      // "Foo" or "Foo as Bar" — take the exported (last) identifier
      const parts = raw.split(/\s+as\s+/);
      const exported = parts[parts.length - 1].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(exported)) exports.named.add(exported);
    }
  }

  // export type { Foo }
  const reExportType = /export\s+type\s*\{([^}]+)\}/g;
  while ((m = reExportType.exec(source))) {
    for (let raw of m[1].split(',')) {
      raw = raw.trim();
      if (/^[A-Za-z_$][\w$]*$/.test(raw)) exports.named.add(raw);
    }
  }
  // export interface Foo
  const reExportIface = /export\s+interface\s+([A-Za-z_$][\w$]*)/g;
  while ((m = reExportIface.exec(source))) exports.named.add(m[1]);
  // export enum Foo
  const reExportEnum = /export\s+(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/g;
  while ((m = reExportEnum.exec(source))) exports.named.add(m[1]);
  // export type Foo = ...
  const reExportTypeAlias = /export\s+type\s+([A-Za-z_$][\w$]*)\s*=/g;
  while ((m = reExportTypeAlias.exec(source))) exports.named.add(m[1]);

  return exports;
}

function modulePathFor(absPath) {
  // Returns the path segment(s) used to import this file:
  //   src/components/literature/LiteratureView.tsx -> ['literature/LiteratureView', 'literature/LiteratureView.tsx']
  const rel = path.relative(COMPONENTS_DIR, absPath).replace(/\\/g, '/');
  const noExt = rel.replace(/\.(ts|tsx)$/, '');
  return [noExt, rel];
}

const components = componentFiles.map((abs) => {
  const source = fs.readFileSync(abs, 'utf8');
  const exports = extractExports(source);
  const [modPath, modPathWithExt] = modulePathFor(abs);
  const lineCount = source.split('\n').length;
  return {
    abs,
    rel: path.relative(ROOT, abs).replace(/\\/g, '/'),
    basename: path.basename(abs),
    modPath,
    modPathWithExt,
    exports,
    lineCount,
    references: { pathHits: [], identHits: [], dynamicHits: [] },
  };
});

// --- Step 3: read all source files once and collect import statements --
function walkSource(dir, acc = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === '.next') continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      walkSource(full, acc);
    } else if (/\.(ts|tsx|mjs)$/.test(e.name)) {
      acc.push(full);
    }
  }
  return acc;
}

const sourceFiles = walkSource(SRC_DIR);
console.error(`[scan] reading ${sourceFiles.length} source files under src/ for import scanning...`);

// Collect import targets and identifier imports in one pass.
//   importTargets: Set of raw module specifiers seen after `from` or inside `import(...)`
//   identImports:  Set of identifiers seen in `import X ...` / `import { X, Y } ...` form
//   dynamicTargets: Set of module specifiers inside dynamic import(...)
const importTargets = new Set();
const identImports = new Set();
const dynamicTargets = new Set();

// Regexes (handle both `import X` and `import type X` forms):
const reFromImport = /(?:from|import)\s*['"]([^'"]+)['"]/g;
// allow optional `type` keyword after `import` for `import type { ... }`
const reNamedImport = /import\s+(?:type\s+)?(?:([A-Za-z_$][\w$]*)\s*,)?\s*\{([^}]+)\}\s*(?:from\s*['"][^'"]+['"])?/g;
// exclude `type` itself as a default identifier (it's a keyword, not a real binding)
const reDefaultImport = /import\s+(?!type\b)([A-Za-z_$][\w$]*)\s+from\s*['"][^'"]+['"]/g;
const reNamespaceImport = /import\s+(?:type\s+)?\*\s+as\s+([A-Za-z_$][\w$]*)\s+from\s*['"][^'"]+['"]/g;
const reDynamicImport = /import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
// next/dynamic: dynamic(() => import('...'))
const reNextDynamic = /dynamic\s*\(\s*(?:\(\)\s*=>\s*)?import\s*\(\s*['"]([^'"]+)['"]\s*\)/g;

for (const f of sourceFiles) {
  let src;
  try {
    src = fs.readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  let m;
  while ((m = reFromImport.exec(src))) importTargets.add(m[1]);
  while ((m = reNamedImport.exec(src))) {
    for (let raw of m[2].split(',')) {
      raw = raw.trim();
      // strip inline `type` qualifier: `type Foo` -> `Foo`
      raw = raw.replace(/^type\s+/, '');
      // "Foo" or "Foo as Bar" — take the imported (first) identifier
      const parts = raw.split(/\s+as\s+/);
      const imported = parts[0].trim();
      if (/^[A-Za-z_$][\w$]*$/.test(imported)) identImports.add(imported);
    }
  }
  while ((m = reDefaultImport.exec(src))) identImports.add(m[1]);
  while ((m = reNamespaceImport.exec(src))) identImports.add(m[1]);
  while ((m = reDynamicImport.exec(src))) {
    importTargets.add(m[1]);
    dynamicTargets.add(m[1]);
  }
  while ((m = reNextDynamic.exec(src))) {
    importTargets.add(m[1]);
    dynamicTargets.add(m[1]);
  }
}

console.error(`[scan] collected ${importTargets.size} import targets, ${identImports.size} identifier imports, ${dynamicTargets.size} dynamic imports`);

// --- Step 4: classify each component file ----------------------------
function isWhitelisted(c) {
  if (WHITELIST_BASENAMES.has(c.basename)) return true;
  const relFromComponents = path.relative(COMPONENTS_DIR, c.abs).replace(/\\/g, '/');
  if (WHITELIST_REL.has(relFromComponents)) return true;
  // index files (barrel exports) — never dead
  if (c.basename === 'index.ts' || c.basename === 'index.tsx') return true;
  return false;
}

// Path-based reference detection:
// A target string like '@/components/literature/LiteratureView' or
// './LiteratureView' or '../literature/LiteratureView' should match
// the file's module path. We check several suffixes.
function pathReferencesFor(c) {
  const hits = [];
  // Suffix candidates (without & with extension), prefixed by '/'.
  const suffixes = [
    c.modPath,
    c.modPathWithExt,
    // last segment only (covers relative imports like './LiteratureView')
    path.basename(c.modPath),
  ];
  for (const target of importTargets) {
    // Strip leading alias / relative prefixes for comparison.
    const stripped = target.replace(/^(@\/|@\/components\/|@\/src\/|\.\/|\.\.\/)+/, '');
    const normalized = stripped.replace(/^components\//, '');
    for (const suf of suffixes) {
      if (normalized === suf || normalized === suf + '.tsx' || normalized === suf + '.ts') {
        hits.push(target);
        break;
      }
      // Also handle when target ends with the suffix path segment:
      if (normalized.endsWith('/' + suf) || normalized === suf) {
        hits.push(target);
        break;
      }
    }
    // Also: dynamicTargets are path-based and should hit the module path
    if (dynamicTargets.has(target)) {
      // already handled above by the loop
    }
  }
  // Dynamic import path detection (separate scan to be safe):
  for (const dyn of dynamicTargets) {
    if (hits.includes(dyn)) continue;
    const stripped = dyn.replace(/^(@\/|@\/components\/|@\/src\/|\.\/|\.\.\/)+/, '').replace(/^components\//, '');
    const suf = c.modPath;
    if (stripped === suf || stripped === suf + '.tsx' || stripped === suf + '.ts' ||
        stripped.endsWith('/' + suf)) {
      hits.push(dyn);
    }
  }
  return hits;
}

function identReferencesFor(c) {
  const hits = [];
  if (c.exports.default && c.exports.default !== '__anonymous_default__') {
    if (identImports.has(c.exports.default)) hits.push(c.exports.default);
  }
  for (const name of c.exports.named) {
    if (identImports.has(name)) hits.push(name);
  }
  return hits;
}

const candidates = [];
const alive = [];
for (const c of components) {
  if (isWhitelisted(c)) {
    c.status = 'whitelisted';
    continue;
  }
  c.references.pathHits = pathReferencesFor(c);
  c.references.identHits = identReferencesFor(c);
  // Dynamic-only files: even if no named/default identifier is referenced,
  // a path hit through `dynamic(() => import('...'))` counts as alive.
  const dynamicHits = c.references.pathHits.filter((p) => dynamicTargets.has(p));
  c.references.dynamicHits = dynamicHits;

  const isAlive =
    c.references.pathHits.length > 0 ||
    c.references.identHits.length > 0;

  if (isAlive) {
    c.status = 'alive';
    alive.push(c);
  } else {
    c.status = 'dead-candidate';
    candidates.push(c);
  }
}

// --- Step 5: produce JSON report ------------------------------------
const report = {
  generatedAt: new Date().toISOString(),
  task: 'dead-code-full-scan',
  scope: 'src/components/**/*.{ts,tsx}',
  totalScanned: components.length,
  whitelisted: components.filter((c) => c.status === 'whitelisted').length,
  aliveCount: alive.length,
  deadCandidateCount: candidates.length,
  candidates: candidates.map((c) => ({
    file: c.rel,
    lines: c.lineCount,
    defaultExport: c.exports.default,
    namedExports: Array.from(c.exports.named).slice(0, 10),
    pathHits: c.references.pathHits,
    identHits: c.references.identHits,
    dynamicHits: c.references.dynamicHits,
  })),
};

console.log(JSON.stringify(report, null, 2));
