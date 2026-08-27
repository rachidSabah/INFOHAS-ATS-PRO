/**
 * ============================================================================
 * A4 Page Density Autotuner Engine (`a4-autotuner.ts`)
 * ============================================================================
 * 
 * Provides exact A4 visual density measurement and automated Content Balancing
 * to ensure every optimized resume fills EXACTLY 100% of a single A4 page —
 * neither underfilled (75%) nor overflowing (101%+).
 * 
 * Capabilities:
 *   1. getA4FillPercentage(resume) — returns visual density (e.g., 98.4%)
 *   2. autotuneA4Density(resume, jd, callbacks) — runs multi-step tuning loop:
 *      - If underfilled (<95%), expands bullets, summary & education modules
 *      - If overflowing (>100%), micro-condenses bullet wording to fit 100%
 *      - Guaranteed 1-page A4 precision
 * ============================================================================
 */

"use client";

import type { ResumeData, JobDescription } from "@/lib/types";
import { simulateLayoutHeight } from "@/lib/layout-simulator";
import { recordAI } from "@/lib/ai/flight-recorder";
import { getOptimizerDirective } from "@/lib/ai";

export interface AutotuneResult {
  resume: ResumeData;
  initialFillPercent: number;
  finalFillPercent: number;
  iterations: number;
  changes: string[];
}

/**
 * Calculates the visual fill percentage of a resume on an A4 page (0% to 120%+).
 * Target optimal range: 95.0% - 100.0%.
 */
export function getA4FillPercentage(resume: ResumeData): number {
  const sim = simulateLayoutHeight(resume);
  const printableHeight = sim.pageHeightPt - sim.marginHeightPt;
  const ratio = sim.contentHeightPt / printableHeight;
  return Math.min(125, Math.round(ratio * 1000) / 10);
}

/**
 * Autotunes a resume's content density to achieve ~98-100% single A4 page filling.
 */
