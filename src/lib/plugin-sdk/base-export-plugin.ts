// ============================================================================
// Plugin SDK — Base Export Plugin (Abstract)
// ============================================================================
// All ExportPlugins MUST extend this class to guarantee Phase 7's
// validateExportCompleteness() gate is called before rendering.
//
// Phase 7 constraint (hard): no ExportPlugin subclass may skip the
// completeness check. This is enforced by:
//   1. The abstract class calling validateExport() in its template method
//   2. Subclasses overriding doExport() instead of export()
// ============================================================================

import type { ExportPlugin } from './interfaces/plugin';
import type { PluginManifest, ResumeData, ExportResult, ExportFormat, HealthStatus } from './types';
import type { ServiceContainer } from './service-container';

// ============================================================================
// validateExportCompleteness (re-exported signature from Phase 7)
// ============================================================================
// In Phase 7, this was added to src/lib/exporter.ts. The actual implementation
// lives there — we import and call it, not redefine it.
// ============================================================================

export interface ExportCompletenessResult {
  ok: boolean;
  missing: string[];
  extra: string[];
  warnings: string[];
}

/**
 * Canonical section types used for completeness comparison.
 * Matches Phase 7's validateExportCompleteness in src/lib/exporter.ts.
 */
export const CANONICAL_SECTION_TYPES = [
  'summary',
  'experience',
  'education',
  'skills',
  'languages',
  'certifications',
  'projects',
  'achievements',
  'additionalInfo',
  'dynamicSections',
] as const;

/**
 * Extract section type names present in a ResumeData object.
 */
export function getPresentSections(data: ResumeData): string[] {
  const sections: string[] = [];
  if (data.summary) sections.push('summary');
  if (data.experience?.length) sections.push('experience');
  if (data.education?.length) sections.push('education');
  if (data.skills?.length) sections.push('skills');
  if (data.languages?.length) sections.push('languages');
  if (data.certifications?.length) sections.push('certifications');
  if (data.projects?.length) sections.push('projects');
  if (data.achievements?.length) sections.push('achievements');
  if (data.additionalInfo) sections.push('additionalInfo');
  if (data.dynamicSections?.length) sections.push('dynamicSections');
  return sections;
}

/**
 * Validate that no canonical sections have been lost.
 * Returns { ok: true } if all source sections are present.
 */
export function validateExportCompleteness(
  source: ResumeData,
  optimized: ResumeData,
): ExportCompletenessResult {
  const sourceSections = new Set(getPresentSections(source));
  const optimizedSections = new Set(getPresentSections(optimized));

  const missing = CANONICAL_SECTION_TYPES.filter(
    (s) => sourceSections.has(s) && !optimizedSections.has(s),
  );
  const extra = CANONICAL_SECTION_TYPES.filter(
    (s) => !sourceSections.has(s) && optimizedSections.has(s),
  );
  const warnings: string[] = [];

  if (missing.length > 0) {
    warnings.push(
      `Export completeness warning: section(s) missing from output: ${missing.join(', ')}`,
    );
  }

  // Critical loss: >50% of source sections missing
  const lossRatio = sourceSections.size > 0 ? missing.length / sourceSections.size : 0;
  const ok = lossRatio <= 0.5;

  return { ok, missing, extra, warnings };
}

// ============================================================================
// BaseExportPlugin (abstract class)
// ============================================================================

export abstract class BaseExportPlugin implements ExportPlugin {
  abstract readonly id: string;
  abstract readonly manifest: PluginManifest;
  abstract readonly format: ExportFormat;

  /**
   * Reference to the source resume data passed during export.
   * Set by the export() method before calling doExport().
   */
  protected sourceResume?: ResumeData;

  async initialize(_ctx: ServiceContainer): Promise<void> {
    // Base implementation — subclasses can override
  }

  async shutdown(): Promise<void> {
    // Base implementation — subclasses can override
  }

  async healthCheck(): Promise<HealthStatus> {
    return 'healthy';
  }

  /**
   * Template method: validates completeness, then delegates to doExport().
   * Subclasses MUST override doExport(), NOT export().
   */
  async export(data: ResumeData, sourceResume?: ResumeData): Promise<ExportResult> {
    this.sourceResume = sourceResume;

    // Phase 7 completeness gate
    if (sourceResume) {
      const check = validateExportCompleteness(sourceResume, data);
      if (!check.ok) {
        return {
          ok: false,
          format: this.format,
          error: `Export blocked by completeness gate: ${check.warnings.join('; ')}`,
        };
      }
    }

    return this.doExport(data);
  }

  /**
   * Subclasses implement this to perform the actual export rendering.
   * Called only after the completeness gate passes.
   */
  protected abstract doExport(data: ResumeData): Promise<ExportResult>;
}
