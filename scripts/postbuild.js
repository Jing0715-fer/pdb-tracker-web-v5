#!/usr/bin/env node
/**
 * postbuild.js — runs after electron-builder has produced the .app.
 *
 * electron-builder 25 silently drops paths that start with a dot from
 * both its asar pack and its asar:false loose file list (minimatch with
 * `{ dot: false }`). So none of `.next/**` or `node_modules/.prisma/`
 * survives the pack, and we must copy them in afterwards by hand.
 *
 * CRITICAL — where the copies must land:
 *
 * electron/main.js spawns the standalone server with
 *   cwd = <app>/.next/standalone
 * and Next.js standalone resolves EVERYTHING relative to that dir:
 *
 *   • /_next/static/*          →  <standalone>/.next/static/
 *   • /public/* (logo, robots) →  <standalone>/public/
 *   • @prisma/client engine    →  <standalone>/node_modules/.prisma/
 *
 * The previous version of this script copied these NEXT TO the standalone
 * dir, where the server never looks. The server therefore booted but every
 * `/_next/static/chunks/*.js` and `/_next/static/css/*.css` returned 404 —
 * causing the "black screen after install". The fix is to copy static /
 * public / .prisma INTO the standalone tree.
 */
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const RELEASE_DIR = path.join(REPO_ROOT, 'release');

/**
 * Locate the electron-builder output's unpacked app directory across
 * platforms. electron-builder's directory layout differs by OS:
 *
 *   macOS:  release/mac-arm64/PDB Structure Tracker.app/Contents/Resources/app/
 *   Windows: release/win-unpacked/resources/app/
 *
 * We probe both layouts (plus the generic `mac/` fallback for x64 builds)
 * and use whichever exists. This lets the same postbuild.js run after
 * `--mac dmg --arm64` or `--win nsis --x64` without platform-specific flags.
 */
function findAppDir() {
  const PRODUCT = 'PDB Structure Tracker';
  const candidates = [
    // macOS arm64
    path.join(RELEASE_DIR, 'mac-arm64', `${PRODUCT}.app`, 'Contents', 'Resources', 'app'),
    // macOS x64 (rare, but --x64 produces release/mac/)
    path.join(RELEASE_DIR, 'mac', `${PRODUCT}.app`, 'Contents', 'Resources', 'app'),
    // Windows unpacked (electron-builder default for --win)
    path.join(RELEASE_DIR, 'win-unpacked', 'resources', 'app'),
  ];
  for (const c of candidates) {
    if (exists(c)) return c;
  }
  return null;
}

function exists(p) {
  try { fs.accessSync(p); return true; } catch { return false; }
}

const APP_DIR = findAppDir();
if (!APP_DIR) {
  console.error('[postbuild] could not find unpacked app dir under release/');
  console.error('  looked in:');
  console.error(`    ${path.join(RELEASE_DIR, 'mac-arm64', 'PDB Structure Tracker.app', 'Contents', 'Resources', 'app')}`);
  console.error(`    ${path.join(RELEASE_DIR, 'win-unpacked', 'resources', 'app')}`);
  console.error('did electron-builder run? (run `npm run build:electron` or `npm run build:electron:win`)');
  process.exit(1);
}
console.log(`[postbuild] app dir: ${APP_DIR}`);

// The standalone server runs with cwd = <APP_DIR>/.next/standalone, so all
// runtime assets must live INSIDE that tree (see header comment).
const STANDALONE_DIR = path.join(APP_DIR, '.next', 'standalone');

// sources from the project root
const SRC_PRISMA = path.join(REPO_ROOT, 'node_modules', '.prisma');
const SRC_NEXT_STANDALONE = path.join(REPO_ROOT, '.next', 'standalone');
const SRC_NEXT_STATIC = path.join(REPO_ROOT, '.next', 'static');
const SRC_PUBLIC = path.join(REPO_ROOT, 'public');
const SRC_PRISMA_SCHEMA = path.join(REPO_ROOT, 'prisma');
const SRC_SEED_DB = path.join(REPO_ROOT, 'prisma', 'seed-schema.db');

// destinations INSIDE the standalone tree (where the server actually reads)
const DST_NEXT_STANDALONE = STANDALONE_DIR;
const DST_NEXT_STATIC = path.join(STANDALONE_DIR, '.next', 'static');
const DST_PUBLIC = path.join(STANDALONE_DIR, 'public');
const DST_PRISMA = path.join(STANDALONE_DIR, 'node_modules', '.prisma');
const DST_PRISMA_SCHEMA = path.join(STANDALONE_DIR, 'prisma');
const DST_SEED_DB = path.join(STANDALONE_DIR, 'prisma', 'seed-schema.db');

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else if (entry.isFile()) fs.copyFileSync(s, d);
    // skip symlinks, sockets, etc.
  }
}

function ensureCopy(src, dst, label) {
  if (!exists(src)) {
    console.error(`[postbuild] missing source for ${label}: ${src}`);
    return false;
  }
  if (exists(dst)) {
    fs.rmSync(dst, { recursive: true, force: true });
  }
  copyDir(src, dst);
  console.log(`[postbuild] copied ${label}: ${src} → ${dst}`);
  return true;
}

/** Copy a single file (not a directory), creating parent dirs as needed. */
function ensureCopyFile(src, dst, label) {
  if (!exists(src)) {
    console.error(`[postbuild] missing source file for ${label}: ${src}`);
    return false;
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  console.log(`[postbuild] copied ${label}: ${src} → ${dst}`);
  return true;
}

// APP_DIR was already located by findAppDir() above (which exits if none
// found), so no additional bundle-existence check is needed here.

// ORDER MATTERS: copy the standalone tree FIRST, then layer static /
// public / .prisma / schema ON TOP. ensureCopy() wipes the destination
// before copying, so anything copied before the standalone tree would be
// deleted when the standalone tree is laid down.
const ok = [
  ensureCopy(SRC_NEXT_STANDALONE, DST_NEXT_STANDALONE, '.next/standalone/ (whole tree)'),
  ensureCopy(SRC_NEXT_STATIC, DST_NEXT_STATIC, '.next/static/ → standalone/.next/static/'),
  ensureCopy(SRC_PUBLIC, DST_PUBLIC, 'public/ → standalone/public/'),
  ensureCopy(SRC_PRISMA, DST_PRISMA, '.prisma/ → standalone/node_modules/.prisma/'),
  ensureCopy(SRC_PRISMA_SCHEMA, DST_PRISMA_SCHEMA, 'prisma/ → standalone/prisma/ (runtime db push)'),
  ensureCopyFile(SRC_SEED_DB, DST_SEED_DB, 'prisma/seed-schema.db (first-launch schema seed)'),
].every(Boolean);

if (!ok) process.exit(1);

// Final sanity check: assert the runtime-critical files actually exist in
// the standalone tree. If next build silently failed, or any copy above was
// a no-op, the .app would boot to a "port never opened" dialog — better to
// fail the build here with a clear message.
const criticalFiles = [
  path.join(STANDALONE_DIR, 'server.js'),
  path.join(STANDALONE_DIR, '.next', 'static'),
  path.join(STANDALONE_DIR, 'node_modules', '@prisma', 'client'),
  path.join(STANDALONE_DIR, 'prisma', 'seed-schema.db'),
];
const missing = criticalFiles.filter((p) => !exists(p));
if (missing.length > 0) {
  console.error('[postbuild] CRITICAL — missing runtime files after copy:');
  missing.forEach((p) => console.error(`  - ${p}`));
  process.exit(1);
}
console.log('[postbuild] done — all runtime assets verified in standalone tree');
