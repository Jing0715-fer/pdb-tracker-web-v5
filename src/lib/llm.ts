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

// ─── Shared cache dir (defined early, used by session registry + provider cache) ──
const _CACHE_DIR = join(tmpdir(), 'pdb-tracker-cache');
try { mkdirSync(_CACHE_DIR, { recursive: true }); } catch { /* ignore */ }

// ─── Public types ─────────────────────────────────────────────────────────────

export interface LlmConfig {
  /** One of: 'cli:hermes' | 'cli:claude' | 'cli:codex' | 'cli:openclaw' | 'cli:gemini' | 'cli:aider' | 'anthropic' | 'openai' | '' (auto) */
  provider?: string;
  model?: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
  /** Round 54: Session ID for CLI agents that support session reuse.
   *  When set, all calls with the same sessionId share context. */
  sessionId?: string;
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
  /**
   * Round 59: Setup hint shown when the CLI binary exists but is not configured
   * (e.g. hermes is installed but no model is set up). The UI can render this
   * as a warning badge or tooltip next to the provider entry.
   */
  configHint?: string;
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
  /**
   * Round 59: Optional deeper probe that checks if the CLI is not just installed
   * but also CONFIGURED (e.g. hermes needs a model/provider set up before it
   * can generate text). When defined, probeCli runs this AFTER the basic
   * probeArgs check passes. If it returns a non-empty string, that string is
   * used as the `configHint` in the provider info — the UI can display it as
   * a setup hint. The provider is still marked `available: true` (the binary
   * exists), but the hint tells the user they need to configure it.
   *
   * The config probe should be FAST (< 3s) and must not make a real LLM call.
   * For hermes: run `hermes -z "test" --cli` and check if the output contains
   * "No inference provider configured".
   */
  configProbe?: { args: string[]; timeoutMs?: number; checkOutput: (stdout: string, stderr: string) => string | null };
  /** Round 54: Optional session ID for CLI agents that support session reuse.
   *  When set, the CLI adapter should use `--session <id>` (or equivalent)
   *  so multiple calls within the same report share context. */
  sessionId?: string;
  /** Real-call args template. */
  callArgs: (prompt: string, model: string | undefined, sessionId?: string) => string[];
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
  /**
   * Round 56: Optional parser that extracts the actual CLI-side session ID
   * from the raw output of the FIRST call (the "create session" call).
   * When defined, runCli/runCliInWsl will:
   *   1. Before the first call: check SESSION_REGISTRY for a captured ID.
   *      If found, pass `resume:<capturedId>` to callArgs so the adapter
   *      switches to "resume session" mode.
   *   2. After the first call: call parseSessionId(raw) to extract the
   *      actual CLI session ID and store it in SESSION_REGISTRY so
   *      subsequent calls with the same logical sessionId can resume.
   *
   * This fixes the bug where hermes/codex created a NEW session on every
   * chapter call even though the caller passed a stable logical sessionId.
   */
  parseSessionId?: (rawOutput: string) => string | null;
}

