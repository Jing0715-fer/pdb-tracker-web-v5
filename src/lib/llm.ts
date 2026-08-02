/**
 * Shared LLM helper.
 *
 * Provider selection policy (NO z-ai, NO hardcoded absolute paths):
 *
 *   The first time a model call is made (or on explicit `inspectProviders()`)
 *   we **probe** each candidate. A candidate is considered *available* only if
 *   its binary resolves on PATH (via `where`/`which`) and a tiny smoke-test
 *   invocation succeeds within a 6-second budget. That probe is cached for
 *   the lifetime of the Node process.
 *
 *   At call time `generateText` / `llmComplete` walks the candidate list in
 *   the user-requested order (or auto order), and on the first failed call it
 *   cleanly falls through to the next candidate. We never fabricate output.
 *
 *   Each CLI has a tiny *adapter* table — name, smoke-test args, real-call
 *   arg template, output-stream hint (stdout|stderr|both), and a regex to
 *   strip the leading "session_id: ..." banner that some agents emit on
 *   stderr. Adding a new CLI = adding one entry to `CLI_ADAPTERS`.
 */

import { spawn, execSync } from 'node:child_process';
import { existsSync, writeFileSync, readFileSync, unlinkSync, statSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ─── Public types ─────────────────────────────────────────────────────────────

export interface LlmConfig {
  /** One of: 'cli:hermes' | 'cli:claude' | 'cli:codex' | 'cli:openclaw' | 'cli:gemini' | 'cli:aider' | 'anthropic' | 'openai' | '' (auto) */
  provider?: string;
  model?: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LlmResult {
  ok: boolean;
  content: string;
  /** Alias for `content` — legacy callers read `.text`. */
  text: string;
  provider: string;
  model: string;
  durationMs: number;
  fallback: boolean;
  error?: string;
  meta?: Record<string, unknown>;
}

export interface LlmProviderInfo {
  provider: string;
  /** Resolved binary path if a CLI provider; null for SDK providers. */
  bin: string | null;
  /** UI icon — single emoji chosen to loosely match the original brand. */
  icon: string;
  /** When set, the UI should render <img src={iconUrl} /> instead of emoji. */
  iconUrl?: string | null;
  label: string;
  reason: string;
  available: boolean;
  /** 'native' (PATH on host OS), 'wsl' (Linux distro via WSL bridge), or 'sdk'. */
  via: 'native' | 'wsl' | 'sdk';
}


// ─── Brand asset resolution (NOT hardcoded) ──────────────────────────────
// When a CLI is detected, climb from its binary directory looking for a
// brand asset (icon.ico / icon.png / assets/icon.svg / logo.png). The list of
// candidate filenames is brand-agnostic so the same discovery works for any
// new CLI we add. Searches up to 5 levels deep and follows standard
// well-known asset paths (resources/, assets/, build/Release/).
async function findBrandIcon(binDir: string, binName: string, brandTokens: string[]): Promise<string | null> {
  // Returns an absolute PATH on disk if found (UI will fetch via /api/llm/icon?path=…)
  try {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');

    // 1. Candidate icon paths, ordered by fidelity:
    //    ICO (Windows desktop) > PNG > SVG. The outer `candidates` array
    //    is checked in order — first hit wins.
    const candidates: string[] = [];
    for (const tok of brandTokens) {
      // ICO first
      candidates.push(
        `${tok}.ico`,
        path.join('resources', `${tok}.ico`),
        path.join('assets', `${tok}.ico`),
      );
      // PNG second
      candidates.push(
        `${tok}.png`,
        path.join('resources', `${tok}.png`),
        path.join('assets', `${tok}.png`),
      );
      // SVG last (treats .ico as higher-priority brand asset)
      candidates.push(
        `${tok}.svg`,
        path.join('resources', `${tok}.svg`),
        path.join('assets', `${tok}.svg`),
      );
    }
    // Generic fallbacks (icon.ico / icon.png / logo.png / icon.svg)
    candidates.push('icon.ico', 'logo.png', 'icon.png', 'logo.svg', 'icon.svg');

    // Walk up from binary dir, at most 8 levels. At each level, scan the
    // immediate `dir` PLUS a few common sibling subdirs (apps/*/release/*/resources,
    // build/Release, etc.) because Electron-packaged CLIs frequently keep
    // their icon under e.g. `apps/desktop/release/win-unpacked/resources/`.
    let _scanDir = binDir;
    const _scanRoots: string[] = [];
    for (let i = 0; i < 6; i++) {
      _scanRoots.push(_scanDir);
      const _parent = path.dirname(_scanDir);
      if (_parent === _scanDir) break;
      _scanDir = _parent;
    }
    const _ebRoots: string[] = [];
    for (const _root of _scanRoots) {
      try {
        const _items = await fs.readdir(_root, { withFileTypes: true });
        for (const _it of _items) {
          if (!_it.isDirectory()) continue;
          // Electron-builder: apps/<app>/release/<platform>/resources/
          if (_it.name === 'apps') {
            try {
              const _appsDir = path.join(_root, 'apps');
              const _appEntries = await fs.readdir(_appsDir, { withFileTypes: true });
              for (const _appEnt of _appEntries) {
                if (!_appEnt.isDirectory()) continue;
                const _appPath = path.join(_appsDir, _appEnt.name);
                _ebRoots.push(path.join(_appPath, 'release'));
              }
            } catch { /* keep going */ }
          }
          // `release` dir directly
          if (_it.name === 'release' || _it.name === 'releases') {
            _ebRoots.push(path.join(_root, _it.name));
          }
        }
      } catch { /* keep going */ }
    }
    for (const _relRoot of _ebRoots) {
      try {
        const _platformEntries = await fs.readdir(_relRoot, { withFileTypes: true });
        for (const _pe of _platformEntries) {
          if (!_pe.isDirectory()) continue;
          const _resDir = path.join(_relRoot, _pe.name, 'resources');
          for (const _fname of ['icon.ico', 'icon.png', 'logo.ico', 'logo.png', 'icon.svg', 'logo.svg']) {
            const _abs = path.join(_resDir, _fname);
            try {
              const _st = await fs.stat(_abs);
              if (_st.isFile() && _st.size > 200) return _abs;
            } catch { /* keep looking */ }
          }
        }
      } catch { /* keep going */ }
    }

    // Generic walk afterwards.
    let dir = binDir;
    for (let depth = 0; depth < 8; depth++) {
      // 1) current dir — single ordered candidates list
      for (const rel of candidates) {
        const abs = path.resolve(dir, rel);
        try {
          const st = await fs.stat(abs);
          if (st.isFile() && st.size > 200) return abs;
        } catch { /* keep looking */ }
      }
      // 2) Sibling subdirs + 2-level descent into well-known bundled-app layouts.
      //    Herme s Electron app stores its icon at apps/desktop/release/<platform>/resources/.
      //    Generic patterns that cover Electron-builder / Electron Forge / Tauri:
      //      apps/<app>/release/<platform>/resources/
      //      <brand>-desktop/release/<platform>/resources/
      //      bin/<brand>/resources/
      //    We only enter them when the directory name matches a brand token or
      //    a known desktop-app directory, to keep the search fast.
      const descendantSubdirs: string[] = [];
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const ent of entries) {
          if (!ent.isDirectory()) continue;
          const subPath = path.resolve(dir, ent.name);
          if (/(^|[\\/])(node_modules|venv|env|\.venv|site-packages|dist|build|\.git|node_modules\.cache)$/i.test(subPath)) continue;
          // Single-level: check immediate children for icon files.
          for (const rel of candidates) {
            const abs = path.resolve(subPath, rel);
            try {
              const st = await fs.stat(abs);
              if (st.isFile() && st.size > 200) return abs;
            } catch { /* keep looking */ }
          }
          // Multi-level: descend into `apps`, `releases`, `desktop`, etc.
          if (/(^|[\\/])(apps?|releases?|desktop|release|bin|out|target|dist-app|app)$/i.test(ent.name)) {
            descendantSubdirs.push(subPath);
          }
        }
      } catch { /* dir unreadable */ }
      // Descend up to 2 extra levels into flagged sibling dirs.
      // This handles `apps/desktop/release/<platform>/resources/icon.ico`
      // (Electron-builder layout) and `<x>-desktop/release/<platform>/resources/...`.
      const seen = new Set<string>();
      const visitDescendants = async (root: string) => {
        try {
          const entries = await fs.readdir(root, { withFileTypes: true });
          for (const ent of entries) {
            if (!ent.isDirectory()) continue;
            const subPath = path.resolve(root, ent.name);
            if (seen.has(subPath)) continue;
            seen.add(subPath);
            // Single candidate check (ordered list, ICO > PNG > SVG).
            for (const rel of candidates) {
              const abs = path.resolve(subPath, rel);
              try {
                const st = await fs.stat(abs);
                if (st.isFile() && st.size > 200) return abs;
              } catch { /* keep looking */ }
            }
            // Look for common Electron-builder intermediate dirs; descend one more level.
            if (/(^|[\\/])(desktop|release|releases|target|win-unpacked|linux-unpacked|mac|macos|darwin|windows|win64|win32|app)$/i.test(ent.name)) {
              const found = await visitDescendants(subPath);
              if (found) return found;
            }
          }
        } catch { /* dir unreadable */ }
        return null;
      };
      for (const sub of descendantSubdirs) {
        const found = await visitDescendants(sub);
        if (found) return found;
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  } catch { /* no fs access */ }
  return null;
}

// Map each CLI id to brand tokens used for icon discovery.
function brandTokensFor(id: string): string[] {
  switch (id) {
    case 'hermes':     return ['hermes', 'icon'];
    case 'claude':     return ['claude', 'claude-code', 'icon', 'logo'];
    case 'codex':      return ['codex', 'openai', 'icon', 'logo'];
    case 'openclaw':   return ['openclaw', 'icon', 'logo'];
    case 'gemini':     return ['gemini', 'google-gemini', 'icon', 'logo'];
    case 'aider':      return ['aider', 'icon', 'logo'];
    default:           return ['icon', 'logo'];
  }
}

// ─── Adapter table ────────────────────────────────────────────────────────────

interface CliAdapter {
  /** Public id used in LlmConfig.provider ("cli:<id>"). */
  id: string;
  /** Display name. */
  label: string;
  /** Brand-matching icon (emoji that visually resembles the original logo). */
  icon: string;
  /** CLI binary name to resolve on PATH. */
  bin: string;
  /** Optional override for the binary name when invoked inside WSL. */
  wslBin?: string;
  /**
   * Lightweight args used by the probe — must exit quickly with success.
   * We default to `['--version']` because it always exits 0 fast without
   * hitting the model API; per-CLI overrides only when --version is
   * unsupported.
   */
  probeArgs?: string[];
  /**
   * Optional probe that just *prints* `ok` (no LLM round trip). Use this if
   * the CLI has no fast --version flag.
   */
  probeCommand?: 'silent-read';
  /** Real-call args template. */
  callArgs: (prompt: string, model: string | undefined) => string[];
  /** Which stream(s) carry the actual text response. */
  outputStream: 'stdout' | 'stderr' | 'both';
  /**
   * Optional path where the CLI writes its final response to a file
   * (e.g. `codex exec --output-last-message <file>`). When set, the
   * library will pre-create a unique temp file per call, inject its
   * path into the args via `callArgs`, then read the file back after
   * the child process exits. The literal token `$OUTPUT_FILE` in
   * callArgs is replaced with the generated temp file path.
   *
   * If the file is empty after the call, the function falls back to
   * parsing stdout/stderr (useful for CLIs that occasionally write
   * to stdout instead of the requested file).
   */
  outputFile?: '$OUTPUT_FILE' | string;
  /** Strip leading non-text banner lines (e.g. "session_id: …"). */
  stripBanner?: (raw: string) => string;
  /** Per-call extra env (e.g. PYTHONIOENCODING). */
  extraEnv?: Record<string, string>;
  /** Probe timeout (ms). Default 6000. */
  probeTimeoutMs?: number;
  /** Call timeout (ms). Default 240000. */
  callTimeoutMs?: number;
  /**
   * Optional extra filesystem locations to probe before falling through to
   * `where`/`which` — useful for CLIs whose binary lives outside PATH (e.g.
   * WorkBuddy's electron-asar.unpacked bundled binary, or `npm i -g`
   * install locations on multi-machine setups).
   */
  extraProbePaths?: string[];
  /**
   * Set to true when the CLI binary is a Node.js script (e.g. WorkBuddy's
   * shim) that must be launched via `node <bin> ...args` rather than spawned
   * directly. Affects both the probe and the real call.
   */
  needsNode?: boolean;
}

const HERMES_BANNER_RE = /(?:^|\n)\s*session_id:\s*\S+\s*(?=\n|$)/i;

const CLI_ADAPTERS: CliAdapter[] = [
  {
    id: 'hermes',
    label: 'Hermes CLI',
    bin: 'hermes',
    icon: '🪶',
    wslBin: 'hermes',
    probeArgs: ['--version'],
    // `hermes chat -q "..." -Q` runs a one-shot query in quiet mode (no TUI).
    // We KEEP the user's model/provider config (no `--ignore-user-config`)
    // so the agent honours whatever default the user has set (e.g. MiniMax).
    callArgs: (q) => ['chat', '-q', q, '-Q'],
    outputStream: 'both',
    stripBanner: (raw) => raw.replace(HERMES_BANNER_RE, '').trim(),
    extraEnv: { PYTHONIOENCODING: 'utf-8' },
    probeTimeoutMs: 15_000,
    // Hermes CLI may need >5min for large reports (e.g. 4000-char full report).
    // Override globally with HERMES_CLI_TIMEOUT_MS env (e.g. `set HERMES_CLI_TIMEOUT_MS=900000`).
    callTimeoutMs: Number(process.env.HERMES_CLI_TIMEOUT_MS) || 600_000,
  },
  {
    id: 'claude',
    label: 'Claude Code CLI',
    bin: 'claude',
    icon: '🟠',
    wslBin: 'claude',
    probeArgs: ['--version'],
    // Claude Code supports `claude -p "..."` (print mode, non-interactive).
    callArgs: (q) => ['-p', q, '--no-stream'],
    outputStream: 'stdout',
    probeTimeoutMs: 15_000,
    callTimeoutMs: 240_000,
  },
  {
    id: 'codex',
    label: 'Codex CLI',
    bin: 'codex',
    icon: '🟢',
    wslBin: 'codex',
    probeArgs: ['--version'],
    /** Multi-machine fallback locations for `@openai/codex` (npm i -g / bun add -g).
     *  Tried in order before falling through to `where codex` / `which codex`.
     *  Env override: `CODEX_CLI_PATH=...`. */
    extraProbePaths: (() => {
      const home = process.env.HOME || process.env.USERPROFILE || '';
      const paths: string[] = [];
      if (process.platform === 'win32') {
        if (home) {
          paths.push(`${home}\\.bun\\bin\\codex.exe`);
          paths.push(`${home}\\.bun\\bin\\codex.cmd`);
          paths.push(`${home}\\AppData\\Roaming\\npm\\codex.cmd`);
          paths.push(`${home}\\AppData\\Local\\npm\\codex.cmd`);
          paths.push(`${home}\\.local\\bin\\codex.exe`);
        }
        paths.push('C:\\Program Files\\nodejs\\codex.cmd');
      } else {
        if (home) {
          paths.push(`${home}/.bun/bin/codex`);
          paths.push(`${home}/.local/bin/codex`);
          paths.push(`${home}/.npm-global/bin/codex`);
          paths.push(`${home}/.nvm/versions/node/current/bin/codex`);
        }
        paths.push('/usr/local/bin/codex');
        paths.push('/opt/homebrew/bin/codex');
      }
      return paths;
    })(),
    /**
     * Codex 0.144+ uses `codex exec [PROMPT]` for non-interactive runs and
     * writes the agent's final message to a file passed via
     * `--output-last-message <file>`. The earlier `codex exec --quiet`
     * invocation is no longer supported (v0.144 rejects the flag).
     * The `$OUTPUT_FILE` token is replaced with a per-call temp file
     * path by the library before spawn (see `outputFile` field).
     */
    callArgs: (q) => ['exec', '--output-last-message', '$OUTPUT_FILE', q],
    outputStream: 'stdout',
    outputFile: '$OUTPUT_FILE',
    probeTimeoutMs: 15_000,
    callTimeoutMs: 240_000,
  },
  {
    id: 'openclaw',
    label: 'OpenClaw CLI',
    bin: 'openclaw',
    icon: '🦅',
    wslBin: 'openclaw',
    probeArgs: ['--version'],
    callArgs: (q) => ['llm', 'chat', '--no-stream', q],
    outputStream: 'stdout',
    probeTimeoutMs: 15_000,
    callTimeoutMs: 240_000,
  },
  {
    id: 'gemini',
    label: 'Gemini CLI',
    bin: 'gemini',
    icon: '♊',
    wslBin: 'gemini',
    probeArgs: ['--version'],
    callArgs: (q) => [q],
    outputStream: 'stdout',
    probeTimeoutMs: 15_000,
    callTimeoutMs: 240_000,
  },
  {
    id: 'codebuddy',
    label: 'Codebuddy / WorkBuddy CLI',
    icon: '🐼',
    bin: 'codebuddy',
    needsNode: true,
    /** Hard-coded fallback for WorkBuddy's bundled CLI on Windows + macOS.
     *  The bundled binary lives inside the app's electron-asar.unpacked
     *  resources, NOT in PATH, so we try the canonical install locations
     *  before falling through to `which codebuddy` / `where codebuddy`.
     *  Env override: `CODEBUDDY_CLI_PATH=...`. */
    extraProbePaths: [
      process.platform === 'win32'
        ? 'C:\\Program Files\\WorkBuddy\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy'
        : '/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy',
      '/usr/local/bin/codebuddy',
      '/opt/homebrew/bin/codebuddy',
    ],
    /** Headless invocation — same flag set used by Claude Code-style CLIs.
     *  `--print "<prompt>"` emits a single text reply on stdout and exits.
     *  For streaming, append `--output-format stream-json` (NDJSON events).
     *  For interactive TUI/REPL, omit `--print`. */
    callArgs: (q, model) => {
      // Default to deepseek-v4-pro for WorkBuddy CLI; user can override via the
      // LLM 高级配置 → model field in the Run Center.
      const m = model || process.env.CODEBUDDY_MODEL || 'deepseek-v4-pro';
      return ['--print', '--model', m, q];
    },
    outputStream: 'stdout',
    probeTimeoutMs: 15_000,
    callTimeoutMs: 240_000,
    extraEnv: { PYTHONIOENCODING: 'utf-8' },
  },
  {
    id: 'aider',
    label: 'Aider CLI',
    bin: 'aider',
    icon: '🛠️',
    wslBin: 'aider',
    probeArgs: ['--version'],
    callArgs: (q) => ['--message', q, '--no-git', '--yes', '--no-auto-commits'],
    outputStream: 'stdout',
    probeTimeoutMs: 15_000,
    callTimeoutMs: 240_000,
  },
];

// ─── PATH-based resolver (cross-platform, no hardcoded paths) ────────────────


/** Read the Lxss registry to enumerate installed WSL distros + the default one. */
function wslRegistryInfo(): { defaultDistro: string; distros: string[] } | null {
  if (process.platform !== 'win32') return null;
  try {
    // Primary strategy: `wsl.exe -l -v` lists distros with NUL-separated columns.
    // The default distro is marked with a leading `*`. This is more reliable
    // than `reg query` because the registry layout (nested vs flat subkeys)
    // varies between Windows 10 and Windows 11, between `reg.exe` versions,
    // and between process user contexts (sandboxed tool shells vs the dev
    // server's normal Win32 child process).
    const wslList = execSync('wsl.exe -l -v', {
      timeout: 10_000,
      encoding: 'buffer',
      windowsHide: true,
    });
    const cleaned = Buffer.from(wslList).toString('utf8').replace(/\0/g, ' ').replace(/\t/g, ' ');
    // Each line: "*  Debian  Running  2" or "   Ubuntu  Stopped  2"
    // Split on any whitespace run, drop header + empty lines.
    const lines = cleaned.split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l && !/^NAME\b/i.test(l));
    const distros: string[] = [];
    let defaultDistro = '';
    for (const line of lines) {
      // Mark default with leading '*'
      const isDefault = /^\*/.test(line);
      const tokens = line.split(/\s{2,}|\s+/).map((t) => t.trim()).filter(Boolean);
      // tokens[0] may be '*' if default; tokens[1] (or [0]) is the name.
      // Skip state (Running/Stopped) and version.
      const name = (isDefault ? tokens[1] : tokens[0]) || '';
      if (!name || /^(running|stopped|installing)$/i.test(name)) continue;
      distros.push(name);
      if (isDefault && !defaultDistro) defaultDistro = name;
    }
    if (distros.length === 0) {
      // Fallback: parse `reg query` (older Windows 10 may use the nested
      // subkey layout where each distro lives in its own UUID block).
      const out = execSync('reg query "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Lxss" /s', {
        timeout: 5_000,
        encoding: 'buffer',
        windowsHide: true,
      });
      const text = Buffer.from(out).toString('latin1');
      const uuids: string[] = [];
      const uuid2name: Record<string, string> = {};
      const blocks = text.split(/\r?\n\s*\r?\n/);
      for (const blk of blocks) {
        const uuidMatch = blk.match(/\\\\([\w-]{36})\s*$/m);
        if (!uuidMatch) continue;
        const uuid = uuidMatch[1];
        uuids.push(uuid);
        const nameMatch = blk.match(/DistributionName\s+REG_SZ\s+(.+)/);
        if (nameMatch) uuid2name[uuid] = nameMatch[1].trim();
      }
      const defaultMatch = text.match(/DefaultDistribution\s+REG_SZ\s+\{?([\w-]+)\}?/);
      if (defaultMatch) {
        const uuid = defaultMatch[1];
        defaultDistro = uuid2name[uuid] || uuid;
      }
      for (const u of uuids) {
        const n = uuid2name[u] || u;
        if (n) distros.push(n);
      }
    }
    if (distros.length === 0) return null;
    return { defaultDistro: defaultDistro || distros[0], distros };
  } catch {
    return null;
  }
}

/** Resolve the WSL distro name to invoke. Priority: WSL_DISTRO env > WSLRegistry default > "Debian". */
function wslTargetDistro(): string {
  return process.env.WSL_DISTRO || 'Debian';
}

/** Lightweight readiness check — runs `true` in the default distro. Long timeout because
 * WSL often needs 30-60s on first launch. */
function wslAvailable(): Promise<boolean> {
  if (process.platform !== 'win32') return Promise.resolve(false);
  const info = wslRegistryInfo();
  if (!info) return Promise.resolve(false);
  const distro = wslTargetDistro();
  return new Promise<boolean>((resolve) => {
    let done = false;
    const finish = (b: boolean) => { if (!done) { done = true; resolve(b); } };
    try {
      const child = spawn('wsl.exe', ['-d', distro, '--', 'true'], {
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      child.on('error', () => finish(false));
      child.on('close', (code) => finish(code === 0));
    } catch { finish(false); }
    // 45s ceiling — first WSL invocation can need that much; subsequent calls are fast.
    setTimeout(() => finish(false), 45_000);
  });
}

/** Run `bash -lc '...'` inside the configured WSL distro and capture stdout/stderr. */
function runInWsl(bashCmd: string, timeoutMs = 300_000): Promise<{ code: number; stdout: string; stderr: string }> {
  const distro = wslTargetDistro();
  // Critical: pass the bash command via stdin to avoid the Windows `wsl.exe`
  // argv parser mishandling shell metacharacters like `||`, `2>/dev/null`, `*`
  // when they appear as bare tokens. We also prepend PATH extensions so the
  // user's `~/.local/bin` and `~/.nvm/.../bin` are in PATH even when bash
  // doesn't source the user's `~/.bashrc` / `~/.profile` (which happens for
  // non-interactive non-login shells started via `wsl.exe -- bash`).
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (code: number, stdout: string, stderr: string) => {
      if (done) return;
      done = true;
      resolve({ code, stdout, stderr });
    };
    try {
      const child = spawn('wsl.exe', ['-d', distro, '--', 'bash'],
        { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
      let stdout = '';
      let stderr = '';
      const killTimer = setTimeout(() => {
        try { child.kill(); } catch {}
        finish(124, stdout, stderr);
      }, timeoutMs);
      child.stdout.on('data', (b) => { stdout += b.toString(); });
      child.stderr.on('data', (b) => { stderr += b.toString(); });
      child.on('error', (err) => { clearTimeout(killTimer); finish(1, stdout, stderr + '\nspawn: ' + err.message); });
      child.on('close', (code) => { clearTimeout(killTimer); finish(code ?? -1, stdout, stderr); });
      // Build the script: source the user's profile/bashrc FIRST so PATH is
      // populated from their environment, then PREPEND (not export-overwrite)
      // a small set of well-known user-local bin directories that npm/pip/cargo/
      // brew etc. install into but which may not be in the user's $PATH depending
      // on the distro (Debian/Ubuntu often lacks them in non-login shells).
      // Sourcing the rc files is best-effort (`|| true`) so the script never
      // aborts on a missing file.
      const script = [
        `set +e`,
        // Source the user's login shell startup files. `bash -l` would also
        // do this but it triggers a slow mesg(1) call; sourcing the files
        // ourselves keeps startup under a second.
        `[ -r "$HOME/.profile" ] && . "$HOME/.profile" 2>/dev/null || true`,
        `[ -r "$HOME/.bash_profile" ] && . "$HOME/.bash_profile" 2>/dev/null || true`,
        `[ -r "$HOME/.bashrc" ] && . "$HOME/.bashrc" 2>/dev/null || true`,
        // Prepend well-known user-local bin directories. This covers:
        //   Linux/macOS:  pip install --user, cargo, go, npm-global, etc.
        //   macOS:         /opt/homebrew/bin (Apple Silicon brew)
        //   Linux:         /usr/local/bin (system npm, pip)
        //   WSL:           /mnt/c/... (interop to host binaries)
        // We APPEND (not overwrite) the existing $PATH so anything the user
        // has set in their rc files is preserved.
        `export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$HOME/.cargo/bin:$HOME/go/bin:$HOME/.bun/bin:$HOME/Library/Python/3.12/bin:$HOME/Library/Python/3.11/bin:/opt/homebrew/bin:/usr/local/bin:/snap/bin:$PATH"`,
        bashCmd,
      ].join('\n');
      child.stdin.write(script + '\n');
      child.stdin.end();
    } catch (err) {
      finish(1, '', 'spawn: ' + (err as Error).message);
    }
  });
}

/** Try to find `bin` inside WSL PATH. Returns path or null. */
async function findOnWsl(bin: string): Promise<string | null> {
  try {
    const bashCmd = `command -v ${bin} 2>/dev/null || which ${bin} 2>/dev/null`;
    const r = await runInWsl(bashCmd, 30_000);
    if (r.code !== 0) return null;
    const first = r.stdout.split('\n').map((line) => line.trim()).find(Boolean);
    return first || null;
  } catch { return null; }
}


/** Resolve `bin` on PATH. Uses `where` (Windows) / `which` (POSIX). Returns absolute path or null. */
function findOnPath(bin: string, extras?: string[]): Promise<string | null> {
  return new Promise<string | null>((resolve) => {
    let resolved = false;
    // 1. Hard-coded extras (e.g. WorkBuddy's bundled CLI).
    if (extras) {
      for (const p of extras) {
        if (resolved) break;
        try {
          if (existsSync(p)) { resolved = true; resolve(p); return; }
        } catch { /* keep looking */ }
      }
    }
    // 2. ${BIN}_CLI_PATH env override.
    if (!resolved) {
      const envKey = bin.toUpperCase().replace(/[^A-Z0-9]/g, '_') + '_CLI_PATH';
      const envPath = process.env[envKey];
      if (envPath) {
        try {
          if (existsSync(envPath)) { resolved = true; resolve(envPath); return; }
        } catch { /* keep looking */ }
      }
    }
    // 3. PATH lookup (where / which).
    if (resolved) return;
    const cmd = process.platform === 'win32' ? 'where' : 'which';
    // On Windows, `where` may need shell:true for certain PATH configurations.
    const r = spawn(cmd, [bin], { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
    let out = '';
    r.stdout.on('data', (b) => { out += b.toString(); });
    r.on('error', () => { if (!resolved) { resolved = true; resolve(null); } });
    r.on('close', (code) => {
      if (resolved) return;
      resolved = true;
      if (code !== 0) return resolve(null);
      const first = out.split('\n').map((line) => line.trim()).find(Boolean);
      resolve(first || null);
    });
  });
}

// ─── Probe (smoke test) ───────────────────────────────────────────────────────

interface ProbeOk  { ok: true; bin: string; reason: string }
interface ProbeErr { ok: false; reason: string }

async function probeCli(adapter: CliAdapter): Promise<ProbeOk | ProbeErr> {
  const bin = await findOnPath(adapter.bin, adapter.extraProbePaths);
  if (!bin) return { ok: false, reason: `${adapter.label} not found on PATH` };

  // Default to a fast --version probe; skip if not provided.
  const args = adapter.probeArgs ?? ['--version'];
  const probeTimeout = adapter.probeTimeoutMs ?? 6_000;

  return new Promise((resolve) => {
    // WorkBuddy-style shims are Node.js scripts — launch via `node <bin> ...args`
    // On Windows, .cmd/.bat files need shell:true to spawn correctly.
    const isCmdBatch = process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin);
    const child = adapter.needsNode
      ? spawn(process.execPath, [bin, ...args], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...adapter.extraEnv } })
      : spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...adapter.extraEnv }, shell: isCmdBatch });
    let stdout = '';
    let stderr = '';
    let done = false;
    const finish = (r: ProbeOk | ProbeErr) => { if (!done) { done = true; resolve(r); } };
    const killTimer = setTimeout(() => { try { child.kill(); } catch {} finish({ ok: false, reason: `${adapter.label} probe timed out (${probeTimeout}ms)` }); }, probeTimeout);
    child.stdout.on('data', (b) => { stdout += b.toString(); });
    child.stderr.on('data', (b) => { stderr += b.toString(); });
    child.on('error', (err) => { clearTimeout(killTimer); finish({ ok: false, reason: `${adapter.label} spawn failed: ${err?.message}` }); });
    child.on('close', (code) => {
      clearTimeout(killTimer);
      const combined = (stdout + '\n' + stderr).trim();
      if (code === 0 && combined.length > 0) {
        finish({ ok: true, bin, reason: `${adapter.label} found at ${bin}` });
      } else {
        finish({ ok: false, reason: `${adapter.label} probe failed (exit=${code}, ${combined.slice(0, 120)})` });
      }
    });
  });
}

