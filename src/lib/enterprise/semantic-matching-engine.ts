// ============================================================================
// Enterprise Semantic Matching Engine — ResumeAI Pro
// ============================================================================
// Recognizes semantic equivalents between resume skills and job requirements
// without relying on exact keyword matching.
//
// Supported mappings:
//   Guest Service ↔ Customer Service ↔ Passenger Assistance ↔ Client Relations
//   Front Office ↔ Reception ↔ Guest Relations
//   Aircraft ↔ Airplane ↔ Plane
//   ... and 100+ more via the Industry Knowledge Engine
// ============================================================================

import {
  getSynonyms,
  getSkillGraph,
  similarity,
  resolveToCanonical,
} from "./industry-knowledge-engine";
import type { IndustrySkillNode } from "./industry-knowledge-engine";
import type { JDAnalysis } from "./jd-engine";

// ============================================================================
// Types
// ============================================================================

export interface SemanticMatch {
  /** The resume skill that was matched */
  resumeSkill: string;
  /** The JD skill/requirement it matched against */
  jdSkill: string;
  /** How strong the match is (0-1) */
  confidence: number;
  /** How the match was determined */
  matchType: "exact" | "synonym" | "bigram" | "industry-graph" | "alias";
}

export interface SemanticAnalysis {
  /** Skills from resume that match JD requirements */
  matchedSkills: SemanticMatch[];
  /** Skills from JD that are MISSING from the resume */
  missingSkills: { skill: string; confidence: number }[];
  /** Overall semantic match score (0-1) */
  overallScore: number;
  /** Industry detected */
  industry: string;
  /** Semantic equivalents found (for reporting) */
  equivalentsFound: string[];
}

// ============================================================================
// Core similarity computation
// ============================================================================

/**
 * Compute semantic similarity between two skill terms.
 * Uses multiple strategies in order of reliability:
 *   1. Exact match (case-insensitive)
 *   2. Synonym resolution via Industry Knowledge Engine
 *   3. Bigram similarity
 *   4. Industry graph parent-child relationship
 */
export function computeSkillSimilarity(
  resumeSkill: string,
  jdSkill: string,
  industryId?: string,
): number {
  const a = resumeSkill.toLowerCase().trim();
  const b = jdSkill.toLowerCase().trim();

  if (a === b) return 1.0; // Exact match

  // Resolve both to canonical via industry knowledge engine
  const canonicalA = resolveToCanonical(resumeSkill, industryId);
  const canonicalB = resolveToCanonical(jdSkill, industryId);

  if (canonicalA && canonicalB && canonicalA.canonical.toLowerCase() === canonicalB.canonical.toLowerCase()) {
    return 0.9; // Both resolve to same canonical skill
  }

  if (canonicalA && canonicalA.canonical.toLowerCase() === b) return 0.9;
  if (canonicalB && canonicalB.canonical.toLowerCase() === a) return 0.9;

  // Check if either skill is an alias of the other's canonical via synonym groups
  const synonyms = getSynonyms(industryId || "");
  for (const group of synonyms) {
    const canonLower = group.canonical.toLowerCase();
    const aliasSet = group.aliases.map((al) => al.toLowerCase());

    const aInGroup = (a === canonLower || aliasSet.indexOf(a) !== -1);
    const bInGroup = (b === canonLower || aliasSet.indexOf(b) !== -1);

    if (aInGroup && bInGroup) {
      // Both map to the same skill
      return 0.95;
    }
    if ((aInGroup && b === canonLower) || (bInGroup && a === canonLower)) {
      return 0.9;
    }
    if (aInGroup && aliasSet.indexOf(b) !== -1) {
      return 0.85; // Both aliases of same canonical
    }
  }

  // Bigram similarity
  const bigramScore = similarity(a, b);
  if (bigramScore >= 0.6) return bigramScore;

  // Industry graph: check if skills are in the same graph branch
  if (industryId) {
    const graph = getSkillGraph(industryId);
    if (graph && graph.length > 0) {
      // Flatten the graph into a flat list of skill names for quick lookup
      const flattenNames = (nodes: IndustrySkillNode[]): string[] => {
        const names: string[] = [];
        for (const node of nodes) {
          names.push(node.name.toLowerCase());
          for (const alias of node.aliases) names.push(alias.toLowerCase());
          if (node.children.length > 0) names.push(...flattenNames(node.children));
        }
        return names;
      };
      const allNames = flattenNames(graph);
      const aInGraph = allNames.indexOf(a) !== -1;
      const bInGraph = allNames.indexOf(b) !== -1;
      if (aInGraph && bInGraph) {
        return 0.5; // Moderate — same industry domain
      }
    }
  }

  return bigramScore; // Fallback to pure bigram
}

// ============================================================================
// Main analysis
// ============================================================================

/**
 * Analyze semantic match between a resume's skill list and a JD's requirements.
 */
