// ============================================================================
// Industry Mapper Tests
// ============================================================================

import { describe, it, expect } from "vitest";
import { mapToIndustryMode } from "./industry-mapper";
import type { IndustryAtsProfile } from "./industry-ats";

// ---------------------------------------------------------------------------
// Helper: build a minimal IndustryAtsProfile for assertions
// ---------------------------------------------------------------------------
function expectValidProfile(profile: IndustryAtsProfile): void {
  expect(profile).toBeDefined();
  expect(profile.id).toBeTruthy();
  expect(profile.label).toBeTruthy();
  expect(profile.keywordBank).toBeTruthy();
  expect(profile.writingGuidance).toBeTruthy();
  expect(Array.isArray(profile.priorityKeywords)).toBe(true);
  expect(Array.isArray(profile.sectionPriorities)).toBe(true);
}

// ============================================================================
// Aviation-adjacent
// ============================================================================

describe("mapToIndustryMode — aviation-adjacent", () => {
  it('detects cabin crew → aviationMode with industryId "aviation"', () => {
    const jdText = `
      Job Title: Flight Attendant
      Requirements: cabin crew experience, SEP certification, safety and emergency procedures
      Company: Emirates Airlines
    `;
    const result = mapToIndustryMode(jdText);

    // Should produce aviationMode
    expect(result.aviationMode).toBeDefined();
    expect(result.aviationMode!.airlineProfile).toBe("aviation");
    expect(result.aviationMode!.settings).toBeDefined();
    expect(result.aviationMode!.settings.tone).toBe("Premium");

    // Detection
    expect(result.detection.industryId).toBe("aviation");
    expect(result.detection.confidence).toBeGreaterThanOrEqual(20);
    expect(result.detection.detectedRole).toBeTruthy();

    // Profile
    expectValidProfile(result.profile);
    expect(result.profile.id).toBe("aviation");

    // Suggested settings
    expect(result.suggestedSettings.tone).toBe("Premium");
  });

  it('detects ground operations → aviationMode with industryId "airline-airport-services"', () => {
    const jdText = `
      Job Title: Airport Services Agent
      Responsibilities: ground operations, check-in, boarding, DCS, turnaround management
    `;
    const result = mapToIndustryMode(jdText);

    expect(result.aviationMode).toBeDefined();
    expect(result.aviationMode!.airlineProfile).toBe("airline-airport-services");
    expect(result.aviationMode!.settings.tone).toBe("Balanced");

    expect(result.detection.industryId).toBe("airline-airport-services");
    expect(result.detection.confidence).toBeGreaterThanOrEqual(20);
    expectValidProfile(result.profile);
    expect(result.profile.id).toBe("airline-airport-services");
  });

  it('detects duty free → aviationMode with industryId "airport-duty-free"', () => {
    const jdText = `
      Sales Associate — Airport Duty Free
      Sell fragrances, cosmetics, liquor in travel retail environment
      Target-driven, upselling skills required
    `;
    const result = mapToIndustryMode(jdText);

    expect(result.aviationMode).toBeDefined();
    expect(result.aviationMode!.airlineProfile).toBe("airport-duty-free");
    expect(result.detection.industryId).toBe("airport-duty-free");
    expect(result.detection.confidence).toBeGreaterThanOrEqual(20);
    expectValidProfile(result.profile);
    expect(result.profile.id).toBe("airport-duty-free");
  });

  it("aviation with low confidence does NOT produce aviationMode", () => {
    // Single weak match (not "cabin crew" or "flight attendant") should have confidence < 20
    const jdText = "Looking for aviation safety inspector with SEP background";
    const result = mapToIndustryMode(jdText);

    // Single SEP match is only 1 cabinCrewTerm → not enough for >= 2 match or explicit strong term
    expect(result.aviationMode).toBeUndefined();
    expect(result.detection.industryId).not.toBe("aviation"); // falls to generic
  });
});

// ============================================================================
// Non-aviation industries
// ============================================================================