// ─── Probe cache (per-process) ────────────────────────────────────────────────

interface AdapterProbes {
  native?: ProbeOk | ProbeErr;
  wsl?: ProbeOk | ProbeErr;
}

let _probeCache: Promise<Record<string, AdapterProbes>> | null = null;
let _probeCacheAt = 0;
const PROBE_TTL_MS = 5 * 60_000; // 5 minutes — in-process TTL for probe results

// ─── Persistent on-disk provider cache ───────────────────────────────────────
//
// The very first probe (cold WSL service start, all CLIs probed concurrently)
// can take 30-60 seconds on Windows. Once we know which providers exist and
// where their binaries live, we don't need to spawn them again on every dev
// server restart — they almost never move. So we persist the probe result to
// `.hermes/llm-providers-cache.json` and reuse it across restarts.
//
// Validation on load (cheap, all synchronous):
//   1. File parses as JSON with `version: 1` and an array of providers.
//   2. `lastUpdated` is within DISK_TTL_MS (default 144 hours / 6 days).
//   3. Every cached `bin` path still exists on disk (existsSync). If a binary
//      was uninstalled/moved, that entry is treated as stale and discarded;
//      the remaining entries still load and a full re-probe runs to refresh
//      the missing one.
//
// If validation passes, `probeAll()` returns the cached results without
// spawning any subprocess — turning what was a 30-60s UI freeze into a
// sub-millisecond read.
//
// On any call that fails through `generateText` (CLI returned non-zero, timed
// out, etc.) the caller can pass `markStale: true` to drop that one entry
// from the on-disk cache so the next `inspectProviders()` re-probes it.

