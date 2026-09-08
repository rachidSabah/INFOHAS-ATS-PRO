import { describe, it, expect } from "vitest";
import {
  supportsCustomTemperature,
  isPuterTemperatureError,
  sanitizePuterChatOpts,
} from "../puter-models";

describe("supportsCustomTemperature", () => {
  it("returns false for undefined, null, or empty string (Puter default is gpt-5-nano)", () => {
    expect(supportsCustomTemperature(undefined)).toBe(false);
    expect(supportsCustomTemperature(null)).toBe(false);
    expect(supportsCustomTemperature("")).toBe(false);
    expect(supportsCustomTemperature("   ")).toBe(false);
  });

  it("returns false for GPT-5 family models", () => {
    expect(supportsCustomTemperature("gpt-5-nano")).toBe(false);
    expect(supportsCustomTemperature("gpt-5.4-nano")).toBe(false);
    expect(supportsCustomTemperature("gpt-5.4")).toBe(false);
    expect(supportsCustomTemperature("gpt-5")).toBe(false);
    expect(supportsCustomTemperature("GPT-5-NANO")).toBe(false);
  });

  it("returns false for OpenAI reasoning models (o1, o3, o4)", () => {
    expect(supportsCustomTemperature("o1")).toBe(false);
    expect(supportsCustomTemperature("o1-mini")).toBe(false);
    expect(supportsCustomTemperature("o1-preview")).toBe(false);
    expect(supportsCustomTemperature("o3-mini")).toBe(false);
    expect(supportsCustomTemperature("o4-mini")).toBe(false);
  });

  it("returns false for deepseek-r1 / reasoner models", () => {
    expect(supportsCustomTemperature("deepseek-r1")).toBe(false);
    expect(supportsCustomTemperature("deepseek-reasoner")).toBe(false);
  });

  it("returns true for standard models that support temperature", () => {
    expect(supportsCustomTemperature("gpt-4o")).toBe(true);
    expect(supportsCustomTemperature("gpt-4o-mini")).toBe(true);
    expect(supportsCustomTemperature("claude-sonnet-4-5")).toBe(true);
    expect(supportsCustomTemperature("claude-3-7-sonnet")).toBe(true);
    expect(supportsCustomTemperature("gemini-2.5-flash")).toBe(true);
    expect(supportsCustomTemperature("deepseek-chat")).toBe(true);
    expect(supportsCustomTemperature("mistral-large-latest")).toBe(true);
  });
});

describe("isPuterTemperatureError", () => {
  it("identifies Puter / OpenAI 400 temperature error messages", () => {
    const err1 = new Error("400 Unsupported value: 'temperature' does not support 0.15 with this model. Only the default (1) value is supported.");
    expect(isPuterTemperatureError(err1)).toBe(true);

    const err2 = { message: "Unsupported value: 'temperature' does not support 0 with this model." };
    expect(isPuterTemperatureError(err2)).toBe(true);

    const err3 = "400 Bad Request: temperature is not supported with this model";
    expect(isPuterTemperatureError(err3)).toBe(true);

    const err4 = "Invalid temperature: only default (1) is supported";
    expect(isPuterTemperatureError(err4)).toBe(true);
  });

  it("returns false for non-temperature errors", () => {
    expect(isPuterTemperatureError(new Error("429 rate limit exceeded"))).toBe(false);
    expect(isPuterTemperatureError(new Error("401 Unauthorized"))).toBe(false);
    expect(isPuterTemperatureError(new Error("Puter stream error"))).toBe(false);
    expect(isPuterTemperatureError(null)).toBe(false);
    expect(isPuterTemperatureError(undefined)).toBe(false);
  });
});

describe("sanitizePuterChatOpts", () => {
  it("strips temperature for models that do not support it", () => {
    const opts = sanitizePuterChatOpts({
      model: "gpt-5.4-nano",
      temperature: 0.15,
      max_tokens: 1000,
    });
    expect(opts.model).toBe("gpt-5.4-nano");
    expect(opts.max_tokens).toBe(1000);
    expect(opts.temperature).toBeUndefined();
    expect("temperature" in opts).toBe(false);
  });

  it("strips temperature when model is omitted (defaults to gpt-5-nano)", () => {
    const opts = sanitizePuterChatOpts({
      temperature: 0.15,
      max_tokens: 1000,
    });
    expect(opts.max_tokens).toBe(1000);
    expect("temperature" in opts).toBe(false);
  });

  it("preserves temperature for supported models", () => {
    const opts = sanitizePuterChatOpts({
      model: "gpt-4o",
      temperature: 0.2,
      max_tokens: 1000,
    });
    expect(opts.model).toBe("gpt-4o");
    expect(opts.temperature).toBe(0.2);
    expect(opts.max_tokens).toBe(1000);
  });
});
