// ============================================================================
// Evidence-Provenance Layer — anti-hallucination scan for optimized resumes.
//
// PROBLEM:
// The optimizer can produce claims like "POS operations", "visual merchandising",
// "inventory management" that aren't in the source resume. These are fabricated
// from the JD's required skills, not from the candidate's actual experience.
//
// SOLUTION:
// After the AI returns the optimized resume, scan every claim against the
// source resume text. Tag each claim with a provenance class:
//
//   DIRECT       → exact match in source resume (safe)
//   TRANSFERABLE → inferred from source experience (safe, labeled)
//   JD_SIGNAL    → keyword from JD, positioned as target (safe, labeled)
//   UNSUPPORTED  → no source evidence (REJECT — rewrite that bullet)
//
// If any UNSUPPORTED claims are found, the offending bullets are rewritten
// to use transferable positioning instead of asserting fabricated expertise.
// ============================================================================

import type { ResumeData, JobDescription } from "../types";

export type ProvenanceClass = "DIRECT" | "TRANSFERABLE" | "JD_SIGNAL" | "UNSUPPORTED";

export interface ProvenanceResult {
  /** Per-bullet provenance analysis */
  bullets: Array<{
    experienceIndex: number;
    bulletIndex: number;
    text: string;
    claims: Array<{
      claim: string;
      provenance: ProvenanceClass;
      evidence: string;
    }>;
    hasUnsupported: boolean;
  }>;
  /** Summary claims (from the professional summary) */
  summaryClaims: Array<{
    claim: string;
    provenance: ProvenanceClass;
    evidence: string;
  }>;
  /** Whether any unsupported claims were found */
  hasUnsupportedClaims: boolean;
  /** Whether any fixes were applied */
  fixesApplied: number;
  /** The cleaned resume (with unsupported claims removed/rewritten) */
  cleanedResume: ResumeData;
}

/**
 * Extract all "claims" from a bullet point. A claim is a skill/competency
 * mentioned in the bullet text. We look for noun phrases and skill keywords.
 */
function extractClaims(bulletText: string): string[] {
  const claims: string[] = [];
  const lower = bulletText.toLowerCase();

  // Common skill/competency patterns
  const patterns = [
    // "expert in X", "experienced in X", "proficient in X"
    /(?:expert|experienced|proficient|skilled)\s+(?:in|with)\s+([a-z][a-z\s,]+?)(?:[.,;]|\band\b|$)/g,
    // "Led X initiatives", "Managed X operations"
    /(?:led|managed|delivered|built|developed|implemented|drove|spearheaded|executed)\s+([a-z][a-z\s,]+?)(?:[.,;]|\b(?:for|at|in|to|by)\b|$)/g,
    // Standalone skill names (camelCase or known terms)
    /\b(POS|CRM|ERP|SAP|SQL|Python|Java|React|Node\.js|Kubernetes|Docker|AWS|Azure|GCP|Salesforce|HubSpot|Jira|Agile|Scrum|Kanban|Lean|Six Sigma|PMP|ITIL|DevOps|CI\/CD)\b/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(lower)) !== null) {
      const claim = match[1]?.trim() || match[0]?.trim();
      if (claim && claim.length > 2 && claim.length < 50) {
        claims.push(claim);
      }
    }
  }

  return claims;
}

/**
 * Check if a claim has direct evidence in the source resume text.
 */
function classifyClaim(
  claim: string,
  sourceResumeText: string,
  jdText: string,
): { provenance: ProvenanceClass; evidence: string } {
  const claimLower = claim.toLowerCase().trim();
  const sourceLower = sourceResumeText.toLowerCase();

  // Check DIRECT: exact match or close match in source resume
  if (sourceLower.includes(claimLower)) {
    return { provenance: "DIRECT", evidence: `Found "${claim}" in source resume` };
  }

  // Check for partial matches (substring either way)
  const sourceWords = sourceLower.split(/\s+/);
  const claimWords = claimLower.split(/\s+/);
  const allClaimWordsInSource = claimWords.every((w) => w.length > 2 && sourceLower.includes(w));
  if (allClaimWordsInSource) {
    return { provenance: "DIRECT", evidence: `All words of "${claim}" found in source resume` };
  }

  // Check TRANSFERABLE: related terms in source resume
  const transferableMap: Record<string, string[]> = {
    "pos operations": ["cash register", "point of sale", "checkout", "transaction", "payment processing", "cash handling"],
    "visual merchandising": ["merchandising", "display", "store layout", "product placement", "retail"],
    "inventory management": ["inventory", "stock", "warehouse", "supply chain", "logistics"],
    "cash handling": ["cash", "register", "payment", "transaction", "till"],
    "customer service": ["customer", "client", "passenger", "guest", "service", "support"],
    "sales": ["selling", "revenue", "upsell", "cross-sell", "target"],
    "leadership": ["lead", "manage", "supervise", "direct", "mentor", "train"],
  };

  const transferableKey = Object.keys(transferableMap).find(
    (k) => claimLower.includes(k) || k.includes(claimLower),
  );
  if (transferableKey) {
    const relatedTerms = transferableMap[transferableKey];
    const foundTerm = relatedTerms.find((t) => sourceLower.includes(t));
    if (foundTerm) {
      return {
        provenance: "TRANSFERABLE",
        evidence: `Source resume has "${foundTerm}" which is transferable to "${claim}"`,
      };
    }
  }

  // Check JD_SIGNAL: the claim appears in the JD (it's a requirement, not experience)
  if (jdText.toLowerCase().includes(claimLower)) {
    return {
      provenance: "JD_SIGNAL",
      evidence: `"${claim}" appears in the job description as a requirement`,
    };
  }

  // UNSUPPORTED: no evidence anywhere
  return {
    provenance: "UNSUPPORTED",
    evidence: `No evidence for "${claim}" in source resume or JD`,
  };
}

