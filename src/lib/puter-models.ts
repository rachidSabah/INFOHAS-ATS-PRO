// ============================================================================
// Puter model catalog — SINGLE SOURCE OF TRUTH
//
// Why this file exists: before Task 14 the app shipped FOUR divergent static
// Puter model lists (8-19 ids each) that drifted apart and made the model
// prefetch look broken ("puter not listing all available models"). Task 13
// already wired the LIVE catalog (GET https://api.puter.com/puterai/chat/models
// — public, keyless, ~900+ models) into ProviderManager.fetchModels(); this
// module unifies what remains static so every surface agrees:
//
//   1. PUTER_CURATED_MODEL_IDS  — plain ids, offline/fallback rank order.
//   2. KNOWN_GOOD_PUTER_MODELS  — the same ids with UI labels (re-exported by
//      puter-client.ts for backward compatibility).
//
// Import-safety: this module is PURE (zero imports) so it can be used from
// browser-only code (puter-client, providers/puter-provider) and from
// non-browser code (ai/services/manager) alike.
//
// NOTE: static lists are FALLBACKS only. The live catalog is fetched via
// /api/providers/models → api.puter.com/puterai/chat/models and normalized by
// normalizePuterModelId() (see ai/services/manager.ts).
// ============================================================================

/** Doc-verified Puter model ids (https://docs.puter.com/AI/chat/), curated rank order. */
export const PUTER_CURATED_MODEL_IDS: readonly string[] = [
  // OpenAI (default is gpt-5-nano per the docs)
  "gpt-5-nano",
  "gpt-5.4-nano",
  "gpt-5.4",
  "gpt-4o-mini",
  "gpt-4o",
  // OpenAI reasoning models (reasoning_effort: none/minimal/low/medium/high/xhigh)
  "o3-mini",
  "o4-mini",
  // Anthropic
  "claude-sonnet-4-5",
  "claude-opus-4-8",
  "claude-3-7-sonnet",
  // Google (some support image generation)
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-2.0-flash",
  "gemini-2.5-flash-image",
  // DeepSeek
  "deepseek-chat",
  // Mistral
  "mistral-large-latest",
  // xAI
  "grok-beta",
  // Reka (video analysis)
  "reka/reka-edge",
];

export interface PuterCuratedModel {
  id: string;
  label: string;
  provider: string; // e.g. "OpenAI", "Anthropic", "Google"
}

/** Curated list with UI labels — same ids, same order as PUTER_CURATED_MODEL_IDS. */
export const KNOWN_GOOD_PUTER_MODELS: PuterCuratedModel[] = [
  // OpenAI models (default is gpt-5-nano per the docs)
  { id: "gpt-5-nano", label: "GPT-5 Nano (Puter default)", provider: "OpenAI" },
  { id: "gpt-5.4-nano", label: "GPT-5.4 Nano", provider: "OpenAI" },
  { id: "gpt-5.4", label: "GPT-5.4", provider: "OpenAI" },
  { id: "gpt-4o-mini", label: "GPT-4o Mini", provider: "OpenAI" },
  { id: "gpt-4o", label: "GPT-4o", provider: "OpenAI" },
  // OpenAI reasoning models (support reasoning_effort: none/minimal/low/medium/high/xhigh)
  { id: "o3-mini", label: "o3-mini (reasoning)", provider: "OpenAI" },
  { id: "o4-mini", label: "o4-mini (reasoning)", provider: "OpenAI" },
  // Anthropic models
  { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", provider: "Anthropic" },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8", provider: "Anthropic" },
  { id: "claude-3-7-sonnet", label: "Claude 3.7 Sonnet", provider: "Anthropic" },
  // Google models (some support image generation)
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "Google" },
  { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", provider: "Google" },
  { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", provider: "Google" },
  { id: "gemini-2.5-flash-image", label: "Gemini 2.5 Flash (Image Gen)", provider: "Google" },
  // DeepSeek
  { id: "deepseek-chat", label: "DeepSeek Chat", provider: "DeepSeek" },
  // Mistral
  { id: "mistral-large-latest", label: "Mistral Large", provider: "Mistral" },
  // xAI
  { id: "grok-beta", label: "Grok Beta", provider: "xAI" },
  // Reka (video analysis)
  { id: "reka/reka-edge", label: "Reka Edge (Video)", provider: "Reka" },
];
