import { describe, it, expect, vi } from "vitest";
import { assembleResume, canonicalSkillKey } from "../resume-assembler";
import { expandResume } from "../agents/page-balancer";
import type { ResumeData, JobDescription } from "../types";

describe("Skill Duplication & Compound Assembly Protection", () => {
  const baseResume: ResumeData = {
    id: "res_test",
    name: "ADAM BOUDKIK",
    headline: "Customer Service Agent",
    contact: { email: "adam@example.com", phone: "+212 600000000" },
    summary: "Dedicated customer service professional with aviation operations experience.",
    experience: [
      {
        id: "exp_1",
        title: "Customer Service Agent",
        company: "International Airport",
        location: "Casablanca",
        startDate: "2023-12",
        endDate: "2024-03",
        bullets: ["Handled passenger check-in and boarding gate operations."],
      },
    ],
    education: [
      {
        id: "edu_1",
        institution: "INFOHAS Aviation Accredited Diploma",
        degree: "Diploma",
        startDate: "2023",
        endDate: "2025",
        highlights: [],
      },
    ],
    skills: [
      {
        id: "sk_src_1",
        name: "Passenger Check - in, Boarding Gate Control, Transfer Desk, Queue Management, Hand Luggage Policies",
        category: "Ground Services & Operations",
      },
      {
        id: "sk_src_2",
        name: "Travel Document & Visa Checks, Aviation Safety & Security Protocols, Flight Coupon & Passenger Reconciliation",
        category: "Compliance & Verification",
      },
      {
        id: "sk_src_3",
        name: "VIP Escort, Unaccompanied Minors (UM), Passengers with Reduced Mobility (PRM), Complaint Resolution",
        category: "Passenger Care",
      },
    ],
    languages: [{ id: "l_1", name: "English", proficiency: "fluent" }],
    certifications: [],
    projects: [],
    template: "ats-professional",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };

  it("does not duplicate compound skills when optimizer returns split versions", () => {
    const optimizerOutput = {
      skills: [
        { name: "Passenger Check-in", category: "Ground Services & Operations" },
        { name: "Boarding Gate Control", category: "Ground Services & Operations" },
        { name: "Transfer Desk", category: "Ground Services & Operations" },
        { name: "Queue Management", category: "Ground Services & Operations" },
        { name: "Hand Luggage Policies", category: "Ground Services & Operations" },
        { name: "Travel Document & Visa Checks", category: "Compliance & Verification" },
        { name: "Aviation Safety & Security Protocols", category: "Compliance & Verification" },
        { name: "VIP Escort", category: "Passenger Care" },
        { name: "Unaccompanied Minors (UM)", category: "Passenger Care" },
      ],
    };

    const assembled = assembleResume(baseResume, optimizerOutput as any);
    const names = assembled.resume.skills.map((s) => s.name);

    // No skill name should contain comma-separated compound blocks
    for (const name of names) {
      expect(name).not.toContain("Boarding Gate Control, Transfer Desk");
      expect(name).not.toContain("Aviation Safety & Security Protocols, Flight");
    }

    // Check-in must appear exactly once despite "Passenger Check - in" in source and "Passenger Check-in" in optimizer
    const checkInMatches = names.filter((n) => canonicalSkillKey(n) === "passenger check in");
    expect(checkInMatches).toHaveLength(1);

    // Boarding Gate Control must appear exactly once
    const boardingMatches = names.filter((n) => canonicalSkillKey(n) === "boarding gate control");
    expect(boardingMatches).toHaveLength(1);

    // Dropped items from source (e.g. "Complaint Resolution") are preserved as atomic items, not full compounds
    const complaintMatches = names.filter((n) => canonicalSkillKey(n).includes("complaint resolution"));
    expect(complaintMatches).toHaveLength(1);
    expect(complaintMatches[0]).toBe("Complaint Resolution");
  });

  it("restores proper categories from split source skills instead of defaulting to General", () => {
    const optimizerOutput = {
      skills: [
        { name: "Passenger Check-in", category: "General" }, // AI misclassified under General
        { name: "Transfer Desk", category: "General" },
      ],
    };

    const assembled = assembleResume(baseResume, optimizerOutput as any);
    const checkIn = assembled.resume.skills.find((s) => canonicalSkillKey(s.name) === "passenger check in");
    expect(checkIn?.category).toBe("Ground Services & Operations");
  });
});

describe("Page Balancer Keyword Injection Deduplication", () => {
  it("does not inject keywords that match existing skills canonically", () => {
    const resume: ResumeData = {
      id: "res_bal",
      name: "Candidate",
      headline: "Specialist",
      contact: { email: "c@example.com" },
      summary: "Short summary.",
      experience: [
        {
          id: "e1",
          title: "Role",
          company: "Company",
          startDate: "2020",
          endDate: "2022",
          bullets: ["Performed Passenger Check-in duties daily."],
        },
      ],
      education: [],
      skills: [
        { id: "s1", name: "Passenger Check-in", category: "Operations" },
        { id: "s2", name: "Boarding Gate Control", category: "Operations" },
      ],
      languages: [],
      certifications: [],
      projects: [],
      template: "ats-professional",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };

    const jd: JobDescription = {
      id: "jd_1",
      title: "Passenger Service Agent",
      company: "Airlines",
      keywords: ["Passenger Check - in", "Boarding Gate Control", "Flight Dispatch"],
      requiredSkills: [],
      preferredSkills: [],
      responsibilities: [],
      technologies: [],
      education: "",
      createdAt: "2026-01-01T00:00:00.000Z",
      rawText: "Passenger Check-in Boarding Gate Control Flight Dispatch",
    };

    const expanded = expandResume(resume, {
      originalResume: resume,
      jd,
      targetChars: 3000,
      currentChars: 500,
      missingKeywords: ["Passenger Check - in", "Boarding Gate Control", "Flight Dispatch"],
    });

    const checkInMatches = expanded.skills.filter((s) => canonicalSkillKey(s.name) === "passenger check in");
    expect(checkInMatches).toHaveLength(1);

    const dispatchMatches = expanded.skills.filter((s) => canonicalSkillKey(s.name) === "flight dispatch");
    expect(dispatchMatches).toHaveLength(1);
  });
});
