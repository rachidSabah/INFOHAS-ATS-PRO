// ProviderFactory — maps a provider type string to its adapter instance.
// To add a new provider type, register it here. No other code changes needed.
import type { AIProviderAdapter } from "../providers/interface";
import { OpenAICompatibleProvider, openaiProvider, deepseekProvider, groqProvider, openrouterProvider, togetherProvider, huggingfaceProvider, mistralProvider, cohereProvider, perplexityProvider, ProviderError, classifyProviderError, PROVIDER_ERROR_CATEGORY_LABELS } from "../providers/openai-compatible";
import { claudeProvider } from "../providers/claude";
import { geminiProvider } from "../providers/gemini";
import { ollamaProvider } from "../providers/ollama";
import { puterProvider } from "../providers/puter";
import { workersAIProvider } from "../providers/workers-ai";
import { customProvider } from "../providers/custom";
import { zaiFallbackProvider } from "../providers/zai-fallback";

// OpenCode Zen uses the OpenAI-compatible API schema
const opencodeProvider = new OpenAICompatibleProvider("opencode");
const opencodeZenProvider = new OpenAICompatibleProvider("opencode-zen");
const zencodeProvider = new OpenAICompatibleProvider("zencode");
const nvidiaProvider = new OpenAICompatibleProvider("nvidia");
const githubProvider = new OpenAICompatibleProvider("github");

const REGISTRY: Record<string, AIProviderAdapter> = {
  openai: openaiProvider,
  // NOTE: the Antigravity CLI and Z.ai Web integrations were fully removed
  // from the product — their dedicated adapters and registry entries are gone.
  opencode: opencodeProvider,   // OpenCode Zen — OpenAI-compatible, free models
  "opencode-zen": opencodeZenProvider,
  zencode: zencodeProvider,
  nvidia: nvidiaProvider,
  github: githubProvider,
  deepseek: deepseekProvider,
  groq: groqProvider,
  openrouter: openrouterProvider,
  together: togetherProvider,
  huggingface: huggingfaceProvider,
  mistral: mistralProvider,
  cohere: cohereProvider,
  perplexity: perplexityProvider,
  claude: claudeProvider,
  "azure-openai": openaiProvider,
  gemini: geminiProvider,
  ollama: ollamaProvider,
  puter: puterProvider,
  // Workers AI — Cloudflare-native rescue tier (in-account [ai] binding, free
  // neurons/day quota → reserved as failover, never a primary engine).
  "workers-ai": workersAIProvider,
  custom: customProvider,
  bedrock: customProvider,
  "z-ai-fallback": zaiFallbackProvider,
};

export class ProviderFactory {
  static get(type: string): AIProviderAdapter {
    const adapter = REGISTRY[type];
    if (!adapter) {
      // Unknown type — fall back to custom adapter (user can configure requestTemplate)
      return customProvider;
    }
    return adapter;
  }

  static register(type: string, adapter: AIProviderAdapter) {
    REGISTRY[type] = adapter;
  }

  static listTypes(): string[] {
    return Object.keys(REGISTRY);
  }
}

export { ProviderError, classifyProviderError, PROVIDER_ERROR_CATEGORY_LABELS };
