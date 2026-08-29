/**
 * eval-llm — the shared LLM settings bridge (R180).
 *
 * The Run Center modules (evaluation classic / DSH, literature, weekly) now
 * share the SAME LLM settings as the Agent chat (the "dsh" harness):
 *
 *   ┌────────────────────────┐   .hermes/agent-providers.json     ┌──────────────┐
 *   │ Agent chat (new sessions)│◀──(per-provider key/model config)─▶│ Providers UI │
 *   │ Run Center (all modules) │◀──(default provider id)───────────│ (shared)     │
 *   └────────────────────────┘   .hermes/agent-default-provider.json └──────────────┘
 *
 * `resolveSharedLlmSettings()` reads the server-side store (same source the
 * chat's AgentManager uses for new sessions) and `resolveRunLlmConfig()`
 * turns it into an eval-pipeline `LlmConfig`. Explicit `body.llm` overrides
 * from API callers still win (backward compatibility for programmatic use),
 * but the Run Center UI no longer sends its own localStorage-based config.
 */

import {
  getDefaultProvider,
  getProviderConfig,
  getProviderProfile,
  isProviderAvailable,
  resolveApiKey,
} from '@/lib/agent/providers';
import { getRunProviderOverride } from '@/lib/agent/run-provider';
import type { LlmConfig } from '@/lib/llm';

export interface SharedLlmSettings {
  /** Agent-catalog provider id ('zai' | 'deepseek' | 'openai' | …). */
  provider: string;
  /** Effective model: config.defaultModel ?? catalog defaultModel. */
  model: string;
  /** Whether the provider has auth (key in store or env; 'zai' is always true). */
  available: boolean;
  /** True when an explicit API key is stored/env-resolvable (excludes zai-internal). */
  hasApiKey: boolean;
  /** Human-readable provider name from the catalog. */
  displayName: string;
}

/**
 * Resolve the shared LLM (default provider + model) from the same store the
 * Agent chat reads for NEW sessions — this is what makes the two features
 * "share" settings: change the default here (from either UI) and both the
 * chat's next session and every Run Center module follow.
 */
export function resolveSharedLlmSettings(): SharedLlmSettings {
  const providerId = getDefaultProvider() ?? 'zai';
  const profile = getProviderProfile(providerId);
  const config = getProviderConfig(providerId);
  const model = config.defaultModel || profile?.defaultModel || 'glm-4.6';
  const available = isProviderAvailable(providerId);
  const hasApiKey = providerId === 'zai' || !!resolveApiKey(providerId);
  return {
    provider: providerId,
    model,
    available,
    hasApiKey,
    displayName: profile?.displayName ?? providerId,
  };
}

/** Where a resolved Run Center LLM config came from (for init-message labels). */
export type RunLlmSource = 'explicit' | 'run-override' | 'shared';

/**
 * Build the effective `LlmConfig` for a Run Center module route.
 *
 * Priority (R181):
 *   1. explicit `body.llm` fields (legacy API callers / programmatic use);
 *   2. the Run Center CLI-agent override (`.hermes/run-provider.json`, `cli:*`
 *      ids — the restored "agent 检测" option; detected agents run locally
 *      as subprocesses via the llm.ts CLI executor);
 *   3. the shared Agent-chat LLM settings (`.hermes/` store);
 *   4. 'zai' + 'glm-4.6' when nothing is configured (always-available SDK).
 *
 * Model inheritance nuance: an explicit provider different from the shared
 * default does NOT inherit the shared default's model (mixing e.g. provider
 * 'cli:hermes' with model 'glm-4.6' would be wrong).
 */
export function resolveRunLlmConfig(
  bodyLlm?: unknown,
): LlmConfig & { shared: SharedLlmSettings; source: RunLlmSource } {
  const shared = resolveSharedLlmSettings();
  const explicit =
    bodyLlm && typeof bodyLlm === 'object' ? (bodyLlm as Record<string, unknown>) : {};

  const str = (v: unknown): string =>
    typeof v === 'string' ? v.trim() : '';

  const explicitProvider = str(explicit.provider);
  const explicitModel = str(explicit.model);

  // R181: the Run Center CLI-agent override sits between explicit API
  // callers and the shared chat default. It only carries `cli:*` providers.
  const override = getRunProviderOverride();

  let provider: string;
  let model: string;
  let source: RunLlmSource;
  if (explicitProvider) {
    provider = explicitProvider;
    model = explicitModel || (provider === shared.provider ? shared.model : '');
    source = 'explicit';
  } else if (override) {
    provider = override.provider;
    // An explicit model-only body.llm acts as a model hint for the CLI agent
    // (the pre-R180 UI allowed provider+model combos like cli:hermes+model).
    model = explicitModel || override.model || '';
    source = 'run-override';
  } else {
    provider = shared.provider;
    model = shared.model;
    source = 'shared';
  }

  const out: LlmConfig & { shared: SharedLlmSettings; source: RunLlmSource } = {
    provider,
    ...(model ? { model } : {}),
    shared,
    source,
  };
  const system = str(explicit.system);
  if (system) out.system = system;
  if (typeof explicit.temperature === 'number' && Number.isFinite(explicit.temperature)) {
    out.temperature = explicit.temperature;
  }
  if (typeof explicit.maxTokens === 'number' && Number.isFinite(explicit.maxTokens)) {
    out.maxTokens = explicit.maxTokens;
  }
  const sessionId = str(explicit.sessionId);
  if (sessionId) out.sessionId = sessionId;
  return out;
}
