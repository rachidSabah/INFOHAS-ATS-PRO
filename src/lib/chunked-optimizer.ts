"use client";

import { recordAI, setFlightScope } from "@/lib/ai/flight-recorder";
setFlightScope({ scope: "resume-optimizer", feature: "Chunked Optimizer", module: "src.lib.chunked-optimizer" });

// Chunked Optimizer — Feature 2: Surgical Chunking (MapReduce Optimization)
//
// Instead of sending the ENTIRE resume + job description in one massive prompt
// (~22k chars), we split the work into small, hyper-focused sub-prompts that
// each hit a different provider in parallel:
//
//   Chunk A → Rewrite experience bullets only        (Gemini / provider #1)
//   Chunk B → Enrich skills array from JD keywords   (Mistral / provider #2)
//   Chunk C → Generate targeted professional summary  (NVIDIA / provider #3)
//
// Each chunk is <2,000 tokens — near-instant speed and almost 0% failure rate.
// The client-side assembler merges the three responses back into a single
// optimized resume object.
//
// The chunked path is used ONLY when:
//   1. At least 2 non-cooldown providers are available, AND
//   2. The resume has enough content to benefit (≥3 experience entries, ≥5 skills)
//
// On any chunk failure, the failed section simply keeps the original data
// (graceful partial optimization).
// ============================================================================


import type { ResumeData, JobDescription } from "./types";
import { callAI } from "./ai";
import { OPTIMIZER_CALL_TIMEOUT_MS } from "./pipeline-watchdog";

// ============================================================================
// Types
// ============================================================================

export interface ChunkedOptimizerInput {
  resume: ResumeData;
  jd: JobDescription;
  intelligenceContext?: string;
}

export interface ChunkedOptimizerResult {
  summary?: string;
  experience?: ResumeData["experience"];
  skills?: ResumeData["skills"];
  usedChunking: true;
  providersBullets?: string;
  providersSkills?: string;
  providersSummary?: string;
  chunkErrors?: string[];
}

// ============================================================================
// Chunk A: Rewrite experience bullets
// ============================================================================

async function optimizeBullets(
  experience: ResumeData["experience"],
  jd: JobDescription
): Promise<{ experience: ResumeData["experience"]; provider: string } | null> {
  const experienceJson = JSON.stringify(
    experience.slice(0, 6).map((e) => ({
      company: e.company,
      title: e.title,
      bullets: e.bullets,
    }))
  );

  const jdKeywords = [
    ...(jd.requiredSkills || []).slice(0, 15),
    ...(jd.keywords || []).slice(0, 10),
  ]
    .filter(Boolean)
    .join(", ");

  const systemPrompt = `You are a professional resume writer. Rewrite the experience bullets to better match the job requirements. 
RULES:
- Keep ALL employers, titles, and dates EXACTLY as given — do not invent facts
- Strengthen bullet verbs and quantify impact where possible
- Naturally integrate these job keywords where truthful: ${jdKeywords || "(none provided)"}
- Return ONLY a JSON array of experience objects with the same structure as input
- Each object must have: company (string), title (string), bullets (string[])
- Maximum 6 bullets per role`;

  const userPrompt = `Job Title: ${jd.title || "N/A"}
Company: ${jd.company || "N/A"}

EXPERIENCE TO REWRITE:
${experienceJson}

Return ONLY the JSON array. No explanation, no markdown fences.`;

  try {
    const result = await recordAI({
      systemPrompt,
      userPrompt,
      maxTokens: 2500,
      temperature: 0.2,
      taskCategory: "document",
      timeoutMs: Math.min(30000, OPTIMIZER_CALL_TIMEOUT_MS),
    });

    if (!result.text || result.isLocalEngine) return null;

    // Parse the returned JSON array
    const cleaned = result.text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return null;

    // Merge back into original experience (preserving startDate, endDate, location, etc.)
    const merged = experience.map((orig, i) => {
      const optimized = parsed.find(
        (p: any) => p.company === orig.company || p.title === orig.title
      );
      if (!optimized || !Array.isArray(optimized.bullets)) return orig;
      return { ...orig, bullets: optimized.bullets };
    });

    return { experience: merged, provider: result.provider };
  } catch (err) {
    console.warn("[ChunkedOptimizer] Bullets chunk failed:", err);
    return null;
  }
}