export function analyzeSemanticMatch(
  resumeSkills: string[],
  jdAnalysis: JDAnalysis,
): SemanticAnalysis {
  const matches: SemanticMatch[] = [];
  const missing: { skill: string; confidence: number }[] = [];
  const equivalents: string[] = [];

  const industryId = jdAnalysis.industryId;

  // Normalize resume skills
  const normalizedResume = resumeSkills.map((s) => s.toLowerCase().trim());

  // Collect all JD skills with weights
  const allJDSkills: { name: string; weight: number }[] = [];

  for (const s of jdAnalysis.skills) {
    allJDSkills.push({ name: s.name, weight: s.weight });
  }
  for (const k of jdAnalysis.criticalKeywords) {
    // Avoid duplicates
    if (allJDSkills.filter((js) => js.name.toLowerCase() === k.toLowerCase()).length === 0) {
      allJDSkills.push({ name: k, weight: 1.0 });
    }
  }
  for (const k of jdAnalysis.priorityKeywords) {
    if (allJDSkills.filter((js) => js.name.toLowerCase() === k.toLowerCase()).length === 0) {
      allJDSkills.push({ name: k, weight: 0.8 });
    }
  }
  for (const s of jdAnalysis.softSkills) {
    if (allJDSkills.filter((js) => js.name.toLowerCase() === s.toLowerCase()).length === 0) {
      allJDSkills.push({ name: s, weight: 0.7 });
    }
  }
  for (const t of jdAnalysis.tools) {
    if (allJDSkills.filter((js) => js.name.toLowerCase() === t.toLowerCase()).length === 0) {
      allJDSkills.push({ name: t, weight: 0.8 });
    }
  }

  for (const jdSkill of allJDSkills) {
    let bestMatch: SemanticMatch | null = null;

    for (const resumeSkill of normalizedResume) {
      const confidence = computeSkillSimilarity(resumeSkill, jdSkill.name, industryId);

      if (confidence > 0 && (!bestMatch || confidence > bestMatch.confidence)) {
        const matchType: SemanticMatch["matchType"] =
          confidence >= 1.0
            ? "exact"
            : confidence >= 0.9
              ? "synonym"
              : confidence >= 0.7
                ? "bigram"
                : "industry-graph";

        bestMatch = {
          resumeSkill,
          jdSkill: jdSkill.name,
          confidence,
          matchType,
        };
      }
    }

    if (bestMatch && bestMatch.confidence >= 0.5) {
      matches.push(bestMatch);

      // Track semantic equivalents (non-exact matches)
      if (bestMatch.matchType !== "exact") {
        equivalents.push(`${bestMatch.resumeSkill} ↔ ${bestMatch.jdSkill}`);
      }
    } else {
      missing.push({
        skill: jdSkill.name,
        confidence: bestMatch ? bestMatch.confidence : 0,
      });
    }
  }

  // Calculate overall score
  const totalJDSkills = allJDSkills.length;
  const matchScore = totalJDSkills > 0 ? matches.length / totalJDSkills : 0;

  return {
    matchedSkills: matches,
    missingSkills: missing,
    overallScore: matchScore,
    industry: industryId,
    equivalentsFound: equivalents,
  };
}

/**
 * Compute ATS keyword match score (0-100).
 * Weights critical skills higher than optional ones.
 */
export function computeKeywordMatchScore(
  analysis: SemanticAnalysis,
  jdAnalysis: JDAnalysis,
): number {
  if (jdAnalysis.skills.length === 0 && jdAnalysis.criticalKeywords.length === 0) return 50;

  let totalWeight = 0;
  let matchedWeight = 0;

  // Weight critical keywords higher
  for (const kw of jdAnalysis.criticalKeywords) {
    totalWeight += 3;
    const matched = analysis.matchedSkills.find(
      (m) => m.jdSkill.toLowerCase() === kw.toLowerCase(),
    );
    if (matched) matchedWeight += 3 * matched.confidence;
  }

  // Weight skills
  for (const skill of jdAnalysis.skills) {
    totalWeight += skill.weight;
    const matched = analysis.matchedSkills.find(
      (m) => m.jdSkill.toLowerCase() === skill.name.toLowerCase(),
    );
    if (matched) matchedWeight += skill.weight * matched.confidence;
  }

  // Soft skills
  for (const ss of jdAnalysis.softSkills) {
    totalWeight += 0.5;
    const matched = analysis.matchedSkills.find(
      (m) => m.jdSkill.toLowerCase() === ss.toLowerCase(),
    );
    if (matched) matchedWeight += 0.5 * matched.confidence;
  }

  if (totalWeight === 0) return 50;
  return Math.round((matchedWeight / totalWeight) * 100);
}

export default {
  computeSkillSimilarity,
  analyzeSemanticMatch,
  computeKeywordMatchScore,
};
