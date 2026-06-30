// ============================================================================
// Durable Object — Session Recovery DO
// ============================================================================
// Maintains in-memory state for a user's active session, enabling crash
// recovery and reconnection resilience for long-running operations
// (optimization, export, blueprint generation).
//
// Architecture:
//   - One DO instance per resume-session scope (keyed by resumeId + userId)
//   - In-memory Map is fast but ephemeral — DO uses D1 as its durable backing
//   - The DO's fetch() handler routes HTTP-style operations
//   - state.storage.put/get is used for crash-safe persistence
// ============================================================================

import type { DurableObjectState } from '../cache/cloudflare-types';

// ============================================================================
// Types
// ============================================================================

export type SessionOperation = 'optimize' | 'export' | 'blueprint' | 'analysis';

export type SessionStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface SessionProgress {
  step: string;
  progress: number;  // 0–100
  message: string;
  startedAt: number;
  updatedAt: number;
  estimatedRemainingMs?: number;
}

export interface SessionSnapshot {
  operation: SessionOperation;
  status: SessionStatus;
  progress: SessionProgress | null;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ResumeSessionRecord {
  resumeId: string;
  userId: string;
  operation: SessionOperation;
  status: SessionStatus;
  payload?: Record<string, unknown>;
  result?: Record<string, unknown>;
  error?: string;
  progress?: SessionProgress;
  resumeDataSnapshot?: string;  // JSON blob for crash recovery
  createdAt: string;
  updatedAt: string;
}

export interface SessionRecoveryToken {
  resumeId: string;
  userId: string;
  operation: SessionOperation;
  sessionId: string;
  expiresAt: number;
}

// ============================================================================
// SessionDO — The Durable Object
// ============================================================================

export class SessionDO {
  private state: DurableObjectState;
  private session: ResumeSessionRecord | null = null;
  private readonly storageKey = 'session';

  constructor(state: DurableObjectState) {
    this.state = state;
    // Auto-restore session from DO storage on instantiation
    state.storage?.get<ResumeSessionRecord>(this.storageKey).then((s) => {
      if (s) this.session = s;
    }).catch(() => {
      // If storage is unavailable, start fresh
    });
  }

  // ── HTTP (fetch) Handler ────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const method = request.method;

