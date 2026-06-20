// ResumeAI Pro — Aviation-focused ATS directives & helpers
//
// This module contains:
//   1. CABIN_CREW_KEYWORDS  — aviation/cabin-crew keyword bank for ATS matching
//   2. AVIATION_KEYWORDS    — broader aviation keyword bank
//   3. AIRLINE_ATS_PROFILES — per-airline ATS system configs (Emirates, Qatar, Etihad, …)
//   4. AppSettings          — tone / format / strictness settings for the optimizer
//   5. analyzeWithGemini()  — AI function that produces a scored, optimized HTML resume
//   6. getAviationOptimizerDirective() — unified directive that merges super-admin
//      optimizer config with aviation keyword bank + airline profile (returns JSON)
//   7. aviationOptimize()   — AI call using the unified directive (returns structured JSON)
//   8. getDocxHtml()        — strict A4 one-page HTML wrapper for .doc/.docx export
//
// analyzeWithGemini() routes through our existing callAI() gateway (Puter → server → local),
// so it inherits the full failover chain. The "Gemini" name is preserved for compatibility
// with the original spec — in practice any provider can serve it.

import { callAI, extractJSON, getOptimizerDirective } from "./ai";
import { INDUSTRY_PROFILES } from "./industry-ats";
import type { OptimizerDirectiveConfig, ResumeData } from "./types";
import { useApp } from "./store";

// ============================================================================
// 1. KEYWORD BANKS
// ============================================================================

export const CABIN_CREW_KEYWORDS = `
  Technical: Cabin Crew Attestation (CCA), CPR/AED Certified, Aviation First Aid, SEP (Safety and Emergency Procedures), Aircraft Type Qualifications (e.g., A380, B787), Cabin Crew Medical.
  Safety: Emergency Evacuation, Dangerous Goods Regulations (DGR), In-flight Firefighting, Ditching Procedures, Pre-flight Safety Checks, Aviation Security (AVSEC).
  Operational: CRM (Crew Resource Management), In-flight Service Delivery, Galley Management, Passenger Announcements (PA), Turnaround Operations, Special Handling (UMNR, PRM).
  Soft Skills: Customer Service Excellence, Conflict Resolution, Cultural Awareness, De-escalation, Decision Making Under Pressure, Situational Awareness.
`;

export const AVIATION_KEYWORDS = `
  Technical: Cabin Crew Attestation (CCA), ATP Certificate, Type Ratings (A320, B737, B777, B787, A350, A380), CRM Certification, Aviation First Aid, CPR/AED, SEP (Safety and Emergency Procedures), Aircraft Type Qualifications, Cabin Crew Medical, ICAO Language Proficiency (Level 4+).
  Safety: Emergency Evacuation, Dangerous Goods Regulations (DGR), In-flight Firefighting, Ditching Procedures, Pre-flight Safety Checks, Aviation Security (AVSEC), Smoke Removal, Rapid Decompression, Cabin Pressurization.
  Operational: Crew Resource Management (CRM), In-flight Service Delivery, Galley Management, Passenger Announcements (PA), Turnaround Operations, Special Handling (UMNR, PRM, CIP), Duty-Free Sales, Cash & Card Handling, Passenger Boarding, Disembarkation Procedures.
  Service: Customer Service Excellence, Conflict Resolution, Cultural Awareness, De-escalation, Decision Making Under Pressure, Situational Awareness, Multicultural Team Collaboration, Premium Cabin Service, Fine Dining Service, Beverage Service.
  Regulatory: EASA Part-CC, FAA Part 121/135, CAA CAP 789, ICAO Annex 6, IATA DGR, Aviation Audits (IOSA), Safety Management Systems (SMS).
  Languages: English (ICAO Level 4+), Arabic, French, German, Spanish, Mandarin, Hindi, Urdu — cross-cultural communication.
`;

// ============================================================================
// 2. AIRLINE ATS PROFILES
// ============================================================================

export interface AirlineAtsProfile {
  system: string;
  focus: string;
  // Keywords the airline's ATS specifically weights
  priorityKeywords?: string[];
  // Tone preference
  tone?: "Formal" | "Balanced" | "Warm" | "Premium";
}

export const AIRLINE_ATS_PROFILES: Record<string, AirlineAtsProfile> = {
  emirates: {
    system: "Emirates Group Talent ATS (Workday)",
    focus: "Multicultural service excellence, premium cabin experience, Dubai-based global operations",
    priorityKeywords: ["Multicultural", "Premium Service", "Diversity", "Global Mindset", "Excellence", "Hospitality", "Luxury", "Etiquette"],
    tone: "Premium",
  },
  qatar: {
    system: "Qatar Airways Talent ATS (SuccessFactors)",
    focus: "Five-star service, fast-paced hub operations, Doha connectivity, award-winning cabin crew",
    priorityKeywords: ["Five-Star", "Award-Winning", "Service Excellence", "Hub Operations", "Diversity", "Premium", "Hospitality"],
    tone: "Formal",
  },
  etihad: {
    system: "Etihad Aviation Group ATS (Taleo)",
    focus: "Abu Dhabi flagship carrier, premium product, cabin crew inflight innovation",
    priorityKeywords: ["Innovation", "Premium", "Choose Well", "Hospitality", "UAE National", "Service Excellence"],
    tone: "Balanced",
  },
  lufthansa: {
    system: "Lufthansa Group ATS (SAP SuccessFactors)",
    focus: "German engineering precision, European network, Star Alliance integration, safety-first",
    priorityKeywords: ["Precision", "Safety-First", "Star Alliance", "German", "Engineering", "Reliability", "Efficiency"],
    tone: "Formal",
  },
  ryanair: {
    system: "Ryanair Careers ATS",
    focus: "Low-cost carrier efficiency, fast turnarounds, high-volume operations, punctuality",
    priorityKeywords: ["Efficiency", "Punctuality", "Fast Turnaround", "Low-Cost", "High-Volume", "On-Time Performance"],
    tone: "Balanced",
  },
  singapore: {
    system: "Singapore Airlines ATS (Workday)",
    focus: "Singapore Girl service standard, Asian hospitality, ultra-long-haul operations, premium cabins",
    priorityKeywords: ["Asian Hospitality", "Singapore Girl", "Premium", "Ultra-Long-Haul", "Service Excellence", "Refinement"],
    tone: "Premium",
  },
  airfrance: {
    system: "Air France-KLM ATS",
    focus: "French service elegance, dual-hub (CDG/AMS), SkyTeam integration, premium leisure",
    priorityKeywords: ["Elegance", "French", "SkyTeam", "Premium Leisure", "Hospitality", "Bilingual"],
    tone: "Premium",
  },
  british: {
    system: "British Airways ATS (Workday)",
    focus: "British heritage service, London hub, premium long-haul, oneworld alliance",
    priorityKeywords: ["Heritage", "British", "Premium", "Oneworld", "Long-Haul", "Service Excellence"],
    tone: "Formal",
  },
  generic: {
    system: "Generic ATS (Workday / SuccessFactors / Taleo compatible)",
    focus: "General aviation keyword matching, standard cabin crew competency framework",
    priorityKeywords: [],
    tone: "Balanced",
  },
};

