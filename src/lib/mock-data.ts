// ResumeAI Pro — seed data for built-in providers and default configs.
// All arrays (resumes, JDs, ATS reports) are intentionally empty in production —
// users create their own data. Only provider configs and system defaults are seeded.
import type {
  User, ResumeData, JobDescription, AIProvider, AIProviderLog, AIProviderSettings, PromptTemplate,
  BrandingConfig, FeatureFlags, AuditLog, CoverLetter, InterviewPackage, ATSReport,
  OptimizerDirectiveConfig,
  AIDevAgentSettings, AIDevAgentHistory, AIDevReport,
  AITask, AIWorkspacePatch, AIGitBranch, AIGitCommit, AIRollback,
  FallbackChainConfig,
} from "./types";
import { BRAND } from "./brand";

// SEED_USER removed — users start with user: null and sign in to create their account.
// Super-admin role is granted at sign-in time via SUPER_ADMIN_EMAILS in brand.ts.

export const SEED_RESUMES: ResumeData[] = [] as ResumeData[]; // Production: empty — users create their own


export const SEED_JDS: JobDescription[] = [] as JobDescription[]; // Production: empty


export const SEED_PROVIDERS: AIProvider[] = [
  {
    id: "p_puter",
    name: "Puter.js (Free, browser-auth)",
    type: "puter",
    providerCategory: "browser_auth",
    supportsServerSide: false,
    supportsClientSide: true,
    supportsStreaming: false,
    supportsFunctionCalling: true,
    supportsJsonMode: true,
    requiresBrowserAuth: true,
    requiresApiKey: false,
    apiUrl: "", // Puter has NO REST API — it uses window.puter.ai.chat() in the browser
    baseUrl: "", // Same — no base URL
    priority: 1,
    isActive: true,
    isDefault: false,
    isFallback: true,
    isBuiltIn: true,
    allowedForRegularUsers: true,
    timeout: 45000, // Puter can be slow on cold starts
    maxTokens: 4096,
    temperature: 0.7,
    retryAttempts: 1,
    rateLimitPerMinute: 60,
    applicationId: "resumeai-pro-app",
    clientId: "resumeai-pro-client",
    redirectUri: "https://resumeai.pro/auth/puter/callback",
    enabledModels: ["gpt-5.4-nano", "gpt-5-nano", "gpt-4o-mini", "gpt-4o", "claude-sonnet-4-5", "claude-3-5-sonnet", "gemini-2.5-flash", "deepseek-chat", "deepseek-reasoner", "meta-llama/Llama-3.3-70B-Instruct", "mistral-large-latest"],
    modelName: "gpt-5.4-nano",
    streamingEnabled: false,
    authType: "none",
    costPerInputToken: 0,
    costPerOutputToken: 0,
    status: "healthy",
    usage: { requests: 0, tokens: 0, errors: 0, avgLatencyMs: 0, cost: 0 },
    health: { consecutiveFailures: 0, consecutiveSuccesses: 0 },
  },
  {
    id: "p_opencode",
    name: "OpenCode Zen (Free models)",
    type: "opencode",
    providerCategory: "api",
    supportsServerSide: true,
    supportsClientSide: true,
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsJsonMode: true,
    requiresBrowserAuth: false,
    requiresApiKey: true,
    apiUrl: "https://opencode.ai/zen/v1",
    baseUrl: "https://opencode.ai/zen/v1",
    apiKey: process.env.NEXT_PUBLIC_OPENCODE_API_KEY ?? "",
    priority: 2,
    isActive: !!(process.env.NEXT_PUBLIC_OPENCODE_API_KEY), // Only active if key is set
    isDefault: true,  // Default for document tasks
    isBuiltIn: true,
    allowedForRegularUsers: true,
    timeout: 60000,
    maxTokens: 4096,
    temperature: 0.7,
    retryAttempts: 1,
    rateLimitPerMinute: 20,
    modelName: "nemotron-3-ultra-free",
    enabledModels: [
      // Verified live on https://opencode.ai/zen/v1 (2026-08-30) — see
      // lib/ai/zen-free-models.ts for the registry + rationale. Order matters:
      // verified-ANSWERING models first (the preflight gate and the router
      // rotate through this list on quota/model errors — the Zen free-usage
      // limiter is keyed to the requester's IP and per-model upstream routes
      // fail independently). hy3-free is dead (removed upstream);
      // muse-spark-1.2-contributor-free is region-locked and served only on
      // the /responses endpoint family, so it must never ship here.
      "nemotron-3-ultra-free",
      "nemotron-3.5-lightning-free",
      "laguna-s-2.1-free",
      "big-pickle",
      "mimo-v2.5-free",
      "deepseek-v4-flash-free",
      "ling-3.0-flash-fin-free",
    ],
    streamingEnabled: true,
    authType: "bearer",
    costPerInputToken: 0,
    costPerOutputToken: 0,
    status: "healthy",
    usage: { requests: 0, tokens: 0, errors: 0, avgLatencyMs: 0, cost: 0 },
    health: { consecutiveFailures: 0, consecutiveSuccesses: 0 },
  },
  // === Z.ai Fallback removed — user has OpenCode + NVIDIA + Mistral + Puter ===
  // The Z.ai fallback required a server-side API key that wasn't configured,
  // and it showed as a confusing "built-in" provider in the UI.
  // === Super-admin-only providers (inactive by default — add API key to activate) ===
  {
    id: "p_openai",
    name: "OpenAI",
    type: "openai",
    providerCategory: "api",
    supportsServerSide: true,
    supportsClientSide: true,
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsJsonMode: true,
    requiresBrowserAuth: false,
    requiresApiKey: true,
    apiUrl: "https://api.openai.com/v1",
    baseUrl: "https://api.openai.com/v1",
    priority: 10,
    isActive: false,
    isBuiltIn: false,
    allowedForRegularUsers: false,
    timeout: 60000,
    maxTokens: 4096,
    temperature: 0.7,
    retryAttempts: 3,
    rateLimitPerMinute: 50,
    modelName: "gpt-4o-mini",
    enabledModels: [
      "gpt-4o-mini",
      "gpt-4o",
      "o1-mini",
      "o3-mini"
    ],
    streamingEnabled: true,
    authType: "bearer",
    costPerInputToken: 0.00000015,
    costPerOutputToken: 0.0000006,
    status: "untested",
    usage: { requests: 0, tokens: 0, errors: 0, avgLatencyMs: 0, cost: 0 },
  },
  {
    id: "p_github",
    name: "GitHub Models",
    type: "github",
    providerCategory: "api",
    supportsServerSide: true,
    supportsClientSide: true,
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsJsonMode: true,
    requiresBrowserAuth: false,
    requiresApiKey: true,
    apiUrl: "https://models.inference.ai.azure.com",
    baseUrl: "https://models.inference.ai.azure.com",
    priority: 15,
    isActive: false,
    isBuiltIn: false,
    allowedForRegularUsers: true,
    timeout: 60000,
    maxTokens: 4096,
    temperature: 0.7,
    retryAttempts: 3,
    rateLimitPerMinute: 50,
    // GitHub Models free tier serves gpt-4o-mini (gpt-4o is paid/rate-limited).
    modelName: "gpt-4o-mini",
    enabledModels: [
      "gpt-4o-mini",
      "gpt-4o",
      "meta-llama-3.1-400b-instruct",
      "cohere-command-r-plus",
      "mistral-large-2411"
    ],
    streamingEnabled: true,
    authType: "bearer",
    costPerInputToken: 0,
    costPerOutputToken: 0,
    status: "untested",
    usage: { requests: 0, tokens: 0, errors: 0, avgLatencyMs: 0, cost: 0 },
    health: { consecutiveFailures: 0, consecutiveSuccesses: 0 },
  },
  {
    id: "p_anthropic",
    name: "Anthropic Claude",
    type: "claude",
    providerCategory: "api",
    supportsServerSide: true,
    supportsClientSide: true,
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsJsonMode: true,
    requiresBrowserAuth: false,
    requiresApiKey: true,
    apiUrl: "https://api.anthropic.com/v1",
    baseUrl: "https://api.anthropic.com/v1",
    priority: 20,
    isActive: false,
    isBuiltIn: false,
    allowedForRegularUsers: false,
    timeout: 60000,
    maxTokens: 4096,
    temperature: 0.7,
    retryAttempts: 3,
    rateLimitPerMinute: 40,
    modelName: "claude-3-5-sonnet-20241022",
    enabledModels: [
      "claude-3-5-sonnet-20241022",
      "claude-3-5-haiku-20241022",
      "claude-3-haiku-20240307",
      "claude-3-opus-20240229"
    ],
    streamingEnabled: true,
    authType: "header",
    costPerInputToken: 0.000003,
    costPerOutputToken: 0.000015,
    status: "untested",
    usage: { requests: 0, tokens: 0, errors: 0, avgLatencyMs: 0, cost: 0 },
  },
  {
    id: "p_deepseek",
    name: "DeepSeek",
    type: "deepseek",
    providerCategory: "api",
    supportsServerSide: true,
    supportsClientSide: true,
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsJsonMode: true,
    requiresBrowserAuth: false,
    requiresApiKey: true,
    apiUrl: "https://api.deepseek.com/v1",
    baseUrl: "https://api.deepseek.com/v1",
    priority: 15,
    isActive: false,
    isBuiltIn: false,
    allowedForRegularUsers: false,
    timeout: 60000,
    maxTokens: 4096,
    temperature: 0.7,
    retryAttempts: 3,
    rateLimitPerMinute: 60,
    modelName: "deepseek-chat",
    enabledModels: [
      "deepseek-chat",
      "deepseek-reasoner"
    ],
    streamingEnabled: true,
    authType: "bearer",
    costPerInputToken: 0.00000014,
    costPerOutputToken: 0.00000028,
    status: "untested",
    usage: { requests: 0, tokens: 0, errors: 0, avgLatencyMs: 0, cost: 0 },
  },
  {
    id: "p_gemini",
    name: "Google Gemini",
    type: "gemini",
    providerCategory: "api",
    supportsServerSide: true,
    supportsClientSide: true,
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsJsonMode: true,
    requiresBrowserAuth: false,
    requiresApiKey: true,
    apiUrl: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    priority: 18,
    isActive: false,
    isBuiltIn: false,
    allowedForRegularUsers: true,
    timeout: 60000,
    maxTokens: 8192,
    temperature: 0.7,
    retryAttempts: 3,
    rateLimitPerMinute: 60,
    modelName: "gemini-2.5-flash",
    enabledModels: [
      "gemini-2.5-flash",
      "gemini-2.5-pro",
      "gemini-1.5-flash",
      "gemini-1.5-pro"
    ],
    streamingEnabled: true,
    authType: "bearer",
    costPerInputToken: 0.000000075,
    costPerOutputToken: 0.0000003,
    status: "untested",
    usage: { requests: 0, tokens: 0, errors: 0, avgLatencyMs: 0, cost: 0 },
  },
  {
    id: "p_groq",
    name: "Groq (fast inference)",
    type: "groq",
    providerCategory: "api",
    supportsServerSide: true,
    supportsClientSide: true,
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsJsonMode: true,
    requiresBrowserAuth: false,
    requiresApiKey: true,
    apiUrl: "https://api.groq.com/openai/v1",
    baseUrl: "https://api.groq.com/openai/v1",
    priority: 12,
    isActive: false,
    isBuiltIn: false,
    allowedForRegularUsers: false,
    timeout: 60000,
    maxTokens: 4096,
    temperature: 0.7,
    retryAttempts: 3,
    rateLimitPerMinute: 30,
    // Lead with the documented free model; llama-3.3-70b-versatile has been
    // reported as retired on the Groq free tier — keep it secondary so the
    // healer's self-repair and the router try the supported id first.
    modelName: "llama-3.1-8b-instant",
    enabledModels: [
      "llama-3.1-8b-instant",
      "mixtral-8x7b-32768",
      "llama-3.3-70b-versatile"
    ],
    streamingEnabled: true,
    authType: "bearer",
    costPerInputToken: 0,
    costPerOutputToken: 0,
    status: "untested",
    usage: { requests: 0, tokens: 0, errors: 0, avgLatencyMs: 0, cost: 0 },
  },
  {
    id: "p_openrouter",
    name: "OpenRouter (multi-model gateway)",
    type: "openrouter",
    providerCategory: "api",
    supportsServerSide: true,
    supportsClientSide: true,
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsJsonMode: true,
    requiresBrowserAuth: false,
    requiresApiKey: true,
    apiUrl: "https://openrouter.ai/api/v1",
    baseUrl: "https://openrouter.ai/api/v1",
    priority: 25,
    isActive: false,
    isBuiltIn: false,
    allowedForRegularUsers: false,
    timeout: 60000,
    maxTokens: 4096,
    temperature: 0.7,
    retryAttempts: 3,
    rateLimitPerMinute: 20,
    // openai/gpt-oss-120b:free does not exist on OpenRouter; the 20b free variant does.
    modelName: "openai/gpt-oss-20b:free",
    enabledModels: [
      // ── OpenAI OSS ──
      "openai/gpt-oss-20b:free",
      "openai/gpt-oss-120b:free",
      // ── xAI Grok ──
      "x-ai/grok-3-mini:free",
      "x-ai/grok-3-mini-beta:free",
      // ── DeepSeek ──
      "deepseek/deepseek-chat-v3-0324:free",
      "deepseek/deepseek-r1:free",
      "deepseek/deepseek-r1-0528:free",
      "tngtech/deepseek-r1t2-chimera:free",
      // ── Meta Llama ──
      "meta-llama/llama-4-maverick:free",
      "meta-llama/llama-4-scout:free",
      "meta-llama/llama-3.3-70b-instruct:free",
      "meta-llama/llama-3.2-3b-instruct:free",
      // ── Qwen ──
      "qwen/qwen3-235b-a22b:free",
      "qwen/qwen3-30b-a3b:free",
      "qwen/qwen3-32b:free",
      "qwen/qwen3-14b:free",
      "qwen/qwen3-8b:free",
      "qwen/qwen3-coder:free",
      "qwen/qwen3-next-80b-a3b-instruct:free",
      // ── Google ──
      "google/gemma-4-31b-it:free",
      "google/gemma-4-26b-a4b-it:free",
      "google/gemma-3-27b-it:free",
      // ── NVIDIA Nemotron ──
      "nvidia/nemotron-3-ultra-550b-a55b:free",
      "nvidia/nemotron-3-super-120b-a12b:free",
      "nvidia/nemotron-3-nano-30b-a3b:free",
      "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
      "nvidia/nemotron-nano-12b-v2-vl:free",
      "nvidia/nemotron-nano-9b-v2:free",
      "nvidia/nemotron-3.5-content-safety:free",
      // ── MoonshotAI ──
      "moonshotai/kimi-k2:free",
      // ── Mistral ──
      "mistralai/mistral-7b-instruct:free",
      "mistralai/mistral-small-3.2-24b-instruct:free",
      // ── Cohere / NousResearch ──
      "cohere/north-mini-code:free",
      "nousresearch/hermes-3-llama-3.1-405b:free",
      // ── StepFun ──
      "stepfun/step-3.5-flash:free",
      // ── Liquid / Poolside ──
      "liquid/lfm-2.5-1.2b-instruct:free",
      "liquid/lfm-2.5-1.2b-thinking:free",
      "poolside/laguna-m.1:free",
      "poolside/laguna-xs.2:free",
      // ── Others ──
      "cognitivecomputations/dolphin-mistral-24b-venice-edition:free",
      "sarvamai/sarvam-m:free",
      "featherless/qwerky-72b:free",
      "bytedance-research/ui-tars-72b:free",
      "shisa-ai/shisa-v2-llama3.3-70b:free",
      "openrouter/free"
    ],
    streamingEnabled: true,
    authType: "bearer",
    costPerInputToken: 0,
    costPerOutputToken: 0,
    status: "untested",
    usage: { requests: 0, tokens: 0, errors: 0, avgLatencyMs: 0, cost: 0 },
  },
  {
    id: "p_google_gemini",
    name: "Google AI Studio (Gemini)",
    type: "gemini",
    providerCategory: "api",
    supportsServerSide: true,
    supportsClientSide: true,
    supportsStreaming: true,
    supportsFunctionCalling: true,
    supportsJsonMode: true,
    requiresBrowserAuth: false,
    requiresApiKey: true,
    // CRITICAL: Google's OpenAI-compatible endpoint uses /v1beta/openai/ as the
    // base path. Do NOT add /v1 — Google's path handles the version natively.
    // The callUserProvider() function appends /chat/completions to this URL,
    // producing: https://generativelanguage.googleapis.com/v1beta/openai/chat/completions
    apiUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai/",
    priority: 8,
    isActive: false,  // User activates by adding their Google AI Studio API key
    isBuiltIn: false,
    allowedForRegularUsers: false,
    timeout: 60000,
    maxTokens: 8192,
    temperature: 0.7,
    retryAttempts: 3,
    rateLimitPerMinute: 60,
    modelName: "gemini-2.5-flash",
    enabledModels: [
      "gemini-2.5-flash",
      "gemini-2.5-flash-lite",
      "gemini-2.5-pro",
      "gemini-2.0-flash",
      "gemini-2.0-flash-lite",
      "gemini-1.5-flash",
      "gemini-1.5-pro",
      "models/gemini-2.5-flash",
      "models/gemini-2.5-flash-lite",
      "models/gemini-2.5-pro",
      "models/gemini-2.0-flash",
      "models/gemini-2.0-flash-lite",
      "models/gemini-1.5-flash",
      "models/gemini-1.5-pro",
    ],
    streamingEnabled: true,
    authType: "bearer",  // Google's OpenAI-compatible endpoint uses Bearer auth
    costPerInputToken: 0,
    costPerOutputToken: 0,
    status: "untested",
    usage: { requests: 0, tokens: 0, errors: 0, avgLatencyMs: 0, cost: 0 },
  },
];

