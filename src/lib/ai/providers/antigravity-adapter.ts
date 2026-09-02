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
   * CLI health semantics — HONEST EDITION (directive #48).
   *
   * Previously: a present token returned ok:true with NO network call —
   * "token presence" was reported as a healthy integration while every real
   * request 404'd (cloudcode-pa relays HTML 404s in the browser; live logs
   * 2026-09-02 showed the user dozens of these per optimization run).
   *
   * Now: a REAL probe request ("Reply with exactly: OK") must answer before
   * the provider is declared usable. Auth failures, endpoint 404s and
   * timeouts all surface verbatim as ok:false — no fabricated ONLINE state.
   * A 20s race bounds the probe so health checks can never hang.
   */
  async testConnection(config: ProviderConfig): Promise<{
    ok: boolean;
    latencyMs: number;
    message: string;
    response?: string;
  }> {
    const t0 = performance.now();
    const { getAntigravityProvider } = await import("../../providers/antigravity-provider");
    const provider = getAntigravityProvider();

    // Auth: browser session first, then the configured token.
    let authed = provider.isAuthenticated();
    if (!authed && config.apiKey && config.apiKey.trim() !== "") {
      try {
        await provider.login(config.apiKey);
        authed = provider.isAuthenticated();
      } catch {
        // login persistence can fail in non-browser contexts — the probe decides
      }
    }
    if (!authed) {
      try {
        const session = await provider.restore();
        authed = !!session?.authenticated;
      } catch {
        // ignore — fall through to the honest failure
      }
    }
    if (!authed) {
      return {
        ok: false,
        latencyMs: Math.round(performance.now() - t0),
        message:
          "Antigravity CLI is not connected. Connect via Google sign-in or paste a CLI token (CLI integration — no Base URL is used).",
      };
    }

    // REAL probe — a provider is only ONLINE if it actually answers.
    const PROBE_TIMEOUT_MS = 20_000;
    try {
      const probe = (async () =>
        provider.generate({
          userPrompt: "Reply with exactly: OK",
          maxTokens: 8,
          temperature: 0,
        }))();
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Antigravity probe timed out after ${PROBE_TIMEOUT_MS / 1000}s`)), PROBE_TIMEOUT_MS),
      );
      const result = await Promise.race([probe, timeout]);
      const latencyMs = Math.round(performance.now() - t0);
      return {
        ok: true,
        latencyMs,
        message: `Antigravity verified by real request — answered in ${latencyMs}ms.`,
        response: result.text,
      };
    } catch (e: any) {
      const latencyMs = Math.round(performance.now() - t0);
      return {
        ok: false,
        latencyMs,
        message: `Antigravity probe failed (${latencyMs}ms): ${e?.message ?? e}`,
      };
    }
  }

  async listModels(config: ProviderConfig): Promise<string[]> {
    // Model ownership: whatever comes back here belongs to the antigravity
    // integration (provider_id = antigravity) — even when ids are Google-family.
    const { getAntigravityProvider } = await import("../../providers/antigravity-provider");
    return getAntigravityProvider().listModels();
  }
}

export const antigravityAdapter = new AntigravityAdapter();
