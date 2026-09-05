/**
 * Task 30c — Z.ai Web v2 signed chat contract tests.
 *
 * The signature chain is cross-checked against Node's independent
 * crypto.createHmac implementation AND a hardcoded golden vector, so a
 * WebCrypto regression cannot pass silently. The contract mirrors the
 * official chat.z.ai web client (public bundle) — the user's own session,
 * the same requests their browser makes.
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  ZAI_WEB_CHAT_V2_PATH,
  ZAI_WEB_FE_VERSION,
  ZAI_WEB_STATIC_SIGNING_KEY,
  base64Utf8,
  buildZaiWebChatRequest,
  buildZaiWebSignature,
  buildZaiWebSortedPayload,
  parseZaiWebChatResponseText,
} from "./web-contract";

const NODE_HMAC = (key: string | Buffer, msg: string) =>
  createHmac("sha256", key).update(msg).digest("hex");

describe("web-contract — signature building (official client parity)", () => {
  it("builds the exact sortedPayload (entries sorted by key, comma-joined)", () => {
    expect(
      buildZaiWebSortedPayload({ timestamp: "1756000000000", requestId: "req-1", userId: "u1" }),
    ).toBe("requestId,req-1,timestamp,1756000000000,user_id,u1");
    // missing user_id behaves like the official client's empty string
    expect(
      buildZaiWebSortedPayload({ timestamp: "1756000000000", requestId: "req-1" }),
    ).toBe("requestId,req-1,timestamp,1756000000000,user_id,");
  });

  it("base64Utf8 matches btoa(utf8 bytes), including multibyte characters", () => {
    expect(base64Utf8("hi")).toBe("aGk=");
    expect(base64Utf8("héllo ✓ 你")).toBe(Buffer.from("héllo ✓ 你", "utf8").toString("base64"));
  });

  it("matches the independent Node HMAC chain and the hardcoded golden vector", async () => {
    const parts = { timestamp: "1756000000000", requestId: "req-1", userId: "u1", prompt: "hi" };
    const { signature } = await buildZaiWebSignature(parts);

    // Independent recomputation (node:crypto)
    const sorted = buildZaiWebSortedPayload(parts);
    const h = `${sorted}|${base64Utf8("hi")}|1756000000000`;
    const bucket = Math.floor(Number("1756000000000") / (5 * 60 * 1000));
    const inner = NODE_HMAC(ZAI_WEB_STATIC_SIGNING_KEY, String(bucket));
    const expected = NODE_HMAC(inner, h);
    expect(signature).toBe(expected);
    // Hardcoded golden vector — catches silent algorithm drift
    expect(signature).toBe("6e421a678473edc44c6e1a9f0631f6c925aed47c72615731c57e4abb110b7fe4");
  });

  it("the signature changes when the prompt or the 5-minute bucket changes", async () => {
    const base = { timestamp: "1756000000000", requestId: "req-1", userId: "u1" };
    const a = await buildZaiWebSignature({ ...base, prompt: "hi" });
    const b = await buildZaiWebSignature({ ...base, prompt: "different prompt" });
    const c = await buildZaiWebSignature({ ...base, timestamp: "1756000000001", prompt: "hi" });
    expect(a.signature).not.toBe(b.signature);
    expect(a.signature).not.toBe(c.signature);
  });
});

describe("web-contract — signed chat request shape", () => {
  it("builds the full official v2 request: path, query, headers, body", async () => {
    const req = await buildZaiWebChatRequest({
      token: "TESTTOKEN123456789",
      model: "glm-4.6",
      messages: [{ role: "user", content: "optimize my resume" }],
      prompt: "optimize my resume",
      requestId: "req-2",
      timestamp: "1756000000000",
      userId: "u1",
      maxTokens: 512,
    });
    expect(req.url).toContain(`https://chat.z.ai${ZAI_WEB_CHAT_V2_PATH}?`);
    expect(req.url).toContain("signature_timestamp=1756000000000");
    expect(req.url).toContain("requestId=req-2");
    expect(req.url).toContain("platform=web");
    expect(req.url).toContain("token=TESTTOKEN123456789");
    expect(req.headers["X-FE-Version"]).toBe(ZAI_WEB_FE_VERSION);
    expect(req.headers["X-FE-Version"]).toBe("prod-fe-1.1.93");
    expect(req.headers["X-Signature"]).toBeTypeOf("string");
    expect(req.headers["X-Signature"].length).toBe(64);
    expect(req.headers.Authorization).toBe("Bearer TESTTOKEN123456789");
    // wy() adds X-Device-ID in the official client
    expect(req.headers["X-Device-ID"]).toBeTypeOf("string");
    const body = JSON.parse(req.body) as Record<string, unknown>;
    expect(body.model).toBe("glm-4.6");
    // the official client streams (model params default stream on)
    expect(body.stream).toBe(true);
    expect(body.signature_prompt).toBe("optimize my resume");
    expect((body.params as Record<string, unknown>).max_tokens).toBe(512);
    // v2 chat/message ids + features block (fresh conversation references are null)
    expect(typeof body.chat_id).toBe("string");
    expect(typeof body.id).toBe("string");
    expect(body.current_user_message_id).toBeNull();
    expect(body.current_user_message_parent_id).toBeNull();
    const features = body.features as Record<string, unknown>;
    expect(features.enable_thinking).toBe(false);
    expect(features.web_search).toBe(false);
    expect(features.auto_web_search).toBe(false);
  });
});

describe("web-contract — response parsing (JSON + SSE)", () => {
  it("parses an OpenAI-shaped JSON response", () => {
    const parsed = parseZaiWebChatResponseText(
      JSON.stringify({ choices: [{ message: { content: "Optimized text" } }], model: "glm-4.6", usage: { prompt_tokens: 10, completion_tokens: 5 } }),
    );
    expect(parsed?.content).toBe("Optimized text");
    expect(parsed?.model).toBe("glm-4.6");
    expect(parsed?.usage?.prompt_tokens).toBe(10);
  });

  it("parses a flat content response shape", () => {
    expect(parseZaiWebChatResponseText(JSON.stringify({ content: "flat answer" }))?.content).toBe("flat answer");
  });

  it("aggregates SSE delta events and stops at [DONE]", () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"Hel"}}],"model":"glm-4.6"}',
      'data: {"choices":[{"delta":{"content":"lo"}}]}',
      "data: [DONE]",
    ].join("\n");
    const parsed = parseZaiWebChatResponseText(sse);
    expect(parsed?.content).toBe("Hello");
    expect(parsed?.model).toBe("glm-4.6");
  });

  it("parses the CONFIRMED official v2 event protocol (chat:completion delta_content)", () => {
    const sse = [
      'data: {"type":"chat:completion","data":{"id":"m1","delta_content":"Optimi","phase":"answer","status":"streaming"}}',
      'data: {"type":"chat:completion","data":{"id":"m1","delta_content":"zed.","phase":"answer","status":"streaming"}}',
      'data: {"type":"chat:completion","data":{"id":"m1","done":true,"content":"Optimized.","phase":"answer","status":"finish","usage":{"prompt_tokens":11,"completion_tokens":3}}}',
      'data: {"type":"chat:title","data":"Resume"}',
      'data: {"type":"conn:heartbeat","data":{}}',
    ].join("\n\n");
    const parsed = parseZaiWebChatResponseText(sse);
    expect(parsed?.content).toBe("Optimized.");
    expect(parsed?.usage?.completion_tokens).toBe(3);
  });

  it("accumulates v2 deltas when the done event carries no full content", () => {
    const sse = [
      'data: {"type":"chat:completion","data":{"delta_content":"A","phase":"answer"}}',
      'data: {"type":"chat:completion","data":{"delta_content":"B","phase":"answer"}}',
      'data: {"type":"chat:completion","data":{"done":true,"phase":"answer","status":"finish"}}',
    ].join("\n\n");
    expect(parseZaiWebChatResponseText(sse)?.content).toBe("AB");
  });

  it("ignores thinking/tool phases and chat:message:delta appends", () => {
    const sse = [
      'data: {"type":"chat:completion","data":{"delta_content":"reasoning…","phase":"thinking"}}',
      'data: {"type":"chat:completion","data":{"delta_content":"answer text","phase":"answer"}}',
      'data: {"type":"chat:message:delta","data":{"content":" + tail"}}',
    ].join("\n\n");
    expect(parseZaiWebChatResponseText(sse)?.content).toBe("answer text + tail");
  });

  it("surfaces Z.ai completion error events instead of pretending a contract mismatch", () => {
    const sse = 'data: {"type":"chat:completion","data":{"error":{"code":429,"detail":"Too many requests"}}}';
    const parsed = parseZaiWebChatResponseText(sse);
    expect(parsed?.content).toBe("");
    expect(parsed?.error).toContain("429");
    expect(parsed?.error).toContain("Too many requests");
  });

  it("replace/chat:message events override accumulated deltas", () => {
    const sse = [
      'data: {"type":"chat:completion","data":{"delta_content":"partial","phase":"answer"}}',
      'data: {"type":"chat:message","data":{"content":"final full answer"}}',
    ].join("\n\n");
    expect(parseZaiWebChatResponseText(sse)?.content).toBe("final full answer");
  });

  it("returns null for garbage so callers can fail honestly", () => {
    expect(parseZaiWebChatResponseText("totally not json or sse")).toBeNull();
    expect(parseZaiWebChatResponseText("{}")).toBeNull();
  });
});