// === NVIDIA NIM provider (free Llama models) ===
// User-configured with their NVIDIA API key
const NVIDIA_PROVIDER: AIProvider = {
  id: "p_nvidia",
  name: "NVIDIA NIM (Llama free)",
  type: "nvidia",
  providerCategory: "api",
  supportsServerSide: true,
  supportsClientSide: true,
  supportsStreaming: true,
  supportsFunctionCalling: true,
  supportsJsonMode: true,
  requiresBrowserAuth: false,
  requiresApiKey: true,
  apiUrl: "https://integrate.api.nvidia.com/v1",
  baseUrl: "https://integrate.api.nvidia.com/v1",
  apiKey: process.env.NEXT_PUBLIC_NVIDIA_API_KEY ?? "",
  priority: 5,
  isActive: !!(process.env.NEXT_PUBLIC_NVIDIA_API_KEY),
  isDefault: false,
  isBuiltIn: false,
  allowedForRegularUsers: true,
  // Bumped from 30s → 90s: Llama-3.3-70b on the 22k-char optimizer directive
  // routinely takes 40-80s. The old 30s timeout was causing the proxy to
  // abort mid-generation, producing truncated JSON that failed QA.
  timeout: 90000,
  // Bumped from 4096 → 8192: Llama-3.1/3.3-70b supports up to 8192 output
  // tokens. The optimizer needs ~8k tokens for a full resume JSON; 4096
  // was truncating the output mid-section, causing empty experience/education.
  maxTokens: 8192,
  // Lowered from 0.7 → 0.2: the optimizer overwrites this to 0.15 per-call,
  // but this fallback reduces creativity on non-optimizer calls. Higher temps
  // cause Llama models to fabricate employers/metrics on structured JSON tasks.
  temperature: 0.2,
  retryAttempts: 2,
  rateLimitPerMinute: 40,
  // Reverted from llama-4-scout-17b back to llama-3.3-70b: Llama 4 Scout
  // was returning errors on the Nvidia free tier. Llama-3.3-70b was working
  // (returned 2874 chars in testing) and has good instruction-following.
  // NVIDIA NIM default now points to a model NVIDIA still serves.
  // stepfun-ai/step-3.7-flash was retired (HTTP 410 EOL on 2026-08-28).
  modelName: "nvidia/nemotron-3-super-120b-a12b",
  enabledModels: [
    "nvidia/nemotron-3-super-120b-a12b",
    "deepseek-ai/deepseek-v4-flash",
    "deepseek-ai/deepseek-v4-pro",
    "minimaxai/minimax-m2.7",
    "minimaxai/minimax-m3",
    "mistralai/mistral-medium-3.5-128b",
    "moonshotai/kimi-k2.6",
    "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning",
    "nvidia/nemotron-3-super-120b-a12b",
    "nvidia/nemotron-3-ultra-550b-a55b",
    "z-ai/glm-5.1"
  ],
  streamingEnabled: true,
  authType: "bearer",
  costPerInputToken: 0,
  costPerOutputToken: 0,
  status: "healthy",
  usage: { requests: 0, tokens: 0, errors: 0, avgLatencyMs: 0, cost: 0 },
  health: { consecutiveFailures: 0, consecutiveSuccesses: 0 },
};

