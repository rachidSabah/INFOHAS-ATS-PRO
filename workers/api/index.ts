// ResumeAI Pro — Cloudflare Workers API (Hono)
// Production entrypoint. The Next.js app calls this for server-side work.
// Routes: /api/ai/* (failover), /api/jd-scrape, /api/auth/*, /api/uploads, /api/health

import { Hono } from "hono";
import { cors } from "hono/cors";
import { jwt } from "hono/jwt";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { rateLimit } from "hono-rate-limiter";

export interface Env {
  DB: D1Database;
  STORAGE: R2Bucket;
  CACHE: KVNamespace;
  JOB_QUEUE: Queue<unknown>;
  ANALYTICS: AnalyticsEngineDataset;
  REALTIME: DurableObjectNamespace;
  // secrets
  NEXTAUTH_SECRET: string;
  JWT_SECRET: string;
  ENCRYPTION_KEY: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  // vars
  APP_NAME: string;
  APP_URL: string;
  RATE_LIMIT_RPM: string;
}

const app = new Hono<{ Bindings: Env }>();

app.use("*", logger());
app.use("*", secureHeaders());
app.use(
  "*",
  cors({
    origin: (origin, c) => origin?.endsWith(c.env.APP_URL.replace("https://", "")) ? origin : null,
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  })
);

// Rate limit
app.use(
  "/api/*",
  rateLimit({
    rateLimit: (c) => ({ windowMs: 60_000, limit: parseInt(c.env.RATE_LIMIT_RPM || "60") }),
    keyGenerator: (c) => c.req.header("x-forwarded-for") || "anon",
  })
);

// Health check
app.get("/api/health", (c) =>
  c.json({ ok: true, app: c.env.APP_NAME, time: new Date().toISOString() })
);

// AI failover endpoint (used as fallback when Puter.js client-side is unavailable)
app.post("/api/ai/chat", async (c) => {
  const { systemPrompt, userPrompt, maxTokens = 4096, temperature = 0.7 } = await c.req.json();
  // 1) Try OpenAI
  if (c.env.OPENAI_API_KEY) {
    try {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${c.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: systemPrompt || "You are ResumeAI Pro." },
            { role: "user", content: userPrompt },
          ],
          max_tokens: maxTokens,
          temperature,
        }),
        signal: AbortSignal.timeout(25000),
      });
      if (r.ok) {
        const data = await r.json();
        const text = data?.choices?.[0]?.message?.content ?? "";
        if (text) return c.json({ text, provider: "openai" });
      }
    } catch (e) {
      console.warn("OpenAI failover failed", e);
    }
  }
  // 2) Try Anthropic
  if (c.env.ANTHROPIC_API_KEY) {
    try {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": c.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-3-5-sonnet-20241022",
          max_tokens: maxTokens,
          system: systemPrompt || "You are ResumeAI Pro.",
          messages: [{ role: "user", content: userPrompt }],
        }),
        signal: AbortSignal.timeout(25000),
      });
      if (r.ok) {
        const data = await r.json();
        const text = data?.content?.[0]?.text ?? "";
        if (text) return c.json({ text, provider: "anthropic" });
      }
    } catch (e) {
      console.warn("Anthropic failover failed", e);
    }
  }
  return c.json({ error: "All AI providers failed. Use Puter.js (client-side) for free AI." }, 503);
});

// JD scraper (server-side fetch with CORS bypass)
app.post("/api/jd-scrape", async (c) => {
  const { url } = await c.req.json();
  if (!url) return c.json({ error: "url required" }, 400);
  try {
    const r = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; ResumeAIProBot/1.0; +https://resumeai.pro)" },
      signal: AbortSignal.timeout(12000),
    });
    const html = await r.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return c.json({ url, text: text.slice(0, 20000) });
  } catch (e: any) {
    return c.json({ error: e?.message }, 502);
  }
});

// Auth-protected example route
app.get("/api/me", jwt({ secret: (c) => c.env.JWT_SECRET }), (c) => {
  return c.json({ user: c.get("jwtPayload") });
});

// 404
app.notFound((c) => c.json({ error: "Not found" }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Internal server error" }, 500);
});

export default app;

// Durable Object for real-time collaboration (sketch)
export class RealtimeObject implements DurableObject {
  constructor(private state: DurableObjectState, private env: Env) {}
  async fetch(_req: Request) {
    return new Response("realtime OK");
  }
}
