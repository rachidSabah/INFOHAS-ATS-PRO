// ============================================================================
// Shareable resume links — domain logic tests (pure functions, node env)
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  maskContactForShare,
  buildShareSnapshot,
  shareUrlFor,
  isValidShareToken,
  isShareActive,
  parseShareRow,
  DEFAULT_SHARE_ORIGIN,
  type ShareRecord,
} from "./share";
import type { ResumeData } from "./types";

// ── Fixture helpers ──────────────────────────────────────────────────────────
function baseResume(overrides: Partial<ResumeData> = {}): ResumeData {
  return {
    id: "r_share",
    name: "Rachid El Sabah",
    headline: "Senior Frontend Engineer",
    contact: {
      email: "rachid@example.com",
      phone: "+212 600 000 000",
      location: "Casablanca, Morocco",
      website: "https://rachid.dev",
      linkedin: "linkedin.com/in/rachid",
      github: "github.com/rachid",
      twitter: "@rachid",
      personalDetails: { Nationality: "Moroccan", "Visa status": "Transferable Iqama" },
      region: "gulf",
    },
    summary: "Frontend engineer with 8 years of experience.",
    experience: [
      {
        id: "e1",
        title: "Lead Engineer",
        company: "Acme",
        startDate: "2020-01",
        endDate: "Present",
        bullets: ["Led the platform team."],
        old_bullets: ["Wrote code.", "Fixed bugs."],
      },
    ],
    education: [],
    skills: [{ id: "s1", name: "React", category: "Frontend" }],
    projects: [],
    certifications: [],
    languages: [{ id: "l1", name: "English", proficiency: "fluent" }],
    achievements: [],
    template: "ats-professional",
    accentColor: "#1154A3",
    rawText: "FULL ORIGINAL FILE TEXT INCLUDING +212 600 000 000",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  };
}

// ── maskContactForShare ──────────────────────────────────────────────────────
describe("maskContactForShare", () => {
  it("blanks every reachable personal channel", () => {
    const masked = maskContactForShare(baseResume().contact);
    expect(masked.email).toBeUndefined();
    expect(masked.phone).toBeUndefined();
    expect(masked.location).toBeUndefined();
    expect(masked.website).toBeUndefined();
    expect(masked.linkedin).toBeUndefined();
    expect(masked.github).toBeUndefined();
    expect(masked.twitter).toBeUndefined();
  });

  it("drops structured personalDetails entirely", () => {
    const masked = maskContactForShare(baseResume().contact);
    expect(masked.personalDetails).toBeUndefined();
  });

  it("keeps region — display metadata, not a contact channel", () => {
    const masked = maskContactForShare(baseResume().contact);
    expect(masked.region).toBe("gulf");
  });

  it("does not mutate the input contact object", () => {
    const contact = baseResume().contact;
    const before = JSON.stringify(contact);
    maskContactForShare(contact);
    expect(JSON.stringify(contact)).toBe(before);
  });

  it("tolerates undefined / garbage input", () => {
    expect(maskContactForShare(undefined)).toEqual({});
    expect(maskContactForShare(null as unknown as Record<string, never>)).toEqual({});
  });
});

// ── buildShareSnapshot ───────────────────────────────────────────────────────
describe("buildShareSnapshot", () => {
  it("preserves the rendered resume content with hideContact off", () => {
    const snap = buildShareSnapshot(baseResume());
    expect(snap.name).toBe("Rachid El Sabah");
    expect(snap.experience[0].bullets).toEqual(["Led the platform team."]);
    expect(snap.skills[0].name).toBe("React");
    expect(snap.template).toBe("ats-professional");
    expect(snap.contact.email).toBe("rachid@example.com");
    expect(snap.shareContactHidden).toBeUndefined();
  });

  it("never leaks rawText into the public payload", () => {
    const snap = buildShareSnapshot(baseResume(), { hideContact: true });
    expect((snap as { rawText?: string }).rawText).toBeUndefined();
  });

  it("never leaks revision-tracked old_bullets", () => {
    const snap = buildShareSnapshot(baseResume());
    expect((snap.experience[0] as { old_bullets?: string[] }).old_bullets).toBeUndefined();
  });

  it("masks contact and sets shareContactHidden when hideContact is on", () => {
    const snap = buildShareSnapshot(baseResume(), { hideContact: true });
    expect(snap.contact.email).toBeUndefined();
    expect(snap.contact.phone).toBeUndefined();
    expect(snap.contact.personalDetails).toBeUndefined();
    expect(snap.shareContactHidden).toBe(true);
  });

  it("clears a stale shareContactHidden flag when hideContact is off", () => {
    const marked = baseResume();
    marked.shareContactHidden = true;
    const snap = buildShareSnapshot(marked);
    expect(snap.shareContactHidden).toBeUndefined();
  });

  it("deep-clones: mutating the snapshot never touches the source resume", () => {
    const resume = baseResume();
    const snap = buildShareSnapshot(resume);
    snap.name = "CHANGED";
    snap.experience[0].bullets.push("injected");
    expect(resume.name).toBe("Rachid El Sabah");
    expect(resume.experience[0].bullets).toEqual(["Led the platform team."]);
  });
});

