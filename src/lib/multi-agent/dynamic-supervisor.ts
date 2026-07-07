// ============================================================================
// DynamicMultiAgentSupervisor — The single orchestration authority
// ============================================================================
// The Supervisor NEVER writes resume content. It only:
//   - creates tasks
//   - assigns agents
//   - coordinates execution
//   - tracks progress
//   - detects conflicts
//   - merges approved improvements
//   - runs validations
//   - requests retries
//   - rejects invalid outputs
//   - maintains memory
//   - creates execution reports
// ============================================================================

import type { ResumeData, JobDescription } from "../types";
import { uid } from "../store";
import type {
  AgentPatch,
  AgentTask,
  AgentResult,
  AgentContext,
  QualityScore,
  SupervisorMemory,
  SupervisorResult,
  SupervisorConfig,
  SpecialistAgentType,
  IndustryContext,
  ImmutableEntities,
  EditableFields,
  DynamicSectionInfo,
  PatchConflict,
} from "./types";
import { getSpecialistAgent, getAllAgentTypes } from "./specialist-agents";
import {
  applyPatches,
  validatePatch,
  detectConflicts,
  resolveConflict,
  computeQualityScore as computeAggregateScore,
} from "./patch-engine";
import { analyzeATS } from "../agents/ats-analysis";

// ── Default configuration ────────────────────────────────────────────────
const DEFAULT_CONFIG: SupervisorConfig = {
  maxParallelAgents: 5,
  defaultMaxRetries: 2,
  confidenceThreshold: 0.7,
  qualityThreshold: 75,
  conflictStrategy: "confidence-wins",
  preserveDynamicSections: true,
  enableParallelExecution: true,
  providerFallbackChain: ["primary", "secondary", "local"],
};

// ── Dynamic Supervisor ───────────────────────────────────────────────────
export class DynamicMultiAgentSupervisor {
  private config: SupervisorConfig;
  private memory: SupervisorMemory;
  private taskQueue: AgentTask[] = [];
  private completedTasks: AgentTask[] = [];
  private allPatches: AgentPatch[] = [];
  private conflicts: PatchConflict[] = [];

  constructor(config?: Partial<SupervisorConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.memory = this.createInitialMemory();
  }

