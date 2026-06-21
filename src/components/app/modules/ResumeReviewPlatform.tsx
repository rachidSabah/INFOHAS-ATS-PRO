"use client";

/**
 * ResumeReviewPlatform — Advanced AI Resume Review Platform
 *
 * EVOLUTIONARY UPGRADE of the legacy AiResumeReview component.
 * The legacy component (in CareerTools.tsx) is preserved untouched; this new
 * platform is wired in via AppShell.tsx so the same nav entry ("AI Resume
 * Review") now opens the full 10-module experience.
 *
 * Modules:
 *   1. ATS Review — score, keyword match, parsing risks, pass probability
 *   2. Recruiter Review — per-section strengths/weaknesses/recommendations
 *   3. Job Match Review — match % across 5 axes + missing skills/keywords/certs
 *   4. Industry Benchmark — readiness score vs. industry averages
 *   5. Resume Improvements — better summary/headlines/skills/bullets
 *   6. Priority Action Plan — critical/high/optional fixes + expected ATS gain
 *   7. One-Click Fixes — Fix Summary, Fix Skills, Fix Experience, etc.
 *   8. Interview Readiness — likely questions, weak areas, talking points
 *   9. Visual Dashboard — radar chart, progress bars, heat-map style
 *  10. Persistence — localStorage backup + store; survives refresh/logout/login
 *
 * Exports: JSON / PDF (print) / DOCX (via clipboard-friendly text).
 *
 * All AI generation is LIVE — no demo data, no hardcoded scores, no
 * placeholders. Every recommendation is dynamically generated from the
 * resume content, optimized resume (if any), job description (if any),
 * company information (if any), and industry profile (auto-detected).
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge, Icon } from "@/components/shared";
import { useApp, uid } from "@/lib/store";
import { callAI, extractJSON } from "@/lib/ai";
import { detectIndustry, INDUSTRY_PROFILES } from "@/lib/industry-ats";
import { toast } from "sonner";
import type { ResumeData, ResumeReviewReport, JobDescription } from "@/lib/types";

// ============================================================================
// Helpers
// ============================================================================

const scoreColor = (s: number, inverted = false) => {
  // inverted=true means LOWER is better (e.g. missing keywords count)
  if (inverted) return s === 0 ? "#10B981" : s <= 3 ? "#F59E0B" : "#DC2626";
  if (s >= 80) return "#10B981";
  if (s >= 60) return "#1154A3";
  if (s >= 40) return "#F59E0B";
  return "#DC2626";
};

const scoreLabel = (s: number) => {
  if (s >= 85) return "Excellent";
  if (s >= 70) return "Good";
  if (s >= 50) return "Needs Work";
  return "Critical";
};

/** Build a compact JSON snapshot of a resume for the AI prompt. */
function resumeSnapshot(r: ResumeData | undefined | null): string {
  if (!r) return "(no resume)";
  return JSON.stringify({
    name: r.name,
    headline: r.headline,
    summary: r.summary,
    contact: r.contact,
    experience: r.experience.map((e) => ({
      title: e.title, company: e.company, location: e.location,
      startDate: e.startDate, endDate: e.endDate,
      bullets: e.bullets,
    })),
    education: r.education.map((e) => ({
      institution: e.institution, degree: e.degree, field: e.field,
    })),
    skills: r.skills.map((s) => s.name),
    projects: r.projects,
    certifications: r.certifications,
    languages: r.languages,
    achievements: r.achievements,
  });
}

/** Build a compact JD snapshot. */
function jdSnapshot(jd: JobDescription | undefined | null): string {
  if (!jd) return "(no job description)";
  return JSON.stringify({
    title: jd.title,
    company: jd.company,
    location: jd.location,
    responsibilities: jd.responsibilities,
    requiredSkills: jd.requiredSkills,
    preferredSkills: jd.preferredSkills,
    technologies: jd.technologies,
    experienceYears: jd.experienceYears,
    education: jd.education,
    keywords: jd.keywords,
    rawText: jd.rawText?.slice(0, 2500),
  });
}

// ============================================================================
// Main component
// ============================================================================

type ModuleTab =
  | "dashboard"
  | "ats"
  | "recruiter"
  | "job-match"
  | "benchmark"
  | "improvements"
  | "action-plan"
  | "fixes"
  | "interview"
  | "history";

