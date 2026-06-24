// ResumeAI Pro — ATS scoring engine (rule-based, deterministic).
// Produces an ATSReport given a ResumeData and optional JobDescription.
import type {
  ResumeData, JobDescription, ATSReport, ATSScoreBreakdown, ATSRecommendation,
} from "./types";
import { uid } from "./store";

const COMMON_ATS_KEYWORDS = [
  "experience", "team", "project", "management", "leadership", "strategy",
  "analysis", "design", "development", "implementation", "optimization",
  "communication", "collaboration", "stakeholder", "delivery", "results",
];

const WEAK_VERBS = ["responsible for", "worked on", "helped", "duties included", "tasked with"];

export function scoreATS(resume: ResumeData, jd?: JobDescription): ATSReport {
  const formatting = scoreFormatting(resume);
  const keywords = scoreKeywords(resume, jd);
  const content = scoreContent(resume);
  const grammar = scoreGrammar(resume);
  const completeness = scoreCompleteness(resume);

  // ATS overall is a weighted blend
  const ats = Math.round(
    formatting * 0.2 + keywords * 0.3 + content * 0.2 + grammar * 0.1 + completeness * 0.2
  );

  const recommendations: ATSRecommendation[] = [];
  const missingKeywords: string[] = [];
  const matchedKeywords: string[] = [];

  // Missing keywords — defensive against jd.keywords being undefined/null
  // (can happen with JDs from stale localStorage backups or older D1 rows).
  if (jd) {
    const jdKeywords = Array.isArray(jd.keywords) ? jd.keywords : [];
    const resumeText = resumeToText(resume).toLowerCase();
    for (const k of jdKeywords) {
      if (typeof k !== "string") continue;
      if (resumeText.includes(k.toLowerCase())) matchedKeywords.push(k);
      else missingKeywords.push(k);
    }
    if (missingKeywords.length > 0) {
      recommendations.push({
        id: uid("rec"),
        severity: missingKeywords.length > 4 ? "critical" : "warning",
        category: "Keywords",
        title: `${missingKeywords.length} missing keywords from the job description`,
        description: `Your resume doesn't mention: ${missingKeywords.slice(0, 8).join(", ")}${missingKeywords.length > 8 ? "..." : ""}. ATS systems weight keyword density heavily.`,
        fix: `Weave these keywords naturally into your bullets and skills — never list them blankly.`,
      });
    }
  }

  // Formatting recommendations
  if (resume.contact.phone && /[\(\)]/.test(resume.contact.phone)) {
    recommendations.push({
      id: uid("rec"),
      severity: "info",
      category: "Formatting",
      title: "Standardize phone format",
      description: "Parentheses can confuse some ATS parsers.",
      fix: "Use +1-415-555-0182 format.",
    });
  }
  if (resume.summary && resume.summary.length > 600) {
    recommendations.push({
      id: uid("rec"),
      severity: "warning",
      category: "Summary",
      title: "Summary too long",
      description: "Long summaries push content below the fold and dilute keyword density.",
      fix: "Trim to 2-3 lines (max ~60 words).",
    });
  }
  if (resume.experience.length === 0) {
    recommendations.push({
      id: uid("rec"),
      severity: "critical",
      category: "Experience",
      title: "No experience entries detected",
      description: "Without experience entries, your ATS score will cap around 40.",
      fix: "Add at least one experience entry with quantified bullets.",
    });
  }

  // Content recommendations
  const weakBullets: string[] = [];
  for (const exp of resume.experience) {
    for (const b of exp.bullets) {
      if (WEAK_VERBS.some((v) => b.toLowerCase().startsWith(v))) weakBullets.push(b);
    }
  }
  if (weakBullets.length > 0) {
    recommendations.push({
      id: uid("rec"),
      severity: "warning",
      category: "Content",
      title: `${weakBullets.length} weak bullet points`,
      description: `Bullets starting with weak verbs like 'responsible for' underperform in ATS and recruiter review.`,
      fix: "Start with strong action verbs (Led, Built, Shipped, Increased, Reduced) and add measurable outcomes.",
    });
  }

  const quantifiedBullets = resume.experience
    .flatMap((e) => e.bullets)
    .filter((b) => /\d+%|\$\d|\d+x|\d{2,}/.test(b)).length;
  const totalBullets = resume.experience.flatMap((e) => e.bullets).length;
  if (totalBullets > 0 && quantifiedBullets / totalBullets < 0.5) {
    recommendations.push({
      id: uid("rec"),
      severity: "info",
      category: "Content",
      title: "Quantify more bullets",
      description: `${quantifiedBullets}/${totalBullets} bullets have measurable outcomes. Aim for 70%+.`,
      fix: "Add numbers (%, $, x, time saved) wherever the context supports them.",
    });
  } else if (quantifiedBullets >= 3) {
    recommendations.push({
      id: uid("rec"),
      severity: "success",
      category: "Content",
      title: "Strong quantified achievements",
      description: `${quantifiedBullets} bullets have measurable outcomes — recruiters love this.`,
    });
  }

  // Completeness
  if (resume.skills.length < 5) {
    recommendations.push({
      id: uid("rec"),
      severity: "warning",
      category: "Skills",
      title: "Add more skills",
      description: "ATS parsers expect 8-15 skills. You have " + resume.skills.length + ".",
      fix: "Add 5-10 more relevant skills.",
    });
  }
  if (!resume.contact.linkedin) {
    recommendations.push({
      id: uid("rec"),
      severity: "info",
      category: "Contact",
      title: "Add LinkedIn URL",
      description: "Recruiters use LinkedIn to verify and reach out — including it slightly improves ATS pass rate.",
      fix: "Add your LinkedIn URL to your contact section.",
    });
  }

  const weakSections: string[] = [];
  if (resume.experience.length === 0) weakSections.push("Experience");
  if (resume.skills.length < 3) weakSections.push("Skills");
  if (!resume.summary) weakSections.push("Summary");
  if (resume.education.length === 0) weakSections.push("Education");

  const jdMatchPercent = jd
    ? Math.round((matchedKeywords.length / Math.max(1, (Array.isArray(jd.keywords) ? jd.keywords : []).length)) * 100)
    : undefined;

  return {
    id: uid("ats"),
    resumeId: resume.id,
    scores: { ats, formatting, keywords, content, grammar, completeness },
    recommendations,
    missingKeywords,
    matchedKeywords,
    weakSections,
    jdMatchPercent,
    createdAt: new Date().toISOString(),
  };
}

