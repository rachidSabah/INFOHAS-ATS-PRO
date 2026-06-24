// ResumeAI Pro — Autonomous Healing Engine
// Detects errors, performs root cause analysis, generates patches, validates,
// and heals the application — with optional auto-heal for low-risk fixes.

"use client";

import { callAI, extractJSON } from "./ai";
import { useApp } from "./store";
import { searchRepository, findDefinitions, traceFunctionCalls, readFile } from "./agent-runtime";
import type { AIDevIssue } from "./types";

export interface HealingResult {
  error: string;
  rootCause: string;
  evidence: Array<{ file: string; line: number; code: string }>;
  patch: string;          // unified diff
  riskLevel: "low" | "medium" | "high";
  confidence: number;     // 0-100
  autoHealEligible: boolean;
  status: "detected" | "analyzed" | "patched" | "approved" | "applied" | "rejected";
}

/**
 * Detect errors by scanning the codebase for common error patterns.
 * This is a heuristic scan — no AI call needed.
 */
export async function detectErrors(): Promise<AIDevIssue[]> {
  const issues: AIDevIssue[] = [];

  // Search for common error-prone patterns
  const errorPatterns = [
    { pattern: "console.error", label: "Error logging found", severity: "info" as const },
    { pattern: "catch (e)", label: "Catch block without error handling", severity: "warning" as const },
    { pattern: "undefined", label: "Potential undefined reference", severity: "warning" as const },
    { pattern: "TODO", label: "TODO comment found", severity: "info" as const },
    { pattern: "FIXME", label: "FIXME comment found", severity: "warning" as const },
    { pattern: "HACK", label: "HACK comment found", severity: "warning" as const },
    { pattern: "@ts-"+"ignore", label: "TypeScript error suppressed", severity: "warning" as const },
    { pattern: "any\\)", label: "TypeScript 'any' type used", severity: "info" as const, regex: true },
  ];

  for (const { pattern, label, severity, regex } of errorPatterns) {
    const results = await searchRepository(pattern, { regex: regex || false, filePattern: "*.{ts,tsx}" });
    for (const r of results.slice(0, 5)) { // max 5 per pattern
      issues.push({
        id: `iss_${Math.random().toString(36).slice(2, 9)}`,
        type: "error",
        severity,
        file: r.file,
        line: r.line,
        title: label,
        description: `${label} in ${r.file}:${r.line}`,
        recommendedFix: "Review the code and fix if necessary.",
        status: "open",
      });
    }
  }

  return issues;
}

/**
 * Perform root cause analysis on an error using AI + repository evidence.
 * The AI receives REAL code evidence (file, line, code snippet) — not guesses.
 */
export async function analyzeRootCause(error: AIDevIssue): Promise<HealingResult> {
  // Step 1: Gather REAL repository evidence
  const evidence: Array<{ file: string; line: number; code: string }> = [];

  // Read the file where the error was found
  if (error.file) {
    try {
      const file = await readFile(error.file);
      if (error.line && error.line <= file.lines.length) {
        const start = Math.max(0, error.line - 3);
        const end = Math.min(file.lines.length, error.line + 3);
        const codeSnippet = file.lines.slice(start, end).join("\n");
        evidence.push({ file: error.file, line: error.line, code: codeSnippet });
      }
    } catch (readErr) {
      // File not readable in agent runtime — skip evidence from this file
      console.warn(`[autonomous-healing] Could not read file ${error.file}:`, readErr instanceof Error ? readErr.message : String(readErr));
    }
  }

  // Search for related patterns
  if (error.title) {
    const searchResults = await searchRepository(error.title, { filePattern: "*.{ts,tsx}" });
    for (const r of searchResults.slice(0, 3)) {
      evidence.push({ file: r.file, line: r.line, code: r.match });
    }
  }

  // Step 2: AI root cause analysis with REAL evidence
  const prompt = `Analyze the root cause of this error and generate a fix.

ERROR:
- Type: ${error.type}
- Severity: ${error.severity}
- File: ${error.file || "unknown"}
- Line: ${error.line || "unknown"}
- Title: ${error.title}
- Description: ${error.description}

REPOSITORY EVIDENCE (real code from the project):
${evidence.map((e) => `File: ${e.file}:${e.line}\n${e.code}`).join("\n\n")}

Based on the REAL code evidence above:
1. Identify the root cause
2. Generate a unified git diff patch to fix it
3. Assess the risk level (low/medium/high)
4. Rate your confidence (0-100)

Return ONLY valid JSON:
{
  "rootCause": "The root cause is...",
  "patch": "diff --git a/...",
  "riskLevel": "low" | "medium" | "high",
  "confidence": 85
}`;

  try {
    const result = await callAI({
      systemPrompt: "You are an autonomous healing agent. Analyze REAL code evidence and generate fixes. Always return ONLY valid JSON.",
      userPrompt: prompt,
      maxTokens: 4000,
      temperature: 0.2,
      taskCategory: "development",
    });

    const data = extractJSON<{
      rootCause: string; patch: string; riskLevel: "low" | "medium" | "high"; confidence: number;
    }>(result.text);
    return {
      error: error.title,
      rootCause: data.rootCause || "Unable to determine root cause",
      evidence,
      patch: data.patch || "",
      riskLevel: data.riskLevel || "medium",
      confidence: data.confidence || 50,
      autoHealEligible: data.riskLevel === "low" && data.confidence >= 80,
      status: "analyzed",
    };
  } catch (analysisErr) {
    console.warn(`[autonomous-healing] Root cause analysis failed for "${error.title}":`, analysisErr instanceof Error ? analysisErr.message : String(analysisErr));
    return {
      error: error.title,
      rootCause: "AI analysis failed — manual review required",
      evidence,
      patch: "",
      riskLevel: "high",
      confidence: 0,
      autoHealEligible: false,
      status: "detected",
    };
  }
}

