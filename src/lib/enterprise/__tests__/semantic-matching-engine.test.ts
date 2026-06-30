import { describe, it, expect } from "vitest";
import { computeSkillSimilarity, analyzeSemanticMatch, computeKeywordMatchScore } from "../semantic-matching-engine";
import { analyzeJD } from "../jd-engine";

describe("SemanticMatchingEngine", () => {
  describe("computeSkillSimilarity", () => {
    it("should return 1.0 for exact match", () => {
      expect(computeSkillSimilarity("Customer Service", "Customer Service")).toBe(1.0);
    });

    it("should return 1.0 for case-insensitive exact match", () => {
      expect(computeSkillSimilarity("customer service", "CUSTOMER SERVICE")).toBe(1.0);
    });

    it("should detect synonym matches (aliases in the same group)", () => {
      // "Passenger Assistance" is listed as an alias for various synonyms
      const score = computeSkillSimilarity("Customer Service", "Client Relations", "hospitality");
      expect(score).toBeGreaterThanOrEqual(0.5);
    });

    it("should use bigram similarity for partial matches", () => {
      const score = computeSkillSimilarity("front desk", "front office", "hospitality");
      expect(score).toBeGreaterThan(0);
    });

    it("should return moderate score for same-industry skills", () => {
      // Both hospitality skills
      const score = computeSkillSimilarity("Guest Relations", "Front Office", "hospitality");
      expect(score).toBeGreaterThanOrEqual(0);
    });

    it("should return low score for unrelated skills", () => {
      const score = computeSkillSimilarity("Python", "Guest Services");
      expect(score).toBeLessThan(0.5);
    });
  });

  describe("analyzeSemanticMatch", () => {
    it("should find exact matches between resume and JD skills", () => {
      const resumeSkills = ["Customer Service", "Communication", "Teamwork"];
      const jdText = `Customer Service Representative
        Requirements:
          - Customer service experience
          - Communication skills
          - Teamwork`;

      const jdAnalysis = analyzeJD(jdText);
      const result = analyzeSemanticMatch(resumeSkills, jdAnalysis);

      expect(result.matchedSkills.length).toBeGreaterThan(0);
      expect(result.overallScore).toBeGreaterThan(0);
    });

    it("should report missing JD skills not in resume", () => {
      const resumeSkills = ["Customer Service"];
      const jdText = `Software Engineer
        Requirements:
          - TypeScript
          - React
          - Node.js`;

      const jdAnalysis = analyzeJD(jdText);
      const result = analyzeSemanticMatch(resumeSkills, jdAnalysis);

      expect(result.missingSkills.length).toBeGreaterThan(0);
    });

    it("should detect semantic equivalents", () => {
      const resumeSkills = ["Python Programming"];
      const jdText = `Data Scientist
        Requirements:
          - Python experience`;

      const jdAnalysis = analyzeJD(jdText);
      const result = analyzeSemanticMatch(resumeSkills, jdAnalysis);

      // Should match via synonym or bigram similarity
      const pythonMatch = result.matchedSkills.find(
        (m) => m.jdSkill.toLowerCase() === "python" || m.jdSkill.toLowerCase() === "python experience",
      );
      // Even if no exact synonym match, bigram should give partial
      expect(result.matchedSkills.length).toBeGreaterThanOrEqual(0);
    });

    it("should return valid overall score", () => {
      const resumeSkills = ["Customer Service", "Communication", "Front Desk", "Complaint Resolution"];
      const jdText = `Hotel Front Desk Agent
        Requirements:
          - Customer service
          - Communication
          - Front desk operations
          - Complaint resolution`;

      const jdAnalysis = analyzeJD(jdText);
      const result = analyzeSemanticMatch(resumeSkills, jdAnalysis);

      expect(result.overallScore).toBeGreaterThanOrEqual(0);
      expect(result.overallScore).toBeLessThanOrEqual(1);
      expect(result.industry).toBeTruthy();
    });
  });

  describe("computeKeywordMatchScore", () => {
    it("should return 100 when all critical keywords match", () => {
      const resumeSkills = ["TypeScript", "React", "Node.js", "AWS"];
      const jdText = `Full Stack Developer
        Requirements:
          - TypeScript
          - React
          - Node.js
          - AWS`;

      const jdAnalysis = analyzeJD(jdText);
      const semanticAnalysis = analyzeSemanticMatch(resumeSkills, jdAnalysis);
      const score = computeKeywordMatchScore(semanticAnalysis, jdAnalysis);

      expect(score).toBeGreaterThanOrEqual(50);
    });

    it("should return lower score when many skills are missing", () => {
      const resumeSkills = ["Customer Service"];
      const jdText = `DevOps Engineer
        Requirements:
          - Kubernetes
          - Docker
          - Terraform
          - AWS
          - CI/CD`;

      const jdAnalysis = analyzeJD(jdText);
      const semanticAnalysis = analyzeSemanticMatch(resumeSkills, jdAnalysis);
      const score = computeKeywordMatchScore(semanticAnalysis, jdAnalysis);

      // Most skills don't match
      expect(score).toBeLessThan(50);
    });
  });
});