// === Antigravity CLI Provider ===
const ANTIGRAVITY_SEED: AIProvider = {
  id: "p_antigravity",
  name: "Antigravity CLI",
  type: "antigravity",
  // Task 29 — CLI integration identity: authenticated via Google sign-in /
  // CLI token, NO REST Base URL (Base URL renders as N/A in the UI). This is
  // NOT the Google Gemini API provider (that is p_gemini / p_google_gemini
  // with baseUrl generativelanguage.googleapis.com).
  integrationType: "cli",
  providerCategory: "api",
  supportsServerSide: true,
  supportsClientSide: true,
  supportsStreaming: true,
  supportsFunctionCalling: true,
  supportsJsonMode: true,
  requiresBrowserAuth: false,
  requiresApiKey: true,
  apiUrl: "https://cloudcode-pa.googleapis.com",
  baseUrl: "https://cloudcode-pa.googleapis.com",
  apiKey: process.env.NEXT_PUBLIC_ANTIGRAVITY_API_KEY ?? "",
  priority: 3,
  isActive: !!(process.env.NEXT_PUBLIC_ANTIGRAVITY_API_KEY),
  isDefault: false,
  isBuiltIn: false,
  allowedForRegularUsers: true,
  timeout: 30000,
  maxTokens: 4096,
  temperature: 0.7,
  retryAttempts: 2,
  rateLimitPerMinute: 60,
  // Antigravity CLI exposes Claude/GPT/DeepSeek models (not Gemini). The Worker
  // proxy transparently remaps claude-sonnet-4 → gemini-2.5-flash for the actual
  // Google Cloud Code Assist call, so the CLI-facing model id stays claude-sonnet-4.
  modelName: "claude-sonnet-4",
  enabledModels: [
    "claude-sonnet-4",
    "gpt-4.1",
    "deepseek-v4",
    "gemini-2.5-pro",
  ],
  streamingEnabled: true,
  authType: "bearer",
  costPerInputToken: 0,
  costPerOutputToken: 0,
  status: "untested",
  usage: { requests: 0, tokens: 0, errors: 0, avgLatencyMs: 0, cost: 0 },
  health: { consecutiveFailures: 0, consecutiveSuccesses: 0 },
};

