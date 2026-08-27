// ============================================================================
// P5: Smart Provider Selection — route AI calls by task type, not just priority.
//
// Some providers are better for certain tasks:
//   - Gemini Flash: fast, good for structured JSON output
//   - Claude: best for nuanced writing (summaries, cover letters)
//   - Puter (gpt-5-nano): free, good for simple tasks
//   - OpenCode Zen: free but rate-limited for third-party apps
//
// This module provides a task-type → provider-capability mapping so the
// orchestrator can select the best provider for each stage, and fall back
// to the next-best when the primary is unavailable.
// ============================================================================

export type AITaskType =
  | "resume_optimization"   // needs JSON output, structured data
  | "ats_analysis"           // keyword matching, scoring
  | "cover_letter"           // nuanced writing
  | "interview_prep"         // structured Q&A generation
  | "company_research"       // web search + synthesis
  | "skill_gap"              // comparison + analysis
  | "jd_parsing"             // text extraction
  | "summary_generation"     // short-form writing
  | "bullet_rewrite"         // short, structured output
  | "generic";               // default

export interface ProviderTaskCapability {
  /** How well this provider handles this task type (0-100). */
  score: number;
  /** Whether this provider supports JSON mode for this task. */
  supportsJson: boolean;
  /** Estimated latency in ms. */
  estimatedLatencyMs: number;
}

/**
 * Capability matrix: which provider types are best for which tasks.
 * Scores are based on general knowledge of model capabilities.
 */
const CAPABILITY_MATRIX: Record<string, Partial<Record<AITaskType, ProviderTaskCapability>>> = {
  // Gemini: fast + good at structured JSON
  gemini: {
    resume_optimization: { score: 85, supportsJson: true, estimatedLatencyMs: 2000 },
    ats_analysis: { score: 70, supportsJson: false, estimatedLatencyMs: 1500 },
    cover_letter: { score: 65, supportsJson: false, estimatedLatencyMs: 3000 },
    interview_prep: { score: 75, supportsJson: true, estimatedLatencyMs: 2500 },
    company_research: { score: 60, supportsJson: false, estimatedLatencyMs: 3000 },
    skill_gap: { score: 70, supportsJson: true, estimatedLatencyMs: 2000 },
    jd_parsing: { score: 80, supportsJson: true, estimatedLatencyMs: 1500 },
    summary_generation: { score: 75, supportsJson: false, estimatedLatencyMs: 1500 },
    bullet_rewrite: { score: 80, supportsJson: true, estimatedLatencyMs: 2000 },
  },

  // Claude: best for nuanced writing
  claude: {
    resume_optimization: { score: 80, supportsJson: true, estimatedLatencyMs: 5000 },
    ats_analysis: { score: 60, supportsJson: false, estimatedLatencyMs: 4000 },
    cover_letter: { score: 95, supportsJson: false, estimatedLatencyMs: 5000 },
    interview_prep: { score: 85, supportsJson: true, estimatedLatencyMs: 5000 },
    company_research: { score: 75, supportsJson: false, estimatedLatencyMs: 5000 },
    skill_gap: { score: 75, supportsJson: true, estimatedLatencyMs: 4000 },
    jd_parsing: { score: 70, supportsJson: true, estimatedLatencyMs: 3000 },
    summary_generation: { score: 90, supportsJson: false, estimatedLatencyMs: 4000 },
    bullet_rewrite: { score: 85, supportsJson: true, estimatedLatencyMs: 4000 },
  },

  // OpenAI: good all-rounder
  openai: {
    resume_optimization: { score: 85, supportsJson: true, estimatedLatencyMs: 3000 },
    ats_analysis: { score: 70, supportsJson: false, estimatedLatencyMs: 2000 },
    cover_letter: { score: 85, supportsJson: false, estimatedLatencyMs: 4000 },
    interview_prep: { score: 85, supportsJson: true, estimatedLatencyMs: 3000 },
    company_research: { score: 75, supportsJson: false, estimatedLatencyMs: 4000 },
    skill_gap: { score: 75, supportsJson: true, estimatedLatencyMs: 3000 },
    jd_parsing: { score: 80, supportsJson: true, estimatedLatencyMs: 2000 },
    summary_generation: { score: 85, supportsJson: false, estimatedLatencyMs: 2000 },
    bullet_rewrite: { score: 85, supportsJson: true, estimatedLatencyMs: 3000 },
  },

  // Puter: free, decent for simple tasks
  puter: {
    resume_optimization: { score: 60, supportsJson: true, estimatedLatencyMs: 5000 },
    ats_analysis: { score: 50, supportsJson: false, estimatedLatencyMs: 4000 },
    cover_letter: { score: 65, supportsJson: false, estimatedLatencyMs: 5000 },
    interview_prep: { score: 60, supportsJson: true, estimatedLatencyMs: 5000 },
    company_research: { score: 40, supportsJson: false, estimatedLatencyMs: 5000 },
    skill_gap: { score: 50, supportsJson: true, estimatedLatencyMs: 4000 },
    jd_parsing: { score: 55, supportsJson: true, estimatedLatencyMs: 3000 },
    summary_generation: { score: 65, supportsJson: false, estimatedLatencyMs: 3000 },
    bullet_rewrite: { score: 60, supportsJson: true, estimatedLatencyMs: 4000 },
  },

  // OpenCode Zen: free, rate-limited
  opencode: {
    resume_optimization: { score: 70, supportsJson: true, estimatedLatencyMs: 4000 },
    ats_analysis: { score: 55, supportsJson: false, estimatedLatencyMs: 3000 },
    cover_letter: { score: 70, supportsJson: false, estimatedLatencyMs: 4000 },
    interview_prep: { score: 70, supportsJson: true, estimatedLatencyMs: 4000 },
    company_research: { score: 50, supportsJson: false, estimatedLatencyMs: 4000 },
    skill_gap: { score: 60, supportsJson: true, estimatedLatencyMs: 3000 },
    jd_parsing: { score: 65, supportsJson: true, estimatedLatencyMs: 2500 },
    summary_generation: { score: 70, supportsJson: false, estimatedLatencyMs: 2500 },
    bullet_rewrite: { score: 70, supportsJson: true, estimatedLatencyMs: 3000 },
  },

  // DeepSeek: good for code/structured
  deepseek: {
    resume_optimization: { score: 75, supportsJson: true, estimatedLatencyMs: 4000 },
    ats_analysis: { score: 60, supportsJson: false, estimatedLatencyMs: 3000 },
    cover_letter: { score: 70, supportsJson: false, estimatedLatencyMs: 4000 },
    interview_prep: { score: 70, supportsJson: true, estimatedLatencyMs: 4000 },
    company_research: { score: 55, supportsJson: false, estimatedLatencyMs: 4000 },
    skill_gap: { score: 65, supportsJson: true, estimatedLatencyMs: 3000 },
    jd_parsing: { score: 70, supportsJson: true, estimatedLatencyMs: 2500 },
    summary_generation: { score: 70, supportsJson: false, estimatedLatencyMs: 2500 },
    bullet_rewrite: { score: 75, supportsJson: true, estimatedLatencyMs: 3000 },
  },
};

