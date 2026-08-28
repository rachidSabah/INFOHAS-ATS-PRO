// Single source of truth for AI provider type metadata (catalog).
// Both the AI Providers table (AIProviders.tsx) and the Add/Edit Provider
// editor (AIProviderEditor.tsx) import this so:
//   - The auto-inserted Base URL / default model / auth type is ALWAYS correct
//     for the selected provider type (requirement: baseUrl inserted dynamically
//     from the online provider catalog).
//   - The two lists can NEVER drift (a previously-missing type such as nvidia /
//     zencode / opencode / opencode-zen / github rendered as a blank icon in the
//     table while being present in the editor).
//
// Keep this list in sync with AIProviderType in lib/types.ts.

export type ProviderCatalogEntry = {
  type: string;
  label: string;
  icon: string;
  defaultUrl: string;
  defaultModel: string;
  authType: "bearer" | "header" | "query" | "none";
};

export const PROVIDER_CATALOG: ProviderCatalogEntry[] = [
  // defaultUrl is the LIVE Cloud Code PA endpoint (matches the seeded provider
  // config + SSRF allowlist). The previous api.antigravity.io/v1 entry was a
  // dead host — endpoint "repair" toward it could never validate, so
  // Antigravity providers always froze at CONFIGURATION ERROR.
  { type: "antigravity", label: "Antigravity CLI (Token)", icon: "Terminal", defaultUrl: "https://cloudcode-pa.googleapis.com", defaultModel: "claude-sonnet-4", authType: "bearer" },
  { type: "puter", label: "Puter.js (Free)", icon: "Sparkles", defaultUrl: "https://api.puter.com", defaultModel: "claude-sonnet-4", authType: "none" },
  { type: "opencode", label: "OpenCode Zen (Free models)", icon: "Gift", defaultUrl: "https://opencode.ai/zen/v1", defaultModel: "deepseek-v4-flash-free", authType: "bearer" },
  { type: "opencode-zen", label: "OpenCode Zen (Free)", icon: "Gift", defaultUrl: "https://opencode.ai/zen/v1", defaultModel: "deepseek-v4-flash-free", authType: "bearer" },
  { type: "nvidia", label: "NVIDIA NIM (Free)", icon: "Bot", defaultUrl: "https://integrate.api.nvidia.com/v1", defaultModel: "nvidia/nemotron-3-super-120b-a12b", authType: "bearer" },
  { type: "zencode", label: "ZenCode API", icon: "Zap", defaultUrl: "https://opencode.ai/zen/v1", defaultModel: "deepseek-v4-flash-free", authType: "bearer" },
  { type: "openai", label: "OpenAI", icon: "Bot", defaultUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o-mini", authType: "bearer" },
  { type: "github", label: "GitHub Models", icon: "Github", defaultUrl: "https://models.inference.ai.azure.com", defaultModel: "gpt-4o", authType: "bearer" },
  { type: "claude", label: "Anthropic Claude", icon: "Bot", defaultUrl: "https://api.anthropic.com/v1", defaultModel: "claude-3-5-sonnet-20241022", authType: "header" },
  { type: "gemini", label: "Google Gemini", icon: "Bot", defaultUrl: "https://generativelanguage.googleapis.com/v1beta", defaultModel: "gemini-2.0-flash", authType: "query" },
  { type: "deepseek", label: "DeepSeek", icon: "Bot", defaultUrl: "https://api.deepseek.com/v1", defaultModel: "deepseek-chat", authType: "bearer" },
  { type: "groq", label: "Groq", icon: "Zap", defaultUrl: "https://api.groq.com/openai/v1", defaultModel: "llama-3.3-70b-versatile", authType: "bearer" },
  { type: "mistral", label: "Mistral AI", icon: "Bot", defaultUrl: "https://api.mistral.ai/v1", defaultModel: "mistral-large-latest", authType: "bearer" },
  { type: "cohere", label: "Cohere", icon: "Bot", defaultUrl: "https://api.cohere.com/v2", defaultModel: "command-r-plus", authType: "bearer" },
  { type: "perplexity", label: "Perplexity", icon: "Search", defaultUrl: "https://api.perplexity.ai", defaultModel: "llama-3.1-sonar-large-128k-online", authType: "bearer" },
  { type: "openrouter", label: "OpenRouter", icon: "Network", defaultUrl: "https://openrouter.ai/api/v1", defaultModel: "anthropic/claude-3.5-sonnet", authType: "bearer" },
  { type: "together", label: "Together AI", icon: "Users", defaultUrl: "https://api.together.xyz/v1", defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo", authType: "bearer" },
  { type: "huggingface", label: "HuggingFace", icon: "Box", defaultUrl: "https://api-inference.huggingface.co/models", defaultModel: "meta-llama/Llama-3.3-70B-Instruct", authType: "bearer" },
  { type: "cerebras", label: "Cerebras (Free)", icon: "Zap", defaultUrl: "https://api.cerebras.ai/v1", defaultModel: "qwen-3-235b", authType: "bearer" },
  { type: "sambanova", label: "SambaNova (Free)", icon: "Zap", defaultUrl: "https://api.sambanova.ai/v1", defaultModel: "Meta-Llama-4-Maverick-17B-128E-Instruct", authType: "bearer" },
  { type: "ollama", label: "Ollama (self-hosted)", icon: "HardDrive", defaultUrl: "http://localhost:11434", defaultModel: "llama3.3:70b", authType: "none" },
  { type: "azure-openai", label: "Azure OpenAI", icon: "Cloud", defaultUrl: "https://{resource}.openai.azure.com/openai/deployments/{deployment}", defaultModel: "gpt-4o", authType: "header" },
  { type: "bedrock", label: "AWS Bedrock", icon: "Cloud", defaultUrl: "https://bedrock-runtime.us-east-1.amazonaws.com", defaultModel: "anthropic.claude-3-5-sonnet-20241022-v1:0", authType: "bearer" },
  { type: "custom", label: "Custom / self-hosted LLM", icon: "Settings", defaultUrl: "", defaultModel: "", authType: "bearer" },
];

/** Look up a catalog entry by provider type (falls back to custom). */
export function getProviderCatalogEntry(type: string): ProviderCatalogEntry {
  return PROVIDER_CATALOG.find((e) => e.type === type) ?? PROVIDER_CATALOG[PROVIDER_CATALOG.length - 1];
}