// === Mistral provider (Mistral Small / Ministral 3B) ===
// User-configured with their Mistral API key
const MISTRAL_PROVIDER: AIProvider = {
  id: "p_mistral",
  name: "Mistral API (Small/Ministral)",
  type: "mistral",
  providerCategory: "api",
  supportsServerSide: true,
  supportsClientSide: true,
  supportsStreaming: true,
  supportsFunctionCalling: true,
  supportsJsonMode: true,
  requiresBrowserAuth: false,
  requiresApiKey: true,
  apiUrl: "https://api.mistral.ai/v1",
  baseUrl: "https://api.mistral.ai/v1",
  apiKey: process.env.NEXT_PUBLIC_MISTRAL_API_KEY ?? "",
  priority: 10,
  isActive: !!(process.env.NEXT_PUBLIC_MISTRAL_API_KEY),
  isDefault: false,
  isBuiltIn: false,
  allowedForRegularUsers: true,
  timeout: 30000,
  maxTokens: 4096,
  temperature: 0.7,
  retryAttempts: 2,
  rateLimitPerMinute: 30,
  modelName: "mistral-small-latest",
  enabledModels: [
    "mistral-large-latest",
    "mistral-small-latest",
    "codestral-latest",
    "ministral-8b-latest",
    "pixtral-large-latest",
    "open-mistral-nemo"
  ],
  streamingEnabled: true,
  authType: "bearer",
  costPerInputToken: 0.0000002,
  costPerOutputToken: 0.0000006,
  status: "healthy",
  usage: { requests: 0, tokens: 0, errors: 0, avgLatencyMs: 0, cost: 0 },
  health: { consecutiveFailures: 0, consecutiveSuccesses: 0 },
};

// === Cerebras Cloud (free tier — no card required) ===
const CEREBRAS_PROVIDER: AIProvider = {
  id: "p_cerebras",
  name: "Cerebras (Free, fast inference)",
  type: "cerebras",
  providerCategory: "api",
  supportsServerSide: true,
  supportsClientSide: true,
  supportsStreaming: true,
  supportsFunctionCalling: true,
  supportsJsonMode: true,
  requiresBrowserAuth: false,
  requiresApiKey: true,
  apiUrl: "https://api.cerebras.ai/v1",
  baseUrl: "https://api.cerebras.ai/v1",
  apiKey: process.env.NEXT_PUBLIC_CEREBRAS_API_KEY ?? "",
  priority: 6,
  isActive: !!(process.env.NEXT_PUBLIC_CEREBRAS_API_KEY),
  isDefault: false,
  isBuiltIn: false,
  allowedForRegularUsers: true,
  timeout: 30000,
  maxTokens: 8192,
  temperature: 0.7,
  retryAttempts: 2,
  rateLimitPerMinute: 30,
  modelName: "qwen-3-235b",
  enabledModels: [
    "qwen-3-235b",
    "qwen-3-32b",
    "llama-3.3-70b",
    "llama-4-scout-17b",
    "llama-4-maverick-17b",
    "deepseek-r1",
  ],
  streamingEnabled: true,
  authType: "bearer",
  costPerInputToken: 0,
  costPerOutputToken: 0,
  status: "untested",
  usage: { requests: 0, tokens: 0, errors: 0, avgLatencyMs: 0, cost: 0 },
  health: { consecutiveFailures: 0, consecutiveSuccesses: 0 },
};

// === Hugging Face Inference API (free, serverless, thousands of OSS models) ===
const HUGGINGFACE_PROVIDER: AIProvider = {
  id: "p_huggingface",
  name: "Hugging Face Inference (Free OSS)",
  type: "huggingface",
  providerCategory: "api",
  supportsServerSide: true,
  supportsClientSide: true,
  supportsStreaming: true,
  supportsFunctionCalling: false,
  supportsJsonMode: false,
  requiresBrowserAuth: false,
  requiresApiKey: true,
  apiUrl: "https://api-inference.huggingface.co/v1",
  baseUrl: "https://api-inference.huggingface.co/v1",
  apiKey: process.env.NEXT_PUBLIC_HUGGINGFACE_API_KEY ?? "",
  priority: 9,
  isActive: !!(process.env.NEXT_PUBLIC_HUGGINGFACE_API_KEY),
  isDefault: false,
  isBuiltIn: false,
  allowedForRegularUsers: true,
  timeout: 60000,
  maxTokens: 4096,
  temperature: 0.7,
  retryAttempts: 2,
  rateLimitPerMinute: 20,
  modelName: "meta-llama/Llama-3.3-70B-Instruct",
  enabledModels: [
    "meta-llama/Llama-3.3-70B-Instruct",
    "meta-llama/Llama-4-Scout-17B-16E-Instruct",
    "Qwen/Qwen3-235B-A22B",
    "Qwen/Qwen3-32B",
    "deepseek-ai/DeepSeek-R1-Distill-Qwen-32B",
    "deepseek-ai/DeepSeek-R1-0528",
    "mistralai/Mistral-7B-Instruct-v0.3",
    "microsoft/phi-4",
    "google/gemma-2-27b-it",
  ],
  streamingEnabled: true,
  authType: "bearer",
  costPerInputToken: 0,
  costPerOutputToken: 0,
  status: "untested",
  usage: { requests: 0, tokens: 0, errors: 0, avgLatencyMs: 0, cost: 0 },
  health: { consecutiveFailures: 0, consecutiveSuccesses: 0 },
};

// === Together AI ($5 free credit, no card required) ===
const TOGETHER_PROVIDER: AIProvider = {
  id: "p_together",
  name: "Together AI (free credit)",
  type: "together",
  providerCategory: "api",
  supportsServerSide: true,
  supportsClientSide: true,
  supportsStreaming: true,
  supportsFunctionCalling: true,
  supportsJsonMode: true,
  requiresBrowserAuth: false,
  requiresApiKey: true,
  apiUrl: "https://api.together.xyz/v1",
  baseUrl: "https://api.together.xyz/v1",
  apiKey: process.env.NEXT_PUBLIC_TOGETHER_API_KEY ?? "",
  priority: 11,
  isActive: !!(process.env.NEXT_PUBLIC_TOGETHER_API_KEY),
  isDefault: false,
  isBuiltIn: false,
  allowedForRegularUsers: true,
  timeout: 60000,
  maxTokens: 4096,
  temperature: 0.7,
  retryAttempts: 2,
  rateLimitPerMinute: 30,
  modelName: "meta-llama/Llama-3.3-70B-Instruct-Turbo-Free",
  enabledModels: [
    "meta-llama/Llama-3.3-70B-Instruct-Turbo-Free",
    "meta-llama/Llama-4-Scout-17B-16E-Instruct-Free",
    "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8-Free",
    "deepseek-ai/DeepSeek-R1-Distill-Llama-70B-free",
    "Qwen/Qwen3-235B-A22B-fp8-tbo-free",
    "Qwen/Qwen3-30B-A3B-fp8-tbo-free",
    "moonshotai/Kimi-K2-Instruct-free",
  ],
  streamingEnabled: true,
  authType: "bearer",
  costPerInputToken: 0,
  costPerOutputToken: 0,
  status: "untested",
  usage: { requests: 0, tokens: 0, errors: 0, avgLatencyMs: 0, cost: 0 },
  health: { consecutiveFailures: 0, consecutiveSuccesses: 0 },
};