const HERMES_BANNER_RE = /(?:^|\n)\s*session[_ ]?id["\']?\s*[:=]\s*\S+\s*(?=\n|$)/i;  // Round 60: also match Session ID: and JSON
/** Round 56/60: Extract the actual hermes session ID printed by `hermes chat -q -Q`.
 *  Hermes prints `session_id: <uuid>` on its own line (mixed in stdout/stderr).
 *  Round 60: Also match "Session ID:" (capitalized, with space) and JSON-style
 *  "session_id":"<uuid>" in case hermes changes its output format. */
const HERMES_SESSION_ID_RE = /session[_ ]?id["\']?\s*[:=]\s*["\']?([A-Za-z0-9_\-]{8,})/i;  // Round 60: match session_id:, Session ID:, session_id=, JSON
function parseHermesSessionId(raw: string): string | null {
  const m = raw.match(HERMES_SESSION_ID_RE);
  return m ? m[1] : null;
}
/** Round 56: Extract codex session ID. Codex prints `session_id: <uuid>` or
 *  `Session ID: <uuid>` or logs it as a JSON field after exec. */
const CODEX_SESSION_ID_RE = /(?:session_id|Session ID|sid)["']?\s*[:=]\s*["']?([A-Za-z0-9_\-]{8,})/i;
function parseCodexSessionId(raw: string): string | null {
  const m = raw.match(CODEX_SESSION_ID_RE);
  return m ? m[1] : null;
}

/**
 * Round 56: In-memory session registry.
 * Maps logical sessionId (caller-supplied, e.g. "eval-P68871-1234567890") to
 * a per-provider map of actual CLI session IDs captured from the first call.
 *
 * Structure: logicalSid → providerId → actualCliSessionId
 *
 * When a caller passes `sessionId = "eval-P68871-1234567890"` and the hermes
 * adapter has `parseSessionId` defined:
 *   - First call: registry miss → hermes runs with `--pass-session-id` →
 *     output contains `session_id: abc-123` → we store
 *     "eval-P68871-1234567890" → "hermes" → "abc-123"
 *   - Second call: registry hit → we pass `resume:abc-123` to callArgs →
 *     hermes runs with `--resume abc-123` → reuses the same session context
 *
 * This is critical for chapter-mode report generation where 8-9 chapters
 * need to share context. Without it, each chapter starts a fresh hermes
 * session and the LLM re-reads the full system prompt every time (slow +
 * loses cross-chapter context).
 *
 * Round 59: The registry is persisted to disk (JSON file in the OS temp dir)
 * so it survives dev server restarts. This is important for long-running
 * report generation jobs that may span multiple HMR cycles. The file is
 * written debounced (max once per 2s) to avoid I/O overhead.
 */
const SESSION_REGISTRY = new Map<string, Map<string, string>>();
const SESSION_REGISTRY_FILE = join(_CACHE_DIR, 'session-registry.json');
let _sessionRegistryDirty = false;
let _sessionRegistryWriteTimer: ReturnType<typeof setTimeout> | null = null;

/** Load the session registry from disk on startup. */
function loadSessionRegistry(): void {
  try {
    const text = readFileSync(SESSION_REGISTRY_FILE, 'utf8');
    const parsed = JSON.parse(text) as Record<string, Record<string, string>>;
    for (const [logicalSid, providers] of Object.entries(parsed)) {
      const inner = new Map<string, string>();
      for (const [providerId, cliSid] of Object.entries(providers)) {
        inner.set(providerId, cliSid);
      }
      SESSION_REGISTRY.set(logicalSid, inner);
    }
  } catch { /* file doesn't exist or is invalid — start fresh */ }
}

/** Persist the session registry to disk (debounced). */
function persistSessionRegistry(): void {
  _sessionRegistryDirty = true;
  if (_sessionRegistryWriteTimer) return; // already scheduled
  _sessionRegistryWriteTimer = setTimeout(() => {
    _sessionRegistryWriteTimer = null;
    if (!_sessionRegistryDirty) return;
    _sessionRegistryDirty = false;
    try {
      const obj: Record<string, Record<string, string>> = {};
      for (const [logicalSid, inner] of SESSION_REGISTRY) {
        obj[logicalSid] = Object.fromEntries(inner);
      }
      writeFileSync(SESSION_REGISTRY_FILE, JSON.stringify(obj, null, 2));
    } catch { /* best-effort persistence */ }
  }, 2000);
}

// Load on module init
loadSessionRegistry();

/** Test-visible: clear the session registry (used by unit tests + dev reset). */
export function _clearSessionRegistry(): void {
  SESSION_REGISTRY.clear();
  try { unlinkSync(SESSION_REGISTRY_FILE); } catch { /* file didn't exist */ }
}

/** Resolve a logical sessionId to an effective sid for callArgs.
 *  Returns `resume:<actualCliSid>` if the registry has a captured ID for
 *  this (logicalSid, providerId) pair; otherwise returns the logicalSid
 *  unchanged (first call). */
function resolveSessionId(providerId: string, logicalSid: string | undefined): string | undefined {
  if (!logicalSid) return undefined;
  const inner = SESSION_REGISTRY.get(logicalSid);
  if (!inner) return logicalSid;
  const captured = inner.get(providerId);
  return captured ? `resume:${captured}` : logicalSid;
}

/** Store a captured CLI session ID in the registry (and persist to disk). */
function storeCapturedSession(providerId: string, logicalSid: string, cliSid: string): void {
  if (!logicalSid || !cliSid) return;
  let inner = SESSION_REGISTRY.get(logicalSid);
  if (!inner) {
    inner = new Map();
    SESSION_REGISTRY.set(logicalSid, inner);
  }
  inner.set(providerId, cliSid);
  persistSessionRegistry(); // Round 59: persist to disk
}

/**
 * Round 58: Detect CLI error messages that are printed to stdout/stderr as
 * content. Some CLIs (notably hermes) exit 0 but print an error message like
 * "agent failed: No inference provider configured" to stdout. Without this
 * check, the error message is treated as valid LLM output and the fallback
 * chain never fires.
 *
 * Known error patterns:
 *   - "agent failed:" (hermes — no model configured)
 *   - "Error:" / "error:" (generic CLI errors)
 *   - "No inference provider configured" (hermes)
 *   - "Run 'hermes model' to" (hermes setup hint)
 *   - "authentication required" / "not authenticated" (codex, claude)
 *   - "rate limit" / "429" (handled separately by retry logic, but catch stragglers)
 *
 * Returns true if the content looks like a CLI error message rather than
 * real LLM output. Conservative — only matches when the FIRST 300 chars are
 * dominated by error keywords, so real content that happens to mention "error"
 * won't be falsely flagged.
 */
function isCliErrorMessage(content: string, adapterId: string): boolean {
  if (!content || content.length === 0) return false;
  // Only check the first 300 chars — if the error is there, it's a CLI error.
  // Real LLM output rarely starts with an error message.
  const head = content.slice(0, 300).toLowerCase();
  // Hermes-specific patterns
  if (adapterId === 'hermes') {
    if (/agent failed:/.test(head)) return true;
    if (/no inference provider configured/.test(head)) return true;
    if (/run 'hermes model' to/.test(head)) return true;
    if (/hermes -z:/.test(head)) return true; // hermes echoes its own command on error
  }
  // Generic patterns — only flag if the content is SHORT (real reports are 1000+ chars)
  // AND starts with the error keyword.
  if (content.length < 500) {
    if (/^(error|failed|fatal|exception|traceback)[:\s]/i.test(head)) return true;
    if (/(not authenticated|authentication required|login required)/i.test(head)) return true;
    if (/command not found|no such file|permission denied/i.test(head)) return true;
  }
  return false;
}

const CLI_ADAPTERS: CliAdapter[] = [
  {
    id: 'hermes',
    label: 'Hermes CLI',
    bin: 'hermes',
    icon: '🪶',
    wslBin: 'hermes',
    // Round 55: Hermes AI CLI is installed to ~/.local/bin/hermes by the
    // install script from hermes-agent.nousresearch.com
    extraProbePaths: (() => {
      const home = process.env.HOME || process.env.USERPROFILE || '';
      const paths: string[] = [];
      if (home) {
        paths.push(`${home}/.local/bin/hermes`);
      }
      return paths.length > 0 ? paths : undefined;
    })(),
    // `hermes chat -q "..." -Q` runs a one-shot query in quiet mode (no TUI).
    // We KEEP the user's model/provider config (no `--ignore-user-config`)
    // so the agent honours whatever default the user has set (e.g. MiniMax).
    // Round 55/56: Hermes AI CLI session reuse. Verified on v0.20.0:
    //   - `chat -q <prompt> -Q` prints `session_id: <id>` to stderr on every call
    //   - `chat -q <prompt> -Q --resume <id>` reuses the prior session
    //   - `-z <prompt> --cli` is the new v0.20 one-shot mode, but it does NOT
    //     print session_id, breaking Round 56 session reuse. So we use the
    //     older `chat -q -Q` invocation which still works and emits the id.
    callArgs: (q, _model, sid) => {
      const args = ['chat', '-q', q, '-Q'];
      if (sid && sid.startsWith('resume:')) {
        const resumeId = sid.slice(7);
        args.push('--resume', resumeId);
      }
      return args;
    },
    outputStream: 'both',
    stripBanner: (raw) => raw.replace(HERMES_BANNER_RE, '').trim(),
    // Round 56: Capture the actual hermes session ID from the first call's
    // output so subsequent calls can --resume it.
    // Round 60: parseHermesSessionId matches session_id:, Session ID:, and
    // session_id= formats; the capture works for both 'chat -q -Q' and
    // '-z --cli' invocations, but the latter doesn't print session_id at
    // all on hermes v0.20, so we use 'chat -q -Q' as the actual call.
    parseSessionId: parseHermesSessionId,
    extraEnv: { PYTHONIOENCODING: 'utf-8' },
    probeTimeoutMs: 15_000,
    // Round 59: Config probe — check if hermes has a model/provider configured.
    // hermes -z "test" --cli exits 0 but prints "No inference provider configured"
    // when no model is set up. This lets us surface a setup hint in the UI.
    configProbe: {
      args: ['-z', 'test', '--cli'],
      timeoutMs: 10_000,
      checkOutput: (stdout, stderr) => {
        const combined = (stdout + '\n' + stderr).toLowerCase();
        if (combined.includes('no inference provider configured')) {
          return 'Hermes CLI installed but no model configured. Run "hermes model" to set up a provider.';
        }
        return null;
      },
    },
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
    // Claude Code supports `claude -p "..." --session <id>` for session reuse.
    callArgs: (q, _model, sid) => sid ? ['-p', q, '--no-stream', '--session', sid] : ['-p', q, '--no-stream'],
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
     * `--output-last-message <file>`.
     *
     * Round 54: Codex does NOT support `--session <id>` for creating new
     * sessions. Instead, it uses `codex exec resume <SESSION_ID> [PROMPT]`
     * to resume an existing session. The first call creates a session
     * (persisted to disk by default), and subsequent calls use
     * `codex exec resume <id> <prompt>` to continue.
     *
     * Since we can't know the session ID before the first call completes,
     * we use a two-phase approach:
     * 1. First call: `codex exec --output-last-message <file> <prompt>`
     *    → Codex creates a session and prints the session ID to stderr
     * 2. Subsequent calls: `codex exec resume <sessionId> <prompt>`
     *    → Codex resumes the session with the new prompt
     *
     * For simplicity, we pass sessionId only when it's non-empty AND
     * starts with "resume:" prefix (set by the caller after the first
     * call). Without the prefix, we do a normal exec (first call).
     *
     * The `$OUTPUT_FILE` token is replaced with a per-call temp file
     * path by the library before spawn (see `outputFile` field).
     */
    callArgs: (q, _m, sid) => {
      // If sid starts with "resume:", use `codex exec resume <id> <prompt>`
      if (sid && sid.startsWith('resume:')) {
        const resumeId = sid.slice(7);
        return ['exec', 'resume', resumeId, '--output-last-message', '$OUTPUT_FILE', q];
      }
      // Normal first call (no session resume)
      return ['exec', '--output-last-message', '$OUTPUT_FILE', q];
    },
    outputStream: 'stdout',
    outputFile: '$OUTPUT_FILE',
    // Round 56: Capture codex session ID from stderr/stdout of the first exec
    // call so subsequent calls can `exec resume <id>`.
    parseSessionId: parseCodexSessionId,
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
    callArgs: (q, _m, sid) => sid ? ['llm', 'chat', '--no-stream', q, '--session', sid] : ['llm', 'chat', '--no-stream', q],
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
    callArgs: (q, _m, sid) => sid ? [q, '--session', sid] : [q],
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
    callArgs: (q, model, sid) => {
      // Round 62: codebuddy CLI's session flag is '--session-id <uuid>' or
      // '--resume <sessionId>'. We use --session-id for the first call (when
      // sid is just the logicalSid) and --resume for subsequent calls.
      // But: codebuddy currently doesn't print a session id in --print mode,
      // so capture won't work (no parseSessionId). The sessionId here is
      // passed-through but the registry stays empty until codebuddy emits
      // a session id in some output mode (e.g. --output-format json).
      const m = model || process.env.CODEBUDDY_MODEL || 'deepseek-v4-pro';
      const base = ['--print', '--model', m, q];
      if (sid && sid.startsWith('resume:')) {
        const resumeId = sid.slice(7);
        return [...base, '--resume', resumeId];
      }
      // First call: use the logical sid as a stable --session-id if provided
      return sid ? [...base, '--session-id', sid] : base;
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
    callArgs: (q, _m, sid) => sid ? ['--message', q, '--no-git', '--yes', '--no-auto-commits', '--session', sid] : ['--message', q, '--no-git', '--yes', '--no-auto-commits'],
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

interface ProbeOk  { ok: true; bin: string; reason: string; configHint?: string }
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
        // Round 59: If the adapter has a configProbe, run it now to check if
        // the CLI is actually CONFIGURED (not just installed). The provider is
        // still marked available:true, but configHint is set so the UI can show
        // a setup hint.
        if (adapter.configProbe) {
          runConfigProbe(adapter, bin).then((hint) => {
            finish({ ok: true, bin, reason: `${adapter.label} found at ${bin}`, configHint: hint ?? undefined });
          });
        } else {
          finish({ ok: true, bin, reason: `${adapter.label} found at ${bin}` });
        }
      } else {
        finish({ ok: false, reason: `${adapter.label} probe failed (exit=${code}, ${combined.slice(0, 120)})` });
      }
    });
  });
}