/**
 * Rank providers for a given task type.
 * Returns providers sorted by capability score (highest first).
 */
export function rankProvidersForTask(
  providers: Array<{ id: string; type: string; isActive: boolean; priority: number; modelName?: string }>,
  taskType: AITaskType,
): Array<{ provider: any; capability: ProviderTaskCapability }> {
  const ranked: Array<{ provider: any; capability: ProviderTaskCapability }> = [];

  for (const provider of providers) {
    if (!provider.isActive) continue;

    const caps = CAPABILITY_MATRIX[provider.type];
    if (!caps) {
      // Unknown provider — give it a moderate score
      ranked.push({
        provider,
        capability: { score: 50, supportsJson: false, estimatedLatencyMs: 5000 },
      });
      continue;
    }

    const taskCap = caps[taskType];
    if (!taskCap) {
      ranked.push({
        provider,
        capability: { score: 50, supportsJson: false, estimatedLatencyMs: 5000 },
      });
      continue;
    }

    ranked.push({ provider, capability: taskCap });
  }

  // Sort by score (highest first), then by priority (lowest number = highest priority)
  ranked.sort((a, b) => {
    if (b.capability.score !== a.capability.score) {
      return b.capability.score - a.capability.score;
    }
    return a.provider.priority - b.provider.priority;
  });

  return ranked;
}

/**
 * Get the best provider for a task type. Falls back to the user's default
 * if no providers are ranked.
 */
export function getBestProviderForTask(
  providers: Array<{ id: string; type: string; isActive: boolean; priority: number; modelName?: string }>,
  taskType: AITaskType,
  defaultProviderId?: string | null,
): any | null {
  const ranked = rankProvidersForTask(providers, taskType);

  if (ranked.length === 0) return null;

  // If the user's default is in the top 3, prefer it
  if (defaultProviderId) {
    const defaultInRanked = ranked.find((r) => r.provider.id === defaultProviderId);
    if (defaultInRanked && defaultInRanked.capability.score >= ranked[0].capability.score - 20) {
      return defaultInRanked.provider;
    }
  }

  return ranked[0].provider;
}
