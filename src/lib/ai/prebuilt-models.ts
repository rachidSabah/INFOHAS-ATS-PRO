// ============================================================================
// Prebuilt Curated Models & Agent Presets by Provider
//
// Provides curated stable model selections per AI provider type and 1-click
// agent routing presets for Puter.js (which executes client-side via window.puter
// without requiring any API keys or billing).
// ============================================================================

export interface ModelOption {
  id: string;
  label: string;
  badge?: string;
  desc?: string;
  isStable?: boolean;
}

export interface ModelGroup {
  group: string;
  models: ModelOption[];
}

export interface AgentRoutingPreset {
  id: string;
  name: string;
  shortLabel: string;
  description: string;
  badge?: string;
  routes: {
    optimizer: string;
    supervisor: string;
    guardian: string;
    assembler: string;
  };
}

/**
 * Verified stable agent pipeline presets for Puter.js.
 * Puter runs client-side in the browser via Puter.js SDK (`window.puter.ai.chat`),
 * requiring zero API keys and zero billing.
 */
export const PUTER_AGENT_PRESETS: AgentRoutingPreset[] = [
  {
    id: "puter-flagship-stable",
    name: "⚡ Stable Flagship (Recommended)",
    shortLabel: "Flagship",
    badge: "Most Accurate",
    description: "Claude Sonnet 4.5 (Optimizer) + GPT-4o (Supervisor) + Gemini 2.5 Flash (Guardian/Assembler). Maximum JSON compliance and strict ATS keyword integration.",
    routes: {
      optimizer: "claude-sonnet-4-5",
      supervisor: "gpt-4o",
      guardian: "gemini-2.5-flash",
      assembler: "gemini-2.5-flash",
    },
  },
  {
    id: "puter-high-speed",
    name: "🚀 High Speed (Gemini 2.5 Flash)",
    shortLabel: "Speed",
    badge: "Fastest",
    description: "Gemini 2.5 Flash across all 4 agents. Blazing fast generation with 1M context window and low latency.",
    routes: {
      optimizer: "gemini-2.5-flash",
      supervisor: "gemini-2.5-flash",
      guardian: "gemini-2.5-flash",
      assembler: "gemini-2.5-flash",
    },
  },
  {
    id: "puter-openai-balanced",
    name: "⚖️ OpenAI Balanced (GPT-4o & 4o-mini)",
    shortLabel: "OpenAI",
    badge: "Balanced",
    description: "GPT-4o for deep content rewriting & QA evaluation + GPT-4o-mini for quick verification and layout assembly.",
    routes: {
      optimizer: "gpt-4o",
      supervisor: "gpt-4o",
      guardian: "gpt-4o-mini",
      assembler: "gpt-4o-mini",
    },
  },
  {
    id: "puter-deepseek-power",
    name: "🧠 DeepSeek Chat",
    shortLabel: "DeepSeek",
    badge: "Strong Writing",
    description: "DeepSeek Chat for Optimizer and Supervisor + Gemini 2.5 Flash for Guardian and Assembler.",
    routes: {
      optimizer: "deepseek-chat",
      supervisor: "deepseek-chat",
      guardian: "gemini-2.5-flash",
      assembler: "gemini-2.5-flash",
    },
  },
];

/**
 * Curated prebuilt model catalogs grouped by provider type.
 * Used to populate model selectors with verified, high-compatibility models
 * so users never have to guess valid model identifiers.
 */
