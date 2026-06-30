// ============================================================================
// Markdown Export Plugin
// ============================================================================
// Wraps exportResumeMarkdown from src/lib/exporter.ts.
// ============================================================================

import { BaseExportPlugin } from '../../../src/lib/plugin-sdk/base-export-plugin';
import type { PluginManifest, ResumeData, ExportFormat, ExportResult } from '../../../src/lib/plugin-sdk/types';

import { exportResumeMarkdown as mdExport } from '../../../src/lib/exporter';

export const create = (): MarkdownExportPlugin => new MarkdownExportPlugin();

export class MarkdownExportPlugin extends BaseExportPlugin {
  readonly id = 'export.markdown';
  readonly format: ExportFormat = 'markdown';

  readonly manifest: PluginManifest = {
    id: 'export.markdown',
    name: 'Markdown Export',
    version: '1.0.0',
    author: 'ResumeAI Pro',
    description: 'Export resumes to Markdown format',
    capabilities: ['export:markdown'],
    dependencies: [],
    entry: './index.ts',
    configuration: {
      type: 'object',
      properties: {},
    },
    permissions: [],
  };

  protected async doExport(data: ResumeData): Promise<ExportResult> {
    try {
      const result = await mdExport(data, this.sourceResume);
      return {
        ok: true,
        format: 'markdown',
        data: result as string,
      };
    } catch (err) {
      return {
        ok: false,
        format: 'markdown',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
