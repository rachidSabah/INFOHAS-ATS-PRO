// ============================================================================
// PatchEngine — Apply, Validate, Rollback Patches
// ============================================================================
// Agents NEVER return full resumes. They return ONLY patches.
// PatchEngine applies patches to the canonical resume safely.
// ============================================================================

import type { ResumeData } from "../types";
import type {
  AgentPatch,
  PatchConflict,
  ConflictResolutionResult,
  ConflictStrategy,
} from "./types";

let patchCounter = 0;
function nextPatchId(agentType: string): string {
  patchCounter++;
  return `${agentType}-${Date.now()}-${patchCounter}`;
}

export function createPatchId(agentType: string): string {
  return nextPatchId(agentType);
}

// ── Applies a list of patches to a resume ────────────────────────────────
// Returns the modified resume plus any patches that failed to apply.
export function applyPatches(
  resume: ResumeData,
  patches: AgentPatch[]
): { resume: ResumeData; applied: AgentPatch[]; failed: AgentPatch[] } {
  const working = JSON.parse(JSON.stringify(resume)) as ResumeData;
  const applied: AgentPatch[] = [];
  const failed: AgentPatch[] = [];

  for (const patch of patches) {
    try {
      const result = applySinglePatch(working, patch);
      if (result.success) {
        applied.push(patch);
      } else {
        failed.push(patch);
      }
    } catch {
      failed.push(patch);
    }
  }

  return { resume: working, applied, failed };
}

// ── Apply a single patch ─────────────────────────────────────────────────
function applySinglePatch(
  resume: ResumeData,
  patch: AgentPatch
): { success: boolean; error?: string } {
  const { sectionId, field, oldValue, newValue } = patch;

  // Validate — if oldValue doesn't match current, reject
  const currentValue = resolveField(resume, sectionId, field);
  if (currentValue === undefined) {
    return { success: false, error: `Field not found: ${sectionId}.${field}` };
  }
  if (currentValue !== oldValue) {
    // Content has changed since patch was created — conflict
    return {
      success: false,
      error: `Content mismatch: expected "${oldValue.substring(0, 50)}", found "${currentValue.substring(0, 50)}"`,
    };
  }

  // Apply
  const setResult = setField(resume, sectionId, field, newValue);
  if (!setResult.success) {
    return { success: false, error: setResult.error };
  }

  return { success: true };
}

