/**
 * ============================================================================
 * AgentBrain — Universal Agentic Engine for INFOHAS ATS PRO
 * ============================================================================
 * 
 * Provides Claude/Gemini/DeepSeek-level agentic capabilities to:
 *   - AI Copilot Panel
 *   - Resume Optimizer
 *   - Resume Builder
 * 
 * Architecture (ReAct-style: Reason → Act → Observe → Repeat):
 *   1. PLAN  — Break task into sub-goals with dependency graph
 *   2. THINK — Emit streaming thought tokens (visible to user)
 *   3. ACT   — Call tool (AI sub-agent, scorer, validator, patcher)
 *   4. OBSERVE — Parse tool result, update working memory
 *   5. REFLECT — Self-critique the output, decide to iterate or stop
 *   6. EMIT — Stream the final structured patch to the UI
 * 
 * Tools available to the brain:
 *   - analyzeATS(resume, jd)           → ATSReport
 *   - scoreSection(section, text, jd)  → SectionScore
 *   - patchSummary(text, jd)           → string
 *   - patchExperience(entries, jd)     → ExperienceEntry[]
 *   - patchEducation(entries)          → EducationEntry[]
 *   - patchSkills(skills, jd)          → SkillEntry[]
 *   - validateOutput(resume, original) → ValidationResult
 *   - reflectOnDiff(before, after)     → ReflectionReport
 * 
 * Streaming model:
 *   - onThought(text)    → Real-time reasoning (like o1 / DeepSeek-R1)
 *   - onToolCall(name)   → Tool being executed
 *   - onObservation(obs) → Tool result observation
 *   - onPatch(patch)     → Partial resume patch to apply live
 *   - onComplete(result) → Final complete result
 *   - onError(err)       → Error with recovery suggestion
 * 
 * ============================================================================
 */

"use client";

import { recordAI } from "@/lib/ai/flight-recorder";
import { callAI, extractJSON, getOptimizerDirective } from "@/lib/ai";
import type { ResumeData, JobDescription, ResumeSkill } from "@/lib/types";
import { analyzeATS } from "@/lib/agents/ats-analysis";

// ─── Streaming event types ────────────────────────────────────────────────────

export type AgentThoughtType =
  | "thinking"    // internal reasoning (like <thinking> in Claude)
  | "planning"    // task decomposition
  | "tool_call"   // invoking a tool
  | "observation" // tool result
  | "reflection"  // self-critique
  | "decision"    // choosing next action
  | "patch"       // partial result ready
  | "complete"    // all done
  | "error";      // failure

export interface AgentThought {
  id: string;
  type: AgentThoughtType;
  text: string;
  timestamp: number;
  toolName?: string;
  data?: any;
}

export interface AgentCallbacks {
  onThought?: (thought: AgentThought) => void;
  onPatch?: (patch: Partial<ResumeData>) => void;
  onComplete?: (result: AgentBrainResult) => void;
  onError?: (error: string) => void;
}

export interface AgentBrainResult {
  resume: ResumeData;
  thoughts: AgentThought[];
  atsScore: number;
  iterations: number;
  toolsUsed: string[];
  totalTimeMs: number;
  improvements: string[];
}

export interface AgentBrainOptions {
  task: "optimize" | "enhance_section" | "fill_page" | "build" | "analyze";
  targetSection?: "summary" | "experience" | "education" | "skills" | "all";
  resume: ResumeData;
  originalResume?: ResumeData;
  jobDescription?: JobDescription | null;
  maxIterations?: number;
  directive?: string;
  callbacks: AgentCallbacks;
}

// ─── Tool registry ────────────────────────────────────────────────────────────

interface ToolResult {
  success: boolean;
  data: any;
  observation: string;
}

// ─── ID helper ────────────────────────────────────────────────────────────────

let _seq = 0;
function thoughtId(): string {
  return `t-${Date.now()}-${++_seq}`;
}

// ─── Main AgentBrain class ────────────────────────────────────────────────────

export class AgentBrain {
  private thoughts: AgentThought[] = [];
  private toolsUsed: string[] = [];
  private improvements: string[] = [];
  private startTime: number = 0;

  constructor(private opts: AgentBrainOptions) {}

  // ─── Emit helpers ──────────────────────────────────────────────────────────

  private emit(type: AgentThoughtType, text: string, data?: any, toolName?: string): AgentThought {
    const thought: AgentThought = {
      id: thoughtId(),
      type,
      text,
      timestamp: Date.now(),
      toolName,
      data,
    };
    this.thoughts.push(thought);
    this.opts.callbacks.onThought?.(thought);
    return thought;
  }

