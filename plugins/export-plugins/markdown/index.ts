// ============================================================================
// Markdown Export Plugin
// ============================================================================
// Generates Markdown from ResumeData.
// ============================================================================

import { BaseExportPlugin } from '../../../src/lib/plugin-sdk/base-export-plugin';
import type { PluginManifest, ResumeData, ExportFormat, ExportResult } from '../../../src/lib/plugin-sdk/types';

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

  private formatDate(d: string | undefined): string {
    if (!d) return 'Present';
    const m = d.match(/^(\d{4})/);
    return m ? m[1] : d;
  }

  protected async doExport(data: ResumeData): Promise<ExportResult> {
    try {
      const lines: string[] = [];

      // Header
      lines.push(`# ${data.name || ''}`);
      if (data.headline) lines.push(`*${data.headline}*`);
      const contact = [data.contact.email, data.contact.phone, data.contact.location, data.contact.linkedin, data.contact.github, data.contact.website].filter(Boolean).join('  |  ');
      if (contact) lines.push(`\n${contact}\n`);

      // Summary
      if (data.summary) {
        lines.push('## Professional Summary');
        lines.push(data.summary);
        lines.push('');
      }

      // Experience
      if (data.experience.length) {
        lines.push('## Professional Experience');
        for (const e of data.experience) {
          lines.push(`### ${e.title}${e.company ? ` — ${e.company}` : ''}  _(${this.formatDate(e.startDate)} – ${this.formatDate(e.endDate)})_`);
          for (const b of e.bullets) lines.push(`- ${b}`);
          lines.push('');
        }
      }

      // Education
      if (data.education.length) {
        lines.push('## Education');
        for (const ed of data.education) {
          lines.push(`- ${ed.degree}${ed.field ? ` in ${ed.field}` : ''}${ed.institution ? ` | ${ed.institution}` : ''}  _(${this.formatDate(ed.startDate)} – ${this.formatDate(ed.endDate)})_`);
        }
        lines.push('');
      }

      // Skills
      if (data.skills.length) {
        lines.push('## Skills');
        lines.push(data.skills.map((s) => s.name).join(', '));
        lines.push('');
      }

      // Projects
      if (data.projects.length) {
        lines.push('## Projects');
        for (const p of data.projects) {
          lines.push(`- **${p.name}**`);
          if (p.description) lines.push(`  ${p.description}`);
        }
        lines.push('');
      }

      // Certifications
      if (data.certifications.length) {
        lines.push('## Certifications');
        for (const c of data.certifications) {
          lines.push(`- ${c.name}${c.issuer ? ` — ${c.issuer}` : ''}`);
        }
        lines.push('');
      }

      // Languages
      if (data.languages.length) {
        lines.push('## Languages');
        for (const l of data.languages) lines.push(`- ${l.name}: ${l.proficiency}`);
        lines.push('');
      }

      // Dynamic sections
      if (data.dynamicSections?.length) {
        for (const ds of data.dynamicSections) {
          lines.push(`## ${ds.title}`);
          if (ds.content) lines.push(ds.content);
          for (const b of ds.bullets) lines.push(`- ${b}`);
          lines.push('');
        }
      }

      // Additional info
      if (data.additionalInfo) {
        lines.push('## Additional Information');
        lines.push(data.additionalInfo);
      }

      const markdown = lines.join('\n');

      return {
        ok: true,
        format: 'markdown',
        data: markdown,
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
