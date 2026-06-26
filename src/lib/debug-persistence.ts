// ============================================================================
// Debug Persistence
//
// Persists intermediate pipeline artifacts for debugging and diff analysis.
// In production, these are stored in memory (or optionally to D1).
//
// Artifacts persisted:
//   1. sourceResume.json — the parsed source resume
//   2. lockedEntities.json — the locked entities (fingerprint map)
//   3. optimizerInput.json — the input sent to the LLM
//   4. providerResponse.json — the raw LLM response
//   5. optimizerOutput.json — the parsed optimizer output
//   6. assembledResume.json — the assembled resume (before final validation)
//   7. finalResume.json — the final resume (after validation)
//   8. experienceDiff.json — per-experience before/after diff
//
// All artifacts are also logged to console for debugging.
// ============================================================================

"use client";

import type { ResumeData } from "./types";
import type { OptimizerOutput } from "./resume-assembler";
import { computeExperienceFingerprint } from "./experience-fingerprint";

export interface DebugArtifacts {
  sourceResume: ResumeData;
  optimizerInput: { systemPrompt: string; userPrompt: string };
  providerResponse: string;
  optimizerOutput: OptimizerOutput;
  assembledResume: ResumeData;
  finalResume: ResumeData;
  experienceDiff: ExperienceDiff[];
  timestamp: string;
}

export interface ExperienceDiff {
  id: string;
  title: string;
  company: string;
  startDate: string;
  endDate: string;
  fingerprint: string;
  bulletsChanged: boolean;
  bulletsBefore: string[];
  bulletsAfter: string[];
  bulletCountBefore: number;
  bulletCountAfter: number;
}

/**
 * Compute the per-experience diff between source and final resume.
 */
export function computeExperienceDiff(source: ResumeData, final: ResumeData): ExperienceDiff[] {
  const diffs: ExperienceDiff[] = [];

  for (const srcExp of source.experience) {
    // Find matching final entry by ID
    const finalExp = final.experience.find((e) => e.id === srcExp.id);

    if (!finalExp) {
      // Entry was dropped — record as a diff with empty "after"
      diffs.push({
        id: srcExp.id,
        title: srcExp.title,
        company: srcExp.company,
        startDate: srcExp.startDate,
        endDate: srcExp.endDate,
        fingerprint: computeExperienceFingerprint(srcExp),
        bulletsChanged: true,
        bulletsBefore: srcExp.bullets,
        bulletsAfter: [],
        bulletCountBefore: srcExp.bullets.length,
        bulletCountAfter: 0,
      });
      continue;
    }

    const bulletsChanged = JSON.stringify(srcExp.bullets) !== JSON.stringify(finalExp.bullets);

    diffs.push({
      id: srcExp.id,
      title: finalExp.title,
      company: finalExp.company,
      startDate: finalExp.startDate,
      endDate: finalExp.endDate,
      fingerprint: computeExperienceFingerprint(finalExp),
      bulletsChanged,
      bulletsBefore: srcExp.bullets,
      bulletsAfter: finalExp.bullets,
      bulletCountBefore: srcExp.bullets.length,
      bulletCountAfter: finalExp.bullets.length,
    });
  }

  return diffs;
}

/**
 * Persist debug artifacts to console (and optionally to storage).
 *
 * In production, this is a no-op except for console logging.
 * In development, this can be extended to write to localStorage or D1.
 */
export function persistDebugArtifacts(artifacts: DebugArtifacts): void {
  const summary = {
    timestamp: artifacts.timestamp,
    sourceExperienceCount: artifacts.sourceResume.experience.length,
    finalExperienceCount: artifacts.finalResume.experience.length,
    bulletsChanged: artifacts.experienceDiff.filter((d) => d.bulletsChanged).length,
    bulletsUnchanged: artifacts.experienceDiff.filter((d) => !d.bulletsChanged).length,
    providerResponseLength: artifacts.providerResponse.length,
    optimizerOutputExperiences: artifacts.optimizerOutput.experiences?.length ?? 0,
    optimizerOutputSkills: artifacts.optimizerOutput.skills?.length ?? 0,
  };

  console.group("[Debug Artifacts]");
  console.log("Summary:", summary);
  console.log("Experience Diff:");
  for (const diff of artifacts.experienceDiff) {
    const status = diff.bulletsChanged
      ? `CHANGED (${diff.bulletCountBefore}→${diff.bulletCountAfter} bullets)`
      : `unchanged (${diff.bulletCountBefore} bullets)`;
    console.log(`  [${diff.id}] ${diff.title} at ${diff.company}: ${status}`);
  }
  console.groupEnd();
}

/**
 * Create a debug artifacts object from pipeline stages.
 */
export function createDebugArtifacts(
  sourceResume: ResumeData,
  optimizerInput: { systemPrompt: string; userPrompt: string },
  providerResponse: string,
  optimizerOutput: OptimizerOutput,
  assembledResume: ResumeData,
  finalResume: ResumeData,
): DebugArtifacts {
  return {
    sourceResume,
    optimizerInput,
    providerResponse,
    optimizerOutput,
    assembledResume,
    finalResume,
    experienceDiff: computeExperienceDiff(sourceResume, finalResume),
    timestamp: new Date().toISOString(),
  };
}
