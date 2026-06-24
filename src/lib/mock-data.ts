// ResumeAI Pro — seed data for built-in providers and default configs.
// All arrays (resumes, JDs, ATS reports) are intentionally empty in production —
// users create their own data. Only provider configs and system defaults are seeded.
import type {
  User, ResumeData, JobDescription, AIProvider, AIProviderLog, AIProviderSettings, PromptTemplate,
  BrandingConfig, FeatureFlags, AuditLog, CoverLetter, InterviewPackage, ATSReport,
  OptimizerDirectiveConfig,
  AIDevAgentSettings, AIDevAgentHistory, AIDevReport,
  AITask, AIWorkspacePatch, AIGitBranch, AIGitCommit, AIRollback,
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
    enabledModels: ["gpt-5.4-nano", "gpt-5-nano", "gpt-4o-mini", "gpt-4o", "claude-sonnet-4-5", "claude-3-5-sonnet", "gemini-2.5-flash", "deepseek-chat", "mistral-large-latest"],
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
    retryAttempts: 2,
    rateLimitPerMinute: 60,
    modelName: "deepseek-v4-flash-free",
    enabledModels: ["deepseek-v4-flash-free", "mimo-v2.5-free", "minimax-m2.5-free", "nemotron-3-super-free", "north-mini-code-free", "big-pickle", "claude-sonnet-4-5", "gpt-5", "gemini-3-flash", "claude-opus-4-8", "gpt-5.5"],
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
    streamingEnabled: true,
    authType: "bearer",
    costPerInputToken: 0.00000015,
    costPerOutputToken: 0.0000006,
    status: "untested",
    usage: { requests: 0, tokens: 0, errors: 0, avgLatencyMs: 0, cost: 0 },
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
    streamingEnabled: true,
    authType: "bearer",
    costPerInputToken: 0.00000014,
    costPerOutputToken: 0.00000028,
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
    modelName: "llama-3.3-70b-versatile",
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
    modelName: "anthropic/claude-3.5-sonnet",
    streamingEnabled: true,
    authType: "bearer",
    costPerInputToken: 0.000003,
    costPerOutputToken: 0.000015,
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
  type: "custom",
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
  modelName: "meta/llama-3.3-70b-instruct",
  enabledModels: ["meta/llama-3.3-70b-instruct", "meta/llama-3.1-70b-instruct", "meta/llama-4-scout-17b-16e-instruct", "meta/llama-3.1-405b-instruct"],
  streamingEnabled: true,
  authType: "bearer",
  costPerInputToken: 0,
  costPerOutputToken: 0,
  status: "healthy",
  usage: { requests: 0, tokens: 0, errors: 0, avgLatencyMs: 0, cost: 0 },
  health: { consecutiveFailures: 0, consecutiveSuccesses: 0 },
};

// === Mistral provider (Mistral Small / Ministral 3B) ===
// User-configured with their Mistral API key
const MISTRAL_PROVIDER: AIProvider = {
  id: "p_mistral",
  name: "Mistral API (Small/Ministral)",
  type: "custom",
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
  enabledModels: ["mistral-small-latest", "ministral-3b-latest", "mistral-large-latest", "open-mistral-7b"],
  streamingEnabled: true,
  authType: "bearer",
  costPerInputToken: 0.0000002,
  costPerOutputToken: 0.0000006,
  status: "healthy",
  usage: { requests: 0, tokens: 0, errors: 0, avgLatencyMs: 0, cost: 0 },
  health: { consecutiveFailures: 0, consecutiveSuccesses: 0 },
};

// Insert NVIDIA + Mistral into the providers list
SEED_PROVIDERS.push(NVIDIA_PROVIDER, MISTRAL_PROVIDER);

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
  // Default to OpenCode — API provider that works without browser auth.
  // Puter is available as a browser-auth fallback for interactive tasks.
  // NVIDIA/Mistral are fallbacks if the user configures valid API keys.
  defaultProviderId: "p_opencode",
  defaultModel: "deepseek-v4-flash-free",
  fallbackProviderIds: ["p_puter", "p_nvidia", "p_mistral"],
  retryAttempts: 2,
  timeout: 30000,
  rateLimitPerMinute: 60,
  enableFailover: true,
  enableCaching: true,
  enableCostTracking: true,
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
};

/**
 * Default optimizer directive config — matches the strict master layout
 * derived from the OUSSAMA EL FATIMI model PDF.
 *
 * Super admins can override these values via the "Optimizer Directive"
 * settings page. The values are stored in D1 and synced to all clients.
 */
export const SEED_OPTIMIZER_DIRECTIVE: OptimizerDirectiveConfig = {
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

  // === CUSTOM DIRECTIVE (ADVANCED) ===
  customDirectiveOverride: "", // empty = use generated directive
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