export const AIRLINE_OPTIONS = [
  { id: "generic", label: "Generic / Multi-Airline", icon: "Globe" },
  { id: "emirates", label: "Emirates", icon: "Plane" },
  { id: "qatar", label: "Qatar Airways", icon: "Plane" },
  { id: "etihad", label: "Etihad Airways", icon: "Plane" },
  { id: "lufthansa", label: "Lufthansa Group", icon: "Plane" },
  { id: "ryanair", label: "Ryanair", icon: "Plane" },
  { id: "singapore", label: "Singapore Airlines", icon: "Plane" },
  { id: "airfrance", label: "Air France-KLM", icon: "Plane" },
  { id: "british", label: "British Airways", icon: "Plane" },
];

// ============================================================================
// 3. APP SETTINGS (tone / format / strictness)
// ============================================================================

export interface AppSettings {
  tone: "Formal" | "Balanced" | "Warm" | "Premium" | "Aggressive";
  format: "Chronological" | "Functional" | "Hybrid" | "Combination";
  strictness: "Conservative" | "Balanced" | "Aggressive";
}

export const DEFAULT_APP_SETTINGS: AppSettings = {
  tone: "Balanced",
  format: "Chronological",
  strictness: "Balanced",
};

// ============================================================================
// 4. analyzeWithGemini — aviation-aware ATS optimization
// ============================================================================

export interface AviationAtsResult {
  score: number;
  score_breakdown: { impact: number; brevity: number; keywords: number };
  summary_critique: string;
  missing_keywords: string[];
  matched_keywords: string[];
  optimized_content: string; // HTML
}

/**
 * Aviation-aware ATS optimization. Uses the directive prompt with airline-specific
 * ATS profile, aviation keyword bank, tone/format/strictness settings, and strict
 * 2,800-character / one-A4-page enforcement.
 *
 * Routes through callAI() (Puter → server → local) for full failover.
 */
