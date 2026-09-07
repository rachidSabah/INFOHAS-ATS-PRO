// ============================================================================
// ResumeAI Pro — Regional resume norms engine (pure, deterministic).
//
// Different markets expect very different personal data on a CV: a photo is
// STANDARD on Gulf (GCC) CVs but a liability on North American ones; nationality
// and visa status are screening fields in the Gulf while US/Canadian recruiters
// avoid them for bias reasons. This module encodes those norms and produces a
// compliance report (warnings + score + one-click fix patches) for a resume.
//
// Design constraints honored here:
// - Region lives at `resume.contact.region` (typed as ContactInfo["region"])
//   so it survives cloud sync inside contact_json with NO D1 migration —
//   ALTER TABLE on resumes has a broken-CI history (see migrations/0018).
// - The optimizer pipeline already forbids the whole `contact` object for LLM
//   patches (OPTIMIZER_FORBIDDEN_TOP_LEVEL), so the LLM can never tamper with
//   or strip the region setting.
// - Defensive against malformed/stale rows (D1 restores, old backups, dumps
//   from other apps): every accessor tolerates garbage input.
// ============================================================================
import type { ResumeData, ResumeRegion } from "./types";

// ─────────────────────────────────────────────────────────────────────────────
// Norms model
// ─────────────────────────────────────────────────────────────────────────────

/** How a market treats a personal-data field. */
export type FieldStance = "expected" | "optional" | "discouraged" | "avoid";

/** Machine keys for the fields the norms engine understands. */
export type NormFieldKey =
  | "photo"
  | "dateOfBirth"
  | "nationality"
  | "visaStatus"
  | "maritalStatus"
  | "gender"
  | "drivingLicence";

export interface RegionalFieldNorm {
  key: NormFieldKey;
  /** Canonical label used as the personalDetails key AND rendered to the user. */
  label: string;
  stance: FieldStance;
  /** One-line, market-grounded explanation shown in the UI. */
  note: string;
}

export interface RegionNorms {
  id: ResumeRegion;
  label: string;
  tagline: string;
  fields: RegionalFieldNorm[];
  advice: string[];
}

/**
 * Personal-data norms per target market.
 *
 * Grounding (recruiter guidance from Bayt/GulfTalent for GCC, DACH vs UK/Ireland
 * conventions for EU, EEOC/ADEA bias-avoidance for NA):
 * - Gulf: photo/nationality/visa status are standard screening fields; DOB and
 *   marital status are common but not mandatory.
 * - Europe: photo and DOB are market-dependent (common in DACH/France, avoided
 *   in UK/Ireland/NL); marital status and gender are outdated/GDPR-sensitive.
 * - North America: photos, DOB, nationality, marital status, gender are all
 *   bias-risk liabilities and many ATS skip image-heavy headers.
 */
export const REGION_NORMS: Record<ResumeRegion, RegionNorms> = {
  na: {
    id: "na",
    label: "North America",
    tagline: "US / Canada — bias-safe minimal format",
    fields: [
      { key: "photo", label: "Photo", stance: "avoid", note: "Photos are strongly discouraged — many ATS skip image-heavy headers and recruiters screen around them for bias risk." },
      { key: "dateOfBirth", label: "Date of birth", stance: "avoid", note: "Never include — age-discrimination norms (ADEA) make it a liability." },
      { key: "nationality", label: "Nationality", stance: "avoid", note: "Omit it — express work authorization in the summary instead if relevant." },
      { key: "maritalStatus", label: "Marital status", stance: "avoid", note: "Outdated and bias-risky in North America — leave it off entirely." },
      { key: "gender", label: "Gender", stance: "avoid", note: "Never expected — its presence reads as an outdated CV." },
      { key: "visaStatus", label: "Visa / work authorization", stance: "optional", note: "Only mention if sponsorship is relevant to your search, phrased in the summary." },
      { key: "drivingLicence", label: "Driving licence", stance: "optional", note: "Only for roles that involve driving — otherwise omit." },
    ],
    advice: [
      "One page, action-verb bullets with measurable results.",
      "No personal data — recruiters screen for bias risk.",
      "A LinkedIn URL is expected; add it to your contact lines.",
      "Education typically goes before experience for recent grads only.",
    ],
  },
  eu: {
    id: "eu",
    label: "Europe",
    tagline: "EU / UK — market-dependent personal data",
    fields: [
      { key: "photo", label: "Photo", stance: "optional", note: "Market-dependent: common in DACH/France, avoided in UK/Ireland/Netherlands. Include only if the target market expects one." },
      { key: "dateOfBirth", label: "Date of birth", stance: "optional", note: "Traditional in Germany/Austria, increasingly omitted elsewhere. Safe either way." },
      { key: "nationality", label: "Nationality", stance: "optional", note: "Fine to include for work-permit clarity; not required." },
      { key: "maritalStatus", label: "Marital status", stance: "avoid", note: "Outdated across most EU markets — GDPR-conscious employers prefer minimal personal data." },
      { key: "gender", label: "Gender", stance: "avoid", note: "Unnecessary and GDPR-sensitive — leave it off." },
      { key: "visaStatus", label: "Visa / work permit", stance: "optional", note: "Useful for non-EU citizens applying inside the EU/Schengen area." },
      { key: "drivingLicence", label: "Driving licence", stance: "optional", note: "Common in Germany for field/technical roles; irrelevant elsewhere." },
    ],
    advice: [
      "A4 format, one to two pages.",
      "Photo convention varies by country — match the target market.",
      "List languages with CEFR levels (B2/C1) — they carry real weight.",
      "Europass layout is mainly for EU-institution applications.",
    ],
  },
  gulf: {
    id: "gulf",
    label: "Gulf (GCC)",
    tagline: "UAE / KSA / Qatar — screening-rich personal data",
    fields: [
      { key: "photo", label: "Photo", stance: "expected", note: "Standard on Gulf CVs — recruiters expect a professional headshot next to the contact block." },
      { key: "nationality", label: "Nationality", stance: "expected", note: "A primary screening field — visa quotas and localisation programmes (Emiratisation, Saudisation) filter on it." },
      { key: "visaStatus", label: "Visa status", stance: "expected", note: "State it explicitly (e.g. 'UAE residence visa — transferable', 'transferable Iqama') — recruiters screen on transferability." },
      { key: "dateOfBirth", label: "Date of birth", stance: "optional", note: "Commonly included and used for age-band screening; not strictly required." },
      { key: "maritalStatus", label: "Marital status", stance: "optional", note: "Often present on Gulf CVs; include only if you are comfortable sharing it." },
      { key: "gender", label: "Gender", stance: "optional", note: "Sometimes expected for role-context (e.g. gender-segregated workplaces); optional." },
      { key: "drivingLicence", label: "Driving licence", stance: "optional", note: "Relevant for field, sales and driver roles in KSA/UAE." },
    ],
    advice: [
      "Two pages are acceptable — depth is expected.",
      "Photo, nationality and visa status are standard screening fields.",
      "State language pairs explicitly (Arabic / English / French) with levels.",
      "Notice period / availability is often expected in personal details.",
    ],
  },
};

