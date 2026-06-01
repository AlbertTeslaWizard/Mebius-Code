export interface ModelProviderPreset {
  id: string;
  displayName: string;
  description: string;
  aliases: string[];
  baseUrl?: string;
  recommendedModels: string[];
  supportsTools: boolean;
  requiresCustomBaseUrl?: boolean;
}

export interface ModelProviderOption {
  id: string;
  displayName: string;
  description: string;
  aliases: string[];
  baseUrl?: string;
  recommendedModels: string[];
  supportsTools: boolean;
  requiresCustomBaseUrl: boolean;
}

export const MODEL_PROVIDER_PRESETS: ModelProviderPreset[] = [
  {
    id: 'openai',
    displayName: 'OpenAI',
    description: 'OpenAI-compatible API for GPT models.',
    aliases: ['gpt', 'chatgpt', 'open ai'],
    baseUrl: 'https://api.openai.com/v1',
    recommendedModels: ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4o', 'gpt-4o-mini'],
    supportsTools: true,
  },
  {
    id: 'openrouter',
    displayName: 'OpenRouter',
    description: 'OpenAI-compatible routing gateway for many hosted models.',
    aliases: ['router', 'open router', '模型路由'],
    baseUrl: 'https://openrouter.ai/api/v1',
    recommendedModels: ['openai/gpt-4.1-mini', 'anthropic/claude-sonnet-4.5', 'deepseek/deepseek-chat'],
    supportsTools: true,
  },
  {
    id: 'deepseek',
    displayName: 'DeepSeek',
    description: 'DeepSeek OpenAI-compatible API.',
    aliases: ['deep seek', '深度求索', '深度'],
    baseUrl: 'https://api.deepseek.com',
    recommendedModels: ['deepseek-chat', 'deepseek-reasoner'],
    supportsTools: true,
  },
  {
    id: 'moonshot',
    displayName: 'Moonshot AI',
    description: 'Moonshot Kimi OpenAI-compatible API.',
    aliases: ['kimi', 'moonshot', '月之暗面', '月之'],
    baseUrl: 'https://api.moonshot.cn/v1',
    recommendedModels: ['kimi-k2-0711-preview', 'moonshot-v1-8k', 'moonshot-v1-32k'],
    supportsTools: true,
  },
  {
    id: 'dashscope',
    displayName: 'DashScope',
    description: 'Alibaba Cloud Bailian OpenAI-compatible API for Qwen models.',
    aliases: ['qwen', '通义千问', '通义', '百炼', '阿里云'],
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    recommendedModels: ['qwen-plus', 'qwen-turbo', 'qwen-max'],
    supportsTools: true,
  },
  {
    id: 'siliconflow',
    displayName: 'SiliconFlow',
    description: 'SiliconFlow OpenAI-compatible model hosting API.',
    aliases: ['silicon flow', '硅基流动', '硅基'],
    baseUrl: 'https://api.siliconflow.cn/v1',
    recommendedModels: ['Qwen/Qwen2.5-Coder-32B-Instruct', 'deepseek-ai/DeepSeek-V3'],
    supportsTools: true,
  },
  {
    id: 'custom',
    displayName: 'Custom OpenAI-compatible',
    description: 'Use any OpenAI-compatible endpoint by entering a base URL and model name.',
    aliases: ['自定义', 'custom provider', 'openai compatible', '兼容接口'],
    recommendedModels: [],
    supportsTools: true,
    requiresCustomBaseUrl: true,
  },
];

export function toProviderOption(provider: ModelProviderPreset): ModelProviderOption {
  return {
    id: provider.id,
    displayName: provider.displayName,
    description: provider.description,
    aliases: provider.aliases,
    baseUrl: provider.baseUrl,
    recommendedModels: provider.recommendedModels,
    supportsTools: provider.supportsTools,
    requiresCustomBaseUrl: provider.requiresCustomBaseUrl ?? false,
  };
}