// === SambaNova Cloud ($5 free credit, no card required) ===
const SAMBANOVA_PROVIDER: AIProvider = {
  id: "p_sambanova",
  name: "SambaNova Cloud (free credit)",
  type: "sambanova",
  providerCategory: "api",
  supportsServerSide: true,
  supportsClientSide: true,
  supportsStreaming: true,
  supportsFunctionCalling: true,
  supportsJsonMode: true,
  requiresBrowserAuth: false,
  requiresApiKey: true,
  apiUrl: "https://api.sambanova.ai/v1",
  baseUrl: "https://api.sambanova.ai/v1",
  apiKey: process.env.NEXT_PUBLIC_SAMBANOVA_API_KEY ?? "",
  priority: 13,
  isActive: !!(process.env.NEXT_PUBLIC_SAMBANOVA_API_KEY),
  isDefault: false,
  isBuiltIn: false,
  allowedForRegularUsers: true,
  timeout: 60000,
  maxTokens: 4096,
  temperature: 0.7,
  retryAttempts: 2,
  rateLimitPerMinute: 20,
  modelName: "Meta-Llama-4-Maverick-17B-128E-Instruct",
  enabledModels: [
    "Meta-Llama-4-Maverick-17B-128E-Instruct",
    "Meta-Llama-4-Scout-17B-16E-Instruct",
    "Meta-Llama-3.3-70B-Instruct",
    "DeepSeek-R1-671B",
    "DeepSeek-V3-0324",
    "Qwen3-32B",
    "QwQ-32B",
  ],
  streamingEnabled: true,
  authType: "bearer",
  costPerInputToken: 0,
  costPerOutputToken: 0,
  status: "untested",
  usage: { requests: 0, tokens: 0, errors: 0, avgLatencyMs: 0, cost: 0 },
  health: { consecutiveFailures: 0, consecutiveSuccesses: 0 },
};

// === Perplexity AI (sonar free tier) ===
const PERPLEXITY_PROVIDER: AIProvider = {
  id: "p_perplexity",
  name: "Perplexity AI (Sonar)",
  type: "perplexity",
  providerCategory: "api",
  supportsServerSide: true,
  supportsClientSide: true,
  supportsStreaming: true,
  supportsFunctionCalling: false,
  supportsJsonMode: false,
  requiresBrowserAuth: false,
  requiresApiKey: true,
  apiUrl: "https://api.perplexity.ai",
  baseUrl: "https://api.perplexity.ai",
  apiKey: process.env.NEXT_PUBLIC_PERPLEXITY_API_KEY ?? "",
  priority: 16,
  isActive: !!(process.env.NEXT_PUBLIC_PERPLEXITY_API_KEY),
  isDefault: false,
  isBuiltIn: false,
  allowedForRegularUsers: true,
  timeout: 30000,
  maxTokens: 4096,
  temperature: 0.7,
  retryAttempts: 2,
  rateLimitPerMinute: 20,
  modelName: "sonar",
  enabledModels: [
    "sonar",
    "sonar-pro",
    "sonar-reasoning",
    "sonar-reasoning-pro",
    "r1-1776",
  ],
  streamingEnabled: true,
  authType: "bearer",
  costPerInputToken: 0,
  costPerOutputToken: 0,
  status: "untested",
  usage: { requests: 0, tokens: 0, errors: 0, avgLatencyMs: 0, cost: 0 },
  health: { consecutiveFailures: 0, consecutiveSuccesses: 0 },
};

// Insert NVIDIA + Mistral + Antigravity + new free-tier providers into the providers list
SEED_PROVIDERS.push(NVIDIA_PROVIDER, MISTRAL_PROVIDER, ANTIGRAVITY_SEED, CEREBRAS_PROVIDER, HUGGINGFACE_PROVIDER, TOGETHER_PROVIDER, SAMBANOVA_PROVIDER, PERPLEXITY_PROVIDER);

// === Task 30 — Z.ai Web (authenticated chat.z.ai browser session) ===
// A SEPARATE integration from the internal z-ai-fallback (server-route API):
// credential_type = zai_web_session, discovered via the user-initiated
// same-origin browser bridge, validated against the live web contract.
// GLM-family model names discovered here belong to THIS provider — the same
// model name may exist under an official Z.ai API integration separately.
const ZAI_WEB_SEED: AIProvider = {
  id: "p_zai_web",
  name: "Z.ai Web",
  type: "zai-web",
  integrationType: "web-session",
  providerCategory: "api",
  supportsServerSide: false,
  supportsClientSide: true,
  supportsStreaming: true,
  supportsFunctionCalling: false,
  supportsJsonMode: false,
  requiresBrowserAuth: true,
  requiresApiKey: false, // web-session credential — never an API key
  baseUrl: "", // N/A: web-session integration (chat.z.ai origin is internal to the adapter)
  apiKey: "",
  priority: 9,
  isActive: false, // becomes active after a VALIDATED web session import
  isDefault: false,
  isBuiltIn: false,
  allowedForRegularUsers: false,
  timeout: 60000,
  maxTokens: 8192,
  temperature: 0.7,
  retryAttempts: 2,
  rateLimitPerMinute: 60,
  modelName: "",
  enabledModels: [],
  streamingEnabled: true,
  authType: "bearer",
  costPerInputToken: 0,
  costPerOutputToken: 0,
  status: "untested",
  usage: { requests: 0, tokens: 0, errors: 0, avgLatencyMs: 0, cost: 0 },
  health: { consecutiveFailures: 0, consecutiveSuccesses: 0 },
};

SEED_PROVIDERS.push(ZAI_WEB_SEED);


export const SEED_PROVIDER_LOGS: AIProviderLog[] = [
  {
    id: "pl_1",
    providerId: "p_puter",
    providerName: "Puter.js (Free, user-auth)",
    requestType: "chat",
    modelName: "gpt-4o-mini",
    status: "success",
    latencyMs: 1842,
    inputTokens: 1240,
    outputTokens: 856,
    requestPreview: "Optimize this resume for ATS: Alex Morgan, Senior Frontend Engineer...",
    responsePreview: "Here is your optimized resume in InfoHAS Pro layout: {\"name\":\"Alex Morgan\"...",
    createdAt: new Date(Date.now() - 1000 * 60 * 4).toISOString(),
  },
  {
    id: "pl_2",
    providerId: "p_puter",
    providerName: "Puter.js (Free, user-auth)",
    requestType: "chat",
    modelName: "gpt-4o-mini",
    status: "rate_limited",
    latencyMs: 120,
    errorMessage: "429 Too Many Requests — Puter free quota exceeded for this hour",
    requestPreview: "Generate cover letter for Stripe role...",
    createdAt: new Date(Date.now() - 1000 * 60 * 11).toISOString(),
  },
  {
    id: "pl_3",
    providerId: "p_zai",
    providerName: "Z.ai Fallback (built-in)",
    requestType: "chat",
    modelName: "glm-4.6",
    status: "success",
    latencyMs: 980,
    inputTokens: 820,
    outputTokens: 412,
    requestPreview: "Generate cover letter for Stripe role (failover after Puter 429)...",
    responsePreview: "Dear Stripe Hiring Team, When I read about this Senior Frontend Engineer opportunity...",
    createdAt: new Date(Date.now() - 1000 * 60 * 11).toISOString(),
  },
  {
    id: "pl_4",
    providerId: "p_puter",
    providerName: "Puter.js (Free, user-auth)",
    requestType: "test",
    modelName: "gpt-4o-mini",
    status: "success",
    latencyMs: 412,
    inputTokens: 12,
    outputTokens: 8,
    requestPreview: "Test prompt: say 'OK' if you can hear me.",
    responsePreview: "OK",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
  },
  {
    id: "pl_5",
    providerId: "p_zai",
    providerName: "Z.ai Fallback (built-in)",
    requestType: "chat",
    modelName: "glm-4.6",
    status: "error",
    latencyMs: 5023,
    errorMessage: "Network timeout (5s exceeded)",
    requestPreview: "Extract keywords from JD...",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
  },
];

export const SEED_PROVIDER_SETTINGS: AIProviderSettings = {
  // Default to Ollama Local — runs on 127.0.0.1:11434, no API key needed.
  // Puter is available as a browser-auth fallback for interactive tasks.
  // OpenCode and NVIDIA/Mistral are fallbacks if configured with valid API keys.
  defaultProviderId: "p_ollama_local",
  defaultModel: "deepseek-coder-v2",
  fallbackProviderIds: ["p_puter", "p_opencode", "p_nvidia", "p_mistral"],
  retryAttempts: 3,
  timeout: 60000,
  rateLimitPerMinute: 60,
  enableFailover: true,
  enableCaching: true,
  enableCostTracking: true,
  agentRoutes: {},
};

