// ============================================================================
// P4: Progressive Content Generation — staged AI calls for reliability.
//
// Instead of one massive prompt expecting a complete optimized resume in a
// single shot, optimization is broken into small, independent, verifiable
// stages:
//
//   Stage 1: Generate summary (60-90 words)   → parse+validate → accept
//   Stage 2: Rewrite experience bullets (per role, sequential)
//          → parse+validate → accept per entry
//   Compose: build an OptimizerPatch from the accepted parts ONLY
//
// Each stage is a smaller prompt with a much higher success rate. If a stage
// fails for one entry, that entry keeps its ORIGINAL content — the rest of
// the optimization is preserved. The emitted patch flows through the SAME
// downstream gates as the monolithic optimizer (OptimizerOutputValidator,
// assembler, guardian, page balancer) — no bypass paths.
//
// ACTIVATED (was dead code): wired into locked-pipeline Step 2 as the
// section-by-section SALVAGE path when the monolithic optimization fails,
// and emit-able per-stage via onStage/globalEventBus for the UI.
// ============================================================================

import type { ResumeData, JobDescription } from "../types";
import type { OptimizerOutput } from "../resume-assembler";
import { parseAgentJSON, runWithParseRepair } from "./structured-output";
import { globalEventBus } from "../agent-event-bus";

export interface ProgressiveStageResult {
  stage: string;
  success: boolean;
  provider: string;
  error?: string;
  /** Human note, e.g. bullet-count reconciliation details. */
  note?: string;
}

/** Injectable LLM invocation — returns RAW response text. */
export type ProgressiveCallAI = (call: {
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
}) => Promise<string>;

export class ProgressiveGenerator {
  private originalResume: ResumeData;
  private jd: JobDescription;
  private directive: string;
  private optimizedSummary: string | null = null;
  private optimizedBullets: Map<number, string[]> = new Map();
  private stageResults: ProgressiveStageResult[] = [];
  private onStage?: (stage: ProgressiveStageResult) => void;
  private callAI: ProgressiveCallAI;
  private providerLabel: string;

  constructor(
    resume: ResumeData,
    jd: JobDescription,
    directive: string,
    callAI: ProgressiveCallAI,
    opts: { onStage?: (stage: ProgressiveStageResult) => void; providerLabel?: string } = {}
  ) {
    this.originalResume = resume;
    this.jd = jd;
    this.directive = directive;
    this.callAI = callAI;
    this.onStage = opts.onStage;
    this.providerLabel = opts.providerLabel ?? "progressive";
  }

  private record(stage: string, success: boolean, error?: string, note?: string): ProgressiveStageResult {
    const result: ProgressiveStageResult = { stage, success, provider: this.providerLabel, ...(error ? { error } : {}), ...(note ? { note } : {}) };
    this.stageResults.push(result);
    this.onStage?.(result);
    globalEventBus.emit({
      agent: "ProgressiveGenerator",
      action: success ? "stage_complete" : "stage_failed",
      resumeId: this.originalResume.id,
      success,
      metadata: { stage, error, note },
    });
    return result;
  }

  /**
   * Stage 1 — optimized summary via a focused prompt. Plain text (no JSON),
   * validated by length only; failures leave the original summary in place.
   */
  async generateSummary(): Promise<ProgressiveStageResult> {
    const systemPrompt = `You are a resume writer. Generate a professional summary (60-90 words) based on the candidate's experience and the target job description. Return ONLY the summary text — no JSON, no markdown, no explanation.`;

    const userPrompt = `CANDIDATE:
Name: ${this.originalResume.name}
Headline: ${this.originalResume.headline ?? ""}
Summary: ${this.originalResume.summary ?? ""}
Top Skills: ${this.originalResume.skills.slice(0, 10).map((s) => s.name).join(", ")}

TARGET JOB:
Title: ${this.jd.title}
Company: ${this.jd.company ?? ""}
Keywords: ${(this.jd.keywords ?? []).join(", ")}

Write a 60-90 word professional summary that positions the candidate for this role. Use only information from the candidate's resume. Do not fabricate experience.`;

    try {
      const result = await this.callAI({ systemPrompt, userPrompt, maxTokens: 400, temperature: 0.3 });
      if (result && result.trim().length > 30) {
        this.optimizedSummary = result.trim();
        return this.record("summary", true);
      }
      return this.record("summary", false, "Empty or too short");
    } catch (e: any) {
      return this.record("summary", false, e?.message ?? "summary call failed");
    }
  }

