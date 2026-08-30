/**
 * cli-agent-scan — lightweight CLI-agent *detection* (R181).
 *
 * Restores the "agent 检测" capability the old Run Center LLM-config block had:
 * it scans the machine for locally installed agent CLIs (hermes / claude code /
 * codex / openclaw / gemini / codebuddy / aider) and reports which ones are
 * usable as Run Center LLM providers.
 *
 * This module is deliberately a LEAF module — it must NOT import `@/lib/llm`
 * (which drags the whole eval-LLM subsystem into any route that scans). The
 * probe here is a pure filesystem/PATH check (no subprocess spawn), so it is
 * cheap enough to run on every providers GET (results cached 60s in-process).
 *
 * The id list mirrors `CLI_ADAPTERS` in llm.ts; the execution path for these
 * providers still lives there (callAnyLlm → executeCliAgent). When a CLI is
 * selected as the Run Center provider, llm.ts resolves it exactly like the
 * pre-R180 UI did.
 */

import { access, constants } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { homedir } from 'node:os';

// NOTE: `access` MUST come from `node:fs/promises`. The callback-style
// `node:fs.access()` throws ERR_INVALID_ARG_TYPE when called without a
// callback (no promise overload on Node ≥22 / Bun) — every probe would
// silently fail and all agents would read as "not detected".

export interface CliAgentInfo {
  /** Provider id as used in LlmConfig.provider (`cli:hermes` etc.). */
  provider: string;
  /** Short adapter id (`hermes`). */
  id: string;
  /** Display label. */
  label: string;
  /** Emoji icon (matches the old scan UI). */
  icon: string;
  /** True when the binary was found on PATH / known install locations. */
  available: boolean;
  /** Resolved binary path when available. */
  bin: string | null;
  /** Why it is unavailable (for dim entries + tooltips). */
  reason: string;
}

interface AgentSpec {
  id: string;
  label: string;
  icon: string;
  bin: string;
  /** Extra absolute paths probed before PATH (canonical install locations). */
  extraPaths?: string[];
}

/** Mirrors CLI_ADAPTERS in llm.ts (same ids/icon keys/labels as the old scan UI). */
const AGENTS: AgentSpec[] = [
  {
    id: 'hermes',
    label: 'Hermes CLI',
    icon: 'feather',
    bin: 'hermes',
    extraPaths: [join(homedir(), '.local/bin/hermes')],
  },
  { id: 'claude', label: 'Claude Code CLI', icon: 'sparkles', bin: 'claude',
    extraPaths: [
      join(homedir(), '.claude/local/claude'),
      '/usr/local/bin/claude',
      '/opt/homebrew/bin/claude',
    ],
  },
  { id: 'codex', label: 'Codex CLI', icon: 'terminal', bin: 'codex' },
  { id: 'openclaw', label: 'OpenClaw CLI', icon: 'bird', bin: 'openclaw' },
  { id: 'gemini', label: 'Gemini CLI', icon: 'gemini', bin: 'gemini' },
  {
    id: 'codebuddy',
    label: 'Codebuddy / WorkBuddy CLI',
    icon: 'panda',
    bin: 'codebuddy',
    extraPaths: [
      process.platform === 'win32'
        ? 'C:\\Program Files\\WorkBuddy\\resources\\app.asar.unpacked\\cli\\bin\\codebuddy'
        : '/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy',
      '/usr/local/bin/codebuddy',
      '/opt/homebrew/bin/codebuddy',
    ],
  },
  {
    id: 'aider',
    label: 'Aider CLI',
    icon: 'wrench',
    bin: 'aider',
    extraPaths: [join(homedir(), '.local/bin/aider')],
  },
];

// De-duplicate (claude appears once above with extra paths folded in — the
// literal list keeps the diff small; guard here keeps ids unique).
const SEEN = new Set<string>();
const UNIQUE_AGENTS = AGENTS.filter((a) => {
  if (SEEN.has(a.id)) return false;
  SEEN.add(a.id);
  return true;
});

const isWindows = process.platform === 'win32';
const EXE = isWindows ? '.exe' : '';
const PATH_DIRS = (process.env.PATH || '').split(delimiter).filter(Boolean);

/** Check that a path exists and is executable (X_OK; on Windows just exists). */
async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, isWindows ? constants.F_OK : constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** `which`-equivalent: probe extra paths first, then every PATH dir. */
async function findBin(spec: AgentSpec): Promise<string | null> {
  const candidates: string[] = [];
  for (const p of spec.extraPaths ?? []) candidates.push(p);
  for (const dir of PATH_DIRS) {
    candidates.push(join(dir, spec.bin + EXE));
    // npm global installs on unix use shebang wrappers without extension
    if (!isWindows) candidates.push(join(dir, spec.bin));
  }
  for (const c of candidates) {
    if (await isExecutable(c)) return c;
  }
  return null;
}

export interface CliAgentScanResult {
  agents: CliAgentInfo[];
  scannedAt: number;
}

/** In-process TTL cache — scanning 7 binaries over ≤~40 PATH dirs is cheap,
 *  but the providers GET can be hit on every popover open, so cache anyway. */
let _cache: CliAgentScanResult | null = null;
const TTL_MS = 60_000;

/** Detect locally installed agent CLIs. Cached for 60s in-process. */
export async function scanCliAgents(force = false): Promise<CliAgentScanResult> {
  if (!force && _cache && Date.now() - _cache.scannedAt < TTL_MS) return _cache;
  const agents = await Promise.all(
    UNIQUE_AGENTS.map(async (spec): Promise<CliAgentInfo> => {
      const bin = await findBin(spec);
      return {
        provider: `cli:${spec.id}`,
        id: spec.id,
        label: spec.label,
        icon: spec.icon,
        available: !!bin,
        bin,
        reason: bin ? '' : `${spec.label} not found on PATH`,
      };
    }),
  );
  _cache = { agents, scannedAt: Date.now() };
  return _cache;
}

/** Valid `cli:*` provider ids accepted as a Run Center override. */
export const CLI_AGENT_PROVIDER_IDS: ReadonlySet<string> = new Set(
  UNIQUE_AGENTS.map((a) => `cli:${a.id}`),
);