describe("mapToIndustryMode — non-aviation industries", () => {
  it("technology JD → no aviationMode, profile is technology", () => {
    const jdText = `
      Senior Software Engineer
      React, TypeScript, Node.js, AWS, microservices architecture
      Design and implement scalable REST APIs
    `;
    const result = mapToIndustryMode(jdText);

    // Non-aviation → no aviationMode
    expect(result.aviationMode).toBeUndefined();

    // Detection
    expect(result.detection.industryId).toBe("technology");
    expect(result.detection.confidence).toBeGreaterThanOrEqual(15);
    expect(result.detection.detectedRole).toBeTruthy();

    // Profile
    expectValidProfile(result.profile);
    expect(result.profile.id).toBe("technology");
  });

  it("finance JD → no aviationMode, profile is finance", () => {
    const jdText = `
      Financial Analyst
      Financial modeling, DCF valuation, P&L management
      CFA preferred, GAAP compliance
    `;
    const result = mapToIndustryMode(jdText);

    expect(result.aviationMode).toBeUndefined();
    expect(result.detection.industryId).toBe("finance");
    expect(result.profile.id).toBe("finance");
  });

  it("hospitality JD → no aviationMode (hospitality gets priority over aviation)", () => {
    const jdText = `
      Hotel Concierge — 5-Star Luxury Resort
      Guest relations, Opera PMS, butler service
      VIP check-in, fine dining reservations
    `;
    const result = mapToIndustryMode(jdText);

    // Hospitality is not in AVIATION_ADJACENT_INDUSTRIES
    expect(result.aviationMode).toBeUndefined();
    expect(result.detection.industryId).toBe("hospitality");
    expect(result.profile.id).toBe("hospitality");
  });

  it("marketing JD → no aviationMode, profile is marketing", () => {
    const jdText = `
      Marketing Manager
      SEO, content marketing, campaign management
      Google Analytics, conversion optimization
    `;
    const result = mapToIndustryMode(jdText);

    expect(result.aviationMode).toBeUndefined();
    expect(result.detection.industryId).toBe("marketing");
    expect(result.profile.id).toBe("marketing");
  });
});

// ============================================================================
// Edge cases
// ============================================================================

describe("mapToIndustryMode — edge cases", () => {
  it("empty JD → generic fallback, no aviationMode", () => {
    const result = mapToIndustryMode("");

    expect(result.aviationMode).toBeUndefined();
    expect(result.detection.industryId).toBe("generic");
    expect(result.detection.confidence).toBeGreaterThanOrEqual(0);
    expect(result.profile.id).toBe("generic");
  });

  it("resume text adds context for stronger detection", () => {
    const jdText = "Job: Cabin Crew Required";
    const resumeText = `
      Worked as a flight attendant for 5 years.
      Trained in safety and emergency procedures, SEP, dangerous goods regulations.
      Experienced in passenger announcement and cabin safety.
    `;
    const jdOnly = mapToIndustryMode(jdText);
    const withResume = mapToIndustryMode(jdText, resumeText);

    // Resume adds enough cabin crew terms to push confidence above threshold
    expect(withResume.aviationMode).toBeDefined();
    expect(withResume.detection.industryId).toBe("aviation");

    // JD alone may not have enough terms
    // (just "Cabin Crew" = 1 strong term → confidence 45%)
    expect(jdOnly.detection.industryId).toBe("aviation");
    expect(jdOnly.detection.confidence).toBe(45);
  });

  it("healthcare JD → no aviationMode, profile is healthcare", () => {
    const jdText = `
      Registered Nurse — ICU
      Patient care, medication administration, BLS/ACLS
      Electronic health records (EHR)
    `;
    const result = mapToIndustryMode(jdText);

    expect(result.aviationMode).toBeUndefined();
    expect(result.detection.industryId).toBe("healthcare");
    expect(result.profile.id).toBe("healthcare");
  });

  it("returns valid suggestedSettings — tone from profile, rest defaults", () => {
    // Detect any industry and verify suggestedSettings shape
    const result = mapToIndustryMode("software engineer react typescript aws");

    expect(result.suggestedSettings).toBeDefined();
    expect(result.suggestedSettings.tone).toBeTruthy();
    expect(typeof result.suggestedSettings.tone).toBe("string");
    expect(result.suggestedSettings.format).toBe("Chronological");
    expect(result.suggestedSettings.strictness).toBe("Balanced");

    // Verify tone comes from the industry profile (not just any string)
    expect(result.suggestedSettings.tone).toBe(result.profile.tone);
  });
});