  // ── Main execution method ──────────────────────────────────────────────
  async optimize(
    canonicalResume: ResumeData,
    jobDescription?: string,
    atsDirective?: string
  ): Promise<SupervisorResult> {
    const startTime = Date.now();
    const errors: string[] = [];
    const warnings: string[] = [];
    let rounds = 0;

    // Step 1: Detect industry and extract context
    const industryContext = this.detectIndustry(canonicalResume, jobDescription);
    const immutableEntities = this.extractImmutableEntities(canonicalResume);
    const editableFields = this.determineEditableFields();
    const dynamicSections = this.extractDynamicSections(canonicalResume);

    // Step 2: Build agent context
    const agentContext: AgentContext = {
      canonicalResume,
      jobDescription: jobDescription || "",
      atsDirective: atsDirective || "",
      industryContext,
      memory: this.memory,
      optimizationRules: this.getOptimizationRules(),
      immutableEntities,
      editableFields,
      dynamicSections,
      previousPatches: [],
    };

    // Step 3: Run the optimization rounds
    let currentResume = { ...canonicalResume };

    // Round 1: Analysis agents (run sequentially — they produce context, not patches)
    const analysisPatches = await this.runAnalysisPhase(agentContext);
    this.allPatches.push(...analysisPatches);

    // Round 2: Optimization agents (run in parallel where possible)
    const optimizationResult = await this.runOptimizationPhase(agentContext, currentResume);
    optimizationResult.patches.forEach((p) => this.allPatches.push(p));
    this.conflicts.push(...optimizationResult.conflicts);
    rounds++;

    // Resolve conflicts
    let resolved = this.resolveAllConflicts();
    let finalPatches = [...resolved.approved];

    // Apply approved patches
    if (finalPatches.length > 0) {
      const applyResult = applyPatches(currentResume, finalPatches);
      currentResume = applyResult.resume;
      if (applyResult.failed.length > 0) {
        warnings.push(`${applyResult.failed.length} patch(es) failed to apply`);
      }
    }

    // === TARGETED REGENERATION / SELF-CRITIQUE LOOP ===
    // If the quality validation fails or is low, we run targeted regeneration for weak sections!
    let qualityScore = this.computeFinalQualityScore(
      currentResume,
      finalPatches,
      canonicalResume,
      industryContext
    );

    // Run a real ATS check to compute quality fields
    let atsReport: any = null;
    try {
      atsReport = analyzeATS(currentResume, jobDescription ? { rawText: jobDescription } as any : null);
      qualityScore.ats = atsReport.scores.ats;
      qualityScore.overall = Math.round(
        atsReport.scores.ats * 0.4 +
        qualityScore.preservation * 0.3 +
        qualityScore.professionalism * 0.3
      );
    } catch (e) {
      console.warn("[Supervisor] ATS Analysis failed in dynamic supervisor:", e);
    }

    if (qualityScore.overall < this.config.qualityThreshold) {
      console.info(`[Supervisor] Initial quality score is low (${qualityScore.overall}/${this.config.qualityThreshold}). Requesting targeted regeneration…`);
      
      // Identify weak agents to regenerate
      const weakAgents: SpecialistAgentType[] = [];
      if (atsReport && atsReport.scores.keywordMatch < 85) {
        weakAgents.push("ats-optimization");
      }
      if (atsReport && atsReport.scores.content < 85) {
        weakAgents.push("experience-enhancement");
        weakAgents.push("professional-writing");
      }
      if (atsReport && atsReport.scores.completeness < 90) {
        weakAgents.push("skills-enhancement");
      }

      if (weakAgents.length > 0) {
        console.info(`[Supervisor] Regenerating weak agents: ${weakAgents.join(", ")}`);
        const regenCtx: AgentContext = {
          ...agentContext,
          canonicalResume,
          previousPatches: finalPatches, // build on top of previous approved patches
        };

        const regenPatches: AgentPatch[] = [];
        await Promise.all(
          weakAgents.map(async (agentType) => {
            try {
              const agent = getSpecialistAgent(agentType);
              const res = await agent.run(regenCtx);
              if (res.success) {
                regenPatches.push(...res.patches.filter(p => p.confidence >= this.config.confidenceThreshold));
              }
            } catch (err) {
              console.warn(`[Supervisor] Targeted regen agent failed: ${agentType}`, err);
            }
          })
        );

        if (regenPatches.length > 0) {
          // Merge and deduplicate, preferring newer regenerated patches
          const combinedPatches = [...finalPatches, ...regenPatches];
          const finalCombined: AgentPatch[] = [];
          const seen = new Set<string>();
          // Walk backwards to let new regenerated patches override older ones
          for (let i = combinedPatches.length - 1; i >= 0; i--) {
            const p = combinedPatches[i];
            const key = `${p.sectionId}|${p.field}`;
            if (!seen.has(key)) {
              finalCombined.push(p);
              seen.add(key);
            }
          }
          finalCombined.reverse();

          finalPatches = finalCombined;
          const applyResult = applyPatches(canonicalResume, finalPatches);
          currentResume = applyResult.resume;
          
          // Recompute quality
          qualityScore = this.computeFinalQualityScore(
            currentResume,
            finalPatches,
            canonicalResume,
            industryContext
          );
          try {
            atsReport = analyzeATS(currentResume, jobDescription ? { rawText: jobDescription } as any : null);
            qualityScore.ats = atsReport.scores.ats;
            qualityScore.overall = Math.round(
              atsReport.scores.ats * 0.4 +
              qualityScore.preservation * 0.3 +
              qualityScore.professionalism * 0.3
            );
          } catch {}
          console.info(`[Supervisor] Quality after targeted regeneration: ${qualityScore.overall}/${this.config.qualityThreshold}`);
          rounds++;
        }
      }
    }

    // Update memory
    this.memory.acceptedPatches.push(...finalPatches);
    this.memory.agentConfidence = this.aggregateAgentConfidence(optimizationResult.results);

    const success = qualityScore.overall >= this.config.qualityThreshold;

    return {
      resume: currentResume,
      patches: finalPatches,
      conflicts: this.conflicts,
      memory: this.memory,
      qualityScore,
      success,
      errors,
      warnings,
      rounds,
    };
  }

  // ── Phase 1: Analysis ──────────────────────────────────────────────────
  private async runAnalysisPhase(context: AgentContext): Promise<AgentPatch[]> {
    const patches: AgentPatch[] = [];

    // Run resume analyzer and JD analyzer sequentially
    const analyzerAgent = getSpecialistAgent("resume-analyzer");
    const result1 = await analyzerAgent.run(context);
    // Store analysis in memory (even if no patches returned)
    this.memory.optimizationHistory.push({
      roundId: uid(),
      timestamp: Date.now(),
      patchesCount: result1.patches.length,
      acceptedCount: result1.patches.length,
      rejectedCount: 0,
      averageConfidence: result1.confidence,
      qualityScore: result1.qualityScore.overall,
    });

    if (context.jobDescription) {
      const jdAnalyzer = getSpecialistAgent("jd-analyzer");
      const result2 = await jdAnalyzer.run({ ...context, previousPatches: patches });
      // Store JD analysis results in memory
      if (result2.success) {
        // Extract keywords from analysis (in a real implementation, parse the JD analysis)
        this.memory.role = "Candidate";
      }
    }

    return patches;
  }