/**
 * Round 59: Run the adapter's configProbe to check if the CLI is configured.
 * Returns a hint string if the CLI needs setup, or null if it's ready.
 */
async function runConfigProbe(adapter: CliAdapter, bin: string): Promise<string | null> {
  if (!adapter.configProbe) return null;
  const { args, timeoutMs = 10_000, checkOutput } = adapter.configProbe;
  return new Promise((resolve) => {
    const isCmdBatch = process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin);
    const child = adapter.needsNode
      ? spawn(process.execPath, [bin, ...args], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...adapter.extraEnv } })
      : spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...adapter.extraEnv }, shell: isCmdBatch });
    let stdout = '';
    let stderr = '';
    let done = false;
    const finish = (r: string | null) => { if (!done) { done = true; resolve(r); } };
    const killTimer = setTimeout(() => { try { child.kill(); } catch {} finish(null); }, timeoutMs);
    child.stdout.on('data', (b) => { stdout += b.toString(); });
    child.stderr.on('data', (b) => { stderr += b.toString(); });
    child.on('error', () => { clearTimeout(killTimer); finish(null); });
    child.on('close', () => {
      clearTimeout(killTimer);
      try {
        finish(checkOutput(stdout, stderr));
      } catch {
        finish(null);
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
// _CACHE_DIR is defined at the top of the file (shared with session registry).
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
  configHint?: string;  // Round 59: setup hint (e.g. "hermes needs model config")
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
          configHint: p.ok ? p.configHint : undefined,
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
            ? { ok: true, bin: p.bin!, reason: p.reason, configHint: p.configHint }
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
        configHint: probePair.native.configHint,
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
  opts: { maxChars?: number; llm?: LlmConfig; signal?: AbortSignal } = {},
): Promise<LlmResult> {
  const t0 = Date.now();
  const maxChars = opts.maxChars ?? 4000;
  const cfg = resolveLlmConfig(opts.llm);
  // API-05: forward caller cancellation (e.g. request.signal on client
  // disconnect) so the underlying CLI child / SDK call is aborted.
  const r = await callAnyLlm(userPrompt, { ...cfg, system: cfg.system || systemPrompt, signal: opts.signal });
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
  cfg: LlmConfig & { resolvedProvider: string; system: string; signal?: AbortSignal },
): Promise<LlmResult> {
  const probes = await probeAll();
  const order = decideProviderOrder(cfg.resolvedProvider, cfg.model);
  const errors: string[] = [];
  for (const item of order) {
    // API-05: caller cancelled (client disconnect) — stop walking the
    // fallback chain; the whole call is dead.
    if (cfg.signal?.aborted) break;
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
        // ★ CRITICAL: CLI adapters (hermes, claude, codex, etc.) don't have a
        // separate system-prompt channel — they only accept a single prompt
        // string via callArgs(). We must PREPEND the system prompt to the
        // user prompt so the CLI sees the full context (JSON format requirements,
        // command schema, examples, etc.). Without this, hermes returns plain
        // text without the expected JSON structure.
        const fullPrompt = cfg.system
          ? `${cfg.system}\n\n---\n\n${prompt}`
          : prompt;
        // Round 54: Pass sessionId to runCli so CLI agents can reuse sessions
        const text = via === 'wsl'
          ? await runCliInWsl(adapter, probe.bin, fullPrompt, cfg.model, cfg.sessionId, cfg.signal)
          : await runCli(adapter, probe.bin, fullPrompt, cfg.model, cfg.sessionId, cfg.signal);
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
        const text = await callAnthropic(prompt, cfg.system, cfg.model, cfg.signal);
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
        const text = await callOpenai(prompt, cfg.system, cfg.model, cfg.signal);
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
        const text = await callZai(prompt, cfg.system, cfg.model, cfg.signal);
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

function runCli(adapter: CliAdapter, bin: string, prompt: string, model: string | undefined, sessionId?: string, signal?: AbortSignal): Promise<string> {
  // Round 56: Resolve the logical sessionId to an effective sid.
  // If SESSION_REGISTRY has a captured CLI session ID for this (logicalSid,
  // adapter.id) pair, pass `resume:<capturedId>` so the adapter switches to
  // "resume session" mode. Otherwise pass the logicalSid unchanged (first call).
  const effectiveSid = adapter.parseSessionId
    ? resolveSessionId(adapter.id, sessionId)
    : sessionId;
  const rawArgs = adapter.callArgs(prompt, model, effectiveSid);
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

    // API-05: caller cancellation (client disconnect) kills the child
    // process instead of letting it run to completion for a dead client.
    const onAbort = () => {
      try { child.kill(); } catch {}
      clearTimeout(killTimer);
      cleanup();
      reject(new Error(`${adapter.id} aborted (caller cancelled)`));
    };
    if (signal?.aborted) { onAbort(); return; }
    signal?.addEventListener('abort', onAbort, { once: true });

    child.stdout.on('data', (b) => { stdout += b.toString(); });
    child.stderr.on('data', (b) => { stderr += b.toString(); });

    child.on('error', (err) => {
      clearTimeout(killTimer);
      if (signal) signal.removeEventListener('abort', onAbort);
      cleanup();
      reject(new Error(`${adapter.id} spawn error: ${err?.message}`));
    });
    child.on('close', (code) => {
      clearTimeout(killTimer);
      if (signal) signal.removeEventListener('abort', onAbort);
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
      // Compute raw for session-ID capture (BEFORE stripBanner removes it).
      // For hermes (outputStream='both'), the session_id line lives in
      // stdout+stderr; for codex (outputStream='stdout', outputFile set),
      // the session ID is printed to stderr — so always capture from both.
      const rawForCapture = (stdout + (stderr ? '\n' + stderr : '')).trim();
      if (!cleaned) {
        const raw = adapter.outputStream === 'stdout' ? stdout
                  : adapter.outputStream === 'stderr' ? stderr
                  : (stdout.trim() + (stderr.includes('\n') ? '\n' : '') + stderr).trim();
        cleaned = adapter.stripBanner ? adapter.stripBanner(raw) : raw.trim();
      }
      // Round 56: Capture the CLI session ID from the first call's output
      // so subsequent calls with the same logical sessionId can resume it.
      // Only capture when this was a "first call" (effectiveSid === logicalSid,
      // i.e. not already in resume mode).
      if (adapter.parseSessionId && sessionId && effectiveSid === sessionId) {
        const captured = adapter.parseSessionId(rawForCapture);
        if (captured) {
          storeCapturedSession(adapter.id, sessionId, captured);
        }
      }
      cleanup();
      // Round 58: Detect CLI error messages that are printed to stdout as
      // content. Some CLIs (notably hermes) exit 0 but print an error message
      // like "agent failed: No inference provider configured" to stdout. Without
      // this check, the error message is treated as valid LLM output and the
      // fallback chain never fires — the user sees the error message as the
      // "report content".
      if (cleaned.length > 0 && isCliErrorMessage(cleaned, adapter.id)) {
        reject(new Error(`${adapter.id} CLI error: ${cleaned.slice(0, 200)}`));
        return;
      }
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

function runCliInWsl(adapter: CliAdapter, wslBin: string, prompt: string, model: string | undefined, sessionId?: string, signal?: AbortSignal): Promise<string> {
  // Round 56: Resolve the logical sessionId to an effective sid (same logic
  // as runCli — check SESSION_REGISTRY for a captured CLI session ID).
  const effectiveSid = adapter.parseSessionId
    ? resolveSessionId(adapter.id, sessionId)
    : sessionId;
  // Build a single bash command string that runs the CLI with the same args,
  // then trim the trailing "session_id: ..." banner on stderr if needed.
  const args = adapter.callArgs(prompt, model, effectiveSid);
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
    // API-05: caller cancellation kills the WSL child too.
    const onAbort = () => {
      try { child.kill(); } catch {}
      clearTimeout(killTimer);
      reject(new Error(`${adapter.id} WSL aborted (caller cancelled)`));
    };
    if (signal?.aborted) { onAbort(); return; }
    signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (b) => { stdout += b.toString(); });
    child.stderr.on('data', (b) => { stderr += b.toString(); });
    child.on('error', (err) => { clearTimeout(killTimer); if (signal) signal.removeEventListener('abort', onAbort); reject(new Error(`${adapter.id} WSL spawn error: ${err?.message}`)); });
    child.on('close', (code) => {
      clearTimeout(killTimer);
      if (signal) signal.removeEventListener('abort', onAbort);
      const raw = (stdout + (stderr ? '\n' + stderr : '')).trim();
      const cleaned = adapter.stripBanner ? adapter.stripBanner(raw) : raw.trim();
      // Round 56: Capture the CLI session ID from the first call's output.
      if (adapter.parseSessionId && sessionId && effectiveSid === sessionId) {
        const captured = adapter.parseSessionId(raw);
        if (captured) {
          storeCapturedSession(adapter.id, sessionId, captured);
        }
      }
      // Round 58: Detect CLI error messages printed to stdout (same as runCli).
      if (cleaned.length > 0 && isCliErrorMessage(cleaned, adapter.id)) {
        reject(new Error(`${adapter.id} WSL CLI error: ${cleaned.slice(0, 200)}`));
        return;
      }
      // code === 124 → `timeout` killed it (still might have partial output)
      if (cleaned.length > 0) { resolve(cleaned); return; }
      reject(new Error(`${adapter.id} WSL returned empty output (exit=${code}, stderr=${stderr.slice(0, 300)})`));
    });
  });
}

// ─── SDK providers ────────────────────────────────────────────────────────────

/**
 * API-06: hard timeout for a single SDK LLM request. The VLM route got 55s
 * per attempt in R165 (VLM-005) and the agent adapters got 120s in R168
 * (AGENT-M6) — the run-center SDK branch (callAnthropic/callOpenai/callZai)
 * previously had NO bound at all, so a hung provider connection blocked the
 * provider fallback chain indefinitely.
 */
const SDK_CALL_TIMEOUT_MS = 90_000;

/**
 * API-06: combine a caller-provided abort signal with the hard SDK-call
 * timeout into one signal + dispose pair. Prefers AbortSignal.any (Node 20+)
 * semantics via manual listener wiring — same pattern as the VLM route's
 * combineAbortSignals (R165/VLM-005) and src/lib/agent/llm/signal-utils.ts
 * (R168/AGENT-M6), inlined here so src/lib/llm.ts stays decoupled from the
 * agent subsystem.
 */
function withSdkTimeout(callerSignal: AbortSignal | undefined): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(
      typeof DOMException === 'function'
        ? new DOMException(`LLM SDK call timed out after ${SDK_CALL_TIMEOUT_MS}ms`, 'TimeoutError')
        : new Error(`LLM SDK call timed out after ${SDK_CALL_TIMEOUT_MS}ms`)
    );
  }, SDK_CALL_TIMEOUT_MS);
  const onCallerAbort = () => controller.abort(callerSignal?.reason);
  if (callerSignal) {
    if (callerSignal.aborted) {
      controller.abort(callerSignal.reason);
    } else {
      callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    }
  }
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      if (callerSignal) callerSignal.removeEventListener('abort', onCallerAbort);
    },
  };
}

