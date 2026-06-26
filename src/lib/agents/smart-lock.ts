// ============================================================================
// Smart Entity Locking — Context-Aware Entity Locking for Resume Optimization
//
// PROBLEM: Current entity-lock.ts is binary (locked/unlocked). Bullet rephrase
// is desired but factual data (dates, metrics, proper nouns) must survive.
//
// LockLevel.STRICT   — Exact copy from source (dates, companies, contacts)
// LockLevel.GUIDED   — Rephrase prose allowed, factual tokens preserved
// LockLevel.FLEXIBLE — Full rewrite (summary, skills)
//
// GUIDED ALGORITHM: extract factual tokens from source → verify in optimized
// → inject missing tokens at natural breaks. Allows AI to rephrase prose
// around metrics without dropping the metrics.
// ============================================================================

import type { ResumeData, ResumeExperience, ResumeEducation } from "../types";

// ============================================================================
// Types
// ============================================================================

export enum LockLevel {
  STRICT = "strict",     // Must match source exactly
  GUIDED = "guided",     // Rephrase prose, preserve factual data
  FLEXIBLE = "flexible", // Free rewrite
}

export interface FieldClassification {
  type: "factual" | "subjective" | "mixed";
  confidence: number;
  factualTokens: string[];
}

export interface SmartLockPolicy {
  experience: LockLevel;
  education: LockLevel;
  summary: LockLevel;
  skills: LockLevel;
  languages: LockLevel;
  contact: LockLevel;
}

export interface SmartLockResult {
  resume: ResumeData;
  changes: { field: string; action: "preserved" | "guided-merge" | "restored" | "passed-through" }[];
}

// ============================================================================
// Default Policy
// ============================================================================

export const DEFAULT_SMART_LOCK_POLICY: SmartLockPolicy = {
  experience: LockLevel.GUIDED,   // Rewrite bullets but keep dates/metrics
  education: LockLevel.STRICT,    // Institutions, degrees, dates immutable
  summary: LockLevel.FLEXIBLE,    // Full ATS rewrite
  skills: LockLevel.FLEXIBLE,     // Reordering + categorization
  languages: LockLevel.STRICT,    // Proficiency levels are source of truth
  contact: LockLevel.STRICT,      // Never change name, email, phone
};

// ============================================================================
// Factual Token Extraction
// ============================================================================

const MONTHS: Record<string, true> = {
  january: true, february: true, march: true, april: true, may: true, june: true,
  july: true, august: true, september: true, october: true, november: true, december: true,
  jan: true, feb: true, mar: true, apr: true, jun: true, jul: true,
  aug: true, sep: true, oct: true, nov: true, dec: true,
};
const MONTH_NAMES = Object.keys(MONTHS);

function extractFactualTokens(text: string) {
  const dates: string[] = [];
  const metrics: string[] = [];
  const properNouns: string[] = [];
  const urls: string[] = [];

  if (!text) return { dates, metrics, properNouns, urls, all: [] as string[] };

  // Years
  const yr = text.match(/\b(19\d{2}|20\d{2})\b/g);
  if (yr) dates.push(...yr);
  if (/\bpresent\b/i.test(text)) dates.push("Present");
  if (/\bcurrent\b/i.test(text)) dates.push("Current");

  // Months
  text.split(/[\s,./-]+/).forEach((w) => { if (MONTHS[w.toLowerCase()]) dates.push(w); });

  // Metrics (numbers, percentages, dollar amounts)
  const mc = text.match(/\b\d+(\.\d+)?[%$]?\b/g);
  if (mc) metrics.push(...mc.filter((m) => /\d/.test(m)));

  // URLs + emails
  const u = text.match(/https?:\/\/[^\s,;)]+/g);
  if (u) urls.push(...u);
  const e = text.match(/[\w.%-]+@[\w.-]+\.[a-zA-Z]{2,}/g);
  if (e) urls.push(...e);

  // Proper nouns — multi-word capitalized sequences
  const pn = text.match(/\b([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})+)\b/g);
  if (pn) properNouns.push(...pn);

  // Single capitalized words 4+ chars, filtered against stop words
  const stopWords = new Set("the,a,an,and,or,but,in,on,at,to,for,of,with,by,from,as,is,was,are,were,be,been,being,have,has,had,do,does,did,will,would,could,should,may,might,shall,this,that,these,those,it,its,not,i,we,you,he,she,they,me,him,her,us,them,my,your,his,their,our,all,each,every".split(","));
  const sw = text.match(/\b([A-Z][a-z]{3,})\b/g);
  if (sw) sw.forEach((w) => { if (!stopWords.has(w.toLowerCase()) && !properNouns.includes(w)) properNouns.push(w); });

  // Deduplicate
  const allMap: Record<string, true> = {};
  [...dates, ...metrics, ...properNouns, ...urls].forEach((t) => { allMap[t] = true; });
  return { dates, metrics, properNouns, urls, all: Object.keys(allMap) };
}

