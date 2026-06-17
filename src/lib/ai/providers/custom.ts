// Custom provider adapter — supports any LLM with configurable request/response templates.
// Example:
//   baseUrl: "https://api.example.com/chat"
//   headers: { "Authorization": "Bearer {{api_key}}" }
//   requestTemplate: { "model": "{{model}}", "messages": "{{messages}}", "temperature": {{temperature}} }
//   responsePath: "choices[0].message.content"
import { ProviderError } from "./openai-compatible";
import type { AIProviderAdapter, ChatRequest, ChatResponse, ProviderConfig } from "./interface";

export class CustomProvider implements AIProviderAdapter {
  readonly type = "custom";

  async chat(req: ChatRequest, config: ProviderConfig): Promise<ChatResponse> {
    const t0 = performance.now();
    if (!config.baseUrl) throw new Error("Custom provider requires baseUrl");
    const model = req.model || config.modelName || "default";

    // Build headers from template
    const headers: Record<string, string> = { "Content-Type": "application/json", ...this.parseJson(config.headersJson) };
    if (config.apiKey) {
      if (config.authType === "bearer" || !config.authType) {
        headers["Authorization"] = `Bearer ${config.apiKey}`;
      } else if (config.authType === "header") {
        headers["X-API-Key"] = config.apiKey;
      }
    }

    // Build body from template, or fall back to OpenAI schema
    let body: any;
    if (config.requestTemplate) {
      body = this.interpolateTemplate(config.requestTemplate, {
        model,
        messages: req.messages,
        temperature: req.temperature ?? config.temperature,
        max_tokens: req.maxTokens ?? config.maxTokens,
        api_key: config.apiKey ?? "",
      });
    } else {
      body = {
        model,
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
        temperature: req.temperature ?? config.temperature,
        max_tokens: req.maxTokens ?? config.maxTokens,
        ...this.parseJson(config.parametersJson),
      };
    }

    const url = config.authType === "query" && config.apiKey
      ? `${config.baseUrl}${config.baseUrl.includes("?") ? "&" : "?"}api_key=${encodeURIComponent(config.apiKey)}`
      : config.baseUrl;

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: req.signal ?? AbortSignal.timeout(config.timeout),
    });
    const latencyMs = Math.round(performance.now() - t0);
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new ProviderError(`Custom provider ${res.status}: ${errText.slice(0, 200)}`, res.status, latencyMs);
    }
    const data = await res.json();

    // Extract text via responsePath, or fall back to common paths
    const text = config.responsePath
      ? this.extractPath(data, config.responsePath)
      : (data?.choices?.[0]?.message?.content ?? data?.content?.[0]?.text ?? data?.text ?? data?.output ?? "");

    return {
      text: typeof text === "string" ? text : JSON.stringify(text),
      provider: "custom",
      model,
      latencyMs,
      inputTokens: data?.usage?.prompt_tokens ?? data?.usage?.input_tokens,
      outputTokens: data?.usage?.completion_tokens ?? data?.usage?.output_tokens,
      raw: data,
    };
  }

  async testConnection(config: ProviderConfig) {
    const t0 = performance.now();
    try {
      const res = await this.chat({ messages: [{ role: "user", content: "Reply with: OK" }], maxTokens: 10 }, { ...config, timeout: Math.min(config.timeout, 10000) });
      return { ok: true, latencyMs: res.latencyMs, message: `Custom provider OK`, response: res.text };
    } catch (e: any) {
      return { ok: false, latencyMs: Math.round(performance.now() - t0), message: e?.message || "Connection failed" };
    }
  }

  private parseJson(s?: string): Record<string, any> {
    if (!s) return {};
    try { return JSON.parse(s); } catch { return {}; }
  }

  private interpolateTemplate(template: string, vars: Record<string, any>): any {
    // If template is JSON-shaped, parse then walk
    try {
      const obj = JSON.parse(template);
      return this.walkInterpolate(obj, vars);
    } catch {
      // Not JSON — return as string with substitutions
      return template
        .replace(/\{\{model\}\}/g, vars.model)
        .replace(/\{\{temperature\}\}/g, String(vars.temperature))
        .replace(/\{\{max_tokens\}\}/g, String(vars.max_tokens))
        .replace(/\{\{api_key\}\}/g, vars.api_key);
    }
  }

  private walkInterpolate(obj: any, vars: Record<string, any>): any {
    if (typeof obj === "string") {
      // Handle "{{messages}}" → inject messages array directly
      if (obj === "{{messages}}") return vars.messages;
      return obj
        .replace(/\{\{model\}\}/g, vars.model)
        .replace(/\{\{temperature\}\}/g, String(vars.temperature))
        .replace(/\{\{max_tokens\}\}/g, String(vars.max_tokens))
        .replace(/\{\{api_key\}\}/g, vars.api_key);
    }
    if (Array.isArray(obj)) return obj.map((o) => this.walkInterpolate(o, vars));
    if (obj && typeof obj === "object") {
      const out: any = {};
      for (const k of Object.keys(obj)) out[k] = this.walkInterpolate(obj[k], vars);
      return out;
    }
    return obj;
  }

  private extractPath(data: any, path: string): any {
    // Support "choices[0].message.content" style paths
    const parts = path.match(/[^.\[\]]+|\[\d+\]/g) ?? [];
    let cur = data;
    for (const p of parts) {
      if (p.startsWith("[") && p.endsWith("]")) {
        cur = cur?.[parseInt(p.slice(1, -1))];
      } else {
        cur = cur?.[p];
      }
      if (cur === undefined) return "";
    }
    return cur;
  }
}

export const customProvider = new CustomProvider();
