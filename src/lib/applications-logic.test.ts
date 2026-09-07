// ============================================================================
// Application Tracker — domain logic tests (pure functions, node env)
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  APPLICATION_STATUSES,
  normalizeStatus,
  appendHistory,
  sanitizeApplication,
  parseDbApplication,
  toApiBody,
  isFollowUpDue,
  dueFollowUps,
  daysSinceApplied,
  computeStats,
  type ApplicationRecord,
} from "./applications-logic";

// Timezone-safe date builders: construct through local Date parts so the
// assertions hold no matter which TZ the CI container runs in.
const NOW = new Date(2026, 8, 7, 12, 0, 0); // Sep 7 2026, noon local
const localIso = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12).toISOString();

function baseApp(overrides: Partial<ApplicationRecord> = {}): ApplicationRecord {
  return sanitizeApplication({
    id: "app_test1",
    company: "Acme",
    role: "Engineer",
    status: "applied",
    createdAt: localIso(2026, 9, 1),
    updatedAt: localIso(2026, 9, 1),
    ...overrides,
  }, NOW);
}

describe("normalizeStatus", () => {
  it("passes through all canonical keys", () => {
    for (const s of APPLICATION_STATUSES) {
      expect(normalizeStatus(s)).toBe(s);
    }
  });

  it("maps legacy display labels from the old in-memory tracker", () => {
    expect(normalizeStatus("Applied")).toBe("applied");
    expect(normalizeStatus("Phone Screen")).toBe("phone-screen");
    expect(normalizeStatus("Interview")).toBe("interview");
    expect(normalizeStatus("Offer")).toBe("offer");
    expect(normalizeStatus("Rejected")).toBe("rejected");
  });

  it("is case- and whitespace-insensitive", () => {
    expect(normalizeStatus("PHONE SCREEN")).toBe("phone-screen");
    expect(normalizeStatus("  applied ")).toBe("applied");
  });

  it("maps synonyms and falls back to wishlist for unknown values", () => {
    expect(normalizeStatus("hired")).toBe("offer");
    expect(normalizeStatus("declined")).toBe("rejected");
    expect(normalizeStatus("saved")).toBe("wishlist");
    expect(normalizeStatus("weird-status")).toBe("wishlist");
  });

  it("handles non-string input", () => {
    expect(normalizeStatus(null)).toBe("wishlist");
    expect(normalizeStatus(42)).toBe("wishlist");
    expect(normalizeStatus(undefined)).toBe("wishlist");
  });
});

describe("appendHistory", () => {
  it("appends a transition entry", () => {
    const h = appendHistory([], "interview", "2026-09-07T00:00:00Z", "applied");
    expect(h).toHaveLength(1);
    expect(h[0]).toEqual({ at: "2026-09-07T00:00:00Z", from: "applied", to: "interview" });
  });

  it("tolerates null/undefined history", () => {
    const h = appendHistory(null, "applied", "2026-09-07T00:00:00Z");
    expect(h).toHaveLength(1);
    expect(h[0].from).toBeNull();
  });

  it("caps history at 50 entries (newest kept)", () => {
    let h = appendHistory([], "applied", "2026-01-01T00:00:00Z");
    for (let i = 0; i < 60; i++) {
      h = appendHistory(h, "applied", `2026-01-0${(i % 9) + 1}T00:00:0${i % 10}Z`);
    }
    expect(h.length).toBeLessThanOrEqual(50);
  });
});

describe("sanitizeApplication", () => {
  it("fills defaults for an empty payload", () => {
    const a = sanitizeApplication({}, NOW);
    expect(a.id).toMatch(/^app_/);
    expect(a.status).toBe("wishlist");
    expect(a.company).toBe("");
    expect(a.history).toHaveLength(1); // synthesized entry
    expect(a.history[0].to).toBe("wishlist");
    expect(a.createdAt).toBe(NOW.toISOString());
  });

  it("truncates oversized strings and rejects invalid dates", () => {
    const a = sanitizeApplication({
      company: "x".repeat(500),
      appliedAt: "not-a-date",
      url: "javascript:alert(1)",
    }, NOW);
    expect(a.company.length).toBeLessThanOrEqual(160);
    expect(a.appliedAt).toBeNull();
    expect(a.url).toBe("javascript:alert(1)".slice(0, 2000)); // sanitized, not executed — no rendering here
  });

  it("normalizes legacy statuses coming from old backups", () => {
    const a = sanitizeApplication({ status: "Phone Screen" }, NOW);
    expect(a.status).toBe("phone-screen");
  });

  it("preserves a valid id", () => {
    const a = sanitizeApplication({ id: "app_keep" }, NOW);
    expect(a.id).toBe("app_keep");
  });
});

