'use strict';

/**
 * Electron main process for the PDB Structure Tracker desktop app.
 *
 * Responsibilities:
 *   1. Spawn the Next.js standalone server on a free local port and wait
 *      until it's accepting HTTP traffic before opening a BrowserWindow.
 *   2. Point the BrowserWindow at http://127.0.0.1:<port>.
 *   3. Cleanly tear down the child server on app quit.
 *
 * Why we wrap Next.js standalone instead of running it as a separate
 * process the user has to launch: the goal is a single .dmg the user
 * double-clicks and immediately sees the PDB tracker UI.
 */

const { app, BrowserWindow, dialog } = require('electron');
const { spawn } = require('node:child_process');
const path = require('node:path');
const net = require('node:net');
const fs = require('node:fs');

// electron-builder ships with asar:false (hidden .prisma/ dir is
// silently dropped by the asar glob library, so we disable asar entirely
// and the .app ships the full tree loose). That means app.getAppPath()
// already resolves directly to .../Contents/Resources/app/ — no .asar
// suffix, no .asar.unpacked sibling needed.
const STANDALONE_ENTRY = path.join(
  app.getAppPath(),
  '.next',
  'standalone',
  'server.js',
);

/**
 * Find a free TCP port by asking the kernel for one. We bind to port 0
 * (kernel assigns), read the assigned port, then close the socket.
 */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      const port = typeof addr === 'object' && addr ? addr.port : 0;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

/**
 * Poll a TCP port until it accepts connections (server is ready).
 * Next.js standalone writes "Ready in" to stdout; we don't rely on the
 * log line — port readiness is the source of truth.
 */
function waitForPort(port, attempts = 60, intervalMs = 500) {
  return new Promise((resolve, reject) => {
    let n = 0;
    const tryOnce = () => {
      const sock = net.createConnection({ host: '127.0.0.1', port }, () => {
        sock.end();
        resolve();
      });
      sock.on('error', () => {
        sock.destroy();
        n += 1;
        if (n >= attempts) reject(new Error(`Port ${port} never opened`));
        else setTimeout(tryOnce, intervalMs);
      });
    };
    tryOnce();
  });
}

let serverProc = null;
let mainWindow = null;

/**
 * Resolve a writable SQLite location for the packaged app.
 *
 * The .app bundle itself is effectively read-only, so the user's database
 * lives under Electron's userData dir. src/lib/db.ts honours an absolute
 * `file:` URL in DATABASE_URL, so setting it here guarantees the Prisma
 * client opens a writable DB regardless of the server's cwd.
 */
function resolveUserDataDb() {
  const userData = app.getPath('userData');
  const dbDir = path.join(userData, 'db');
  fs.mkdirSync(dbDir, { recursive: true });
  const dbPath = path.join(dbDir, 'pdb-tracker.db');
  seedUserDbIfMissing(dbPath);
  return `file:${dbPath}`;
}

/**
 * On first launch the user's DB file does not exist. The packaged .app has
 * no `bunx`/`prisma` CLI, so `/api/db-config?action=init` cannot run
 * `prisma db push`. Instead we ship a pre-built empty-schema SQLite file
 * (`prisma/seed-schema.db`, copied into the standalone tree by postbuild.js)
 * and clone it into the user's DB path on first launch.
 */
function seedUserDbIfMissing(dbPath) {
  try {
    const exists = fs.existsSync(dbPath);
    const isEmpty = exists && fs.statSync(dbPath).size === 0;
    if (exists && !isEmpty) return; // user already has data
    const seedPath = path.join(path.dirname(STANDALONE_ENTRY), 'prisma', 'seed-schema.db');
    if (!fs.existsSync(seedPath)) {
      console.warn(`[electron] seed-schema.db not found at ${seedPath} — first-launch schema init skipped.`);
      return;
    }
    fs.copyFileSync(seedPath, dbPath);
    console.log(`[electron] seeded user database from ${seedPath} → ${dbPath}`);
  } catch (err) {
    console.error('[electron] failed to seed user database:', err);
  }
}