  private think(text: string) { return this.emit("thinking", text); }
  private plan(text: string)  { return this.emit("planning", text); }
  private decide(text: string){ return this.emit("decision", text); }
  private reflect(text: string, data?: any){ return this.emit("reflection", text, data); }

  private async callTool(name: string, fn: () => Promise<ToolResult>): Promise<ToolResult> {
    this.emit("tool_call", `Invoking ${name}...`, undefined, name);
    this.toolsUsed.push(name);
    try {
      const result = await fn();
      this.emit("observation", result.observation, result.data, name);
      return result;
    } catch (err: any) {
      const errMsg = `Tool ${name} failed: ${err.message}`;
      this.emit("error", errMsg);
      return { success: false, data: null, observation: errMsg };
    }
  }

  // ─── Tool implementations ──────────────────────────────────────────────────

  private async toolAnalyzeATS(resume: ResumeData, jd?: JobDescription | null): Promise<ToolResult> {
    return this.callTool("ATS Analyzer", async () => {
      const report = analyzeATS(resume, jd);
      return {
        success: true,
        data: report,
        observation: `ATS Score: ${report.scores.ats}/100. Missing keywords: ${(report.missingKeywords || []).slice(0, 5).join(", ") || "none"}. Weak sections: ${(report.weakSections || []).slice(0, 3).join(", ") || "none"}.`,
      };
    });
  }

