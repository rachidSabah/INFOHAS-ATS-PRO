// ============================================================================
// Seed Defaults for Pipeline Orchestration
//
// Built-in pipeline profiles + default agent configurations.
// These are additive — they don't replace any existing seed data.
// All defaults can be overridden by the user via the UI and persisted to D1.
// ============================================================================

"use client";

import type {
  PipelineProfile,
  AgentConfig,
  QualityGate,
  PromptVersion,
} from "./pipeline-orchestration-types";

// ============================================================================
// 1. BUILT-IN PIPELINE PROFILES
// ============================================================================

export const SEED_PIPELINE_PROFILES: PipelineProfile[] = [
  {
    id: "profile-legacy-v2",
    name: "Legacy V2",
    description: "Original V2 pipeline — standard optimizer only, no V3 agents, no locked pipeline. Maximum backward compatibility.",
    type: "legacy-v2",
    enabledAgents: [
      "job-intelligence", "company-intelligence", "skill-gap", "ats-analysis",
      "experience-optimizer", "quality-assurance", "reflection",
    ],
    parallelGroups: [
      ["job-intelligence", "company-intelligence", "skill-gap"],
      ["ats-analysis"],
      ["experience-optimizer"],
      ["quality-assurance", "reflection"],
    ],
    enableV3PostOptimization: false,
    useLockedPipeline: false,
    enableTargetedRegeneration: false,
    matchingStrategy: "fuzzy",
    hybridMatchingThreshold: 70,
    maxRetries: 4,
    validationThresholds: {
      minAtsScore: 60,
      minFactualConsistency: 80,
      minKeywordCoverage: 60,
      minHtmlValidation: 80,
      minGrammarScore: 80,
      minRecruiterReadability: 80,
      minSemanticSimilarity: 70,
      minConfidenceScore: 70,
      minQualityScore: 75,
      enforceOnePage: true,
    },
    isBuiltIn: true,
    isDefault: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "profile-legacy-v3",
    name: "Legacy V3",
    description: "V2 pipeline + V3 post-optimization agents (Keyword Embedding, Fact Verification, Layout Optimization). Enhanced keyword coverage.",
    type: "legacy-v3",
    enabledAgents: [
      "job-intelligence", "company-intelligence", "skill-gap", "ats-analysis",
      "experience-optimizer", "quality-assurance", "reflection",
    ],
    parallelGroups: [
      ["job-intelligence", "company-intelligence", "skill-gap"],
      ["ats-analysis"],
      ["experience-optimizer"],
      ["quality-assurance", "reflection"],
    ],
    enableV3PostOptimization: true,
    useLockedPipeline: false,
    enableTargetedRegeneration: false,
    matchingStrategy: "fuzzy",
    hybridMatchingThreshold: 70,
    maxRetries: 4,
    validationThresholds: {
      minAtsScore: 65,
      minFactualConsistency: 85,
      minKeywordCoverage: 65,
      minHtmlValidation: 85,
      minGrammarScore: 85,
      minRecruiterReadability: 85,
      minSemanticSimilarity: 75,
      minConfidenceScore: 75,
      minQualityScore: 80,
      enforceOnePage: true,
    },
    isBuiltIn: true,
    isDefault: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "profile-locked",
    name: "Locked Pipeline",
    description: "Bullet-only optimizer + Resume Assembler. LLM cannot generate full resume. Maximum factual integrity. V3 agents skipped.",
    type: "locked",
    enabledAgents: [
      "entity-lock", "job-intelligence", "company-intelligence", "skill-gap", "ats-analysis",
      "summary-optimizer", "skills-optimizer", "experience-optimizer",
      "resume-assembler", "structure-guardian", "factual-consistency", "quality-assurance",
    ],
    parallelGroups: [
      ["entity-lock"],
      ["job-intelligence", "company-intelligence", "skill-gap", "ats-analysis"],
      ["summary-optimizer", "skills-optimizer", "experience-optimizer"],
      ["resume-assembler"],
      ["structure-guardian", "factual-consistency"],
      ["quality-assurance"],
    ],
    enableV3PostOptimization: false,
    useLockedPipeline: true,
    enableTargetedRegeneration: false,
    matchingStrategy: "strict",
    hybridMatchingThreshold: 80,
    maxRetries: 4,
    validationThresholds: {
      minAtsScore: 65,
      minFactualConsistency: 95,
      minKeywordCoverage: 60,
      minHtmlValidation: 90,
      minGrammarScore: 90,
      minRecruiterReadability: 85,
      minSemanticSimilarity: 75,
      minConfidenceScore: 75,
      minQualityScore: 80,
      enforceOnePage: true,
    },
    isBuiltIn: true,
    isDefault: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "profile-hybrid",
    name: "Hybrid (Recommended)",
    description: "Locked pipeline + V3 agents + targeted regeneration + hybrid matching. Best balance of factual integrity, ATS score, and reliability.",
    type: "hybrid",
    enabledAgents: [
      "entity-lock", "job-intelligence", "company-intelligence", "skill-gap", "ats-analysis",
      "summary-optimizer", "skills-optimizer", "experience-optimizer",
      "resume-assembler", "structure-guardian", "factual-consistency", "quality-assurance", "reflection",
    ],
    parallelGroups: [
      ["entity-lock"],
      ["job-intelligence", "company-intelligence", "skill-gap", "ats-analysis"],
      ["summary-optimizer", "skills-optimizer", "experience-optimizer"],
      ["resume-assembler"],
      ["structure-guardian", "factual-consistency"],
      ["quality-assurance", "reflection"],
    ],
    enableV3PostOptimization: true,
    useLockedPipeline: true,
    enableTargetedRegeneration: true,
    matchingStrategy: "hybrid",
    hybridMatchingThreshold: 75,
    maxRetries: 4,
    validationThresholds: {
      minAtsScore: 70,
      minFactualConsistency: 95,
      minKeywordCoverage: 70,
      minHtmlValidation: 90,
      minGrammarScore: 90,
      minRecruiterReadability: 85,
      minSemanticSimilarity: 80,
      minConfidenceScore: 80,
      minQualityScore: 85,
      enforceOnePage: true,
    },
    isBuiltIn: true,
    isDefault: true, // This is the recommended profile
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "profile-agentic-turbo",
    name: "Agentic Turbo",
    description:
      "Agentic fast lane — locked pipeline + V3 agents + surgical targeted regeneration on a lean 2-attempt budget. Flash-tier turnaround for quick iterations; factual integrity (95) is never relaxed.",
    type: "agentic-turbo",
    enabledAgents: [
      "entity-lock", "job-intelligence", "company-intelligence", "skill-gap", "ats-analysis",
      "summary-optimizer", "skills-optimizer", "experience-optimizer",
      "resume-assembler", "structure-guardian", "factual-consistency", "quality-assurance", "reflection",
    ],
    parallelGroups: [
      ["entity-lock"],
      ["job-intelligence", "company-intelligence", "skill-gap", "ats-analysis"],
      ["summary-optimizer", "skills-optimizer", "experience-optimizer"],
      ["resume-assembler"],
      ["structure-guardian", "factual-consistency"],
      ["quality-assurance", "reflection"],
    ],
    enableV3PostOptimization: true,
    useLockedPipeline: true,
    enableTargetedRegeneration: true,
    matchingStrategy: "hybrid",
    hybridMatchingThreshold: 70, // slightly lenient → less match churn → fewer wasted cycles
    maxRetries: 2,
    validationThresholds: {
      minAtsScore: 65,
      minFactualConsistency: 95, // NEVER relaxed — directive §2
      minKeywordCoverage: 60,
      minHtmlValidation: 85,
      minGrammarScore: 85,
      minRecruiterReadability: 85,
      minSemanticSimilarity: 75,
      minConfidenceScore: 75,
      minQualityScore: 80,
      enforceOnePage: true,
    },
    isBuiltIn: true,
    isDefault: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: "profile-agentic-sentinel",
    name: "Agentic Sentinel",
    description:
      "Agentic deep mode — locked pipeline + V3 agents + targeted regeneration with the maximum 6-attempt budget and the strictest validation gates. The pipeline keeps self-correcting section-by-section until every gate passes or the budget is exhausted.",
    type: "agentic-sentinel",
    enabledAgents: [
      "entity-lock", "job-intelligence", "company-intelligence", "skill-gap", "ats-analysis",
      "summary-optimizer", "skills-optimizer", "experience-optimizer",
      "resume-assembler", "structure-guardian", "factual-consistency", "quality-assurance", "reflection",
    ],
    parallelGroups: [
      ["entity-lock"],
      ["job-intelligence", "company-intelligence", "skill-gap", "ats-analysis"],
      ["summary-optimizer", "skills-optimizer", "experience-optimizer"],
      ["resume-assembler"],
      ["structure-guardian", "factual-consistency"],
      ["quality-assurance", "reflection"],
    ],
    enableV3PostOptimization: true,
    useLockedPipeline: true,
    enableTargetedRegeneration: true,
    matchingStrategy: "hybrid",
    hybridMatchingThreshold: 85, // tight matching for maximum integrity
    maxRetries: 6,
    validationThresholds: {
      minAtsScore: 75,
      minFactualConsistency: 95, // NEVER relaxed — directive §2
      minKeywordCoverage: 75,
      minHtmlValidation: 90,
      minGrammarScore: 90,
      minRecruiterReadability: 90,
      minSemanticSimilarity: 85,
      minConfidenceScore: 85,
      minQualityScore: 90,
      enforceOnePage: true,
    },
    isBuiltIn: true,
    isDefault: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

// ============================================================================
// 2. DEFAULT AGENT CONFIGURATIONS (OPTIMAL — Task 7)
//
// Per-agent tuned defaults aligned with the Auto-Heal / AI Readiness Gate
// architecture (commit 374847fe):
//   - Deterministic agents (lock, assemble, validate) → temperature 0.0-0.1.
//   - Creative-but-factual optimizers → 0.15-0.3 (quality without drift).
//   - maxTokens sized to each agent's output shape (no truncation, no waste).
//   - requestTimeoutMs sized for free-tier latency (40-80s typical).
//   - maxRetryCount ≤ 3 + exponential backoff — the job AI lock adds ONE
//     supervised recovery cycle ON TOP (directive #14/#35: no retry loops).
//   - Provider/model left EMPTY = use the app default chain / job AI lock.
//     Set them in the Agent Configuration Center to pin an agent's
//     preference for non-locked runs; under an optimization job the
//     readiness-gate lock ALWAYS wins (directive #31).
// ============================================================================

function createDefaultAgentConfig(
  agentType: AgentConfig["agentType"],
  displayName: string,
  description: string,
  executionOrder: number,
  overrides: Partial<AgentConfig> = {},
): AgentConfig {
  return {
    id: `agent-${agentType}`,
    agentType,
    displayName,
    description,
    version: "1.0.0",
    executionOrder,
    enabled: true,
    parallelExecution: false,
    dependencies: [],
    runOnlyWhenRequired: false,
    enableLogging: false,
    enableDebugMode: false,
    providerId: "",  // empty = app default chain (or job AI lock during optimization)
    model: "",       // empty = provider's default model
    qualityMode: "balanced",
    temperature: 0.15,
    topP: 1.0,
    presencePenalty: 0,
    frequencyPenalty: 0,
    maxTokens: 8000,
    contextLength: 16000,
    stopSequences: [],
    reasoningEnabled: false,
    reasoningEffort: "medium",
    maxThinkingTokens: 4096,
    reasoningTimeoutMs: 30000,
    streamingEnabled: false,
    streamPartialResponses: false,
    streamThinkingProcess: false,
    streamTokenStatistics: false,
    maxRetryCount: 2,
    retryDelayMs: 1500,
    exponentialBackoff: true,
    retryOnTimeout: true,
    retryOnRateLimit: true,
    retryOnNetworkError: true,
    retryOnInvalidOutput: true,
    requestTimeoutMs: 90000,
    totalAgentTimeoutMs: 120000,
    maxQueueWaitMs: 30000,
    fallbackChain: [],
    promptId: `prompt-${agentType}`,
    promptVersion: 1,
    minConfidenceScore: 70,
    minQualityScore: 75,
    minAtsScore: 60,
    minSemanticSimilarity: 70,
    minHtmlValidationScore: 80,
    onFailureAction: "retry",
    readFromSharedMemory: true,
    writeToSharedMemory: true,
    memorySectionsUsed: [],
    cacheResults: false,
    cacheDurationMs: 300000,
    persistIntermediateResults: false,
    outputFormat: "json",
    outputVisibility: "internal",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

export const SEED_AGENT_CONFIGS: AgentConfig[] = [
  createDefaultAgentConfig("supervisor", "Supervisor Agent", "Orchestrates the entire pipeline — planning, scheduling, retries, validation.", 0, {
    temperature: 0.1, maxTokens: 4000, maxRetryCount: 2,
  }),
  createDefaultAgentConfig("parser", "Resume Parser", "Parses uploaded resume (PDF/DOCX/TXT/HTML) into structured ResumeData.", 1, {
    temperature: 0.0, maxTokens: 8000, requestTimeoutMs: 90000,
  }),
  createDefaultAgentConfig("entity-lock", "Entity Lock Agent", "Locks immutable entities (company, dates, education, languages) before optimization.", 2, {
    temperature: 0.0, maxTokens: 3000, maxRetryCount: 2, onFailureAction: "retry",
  }),
  createDefaultAgentConfig("resume-optimizer", "Resume Optimizer", "Bullet-only optimizer + assembler output (locked pipeline) or full-resume optimizer (legacy path). The pipeline's main AI engine.", 3, {
    temperature: 0.15, maxTokens: 8000, maxRetryCount: 3, requestTimeoutMs: 120000,
    totalAgentTimeoutMs: 180000, qualityMode: "high-quality", streamingEnabled: true,
    streamPartialResponses: true, minQualityScore: 80, onFailureAction: "fallback-model",
  }),
  createDefaultAgentConfig("job-intelligence", "Job Intelligence Agent", "Analyzes JD to extract industry, required skills, recruiter intent, priority keywords.", 3, {
    temperature: 0.2, maxTokens: 3000, requestTimeoutMs: 90000, minConfidenceScore: 75,
  }),
  createDefaultAgentConfig("company-intelligence", "Company Intelligence Agent", "Researches the target company — culture, values, hiring priorities, ATS system.", 3, {
    temperature: 0.3, maxTokens: 1800, requestTimeoutMs: 90000, runOnlyWhenRequired: true,
  }),
  createDefaultAgentConfig("skill-gap", "Skill Gap Agent", "Identifies gaps between candidate skills and JD requirements. Suggests transferable skills.", 3, {
    temperature: 0.2, maxTokens: 2200, requestTimeoutMs: 90000, minConfidenceScore: 75,
  }),
  createDefaultAgentConfig("ats-analysis", "ATS Analysis Agent", "Computes ATS score and identifies missing keywords.", 4, {
    temperature: 0.0, maxTokens: 2500, requestTimeoutMs: 90000,
  }),
  createDefaultAgentConfig("summary-optimizer", "Summary Optimization Agent", "Rewrites the professional summary for ATS + readability.", 5, {
    temperature: 0.3, maxTokens: 2000, maxRetryCount: 3, requestTimeoutMs: 120000,
    minQualityScore: 80, onFailureAction: "fallback-model",
  }),
  createDefaultAgentConfig("skills-optimizer", "Skills Optimization Agent", "Enriches skills with transferable skills and JD-relevant keywords.", 5, {
    temperature: 0.2, maxTokens: 1500, maxRetryCount: 3, requestTimeoutMs: 120000,
    onFailureAction: "fallback-model",
  }),
  createDefaultAgentConfig("experience-optimizer", "Experience Optimization Agent", "Rewrites experience bullets for impact + ATS keywords. Title/company/dates locked.", 5, {
    temperature: 0.15, maxTokens: 4000, maxRetryCount: 3, requestTimeoutMs: 120000,
    totalAgentTimeoutMs: 180000, minQualityScore: 80, onFailureAction: "fallback-model",
  }),
  createDefaultAgentConfig("education-languages", "Education & Languages Agent", "Formatting only — no inference or additions.", 5, {
    temperature: 0.0, maxTokens: 2000, maxRetryCount: 2,
  }),
  createDefaultAgentConfig("resume-assembler", "Resume Assembler Agent", "Merges immutable source fields with mutable optimizer output. Application-owned.", 6, {
    temperature: 0.0, maxTokens: 4000, maxRetryCount: 1,
  }),
  createDefaultAgentConfig("structure-guardian", "Structure Guardian Agent", "Validates final resume for corruption, duplicates, malformed fragments.", 7, {
    temperature: 0.0, maxTokens: 2000, maxRetryCount: 2, minQualityScore: 85,
  }),
  createDefaultAgentConfig("factual-consistency", "Factual Consistency Agent", "Compares optimized resume against source to detect hallucinations.", 7, {
    temperature: 0.0, maxTokens: 2000, maxRetryCount: 2, minConfidenceScore: 95,
  }),
  createDefaultAgentConfig("quality-assurance", "Quality Assurance Agent", "Final quality check — ATS score, readability, completeness.", 8, {
    temperature: 0.0, maxTokens: 2000, maxRetryCount: 2, minQualityScore: 80,
  }),
  createDefaultAgentConfig("reflection", "Reflection Agent", "Reviews diff between original and optimized. Triggers when QA confidence < threshold.", 8, {
    temperature: 0.2, maxTokens: 1500, maxRetryCount: 2, requestTimeoutMs: 90000,
  }),
  createDefaultAgentConfig("recovery", "Recovery Agent", "Handles pipeline failures — snapshot rollback, fallback generation.", 99, {
    temperature: 0.0, maxTokens: 2000, maxRetryCount: 1, runOnlyWhenRequired: true,
  }),
];

// ============================================================================
// 3. DEFAULT QUALITY GATES
// ============================================================================

export const SEED_QUALITY_GATES: QualityGate[] = [
  {
    type: "ats-score",
    name: "ATS Score",
    description: "Minimum ATS compatibility score (keyword match, formatting, structure).",
    weight: 0.20,
    threshold: 70,
    enabled: true,
    onFailureAction: "regenerate-targeted",
    regenerationTarget: "skills",
  },
  {
    type: "factual-consistency",
    name: "Factual Consistency",
    description: "No hallucinated employers, dates, education, or languages.",
    weight: 0.25,
    threshold: 95,
    enabled: true,
    onFailureAction: "stop-pipeline",
  },
  {
    type: "keyword-coverage",
    name: "Keyword Coverage",
    description: "Percentage of JD keywords present in the optimized resume.",
    weight: 0.10,
    threshold: 65,
    enabled: true,
    onFailureAction: "regenerate-targeted",
    regenerationTarget: "skills",
  },
  {
    type: "html-validation",
    name: "HTML Validation",
    description: "Resume HTML renders without errors or overflow.",
    weight: 0.10,
    threshold: 90,
    enabled: true,
    onFailureAction: "regenerate-targeted",
    regenerationTarget: "formatting",
  },
  {
    type: "grammar",
    name: "Grammar Score",
    description: "No double periods, duplicate sentences, filler phrases, or malformed fragments.",
    weight: 0.05,
    threshold: 90,
    enabled: true,
    onFailureAction: "regenerate-targeted",
    regenerationTarget: "summary",
  },
  {
    type: "recruiter-readability",
    name: "Recruiter Readability",
    description: "Resume is readable, well-structured, and professional.",
    weight: 0.10,
    threshold: 85,
    enabled: true,
    onFailureAction: "reflect",
  },
  {
    type: "one-page",
    name: "One-Page Validation",
    description: "Resume fits on exactly one A4 page (rendered layout, not char count).",
    weight: 0.15,
    threshold: 95,
    enabled: true,
    onFailureAction: "regenerate-targeted",
    regenerationTarget: "formatting",
  },
  {
    type: "semantic-similarity",
    name: "Semantic Similarity",
    description: "Optimized resume semantically matches the source resume (no meaning drift).",
    weight: 0.05,
    threshold: 80,
    enabled: true,
    onFailureAction: "regenerate-targeted",
    regenerationTarget: "summary",
  },
];

// ============================================================================
// 4. DEFAULT PROMPT VERSIONS (one per agent)
// ============================================================================

function createDefaultPrompt(
  agentType: AgentConfig["agentType"],
  name: string,
  description: string,
  systemPrompt: string,
  userPromptTemplate: string,
  variables: Array<{ name: string; description: string; required: boolean }> = [],
): PromptVersion {
  return {
    id: `prompt-${agentType}`,
    agentType,
    name,
    description,
    version: 1,
    systemPrompt,
    userPromptTemplate,
    variables: variables.map((v) => ({ ...v, required: v.required })),
    status: "published",
    createdBy: "system",
    createdAt: new Date().toISOString(),
    lastModified: new Date().toISOString(),
    testResults: [],
  };
}

export const SEED_PROMPT_VERSIONS: PromptVersion[] = [
  createDefaultPrompt(
    "summary-optimizer",
    "Summary Optimization Prompt",
    "Rewrites the professional summary for ATS + readability.",
    "You are an expert ATS resume optimizer. Rewrite the professional summary to maximize ATS compatibility while preserving factual accuracy.\n\nRULES:\n1. NEVER invent employers, dates, or metrics not in the source resume.\n2. Embed 2-3 priority keywords naturally.\n3. 4-6 lines, 60-90 words.\n4. Must describe the candidate, NOT critique the resume.\n5. NEVER use double periods or filler phrases.\n\nReturn ONLY the rewritten summary as a string.",
    "SOURCE RESUME:\n{{resumeJson}}\n\nJOB DESCRIPTION:\n{{jobDescription}}\n\nPRIORITY KEYWORDS: {{atsKeywords}}\n\nATS AGGRESSIVENESS: {{atsAggressiveness}}/100\n\nReturn ONLY the rewritten summary:",
    [
      { name: "resumeJson", description: "The parsed source resume as JSON", required: true },
      { name: "jobDescription", description: "The target job description text", required: true },
      { name: "atsKeywords", description: "Comma-separated priority keywords from JD", required: true },
      { name: "atsAggressiveness", description: "ATS keyword injection aggressiveness (0-100)", required: true },
    ],
  ),
  createDefaultPrompt(
    "experience-optimizer",
    "Experience Optimization Prompt",
    "Rewrites experience bullets for impact + ATS keywords. Title/company/dates are LOCKED.",
    "You are an expert ATS resume optimizer. You may ONLY rewrite bullet points.\n\nFORBIDDEN — you may NOT return:\n- experience[].title (locked)\n- experience[].company (locked)\n- experience[].location (locked)\n- experience[].startDate (locked)\n- experience[].endDate (locked)\n\nYou may ONLY return: { experiences: [{ id, bullets }] }\n\nRULES:\n1. Echo back the EXACT same experience IDs.\n2. Start every bullet with a strong action verb.\n3. NEVER invent metrics or numbers not in the source.\n4. NEVER use 'within <JobTitle>' or 'at <JobTitle>'.\n5. NEVER use double periods or filler phrases.\n\nReturn ONLY valid JSON.",
    "SOURCE RESUME:\n{{resumeJson}}\n\nJOB DESCRIPTION:\n{{jobDescription}}\n\nPRIORITY KEYWORDS: {{atsKeywords}}\n\nReturn ONLY: { experiences: [{ id: 'EXACT_SOURCE_ID', bullets: ['...', '...'] }] }",
    [
      { name: "resumeJson", description: "The parsed source resume as JSON", required: true },
      { name: "jobDescription", description: "The target job description text", required: true },
      { name: "atsKeywords", description: "Comma-separated priority keywords from JD", required: true },
    ],
  ),
  createDefaultPrompt(
    "skills-optimizer",
    "Skills Optimization Prompt",
    "Enriches skills with transferable skills and JD-relevant keywords.",
    "You are an expert ATS resume optimizer. Enrich the skills section.\n\nRULES:\n1. Add transferable skills that bridge gaps.\n2. NEVER include company names or locations as skills.\n3. NEVER include 'Qatar Duty Free', 'Qatar Airways', 'Doha', 'Qatar', etc.\n4. Max {{maxKeywords}} skills.\n5. Group by category.\n\nReturn ONLY: { skills: [{ name, category }] }",
    "SOURCE RESUME:\n{{resumeJson}}\n\nJOB DESCRIPTION:\n{{jobDescription}}\n\nMISSING SKILLS: {{missingSkills}}\nTRANSFERABLE SKILLS: {{transferableSkills}}\nMAX KEYWORDS: {{maxKeywords}}\n\nReturn ONLY: { skills: [{ name: '...', category: '...' }] }",
    [
      { name: "resumeJson", description: "The parsed source resume as JSON", required: true },
      { name: "jobDescription", description: "The target job description text", required: true },
      { name: "missingSkills", description: "Comma-separated missing skills from JD", required: true },
      { name: "transferableSkills", description: "Comma-separated transferable skills", required: true },
      { name: "maxKeywords", description: "Maximum number of skills to include", required: true },
    ],
  ),
];