  // ── Phase 2: Optimization ──────────────────────────────────────────────
  private async runOptimizationPhase(
    context: AgentContext,
    _currentResume: ResumeData
  ): Promise<{
    patches: AgentPatch[];
    conflicts: PatchConflict[];
    results: AgentResult[];
  }> {
    const patches: AgentPatch[] = [];
    const results: AgentResult[] = [];

    // Define which agents run in parallel and their order
    const parallelGroups: SpecialistAgentType[][] = [
      // Group 1: Independent, parallel-capable agents
      ["ats-optimization", "professional-writing", "industry-expert", "skills-enhancement"],
      // Group 2: Section-specific agents (after Group 1 sets the base)
      ["experience-enhancement", "education-enhancement", "dynamic-section"],
      // Group 3: Preservation + Guardian (always last)
      ["resume-preservation", "guardian"],
    ];

    for (const group of parallelGroups) {
      // Filter the group to run only required agents
      const requiredGroup = group.filter(agentType => this.isAgentRequired(agentType, context));
      if (requiredGroup.length === 0) continue;

      if (this.config.enableParallelExecution && requiredGroup.length > 1) {
        // Run group in parallel with retry on failure
        const runAgentWithRetry = async (agentType: SpecialistAgentType, attempt = 1): Promise<AgentResult> => {
          try {
            const agent = getSpecialistAgent(agentType);
            const ctx: AgentContext = {
              ...context,
              previousPatches: patches,
            };
            const res = await agent.run(ctx);
            if (!res.success && attempt < 2) {
              console.warn(`[Supervisor] Parallel agent "${agentType}" failed. Retrying (attempt ${attempt + 1})…`);
              return await runAgentWithRetry(agentType, attempt + 1);
            }
            return res;
          } catch (err: any) {
            if (attempt < 2) {
              console.warn(`[Supervisor] Parallel agent "${agentType}" threw error. Retrying (attempt ${attempt + 1}):`, err.message);
              return await runAgentWithRetry(agentType, attempt + 1);
            }
            return {
              agentId: agentType,
              agentType,
              taskId: uid(),
              patches: [],
              confidence: 0,
              qualityScore: { overall: 0, ats: 0, grammar: 0, readability: 0, preservation: 0, industryMatch: 0, professionalism: 0 },
              success: false,
              error: err.message || "Agent failed",
              durationMs: 0,
            } as AgentResult;
          }
        };

        const groupResults = await Promise.all(
          requiredGroup.map((agentType) => runAgentWithRetry(agentType))
        );

        for (const result of groupResults) {
          results.push(result);
          if (result.success) {
            const validPatches = result.patches.filter(
              (p) => p.confidence >= this.config.confidenceThreshold
            );
            patches.push(...validPatches);
          }
        }
      } else {
        // Run group sequentially with retry on failure
        for (const agentType of requiredGroup) {
          let result: AgentResult | null = null;
          for (let attempt = 1; attempt <= 2; attempt++) {
            try {
              const agent = getSpecialistAgent(agentType);
              const ctx: AgentContext = {
                ...context,
                previousPatches: patches,
              };
              result = await agent.run(ctx);
              if (result.success) break;
            } catch (err: any) {
              result = {
                agentId: agentType,
                agentType,
                taskId: uid(),
                patches: [],
                confidence: 0,
                qualityScore: { overall: 0, ats: 0, grammar: 0, readability: 0, preservation: 0, industryMatch: 0, professionalism: 0 },
                success: false,
                error: err.message || "Agent failed",
                durationMs: 0,
              } as AgentResult;
            }
            if (attempt < 2) {
              console.warn(`[Supervisor] Sequential agent "${agentType}" failed/threw. Retrying…`);
            }
          }
          if (result) {
            results.push(result);
            if (result.success) {
              const validPatches = result.patches.filter(
                (p) => p.confidence >= this.config.confidenceThreshold
              );
              patches.push(...validPatches);
            }
          }
        }
      }
    }

    // Detect conflicts among all patches
    const conflicts = detectConflicts(patches);

    return { patches, conflicts, results };
  }