// ── Tokens & URLs ────────────────────────────────────────────────────────────
describe("share URLs and tokens", () => {
  it("accepts well-formed URL-safe tokens", () => {
    expect(isValidShareToken("AbC23xyzW9kQ")).toBe(true);
    expect(isValidShareToken("a".repeat(64))).toBe(true);
  });

  it("rejects garbage, short and unsafe tokens", () => {
    expect(isValidShareToken("")).toBe(false);
    expect(isValidShareToken("short7")).toBe(false);
    expect(isValidShareToken("has/dots…" + "a".repeat(12))).toBe(false);
    expect(isValidShareToken("../etc/passwd")).toBe(false);
    expect(isValidShareToken(null)).toBe(false);
    expect(isValidShareToken(undefined)).toBe(false);
  });

  it("builds the public reader URL from an explicit origin", () => {
    expect(shareUrlFor("AbC23xyzW9kQ", "https://example.com")).toBe(
      "https://example.com/r/AbC23xyzW9kQ",
    );
  });

  it("strips trailing slashes from the origin", () => {
    expect(shareUrlFor("AbC23xyzW9kQ", "https://example.com///")).toBe(
      "https://example.com/r/AbC23xyzW9kQ",
    );
  });

  it("falls back to the production origin when window is unavailable", () => {
    // vitest node env has no window — exercises the SSR fallback.
    expect(shareUrlFor("AbC23xyzW9kQ")).toBe(`${DEFAULT_SHARE_ORIGIN}/r/AbC23xyzW9kQ`);
  });
});

// ── Expiry & activity ────────────────────────────────────────────────────────
describe("isShareActive", () => {
  const now = Date.parse("2026-09-08T12:00:00.000Z");

  it("is active when never expiring", () => {
    expect(isShareActive(true, null, now)).toBe(true);
    expect(isShareActive(1, undefined, now)).toBe(true);
  });

  it("is inactive when revoked (active flag falsey)", () => {
    expect(isShareActive(false, null, now)).toBe(false);
    expect(isShareActive(0, null, now)).toBe(false);
  });

  it("respects expiry boundaries", () => {
    expect(isShareActive(true, "2026-09-08T11:59:59.000Z", now)).toBe(false);
    expect(isShareActive(true, "2026-09-08T12:00:01.000Z", now)).toBe(true);
  });

  it("treats an unparseable expiry as never-expiring (fail open)", () => {
    expect(isShareActive(true, "not-a-date", now)).toBe(true);
  });
});

// ── parseShareRow ────────────────────────────────────────────────────────────
describe("parseShareRow", () => {
  it("maps snake_case D1 rows to the ShareRecord shape", () => {
    const rec: ShareRecord = parseShareRow({
      id: "sh_1",
      token: "AbC23xyzW9kQ",
      resume_id: "r_share",
      resume_name: "My Resume",
      resume_headline: "Engineer",
      hide_contact: 1,
      active: 1,
      view_count: "42",
      expires_at: null,
      created_at: "2026-09-01T00:00:00.000Z",
      updated_at: "2026-09-02T00:00:00.000Z",
    });
    expect(rec).toEqual({
      id: "sh_1",
      token: "AbC23xyzW9kQ",
      resumeId: "r_share",
      resumeName: "My Resume",
      resumeHeadline: "Engineer",
      hideContact: true,
      active: true,
      viewCount: 42,
      expiresAt: null,
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-02T00:00:00.000Z",
    });
  });

  it("defaults defensively on partial rows", () => {
    const rec = parseShareRow({});
    expect(rec.resumeName).toBe("Untitled resume");
    expect(rec.viewCount).toBe(0);
    expect(rec.hideContact).toBe(false);
    expect(rec.active).toBe(false);
  });
});