// ============================================================================
// Field Classifier
// ============================================================================

export function classifyField(value: string | string[] | undefined): FieldClassification {
  const text = Array.isArray(value) ? value.join(" ") : (value || "");
  if (!text.trim()) return { type: "subjective", confidence: 0.5, factualTokens: [] };

  const t = extractFactualTokens(text);
  if (t.urls.length > 0) return { type: "factual", confidence: 1.0, factualTokens: t.all };
  if (t.dates.length >= 2) return { type: "factual", confidence: 0.95, factualTokens: t.all };
  if (t.dates.length >= 1 && t.metrics.length >= 1) return { type: "factual", confidence: 0.9, factualTokens: t.all };
  if (t.dates.length >= 1 && t.metrics.length === 0 && t.properNouns.length === 0) return { type: "factual", confidence: 0.85, factualTokens: t.all };
  if (t.metrics.length >= 1 && t.properNouns.length === 0) return { type: "factual", confidence: 0.8, factualTokens: t.all };
  if (t.properNouns.length >= 1 && (t.dates.length > 0 || t.metrics.length > 0)) return { type: "mixed", confidence: 0.75, factualTokens: t.all };
  if (t.properNouns.length >= 1) return { type: "mixed", confidence: 0.6, factualTokens: t.all };
  return { type: "subjective", confidence: 0.5, factualTokens: [] };
}

// ============================================================================
// Guided Merge Algorithm (core)
// ============================================================================

/**
 * Inject a token at the first natural break in text (before period, at end).
 */
function injectAtBreak(text: string, token: string): string {
  const t = text.trim();
  if (t.endsWith(".")) return t.slice(0, -1) + `, ${token}.`;
  if (/[.!?;:]$/.test(t)) return t.slice(0, -1) + ` ${token}${t.slice(-1)}`;
  return `${t}. ${token}`;
}

/**
 * Guided merge: extract factual tokens from source, ensure they survive
 * in the optimized output, and inject missing ones back.
 */
function guidedMerge(sourceValue: string, optimizedValue: string): string {
  if (!sourceValue) return optimizedValue || "";
  if (!optimizedValue) return sourceValue;
  if (sourceValue.trim() === optimizedValue.trim()) return optimizedValue;

  const srcT = extractFactualTokens(sourceValue);
  const optT = extractFactualTokens(optimizedValue);

  // Find tokens missing from optimized output
  const optLower = new Set(optT.all.map((t) => t.toLowerCase()));
  const missing = srcT.all.filter((t) => !optLower.has(t.toLowerCase()));

  if (missing.length === 0 || srcT.all.length === 0) return optimizedValue;

  // Inject missing tokens back
  let result = optimizedValue;
  for (const m of missing) {
    if (/^\d{4}$/.test(m)) {
      // Year — try to reconstruct date context from source
      const monthMatch = sourceValue.match(new RegExp(`(${MONTH_NAMES.join("|")})\\s*${m}`, "i"));
      if (monthMatch) {
        const phrase = monthMatch[0];
        if (!optT.dates.some((d) => srcT.dates.includes(d))) {
          result = injectAtBreak(result, phrase);
        }
      } else {
        result = injectAtBreak(result, `(${m})`);
      }
    } else if (/^\d+(\.\d+)?[%$]?$/.test(m)) {
      result = injectAtBreak(result, `(${m})`);
    } else {
      result = injectAtBreak(result, m);
    }
  }
  return result;
}

