import type { ResumeData, JobDescription } from "../types";
import type { JobIntelligence } from "../job-intelligence";
import { callAI } from "../ai";
import { uid } from "../store";

export interface ExpansionResult {
  resume: ResumeData;
  expandedSections: ExpandedSection[];
  finalCharCount: number;
  confidence: number;
}

export interface ExpandedSection {
  section: string;
  beforeChars: number;
  afterChars: number;
  changes: string[];
}

export interface ExpansionConfig {
  targetMinChars: number;
  targetMaxChars: number;
  maxBulletsPerEntry: number;
  preserveLockedFields: boolean;
}

export const DEFAULT_EXPANSION_CONFIG: ExpansionConfig = {
  targetMinChars: 2800,
  targetMaxChars: 3800,
  maxBulletsPerEntry: 7,
  preserveLockedFields: true,
};

/**
 * ContentExpansionAgent — expands resume content to meet character/page-fill targets.
 * Runs after Optimizer when the output is too short (< 2500 chars).
 * Expands bullets, adds detail to sparse sections, and fills the page.
 */
export async function runContentExpansion(
  resume: ResumeData,
  jd?: JobDescription | null,
  ji?: JobIntelligence | null,
  config: ExpansionConfig = DEFAULT_EXPANSION_CONFIG,
): Promise<ExpansionResult> {
  const expandedSections: ExpandedSection[] = [];
  const changes: string[] = [];

  const currentChars = JSON.stringify(resume).length;
  if (currentChars >= config.targetMinChars) {
    return { resume, expandedSections: [], finalCharCount: currentChars, confidence: 100 };
  }

  // 1. Expand summary if too short
  if (resume.summary && resume.summary.length < 200) {
    const before = resume.summary.length;
    const expanded = await expandSummary(resume, jd, ji);
    if (expanded && expanded.length > before) {
      resume.summary = expanded;
      expandedSections.push({ section: "summary", beforeChars: before, afterChars: expanded.length, changes: ["Expanded summary to be more detailed"] });
      changes.push(`Summary: ${before} → ${expanded.length} chars`);
    }
  }

  // 2. Expand experience bullets
  for (let i = 0; i < resume.experience.length; i++) {
    const exp = resume.experience[i];
    if (exp.bullets.length < 3) {
      const before = exp.bullets.length;
      resume.experience[i] = await expandBullets(exp, jd, config.maxBulletsPerEntry);
      expandedSections.push({ section: `experience[${i}]`, beforeChars: before, afterChars: resume.experience[i].bullets.length, changes: [`Expanded from ${before} to ${resume.experience[i].bullets.length} bullets`] });
      changes.push(`Experience[${i}] (${exp.company}): ${before} → ${resume.experience[i].bullets.length} bullets`);
    }
  }

  // 3. Expand skills if sparse
  if (resume.skills.length < 5 && ji?.priorityKeywords) {
    const before = resume.skills.length;
    const existingNames = new Set(resume.skills.map((s) => s.name.toLowerCase()));
    for (const kw of ji.priorityKeywords) {
      if (!existingNames.has(kw.toLowerCase()) && resume.skills.length < 15) {
        resume.skills.push({ id: uid("sk"), name: kw, level: "intermediate" as const, category: ji.industry ?? "General" });
        existingNames.add(kw.toLowerCase());
      }
    }
    expandedSections.push({ section: "skills", beforeChars: before, afterChars: resume.skills.length, changes: [`Added ${resume.skills.length - before} JD-relevant skills`] });
    changes.push(`Skills: ${before} → ${resume.skills.length}`);
  }

  const finalCharCount = JSON.stringify(resume).length;
  const confidence = finalCharCount >= config.targetMinChars ? 100 : Math.round((finalCharCount / config.targetMinChars) * 100);

  return { resume, expandedSections, finalCharCount, confidence };
}

