// ============================================================================
// ResumeAI Pro — JD Match Dashboard engine (pure, deterministic).
// Builds a priority-aware match dashboard (required skills / core tech /
// preferred / extra keywords) between a ResumeData and a JobDescription,
// including per-section coverage so users see WHERE each JD term lives.
// Unlike the flat keyword matching in ats.ts, this module uses the JD's
// structured fields (requiredSkills, technologies, preferredSkills) with
// weights, and is safe against malformed/stale inputs.
// ============================================================================
import type { ResumeData, JobDescription } from "./types";
import { filterJunkKeywords } from "./keyword-quality";

export type TermPriority = "required" | "technology" | "preferred" | "keyword";

export interface TermMatch {
  term: string;
  matched: boolean;
  /** Buckets where the term was found: summary | experience | skills | projects | education | certifications */
  sections: string[];
}

export interface MatchGroup {
  priority: TermPriority;
  label: string;
  terms: TermMatch[];
  matched: number;
  total: number;
  percent: number;
}

export interface SectionCoverage {
  section: string;
  label: string;
  /** Unique JD terms found in this section */
  hits: number;
  /** Total unique JD terms across all groups */
  total: number;
  percent: number;
}

export interface ATSDashboard {
  /** Weighted overall JD match percentage (0-100) */
  overall: number;
  groups: MatchGroup[];
  sectionCoverage: SectionCoverage[];
  /** Missing terms, ordered required → technology → preferred → keyword */
  missing: TermMatch[];
  matched: TermMatch[];
  /** Missing terms that gate most ATS screens: required + technology */
  mustHaveMissing: string[];
  totalTerms: number;
}

/** Group weights — renormalized over groups that have at least one term. */
export const MATCH_WEIGHTS: Record<TermPriority, number> = {
  required: 0.45,
  technology: 0.25,
  preferred: 0.15,
  keyword: 0.15,
};

const GROUP_META: Record<TermPriority, { label: string }> = {
  required: { label: "Must-have skills" },
  technology: { label: "Core technologies" },
  preferred: { label: "Nice-to-have" },
  keyword: { label: "Other JD keywords" },
};

const SECTIONS: Array<{ section: string; label: string }> = [
  { section: "summary", label: "Summary" },
  { section: "experience", label: "Experience" },
  { section: "skills", label: "Skills" },
  { section: "projects", label: "Projects" },
  { section: "education", label: "Education" },
  { section: "certifications", label: "Certifications" },
];

const PRIORITY_ORDER: TermPriority[] = ["required", "technology", "preferred", "keyword"];

// ─── Text sanitization ──────────────────────────────────────────────────────

/** Clean a raw term: trim, collapse whitespace, drop empties/too-short noise. */
export function sanitizeTerm(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const t = raw.replace(/\s+/g, " ").trim();
  if (!t) return "";
  // Single characters are noise unless they are tech tokens like C, R, C#.
  if (t.length === 1 && !/[+#]/.test(t) && !/[A-Z]/.test(t)) return "";
  return t;
}

/**
 * Sanitize + dedupe a list of terms (case-insensitive dedupe, first casing
 * wins). Used for every JD field before matching.
 */
export function sanitizeTerms(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input) {
    const t = sanitizeTerm(raw);
    if (!t) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t);
  }
  return out;
}

// ─── Matching helpers ───────────────────────────────────────────────────────

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Case-insensitive containment. Short single tokens (len < 4, e.g. "R", "C#",
 * "Go") use word boundaries so "R" doesn't match inside "developer"; longer
 * terms and multi-word phrases use plain substring matching.
 */
export function termInText(term: string, textLower: string): boolean {
  const t = term.toLowerCase();
  if (!t) return false;
  const text = (textLower || "").toLowerCase();
  if (t.length < 4 && !t.includes(" ")) {
    return new RegExp(`(^|[^a-z0-9+#])${escapeRegExp(t)}([^a-z0-9+#]|$)`).test(text);
  }
  return text.includes(t);
}