async function createWindow() {
  const port = await getFreePort();

  serverProc = spawn(
    process.execPath,
    [STANDALONE_ENTRY],
    {
      env: {
        ...process.env,
        PORT: String(port),
        HOSTNAME: '127.0.0.1',
        ELECTRON_RUN_AS_NODE: '1',
        // Suppress Next.js telemetry download attempts inside the bundle.
        NEXT_TELEMETRY_DISABLED: '1',
        // Writable, absolute SQLite path outside the .app bundle.
        DATABASE_URL: resolveUserDataDb(),
        NODE_ENV: 'production',
        // Writable root for .hermes/db-config.json, db/ etc. Read by src/lib/paths.ts.
        PDB_USER_DATA_DIR: app.getPath('userData'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: path.dirname(STANDALONE_ENTRY),
    },
  );

  // Surface server errors but don't crash the app — Next.js writes to
  // stdout/stderr and the user can still see the page once it's up.
  serverProc.stdout.on('data', (b) => process.stdout.write(`[next] ${b}`));
  serverProc.stderr.on('data', (b) => process.stderr.write(`[next] ${b}`));
  serverProc.on('exit', (code) => {
    console.log(`[next] standalone server exited with code ${code}`);
    serverProc = null;
  });

  try {
    await waitForPort(port);
  } catch (err) {
    console.error('[electron] standalone server never came up:', err);
    dialog.showErrorBox(
      'PDB Structure Tracker failed to start',
      `The local server did not become ready in time.\n\n${err && err.message ? err.message : err}\n\n` +
      'The app will now quit. Please relaunch it; if the problem persists, ' +
      'check that another instance is not already running.',
    );
    if (serverProc) { try { serverProc.kill('SIGKILL'); } catch { /* ignore */ } serverProc = null; }
    app.quit();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'PDB Structure Tracker',
    backgroundColor: '#1a1a1a',
    show: false, // wait for ready-to-show to avoid the white flash and the
                 // "window appeared but is hidden behind the dock" race on
                 // macOS 14+ where BrowserWindow auto-show can land off-screen
                 // or behind another app's window.
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // Disable the chromium sandbox: when sandbox: true is left on, Next.js
      // 16's strict default CSP and cross-origin cookie scoping can cause
      // /_next/static/* and /api/* requests from the BrowserWindow to fail
      // silently, leaving the window blank (this is the DMG-installed black
      // screen the user reported). We don't load remote code — the only
      // origin we visit is http://127.0.0.1:<port>/ — so the sandbox
      // hardening buys us nothing in this setup and now costs us a usable
      // window.
      sandbox: false,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
    // macOS quirk: a brand-new BrowserWindow often lands behind the dock or
    // behind the previously-focused app. activateIgnoringOtherApps() lifts it
    // to the foreground the same way Dock → app does.
    if (typeof app.focus === 'function') app.focus();
    if (process.platform === 'darwin' && typeof app.dock?.show === 'function') {
      app.dock.show();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // Surface any page-load failure (DNS, network, CSP, etc.) to stdout so the
  // user / build log sees a diagnostic instead of a silent black window.
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[electron] BrowserWindow failed to load ${url}: ${code} ${desc}`);
  });
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error(`[electron] renderer process gone:`, details);
  });
  mainWindow.webContents.on('console-message', (_e, level, message, line, source) => {
    if (level >= 2 /* warning/error */) {
      console.error(`[electron/web] ${source}:${line} ${message}`);
    }
  });

  await mainWindow.loadURL(`http://127.0.0.1:${port}`);

  // Belt-and-braces: if ready-to-show never fired within 8s (Chromium can
  // sometimes skip the event for cached pages), force-show so the user
  // never sees a blank dock icon with no window.
  const forceShowTimer = setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
    }
  }, 8000);
  mainWindow.once('closed', () => clearTimeout(forceShowTimer));
}

app.whenReady().then(createWindow).catch((err) => {
  console.error('Failed to start PDB tracker:', err);
  app.quit();
});

app.on('window-all-closed', () => {
  // macOS default is to keep the app alive in the dock after all windows
  // close, but that strands the spawned Next.js server as an orphan and
  // makes the .app undeletable from the Finder (it reports "running").
  // Quit on every platform when the user closes the last window.
  app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('before-quit', () => {
  if (serverProc) {
    try { serverProc.kill('SIGTERM'); } catch { /* ignore */ }
    // give it a brief grace window to flush before we hard-kill. If the
    // server is stuck on a long in-flight request, SIGKILL after 1 s.
    try {
      const p = serverProc;
      setTimeout(() => {
        try { p.kill('SIGKILL'); } catch { /* already dead */ }
      }, 1000);
    } catch { /* ignore */ }
    serverProc = null;
  }
});