/**
 * Default fallback chain configuration.
 *
 * This is the factory default. Users can customize the chain in the
 * Fallback Chain settings UI. Changes are persisted to D1 and synced
 * to all pipelines, routes, and agents.
 *
 * The chain is ordered: index 0 is tried first, then index 1, etc.
 * The user's primary provider is ALWAYS tried first (before this chain).
 * This chain only activates when the primary fails.
 */
export const SEED_FALLBACK_CHAIN: FallbackChainConfig = {
  enabled: true,
  includePuterLastResort: true,
  includeLocalEngineLastResort: true,
  respectPrimarySelection: true,
  entries: [
    // Task 24 — distinct upstreams only, verified live 2026-08-30.
    // p_zencode was REMOVED: it is an alias of p_opencode (both opencode.ai),
    // so listing both double-books the same IP-keyed limiter. The runtime
    // diversion (lib/ai/upstream-domain.ts) skips same-upstream siblings on
    // 429/quota windows anyway — this seed now never relies on that safety
    // net. deepseek-v4-flash-free is dead upstream (400 "Model is
    // unavailable"); the Zen entry uses nemotron-3.5-lightning-free, the only
    // free model both answering AND fast (1.2s) in live probes.
    {
      id: "fb_001",
      providerId: "p_opencode",
      model: "nemotron-3.5-lightning-free",
      enabled: true,
      temperature: 0.15,
      maxTokens: 8000,
      timeoutMs: 120000,
    },
    {
      id: "fb_002",
      providerId: "p_nvidia",
      model: "nvidia/nemotron-3-super-120b-a12b",
      enabled: true,
      temperature: 0.15,
      maxTokens: 8192,
      timeoutMs: 90000,
    },
    {
      id: "fb_003",
      providerId: "p_mistral",
      model: "mistral-small-latest",
      enabled: true,
      temperature: 0.15,
      maxTokens: 8192,
      timeoutMs: 90000,
    },
    {
      id: "fb_004",
      providerId: "p_google",
      model: "gemini-2.5-flash",
      enabled: true,
      temperature: 0.15,
      maxTokens: 8192,
      timeoutMs: 90000,
    },
    {
      id: "fb_005",
      providerId: "p_openrouter",
      model: "openai/gpt-oss-120b:free",
      enabled: true,
      temperature: 0.15,
      maxTokens: 8192,
      timeoutMs: 90000,
    },
  ],
};

export const SEED_PROMPTS: PromptTemplate[] = [
  {
    id: "pt_001",
    name: "ATS Resume Rewrite",
    category: "rewrite",
    content:
      "You are a senior ATS optimization expert. Rewrite the candidate's resume bullets to be ATS-friendly, quantified, and impactful. Keep all claims truthful. Use strong action verbs, add measurable outcomes where context permits, and embed target keywords naturally.\n\nTarget keywords: {{keywords}}\n\nOriginal resume:\n{{resume}}",
    version: 3,
    isActive: true,
    variables: ["keywords", "resume"],
  },
  {
    id: "pt_002",
    name: "Cover Letter — Modern",
    category: "cover-letter",
    content:
      "Write a modern, concise, ATS-friendly cover letter (~280 words) for {{role}} at {{company}}. Match the candidate's voice to the company's industry. Open with a specific, non-generic hook. Close with a confident CTA.\n\nCandidate resume:\n{{resume}}\n\nJob description:\n{{jd}}",
    version: 2,
    isActive: true,
    variables: ["role", "company", "resume", "jd"],
  },
  {
    id: "pt_003",
    name: "Interview Question Generator",
    category: "interview",
    content:
      "Generate a balanced interview preparation package for {{role}} at {{company}}. Include 3 technical, 3 behavioral, 2 situational, 2 HR, and 2 company-specific questions. For each, provide a recommended answer, 3-4 talking points, a STAR example, difficulty (easy/medium/hard), and 2 follow-up questions.\n\nCandidate resume:\n{{resume}}\n\nJob description:\n{{jd}}",
    version: 1,
    isActive: true,
    variables: ["role", "company", "resume", "jd"],
  },
  {
    id: "pt_004",
    name: "Aviation Cabin Crew ATS — 2,800-char One-Page",
    category: "ats",
    content:
      "ACT AS: Senior ATS Optimization Expert and Master Executive Resume Writer.\n\nOBJECTIVE: Optimise for maximum ATS score. Rewrite the resume to FILL EXACTLY ONE A4 PAGE (12pt font). Strategically weave in exact keywords, hard skills, and industry terminology to guarantee a 90%+ match rate.\n\nCONTEXT:\n- ATS SYSTEM: {{ats_system}} ({{ats_focus}})\n- INDUSTRY KEYWORDS: {{aviation_keywords}}\n- TONE: {{tone}}\n- FORMAT STYLE: {{format}}\n- STRATEGY: {{strictness}}\n\nINPUT DATA:\n[RESUME]: {{resume}}\n[JOB DESCRIPTION]: {{jd}}\n\nTASK 1: SCORING (Calculate ATS Score, Impact, Brevity, Keywords).\nTASK 2: REWRITE (STRICT PLAIN TEXT).\n\nCRITICAL LENGTH ENFORCEMENT (NON-NEGOTIABLE & STRICT):\nThe generated resume MUST contain EXACTLY 2,800 characters (excluding HTML tags). Not less, not more.\n- 2,100 characters is too short. DO NOT OUTPUT SHORT TEXT.\n- 3,000+ characters will cause page overflow. DO NOT EXCEED.\n- HOW TO HIT EXACTLY 2800 CHARACTERS INTELLIGENTLY:\n  1. If short: Expand content intelligently without filler. Add deep technical context. Improve impact-driven bullet points. Use 5-7 detailed bullets for the 2 most recent roles.\n  2. If too long: Summarize older roles (older than 5 years) to a single line. Keep summary to exactly 3 lines.\n\nFORMATTING RULES (NON-NEGOTIABLE):\n1. NO Emojis, Icons, Graphics, Colors, Tables, Columns, or Decorative Symbols.\n2. NO Underlines or horizontal rules (<hr>).\n3. FONT: Times New Roman, Size 12.\n\nSTRUCTURE:\n1. HEADER: Name (H1, Uppercase, Bold, LEFT ALIGNED), Contact Info (LEFT ALIGNED).\n2. SECTIONS (H3): PROFESSIONAL SUMMARY, EXPERIENCE, EDUCATION, SKILLS.\n3. EXPERIENCE ENTRIES: <h4><strong>Job Title</strong> | <strong>Company</strong>, Location | <strong>YYYY to YYYY</strong></h4>\n4. EDUCATION ENTRIES: <h4><strong>Degree</strong> | <strong>School</strong> | <strong>YYYY to YYYY</strong></h4>\n5. CONTENT: Use <strong> tags for bolding. NO markdown asterisks.\n\nRETURN JSON FORMAT ONLY:\n{\n  \"score\": number,\n  \"score_breakdown\": { \"impact\": number, \"brevity\": number, \"keywords\": number },\n  \"summary_critique\": \"string\",\n  \"missing_keywords\": [\"string\"],\n  \"matched_keywords\": [\"string\"],\n  \"optimized_content\": \"Valid HTML string...\"\n}",
    version: 1,
    isActive: true,
    variables: ["ats_system", "ats_focus", "aviation_keywords", "tone", "format", "strictness", "resume", "jd"],
  },
  {
    id: "pt_005",
    name: "Cabin Crew Keyword Injection",
    category: "keywords",
    content:
      "You are an aviation ATS keyword specialist. Analyze the candidate's resume and the target cabin crew job description. Identify which aviation keywords are missing and weave them naturally into the resume's experience and skills sections.\n\nAVIATION KEYWORD BANK:\n{{aviation_keywords}}\n\nCandidate resume:\n{{resume}}\n\nTarget job description:\n{{jd}}\n\nReturn JSON: { \"missing\": [\"keyword1\", ...], \"matched\": [\"keyword1\", ...], \"injection_suggestions\": [{ \"section\": \"experience\", \"entry\": \"Job Title at Company\", \"suggestion\": \"Rewritten bullet with keyword\" }] }",
    version: 1,
    isActive: true,
    variables: ["aviation_keywords", "resume", "jd"],
  },
];

