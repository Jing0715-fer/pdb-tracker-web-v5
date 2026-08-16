/**
 * Provider catalog — the built-in list of LLM providers, their default
 * baseURLs, auth header formats, and default models.
 *
 * Inspired by dsh's pi-ai catalog (@earendil-works/pi-ai builtinProviders):
 * the full list includes 40+ providers. We include the most commonly used
 * ones that support the OpenAI-compatible /chat/completions wire format.
 *
 * Each provider has a short text label (first 1-2 letters) instead of an
 * emoji — clean, professional, and consistent with the app's Claude theme.
 */

export interface ProviderModel {
  id: string;
  name: string;
  contextWindow?: number;
}

export interface ProviderProfile {
  id: string;
  displayName: string;
  /** Short text label (1-2 chars) for UI display. */
  label: string;
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
  /** Optional: extra headers to send. */
  extraHeaders?: Record<string, string>;
  /** Whether this provider supports tool/function calling. */
  supportsToolCalling: boolean;
  /** Documentation URL for getting an API key. */
  docsUrl: string;
}

/** The built-in provider catalog. */
export const PROVIDER_CATALOG: ProviderProfile[] = [
  {
    id: 'zai',
    displayName: 'Z.ai (GLM)',
    label: 'ZAI',
    baseURL: 'https://internal-api.z.ai/v1',
    apiKeyEnv: 'ZAI_API_KEY',
    defaultModel: 'glm-4.6',
    models: [
      { id: 'glm-4.6', name: 'GLM-4.6', contextWindow: 128000 },
      { id: 'glm-4.5', name: 'GLM-4.5', contextWindow: 128000 },
      { id: 'glm-4-flash', name: 'GLM-4 Flash', contextWindow: 128000 },
      { id: 'glm-4-plus', name: 'GLM-4 Plus', contextWindow: 128000 },
      { id: 'glm-4-air', name: 'GLM-4 Air', contextWindow: 128000 },
    ],
    supportsToolCalling: true,
    docsUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
  },
  {
    id: 'deepseek',
    displayName: 'DeepSeek',
    label: 'DS',
    baseURL: 'https://api.deepseek.com/v1',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    defaultModel: 'deepseek-chat',
    models: [
      { id: 'deepseek-chat', name: 'DeepSeek-V3 (Chat)', contextWindow: 64000 },
      { id: 'deepseek-reasoner', name: 'DeepSeek-R1 (Reasoner)', contextWindow: 64000 },
      { id: 'deepseek-coder', name: 'DeepSeek Coder', contextWindow: 64000 },
    ],
    supportsToolCalling: true,
    docsUrl: 'https://platform.deepseek.com/api_keys',
  },
  {
    id: 'openai',
    displayName: 'OpenAI',
    label: 'AI',
    baseURL: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4o',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o', contextWindow: 128000 },
      { id: 'gpt-4o-mini', name: 'GPT-4o mini', contextWindow: 128000 },
      { id: 'gpt-4.1', name: 'GPT-4.1', contextWindow: 1047576 },
      { id: 'gpt-4.1-mini', name: 'GPT-4.1 mini', contextWindow: 1047576 },
      { id: 'o3-mini', name: 'o3-mini', contextWindow: 200000 },
      { id: 'o1', name: 'o1', contextWindow: 200000 },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', contextWindow: 128000 },
    ],
    supportsToolCalling: true,
    docsUrl: 'https://platform.openai.com/api-keys',
  },
  {
    id: 'anthropic',
    displayName: 'Anthropic',
    label: 'AN',
    baseURL: 'https://api.anthropic.com/v1',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    authHeader: 'x-api-key',
    authPrefix: '',
    defaultModel: 'claude-sonnet-4-20250514',
    models: [
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', contextWindow: 200000 },
      { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', contextWindow: 200000 },
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', contextWindow: 200000 },
      { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', contextWindow: 200000 },
      { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', contextWindow: 200000 },
    ],
    supportsToolCalling: true,
    extraHeaders: { 'anthropic-version': '2023-06-01' },
    docsUrl: 'https://console.anthropic.com/settings/keys',
  },
  {
    id: 'google',
    displayName: 'Google (Gemini)',
    label: 'GG',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    apiKeyEnv: 'GOOGLE_API_KEY',
    defaultModel: 'gemini-2.0-flash',
    models: [
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', contextWindow: 1048576 },
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', contextWindow: 1048576 },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash', contextWindow: 1048576 },
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro', contextWindow: 2000000 },
      { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash', contextWindow: 1000000 },
    ],
    supportsToolCalling: true,
    docsUrl: 'https://aistudio.google.com/apikey',
  },
  {
    id: 'qwen',
    displayName: 'Qwen (Alibaba)',
    label: 'QW',
    baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyEnv: 'DASHSCOPE_API_KEY',
    defaultModel: 'qwen-plus',
    models: [
      { id: 'qwen-plus', name: 'Qwen Plus', contextWindow: 131072 },
      { id: 'qwen-max', name: 'Qwen Max', contextWindow: 32768 },
      { id: 'qwen-turbo', name: 'Qwen Turbo', contextWindow: 1000000 },
      { id: 'qwen2.5-72b-instruct', name: 'Qwen 2.5 72B', contextWindow: 131072 },
      { id: 'qwen-coder-plus', name: 'Qwen Coder Plus', contextWindow: 131072 },
    ],
    supportsToolCalling: true,
    docsUrl: 'https://dashscope.console.aliyun.com/apiKey',
  },
  {
    id: 'moonshot',
    displayName: 'Moonshot (Kimi)',
    label: 'MS',
    baseURL: 'https://api.moonshot.cn/v1',
    apiKeyEnv: 'MOONSHOT_API_KEY',
    defaultModel: 'moonshot-v1-8k',
    models: [
      { id: 'moonshot-v1-8k', name: 'Moonshot v1 (8k)', contextWindow: 8000 },
      { id: 'moonshot-v1-32k', name: 'Moonshot v1 (32k)', contextWindow: 32000 },
      { id: 'moonshot-v1-128k', name: 'Moonshot v1 (128k)', contextWindow: 128000 },
      { id: 'kimi-k2-0905-preview', name: 'Kimi K2', contextWindow: 131072 },
    ],
    supportsToolCalling: true,
    docsUrl: 'https://platform.moonshot.cn/console/api-keys',
  },
  {
    id: 'zhipu',
    displayName: 'Zhipu AI',
    label: 'ZP',
    baseURL: 'https://open.bigmodel.cn/api/paas/v4',
    apiKeyEnv: 'ZHIPU_API_KEY',
    defaultModel: 'glm-4',
    models: [
      { id: 'glm-4', name: 'GLM-4', contextWindow: 128000 },
      { id: 'glm-4-air', name: 'GLM-4 Air', contextWindow: 128000 },
      { id: 'glm-4-flash', name: 'GLM-4 Flash', contextWindow: 128000 },
      { id: 'glm-4-plus', name: 'GLM-4 Plus', contextWindow: 128000 },
      { id: 'glm-4v', name: 'GLM-4V (Vision)', contextWindow: 128000 },
    ],
    supportsToolCalling: true,
    docsUrl: 'https://open.bigmodel.cn/usercenter/apikeys',
  },
  {
    id: 'minimax',
    displayName: 'MiniMax',
    label: 'MM',
    baseURL: 'https://api.minimax.chat/v1',
    apiKeyEnv: 'MINIMAX_API_KEY',
    defaultModel: 'MiniMax-Text-01',
    models: [
      { id: 'MiniMax-Text-01', name: 'MiniMax Text 01', contextWindow: 1000000 },
      { id: 'abab6.5s-chat', name: 'abab6.5s', contextWindow: 245760 },
      { id: 'abab6.5g-chat', name: 'abab6.5g', contextWindow: 245760 },
    ],
    supportsToolCalling: true,
    docsUrl: 'https://platform.minimaxi.com/user-center/basic-information/interface-key',
  },
  {
    id: 'xai',
    displayName: 'xAI (Grok)',
    label: 'xA',
    baseURL: 'https://api.x.ai/v1',
    apiKeyEnv: 'XAI_API_KEY',
    defaultModel: 'grok-3',
    models: [
      { id: 'grok-3', name: 'Grok 3', contextWindow: 131072 },
      { id: 'grok-3-mini', name: 'Grok 3 Mini', contextWindow: 131072 },
      { id: 'grok-2', name: 'Grok 2', contextWindow: 131072 },
      { id: 'grok-2-vision', name: 'Grok 2 Vision', contextWindow: 32768 },
    ],
    supportsToolCalling: true,
    docsUrl: 'https://console.x.ai',
  },
  {
    id: 'mistral',
    displayName: 'Mistral',
    label: 'MI',
    baseURL: 'https://api.mistral.ai/v1',
    apiKeyEnv: 'MISTRAL_API_KEY',
    defaultModel: 'mistral-large-latest',
    models: [
      { id: 'mistral-large-latest', name: 'Mistral Large', contextWindow: 128000 },
      { id: 'mistral-small-latest', name: 'Mistral Small', contextWindow: 32000 },
      { id: 'codestral-latest', name: 'Codestral', contextWindow: 256000 },
      { id: 'open-mistral-nemo', name: 'Mistral Nemo', contextWindow: 128000 },
      { id: 'open-mixtral-8x7b', name: 'Mixtral 8x7B', contextWindow: 32768 },
    ],
    supportsToolCalling: true,
    docsUrl: 'https://console.mistral.ai/api-keys',
  },
  {
    id: 'groq',
    displayName: 'Groq',
    label: 'GQ',
    baseURL: 'https://api.groq.com/openai/v1',
    apiKeyEnv: 'GROQ_API_KEY',
    defaultModel: 'llama-3.3-70b-versatile',
    models: [
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B', contextWindow: 131072 },
      { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B', contextWindow: 131072 },
      { id: 'deepseek-r1-distill-llama-70b', name: 'DeepSeek R1 Distill', contextWindow: 131072 },
      { id: 'qwen-2.5-72b-instruct', name: 'Qwen 2.5 72B', contextWindow: 131072 },
      { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B', contextWindow: 32768 },
    ],
    supportsToolCalling: true,
    docsUrl: 'https://console.groq.com/keys',
  },
  {
    id: 'openrouter',
    displayName: 'OpenRouter',
    label: 'OR',
    baseURL: 'https://openrouter.ai/api/v1',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    defaultModel: 'deepseek/deepseek-chat',
    models: [
      { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3', contextWindow: 64000 },
      { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1', contextWindow: 64000 },
      { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', contextWindow: 200000 },
      { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', contextWindow: 200000 },
      { id: 'openai/gpt-4o', name: 'GPT-4o', contextWindow: 128000 },
      { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash', contextWindow: 1048576 },
      { id: 'meta-llama/llama-3.3-70b-instruct', name: 'Llama 3.3 70B', contextWindow: 131072 },
    ],
    supportsToolCalling: true,
    docsUrl: 'https://openrouter.ai/keys',
  },
  {
    id: 'siliconflow',
    displayName: 'SiliconFlow',
    label: 'SF',
    baseURL: 'https://api.siliconflow.cn/v1',
    apiKeyEnv: 'SILICONFLOW_API_KEY',
    defaultModel: 'deepseek-ai/DeepSeek-V3',
    models: [
      { id: 'deepseek-ai/DeepSeek-V3', name: 'DeepSeek V3', contextWindow: 64000 },
      { id: 'deepseek-ai/DeepSeek-R1', name: 'DeepSeek R1', contextWindow: 64000 },
      { id: 'Qwen/Qwen2.5-72B-Instruct', name: 'Qwen 2.5 72B', contextWindow: 32768 },
      { id: 'Qwen/Qwen2.5-Coder-32B-Instruct', name: 'Qwen 2.5 Coder 32B', contextWindow: 32768 },
      { id: 'meta-llama/Llama-3.3-70B-Instruct', name: 'Llama 3.3 70B', contextWindow: 131072 },
    ],
    supportsToolCalling: true,
    docsUrl: 'https://cloud.siliconflow.cn/account/ak',
  },
  {
    id: 'together',
    displayName: 'Together AI',
    label: 'TG',
    baseURL: 'https://api.together.xyz/v1',
    apiKeyEnv: 'TOGETHER_API_KEY',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    models: [
      { id: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', name: 'Llama 3.3 70B', contextWindow: 131072 },
      { id: 'deepseek-ai/DeepSeek-R1', name: 'DeepSeek R1', contextWindow: 131072 },
      { id: 'deepseek-ai/DeepSeek-V3', name: 'DeepSeek V3', contextWindow: 131072 },
      { id: 'Qwen/Qwen3-235B-A22B-Instruct', name: 'Qwen 3 235B', contextWindow: 131072 },
    ],
    supportsToolCalling: true,
    docsUrl: 'https://api.together.xyz/settings/api-keys',
  },
  {
    id: 'fireworks',
    displayName: 'Fireworks AI',
    label: 'FW',
    baseURL: 'https://api.fireworks.ai/inference/v1',
    apiKeyEnv: 'FIREWORKS_API_KEY',
    defaultModel: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
    models: [
      { id: 'accounts/fireworks/models/llama-v3p3-70b-instruct', name: 'Llama 3.3 70B', contextWindow: 131072 },
      { id: 'accounts/fireworks/models/deepseek-v3', name: 'DeepSeek V3', contextWindow: 64000 },
    ],
    supportsToolCalling: true,
    docsUrl: 'https://fireworks.ai/account/api-keys',
  },
  {
    id: 'ollama',
    displayName: 'Ollama (Local)',
    label: 'OL',
    baseURL: 'http://localhost:11434/v1',
    apiKeyEnv: 'OLLAMA_API_KEY',
    defaultModel: 'llama3.2',
    models: [
      { id: 'llama3.2', name: 'Llama 3.2', contextWindow: 128000 },
      { id: 'qwen2.5', name: 'Qwen 2.5', contextWindow: 32768 },
      { id: 'deepseek-r1', name: 'DeepSeek R1', contextWindow: 128000 },
    ],
    supportsToolCalling: true,
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
