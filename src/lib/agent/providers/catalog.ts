/**
 * Provider catalog — the built-in list of LLM providers, their default
 * baseURLs, auth header formats, and default models.
 *
 * Inspired by dsh's pi-ai catalog: each provider has an `api` (wire protocol),
 * a default `baseURL`, an `apiKeyEnv` (the env var that holds the key), and a
 * list of `models` with display names + context windows.
 *
 * All providers here use the OpenAI-compatible `chat/completions` wire format,
 * so a single `OpenAICompatAdapter` can serve them all — only the baseURL,
 * auth header, and model list differ.
 */

export interface ProviderModel {
  id: string;
  name: string;
  contextWindow?: number;
}

export interface ProviderProfile {
  /** Provider route id (e.g. 'deepseek', 'openai'). */
  id: string;
  /** Human-readable display name. */
  displayName: string;
  /** Default base URL for the API. */
  baseURL: string;
  /** The env var that typically holds the API key. */
  apiKeyEnv: string;
  /** Auth header name (default: 'Authorization'). */
  authHeader?: string;
  /** Auth header value prefix (default: 'Bearer '). */
  authPrefix?: string;
  /** Default model id (used when settings don't specify one). */
  defaultModel: string;
  /** Known models for this provider. */
  models: ProviderModel[];
  /** Optional: extra headers to send (e.g. Anthropic's version header). */
  extraHeaders?: Record<string, string>;
  /** Whether this provider supports tool/function calling. */
  supportsToolCalling: boolean;
  /** Icon/emoji for UI display. */
  icon: string;
  /** Documentation URL for getting an API key. */
  docsUrl: string;
}