export const SEED_BRANDING: BrandingConfig = {
  appName: BRAND.name,
  tagline: BRAND.tagline,
  primaryColor: BRAND.primaryColor,
  accentColor: BRAND.accentColor,
  logoUrl: BRAND.logoUrl,
  emailFromName: BRAND.name,
  emailFromAddress: BRAND.email,
  pdfFooterText: "Generated by ResumeAI Pro — resumeai.pro",
};

export const SEED_FLAGS: FeatureFlags = {
  enableResumeBuilder: true,
  enableATSChecker: true,
  enableOptimizer: true,
  enableCoverLetter: true,
  enableInterviewPrep: true,
  enableJDScraper: true,
  enableAIFailover: true,
  enableDonations: true,
  enableAds: false,
  maintenanceMode: false,
  // P3: Real-time pipeline WebSocket. Default OFF — requires the pipeline
  // worker (resumeai-pro-pipeline) to be deployed. Enable via Super Admin UI.
  pipeline_websocket_enabled: false,
  enableAIGuardian: true,
  enableSelfHealing: true,
  enableModelArena: true,
};

/**
 * Default optimizer directive config — matches the strict master layout
 * derived from the OUSSAMA EL FATIMI model PDF.
 *
 * Super admins can override these values via the "Optimizer Directive"
 * settings page. The values are stored in D1 and synced to all clients.
 */
export const SEED_OPTIMIZER_DIRECTIVE: OptimizerDirectiveConfig = {
  selectedStructuralBlueprintId: "infohas_aviation",
  // === PAGE ===
  pageSize: "A4",
  marginTopMm: 6.35,       // 0.25 inch
  marginBottomMm: 6.35,    // 0.25 inch
  marginLeftMm: 8.89,      // 0.35 inch
  marginRightMm: 8.89,     // 0.35 inch

  // === FONTS ===
  fontFamily: "Times New Roman",
  bodyFontSizePt: 10.5,
  sectionTitleSizePt: 12,
  nameSizePt: 14,

  // === COLORS ===
  nameColor: "#8B0000",       // dark red
  sectionTitleColor: "#8B0000", // dark red
  bodyTextColor: "#000000",   // pure black

  // === SPACING ===
  lineHeight: 1.2,          // compact single-spacing
  sectionGapMm: 3,          // compact section gap
  bulletIndentMm: 4,        // bullet indent from left margin

  // === PHOTO ===
  photoEnabled: true,
  photoWidthMm: 30,         // 3.0cm
  photoHeightMm: 40,        // 4.0cm
  showPlaceholderIfNoPhoto: false, // remove photo section entirely if no photo

  // === CONTENT LIMITS ===
  summaryMinWords: 60,
  summaryMaxWords: 90,
  skillsMaxGroups: 4,
  experienceMaxEntries: 4,
  experienceBulletsPerEntry: 4,
  educationMaxEntries: 3,
  languagesMaxEntries: 4,

  // === ONE-PAGE ENFORCEMENT ===
  enforceOnePage: true,
  minFontSizePt: 10,

  // === SECTION CHARACTER LIMITS (fine-tunable) ===
  sectionLimits: {
    header: { min: 80, max: 150 },          // name + contact line
    summary: { min: 400, max: 600 },         // professional summary (3-5 sentences)
    skills: { min: 300, max: 500 },           // core competencies (4 groups)
    experience: { min: 1200, max: 1800 },     // all experience combined
    education: { min: 150, max: 300 },        // all education
    languages: { min: 50, max: 100 },         // languages
    total: { min: 2500, max: 3500 },          // total resume
  },

  // === CUSTOM DIRECTIVE (ADVANCED) ===
  customDirectiveOverride: "", // empty = use generated directive

  // === COMPLIANCE ENFORCEMENT ENGINE ===
  complianceThreshold: 100,
  complianceRules: {
    entityPreservation: true,
    sectionOrder: true,
    immutableFields: true,
    hallucinationCheck: true,
    summaryLength: true,
    skillGrouping: true,
    chronology: true,
    pageCount: true,
    bulletCount: true,
    languageSeparation: true,
  },
  enforceComplianceOnAllAgents: true,
  forceDirectiveOnRetry: true,
  directiveVersion: 1,
  directiveHash: "",
  strictAgentLock: true,

  // === PER-AGENT DIRECTIVES ===
  // Default values for each agent's behavior knobs.
  // Users can override these in the Optimizer Directive → Agent Directives tab.
  agentDirectives: {
    supervisor: {
      strictMode: true,
      enableRetries: true,
      enableProviderSwitch: true,
      enforceImmutableEntities: true,
      enableDebugLogs: false,
      enableDiffViewer: true,
    },
    summary: {
      atsAggressiveness: 60, // moderate — embed keywords naturally, don't stuff
      preserveFacts: true,
      maxCharacters: 600,
      minCharacters: 350,
    },
    skills: {
      maxKeywords: 15,
      allowTransferableSkills: true,
      allowCompanyKeywords: false, // FORBIDDEN — always false
      allowLocationKeywords: false, // FORBIDDEN — always false
    },
    experience: {
      rewriteBulletsOnly: true,
      rewriteTitle: false,        // FORBIDDEN in locked pipeline
      rewriteCompany: false,      // FORBIDDEN in locked pipeline
      rewriteDates: false,        // FORBIDDEN in locked pipeline
      rewriteLocation: false,     // FORBIDDEN in locked pipeline
      maxExpansionPercent: 20,    // bullets can be up to 20% longer than original
    },
    education: {
      formatOnly: true,
      stripSectionHeaders: true,
    },
    languages: {
      formatOnly: true,
    },
    guardian: {
      enforceEntityIntegrity: true,
      enforcePageUtilization: false,  // false = advisory only (non-critical)
      enforceContentLength: false,    // false = advisory only (non-critical)
      enforceNoDuplicates: true,
      enforceSummaryQuality: false,   // false = skip summary quality check
      minimumScore: 80,
    },
    additionalInfo: {
      preserveSection: true,
      improveWording: true,
      stripSectionHeaders: true,
    },
    headline: {
      rewriteHeadline: false,
      maxHeadlineChars: 80,
      headlineTone: "preserve",
    },
    certifications: {
      formatOnly: true,
      stripExpiredCerts: false,
      maxCertAgeYears: 0,
      maxCertEntries: 5,
    },
  },

  // === TONE & WRITING STYLE ===
  toneConfig: {
    tone: "confident",
    bulletVerbTense: "past-tense",
    avoidFillerPhrases: true,
    enforcePowerVerbs: true,
    requireQuantification: false,
    avoidPassiveVoice: true,
    experienceFormula: "auto",
  },

  // === CUSTOM KEYWORD CONTROLS ===
  customKeywords: {
    forbiddenKeywords: [],
    requiredKeywords: [],
    keywordPlacement: "spread-evenly",
    maxKeywordDensityPercent: 0,
  },

  // === TARGET ATS SYSTEM ===
  targetAtsSystem: "generic",

  // === SECTION VISIBILITY OVERRIDES ===
  sectionVisibility: {
    summary: true,
    skills: true,
    experience: true,
    education: true,
    languages: true,
    certifications: true,
    additionalInfo: true,
    projects: true,
  },

  // === SECTION ORDER ===
  sectionOrder: ["summary", "experience", "education", "skills", "languages", "projects", "certifications", "additionalInfo"],

  // === DATE STANDARDIZATION ===
  dateFormat: "auto",

  // === CONTACT BLOCK LAYOUT ===
  contactSpacing: "stacked",

  // === CUSTOM SECTION INSTRUCTIONS ===
  customSectionInstructions: {},
};

