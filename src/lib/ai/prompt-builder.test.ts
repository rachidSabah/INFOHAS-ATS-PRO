import { describe, it, expect } from "vitest";
import { PromptBuilder, buildPrompt, toAICallOptions, serializePrompt } from "./prompt-builder";

describe("PromptBuilder", () => {
  it("composes system + user into AICallOptions-shaped output", () => {
    const built = new PromptBuilder({ scope: "cover-letter", feature: "Cover Letter" })
      .system("You are a writer.")
      .user("Write a letter.")
      .build();
    expect(built.systemPrompt).toBe("You are a writer.");
    expect(built.userPrompt).toBe("Write a letter.");
    expect(built.promptVersion).toBe("8.1.3.2A");
    expect(built.size).toBeGreaterThan(0);
    expect(built.assemblyMs).toBeGreaterThanOrEqual(0);
    expect(built.source).toBe("PromptBuilder");
  });

  it("does NOT change prompt wording", () => {
    const sys = "System: keep this exact text. {curly braces} and @@@ markers";
    const usr = "User: also exact. With {{placeholders}} that must remain literal.";
    const built = new PromptBuilder().system(sys).user(usr).build();
    expect(built.systemPrompt).toBe(sys);
    expect(built.userPrompt).toBe(usr);
  });

  it("interpolates only when variables are provided", () => {
    const built = new PromptBuilder({ variables: { name: "Ada" } })
      .system("Hello {{name}}")
      .user("Hi {{name}}")
      .build();
    expect(built.systemPrompt).toBe("Hello Ada");
    expect(built.userPrompt).toBe("Hi Ada");

    // Without variables, braces are preserved verbatim (no accidental mutation).
    const literal = new PromptBuilder().user("Hi {{name}}").build();
    expect(literal.userPrompt).toBe("Hi {{name}}");
  });

  it("folds developer role into system on assembly", () => {
    const built = new PromptBuilder()
      .system("SYS")
      .developer("DEV")
      .user("USR")
      .build();
    expect(built.systemPrompt).toBe("SYS\n\nDEV");
    expect(built.userPrompt).toBe("USR");
  });

  it("produces multi-turn messages when requested", () => {
    const built = new PromptBuilder()
      .system("SYS")
      .user("first")
      .assistant("reply")
      .user("second")
      .asMessages()
      .build();
    expect(built.messages?.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(built.messages?.[1].content).toBe("first");
  });

  it("validates structure and reports warnings", () => {
    const empty = new PromptBuilder();
    const v = empty.validate();
    expect(v.ok).toBe(false);
    expect(v.warnings.length).toBeGreaterThan(0);

    const ok = new PromptBuilder().user("hi").validate();
    expect(ok.ok).toBe(true);
  });

  it("produces a stable hash for identical content", () => {
    const a = buildPrompt("S", "U");
    const b = buildPrompt("S", "U");
    expect(a.promptHash).toBe(b.promptHash);
    const c = buildPrompt("S", "U2");
    expect(c.promptHash).not.toBe(a.promptHash);
  });

  it("maps onto AICallOptions via toAICallOptions", () => {
    const built = new PromptBuilder().user("x").build();
    const opts = toAICallOptions(built);
    expect(opts.userPrompt).toBe("x");
  });

  it("serializes without secrets", () => {
    const built = new PromptBuilder({ scope: "resume-builder", tags: ["t1"] }).user("x").build();
    const s = serializePrompt(built);
    expect(s).not.toContain("x"); // payload content not in the diagnostic summary
    expect(s).toContain(built.promptHash);
  });
});
