import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./workers/api/schema.ts",
  out: "./migrations",
  dialect: "sqlite",
});