    try {
      switch (method) {
        case 'GET':
          return this.handleGet(url);
        case 'PUT':
          return this.handlePut(request);
        case 'DELETE':
          return this.handleDelete();
        default:
          return new Response('Method not allowed', { status: 405 });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // ── GET ─────────────────────────────────────────────────────────────

  private async handleGet(url: URL): Promise<Response> {
    const action = url.searchParams.get('action') ?? 'status';

    switch (action) {
      case 'status':
        return this.jsonResponse(this.session ?? { status: 'idle', operation: null });

      case 'progress':
        return this.jsonResponse(this.session?.progress ?? null);

      case 'snapshot':
        return this.jsonResponse(this.session?.resumeDataSnapshot ?? null);

      case 'recovery-token':
        return this.jsonResponse(this.generateRecoveryToken());

      default:
        return this.jsonResponse(this.session);
    }
  }

  // ── PUT ─────────────────────────────────────────────────────────────

  private async handlePut(request: Request): Promise<Response> {
    const body = await request.json() as {
      action: 'start' | 'update-progress' | 'complete' | 'fail' | 'save-snapshot' | 'cancel';
      operation?: SessionOperation;
      payload?: Record<string, unknown>;
      result?: Record<string, unknown>;
      error?: string;
      progress?: SessionProgress;
      resumeDataSnapshot?: string;
    };

    switch (body.action) {
      case 'start':
        return this.startOperation(body);

      case 'update-progress':
        return this.updateProgress(body);

      case 'save-snapshot':
        return this.saveSnapshot(body);

      case 'complete':
        return this.completeOperation(body);

      case 'fail':
        return this.failOperation(body);

      case 'cancel':
        return this.cancelOperation();

      default:
        return new Response(JSON.stringify({ error: 'Unknown action' }), { status: 400 });
    }
  }

  // ── DELETE ──────────────────────────────────────────────────────────

  private async handleDelete(): Promise<Response> {
    if (this.session) {
      await this.state.storage?.delete(this.storageKey);
      this.session = null;
    }
    return this.jsonResponse({ cleared: true });
  }

  // ── Operation Lifecycle ─────────────────────────────────────────────

  private async startOperation(body: {
    operation?: SessionOperation;
    payload?: Record<string, unknown>;
    resumeDataSnapshot?: string;
  }): Promise<Response> {
    if (!body.operation) {
      return new Response(JSON.stringify({ error: 'Operation type required' }), { status: 400 });
    }

    const now = new Date().toISOString();
    this.session = {
      resumeId: '',
      userId: '',
      operation: body.operation,
      status: 'running',
      payload: body.payload,
      progress: {
        step: 'initializing',
        progress: 0,
        message: 'Operation started',
        startedAt: Date.now(),
        updatedAt: Date.now(),
      },
      resumeDataSnapshot: body.resumeDataSnapshot,
      createdAt: now,
      updatedAt: now,
    };

    await this.persist();
    return this.jsonResponse(this.session);
  }

  private async updateProgress(body: {
    progress?: SessionProgress;
  }): Promise<Response> {
    if (!this.session) {
      return new Response(JSON.stringify({ error: 'No active session' }), { status: 400 });
    }

    if (body.progress) {
      this.session.progress = {
        ...body.progress,
        updatedAt: Date.now(),
      };
    }
    this.session.updatedAt = new Date().toISOString();

    await this.persist();
    return this.jsonResponse(this.session.progress);
  }

  private async saveSnapshot(body: {
    resumeDataSnapshot?: string;
  }): Promise<Response> {
    if (!this.session) {
      return new Response(JSON.stringify({ error: 'No active session' }), { status: 400 });
    }

    if (body.resumeDataSnapshot) {
      this.session.resumeDataSnapshot = body.resumeDataSnapshot;
    }
    this.session.updatedAt = new Date().toISOString();

    await this.persist();
    return this.jsonResponse({ saved: true });
  }

  private async completeOperation(body: {
    result?: Record<string, unknown>;
  }): Promise<Response> {
    if (!this.session) {
      return new Response(JSON.stringify({ error: 'No active session' }), { status: 400 });
    }

    this.session.status = 'completed';
    this.session.result = body.result;
    this.session.updatedAt = new Date().toISOString();
    if (this.session.progress) {
      this.session.progress.progress = 100;
      this.session.progress.message = 'Completed';
    }

    await this.persist();
    return this.jsonResponse(this.session);
  }

  private async failOperation(body: {
    error?: string;
  }): Promise<Response> {
    if (!this.session) {
      return new Response(JSON.stringify({ error: 'No active session' }), { status: 400 });
    }

    this.session.status = 'failed';
    this.session.error = body.error ?? 'Unknown error';
    this.session.updatedAt = new Date().toISOString();

    await this.persist();
    return this.jsonResponse(this.session);
  }

  private async cancelOperation(): Promise<Response> {
    if (!this.session) {
      return new Response(JSON.stringify({ error: 'No active session' }), { status: 400 });
    }

    this.session.status = 'cancelled';
    this.session.updatedAt = new Date().toISOString();

    await this.persist();
    return this.jsonResponse(this.session);
  }

  // ── Recovery ────────────────────────────────────────────────────────

  private generateRecoveryToken(): SessionRecoveryToken {
    return {
      resumeId: this.session?.resumeId ?? '',
      userId: this.session?.userId ?? '',
      operation: this.session?.operation ?? 'optimize',
      sessionId: this.state.id?.toString() ?? '',
      expiresAt: Date.now() + 30_000,  // 30 seconds
    };
  }

  // ── Private ─────────────────────────────────────────────────────────

  private async persist(): Promise<void> {
    if (this.session) {
      await this.state.storage?.put(this.storageKey, this.session);
    }
  }

  private jsonResponse(data: unknown, status = 200): Response {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

// ============================================================================
// SessionManager — Client-Side Facade
// ============================================================================

export class SessionManager {
  private doStub: any; // DurableObjectStub

  constructor(doStub: any) {
    this.doStub = doStub;
  }

  /**
   * Start a new operation in the session DO.
   */
  async start(
    operation: SessionOperation,
    payload: Record<string, unknown>,
    resumeDataSnapshot?: string,
  ): Promise<ResumeSessionRecord> {
    return this.fetch({
      action: 'start',
      operation,
      payload,
      resumeDataSnapshot,
    });
  }

  /**
   * Update the progress of the current operation.
   */
  async updateProgress(progress: SessionProgress): Promise<SessionProgress | null> {
    return this.fetch({ action: 'update-progress', progress });
  }

  /**
   * Save a resume data snapshot for crash recovery.
   */
  async saveSnapshot(resumeData: string): Promise<{ saved: boolean }> {
    return this.fetch({ action: 'save-snapshot', resumeDataSnapshot: resumeData });
  }

  /**
   * Mark the operation as completed with its result.
   */
  async complete(result: Record<string, unknown>): Promise<ResumeSessionRecord> {
    return this.fetch({ action: 'complete', result });
  }

  /**
   * Mark the operation as failed.
   */
  async fail(error: string): Promise<ResumeSessionRecord> {
    return this.fetch({ action: 'fail', error });
  }

  /**
   * Cancel the operation.
   */
  async cancel(): Promise<ResumeSessionRecord> {
    return this.fetch({ action: 'cancel' });
  }

  /**
   * Get the current session status.
   */
  async getStatus(): Promise<ResumeSessionRecord | { status: string; operation: null }> {
    const response = await this.doStub.fetch(
      new Request('http://do/session?action=status'),
    );
    return response.json();
  }

  /**
   * Get the current progress.
   */
  async getProgress(): Promise<SessionProgress | null> {
    const response = await this.doStub.fetch(
      new Request('http://do/session?action=progress'),
    );
    return response.json();
  }

  /**
   * Get the saved resume data snapshot (for crash recovery).
   */
  async getSnapshot(): Promise<string | null> {
    const response = await this.doStub.fetch(
      new Request('http://do/session?action=snapshot'),
    );
    return response.json();
  }

  /**
   * Generate a recovery token for reconnection.
   */
  async getRecoveryToken(): Promise<SessionRecoveryToken> {
    const response = await this.doStub.fetch(
      new Request('http://do/session?action=recovery-token'),
    );
    return response.json();
  }

  /**
   * Clear the session entirely.
   */
  async clear(): Promise<{ cleared: boolean }> {
    const response = await this.doStub.fetch(
      new Request('http://do/session', { method: 'DELETE' }),
    );
    return response.json();
  }

  // ── Private ─────────────────────────────────────────────────────────

  private async fetch<T>(body: Record<string, unknown>): Promise<T> {
    const response = await this.doStub.fetch(
      new Request('http://do/session', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: response.statusText }));
      throw new Error((err as any).error ?? `Session DO error: ${response.status}`);
    }
    return response.json();
  }
}