/**
 * Guided merge for bullet arrays (each bullet merged individually).
 */
function guidedMergeArray(src: string[], opt: string[]): string[] {
  const result: string[] = [];
  for (let i = 0; i < Math.max(src.length, opt.length); i++) {
    const s = i < src.length ? src[i] : "";
    const o = i < opt.length ? opt[i] : "";
    result.push(!s ? o : !o ? s : guidedMerge(s, o));
  }
  return result;
}

// ============================================================================
// Per-Field Enforcement
// ============================================================================

function enforceFieldLock(
  src: string | undefined,
  opt: string | undefined,
  level: LockLevel,
): { value: string | undefined; action: "preserved" | "guided-merge" | "restored" | "passed-through" } {
  if (level === LockLevel.STRICT) return { value: src, action: "preserved" };
  if (level === LockLevel.GUIDED) {
    if (src === undefined && opt === undefined) return { value: undefined, action: "passed-through" };
    if (src === undefined) return { value: opt, action: "passed-through" };
    if (opt === undefined) return { value: src, action: "restored" };
    const merged = guidedMerge(src, opt);
    return { value: merged, action: merged === src ? "preserved" : "guided-merge" };
  }
  return { value: opt, action: "passed-through" };
}

// ============================================================================
// Main Enforcer
// ============================================================================

/**
 * Enforce smart locking on an optimized resume.
 *
 * @param optimizedResume - AI-optimized resume
 * @param sourceResume    - Original source resume (ground truth)
 * @param policyOverrides - Per-section lock level overrides
 */
