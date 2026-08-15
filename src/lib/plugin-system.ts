/**
 * Plugin System — Custom LLM Provider Registry
 * -------------------------------------------------------------
 * Allows users (or third-party packages) to register custom LLM
 * providers at runtime. Each provider implements a uniform `call`
 * interface so that the rest of the app can treat them identically
 * to the built-in `cli:*` / `anthropic` / `openai` providers in
 * `src/lib/llm.ts`.
 *
 * The registry is a process-wide singleton (`pluginRegistry`) so
 * plugins registered on the server (e.g. via an API route or an
 * import-time side effect) are visible everywhere.
 *
 * Registering a provider whose `id` already exists replaces the
 * previous entry — this is intentional so that hot-reload during
 * development does not accumulate stale entries.
 */

export interface LLMProviderPlugin {
  /** Stable unique id, e.g. `my-org:ollama`. */
  id: string;
  /** Human-readable name shown in UI. */
  name: string;
  /** Short description / capability blurb. */
  description: string;
  /**
   * Run a completion. Implementations should:
   *  - respect `options.system` if supported
   *  - default to a sensible model when `options.model` is omitted
   *  - return wall-clock duration in `durationMs`
   *  - throw on hard failure (caller will fall through to the next provider)
   */
  call: (
    prompt: string,
    options?: {
      system?: string;
      model?: string;
      temperature?: number;
    },
  ) => Promise<{
    content: string;
    tokensUsed?: number;
    durationMs: number;
  }>;
  /** Lightweight availability probe — must NOT throw; return false on failure. */
  isAvailable: () => Promise<boolean>;
}

export class PluginRegistry {
  private providers = new Map<string, LLMProviderPlugin>();

  /** Register (or replace) a provider. Validates required fields. */
  register(provider: LLMProviderPlugin): void {
    if (!provider || typeof provider !== 'object') {
      throw new TypeError('plugin-system: register() expects a provider object');
    }
    if (!provider.id || typeof provider.id !== 'string') {
      throw new TypeError('plugin-system: provider.id is required (string)');
    }
    if (typeof provider.call !== 'function') {
      throw new TypeError(`plugin-system: provider "${provider.id}" is missing a call() function`);
    }
    if (typeof provider.isAvailable !== 'function') {
      throw new TypeError(`plugin-system: provider "${provider.id}" is missing an isAvailable() function`);
    }
    if (!provider.name) provider.name = provider.id;
    if (!provider.description) provider.description = '';
    this.providers.set(provider.id, provider);
  }

  /** Remove a provider by id. No-op if not registered. */
  unregister(id: string): void {
    this.providers.delete(id);
  }

  /** Get a single provider by id (or undefined). */
  get(id: string): LLMProviderPlugin | undefined {
    return this.providers.get(id);
  }

  /** List all registered providers (insertion order). */
  list(): LLMProviderPlugin[] {
    return Array.from(this.providers.values());
  }

  /**
   * List providers whose `isAvailable()` resolved to true.
   * Failures are swallowed (a broken probe must never crash the caller)
   * and the offending provider is silently skipped.
   */
  async listAvailable(): Promise<LLMProviderPlugin[]> {
    const all = this.list();
    const results = await Promise.all(
      all.map(async (p) => {
        try {
          const ok = await p.isAvailable();
          return ok ? p : null;
        } catch {
          return null;
        }
      }),
    );
    return results.filter((p): p is LLMProviderPlugin => p !== null);
  }
}

/**
 * Process-wide singleton. We attach it to `globalThis` so that Next.js
 * hot-reload in dev does not create duplicate registries — the same
 * pattern used by `src/lib/db.ts` for the PrismaClient.
 */
const GLOBAL_KEY = '__pdb_plugin_registry__';
const g = globalThis as unknown as { [GLOBAL_KEY]?: PluginRegistry };

export const pluginRegistry: PluginRegistry =
  g[GLOBAL_KEY] ?? (g[GLOBAL_KEY] = new PluginRegistry());

/**
 * Convenience helper — call the first available provider from a list
 * of ids (or all providers, if `ids` is omitted). Returns the first
 * non-throwing result, mirroring the fall-through behaviour of the
 * built-in provider walker in `src/lib/llm.ts`.
 */
export async function callWithPlugin(
  prompt: string,
  ids?: string[],
  options?: { system?: string; model?: string; temperature?: number },
): Promise<{
  providerId: string;
  content: string;
  tokensUsed?: number;
  durationMs: number;
}> {
  const candidates = ids && ids.length > 0
    ? ids
        .map((id) => pluginRegistry.get(id))
        .filter((p): p is LLMProviderPlugin => Boolean(p))
    : pluginRegistry.list();

  if (candidates.length === 0) {
    throw new Error('plugin-system: no LLM provider plugins registered');
  }

  let lastError: unknown = null;
  for (const p of candidates) {
    try {
      const available = await p.isAvailable();
      if (!available) continue;
      const result = await p.call(prompt, options);
      return { providerId: p.id, ...result };
    } catch (err) {
      lastError = err;
      // fall through to next candidate
    }
  }
  throw new Error(
    `plugin-system: all candidate providers failed${
      lastError ? ` (last error: ${lastError instanceof Error ? lastError.message : String(lastError)})` : ''
    }`,
  );
}
