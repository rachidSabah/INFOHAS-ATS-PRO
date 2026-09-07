// ============================================================================
// Application Tracker — pure domain logic (no React, no store, no DOM).
// ============================================================================
// Everything here is deterministic and unit-tested (applications-logic.test.ts).
// The Zustand slice (store/applications-slice.ts), the cloud client
// (cloud-api.ts) and the Workers D1 endpoints (workers/api/index.ts) all
// consume these helpers so status normalization, reminder computation and
// stats follow ONE definition across client, server and tests.

// ---------------------------------------------------------------------------
// Statuses
// ---------------------------------------------------------------------------

export const APPLICATION_STATUSES = [
  "wishlist",
  "applied",
  "phone-screen",
  "interview",
  "offer",
  "rejected",
] as const;

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/** Display labels — Kanban column headers and selects. */
export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  wishlist: "Wishlist",
  applied: "Applied",
  "phone-screen": "Phone Screen",
  interview: "Interview",
  offer: "Offer",
  rejected: "Rejected",
};

/** Column order for the Kanban board (left → right). */
export const APPLICATION_COLUMNS: ApplicationStatus[] = [
  "wishlist",
  "applied",
  "phone-screen",
  "interview",
  "offer",
  "rejected",
];

/** Statuses where the candidate is still waiting / acting — follow-ups apply. */
const ACTIVE_PIPELINE: ReadonlySet<string> = new Set([
  "applied",
  "phone-screen",
  "interview",
]);

/**
 * Normalize any raw status (legacy label, different case, unknown value) to a
 * valid ApplicationStatus. The old in-memory tracker stored display labels
 * ("Applied", "Phone Screen") directly as status values — those map cleanly.
 * Unknown / empty values fall back to "wishlist" so nothing ever disappears
 * from the board.
 */
export function normalizeStatus(raw: unknown): ApplicationStatus {
  if (typeof raw !== "string") return "wishlist";
  const key = raw.trim().toLowerCase().replace(/\s+/g, "-");
  if ((APPLICATION_STATUSES as readonly string[]).includes(key)) {
    return key as ApplicationStatus;
  }
  // Legacy display labels from the pre-persistence stub.
  const legacy: Record<string, ApplicationStatus> = {
    "phone-screen": "phone-screen",
    "phone": "phone-screen",
    "screening": "phone-screen",
    "wishlist": "wishlist",
    "saved": "wishlist",
    "interested": "wishlist",
    "applied": "applied",
    "application-sent": "applied",
    "interview": "interview",
    "technical": "interview",
    "onsite": "interview",
    "offer": "offer",
    "hired": "offer",
    "rejected": "rejected",
    "declined": "rejected",
    "closed": "rejected",
  };
  return legacy[key] ?? "wishlist";
}

// ---------------------------------------------------------------------------
// Record types
// ---------------------------------------------------------------------------

export interface ApplicationHistoryEntry {
  at: string; // ISO timestamp of the transition
  from: ApplicationStatus | null;
  to: ApplicationStatus;
}

export interface ApplicationRecord {
  id: string;
  company: string;
  role: string;
  status: ApplicationStatus;
  source: string;        // where the job was found (LinkedIn, referral, …)
  url: string;           // job posting URL
  location: string;
  salary: string;        // free text ("25k AED/month")
  resumeId: string | null; // which resume was sent
  notes: string;
  appliedAt: string | null;      // ISO date the application was sent
  nextActionAt: string | null;   // ISO date — follow-up reminder
  nextActionNote: string;        // e.g. "Follow up with HR"
  history: ApplicationHistoryEntry[];
  createdAt: string;
  updatedAt: string;
}

const HISTORY_CAP = 50;

/** Append a status transition to an application's history (newest last). */
export function appendHistory(
  history: ApplicationHistoryEntry[] | undefined | null,
  to: ApplicationStatus,
  at: string,
  from?: ApplicationStatus | null,
): ApplicationHistoryEntry[] {
  const base = Array.isArray(history) ? history.slice(-HISTORY_CAP + 1) : [];
  base.push({ at, from: from ?? null, to });
  return base.slice(-HISTORY_CAP);
}

// ---------------------------------------------------------------------------
// Sanitization — coerce untrusted input (dialogs, D1 rows, old backups) into
// a clean ApplicationRecord.
// ---------------------------------------------------------------------------

function safeStr(v: unknown, max = 500): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