/**
 * Default AI Development Agent settings.
 * Default provider: DeepSeek (OpenCode-compatible API), model: deepseek-v4-flash.
 * Super admins can override these via Super Admin → AI Development Agent → Settings.
 */
export const SEED_AI_DEV_SETTINGS: AIDevAgentSettings = {
  providerId: "",             // will be set dynamically to the first DeepSeek provider
  modelName: "deepseek-v4-flash",
  temperature: 0.4,
  maxTokens: 8000,
  timeout: 60,
  streaming: false,
  reasoningLevel: "medium",
  systemPrompt: `You are an elite AI Development Agent for ResumeAI Pro — a production Next.js 16 + Cloudflare Pages + D1 application. You have deep expertise in:
- TypeScript, React 19, Next.js 16, Tailwind CSS 4, shadcn/ui
- Cloudflare Pages (Edge Runtime), Workers (Hono), D1 (SQLite), KV
- Code auditing, security analysis, performance optimization, testing
- Git diff/patch generation, migration scripts, deployment validation

RULES:
1. ALWAYS analyze the actual code/files before making recommendations.
2. Return structured JSON when asked — no prose preambles, no markdown fences.
3. For patches, use unified git diff format (diff --git a/... b/...).
4. For migrations, use SQL compatible with Cloudflare D1 (SQLite).
5. NEVER invent APIs, dependencies, or files that don't exist.
6. Be specific — cite file paths and line numbers when possible.
7. For security issues, provide a severity (info/warning/error/critical) and a remediation plan.
8. Respect the Safe Apply workflow: never modify production directly.`,
  fallbackProviderId: "",
  fallbackModel: "gpt-4o-mini",
  autoScanEnabled: false,
  autoReportEnabled: true,
  safeApplyEnabled: true,
  requireApprovalEnabled: true,
  focusDirectories: [],
  excludeFilesPattern: "",
};

export const SEED_AI_DEV_HISTORY: AIDevAgentHistory[] = [
  {
    id: "h1",
    userId: "u_demo_001",
    provider: "DeepSeek",
    model: "deepseek-v4-flash",
    action: "code_audit",
    prompt: "Scan the project for TypeScript errors and ESLint issues",
    response: "Found 3 issues: 1) src/lib/ai.ts:249 — Property 'message' does not exist on type '{}'. 2) src/components/app/modules/Optimizer.tsx:166 — Property 'location' does not exist on type 'ResumeEducation'. 3) src/lib/exporter.ts:75 — Comparison appears unintentional.",
    status: "success",
    createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(),
  },
];

export const SEED_AI_DEV_REPORTS: AIDevReport[] = [];

// ============================================================================
// AI Workspace seed data
// ============================================================================

export const SEED_AI_TASKS: AITask[] = [
  {
    id: "t_seed_001",
    title: "Fix ATS Score Calculation",
    description: "The ATS score calculation has a bug where missing keywords are counted twice, lowering the score unfairly.",
    type: "fix",
    status: "ready",
    request: "Fix the ATS score calculation bug in src/lib/ats.ts where missing keywords are double-counted",
    plan: "1. Analyze src/lib/ats.ts scoreATS() function\n2. Identify the double-counting bug in missingKeywords calculation\n3. Generate patch to fix the counting logic\n4. Add regression test\n5. Validate build + tests",
    affectedFiles: ["src/lib/ats.ts", "src/lib/ats.test.ts"],
    generatedPatch: "diff --git a/src/lib/ats.ts b/src/lib/ats.ts\n--- a/src/lib/ats.ts\n+++ b/src/lib/ats.ts\n@@ -45,7 +45,7 @@\n-    missingKeywords: keywords.filter(k => !resumeText.includes(k)).concat(keywords.filter(k => !resumeText.includes(k))),\n+    missingKeywords: [...new Set(keywords.filter(k => !resumeText.includes(k)))],",
    generatedTests: "import { describe, it, expect } from 'vitest';\nimport { scoreATS } from './ats';\n\ndescribe('scoreATS', () => {\n  it('does not double-count missing keywords', () => {\n    const result = scoreATS(mockResume, mockJD);\n    const uniqueMissing = [...new Set(result.missingKeywords)];\n    expect(result.missingKeywords.length).toBe(uniqueMissing.length);\n  });\n});",
    createdAt: new Date(Date.now() - 1000 * 60 * 30).toISOString(),
    updatedAt: new Date(Date.now() - 1000 * 60 * 10).toISOString(),
    createdBy: "relsabah@gmail.com",
  },
];

export const SEED_AI_PATCHES: AIWorkspacePatch[] = [
  {
    id: "p_seed_001",
    taskId: "t_seed_001",
    title: "Fix: ATS score double-counting missing keywords",
    description: "Deduplicates missingKeywords array to prevent double-counting, which was unfairly lowering ATS scores.",
    diff: "diff --git a/src/lib/ats.ts b/src/lib/ats.ts\n--- a/src/lib/ats.ts\n+++ b/src/lib/ats.ts\n@@ -45,7 +45,7 @@\n-    missingKeywords: keywords.filter(k => !resumeText.includes(k)).concat(keywords.filter(k => !resumeText.includes(k))),\n+    missingKeywords: [...new Set(keywords.filter(k => !resumeText.includes(k)))],",
    modifiedFiles: ["src/lib/ats.ts"],
    newFiles: [],
    deletedFiles: [],
    impactAnalysis: "This change only affects the missingKeywords output of scoreATS(). No other code paths are affected. The fix ensures each missing keyword is counted exactly once.",
    riskAnalysis: "low",
    status: "pending",
    createdAt: new Date(Date.now() - 1000 * 60 * 10).toISOString(),
    createdBy: "relsabah@gmail.com",
  },
];

export const SEED_AI_BRANCHES: AIGitBranch[] = [
  { name: "main", isCurrent: true, isStaging: false, lastCommit: "feat: AI Builder Agent", commitCount: 245, createdAt: "2025-01-01T00:00:00Z" },
  { name: "staging/fix-ats-score", isCurrent: false, isStaging: true, lastCommit: "fix: deduplicate missing keywords", commitCount: 1, createdAt: new Date(Date.now() - 1000 * 60 * 10).toISOString() },
];

export const SEED_AI_COMMITS: AIGitCommit[] = [
  { hash: "e703789", message: "feat: Job Intelligence + Relevance Scoring + Output Validation + AI Error Leak Prevention", author: "Z User", timestamp: new Date(Date.now() - 1000 * 60 * 60 * 2).toISOString(), filesChanged: 7 },
  { hash: "c416b38", message: "fix: AI Dev Agent — handle prose responses gracefully", author: "Z User", timestamp: new Date(Date.now() - 1000 * 60 * 60 * 4).toISOString(), filesChanged: 3 },
  { hash: "4377867", message: "feat: AI Development Agent — production-grade autonomous engineering assistant", author: "Z User", timestamp: new Date(Date.now() - 1000 * 60 * 60 * 6).toISOString(), filesChanged: 8 },
];

export const SEED_AI_ROLLBACKS: AIRollback[] = [];

export const SEED_LOGS: AuditLog[] = [] as AuditLog[]; // Production: empty


export const SEED_COVER_LETTERS: CoverLetter[] = [] as CoverLetter[]; // Production: empty


export const SEED_INTERVIEW: InterviewPackage[] = [] as InterviewPackage[]; // Production: empty


export const SEED_ATS_REPORTS: ATSReport[] = [] as ATSReport[]; // Production: empty

