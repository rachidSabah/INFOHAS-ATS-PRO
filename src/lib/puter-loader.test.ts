// Puter.js SDK loader — singleton, readiness-predicate, timeout behavior.
//
// Contract under test:
//  1. Already-ready SDK → resolves immediately WITHOUT injecting a script.
//  2. Not loaded → injects exactly ONE script tag even when several callers
//     race (singleton promise), and resolves all of them once ready.
//  3. "auth" surface waits for puter.auth.signIn; "ai" waits for puter.ai.chat.
//  4. Script load failure (onerror) → rejects with a clear error.
//  5. SDK that never initializes → rejects after the timeout window.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

type LoaderModule = typeof import("./puter-loader");

interface FakeScript {
  src: string;
  onload: (() => void) | null;
  onerror: (() => void) | null;
}

function makeBrowserEnv() {
  const scripts: FakeScript[] = [];
  const head: FakeScript[] = [];
  (globalThis as any).document = {
    createElement: (_tag: string) => {
      const s: FakeScript = { src: "", onload: null, onerror: null };
      scripts.push(s);
      return s;
    },
    head: {
      appendChild: (s: FakeScript) => { head.push(s); },
    },
  };
  (globalThis as any).window = { puter: undefined };
  return {
    scripts,
    head,
    setPuter: (puter: any) => { (globalThis as any).window.puter = puter; },
  };
}

async function freshLoader(): Promise<LoaderModule> {
  vi.resetModules();
  return await import("./puter-loader");
}

describe("ensurePuterLoaded", () => {
  let env: ReturnType<typeof makeBrowserEnv>;

  beforeEach(() => {
    env = makeBrowserEnv();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete (globalThis as any).document;
    delete (globalThis as any).window;
  });

  it("resolves immediately without injecting a script when the SDK is already ready", async () => {
    env.setPuter({ ai: { chat: () => {} }, auth: { signIn: () => {} } });
    const { ensurePuterLoaded } = await freshLoader();
    await expect(ensurePuterLoaded("ai")).resolves.toBeTruthy();
    await expect(ensurePuterLoaded("auth")).resolves.toBeTruthy();
    expect(env.scripts.length).toBe(0);
  });

  it("injects exactly one script for concurrent callers and resolves all of them", async () => {
    const { ensurePuterLoaded } = await freshLoader();
    const p1 = ensurePuterLoaded("auth");
    const p2 = ensurePuterLoaded("auth");
    const p3 = ensurePuterLoaded("ai");
    expect(env.scripts.length).toBe(1);

    env.setPuter({ ai: { chat: () => {} }, auth: { signIn: () => {} } });
    env.scripts[0].onload!();

    await expect(p1).resolves.toBeTruthy();
    await expect(p2).resolves.toBeTruthy();
    await expect(p3).resolves.toBeTruthy();
    expect(env.scripts.length).toBe(1);
  });

  it("rejects when the SDK script fails to load (onerror)", async () => {
    const { ensurePuterLoaded } = await freshLoader();
    const p = ensurePuterLoaded("auth");
    env.scripts[0].onerror!();
    await expect(p).rejects.toThrow(/Failed to load Puter.js SDK script/);
    // A later retry may start a fresh load (singleton cleared on failure).
    const p2 = ensurePuterLoaded("auth");
    expect(env.scripts.length).toBe(2);
    env.setPuter({ auth: { signIn: () => {} } });
    env.scripts[1].onload!();
    await expect(p2).resolves.toBeTruthy();
  });

  it("rejects after the init timeout when the SDK never becomes ready", async () => {
    vi.useFakeTimers();
    const { ensurePuterLoaded } = await freshLoader();
    const p = ensurePuterLoaded("ai");
    env.scripts[0].onload!(); // script "loaded" but window.puter never appears
    const expectation = expect(p).rejects.toThrow(/failed to initialize/);
    await vi.advanceTimersByTimeAsync(16_500);
    await expectation;
  });

  it("resolves as soon as the readiness predicate is satisfied during polling", async () => {
    vi.useFakeTimers();
    const { ensurePuterLoaded } = await freshLoader();
    const p = ensurePuterLoaded("auth");
    env.scripts[0].onload!();
    // Simulate the SDK finishing init one poll interval later.
    env.setPuter({ auth: { signIn: () => {} } });
    await vi.advanceTimersByTimeAsync(120);
    await expect(p).resolves.toBeTruthy();
  });
});