async function expandSummary(
  resume: ResumeData,
  jd?: JobDescription | null,
  ji?: JobIntelligence | null,
): Promise<string | undefined> {
  const industry = ji?.industry ?? "";
  const keywords = ji?.priorityKeywords?.slice(0, 10).join(", ") ?? "";
  const topSkills = resume.skills.slice(0, 8).map((s) => s.name).join(", ");

  try {
    const result = await callAI({
      systemPrompt: "You are a professional resume writer. Expand the given summary to 2-3 sentences that are impactful and ATS-friendly. Return ONLY the expanded summary text — no quotes, no labels, no markdown.",
      userPrompt: `Original summary: "${resume.summary}"

Expand this summary for a ${industry || "professional"} role. Incorporate these keywords naturally: ${keywords || "(none specified)"}. Key skills: ${topSkills || "(none listed)"}.

Write 2-3 compelling sentences that:
- Open with the candidate's title and years of experience
- Highlight 2-3 key achievements or areas of expertise
- Mention the target industry or role
- Naturally embed relevant keywords

Expanded summary:`,
      maxTokens: 300,
      temperature: 0.3,
      taskCategory: "document",
    });
    return result.text?.trim() || resume.summary;
  } catch {
    return resume.summary;
  }
}

async function expandBullets(
  exp: ResumeData["experience"][0],
  jd?: JobDescription | null,
  maxBullets = 7,
): Promise<ResumeData["experience"][0]> {
  if (exp.bullets.length >= maxBullets) return exp;

  try {
    const result = await callAI({
      systemPrompt: "You are a professional resume writer. Add more bullet points to the given experience entry. Keep them factual, quantified, and ATS-friendly. Return ONLY the bullet points as a JSON array of strings — no other text.",
      userPrompt: `Role: ${exp.title} at ${exp.company}
Existing bullets: ${JSON.stringify(exp.bullets)}

Add ${Math.min(3, maxBullets - exp.bullets.length)} more bullet points that:
- Are consistent with the existing bullets
- Use strong action verbs (Led, Developed, Implemented, Optimized)
- Include metrics where possible
- Are relevant to ${jd?.title || "the target role"}

Return ONLY a JSON array of strings:
["bullet 1", "bullet 2", "bullet 3"]`,
      maxTokens: 500,
      temperature: 0.3,
      taskCategory: "document",
    });
    const text = result.text?.trim() ?? "[]";
    const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*$/gi, "").trim();
    const newBullets: string[] = JSON.parse(cleaned);
    if (Array.isArray(newBullets) && newBullets.length > 0) {
      const allBullets = [...exp.bullets, ...newBullets].slice(0, maxBullets);
      return { ...exp, bullets: allBullets };
    }
  } catch {
    // Silently fail — return original
  }
  return exp;
}

/**
 * Trim and consolidate bullets for a specific experience entry.
 */
export async function trimExperienceBullets(
  exp: ResumeData["experience"][0],
  targetCount = 3
): Promise<string[]> {
  try {
    const result = await callAI({
      systemPrompt: "You are an expert resume writer and editor. Your job is to trim, consolidate, and shorten the bullet points for a job experience entry to make them more concise, high-impact, and quantified, fitting strictly into a smaller layout space while retaining all factual metrics and achievements.",
      userPrompt: `Role: ${exp.title} at ${exp.company}
Current bullets:
${JSON.stringify(exp.bullets)}

Please rewrite and consolidate these bullets down to exactly ${targetCount} bullet points.
Rules:
1. Every bullet must start with a strong action verb (e.g. Optimized, Led, Formulated).
2. Keep it factual and preserve all metrics (percentages, dollar amounts, number of users, etc.).
3. Combine overlapping achievements to make them concise.
4. Return ONLY a valid JSON array of strings:
["bullet 1", "bullet 2", "bullet 3"]`,
      maxTokens: 500,
      temperature: 0.2,
      taskCategory: "document"
    });
    const text = result.text?.trim() ?? "[]";
    const cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*$/gi, "").trim();
    const trimmed: string[] = JSON.parse(cleaned);
    if (Array.isArray(trimmed) && trimmed.length > 0) {
      return trimmed;
    }
  } catch (err) {
    console.warn("[trimExperienceBullets] failed:", err);
  }
  return exp.bullets;
}