describe("parseDbApplication (D1 snake_case row)", () => {
  it("maps columns and parses history_json", () => {
    const row = {
      id: "app_db1",
      user_id: "u1",
      company: "Gulf Tech",
      role: "Frontend Dev",
      status: "interview",
      source: "LinkedIn",
      url: "https://jobs.example/1",
      location: "Dubai",
      salary: "25k AED",
      resume_id: "r_1",
      notes: " Recruiter: Sara ",
      applied_at: localIso(2026, 9, 1),
      next_action_at: localIso(2026, 9, 5),
      next_action_note: "Follow up",
      history_json: JSON.stringify([{ at: localIso(2026, 9, 2), from: "applied", to: "interview" }]),
      created_at: localIso(2026, 9, 1),
      updated_at: localIso(2026, 9, 3),
    };
    const a = parseDbApplication(row);
    expect(a.resumeId).toBe("r_1");
    expect(a.status).toBe("interview");
    expect(a.history).toHaveLength(1);
    expect(a.history[0].to).toBe("interview");
    expect(a.appliedAt).toBeTruthy();
  });

  it("survives corrupt history_json", () => {
    const a = parseDbApplication({ id: "app_db2", history_json: "{not json", status: "applied" });
    expect(a.history).toHaveLength(1); // synthesized
    expect(a.status).toBe("applied");
  });
});

describe("toApiBody", () => {
  it("round-trips through sanitizeApplication (API body → parse → same record)", () => {
    const a = baseApp({ status: "interview", nextActionAt: localIso(2026, 9, 10) });
    const body = toApiBody(a);
    expect(body.status).toBe("interview");
    expect(body.resumeId).toBeNull();
    const back = sanitizeApplication(body, NOW);
    expect(back.status).toBe(a.status);
    expect(back.history).toEqual(a.history);
    expect(back.nextActionAt).toBe(a.nextActionAt);
  });
});

describe("isFollowUpDue", () => {
  it("is due when nextActionAt is today and status is active", () => {
    const a = baseApp({ status: "applied", nextActionAt: localIso(2026, 9, 7) });
    expect(isFollowUpDue(a, NOW)).toBe(true);
  });

  it("is due when nextActionAt is overdue", () => {
    const a = baseApp({ status: "applied", nextActionAt: localIso(2026, 9, 1) });
    expect(isFollowUpDue(a, NOW)).toBe(true);
  });

  it("is not due for a future date", () => {
    const a = baseApp({ status: "applied", nextActionAt: localIso(2026, 9, 8) });
    expect(isFollowUpDue(a, NOW)).toBe(false);
  });

  it("ignores applications without a reminder", () => {
    const a = baseApp({ status: "applied", nextActionAt: null });
    expect(isFollowUpDue(a, NOW)).toBe(false);
  });

  it("never chases terminal or wishlist stages", () => {
    for (const status of ["offer", "rejected", "wishlist"] as const) {
      const a = baseApp({ status, nextActionAt: localIso(2026, 9, 1) });
      expect(isFollowUpDue(a, NOW)).toBe(false);
    }
  });
});

describe("dueFollowUps", () => {
  it("returns only due items, sorted soonest first", () => {
    const apps = [
      baseApp({ id: "a", nextActionAt: localIso(2026, 9, 6) }),
      baseApp({ id: "b", nextActionAt: localIso(2026, 9, 2) }),
      baseApp({ id: "c", nextActionAt: localIso(2026, 9, 8) }), // future
      baseApp({ id: "d", nextActionAt: localIso(2026, 9, 4), status: "offer" }), // terminal
    ];
    const due = dueFollowUps(apps, NOW);
    expect(due.map((a) => a.id)).toEqual(["b", "a"]);
  });
});

describe("daysSinceApplied", () => {
  it("counts full days since appliedAt", () => {
    const a = baseApp({ appliedAt: localIso(2026, 9, 4) });
    expect(daysSinceApplied(a, NOW)).toBe(3);
  });

  it("returns -1 when unknown", () => {
    expect(daysSinceApplied(baseApp({ appliedAt: null }), NOW)).toBe(-1);
  });
});

describe("computeStats", () => {
  it("computes counts and rates", () => {
    const apps = [
      baseApp({ id: "1", status: "wishlist" }),
      baseApp({ id: "2", status: "applied" }),
      baseApp({ id: "3", status: "applied" }),
      baseApp({ id: "4", status: "interview" }),
      baseApp({ id: "5", status: "offer" }),
      baseApp({ id: "6", status: "rejected" }),
    ];
    const s = computeStats(apps);
    expect(s.total).toBe(6);
    expect(s.wishlist).toBe(1);
    expect(s.active).toBe(3); // applied x2 + interview
    expect(s.interviews).toBe(1);
    expect(s.offers).toBe(1);
    expect(s.rejected).toBe(1);
    expect(s.responseRate).toBeCloseTo(3 / 5); // responded (1+1+1) / sent (5)
    expect(s.offerRate).toBeCloseTo(1 / 5);
  });

  it("returns zeros for an empty pipeline", () => {
    const s = computeStats([]);
    expect(s.total).toBe(0);
    expect(s.responseRate).toBe(0);
    expect(s.offerRate).toBe(0);
  });

  it("never divides by zero when everything is a wishlist entry", () => {
    const s = computeStats([baseApp({ id: "w", status: "wishlist" })]);
    expect(s.responseRate).toBe(0);
    expect(s.offerRate).toBe(0);
  });
});