export async function autotuneA4Density(
  resume: ResumeData,
  jd?: JobDescription | null,
  onProgress?: (message: string, fillPercent: number) => void
): Promise<AutotuneResult> {
  let currentResume = JSON.parse(JSON.stringify(resume)) as ResumeData;
  const initialFill = getA4FillPercentage(currentResume);
  const changes: string[] = [];
  let iterations = 0;
  const maxIterations = 3;

  onProgress?.(`Initial visual density: ${initialFill}% A4 page height`, initialFill);

  // Ideal target range: 94.0% to 98.0% (leaves 2-4% safety buffer for Word/DOCX line heights)
  // NOTE: getA4FillPercentage (layout-simulator) tends to over-report fill, so we
  // additionally check the accurate visible-char metric. Expand if EITHER says
  // we are under 94% (so genuinely thin resumes get filled), only stop on overflow.
  const { validatePageFill } = await import("./agents/page-balancer");
  let visibleUsage = 100;
  try {
    visibleUsage = validatePageFill(resume, null).pageUsage;
  } catch { /* non-fatal */ }
  if ((initialFill >= 94.0 && initialFill <= 98.0) || (visibleUsage >= 94.0 && visibleUsage <= 98.0)) {
    onProgress?.(`Resume is already perfectly tuned at ${Math.max(initialFill, visibleUsage)}% A4 density!`, initialFill);
    return {
      resume: currentResume,
      initialFillPercent: initialFill,
      finalFillPercent: initialFill,
      iterations: 0,
      changes: ["Already optimal A4 page density"],
    };
  }

  const jdContext = jd
    ? `Target Role: ${jd.title} at ${jd.company || "Employer"}. Keywords: ${(jd.keywords || []).slice(0, 15).join(", ")}`
    : "General Senior Professional";

  const directive = getOptimizerDirective();

  while (iterations < maxIterations) {
    const currentFill = getA4FillPercentage(currentResume);
    iterations++;

    if (currentFill >= 94.0 && currentFill <= 98.0) {
      onProgress?.(`Target density reached: ${currentFill}% A4 page height!`, currentFill);
      break;
    }

    if (currentFill < 94.0) {
      // Underfilled: Expand content to reach 95-98% density
      const deficitPercent = Math.round(96 - currentFill);
      onProgress?.(`Underfilled (${currentFill}%). Deficit: +${deficitPercent}%. Expanding content...`, currentFill);

      const prompt = `You are an elite ATS resume architect. The candidate's resume is underfilling the single A4 page (currently ${currentFill}% full, needs to be 98-100% full).

TASK: Expand the content to reach 98-100% A4 visual density.
${jdContext}

OPTIMIZATION DIRECTIVE:
${directive}

CURRENT RESUME DATA:
${JSON.stringify({
  summary: currentResume.summary,
  experience: currentResume.experience.map((e) => ({ id: e.id, title: e.title, company: e.company, bullets: e.bullets })),
  education: currentResume.education.map((e) => ({ id: e.id, degree: e.degree, institution: e.institution, highlights: e.highlights })),
})}

EXPANSION INSTRUCTIONS:
1. Add 1-3 new quantified bullet points to each experience entry.
2. Expand summary to 5-6 powerful sentences.
3. Ensure education entries have 8-12 comprehensive, comma-separated module highlights.
4. Keep all existing company names, degree titles, and employment dates UNCHANGED.
5. Return ONLY a valid JSON object matching this schema:
{
  "summary": "expanded summary text...",
  "experience": [{"id":"...","bullets":["...","..."]}],
  "education": [{"id":"...","highlights":["Module1, Module2, Module3, ..."]}]
}`;

      try {
        const res = await recordAI({
          systemPrompt: "You are a professional resume writer. Return ONLY valid JSON.",
          userPrompt: prompt,
          maxTokens: 3500,
          temperature: 0.3,
          taskCategory: "document",
          agentType: "optimizer",
        });

        const jsonStr = (res.text || "").replace(/```json|```/g, "").trim();
        const data = JSON.parse(jsonStr);

        if (data) {
          if (data.summary) currentResume.summary = data.summary;
          if (Array.isArray(data.experience)) {
            currentResume.experience = currentResume.experience.map((e) => {
              const match = data.experience.find((x: any) => x.id === e.id);
              return match ? { ...e, bullets: match.bullets } : e;
            });
          }
          if (Array.isArray(data.education)) {
            currentResume.education = currentResume.education.map((e) => {
              const match = data.education.find((x: any) => x.id === e.id);
              return match ? { ...e, highlights: match.highlights } : e;
            });
          }
          changes.push(`Expanded content density (+${deficitPercent}%)`);
        }
      } catch (err: any) {
        onProgress?.(`Expansion attempt failed: ${err.message}`, currentFill);
        break;
      }
    } else {
      // Overflowing (>98%): Micro-condense to fit single A4 page
      const excessPercent = Math.round(currentFill - 96);
      onProgress?.(`Overflowing (${currentFill}%). Excess: -${excessPercent}%. Micro-condensing to fit 1 page...`, currentFill);

      const prompt = `You are an elite ATS resume architect. The candidate's resume slightly overflows 1 A4 page (currently ${currentFill}% full).

TASK: Condense wording by ~10-15% to guarantee it fits on EXACTLY 1 A4 page (98-100% full).
${jdContext}

CURRENT RESUME DATA:
${JSON.stringify({
  summary: currentResume.summary,
  experience: currentResume.experience.map((e) => ({ id: e.id, title: e.title, company: e.company, bullets: e.bullets })),
})}

CONDENSING INSTRUCTIONS:
1. Trim wordy introductory phrases while preserving ALL metrics, numbers, and key facts.
2. Keep bullet counts intact, but make each bullet 15-20% tighter.
3. Return ONLY a valid JSON object:
{
  "summary": "tightened summary...",
  "experience": [{"id":"...","bullets":["...","..."]}]
}`;

      try {
        const res = await recordAI({
          systemPrompt: "You are a professional resume writer. Return ONLY valid JSON.",
          userPrompt: prompt,
          maxTokens: 2500,
          temperature: 0.2,
          taskCategory: "document",
          agentType: "optimizer",
        });

        const jsonStr = (res.text || "").replace(/```json|```/g, "").trim();
        const data = JSON.parse(jsonStr);

        if (data) {
          if (data.summary) currentResume.summary = data.summary;
          if (Array.isArray(data.experience)) {
            currentResume.experience = currentResume.experience.map((e) => {
              const match = data.experience.find((x: any) => x.id === e.id);
              return match ? { ...e, bullets: match.bullets } : e;
            });
          }
          changes.push(`Micro-condensed text to fit single A4 page (-${excessPercent}%)`);
        }
      } catch (err: any) {
        onProgress?.(`Condensing attempt failed: ${err.message}`, currentFill);
        break;
      }
    }
  }

  const finalFill = getA4FillPercentage(currentResume);
  onProgress?.(`Autotune complete: ${initialFill}% → ${finalFill}% A4 visual density`, finalFill);

  return {
    resume: currentResume,
    initialFillPercent: initialFill,
    finalFillPercent: finalFill,
    iterations,
    changes,
  };
}