export async function analyzeWithGemini(
  resumeText: string,
  jobDescription: string,
  settings: AppSettings,
  airlineProfile: string
): Promise<AviationAtsResult> {
  try {
    const toneInstruction = settings?.tone || "Balanced";
    const formatInstruction = settings?.format || "Chronological";
    const strictnessInstruction = settings?.strictness === "Aggressive"
      ? "MAXIMUM keyword stuffing."
      : "Balanced optimization.";
    const atsSystem = airlineProfile ? (AIRLINE_ATS_PROFILES[airlineProfile]?.system || "Generic ATS") : "Generic ATS";
    const atsFocus = airlineProfile ? (AIRLINE_ATS_PROFILES[airlineProfile]?.focus || "General") : "General";

    const prompt = `
      ACT AS: Expert Recruiter, Senior ATS Consultant, and Master Resume Strategist.

      OBJECTIVE: Deeply analyze the resume and job description, then produce a highly optimized recruiter-grade resume that maximizes ATS compatibility while remaining 100% factual.

      ═══════════════════════════════════════════════════════════
      MULTI-STAGE REASONING PIPELINE (THINK BEFORE WRITING)
      ═══════════════════════════════════════════════════════════

      Stage 1 — RESUME UNDERSTANDING:
      Extract from the resume: experience, achievements, technologies, competencies, certifications, transferable skills, leadership indicators, quantified metrics.
      Identify what the candidate is ACTUALLY good at (not what they claim — what their achievements prove).

      Stage 2 — JOB DESCRIPTION UNDERSTANDING:
      Deeply analyze: responsibilities, required skills, preferred skills, hidden expectations, seniority indicators, industry terminology, business goals, soft skills, action verbs, repeated phrases.
      Extract: high-value phrases, hiring signals, recruiter intent, critical requirements, implied requirements.
      Identify what the recruiter ACTUALLY cares about (read between the lines).

      Stage 3 — INDUSTRY UNDERSTANDING:
      Industry: ${INDUSTRY_PROFILES[airlineProfile]?.label || "Generic"}
      Determine: ATS conventions, resume conventions, recruiter expectations for this industry.

      Stage 4 — SEMANTIC MAPPING:
      Map: Resume Experience → Job Responsibilities. Resume Skills → Job Requirements. Resume Achievements → Business Objectives.
      Identify: gaps, strengths, opportunities, transferable skills.

      Stage 5 — OPTIMIZATION STRATEGY:
      Decide: which keywords to use, which phrases to use, which sections to prioritize, what to condense, what to expand, what should appear earlier, what should be emphasized.

      ═══════════════════════════════════════════════════════════
      HIGH-VALUE LANGUAGE OPTIMIZATION
      ═══════════════════════════════════════════════════════════

      Use recruiter-grade wording. Transform weak phrases into high-impact statements:
      - "Responsible for customer service" → "Delivered exceptional customer service resulting in measurable satisfaction improvements"
      - "Worked on software" → "Designed and implemented scalable software solutions supporting mission-critical applications"
      - "Helped with projects" → "Led cross-functional initiatives that improved operational efficiency and business outcomes"

      Extract and reuse high-value phrases from the job description naturally:
      - "cross-functional collaboration", "stakeholder management", "process optimization", "data-driven decision making"

      ═══════════════════════════════════════════════════════════
      KEYWORD STRATEGY (NO STUFFING)
      ═══════════════════════════════════════════════════════════

      1. Identify critical keywords (must-haves from JD).
      2. Identify secondary keywords (nice-to-haves).
      3. Identify semantic synonyms (use if natural keyword doesn't fit).
      4. Identify industry terminology (from the keyword bank below).
      5. Embed ALL keywords NATURALLY — never stuff. Each keyword must appear in context.

      ═══════════════════════════════════════════════════════════
      CONTEXT
      ═══════════════════════════════════════════════════════════
      ATS SYSTEM: ${atsSystem} (${atsFocus})
      INDUSTRY KEYWORDS: ${INDUSTRY_PROFILES[airlineProfile]?.keywordBank || AVIATION_KEYWORDS}
      INDUSTRY WRITING GUIDANCE: ${INDUSTRY_PROFILES[airlineProfile]?.writingGuidance || ""}
      TONE: ${toneInstruction}
      FORMAT: ${formatInstruction}
      STRICTNESS: ${strictnessInstruction}

      INPUT DATA:
      [RESUME]: ${resumeText}
      [JOB DESCRIPTION]: ${jobDescription}

      ═══════════════════════════════════════════════════════════
      CONTENT TARGET
      ═══════════════════════════════════════════════════════════
      Target: ~2,900 characters. Range: 2,700-3,100. One A4 page only.
      Each bullet: 110-180 chars. Summary: 4-6 lines (~60-90 words).
      Use 5-7 detailed bullets for the 2 most recent roles. 3 bullets for older roles.

      ═══════════════════════════════════════════════════════════
      FACTUAL INTEGRITY (NON-NEGOTIABLE)
      ═══════════════════════════════════════════════════════════
      NEVER fabricate: experience, employers, dates, metrics, certifications, skills.
      ONLY use information from the original resume.
      Rephrase, expand, and optimize — but never invent.

      RETURN JSON FORMAT ONLY:
      {
        "score": number,
        "score_breakdown": { "impact": number, "brevity": number, "keywords": number },
        "summary_critique": "Brief explanation of what was optimized and why (shown in analysis panel, NOT in resume)",
        "missing_keywords": ["string"],
        "matched_keywords": ["string"],
        "optimized_content": "Valid HTML string"
      }
    `;

    const result = await callAI({
      systemPrompt: `You are an Expert Recruiter, Senior ATS Consultant, and Master Resume Strategist. You deeply analyze resumes and job descriptions before rewriting. You use recruiter-grade language, industry terminology, and high-impact phrases. You NEVER fabricate information. Industry: ${INDUSTRY_PROFILES[airlineProfile]?.label || "Generic"}. Always return ONLY valid JSON — no markdown fences, no prose.`,
      userPrompt: prompt,
      maxTokens: 4000,
      temperature: 0.4,
    });

    // Robustly extract JSON — handles markdown fences, leading prose, trailing commentary.
    // Falls back to a default-scored result on parse failure instead of crashing the UI.
    let data: AviationAtsResult;
    try {
      data = extractJSON<AviationAtsResult>(result.text);
    } catch (parseErr: any) {
      console.warn("[analyzeWithGemini] JSON extraction failed, using fallback result:", parseErr?.message);
      // CRITICAL: summary_critique is an ANALYSIS field shown in the UI's analysis panel,
      // NOT in the resume. But we still must not leak provider errors here.
      data = {
        score: 0,
        score_breakdown: { impact: 0, brevity: 0, keywords: 0 },
        summary_critique: "Analysis could not be completed. Please try again with a different AI provider.",
        missing_keywords: [],
        matched_keywords: [],
        optimized_content: "",
      } as AviationAtsResult;
    }

    // Normalize markdown bold → <strong>
    if (data.optimized_content) {
      data.optimized_content = data.optimized_content.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
    }
    if (!data.score_breakdown) {
      data.score_breakdown = { impact: 85, brevity: 90, keywords: data.score };
    }
    return data;
  } catch (error: any) {
    console.error("[analyzeWithGemini] AI Error:", error);
    throw new Error(error.message || "Optimization failed. Please check the text and try again.");
  }
}

// ============================================================================
// 4b. UNIFIED AVIATION OPTIMIZER DIRECTIVE
// ============================================================================
//
// This is the production path for Aviation ATS Mode. Unlike analyzeWithGemini()
// (which returns HTML only), this generator produces a directive that asks the
// AI for the SAME structured JSON shape as the standard OPTIMIZER_DIRECTIVE,
// so the Optimizer.tsx mapping pipeline can build a proper ResumeData object
// (fixing the "short content" bug where aviation mode just kept the original
// resume content unchanged).
//
// It also HONORS the super-admin's Optimizer Directive settings:
//   - If customDirectiveOverride is set → that becomes the BASE of the directive
//     (the aviation keyword bank + airline profile are appended).
//   - Otherwise → the generated directive from the structured config fields is used
//     as the base, again with aviation context appended.
// This ensures aviation mode is SYNCHRONIZED with the optimizer directive page.

