import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "**/*.spec.ts",
  use: {
    baseURL: "http://localhost:3000",
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
  },
});