/** The built-in provider catalog. */
export const PROVIDER_CATALOG: ProviderProfile[] = [
  {
    id: 'zai',
    displayName: 'Z.ai (GLM)',
    baseURL: 'https://internal-api.z.ai/v1',
    apiKeyEnv: 'ZAI_API_KEY',
    defaultModel: 'glm-4.6',
    models: [
      { id: 'glm-4.6', name: 'GLM-4.6', contextWindow: 128000 },
      { id: 'glm-4.5', name: 'GLM-4.5', contextWindow: 128000 },
      { id: 'glm-4-flash', name: 'GLM-4 Flash', contextWindow: 128000 },
    ],
    supportsToolCalling: true,
    icon: '🤖',
    docsUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
  },
  {
    id: 'deepseek',
    displayName: 'DeepSeek',
    baseURL: 'https://api.deepseek.com/v1',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    defaultModel: 'deepseek-chat',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek-V3 (Chat)', contextWindow: 64000 },
      { id: 'deepseek-reasoner', name: 'DeepSeek-R1 (Reasoner)', contextWindow: 64000 },
    ],
    supportsToolCalling: true,
    icon: '🐋',
    docsUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'openai',
    displayName: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4o',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000 },
      { id: 'gpt-4o-mini', name: 'GPT-4o mini', contextWindow: 128000 },
      { id: 'gpt-4.1', name: 'GPT-4.1', contextWindow: 1047576 },
      { id: 'o3-mini', name: 'o3-mini', contextWindow: 200000 },
    ],
    supportsToolCalling: true,
    icon: '🟢',
    docsUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'anthropic',
    displayName: 'Anthropic (Claude)',
    baseURL: 'https://api.anthropic.com/v1',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    authHeader: 'x-api-key',
    authPrefix: '',
    defaultModel: 'claude-sonnet-4-20250514',
    models: [
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', contextWindow: 200000 },
      { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', contextWindow: 200000 },
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', contextWindow: 200000 },
    ],
    supportsToolCalling: true,
    extraHeaders: { 'anthropic-version': '2023-06-01' },
    icon: '🟠',
    docsUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'qwen',
    displayName: 'Qwen (Alibaba)',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyEnv: 'DASHSCOPE_API_KEY',
    defaultModel: 'qwen-plus',
    models: [
      { id: 'qwen-plus', name: 'Qwen Plus', contextWindow: 131072 },
      { id: 'qwen-max', name: 'Qwen Max', contextWindow: 32768 },
      { id: 'qwen-turbo', name: 'Qwen Turbo', contextWindow: 1000000 },
    ],
    supportsToolCalling: true,
    icon: '🔮',
    docsUrl: 'https://dashscope.console.aliyun.com/apiKey',
  },
  {
    id: 'moonshot',
    displayName: 'Moonshot (Kimi)',
    baseURL: 'https://api.moonshot.cn/v1',
    apiKeyEnv: 'MOONSHOT_API_KEY',
    defaultModel: 'moonshot-v1-8k',
    models: [
      { id: 'moonshot-v1-8k', name: 'Moonshot v1 (8k)', contextWindow: 8000 },
      { id: 'moonshot-v1-32k', name: 'Moonshot v1 (32k)', contextWindow: 32000 },
      { id: 'moonshot-v1-128k', name: 'Moonshot v1 (128k)', contextWindow: 128000 },
    ],
    supportsToolCalling: true,
    icon: '🌙',
    docsUrl: 'https://platform.moonshot.cn/console/api-keys',
  },
  {
    id: 'zhipu',
    displayName: 'Zhipu AI (GLM)',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    apiKeyEnv: 'ZHIPU_API_KEY',
    defaultModel: 'glm-4',
    models: [
      { id: 'glm-4', name: 'GLM-4', contextWindow: 128000 },
      { id: 'glm-4-air', name: 'GLM-4 Air', contextWindow: 128000 },
      { id: 'glm-4-flash', name: 'GLM-4 Flash', contextWindow: 128000 },
    ],
    supportsToolCalling: true,
    icon: '✨',
    docsUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
  },
  {
    id: 'siliconflow',
    displayName: 'SiliconFlow',
    baseURL: 'https://api.siliconflow.cn/v1',
    apiKeyEnv: 'SILICONFLOW_API_KEY',
    defaultModel: 'deepseek-ai/DeepSeek-V3',
    models: [
      { id: 'deepseek-ai/DeepSeek-V3', name: 'DeepSeek V3', contextWindow: 64000 },
      { id: 'deepseek-ai/DeepSeek-R1', name: 'DeepSeek R1', contextWindow: 64000 },
      { id: 'Qwen/Qwen2.5-72B-Instruct', name: 'Qwen 2.5 72B', contextWindow: 32768 },
    ],
    supportsToolCalling: true,
    icon: '🔮',
    docsUrl: 'https://cloud.siliconflow.cn/account/ak',
  },
  {
    id: 'together',
    displayName: 'Together AI',
    baseURL: 'https://api.together.xyz/v1',
    apiKeyEnv: 'TOGETHER_API_KEY',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    models: [
      { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', name: 'Llama 3.3 70B', contextWindow: 131072 },
      { id: 'deepseek-ai/DeepSeek-R1', name: 'DeepSeek R1', contextWindow: 131072 },
    ],
    supportsToolCalling: true,
    icon: '🤝',
    docsUrl: 'https://api.together.xyz/settings/api-keys',
  },
  {
    id: 'ollama',
    displayName: 'Ollama (Local)',
    baseURL: 'http://localhost:11434/v1',
    apiKeyEnv: 'OLLAMA_API_KEY',
    defaultModel: 'llama3.2',
    models: [
      { id: 'llama3.2', name: 'Llama 3.2', contextWindow: 128000 },
      { id: 'qwen2.5', name: 'Qwen 2.5', contextWindow: 32768 },
      { id: 'deepseek-r1', name: 'DeepSeek R1', contextWindow: 128000 },
    ],
    supportsToolCalling: true,
    icon: '🦙',
    docsUrl: 'https://ollama.com',
  },
];

/** Get a provider profile by id. */
export function getProviderProfile(id: string): ProviderProfile | undefined {
  return PROVIDER_CATALOG.find((p) => p.id === id);
}

/** List all provider ids. */
export function getProviderIds(): string[] {
  return PROVIDER_CATALOG.map((p) => p.id);
}