export interface AviationOptimizeResult {
  // Structured resume JSON — same shape as OPTIMIZER_DIRECTIVE output
  resume: {
    name: string;
    headline: string;
    location: string;
    phone: string;
    email: string;
    dateOfBirth: string;
    summary: string;
    skills: Array<{ category: string; items: string[] }>;
    experience: Array<{
      title: string;
      company: string;
      location: string;
      startDate: string;
      endDate: string;
      bullets: string[];
    }>;
    education: Array<{
      degree: string;
      institution: string;
      location: string;
      startDate: string;
      endDate: string;
      modules: string;
    }>;
    languages: Array<{ name: string; proficiency: string; note: string }>;
    missingKeywordsAdded: string[];
    bulletsRewritten: number;
  };
  // ATS scoring metadata (kept for backward compat with the old analyzeWithGemini UI panel)
  score: number;
  score_breakdown: { impact: number; brevity: number; keywords: number };
  matched_keywords: string[];
  missing_keywords: string[];
  summary_critique: string;
  // The actual character count of the generated resume content (for the UI badge)
  charCount: number;
}

/**
 * Build the unified aviation directive. Merges:
 *   1. Super-admin's optimizer directive config (from store, with custom override support)
 *   2. Aviation keyword bank (cabin crew + broad aviation)
 *   3. Airline-specific ATS profile (Emirates/Qatar/Etihad/…)
 *   4. Tone / format / strictness settings
 *
 * The directive asks the AI for the SAME JSON shape as OPTIMIZER_DIRECTIVE so the
 * Optimizer's existing JSON → ResumeData mapping works without changes.
 */
