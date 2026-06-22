// ============================================================================
// PipelineDurableObject — a Cloudflare Durable Object that holds the state
// of a single optimization pipeline run and broadcasts updates to subscribed
// WebSocket clients in real time.
//
// Architecture (P3 — Real-time Pipeline Updates):
//   - Each pipeline run gets its own DO instance, named by the pipelineId.
//   - The browser orchestrator (supervisor.ts) reports state changes to the
//     DO via a REST endpoint (POST /update).
//   - The DO is the single source of truth for the dashboard UI.
//   - Clients subscribe via WebSocket and receive push events (agent_status,
//     progress, pipeline_complete, etc.).
//   - On connect, the DO sends a full snapshot so the client can hydrate.
//   - Heartbeats are sent every 30s to keep the connection alive.
//
// Cost model:
//   - Durable Objects require the Workers Paid plan ($5/month).
//   - Each DO instance bills for duration while it has active connections
//     OR while it's processing a request. Idle DOs are evicted (hibernation).
//   - WebSocket Hibernation API reduces cost by allowing the DO to sleep
//     while clients are connected but no messages are flowing.
//
// CRITICAL: This file runs in the Cloudflare Worker runtime, NOT in the
// browser. It must NOT import any browser-only modules.
// ============================================================================

import { DurableObject } from "cloudflare:workers";
import type {
  PipelineWebSocketEvent,
  PipelineSnapshot,
  ClientToServerMessage,
  AgentStatusEvent,
  ProgressEvent,
} from "../../src/lib/agents/pipeline-events";

export interface PipelineDOEnv {
  // No bindings needed for now — the DO is self-contained.
  // Future: add KV binding for cross-pipeline persistence.
}

interface AgentState {
  id: string;
  name: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped" | "cached";
  log?: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
}

interface PipelineDOState {
  pipelineId: string;
  optimizationId: string | null;
  resumeId: string | null;
  jobId: string | null;
  companyName: string | null;
  jobTitle: string | null;
  isRunning: boolean;
  startedAt: string;
  completedAt?: string;
  agents: Map<string, AgentState>;
  progress: {
    stepIndex: number;
    totalSteps: number;
    percent: number;
    etaSeconds: number;
    stepName: string;
  } | null;
  lastSeq: number;
}

const HEARTBEAT_INTERVAL_MS = 30_000;
const MAX_AGENT_LOG_LENGTH = 500; // truncate long logs to prevent memory bloat

export class PipelineDurableObject extends DurableObject<PipelineDOEnv> {
  // In-memory state. Persisted to storage on every change so the DO can
  // recover after eviction/hibernation.
  private state: PipelineDOState = {
    pipelineId: "unknown",
    optimizationId: null,
    resumeId: null,
    jobId: null,
    companyName: null,
    jobTitle: null,
    isRunning: false,
    startedAt: new Date().toISOString(),
    agents: new Map(),
    progress: null,
    lastSeq: 0,
  };

  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  // ========================================================================
  // Lifecycle
  // ========================================================================

  constructor(state: DurableObjectState, env: PipelineDOEnv) {
    super(state, env);
    // Restore state from storage on cold start.
    // We do this lazily in the first request to avoid blocking construction.
  }

  private async restoreState(): Promise<void> {
    if (this.state.pipelineId !== "unknown") return; // already restored
    try {
      const stored = await this.ctx.storage.get<PipelineDOState>("state");
      if (stored) {
        // Map is not JSON-serializable, so we store agents as an array.
        this.state = {
          ...stored,
          agents: new Map(stored.agents.map((a) => [a.id, a])),
        };
      }
    } catch (e) {
      console.error("[PipelineDO] Failed to restore state:", e);
    }
  }

  private async persistState(): Promise<void> {
    try {
      // Convert Map to array for JSON serialization.
      const toStore = {
        ...this.state,
        agents: Array.from(this.state.agents.values()),
      };
      await this.ctx.storage.put("state", toStore);
    } catch (e) {
      console.error("[PipelineDO] Failed to persist state:", e);
    }
  }

  // ========================================================================
  // HTTP handler — REST endpoints for the orchestrator to report state
  // ========================================================================