  /**
   * Stage 2 — rewrite bullets per experience entry. Each entry is an
   * independent, bounded attempt: structured-output parse with ONE repair
   * round; on total failure the ORIGINAL bullets are preserved.
   */
  async generateExperienceBullets(): Promise<ProgressiveStageResult[]> {
    const results: ProgressiveStageResult[] = [];
    const BULLETS_SCHEMA = {
      type: "array" as const,
      minLength: 1,
      items: { type: "string" as const },
      label: "rewritten bullets",
    };

    for (let i = 0; i < this.originalResume.experience.length; i++) {
      const exp = this.originalResume.experience[i];
      const systemPrompt = `You are a resume writer. Rewrite the bullet points for this role to be more impactful and ATS-optimized. Return ONLY a JSON array of strings (the bullets). Same count as the original bullets. No markdown, no explanation.`;

      const userPrompt = `ROLE:
Title: ${exp.title}
Company: ${exp.company}
Dates: ${exp.startDate} - ${exp.endDate}
Original Bullets:
${exp.bullets.map((b, j) => `${j + 1}. ${b}`).join("\n")}

TARGET JOB KEYWORDS: ${(this.jd.keywords ?? []).join(", ")}

Rewrite each bullet to:
1. Start with a strong action verb (Led, Built, Improved, Delivered, etc.)
2. Include quantified results where the original supports it (do NOT invent metrics)
3. Naturally embed relevant JD keywords where appropriate
4. Keep each bullet 110-180 characters
5. Return EXACTLY ${exp.bullets.length} rewritten bullets (one per original bullet).

Return ONLY a JSON array of strings. Example: ["Rewrote bullet 1...", "Rewrote bullet 2..."]`;

      try {
        const { data: bullets, repairRounds } = await runWithParseRepair<string[]>(
          async (repairFeedback) => {
            const raw = await this.callAI({
              systemPrompt,
              userPrompt: repairFeedback ? `${userPrompt}\n\n${repairFeedback}` : userPrompt,
              maxTokens: 900,
              temperature: 0.3,
            });
            return raw ?? "";
          },
          BULLETS_SCHEMA,
          { label: `bullets[${exp.title}]`, maxRepairRounds: 1 }
        );

        const clean = bullets.map((b) => String(b).trim()).filter(Boolean);
        if (clean.length === 0) {
          results.push(this.record(`experience[${i}]`, false, "Empty bullet list"));
          continue;
        }

        // Patch contract: bullet count MUST match the source entry. Reconcile
        // honestly — keep rewrites for the first N, pad/truncate with the
        // ORIGINAL bullets so facts and counts are preserved.
        let accepted = clean;
        let note: string | undefined;
        if (clean.length < exp.bullets.length) {
          accepted = [...clean, ...exp.bullets.slice(clean.length)];
          note = `model returned ${clean.length}/${exp.bullets.length} bullets — remainder kept original`;
        } else if (clean.length > exp.bullets.length) {
          accepted = clean.slice(0, exp.bullets.length);
          note = `model returned ${clean.length}/${exp.bullets.length} bullets — truncated to source count`;
        }
        this.optimizedBullets.set(i, accepted);
        results.push(this.record(`experience[${i}]`, true, undefined, note ?? (repairRounds > 0 ? `recovered after ${repairRounds} repair round(s)` : undefined)));
      } catch (e: any) {
        results.push(this.record(`experience[${i}]`, false, e?.message ?? "bullets call failed"));
      }
    }

    return results;
  }

  /**
   * Compose the OptimizerPatch — REGRESSION FIX (production trace, ec799db
   * diagnosis): the patch must include EVERY source experience entry, not
   * only the stages that succeeded. The previous contract omitted failed
   * entries entirely, so a salvage whose per-experience calls all failed
   * (429 window / timeouts / parse errors) while the small summary call
   * slipped through produced `{ summary }` — which the OptimizerOutput
   * Validator then rejected with "0 experience rewrites for N source
   * entries — incomplete coverage", dooming every bounded retry.
   *
   * Contract: a failed stage contributes its ORIGINAL content (same promise
   * assembly always honored — now visible to the validator too); a succeeded
   * stage contributes its rewrite. Zero successful stages still yields an
   * empty patch and `runProgressiveOptimization` returns null (unchanged).
   */
  composePatch(): OptimizerOutput {
    const patch: OptimizerOutput = {};
    if (this.optimizedSummary) {
      patch.summary = this.optimizedSummary;
    }
    const experiences: NonNullable<OptimizerOutput["experiences"]> = [];
    for (let i = 0; i < this.originalResume.experience.length; i++) {
      const exp = this.originalResume.experience[i];
      if (!exp?.id) continue;
      // Rewritten bullets when the stage succeeded; ORIGINAL bullets when it
      // failed ("failed stage keeps original content" — at patch level).
      const bullets = this.optimizedBullets.get(i) ?? exp.bullets;
      experiences.push({ id: exp.id, bullets });
    }
    if (experiences.length > 0) {
      patch.experiences = experiences;
    }
    return patch;
  }