/** Selector options — "" means "no region / international default". */
export const REGION_OPTIONS: Array<{ value: ResumeRegion | ""; label: string; tagline: string }> = [
  { value: "", label: "International (no regional rules)", tagline: "No region-specific warnings" },
  { value: "na", label: "North America (US / Canada)", tagline: REGION_NORMS.na.tagline },
  { value: "eu", label: "Europe (EU / UK)", tagline: REGION_NORMS.eu.tagline },
  { value: "gulf", label: "Gulf (GCC)", tagline: REGION_NORMS.gulf.tagline },
];

// ─────────────────────────────────────────────────────────────────────────────
// Accessors & detection
// ─────────────────────────────────────────────────────────────────────────────

/** Tolerant region parser — accepts case variants, rejects everything else. */
export function normalizeRegion(value: unknown): ResumeRegion | null {
  if (typeof value !== "string") return null;
  const v = value.trim().toLowerCase();
  if (v === "na" || v === "us" || v === "usa" || v === "canada" || v === "north-america") return "na";
  if (v === "eu" || v === "europe" || v === "uk" || v === "european-union") return "eu";
  if (v === "gulf" || v === "gcc" || v === "uae" || v === "ksa") return "gulf";
  return null;
}

/** Region for a resume — reads contact.region, tolerates malformed rows. */
export function getResumeRegion(resume: ResumeData | null | undefined): ResumeRegion | null {
  if (!resume || typeof resume !== "object") return null;
  const contact = resume.contact as Record<string, unknown> | undefined;
  if (!contact || typeof contact !== "object") return null;
  return normalizeRegion(contact.region);
}

/** True when the personalDetails entry exists with a non-empty value (case-insensitive label lookup). */
export function hasPersonalDetail(resume: ResumeData | null | undefined, label: string): boolean {
  if (!resume) return false;
  const contact = resume.contact as Record<string, unknown> | undefined;
  const pd = contact?.personalDetails;
  if (!pd || typeof pd !== "object") return false;
  const target = label.trim().toLowerCase();
  return Object.keys(pd).some((k) => {
    if (k.trim().toLowerCase() !== target) return false;
    const v = (pd as Record<string, unknown>)[k];
    return typeof v === "string" ? v.trim().length > 0 : v != null && String(v).trim().length > 0;
  });
}

function hasPhoto(resume: ResumeData): boolean {
  return typeof resume.photoUrl === "string" ? resume.photoUrl.trim().length > 0 : !!resume.photoUrl;
}

function hasDateOfBirth(resume: ResumeData): boolean {
  return typeof resume.dateOfBirth === "string" ? resume.dateOfBirth.trim().length > 0 : !!resume.dateOfBirth;
}

/** Generic detector for a norm field on the resume. */
export function hasNormField(resume: ResumeData | null | undefined, key: NormFieldKey): boolean {
  if (!resume) return false;
  switch (key) {
    case "photo":
      return hasPhoto(resume);
    case "dateOfBirth":
      return hasDateOfBirth(resume);
    default: {
      const norm = findFieldNorm(resume, key);
      return norm ? hasPersonalDetail(resume, norm.label) : false;
    }
  }
}

