// ============================================================================
// Plugin SDK — Cover Letter Plugin
// ============================================================================

"use client";

import type { AgentPlugin } from "../interfaces/plugin";
import type { ServiceContainer } from "../service-container";
import type { PluginManifest, HealthStatus } from "../types";
import type { PipelineContext } from "../types";
import { callAI } from "../../ai";

export class CoverLetterPlugin implements AgentPlugin {
  readonly id = "agent.cover-letter";
  readonly manifest: PluginManifest = {
    id: "agent.cover-letter",
    name: "Cover Letter Agent",
    version: "1.0.0",
    author: "ResumeAI Pro",
    description: "Generates custom cover letters using user resume and job description.",
    capabilities: ["cover-letter-generation"],
    dependencies: [],
    entry: "./cover-letter-plugin.ts",
    configuration: { type: "object", properties: {} },
    permissions: [],
  };

  async initialize(ctx: ServiceContainer): Promise<void> {
    console.info("[CoverLetterPlugin] Initialized.");
  }

  async shutdown(): Promise<void> {
    console.info("[CoverLetterPlugin] Shutdown.");
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

    const result = await callAI({
      systemPrompt: `You are a professional cover letter writer. Write a compelling, personalized cover letter of at least 400 words (minimum 2,500 characters). Structure: opening paragraph (hook + role interest), body (2-3 paragraphs matching experience to job requirements), closing (call to action). Plain text only — no headers, no markdown.`,
      userPrompt: `Write a full cover letter for the following:

CANDIDATE: ${candidateSummary}
EXPERIENCE: ${experienceSummary}
KEY SKILLS: ${skillsSummary}

TARGET ROLE: ${jobTitle} at ${company}
JOB REQUIREMENTS: ${jobSummary}

Instructions:
- Address to: "Dear Hiring Team" or "Dear ${company} Recruitment Team"
- Open by expressing genuine interest in ${jobTitle} at ${company}
- In the body, connect the candidate's experience to 2-3 specific job requirements
- Use professional, confident language — avoid generic phrases
- Close with a clear call to action requesting an interview
- Write at least 400 words

Write the complete cover letter now:`,
      maxTokens: 1200,
      taskCategory: "document",
    });

    if (result && result.text) {
      ctx.metadata.coverLetter = result.text;
    }
    return ctx;
  }
}
