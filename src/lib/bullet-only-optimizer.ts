// ============================================================================
// Bullet-Only Optimizer
//
// The new optimizer contract. The LLM is NO LONGER allowed to generate
// an entire resume. It may ONLY return:
//
//   {
//     summary: string,
//     headline: string,
//     skills: [{ name, category }],
//     experiences: [{ id, bullets }]
//   }
//
// Everything else (company, dates, title, location, education, languages,
// contact info) is APPLICATION-OWNED and comes from the source resume.
//
// The Resume Assembler merges the optimizer output with the source resume
// to produce the final resume.
//
// This eliminates ALL classes of corruption:
//   - missing company names (company comes from source)
//   - missing dates (dates come from source)
//   - duplicated experiences (assembler enforces source count)
//   - hallucinated employers (LLM cannot add employers)
//   - education corruption (education comes from source)
//   - language corruption (languages come from source)
// ============================================================================

"use client";

import type { ResumeData, ResumeSkill, JobDescription, AgentDirectives, OptimizerDirectiveConfig } from "./types";
import { callAI, callAIStreamed, extractJSON, OPTIMIZER_CALL_TIMEOUT_MS } from "./ai";
import { buildBulletDirective } from "./optimizer-directive-engine";
import { cleanupGrammar, repairMalformedJSON, stripMarkdown } from "./ai-response-processor";
import type { OptimizerOutput } from "./resume-assembler";
import { validateOptimizerPatch } from "./optimizer-patch";
import {
  detectATSFromContext,
  ATS_PLATFORM_PROFILES,
  AIRLINE_COMPETENCY_ONTOLOGY
} from "./enterprise/ats-intelligence-engine";
import { loadUserProfile } from "./agents/memory-agent";

export interface BulletOnlyOptimizerResult {
  output: OptimizerOutput;
  provider: string;
  rawResponse: string;
  warnings: string[];
}

/**
 * Build the optimizer input — the data sent to the LLM.
 *
 * CRITICAL: The LLM receives the FULL source resume (so it has context),
 * but it's instructed to ONLY return { summary, headline, skills, experiences: [{id, bullets}] }.
 *
 * The experience entries sent to the LLM include their IDs so the LLM
 * can echo them back in its output (enabling ID-based matching).
 */
