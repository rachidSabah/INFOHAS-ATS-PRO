// ============================================================================
// Directive Profiles — Pre-built Optimization Directive Configurations
//
// Each profile is a partial OptimizerDirectiveConfig that can be applied to
// quickly configure the optimizer for specific use cases.
//
// Users can save/load profiles from the UI. New profiles can be added
// without code changes by storing them in D1 as JSON.
// ============================================================================

"use client";

import type { OptimizerDirectiveConfig, AgentDirectives } from "./types";

/**
 * A named directive profile with metadata.
 */
export interface DirectiveProfile {
  id: string;
  name: string;
  description: string;
  /** Tags for filtering/searching in the UI */
  tags: string[];
  /** Partial config overrides — any field not specified keeps its current value */
  overrides: Partial<OptimizerDirectiveConfig>;
}

// ============================================================================
// BUILT-IN PROFILES
// ============================================================================

/**
 * ATS Conservative — Safe, minimal changes, preserves original structure.
 */
const ATS_CONSERVATIVE: DirectiveProfile = {
  id: "ats-conservative",
  name: "ATS Conservative",
  description: "Safe optimization that preserves original resume structure. Minimal keyword injection, conservative ATS changes.",
  tags: ["ats", "safe", "conservative"],
  overrides: {
    agentDirectives: {
      supervisor: { strictMode: true, enableRetries: true, enableProviderSwitch: false, enforceImmutableEntities: true, enableDebugLogs: false, enableDiffViewer: false },
      summary: { atsAggressiveness: 25, preserveFacts: true, maxCharacters: 800, minCharacters: 300 },
      skills: { maxKeywords: 15, allowTransferableSkills: false, allowCompanyKeywords: false, allowLocationKeywords: false },
      experience: { rewriteBulletsOnly: true, rewriteTitle: false, rewriteCompany: false, rewriteDates: false, rewriteLocation: false, maxExpansionPercent: 20 },
      education: { formatOnly: true },
      languages: { formatOnly: true },
    },
  },
};

/**
 * ATS Aggressive — Maximum ATS optimization. Inject keywords naturally where
 * supported by candidate experience, expand bullets, enrich skills.
 */
const ATS_AGGRESSIVE: DirectiveProfile = {
  id: "ats-aggressive",
  name: "ATS Aggressive",
  description: "Maximum ATS optimization. Inject keywords naturally where supported by experience, expand bullets, enrich skills.",
  tags: ["ats", "aggressive", "keywords"],
  overrides: {
    agentDirectives: {
      supervisor: { strictMode: false, enableRetries: true, enableProviderSwitch: true, enforceImmutableEntities: true, enableDebugLogs: false, enableDiffViewer: true },
      summary: { atsAggressiveness: 85, preserveFacts: true, maxCharacters: 1200, minCharacters: 500 },
      skills: { maxKeywords: 30, allowTransferableSkills: true, allowCompanyKeywords: false, allowLocationKeywords: false },
      experience: { rewriteBulletsOnly: true, rewriteTitle: false, rewriteCompany: false, rewriteDates: false, rewriteLocation: false, maxExpansionPercent: 40 },
      education: { formatOnly: true },
      languages: { formatOnly: true },
    },
  },
};

/**
 * Cabin Crew — Specialized for aviation/hospitality roles. Focuses on safety
 * certifications, language skills, customer service, physical requirements.
 */
const CABIN_CREW: DirectiveProfile = {
  id: "cabin-crew",
  name: "Cabin Crew / Aviation",
  description: "Optimized for airline/hospitality roles. Highlights safety, languages, customer service, physical requirements.",
  tags: ["aviation", "hospitality", "customer-service"],
  overrides: {
    agentDirectives: {
      supervisor: { strictMode: true, enableRetries: true, enableProviderSwitch: false, enforceImmutableEntities: true, enableDebugLogs: false, enableDiffViewer: false },
      summary: { atsAggressiveness: 60, preserveFacts: true, maxCharacters: 1000, minCharacters: 450 },
      skills: { maxKeywords: 25, allowTransferableSkills: true, allowCompanyKeywords: false, allowLocationKeywords: false },
      experience: { rewriteBulletsOnly: true, rewriteTitle: false, rewriteCompany: false, rewriteDates: false, rewriteLocation: false, maxExpansionPercent: 30 },
      education: { formatOnly: true },
      languages: { formatOnly: true },
    },
  },
};

/**
 * Retail — For retail/sales roles. Focuses on customer service, sales metrics,
 * cash handling, product knowledge, team collaboration.
 */
const RETAIL: DirectiveProfile = {
  id: "retail",
  name: "Retail / Sales",
  description: "Optimized for retail and sales roles. Highlights customer service, sales performance, cash handling.",
  tags: ["retail", "sales", "customer-service"],
  overrides: {
    agentDirectives: {
      supervisor: { strictMode: true, enableRetries: true, enableProviderSwitch: false, enforceImmutableEntities: true, enableDebugLogs: false, enableDiffViewer: false },
      summary: { atsAggressiveness: 50, preserveFacts: true, maxCharacters: 900, minCharacters: 400 },
      skills: { maxKeywords: 20, allowTransferableSkills: true, allowCompanyKeywords: false, allowLocationKeywords: false },
      experience: { rewriteBulletsOnly: true, rewriteTitle: false, rewriteCompany: false, rewriteDates: false, rewriteLocation: false, maxExpansionPercent: 25 },
      education: { formatOnly: true },
      languages: { formatOnly: true },
    },
  },
};