export function getAviationOptimizerDirective(
  airlineProfile: string,
  settings: AppSettings
): string {
  // --- 1. Read super-admin's optimizer config from store ---
  let baseConfig: OptimizerDirectiveConfig | undefined;
  try {
    const state: any = useApp.getState();
    baseConfig = state?.optimizerDirective;
  } catch {
    baseConfig = undefined;
  }

  const profile = AIRLINE_ATS_PROFILES[airlineProfile] || AIRLINE_ATS_PROFILES.generic;
  const toneInstruction = settings?.tone || "Balanced";
  const formatInstruction = settings?.format || "Chronological";
  const strictnessInstruction =
    settings?.strictness === "Aggressive"
      ? "MAXIMUM keyword density — embed every priority keyword naturally."
      : settings?.strictness === "Conservative"
        ? "Conservative — embed only the most relevant priority keywords."
        : "Balanced — embed priority keywords naturally without stuffing.";

  // --- 2. If the super-admin has set a customDirectiveOverride, use it as the BASE ---
  // This is the synchronization point: aviation mode respects the override.
  const customOverride = baseConfig?.customDirectiveOverride?.trim();
  const baseDirective = customOverride
    ? customOverride
    : getOptimizerDirective(); // generates from structured config OR falls back to hardcoded

  // --- 3. Build the industry augmentation layer ---
  const industryProfile = INDUSTRY_PROFILES[airlineProfile];
  const aviationAugmentation = `
═══════════════════════════════════════════════════════════════
INDUSTRY ATS MODE — ACTIVE
═══════════════════════════════════════════════════════════════
OPTIMIZATION PROFILE: ${industryProfile?.label || profile.system}
INDUSTRY: ${industryProfile?.description || profile.focus}
${industryProfile?.priorityKeywords?.length ? `INDUSTRY PRIORITY KEYWORDS: ${industryProfile.priorityKeywords.join(", ")}` : `AIRLINE PRIORITY KEYWORDS: ${profile.priorityKeywords?.join(", ") || "(none)"}`}
INDUSTRY TONE PREFERENCE: ${industryProfile?.tone || profile.tone || "Balanced"}

USER-SELECTED TONE: ${toneInstruction}
USER-SELECTED FORMAT: ${formatInstruction}
USER-SELECTED STRICTNESS: ${strictnessInstruction}

═══════════════════════════════════════════════════════════════
MULTI-STAGE REASONING PIPELINE (THINK BEFORE WRITING)
═══════════════════════════════════════════════════════════════

Stage 1 — RESUME UNDERSTANDING:
Extract: experience, achievements, technologies, competencies, certifications, transferable skills, leadership indicators, quantified metrics.
Identify what the candidate is ACTUALLY good at (not what they claim — what their achievements prove).

Stage 2 — JOB DESCRIPTION UNDERSTANDING:
Deeply analyze: responsibilities, required skills, preferred skills, hidden expectations, seniority indicators, industry terminology, business goals, soft skills, action verbs, repeated phrases.
Extract: high-value phrases, hiring signals, recruiter intent, critical requirements, implied requirements.

Stage 3 — SEMANTIC MAPPING:
Map: Resume Experience → Job Responsibilities. Resume Skills → Job Requirements. Resume Achievements → Business Objectives.
Identify: gaps, strengths, opportunities, transferable skills.

Stage 4 — OPTIMIZATION STRATEGY:
Decide: which keywords to use, which phrases to use, which sections to prioritize, what to condense, what to expand, what should appear earlier, what should be emphasized.

═══════════════════════════════════════════════════════════════
HIGH-VALUE LANGUAGE OPTIMIZATION
═══════════════════════════════════════════════════════════════
Transform weak phrases into high-impact statements:
- "Responsible for customer service" → "Delivered exceptional customer service resulting in measurable satisfaction improvements"
- "Worked on software" → "Designed and implemented scalable software solutions supporting mission-critical applications"
- "Helped with projects" → "Led cross-functional initiatives that improved operational efficiency and business outcomes"

Extract and reuse high-value phrases from the JD naturally: "cross-functional collaboration", "stakeholder management", "process optimization", "data-driven decision making".

═══════════════════════════════════════════════════════════════
KEYWORD STRATEGY (NO STUFFING)
═══════════════════════════════════════════════════════════════
1. Identify critical keywords (must-haves from JD).
2. Identify secondary keywords (nice-to-haves).
3. Identify semantic synonyms.
4. Identify industry terminology (from the keyword bank below).
5. Embed ALL keywords NATURALLY — never stuff. Each keyword must appear in context.

═══════════════════════════════════════════════════════════════
INDUSTRY KEYWORD BANK (weave relevant keywords naturally into summary, skills, and bullets)
═══════════════════════════════════════════════════════════════
${INDUSTRY_PROFILES[airlineProfile]?.keywordBank || `${CABIN_CREW_KEYWORDS}\n${AVIATION_KEYWORDS}`}

INDUSTRY WRITING GUIDANCE:
${INDUSTRY_PROFILES[airlineProfile]?.writingGuidance || ""}

═══════════════════════════════════════════════════════════════
CONTENT TARGET — STRICT ENFORCEMENT (NON-NEGOTIABLE)
═══════════════════════════════════════════════════════════════
Target character count: ~2,900 characters of resume body content (excluding JSON keys/structure).
Acceptable range: 2,700 – 3,100 characters.
- 2,100 chars = TOO SHORT — expand bullets, add measurable achievements, deepen technical context.
- 3,200+ chars = TOO LONG — condense older roles, tighten bullets, merge similar skills.
HOW TO HIT THE TARGET INTELLIGENTLY:
1. PROFESSIONAL SUMMARY: 4-6 lines (~60-90 words). Embed 2-3 priority keywords naturally.
2. EXPERIENCE: For the 2 most recent roles, write 5-7 detailed bullets each. Older roles can have 3 bullets.
3. Each bullet must START with a strong action verb and QUANTIFY where possible (%, $, counts, time saved, team size, customer volume).
4. Each bullet should be 110-180 characters — long enough to wrap onto 2 lines (for justified text).
5. EXPAND weak bullets — never leave "Responsible for X". Rewrite as "Led X to achieve Y, resulting in Z% improvement".
6. SKILLS: Group into 3-4 categories with 4-6 items each. Embed priority keywords as skill items where natural.
7. Never produce a half-empty page — fully utilize the A4 layout.

═══════════════════════════════════════════════════════════════
FACTUAL INTEGRITY (NON-NEGOTIABLE)
═══════════════════════════════════════════════════════════════
NEVER fabricate: experience, employers, dates, metrics, certifications, skills.
ONLY use information from the original resume.
Rephrase, expand, and optimize — but never invent.

═══════════════════════════════════════════════════════════════
AIRLINE-SPECIFIC WRITING GUIDANCE
═══════════════════════════════════════════════════════════════
${airlineSpecificWritingGuidance(airlineProfile)}

═══════════════════════════════════════════════════════════════
DIRECTIVE HIERARCHY (MUST FOLLOW THIS ORDER)
═══════════════════════════════════════════════════════════════
1. SUPER-ADMIN OPTIMIZER DIRECTIVE (the base directive above — including any custom override)
2. AIRLINE ATS PROFILE (priority keywords, tone preference, system-specific requirements)
3. JOB DESCRIPTION REQUIREMENTS (required skills, responsibilities, keywords)
4. ORIGINAL RESUME CONTENT (preserve factual information — never invent employers, dates, or metrics)
5. AVIATION KEYWORD BANK (use relevant terms only — never stuff)

If the super-admin's override directive conflicts with aviation defaults, THE OVERRIDE WINS.
If the airline priority keywords conflict with the JD, PRIORITIZE THE JD's required skills.

═══════════════════════════════════════════════════════════════
OUTPUT FORMAT — STRICT JSON
═══════════════════════════════════════════════════════════════
Return ONLY valid JSON with this exact shape (no markdown fences, no prose, no HTML):
{
  "resume": {
    "name": "FULL NAME",
    "headline": "Target Role Title (e.g. Cabin Crew — Emirates Group)",
    "location": "City, Country",
    "phone": "+X ...",
    "email": "...",
    "dateOfBirth": "DD/MM/YYYY" | "",
    "summary": "4-6 line professional summary paragraph (~60-90 words) with 2-3 priority keywords embedded naturally...",
    "skills": [
      { "category": "Cabin Safety & Emergency Procedures", "items": ["SEP", "Emergency Evacuation", "First Aid", "CPR/AED"] },
      { "category": "Customer Service Excellence", "items": ["Premium Service", "Conflict Resolution", "Cultural Awareness"] },
      { "category": "Aviation Operations", "items": ["CRM", "Galley Management", "Turnaround Operations"] },
      { "category": "Languages", "items": ["English (Fluent)", "Arabic (Conversational)"] }
    ],
    "experience": [
      {
        "title": "Job Title",
        "company": "Company",
        "location": "City, Country",
        "startDate": "Mon YYYY",
        "endDate": "Mon YYYY" | "Present",
        "bullets": [
          "Strong action verb + measurable achievement + relevant priority keyword...",
          "..."
        ]
      }
    ],
    "education": [
      {
        "degree": "Degree Name",
        "institution": "Institution",
        "location": "City, Country" | "",
        "startDate": "YYYY",
        "endDate": "YYYY",
        "modules": "Module 1, Module 2, ..." | ""
      }
    ],
    "languages": [
      { "name": "English", "proficiency": "Fluent", "note": "ICAO Level 5" },
      { "name": "Arabic", "proficiency": "Conversational", "note": "" }
    ],
    "missingKeywordsAdded": ["keyword1", "keyword2", ...],
    "bulletsRewritten": 7
  },
  "score": 92,
  "score_breakdown": { "impact": 90, "brevity": 95, "keywords": 92 },
  "matched_keywords": ["Multicultural", "Premium Service", ...],
  "missing_keywords": ["...", "..."],
  "summary_critique": "Brief internal critique (NOT shown in the resume — analysis only). Max 2 sentences."
}

CRITICAL RULES:
- The "resume" object MUST be a complete, professionally written resume — NOT an analysis report.
- "summary" must be a professional paragraph ABOUT the candidate, never a critique like "The original resume lacks...".
- "summary_critique" is a separate analysis field — it must NEVER appear in the resume output.
- Every bullet must quantify impact where possible (%, $, counts, time saved, team size, customer volume).
- NEVER include provider errors, JSON parse errors, debug messages, or system text in the resume content.
- NEVER include analysis artifacts ("ATS score", "Matched keywords", "AI Notes", "Optimization applied").
- The output character count of "resume" (serialized) MUST be ~2,900 chars (±200).
- ALL priority keywords from the airline profile MUST appear naturally in the resume content.
`;

  // If using custom override, mark it clearly so the user sees it in logs
  if (customOverride) {
    return `${baseDirective}

${aviationAugmentation}

═══════════════════════════════════════════════════════════════
NOTE: Super-admin's CUSTOM DIRECTIVE OVERRIDE is active. The above aviation
augmentation is appended to the override. The override takes priority on conflicts.
═══════════════════════════════════════════════════════════════`;
  }

  return `${baseDirective}

${aviationAugmentation}`;
}

