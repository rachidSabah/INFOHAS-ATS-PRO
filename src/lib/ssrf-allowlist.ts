// ResumeAI Pro — Shared SSRF Allowlist
// Single source of truth for allowed AI provider hostnames.
// Used by middleware.ts, /api/providers/chat, /api/providers/models, /api/providers/test
//
// When adding a new provider, add its hostname HERE — all routes will pick it up.

export const ALLOWED_PROVIDER_HOSTS = new Set([
  "api.openai.com",
  "api.anthropic.com",
  "generativelanguage.googleapis.com",
  "api.groq.com",
  "api.deepseek.com",
  "integrate.api.nvidia.com",
  "openrouter.ai",
  "api.opencode.com",
  "opencode.ai",
  "api.perplexity.ai",
  "api.mistral.ai",
  "api.cohere.com",
  "api.together.xyz",
  "api.z.ai",
  "api.aimlapi.com",
  "api.azure.com",
  "api-inference.huggingface.co",
  "api.puter.com",
  "api.cohere.ai",
  "bedrock-runtime.us-east-1.amazonaws.com",
  "bedrock-runtime.us-west-2.amazonaws.com",
]);

/**
 * Check whether a URL points to an allowed AI provider hostname.
 * Blocks internal/private IPs and non-allowlisted hosts.
 */
export function isAllowedProviderUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    const h = url.hostname.toLowerCase();

    // Block internal/private IPs (RFC 1918 + link-local + metadata)
    if (
      h === "localhost" ||
      h === "127.0.0.1" ||
      h === "0.0.0.0" ||
      h.startsWith("192.168.") ||
      h.startsWith("10.") ||
      // RFC 1918 172.16.0.0/12 — covers 172.16.x through 172.31.x
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h) ||
      h.startsWith("169.254.") ||
      h === "metadata.google.internal" ||
      h.endsWith(".local") ||
      h.endsWith(".internal")
    ) {
      return false;
    }

    return ALLOWED_PROVIDER_HOSTS.has(h);
  } catch {
    return false;
  }
}

/**
 * Headers that must NEVER be forwarded in provider proxy requests.
 * Used by chat, models, and test routes.
 */
export const BLOCKED_PROXY_HEADERS = new Set([
  "host",
  "cookie",
  "authorization", // set explicitly per provider
  "x-forwarded-for",
  "x-real-ip",
]);