export function buildOptimizerInput(
  sourceResume: ResumeData,
  jd: JobDescription,
  intelligenceContext: string,
  directiveConfig?: OptimizerDirectiveConfig | null,
  optimizationPolicy?: string | null,
  feedback?: string,
): { systemPrompt: string; userPrompt: string } {
  const agentDirectives = directiveConfig?.agentDirectives;
  // The source resume sent to the LLM — includes IDs for experience entries
  // so the LLM can echo them back.
  const sourceForLLM = {
    name: sourceResume.name,
    headline: sourceResume.headline,
    contact: {
      email: sourceResume.contact.email,
      phone: sourceResume.contact.phone,
      location: sourceResume.contact.location,
    },
    summary: sourceResume.summary,
    experience: sourceResume.experience.map((e) => ({
      id: e.id, // CRITICAL: include ID so LLM can echo it back
      title: e.title,
      company: e.company,
      location: e.location,
      startDate: e.startDate,
      endDate: e.endDate,
      bullets: e.bullets,
    })),
    education: sourceResume.education.map((ed) => ({
      id: ed.id, // CRITICAL: include ID so LLM can echo it back
      degree: ed.degree,
      institution: ed.institution,
      field: ed.field,
      location: ed.location,
      startDate: ed.startDate,
      endDate: ed.endDate,
      highlights: ed.highlights,
    })),
    skills: sourceResume.skills.map((s) => ({ name: s.name, category: s.category })),
    languages: sourceResume.languages,
    certifications: sourceResume.certifications,
  };

  const jdText = jd.rawText || (jd.keywords || []).join(" ");
  const detectedAts = detectATSFromContext(undefined, jdText, jd.company);
  const platform = ATS_PLATFORM_PROFILES[detectedAts.atsId] || ATS_PLATFORM_PROFILES.generic;

  const atsIntel = `
  ═══════════════════════════════════════════════════════════════
  TARGET ATS ECOSYSTEM GUIDANCE (${platform.name} - Version ${platform.version}):
  - Parsing Behavior: ${platform.parsingStyle}
  - Formatting Constraints: ${platform.formattingPreferences}
  - Optimization Strategy: ${platform.optimizationStrategy}
  ═══════════════════════════════════════════════════════════════`;

  const matchedCompetencies: string[] = [];
  for (const [key, comp] of Object.entries(AIRLINE_COMPETENCY_ONTOLOGY)) {
    const termMatches = [comp.name, ...comp.aliases, ...comp.synonyms].some(term => 
      jdText.toLowerCase().includes(term.toLowerCase())
    );
    if (termMatches) {
      matchedCompetencies.push(`- **${comp.name}**: ${comp.description}
  *Behavioral Indicators*: ${comp.behavioralIndicators.slice(0, 2).join("; ")}
  *Key Terminology*: ${comp.relatedAtsKeywords.slice(0, 5).join(", ")}`);
    }
  }

  const competencyIntel = matchedCompetencies.length > 0
    ? `
  ═══════════════════════════════════════════════════════════════
  TARGET COMPETENCY ONTOLOGY (Align candidate achievements with these profiles):
  ${matchedCompetencies.join("\n")}
  ═══════════════════════════════════════════════════════════════`
    : "";

  const airlineLanguageIntel = `
  ═══════════════════════════════════════════════════════════════
  AIRLINE LANGUAGE ENGINE TRANSFORMS (Translate generic terms naturally where appropriate):
  - customer support / customer service -> Passenger Assistance / Passenger Experience
  - safety rules -> Safety Compliance / SEP Guidelines
  - help customers -> Deliver Exceptional Passenger Experience / Service Recovery
  - teamwork -> Crew Resource Management (CRM)
  - problem solving -> Operational Decision Making
  - baggage -> Cabin Baggage
  - flight -> Sector Operation
  - boss / supervisor -> Cabin Senior / Purser
  ═══════════════════════════════════════════════════════════════`;

  // === Load manual style overrides from memory ===
  const profile = loadUserProfile();
  const manualOverridesPrompt = profile.manualOverrides && profile.manualOverrides.length > 0
    ? `\n\n═══════════════════════════════════════════════════════════════
USER WRITING STYLE PREFERENCES (Learned from manual overrides of prior generations):
${profile.manualOverrides.slice(-5).map(o => `- Preferred: "${o.edited}" instead of "${o.original}"`).join("\n")}
Please mimic this style and choice of wording in new generations.
═══════════════════════════════════════════════════════════════`
    : "";

  const systemPrompt = `${optimizationPolicy ? optimizationPolicy + "\n\n" : ""}${buildBulletDirective(directiveConfig, {
    sourceResume,
    customOverride: directiveConfig?.customDirectiveOverride?.trim(),
  })}

${atsIntel}
${competencyIntel}
${airlineLanguageIntel}
${manualOverridesPrompt}

${agentDirectives ? buildAgentDirectiveSection(agentDirectives) : ""}`;
  let userPrompt = `SOURCE RESUME (be truthful to this — never invent employers, dates, or metrics):

${JSON.stringify(sourceForLLM, null, 2)}

${sourceResume.rawText ? `\nFULL RAW RESUME TEXT (may contain content the parser missed — use it to fill gaps in the parsed data above):\n\n${sourceResume.rawText}\n` : ""}

TARGET JOB DESCRIPTION:
${jd.rawText ?? JSON.stringify({ title: jd.title, company: jd.company, responsibilities: jd.responsibilities, requiredSkills: jd.requiredSkills, keywords: jd.keywords })}

${intelligenceContext}

Return ONLY the JSON object with this EXACT shape:
{
  "summary": "...",
  "headline": "...",
  "skills": [{ "name": "...", "category": "..." }],
  "experiences": [{ "id": "EXACT_SOURCE_ID", "bullets": ["...", "..."] }],
  "education": [{ "id": "EXACT_SOURCE_ID", "highlights": ["...", "..."] }]
}

No prose. No markdown fences. No HTML. Only JSON.`;

  if (feedback) {
    userPrompt += `\n\nCRITICAL FEEDBACK FROM PREVIOUS ATTEMPT (YOU MUST FIX THESE ISSUES):\n${feedback}`;
  }

  // Enforce AI contract at prompt-construction time: ensure critical directives
  // are present in the prompt before it's sent to any AI provider.
  const combinedPrompt = systemPrompt + "\n" + userPrompt;
  const requiredDirectives = [
    { keyword: "DO NOT change", message: "IMPORTANT: DO NOT change, remove, or reorder experience/education IDs. They are immutable." },
    { keyword: "Only modify", message: "CRITICAL: Only modify: summary text, experience bullet points, and skill bullet points. Never change job titles, companies, dates, or education entries." },
    { keyword: "content must not be removed", message: "CRITICAL: Original content must not be removed or reduced unless explicitly instructed." },
  ];

  let finalSystemPrompt = systemPrompt;
  for (const directive of requiredDirectives) {
    if (!combinedPrompt.includes(directive.keyword)) {
      finalSystemPrompt = directive.message + "\n" + finalSystemPrompt;
    }
  }

  return { systemPrompt: finalSystemPrompt, userPrompt };
}