/**
 * Per-airline writing guidance — tells the AI how to frame the content for each carrier's
 * specific ATS and culture. This goes beyond just keywords — it shapes tone and emphasis.
 */
function airlineSpecificWritingGuidance(airline: string): string {
  const guide: Record<string, string> = {
    emirates: `Emirates (Workday ATS):
- Emphasize MULTICULTURAL exposure — Dubai-based global operations, 160+ nationalities served daily.
- Premium cabin experience is critical — mention luxury service, fine dining, first-class standards.
- "Diversity" and "Global Mindset" must appear naturally in summary AND skills.
- Highlight any Arabic language ability or willingness to learn.
- Tone: Premium, confident, world-class. Avoid casual language.`,
    qatar: `Qatar Airways (SuccessFactors ATS):
- Emphasize FIVE-STAR service — award-winning standards, Skytrax ratings.
- Fast-paced hub operations — Doha connectivity, rapid turnarounds.
- "Service Excellence" and "Award-Winning" should appear in summary or first bullets.
- Mention willingness to relocate to Doha if not already there.
- Tone: Formal, disciplined, premium.`,
    etihad: `Etihad Aviation Group (Taleo ATS):
- Abu Dhabi flagship carrier — "Choose Well" brand ethos.
- Innovation focus — cabin crew inflight innovation, new product launches.
- "Innovation" and "Service Excellence" priority keywords.
- Tone: Balanced, modern, aspirational.`,
    lufthansa: `Lufthansa Group (SAP SuccessFactors):
- German engineering precision — punctuality, reliability, safety-first.
- Star Alliance integration — mention multi-airline cooperation if relevant.
- "Precision", "Safety-First", "Reliability" priority keywords.
- Tone: Formal, precise, structured. No casual language.`,
    ryanair: `Ryanair Careers ATS:
- Low-cost carrier efficiency — fast turnarounds, high-volume operations.
- "Efficiency", "Punctuality", "On-Time Performance" priority keywords.
- Sales ability matters — duty-free, ancillary revenue, on-board sales.
- Tone: Balanced, direct, efficiency-focused.`,
    singapore: `Singapore Airlines (Workday ATS):
- "Singapore Girl" service standard — Asian hospitality, refinement, grace.
- Ultra-long-haul operations — endurance, time-zone management.
- "Asian Hospitality", "Refinement", "Service Excellence" priority keywords.
- Tone: Premium, gracious, attentive to detail.`,
    airfrance: `Air France-KLM ATS:
- French service elegance — bilingual capability is a plus.
- Dual-hub (CDG/AMS) — SkyTeam integration.
- "Elegance", "Bilingual", "Hospitality" priority keywords.
- Tone: Premium, elegant, warm.`,
    british: `British Airways (Workday ATS):
- British heritage service — traditional standards of excellence.
- London hub (LHR/LGW) — oneworld alliance integration.
- "Heritage", "Premium", "Service Excellence" priority keywords.
- Tone: Formal, professional, classic British polish.`,
    generic: `Generic ATS (Workday / SuccessFactors / Taleo compatible):
- Use general aviation keywords relevant to the role.
- Standard cabin crew competency framework.
- Tone: Balanced, professional.`,
  };
  return guide[airline] || guide.generic;
}

/**
 * Run the unified aviation optimization. Calls the AI with the unified directive
 * (which merges super-admin config + aviation keywords + airline profile) and
 * returns the structured JSON result.
 *
 * Unlike analyzeWithGemini() (which returns HTML only), this returns a proper
 * structured "resume" object that the Optimizer can map directly to ResumeData.
 */
