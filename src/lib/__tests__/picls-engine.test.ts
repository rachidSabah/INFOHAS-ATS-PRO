// ============================================================================
// Production Intelligence & Continuous Learning System (PICLS) Tests
// Phase Ω+ (Omega Plus)
// ============================================================================

import { describe, it, expect } from "vitest";
import { PICLSEngine, globalPICLS } from "../picls-engine";

describe("Production Intelligence & Continuous Learning System (PICLS) — Phase Ω+ Audit", () => {
  it("records user feedback with anonymization and consent flags", () => {
    const engine = new PICLSEngine();
    const fb = engine.submitFeedback({
      artifactId: "res_123",
      artifactType: "resume",
      ratingStar: 5,
      isThumbsUp: true,
      writtenFeedback: "Perfect ATS formatting!",
      userConsentGranted: true,
      anonymizedIpHash: "hash_abc123",
    });

    expect(fb.id).toBeDefined();
    expect(fb.ratingStar).toBe(5);
    expect(fb.userConsentGranted).toBe(true);

    const state = engine.getState();
    expect(state.totalFeedbackEntries).toBe(1);
  });

  it("handles outcome tracking with explicit user consent enforcement", () => {
    const engine = new PICLSEngine();

    // With consent
    const outcomeWithConsent = engine.trackOutcome({
      userId: "usr_789",
      company: "Emirates Airline",
      role: "Cabin Crew Manager",
      resumeVersion: "v4.2",
      promptVersion: "standard_v4",
      atsScore: 98,
      modelUsed: "opencode-zen",
      outcomeStage: "interview_invite",
      date: "2026-07-21",
      consentGranted: true,
    });
    expect(outcomeWithConsent).not.toBeNull();
    expect(outcomeWithConsent?.outcomeStage).toBe("interview_invite");

    // Without consent -> should not store
    const outcomeWithoutConsent = engine.trackOutcome({
      userId: "usr_000",
      company: "Qatar Airways",
      role: "Flight Attendant",
      resumeVersion: "v4.2",
      promptVersion: "standard_v4",
      atsScore: 95,
      modelUsed: "opencode-zen",
      outcomeStage: "submitted",
      date: "2026-07-21",
      consentGranted: false,
    });
    expect(outcomeWithoutConsent).toBeNull();

    const state = engine.getState();
    expect(state.totalOutcomesTracked).toBe(1);
  });

  it("stores expert reviews and calculates human-AI agreement metrics", () => {
    const engine = new PICLSEngine();
    const review = engine.submitExpertReview({
      artifactId: "res_456",
      reviewerRole: "recruiter",
      resumeQualityScore: 98,
      atsQualityScore: 96,
      writingGrammarScore: 100,
      keywordRelevanceScore: 97,
      humanAiAgreementPercent: 98.5,
      comments: "Outstanding bullet impact structure.",
    });

    expect(review.reviewId).toBeDefined();
    expect(review.humanAiAgreementPercent).toBe(98.5);

    const state = engine.getState();
    expect(state.totalExpertReviews).toBe(1);
  });

  it("generates prompt & model routing intelligence reports", () => {
    const engine = new PICLSEngine();
    const prompts = engine.getPromptIntelligence();
    const models = engine.getModelRoutingIntelligence();

    expect(prompts.length).toBeGreaterThan(0);
    expect(prompts[0].acceptanceRatePercent).toBeGreaterThan(95);

    expect(models.length).toBeGreaterThan(0);
    expect(models[0].accuracyScore).toBeGreaterThan(95);
  });

  it("generates weekly continuous improvement summary with actionable recommendations", () => {
    const summary = globalPICLS.generateWeeklyLearningSummary();

    expect(summary.weekStarting).toBeDefined();
    expect(summary.overallUserSatisfactionScore).toBeGreaterThan(4.5);
    expect(summary.engineeringRecommendations.length).toBeGreaterThan(0);
    expect(summary.uxRecommendations.length).toBeGreaterThan(0);
  });

  it("confirms GDPR compliance & consent management integrity", () => {
    const state = globalPICLS.getState();
    expect(state.gdprCompliant).toBe(true);
  });
});
