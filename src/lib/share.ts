// ResumeAI Pro — Shareable resume links (pure domain logic)
//
// A share is a SELF-CONTAINED snapshot of one resume published under a stable
// token (see workers/api/index.ts → /api/shares + migration 0022). The public
// route /r/<token> fetches the snapshot from GET /api/public/shares/<token>,
// so the link works cross-device without stuffing resume data into the URL
// (the old ?d= base64 blob approach) and without leaking the resume content
// to any third-party QR service (QRs are generated locally via the `qrcode`
// package).
//
// Everything in this file is pure and unit-tested: masking, snapshot
// building, URL building, expiry checks, and D1 row parsing.

import type { ContactInfo, ResumeData } from "./types";

// ============================================================================
// Types
// ============================================================================

/** Owner-facing view of one share row (as returned by GET /api/shares). */
export interface ShareRecord {
  id: string;
  token: string;
  resumeId: string;
  resumeName: string;
  resumeHeadline?: string | null;
  hideContact: boolean;
  active: boolean;
  viewCount: number;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Public reader payload (GET /api/public/shares/:token). */
export interface PublicSharePayload {
  ok: boolean;
  resume: ResumeData;
  hideContact: boolean;
  sharedAt: string;
}

// ============================================================================
// Contact masking — "hide contact details" option
// ============================================================================

/**
 * Personal-contact fields that a public share should drop when the owner
 * asks to hide contact details. Region is deliberately KEPT: it is display
 * metadata for regional norms, not a way to reach the candidate.
 */
const MASKED_CONTACT_KEYS: (keyof ContactInfo)[] = [
  "email",
  "phone",
  "location",
  "website",
  "linkedin",
  "github",
  "twitter",
];

/**
 * Return a copy of the contact with every reachable personal field blanked
 * (including structured personalDetails such as nationality / visa / address).
 * The result keeps `region` so templates and panels still render correctly.
 */
export function maskContactForShare(contact: ContactInfo | undefined): ContactInfo {
  if (!contact || typeof contact !== "object") return {};
  const masked: ContactInfo = { ...contact };
  for (const key of MASKED_CONTACT_KEYS) {
    if (key in masked) delete masked[key];
  }
  if ("personalDetails" in masked) delete masked.personalDetails;
  return masked;
}

// ============================================================================
// Snapshot building
// ============================================================================

function deepClone<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Build the publishable snapshot for a resume.
 *
 * - Deep-clones so later edits to the live resume object never mutate an
 *   already-created share.
 * - `hideContact` blanks every contact channel and sets `shareContactHidden`
 *   so the public page can show "contact details hidden by the owner".
 * - Strips internal-only fields that must never leak in a public payload:
 *   `rawText` (the full original file text, which contains the very contact
 *   details being hidden) and per-experience `old_bullets` (revision
 *   tracking, not part of the rendered resume).
 */
export function buildShareSnapshot(
  resume: ResumeData,
  opts: { hideContact?: boolean } = {},
): ResumeData {
  const snapshot = deepClone(resume);
  delete (snapshot as { rawText?: string }).rawText;
  if (Array.isArray(snapshot.experience)) {
    snapshot.experience = snapshot.experience.map((e) => {
      if (e && typeof e === "object" && "old_bullets" in e) {
        const { old_bullets: _drop, ...rest } = e as typeof e & { old_bullets?: string[] };
        return rest as typeof e;
      }
      return e;
    });
  }
  if (opts.hideContact) {
    snapshot.contact = maskContactForShare(snapshot.contact);
    (snapshot as ResumeData).shareContactHidden = true;
  } else {
    delete (snapshot as ResumeData).shareContactHidden;
  }
  return snapshot;
}

// ============================================================================
// URLs, tokens, expiry
// ============================================================================

/** Default origin used when `window` is unavailable (SSR / tests). */
export const DEFAULT_SHARE_ORIGIN = "https://resumeai-pro.pages.dev";

/** Share tokens are URL-safe opaque strings (see worker shareToken()). */
export const SHARE_TOKEN_RE = /^[A-Za-z0-9_-]{8,64}$/;

export function isValidShareToken(token: string | null | undefined): boolean {
  return typeof token === "string" && SHARE_TOKEN_RE.test(token);
}

/** Build the public URL for a share token. */
export function shareUrlFor(token: string, origin?: string): string {
  let base = origin;
  if (!base && typeof window !== "undefined" && window.location?.origin) {
    base = window.location.origin;
  }
  return `${(base || DEFAULT_SHARE_ORIGIN).replace(/\/+$/, "")}/r/${token}`;
}

/** A share is readable while active and unexpired. `expiresAt` null = never. */
export function isShareActive(
  active: boolean | number | undefined,
  expiresAt: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (active === 0 || active === false) return false;
  if (!expiresAt) return true;
  const t = Date.parse(expiresAt);
  return Number.isNaN(t) ? true : t > now;
}

// ============================================================================
// D1 row parsing (worker rows are snake_case)
// ============================================================================

export function parseShareRow(row: Record<string, unknown>): ShareRecord {
  return {
    id: String(row.id ?? ""),
    token: String(row.token ?? ""),
    resumeId: String(row.resume_id ?? ""),
    resumeName: String(row.resume_name ?? "Untitled resume"),
    resumeHeadline: (row.resume_headline as string) ?? null,
    hideContact: !!row.hide_contact,
    active: !!row.active,
    viewCount: Number(row.view_count ?? 0) || 0,
    expiresAt: (row.expires_at as string) ?? null,
    createdAt: String(row.created_at ?? ""),
    updatedAt: String(row.updated_at ?? ""),
  };
}
