// ============================================================================
// P4: Progressive Content Generation — staged AI calls for reliability.
//
// Instead of sending one massive prompt and expecting a complete optimized
// resume in one shot, this module breaks the optimization into smaller,
// more reliable stages:
//
//   Stage 1: Generate summary (60-90 words) → validate → accept
//   Stage 2: Rewrite experience bullets (per role) → validate → accept
//   Stage 3: Reorder/optimize skills → validate → accept
//   Stage 4: Compose final resume from accepted parts
//
// Each stage is a smaller, simpler AI call that's more likely to succeed.
// If stage 2 fails for one role, only that role uses the original bullets —
// the rest of the optimization is preserved.
//
// Usage (from orchestrator):
//   const generator = new ProgressiveGenerator(resume, jd, directive);
//   await generator.generateSummary();
//   await generator.generateExperienceBullets();
//   await generator.generateSkills();
//   const result = generator.compose();
// ============================================================================

import type { ResumeData, JobDescription } from "../types";

export interface ProgressiveStageResult {
  stage: string;
  success: boolean;
  provider: string;
  error?: string;
}

export class ProgressiveGenerator {
  private originalResume: ResumeData;
  private jd: JobDescription;
  private directive: string;
  private optimizedSummary: string | null = null;
  private optimizedBullets: Map<number, string[]> = new Map();
  private optimizedSkills: any[] | null = null;
  private stageResults: ProgressiveStageResult[] = [];

  constructor(resume: ResumeData, jd: JobDescription, directive: string) {
    this.originalResume = resume;
    this.jd = jd;
    this.directive = directive;
  }

  /**
   * Generate an optimized summary using a focused, smaller prompt.
   * This is more reliable than asking the AI to generate the entire resume at once.
   */
  async generateSummary(
    callAI: (systemPrompt: string, userPrompt: string) => Promise<string>,
  ): Promise<ProgressiveStageResult> {
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
      const result = await callAI(systemPrompt, userPrompt);
      if (result && result.trim().length > 30) {
        this.optimizedSummary = result.trim();
        this.stageResults.push({ stage: "summary", success: true, provider: "progressive" });
        return { stage: "summary", success: true, provider: "progressive" };
      }
      this.stageResults.push({ stage: "summary", success: false, provider: "progressive", error: "Empty or too short" });
      return { stage: "summary", success: false, provider: "progressive", error: "Empty or too short" };
    } catch (e: any) {
      this.stageResults.push({ stage: "summary", success: false, provider: "progressive", error: e?.message });
      return { stage: "summary", success: false, provider: "progressive", error: e?.message };
    }
  }

  /**
   * Generate optimized bullets for a single experience entry.
   * If this fails for one entry, the original bullets are preserved.
   */
  async generateExperienceBullets(
    callAI: (systemPrompt: string, userPrompt: string) => Promise<string>,
  ): Promise<ProgressiveStageResult[]> {
    const results: ProgressiveStageResult[] = [];

    for (let i = 0; i < this.originalResume.experience.length; i++) {
      const exp = this.originalResume.experience[i];
      const systemPrompt = `You are a resume writer. Rewrite the bullet points for this role to be more impactful and ATS-optimized. Return ONLY a JSON array of strings (the bullets). No markdown, no explanation.`;

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

Return ONLY a JSON array of strings. Example: ["Rewrote bullet 1...", "Rewrote bullet 2..."]`;

      try {
        const result = await callAI(systemPrompt, userPrompt);
        // Try to parse as JSON array
        const jsonMatch = result.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const bullets = JSON.parse(jsonMatch[0]);
          if (Array.isArray(bullets) && bullets.length > 0) {
            this.optimizedBullets.set(i, bullets.map((b: any) => String(b)));
            results.push({ stage: `experience[${i}]`, success: true, provider: "progressive" });
            continue;
          }
        }
        // Fallback: keep original bullets
        results.push({ stage: `experience[${i}]`, success: false, provider: "progressive", error: "Could not parse bullets" });
      } catch (e: any) {
        results.push({ stage: `experience[${i}]`, success: false, provider: "progressive", error: e?.message });
      }
    }

    this.stageResults.push(...results);
    return results;
  }

  /**
   * Compose the final resume from the generated parts.
   * Any stage that failed uses the original content.
   */
  compose(): ResumeData {
    const composed: ResumeData = JSON.parse(JSON.stringify(this.originalResume));

    if (this.optimizedSummary) {
      composed.summary = this.optimizedSummary;
    }

    for (const [expIndex, bullets] of this.optimizedBullets) {
      if (composed.experience[expIndex]) {
        composed.experience[expIndex].bullets = bullets;
      }
    }

    if (this.optimizedSkills) {
      composed.skills = this.optimizedSkills;
    }

    composed.updatedAt = new Date().toISOString();
    composed.source = "ai-optimized-progressive" as any;

    return composed;
  }

  getStageResults(): ProgressiveStageResult[] {
    return this.stageResults;
  }

  /**
   * Check if any stage succeeded (at least partial optimization).
   */
  hasAnySuccess(): boolean {
    return this.stageResults.some((r) => r.success);
  }
}
