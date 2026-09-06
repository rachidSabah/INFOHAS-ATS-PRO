// ============================================================================
// Workers AI core — pure, testable mapping layer for the native Cloudflare
// Workers AI binding (env.AI). NO imports from next-on-pages or the store —
// this module must stay unit-testable in plain vitest.
//
// Transport model:
//   browser adapter (workers-ai.ts) ──POST /api/providers/chat { workersAI: true }──▶
//   Pages edge route ── getRequestContext().env.AI.run(model, input) ──▶ Cloudflare
//   inference. The binding call is IN-ACCOUNT: no external egress, no proxy
//   blocks, no per-IP third-party quota — the exact failure class that kills
//   the OpenCode Zen free tier (Task 12: 429 FreeUsageLimitError keyed on the
//   shared Pages egress IP).
// ============================================================================

/** Default rescue model — fast, structured-JSON capable, 80k ctx on FP8. */
export const WORKERS_AI_DEFAULT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/** Curated model options for the Providers UI + listModels(). */
export const WORKERS_AI_MODEL_OPTIONS: string[] = [
  WORKERS_AI_DEFAULT_MODEL,
  "@cf/meta/llama-3.1-8b-instruct-fp8",
  "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
];

export interface WorkersAIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * Map the app's ChatMessage[] to a Workers AI chat-completions input.
 * Workers AI chat models accept OpenAI-style message arrays but only
 * system/user/assistant roles — "tool" messages are folded into assistant.
 */
export function buildWorkersAIRunInput(
  messages: Array<{ role: string; content: string }>,
  opts: { maxTokens?: number; temperature?: number; topP?: number } = {},
): { messages: WorkersAIMessage[]; max_tokens: number; temperature: number; top_p?: number } {
  const mapped: WorkersAIMessage[] = messages
    .filter((m) => typeof m?.content === "string" && m.content.length > 0)
    .map((m) => ({
      role: m.role === "system" || m.role === "user" ? m.role : "assistant",
      content: m.content,
    }));
  if (mapped.length === 0) {
    mapped.push({ role: "user", content: "Hello" });
  }
  const input: { messages: WorkersAIMessage[]; max_tokens: number; temperature: number; top_p?: number } = {
    messages: mapped,
    max_tokens: Math.max(1, Math.min(8192, Math.floor(opts.maxTokens ?? 4096))),
    temperature: typeof opts.temperature === "number" ? Math.max(0, Math.min(2, opts.temperature)) : 0.7,
  };
  if (typeof opts.topP === "number" && opts.topP > 0) {
    input.top_p = Math.min(1, opts.topP);
  }
  return input;
}

export interface MappedWorkersAIResult {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
  finishReason?: "stop" | "length";
}

/**
 * Normalize a Workers AI run() result into the app's ChatResponse fields.
 * Handles: { response }, { data: { response } }, { result: { response } },
 * content-part arrays, and usage token accounting. An empty response becomes
 * an empty string (caller decides whether that's fatal).
 */
export function mapWorkersAIResponse(result: any): MappedWorkersAIResult {
  let text = "";
  if (typeof result?.response === "string") {
    text = result.response;
  } else if (typeof result?.data?.response === "string") {
    text = result.data.response; // REST envelope: { success, data: { response } }
  } else if (typeof result?.result?.response === "string") {
    text = result.result.response;
  } else if (typeof result?.data === "string") {
    text = result.data;
  } else if (Array.isArray(result?.content)) {
    text = result.content
      .map((p: any) => (typeof p?.text === "string" ? p.text : ""))
      .join("");
  } else if (typeof result?.text === "string") {
    text = result.text;
  }
  // Strip reasoning traces some distill models prepend (<think>…</think>).
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  const usage = result?.usage ?? result?.data?.usage;
  return {
    text,
    inputTokens: Number.isFinite(usage?.prompt_tokens) ? Number(usage.prompt_tokens) : undefined,
    outputTokens: Number.isFinite(usage?.completion_tokens) ? Number(usage.completion_tokens) : undefined,
    finishReason: /length/i.test(String(result?.finishReason ?? result?.data?.finishReason ?? "")) ? "length" : "stop",
  };
}

/** True when an AI.run error looks like the daily neurons/quota exhaustion. */
export function isWorkersAIQuotaError(e: unknown): boolean {
  const msg = String((e as any)?.message ?? e ?? "");
  return /neuron|quota|daily limit|exceeded|429/i.test(msg);
}

export interface WorkersAIChatBody {
  model?: string;
  messages: Array<{ role: string; content: string }>;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  timeoutMs?: number;
}

/**
 * Execute a chat completion against the native AI binding with a hard
 * deadline. `envAI` is the caller-resolved binding (env.AI) — resolved by the
 * route via getRequestContext(), injected here so tests can pass a mock.
 */
export async function runWorkersAIChat(
  envAI: { run: (model: string, input: unknown) => Promise<any> },
  body: WorkersAIChatBody,
): Promise<MappedWorkersAIResult & { model: string }> {
  const model = (body.model || WORKERS_AI_DEFAULT_MODEL).trim();
  if (!model.startsWith("@cf/") && !model.startsWith("@hf/")) {
    throw new Error(`Invalid Workers AI model "${model}" — expected an @cf/ or @hf/ model id.`);
  }
  const input = buildWorkersAIRunInput(body.messages, {
    maxTokens: body.maxTokens,
    temperature: body.temperature,
    topP: body.topP,
  });
  const deadlineMs = Math.max(1000, Math.min(180_000, body.timeoutMs ?? 120_000));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const runPromise = Promise.resolve(envAI.run(model, input));
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(`Workers AI timed out after ${Math.round(deadlineMs / 1000)}s`), { name: "AbortError" })), deadlineMs);
    });
    const result = await Promise.race([runPromise, timeoutPromise]);
    return { ...mapWorkersAIResponse(result), model };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