/**
 * Parse the LLM's response into an OptimizerOutput.
 *
 * Handles:
 *   - JSON extraction from prose/markdown
 *   - Malformed JSON repair
 *   - Validation that the output matches the optimizer contract
 *   - Stripping any forbidden fields the LLM may have included
 */
export function parseOptimizerOutput(rawResponse: string): { output: OptimizerOutput; warnings: string[] } {
  const warnings: string[] = [];

  if (!rawResponse || rawResponse.trim().length === 0) {
    throw new Error("Optimizer returned empty response");
  }

  let parsed: any;

  // Try direct JSON extraction
  try {
    parsed = extractJSON<any>(rawResponse);
  } catch {
    // Try repair
    const repaired = repairMalformedJSON(rawResponse);
    if (repaired.json) {
      parsed = repaired.json;
      warnings.push(`JSON repaired: ${repaired.repairs.join(", ")}`);
    } else {
      // Try stripping markdown
      const stripped = stripMarkdown(rawResponse);
      try {
        parsed = JSON.parse(stripped);
        warnings.push("Stripped markdown before parsing");
      } catch {
        throw new Error("Failed to parse optimizer output as JSON after all repair attempts");
      }
    }
  }

  // Handle nested "resume" wrapper (some LLMs wrap the output)
  if (parsed.resume && typeof parsed.resume === "object") {
    parsed = parsed.resume;
    warnings.push("Unwrapped nested 'resume' object");
  }

  // Extract ONLY allowed fields — strip everything else
  const output: OptimizerOutput = {
    summary: typeof parsed.summary === "string" ? cleanupGrammar(parsed.summary) : undefined,
    headline: typeof parsed.headline === "string" ? cleanupGrammar(parsed.headline) : undefined,
    skills: Array.isArray(parsed.skills)
      ? parsed.skills
          .filter((s: any) => s && typeof s === "object" && typeof s.name === "string")
          .map((s: any) => ({
            name: cleanupGrammar(s.name),
            category: typeof s.category === "string" ? cleanupGrammar(s.category) : undefined,
          }))
      : undefined,
    experiences: Array.isArray(parsed.experiences)
      ? parsed.experiences
          .filter((e: any) => e && typeof e === "object" && typeof e.id === "string")
          .map((e: any) => ({
            id: e.id,
            bullets: Array.isArray(e.bullets)
              ? e.bullets
                  .filter((b: any) => typeof b === "string")
                  .map((b: string) => cleanupGrammar(b))
                  .filter((b: string) => b.length > 0)
              : [],
          }))
      : Array.isArray(parsed.experience) // fallback for LLMs that use "experience" instead of "experiences"
        ? parsed.experience
            .filter((e: any) => e && typeof e === "object" && typeof e.id === "string")
            .map((e: any) => ({
              id: e.id,
              bullets: Array.isArray(e.bullets)
                ? e.bullets
                    .filter((b: any) => typeof b === "string")
                    .map((b: string) => cleanupGrammar(b))
                    .filter((b: string) => b.length > 0)
                : [],
            }))
        : undefined,
    education: Array.isArray(parsed.education)
      ? parsed.education
          .filter((ed: any) => ed && typeof ed === "object" && typeof ed.id === "string")
          .map((ed: any) => ({
            id: ed.id,
            highlights: Array.isArray(ed.highlights)
              ? ed.highlights
                  .filter((h: any) => typeof h === "string")
                  .map((h: string) => cleanupGrammar(h))
                  .filter((h: string) => h.length > 0)
              : [],
          }))
      : undefined,
    missingKeywordsAdded: Array.isArray(parsed.missingKeywordsAdded) ? parsed.missingKeywordsAdded : undefined,
    bulletsRewritten: typeof parsed.bulletsRewritten === "number" ? parsed.bulletsRewritten : undefined,
    rationales: Array.isArray(parsed.rationales)
      ? parsed.rationales
          .filter((r: any) => r && typeof r === "object" && typeof r.reason === "string")
          .map((r: any) => ({
            section: typeof r.section === "string" ? r.section : "experience",
            original: typeof r.original === "string" ? r.original : "",
            edited: typeof r.edited === "string" ? r.edited : "",
            reason: typeof r.reason === "string" ? r.reason : "",
          }))
      : undefined,
  };

  // Use OptimizerPatch validator to detect & strip ALL forbidden fields at every level
  const validationWarnings = validateOptimizerPatch(parsed);
  warnings.push(...validationWarnings);

  return { output, warnings };
}

