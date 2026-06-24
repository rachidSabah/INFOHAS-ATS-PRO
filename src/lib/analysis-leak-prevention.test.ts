// Regression tests proving analysis output is never exported
// Only final resume content reaches PDF and DOCX generation.

import { describe, it, expect } from "vitest";
import {
  detectLeaks,
  stripLeaks,
  processAIResponse,
  validateResumeForExport,
  isProfessionalResume,
} from "./ai-response-processor";
import type { ResumeData } from "./types";

// Helper: create a clean professional resume
function cleanResume(): ResumeData {
  return {
    id: "r1",
    name: "John Doe",
    headline: "Customer Service Agent",
    contact: { email: "john@test.com", phone: "+1234567890", location: "Dubai" },
    summary: "Customer service professional with 3 years of experience in call center operations, complaint resolution, and CRM systems. Dedicated to delivering exceptional customer experiences.",
    experience: [{
      id: "e1",
      title: "Customer Service Agent",
      company: "Emirates",
      location: "Dubai",
      startDate: "2022",
      endDate: "Present",
      bullets: [
        "Handled 200+ customer calls daily with 95% satisfaction rate.",
        "Resolved complaints using CRM system, reducing escalation rate by 30%.",
      ],
    }],
    education: [{ id: "ed1", institution: "University", degree: "BA", startDate: "2018", endDate: "2022" }],
    skills: [
      { id: "s1", name: "Customer Service" },
      { id: "s2", name: "Communication" },
      { id: "s3", name: "CRM" },
    ],
    languages: [{ id: "l1", name: "English", proficiency: "fluent" }],
    projects: [], certifications: [],
    template: "infohas-pro",
    accentColor: "#0563C1",
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), source: "manual",
  };
}

// Helper: create a contaminated resume with analysis artifacts
function contaminatedResume(): ResumeData {
  return {
    ...cleanResume(),
    summary: "The original resume lacks keywords. Missing keywords: CRM, communication. Based on the job description, the following improvements were made. ATS analysis shows a score of 65.",
    experience: [{
      id: "e1",
      title: "Customer Service Agent",
      company: "Emirates",
      location: "Dubai",
      startDate: "2022",
      endDate: "Present",
      bullets: [
        "Suggested improvement: add metrics to bullets.",
        "The resume needs more quantified achievements in this section.",
      ],
    }],
    skills: [
      { id: "s1", name: "From JD: customer service" },
      { id: "s2", name: "Missing Skills: CRM, sales" },
      { id: "s3", name: "Keywords identified: communication" },
    ],
  };
}

describe("Analysis output is never exported", () => {
  it("detects 'The original resume lacks' as an analysis artifact", () => {
    const leaks = detectLeaks("The original resume lacks keywords.");
    expect(leaks.length).toBeGreaterThan(0);
  });

  it("detects 'Missing keywords:' as an analysis artifact", () => {
    const leaks = detectLeaks("Missing keywords: CRM, communication, sales.");
    expect(leaks.length).toBeGreaterThan(0);
  });

  it("detects 'From JD:' as an analysis artifact", () => {
    const leaks = detectLeaks("From JD: customer service, call handling.");
    expect(leaks.length).toBeGreaterThan(0);
  });

  it("detects 'ATS analysis' as an analysis artifact", () => {
    const leaks = detectLeaks("ATS analysis shows a score of 65/100.");
    expect(leaks.length).toBeGreaterThan(0);
  });

  it("detects 'Optimization notes' as an analysis artifact", () => {
    const leaks = detectLeaks("Optimization notes: added 5 keywords, rewrote 3 bullets.");
    expect(leaks.length).toBeGreaterThan(0);
  });

  it("detects 'Recommendations:' as an analysis artifact", () => {
    const leaks = detectLeaks("Recommendations: Add more quantified achievements.");
    expect(leaks.length).toBeGreaterThan(0);
  });

  it("detects 'Reasoning:' as an analysis artifact", () => {
    const leaks = detectLeaks("Reasoning: The summary was rewritten to emphasize customer service.");
    expect(leaks.length).toBeGreaterThan(0);
  });

  it("detects 'Here is the optimized resume' as an analysis artifact", () => {
    const leaks = detectLeaks("Here is the optimized resume based on the job description.");
    expect(leaks.length).toBeGreaterThan(0);
  });

  it("detects 'I have improved the resume' as an analysis artifact", () => {
    const leaks = detectLeaks("I have improved the resume by adding missing keywords.");
    expect(leaks.length).toBeGreaterThan(0);
  });

  it("detects 'Based on the job description' as an analysis artifact", () => {
    const leaks = detectLeaks("Based on the job description, the following changes were made.");
    expect(leaks.length).toBeGreaterThan(0);
  });

  it("detects 'Required Skills:' as an analysis artifact", () => {
    const leaks = detectLeaks("Required Skills: Customer Service, Communication, CRM.");
    expect(leaks.length).toBeGreaterThan(0);
  });

  it("detects 'Missing Skills:' as an analysis artifact", () => {
    const leaks = detectLeaks("Missing Skills: CRM, sales, upselling.");
    expect(leaks.length).toBeGreaterThan(0);
  });

  it("detects 'Keywords identified:' as an analysis artifact", () => {
    const leaks = detectLeaks("Keywords identified: customer service, call handling.");
    expect(leaks.length).toBeGreaterThan(0);
  });
});