export async function aviationOptimize(
  resume: ResumeData,
  jobDescription: string,
  airlineProfile: string,
  settings: AppSettings
): Promise<AviationOptimizeResult> {
  const directive = getAviationOptimizerDirective(airlineProfile, settings);
  const profile = AIRLINE_ATS_PROFILES[airlineProfile] || AIRLINE_ATS_PROFILES.generic;

  const userPrompt = `SOURCE RESUME (be truthful to this — never invent employers, dates, or metrics):
${JSON.stringify({
  name: resume.name,
  headline: resume.headline,
  contact: resume.contact,
  dateOfBirth: resume.dateOfBirth,
  summary: resume.summary,
  experience: resume.experience.map((e) => ({
    title: e.title,
    company: e.company,
    location: e.location,
    startDate: e.startDate,
    endDate: e.endDate,
    bullets: e.bullets,
  })),
  education: resume.education.map((ed) => ({
    degree: ed.degree,
    field: ed.field,
    institution: ed.institution,
    location: ed.location,
    startDate: ed.startDate,
    endDate: ed.endDate,
    highlights: ed.highlights,
  })),
  skills: resume.skills.map((s) => ({ name: s.name, category: s.category })),
  languages: resume.languages,
  certifications: resume.certifications,
})}

TARGET JOB DESCRIPTION:
${jobDescription}

TARGET AIRLINE: ${profile.system} (${profile.focus})
PRIORITY KEYWORDS TO EMBED NATURALLY: ${profile.priorityKeywords?.join(", ") || "(use general aviation keywords)"}

INSTRUCTIONS:
1. Rewrite the resume to FULLY UTILIZE one A4 page (~2,900 characters of body content).
2. Embed the airline's priority keywords naturally throughout summary, skills, and bullets.
3. Expand weak bullets — quantify achievements with %, $, counts, time saved, team size, customer volume.
4. For the 2 most recent roles: 5-7 detailed bullets each. Older roles: 3 bullets.
5. Group skills into 3-4 categories with 4-6 items each.
6. Match the tone preference (${profile.tone || "Balanced"}) of the target airline.
7. NEVER invent employers, dates, or metrics — only rephrase and expand real content.

Return ONLY the JSON object described in the directive. No prose, no markdown fences.`;

  const result = await callAI({
    systemPrompt: directive,
    userPrompt,
    maxTokens: 5000,
    temperature: 0.45,
    taskCategory: "document",
  });

  // Parse JSON — robustly handle markdown fences, prose preambles, trailing commentary
  let data: AviationOptimizeResult;
  try {
    data = extractJSON<AviationOptimizeResult>(result.text);
  } catch (parseErr: any) {
    // Log only in development — never expose provider name or raw response to users
    if (process.env.NODE_ENV !== "production") {
      console.warn("[aviationOptimize] JSON extraction failed:", parseErr?.message);
    }
    throw new Error("Optimization failed — the AI returned an unexpected response. Please try again.");
  }

  // Validate the resume object exists
  if (!data.resume || typeof data.resume !== "object") {
    throw new Error("Optimization failed — the AI response was incomplete. Please try again.");
  }

  // Validate minimal content
  if (!data.resume.summary || data.resume.summary.length < 50) {
    console.warn("[aviationOptimize] Summary is too short or missing — AI may have returned an analysis instead of a resume.");
  }

  // Compute character count of the serialized resume content (for the UI badge)
  const charCount = JSON.stringify(data.resume).length;
  data.charCount = charCount;

  // Normalize score breakdown
  if (!data.score_breakdown) {
    data.score_breakdown = { impact: 85, brevity: 90, keywords: data.score || 85 };
  }
  if (typeof data.score !== "number") {
    data.score = Math.round(
      (data.score_breakdown.impact + data.score_breakdown.brevity + data.score_breakdown.keywords) / 3
    );
  }
  if (!Array.isArray(data.matched_keywords)) data.matched_keywords = [];
  if (!Array.isArray(data.missing_keywords)) data.missing_keywords = [];
  if (typeof data.summary_critique !== "string") data.summary_critique = "";

  return data;
}

/**
 * Convert a ResumeData object into the plain-text input that analyzeWithGemini expects.
 */
export function resumeToPlainText(r: ResumeData): string {
  const parts: string[] = [];
  parts.push(r.name || "");
  if (r.headline) parts.push(r.headline);
  const contact = [r.contact.email, r.contact.phone, r.contact.location, r.contact.linkedin, r.contact.github, r.contact.website].filter(Boolean).join(" | ");
  if (contact) parts.push(contact);
  if (r.dateOfBirth) parts.push(`Date of Birth: ${r.dateOfBirth}`);
  if (r.summary) parts.push(`\nPROFESSIONAL SUMMARY\n${r.summary}`);
  if (r.experience.length) {
    parts.push("\nEXPERIENCE");
    for (const e of r.experience) {
      parts.push(`${e.title} | ${e.company}${e.location ? ", " + e.location : ""} | ${e.startDate} to ${e.endDate}`);
      for (const b of e.bullets) parts.push(`- ${b}`);
    }
  }
  if (r.education.length) {
    parts.push("\nEDUCATION");
    for (const ed of r.education) {
      parts.push(`${ed.degree}${ed.field ? " in " + ed.field : ""} | ${ed.institution} | ${ed.startDate} to ${ed.endDate}`);
      if (ed.highlights?.length) for (const h of ed.highlights) parts.push(`- ${h}`);
    }
  }
  if (r.skills.length) parts.push("\nSKILLS\n" + r.skills.map((s) => s.name).join(", "));
  if (r.languages.length) parts.push("\nLANGUAGES\n" + r.languages.map((l) => `${l.name}: ${l.proficiency}`).join("\n"));
  if (r.certifications.length) parts.push("\nCERTIFICATIONS\n" + r.certifications.map((c) => `${c.name}${c.issuer ? " - " + c.issuer : ""}`).join("\n"));
  return parts.join("\n");
}

// ============================================================================
// 5. getDocxHtml — strict A4 one-page HTML wrapper for Word export
// ============================================================================

/**
 * Wraps resume HTML content in a strict A4 one-page Word-compatible HTML document.
 * The @page rules force A4 (21cm × 29.7cm) with 1.27cm margins in Word.
 * Saves as .doc (Word 97-2003) which Word opens natively with the CSS preserved.
 */