  async fetch(request: Request): Promise<Response> {
    await this.restoreState();
    const url = new URL(request.url);

    // === WebSocket upgrade ===
    if (request.headers.get("Upgrade") === "websocket") {
      return this.handleWebSocketUpgrade(request);
    }

    // === REST endpoints ===
    if (url.pathname === "/update" && request.method === "POST") {
      return this.handleUpdate(request);
    }
    if (url.pathname === "/snapshot" && request.method === "GET") {
      return this.handleGetSnapshot();
    }
    if (url.pathname === "/init" && request.method === "POST") {
      return this.handleInit(request);
    }
    if (url.pathname === "/complete" && request.method === "POST") {
      return this.handleComplete(request);
    }

    return new Response("Not found", { status: 404 });
  }

  // ========================================================================
  // REST: POST /init — initialize the pipeline state
  // ========================================================================

  private async handleInit(request: Request): Promise<Response> {
    try {
      const body = await request.json() as {
        pipelineId: string;
        optimizationId?: string;
        resumeId?: string;
        jobId?: string;
        companyName?: string;
        jobTitle?: string;
        agents: Array<{ id: string; name: string }>;
      };

      this.state.pipelineId = body.pipelineId;
      this.state.optimizationId = body.optimizationId ?? null;
      this.state.resumeId = body.resumeId ?? null;
      this.state.jobId = body.jobId ?? null;
      this.state.companyName = body.companyName ?? null;
      this.state.jobTitle = body.jobTitle ?? null;
      this.state.isRunning = true;
      this.state.startedAt = new Date().toISOString();
      this.state.completedAt = undefined;

      // Initialize all agents as pending
      this.state.agents.clear();
      for (const agent of body.agents) {
        this.state.agents.set(agent.id, {
          id: agent.id,
          name: agent.name,
          status: "pending",
        });
      }
      this.state.progress = null;
      this.state.lastSeq = 0;

      await this.persistState();
      return Response.json({ ok: true });
    } catch (e: any) {
      return Response.json({ ok: false, error: e?.message }, { status: 500 });
    }
  }

  // ========================================================================
  // REST: POST /update — report an agent status change
  // ========================================================================

  private async handleUpdate(request: Request): Promise<Response> {
    try {
      const body = await request.json() as {
        agentId: string;
        status: AgentStatusEvent["status"];
        log?: string;
        error?: string;
        resultSummary?: string;
        metrics?: Record<string, number>;
      };

      const { agentId, status, log, error, resultSummary } = body;
      const agent = this.state.agents.get(agentId);
      if (!agent) {
        return Response.json({ ok: false, error: `Unknown agent: ${agentId}` }, { status: 404 });
      }

      // Update agent state
      const previousStatus = agent.status;
      agent.status = status;
      if (log) {
        agent.log = log.slice(0, MAX_AGENT_LOG_LENGTH);
      }
      if (status === "running" && previousStatus === "pending") {
        agent.startedAt = new Date().toISOString();
      }
      if (["completed", "failed", "skipped", "cached"].includes(status)) {
        agent.completedAt = new Date().toISOString();
      }
      if (error) {
        agent.error = error.slice(0, MAX_AGENT_LOG_LENGTH);
      }

      // Build the event
      const event: AgentStatusEvent = {
        type: "agent_status",
        seq: ++this.state.lastSeq,
        timestamp: new Date().toISOString(),
        agentId,
        status,
        log: agent.log,
        error,
        resultSummary,
        metrics: body.metrics,
      };

      // Broadcast to all connected WebSocket clients
      await this.broadcast(event);
      await this.persistState();

      return Response.json({ ok: true, seq: event.seq });
    } catch (e: any) {
      return Response.json({ ok: false, error: e?.message }, { status: 500 });
    }
  }

  // ========================================================================
  // REST: POST /complete — mark the pipeline as complete
  // ========================================================================

  private async handleComplete(request: Request): Promise<Response> {
    try {
      const body = await request.json() as {
        finalStatus: "completed" | "failed";
        summary: string;
        durationMs?: number;
      };

      this.state.isRunning = false;
      this.state.completedAt = new Date().toISOString();

      const counts = {
        completed: 0,
        failed: 0,
        skipped: 0,
        cached: 0,
      };
      for (const agent of this.state.agents.values()) {
        if (agent.status === "completed") counts.completed++;
        else if (agent.status === "failed") counts.failed++;
        else if (agent.status === "skipped") counts.skipped++;
        else if (agent.status === "cached") counts.cached++;
      }

      const event: PipelineWebSocketEvent = {
        type: "pipeline_complete",
        seq: ++this.state.lastSeq,
        timestamp: new Date().toISOString(),
        finalStatus: body.finalStatus,
        summary: body.summary,
        durationMs: body.durationMs ?? 0,
        counts,
      };

      await this.broadcast(event);
      await this.persistState();
      this.stopHeartbeat();

      return Response.json({ ok: true, seq: event.seq });
    } catch (e: any) {
      return Response.json({ ok: false, error: e?.message }, { status: 500 });
    }
  }