/** Lowercased text per resume section bucket. */
export function sectionTexts(resume: ResumeData): Record<string, string> {
  const r = resume as Partial<ResumeData>;
  const summary = [r.name, r.headline, r.summary].filter(Boolean).join(" ");
  const experience = [
    ...(r.experience || []).flatMap((e) => [e?.title, e?.company, ...(e?.bullets || [])]),
    ...(r.achievements || []),
  ]
    .filter(Boolean)
    .join(" ");
  const skills = [
    ...(r.skills || []).map((s) => s?.name),
    ...(r.languages || []).map((l) => (typeof l === "string" ? l : l?.name)),
  ]
    .filter(Boolean)
    .join(" ");
  const projects = (r.projects || [])
    .flatMap((p) => [p?.name, p?.description, ...(p?.bullets || [])])
    .filter(Boolean)
    .join(" ");
  const education = (r.education || [])
    .flatMap((e) => [e?.degree, e?.field, e?.institution])
    .filter(Boolean)
    .join(" ");
  const certifications = (r.certifications || []).map((c) => c?.name).filter(Boolean).join(" ");
  return {
    summary: summary.toLowerCase(),
    experience: experience.toLowerCase(),
    skills: skills.toLowerCase(),
    projects: projects.toLowerCase(),
    education: education.toLowerCase(),
    certifications: certifications.toLowerCase(),
  };
}

// ─── Dashboard computation ──────────────────────────────────────────────────

/**
 * Build the full match dashboard. All inputs are defensively sanitized so
 * stale D1 rows / localStorage backups / hand-typed JDs can never crash it.
 */
export function computeATSDashboard(resumeRaw: ResumeData, jdRaw: JobDescription): ATSDashboard {
  const resume = (resumeRaw || {}) as ResumeData;
  const jd = (jdRaw || ({} as JobDescription));

  // Unique term → {cased term, priority} (highest priority wins:
  // required > technology > preferred > keyword).
  const termMap = new Map<string, { term: string; priority: TermPriority }>();
  const pushTerms = (input: unknown, priority: TermPriority, junkFilter = false) => {
    let terms = sanitizeTerms(input);
    if (junkFilter) terms = filterJunkKeywords(terms);
    for (const term of terms) {
      const key = term.toLowerCase();
      const cur = termMap.get(key);
      if (!cur) termMap.set(key, { term, priority });
      else if (PRIORITY_ORDER.indexOf(priority) < PRIORITY_ORDER.indexOf(cur.priority)) {
        cur.priority = priority;
      }
    }
  };
  pushTerms((jd as any).requiredSkills, "required");
  pushTerms((jd as any).technologies, "technology");
  pushTerms((jd as any).preferredSkills, "preferred");
  pushTerms(jd.keywords, "keyword", true);

  const texts = sectionTexts(resume);

  const groups = new Map<TermPriority, TermMatch[]>();
  for (const { term, priority } of termMap.values()) {
    const key = term.toLowerCase();
    const sections = SECTIONS.filter(({ section }) => termInText(term, texts[section])).map(
      ({ section }) => section,
    );
    const match: TermMatch = { term, matched: sections.length > 0, sections };
    const bucket = groups.get(priority) || [];
    bucket.push(match);
    groups.set(priority, bucket);
  }

  const matchGroups: MatchGroup[] = PRIORITY_ORDER.filter((p) => groups.has(p)).map((p) => {
    const terms = groups.get(p)!;
    const matched = terms.filter((t) => t.matched).length;
    return {
      priority: p,
      label: GROUP_META[p].label,
      terms,
      matched,
      total: terms.length,
      percent: Math.round((matched / terms.length) * 100),
    };
  });

  const active = matchGroups.filter((g) => g.total > 0);
  const weightSum = active.reduce((sum, g) => sum + MATCH_WEIGHTS[g.priority], 0);
  const overall =
    weightSum > 0
      ? Math.round(active.reduce((sum, g) => sum + MATCH_WEIGHTS[g.priority] * g.percent, 0) / weightSum)
      : 0;

  const totalTerms = termMap.size;
  const sectionCoverage: SectionCoverage[] = SECTIONS.map(({ section, label }) => {
    let hits = 0;
    for (const [key] of termMap) {
      if (termInText(key, texts[section])) hits += 1;
    }
    return {
      section,
      label,
      hits,
      total: totalTerms,
      percent: totalTerms > 0 ? Math.round((hits / totalTerms) * 100) : 0,
    };
  });

  const missing: TermMatch[] = [];
  const matched: TermMatch[] = [];
  for (const g of matchGroups) {
    for (const t of g.terms) (t.matched ? matched : missing).push(t);
  }
  const mustHaveMissing = missing
    .filter((t) => {
      const p = termMap.get(t.term.toLowerCase())?.priority;
      return p === "required" || p === "technology";
    })
    .map((t) => t.term);

  return { overall, groups: matchGroups, sectionCoverage, missing, matched, mustHaveMissing, totalTerms };
}
