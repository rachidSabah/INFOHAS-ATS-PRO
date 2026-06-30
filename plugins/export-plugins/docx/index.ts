// ============================================================================
// DOCX Export Plugin
// ============================================================================
// Wraps the existing exportResumeDOCX from src/lib/exporter.ts.
// Extends BaseExportPlugin to enforce Phase 7 completeness gate.
// ============================================================================

import { BaseExportPlugin } from '../../../src/lib/plugin-sdk/base-export-plugin';
import type { PluginManifest, ResumeData, ExportFormat, ExportResult } from '../../../src/lib/plugin-sdk/types';

// Import existing implementation (wrap, don't rewrite — Phase 7 constraint)
import { exportResumeDOCX as docxExport } from '../../../src/lib/exporter';

export const create = (): DocxExportPlugin => new DocxExportPlugin();

export class DocxExportPlugin extends BaseExportPlugin {
  readonly id = 'export.docx';
  readonly format: ExportFormat = 'docx';

  readonly manifest: PluginManifest = {
    id: 'export.docx',
    name: 'DOCX Export',
    version: '1.0.0',
    author: 'ResumeAI Pro',
    description: 'Export resumes to Microsoft Word (.docx) format',
    capabilities: ['export:docx'],
    dependencies: [],
    entry: './index.ts',
    configuration: {
      type: 'object',
      properties: {
        includeHeader: { type: 'boolean', description: 'Include header with contact info', default: true },
        fontSize: { type: 'number', description: 'Base font size in points', default: 11 },
      },
    },
    permissions: [],
  };

  protected async doExport(data: ResumeData): Promise<ExportResult> {
    try {
      const result = await docxExport(data, 'professional', this.sourceResume);
      return {
        ok: true,
        format: 'docx',
        data: result as unknown as Uint8Array,
      };
    } catch (err) {
      return {
        ok: false,
        format: 'docx',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
