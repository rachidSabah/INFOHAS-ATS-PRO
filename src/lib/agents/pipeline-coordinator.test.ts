// ============================================================================
// Pipeline Coordinator Tests
// ============================================================================

import { describe, it, expect, vi } from "vitest";
import {
  validatePipelineDefinition,
  runCoordinatedPipeline,
  type PipelineDefinition,
  type PipelineStep,
} from "./pipeline-coordinator";
import { createEmptyContext, type GlobalPipelineContext } from "./pipeline-context";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const emptyCtx = (): GlobalPipelineContext => createEmptyContext();

function step(
  id: string,
  label: string,
  deps: string[] = [],
  opts?: { timeout?: number; retries?: number; fail?: boolean; delay?: number },
): PipelineStep {
  return {
    id,
    label,
    dependencies: deps,
    timeout: opts?.timeout ?? 30_000,
    retries: opts?.retries ?? 0,
    execute: async () => {
      if (opts?.delay) {
        await new Promise((r) => setTimeout(r, opts.delay!));
      }
      if (opts?.fail) {
        throw new Error(`Step "${id}" simulated failure`);
      }
      return { step: id };
    },
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

describe("validatePipelineDefinition", () => {
  it("accepts a valid pipeline with no dependencies", () => {
    const def: PipelineDefinition = {
      id: "test",
      steps: [
        step("a", "Step A"),
        step("b", "Step B"),
        step("c", "Step C"),
      ],
    };
    expect(validatePipelineDefinition(def)).toEqual([]);
  });

  it("accepts a pipeline with dependencies", () => {
    const def: PipelineDefinition = {
      id: "test",
      steps: [
        step("a", "Step A"),
        step("b", "Step B", ["a"]),
        step("c", "Step C", ["b"]),
      ],
    };
    expect(validatePipelineDefinition(def)).toEqual([]);
  });

  it("rejects duplicate step IDs", () => {
    const def: PipelineDefinition = {
      id: "test",
      steps: [
        { ...step("a", "Step A"), id: "dupe" },
        { ...step("b", "Step B"), id: "dupe" },
      ],
    };
    const errors = validatePipelineDefinition(def);
    expect(errors.some((e) => e.includes("Duplicate"))).toBe(true);
  });

  it("rejects circular dependencies", () => {
    const def: PipelineDefinition = {
      id: "test",
      steps: [
        step("a", "Step A", ["c"]),
        step("b", "Step B", ["a"]),
        step("c", "Step C", ["b"]),
      ],
    };
    const errors = validatePipelineDefinition(def);
    expect(errors.some((e) => e.toLowerCase().includes("circular"))).toBe(true);
  });

  it("rejects missing dependency references", () => {
    const def: PipelineDefinition = {
      id: "test",
      steps: [
        step("a", "Step A", ["nonexistent"]),
      ],
    };
    const errors = validatePipelineDefinition(def);
    expect(errors.some((e) => e.includes("unknown"))).toBe(true);
  });

  it("rejects empty pipeline", () => {
    const def: PipelineDefinition = { id: "empty", steps: [] };
    const errors = validatePipelineDefinition(def);
    expect(errors.some((e) => e.includes("no steps"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Execution - basic
// ---------------------------------------------------------------------------

describe("runCoordinatedPipeline", () => {
  it("runs all steps in order with no dependencies", async () => {
    const def: PipelineDefinition = {
      id: "test",
      steps: [step("a", "A"), step("b", "B"), step("c", "C")],
    };
    const result = await runCoordinatedPipeline(def, emptyCtx());
    expect(result.status).toBe("completed");
    expect(result.outcomes).toHaveLength(3);
    expect(result.outcomes.every((o) => o.status === "completed")).toBe(true);
  });

  it("respects dependency order (topological sort)", async () => {
    const order: string[] = [];
    const def: PipelineDefinition = {
      id: "test",
      steps: [
        {
          id: "first",
          label: "First",
          dependencies: [],
          execute: async () => { order.push("first"); },
        },
        {
          id: "third",
          label: "Third",
          dependencies: ["second"],
          execute: async () => { order.push("third"); },
        },
        {
          id: "second",
          label: "Second",
          dependencies: ["first"],
          execute: async () => { order.push("second"); },
        },
      ],
    };
    await runCoordinatedPipeline(def, emptyCtx());
    expect(order).toEqual(["first", "second", "third"]);
  });

  it("collects step outputs in stepResults", async () => {
    const captured: string[] = [];
    const def: PipelineDefinition = {
      id: "test",
      steps: [
        {
          id: "source",
          label: "Source",
          dependencies: [],
          execute: async () => ({ value: 42 }),
        },
        {
          id: "consumer",
          label: "Consumer",
          dependencies: ["source"],
          execute: async (ctx) => {
            const src = ctx.stepResults.get("source") as any;
            captured.push(src?.value);
            return {};
          },
        },
      ],
    };
    await runCoordinatedPipeline(def, emptyCtx());
    expect(captured).toEqual([42]);
  });

  it("marks pipeline as completed when all steps succeed", async () => {
    const def: PipelineDefinition = {
      id: "test",
      steps: [step("a", "A"), step("b", "B")],
    };
    const result = await runCoordinatedPipeline(def, emptyCtx());
    expect(result.status).toBe("completed");
  });

  it("tracks duration per step", async () => {
    const def: PipelineDefinition = {
      id: "test",
      steps: [step("a", "A", [], { delay: 10 })],
    };
    const result = await runCoordinatedPipeline(def, emptyCtx());
    expect(result.outcomes[0].durationMs).toBeGreaterThanOrEqual(5);
  });
});

// ---------------------------------------------------------------------------
// Failure handling
// ---------------------------------------------------------------------------

describe("failure handling", () => {
  it("marks pipeline as failed when a step fails", async () => {
    const def: PipelineDefinition = {
      id: "test",
      steps: [step("ok", "OK"), step("bad", "Bad", [], { fail: true })],
    };
    const result = await runCoordinatedPipeline(def, emptyCtx());
    expect(result.status).toBe("failed");
  });

  it("skips downstream steps when a dependency fails", async () => {
    const def: PipelineDefinition = {
      id: "test",
      steps: [
        step("root", "Root"),
        step("failing", "Failing", ["root"], { fail: true }),
        step("dependent", "Dependent", ["failing"]),
      ],
    };
    const result = await runCoordinatedPipeline(def, emptyCtx());
    expect(result.status).toBe("failed");
    const skipped = result.outcomes.find((o) => o.stepId === "dependent");
    expect(skipped?.status).toBe("skipped");
  });

  it("uses fallback when step fails and fallback is provided", async () => {
    const def: PipelineDefinition = {
      id: "test",
      steps: [
        {
          id: "flaky",
          label: "Flaky",
          dependencies: [],
          execute: async () => { throw new Error("oops"); },
          fallback: async () => ({ from: "fallback" }),
        },
        {
          id: "consumer",
          label: "Consumer",
          dependencies: ["flaky"],
          execute: async (ctx) => {
            const src = ctx.stepResults.get("flaky") as any;
            return { consumed: src?.from };
          },
        },
      ],
    };
    const result = await runCoordinatedPipeline(def, emptyCtx());
    expect(result.status).toBe("completed");
    const flakyOutcome = result.outcomes.find((o) => o.stepId === "flaky");
    expect(flakyOutcome?.status).toBe("fallback");
    expect(flakyOutcome?.error).toContain("oops");
  });

  it("retries transient errors", async () => {
    let attempts = 0;
    const def: PipelineDefinition = {
      id: "test",
      steps: [
        {
          id: "retry-me",
          label: "Retry Me",
          dependencies: [],
          retries: 2,
          execute: async () => {
            attempts++;
            if (attempts < 3) throw new Error("Timeout — transient");
            return { ok: true };
          },
        },
      ],
    };
    const result = await runCoordinatedPipeline(def, emptyCtx());
    expect(result.status).toBe("completed");
    expect(attempts).toBe(3);
  });

  it("fails after exhausting retries without fallback", async () => {
    let attempts = 0;
    const def: PipelineDefinition = {
      id: "test",
      steps: [
        {
          id: "always-fail",
          label: "Always Fail",
          dependencies: [],
          retries: 2,
          execute: async () => {
            attempts++;
            throw new Error("Persistent error");
          },
        },
      ],
    };
    const result = await runCoordinatedPipeline(def, emptyCtx());
    expect(result.status).toBe("failed");
    expect(attempts).toBe(1); // only 1 attempt — error is not transient
  });
});

// ---------------------------------------------------------------------------
// Timeout
// ---------------------------------------------------------------------------

describe("timeout handling", () => {
  it("fails a step that exceeds its timeout", async () => {
    const def: PipelineDefinition = {
      id: "test",
      steps: [
        {
          id: "slow",
          label: "Slow",
          dependencies: [],
          timeout: 50,
          execute: async () => {
            await new Promise((r) => setTimeout(r, 200));
            return {};
          },
        },
      ],
    };
    const result = await runCoordinatedPipeline(def, emptyCtx());
    expect(result.status).toBe("failed");
    expect(result.outcomes[0].error).toContain("Timeout");
  });

  it("does not timeout a fast step", async () => {
    const def: PipelineDefinition = {
      id: "test",
      steps: [
        {
          id: "fast",
          label: "Fast",
          dependencies: [],
          timeout: 500,
          execute: async () => {
            await new Promise((r) => setTimeout(r, 10));
            return { ok: true };
          },
        },
      ],
    };
    const result = await runCoordinatedPipeline(def, emptyCtx());
    expect(result.status).toBe("completed");
  });
});

// ---------------------------------------------------------------------------
// Abort
// ---------------------------------------------------------------------------

describe("abort handling", () => {
  it("stops pipeline when abort signal is fired", async () => {
    const controller = new AbortController();
    const def: PipelineDefinition = {
      id: "test",
      steps: [
        {
          id: "a", label: "A", dependencies: [],
          execute: async () => { await new Promise((r) => setTimeout(r, 200)); return {}; },
        },
        { id: "b", label: "B", dependencies: ["a"], execute: async () => { return {}; } },
      ],
    };
    // Abort before the first slow step completes
    setTimeout(() => controller.abort(), 50);

    const result = await runCoordinatedPipeline(def, emptyCtx(), {
      signal: controller.signal,
    });
    expect(result.status).toBe("aborted");
  });
});
