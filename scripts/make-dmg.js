#!/usr/bin/env node
/**
 * make-dmg.js — rebuild the DMG after postbuild.js has injected files
 * electron-builder's globby layer silently dropped. (electron-builder 25
 * passes the `files` glob through minimatch with `{ dot: false }`, so any
 * leading-dot path — `.next/`, `.prisma/`, `node_modules/.prisma/` — is
 * silently skipped from the asar pack and the asar:false loose list.)
 *
 * Why we don't just bump the bundler config: we've tried every glob form
 * we can think of and none of them reach into the .app.
 *
 * Strategy: stage a directory containing the .app *plus* an
 * `Applications` symlink, then `hdiutil create -srcfolder` over the
 * stage. The Applications symlink is what makes Finder render the
 * classic "drag to Applications" window when the user double-clicks the
 * dmg — without it, `-srcfolder` only gets the .app and the user
 * sees a single-icon window with no Install hint.
 *
 * -srcfolder produces an APFS image (macOS 13+ arm64 default) so it
 * works on any modern Mac. UDZO compresses it.
 *
 * Run as the final step of `npm run build:electron`.
 */
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const APP_PATH = path.join(REPO_ROOT, 'release', 'mac-arm64', 'PDB Structure Tracker.app');
const RELEASE_DIR = path.join(REPO_ROOT, 'release');
const ORIGINAL_DMG = path.join(RELEASE_DIR, 'PDB Structure Tracker-0.2.0-arm64.dmg');
const WORK_DIR = path.join(RELEASE_DIR, '.repack-tmp');
const STAGE_DIR = path.join(WORK_DIR, 'stage');
const NEW_DMG_PATH = path.join(WORK_DIR, 'PDB-Structure-Tracker-repacked.dmg');

function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', ...opts });
  if (r.status !== 0) {
    console.error(`[make-dmg] ${cmd} ${args.join(' ')} failed with status ${r.status}`);
    process.exit(r.status ?? 1);
  }
}

function rmrf(p) {
  if (fs.existsSync(p)) {
    fs.rmSync(p, { recursive: true, force: true });
  }
}

try {
  // 1. Wipe the previous DMG — it was generated before postbuild ran, so
  // it does NOT contain the freshly-copied `.prisma/` / `.next/standalone/`
  // files. The .app on disk does.
  if (fs.existsSync(ORIGINAL_DMG)) {
    fs.unlinkSync(ORIGINAL_DMG);
    console.log(`[make-dmg] removed stale ${ORIGINAL_DMG}`);
  }

  // 2. Prepare a clean stage dir.
  rmrf(WORK_DIR);
  fs.mkdirSync(STAGE_DIR, { recursive: true });

  // 3. APFS-clone the .app into the stage. `cp -c` uses APFS
  // clonefile(2) which creates a copy-on-write reference that
  // doesn't reserve the source's space on disk — the stage
  // essentially shares the same extents as the source until the
  // dmg build writes its output. This is the only way to stage a
  // 1.2 GB .app into a 1.7 GB /Users volume and still have room
  // for the dmg output.
  console.log(`[make-dmg] cloning .app into stage (APFS clonefile)`);
  run('cp', [
    '-cR',
    APP_PATH,
    path.join(STAGE_DIR, 'PDB Structure Tracker.app'),
  ]);

  // 4. Drop an `Applications` symlink into the stage so Finder renders
  // the classic drag-to-Applications window when the user opens the dmg.
  fs.symlinkSync('/Applications', path.join(STAGE_DIR, 'Applications'));

  // 5. Build the dmg from the stage.
  console.log(`[make-dmg] building DMG from ${STAGE_DIR}`);
  run('hdiutil', [
    'create',
    '-ov',
    '-format', 'UDZO',
    '-imagekey', 'zlib-level=9',
    '-srcfolder', STAGE_DIR,
    '-volname', 'PDB Structure Tracker',
    NEW_DMG_PATH,
  ]);

  // 6. Atomically replace the previous DMG name.
  fs.renameSync(NEW_DMG_PATH, ORIGINAL_DMG);
  const size = fs.statSync(ORIGINAL_DMG).size;
  console.log(`[make-dmg] wrote ${ORIGINAL_DMG} (${(size / 1024 / 1024).toFixed(1)} MB)`);
} finally {
  rmrf(WORK_DIR);
}
