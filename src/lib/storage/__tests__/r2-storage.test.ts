// ============================================================================
// Phase 9 — R2 Storage Tests
// ============================================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { R2StorageBackend } from '../index';
import type { ExportArtifactMetadata } from '../index';

// ── Mock R2 Bucket ─────────────────────────────────────────────────────

interface MockR2Object {
  key: string;
  size: number;
  uploaded: Date;
  customMetadata?: Record<string, string>;
  httpMetadata?: Record<string, string>;
  body?: ArrayBuffer;
}

function createMockR2Bucket(): any {
  const objects = new Map<string, MockR2Object>();

  return {
    put: vi.fn(async (key: string, data: any, options?: any) => {
      const obj: MockR2Object = {
        key,
        size: data instanceof ArrayBuffer ? data.byteLength : String(data).length,
        uploaded: new Date(),
        customMetadata: options?.customMetadata,
      };
      objects.set(key, obj);
      return obj;
    }),
    get: vi.fn(async (key: string) => {
      const obj = objects.get(key);
      if (!obj) return null;
      return {
        ...obj,
        body: obj.body ?? new ArrayBuffer(0),
        bodyUsed: false,
        arrayBuffer: async () => obj.body ?? new ArrayBuffer(0),
        text: async () => '',
        json: async () => ({}),
      };
    }),
    delete: vi.fn(async (keys: string[]) => {
      for (const key of keys) objects.delete(key);
    }),
    head: vi.fn(),
    list: vi.fn(async (opts?: { prefix?: string; cursor?: string; limit?: number }) => {
      const prefix = opts?.prefix ?? '';
      const matching = Array.from(objects.values())
        .filter((o) => o.key.startsWith(prefix))
        .map((o) => ({
          key: o.key,
          size: o.size,
          uploaded: o.uploaded,
          customMetadata: o.customMetadata,
        }));
      return { objects: matching, delimitedPrefixes: [], truncated: false };
    }),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('R2StorageBackend', () => {
  let bucket: any;
  let storage: R2StorageBackend;

  beforeEach(() => {
    bucket = createMockR2Bucket();
    storage = new R2StorageBackend(bucket);
  });

  it('stores an export artifact', async () => {
    const data = new ArrayBuffer(100);
    const result = await storage.store(
      'resume-1', 'docx', data,
      {
        resumeId: 'resume-1', format: 'docx',
        sectionCount: 10, sourceVersion: 'v1',
        completenessHash: 'abc123',
        generatedAt: new Date().toISOString(),
        renderDurationMs: 150,
      },
    );
    expect(result.key).toContain('exports/resume-1/docx/');
    expect(result.size).toBe(100);
    expect(result.format).toBe('docx');
    expect(bucket.put).toHaveBeenCalledTimes(1);
  });

  it('retrieves the latest artifact', async () => {
    const data = new ArrayBuffer(200);
    await storage.store('resume-2', 'pdf', data, {
      resumeId: 'resume-2', format: 'pdf',
      sectionCount: 8, sourceVersion: 'v2',
      completenessHash: 'def456',
      generatedAt: new Date().toISOString(),
      renderDurationMs: 200,
    });

    const latest = await storage.getLatest('resume-2', 'pdf');
    expect(latest).not.toBeNull();
    expect(latest!.metadata.format).toBe('pdf');
    expect(latest!.metadata.sectionCount).toBe(8);
  });

  it('returns null when no artifact exists', async () => {
    const latest = await storage.getLatest('non-existent', 'docx');
    expect(latest).toBeNull();
  });

  it('lists artifacts for a resume', async () => {
    await storage.store('resume-3', 'docx', new ArrayBuffer(100), {
      resumeId: 'resume-3', format: 'docx',
      sectionCount: 5, sourceVersion: 'v1',
      completenessHash: 'ghi789',
      generatedAt: new Date().toISOString(),
      renderDurationMs: 100,
    });
    await storage.store('resume-3', 'html', new ArrayBuffer(200), {
      resumeId: 'resume-3', format: 'html',
      sectionCount: 5, sourceVersion: 'v1',
      completenessHash: 'ghi789',
      generatedAt: new Date().toISOString(),
      renderDurationMs: 120,
    });

    const list = await storage.listForResume('resume-3');
    expect(list.artifacts).toHaveLength(2);
    expect(list.artifacts.map((a) => a.format).sort()).toEqual(['docx', 'html']);
  });

  it('deletes all artifacts for a resume', async () => {
    await storage.store('resume-4', 'txt', 'hello', {
      resumeId: 'resume-4', format: 'txt',
      sectionCount: 3, sourceVersion: 'v1',
      completenessHash: 'jkl012',
      generatedAt: new Date().toISOString(),
      renderDurationMs: 50,
    });
    const deleted = await storage.deleteForResume('resume-4');
    expect(deleted).toBe(1);
    const list = await storage.listForResume('resume-4');
    expect(list.artifacts).toHaveLength(0);
  });
});
