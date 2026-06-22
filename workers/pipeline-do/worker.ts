// ============================================================================
// Pipeline Worker — exposes the PipelineDurableObject via HTTP and WebSocket.
//
// Routes:
//   GET  /api/pipeline/:pipelineId/snapshot  → fetch current state as JSON
//   POST /api/pipeline/:pipelineId/init      → initialize the pipeline state
//   POST /api/pipeline/:pipelineId/update    → report an agent status change
//   POST /api/pipeline/:pipelineId/complete  → mark the pipeline as complete
//   GET  /api/pipeline/:pipelineId/ws        → WebSocket upgrade (subscribe)
//
// The DO instance is named by pipelineId — each pipeline run gets its own
// isolated state.
// ============================================================================

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { PipelineDurableObject } from "./index";

export interface PipelineWorkerEnv {
  PIPELINE_DO: DurableObjectNamespace;
  APP_NAME: string;
  CORS_ORIGIN: string;
}

const app = new Hono<{ Bindings: PipelineWorkerEnv }>();

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: (origin, c) => {
      const allowed = c.env.CORS_ORIGIN || "*";
      return origin === allowed ? origin : allowed === "*" ? origin : null;
    },
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization", "X-User-Id"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  }),
);

app.get("/api/health", (c) =>
  c.json({ ok: true, service: "pipeline-worker", time: new Date().toISOString() }),
);

/**
 * Get the DO instance for a given pipelineId.
 * The DO is created on-demand by Cloudflare if it doesn't exist yet.
 */
function getDO(env: PipelineWorkerEnv, pipelineId: string): DurableObjectStub {
  const id = env.PIPELINE_DO.idFromName(pipelineId);
  return env.PIPELINE_DO.get(id);
}

// === GET /api/pipeline/:pipelineId/snapshot ===
app.get("/api/pipeline/:pipelineId/snapshot", async (c) => {
  const pipelineId = c.req.param("pipelineId");
  const doStub = getDO(c.env, pipelineId);
  const response = await doStub.fetch(
    new Request(`https://pipeline-do/snapshot`),
  );
  return response;
});

// === POST /api/pipeline/:pipelineId/init ===
app.post("/api/pipeline/:pipelineId/init", async (c) => {
  const pipelineId = c.req.param("pipelineId");
  const body = await c.req.json().catch(() => ({}));
  const doStub = getDO(c.env, pipelineId);
  const response = await doStub.fetch(
    new Request(`https://pipeline-do/init`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, pipelineId }),
    }),
  );
  return response;
});

// === POST /api/pipeline/:pipelineId/update ===
app.post("/api/pipeline/:pipelineId/update", async (c) => {
  const pipelineId = c.req.param("pipelineId");
  const body = await c.req.json().catch(() => ({}));
  const doStub = getDO(c.env, pipelineId);
  const response = await doStub.fetch(
    new Request(`https://pipeline-do/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return response;
});

// === POST /api/pipeline/:pipelineId/complete ===
app.post("/api/pipeline/:pipelineId/complete", async (c) => {
  const pipelineId = c.req.param("pipelineId");
  const body = await c.req.json().catch(() => ({}));
  const doStub = getDO(c.env, pipelineId);
  const response = await doStub.fetch(
    new Request(`https://pipeline-do/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  return response;
});

// === GET /api/pipeline/:pipelineId/ws — WebSocket upgrade ===
app.get("/api/pipeline/:pipelineId/ws", async (c) => {
  const upgradeHeader = c.req.header("Upgrade");
  if (!upgradeHeader || upgradeHeader.toLowerCase() !== "websocket") {
    return c.json({ error: "WebSocket upgrade required" }, 426);
  }
  const pipelineId = c.req.param("pipelineId");
  const doStub = getDO(c.env, pipelineId);
  // Forward the request to the DO — the DO handles the WebSocket upgrade.
  const response = await doStub.fetch(
    new Request(`https://pipeline-do/ws`, {
      headers: { Upgrade: "websocket" },
    }),
  );
  return response;
});

app.notFound((c) => c.json({ error: "Not found", path: c.req.path }, 404));
app.onError((err, c) => {
  console.error(`[Pipeline Worker ERROR] ${c.req.method} ${c.req.path}:`, err);
  return c.json({ error: "Internal server error", message: (err as Error).message }, 500);
});

export { PipelineDurableObject };
export default app;