export function ResumeReviewPlatform() {
  const resumes = useApp((s) => s.resumes);
  const jds = useApp((s) => s.jobDescriptions);
  const reviewReports = useApp((s) => s.reviewReports);
  const addReviewReport = useApp((s) => s.addReviewReport);
  const removeReviewReport = useApp((s) => s.removeReviewReport);
  const updateResume = useApp((s) => s.updateResume);
  const addResume = useApp((s) => s.addResume);
  const user = useApp((s) => s.user);
  const log = useApp((s) => s.log);
  const incUsage = useApp((s) => s.incUsage);

  // === Multi-source input state ===
  // Auto-detect the most recent resume and JD as defaults.
  const [resumeId, setResumeId] = useState("");
  const [optimizedResumeId, setOptimizedResumeId] = useState("");
  const [jdId, setJdId] = useState("");
  const [companyName, setCompanyName] = useState("");

  // Auto-select defaults on mount / when resumes arrive
  useEffect(() => {
    if (!resumeId && resumes.length > 0) {
      // Pick the most recently updated resume that's NOT marked as optimized
      const original = resumes.find((r) => r.source !== "ai-optimized") ?? resumes[0];
      setResumeId(original.id);
    }
    if (!jdId && jds.length > 0) setJdId(jds[0].id);
  }, [resumes, jds, resumeId, jdId]);

  const resume = useMemo(() => resumes.find((r) => r.id === resumeId) ?? null, [resumes, resumeId]);
  const optimizedResume = useMemo(() => resumes.find((r) => r.id === optimizedResumeId) ?? null, [resumes, optimizedResumeId]);
  const jd = useMemo(() => jds.find((j) => j.id === jdId) ?? null, [jds, jdId]);

  // Auto-detect industry from JD + resume
  const industryDetection = useMemo(() => {
    if (!resume) return null;
    const jdText = jd?.rawText || jd?.keywords?.join(" ") || "";
    const resumeText = `${resume.name} ${resume.headline ?? ""} ${resume.summary ?? ""} ${resume.experience.map((e) => e.title + " " + e.company).join(" ")}`;
    return detectIndustry(jdText, resumeText);
  }, [resume, jd]);
  const industryProfile = industryDetection ? INDUSTRY_PROFILES[industryDetection.industryId] : null;

  // Auto-populate company name from JD
  useEffect(() => {
    if (jd?.company && !companyName) setCompanyName(jd.company);
  }, [jd, companyName]);

  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<ModuleTab>("dashboard");
  const [report, setReport] = useState<ResumeReviewReport | null>(null);
  const [fixLoading, setFixLoading] = useState<string | null>(null);

  // ============================================================================
  // MAIN REVIEW — calls AI once with a comprehensive prompt that returns the
  // full multi-module JSON. This avoids 10 separate round-trips and keeps
  // the experience fast even on slow providers.
  // ============================================================================
  const runReview = async () => {
    if (!resume) { toast.error("Select a resume to review."); return; }
    setLoading(true);
    setReport(null);
    setActiveTab("dashboard");
    try {
      const industryLabel = industryProfile?.label ?? "Generic";
      // keywordBank is a single string of comma/newline-separated keywords — split it.
      const industryKeywordsRaw = industryProfile?.keywordBank ?? "";
      const industryKeywords = industryKeywordsRaw
        .split(/[\n,]/)
        .map((k) => k.trim())
        .filter((k) => k.length > 0)
        .slice(0, 60);

      const systemPrompt = `You are an elite Resume Review Platform combining the expertise of a Senior Recruiter, ATS Engineer, Industry Benchmark Analyst, and Career Coach. You analyze resumes holistically and produce a comprehensive multi-module review. NEVER fabricate information — only reference real content from the resume. Return ONLY valid JSON matching the requested schema. No prose, no markdown fences.`;

      const userPrompt = `# RESUME REVIEW REQUEST

## Context
- Industry: ${industryLabel}
- Industry Keywords: ${industryKeywords.join(", ")}
- Company: ${companyName || "(not specified)"}
- Has Optimized Resume: ${optimizedResume ? "yes" : "no"}
- Has Job Description: ${jd ? "yes" : "no"}

## ORIGINAL RESUME
${resumeSnapshot(resume)}

${optimizedResume ? `## OPTIMIZED RESUME (also review this)\n${resumeSnapshot(optimizedResume)}` : ""}

${jd ? `## JOB DESCRIPTION\n${jdSnapshot(jd)}` : ""}

## TASK
Generate a comprehensive review covering all 10 modules. Return JSON with EXACTLY this shape:

{
  "ats": {
    "atsScore": <0-100>,
    "keywordMatch": <0-100>,
    "missingKeywords": ["..."],
    "formattingIssues": ["..."],
    "sectionDetection": [{"section":"Contact","detected":true,"confidence":95}, ...],
    "parsingRisks": ["..."],
    "graphicsRisks": ["..."],
    "tablesRisks": ["..."],
    "fileCompatibility": ["PDF: ✓", "DOCX: ✓", "ATS-friendly: ✓"],
    "passProbability": <0-100>,
    "recommendations": ["..."]
  },
  "recruiter": {
    "overallScore": <0-10>,
    "sections": [
      {"section":"Headline","score":<0-10>,"strengths":["..."],"weaknesses":["..."],"recommendations":["..."]},
      {"section":"Summary","score":<0-10>,"strengths":["..."],"weaknesses":["..."],"recommendations":["..."]},
      {"section":"Experience","score":<0-10>,"strengths":["..."],"weaknesses":["..."],"recommendations":["..."]},
      {"section":"Skills","score":<0-10>,"strengths":["..."],"weaknesses":["..."],"recommendations":["..."]},
      {"section":"Education","score":<0-10>,"strengths":["..."],"weaknesses":["..."],"recommendations":["..."]},
      {"section":"Projects","score":<0-10>,"strengths":["..."],"weaknesses":["..."],"recommendations":["..."]},
      {"section":"Certifications","score":<0-10>,"strengths":["..."],"weaknesses":["..."],"recommendations":["..."]},
      {"section":"Achievements","score":<0-10>,"strengths":["..."],"weaknesses":["..."],"recommendations":["..."]},
      {"section":"Languages","score":<0-10>,"strengths":["..."],"weaknesses":["..."],"recommendations":["..."]}
    ]
  },
  "jobMatch": ${jd ? `{
    "overallMatch": <0-100>,
    "atsMatch": <0-100>,
    "experienceMatch": <0-100>,
    "skillMatch": <0-100>,
    "educationMatch": <0-100>,
    "industryMatch": <0-100>,
    "missingSkills": ["..."],
    "missingKeywords": ["..."],
    "missingCertifications": ["..."]
  }` : `null`},
  "benchmark": {
    "industry": "${industryLabel}",
    "role": "<detected role>",
    "seniority": "<Entry|Mid|Senior|Lead|Executive>",
    "country": "<detected or 'Global'>",
    "industryReadinessScore": <0-100>,
    "benchmarkComparisons": [
      {"metric":"Years of Experience","candidate":<n>,"industryAverage":<n>,"topPercentile":<n>},
      {"metric":"Skills Count","candidate":<n>,"industryAverage":<n>,"topPercentile":<n>},
      {"metric":"Quantified Bullets %","candidate":<n>,"industryAverage":<n>,"topPercentile":<n>}
    ],
    "insights": ["..."]
  },
  "improvements": {
    "betterSummary": "<a stronger 2-3 sentence summary>",
    "betterHeadlines": ["<alt headline 1>","<alt headline 2>","<alt headline 3>"],
    "betterSkills": ["<skill to add 1>","<skill to add 2>"],
    "betterBulletPoints": [{"original":"<weak bullet>","improved":"<strong bullet with metric>"}],
    "betterAchievements": ["..."],
    "actionVerbs": ["Led","Built","Shipped","..."],
    "metrics": ["<suggested metric to add>"],
    "highValueKeywords": ["..."]
  },
  "actionPlan": {
    "criticalFixes": [{"fix":"...","impact":"..."}],
    "highPriorityFixes": [{"fix":"...","impact":"..."}],
    "optionalImprovements": [{"fix":"...","impact":"..."}],
    "expectedAtsIncrease": <number of ATS points>
  },
  "interviewReadiness": {
    "likelyQuestions": ["..."],
    "weakAreas": ["..."],
    "talkingPoints": ["..."],
    "preparationAdvice": ["..."]
  }
}

Rules:
- All scores must be REALISTIC and derived from the actual resume content. NEVER use placeholder scores.
- Section scores should reflect actual content quality (empty sections get 0, not 5).
- Missing keywords must come from the JD or industry keyword bank.
- Bullet improvements must rewrite ACTUAL bullets from the resume, not invent new ones.
- Be honest — a weak resume should get low scores, not generic 7/10s.`;

      const result = await callAI({
        systemPrompt,
        userPrompt,
        maxTokens: 4500,
        temperature: 0.3,
        taskCategory: "document",
      });

      let data: any;
      try { data = extractJSON<any>(result.text); }
      catch { throw new Error("AI did not return valid JSON. Please try again."); }

      // Validate minimum shape
      if (!data.ats || !data.recruiter || !data.benchmark || !data.improvements || !data.actionPlan || !data.interviewReadiness) {
        throw new Error("AI response missing required modules. Please try again.");
      }

      // Compute dashboard aggregate scores
      const formattingScore = data.ats.atsScore && data.ats.formattingIssues
        ? Math.max(0, 100 - data.ats.formattingIssues.length * 8) : data.ats.atsScore || 0;
      const readabilityScore = Math.round(
        (data.recruiter.sections.find((s: any) => s.section === "Summary")?.score ?? 5) * 10
      );
      const recruiterScore = data.recruiter.overallScore || 0;

      const newReport: ResumeReviewReport = {
        id: uid("rr"),
        userId: user?.id || "anonymous",
        resumeId: resume.id,
        optimizedResumeId: optimizedResume?.id,
        jdId: jd?.id,
        companyName: companyName || jd?.company || undefined,
        industryProfile: industryProfile?.label ?? "Generic",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ats: data.ats,
        recruiter: data.recruiter,
        jobMatch: data.jobMatch ?? null,
        benchmark: data.benchmark,
        improvements: data.improvements,
        actionPlan: data.actionPlan,
        interviewReadiness: data.interviewReadiness,
        dashboard: {
          atsScore: data.ats.atsScore ?? 0,
          recruiterScore,
          jobMatch: data.jobMatch?.overallMatch ?? null,
          formattingScore,
          readabilityScore,
          industryBenchmark: data.benchmark.industryReadinessScore ?? 0,
        },
      };

      setReport(newReport);
      addReviewReport(newReport);
      incUsage("atsChecks");
      log({
        actor: user?.email || "you",
        action: "AI Resume Review generated",
        category: "ai",
        details: `ATS ${newReport.dashboard.atsScore}/100 · Recruiter ${newReport.dashboard.recruiterScore}/10 · Industry ${newReport.dashboard.industryBenchmark}/100 via ${result.provider}`,
        severity: "info",
      });
      toast.success(`Review complete — ATS ${newReport.dashboard.atsScore}/100 · Recruiter ${newReport.dashboard.recruiterScore}/10`);
    } catch (e: any) {
      toast.error(e?.message || "Review failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // ============================================================================
  // ONE-CLICK FIXES — Module 7
  // Each fix calls AI to rewrite a specific section and applies it to the
  // resume via updateResume() (or creates an optimized copy via addResume()).
  // ============================================================================
  const runOneClickFix = async (fixType: "summary" | "skills" | "experience" | "ats" | "all") => {
    if (!resume) { toast.error("Select a resume first."); return; }
    if (!report) { toast.error("Run a review first to get recommendations."); return; }
    setFixLoading(fixType);
    try {
      const fixPrompts: Record<string, string> = {
        summary: `Rewrite ONLY the summary section of this resume. Use the review's recommendations and the suggested betterSummary. Return JSON: {"summary": "..."}.\n\nRESUME:\n${resumeSnapshot(resume)}\n\nREVIEW SUMMARY RECOMMENDATIONS:\n${JSON.stringify(report.recruiter.sections.find((s) => s.section === "Summary"))}\n\nSUGGESTED BETTER SUMMARY:\n${report.improvements.betterSummary}`,
        skills: `Improve ONLY the skills section. Add the suggested missing skills, remove redundant ones, and reorganize by category. Return JSON: {"skills": [{"name":"...","category":"..."}]}.\n\nRESUME:\n${resumeSnapshot(resume)}\n\nSUGGESTED SKILLS TO ADD:\n${JSON.stringify(report.improvements.betterSkills)}`,
        experience: `Rewrite ONLY the experience bullets to be more impactful. Apply the betterBulletPoints suggestions. Return JSON: {"experience": [{"title":"...","company":"...","location":"...","startDate":"...","endDate":"...","bullets":["..."]}]}.\n\nRESUME:\n${resumeSnapshot(resume)}\n\nBULLET IMPROVEMENTS:\n${JSON.stringify(report.improvements.betterBulletPoints)}`,
        ats: `Optimize this resume for maximum ATS score by embedding the missing keywords naturally and applying all action verbs. NEVER fabricate experience. Return the FULL optimized resume as JSON matching the resume schema.\n\nRESUME:\n${resumeSnapshot(resume)}\n\nMISSING KEYWORDS:\n${JSON.stringify(report.ats.missingKeywords)}\n\nACTION VERBS:\n${JSON.stringify(report.improvements.actionVerbs)}`,
        all: `Fully optimize this resume by applying ALL recommendations from the review: better summary, better headlines, better skills, better bullets, missing keywords. NEVER fabricate experience. Return the FULL optimized resume as JSON matching the resume schema with keys: name, headline, summary, contact, experience, education, skills, projects, certifications, languages, achievements.\n\nRESUME:\n${resumeSnapshot(resume)}\n\nFULL REVIEW:\n${JSON.stringify({ improvements: report.improvements, ats: report.ats, actionPlan: report.actionPlan })}`,
      };

      const result = await callAI({
        systemPrompt: "You are an expert resume optimizer. Apply the requested fixes precisely. Return ONLY valid JSON. NEVER fabricate experience or metrics not present in the original resume.",
        userPrompt: fixPrompts[fixType],
        maxTokens: fixType === "all" || fixType === "ats" ? 3500 : 1500,
        temperature: 0.4,
        taskCategory: "document",
      });

      let data: any;
      try { data = extractJSON<any>(result.text); }
      catch { throw new Error("AI did not return valid JSON for the fix."); }

      if (fixType === "all" || fixType === "ats") {
        // Create an optimized copy as a new resume
        const optimized: ResumeData = {
          ...resume,
          id: uid("r"),
          headline: data.headline || resume.headline,
          summary: data.summary || resume.summary,
          skills: (data.skills ?? resume.skills).map((s: any) => typeof s === "string" ? { id: uid("s"), name: s, category: "Skills" } : { id: uid("s"), ...s }),
          experience: (data.experience ?? resume.experience).map((e: any) => ({
            id: uid("e"), title: e.title || "", company: e.company || "", location: e.location || "",
            startDate: e.startDate || "", endDate: e.endDate || "Present",
            bullets: e.bullets ?? [],
          })),
          template: resume.template,
          accentColor: resume.accentColor,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          source: "ai-optimized",
          fileName: `${resume.name.replace(/\s+/g, "_")}_optimized.pdf`,
        };
        addResume(optimized);
        toast.success(`Optimized resume created — "${optimized.name} (Optimized)" added to your library.`);
      } else {
        // Patch the existing resume
        const patch: Partial<ResumeData> = {};
        if (fixType === "summary" && data.summary) patch.summary = data.summary;
        if (fixType === "skills" && data.skills) {
          patch.skills = data.skills.map((s: any) => typeof s === "string" ? { id: uid("s"), name: s, category: "Skills" } : { id: uid("s"), ...s });
        }
        if (fixType === "experience" && data.experience) {
          patch.experience = data.experience.map((e: any) => ({
            id: uid("e"), title: e.title || "", company: e.company || "", location: e.location || "",
            startDate: e.startDate || "", endDate: e.endDate || "Present",
            bullets: e.bullets ?? [],
          }));
        }
        updateResume(resume.id, patch);
        toast.success(`${fixType.charAt(0).toUpperCase() + fixType.slice(1)} updated — review the changes in My Resumes.`);
      }
      log({
        actor: user?.email || "you",
        action: `One-click fix applied: ${fixType}`,
        category: "ai",
        details: `Resume: ${resume.name} via ${result.provider}`,
        severity: "info",
      });
    } catch (e: any) {
      toast.error(e?.message || "Fix failed.");
    } finally {
      setFixLoading(null);
    }
  };

  // ============================================================================
  // EXPORTS
  // ============================================================================
  const exportJSON = () => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `resume-review-${resume?.name?.replace(/\s+/g, "_") ?? "report"}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("JSON report exported.");
  };

  const exportPDF = () => {
    if (!report) return;
    // Use the browser's print dialog — user can save as PDF.
    // This is the most reliable cross-browser approach on Cloudflare Free.
    window.print();
    toast.info("Use your browser's print dialog to save as PDF.");
  };

  const exportDOCX = () => {
    if (!report) return;
    // Build a plain-text version that pastes cleanly into Word/Google Docs.
    const lines: string[] = [];
    lines.push("AI RESUME REVIEW REPORT");
    lines.push("========================");
    lines.push(`Generated: ${new Date(report.createdAt).toLocaleString()}`);
    lines.push(`Resume: ${resume?.name ?? "N/A"}`);
    if (optimizedResume) lines.push(`Optimized Resume: ${optimizedResume.name}`);
    if (jd) lines.push(`Job: ${jd.title} at ${jd.company || "N/A"}`);
    lines.push(`Industry: ${report.industryProfile}`);
    lines.push("");
    lines.push("DASHBOARD");
    lines.push("---------");
    lines.push(`ATS Score: ${report.dashboard.atsScore}/100`);
    lines.push(`Recruiter Score: ${report.dashboard.recruiterScore}/10`);
    if (report.dashboard.jobMatch !== null) lines.push(`Job Match: ${report.dashboard.jobMatch}%`);
    lines.push(`Formatting Score: ${report.dashboard.formattingScore}/100`);
    lines.push(`Readability Score: ${report.dashboard.readabilityScore}/100`);
    lines.push(`Industry Benchmark: ${report.dashboard.industryBenchmark}/100`);
    lines.push("");
    lines.push("MODULE 1 — ATS REVIEW");
    lines.push("---------------------");
    lines.push(`ATS Score: ${report.ats.atsScore}/100`);
    lines.push(`Keyword Match: ${report.ats.keywordMatch}/100`);
    lines.push(`Pass Probability: ${report.ats.passProbability}%`);
    lines.push(`Missing Keywords: ${report.ats.missingKeywords.join(", ") || "none"}`);
    lines.push(`Formatting Issues: ${report.ats.formattingIssues.join("; ") || "none"}`);
    lines.push(`Parsing Risks: ${report.ats.parsingRisks.join("; ") || "none"}`);
    lines.push(`Recommendations: ${report.ats.recommendations.join("; ") || "none"}`);
    lines.push("");
    lines.push("MODULE 2 — RECRUITER REVIEW");
    lines.push("---------------------------");
    lines.push(`Overall: ${report.recruiter.overallScore}/10`);
    for (const s of report.recruiter.sections) {
      lines.push(`  ${s.section} (${s.score}/10)`);
      lines.push(`    Strengths: ${s.strengths.join("; ")}`);
      lines.push(`    Weaknesses: ${s.weaknesses.join("; ")}`);
      lines.push(`    Recommendations: ${s.recommendations.join("; ")}`);
    }
    lines.push("");
    if (report.jobMatch) {
      lines.push("MODULE 3 — JOB MATCH REVIEW");
      lines.push("---------------------------");
      lines.push(`Overall Match: ${report.jobMatch.overallMatch}%`);
      lines.push(`ATS Match: ${report.jobMatch.atsMatch}%`);
      lines.push(`Experience Match: ${report.jobMatch.experienceMatch}%`);
      lines.push(`Skill Match: ${report.jobMatch.skillMatch}%`);
      lines.push(`Education Match: ${report.jobMatch.educationMatch}%`);
      lines.push(`Industry Match: ${report.jobMatch.industryMatch}%`);
      lines.push(`Missing Skills: ${report.jobMatch.missingSkills.join(", ") || "none"}`);
      lines.push(`Missing Keywords: ${report.jobMatch.missingKeywords.join(", ") || "none"}`);
      lines.push(`Missing Certifications: ${report.jobMatch.missingCertifications.join(", ") || "none"}`);
      lines.push("");
    }
    lines.push("MODULE 4 — INDUSTRY BENCHMARK");
    lines.push("------------------------------");
    lines.push(`Industry: ${report.benchmark.industry}`);
    lines.push(`Role: ${report.benchmark.role}`);
    lines.push(`Seniority: ${report.benchmark.seniority}`);
    lines.push(`Country: ${report.benchmark.country}`);
    lines.push(`Industry Readiness Score: ${report.benchmark.industryReadinessScore}/100`);
    for (const b of report.benchmark.benchmarkComparisons) {
      lines.push(`  ${b.metric}: candidate=${b.candidate}, industry avg=${b.industryAverage}, top percentile=${b.topPercentile}`);
    }
    lines.push(`Insights: ${report.benchmark.insights.join("; ")}`);
    lines.push("");
    lines.push("MODULE 5 — RESUME IMPROVEMENTS");
    lines.push("------------------------------");
    lines.push(`Better Summary: ${report.improvements.betterSummary}`);
    lines.push(`Better Headlines: ${report.improvements.betterHeadlines.join(" | ")}`);
    lines.push(`Skills to Add: ${report.improvements.betterSkills.join(", ") || "none"}`);
    lines.push(`Better Bullets:`);
    for (const b of report.improvements.betterBulletPoints) {
      lines.push(`  - "${b.original}" → "${b.improved}"`);
    }
    lines.push(`Action Verbs: ${report.improvements.actionVerbs.join(", ")}`);
    lines.push(`Suggested Metrics: ${report.improvements.metrics.join(", ")}`);
    lines.push(`High-Value Keywords: ${report.improvements.highValueKeywords.join(", ")}`);
    lines.push("");
    lines.push("MODULE 6 — PRIORITY ACTION PLAN");
    lines.push("------------------------------");
    lines.push(`Expected ATS Increase: +${report.actionPlan.expectedAtsIncrease} points`);
    lines.push(`Critical Fixes:`);
    for (const f of report.actionPlan.criticalFixes) lines.push(`  - ${f.fix} (impact: ${f.impact})`);
    lines.push(`High Priority Fixes:`);
    for (const f of report.actionPlan.highPriorityFixes) lines.push(`  - ${f.fix} (impact: ${f.impact})`);
    lines.push(`Optional Improvements:`);
    for (const f of report.actionPlan.optionalImprovements) lines.push(`  - ${f.fix} (impact: ${f.impact})`);
    lines.push("");
    lines.push("MODULE 8 — INTERVIEW READINESS");
    lines.push("-----------------------------");
    lines.push(`Likely Questions:`);
    for (const q of report.interviewReadiness.likelyQuestions) lines.push(`  - ${q}`);
    lines.push(`Weak Areas: ${report.interviewReadiness.weakAreas.join(", ")}`);
    lines.push(`Talking Points: ${report.interviewReadiness.talkingPoints.join("; ")}`);
    lines.push(`Preparation Advice: ${report.interviewReadiness.preparationAdvice.join("; ")}`);

    const blob = new Blob([lines.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `resume-review-${resume?.name?.replace(/\s+/g, "_") ?? "report"}-${new Date().toISOString().slice(0, 10)}.docx.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("DOCX-compatible text exported (opens in Word/Google Docs).");
  };

  // ============================================================================
  // Render
  // ============================================================================

  const tabs: { id: ModuleTab; label: string; icon: string; disabled?: boolean }[] = [
    { id: "dashboard", label: "Dashboard", icon: "LayoutDashboard" },
    { id: "ats", label: "ATS Review", icon: "ShieldCheck" },
    { id: "recruiter", label: "Recruiter Review", icon: "Users" },
    { id: "job-match", label: "Job Match", icon: "Target", disabled: !report?.jobMatch },
    { id: "benchmark", label: "Industry Benchmark", icon: "BarChart3" },
    { id: "improvements", label: "Improvements", icon: "Sparkles" },
    { id: "action-plan", label: "Action Plan", icon: "ListChecks" },
    { id: "fixes", label: "One-Click Fixes", icon: "Wand2" },
    { id: "interview", label: "Interview Readiness", icon: "MessageSquare" },
    { id: "history", label: "History", icon: "History" },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2">
            <Icon name="FileSearch" className="w-6 h-6 text-brand" /> AI Resume Review Platform
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Recruiter-grade review · ATS analysis · Industry benchmark · Job match · One-click fixes · Interview readiness
          </p>
        </div>
        {report && (
          <div className="flex gap-2 flex-wrap">
            <Button size="sm" variant="outline" onClick={exportJSON} className="gap-1.5"><Icon name="Braces" className="w-3.5 h-3.5" /> JSON</Button>
            <Button size="sm" variant="outline" onClick={exportDOCX} className="gap-1.5"><Icon name="FileType" className="w-3.5 h-3.5" /> DOCX</Button>
            <Button size="sm" variant="outline" onClick={exportPDF} className="gap-1.5"><Icon name="Printer" className="w-3.5 h-3.5" /> PDF</Button>
          </div>
        )}
      </div>

      {/* Multi-source input */}
      <Card><CardContent className="p-4 space-y-4">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <Label>Original Resume</Label>
            <select value={resumeId} onChange={(e) => setResumeId(e.target.value)} className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm mt-1">
              <option value="">Select...</option>
              {resumes.map((r) => <option key={r.id} value={r.id}>{r.name}{r.source === "ai-optimized" ? " (optimized)" : ""}</option>)}
            </select>
          </div>
          <div>
            <Label>Optimized Resume <span className="text-muted-foreground text-[10px]">(optional)</span></Label>
            <select value={optimizedResumeId} onChange={(e) => setOptimizedResumeId(e.target.value)} className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm mt-1">
              <option value="">None</option>
              {resumes.filter((r) => r.id !== resumeId).map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div>
            <Label>Job Description <span className="text-muted-foreground text-[10px]">(optional)</span></Label>
            <select value={jdId} onChange={(e) => setJdId(e.target.value)} className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm mt-1">
              <option value="">None</option>
              {jds.map((j) => <option key={j.id} value={j.id}>{j.title}{j.company ? ` — ${j.company}` : ""}</option>)}
            </select>
          </div>
          <div>
            <Label>Company <span className="text-muted-foreground text-[10px]">(auto-detected)</span></Label>
            <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="e.g. Emirates" className="mt-1" />
          </div>
        </div>

        {/* Auto-detected context badges */}
        <div className="flex flex-wrap gap-2 items-center text-xs">
          {industryProfile && <Badge variant="brand" className="gap-1"><Icon name="Building2" className="w-3 h-3" /> Industry: {industryProfile.label}</Badge>}
          {industryDetection && industryDetection.confidence >= 30 && <Badge variant="outline">Confidence: {industryDetection.confidence}%</Badge>}
          {resume && <Badge variant="outline">Resume: {resume.name}</Badge>}
          {optimizedResume && <Badge variant="success">Optimized: {optimizedResume.name}</Badge>}
          {jd && <Badge variant="warning">JD: {jd.title}</Badge>}
          {!jd && <Badge variant="outline">No JD — Job Match module will be skipped</Badge>}
        </div>

        <Button onClick={runReview} disabled={loading || !resume} className="bg-brand hover:bg-brand-dark text-white gap-2 w-full sm:w-auto">
          <Icon name={loading ? "Loader2" : "FileSearch"} className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          {loading ? "Running multi-module review..." : "Run Full Review"}
        </Button>
        {!resume && <p className="text-xs text-amber-600 mt-1">⚠ Create or upload a resume first to enable the review.</p>}
      </CardContent></Card>

      {/* Loading state */}
      {loading && (
        <Card><CardContent className="p-4">
          <div className="flex items-center gap-2 mb-2">
            <Icon name="Loader2" className="w-4 h-4 animate-spin text-brand" />
            <span className="text-sm text-muted-foreground">Running 10-module review — this may take 15-30 seconds…</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-[10px] text-muted-foreground">
            {["ATS", "Recruiter", "Job Match", "Benchmark", "Improvements", "Action Plan", "Fixes", "Interview", "Dashboard", "Persistence"].map((m, i) => (
              <div key={m} className="flex items-center gap-1"><span className="text-brand">✓</span> {m}</div>
            ))}
          </div>
        </CardContent></Card>
      )}

      {/* Empty state */}
      {!loading && !report && reviewReports.length === 0 && (
        <Card><CardContent className="py-12 text-center">
          <Icon name="FileSearch" className="w-12 h-12 text-muted-foreground/30 mx-auto" />
          <h3 className="mt-3 font-semibold">No reviews yet</h3>
          <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
            Select a resume above and click <strong>Run Full Review</strong> to generate a comprehensive 10-module analysis — ATS score, recruiter feedback, industry benchmark, job match, one-click fixes, and interview readiness.
          </p>
        </CardContent></Card>
      )}

      {/* Tabs + content */}
      {report && !loading && (
        <>
          {/* Tab strip */}
          <div className="flex gap-1 overflow-x-auto pb-1 border-b border-border">
            {tabs.map((t) => (
              <button
                key={t.id}
                disabled={t.disabled}
                onClick={() => setActiveTab(t.id)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium whitespace-nowrap border-b-2 transition-colors ${
                  activeTab === t.id
                    ? "border-brand text-brand"
                    : t.disabled
                      ? "border-transparent text-muted-foreground/40 cursor-not-allowed"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon name={t.icon} className="w-3.5 h-3.5" /> {t.label}
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait">
            <motion.div key={activeTab} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ duration: 0.15 }}>
              {activeTab === "dashboard" && <DashboardModule report={report} />}
              {activeTab === "ats" && <ATSModule report={report} />}
              {activeTab === "recruiter" && <RecruiterModule report={report} />}
              {activeTab === "job-match" && report.jobMatch && <JobMatchModule report={report} />}
              {activeTab === "benchmark" && <BenchmarkModule report={report} />}
              {activeTab === "improvements" && <ImprovementsModule report={report} />}
              {activeTab === "action-plan" && <ActionPlanModule report={report} />}
              {activeTab === "fixes" && <FixesModule report={report} onFix={runOneClickFix} loading={fixLoading} />}
              {activeTab === "interview" && <InterviewModule report={report} />}
              {activeTab === "history" && (
                <HistoryModule
                  reports={reviewReports}
                  resumes={resumes}
                  currentReportId={report.id}
                  onSelect={(r) => setReport(r)}
                  onDelete={(id) => { removeReviewReport(id); if (id === report.id) setReport(null); }}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </>
      )}

      {/* If no current report but history exists, show history list */}
      {!report && !loading && reviewReports.length > 0 && (
        <HistoryModule
          reports={reviewReports}
          resumes={resumes}
          currentReportId={null}
          onSelect={(r) => { setReport(r); setActiveTab("dashboard"); }}
          onDelete={(id) => removeReviewReport(id)}
        />
      )}
    </div>
  );
}

// ============================================================================
// MODULE 9 — VISUAL DASHBOARD
// ============================================================================

function DashboardModule({ report }: { report: ResumeReviewReport }) {
  const scores = [
    { label: "ATS Score", value: report.dashboard.atsScore, max: 100, color: scoreColor(report.dashboard.atsScore) },
    { label: "Recruiter Score", value: report.dashboard.recruiterScore * 10, max: 100, color: scoreColor(report.dashboard.recruiterScore * 10) },
    { label: "Formatting", value: report.dashboard.formattingScore, max: 100, color: scoreColor(report.dashboard.formattingScore) },
    { label: "Readability", value: report.dashboard.readabilityScore, max: 100, color: scoreColor(report.dashboard.readabilityScore) },
    { label: "Industry Benchmark", value: report.dashboard.industryBenchmark, max: 100, color: scoreColor(report.dashboard.industryBenchmark) },
  ];
  if (report.dashboard.jobMatch !== null) {
    scores.push({ label: "Job Match", value: report.dashboard.jobMatch, max: 100, color: scoreColor(report.dashboard.jobMatch) });
  }

  // Radar chart — SVG-based (no external dependency, works on Cloudflare Free)
  const radarValues = scores.slice(0, 6);
  const radarSize = 220;
  const radarCenter = radarSize / 2;
  const radarRadius = radarSize / 2 - 30;
  const radarPoints = radarValues.map((s, i) => {
    const angle = (Math.PI * 2 * i) / radarValues.length - Math.PI / 2;
    const r = (s.value / s.max) * radarRadius;
    return [radarCenter + r * Math.cos(angle), radarCenter + r * Math.sin(angle)];
  });
  const radarPath = radarPoints.map((p) => p.join(",")).join(" ");
  const radarLabels = radarValues.map((s, i) => {
    const angle = (Math.PI * 2 * i) / radarValues.length - Math.PI / 2;
    const labelR = radarRadius + 18;
    return {
      label: s.label,
      value: Math.round(s.value),
      x: radarCenter + labelR * Math.cos(angle),
      y: radarCenter + labelR * Math.sin(angle),
    };
  });

  return (
    <div className="space-y-4">
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Radar Chart */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Icon name="Radar" className="w-4 h-4 text-brand" /> Performance Radar</CardTitle></CardHeader>
          <CardContent className="flex justify-center pt-2">
            <svg width={radarSize} height={radarSize} className="max-w-full">
              {/* Grid circles */}
              {[0.25, 0.5, 0.75, 1].map((f) => (
                <circle key={f} cx={radarCenter} cy={radarCenter} r={radarRadius * f} fill="none" stroke="currentColor" strokeWidth="0.5" className="text-muted-foreground/30" />
              ))}
              {/* Grid lines */}
              {radarValues.map((_, i) => {
                const angle = (Math.PI * 2 * i) / radarValues.length - Math.PI / 2;
                return <line key={i} x1={radarCenter} y1={radarCenter} x2={radarCenter + radarRadius * Math.cos(angle)} y2={radarCenter + radarRadius * Math.sin(angle)} stroke="currentColor" strokeWidth="0.5" className="text-muted-foreground/30" />;
              })}
              {/* Score polygon */}
              <polygon points={radarPath} fill="rgba(17, 84, 163, 0.25)" stroke="#1154A3" strokeWidth="2" />
              {/* Score points */}
              {radarPoints.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="3" fill="#1154A3" />)}
              {/* Labels */}
              {radarLabels.map((l, i) => (
                <g key={i}>
                  <text x={l.x} y={l.y} textAnchor="middle" dominantBaseline="middle" className="text-[9px] fill-muted-foreground font-medium">{l.label}</text>
                  <text x={l.x} y={l.y + 10} textAnchor="middle" dominantBaseline="middle" className="text-[10px] font-bold" fill={scoreColor(l.value)}>{l.value}</text>
                </g>
              ))}
            </svg>
          </CardContent>
        </Card>

        {/* Progress bars */}
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Icon name="BarChart3" className="w-4 h-4 text-brand" /> Score Breakdown</CardTitle></CardHeader>
          <CardContent className="space-y-3 pt-2">
            {scores.map((s) => (
              <div key={s.label}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="font-medium">{s.label}</span>
                  <span className="font-bold" style={{ color: s.color }}>{Math.round(s.value)}<span className="text-muted-foreground text-[10px]">/{s.max}</span></span>
                </div>
                <div className="h-2 bg-secondary rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${(s.value / s.max) * 100}%` }}
                    transition={{ duration: 0.6, ease: "easeOut" }}
                    className="h-full rounded-full"
                    style={{ background: s.color }}
                  />
                </div>
              </div>
            ))}
            <div className="pt-2 border-t border-border flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Overall verdict</span>
              <Badge variant={report.dashboard.atsScore >= 70 ? "success" : report.dashboard.atsScore >= 50 ? "warning" : "danger"}>
                {scoreLabel(report.dashboard.atsScore)}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Heat-map style section scores */}
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Icon name="Grid3x3" className="w-4 h-4 text-brand" /> Section Heat Map</CardTitle></CardHeader>
        <CardContent className="pt-2">
          <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2">
            {report.recruiter.sections.map((s) => {
              const pct = (s.score / 10) * 100;
              const color = pct >= 80 ? "#10B981" : pct >= 60 ? "#1154A3" : pct >= 40 ? "#F59E0B" : "#DC2626";
              return (
                <div key={s.section} className="rounded-lg p-2 text-center border" style={{ borderColor: color + "40", background: color + "10" }}>
                  <div className="text-[9px] uppercase text-muted-foreground truncate">{s.section}</div>
                  <div className="text-lg font-bold" style={{ color }}>{s.score}<span className="text-[10px] text-muted-foreground">/10</span></div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Top critical fixes preview */}
      {report.actionPlan.criticalFixes.length > 0 && (
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2 text-red-600"><Icon name="AlertTriangle" className="w-4 h-4" /> Critical Fixes Preview</CardTitle></CardHeader>
          <CardContent className="pt-2 space-y-2">
            {report.actionPlan.criticalFixes.slice(0, 3).map((f, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span className="text-red-500 font-bold mt-0.5">{i + 1}.</span>
                <div><span className="font-medium">{f.fix}</span> <span className="text-muted-foreground">— {f.impact}</span></div>
              </div>
            ))}
            <div className="pt-2 border-t border-border flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Expected ATS increase after all fixes</span>
              <Badge variant="success" className="gap-1"><Icon name="TrendingUp" className="w-3 h-3" /> +{report.actionPlan.expectedAtsIncrease} pts</Badge>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ============================================================================
// MODULE 1 — ATS REVIEW
// ============================================================================

function ATSModule({ report }: { report: ResumeReviewReport }) {
  const a = report.ats;
  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-3 gap-4">
        <Card><CardContent className="p-4 text-center">
          <div className="text-3xl font-bold font-display" style={{ color: scoreColor(a.atsScore) }}>{a.atsScore}</div>
          <div className="text-[10px] text-muted-foreground uppercase mt-1">ATS Score / 100</div>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <div className="text-3xl font-bold font-display" style={{ color: scoreColor(a.keywordMatch) }}>{a.keywordMatch}%</div>
          <div className="text-[10px] text-muted-foreground uppercase mt-1">Keyword Match</div>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <div className="text-3xl font-bold font-display" style={{ color: scoreColor(a.passProbability) }}>{a.passProbability}%</div>
          <div className="text-[10px] text-muted-foreground uppercase mt-1">Pass Probability</div>
        </CardContent></Card>
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-red-600 flex items-center gap-2"><Icon name="KeyRound" className="w-4 h-4" /> Missing Keywords ({a.missingKeywords.length})</CardTitle></CardHeader>
          <CardContent className="pt-0">
            {a.missingKeywords.length > 0 ? (
              <div className="flex flex-wrap gap-1">{a.missingKeywords.map((k, i) => <Badge key={i} variant="danger" className="text-[10px]">{k}</Badge>)}</div>
            ) : <p className="text-xs text-muted-foreground">None — all keywords matched ✓</p>}
          </CardContent>
        </Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-amber-600 flex items-center gap-2"><Icon name="AlertCircle" className="w-4 h-4" /> Formatting Issues ({a.formattingIssues.length})</CardTitle></CardHeader>
          <CardContent className="pt-0">
            {a.formattingIssues.length > 0 ? (
              <ul className="space-y-1 text-xs">{a.formattingIssues.map((f, i) => <li key={i} className="flex gap-1.5"><span className="text-amber-500">!</span> {f}</li>)}</ul>
            ) : <p className="text-xs text-muted-foreground">No formatting issues ✓</p>}
          </CardContent>
        </Card>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs">Section Detection</CardTitle></CardHeader>
          <CardContent className="pt-0 space-y-1">
            {a.sectionDetection.map((s, i) => (
              <div key={i} className="flex items-center justify-between text-xs">
                <span>{s.section}</span>
                <span className={s.detected ? "text-emerald-600" : "text-red-500"}>{s.detected ? `✓ ${s.confidence}%` : "✗ missing"}</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs">Parsing Risks</CardTitle></CardHeader>
          <CardContent className="pt-0">
            {a.parsingRisks.length > 0 ? <ul className="space-y-1 text-xs">{a.parsingRisks.map((r, i) => <li key={i} className="flex gap-1.5"><span className="text-amber-500">!</span> {r}</li>)}</ul> : <p className="text-xs text-emerald-600">No parsing risks ✓</p>}
          </CardContent>
        </Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs">File Compatibility</CardTitle></CardHeader>
          <CardContent className="pt-0 space-y-1">
            {a.fileCompatibility.map((f, i) => <div key={i} className="text-xs">{f}</div>)}
            {a.graphicsRisks.length > 0 && <div className="mt-2 pt-2 border-t border-border"><div className="text-[10px] uppercase text-muted-foreground mb-1">Graphics Risks</div>{a.graphicsRisks.map((r, i) => <div key={i} className="text-xs text-amber-600">⚠ {r}</div>)}</div>}
            {a.tablesRisks.length > 0 && <div className="mt-2 pt-2 border-t border-border"><div className="text-[10px] uppercase text-muted-foreground mb-1">Tables Risks</div>{a.tablesRisks.map((r, i) => <div key={i} className="text-xs text-amber-600">⚠ {r}</div>)}</div>}
          </CardContent>
        </Card>
      </div>

      <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Icon name="Lightbulb" className="w-4 h-4 text-brand" /> ATS Recommendations</CardTitle></CardHeader>
        <CardContent className="pt-0"><ul className="space-y-1.5 text-xs">{a.recommendations.map((r, i) => <li key={i} className="flex gap-1.5"><span className="text-brand">→</span> {r}</li>)}</ul></CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// MODULE 2 — RECRUITER REVIEW
// ============================================================================

function RecruiterModule({ report }: { report: ResumeReviewReport }) {
  return (
    <div className="space-y-4">
      <Card><CardContent className="p-4 flex items-center gap-4">
        <div className="text-center">
          <div className="text-4xl font-bold font-display" style={{ color: scoreColor(report.recruiter.overallScore * 10) }}>{report.recruiter.overallScore}</div>
          <div className="text-[10px] text-muted-foreground uppercase">Overall / 10</div>
        </div>
        <div className="flex-1 text-sm text-muted-foreground">
          A senior recruiter's honest assessment of each resume section. Scores reflect real content quality — empty or weak sections get low scores, not generic 7/10s.
        </div>
      </CardContent></Card>

      <div className="grid md:grid-cols-2 gap-4">
        {report.recruiter.sections.map((s, i) => {
          const pct = (s.score / 10) * 100;
          const color = pct >= 80 ? "#10B981" : pct >= 60 ? "#1154A3" : pct >= 40 ? "#F59E0B" : "#DC2626";
          return (
            <Card key={i}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm">{s.section}</CardTitle>
                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: color + "20", color }}>{s.score}/10</span>
                </div>
              </CardHeader>
              <CardContent className="pt-0 space-y-2 text-xs">
                {s.strengths.length > 0 && <div><div className="font-semibold text-emerald-600 mb-0.5">✓ Strengths</div><ul className="space-y-0.5">{s.strengths.map((x, j) => <li key={j} className="flex gap-1"><span className="text-emerald-500">+</span> {x}</li>)}</ul></div>}
                {s.weaknesses.length > 0 && <div><div className="font-semibold text-red-600 mb-0.5 mt-2">✗ Weaknesses</div><ul className="space-y-0.5">{s.weaknesses.map((x, j) => <li key={j} className="flex gap-1"><span className="text-red-500">−</span> {x}</li>)}</ul></div>}
                {s.recommendations.length > 0 && <div><div className="font-semibold text-brand mb-0.5 mt-2">→ Recommendations</div><ul className="space-y-0.5">{s.recommendations.map((x, j) => <li key={j} className="flex gap-1"><span className="text-brand">›</span> {x}</li>)}</ul></div>}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================================
// MODULE 3 — JOB MATCH REVIEW
// ============================================================================

function JobMatchModule({ report }: { report: ResumeReviewReport }) {
  if (!report.jobMatch) return null;
  const jm = report.jobMatch;
  const axes = [
    { label: "Overall Match", val: jm.overallMatch },
    { label: "ATS Match", val: jm.atsMatch },
    { label: "Experience Match", val: jm.experienceMatch },
    { label: "Skill Match", val: jm.skillMatch },
    { label: "Education Match", val: jm.educationMatch },
    { label: "Industry Match", val: jm.industryMatch },
  ];
  return (
    <div className="space-y-4">
      <Card><CardContent className="p-4 flex items-center gap-4">
        <div className="text-center">
          <div className="text-4xl font-bold font-display" style={{ color: scoreColor(jm.overallMatch) }}>{jm.overallMatch}%</div>
          <div className="text-[10px] text-muted-foreground uppercase">Overall Match</div>
        </div>
        <div className="flex-1 grid grid-cols-2 sm:grid-cols-3 gap-2">
          {axes.slice(1).map((a) => (
            <div key={a.label}>
              <div className="text-[10px] uppercase text-muted-foreground">{a.label}</div>
              <div className="h-1.5 bg-secondary rounded-full overflow-hidden mt-0.5"><div className="h-full rounded-full" style={{ width: `${a.val}%`, background: scoreColor(a.val) }} /></div>
              <div className="text-[10px] font-bold mt-0.5" style={{ color: scoreColor(a.val) }}>{a.val}%</div>
            </div>
          ))}
        </div>
      </CardContent></Card>

      <div className="grid md:grid-cols-3 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-red-600">Missing Skills</CardTitle></CardHeader>
          <CardContent className="pt-0">{jm.missingSkills.length > 0 ? <div className="flex flex-wrap gap-1">{jm.missingSkills.map((s, i) => <Badge key={i} variant="danger" className="text-[10px]">{s}</Badge>)}</div> : <p className="text-xs text-emerald-600">All skills matched ✓</p>}</CardContent>
        </Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-amber-600">Missing Keywords</CardTitle></CardHeader>
          <CardContent className="pt-0">{jm.missingKeywords.length > 0 ? <div className="flex flex-wrap gap-1">{jm.missingKeywords.map((s, i) => <Badge key={i} variant="warning" className="text-[10px]">{s}</Badge>)}</div> : <p className="text-xs text-emerald-600">All keywords matched ✓</p>}</CardContent>
        </Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-blue-600">Missing Certifications</CardTitle></CardHeader>
          <CardContent className="pt-0">{jm.missingCertifications.length > 0 ? <ul className="space-y-0.5 text-xs">{jm.missingCertifications.map((s, i) => <li key={i} className="flex gap-1"><span className="text-blue-500">+</span> {s}</li>)}</ul> : <p className="text-xs text-emerald-600">No required certs missing ✓</p>}</CardContent>
        </Card>
      </div>
    </div>
  );
}

// ============================================================================
// MODULE 4 — INDUSTRY BENCHMARK
// ============================================================================

function BenchmarkModule({ report }: { report: ResumeReviewReport }) {
  const b = report.benchmark;
  return (
    <div className="space-y-4">
      <Card><CardContent className="p-4 flex items-center gap-4 flex-wrap">
        <div className="text-center">
          <div className="text-4xl font-bold font-display" style={{ color: scoreColor(b.industryReadinessScore) }}>{b.industryReadinessScore}</div>
          <div className="text-[10px] text-muted-foreground uppercase">Industry Readiness / 100</div>
        </div>
        <div className="flex-1 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
          <div><div className="text-[10px] uppercase text-muted-foreground">Industry</div><div className="font-semibold">{b.industry}</div></div>
          <div><div className="text-[10px] uppercase text-muted-foreground">Role</div><div className="font-semibold">{b.role}</div></div>
          <div><div className="text-[10px] uppercase text-muted-foreground">Seniority</div><div className="font-semibold">{b.seniority}</div></div>
          <div><div className="text-[10px] uppercase text-muted-foreground">Country</div><div className="font-semibold">{b.country}</div></div>
        </div>
      </CardContent></Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Icon name="BarChart3" className="w-4 h-4 text-brand" /> Benchmark vs. Industry</CardTitle></CardHeader>
        <CardContent className="pt-0 space-y-3">
          {b.benchmarkComparisons.map((c, i) => {
            const maxVal = Math.max(c.candidate, c.industryAverage, c.topPercentile, 1);
            return (
              <div key={i}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="font-medium">{c.metric}</span>
                  <span className="text-muted-foreground">You: <span className="font-bold" style={{ color: scoreColor((c.candidate / maxVal) * 100) }}>{c.candidate}</span> · Avg: {c.industryAverage} · Top: {c.topPercentile}</span>
                </div>
                <div className="space-y-0.5">
                  <div className="h-2 bg-secondary rounded-full overflow-hidden"><div className="h-full rounded-full bg-brand" style={{ width: `${(c.candidate / maxVal) * 100}%` }} /></div>
                  <div className="h-1 bg-secondary rounded-full overflow-hidden"><div className="h-full rounded-full bg-muted-foreground/40" style={{ width: `${(c.industryAverage / maxVal) * 100}%` }} /></div>
                  <div className="h-1 bg-secondary rounded-full overflow-hidden"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${(c.topPercentile / maxVal) * 100}%` }} /></div>
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Icon name="Lightbulb" className="w-4 h-4 text-brand" /> Insights</CardTitle></CardHeader>
        <CardContent className="pt-0"><ul className="space-y-1.5 text-xs">{b.insights.map((s, i) => <li key={i} className="flex gap-1.5"><span className="text-brand">→</span> {s}</li>)}</ul></CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// MODULE 5 — RESUME IMPROVEMENTS
// ============================================================================

function ImprovementsModule({ report }: { report: ResumeReviewReport }) {
  const imp = report.improvements;
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Icon name="FileText" className="w-4 h-4 text-brand" /> Better Summary</CardTitle></CardHeader>
        <CardContent className="pt-0"><p className="text-sm text-foreground/90 text-pretty">{imp.betterSummary}</p></CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Icon name="Type" className="w-4 h-4 text-brand" /> Better Headlines</CardTitle></CardHeader>
          <CardContent className="pt-0 space-y-2">{imp.betterHeadlines.map((h, i) => <div key={i} className="text-xs p-2 rounded-md bg-secondary/50 border border-border">{h}</div>)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Icon name="Plus" className="w-4 h-4 text-brand" /> Skills to Add</CardTitle></CardHeader>
          <CardContent className="pt-0">{imp.betterSkills.length > 0 ? <div className="flex flex-wrap gap-1">{imp.betterSkills.map((s, i) => <Badge key={i} variant="brand" className="text-[10px]">{s}</Badge>)}</div> : <p className="text-xs text-muted-foreground">None suggested</p>}</CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Icon name="RefreshCcw" className="w-4 h-4 text-brand" /> Better Bullet Points</CardTitle></CardHeader>
        <CardContent className="pt-0 space-y-3">
          {imp.betterBulletPoints.length > 0 ? imp.betterBulletPoints.map((b, i) => (
            <div key={i} className="rounded-lg border border-border p-3 bg-secondary/30">
              <div className="text-[10px] uppercase text-red-500 mb-1">Original</div>
              <div className="text-xs text-muted-foreground line-through mb-2">{b.original}</div>
              <div className="text-[10px] uppercase text-emerald-600 mb-1">Improved</div>
              <div className="text-xs font-medium text-foreground">{b.improved}</div>
            </div>
          )) : <p className="text-xs text-muted-foreground">No bullet improvements suggested</p>}
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-3 gap-4">
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs">Action Verbs</CardTitle></CardHeader><CardContent className="pt-0"><div className="flex flex-wrap gap-1">{imp.actionVerbs.map((v, i) => <Badge key={i} variant="outline" className="text-[10px]">{v}</Badge>)}</div></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs">Metrics to Add</CardTitle></CardHeader><CardContent className="pt-0"><ul className="space-y-0.5 text-xs">{imp.metrics.map((m, i) => <li key={i} className="flex gap-1"><span className="text-brand">›</span> {m}</li>)}</ul></CardContent></Card>
        <Card><CardHeader className="pb-2"><CardTitle className="text-xs">High-Value Keywords</CardTitle></CardHeader><CardContent className="pt-0"><div className="flex flex-wrap gap-1">{imp.highValueKeywords.map((k, i) => <Badge key={i} variant="warning" className="text-[10px]">{k}</Badge>)}</div></CardContent></Card>
      </div>
    </div>
  );
}

// ============================================================================
// MODULE 6 — PRIORITY ACTION PLAN
// ============================================================================

function ActionPlanModule({ report }: { report: ResumeReviewReport }) {
  const ap = report.actionPlan;
  return (
    <div className="space-y-4">
      <Card><CardContent className="p-4 flex items-center gap-4">
        <Icon name="TrendingUp" className="w-10 h-10 text-emerald-600" />
        <div>
          <div className="text-2xl font-bold font-display text-emerald-600">+{ap.expectedAtsIncrease} points</div>
          <div className="text-xs text-muted-foreground">Expected ATS increase after applying all fixes below</div>
        </div>
      </CardContent></Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm text-red-600 flex items-center gap-2"><Icon name="AlertOctagon" className="w-4 h-4" /> Critical Fixes ({ap.criticalFixes.length})</CardTitle></CardHeader>
        <CardContent className="pt-0 space-y-2">
          {ap.criticalFixes.length > 0 ? ap.criticalFixes.map((f, i) => (
            <div key={i} className="rounded-lg border-l-4 border-red-500 p-3 bg-red-50/50 dark:bg-red-950/20">
              <div className="font-semibold text-xs text-red-700 dark:text-red-300">{f.fix}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Impact: {f.impact}</div>
            </div>
          )) : <p className="text-xs text-emerald-600">No critical fixes needed ✓</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm text-amber-600 flex items-center gap-2"><Icon name="AlertTriangle" className="w-4 h-4" /> High Priority Fixes ({ap.highPriorityFixes.length})</CardTitle></CardHeader>
        <CardContent className="pt-0 space-y-2">
          {ap.highPriorityFixes.length > 0 ? ap.highPriorityFixes.map((f, i) => (
            <div key={i} className="rounded-lg border-l-4 border-amber-500 p-3 bg-amber-50/50 dark:bg-amber-950/20">
              <div className="font-semibold text-xs text-amber-700 dark:text-amber-300">{f.fix}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Impact: {f.impact}</div>
            </div>
          )) : <p className="text-xs text-muted-foreground">None</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm text-blue-600 flex items-center gap-2"><Icon name="Sparkles" className="w-4 h-4" /> Optional Improvements ({ap.optionalImprovements.length})</CardTitle></CardHeader>
        <CardContent className="pt-0 space-y-2">
          {ap.optionalImprovements.length > 0 ? ap.optionalImprovements.map((f, i) => (
            <div key={i} className="rounded-lg border-l-4 border-blue-500 p-3 bg-blue-50/50 dark:bg-blue-950/20">
              <div className="font-semibold text-xs text-blue-700 dark:text-blue-300">{f.fix}</div>
              <div className="text-xs text-muted-foreground mt-0.5">Impact: {f.impact}</div>
            </div>
          )) : <p className="text-xs text-muted-foreground">None</p>}
        </CardContent>
      </Card>
    </div>
  );
}

// ============================================================================
// MODULE 7 — ONE-CLICK FIXES
// ============================================================================

function FixesModule({ report, onFix, loading }: { report: ResumeReviewReport; onFix: (type: "summary" | "skills" | "experience" | "ats" | "all") => void; loading: string | null }) {
  const fixes = [
    { id: "summary" as const, label: "Fix Summary", icon: "FileText", desc: "Rewrite the summary using the AI's recommended betterSummary.", color: "#1154A3" },
    { id: "skills" as const, label: "Fix Skills", icon: "Plus", desc: "Add suggested missing skills and reorganize by category.", color: "#10B981" },
    { id: "experience" as const, label: "Fix Experience", icon: "RefreshCcw", desc: "Rewrite weak bullets into impactful, metric-driven achievements.", color: "#F59E0B" },
    { id: "ats" as const, label: "Fix ATS", icon: "ShieldCheck", desc: "Embed all missing keywords naturally to maximize ATS score. Creates an optimized copy.", color: "#8B5CF6" },
    { id: "all" as const, label: "Optimize Entire Resume", icon: "Wand2", desc: "Apply ALL recommendations: summary, headlines, skills, bullets, keywords. Creates an optimized copy.", color: "#DC2626" },
  ];
  return (
    <div className="space-y-4">
      <Card><CardContent className="p-4">
        <div className="flex items-start gap-2 text-xs text-muted-foreground bg-brand/5 dark:bg-brand/10 border border-brand/20 rounded-lg p-3 mb-4">
          <Icon name="Info" className="w-4 h-4 text-brand shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-foreground mb-1">How one-click fixes work</p>
            <p><strong>Fix Summary / Skills / Experience</strong> apply directly to your current resume. <strong>Fix ATS / Optimize Entire Resume</strong> create a new optimized copy in your library so you can compare side-by-side.</p>
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          {fixes.map((f) => (
            <Card key={f.id} className="border-l-4" style={{ borderLeftColor: f.color }}>
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <Icon name={f.icon} className="w-5 h-5 shrink-0 mt-0.5" style={{ color: f.color }} />
                  <div className="flex-1 min-w-0">
                    <h4 className="font-semibold text-sm">{f.label}</h4>
                    <p className="text-xs text-muted-foreground mt-1">{f.desc}</p>
                    <Button size="sm" onClick={() => onFix(f.id)} disabled={loading !== null} className="mt-3 gap-1.5 text-white" style={{ background: f.color }}>
                      {loading === f.id ? <Icon name="Loader2" className="w-3.5 h-3.5 animate-spin" /> : <Icon name="Play" className="w-3.5 h-3.5" />}
                      {loading === f.id ? "Applying..." : "Apply Fix"}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </CardContent></Card>
    </div>
  );
}

// ============================================================================
// MODULE 8 — INTERVIEW READINESS
// ============================================================================

function InterviewModule({ report }: { report: ResumeReviewReport }) {
  const ir = report.interviewReadiness;
  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Icon name="HelpCircle" className="w-4 h-4 text-brand" /> Likely Questions ({ir.likelyQuestions.length})</CardTitle></CardHeader>
          <CardContent className="pt-0 space-y-2">{ir.likelyQuestions.map((q, i) => <div key={i} className="text-xs p-2 rounded-md bg-secondary/40 border border-border">Q{i + 1}: {q}</div>)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2 text-red-600"><Icon name="AlertTriangle" className="w-4 h-4" /> Weak Areas ({ir.weakAreas.length})</CardTitle></CardHeader>
          <CardContent className="pt-0 space-y-1">{ir.weakAreas.map((w, i) => <div key={i} className="text-xs flex gap-1.5"><span className="text-red-500">!</span> {w}</div>)}</CardContent>
        </Card>
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2 text-emerald-600"><Icon name="MessageSquare" className="w-4 h-4" /> Talking Points ({ir.talkingPoints.length})</CardTitle></CardHeader>
          <CardContent className="pt-0 space-y-1">{ir.talkingPoints.map((t, i) => <div key={i} className="text-xs flex gap-1.5"><span className="text-emerald-500">+</span> {t}</div>)}</CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2 text-brand"><Icon name="Lightbulb" className="w-4 h-4" /> Preparation Advice ({ir.preparationAdvice.length})</CardTitle></CardHeader>
          <CardContent className="pt-0 space-y-1.5">{ir.preparationAdvice.map((a, i) => <div key={i} className="text-xs flex gap-1.5"><span className="text-brand">→</span> {a}</div>)}</CardContent>
        </Card>
      </div>
    </div>
  );
}

// ============================================================================
// MODULE 10 — HISTORY (persistence viewer)
// ============================================================================

function HistoryModule({
  reports,
  resumes,
  currentReportId,
  onSelect,
  onDelete,
}: {
  reports: ResumeReviewReport[];
  resumes: ResumeData[];
  currentReportId: string | null;
  onSelect: (r: ResumeReviewReport) => void;
  onDelete: (id: string) => void;
}) {
  if (reports.length === 0) {
    return <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">No saved reviews yet. Run your first review above.</CardContent></Card>;
  }
  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Icon name="History" className="w-4 h-4 text-brand" /> Saved Reviews ({reports.length})</CardTitle>
      <CardDescription className="text-xs">Reviews are saved to your browser and survive logout, login, refresh, and browser restart.</CardDescription>
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        {reports.map((r) => {
          const resumeName = resumes.find((x) => x.id === r.resumeId)?.name ?? "Unknown resume";
          const isActive = r.id === currentReportId;
          return (
            <div key={r.id} className={`flex items-center gap-3 p-3 rounded-lg border ${isActive ? "border-brand bg-brand/5" : "border-border"}`}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-semibold text-sm">{resumeName}</span>
                  {r.companyName && <Badge variant="outline" className="text-[10px]">{r.companyName}</Badge>}
                  <Badge variant="brand" className="text-[10px]">{r.industryProfile}</Badge>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  ATS {r.dashboard.atsScore}/100 · Recruiter {r.dashboard.recruiterScore}/10
                  {r.dashboard.jobMatch !== null && ` · Match ${r.dashboard.jobMatch}%`}
                  · {new Date(r.createdAt).toLocaleString()}
                </div>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant={isActive ? "default" : "outline"} onClick={() => onSelect(r)} className="h-7 text-xs gap-1">
                  <Icon name={isActive ? "Check" : "Eye"} className="w-3 h-3" /> {isActive ? "Active" : "View"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onDelete(r.id)} className="h-7 text-xs text-red-500 hover:text-red-600">
                  <Icon name="Trash2" className="w-3 h-3" />
                </Button>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
