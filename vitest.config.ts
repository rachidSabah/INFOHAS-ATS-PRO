import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    // Force per-test-file module isolation. Several test files assign
    // (globalThis as any).window = { ... } to fake sessionStorage/localStorage
    // for the cooldown code paths. Without isolate:true, these globals leak
    // into sibling test files and break modules that read window.location
    // at import time (e.g. supervisor.ts TASK_API_BASE_URL). CI runs
    // `vitest run` with default options, so we MUST set this here — relying
    // on the default bit us before (vitest 4.x's default is not always true
    // across every pool/runner combination).
    isolate: true,
    // Parallel file execution is on, but isolate:true above guarantees each
    // test file still gets its own module registry — so the globalThis.window
    // assignments in cooldown tests cannot leak into sibling files.
    fileParallelism: true,
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json"],
      reportsDirectory: "./coverage",
      include: ["src/lib/**/*.ts"],
      exclude: ["src/lib/mock-data.ts", "src/lib/store.ts"],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
