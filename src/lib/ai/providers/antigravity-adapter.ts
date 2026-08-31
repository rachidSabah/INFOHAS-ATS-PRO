/**
 * Task 29 — Antigravity CLI adapter for the modern ProviderRouter.
 *
 * WHY THIS EXISTS (audit finding, 2026-08-31): ProviderFactory's REGISTRY had
 * no "antigravity" entry, so every router path — chat, benchmark pings,
 * testConnection, health probes — silently fell back to the `custom`
 * adapter for provider type "antigravity". The complete Antigravity CLI
 * integration stack (src/lib/providers/antigravity-provider.ts,
 * antigravity-auth.ts, antigravity-health.ts, the OAuth API routes) was
 * therefore unreachable from the runtime, and the app could only treat the
 * CLI provider as an unconfigured REST endpoint.
 *
 * This adapter bridges the modern AIProviderAdapter contract to the legacy
 * stack. It is deliberately CLI-shaped:
 *  - testConnection checks TOKEN PRESENCE (config.apiKey = the Google/
 *    Antigravity access token). It never probes a REST endpoint, because
 *    cloudcode-pa.googleapis.com is an internal Google API that always
 *    answers 404/403 from servers — the same reasoning as the edge route's
 *    synthetic Antigravity check.
 *  - chat() delegates to generateAntigravity() through the singleton
 *    AntigravityProvider session (token refresh + health recording included).
 *  - A Google-family model id inside this adapter is an ANTIGRAVITY model:
 *    routing is decided by provider identity, never by model-name matching.
 *
 * Google sign-in is the AUTH MECHANISM of this integration — it is NOT the
 * Google Gemini REST API provider (that one lives in the `gemini` adapter
 * with baseUrl https://generativelanguage.googleapis.com/v1beta).
 */

import type {
  AIProviderAdapter,
  ChatRequest,
  ChatResponse,
  ProviderConfig,
} from "./interface";
import { ProviderAuthenticationError } from "../../providers/interface";

export class AntigravityAdapter implements AIProviderAdapter {
  readonly type = "antigravity";

  async chat(req: ChatRequest, config: ProviderConfig): Promise<ChatResponse> {
    const { getAntigravityProvider } = await import("../../providers/antigravity-provider");
    const provider = getAntigravityProvider();

    // Last line of defense: never fall through to an OpenAI-shaped REST call
    // against cloudcode-pa when the CLI session is unauthenticated.
    if (!provider.isAuthenticated() && !(config.apiKey && config.apiKey.trim() !== "")) {
      throw new ProviderAuthenticationError(
        "auth_required",
        "Antigravity CLI is not connected. Connect it via Google sign-in or paste a CLI token in the Antigravity CLI card.",
        "antigravity",
      );
    }

    // Seed the session from the configured token when the browser session is
    // empty but the provider record carries one (e.g. server-side routes).
    if (!provider.isAuthenticated() && config.apiKey) {
      try {
        await provider.login(config.apiKey);
      } catch {
        // login() persisting may fail in non-browser contexts — generate()
        // below still attempts with the session seeded in memory.
      }
    }

    const userPrompt = req.messages
      .filter((m) => m.role !== "system")
      .map((m) => (typeof m.content === "string" ? m.content : ""))
      .join("\n")
      .trim();
    const systemPrompt = req.messages.find((m) => m.role === "system");
    const systemText =
      systemPrompt && typeof systemPrompt.content === "string" ? systemPrompt.content : undefined;

    const result = await provider.generate({
      systemPrompt: systemText,
      userPrompt: userPrompt || "Reply with exactly: OK",
      model: req.model || config.modelName,
      maxTokens: req.maxTokens ?? config.maxTokens,
      temperature: req.temperature ?? config.temperature,
    });

    return {
      text: result.text,
      provider: "antigravity",
      model: req.model || config.modelName || "antigravity-default",
      latencyMs: result.latencyMs,
    };
  }

  /**
   * CLI health semantics: the integration is healthy when a token exists.
   * Inference runs through the CLI runtime — probing cloudcode-pa over REST
   * from a server always 404s and would falsely declare the provider down.
   */
  async testConnection(config: ProviderConfig): Promise<{
    ok: boolean;
    latencyMs: number;
    message: string;
    response?: string;
  }> {
    const t0 = performance.now();
    const hasToken = !!(config.apiKey && config.apiKey.trim() !== "");
    if (!hasToken) {
      // A stored browser session counts even when the record has no key copy.
      try {
        const { getAntigravityProvider } = await import("../../providers/antigravity-provider");
        const session = await getAntigravityProvider().restore();
        if (session?.authenticated) {
          return {
            ok: true,
            latencyMs: Math.round(performance.now() - t0),
            message: "Antigravity CLI session active (Google sign-in) — CLI integration ready.",
          };
        }
      } catch {
        // ignore — fall through to the failure message
      }
      return {
        ok: false,
        latencyMs: 0,
        message:
          "Antigravity CLI is not connected. Connect via Google sign-in or paste a CLI token (CLI integration — no Base URL is used).",
      };
    }
    return {
      ok: true,
      latencyMs: Math.round(performance.now() - t0),
      message:
        "Antigravity CLI token present — CLI integration ready (Google sign-in is the auth mechanism; inference is handled by the Antigravity CLI runtime, not the Gemini REST API).",
      response: "OK",
    };
  }

  async listModels(config: ProviderConfig): Promise<string[]> {
    // Model ownership: whatever comes back here belongs to the antigravity
    // integration (provider_id = antigravity) — even when ids are Google-family.
    const { getAntigravityProvider } = await import("../../providers/antigravity-provider");
    return getAntigravityProvider().listModels();
  }
}

export const antigravityAdapter = new AntigravityAdapter();