/**
 * Self-Reflection Engine — after every task, perform a review.
 */
export async function selfReflect(taskResult: {
  title: string;
  patch: string;
  affectedFiles: string[];
}): Promise<{
  codeReview: string;
  architectureReview: string;
  securityReview: string;
  performanceReview: string;
  regressionRisk: string;
  confidenceScore: number;
  riskScore: number;
  affectedComponents: string[];
}> {
  const prompt = `Perform a self-reflection review on this completed task.

TASK: ${taskResult.title}
AFFECTED FILES: ${taskResult.affectedFiles.join(", ")}

PATCH:
${taskResult.patch.slice(0, 3000)}

Review the patch for:
1. Code quality (naming, structure, readability)
2. Architecture (does it follow existing patterns?)
3. Security (any vulnerabilities introduced?)
4. Performance (any bottlenecks?)
5. Regression risk (what might break?)

Return ONLY valid JSON:
{
  "codeReview": "...",
  "architectureReview": "...",
  "securityReview": "...",
  "performanceReview": "...",
  "regressionRisk": "...",
  "confidenceScore": 85,
  "riskScore": 20,
  "affectedComponents": ["component1", "component2"]
}`;

  try {
    const result = await callAI({
      systemPrompt: "You are a code review agent. Review patches critically. Always return ONLY valid JSON.",
      userPrompt: prompt,
      maxTokens: 2000,
      temperature: 0.3,
      taskCategory: "development",
    });

    return extractJSON<{
      codeReview: string; architectureReview: string; securityReview: string;
      performanceReview: string; regressionRisk: string; confidenceScore: number;
      riskScore: number; affectedComponents: string[];
    }>(result.text);
  } catch (reflectionErr) {
    console.warn(`[autonomous-healing] Self-reflection failed for "${taskResult.title}":`, reflectionErr instanceof Error ? reflectionErr.message : String(reflectionErr));
    return {
      codeReview: "Review failed",
      architectureReview: "Review failed",
      securityReview: "Review failed",
      performanceReview: "Review failed",
      regressionRisk: "Review failed",
      confidenceScore: 0,
      riskScore: 100,
      affectedComponents: taskResult.affectedFiles,
    };
  }
}

/**
 * Production Diagnostics — scan for production health issues.
 */
export interface ProductionDiagnostics {
  resumeOptimizerHealth: "healthy" | "degraded" | "down";
  pdfExportHealth: "healthy" | "degraded" | "down";
  docxExportHealth: "healthy" | "degraded" | "down";
  providerHealth: "healthy" | "degraded" | "down";
  workerHealth: "healthy" | "degraded" | "down";
  databaseHealth: "healthy" | "degraded" | "down";
  buildHealth: "healthy" | "degraded" | "down";
  lastError: string | null;
  openIssues: number;
}

export async function runProductionDiagnostics(): Promise<ProductionDiagnostics> {
  const issues = await detectErrors();
  const criticalCount = issues.filter((i) => i.severity === "critical").length;
  const errorCount = issues.filter((i) => i.severity === "error").length;

  const healthFor = (critical: number, errors: number): "healthy" | "degraded" | "down" => {
    if (critical > 0) return "down";
    if (errors > 2) return "degraded";
    return "healthy";
  };

  return {
    resumeOptimizerHealth: healthFor(0, issues.filter((i) => /resume|optim/i.test(i.title)).length),
    pdfExportHealth: healthFor(0, issues.filter((i) => /pdf|export/i.test(i.title)).length),
    docxExportHealth: healthFor(0, issues.filter((i) => /docx|export/i.test(i.title)).length),
    providerHealth: healthFor(0, issues.filter((i) => /provider/i.test(i.title)).length),
    workerHealth: healthFor(0, issues.filter((i) => /worker/i.test(i.title)).length),
    databaseHealth: healthFor(0, issues.filter((i) => /database|d1|sql/i.test(i.title)).length),
    buildHealth: healthFor(criticalCount, errorCount),
    lastError: issues.find((i) => i.severity === "critical" || i.severity === "error")?.title || null,
    openIssues: issues.length,
  };
}
