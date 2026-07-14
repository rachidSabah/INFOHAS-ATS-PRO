"use client";

import { recordAI, setFlightScope } from "@/lib/ai/flight-recorder";
setFlightScope({ scope: "interview", feature: "Interview Plugin", module: "src.lib.plugin-sdk.plugins.interview-plugin" });

// Plugin SDK — Interview Prep Plugin
// ============================================================================


import type { AgentPlugin } from "../interfaces/plugin";
import type { ServiceContainer } from "../service-container";
import type { PluginManifest, HealthStatus } from "../types";
import type { PipelineContext } from "../types";
import { callAI } from "../../ai";

export class InterviewPlugin implements AgentPlugin {
  readonly id = "agent.interview";
  readonly manifest: PluginManifest = {
    id: "agent.interview",
    name: "Interview Prep Agent",
    version: "1.0.0",
    author: "ResumeAI Pro",
    description: "Generates tailored mock interview questions and answers.",
    capabilities: ["interview-questions-generation"],
    dependencies: [],
    entry: "./interview-plugin.ts",
    configuration: { type: "object", properties: {} },
    permissions: [],
  };

  async initialize(ctx: ServiceContainer): Promise<void> {
    console.info("[InterviewPlugin] Initialized.");
  }

  async shutdown(): Promise<void> {
    console.info("[InterviewPlugin] Shutdown.");
  }

  async healthCheck(): Promise<HealthStatus> {
    return "healthy";
  }

  async run(ctx: PipelineContext): Promise<PipelineContext> {
    const resume = ctx.resume;
    const jd = ctx.directive.jobDescription || "";
    const company = ctx.directive.targetCompany || "the company";
    const jobTitle = ctx.directive.targetJobTitle || "the role";

    const candidateSummary = `${resume.name}${resume.headline ? `, ${resume.headline}` : ""}`;
    const experienceSummary = resume.experience.slice(0, 3).map((e) => `${e.title} at ${e.company}`).join("; ");
    const skillsSummary = resume.skills.slice(0, 10).map((s) => s.name).join(", ");
    const jobSummary = jd.slice(0, 800);

    const result = await recordAI({
      systemPrompt: `You are an expert interview coach. Generate a tailored interview package based on the candidate's background and the target job description. Output MUST be valid JSON (no markdown formatting, no prefix/suffix text) representing a list of questions.`,
      userPrompt: `Generate exactly 9 interview questions (3 behavioral, 3 technical, 2 situational, 1 company-fit). For each question, provide:
- question: the question text
- category: "behavioral", "technical", "situational", or "company-fit"
- purpose: what this question evaluates
- modelAnswer: a stellar response matching candidate experience

CANDIDATE: ${candidateSummary}
EXPERIENCE: ${experienceSummary}
KEY SKILLS: ${skillsSummary}

TARGET ROLE: ${jobTitle} at ${company}
JOB REQUIREMENTS: ${jobSummary}

JSON Output structure:
[
  { "question": "...", "category": "...", "purpose": "...", "modelAnswer": "..." }
]`,
      maxTokens: 1500,
      taskCategory: "document",
    });

    if (result && result.text) {
      try {
        const parsed = JSON.parse(result.text);
        ctx.metadata.interviewQuestions = parsed;
      } catch (err) {
        console.warn("[InterviewPlugin] AI did not return JSON. Trying fallback parse:", err);
      }
    }
    return ctx;
  }
}