function findFieldNorm(resume: ResumeData | null | undefined, key: NormFieldKey): RegionalFieldNorm | null {
  const region = getResumeRegion(resume);
  if (!region) return null;
  return REGION_NORMS[region].fields.find((f) => f.key === key) ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Compliance report
// ─────────────────────────────────────────────────────────────────────────────

export interface RegionalNormIssue {
  id: string;
  fieldKey: NormFieldKey;
  label: string;
  /** "remove" = field present but region says it hurts; "add" = region expects it. */
  kind: "remove" | "add";
  severity: "warning" | "info";
  message: string;
}

export interface RegionalNormReport {
  /** null → feature dormant (no region selected): no issues, perfect score. */
  region: ResumeRegion | null;
  regionLabel: string;
  /** 0–100 compliance; 100 when dormant or fully compliant. */
  score: number;
  issues: RegionalNormIssue[];
  /** Region's field reference table (for the panel inputs/legend). */
  fields: RegionalFieldNorm[];
  advice: string[];
}

/** Score penalties per (stance × presence) combination. */
const PENALTY_PRESENT_AVOID = 20;
const PENALTY_PRESENT_DISCOURAGED = 10;
const PENALTY_MISSING_EXPECTED = 15;

/**
 * Compute the regional compliance report for a resume. Pure — safe in render.
 * With no region selected the report is dormant (region null, score 100, no
 * issues) so panels can render nothing without special-casing.
 */
export function computeRegionalNormReport(resume: ResumeData | null | undefined): RegionalNormReport {
  const region = getResumeRegion(resume);
  if (!region || !resume) {
    return { region: null, regionLabel: "", score: 100, issues: [], fields: [], advice: [] };
  }
  const norms = REGION_NORMS[region];
  const issues: RegionalNormIssue[] = [];
  let score = 100;

  for (const field of norms.fields) {
    const present = hasNormField(resume, field.key);
    if ((field.stance === "avoid" || field.stance === "discouraged") && present) {
      score -= field.stance === "avoid" ? PENALTY_PRESENT_AVOID : PENALTY_PRESENT_DISCOURAGED;
      issues.push({
        id: `regional_remove_${field.key}`,
        fieldKey: field.key,
        label: field.label,
        kind: "remove",
        severity: field.stance === "avoid" ? "warning" : "info",
        message: field.note,
      });
    } else if (field.stance === "expected" && !present) {
      score -= PENALTY_MISSING_EXPECTED;
      issues.push({
        id: `regional_add_${field.key}`,
        fieldKey: field.key,
        label: field.label,
        kind: "add",
        severity: "warning",
        message: field.note,
      });
    }
  }

  return {
    region,
    regionLabel: norms.label,
    score: Math.max(0, Math.min(100, score)),
    issues,
    fields: norms.fields,
    advice: norms.advice,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// One-click fixes
// ─────────────────────────────────────────────────────────────────────────────

/** personalDetails key lookup — case-insensitive, returns the STORED key. */
function findStoredPdKey(resume: ResumeData, label: string): string | null {
  const contact = resume.contact as Record<string, unknown> | undefined;
  const pd = contact?.personalDetails;
  if (!pd || typeof pd !== "object") return null;
  const target = label.trim().toLowerCase();
  const hit = Object.keys(pd).find((k) => k.trim().toLowerCase() === target);
  return hit ?? null;
}

/**
 * Build the patch that resolves a "remove" issue mechanically:
 * clearing the photo, clearing the DOB, or deleting the matching
 * personalDetails entries. Returns null when there is nothing to patch
 * (including every "add" issue — those need human input, the panel renders
 * the fields for them).
 */
export function buildRegionalFixPatch(
  resume: ResumeData | null | undefined,
  issue: RegionalNormIssue,
): Partial<ResumeData> | null {
  if (!resume || issue.kind !== "remove") return null;

  if (issue.fieldKey === "photo") {
    return hasPhoto(resume) ? { photoUrl: "" } : null;
  }
  if (issue.fieldKey === "dateOfBirth") {
    return hasDateOfBirth(resume) ? { dateOfBirth: "" } : null;
  }

  const norms = REGION_NORMS[getResumeRegion(resume) ?? "na"];
  const field = norms.fields.find((f) => f.key === issue.fieldKey);
  if (!field) return null;
  const storedKey = findStoredPdKey(resume, field.label);
  if (!storedKey) return null;

  const contact = resume.contact as Record<string, unknown> | undefined;
  const pd = (contact?.personalDetails ?? {}) as Record<string, string>;
  const next: Record<string, string> = {};
  const storedLower = storedKey.trim().toLowerCase();
  for (const [k, v] of Object.entries(pd)) {
    if (k.trim().toLowerCase() !== storedLower) next[k] = v;
  }
  return { contact: { ...(contact as ResumeData["contact"]), personalDetails: next } };
}