function safeIsoDate(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function sanitizeApplication(raw: any, now = new Date()): ApplicationRecord {
  const nowIso = now.toISOString();
  let history: ApplicationHistoryEntry[] = [];
  if (Array.isArray(raw?.history)) {
    history = raw.history
      .filter((h: any) => h && typeof h === "object")
      .slice(-HISTORY_CAP)
      .map((h: any) => ({
        at: safeIsoDate(h.at) ?? nowIso,
        from: h.from ? normalizeStatus(h.from) : null,
        to: normalizeStatus(h.to),
      }));
  }
  const status = normalizeStatus(raw?.status);
  if (history.length === 0 || history[history.length - 1].to !== status) {
    history = appendHistory(history, status, safeIsoDate(raw?.updatedAt) ?? nowIso, history.length ? history[history.length - 1].to : null);
  }
  return {
    id: typeof raw?.id === "string" && raw.id ? raw.id.slice(0, 64) : `app_${Math.random().toString(36).slice(2, 9)}${Date.now().toString(36).slice(-4)}`,
    company: safeStr(raw?.company, 160),
    role: safeStr(raw?.role, 160),
    status,
    source: safeStr(raw?.source, 80),
    url: safeStr(raw?.url, 2000),
    location: safeStr(raw?.location, 160),
    salary: safeStr(raw?.salary, 120),
    resumeId: typeof raw?.resumeId === "string" && raw.resumeId ? raw.resumeId : null,
    notes: safeStr(raw?.notes, 5000),
    appliedAt: safeIsoDate(raw?.appliedAt),
    nextActionAt: safeIsoDate(raw?.nextActionAt),
    nextActionNote: safeStr(raw?.nextActionNote, 300),
    history,
    createdAt: safeIsoDate(raw?.createdAt) ?? nowIso,
    updatedAt: safeIsoDate(raw?.updatedAt) ?? nowIso,
  };
}

/**
 * Parse a raw D1 row (snake_case columns, JSON strings) into an
 * ApplicationRecord. Mirrors parseDbResume's contract in cloud-api.ts.
 */
export function parseDbApplication(row: any): ApplicationRecord {
  let history: ApplicationHistoryEntry[] = [];
  try {
    if (row?.history_json) history = JSON.parse(row.history_json);
  } catch {
    history = [];
  }
  return sanitizeApplication(
    {
      id: row?.id,
      company: row?.company,
      role: row?.role,
      status: row?.status,
      source: row?.source,
      url: row?.url,
      location: row?.location,
      salary: row?.salary,
      resumeId: row?.resume_id ?? null,
      notes: row?.notes,
      appliedAt: row?.applied_at ?? null,
      nextActionAt: row?.next_action_at ?? null,
      nextActionNote: row?.next_action_note,
      history,
      createdAt: row?.created_at,
      updatedAt: row?.updated_at,
    },
    // Deterministic "now" is not needed here — sanitize falls back internally.
  );
}

/** ApplicationRecord → plain JSON body for the Workers API. */
export function toApiBody(a: ApplicationRecord): Record<string, unknown> {
  return {
    id: a.id,
    company: a.company,
    role: a.role,
    status: a.status,
    source: a.source,
    url: a.url,
    location: a.location,
    salary: a.salary,
    resumeId: a.resumeId,
    notes: a.notes,
    appliedAt: a.appliedAt,
    nextActionAt: a.nextActionAt,
    nextActionNote: a.nextActionNote,
    history: a.history,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

// ---------------------------------------------------------------------------
// Follow-up reminders
// ---------------------------------------------------------------------------

/** Local YYYY-MM-DD for date-only comparison (time-of-day ignored). */
function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Is this application's follow-up due (or overdue) as of `now`?
 * True when a nextActionAt date exists, falls on/before today, and the
 * application is still in an active pipeline stage (applied / phone-screen /
 * interview). Wishlist items were never sent; offer/rejected need no chasing.
 */
export function isFollowUpDue(a: ApplicationRecord, now = new Date()): boolean {
  if (!a?.nextActionAt) return false;
  if (!ACTIVE_PIPELINE.has(a.status)) return false;
  const due = dayKey(a.nextActionAt);
  if (!due) return false;
  return due <= dayKey(now.toISOString());
}

/** All due follow-ups, soonest first. */
export function dueFollowUps(apps: ApplicationRecord[], now = new Date()): ApplicationRecord[] {
  return apps
    .filter((a) => isFollowUpDue(a, now))
    .sort((x, y) => String(x.nextActionAt).localeCompare(String(y.nextActionAt)));
}

/** Days since the application was sent (for card badges). -1 when unknown. */
export function daysSinceApplied(a: ApplicationRecord, now = new Date()): number {
  if (!a.appliedAt) return -1;
  const then = new Date(a.appliedAt).getTime();
  if (Number.isNaN(then)) return -1;
  return Math.max(0, Math.floor((now.getTime() - then) / 86_400_000));
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

export interface ApplicationStats {
  total: number;
  wishlist: number;
  applied: number;
  active: number;      // applied + phone-screen + interview
  interviews: number;  // interview stage
  offers: number;
  rejected: number;
  /** Share of non-wishlist applications that produced a human response. */
  responseRate: number; // 0..1
  /** Share of non-wishlist applications that reached offer. */
  offerRate: number;    // 0..1
}

export function computeStats(apps: ApplicationRecord[]): ApplicationStats {
  let wishlist = 0, applied = 0, phoneScreen = 0, interviews = 0, offers = 0, rejected = 0;
  for (const a of apps) {
    switch (a.status) {
      case "wishlist": wishlist++; break;
      case "applied": applied++; break;
      case "phone-screen": phoneScreen++; break;
      case "interview": interviews++; break;
      case "offer": offers++; break;
      case "rejected": rejected++; break;
    }
  }
  const tracked = apps.length - wishlist; // things actually sent out
  const responded = interviews + offers + rejected; // someone got back to you
  const safeDiv = (n: number, d: number) => (d > 0 ? n / d : 0);
  return {
    total: apps.length,
    wishlist,
    applied,
    active: applied + phoneScreen + interviews,
    interviews,
    offers,
    rejected,
    responseRate: safeDiv(responded, tracked),
    offerRate: safeDiv(offers, tracked),
  };
}
