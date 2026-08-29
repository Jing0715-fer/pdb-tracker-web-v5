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

/**
 * Build the effective `LlmConfig` for a Run Center module route.
 *
 * Priority:
 *   1. explicit `body.llm` fields (legacy API callers / programmatic use);
 *   2. the shared Agent-chat LLM settings (`.hermes/` store);
 *   3. 'zai' + 'glm-4.6' when nothing is configured (always-available SDK).
 *
 * Model inheritance nuance: an explicit provider different from the shared
 * default does NOT inherit the shared default's model (mixing e.g. provider
 * 'cli:hermes' with model 'glm-4.6' would be wrong).
 */
export function resolveRunLlmConfig(
  bodyLlm?: unknown,
): LlmConfig & { shared: SharedLlmSettings } {
  const shared = resolveSharedLlmSettings();
  const explicit =
    bodyLlm && typeof bodyLlm === 'object' ? (bodyLlm as Record<string, unknown>) : {};

  const str = (v: unknown): string =>
    typeof v === 'string' ? v.trim() : '';

  const explicitProvider = str(explicit.provider);
  const explicitModel = str(explicit.model);

  const provider = explicitProvider || shared.provider;
  const model =
    explicitModel || (provider === shared.provider ? shared.model : '');

  const out: LlmConfig & { shared: SharedLlmSettings } = {
    provider,
    ...(model ? { model } : {}),
    shared,
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