  private async toolPatchSummary(
    currentSummary: string,
    jd?: JobDescription | null,
    instruction?: string
  ): Promise<ToolResult> {
    return this.callTool("Summary Patcher", async () => {
      const jdContext = jd
        ? `Target role: ${jd.title} at ${jd.company || "company"}. Keywords: ${(jd.keywords || []).slice(0, 12).join(", ")}.`
        : "General professional resume";

      const directive = getOptimizerDirective();
      const prompt = `You are an elite ATS resume writer specializing in executive-level resumes with frontier-level AI intelligence.

TASK: ${instruction || "Enhance this professional summary for maximum ATS impact and executive presence."}
CONTEXT: ${jdContext}

GLOBAL OPTIMIZATION DIRECTIVE:
${directive}

CURRENT SUMMARY:
"${currentSummary}"

REQUIREMENTS:
- 4-6 powerful sentences with executive-level language
- Start with a strong professional identity statement
- Include measurable achievements and impact
- Naturally embed ATS keywords from the job context
- Use active voice throughout
- NO markdown, NO asterisks, NO quotes in output
- Return ONLY the enhanced summary text`;

      const res = await recordAI({
        systemPrompt: "You are an elite resume writer. Return ONLY plain text, no markdown.",
        userPrompt: prompt,
        maxTokens: 700,
        temperature: 0.28,
        taskCategory: "document",
        agentType: "optimizer",
      });

      const cleaned = (res.text || "").replace(/^["']|["']$/g, "").replace(/\*\*([^*]+)\*\*/g, "$1").replace(/\*([^*]+)\*/g, "$1").trim();
      return {
        success: !!cleaned,
        data: cleaned,
        observation: `Summary enhanced: ${cleaned.length} characters, ${cleaned.split(". ").length} sentences.`,
      };
    });
  }

  private async toolPatchExperience(
    experience: ResumeData["experience"],
    jd?: JobDescription | null,
    targetCount = 5
  ): Promise<ToolResult> {
    return this.callTool("Experience Enhancer", async () => {
      const jdContext = jd
        ? `Role: ${jd.title}. Keywords: ${(jd.keywords || []).slice(0, 12).join(", ")}.`
        : "General professional";

      const expSlim = experience.slice(0, 4).map((e) => ({
        id: e.id,
        title: e.title,
        company: e.company,
        bullets: e.bullets,
      }));

      const directive = getOptimizerDirective();
      const prompt = `You are an elite ATS resume writer with frontier-level AI intelligence.

TASK: Enhance ALL experience bullet points to be highly quantified and ATS-optimized.
CONTEXT: ${jdContext}

GLOBAL OPTIMIZATION DIRECTIVE:
${directive}

CURRENT EXPERIENCE:
${JSON.stringify(expSlim, null, 2)}

REQUIREMENTS:
- At least ${targetCount} bullets per role (add new ones if fewer exist)
- Every bullet starts with a STRONG action verb (Spearheaded, Orchestrated, Delivered, etc.)
- Add quantified metrics where contextually plausible (%, numbers, team sizes)
- Naturally inject job keywords
- NEVER invent fake company names, dates, or certifications
- Return ONLY valid JSON: [{"id":"...","bullets":["bullet1","bullet2",...]}]`;

      const res = await recordAI({
        systemPrompt: "You are an elite resume writer. Return ONLY valid JSON array. No markdown.",
        userPrompt: prompt,
        maxTokens: 3500,
        temperature: 0.28,
        taskCategory: "document",
        agentType: "optimizer",
      });

      const jsonStr = (res.text || "").replace(/```json|```/g, "").trim();
      const data = JSON.parse(jsonStr);

      if (!Array.isArray(data)) throw new Error("Expected JSON array");

      let totalNew = 0;
      const result = experience.map((e) => {
        const match = data.find((x: any) => x.id === e.id);
        if (match) { totalNew += (match.bullets?.length || 0) - e.bullets.length; }
        return match ? { ...e, bullets: match.bullets } : e;
      });

      return {
        success: true,
        data: result,
        observation: `Experience enhanced: ${data.length} roles updated. Added ~${Math.max(0, totalNew)} new bullet points.`,
      };
    });
  }

  private async toolPatchEducation(
    education: ResumeData["education"],
    jd?: JobDescription | null
  ): Promise<ToolResult> {
    return this.callTool("Education Modules Enhancer", async () => {
      const jdContext = jd ? `Target role: ${jd.title}. Context: ${(jd.keywords || []).slice(0, 8).join(", ")}.` : "";

      const eduSlim = education.map((e) => ({
        id: e.id,
        degree: e.degree,
        field: e.field,
        institution: e.institution,
        highlights: e.highlights,
      }));

      const prompt = `You are an expert academic resume writer.

TASK: Enhance education entries with comprehensive, relevant module highlights.
${jdContext}

CURRENT EDUCATION:
${JSON.stringify(eduSlim, null, 2)}

REQUIREMENTS:
- For each entry, generate 8-12 highly relevant modules/subjects
- Format as a single comma-separated string of module names
- Modules should be relevant to the degree AND the target role
- Keep degree names, institutions UNCHANGED
- Return ONLY JSON: [{"id":"...","highlights":["Module1, Module2, Module3, ..."]}]`;

      const res = await recordAI({
        systemPrompt: "You are an expert resume writer. Return ONLY valid JSON array.",
        userPrompt: prompt,
        maxTokens: 1200,
        temperature: 0.3,
        taskCategory: "document",
        agentType: "optimizer",
      });

      const jsonStr = (res.text || "").replace(/```json|```/g, "").trim();
      const data = JSON.parse(jsonStr);

      if (!Array.isArray(data)) throw new Error("Expected JSON array");

      const result = education.map((e) => {
        const match = data.find((x: any) => x.id === e.id);
        return match ? { ...e, highlights: match.highlights } : e;
      });

      return {
        success: true,
        data: result,
        observation: `Education enhanced: ${data.length} entries with module highlights added.`,
      };
    });
  }

  private async toolPatchSkills(
    skills: ResumeData["skills"],
    jd?: JobDescription | null
  ): Promise<ToolResult> {
    return this.callTool("Skills ATS Optimizer", async () => {
      const currentSkillNames = skills.map((s) => s.name);
      const jdKeywords = (jd?.keywords || []).filter((k) => !currentSkillNames.some((s) => s.toLowerCase().includes(k.toLowerCase())));

      if (jdKeywords.length === 0) {
        return { success: true, data: skills, observation: "All JD keywords already present in skills section." };
      }

      // Group by most common category
      const catCounts: Record<string, number> = {};
      for (const s of skills) { if (s.category) catCounts[s.category] = (catCounts[s.category] || 0) + 1; }
      const bestCat = Object.entries(catCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || "Core Competencies";

      const newSkills: ResumeSkill[] = jdKeywords.slice(0, 8).map((name, i) => ({
        id: `skill-ats-${Date.now()}-${i}`,
        name,
        category: bestCat,
      }));

      const result = [...skills, ...newSkills];
      return {
        success: true,
        data: result,
        observation: `Skills enhanced: added ${newSkills.length} missing ATS keywords (${newSkills.map((s) => s.name).join(", ")}).`,
      };
    });
  }

  private async toolReflect(
    before: Partial<ResumeData>,
    after: Partial<ResumeData>,
    atsScoreBefore: number,
    atsScoreAfter: number,
    directive?: string
  ): Promise<ToolResult> {
    return this.callTool("Self-Reflection Engine", async () => {
      const improvementPct = atsScoreAfter - atsScoreBefore;
      const prompt = `You are a senior resume QA specialist performing self-reflection on an optimization pass.

ATS Score: ${atsScoreBefore} → ${atsScoreAfter} (${improvementPct >= 0 ? "+" : ""}${improvementPct} points)
Directive: ${directive || "General ATS optimization"}

Analyze the optimization quality and answer:
1. Was the optimization successful? (yes/partial/no)
2. What was improved most effectively?
3. What still needs improvement?
4. Is another optimization iteration needed? (yes/no)
5. Confidence score (0-100)

Respond with ONLY JSON:
{
  "success": "yes"|"partial"|"no",
  "improved": ["item1","item2"],
  "gaps": ["gap1","gap2"],
  "needsIteration": true|false,
  "confidence": 85,
  "summary": "one sentence summary"
}`;

      const res = await recordAI({
        systemPrompt: "You are a resume QA specialist. Return ONLY valid JSON.",
        userPrompt: prompt,
        maxTokens: 400,
        temperature: 0.2,
        taskCategory: "document",
        agentType: "supervisor",
      });

      const jsonStr = (res.text || "").replace(/```json|```/g, "").trim();
      const data = JSON.parse(jsonStr);

      return {
        success: true,
        data,
        observation: `Reflection: ${data.summary}. Needs iteration: ${data.needsIteration}. Confidence: ${data.confidence}%.`,
      };
    });
  }

  // ─── Main execution loop (ReAct pattern) ──────────────────────────────────

  async run(): Promise<AgentBrainResult> {
    this.startTime = Date.now();
    const {
      task,
      targetSection,
      resume,
      originalResume,
      jobDescription,
      maxIterations = 3,
      directive,
    } = this.opts;

    let currentResume = JSON.parse(JSON.stringify(resume)) as ResumeData;
    let iteration = 0;

    try {
      // ── PHASE 1: PLAN ────────────────────────────────────────────────────
      this.plan(`Task: ${task}${targetSection ? ` → ${targetSection}` : ""}. Building execution plan...`);

      const atsInitial = analyzeATS(currentResume, jobDescription);
      this.think(`Initial ATS score: ${atsInitial.scores.ats}/100. Gap: ${Math.max(0, 85 - atsInitial.scores.ats)} points to target. Missing: ${(atsInitial.missingKeywords || []).slice(0, 5).join(", ") || "none"}.`);

      // Determine which tools to run based on task
      const toolPlan = this.buildToolPlan(task, targetSection, atsInitial.scores.ats);
      this.plan(`Execution plan: ${toolPlan.join(" → ")}`);

      // ── PHASE 2: EXECUTE TOOLS ───────────────────────────────────────────
      for (const toolName of toolPlan) {
        this.decide(`Executing: ${toolName}`);

        if (toolName === "patch_summary" && (targetSection === "summary" || targetSection === "all" || !targetSection)) {
          const result = await this.toolPatchSummary(currentResume.summary || "", jobDescription, directive);
          if (result.success && result.data) {
            currentResume = { ...currentResume, summary: result.data };
            this.improvements.push("Summary rewritten with executive language + ATS keywords");
            this.opts.callbacks.onPatch?.({ summary: result.data });
          }
        }

        else if (toolName === "patch_experience" && (targetSection === "experience" || targetSection === "all" || !targetSection)) {
          const result = await this.toolPatchExperience(currentResume.experience, jobDescription);
          if (result.success && result.data) {
            currentResume = { ...currentResume, experience: result.data };
            this.improvements.push("Experience bullets expanded with quantified achievements");
            this.opts.callbacks.onPatch?.({ experience: result.data });
          }
        }

        else if (toolName === "patch_education" && (targetSection === "education" || targetSection === "all" || !targetSection)) {
          const result = await this.toolPatchEducation(currentResume.education, jobDescription);
          if (result.success && result.data) {
            currentResume = { ...currentResume, education: result.data };
            this.improvements.push("Education module highlights added");
            this.opts.callbacks.onPatch?.({ education: result.data });
          }
        }

        else if (toolName === "patch_skills" && (targetSection === "skills" || targetSection === "all" || !targetSection)) {
          const result = await this.toolPatchSkills(currentResume.skills, jobDescription);
          if (result.success && result.data) {
            currentResume = { ...currentResume, skills: result.data };
            this.improvements.push(`Skills section expanded with ${result.data.length - resume.skills.length} ATS keywords`);
            this.opts.callbacks.onPatch?.({ skills: result.data });
          }
        }

        else if (toolName === "analyze_ats") {
          await this.toolAnalyzeATS(currentResume, jobDescription);
        }
      }

      // ── PHASE 3: REFLECT ─────────────────────────────────────────────────
      const atsAfter = analyzeATS(currentResume, jobDescription);
      this.think(`Post-optimization ATS: ${atsAfter.scores.ats}/100 (was ${atsInitial.scores.ats}/100, +${atsAfter.scores.ats - atsInitial.scores.ats} pts).`);

      iteration++;

      // Self-reflection loop (max 2 more iterations if needed)
      while (iteration < maxIterations) {
        const reflResult = await this.toolReflect(
          { summary: resume.summary },
          { summary: currentResume.summary },
          atsInitial.scores.ats,
          atsAfter.scores.ats,
          directive
        );

        if (!reflResult.data?.needsIteration) {
          this.reflect(`Reflection satisfied: ${reflResult.data?.summary || "output quality confirmed"}. Stopping iterations.`);
          break;
        }

        this.reflect(`Iteration ${iteration + 1} needed: ${reflResult.data?.gaps?.join(", ") || "gaps found"}.`);

        // Quick targeted improvement in next iteration
        if ((reflResult.data?.gaps || []).some((g: string) => g.toLowerCase().includes("summary"))) {
          const r = await this.toolPatchSummary(currentResume.summary || "", jobDescription, `Iteration ${iteration + 1}: ${reflResult.data.gaps.join(". ")}`);
          if (r.success && r.data) {
            currentResume = { ...currentResume, summary: r.data };
            this.opts.callbacks.onPatch?.({ summary: r.data });
          }
        }

        iteration++;
      }

      // ── PHASE 4: FINALIZE ─────────────────────────────────────────────────
      const finalAts = analyzeATS(currentResume, jobDescription);
      const totalMs = Date.now() - this.startTime;

      this.emit("complete", `✅ Optimization complete in ${iteration} iteration(s). ATS: ${atsInitial.scores.ats} → ${finalAts.scores.ats}. ${this.improvements.length} improvements applied.`, {
        atsScore: finalAts.scores.ats,
        improvements: this.improvements,
      });

      const finalResult: AgentBrainResult = {
        resume: currentResume,
        thoughts: this.thoughts,
        atsScore: finalAts.scores.ats,
        iterations: iteration,
        toolsUsed: [...new Set(this.toolsUsed)],
        totalTimeMs: totalMs,
        improvements: this.improvements,
      };

      this.opts.callbacks.onComplete?.(finalResult);
      return finalResult;

    } catch (err: any) {
      const errMsg = err.message || "Unknown error in AgentBrain";
      this.emit("error", `Fatal error: ${errMsg}`);
      this.opts.callbacks.onError?.(errMsg);

      return {
        resume: currentResume,
        thoughts: this.thoughts,
        atsScore: 0,
        iterations: iteration,
        toolsUsed: this.toolsUsed,
        totalTimeMs: Date.now() - this.startTime,
        improvements: this.improvements,
      };
    }
  }

  // ─── Plan builder: decide which tools to run ──────────────────────────────

  private buildToolPlan(
    task: string,
    targetSection?: string,
    currentScore: number = 70
  ): string[] {
    if (task === "analyze") return ["analyze_ats"];

    if (task === "enhance_section") {
      const map: Record<string, string[]> = {
        summary: ["patch_summary"],
        experience: ["patch_experience"],
        education: ["patch_education"],
        skills: ["patch_skills"],
        all: ["analyze_ats", "patch_summary", "patch_experience", "patch_education", "patch_skills"],
      };
      return map[targetSection || "all"] || ["analyze_ats"];
    }

    if (task === "fill_page") {
      return ["patch_summary", "patch_experience", "patch_education", "patch_skills", "analyze_ats"];
    }

    if (task === "build") {
      return ["analyze_ats", "patch_summary", "patch_skills", "patch_experience"];
    }

    // Default "optimize" — prioritize weakest areas
    const plan: string[] = ["analyze_ats"];
    if (currentScore < 85) plan.push("patch_skills");     // quickest ATS win
    plan.push("patch_summary", "patch_experience");
    if (currentScore < 75) plan.push("patch_education");  // only if score is low
    return plan;
  }
}

// ─── Convenience factory ──────────────────────────────────────────────────────

export async function runAgentBrain(opts: AgentBrainOptions): Promise<AgentBrainResult> {
  const brain = new AgentBrain(opts);
  return brain.run();
}
