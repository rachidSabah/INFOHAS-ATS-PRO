// ============================================================================
// Keyword Quality Filter
// ============================================================================
// JD keyword extraction (both the AI parser and the heuristic fallback) can
// emit junk tokens — generic English words, verbs, or sentence fragments that
// no ATS actually scans for ("go", "basic", "job", "company", "group",
// "ensure"...). Treating these as "missing keywords" produced absurd
// recommendations ("add Go, Basic, Job, Company to your resume") and the
// degraded page-fill expansion even injected them as fake skills
// ("Job-Relevant: Duty, Free, Ensure, Till, Assistant.").
//
// This module provides ONE shared filter so every consumer — JD parsing, ATS
// scoring, keyword injection, and optimization prompts — sees the same clean
// keyword list. Deterministic by design: calling it twice yields the same
// list, so scores and displays stay consistent.

/** Generic words that carry no ATS signal when used as STANDALONE keywords. */
const JUNK_KEYWORDS = new Set([
  // Function words (defensive — most are already removed by length checks,
  // but short tokens from fragmented JD text slip through)
  "the", "and", "for", "with", "you", "your", "our", "their", "this", "that",
  "these", "those", "from", "into", "onto", "over", "under", "about", "across",
  "after", "before", "between", "during", "through", "throughout", "within",
  "without", "upon", "among", "along", "are", "was", "were", "been", "being",
  "have", "has", "had", "will", "would", "should", "could", "can", "may",
  "might", "must", "shall", "does", "doing", "did", "not", "but", "its", "his",
  "her", "him", "she", "they", "them", "who", "whom", "which", "what", "when",
  "where", "why", "how", "all", "any", "each", "every", "both", "few", "more",
  "most", "other", "others", "some", "such", "only", "own", "same", "so",
  "than", "too", "very", "just", "also", "per", "via", "etc",
  // Generic nouns — no ATS scans for these as standalone skills/keywords
  "job", "jobs", "role", "roles", "position", "positions", "company",
  "companies", "group", "groups", "team", "teams", "candidate", "candidates",
  "applicant", "applicants", "person", "people", "individual", "individuals",
  "year", "years", "month", "months", "day", "days", "time", "times", "new",
  "old", "general", "various", "multiple", "certain", "relevant", "related",
  "including", "include", "includes", "included", "ability", "abilities",
  "able", "skill", "skills", "skilled", "experience", "experienced",
  "experiences", "work", "working", "works", "worked", "duty", "duties",
  "task", "tasks", "responsibility", "responsibilities", "requirement",
  "requirements", "qualification", "qualifications", "opportunity",
  "opportunities", "environment", "environments", "benefits", "salary",
  "application", "applications", "apply", "free",
  // Generic verbs — fragments of responsibility sentences, not competencies
  "go", "goes", "going", "get", "gets", "getting", "got", "make", "makes",
  "making", "made", "do", "does", "done", "put", "puts", "use", "uses",
  "using", "used", "ensure", "ensures", "ensured", "ensuring", "maintain",
  "maintains", "maintained", "maintaining", "perform", "performs",
  "performed", "performing", "provide", "provides", "provided", "providing",
  "assist", "assists", "assisted", "assisting", "handle", "handles",
  "handled", "handling", "follow", "follows", "followed", "following",
  "adhere", "adheres", "adhered", "adhering", "comply", "complies",
  "complied", "complying", "basic", "basics", "good", "great", "excellent",
  "strong", "weak", "high", "low", "level", "levels", "key", "main",
  "primary", "secondary",
]);

/**
 * Returns true when a keyword is junk: too short, numeric, or a generic
 * standalone word. Multi-word phrases are ALWAYS kept — phrases like
 * "cash handling", "duty free", or "qatar airways" are exactly what ATS
 * systems match on, even when they contain junk words individually.
 */
export function isJunkKeyword(k: unknown): boolean {
  if (typeof k !== "string") return true;
  const kw = k.trim();
  if (kw.length < 3) return true; // "go", "a", "x"
  if (!/[a-z]/i.test(kw)) return true; // numbers / symbols only
  if (/^\d+$/.test(kw)) return true;
  if (kw.includes(" ")) return false; // multi-word phrase — keep
  return JUNK_KEYWORDS.has(kw.toLowerCase());
}

/**
 * Filter a keyword list down to meaningful, deduplicated keywords.
 * Order-preserving (first occurrence wins) so downstream priority ranks
 * remain stable. Accepts unknown input defensively.
 */
export function filterJunkKeywords(keywords: unknown): string[] {
  if (!Array.isArray(keywords)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const k of keywords) {
    if (isJunkKeyword(k)) continue;
    const kw = (k as string).trim();
    const key = kw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(kw);
  }
  return out;
}