// ── Resolve field path ───────────────────────────────────────────────────
// sectionId can be: "summary", "headline", "experience_0", "experience_1.bullet_2",
// "education_0.highlights[1]", "skills", "languages", etc.
function resolveField(
  resume: ResumeData,
  sectionId: string,
  field: string
): string | undefined {
  // Simple top-level fields
  if (sectionId === "summary") return resume.summary || "";
  if (sectionId === "headline") return resume.headline || "";

  // Array fields with index
  // Format: "experience_2" → experience[2], "education_0" → education[0]
  const expMatch = sectionId.match(/^experience_(\d+)$/);
  if (expMatch) {
    const idx = parseInt(expMatch[1], 10);
    const entry = resume.experience?.[idx];
    if (!entry) return undefined;

    if (field === "company") return entry.company;
    if (field === "title") return entry.title;
    if (field === "startDate") return entry.startDate || "";
    if (field === "endDate") return entry.endDate || "";
    if (field === "location") return entry.location || "";

    const bulletMatch = field.match(/^bullet_(\d+)$/);
    if (bulletMatch) {
      const bIdx = parseInt(bulletMatch[1], 10);
      return entry.bullets?.[bIdx];
    }

    // Check if it's a highlights field inside experience (some resumes have this)
    const hlMatch = field.match(/^highlights\[(\d+)\]$/);
    if (hlMatch) {
      const hIdx = parseInt(hlMatch[1], 10);
      return (entry as any).highlights?.[hIdx];
    }

    return undefined;
  }

  // Education
  const eduMatch = sectionId.match(/^education_(\d+)$/);
  if (eduMatch) {
    const idx = parseInt(eduMatch[1], 10);
    const entry = resume.education?.[idx];
    if (!entry) return undefined;

    if (field === "institution") return entry.institution;
    if (field === "degree") return entry.degree;
    if (field === "startDate") return entry.startDate || "";
    if (field === "endDate") return entry.endDate || "";
    if (field === "field") return entry.field || "";

    const hlMatch = field.match(/^highlights\[(\d+)\]$/);
    if (hlMatch) {
      const hIdx = parseInt(hlMatch[1], 10);
      return entry.highlights?.[hIdx];
    }

    return undefined;
  }

  // Project
  const projMatch = sectionId.match(/^project_(\d+)$/);
  if (projMatch) {
    const idx = parseInt(projMatch[1], 10);
    const entry = resume.projects?.[idx];
    if (!entry) return undefined;

    if (field === "name") return entry.name;
    if (field === "url") return entry.url || "";

    const bMatch = field.match(/^bullet_(\d+)$/);
    if (bMatch) {
      const bIdx = parseInt(bMatch[1], 10);
      return entry.bullets?.[bIdx] || "";
    }

    return undefined;
  }

  // Skills — flat array, field could be "skills" or "skill_2.name", "skill_2.category"
  const skillMatch = sectionId.match(/^skill_(\d+)$/);
  if (skillMatch) {
    const idx = parseInt(skillMatch[1], 10);
    const entry = resume.skills?.[idx];
    if (!entry) return undefined;

    if (field === "name") return entry.name;
    if (field === "category") return entry.category || "";

    return undefined;
  }

  // Languages
  const langMatch = sectionId.match(/^language_(\d+)$/);
  if (langMatch) {
    const idx = parseInt(langMatch[1], 10);
    const entry = resume.languages?.[idx];
    if (!entry) return undefined;

    if (field === "language") {
      return entry.name;
    }
    if (field === "proficiency") return entry.proficiency || "";

    return undefined;
  }

  // Certification
  const certMatch = sectionId.match(/^certification_(\d+)$/);
  if (certMatch) {
    const idx = parseInt(certMatch[1], 10);
    const entry = resume.certifications?.[idx];
    if (!entry) return undefined;

    if (field === "name") return entry.name;
    if (field === "issuer") return entry.issuer || "";

    return undefined;
  }

  // Dynamic section — sectionId IS the normalized title
  // Check any dynamicSections if available
  if (resume.dynamicSections) {
    const ds = resume.dynamicSections.find(
      (s: any) => s.normalizedTitle === sectionId || s.sectionId === sectionId
    );
    if (ds) {
      if (field === "content") return ds.content || "";
      // Indexed bullets inside dynamic section
      const dBullet = field.match(/^bullet_(\d+)$/);
      if (dBullet) {
        const bIdx = parseInt(dBullet[1], 10);
        const lines = (ds.content || "").split("\n");
        return lines[bIdx] || "";
      }
    }
  }

  // Additional info
  if (sectionId === "additionalInfo") return resume.additionalInfo || "";

  return undefined;
}

