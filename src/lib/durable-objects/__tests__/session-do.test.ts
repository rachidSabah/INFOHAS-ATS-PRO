// ============================================================================
// Phase 9 — Durable Object Session Recovery Tests
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SessionDO, SessionManager } from '../session-do';
import type { DurableObjectState, DurableObjectId } from '../../cache/cloudflare-types';

// ============================================================================
// Helpers
// ============================================================================

function createMockDOId(): DurableObjectId {
  let name = 'test-session';
  return {
    name,
    equals: (other: DurableObjectId) => false,
    toString: () => `test-do-id-${name}`,
  } as DurableObjectId;
}

function createMockDurableObjectState(): DurableObjectState {
  const storage = new Map<string, any>();
  return {
    id: createMockDOId(),
    storage: {
      get: vi.fn(async (key: string) => storage.get(key)),
      put: vi.fn(async (key: string, value: any) => { storage.set(key, value); }),
      delete: vi.fn(async (key: string) => storage.delete(key)),
      list: vi.fn(async () => new Map(storage)),
    },
    waitUntil: vi.fn(),
    blockConcurrencyWhile: vi.fn(async (cb: () => Promise<void>) => { await cb(); }) as any,
  } as DurableObjectState;
}

function createMockDOStub(): any {
  const doState = createMockDurableObjectState();
  const sessionDO = new SessionDO(doState);

  return {
    fetch: vi.fn(async (request: Request) => {
      return sessionDO.fetch(request);
    }),
  };
}

// ============================================================================
// SessionDO Tests
// ============================================================================

describe('SessionDO', () => {
  let stub: any;
  let manager: SessionManager;

  beforeEach(() => {
    stub = createMockDOStub();
    manager = new SessionManager(stub);
  });

  it('starts an operation', async () => {
    const session = await manager.start('optimize', { resumeId: 'abc' });
    expect(session.operation).toBe('optimize');
    expect(session.status).toBe('running');
  });

  it('returns idle status when no session exists', async () => {
    const status = await manager.getStatus();
    expect((status as any).status).toBe('idle');
    expect((status as any).operation).toBeNull();
  });

  it('updates progress during an operation', async () => {
    await manager.start('export', { resumeId: 'abc' });
    const progress = await manager.updateProgress({
      step: 'rendering',
      progress: 50,
      message: 'Rendering DOCX',
      startedAt: Date.now(),
      updatedAt: Date.now(),
    });
    expect(progress?.step).toBe('rendering');
    expect(progress?.progress).toBe(50);
  });

  it('completes an operation', async () => {
    await manager.start('blueprint', { resumeId: 'abc' });
    const completed = await manager.complete({ fileUrl: 'https://example.com/export.docx' });
    expect(completed.status).toBe('completed');
    expect(completed.result?.fileUrl).toBe('https://example.com/export.docx');
  });

  it('fails an operation with error message', async () => {
    await manager.start('optimize', { resumeId: 'abc' });
    const failed = await manager.fail('Provider timeout');
    expect(failed.status).toBe('failed');
    expect(failed.error).toBe('Provider timeout');
  });

  it('cancels an operation', async () => {
    await manager.start('analysis', { resumeId: 'abc' });
    const cancelled = await manager.cancel();
    expect(cancelled.status).toBe('cancelled');
  });

  it('saves and retrieves a snapshot', async () => {
    await manager.start('optimize', { resumeId: 'abc' });
    const saveResult = await manager.saveSnapshot(JSON.stringify({ name: 'John Doe' }));
    expect(saveResult.saved).toBe(true);

    const snapshot = await manager.getSnapshot();
    expect(snapshot).toBe(JSON.stringify({ name: 'John Doe' }));
  });

  it('generates a recovery token', async () => {
    await manager.start('optimize', { resumeId: 'abc', userId: 'user-1' });
    const token = await manager.getRecoveryToken();
    expect(token.operation).toBe('optimize');
    expect(token.expiresAt).toBeGreaterThan(Date.now());
  });

  it('clears session state', async () => {
    await manager.start('optimize', { resumeId: 'abc' });
    const cleared = await manager.clear();
    expect(cleared.cleared).toBe(true);

    const status = await manager.getStatus();
    expect((status as any).status).toBe('idle');
  });

  it('returns progress after start', async () => {
    await manager.start('export', { resumeId: 'abc' });
    const progress = await manager.getProgress();
    expect(progress?.step).toBe('initializing');
    expect(progress?.progress).toBe(0);
  });
});

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('SessionDO error handling', () => {
  it('rejects unknown actions', async () => {
    const doState = createMockDurableObjectState();
    const sessionDO = new SessionDO(doState);

    const req = new Request('http://do/session', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'invalid-action' }),
    });

    const response = await sessionDO.fetch(req);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Unknown action');
  });

  it('rejects PUT for non-PUT methods', async () => {
    const doState = createMockDurableObjectState();
    const sessionDO = new SessionDO(doState);

    const req = new Request('http://do/session', { method: 'POST' });
    const response = await sessionDO.fetch(req);
    expect(response.status).toBe(405);
  });

  it('rejects start without operation', async () => {
    const doState = createMockDurableObjectState();
    const sessionDO = new SessionDO(doState);

    const req = new Request('http://do/session', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'start' }),
    });

    const response = await sessionDO.fetch(req);
    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error).toBe('Operation type required');
  });
});