  compose(): ResumeData {
    // Full-resume compose is retained for callers that want a standalone
    // resume (UI preview); the PIPELINE path uses composePatch() so the output
    // flows through the standard assembler + validators.
    const composed: ResumeData = JSON.parse(JSON.stringify(this.originalResume));
    if (this.optimizedSummary) {
      composed.summary = this.optimizedSummary;
    }
    for (const [expIndex, bullets] of this.optimizedBullets) {
      if (composed.experience[expIndex]) {
        composed.experience[expIndex].bullets = bullets;
      }
    }
    composed.updatedAt = new Date().toISOString();
    composed.source = "ai-optimized-progressive" as any;
    return composed;
  }

  getStageResults(): ProgressiveStageResult[] {
    return this.stageResults;
  }

  hasAnySuccess(): boolean {
    return this.stageResults.some((r) => r.success);
  }
}

/**
 * Compact, human-readable summary of FAILED salvage stages — appended to the
 * locked pipeline's output-validation error so attemptErrors carry the REAL
 * per-stage reason (timeout / 429 / parse failure) instead of a bare
 * "incomplete coverage" symptom. Returns "" when nothing failed.
 */
export function describeSalvageStageFailures(stages: ProgressiveStageResult[]): string {
  if (!Array.isArray(stages)) return "";
  return stages
    .filter((s) => !s.success)
    .map((s) => `${s.stage}: ${String(s.error ?? "unknown").slice(0, 140)}`)
    .join("; ");
}

/**
 * Run the progressive section-by-section optimization and return a result
 * shaped exactly like BulletOnlyOptimizerResult, so the locked pipeline can
 * use it as a drop-in salvage path (same validation + assembly downstream).
 * Returns null when NO stage succeeded (caller falls back to the error path).
 */
export async function runProgressiveOptimization(
  sourceResume: ResumeData,
  jd: JobDescription,
  opts: {
    directive?: string;
    excludeProviderIds?: string[];
    onStage?: (stage: ProgressiveStageResult) => void;
    /** Injectable LLM — defaults to the real callAI with optimizer routing. */
    callAI?: ProgressiveCallAI;
    providerLabel?: string;
  } = {}
): Promise<{ output: OptimizerOutput; provider: string; rawResponse: string; warnings: string[]; salvageStages: ProgressiveStageResult[] } | null> {
  const defaultCallAI: ProgressiveCallAI = async (call) => {
    const { callAI: realCallAI } = await import("../ai");
    const res = await realCallAI({
      systemPrompt: call.systemPrompt,
      userPrompt: call.userPrompt,
      maxTokens: call.maxTokens,
      temperature: call.temperature,
      taskCategory: "document",
      isOptimizerCall: true,
      pipelineAgent: "optimizer",
      excludeProviderIds: opts.excludeProviderIds,
    });
    return res.text ?? "";
  };

  const generator = new ProgressiveGenerator(sourceResume, jd, opts.directive ?? "", opts.callAI ?? defaultCallAI, {
    onStage: opts.onStage,
    providerLabel: opts.providerLabel ?? "progressive",
  });

  await generator.generateSummary();
  await generator.generateExperienceBullets();

  if (!generator.hasAnySuccess()) {
    return null;
  }

  const stages = generator.getStageResults();
  const failed = stages.filter((s) => !s.success);
  const warnings = failed.map((s) => `Progressive stage "${s.stage}" failed: ${s.error ?? "unknown"} — original content preserved.`);

  globalEventBus.emit({
    agent: "ProgressiveGenerator",
    action: "optimization_complete",
    resumeId: sourceResume.id,
    success: true,
    metadata: {
      stagesTotal: stages.length,
      stagesSucceeded: stages.length - failed.length,
    },
  });

  return {
    output: generator.composePatch(),
    provider: "progressive-sections",
    rawResponse: JSON.stringify(stages),
    warnings,
    salvageStages: stages,
  };
}
