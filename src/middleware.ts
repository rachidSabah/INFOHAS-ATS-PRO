// ResumeAI Pro — Security Middleware
// Adds security headers, basic rate limiting, and route protection.
// Runs on the Edge Runtime (compatible with Cloudflare Pages).

import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isAllowedProviderUrl } from "@/lib/ssrf-allowlist";

// ============================================================================
// Rate Limiting (in-memory, per-worker — best-effort on edge)
// ============================================================================

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 30; // 30 requests per minute per IP

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now >= entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  entry.count++;
  if (entry.count > RATE_LIMIT_MAX_REQUESTS) {
    return false; // Rate limited
  }
  return true;
}

// Cleanup old entries periodically (prevent memory leak)
if (typeof setInterval !== "undefined") {
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of rateLimitMap) {
      if (now >= entry.resetAt) {
        rateLimitMap.delete(key);
      }
    }
  }, 5 * 60_000); // Every 5 minutes
}

// ============================================================================
// Routes that should be disabled in production
// ============================================================================

const PRODUCTION_BLOCKED_ROUTES = ["/api/debug", "/debug"];
const PRODUCTION_RESTRICTED_ROUTES = ["/api/qa/run", "/api/health"];

// ============================================================================
// Middleware
// ============================================================================

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProduction = process.env.NODE_ENV === "production";

  // === 1. Block debug routes in production ===
  if (isProduction && PRODUCTION_BLOCKED_ROUTES.some((r) => pathname.startsWith(r))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // === 2. Rate limiting for API routes ===
  if (pathname.startsWith("/api/")) {
    const ip =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";

    if (!checkRateLimit(ip)) {
      return NextResponse.json(
        { error: "Rate limit exceeded. Please try again later." },
        { status: 429, headers: { "Retry-After": "60" } },
      );
    }
  }

  // === 3. SSRF protection for provider proxy routes ===
  // Uses shared isAllowedProviderUrl from ssrf-allowlist.ts — single source of truth
  // with proper 172.16.0.0/12 blocking (172.16-31.x.x) and all provider hosts.
  if (
    pathname.startsWith("/api/providers/chat") ||
    pathname.startsWith("/api/providers/models") ||
    pathname.startsWith("/api/providers/test")
  ) {
    // Check the baseUrl in the request body (for POST requests)
    // We can't read the body in middleware without cloning, so we check
    // the query param fallback. The actual body validation happens in the
    // route handler — this is a first-pass check.
    const baseUrl = request.nextUrl.searchParams.get("baseUrl");
    if (baseUrl && !isAllowedProviderUrl(baseUrl)) {
      return NextResponse.json(
        { error: "Provider URL not allowed. Only known AI provider APIs are supported." },
        { status: 403 },
      );
    }
  }

  // === 4. Security headers on all responses ===
  const response = NextResponse.next();
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-XSS-Protection", "1; mode=block");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  // Content Security Policy — allow same-origin and necessary external resources
  if (isProduction) {
    response.headers.set(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://api.z.ai https://api.openai.com https://api.anthropic.com https://api.groq.com https://api.deepseek.com https://openrouter.ai https://opencode.ai https://api.mistral.ai https://api.cohere.com https://api.perplexity.ai https://api.together.xyz https://api-inference.huggingface.co https://*.cloudflare.com https://puter.com https://accounts.google.com https://generativelanguage.googleapis.com;",
    );
  }

  // Strict Transport Security (only in production over HTTPS)
  if (isProduction) {
    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }

  return response;
}

// ============================================================================
// Matcher — only run middleware on API routes and debug pages
// ============================================================================

export const config = {
  matcher: [
    "/api/:path*",
    "/debug/:path*",
    "/qa/:path*",
    "/test/:path*",
  ],
};