/**
 * Rewrite a bullet to replace unsupported claims with transferable positioning.
 */
function rewriteBullet(bulletText: string, unsupportedClaims: string[]): string {
  let rewritten = bulletText;

  for (const claim of unsupportedClaims) {
    // Replace "expert in X" / "experienced in X" / "proficient in X"
    // with "with transferable experience in X"
    const expertPattern = new RegExp(
      `(?:expert|experienced|proficient|skilled)\\s+(?:in|with)\\s+${claim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      "gi",
    );
    if (expertPattern.test(rewritten)) {
      rewritten = rewritten.replace(expertPattern, `with transferable experience relevant to ${claim}`);
    }

    // Replace "Led X operations" / "Managed X" with softer language
    const ledPattern = new RegExp(
      `\\b(?:led|managed|delivered|drove)\\s+${claim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
      "gi",
    );
    if (ledPattern.test(rewritten)) {
      rewritten = rewritten.replace(ledPattern, `engaged with ${claim}`);
    }

    // If we couldn't rewrite it, prefix with a transferability note
    if (rewritten.toLowerCase().includes(claim.toLowerCase())) {
      // Check if the claim is still asserted as direct experience
      if (!rewritten.toLowerCase().includes("transferable")) {
        rewritten = rewritten.replace(
          new RegExp(claim.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"),
          `${claim} (transferable)`,
        );
      }
    }
  }

  return rewritten;
}

/**
 * Scan the optimized resume for unsupported claims and rewrite them.
 */
export function scanProvenance(
  optimized: ResumeData,
  original: ResumeData,
  jd: JobDescription,
): ProvenanceResult {
  const sourceText = JSON.stringify(original);
  const jdText = `${jd.title} ${jd.company ?? ""} ${(jd.responsibilities ?? []).join(" ")} ${(jd.requiredSkills ?? []).join(" ")} ${(jd.keywords ?? []).join(" ")} ${jd.rawText ?? ""}`;

  const bulletResults: ProvenanceResult["bullets"] = [];
  const summaryClaims: ProvenanceResult["summaryClaims"] = [];
  let hasUnsupportedClaims = false;
  let fixesApplied = 0;

  // Create a deep copy for cleaning
  const cleanedResume: ResumeData = JSON.parse(JSON.stringify(optimized));

  // === Scan experience bullets ===
  for (let i = 0; i < (optimized.experience ?? []).length; i++) {
    const exp = optimized.experience[i];
    for (let j = 0; j < (exp.bullets ?? []).length; j++) {
      const bulletText = exp.bullets[j];
      const claims = extractClaims(bulletText);
      const claimResults = claims.map((c) => {
        const result = classifyClaim(c, sourceText, jdText);
        return { claim: c, provenance: result.provenance, evidence: result.evidence };
      });

      const hasUnsupported = claimResults.some((c) => c.provenance === "UNSUPPORTED");
      if (hasUnsupported) {
        hasUnsupportedClaims = true;
        const unsupportedClaimTexts = claimResults
          .filter((c) => c.provenance === "UNSUPPORTED")
          .map((c) => c.claim);

        // Rewrite the bullet
        const rewritten = rewriteBullet(bulletText, unsupportedClaimTexts);
        if (rewritten !== bulletText) {
          cleanedResume.experience[i].bullets[j] = rewritten;
          fixesApplied++;
        }
      }

      bulletResults.push({
        experienceIndex: i,
        bulletIndex: j,
        text: bulletText,
        claims: claimResults,
        hasUnsupported,
      });
    }
  }

  // === Scan summary claims ===
  if (optimized.summary) {
    const summaryClaimTexts = extractClaims(optimized.summary);
    for (const claim of summaryClaimTexts) {
      const result = classifyClaim(claim, sourceText, jdText);
      summaryClaims.push({ claim, provenance: result.provenance, evidence: result.evidence });
      if (result.provenance === "UNSUPPORTED") {
        hasUnsupportedClaims = true;
        // Rewrite the summary to soften the unsupported claim
        const rewritten = rewriteBullet(optimized.summary, [claim]);
        if (rewritten !== optimized.summary) {
          cleanedResume.summary = rewritten;
          fixesApplied++;
        }
      }
    }
  }

  return {
    bullets: bulletResults,
    summaryClaims,
    hasUnsupportedClaims,
    fixesApplied,
    cleanedResume,
  };
}