export const PREBUILT_MODELS_BY_PROVIDER: Record<string, ModelGroup[]> = {
  puter: [
    {
      group: "⭐ Recommended Stable (Flagship)",
      models: [
        { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", badge: "Best for Optimizer", desc: "Top tier JSON adherence, creative professional writing, bullet constraints", isStable: true },
        { id: "gpt-4o", label: "GPT-4o", badge: "Best for Supervisor", desc: "High reasoning, strict compliance evaluation, reliable JSON", isStable: true },
        { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", badge: "Best for Guardian", desc: "Ultra fast, 1M context, reliable factual checking", isStable: true },
        { id: "claude-3-7-sonnet", label: "Claude 3.7 Sonnet", badge: "Advanced", desc: "State of the art reasoning and formatting", isStable: true },
        { id: "gpt-4o-mini", label: "GPT-4o Mini", badge: "Fast", desc: "Lightweight, reliable formatting", isStable: true },
        { id: "deepseek-chat", label: "DeepSeek Chat", badge: "Versatile", desc: "Strong multilingual writing and ATS optimization", isStable: true },
      ],
    },
    {
      group: "⚡ Fast & Lightweight",
      models: [
        { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", badge: "Fastest", desc: "Sub-second response times" },
        { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", badge: "Fast", desc: "Solid multimodal and generation speed" },
      ],
    },
    {
      group: "🧠 Reasoning (Default Temperature Only)",
      models: [
        { id: "o3-mini", label: "o3-mini", badge: "Reasoning", desc: "High-power logical verification (auto-locks temp to 1.0)" },
        { id: "o4-mini", label: "o4-mini", badge: "Reasoning", desc: "Next-gen reasoning (auto-locks temp to 1.0)" },
      ],
    },
    {
      group: "📦 Other Models",
      models: [
        { id: "claude-opus-4-8", label: "Claude Opus 4.8", desc: "Deep analytical generation" },
        { id: "gpt-5.4", label: "GPT-5.4", desc: "OpenAI high tier" },
        { id: "gpt-5.4-nano", label: "GPT-5.4 Nano", desc: "Lightweight nano model" },
        { id: "gpt-5-nano", label: "GPT-5 Nano", desc: "Puter default nano" },
        { id: "mistral-large-latest", label: "Mistral Large", desc: "Mistral enterprise" },
        { id: "grok-beta", label: "Grok Beta", desc: "xAI model" },
        { id: "reka/reka-edge", label: "Reka Edge", desc: "Reka multimodal" },
      ],
    },
  ],

  openrouter: [
    {
      group: "⭐ Recommended Free Models",
      models: [
        { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash", badge: "Free / Fast", isStable: true },
        { id: "meta-llama/llama-3.3-70b-instruct:free", label: "Llama 3.3 70B Instruct (Free)", badge: "Free", isStable: true },
        { id: "deepseek/deepseek-chat:free", label: "DeepSeek Chat (Free)", badge: "Free", isStable: true },
        { id: "qwen/qwen-2.5-72b-instruct:free", label: "Qwen 2.5 72B (Free)", badge: "Free" },
      ],
    },
    {
      group: "⭐ Flagship (Requires OpenRouter Credits)",
      models: [
        { id: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet", badge: "Flagship", isStable: true },
        { id: "openai/gpt-4o", label: "GPT-4o", badge: "Flagship", isStable: true },
        { id: "openai/gpt-4o-mini", label: "GPT-4o Mini", badge: "Fast", isStable: true },
        { id: "deepseek/deepseek-r1", label: "DeepSeek R1", badge: "Reasoning" },
      ],
    },
  ],

  gemini: [
    {
      group: "⭐ Official Google Gemini Models",
      models: [
        { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", badge: "Recommended", isStable: true },
        { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", badge: "Fast", isStable: true },
        { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", badge: "Fastest" },
        { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", badge: "Deep Reasoning" },
        { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro", badge: "High Context" },
      ],
    },
  ],

  openai: [
    {
      group: "⭐ Official OpenAI Models",
      models: [
        { id: "gpt-4o", label: "GPT-4o", badge: "Recommended", isStable: true },
        { id: "gpt-4o-mini", label: "GPT-4o Mini", badge: "Fast & Low Cost", isStable: true },
        { id: "o3-mini", label: "o3-mini", badge: "Reasoning" },
        { id: "gpt-4-turbo", label: "GPT-4 Turbo", badge: "Legacy" },
      ],
    },
  ],

  claude: [
    {
      group: "⭐ Official Anthropic Claude Models",
      models: [
        { id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet", badge: "Recommended", isStable: true },
        { id: "claude-3-5-haiku-20241022", label: "Claude 3.5 Haiku", badge: "Fast", isStable: true },
        { id: "claude-3-opus-20240229", label: "Claude 3 Opus", badge: "Deep Analysis" },
      ],
    },
  ],

  groq: [
    {
      group: "⭐ Ultra-Fast Groq Models",
      models: [
        { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B Versatile", badge: "Recommended", isStable: true },
        { id: "llama-3.1-8b-instant", label: "Llama 3.1 8B Instant", badge: "Blazing Fast", isStable: true },
        { id: "mixtral-8x7b-32768", label: "Mixtral 8x7B", badge: "Balanced" },
      ],
    },
  ],

  deepseek: [
    {
      group: "⭐ Official DeepSeek Models",
      models: [
        { id: "deepseek-chat", label: "DeepSeek Chat (V3)", badge: "Recommended", isStable: true },
        { id: "deepseek-reasoner", label: "DeepSeek Reasoner (R1)", badge: "Deep Logic", isStable: true },
      ],
    },
  ],

  mistral: [
    {
      group: "⭐ Official Mistral Models",
      models: [
        { id: "mistral-large-latest", label: "Mistral Large", badge: "Flagship", isStable: true },
        { id: "mistral-small-latest", label: "Mistral Small", badge: "Fast", isStable: true },
        { id: "codestral-latest", label: "Codestral", badge: "Code" },
      ],
    },
  ],

  "workers-ai": [
    {
      group: "⭐ Cloudflare Workers AI (Powerful / Flagship)",
      models: [
        { id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", label: "Llama 3.3 70B Fast (FP8)", badge: "Recommended", isStable: true },
        { id: "@cf/meta/llama-3.3-70b-instruct", label: "Llama 3.3 70B Full", badge: "High Precision", isStable: true },
        { id: "@cf/qwen/qwen2.5-72b-instruct", label: "Qwen 2.5 72B Instruct", badge: "Most Powerful", isStable: true },
        { id: "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b", label: "DeepSeek R1 Distill 32B", badge: "Reasoning", isStable: true },
        { id: "@cf/meta/llama-3.1-70b-instruct", label: "Llama 3.1 70B Instruct", badge: "High Accuracy" },
      ],
    },
    {
      group: "⚡ Cloudflare Workers AI (Fast & Compact)",
      models: [
        { id: "@cf/google/gemma-2-27b-it", label: "Gemma 2 27B IT", badge: "Fast" },
        { id: "@cf/meta/llama-3.1-8b-instruct", label: "Llama 3.1 8B Instruct", badge: "Ultra Fast" },
        { id: "@cf/mistral/mistral-7b-instruct-v0.2", label: "Mistral 7B v0.2", badge: "Compact" },
      ],
    },
  ],

  nvidia: [
    {
      group: "⭐ NVIDIA NIM Models",
      models: [
        { id: "nvidia/nemotron-3-super-120b-a12b", label: "Nemotron 3 Super 120B", badge: "Recommended", isStable: true },
        { id: "deepseek-ai/deepseek-v4-flash", label: "DeepSeek V4 Flash", badge: "Fast" },
      ],
    },
  ],
};

/**
 * Returns the curated prebuilt model groups for a given provider type.
 * Returns null if no prebuilt groups exist for the provider.
 */
export function getPrebuiltModelsForProvider(providerType: string): ModelGroup[] | null {
  const normType = providerType.toLowerCase().trim();
  if (PREBUILT_MODELS_BY_PROVIDER[normType]) {
    return PREBUILT_MODELS_BY_PROVIDER[normType];
  }
  // Alias checks (e.g. opencode-zen -> zencode)
  if (normType === "opencode" || normType === "opencode-zen" || normType === "zencode") {
    return [
      {
        group: "⭐ ZenCode Free Models",
        models: [
          { id: "nemotron-3-ultra-free", label: "Nemotron 3 Ultra (Free)", isStable: true },
          { id: "nemotron-3.5-lightning-free", label: "Nemotron 3.5 Lightning (Free)" },
          { id: "mimo-v2.5-free", label: "Mimo v2.5 (Free)" },
          { id: "deepseek-v4-flash-free", label: "DeepSeek V4 Flash (Free)" },
        ],
      },
    ];
  }
  return null;
}

/**
 * Flattens all prebuilt model IDs for a given provider type into a simple array.
 */
export function getPrebuiltModelIdsForProvider(providerType: string): string[] {
  const groups = getPrebuiltModelsForProvider(providerType);
  if (!groups) return [];
  return groups.flatMap((g) => g.models.map((m) => m.id));
}