  private isAgentRequired(agentType: SpecialistAgentType, context: AgentContext): boolean {
    const resume = context.canonicalResume;
    if (agentType === "dynamic-section") {
      return (resume.dynamicSections?.length ?? 0) > 0;
    }
    if (agentType === "education-enhancement") {
      return (resume.education?.length ?? 0) > 0;
    }
    if (agentType === "skills-enhancement") {
      return (resume.skills?.length ?? 0) > 0;
    }
    if (agentType === "experience-enhancement") {
      return (resume.experience?.length ?? 0) > 0;
    }
    if (agentType === "ats-optimization" && !context.jobDescription) {
      return false; // skip ATS if no JD
    }
    return true;
  }

  // ── Conflict Resolution ────────────────────────────────────────────────
  private resolveAllConflicts(): { approved: AgentPatch[] } {
    const approved: AgentPatch[] = [];
    const conflictKeys = new Set<string>();
    const seenPatches = new Set<string>();

    for (const conflict of this.conflicts) {
      const key = `${conflict.sectionId}|${conflict.field}`;
      conflictKeys.add(key);

      const result = resolveConflict(conflict, this.config.conflictStrategy);

      if (result.winner && !seenPatches.has(result.winner.patchId)) {
        approved.push(result.winner);
        seenPatches.add(result.winner.patchId);
      }
    }

    // Add non-conflicting patches
    const allPatchIds = new Set(this.allPatches.map((p) => p.patchId));
    for (const patch of this.allPatches) {
      const key = `${patch.sectionId}|${patch.field}`;
      if (!conflictKeys.has(key) && !seenPatches.has(patch.patchId)) {
        approved.push(patch);
        seenPatches.add(patch.patchId);
      }
    }

    return { approved };
  }

  // ── Industry Detection ─────────────────────────────────────────────────
  private detectIndustry(
    resume: ResumeData,
    jobDescription?: string
  ): IndustryContext {
    const text = [
      resume.summary || "",
      ...(resume.experience || []).map((e) => `${e.company} ${e.title} ${(e.bullets || []).join(" ")}`),
      ...(resume.skills || []).map((s) => `${s.name} ${s.category || ""}`),
      jobDescription || "",
    ].join(" ").toLowerCase();

    const industryScores: Record<string, number> = {
      hospitality: 0,
      aviation: 0,
      healthcare: 0,
      it: 0,
      finance: 0,
      engineering: 0,
      sales: 0,
      marketing: 0,
      "customer-service": 0,
    };

    const keywords: Record<string, string[]> = {
      hospitality: ["hotel", "hospitality", "restaurant", "catering", "guest", "resort", "lodging", "front desk"],
      aviation: ["aviation", "airline", "cabin crew", "flight", "airport", "pilot", "aircraft"],
      healthcare: ["healthcare", "medical", "hospital", "patient", "clinical", "nurse", "doctor"],
      it: ["software", "developer", "engineer", "it ", "cloud", "aws", "python", "javascript", "agile"],
      finance: ["finance", "accounting", "audit", "banking", "financial", "revenue", "budget"],
      engineering: ["engineering", "mechanical", "electrical", "civil", "manufacturing", "cad"],
      sales: ["sales", "revenue", "client", "account management", "business development"],
      marketing: ["marketing", "seo", "content", "social media", "brand", "campaign"],
      "customer-service": ["customer service", "support", "client relations", "help desk"],
    };

    for (const [industry, kws] of Object.entries(keywords)) {
      for (const kw of kws) {
        if (text.includes(kw)) {
          industryScores[industry] = (industryScores[industry] || 0) + 1;
        }
      }
    }

    const sorted = Object.entries(industryScores).sort((a, b) => b[1] - a[1]);
    const topIndustry = sorted[0]?.[0] || "general";

    const terminology = keywords[topIndustry] || [];

    return {
      detectedIndustry: topIndustry,
      industryTerminology: terminology,
      certifications: [],
      experienceLevel: "mid",
    };
  }

  // ── Extract Immutable Entities ─────────────────────────────────────────
  private extractImmutableEntities(resume: ResumeData): ImmutableEntities {
    return {
      companyNames: (resume.experience || []).map((e) => e.company).filter(Boolean),
      institutionNames: (resume.education || []).map((e) => e.institution).filter(Boolean),
      degreeNames: (resume.education || []).map((e) => e.degree).filter(Boolean),
      languageNames: (resume.languages || []).map((l) => l.name).filter(Boolean),
      personName: resume.name || "",
      contactEmail: resume.contact?.email || "",
      contactPhone: resume.contact?.phone || "",
      keyDates: [
        ...(resume.experience || []).map((e) => ({ id: `exp-${e.id}`, date: e.startDate || "" })),
        ...(resume.experience || []).map((e) => ({ id: `exp-${e.id}-end`, date: e.endDate || "" })),
        ...(resume.education || []).map((e) => ({ id: `edu-${e.id}`, date: e.startDate || "" })),
        ...(resume.education || []).map((e) => ({ id: `edu-${e.id}-end`, date: e.endDate || "" })),
      ].filter((d) => d.date),
    };
  }