/**
 * Run the bullet-only optimizer.
 *
 * This is the NEW optimization entry point. It:
 *   1. Builds the optimizer input (source resume + JD + intelligence)
 *   2. Calls the LLM with the strict optimizer contract
 *   3. Parses the response into an OptimizerOutput
 *   4. Returns the output for the Resume Assembler to merge
 *
 * The LLM NEVER generates the full resume. The application owns assembly.
 */
export async function runBulletOnlyOptimizer(
  sourceResume: ResumeData,
  jd: JobDescription,
  intelligenceContext: string,
  directiveConfig?: OptimizerDirectiveConfig | null,
  excludeProviderIds?: string[],
  optimizationPolicy?: string | null,
  feedback?: string,
  baselineResume?: ResumeData, // Added for Localized Diff-Only Processing
  onChunk?: (chunk: string) => void,
): Promise<BulletOnlyOptimizerResult> {
  // FAST-FAIL: Structural validation before any AI call
  const structuralWarnings: string[] = [];
  if (!sourceResume.experience || sourceResume.experience.length === 0) {
    structuralWarnings.push("Resume has no experience entries — optimization limited to other sections.");
  }
  if (!sourceResume.education || sourceResume.education.length === 0) {
    structuralWarnings.push("Resume has no education entries — optimization will skip education.");
  }
  if (!sourceResume.skills || sourceResume.skills.length === 0) {
    structuralWarnings.push("Resume has no skills — optimization will skip skills.");
  }
  if (!sourceResume.contact?.email && !sourceResume.contact?.phone) {
    structuralWarnings.push("Resume has no contact information (email or phone).");
  }
  if (structuralWarnings.length > 0) {
    console.warn(
      `[BulletOnlyOptimizer] Structural advisories (non-blocking): ${structuralWarnings.join("; ")}`
    );
  }

  const useParallel = process.env.NEXT_PUBLIC_USE_PARALLEL_PIPELINE === "true"; // default: false

  if (useParallel) {
    console.info("[BulletOnlyOptimizer] Running in parallel subagent mode.");
    const { runParallelOptimizer } = await import("./parallel-pipeline");
    const parallelResult = await runParallelOptimizer({
      resume: sourceResume,
      jd,
      directiveConfig,
      optimizationPolicy,
      baselineResume,
    });

    const output: OptimizerOutput = {
      summary: parallelResult.resume.summary,
      headline: parallelResult.resume.headline,
      skills: parallelResult.resume.skills,
      experiences: parallelResult.resume.experience,
    };

    return {
      output,
      provider: parallelResult.provider,
      rawResponse: JSON.stringify(output),
      warnings: [...structuralWarnings, ...parallelResult.warnings],
    };
  }

  const { systemPrompt, userPrompt } = buildOptimizerInput(sourceResume, jd, intelligenceContext, directiveConfig, optimizationPolicy, feedback);

  const agentDirectives = directiveConfig?.agentDirectives;
  const temp = agentDirectives?.supervisor?.temperature ?? 0.15;
  const result = await callAIStreamed({
    systemPrompt,
    isOptimizerCall: true,
    pipelineAgent: "resume-optimizer",
    userPrompt,
    maxTokens: 6000, // smaller than before — output is much smaller now
    temperature: temp,
    taskCategory: "document",
    timeoutMs: OPTIMIZER_CALL_TIMEOUT_MS,
    excludeProviderIds,
    enableRetries: agentDirectives?.supervisor?.enableRetries,
    enableProviderSwitch: agentDirectives?.supervisor?.enableProviderSwitch,
  }, (chunk) => {
    if (onChunk) onChunk(chunk);
  });

  // Reject local fallback
  if (result.isLocalEngine || result.provider === "Local Engine (offline mode)" || (result.text?.length ?? 0) < 200) {
    throw new Error(
      "No AI provider available. Optimization could not be completed. " +
      "Configure an API provider in Settings or sign in to Puter.",
    );
  }

  const { output, warnings } = parseOptimizerOutput(result.text);

  return {
    output,
    provider: result.provider,
    rawResponse: result.text,
    warnings: [...structuralWarnings, ...warnings],
  };
}

