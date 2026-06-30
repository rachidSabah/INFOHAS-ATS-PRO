// ============================================================================
// TXT Export Plugin
// ============================================================================
// Wraps exportResumeTXT from src/lib/exporter.ts.
// ============================================================================

import { BaseExportPlugin } from '../../../src/lib/plugin-sdk/base-export-plugin';
import type { PluginManifest, ResumeData, ExportFormat, ExportResult } from '../../../src/lib/plugin-sdk/types';

import { exportResumeTXT as textExport } from '../../../src/lib/exporter';

export const create = (): TxtExportPlugin => new TxtExportPlugin();

export class TxtExportPlugin extends BaseExportPlugin {
  readonly id = 'export.txt';
  readonly format: ExportFormat = 'txt';

  readonly manifest: PluginManifest = {
    id: 'export.txt',
    name: 'Plain Text Export',
    version: '1.0.0',
    author: 'ResumeAI Pro',
    description: 'Export resumes to plain text format',
    capabilities: ['export:txt'],
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
      const result = await textExport(data, this.sourceResume);
      return {
        ok: true,
        format: 'txt',
        data: result as string,
      };
    } catch (err) {
      return {
        ok: false,
        format: 'txt',
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