// ── Set a field value ────────────────────────────────────────────────────
function setField(
  resume: ResumeData,
  sectionId: string,
  field: string,
  value: string
): { success: boolean; error?: string } {
  if (sectionId === "summary") {
    resume.summary = value;
    return { success: true };
  }

  if (sectionId === "headline") {
    resume.headline = value;
    return { success: true };
  }

  if (sectionId === "additionalInfo") {
    resume.additionalInfo = value;
    return { success: true };
  }

  // Experience
  const expMatch = sectionId.match(/^experience_(\d+)$/);
  if (expMatch) {
    const idx = parseInt(expMatch[1], 10);
    const entry = resume.experience?.[idx];
    if (!entry) return { success: false, error: `Experience entry ${idx} not found` };

    if (field === "company") {
      if (entry.company !== value) {
        // IMMUTABLE — company names NEVER change via patch
        return { success: false, error: "Company name is immutable" };
      }
      return { success: true };
    }
    if (field === "title") {
      if (entry.title !== value) {
        return { success: false, error: "Title is immutable" };
      }
      return { success: true };
    }
    if (field === "startDate" || field === "endDate") {
      const current = field === "startDate" ? entry.startDate : entry.endDate;
      if (current !== value) {
        return { success: false, error: `${field} is immutable` };
      }
      return { success: true };
    }
    if (field === "location") {
      if (entry.location !== value) {
        return { success: false, error: "Location is immutable" };
      }
      return { success: true };
    }

    const bulletMatch = field.match(/^bullet_(\d+)$/);
    if (bulletMatch) {
      const bIdx = parseInt(bulletMatch[1], 10);
      if (!entry.bullets) entry.bullets = [];
      if (bIdx >= entry.bullets.length) {
        entry.bullets.push(value);
      } else {
        entry.bullets[bIdx] = value;
      }
      return { success: true };
    }

    return { success: false, error: `Unknown field: ${field}` };
  }

  // Education
  const eduMatch = sectionId.match(/^education_(\d+)$/);
  if (eduMatch) {
    const idx = parseInt(eduMatch[1], 10);
    const entry = resume.education?.[idx];
    if (!entry) return { success: false, error: `Education entry ${idx} not found` };

    if (field === "institution" || field === "degree" || field === "startDate" || field === "endDate") {
      return { success: false, error: `${field} is immutable` };
    }

    const hlMatch = field.match(/^highlights\[(\d+)\]$/);
    if (hlMatch) {
      const hIdx = parseInt(hlMatch[1], 10);
      if (!entry.highlights) entry.highlights = [];
      if (hIdx >= entry.highlights.length) {
        entry.highlights.push(value);
      } else {
        entry.highlights[hIdx] = value;
      }
      return { success: true };
    }

    return { success: false, error: `Unknown field: ${field}` };
  }

  // Project
  const projMatch = sectionId.match(/^project_(\d+)$/);
  if (projMatch) {
    const idx = parseInt(projMatch[1], 10);
    const entry = resume.projects?.[idx];
    if (!entry) return { success: false, error: `Project entry ${idx} not found` };

    const bMatch = field.match(/^bullet_(\d+)$/);
    if (bMatch) {
      const bIdx = parseInt(bMatch[1], 10);
      if (!entry.bullets) entry.bullets = [];
      if (bIdx >= entry.bullets.length) {
        entry.bullets.push(value);
      } else {
        entry.bullets[bIdx] = value;
      }
      return { success: true };
    }

    return { success: false, error: `Unknown project field: ${field}` };
  }

  // Skills
  const skillMatch = sectionId.match(/^skill_(\d+)$/);
  if (skillMatch) {
    const idx = parseInt(skillMatch[1], 10);
    const entry = resume.skills?.[idx];
    if (!entry) return { success: false, error: `Skill entry ${idx} not found` };

    if (field === "category") {
      entry.category = value;
      return { success: true };
    }
    if (field === "name") {
      entry.name = value;
      return { success: true };
    }

    return { success: false, error: `Unknown skill field: ${field}` };
  }

  // Languages
  const langMatch = sectionId.match(/^language_(\d+)$/);
  if (langMatch) {
    return { success: false, error: "Language entries are immutable" };
  }

  // Certifications
  const certMatch = sectionId.match(/^certification_(\d+)$/);
  if (certMatch) {
    const idx = parseInt(certMatch[1], 10);
    const entry = resume.certifications?.[idx];
    if (!entry) return { success: false, error: `Certification entry ${idx} not found` };

    if (field === "description" || field === "details") {
      (entry as any)[field] = value;
      return { success: true };
    }

    if (field === "name" || field === "issuer") {
      return { success: false, error: "Certification name/issuer is immutable" };
    }

    return { success: false, error: `Unknown certification field: ${field}` };
  }

  // Dynamic section
  if (resume.dynamicSections) {
    const dsIndex = resume.dynamicSections.findIndex(
      (s: any) => s.normalizedTitle === sectionId || s.sectionId === sectionId
    );
    if (dsIndex >= 0) {
      const ds = resume.dynamicSections[dsIndex] as any;
      const bMatch = field.match(/^bullet_(\d+)$/);
      if (bMatch) {
        const lines = (ds.content || "").split("\n");
        const bIdx = parseInt(bMatch[1], 10);
        if (bIdx < lines.length) {
          lines[bIdx] = value;
          ds.content = lines.join("\n");
          resume.dynamicSections[dsIndex] = ds;
          return { success: true };
        }
      }
      if (field === "content") {
        ds.content = value;
        resume.dynamicSections[dsIndex] = ds;
        return { success: true };
      }
    }
  }

  return { success: false, error: `Cannot resolve: ${sectionId}.${field}` };
}

// ── Validate a single patch for integrity ────────────────────────────────
export function validatePatch(patch: AgentPatch): string[] {
  const errors: string[] = [];

  if (!patch.patchId) errors.push("Missing patchId");
  if (!patch.agentId) errors.push("Missing agentId");
  if (!patch.agentType) errors.push("Missing agentType");
  if (!patch.sectionId) errors.push("Missing sectionId");
  if (!patch.field) errors.push("Missing field");
  if (patch.oldValue === undefined) errors.push("Missing oldValue");
  if (patch.newValue === undefined) errors.push("Missing newValue");
  if (patch.oldValue === patch.newValue) errors.push("Patch makes no change");
  if (patch.confidence < 0 || patch.confidence > 1) errors.push("Confidence out of range [0,1]");
  if (!patch.reason) errors.push("Missing reason");

  // Size limit on text fields
  if (patch.newValue && patch.newValue.length > 5000) {
    errors.push("newValue exceeds 5000 chars");
  }

  return errors;
}