export function getDocxHtml(content: string, template: "professional" | "modern" | "minimal" = "professional"): string {
  let fontFamily = "'Times New Roman', serif";
  let headingColor = "#000000";
  let textColor = "#000000";

  if (template === "modern") {
    fontFamily = "'Helvetica Neue', Helvetica, Arial, sans-serif";
    headingColor = "#2c3e50";
    textColor = "#333333";
  } else if (template === "minimal") {
    fontFamily = "'Inter', 'Segoe UI', Roboto, sans-serif";
    headingColor = "#111827";
    textColor = "#4b5563";
  }

  return `
    <html xmlns:o='urn:schemas-microsoft-com:office:office' xmlns:w='urn:schemas-microsoft-com:office:word' xmlns='http://www.w3.org/TR/REC-html40'>
      <head>
        <meta charset='utf-8'>
        <title>Resume Export</title>
        <style>
          /* STRICT A4 PAGE LAYOUT */
          @page {
              size: 21cm 29.7cm;
              margin: 1.27cm 1.27cm 1.27cm 1.27cm;
              mso-page-orientation: portrait;
          }
          @page WordSection1 {
              size: 21cm 29.7cm;
              margin: 1.27cm 1.27cm 1.27cm 1.27cm;
          }
          div.WordSection1 {
              page: WordSection1;
          }
          /* Global Resets - PLAIN TEXT AESTHETIC */
          body {
            font-family: ${fontFamily};
            font-size: 12.0pt;
            line-height: 1.15;
            color: ${textColor};
            background: #ffffff;
            margin: 0;
            padding: 0;
          }
          /* Force Single Column Flow */
          div, p, ul, li, h1, h2, h3, h4 {
            display: block !important;
            width: 100% !important;
            float: none !important;
            clear: both !important;
          }
          /* Header: Name - LEFT ALIGNED */
          h1 {
            font-size: 16pt;
            font-weight: bold;
            text-align: left;
            text-transform: uppercase;
            color: ${headingColor};
            margin: 0 0 4pt 0;
            padding: 0;
          }
          /* Header: Contact - LEFT ALIGNED */
          p.contact {
            text-align: left;
            font-size: 12pt;
            margin: 0 0 12pt 0;
            color: ${textColor};
          }
          /* Section Headers - LEFT ALIGNED */
          h3 {
            font-size: 12pt;
            font-weight: bold;
            text-transform: uppercase;
            text-align: left;
            border: none !important;
            text-decoration: none !important;
            margin-top: 12pt;
            margin-bottom: 6pt;
            color: ${headingColor};
          }
          /* Job Titles */
          h4 {
            font-size: 12pt;
            margin-top: 6pt;
            margin-bottom: 2pt;
            color: ${headingColor};
            font-weight: bold;
          }
          /* Body Text */
          p {
            margin: 0;
            text-align: justify;
            margin-bottom: 4pt;
          }
          /* Bullets */
          ul {
            margin-top: 0;
            margin-bottom: 8pt;
            padding-left: 18pt;
          }
          li {
            margin-bottom: 2pt;
            padding-left: 0;
            text-align: justify; /* straight right edge on multi-line bullets */
          }
          /* Clean Bold */
          strong, b {
            color: ${headingColor};
            font-weight: bold;
          }
        </style>
      </head>
      <body>
        <div class="WordSection1">
          ${content}
        </div>
      </body>
    </html>
  `;
}

/**
 * Build the inner HTML body for a resume, following the directive's structure:
 *   <h1>NAME</h1>
 *   <p class="contact">contact info</p>
 *   <h3>PROFESSIONAL SUMMARY</h3><p>summary</p>
 *   <h3>EXPERIENCE</h3>
 *     <h4><strong>Title</strong> | <strong>Company</strong>, Location | <strong>YYYY to YYYY</strong></h4>
 *     <ul><li>bullet</li>...</ul>
 *   <h3>EDUCATION</h3>
 *     <h4><strong>Degree</strong> | <strong>School</strong> | <strong>YYYY to YYYY</strong></h4>
 *     <ul><li>modules</li></ul>
 *   <h3>SKILLS</h3><p>skill, skill, skill</p>
 */
export function resumeToDirectiveHtml(r: ResumeData): string {
  const fmtDate = (d?: string) => {
    if (!d) return "";
    if (/present/i.test(d)) return "Present";
    const m = d.match(/^(\d{4})-(\d{2})$/);
    if (m) return m[1]; // YYYY
    if (/^\d{4}$/.test(d)) return d;
    return d;
  };

  const parts: string[] = [];
  // Header
  parts.push(`<h1>${escapeHtml((r.name || "YOUR NAME").toUpperCase())}</h1>`);
  const contactBits = [r.contact.email, r.contact.phone, r.contact.location, r.contact.linkedin, r.contact.github, r.contact.website].filter((s): s is string => Boolean(s));
  if (contactBits.length) parts.push(`<p class="contact">${contactBits.map(escapeHtml).join(" | ")}</p>`);

  // Summary
  if (r.summary) {
    parts.push(`<h3>PROFESSIONAL SUMMARY</h3><p>${escapeHtml(r.summary)}</p>`);
  }

  // Experience
  if (r.experience.length) {
    parts.push(`<h3>EXPERIENCE</h3>`);
    for (const e of r.experience) {
      const dateStr = `${fmtDate(e.startDate)} to ${fmtDate(e.endDate)}`;
      parts.push(`<h4><strong>${escapeHtml(e.title)}</strong> | <strong>${escapeHtml(e.company)}</strong>${e.location ? ", " + escapeHtml(e.location) : ""} | <strong>${escapeHtml(dateStr)}</strong></h4>`);
      if (e.bullets.length) {
        parts.push(`<ul>${e.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>`);
      }
    }
  }

  // Education
  if (r.education.length) {
    parts.push(`<h3>EDUCATION</h3>`);
    for (const ed of r.education) {
      const dateStr = `${fmtDate(ed.startDate)} to ${fmtDate(ed.endDate)}`;
      parts.push(`<h4><strong>${escapeHtml(ed.degree)}${ed.field ? " in " + escapeHtml(ed.field) : ""}</strong> | <strong>${escapeHtml(ed.institution)}</strong> | <strong>${escapeHtml(dateStr)}</strong></h4>`);
      if (ed.highlights?.length) {
        parts.push(`<ul>${ed.highlights.map((h) => `<li>${escapeHtml(h)}</li>`).join("")}</ul>`);
      }
    }
  }

  // Skills
  if (r.skills.length) {
    parts.push(`<h3>SKILLS</h3><p>${r.skills.map((s) => `<strong>${escapeHtml(s.name)}</strong>${s.category ? ` (${escapeHtml(s.category)})` : ""}`).join(", ")}</p>`);
  }

  // Languages
  if (r.languages.length) {
    parts.push(`<h3>LANGUAGES</h3><p>${r.languages.map((l) => `<strong>${escapeHtml(l.name)}</strong>: ${escapeHtml(l.proficiency)}`).join(", ")}</p>`);
  }

  // Certifications
  if (r.certifications.length) {
    parts.push(`<h3>CERTIFICATIONS</h3><ul>${r.certifications.map((c) => `<li><strong>${escapeHtml(c.name)}</strong>${c.issuer ? " - " + escapeHtml(c.issuer) : ""}${c.date ? ` (${escapeHtml(fmtDate(c.date))})` : ""}</li>`).join("")}</ul>`);
  }

  return parts.join("\n");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