export function enforceSmartLock(
  optimizedResume: ResumeData,
  sourceResume: ResumeData,
  policyOverrides?: Partial<SmartLockPolicy>,
): SmartLockResult {
  const policy: SmartLockPolicy = { ...DEFAULT_SMART_LOCK_POLICY, ...policyOverrides };
  const changes: SmartLockResult["changes"] = [];
  const locked: ResumeData = JSON.parse(JSON.stringify(optimizedResume));

  // === Contact (always STRICT, regardless of policy) ===
  locked.name = sourceResume.name || locked.name;
  locked.contact = {
    ...(locked.contact || {}),
    email: sourceResume.contact?.email || locked.contact?.email || "",
    phone: sourceResume.contact?.phone || locked.contact?.phone || "",
    location: sourceResume.contact?.location || locked.contact?.location || "",
  };
  changes.push({ field: "contact", action: "preserved" });

  // === Summary ===
  const sr = enforceFieldLock(sourceResume.summary, locked.summary, policy.summary);
  locked.summary = sr.value;
  changes.push({ field: "summary", action: sr.action });

  // === Skills ===
  if (policy.skills === LockLevel.STRICT) {
    locked.skills = sourceResume.skills ? JSON.parse(JSON.stringify(sourceResume.skills)) : locked.skills;
    changes.push({ field: "skills", action: "preserved" });
  } else {
    changes.push({ field: "skills", action: "passed-through" });
  }

  // === Languages ===
  if (policy.languages === LockLevel.STRICT) {
    locked.languages = sourceResume.languages ? JSON.parse(JSON.stringify(sourceResume.languages)) : locked.languages;
    changes.push({ field: "languages", action: "preserved" });
  } else {
    changes.push({ field: "languages", action: "passed-through" });
  }

  // === Experience ===
  const expPolicy = policy.experience;
  const srcExp = new Map(sourceResume.experience.map((e) => [e.id, e]));
  const lockedExps: ResumeExperience[] = [];

  for (const opt of locked.experience) {
    const src = srcExp.get(opt.id);
    if (!src) {
      if (expPolicy === LockLevel.STRICT) { changes.push({ field: `exp[${opt.id}]`, action: "restored" }); continue; }
      lockedExps.push(opt);
      changes.push({ field: `exp[${opt.id}]`, action: "passed-through" });
      continue;
    }

    // Factual metadata always locked
    const le: ResumeExperience = {
      ...opt, id: src.id, company: src.company,
      location: src.location || opt.location,
      startDate: src.startDate, endDate: src.endDate,
    };

    // Title
    if (expPolicy === LockLevel.STRICT) { le.title = src.title; changes.push({ field: `exp[${opt.id}].title`, action: "preserved" }); }
    else if (expPolicy === LockLevel.GUIDED) { const tr = enforceFieldLock(src.title, opt.title, LockLevel.GUIDED); le.title = tr.value || src.title; changes.push({ field: `exp[${opt.id}].title`, action: tr.action }); }
    else { le.title = opt.title; changes.push({ field: `exp[${opt.id}].title`, action: "passed-through" }); }

    // Bullets
    if (expPolicy === LockLevel.STRICT) { le.bullets = [...src.bullets]; changes.push({ field: `exp[${opt.id}].bullets`, action: "preserved" }); }
    else if (expPolicy === LockLevel.GUIDED) { le.bullets = guidedMergeArray(src.bullets, opt.bullets || []); changes.push({ field: `exp[${opt.id}].bullets`, action: JSON.stringify(le.bullets) === JSON.stringify(src.bullets) ? "preserved" : "guided-merge" }); }
    else { le.bullets = opt.bullets || []; changes.push({ field: `exp[${opt.id}].bullets`, action: "passed-through" }); }

    lockedExps.push(le);
  }

  // Restore dropped experiences
  if (expPolicy === LockLevel.STRICT || expPolicy === LockLevel.GUIDED) {
    const ids = new Set(lockedExps.map((e) => e.id));
    sourceResume.experience.forEach((e) => {
      if (!ids.has(e.id)) { lockedExps.push(JSON.parse(JSON.stringify(e))); changes.push({ field: `exp[${e.id}]`, action: "restored" }); }
    });
  }
  locked.experience = lockedExps;

  // === Education ===
  const eduPolicy = policy.education;
  const srcEdu = new Map(sourceResume.education.map((e) => [e.id, e]));
  const lockedEdus: ResumeEducation[] = [];

  for (const opt of locked.education) {
    const src = srcEdu.get(opt.id);
    if (!src) {
      if (eduPolicy === LockLevel.STRICT) { changes.push({ field: `edu[${opt.id}]`, action: "restored" }); continue; }
      lockedEdus.push(opt); changes.push({ field: `edu[${opt.id}]`, action: "passed-through" }); continue;
    }

    const le: ResumeEducation = {
      ...opt, id: src.id, institution: src.institution, degree: src.degree,
      field: src.field || opt.field, location: src.location || opt.location,
      startDate: src.startDate, endDate: src.endDate,
    };

    if (eduPolicy === LockLevel.STRICT) { le.highlights = src.highlights ? [...src.highlights] : []; changes.push({ field: `edu[${opt.id}].highlights`, action: "preserved" }); }
    else if (eduPolicy === LockLevel.GUIDED) { le.highlights = guidedMergeArray(src.highlights || [], opt.highlights || []); changes.push({ field: `edu[${opt.id}].highlights`, action: "guided-merge" }); }
    else { changes.push({ field: `edu[${opt.id}].highlights`, action: "passed-through" }); }

    lockedEdus.push(le);
  }

  // Restore dropped education
  if (eduPolicy === LockLevel.STRICT || eduPolicy === LockLevel.GUIDED) {
    const ids = new Set(lockedEdus.map((e) => e.id));
    sourceResume.education.forEach((e) => {
      if (!ids.has(e.id)) { lockedEdus.push(JSON.parse(JSON.stringify(e))); changes.push({ field: `edu[${e.id}]`, action: "restored" }); }
    });
  }
  locked.education = lockedEdus;

  return { resume: locked, changes };
}
