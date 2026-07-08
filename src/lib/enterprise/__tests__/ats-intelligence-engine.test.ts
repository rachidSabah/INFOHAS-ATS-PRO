import { describe, it, expect } from "vitest";
import {
  detectATSFromContext,
  simulateATSParser,
  simulateRecruiter,
  evaluateDualScoring,
  translateToAirlineLanguage,
  validateFactualConsistency
} from "../ats-intelligence-engine";
import type { ResumeData } from "../../types";

const mockResume: ResumeData = {
  id: "test-resume-1",
  name: "John Doe",
  headline: "hospitality professional",
  contact: {
    email: "john.doe@example.com",
    phone: "1234567890",
    location: "Dubai, UAE"
  },
  summary: "Experienced customer service agent with a strong safety mindset.",
  experience: [
    {
      id: "exp-1",
      title: "Customer Service Representative",
      company: "Aviation Services Ltd",
      location: "Dubai",
      startDate: "2024-01",
      endDate: "2025-01",
      bullets: [
        "Responsible for safety check protocols and passenger boarding procedures.",
        "Helped customers with baggage claims and solved ticketing issues."
      ]
    }
  ],
  education: [
    {
      id: "edu-1",
      institution: "Aviation College",
      degree: "Bachelor of Science",
      field: "Aviation Management",
      location: "Dubai",
      startDate: "2020-09",
      endDate: "2023-06",
      highlights: ["Graduated with honors"]
    }
  ],
  skills: [
    { id: "sk1", name: "Customer Service", category: "Core" },
    { id: "sk2", name: "Safety compliance", category: "Core" }
  ],
  languages: [
    { id: "lg1", name: "English", proficiency: "fluent" as const }
  ],
  certifications: [
    { id: "ct1", name: "SEP Certified", issuer: "GCAA", date: "2024" }
  ],
  projects: [],
  template: "ats-professional",
  createdAt: "2025-01-01T00:00:00Z",
  updatedAt: "2025-01-01T00:00:00Z",
};

describe("ATS Intelligence Engine Tests", () => {
  describe("detectATSFromContext", () => {
    it("should detect Workday from a careers URL", () => {
      const result = detectATSFromContext("https://emirates.myworkdayjobs.com/Careers");
      expect(result.atsId).toBe("workday");
      expect(result.confidence).toBeGreaterThan(90);
    });

    it("should detect Oracle Recruiting Cloud for Emirates", () => {
      const result = detectATSFromContext(undefined, undefined, "Emirates Airline");
      expect(result.atsId).toBe("oracle_recruiting_cloud");
      expect(result.confidence).toBe(95);
    });

    it("should fall back to generic if no signals are matched", () => {
      const result = detectATSFromContext();
      expect(result.atsId).toBe("generic");
    });
  });

  describe("simulateATSParser", () => {
    it("should warn on missing months or year-only format", () => {
      const badResume: ResumeData = {
        ...mockResume,
        experience: [
          {
            ...mockResume.experience[0],
            startDate: "2024",
            endDate: "2025"
          }
        ]
      };
      const result = simulateATSParser(badResume, "taleo");
      expect(result.warnings.some(w => w.includes("year-only"))).toBe(true);
    });

    it("should report critical risk if email is missing or invalid", () => {
      const badResume: ResumeData = {
        ...mockResume,
        contact: {
          ...mockResume.contact,
          email: "invalid-email"
        }
      };
      const result = simulateATSParser(badResume, "workday");
      expect(result.risks.some(r => r.includes("email"))).toBe(true);
      expect(result.parseScore).toBeLessThan(80);
    });
  });

  describe("simulateRecruiter", () => {
    it("should compute recruiterScore and evaluate safety and service mindsets", () => {
      const result = simulateRecruiter(mockResume);
      expect(result.recruiterScore).toBeGreaterThanOrEqual(10);
      expect(result.breakdown).toBeDefined();
      expect(result.breakdown.safetyMindset).toBeGreaterThanOrEqual(30);
    });
  });

  describe("evaluateDualScoring", () => {
    it("should explain the gap if ATS score is much higher than recruiter score", () => {
      const result = evaluateDualScoring(95, 60, 90, mockResume);
      expect(result.differenceReason).toContain("ATS");
      expect(result.differenceReason).toContain("recruiter");
    });
  });

  describe("translateToAirlineLanguage", () => {
    it("should translate generic customer service words to airline terminology", () => {
      const genericStr = "I worked in customer support and safety rules. I helped customers with baggage.";
      const translated = translateToAirlineLanguage(genericStr);
      expect(translated).toContain("Passenger Assistance");
      expect(translated).toContain("Safety Compliance");
      expect(translated).toContain("Delivered Exceptional Passenger Experience");
      expect(translated).toContain("Cabin Baggage");
    });
  });

  describe("validateFactualConsistency", () => {
    it("should succeed for identical resumes", () => {
      const report = validateFactualConsistency(mockResume, mockResume);
      expect(report.valid).toBe(true);
      expect(report.issues.length).toBe(0);
    });

    it("should flag a modified date boundary", () => {
      const tamperedResume: ResumeData = {
        ...mockResume,
        experience: [
          {
            ...mockResume.experience[0],
            startDate: "2010-01" // original: 2024-01
          }
        ]
      };
      const report = validateFactualConsistency(mockResume, tamperedResume);
      expect(report.valid).toBe(false);
      expect(report.issues.some(i => i.includes("Date modification"))).toBe(true);
    });

    it("should flag a hallucinated company name", () => {
      const tamperedResume: ResumeData = {
        ...mockResume,
        experience: [
          {
            ...mockResume.experience[0],
            company: "Fake Airways"
          }
        ]
      };
      const report = validateFactualConsistency(mockResume, tamperedResume);
      expect(report.valid).toBe(false);
      expect(report.issues.some(i => i.includes("Hallucinated employer"))).toBe(true);
    });
  });
});