function resumeToText(r: ResumeData): string {
  return [
    r.name, r.headline, r.summary,
    r.experience.map((e) => `${e.title} ${e.company} ${e.bullets.join(" ")}`).join(" "),
    r.education.map((e) => `${e.degree} ${e.field} ${e.institution}`).join(" "),
    r.skills.map((s) => s.name).join(" "),
    r.projects.map((p) => `${p.name} ${p.description ?? ""} ${p.bullets.join(" ")}`).join(" "),
    r.certifications.map((c) => c.name).join(" "),
  ].filter(Boolean).join(" \n ");
}

function scoreFormatting(r: ResumeData): number {
  let score = 100;
  if (!r.contact.email) score -= 15;
  if (!r.contact.phone) score -= 8;
  if (r.contact.phone && /[\(\)]/.test(r.contact.phone)) score -= 5;
  if (r.experience.length > 5) score -= 4; // too many jobs may overflow
  if (r.summary && r.summary.length > 600) score -= 8;
  if (r.skills.length > 20) score -= 4; // skill stuffing
  return clamp(score);
}

function scoreKeywords(r: ResumeData, jd?: JobDescription): number {
  if (!jd) {
    // Generic: how many common ATS keywords appear?
    const text = resumeToText(r).toLowerCase();
    const hits = COMMON_ATS_KEYWORDS.filter((k) => text.includes(k)).length;
    return clamp(Math.round((hits / COMMON_ATS_KEYWORDS.length) * 100));
  }
  const text = resumeToText(r).toLowerCase();
  // Defensive: jd.keywords may be undefined/null on JDs from stale sources.
  const jdKeywords = Array.isArray(jd.keywords) ? jd.keywords : [];
  const hits = jdKeywords.filter((k) => typeof k === "string" && text.includes(k.toLowerCase())).length;
  return clamp(Math.round((hits / Math.max(1, jdKeywords.length)) * 100));
}

function scoreContent(r: ResumeData): number {
  let score = 50;
  const bullets = r.experience.flatMap((e) => e.bullets);
  if (bullets.length >= 5) score += 12;
  if (bullets.length >= 10) score += 6;
  const quantified = bullets.filter((b) => /\d+%|\$\d|\d+x|\d{2,}/.test(b)).length;
  score += Math.min(20, quantified * 4);
  const weak = bullets.filter((b) => WEAK_VERBS.some((v) => b.toLowerCase().startsWith(v))).length;
  score -= weak * 6;
  if (r.summary && r.summary.length > 40 && r.summary.length < 500) score += 8;
  return clamp(score);
}

function scoreGrammar(r: ResumeData): number {
  let score = 100;
  const all = [
    r.summary ?? "",
    ...r.experience.flatMap((e) => e.bullets),
    ...r.experience.map((e) => `${e.title} ${e.company}`),
  ];
  // Simple checks: capitalized sentences, no double spaces, ends with period for long ones
  for (const s of all) {
    if (!s) continue;
    if (/\s{2,}/.test(s)) score -= 2;
    if (/^[a-z]/.test(s.trim()) && s.length > 20) score -= 2;
  }
  return clamp(score);
}

function scoreCompleteness(r: ResumeData): number {
  let score = 0;
  if (r.name) score += 5;
  if (r.contact.email) score += 5;
  if (r.contact.phone) score += 5;
  if (r.contact.location) score += 5;
  if (r.summary) score += 15;
  if (r.experience.length >= 1) score += 20;
  if (r.experience.length >= 2) score += 5;
  if (r.experience[0]?.bullets.length >= 3) score += 10;
  if (r.education.length >= 1) score += 10;
  if (r.skills.length >= 5) score += 10;
  if (r.skills.length >= 10) score += 5;
  if (r.projects.length >= 1) score += 5;
  return clamp(score);
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, n));
}

/** Returns a label for a score */
export function scoreLabel(score: number): { label: string; color: string } {
  if (score >= 85) return { label: "Excellent", color: "#10B981" };
  if (score >= 70) return { label: "Good", color: "#1154A3" };
  if (score >= 50) return { label: "Needs Work", color: "#F59E0B" };
  return { label: "Critical", color: "#DC2626" };
}