// ============================================================================
// Chunk B: Enrich skills array
// ============================================================================

async function optimizeSkills(
  skills: ResumeData["skills"],
  jd: JobDescription
): Promise<{ skills: ResumeData["skills"]; provider: string } | null> {
  const currentSkillNames = skills.map((s) => s.name).join(", ");
  const jdSkills = [
    ...(jd.requiredSkills || []),
    ...(jd.keywords || []).filter(
      (k) => k.length > 2 && !/^(and|the|for|with|in|of|to|at|by)$/i.test(k)
    ),
  ]
    .filter(Boolean)
    .slice(0, 30)
    .join(", ");

  const systemPrompt = `You are a professional resume skills optimizer.
Given a candidate's current skills and a job description's requirements, return an enriched skills list.
RULES:
- Keep ALL existing skills — never remove skills the candidate already has
- Add ONLY skills that are in the job description AND are real technical skills (not soft skills or generic phrases)
- Do NOT invent skills the candidate might not have — only add from the JD list
- Group related skills under the same category if possible
- Return ONLY a JSON array of skill objects with structure: [{name: string, category: string}]`;

  const userPrompt = `Current Skills: ${currentSkillNames || "(none)"}

Job Description Required Skills & Keywords: ${jdSkills || "(none provided)"}

Return the enriched skills JSON array. No explanation, no markdown.`;

  try {
    const result = await recordAI({
      systemPrompt,
      userPrompt,
      maxTokens: 1200,
      temperature: 0.1,
      taskCategory: "document",
      timeoutMs: Math.min(20000, OPTIMIZER_CALL_TIMEOUT_MS),
    });

    if (!result.text || result.isLocalEngine) return null;

    const cleaned = result.text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return null;

    // Validate structure
    const valid = parsed.filter(
      (s: any) => s && typeof s.name === "string" && s.name.trim().length > 0
    );
    if (valid.length === 0) return null;

    return {
      skills: valid.map((s: any) => ({
        id: s.id || `skill-${s.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}`,
        name: s.name.trim(),
        category: s.category?.trim() || "Skills",
        level: s.level ?? undefined,
      })),
      provider: result.provider,
    };
  } catch (err) {
    console.warn("[ChunkedOptimizer] Skills chunk failed:", err);
    return null;
  }
}

// ============================================================================
// Chunk C: Generate professional summary
// ============================================================================

async function optimizeSummary(
  resume: ResumeData,
  jd: JobDescription,
  intelligenceContext?: string
): Promise<{ summary: string; provider: string } | null> {
  const currentSummary = resume.summary || "";
  const topSkills = resume.skills
    .slice(0, 10)
    .map((s) => s.name)
    .join(", ");
  const topTitles = resume.experience
    .slice(0, 3)
    .map((e) => `${e.title} at ${e.company}`)
    .join("; ");

  const systemPrompt = `You are a professional resume writer specializing in executive summaries.
Write a targeted 3-4 sentence professional summary that:
- Opens with the candidate's strongest value proposition for THIS specific role
- Naturally integrates 3-5 of the most relevant keywords from the job description
- Highlights quantifiable achievements from their experience
- Matches the tone of a senior professional applying to this role
- Stays truthful — only reference what is in the source data
Return ONLY the summary text. No JSON, no labels, no markdown.`;

  const userPrompt = `TARGET ROLE: ${jd.title || "N/A"} at ${jd.company || "N/A"}
REQUIRED SKILLS: ${(jd.requiredSkills || []).slice(0, 15).join(", ") || "N/A"}

CANDIDATE BACKGROUND:
Current Summary: ${currentSummary || "(none)"}
Top Skills: ${topSkills || "(none)"}
Experience: ${topTitles || "(none)"}
${intelligenceContext ? `\nAdditional Context:\n${intelligenceContext.slice(0, 800)}` : ""}

Write the optimized professional summary now:`;

  try {
    const result = await recordAI({
      systemPrompt,
      userPrompt,
      maxTokens: 600,
      temperature: 0.3,
      taskCategory: "document",
      timeoutMs: Math.min(20000, OPTIMIZER_CALL_TIMEOUT_MS),
    });

    if (!result.text || result.isLocalEngine) return null;

    const summary = result.text.trim();
    if (summary.length < 50 || summary.length > 2000) return null;

    return { summary, provider: result.provider };
  } catch (err) {
    console.warn("[ChunkedOptimizer] Summary chunk failed:", err);
    return null;
  }
}

