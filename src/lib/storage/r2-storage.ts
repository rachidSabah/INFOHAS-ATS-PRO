// ============================================================================
// R2 Storage — Binary Export Artifact Storage
// ============================================================================
// R2 is the correct place for binary export artifacts (DOCX/PDF bytes).
// NOT D1 (row size limits) and NOT KV (per-value size limits, cost on blobs).
//
// Each export artifact is stored at:
//   exports/{resumeId}/{format}/{timestamp}-{hash}.{ext}
//
// Custom metadata includes:
//   - sourceVersion: data version tag for staleness checking
//   - format: ExportFormat
//   - sectionCount: number of sections in the source data
//   - completenessHash: sha256 of validateExportCompleteness result
// ============================================================================

import type { R2Bucket, R2Object, R2ObjectBody, R2PutOptions } from '../cache/cloudflare-types';

// ============================================================================
// Types
// ============================================================================

export type ExportArtifactFormat = 'docx' | 'pdf' | 'html' | 'txt' | 'markdown' | 'json';

export interface ExportArtifactMetadata {
  resumeId: string;
  format: ExportArtifactFormat;
  sectionCount: number;
  sourceVersion: string;
  completenessHash: string;
  generatedAt: string;
  renderDurationMs: number;
  sizeBytes: number;
}

export interface ExportArtifactResult {
  key: string;
  format: ExportArtifactFormat;
  size: number;
  uploadedAt: Date;
  metadata: ExportArtifactMetadata;
}

export interface ExportArtifactListResult {
  artifacts: ExportArtifactResult[];
  truncated: boolean;
  cursor?: string;
}

// ============================================================================
// R2StorageBackend
// ============================================================================

export class R2StorageBackend {
  private bucket: R2Bucket;
  private basePath: string;

  constructor(bucket: R2Bucket, basePath = 'exports') {
    this.bucket = bucket;
    this.basePath = basePath;
  }

  // ── Upload ──────────────────────────────────────────────────────────

  /**
   * Store an export artifact in R2.
   * Returns the storage key and metadata.
   */
  async store(
    resumeId: string,
    format: ExportArtifactFormat,
    data: ArrayBuffer | ReadableStream | string,
    metadata: Omit<ExportArtifactMetadata, 'sizeBytes'>,
    extension?: string,
  ): Promise<ExportArtifactResult> {
    const ext = extension ?? this.getExtension(format);
    const timestamp = Date.now();
    const key = `${this.basePath}/${resumeId}/${format}/${timestamp}.${ext}`;

    const fullMetadata: ExportArtifactMetadata = {
      ...metadata,
      sizeBytes: 0,
    };

    const putOptions: R2PutOptions = {
      customMetadata: {
        resumeId: metadata.resumeId,
        format: metadata.format,
        sectionCount: String(metadata.sectionCount),
        sourceVersion: metadata.sourceVersion,
        completenessHash: metadata.completenessHash,
        generatedAt: metadata.generatedAt,
        renderDurationMs: String(metadata.renderDurationMs),
      },
    };

    const obj = await this.bucket.put(key, data, putOptions);

    fullMetadata.sizeBytes = obj.size;

    return {
      key,
      format,
      size: obj.size,
      uploadedAt: obj.uploaded,
      metadata: fullMetadata,
    };
  }

  // ── Retrieve ────────────────────────────────────────────────────────

  /**
   * Retrieve the most recent export artifact for a given resume + format.
   * Lists recent exports and returns the latest.
   */
  async getLatest(
    resumeId: string,
    format: ExportArtifactFormat,
  ): Promise<{ body: ArrayBuffer; metadata: ExportArtifactMetadata } | null> {
    const prefix = `${this.basePath}/${resumeId}/${format}/`;
    const objects = await this.bucket.list({ prefix, limit: 10 });

    if (!objects.objects.length) return null;

    // Sort by uploaded date (most recent first)
    const sorted = objects.objects.sort(
      (a, b) => b.uploaded.getTime() - a.uploaded.getTime(),
    );

    const latest = await this.bucket.get(sorted[0].key);
    if (!latest) return null;

    const metadata: ExportArtifactMetadata = {
      resumeId: sorted[0].customMetadata?.resumeId ?? resumeId,
      format: (sorted[0].customMetadata?.format as ExportArtifactFormat) ?? format,
      sectionCount: Number(sorted[0].customMetadata?.sectionCount ?? 0),
      sourceVersion: sorted[0].customMetadata?.sourceVersion ?? '',
      completenessHash: sorted[0].customMetadata?.completenessHash ?? '',
      generatedAt: sorted[0].customMetadata?.generatedAt ?? '',
      renderDurationMs: Number(sorted[0].customMetadata?.renderDurationMs ?? 0),
      sizeBytes: sorted[0].size,
    };

    const body = await latest.arrayBuffer();
    return { body, metadata };
  }

  // ── List ────────────────────────────────────────────────────────────

  /**
   * List all export artifacts for a resume.
   */
  async listForResume(
    resumeId: string,
    cursor?: string,
  ): Promise<ExportArtifactListResult> {
    const prefix = `${this.basePath}/${resumeId}/`;
    const result = await this.bucket.list({ prefix, cursor, limit: 50 });

    const artifacts: ExportArtifactResult[] = result.objects.map((obj) => ({
      key: obj.key,
      format: (obj.customMetadata?.format as ExportArtifactFormat) ?? 'docx',
      size: obj.size,
      uploadedAt: obj.uploaded,
      metadata: {
        resumeId: obj.customMetadata?.resumeId ?? resumeId,
        format: (obj.customMetadata?.format as ExportArtifactFormat) ?? 'docx',
        sectionCount: Number(obj.customMetadata?.sectionCount ?? 0),
        sourceVersion: obj.customMetadata?.sourceVersion ?? '',
        completenessHash: obj.customMetadata?.completenessHash ?? '',
        generatedAt: obj.customMetadata?.generatedAt ?? '',
        renderDurationMs: Number(obj.customMetadata?.renderDurationMs ?? 0),
        sizeBytes: obj.size,
      },
    }));

    return {
      artifacts,
      truncated: result.truncated,
      cursor: result.cursor,
    };
  }

  // ── Delete ──────────────────────────────────────────────────────────

  /**
   * Delete all artifacts for a resume (e.g., when resume is deleted).
   */
  async deleteForResume(resumeId: string): Promise<number> {
    const prefix = `${this.basePath}/${resumeId}/`;
    let deleted = 0;
    let cursor: string | undefined;

    do {
      const result = await this.bucket.list({ prefix, cursor });
      const keys = result.objects.map((o) => o.key);
      if (keys.length > 0) {
        await this.bucket.delete(keys);
        deleted += keys.length;
      }
      cursor = result.truncated ? result.cursor : undefined;
    } while (cursor);

    return deleted;
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  private getExtension(format: ExportArtifactFormat): string {
    const map: Record<ExportArtifactFormat, string> = {
      docx: 'docx',
      pdf: 'pdf',
      html: 'html',
      txt: 'txt',
      markdown: 'md',
      json: 'json',
    };
    return map[format] ?? 'bin';
  }
}
