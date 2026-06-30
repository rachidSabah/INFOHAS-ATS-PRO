import { describe, it, expect } from "vitest";
import { analyzeJD } from "../jd-engine";

describe("JDEngine", () => {
  describe("analyzeJD", () => {
    it("should extract technical skills from JD text", () => {
      const jd = `Job Title: Senior Software Engineer
Company: TechCorp

Responsibilities:
  - Design and implement microservices architecture
  - Build REST APIs using Node.js and TypeScript
  - Deploy applications on AWS using Kubernetes

Requirements:
  - 5+ years of software engineering experience
  - Strong experience with TypeScript, Node.js, and React
  - Experience with cloud platforms (AWS, GCP)
  - Bachelor's degree in Computer Science

Preferred:
  - Experience with GraphQL
  - Knowledge of Docker and CI/CD pipelines`;

      const result = analyzeJD(jd);

      expect(result.roleTitle).toBe("Senior Software Engineer");
      expect(result.skills.length).toBeGreaterThan(0);
      expect(result.criticalKeywords).toContain("typescript");
      expect(result.criticalKeywords).toContain("node.js");
      expect(result.experienceYears).toBe(5);
      expect(result.educationRequirements.length).toBeGreaterThan(0);
      expect(result.requiredQualifications.length).toBeGreaterThan(0);
      expect(result.preferredQualifications.length).toBeGreaterThan(0);
    });

    it("should extract soft skills from JD text", () => {
      const jd = `Customer Service Representative

We're looking for someone with teamwork and excellent communication skills.
You should be detail-oriented and have strong problem solving abilities.
Leadership experience is a plus.

Requirements:
  - 2+ years of customer service experience
  - Strong interpersonal and communication skills`;

      const result = analyzeJD(jd);

      expect(result.softSkills.length).toBeGreaterThan(0);
      const softSkillNames = result.softSkills.map((s) => s.toLowerCase());
      expect(softSkillNames).toContain("communication");
      expect(softSkillNames).toContain("teamwork");
      expect(softSkillNames).toContain("problem solving");
    });

    it("should extract certifications from JD text", () => {
      const jd = `Project Manager

Requirements:
  - PMP certification required
  - Six Sigma Green Belt preferred
  - Scrum Master certification a plus`;

      const result = analyzeJD(jd);

      expect(result.certifications.length).toBeGreaterThan(0);
      const certNames = result.certifications.map((c) => c.toLowerCase());
      expect(certNames).toContain("pmp");
      expect(certNames).toContain("six sigma");
    });

    it("should detect industry from JD text", () => {
      const jd = `Front Office Manager - Luxury Hotel

We are seeking an experienced Front Office Manager to oversee guest services,
concierge operations, and VIP guest relations at our 5-star property.

Requirements:
  - 3+ years of front office management in luxury hospitality
  - Experience with Opera PMS
  - Strong guest relations and complaint resolution skills`;

      const result = analyzeJD(jd);

      expect(result.industryId).toBe("hospitality");
      expect(result.experienceYears).toBe(3);
      expect(result.employmentType).toBeNull(); // No FT/PT specified
    });

    it("should extract employment type", () => {
      const jd = `Position: Software Developer
Full-time position with competitive salary.
Requirements: 3+ years of experience.`;

      const result = analyzeJD(jd);
      expect(result.employmentType).toBe("Full-time");
    });

    it("should handle empty or minimal JD text", () => {
      const result = analyzeJD("");

      expect(result.skills).toEqual([]);
      expect(result.softSkills).toEqual([]);
      expect(result.certifications).toEqual([]);
      expect(result.experienceYears).toBeNull();
    });

    it("should extract tools from JD text", () => {
      const jd = `DevOps Engineer
Manage Kubernetes clusters, Docker containers, Terraform infrastructure.
Experience with CI/CD pipelines using Jenkins.`;

      const result = analyzeJD(jd);

      expect(result.skills).toContainEqual(
        expect.objectContaining({ name: "kubernetes", type: "technical" }),
      );
      expect(result.skills).toContainEqual(
        expect.objectContaining({ name: "docker", type: "technical" }),
      );
      expect(result.skills).toContainEqual(
        expect.objectContaining({ name: "terraform", type: "technical" }),
      );
    });

    it("should detect contract type", () => {
      const jd = "Contract position for 6 months. Software Developer.";
      const result = analyzeJD(jd);
      expect(result.employmentType).toBe("Contract");
    });
  });
});