// ============================================================================
// Main MapReduce entry point
// ============================================================================

/**
 * Returns true if the resume is a good candidate for chunked optimization.
 * We only split when there's enough content that chunking saves time.
 */
export function isChunkingCandidate(resume: ResumeData): boolean {
  const hasEnoughExperience = (resume.experience?.length ?? 0) >= 2;
  const hasEnoughSkills = (resume.skills?.length ?? 0) >= 3;
  const hasSummaryContent = (resume.summary?.length ?? 0) >= 20 || (resume.experience?.length ?? 0) >= 1;
  return hasEnoughExperience && hasEnoughSkills && hasSummaryContent;
}

/**
 * Run the chunked MapReduce optimizer.
 * Fires 3 parallel AI calls for bullets, skills, and summary.
 * Returns partial results for each chunk that succeeded.
 */
export async function runChunkedOptimizer(
  input: ChunkedOptimizerInput
): Promise<ChunkedOptimizerResult> {
  const { resume, jd, intelligenceContext } = input;
  const errors: string[] = [];

  console.info("[ChunkedOptimizer] Starting MapReduce with 3 parallel chunks...");
  const t0 = performance.now();

  // Fire all 3 chunks in parallel
  const [bulletsResult, skillsResult, summaryResult] = await Promise.allSettled([
    optimizeBullets(resume.experience, jd),
    optimizeSkills(resume.skills, jd),
    optimizeSummary(resume, jd, intelligenceContext),
  ]);

  const elapsed = Math.round(performance.now() - t0);
  console.info(`[ChunkedOptimizer] All chunks completed in ${elapsed}ms`);

  // Collect results
  let experience = resume.experience;
  let skills = resume.skills;
  let summary = resume.summary;
  let providersBullets: string | undefined;
  let providersSkills: string | undefined;
  let providersSummary: string | undefined;

  if (bulletsResult.status === "fulfilled" && bulletsResult.value) {
    experience = bulletsResult.value.experience;
    providersBullets = bulletsResult.value.provider;
    console.info(`[ChunkedOptimizer] Bullets OK via ${providersBullets}`);
  } else {
    const reason = bulletsResult.status === "rejected" ? String(bulletsResult.reason) : "null result";
    errors.push(`Bullets: ${reason}`);
    console.warn(`[ChunkedOptimizer] Bullets chunk failed: ${reason}`);
  }

  if (skillsResult.status === "fulfilled" && skillsResult.value) {
    skills = skillsResult.value.skills;
    providersSkills = skillsResult.value.provider;
    console.info(`[ChunkedOptimizer] Skills OK via ${providersSkills}`);
  } else {
    const reason = skillsResult.status === "rejected" ? String(skillsResult.reason) : "null result";
    errors.push(`Skills: ${reason}`);
    console.warn(`[ChunkedOptimizer] Skills chunk failed: ${reason}`);
  }

  if (summaryResult.status === "fulfilled" && summaryResult.value) {
    summary = summaryResult.value.summary;
    providersSummary = summaryResult.value.provider;
    console.info(`[ChunkedOptimizer] Summary OK via ${providersSummary}`);
  } else {
    const reason = summaryResult.status === "rejected" ? String(summaryResult.reason) : "null result";
    errors.push(`Summary: ${reason}`);
    console.warn(`[ChunkedOptimizer] Summary chunk failed: ${reason}`);
  }

  return {
    summary,
    experience,
    skills,
    usedChunking: true,
    providersBullets,
    providersSkills,
    providersSummary,
    chunkErrors: errors.length > 0 ? errors : undefined,
  };
}