// ── Detect conflicts between patches ─────────────────────────────────────
export function detectConflicts(
  patches: AgentPatch[]
): PatchConflict[] {
  const conflicts: PatchConflict[] = [];
  const seen = new Map<string, AgentPatch>();

  for (const patch of patches) {
    const key = `${patch.sectionId}|${patch.field}`;
    const existing = seen.get(key);

    if (existing && existing.agentId !== patch.agentId) {
      conflicts.push({
        patchA: existing,
        patchB: patch,
        sectionId: patch.sectionId,
        field: patch.field,
        resolution: "reject-both",
      });
    } else if (!existing) {
      seen.set(key, patch);
    }
  }

  return conflicts;
}

// ── Resolve a conflict based on strategy ─────────────────────────────────
export function resolveConflict(
  conflict: PatchConflict,
  strategy: ConflictStrategy
): ConflictResolutionResult {
  const { patchA, patchB } = conflict;

  switch (strategy) {
    case "confidence-wins": {
      const winner = patchA.confidence >= patchB.confidence ? patchA : patchB;
      return {
        resolved: true,
        winner,
        resolution: "choose-a" as PatchConflict["resolution"],
        explanation: `Chose ${winner.agentId} (confidence: ${winner.confidence}) over ${winner === patchA ? patchB.agentId : patchA.agentId} (${winner === patchA ? patchB.confidence : patchA.confidence})`,
      };
    }

    case "ats-wins": {
      // Both patches — prefer the ATS optimization agent's version
      const winner = patchA.agentType === "ats-optimization" ? patchA : patchB;
      return {
        resolved: true,
        winner,
        resolution: "choose-a" as PatchConflict["resolution"],
        explanation: `ATS optimization agent preferred for ATS impact`,
      };
    }

    case "grammar-wins": {
      const winner = patchA.agentType === "professional-writing" ? patchA : patchB;
      return {
        resolved: true,
        winner,
        resolution: "choose-a" as PatchConflict["resolution"],
        explanation: `Professional writing agent preferred for grammar/readability`,
      };
    }

    case "preservation-wins": {
      // Prefer the patch with higher preservation score (closer to original)
      // We keep the shorter / more conservative change
      const aChange = Math.abs(patchA.newValue.length - patchA.oldValue.length);
      const bChange = Math.abs(patchB.newValue.length - patchB.oldValue.length);
      const winner = aChange <= bChange ? patchA : patchB;
      return {
        resolved: true,
        winner,
        resolution: "choose-a" as PatchConflict["resolution"],
        explanation: `Chose patch with smaller content change (preservation priority)`,
      };
    }

    case "latest-wins": {
      return {
        resolved: true,
        winner: patchB,
        resolution: "choose-b" as PatchConflict["resolution"],
        explanation: `Latest patch wins`,
      };
    }

    case "retry": {
      return {
        resolved: false,
        resolution: "retry",
        explanation: `Conflict requires retry: ${patchA.agentId} vs ${patchB.agentId} on ${conflict.sectionId}.${conflict.field}`,
      };
    }

    default:
      return {
        resolved: true,
        winner: patchA,
        resolution: "choose-a" as PatchConflict["resolution"],
        explanation: `Default: chose ${patchA.agentId}`,
      };
  }
}

// ── Rollback patches (reverse their effects) ─────────────────────────────
export function rollbackPatches(
  resume: ResumeData,
  patches: AgentPatch[]
): { resume: ResumeData; errors: string[] } {
  // Rollback by re-applying patches in reverse with oldValue and newValue swapped
  const reversePatches: AgentPatch[] = patches
    .slice()
    .reverse()
    .map((p) => ({
      ...p,
      patchId: `rollback-${p.patchId}`,
      oldValue: p.newValue,
      newValue: p.oldValue,
    }));

  const result = applyPatches(resume, reversePatches);
  return { resume: result.resume, errors: result.failed.map((p) => p.reason) };
}

// ── Compute a basic quality score from patches ───────────────────────────
export function computeQualityScore(
  _resume: ResumeData,
  patches: AgentPatch[]
): number {
  if (patches.length === 0) return 100;

  let totalConfidence = 0;
  let highConfCount = 0;

  for (const p of patches) {
    totalConfidence += p.confidence;
    if (p.confidence >= 0.85) highConfCount++;
  }

  const avgConfidence = totalConfidence / patches.length;
  const highConfRatio = patches.length > 0 ? highConfCount / patches.length : 0;

  // Score = 80% average confidence + 20% high-confidence ratio
  return Math.round((avgConfidence * 80 + highConfRatio * 20) * 100);
}