/**
 * Hospitality — For hotel/restaurant roles. Focuses on service excellence,
 * guest relations, team management, multilingual skills.
 */
const HOSPITALITY: DirectiveProfile = {
  id: "hospitality",
  name: "Hospitality",
  description: "Optimized for hotel/restaurant/tourism roles. Highlights guest service, multilingual skills, team coordination.",
  tags: ["hospitality", "tourism", "service"],
  overrides: {
    agentDirectives: {
      supervisor: { strictMode: true, enableRetries: true, enableProviderSwitch: false, enforceImmutableEntities: true, enableDebugLogs: false, enableDiffViewer: false },
      summary: { atsAggressiveness: 50, preserveFacts: true, maxCharacters: 950, minCharacters: 400 },
      skills: { maxKeywords: 22, allowTransferableSkills: true, allowCompanyKeywords: false, allowLocationKeywords: false },
      experience: { rewriteBulletsOnly: true, rewriteTitle: false, rewriteCompany: false, rewriteDates: false, rewriteLocation: false, maxExpansionPercent: 25 },
      education: { formatOnly: true },
      languages: { formatOnly: true },
    },
  },
};

/**
 * Executive — For senior/leadership roles. Focuses on strategic achievements,
 * team leadership, P&L responsibility, board-level communication.
 */
const EXECUTIVE: DirectiveProfile = {
  id: "executive",
  name: "Executive / Leadership",
  description: "Optimized for senior/executive roles. Highlights strategic leadership, P&L results, team development, board-level communication.",
  tags: ["executive", "leadership", "senior"],
  overrides: {
    agentDirectives: {
      supervisor: { strictMode: true, enableRetries: true, enableProviderSwitch: true, enforceImmutableEntities: true, enableDebugLogs: false, enableDiffViewer: true },
      summary: { atsAggressiveness: 65, preserveFacts: true, maxCharacters: 1200, minCharacters: 600 },
      skills: { maxKeywords: 25, allowTransferableSkills: true, allowCompanyKeywords: false, allowLocationKeywords: false },
      experience: { rewriteBulletsOnly: true, rewriteTitle: false, rewriteCompany: false, rewriteDates: false, rewriteLocation: false, maxExpansionPercent: 35 },
      education: { formatOnly: true },
      languages: { formatOnly: true },
    },
  },
};

// ============================================================================
// PROFILE REGISTRY
// ============================================================================

/**
 * All built-in profiles, keyed by ID.
 */
export const BUILT_IN_PROFILES: Record<string, DirectiveProfile> = {
  "ats-conservative": ATS_CONSERVATIVE,
  "ats-aggressive": ATS_AGGRESSIVE,
  "cabin-crew": CABIN_CREW,
  "retail": RETAIL,
  "hospitality": HOSPITALITY,
  "executive": EXECUTIVE,
};

/**
 * Get all available profiles (built-in + user-saved).
 * TODO: Merge with user-saved profiles from D1.
 */
export function getAllProfiles(): DirectiveProfile[] {
  return Object.values(BUILT_IN_PROFILES);
}

/**
 * Get a profile by ID.
 */
export function getProfile(id: string): DirectiveProfile | undefined {
  return BUILT_IN_PROFILES[id];
}

/**
 * Apply a profile's overrides to an existing directive config.
 * Returns a new config object with the profile's overrides merged in.
 */
export function applyProfileToConfig(
  baseConfig: OptimizerDirectiveConfig,
  profile: DirectiveProfile,
): OptimizerDirectiveConfig {
  const result = { ...baseConfig };

  // Deep-merge agentDirectives if both exist
  if (profile.overrides.agentDirectives && baseConfig.agentDirectives) {
    result.agentDirectives = deepMergeAgentDirectives(baseConfig.agentDirectives, profile.overrides.agentDirectives);
  } else if (profile.overrides.agentDirectives) {
    result.agentDirectives = profile.overrides.agentDirectives;
  }

  // Spread other scalar overrides
  for (const [key, value] of Object.entries(profile.overrides)) {
    if (key !== "agentDirectives" && value !== undefined) {
      (result as any)[key] = value;
    }
  }

  return result;
}

/**
 * Deep-merge agent directives (profile overrides take precedence).
 */
function deepMergeAgentDirectives(base: AgentDirectives, override: Partial<AgentDirectives>): AgentDirectives {
  return {
    ...base,
    ...override,
    supervisor: { ...base.supervisor, ...(override.supervisor || {}) },
    summary: { ...base.summary, ...(override.summary || {}) },
    skills: { ...base.skills, ...(override.skills || {}) },
    experience: { ...base.experience, ...(override.experience || {}) },
    education: { ...base.education, ...(override.education || {}) },
    languages: { ...base.languages, ...(override.languages || {}) },
  };
}
