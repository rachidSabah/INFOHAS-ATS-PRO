// ProviderFactory — maps a provider type string to its adapter instance.
// To add a new provider type, register it here. No other code changes needed.
import type { AIProviderAdapter } from "../providers/interface";
import { OpenAICompatibleProvider, openaiProvider, deepseekProvider, groqProvider, openrouterProvider, togetherProvider, huggingfaceProvider, mistralProvider, cohereProvider, perplexityProvider, ProviderError } from "../providers/openai-compatible";
import { claudeProvider } from "../providers/claude";
import { geminiProvider } from "../providers/gemini";
import { ollamaProvider } from "../providers/ollama";
import { puterProvider } from "../providers/puter";
import { customProvider } from "../providers/custom";
import { zaiFallbackProvider } from "../providers/zai-fallback";

// OpenCode Zen uses the OpenAI-compatible API schema
const opencodeProvider = new OpenAICompatibleProvider("opencode");

const REGISTRY: Record<string, AIProviderAdapter> = {
  openai: openaiProvider,
  opencode: opencodeProvider,   // OpenCode Zen — OpenAI-compatible, free models
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

export { ProviderError };
