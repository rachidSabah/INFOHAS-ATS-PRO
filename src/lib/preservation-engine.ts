// ============================================================================
// Reservation Preservation Engine
//
// Created immediately after parsing. Creates an immutable PreservationSnapshot
// that serves as the canonical source of truth. The Merge Engine uses this
// to enforce that ONLY optimizable fields can change during optimization.
//
// Pipeline:
//   Parser → createPreservationSnapshot() → Optimizer → Merge Engine → Guardian
//                                                                   ↑
//                                    compareSnapshots() ←───────────┘
// ============================================================================

"use client";

import type {
  ResumeData,
  PreservationSnapshot,
  SectionFingerprint,
} from "./types";

// ====================================================================
// Section Hash Computation (FNV-1a 32-bit, browser-compatible)
// ====================================================================

/**
 * Compute an FNV-1a 32-bit hash from a string.
 * Deterministic, fast, no external dependencies.
 */
export function fnv1a(str: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash +=
      (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// ====================================================================
// Section Fingerprint Computation
// ====================================================================

/**
 * Compute a content hash for an experience section.
 */
function hashExperiences(resume: ResumeData): string {
  const parts: string[] = [];
  for (const exp of resume.experience) {
    parts.push(exp.company || "");
    parts.push(exp.title || "");
    for (const b of exp.bullets || []) parts.push(b);
  }
  return fnv1a(parts.join("|"));
}

/**
 * Compute a content hash for an education section.
 */
function hashEducation(resume: ResumeData): string {
  const parts: string[] = [];
  for (const edu of resume.education) {
    parts.push(edu.institution || "");
    parts.push(edu.degree || "");
    for (const h of edu.highlights || []) parts.push(h);
  }
  return fnv1a(parts.join("|"));
}

/**
 * Compute a content hash for a skills section.
 */
function hashSkills(resume: ResumeData): string {
  const parts: string[] = [];
  for (const sk of resume.skills) {
    parts.push(sk.name);
    parts.push(sk.category || "");
  }
  return fnv1a(parts.join("|"));
}

/**
 * Compute a content hash for a languages section.
 */
function hashLanguages(resume: ResumeData): string {
  const parts: string[] = [];
  for (const lang of resume.languages) {
    parts.push(lang.name);
    parts.push(lang.proficiency || "");
  }
  return fnv1a(parts.join("|"));
}

/**
 * Compute a content hash for a projects section.
 */
function hashProjects(resume: ResumeData): string {
  const parts: string[] = [];
  for (const proj of resume.projects || []) {
    parts.push(proj.name || "");
    for (const b of proj.bullets || []) parts.push(b);
  }
  return fnv1a(parts.join("|"));
}

/**
 * Compute a content hash for a certifications section.
 */
function hashCertifications(resume: ResumeData): string {
  const parts: string[] = [];
  for (const cert of resume.certifications || []) {
    parts.push(cert.name);
    parts.push(cert.issuer || "");
  }
  return fnv1a(parts.join("|"));
}

/**
 * Compute a content hash for dynamic sections.
 */
function hashDynamicSections(resume: ResumeData): string {
  const parts: string[] = [];
  for (const ds of resume.dynamicSections || []) {
    parts.push(ds.title);
    for (const b of ds.bullets || []) parts.push(b);
  }
  return fnv1a(parts.join("|"));
}

// ====================================================================
// Fingerprint Builder
// ====================================================================

/**
 * Build a SectionFingerprint from a section's data.
 */
function buildFingerprint(
  sectionType: string,
  entityCount: number,
  contentCount: number,
  bulletCount: number,
  hash: string,
): SectionFingerprint {
  return { sectionType, entityCount, contentCount, bulletCount, hash };
}

/**
 * Count total characters in a string array.
 */
function sumLengths(items: string[]): number {
  return items.reduce((sum, s) => sum + s.length, 0);
}

// ====================================================================
// createPreservationSnapshot
// ====================================================================

/**
 * Create an immutable PreservationSnapshot from a ResumeData object.
 *
 * Call this IMMEDIATELY after parsing, before any optimization.
 * The snapshot is the CANONICAL source of truth.
 */
export function createPreservationSnapshot(
  resume: ResumeData,
): PreservationSnapshot {
  const sections: SectionFingerprint[] = [];
  const entityIds = {
    experience: resume.experience.map((e) => e.id),
    education: resume.education.map((e) => e.id),
    skills: resume.skills.map((s) => s.id),
    languages: resume.languages.map((l) => l.id),
    projects: (resume.projects || []).map((p) => p.id),
    certifications: (resume.certifications || []).map((c) => c.id),
    dynamicSections: (resume.dynamicSections || []).map((ds) => ds.normalizedTitle || ds.title),
  };

  // Experience fingerprint
  if (resume.experience.length > 0) {
    const bulletCount = resume.experience.reduce(
      (sum, e) => sum + e.bullets.length,
      0,
    );
    const contentCount = resume.experience.reduce(
      (sum, e) => sum + sumLengths(e.bullets),
      0,
    );
    sections.push(
      buildFingerprint(
        "professionalExperience",
        resume.experience.length,
        contentCount,
        bulletCount,
        hashExperiences(resume),
      ),
    );
  }

  // Education fingerprint
  if (resume.education.length > 0) {
    const highlightCount = resume.education.reduce(
      (sum, e) => sum + (e.highlights?.length || 0),
      0,
    );
    const contentCount = resume.education.reduce(
      (sum, e) =>
        sum +
        (e.institution?.length || 0) +
        (e.degree?.length || 0) +
        sumLengths(e.highlights || []),
      0,
    );
    sections.push(
      buildFingerprint(
        "education",
        resume.education.length,
        contentCount,
        highlightCount,
        hashEducation(resume),
      ),
    );
  }

  // Skills fingerprint
  if (resume.skills.length > 0) {
    const contentCount = resume.skills.reduce(
      (sum, s) => sum + s.name.length + (s.category?.length || 0),
      0,
    );
    sections.push(
      buildFingerprint(
        "skills",
        resume.skills.length,
        contentCount,
        0,
        hashSkills(resume),
      ),
    );
  }

  // Languages fingerprint
  if (resume.languages.length > 0) {
    const contentCount = resume.languages.reduce(
      (sum, l) => sum + l.name.length + (l.proficiency?.length || 0),
      0,
    );
    sections.push(
      buildFingerprint(
        "languages",
        resume.languages.length,
        contentCount,
        0,
        hashLanguages(resume),
      ),
    );
  }

  // Projects fingerprint
  if ((resume.projects?.length ?? 0) > 0) {
    const bulletCount = (resume.projects || []).reduce(
      (sum, p) => sum + p.bullets.length,
      0,
    );
    const contentCount = (resume.projects || []).reduce(
      (sum, p) => sum + p.name.length + sumLengths(p.bullets),
      0,
    );
    sections.push(
      buildFingerprint(
        "projects",
        resume.projects!.length,
        contentCount,
        bulletCount,
        hashProjects(resume),
      ),
    );
  }

  // Certifications fingerprint
  if ((resume.certifications?.length ?? 0) > 0) {
    const contentCount = (resume.certifications || []).reduce(
      (sum, c) => sum + c.name.length + (c.issuer?.length || 0),
      0,
    );
    sections.push(
      buildFingerprint(
        "certifications",
        resume.certifications!.length,
        contentCount,
        0,
        hashCertifications(resume),
      ),
    );
  }

  // Dynamic sections fingerprint
  if ((resume.dynamicSections?.length ?? 0) > 0) {
    const bulletCount = (resume.dynamicSections || []).reduce(
      (sum, ds) => sum + ds.bullets.length,
      0,
    );
    const contentCount = (resume.dynamicSections || []).reduce(
      (sum, ds) => sum + ds.title.length + sumLengths(ds.bullets),
      0,
    );
    sections.push(
      buildFingerprint(
        "dynamicSections",
        resume.dynamicSections!.length,
        contentCount,
        bulletCount,
        hashDynamicSections(resume),
      ),
    );
  }

  return {
    createdAt: new Date().toISOString(),
    source: resume.source || "unknown",
    sectionCount: sections.length,
    sections,
    entityIds,
    immutable: {
      name: resume.name || "",
      email: resume.contact?.email,
      phone: resume.contact?.phone,
      employerNames: resume.experience.map((e) => e.company).filter(Boolean),
      institutionNames: resume.education
        .map((e) => e.institution)
        .filter(Boolean),
      degreeNames: resume.education.map((e) => e.degree).filter(Boolean),
      languageNames: resume.languages.map((l) => l.name),
      experienceDates: resume.experience.map((e) => ({
        id: e.id,
        startDate: e.startDate,
        endDate: e.endDate,
      })),
      educationDates: resume.education.map((e) => ({
        id: e.id,
        startDate: e.startDate,
        endDate: e.endDate,
      })),
      certificationNames: (resume.certifications || []).map((c) => c.name),
      projectNames: (resume.projects || []).map((p) => p.name),
    },
    optimizable: {
      summaryLength: (resume.summary || "").length,
      headlineLength: (resume.headline || "").length,
      bulletCount: resume.experience.reduce(
        (sum, e) => sum + e.bullets.length,
        0,
      ),
      highlightCount: resume.education.reduce(
        (sum, e) => sum + (e.highlights?.length || 0),
        0,
      ),
      skillCategoryCount: new Set(
        resume.skills.map((s) => s.category).filter(Boolean),
      ).size,
    },
  };
}

// ====================================================================
// Snapshot Comparison
// ====================================================================

export interface SnapshotDiff {
  /** True when all sections match their fingerprints */
  passed: boolean;
  /** Per-section comparison results */
  sectionDiffs: SectionDiff[];
  /** Entity-level changes detected */
  entityChanges: EntityChange[];
  /** Immutable field violations */
  immutableViolations: string[];
  /** Summary of what changed */
  summary: string;
}

export interface SectionDiff {
  sectionType: string;
  before: SectionFingerprint | null;
  after: SectionFingerprint | null;
  hashChanged: boolean;
  entityCountChanged: boolean;
  bulletCountChanged: boolean;
  /** "preserved", "modified", "added", "removed" */
  status: "preserved" | "modified" | "added" | "removed";
}

export interface EntityChange {
  type: string;
  id: string;
  label: string;
  change: "added" | "removed" | "modified";
}

/**
 * Compare two preservation snapshots (before → after optimization).
 *
 * Returns a detailed diff covering:
 * - Section-level fingerprint changes
 * - Entity-level additions/removals
 * - Immutable field violations (name, email, phone changed)
 */
export function compareSnapshots(
  before: PreservationSnapshot,
  after: PreservationSnapshot,
): SnapshotDiff {
  const sectionDiffs: SectionDiff[] = [];
  const entityChanges: EntityChange[] = [];
  const immutableViolations: string[] = [];

  // ============================================================
  // 1. Section-level comparison
  // ============================================================
  const beforeMap = new Map<string, SectionFingerprint>();
  for (const s of before.sections) beforeMap.set(s.sectionType, s);

  const afterMap = new Map<string, SectionFingerprint>();
  for (const s of after.sections) afterMap.set(s.sectionType, s);

  // Check all before sections
  beforeMap.forEach((bSec, type) => {
    const aSec = afterMap.get(type);
    if (!aSec) {
      sectionDiffs.push({
        sectionType: type,
        before: bSec,
        after: null,
        hashChanged: true,
        entityCountChanged: true,
        bulletCountChanged: true,
        status: "removed",
      });
      return;
    }

    const hashChanged = bSec.hash !== aSec.hash;
    const entityCountChanged = bSec.entityCount !== aSec.entityCount;
    const bulletCountChanged = bSec.bulletCount !== aSec.bulletCount;

    sectionDiffs.push({
      sectionType: type,
      before: bSec,
      after: aSec,
      hashChanged,
      entityCountChanged,
      bulletCountChanged,
      status: hashChanged ? "modified" : "preserved",
    });
  });

  // Check for new sections in after that weren't in before
  afterMap.forEach((aSec, type) => {
    if (!beforeMap.has(type)) {
      sectionDiffs.push({
        sectionType: type,
        before: null,
        after: aSec,
        hashChanged: true,
        entityCountChanged: true,
        bulletCountChanged: true,
        status: "added",
      });
    }
  });

  // ============================================================
  // 2. Entity-level comparison
  // ============================================================
  const entityIdSources: Array<{
    type: string;
    ids: string[];
    labels: string[];
  }> = [
    {
      type: "experience",
      ids: before.entityIds.experience,
      labels: before.immutable.employerNames,
    },
    {
      type: "education",
      ids: before.entityIds.education,
      labels: before.immutable.institutionNames,
    },
    {
      type: "skills",
      ids: before.entityIds.skills,
      labels: [],
    },
    {
      type: "languages",
      ids: before.entityIds.languages,
      labels: before.immutable.languageNames,
    },
    {
      type: "projects",
      ids: before.entityIds.projects,
      labels: before.immutable.projectNames,
    },
    {
      type: "certifications",
      ids: before.entityIds.certifications,
      labels: before.immutable.certificationNames,
    },
    {
      type: "dynamicSections",
      ids: before.entityIds.dynamicSections,
      labels: [],
    },
  ];

  const afterIds = new Map<string, Set<string>>();
  for (const [key, ids] of Object.entries(after.entityIds)) {
    afterIds.set(key, new Set(ids));
  }

  for (const source of entityIdSources) {
    const afterSet = afterIds.get(source.type);
    if (!afterSet) continue;

    for (let i = 0; i < source.ids.length; i++) {
      const id = source.ids[i];
      if (!afterSet.has(id)) {
        const label =
          source.labels[i] ||
          source.ids[i] ||
          `${source.type}[${i}]`;
        entityChanges.push({
          type: source.type,
          id,
          label,
          change: "removed",
        });
      }
    }
  }

  // ============================================================
  // 3. Immutable field violations
  // ============================================================
  if (after.immutable.name !== before.immutable.name) {
    immutableViolations.push(
      `Name changed: "${before.immutable.name}" → "${after.immutable.name}"`,
    );
  }
  if (
    before.immutable.email &&
    after.immutable.email !== before.immutable.email
  ) {
    immutableViolations.push(
      `Email changed: "${before.immutable.email}" → "${after.immutable.email}"`,
    );
  }
  if (
    before.immutable.phone &&
    after.immutable.phone !== before.immutable.phone
  ) {
    immutableViolations.push(
      `Phone changed: "${before.immutable.phone}" → "${after.immutable.phone}"`,
    );
  }

  // ============================================================
  // 4. Determine overall status
  // ============================================================
  const hasSectionRemovals = sectionDiffs.some(
    (d) => d.status === "removed",
  );
  const hasEntityRemovals = entityChanges.some(
    (c) => c.change === "removed",
  );
  const hasImmutableViolations = immutableViolations.length > 0;
  const hasContentModifications = sectionDiffs.some(
    (d) => d.status === "modified",
  );

  const passed =
    !hasSectionRemovals &&
    !hasEntityRemovals &&
    !hasImmutableViolations;

  // Build human-readable summary
  const parts: string[] = [];
  const modifiedSections = sectionDiffs.filter((d) => d.status === "modified");
  if (modifiedSections.length > 0) {
    parts.push(
      `${modifiedSections.length} section(s) modified (optimizable content changes)`,
    );
  }
  if (hasSectionRemovals) {
    const removed = sectionDiffs
      .filter((d) => d.status === "removed")
      .map((d) => d.sectionType);
    parts.push(`Sections REMOVED: ${removed.join(", ")}`);
  }
  if (hasEntityRemovals) {
    parts.push(
      `${entityChanges.filter((c) => c.change === "removed").length} entity/entities removed`,
    );
  }
  if (hasImmutableViolations) {
    parts.push(`Immutable field violations: ${immutableViolations.join("; ")}`);
  }
  if (hasContentModifications && !hasSectionRemovals && !hasEntityRemovals) {
    parts.push("Only optimizable content was modified — acceptable");
  }

  return {
    passed,
    sectionDiffs,
    entityChanges,
    immutableViolations,
    summary: parts.length > 0 ? parts.join(". ") : "No changes detected",
  };
}

// ====================================================================
// Merge Engine — Explicit Optimizable/Non-Optimizable Field Contract
// ====================================================================

/**
 * OPTIMIZABLE FIELDS — the ONLY fields the AI is allowed to modify.
 * Everything else comes from the CANONICAL (source) resume.
 */
export interface OptimizableFieldExtract {
  summary?: string;
  headline?: string;
  /** AI-rewritten bullet text per experience entry */
  experienceBullets?: Record<string, string[]>;
  /** AI-rewritten highlight text per education entry */
  educationHighlights?: Record<string, string[]>;
  /** AI-rewritten project descriptions per project entry */
  projectBullets?: Record<string, string[]>;
  /** AI-rewritten certification descriptions (optional) */
  certificationDescriptions?: Record<string, string>;
  /** AI-rewritten dynamic section enhanced content */
  dynamicSectionEnhanced?: Record<string, { content?: string; bullets?: string[] }>;
  /** AI-reordered/categorized skills (names must still match original) */
  skillCategories?: Array<{ name: string; category: string }>;
}

/**
 * Merge AI-optimized fields into the canonical (source) resume.
 *
 * This is the authoritative merge engine. It enforces the preservation
 * contract by accepting ONLY the explicitly optimizable fields from the
 * AI output, and taking EVERYTHING ELSE from the canonical source resume.
 *
 * Pipeline usage:
 *   canonical = source resume (right after parsing)
 *   optimized = AI-provided output
 *   result   = mergeOptimizedIntoCanonical(canonical, optimized)
 *              // now fully validated, ready for Guardian
 *
 * Rules:
 *   - NON-OPTIMIZABLE FIELDS are ALWAYS from canonical (never trust AI).
 *   - OPTIMIZABLE FIELDS are taken from AI if present AND non-empty.
 *   - Bullets are merged per-entry using entity IDs.
 *   - Skills preserve names from canonical; only categories can change.
 *   - Summary/headline are replaced wholesale (they are pure optimizable text).
 *   - Languages, certifications, projects — entity structure is CANONICAL,
 *     only the description bullets can come from AI.
 */
export function mergeOptimizedIntoCanonical(
  canonical: ResumeData,
  optimized: ResumeData,
): ResumeData {
  // Start with a deep clone of the canonical resume
  const merged: ResumeData = JSON.parse(JSON.stringify(canonical));

  // ── OPTIMIZABLE: summary ──────────────────────────────────────────────
  if (optimized.summary && optimized.summary.length > 0) {
    merged.summary = optimized.summary;
  }

  // ── OPTIMIZABLE: headline ──────────────────────────────────────────────
  if (optimized.headline && optimized.headline.length > 0) {
    merged.headline = optimized.headline;
  }

  // ── OPTIMIZABLE: experience bullets (per-entry) ────────────────────────
  for (const exp of merged.experience) {
    const optExp = optimized.experience.find((e) => e.id === exp.id);
    if (optExp && optExp.bullets && optExp.bullets.length > 0) {
      exp.bullets = optExp.bullets;
    }
  }

  // ── OPTIMIZABLE: education highlights (per-entry) ──────────────────────
  for (const edu of merged.education) {
    const optEdu = optimized.education.find((e) => e.id === edu.id);
    if (optEdu && optEdu.highlights && optEdu.highlights.length > 0) {
      edu.highlights = optEdu.highlights;
    }
  }

  // ── OPTIMIZABLE: project bullets (per-entry) ───────────────────────────
  for (const proj of merged.projects || []) {
    const optProj = (optimized.projects || []).find((p) => p.id === proj.id);
    if (optProj && optProj.bullets && optProj.bullets.length > 0) {
      proj.bullets = optProj.bullets;
    }
  }

  // ── OPTIMIZABLE: skill categories ──────────────────────────────────────
  if (optimized.skills && optimized.skills.length > 0) {
    // Build a map of AI-optimized categories by skill name
    const optCategories = new Map<string, string>();
    for (const s of optimized.skills) {
      if (s.name && s.category) {
        optCategories.set(s.name.toLowerCase().trim(), s.category);
      }
    }
    // Apply categories to canonical skills
    for (const s of merged.skills) {
      const cat = optCategories.get(s.name.toLowerCase().trim());
      if (cat) {
        s.category = cat;
      }
    }
  }

  return merged;
}

/**
 * Extract ONLY the optimizable fields from an AI-generated resume.
 * This is the inverse of mergeOptimizedIntoCanonical — it strips away
 * all non-optimizable fields so the AI output acts purely as a
 * "diff of optimizable text" rather than a full resume replacement.
 */
export function extractOptimizableFields(
  optimized: ResumeData,
): OptimizableFieldExtract {
  const extract: OptimizableFieldExtract = {};

  if (optimized.summary) extract.summary = optimized.summary;
  if (optimized.headline) extract.headline = optimized.headline;

  // Experience bullets
  const expBullets: Record<string, string[]> = {};
  for (const exp of optimized.experience) {
    if (exp.bullets && exp.bullets.length > 0) {
      expBullets[exp.id] = exp.bullets;
    }
  }
  if (Object.keys(expBullets).length > 0) extract.experienceBullets = expBullets;

  // Education highlights
  const eduHighlights: Record<string, string[]> = {};
  for (const edu of optimized.education) {
    if (edu.highlights && edu.highlights.length > 0) {
      eduHighlights[edu.id] = edu.highlights;
    }
  }
  if (Object.keys(eduHighlights).length > 0) extract.educationHighlights = eduHighlights;

  // Project bullets
  const projBullets: Record<string, string[]> = {};
  for (const proj of optimized.projects || []) {
    if (proj.bullets && proj.bullets.length > 0) {
      projBullets[proj.id] = proj.bullets;
    }
  }
  if (Object.keys(projBullets).length > 0) extract.projectBullets = projBullets;

  // Skill categories
  const skills = optimized.skills.filter((s) => s.category);
  if (skills.length > 0) {
    extract.skillCategories = skills.map((s) => ({
      name: s.name,
      category: s.category!,
    }));
  }

  return extract;
}
