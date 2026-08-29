/**
 * run-provider — the Run Center LLM provider override (R181).
 *
 * The Run Center modules share the Agent-chat LLM settings by default (R180:
 * `.hermes/agent-default-provider.json` + per-provider key/model). R181
 * restores the pre-R180 "agent 检测" capability: locally installed agent CLIs
 * (hermes / claude code / codex / gemini / openclaw / codebuddy / aider) can
 * be DETECTED and selected as the Run Center's LLM provider.
 *
 * CLI agents cannot be chat defaults (the chat harness speaks API adapters
 * only), so a CLI selection is stored HERE as a Run-Center-scoped override:
 *
 *   resolveRunLlmConfig() priority:
 *     1. explicit body.llm (programmatic API callers)
 *     2. run-provider override  ← this file (`cli:*` ids only)
 *     3. shared Agent-chat default (.hermes/agent-default-provider.json)
 *     4. 'zai' + 'glm-4.6' fallback
 *
 * Storage mirrors the credentials store pattern: a tiny JSON file in
 * `.hermes/` with mtime-based in-memory caching.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CLI_AGENT_PROVIDER_IDS } from '@/lib/cli-agent-scan';

const CONFIG_DIR = resolve(process.cwd(), '.hermes');
const RUN_PROVIDER_FILE = resolve(CONFIG_DIR, 'run-provider.json');

export interface RunProviderOverride {
  /** `cli:*` provider id (validated against the scanned agent list). */
  provider: string;
  /** Optional model hint for the CLI agent (empty = the CLI's own default). */
  model?: string;
  /** When the override was set (ISO string) — for UI display. */
  setAt?: string;
}

let cachedOverride: RunProviderOverride | null | undefined = undefined;
let cachedMtime = 0;

function isValidCliProvider(id: string): boolean {
  return CLI_AGENT_PROVIDER_IDS.has(id);
}

/** Read the Run Center provider override (null when following the shared default). */
export function getRunProviderOverride(): RunProviderOverride | null {
  try {
    if (!existsSync(RUN_PROVIDER_FILE)) return null;
    const stat = statSync(RUN_PROVIDER_FILE);
    if (cachedOverride !== undefined && stat.mtimeMs === cachedMtime) {
      return cachedOverride;
    }
    const raw = readFileSync(RUN_PROVIDER_FILE, 'utf-8');
    const data = JSON.parse(raw) as Partial<RunProviderOverride>;
    if (
      typeof data.provider === 'string' &&
      isValidCliProvider(data.provider)
    ) {
      cachedOverride = {
        provider: data.provider,
        ...(typeof data.model === 'string' && data.model.trim() ? { model: data.model.trim() } : {}),
        ...(typeof data.setAt === 'string' ? { setAt: data.setAt } : {}),
      };
    } else {
      cachedOverride = null;
    }
    cachedMtime = stat.mtimeMs;
    return cachedOverride;
  } catch {
    return null;
  }
}

/** Set the Run Center provider override (`cli:*` ids only — invalid ids are ignored, returns false). */
export function setRunProviderOverride(provider: string, model?: string): boolean {
  if (!isValidCliProvider(provider)) return false;
  try {
    if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    const payload: RunProviderOverride = {
      provider,
      ...(model && model.trim() ? { model: model.trim() } : {}),
      setAt: new Date().toISOString(),
    };
    writeFileSync(RUN_PROVIDER_FILE, JSON.stringify(payload, null, 2), {
      encoding: 'utf-8',
      mode: 0o600,
    });
    cachedOverride = payload;
    cachedMtime = statSync(RUN_PROVIDER_FILE).mtimeMs;
    return true;
  } catch (err) {
    console.error('[run-provider] setRunProviderOverride failed:', err);
    return false;
  }
}

/** Clear the override — Run Center follows the shared Agent-chat default again. */
export function clearRunProviderOverride(): void {
  try {
    if (existsSync(RUN_PROVIDER_FILE)) writeFileSync(RUN_PROVIDER_FILE, JSON.stringify({}));
    cachedOverride = null;
    cachedMtime = 0;
  } catch (err) {
    console.error('[run-provider] clearRunProviderOverride failed:', err);
  }
}