// Cache file lives in the OS temp dir (/tmp on Linux) so that writing it
// during an eval run does NOT trigger webpack's file watcher → no HMR /
// page refresh / CSS flash. The project's .hermes/ dir is still used for
// db-config.json (written rarely, only on DB path change).
const _CACHE_DIR = join(tmpdir(), 'pdb-tracker-cache');
try { mkdirSync(_CACHE_DIR, { recursive: true }); } catch { /* ignore */ }
const DISK_CACHE_FILE = join(_CACHE_DIR, 'llm-providers-cache.json');
const DISK_CACHE_VERSION = 1;
const DISK_TTL_MS = 144 * 60 * 60_000; // 144 hours (6 days)

interface CachedProvider {
  id: string;           // 'cli:hermes'
  via: 'native' | 'wsl';
  bin: string | null;   // absolute path or null if not available
  available: boolean;
  reason: string;
  binMtime?: number;    // seconds since epoch; used for additional freshness check
}
interface ProviderCache {
  version: number;
  lastUpdated: string;  // ISO 8601
  providers: CachedProvider[];
}

function readDiskCache(): ProviderCache | null {
  try {
    const text = readFileSync(DISK_CACHE_FILE, 'utf8');
    const parsed = JSON.parse(text) as ProviderCache;
    if (parsed.version !== DISK_CACHE_VERSION) return null;
    if (!Array.isArray(parsed.providers) || !parsed.lastUpdated) return null;
    const ageMs = Date.now() - new Date(parsed.lastUpdated).getTime();
    if (ageMs > DISK_TTL_MS) return null;
    // Validate that each cached `bin` still exists on disk. If any are gone,
    // we invalidate the entire cache (the missing binary may have been
    // re-installed in a new location, and we don't want to misleadingly say
    // it's unavailable when in fact we just don't know).
    for (const p of parsed.providers) {
      if (p.available && p.bin && !existsSync(p.bin)) return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeDiskCache(probes: Record<string, AdapterProbes>): void {
  try {
    const providers: CachedProvider[] = [];
    for (const a of CLI_ADAPTERS) {
      const pair = probes[a.id];
      if (!pair) continue;
      for (const via of ['native', 'wsl'] as const) {
        const p = pair[via];
        if (!p) continue;
        let binMtime: number | undefined;
        if (p.ok && p.bin) {
          try {
            binMtime = statSync(p.bin).mtimeMs / 1000;
          } catch { /* binary disappeared between probe and write — skip */ }
        }
        providers.push({
          id: a.id,
          via,
          bin: p.ok ? p.bin : null,
          available: p.ok,
          reason: p.reason,
          binMtime,
        });
      }
    }
    const cache: ProviderCache = {
      version: DISK_CACHE_VERSION,
      lastUpdated: new Date().toISOString(),
      providers,
    };
    writeFileSync(DISK_CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (err) {
    // Persistence is best-effort — never crash a probe because we couldn't write.
    console.warn('[llm] failed to write provider cache:', (err as Error).message);
  }
}

/** Drop the entire on-disk cache. Called by clearLlmProbeCache and /api/llm/refresh. */
function clearDiskCache(): void {
  try { unlinkSync(DISK_CACHE_FILE); } catch { /* file didn't exist */ }
}

/**
 * Drop a single provider entry from the on-disk cache. Useful when a CLI is
 * detected at startup but fails at first use (binary deleted, path changed,
 * auth expired). The next inspectProviders() will re-probe just that entry.
 */
function markProviderStale(adapterId: string, via: 'native' | 'wsl'): void {
  const cache = readDiskCache();
  if (!cache) return;
  const before = cache.providers.length;
  cache.providers = cache.providers.filter((p) => !(p.id === adapterId && p.via === via));
  if (cache.providers.length === before) return;
  try {
    cache.lastUpdated = new Date().toISOString();
    writeFileSync(DISK_CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch { /* best-effort */ }
}

function probeAll(force = false): Promise<Record<string, AdapterProbes>> {
  const ageOk = Date.now() - _probeCacheAt < PROBE_TTL_MS;
  if (_probeCache && ageOk && !force) return _probeCache;
  if (_probeCache && force) _probeCache = null;
  _probeCache = (async () => {
    // Fast path: a fresh on-disk cache exists. Skip spawning any subprocess.
    if (!force) {
      const disk = readDiskCache();
      if (disk) {
        const out: Record<string, AdapterProbes> = {};
        for (const p of disk.providers) {
          if (!out[p.id]) out[p.id] = {};
          out[p.id][p.via] = p.available
            ? { ok: true, bin: p.bin!, reason: p.reason }
            : { ok: false, reason: p.reason };
        }
        // Fill in any adapters the cache didn't have (e.g. a new CLI was added
        // since the cache was written). Don't spawn probes for them either —
        // just leave them missing from the result so inspectProviders reports
        // them as unavailable rather than running an unsolicited 60s probe.
        return out;
      }
    }
    // Kick off WSL check in the background. Native probes return immediately so the UI is
    // responsive; WSL entries appear later when the readiness probe + per-CLI probes finish.
    const out: Record<string, AdapterProbes> = {};
    // Native probes always run first (fast — typically <1s).
    await Promise.all(CLI_ADAPTERS.map(async (a) => {
      out[a.id] = { native: await probeCli(a) };
    }));
    // Now wait for WSL readiness (long, up to 45s on first launch).
    if (process.platform === 'win32') {
      const wsl = await wslAvailable();
      if (wsl) {
        const wslResults = await Promise.all(
          CLI_ADAPTERS.map((a) => probeCliInWsl(a).then((r) => ({ id: a.id, r })))
        );
        for (const { id, r } of wslResults) {
          out[id] = { ...(out[id] ?? {}), wsl: r };
        }
      }
    }
    writeDiskCache(out);
    _probeCacheAt = Date.now();
    return out;
  })();
  return _probeCache;
}

/** Run the same probe as `probeCli` but inside WSL bash. */
async function probeCliInWsl(adapter: CliAdapter): Promise<ProbeOk | ProbeErr> {
  const wslBin = adapter.wslBin ?? adapter.bin;
  // Pre-check whether the binary exists in WSL PATH first (avoids spawning failing commands).
  const wslPath = await findOnWsl(wslBin);
  if (!wslPath) return { ok: false, reason: `${adapter.label} not found inside WSL` };
  const args = adapter.probeArgs ?? ['--version'];
  const bashCmd = `${wslBin} ${args.map((a) => JSON.stringify(a)).join(' ')}`;
  const probeTimeout = adapter.probeTimeoutMs ?? 6_000;
  try {
    // Use GNU `timeout` (always in WSL) to hard-cap the probe; and `command -v` already
    // confirmed the binary exists. code === 124 from GNU timeout counts as success when
    // there is any output (some CLIs print version then wait).
    const r = await runInWsl(`timeout ${Math.ceil(probeTimeout / 1000)} ${bashCmd} 2>&1`, probeTimeout + 30_000);
    const combined = (r.stdout + '\n' + r.stderr).trim();
    if ((r.code === 0 || r.code === 124) && combined.length > 0) {
      return { ok: true, bin: wslPath, reason: `${adapter.label} found in WSL at ${wslPath}` };
    }
    return { ok: false, reason: `${adapter.label} WSL probe failed (exit=${r.code}, ${combined.slice(0, 120)})` };
  } catch (err: any) {
    return { ok: false, reason: `${adapter.label} WSL probe error: ${err?.message}` };
  }
}

// Allow callers (tests or admin endpoints) to force-refresh.
export function clearLlmProbeCache(): void {
  _probeCache = null;
  _probeCacheAt = 0;
  clearDiskCache();
}

/**
 * Mark a single provider entry as stale in the on-disk cache (does not clear
 * the in-process _probeCache). Next call to inspectProviders() will re-probe
 * just this adapter. Useful when generateText fails at first use — the CLI
 * may have been moved, uninstalled, or auth may have expired, and we want
 * the next UI visit to refresh the entry without dropping the other cached
 * providers.
 */
export function markLlmProviderStale(adapterId: string, via: 'native' | 'wsl'): void {
  markProviderStale(adapterId, via);
}

// ─── Provider enumeration (for the front-end settings panel) ──────────────────

export interface InspectProvidersOptions {
  /** When true, include `available: false` entries so the UI can show them dim. Default false. */
  showUnavailable?: boolean;
  /** Optional list of provider ids the user has whitelisted (others hidden). */
  whitelist?: string[];
}

export async function inspectProviders(opts: InspectProvidersOptions = {}): Promise<{
  chosen: string;
  available: LlmProviderInfo[];
  totalClisScanned: number;
}> {
  const probes = await probeAll();
  const available: LlmProviderInfo[] = [];

  let totalClisScanned = 0;
  for (const a of CLI_ADAPTERS) {
    totalClisScanned++;
    const probePair = probes[a.id] ?? {};
    if (probePair.native?.ok) {
      available.push({
        provider: `cli:${a.id}`,
        bin: probePair.native.bin,
        icon: a.icon,
        label: a.label,
        reason: probePair.native.reason,
        available: true,
        via: 'native',
      });
    }
    if (probePair.wsl?.ok) {
      // Use a different provider id so the user can pick native vs wsl explicitly.
      available.push({
        provider: `cli:${a.id}`,
        bin: probePair.wsl.bin,
        icon: a.icon,
        label: `${a.label} (WSL)`,
        reason: probePair.wsl.reason,
        available: true,
        via: 'wsl',
      });
    }
    if (!probePair.native?.ok && !probePair.wsl?.ok) {
      const why = probePair.native?.reason || probePair.wsl?.reason || `${a.label} not found`;
      // Surface a single 'unavailable' entry (the UI can render it dim).
      available.push({
        provider: `cli:${a.id}`,
        bin: null,
        icon: a.icon,
        label: a.label,
        reason: why,
        available: false,
        via: 'native',
      });
    }
  }

  // Anthropic SDK
  const anthropicAvailable = !!process.env.ANTHROPIC_API_KEY;
  available.push({
    provider: 'anthropic',
    bin: null,
    icon: '🤖',
    iconUrl: null,
    label: 'Anthropic SDK',
    reason: anthropicAvailable ? 'ANTHROPIC_API_KEY is set' : 'ANTHROPIC_API_KEY not set',
    available: anthropicAvailable,
    via: 'sdk',
  });

  const openaiAvailable = !!process.env.OPENAI_API_KEY;
  available.push({
    provider: 'openai',
    bin: null,
    icon: '🧠',
    iconUrl: null,
    label: 'OpenAI SDK',
    reason: openaiAvailable ? 'OPENAI_API_KEY is set' : 'OPENAI_API_KEY not set',
    available: openaiAvailable,
    via: 'sdk',
  });

  const chosen = available.find((p) => p.available)?.provider || 'cli:hermes';
  // Apply visibility filters for the front-end.
  const showAll = !!opts.showUnavailable;
  const wl = opts.whitelist && opts.whitelist.length > 0 ? new Set(opts.whitelist) : null;

  // Resolve brand icons in parallel for available entries.
  const iconPromises = available.map((p) => {
    if (!p.available) return Promise.resolve(p);
    return resolveIconFor(p.provider.replace(/^cli:/, ''), p.bin).then((iconUrl) => ({ ...p, iconUrl }));
  });
  const withIcons = await Promise.all(iconPromises);

  const filtered = withIcons.filter((p) => {
    if (wl && !wl.has(p.provider)) return false;
    if (!showAll && !p.available) return false;
    return true;
  });
  return { chosen, available: filtered, totalClisScanned };
}

export function resolveLlmConfig(overrides?: LlmConfig): LlmConfig & { resolvedProvider: string } {
  const envProvider = process.env.LLM_PROVIDER || '';
  const provider = (overrides?.provider || envProvider || '').trim() || 'auto';
  const model = (overrides?.model || process.env.LLM_MODEL || '').trim() || undefined;
  return { ...overrides, provider, model, resolvedProvider: provider };
}

// ─── High-level text-in / text-out ────────────────────────────────────────────

export async function generateText(
  systemPrompt: string,
  userPrompt: string,
  opts: { maxChars?: number; llm?: LlmConfig } = {},
): Promise<LlmResult> {
  const t0 = Date.now();
  const maxChars = opts.maxChars ?? 4000;
  const cfg = resolveLlmConfig(opts.llm);
  const r = await callAnyLlm(userPrompt, { ...cfg, system: cfg.system || systemPrompt });
  if (r.ok) {
    const content = (r.content || '').slice(0, maxChars);
    return {
      ok: true,
      content,
      text: content,
      provider: r.provider,
      model: r.model,
      durationMs: Date.now() - t0,
      fallback: false,
      meta: r.meta,
    };
  }
  return {
    ok: false,
    content: '',
    text: '',
    provider: r.provider,
    model: r.model,
    durationMs: Date.now() - t0,
    fallback: false,
    error: r.error,
  };
}

/** Per-paper one-line digest (used by module ①). */
export async function generatePaperDigest(title: string, pmid: string): Promise<LlmResult> {
  return generateText(
    '你是结构生物学领域的资深研究员。请用一句中文（不超过 40 字）概括这篇论文的核心发现，要求准确、简洁、专业。',
    `论文标题：${title}\nPMID: ${pmid}`,
    { maxChars: 120 },
  );
}

// ─── Core dispatch with fallback ──────────────────────────────────────────────

async function callAnyLlm(
  prompt: string,
  cfg: LlmConfig & { resolvedProvider: string; system: string },
): Promise<LlmResult> {
  const probes = await probeAll();
  const order = decideProviderOrder(cfg.resolvedProvider, cfg.model);

  const errors: string[] = [];
  for (const item of order) {
    const id = item.id;
    const via = item.via;
    if (id.startsWith('cli:')) {
      const adapter = CLI_ADAPTERS.find((a) => `cli:${a.id}` === id);
      if (!adapter) continue;
      const probePair = probes[adapter.id] ?? {};
      const probe = via === 'wsl' ? probePair.wsl : probePair.native;
      if (!probe?.ok) {
        errors.push(`${id}${via ? `(${via})` : ''}: ${probe?.reason ?? 'unavailable'}`);
        continue;
      }
      try {
        const t0 = Date.now();
        const text = via === 'wsl'
          ? await runCliInWsl(adapter, probe.bin, prompt, cfg.model)
          : await runCli(adapter, probe.bin, prompt, cfg.model);
        return {
          ok: true,
          content: text,
          text,
          provider: id,
          model: cfg.model || adapter.id,
          durationMs: Date.now() - t0,
          fallback: item.fallback,
          meta: { cli: probe.bin, via: via ?? 'native' },
        };
      } catch (err: any) {
        // ★ Fallback to the next provider on failure.
        errors.push(`${id}${via ? `(${via})` : ''}: ${err?.message ?? String(err)}`);
        // The cached probe said this CLI is available, but the actual call
        // failed — most likely the binary was uninstalled/moved or auth
        // expired. Drop just this entry from the on-disk cache so the next
        // inspectProviders() call will re-probe it, without disturbing the
        // other cached providers.
        if (via) {
          try { markLlmProviderStale(adapter.id, via); } catch { /* best-effort */ }
        }
        continue;
      }
    }
    if (id === 'anthropic') {
      if (!process.env.ANTHROPIC_API_KEY) { errors.push('anthropic: ANTHROPIC_API_KEY not set'); continue; }
      try {
        const t0 = Date.now();
        const text = await callAnthropic(prompt, cfg.system, cfg.model);
        return {
          ok: true,
          content: text,
          text,
          provider: id,
          model: cfg.model || 'claude-3-5-sonnet-latest',
          durationMs: Date.now() - t0,
          fallback: false,
        };
      } catch (err: any) {
        errors.push(`anthropic: ${err?.message ?? String(err)}`);
        continue;
      }
    }
    if (id === 'openai') {
      if (!process.env.OPENAI_API_KEY) { errors.push('openai: OPENAI_API_KEY not set'); continue; }
      try {
        const t0 = Date.now();
        const text = await callOpenai(prompt, cfg.system, cfg.model);
        return {
          ok: true,
          content: text,
          text,
          provider: id,
          model: cfg.model || 'gpt-4o-mini',
          durationMs: Date.now() - t0,
          fallback: false,
        };
      } catch (err: any) {
        errors.push(`openai: ${err?.message ?? String(err)}`);
        continue;
      }
    }
    // ── z.ai SDK (independent branch, no API key needed) ──
    if (id === 'zai') {
      try {
        const t0 = Date.now();
        const text = await callZai(prompt, cfg.system, cfg.model);
        return {
          ok: true,
          content: text,
          text,
          provider: id,
          model: cfg.model || 'glm-4.6',
          durationMs: Date.now() - t0,
          fallback: item.fallback,
        };
      } catch (err: any) {
        errors.push(`zai: ${err?.message ?? String(err)}`);
        continue;
      }
    }
  }

  return {
    ok: false,
    content: '',
    text: '',
    provider: cfg.resolvedProvider,
    model: cfg.model || '',
    durationMs: 0,
    fallback: false,
    error: `No LLM provider succeeded. Tried ${order.length} candidate(s): ${errors.join('; ')}`,
  };
}

interface OrderedProvider {
  id: string;
  via?: 'native' | 'wsl';
  /** True when not the user-requested provider (i.e. fallback). */
  fallback: boolean;
}

function decideProviderOrder(requested: string, _model?: string): OrderedProvider[] {
  // Auto order: native CLI first, then WSL CLI mirrors, then SDK fallbacks.
  const cliIds = CLI_ADAPTERS.map((a) => `cli:${a.id}`);
  const auto: OrderedProvider[] = [];
  for (const id of cliIds) auto.push({ id, via: 'native', fallback: requested !== id });
  for (const id of cliIds) auto.push({ id, via: 'wsl', fallback: requested !== id });
  auto.push({ id: 'anthropic', fallback: true });
  auto.push({ id: 'openai', fallback: true });
  // z.ai SDK — always available as a fallback candidate (independent of CLI/SDK agents)
  auto.push({ id: 'zai', fallback: requested !== 'zai' });

  if (!requested || requested === 'auto') {
    return auto.map((p) => ({ ...p, fallback: false }));
  }
  // Promote requested to first.
  const requestedProvider = auto.find((p) => p.id === requested);
  const rest = auto.filter((p) => p.id !== requested);
  return [{ ...(requestedProvider ?? { id: requested, fallback: false }), fallback: false }, ...rest];
}

// ─── CLI subprocess runner ────────────────────────────────────────────────────

/**
 * Compute per-call timeout. Hermes specifically scales with prompt size — a 10k-char
 * full report takes ~5-10 minutes; a short query returns in ~30s. We choose the larger
 * of the adapter default and `60s + 30ms-per-char` heuristic.
 */
function computeCliTimeoutMs(adapter: CliAdapter, prompt: string): number {
  const base = adapter.callTimeoutMs ?? 240_000;
  const heuristic = 60_000 + prompt.length * 30;
  return Math.max(base, heuristic);
}

function runCli(adapter: CliAdapter, bin: string, prompt: string, model: string | undefined): Promise<string> {
  const rawArgs = adapter.callArgs(prompt, model);
  const timeoutMs = computeCliTimeoutMs(adapter, prompt);
  // If the adapter declares an `outputFile`, the CLI writes its final
  // response to a file we control. Pre-create a unique temp file and
  // substitute the literal `$OUTPUT_FILE` token in args with its path.
  // The temp file is deleted in `finally` regardless of outcome.
  let outputFilePath: string | null = null;
  let args = rawArgs;
  if (adapter.outputFile) {
    const ext = adapter.id === 'codex' ? '.md' : '.txt';
    outputFilePath = join(tmpdir(), `pdb-llm-${adapter.id}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
    // Pre-touch the file so the CLI doesn't fail with ENOENT on some shells
    try { writeFileSync(outputFilePath, ''); } catch { /* best-effort */ }
    args = rawArgs.map((a) => a === '$OUTPUT_FILE' ? outputFilePath! : a);
  }

  return new Promise<string>((resolve, reject) => {
    // WorkBuddy-style shims are Node.js scripts — invoke via `node <bin> ...args`.
    // On Windows, CLI tools installed via npm are typically .cmd wrappers —
    // spawn() with shell:false cannot execute .cmd files, so we set shell:true
    // when the bin path ends with .cmd or .bat (Windows-only).
    const isCmdBatch = process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin);
    const child = adapter.needsNode
      ? spawn(process.execPath, [bin, ...args], {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, ...adapter.extraEnv },
        })
      : spawn(bin, args, {
          stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, ...adapter.extraEnv },
          shell: isCmdBatch,
        });

    let stdout = '';
    let stderr = '';
    const killTimer = setTimeout(() => {
      try { child.kill(); } catch {}
      reject(new Error(`${adapter.id} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (b) => { stdout += b.toString(); });
    child.stderr.on('data', (b) => { stderr += b.toString(); });

    child.on('error', (err) => {
      clearTimeout(killTimer);
      cleanup();
      reject(new Error(`${adapter.id} spawn error: ${err?.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(killTimer);
      // Prefer the file contents if we asked for an outputFile and it
      // was actually written. Fall back to stdout/stderr parsing.
      let cleaned = '';
      if (outputFilePath) {
        try {
          const fileContent = readFileSync(outputFilePath, 'utf8');
          if (fileContent.trim().length > 0) {
            cleaned = fileContent;
          }
        } catch { /* fall through */ }
      }
      if (!cleaned) {
        const raw = adapter.outputStream === 'stdout' ? stdout
                  : adapter.outputStream === 'stderr' ? stderr
                  : (stdout.trim() + (stderr.includes('\n') ? '\n' : '') + stderr).trim();
        cleaned = adapter.stripBanner ? adapter.stripBanner(raw) : raw.trim();
      }
      cleanup();
      if (cleaned.length > 0) {
        resolve(cleaned);
        return;
      }
      reject(new Error(`${adapter.id} returned empty output (exit=${code}, stderr=${stderr.slice(0, 300)})`));
    });

    function cleanup() {
      if (outputFilePath) {
        try { unlinkSync(outputFilePath); } catch { /* best-effort */ }
        outputFilePath = null;
      }
    }
  });
}

function runCliInWsl(adapter: CliAdapter, wslBin: string, prompt: string, model: string | undefined): Promise<string> {
  // Build a single bash command string that runs the CLI with the same args,
  // then trim the trailing "session_id: ..." banner on stderr if needed.
  const args = adapter.callArgs(prompt, model);
  const escaped = args.map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(' ');
  const timeoutSec = Math.max(1, Math.ceil((adapter.callTimeoutMs ?? 240_000) / 1000));
  // Use `timeout` (coreutils) to hard-cap total wall time inside WSL.
  const bashCmd = `timeout ${timeoutSec} ${wslBin} ${escaped} 2>&1`;

  // Match the host-side heuristic so WSL mirrors the same scaling.
  const totalTimeout = computeCliTimeoutMs(adapter, prompt) + 15_000;
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const child = spawn('wsl.exe', ['-e', 'bash', '-lc', bashCmd], { stdio: ['ignore', 'pipe', 'pipe'] });
    const killTimer = setTimeout(() => {
      try { child.kill(); } catch {}
      reject(new Error(`${adapter.id} WSL timed out after ${totalTimeout}ms`));
    }, totalTimeout);
    child.stdout.on('data', (b) => { stdout += b.toString(); });
    child.stderr.on('data', (b) => { stderr += b.toString(); });
    child.on('error', (err) => { clearTimeout(killTimer); reject(new Error(`${adapter.id} WSL spawn error: ${err?.message}`)); });
    child.on('close', (code) => {
      clearTimeout(killTimer);
      const raw = (stdout + (stderr ? '\n' + stderr : '')).trim();
      const cleaned = adapter.stripBanner ? adapter.stripBanner(raw) : raw.trim();
      // code === 124 → `timeout` killed it (still might have partial output)
      if (cleaned.length > 0) { resolve(cleaned); return; }
      reject(new Error(`${adapter.id} WSL returned empty output (exit=${code}, stderr=${stderr.slice(0, 300)})`));
    });
  });
}

// ─── SDK providers ────────────────────────────────────────────────────────────

async function callAnthropic(prompt: string, system?: string, model?: string): Promise<string> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const client = new Anthropic({ apiKey });
  const resp = await client.messages.create({
    model: model || 'claude-3-5-sonnet-latest',
    max_tokens: 4096,
    system: system || 'You are a helpful assistant.',
    messages: [{ role: 'user', content: prompt }],
  });
  const block = resp.content?.[0];
  return (block && block.type === 'text' ? block.text : '') || '';
}

async function callOpenai(prompt: string, system?: string, model?: string): Promise<string> {
  const OpenAI = (await import('openai')).default;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');
  const client = new OpenAI({ apiKey });
  const resp = await client.chat.completions.create({
    model: model || 'gpt-4o-mini',
    messages: [
      ...(system ? [{ role: 'system' as const, content: system }] : []),
      { role: 'user' as const, content: prompt },
    ],
  });
  return resp.choices?.[0]?.message?.content || '';
}

/**
 * z.ai SDK — independent LLM provider using z-ai-web-dev-sdk.
 *
 * This is a SEPARATE branch that does NOT touch the existing CLI/SDK agent
 * discovery or call logic. It uses the built-in z-ai-web-dev-sdk to call
 * GLM models. No API key configuration needed — the SDK handles auth
 * internally. Intended for temporary LLM testing.
 */
async function callZai(prompt: string, system?: string, model?: string): Promise<string> {
  const ZAI = (await import('z-ai-web-dev-sdk')).default;
  const zai = await ZAI.create();
  const resp = await zai.chat.completions.create({
    model: model || 'glm-4.6',
    messages: [
      ...(system ? [{ role: 'system' as const, content: system }] : []),
      { role: 'user' as const, content: prompt }],
    thinking: { type: 'disabled' as const },
  });
  return resp.choices?.[0]?.message?.content || '';
}

// ─── llmComplete (legacy interface used by pdb-weekly/literature-daily/target-eval) ─

export async function llmComplete(prompt: string, cfg?: LlmConfig): Promise<LlmResult> {
  const t0 = Date.now();
  const resolved = resolveLlmConfig(cfg);
  const r = await callAnyLlm(prompt, { ...resolved, system: resolved.system || '' });
  return { ...r, durationMs: r.durationMs || (Date.now() - t0) };
}

// Cache: providerId -> absolute icon path on disk (or null)
let _iconCache: Record<string, string | null> = {};
export function clearLlmIconCache(): void { _iconCache = {}; }
export async function resolveIconFor(id: string, binPath: string | null): Promise<string | null> {
  if (id in _iconCache) return _iconCache[id];
  if (!binPath) { _iconCache[id] = null; return null; }
  const path = await import('node:path');
  const binDir = path.dirname(binPath);
  const icon = await findBrandIcon(binDir, id, brandTokensFor(id));
  _iconCache[id] = icon;
  return icon;
}