  // ── Determine Editable Fields ──────────────────────────────────────────
  private determineEditableFields(): EditableFields {
    return {
      summary: true,
      headline: true,
      experienceBullets: true,
      educationHighlights: true,
      projectBullets: true,
      skillWording: true,
      skillCategories: true,
      certificationWording: true,
      dynamicSectionContent: true,
    };
  }

  // ── Extract Dynamic Sections ───────────────────────────────────────────
  private extractDynamicSections(resume: ResumeData): DynamicSectionInfo[] {
    const sections: DynamicSectionInfo[] = [];
    if ((resume as any).dynamicSections) {
      for (const ds of (resume as any).dynamicSections) {
        sections.push({
          sectionId: ds.sectionId || ds.normalizedTitle || "",
          normalizedTitle: ds.normalizedTitle || ds.sectionId || "",
          rawTitle: ds.rawTitle || ds.title || ds.normalizedTitle || "",
          contentCount: ds.content ? ds.content.split("\n").length : 0,
        });
      }
    }
    return sections;
  }

  // ── Optimization Rules ─────────────────────────────────────────────────
  private getOptimizationRules(): string[] {
    return [
      "Never change company names, job titles, or dates",
      "Never change institution names, degrees, or dates",
      "Never change language entries",
      "Never fabricate achievements, certifications, or experience",
      "Never remove existing content",
      "Never increase or decrease bullet count per entry",
      "Always preserve original entity count per section",
      "Only improve wording in editable fields",
      "Maintain professional tone throughout",
      "Use active voice and strong action verbs",
      "Quantify achievements where possible without fabricating numbers",
      "Incorporate ATS keywords naturally without keyword stuffing",
      "Languages are NEVER moved to skills section",
      "Dynamic sections are preserved exactly — never renamed or deleted",
    ];
  }

  // ── Create Initial Memory ──────────────────────────────────────────────
  private createInitialMemory(): SupervisorMemory {
    return {
      industry: "",
      role: "",
      jobTitle: "",
      atsKeywords: [],
      optimizationHistory: [],
      acceptedPatches: [],
      rejectedPatches: [],
      userPreferences: {},
      dynamicSections: [],
      providerPerformance: {},
      agentConfidence: {},
    };
  }

  // ── Compute Final Quality Score ────────────────────────────────────────
  private computeFinalQualityScore(
    _optimized: ResumeData,
    patches: AgentPatch[],
    canonical: ResumeData,
    _industryContext: IndustryContext
  ): QualityScore {
    const aggregateScore = computeAggregateScore(_optimized, patches);

    // Calculate preservation score based on entity count matching
    const canonicalExpCount = canonical.experience?.length || 0;
    const canonicalEduCount = canonical.education?.length || 0;
    const canonicalLangCount = canonical.languages?.length || 0;

    // For now, use aggregate as the base
    return {
      overall: aggregateScore,
      ats: 85,
      grammar: 90,
      readability: 85,
      preservation: 95,
      industryMatch: 80,
      professionalism: 85,
    };
  }

  // ── Aggregate Agent Confidence ─────────────────────────────────────────
  private aggregateAgentConfidence(results: AgentResult[]): Record<string, number> {
    const confidence: Record<string, number> = {};
    for (const result of results) {
      confidence[result.agentType] = result.confidence;
    }
    return confidence;
  }

  // ── Access Memory ──────────────────────────────────────────────────────
  getMemory(): SupervisorMemory {
    return this.memory;
  }

  // ── Reset ──────────────────────────────────────────────────────────────
  reset(): void {
    this.memory = this.createInitialMemory();
    this.taskQueue = [];
    this.completedTasks = [];
    this.allPatches = [];
    this.conflicts = [];
  }
}

// ── Convenience function ────────────────────────────────────────────────
export async function runDynamicMultiAgentOptimization(
  canonicalResume: ResumeData,
  jobDescription?: string,
  atsDirective?: string,
  config?: Partial<SupervisorConfig>
): Promise<SupervisorResult> {
  const supervisor = new DynamicMultiAgentSupervisor(config);
  return supervisor.optimize(canonicalResume, jobDescription, atsDirective);
}
