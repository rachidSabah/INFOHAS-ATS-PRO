import { describe, it, expect } from "vitest";
import { ContextBuilder, serializeContext } from "./context-builder";

describe("ContextBuilder", () => {
  it("assembles ordered sections with headings", () => {
    const ctx = new ContextBuilder({ scope: "interview", feature: "Interview" })
      .resume({ name: "A" })
      .jobDescription({ title: "B" })
      .persona({ role: "HR" })
      .build();
    expect(ctx.text).toContain("RESUME");
    expect(ctx.text).toContain("JOB DESCRIPTION");
    expect(ctx.text).toContain("PERSONA");
    expect(ctx.size).toBeGreaterThan(0);
    expect(ctx.sections.map((s) => s.kind)).toEqual(["resume", "job-description", "persona"]);
    expect(ctx.source).toBe("ContextBuilder");
  });

  it("never executes AI and contains no business logic", () => {
    // build() returns a string + hash; there is no async/network call.
    const ctx = new ContextBuilder().resume("data").build();
    expect(typeof ctx.text).toBe("string");
    expect(ctx.hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it("captures entity refs for the Flight Recorder (no payloads)", () => {
    const ctx = new ContextBuilder({ refs: { resumeId: "r1", jdId: "j1", personaId: "p1" } })
      .resume("x")
      .build();
    expect(ctx.refs).toEqual({ resumeId: "r1", jdId: "j1", personaId: "p1" });
  });

  it("produces a stable hash for identical inputs", () => {
    const a = new ContextBuilder().resume("same").build();
    const b = new ContextBuilder().resume("same").build();
    expect(a.hash).toBe(b.hash);
    const c = new ContextBuilder().resume("diff").build();
    expect(c.hash).not.toBe(a.hash);
  });

  it("compose merges sections from another builder", () => {
    const a = new ContextBuilder().resume("r");
    const b = new ContextBuilder().persona("p").compose(a).build();
    expect(b.sections.map((s) => s.kind)).toContain("resume");
    expect(b.sections.map((s) => s.kind)).toContain("persona");
  });

  it("serializes shape without payloads", () => {
    const ctx = new ContextBuilder({ scope: "ats-analysis" }).atsAnalysis({ score: 90 }).build();
    const s = serializeContext(ctx);
    expect(s).not.toContain("90"); // payload value not in diagnostic summary
    expect(s).toContain(ctx.hash);
  });
});
