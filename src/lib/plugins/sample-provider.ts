/**
 * Sample custom LLM provider plugin — an echo / mock provider.
 * -------------------------------------------------------------
 * This file demonstrates the minimum surface area a plugin must
 * implement to be registered with `pluginRegistry` (see
 * `src/lib/plugin-system.ts`). It is intentionally dependency-free
 * so it can be used as a smoke-test in unit tests or in dev mode
 * when no real LLM CLI / API key is available.
 *
 * Behaviour:
 *  - `isAvailable()` always returns true (it's a mock — nothing to probe)
 *  - `call(prompt)` returns a deterministic echoed string after a tiny
 *    artificial delay so consumers can exercise streaming/timeout paths
 *  - Token usage is approximated by whitespace splitting, which is good
 *    enough for UI plumbing tests
 *
 * To activate in your own code:
 *
 *   import { pluginRegistry } from '@/lib/plugin-system';
 *   import { sampleEchoProvider } from '@/lib/plugins/sample-provider';
 *   pluginRegistry.register(sampleEchoProvider);
 *
 *   const { content } = await sampleEchoProvider.call('Hello');
 *   // → "[echo] Hello"
 */

import type { LLMProviderPlugin } from '@/lib/plugin-system';

const SAMPLE_PROVIDER_ID = 'sample:echo';

/**
 * Approximate token count for the mock result.
 * Real providers should return the value reported by the upstream API.
 */
function approxTokens(text: string): number {
  if (!text) return 0;
  // 1 token ≈ 4 chars for English; round up so the UI shows a non-zero number.
  return Math.max(1, Math.ceil(text.length / 4));
}

export const sampleEchoProvider: LLMProviderPlugin = {
  id: SAMPLE_PROVIDER_ID,
  name: 'Sample Echo Provider',
  description:
    'A built-in mock LLM provider that echoes the prompt back. Useful for ' +
    'testing the plugin pipeline without an external API key or CLI. ' +
    'Always reports itself as available.',

  async isAvailable() {
    // The mock provider is always available — it requires no external
    // resources. Override this method in a real plugin to probe CLI
    // binaries, API keys, network endpoints, etc.
    return true;
  },

  async call(prompt, options) {
    const start = Date.now();

    // Tiny artificial latency so consumers can exercise loading UIs.
    // Kept well under any reasonable timeout.
    await new Promise((resolve) => setTimeout(resolve, 10));

    const sys = options?.system ? `[system: ${options.system}] ` : '';
    const model = options?.model ?? 'echo-1';
    const temp = options?.temperature ?? 0.7;

    // Deterministic, side-effect-free response.
    const content = `${sys}[echo via ${model} (t=${temp})] ${prompt}`;

    return {
      content,
      tokensUsed: approxTokens(content),
      durationMs: Date.now() - start,
    };
  },
};

/**
 * A second sample: a "reversing" provider, useful for demonstrating that
 * the registry can hold multiple providers at once and `listAvailable()`
 * correctly returns all of them.
 */
export const sampleReverseProvider: LLMProviderPlugin = {
  id: 'sample:reverse',
  name: 'Sample Reverse Provider',
  description:
    'A built-in mock LLM provider that returns the prompt reversed. ' +
    'Exists to demonstrate multi-provider registration.',
  async isAvailable() {
    return true;
  },
  async call(prompt, options) {
    const start = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const reversed = Array.from(prompt).reverse().join('');
    const model = options?.model ?? 'reverse-1';
    const content = `[reverse via ${model}] ${reversed}`;
    return {
      content,
      tokensUsed: approxTokens(content),
      durationMs: Date.now() - start,
    };
  },
};

/**
 * Optional convenience helper: register all bundled sample providers.
 * Safe to call multiple times — `register()` is idempotent for a given id.
 */
export function registerAllSampleProviders(): void {
  // Imported lazily-inside-the-function style to keep the top-level
  // import type-only and avoid any chance of a circular import side effect.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { pluginRegistry } = require('@/lib/plugin-system') as {
    pluginRegistry: import('@/lib/plugin-system').PluginRegistry;
  };
  pluginRegistry.register(sampleEchoProvider);
  pluginRegistry.register(sampleReverseProvider);
}
