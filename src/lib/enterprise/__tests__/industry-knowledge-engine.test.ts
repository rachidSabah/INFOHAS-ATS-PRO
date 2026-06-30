import { describe, it, expect } from "vitest";
import {
  detectIndustry,
  getIndustryProfile,
  getSkillGraph,
  getSynonyms,
  getAllIndustryIds,
  getAllSkillNames,
  resolveToCanonical,
  findMatchingSkills,
  findMissingSkills,
} from "../industry-knowledge-engine";

describe("IndustryKnowledgeEngine", () => {
  describe("detectIndustry", () => {
    it("should detect hospitality industry from relevant text", () => {
      const text = ["Front Office Guest Services Concierge Fine Dining Opera PMS VIP Guest Satisfaction"];
      const result = detectIndustry(text);
      expect(result.industry.id).toBe("hospitality");
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.matchedTerms.length).toBeGreaterThan(0);
    });

    it("should detect airlines industry from relevant text", () => {
      const text = ["Cabin Crew Passenger Safety SEP CRM First Aid In-flight Service"];
      const result = detectIndustry(text);
      expect(result.industry.id).toBe("airlines");
      expect(result.confidence).toBeGreaterThan(0);
    });

    it("should detect technology industry from relevant text", () => {
      const text = ["Software Engineering AWS Cloud Kubernetes DevOps CI/CD Microservices API Design"];
      const result = detectIndustry(text);
      expect(result.industry.id).toBe("technology");
      expect(result.confidence).toBeGreaterThan(0);
    });

    it("should detect customer service / call center from relevant text", () => {
      const text = ["Call Handling Customer Service CRM Zendesk High Volume Issue Resolution FCR"];
      const result = detectIndustry(text);
      expect(result.industry.id).toBe("customer-service");
      expect(result.confidence).toBeGreaterThan(0);
    });

    it("should return generic profile for unmatched text", () => {
      const text = ["quantum chronodynamics stellar nucleosynthesis plasma confinement"];
      const result = detectIndustry(text);
      expect(result.industry.id).toBe("generic");
      expect(result.confidence).toBe(0);
    });
  });

  describe("getIndustryProfile", () => {
    it("should return a valid profile for known industry", () => {
      const profile = getIndustryProfile("hospitality");
      expect(profile.id).toBe("hospitality");
      expect(profile.skillGraph.length).toBeGreaterThan(0);
      expect(profile.priorityKeywords.length).toBeGreaterThan(0);
      expect(profile.commonTools.length).toBeGreaterThan(0);
      expect(profile.competencies.length).toBeGreaterThan(0);
    });

    it("should return generic profile for unknown industry", () => {
      const profile = getIndustryProfile("nonexistent-industry");
      expect(profile.id).toBe("generic");
    });
  });

  describe("getSkillGraph", () => {
    it("should return skill nodes for airlines", () => {
      const graph = getSkillGraph("airlines");
      const names = graph.map((n) => n.name);
      expect(names).toContain("Passenger Service");
      expect(names).toContain("Safety & Emergency");
    });

    it("should return empty array for generic/unknown", () => {
      const graph = getSkillGraph("generic");
      expect(graph).toEqual([]);
    });
  });

  describe("getSynonyms", () => {
    it("should return global synonyms", () => {
      const syns = getSynonyms();
      expect(syns.length).toBeGreaterThan(10);
      const comms = syns.find((s) => s.canonical === "Communication");
      expect(comms).toBeDefined();
      expect(comms!.aliases).toContain("Verbal Communication");
    });

    it("should include industry-specific synonyms when id is provided", () => {
      const syns = getSynonyms("airlines");
      const passenger = syns.find(
        (s) => s.canonical === "Passenger Assistance",
      );
      expect(passenger).toBeDefined();
    });
  });

  describe("getAllIndustryIds", () => {
    it("should return all registered industry IDs", () => {
      const ids = getAllIndustryIds();
      expect(ids.length).toBeGreaterThanOrEqual(10);
      expect(ids).toContain("hospitality");
      expect(ids).toContain("airlines");
      expect(ids).toContain("technology");
      expect(ids).toContain("finance");
    });
  });

  describe("getAllSkillNames", () => {
    it("should return flat list of skill names and aliases", () => {
      const names = getAllSkillNames("hospitality");
      expect(names.length).toBeGreaterThan(20);
      expect(names).toContain("Guest Services");
      expect(names).toContain("Complaint Resolution"); // alias
    });
  });

  describe("resolveToCanonical", () => {
    it("should resolve customer service to canonical form", () => {
      const result = resolveToCanonical("Client Relations");
      expect(result).not.toBeNull();
      expect(result!.canonical).toBe("Customer Service");
    });

    it("should resolve industry-specific terms", () => {
      const result = resolveToCanonical("Traveler Assistance", "airlines");
      expect(result).not.toBeNull();
      expect(result!.canonical).toBe("Passenger Assistance");
    });

    it("should return null for unknown terms", () => {
      const result = resolveToCanonical("Quantum Chronodynamics");
      expect(result).toBeNull();
    });
  });

  describe("findMatchingSkills", () => {
    it("should find exact matches in skill graph", () => {
      const skills = ["Guest Services", "Front Office", "Housekeeping"];
      const results = findMatchingSkills(skills, "hospitality");
      expect(results.length).toBe(3);
      const matched = results.filter((r) => r.matched);
      expect(matched.length).toBe(3);
    });

    it("should find alias matches", () => {
      const skills = ["Guest Relations"]; // alias for Guest Services
      const results = findMatchingSkills(skills, "hospitality");
      const matched = results.filter((r) => r.matched);
      expect(matched.length).toBe(1);
      expect(matched[0].matchedAs).toBe("Guest Services");
    });

    it("should return low confidence for unrelated skills", () => {
      const skills = ["Chronodynamics"];
      const results = findMatchingSkills(skills, "hospitality");
      expect(results[0].matched).toBe(false);
      expect(results[0].confidence).toBe(0);
    });
  });

  describe("findMissingSkills", () => {
    it("should return missing core skills for hospitality", () => {
      // Only has one non-core skill
      const reserveSkills = ["Housekeeping"];
      const missing = findMissingSkills(reserveSkills, "hospitality");
      // Guest Services (weight 1.0), Front Office (weight 0.9), Food & Beverage (weight 0.8),
      // Property Management Systems (weight 0.8), Luxury Standards (weight 0.9),
      // Upselling (weight 0.7 < 0.8 threshold)
      expect(missing.length).toBeGreaterThanOrEqual(3);
      const skillNames = missing.map((m) => m.skill);
      expect(skillNames).toContain("Guest Services");
      expect(skillNames).toContain("Front Office");
    });

    it("should respect threshold", () => {
      const skills = ["Guest Services", "Food & Beverage"];
      const missing = findMissingSkills(skills, "hospitality", 0.5);
      // Most skills have weight >= 0.5
      expect(missing.length).toBeGreaterThan(0);
    });

    it("should return no missing skills when all core skills are present", () => {
      const skills = ["Guest Services", "Front Office", "Luxury Standards"];
      const missing = findMissingSkills(skills, "hospitality", 0.9);
      // Guest Services (1.0), Front Office (0.9), Luxury Standards (0.9)
      // all >= 0.9 threshold and present in resume
      expect(missing.length).toBe(0);
    });
  });
});