  // ========================================================================
  // REST: GET /snapshot — return the current state as JSON
  // ========================================================================

  private async handleGetSnapshot(): Promise<Response> {
    return Response.json(this.buildSnapshot());
  }

  // ========================================================================
  // WebSocket handler — clients subscribe here
  // ========================================================================

  private async handleWebSocketUpgrade(request: Request): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    // Accept the WebSocket. The second arg enables hibernation.
    this.ctx.acceptWebSocket(server);

    // Send a snapshot immediately so the client can hydrate.
    const snapshot = this.buildSnapshot();
    const snapshotEvent: PipelineWebSocketEvent = {
      type: "snapshot",
      seq: ++this.state.lastSeq,
      timestamp: new Date().toISOString(),
      state: snapshot,
    };
    server.send(JSON.stringify(snapshotEvent));

    // Start heartbeat (only if not already running)
    if (!this.heartbeatTimer) {
      this.startHeartbeat();
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  // ========================================================================
  // WebSocket message handler (called by the runtime on incoming messages)
  // ========================================================================

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      const msg = JSON.parse(message.toString()) as ClientToServerMessage;
      switch (msg.type) {
        case "request_snapshot": {
          const snapshot = this.buildSnapshot();
          const event: PipelineWebSocketEvent = {
            type: "snapshot",
            seq: ++this.state.lastSeq,
            timestamp: new Date().toISOString(),
            state: snapshot,
          };
          ws.send(JSON.stringify(event));
          break;
        }
        case "ping": {
          ws.send(JSON.stringify({ type: "pong", timestamp: new Date().toISOString() }));
          break;
        }
        case "subscribe": {
          // Already subscribed via the WebSocket upgrade. Just acknowledge.
          ws.send(JSON.stringify({ type: "subscribed", pipelineId: msg.pipelineId }));
          break;
        }
      }
    } catch (e) {
      // Ignore malformed messages — don't drop the connection.
      console.warn("[PipelineDO] Malformed WebSocket message:", e);
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    // The runtime handles removing the closed WebSocket from the hibernation set.
    // If no more WebSockets are connected, stop the heartbeat.
    const openConnections = await this.getOpenConnectionCount();
    if (openConnections === 0) {
      this.stopHeartbeat();
    }
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    console.error("[PipelineDO] WebSocket error:", error);
  }

  // ========================================================================
  // Hibernation handlers
  // ========================================================================

  // When using acceptWebSocket, the DO can hibernate while WebSockets are
  // still open. On incoming message, the runtime wakes the DO and calls
  // webSocketMessage. This is automatic — no additional code needed here.

  // ========================================================================
  // Broadcast + helpers
  // ========================================================================

  private async broadcast(event: PipelineWebSocketEvent): Promise<void> {
    const message = JSON.stringify(event);
    // Get all connected WebSockets from the hibernation API.
    const sockets = this.ctx.getWebSockets();
    for (const ws of sockets) {
      try {
        ws.send(message);
      } catch (e) {
        // Individual socket send failure — don't drop the whole broadcast.
        console.warn("[PipelineDO] Failed to send to a WebSocket:", e);
      }
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => {
      const event: PipelineWebSocketEvent = {
        type: "heartbeat",
        seq: ++this.state.lastSeq,
        timestamp: new Date().toISOString(),
      };
      this.broadcast(event).catch(() => {});
    }, HEARTBEAT_INTERVAL_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private async getOpenConnectionCount(): Promise<number> {
    return this.ctx.getWebSockets().length;
  }

  private buildSnapshot(): PipelineSnapshot {
    return {
      pipelineId: this.state.pipelineId,
      optimizationId: this.state.optimizationId,
      resumeId: this.state.resumeId,
      jobId: this.state.jobId,
      companyName: this.state.companyName,
      jobTitle: this.state.jobTitle,
      isRunning: this.state.isRunning,
      startedAt: this.state.startedAt,
      completedAt: this.state.completedAt,
      agents: Array.from(this.state.agents.values()).map((a) => ({
        id: a.id,
        name: a.name,
        status: a.status,
        log: a.log,
        startedAt: a.startedAt,
        completedAt: a.completedAt,
        error: a.error,
      })),
      progress: this.state.progress,
      lastSeq: this.state.lastSeq,
    };
  }
}