/**
 * API-06: rejects with the signal's reason when it aborts, never resolves.
 * Used to race unsignallable calls (the z-ai SDK's create() takes no
 * AbortSignal — its internal fetch is unsignalled) against the timeout.
 */
function abortGuard(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (signal.aborted) {
      reject(signal.reason ?? new Error('aborted'));
      return;
    }
    signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')), { once: true });
  });
}

async function callAnthropic(prompt: string, system?: string, model?: string, signal?: AbortSignal): Promise<string> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');
  const client = new Anthropic({ apiKey });
  // API-06: 90s hard timeout + caller cancellation — the Anthropic SDK
  // forwards the signal and cancels the in-flight HTTP request.
  const t = withSdkTimeout(signal);
  try {
    const resp = await client.messages.create({
      model: model || 'claude-3-5-sonnet-latest',
      max_tokens: 4096,
      system: system || 'You are a helpful assistant.',
      messages: [{ role: 'user', content: prompt }],
    }, { signal: t.signal });
    const block = resp.content?.[0];
    return (block && block.type === 'text' ? block.text : '') || '';
  } finally {
    t.dispose();
  }
}

async function callOpenai(prompt: string, system?: string, model?: string, signal?: AbortSignal): Promise<string> {
  const OpenAI = (await import('openai')).default;
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');
  const client = new OpenAI({ apiKey });
  // API-06: 90s hard timeout + caller cancellation — the OpenAI SDK
  // forwards the signal and cancels the in-flight HTTP request.
  const t = withSdkTimeout(signal);
  try {
    const resp = await client.chat.completions.create({
      model: model || 'gpt-4o-mini',
      messages: [
        ...(system ? [{ role: 'system' as const, content: system }] : []),
        { role: 'user' as const, content: prompt },
      ],
    }, { signal: t.signal });
    return resp.choices?.[0]?.message?.content || '';
  } finally {
    t.dispose();
  }
}