/**
 * Build the agent directive section that gets injected into the LLM prompt.
 *
 * This reflects the user's configured per-agent directives (from the UI)
 * into the actual prompt text sent to the LLM.
 */
function buildAgentDirectiveSection(d: AgentDirectives): string {
  const lines: string[] = [];

  lines.push("═══════════════════════════════════════════════════════════════");
  lines.push("AGENT DIRECTIVES (user-configured — MUST follow)");
  lines.push("═══════════════════════════════════════════════════════════════");

  // Summary Agent
  lines.push("");
  lines.push("SUMMARY AGENT DIRECTIVE:");
  lines.push(`- ATS Aggressiveness: ${d.summary.atsAggressiveness}/100 ${
    d.summary.atsAggressiveness < 30 ? "(minimal — only rephrase, do not add new keywords)" :
    d.summary.atsAggressiveness < 70 ? "(moderate — embed keywords naturally)" :
    "(aggressive — maximize keyword density, but never stuff)"
  }`);
  lines.push(`- Preserve Facts: ${d.summary.preserveFacts ? "YES — never add facts not in source" : "NO (warning: may add inferred facts)"}`);
  lines.push(`- Summary Length: ${d.summary.minCharacters}-${d.summary.maxCharacters} characters`);

  // Skills Agent
  lines.push("");
  lines.push("SKILLS AGENT DIRECTIVE:");
  lines.push(`- Max Keywords: ${d.skills.maxKeywords}`);
  lines.push(`- Transferable Skills: ${d.skills.allowTransferableSkills ? "ALLOWED — bridge JD gaps with transferable skills" : "NOT allowed"}`);
  lines.push(`- Company Keywords: ${d.skills.allowCompanyKeywords ? "allowed" : "FORBIDDEN (never use company names as skills)"}`);
  lines.push(`- Location Keywords: ${d.skills.allowLocationKeywords ? "allowed" : "FORBIDDEN (never use location names as skills)"}`);

  // Experience Agent
  lines.push("");
  lines.push("EXPERIENCE AGENT DIRECTIVE:");
  lines.push(`- Rewrite: ${d.experience.rewriteBulletsOnly ? "BULLETS ONLY (title, company, dates, location are LOCKED)" : "all fields (warning: may corrupt locked fields)"}`);
  lines.push(`- Max Expansion: ${d.experience.maxExpansionPercent}% (bullets can be at most ${d.experience.maxExpansionPercent}% longer than original)`);

  // Education Agent
  lines.push("");
  lines.push("EDUCATION AGENT DIRECTIVE:");
  lines.push(`- ${d.education.formatOnly ? "FORMAT ONLY — never add, remove, or infer education" : "Full edit allowed (warning: may corrupt education)"}`);

  // Languages Agent
  lines.push("");
  lines.push("LANGUAGES AGENT DIRECTIVE:");
  lines.push(`- ${d.languages.formatOnly ? "FORMAT ONLY — never add, remove, or infer languages" : "Full edit allowed (warning: may corrupt languages)"}`);

  // Headline Agent
  if (d.headline) {
    lines.push("");
    lines.push("HEADLINE AGENT DIRECTIVE:");
    lines.push(`- Rewrite Headline: ${d.headline.rewriteHeadline ? "ALLOWED" : "FORBIDDEN"}`);
    lines.push(`- Max Headline Length: ${d.headline.maxHeadlineChars} characters`);
    lines.push(`- Headline Tone Alignment: ${d.headline.headlineTone}`);
  }

  // Certifications Agent
  if (d.certifications) {
    lines.push("");
    lines.push("CERTIFICATIONS AGENT DIRECTIVE:");
    lines.push(`- Format Only: ${d.certifications.formatOnly ? "YES — format existing certs without adding or removing credentials" : "NO"}`);
    lines.push(`- Strip Expired Certs: ${d.certifications.stripExpiredCerts ? "YES" : "NO"}`);
    lines.push(`- Max Cert Age: ${d.certifications.maxCertAgeYears} years (0 = no limit)`);
    lines.push(`- Max Certification Entries: ${d.certifications.maxCertEntries}`);
  }

  // Supervisor
  lines.push("");
  lines.push("SUPERVISOR DIRECTIVE:");
  lines.push(`- Strict Mode: ${d.supervisor.strictMode ? "ENABLED — hard-fail on any critical issue" : "disabled (graceful degradation)"}`);
  lines.push(`- Immutable Entity Enforcement: ${d.supervisor.enforceImmutableEntities ? "ENABLED" : "disabled"}`);
  if (d.supervisor.temperature !== undefined) {
    lines.push(`- Temperature: ${d.supervisor.temperature}`);
  }
  if (d.supervisor.strictness !== undefined) {
    lines.push(`- Strictness: ${d.supervisor.strictness}/100`);
  }

  lines.push("");
  lines.push("═══════════════════════════════════════════════════════════════");

  return lines.join("\n");
}

/**
 * Filter out full-resume specific JSON layout specifications from the compiled
 * directive so that the bullet-only optimizer is not confused into outputting the full resume.
 */
function cleanDirectiveForBulletOnly(directive: string, isCustom: boolean): string {
  // If it's a custom override, we DON'T clean it. We want the LLM to see 
  // exactly what the user wrote, as it's a "robust override".
  if (isCustom) return directive;

  const delimiter = "═══════════════════════════════════════════════════════════════";
  const sections = directive.split(delimiter);
  const cleanSections: string[] = [];

  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;

    const lines = trimmed.split("\n");
    const title = lines[0]?.trim() || "";

    if (
      title.includes("OUTPUT FORMAT") ||
      title.includes("OUTPUT CONTRACT") ||
      title.includes("FORBIDDEN SECTIONS") ||
      title.includes("SECTION ORDER")
    ) {
      continue;
    }

    cleanSections.push(section);
  }

  return cleanSections.join(delimiter);
}