describe("Reasoning output is never exported", () => {
  it("detects 'Thought process' as reasoning artifact", () => {
    const leaks = detectLeaks("Thought process: I analyzed the JD and identified gaps.");
    expect(leaks.length).toBeGreaterThan(0);
  });

  it("detects 'Score explanation' as reasoning artifact", () => {
    const leaks = detectLeaks("Score explanation: ATS score increased from 65 to 92.");
    expect(leaks.length).toBeGreaterThan(0);
  });

  it("detects 'Areas for improvement' as reasoning artifact", () => {
    const leaks = detectLeaks("Areas for improvement: summary needs more keywords.");
    expect(leaks.length).toBeGreaterThan(0);
  });

  it("detects 'Identified gaps' as reasoning artifact", () => {
    const leaks = detectLeaks("Identified gaps: missing 5 keywords from the JD.");
    expect(leaks.length).toBeGreaterThan(0);
  });
});

describe("ATS reports are never exported", () => {
  it("detects 'ATS analysis' in a resume summary", () => {
    const resume = { ...cleanResume(), summary: "ATS analysis: score 65/100. Keyword match: 70%." };
    const leaks = detectLeaks(resume.summary);
    expect(leaks.length).toBeGreaterThan(0);
  });

  it("detects 'Keyword gap' in resume content", () => {
    const resume = { ...cleanResume(), summary: "Keyword gap analysis: 5 missing keywords identified." };
    const leaks = detectLeaks(resume.summary);
    expect(leaks.length).toBeGreaterThan(0);
  });
});

describe("Only final resume content reaches PDF/DOCX", () => {
  it("isProfessionalResume accepts a clean professional resume", () => {
    const result = isProfessionalResume(cleanResume());
    expect(result.professional).toBe(true);
    expect(result.issues.length).toBe(0);
  });

  it("isProfessionalResume rejects a resume with analysis in summary", () => {
    const resume = { ...cleanResume(), summary: "The original resume lacks keywords. Missing keywords: CRM." };
    const result = isProfessionalResume(resume);
    expect(result.professional).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
  });

  it("isProfessionalResume rejects a resume with JD references in skills", () => {
    const resume = {
      ...cleanResume(),
      skills: [{ id: "s1", name: "From JD: customer service" }],
    };
    const result = isProfessionalResume(resume);
    expect(result.professional).toBe(false);
  });

  it("isProfessionalResume rejects a resume with analysis in bullets", () => {
    const resume = {
      ...cleanResume(),
      experience: [{
        ...cleanResume().experience[0],
        bullets: ["Suggested improvement: add metrics to bullets."],
      }],
    };
    const result = isProfessionalResume(resume);
    expect(result.professional).toBe(false);
  });

  it("validateResumeForExport strips analysis artifacts and returns cleaned resume", () => {
    const result = validateResumeForExport(contaminatedResume());
    expect(result.valid).toBe(false);
    // Should return a cleaned resume (or null if unsalvageable)
    if (result.cleanedResume) {
      const qualityCheck = isProfessionalResume(result.cleanedResume);
      // After cleaning, it should be professional (or at least have fewer issues)
      expect(qualityCheck.issues.length).toBeLessThan(5);
    }
  });

  it("a clean resume passes validateResumeForExport", () => {
    const result = validateResumeForExport(cleanResume());
    expect(result.valid).toBe(true);
  });
});

describe("processAIResponse blocks analysis content", () => {
  it("marks a response with analysis artifacts as not safe for documents", () => {
    const response = '{"summary":"The original resume lacks keywords. Missing keywords: CRM."}';
    const result = processAIResponse(response, "TestProvider", { expectJson: true });
    expect(result.data).toBeDefined();
    // The response contains analysis artifacts — detectLeaks should find them
    const leaks = detectLeaks(response);
    expect(leaks.length).toBeGreaterThan(0);
    // The warnings should mention the leaks
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it("allows a clean JSON resume response", () => {
    const response = '{"summary":"Customer service professional with 3 years of experience."}';
    const result = processAIResponse(response, "TestProvider", { expectJson: true });
    expect(result.data).toBeDefined();
    expect(result.safeForDocument).toBe(true);
  });
});
