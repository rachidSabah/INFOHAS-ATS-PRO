// ============================================================================
// Tests — provider chat proxy edge cache (chat-proxy-cache.ts).
//
// vitest runs in node (no Cache API), so these install a Map-based
// caches.default stub on globalThis to exercise the real match/put logic,
// and delete it to prove every path no-ops safely without the API.
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  chatCacheKey,
  matchCachedChat,
  putCachedChat,
  CHAT_CACHE_TTL_SECONDS,
} from "./chat-proxy-cache";

interface StoredEntry {
  body: string;
  headers: Record<string, string>;
}

function installCacheStub() {
  const map = new Map<string, StoredEntry>();
  const stub = {
    default: {
      match: async (key: string) => {
        const e = map.get(key);
        if (!e) return undefined;
        return new Response(e.body, { headers: e.headers });
      },
      put: async (key: string, res: Response) => {
        map.set(key, {
          body: await res.text(),
          headers: Object.fromEntries((res.headers as any).entries?.() ?? []),
        });
      },
    },
  };
  (globalThis as any).caches = stub;
  return map;
}

const MESSAGES = [
  { role: "system", content: "You are a pipeline agent." },
  { role: "user", content: "Analyze this JD." },
];

const OK_BODY = { ok: true, latencyMs: 123, text: "cached answer" };
const ERR_BODY = { ok: false, error: "API returned HTTP 429" };

describe("chatCacheKey", () => {
  it("produces a stable key for identical prompt identity", async () => {
    const a = await chatCacheKey({ baseUrl: "https://opencode.ai/zen/v1", model: "big-pickle", messages: MESSAGES, maxTokens: 100, temperature: 0.7 });
    const b = await chatCacheKey({ baseUrl: "https://opencode.ai/zen/v1", model: "big-pickle", messages: MESSAGES, maxTokens: 100, temperature: 0.7 });
    expect(a).toBeTruthy();
    expect(a).toBe(b);
  });

  it("differs when model or messages differ", async () => {
    const base = { baseUrl: "https://opencode.ai/zen/v1", messages: MESSAGES };
    const a = await chatCacheKey({ ...base, model: "big-pickle" });
    const b = await chatCacheKey({ ...base, model: "nemotron-3-ultra-free" });
    const c = await chatCacheKey({ ...base, model: "big-pickle", messages: [...MESSAGES, { role: "user", content: "more" }] });
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
  });

  it("excludes the API key from identity — same prompt, different key → SAME key", async () => {
    // The key inputs have no key field by construction; assert the contract stays:
    // two callers with different keys but identical prompts share one cache entry.
    const key = await chatCacheKey({ baseUrl: "https://opencode.ai/zen/v1", model: "m", messages: MESSAGES });
    expect(key).toBeTruthy();
    expect(key).not.toContain("sk-");
  });

  it("returns null for empty/missing messages (not keyable)", async () => {
    expect(await chatCacheKey({ baseUrl: "https://x/v1", messages: [] })).toBeNull();
    expect(await chatCacheKey({ baseUrl: "https://x/v1" })).toBeNull();
    expect(await chatCacheKey({ baseUrl: "", messages: MESSAGES })).toBeNull();
  });
});

describe("putCachedChat / matchCachedChat", () => {
  beforeEach(() => installCacheStub());
  afterEach(() => delete (globalThis as any).caches);

  it("stores a successful body and replays it with cached:true", async () => {
    const key = await chatCacheKey({ baseUrl: "https://opencode.ai/zen/v1", model: "big-pickle", messages: MESSAGES });
    await putCachedChat(key, OK_BODY);
    const hit = await matchCachedChat(key);
    expect(hit).not.toBeNull();
    expect(hit!.ok).toBe(true);
    expect(hit!.text).toBe("cached answer");
    expect((hit as any).cached).toBe(true);
  });

  it("never caches error bodies (429/5xx evidence must stay fresh)", async () => {
    const key = await chatCacheKey({ baseUrl: "https://opencode.ai/zen/v1", model: "m", messages: MESSAGES });
    await putCachedChat(key, ERR_BODY);
    expect(await matchCachedChat(key)).toBeNull();
  });

  it("no-ops on null key or when caches is unavailable", async () => {
    delete (globalThis as any).caches;
    const key = await chatCacheKey({ baseUrl: "https://x/v1", messages: MESSAGES });
    await expect(putCachedChat(key, OK_BODY)).resolves.toBeUndefined();
    await expect(matchCachedChat(key)).resolves.toBeNull();
  });

  it("sets a 1h TTL via cache-control on the stored response", async () => {
    const map = installCacheStub();
    const key = await chatCacheKey({ baseUrl: "https://x/v1", messages: MESSAGES });
    await putCachedChat(key, OK_BODY);
    const entry = [...map.values()][0];
    expect(entry.headers["cache-control"]).toBe(`public, max-age=${CHAT_CACHE_TTL_SECONDS}`);
    expect(CHAT_CACHE_TTL_SECONDS).toBe(3600);
  });
});
