/**
 * Credentials store — a file-based store for provider API keys + baseURL
 * overrides, persisted to `.hermes/agent-providers.json`.
 *
 * Mirrors dsh's `credentials` capability: API keys are resolved per-request
 * from the store (or the environment as fallback), never hardcoded.
 *
 * The store is a simple JSON file:
 *   {
 *     "deepseek": { "apiKey": "sk-...", "baseURL": "https://..." },
 *     "openai": { "apiKey": "sk-...", "baseURL": "https://..." }
 *   }
 *
 * The 'zai' provider uses the z-ai SDK's built-in auth (the .z-ai-config
 * file) and does NOT need an explicit API key — it's always available.
 */

import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ProviderProfile } from './catalog';
import { PROVIDER_CATALOG, getProviderProfile } from './catalog';

export interface ProviderConfig {
  /** The API key for this provider. */
  apiKey?: string;
  /** Override the default baseURL. */
  baseURL?: string;
  /** Override the default model for this provider. */
  defaultModel?: string;
  /** Whether this provider is enabled (default: true if apiKey is set). */
  enabled?: boolean;
}

export type ProviderConfigMap = Record<string, ProviderConfig>;

const CONFIG_DIR = resolve(process.cwd(), '.hermes');
const CONFIG_FILE = resolve(CONFIG_DIR, 'agent-providers.json');
const DEFAULT_FILE = resolve(CONFIG_DIR, 'agent-default-provider.json');

/** In-memory cache for default provider. */
let cachedDefaultProvider: string | null | undefined = undefined;
let cachedDefaultMtime = 0;

/** Get the default provider ID. Returns null if not set. */
export function getDefaultProvider(): string | null {
  try {
    if (!existsSync(DEFAULT_FILE)) return null;
    const stat = statSync(DEFAULT_FILE);
    if (cachedDefaultProvider !== undefined && stat.mtimeMs === cachedDefaultMtime) {
      return cachedDefaultProvider;
    }
    const raw = readFileSync(DEFAULT_FILE, 'utf-8');
    const data = JSON.parse(raw) as { providerId?: string };
    cachedDefaultProvider = data.providerId ?? null;
    cachedDefaultMtime = stat.mtimeMs;
    return cachedDefaultProvider;
  } catch {
    return null;
  }
}

/** Set the default provider ID. */
export function setDefaultProvider(providerId: string | null): void {
  try {
    if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(DEFAULT_FILE, JSON.stringify({ providerId }, null, 2), { encoding: 'utf-8', mode: 0o600 });
    cachedDefaultProvider = providerId;
    cachedDefaultMtime = statSync(DEFAULT_FILE).mtimeMs;
  } catch (err) {
    console.error('[provider-config] setDefaultProvider failed:', err);
  }
}

/** In-memory cache with mtime invalidation — eliminates repeated disk reads. */
let cachedConfigs: ProviderConfigMap | null = null;
let cachedMtime = 0;

/** Load the provider config from disk (with in-memory caching). */
export function loadProviderConfigs(): ProviderConfigMap {
  try {
    if (!existsSync(CONFIG_FILE)) {
      cachedConfigs = {};
      cachedMtime = 0;
      return {};
    }
    const stat = statSync(CONFIG_FILE);
    if (cachedConfigs && stat.mtimeMs === cachedMtime) {
      return cachedConfigs;
    }
    const raw = readFileSync(CONFIG_FILE, 'utf-8');
    cachedConfigs = JSON.parse(raw) as ProviderConfigMap;
    cachedMtime = stat.mtimeMs;
    return cachedConfigs;
  } catch {
    return {};
  }
}

/** Save the provider config to disk with restrictive permissions + invalidate cache. */
export function saveProviderConfigs(configs: ProviderConfigMap): void {
  try {
    if (!existsSync(CONFIG_DIR)) mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    writeFileSync(CONFIG_FILE, JSON.stringify(configs, null, 2), { encoding: 'utf-8', mode: 0o600 });
    // Invalidate cache so next read picks up the new file.
    cachedConfigs = null;
    cachedMtime = 0;
  } catch (err) {
    console.error('[provider-config] save failed:', err);
  }
}

/** Get the config for a single provider. */
export function getProviderConfig(providerId: string): ProviderConfig {
  const configs = loadProviderConfigs();
  return configs[providerId] ?? {};
}

/** Set the config for a single provider (merges with existing). */
export function setProviderConfig(providerId: string, config: ProviderConfig): void {
  const configs = loadProviderConfigs();
  configs[providerId] = { ...configs[providerId], ...config };
  saveProviderConfigs(configs);
}

/** Delete a provider's config. */
export function deleteProviderConfig(providerId: string): void {
  const configs = loadProviderConfigs();
  delete configs[providerId];
  saveProviderConfigs(configs);
}

/**
 * Resolve the effective API key for a provider: explicit config → env var →
 * null. The 'zai' provider uses the z-ai SDK's built-in auth.
 */
export function resolveApiKey(providerId: string): string | null {
  if (providerId === 'zai') return 'zai-sdk-internal'; // z-ai SDK handles auth
  const config = getProviderConfig(providerId);
  if (config.apiKey) return config.apiKey;
  const profile = getProviderProfile(providerId);
  if (profile) {
    const envKey = process.env[profile.apiKeyEnv];
    if (envKey) return envKey;
  }
  return null;
}

/** Resolve the effective baseURL for a provider: config override → catalog default. */
export function resolveBaseURL(providerId: string): string | null {
  const config = getProviderConfig(providerId);
  if (config.baseURL) return config.baseURL;
  const profile = getProviderProfile(providerId);
  return profile?.baseURL ?? null;
}

/** Check if a provider is available (has an API key or is 'zai'). */
export function isProviderAvailable(providerId: string): boolean {
  if (providerId === 'zai') return true; // always available via z-ai SDK
  const config = getProviderConfig(providerId);
  if (config.enabled === false) return false;
  if (config.apiKey) return true;
  const profile = getProviderProfile(providerId);
  if (profile && process.env[profile.apiKeyEnv]) return true;
  return false;
}

/** List all available providers (has auth or is 'zai'). */
export function listAvailableProviders(): ProviderProfile[] {
  return PROVIDER_CATALOG.filter((p) => isProviderAvailable(p.id));
}

/** List all providers with their availability status (for UI). */
export function listAllProvidersWithStatus(): Array<ProviderProfile & {
  available: boolean;
  hasApiKey: boolean;
  hasBaseURLOverride: boolean;
  effectiveModel: string;
}> {
  return PROVIDER_CATALOG.map((p) => {
    const config = getProviderConfig(p.id);
    return {
      ...p,
      available: isProviderAvailable(p.id),
      hasApiKey: !!config.apiKey || (!!process.env[p.apiKeyEnv] && p.id !== 'zai'),
      hasBaseURLOverride: !!config.baseURL,
      effectiveModel: config.defaultModel ?? p.defaultModel,
    };
  });
}

export { CONFIG_FILE };
