// ============================================================================
// HTML Export Plugin
// ============================================================================
// Wraps the existing exportResumeHTML from src/lib/exporter.ts.
// Extends BaseExportPlugin to enforce Phase 7 completeness gate.
// ============================================================================

import { BaseExportPlugin } from '../../../src/lib/plugin-sdk/base-export-plugin';
import type { PluginManifest, ResumeData, ExportFormat, ExportResult } from '../../../src/lib/plugin-sdk/types';

import { exportResumeHTML as htmlExport } from '../../../src/lib/exporter';

export const create = (): HtmlExportPlugin => new HtmlExportPlugin();

export class HtmlExportPlugin extends BaseExportPlugin {
  readonly id = 'export.html';
  readonly format: ExportFormat = 'html';

  readonly manifest: PluginManifest = {
    id: 'export.html',
    name: 'HTML Export',
    version: '1.0.0',
    author: 'ResumeAI Pro',
    description: 'Export resumes to HTML format',
    capabilities: ['export:html'],
    dependencies: [],
    entry: './index.ts',
    configuration: {
      type: 'object',
      properties: {
        inlineStyles: { type: 'boolean', description: 'Inline CSS styles', default: true },
      },
    },
    permissions: [],
  };

  protected async doExport(data: ResumeData): Promise<ExportResult> {
    try {
      const result = await htmlExport(data, this.sourceResume);
      return {
        ok: true,
        format: 'html',
        data: result as string,
      };
    } catch (err) {
      return {
        ok: false,
        format: 'html',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