/**
 * z.ai SDK — independent LLM provider using z-ai-web-dev-sdk.
 *
 * This is a SEPARATE branch that does NOT touch the existing CLI/SDK agent
 * discovery or call logic. It uses the built-in z-ai-web-dev-sdk to call
 * GLM models. No API key configuration needed — the SDK handles auth
 * internally. Intended for temporary LLM testing.
 */
async function callZai(prompt: string, system?: string, model?: string, signal?: AbortSignal): Promise<string> {
  const ZAI = (await import('z-ai-web-dev-sdk')).default;
  const zai = await ZAI.create();
  // Round 31: Reduced from 5 retries (10s+20s+40s+80s+160s = 310s total) to 2 retries
  // (5s + 10s = 15s total). The old 310s backoff exceeded the 60-90s request timeout,
  // preventing the provider fallback in callAnyLlm from ever trying the next provider.
  // With 15s max backoff, if ZAI is still rate-limited, callAnyLlm will fall back to
  // cli:hermes, cli:claude, etc. much faster.
  const MAX_RETRIES = 2;
  const BASE_DELAY = 5_000; // 5s initial backoff for 429 errors
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      // API-06: 90s hard timeout per attempt + caller cancellation. The z-ai
      // SDK's create() takes no AbortSignal (its internal fetch is
      // unsignalled), so the call is raced against the combined timeout —
      // the underlying HTTP request may still finish in the background, but
      // a hung call can no longer block the provider fallback chain.
      const t = withSdkTimeout(signal);
      let resp: any;
      try {
        resp = await Promise.race([
          zai.chat.completions.create({
            model: model || 'glm-4.6',
            messages: [
              ...(system ? [{ role: 'system' as const, content: system }] : []),
              { role: 'user' as const, content: prompt }],
            thinking: { type: 'disabled' as const },
          }),
          abortGuard(t.signal),
        ]);
      } finally {
        t.dispose();
      }
      return resp.choices?.[0]?.message?.content || '';
    } catch (err: any) {
      const is429 = err?.message?.includes('429') || err?.message?.includes('Too many');
      if (is429 && attempt < MAX_RETRIES - 1) {
        const delay = BASE_DELAY * Math.pow(2, attempt); // 5s, 10s
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error('callZai: max retries exceeded (429 rate limit)');
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
