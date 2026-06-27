// ============================================================================
// Resume Snapshot Engine — instant rollback, diff comparison, undo optimization
//
// Captures the full resume state before optimization so you can always:
//   1. Rollback to pre-optimization state
//   2. Compare before/after for regressions
//   3. Detect hallucinations (invented companies, changed institutions)
//
// Used by: locked-pipeline.ts, parallel-pipeline.ts
// ============================================================================

import type { ResumeData } from "./types";
import { extractBlueprint, type ResumeBlueprint } from "./resume-blueprint-agent";
import { extractTemplateBlueprint, type ResumeTemplateBlueprint } from "./resume-template-blueprint-agent";
import { computeExperienceFingerprint } from "./experience-fingerprint";

let _snapCounter = 0;
function nextSnapId(): string {
  _snapCounter++;
  return `snap_${Date.now()}_${_snapCounter}`;
}

// ============================================================================
// Types
// ============================================================================

export interface ExperienceFingerprintEntry {
  expId: string;
  fingerprint: string;
  company: string;
  title: string;
}

export interface ResumeSnapshot {
  resumeId: string;
  snapshotId: string;
  timestamp: string;
  /** Full resume data for instant rollback */
  fullResume: ResumeData;
  /** Immutable entity blueprint */
  blueprint: ResumeBlueprint;
  /** Template/layout blueprint */
  templateBlueprint: ResumeTemplateBlueprint;
  /** Experience fingerprints for cross-optimization matching */
  experienceFingerprints: ExperienceFingerprintEntry[];
  /** Label for UI display (e.g., "pre-optimization") */
  label?: string;
}

export interface SnapshotDiff {
  changes: { field: string; before: unknown; after: unknown }[];
  hallucinations: string[];
  summary: string;
}

// ============================================================================
// Core Functions
// ============================================================================

/**
 * Create a snapshot of a resume before optimization.
 * Captures: full resume, blueprint, template, and fingerprints.
 */
export function createSnapshot(resume: ResumeData, label?: string): ResumeSnapshot {
  const blueprint = extractBlueprint(resume);
  const templateBlueprint = extractTemplateBlueprint(resume);
  const experienceFingerprints: ExperienceFingerprintEntry[] = resume.experience.map((exp) => ({
    expId: exp.id,
    fingerprint: computeExperienceFingerprint(exp),
    company: exp.company,
    title: exp.title,
  }));

  return {
    resumeId: resume.id,
    snapshotId: nextSnapId(),
    timestamp: new Date().toISOString(),
    fullResume: JSON.parse(JSON.stringify(resume)), // deep clone
    blueprint,
    templateBlueprint,
    experienceFingerprints,
    label,
  };
}

/**
 * Restore a resume from a snapshot. Returns null if snapshot is invalid.
 */
export function restoreResumeFromSnapshot(
  snapshot: ResumeSnapshot | null | undefined
): ResumeData | null {
  if (!snapshot || !snapshot.fullResume || !snapshot.fullResume.id) {
    return null;
  }
  // Return a deep clone so mutations don't affect the stored snapshot
  return JSON.parse(JSON.stringify(snapshot.fullResume));
}

/**
 * Compare two snapshots and produce a human-readable diff.
 */
export function compareSnapshots(before: ResumeSnapshot, after: ResumeSnapshot): SnapshotDiff {
  const changes: { field: string; before: unknown; after: unknown }[] = [];
  const hallucinations: string[] = [];

  const bResume = before.fullResume;
  const aResume = after.fullResume;

  // Check summary
  if (bResume.summary !== aResume.summary) {
    changes.push({ field: "summary", before: bResume.summary, after: aResume.summary });
  }

  // Check headline
  if (bResume.headline !== aResume.headline) {
    changes.push({ field: "headline", before: bResume.headline, after: aResume.headline });
  }

  // Check experience count
  if (bResume.experience.length !== aResume.experience.length) {
    changes.push({
      field: "experience",
      before: `${bResume.experience.length} entries`,
      after: `${aResume.experience.length} entries`,
    });
  }

  // Detect hallucinated companies (in after but not in before)
  const beforeCompanies = new Set(bResume.experience.map((e) => e.company.toLowerCase()));
  const beforeFingerprints = new Set(
    before.experienceFingerprints.map((f) => f.fingerprint)
  );
  for (const exp of aResume.experience) {
    if (!beforeCompanies.has(exp.company.toLowerCase())) {
      const fp = computeExperienceFingerprint(exp);
      if (!beforeFingerprints.has(fp)) {
        hallucinations.push(`Hallucinated employer: "${exp.company}" — "${exp.title}"`);
      }
    }
  }

  // Check education
  if (bResume.education.length !== aResume.education.length) {
    changes.push({
      field: "education",
      before: `${bResume.education.length} entries`,
      after: `${aResume.education.length} entries`,
    });
  }

  // Check languages
  if (bResume.languages.length !== aResume.languages.length) {
    changes.push({
      field: "languages",
      before: `${bResume.languages.length} entries`,
      after: `${aResume.languages.length} entries`,
    });
  }

  // Check changed institutions
  const beforeInstitutions = new Set(bResume.education.map((e) => e.institution.toLowerCase()));
  for (const ed of aResume.education) {
    if (ed.institution && !beforeInstitutions.has(ed.institution.toLowerCase())) {
      hallucinations.push(`Changed institution: "${ed.institution}" (not in original)`);
    }
  }

  const summary = changes.length === 0 && hallucinations.length === 0
    ? "No changes detected — optimized resume matches original structure."
    : `${changes.length} structural change(s), ${hallucinations.length} hallucination(s) detected.`;

  return { changes, hallucinations, summary };
}
