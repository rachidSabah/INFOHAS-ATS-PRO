import { describe, it, expect } from "vitest";
import { analyzeJobIntelligence } from "./job-intelligence";
import { callAI } from "./ai";

// Mock the AI caller
import { vi } from "vitest";

vi.mock("./ai", async () => {
  const actual = await vi.importActual<any>("./ai");
  return {
    ...actual,
    callAI: vi.fn(),
  };
});

const QATAR_DUTY_FREE_TEXT = `Till Assistant | Qatar Duty Free
General Information
Ref #  2600005S
Location  Qatar-Doha
Job family  Customer Service
Closing Date: 2026-07-31
Description
Calling all ambitious Retail professionals to join our Qatar Duty Free team and start writing your own story with Qatar Airways Group.

As a Till Assistant you will be undertake all cash desk sales activities in the shop and provide the best possible customer service in order to maximize sales opportunities within Qatar Duty Free Company retail shops.

Responsibilities
Ensure the float is correct and that all keyed information into the POS terminal is done so accurately.
Process customer’s transactions efficiently using the QDFC shop's Point of Sale (POS) system and must present the receipts at all times to the customer.

Qualification
Basic Literacy and Numeracy skills, English communication skills with Entry level roles - no prior job-related work experience

Preferred
Previous Retails and or Customer Service experience`;

describe("Job Description Parsing — Qatar Duty Free", () => {
  it("extracts structured intelligence using analyzeJobIntelligence", async () => {
    // Mock the AI response for the job description analysis
    const mockAIResponse = JSON.stringify({
      roleTitle: "Till Assistant",
      company: "Qatar Duty Free",
      location: "Qatar-Doha",
      industry: "Retail / Aviation",
      businessFunction: "Customer Service",
      requiredSkills: ["Basic Literacy", "Basic Numeracy", "English Communication"],
      preferredSkills: ["Previous Retail Experience", "Customer Service Experience"],
      requiredExperienceYears: 0,
      requiredRoles: ["Till Assistant", "Cashier"],
      requiredLanguages: ["English"],
      requiredCompetencies: ["Customer Service", "Cash Handling", "Accuracy"],
      requiredTechnicalSkills: ["POS System", "PC Skills"],
      requiredSoftSkills: ["Interpersonal Skills", "Approachable", "Pleasant"],
      requiredIndustryKnowledge: ["Duty Free Operations", "Retail"],
      preferredQualifications: [],
      technologies: ["Point of Sale (POS)"],
      requiredCertifications: [],
      atsKeywords: ["till assistant", "pos terminal", "customer transactions", "cash desk", "qdfc", "qatar duty free", "float", "point of sale"],
      industryTerminology: ["POS", "QDFC", "DIA", "QDFC shop"],
      recruiterIntent: "To hire entry-level cashier/sales assistants for duty-free shops at Hamad International Airport, prioritizing English capability and cash accuracy.",
      priorityKeywords: ["pos", "cashier", "till assistant", "customer service", "retail", "transactions", "float", "point of sale"],
      avoidKeywords: ["airport security", "aviation engineer"],
    });

    vi.mocked(callAI).mockResolvedValue({
      text: mockAIResponse,
      provider: "Mock OpenAI",
      latencyMs: 100,
      tokensEstimate: 200,
    });

    const jd = {
      id: "jd_qatar",
      title: "Till Assistant",
      company: "Qatar Duty Free",
      location: "Qatar-Doha",
      rawText: QATAR_DUTY_FREE_TEXT,
      responsibilities: [
        "Ensure the float is correct and that all keyed information into the POS terminal is done so accurately.",
        "Process customer’s transactions efficiently using the QDFC shop's Point of Sale (POS) system and must present the receipts at all times to the customer.",
      ],
      requiredSkills: [
        "Basic Literacy and Numeracy skills",
        "English communication skills",
      ],
      preferredSkills: [
        "Previous Retails and or Customer Service experience",
      ],
      technologies: [],
      keywords: [],
      createdAt: new Date().toISOString(),
    };

    const intelligence = await analyzeJobIntelligence(jd);

    expect(callAI).toHaveBeenCalled();
    expect(intelligence.roleTitle).toBe("Till Assistant");
    expect(intelligence.company).toBe("Qatar Duty Free");
    expect(intelligence.requiredSkills).toContain("Basic Literacy");
    expect(intelligence.requiredExperienceYears).toBe(0);
    expect(intelligence.technologies).toContain("Point of Sale (POS)");
  });
});
