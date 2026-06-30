// ============================================================================
// Enterprise QA Platform — Golden Resume Corpus
// ============================================================================
// Structured validation dataset of canonical resumes across all supported
// industries. Used for regression detection, pipeline validation, and
// semantic consistency checks.
// ============================================================================

import type { ResumeData } from "../types";

// ============================================================================
// Types
// ============================================================================

export interface GoldenResume {
  id: string;
  name: string;
  industry: string;
  description: string;
  expected: ResumeData;
  invariants: {
    names: string[];
    employers: string[];
    schools: string[];
    diplomas: string[];
    dates: string[];
    locations: string[];
    languages: string[];
    certifications: string[];
    projects: string[];
    awards: string[];
    expectedSectionCount: number;
  };
  tags: string[];
}

// ============================================================================
// Helper to generate sequential IDs
// ============================================================================
let _idCounter = 1;
function nextId(): string {
  return `golden-id-${String(_idCounter++).padStart(4, "0")}`;
}

// ============================================================================
// The Corpus
// ============================================================================

export const GOLDEN_CORPUS: GoldenResume[] = [];

function add(
  overrides: Partial<ResumeData>,
  invariants: {
    names: string[];
    employers: string[];
    schools: string[];
    diplomas: string[];
    dates: string[];
    locations: string[];
    languages: string[];
    certifications: string[];
    projects: string[];
    awards: string[];
    expectedSectionCount: number;
  },
  meta: { id: string; name: string; industry: string; description: string; tags: string[] },
): void {
  const base: ResumeData = {
    id: meta.id,
    name: meta.name,
    contact: { email: "", phone: "", location: "" },
    summary: "",
    experience: [],
    education: [],
    skills: [],
    languages: [],
    certifications: [],
    projects: [],
    achievements: [],
    template: "ats-professional",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  GOLDEN_CORPUS.push({
    id: meta.id,
    name: meta.name,
    industry: meta.industry,
    description: meta.description,
    expected: { ...base, ...overrides },
    invariants,
    tags: meta.tags,
  });
}

// Reset counter for deterministic IDs
_idCounter = 1;

// ── AIRLINE / CABIN CREW ──────────────────────────────────────────────
add({
  contact: { email: "sarah.j@email.com", phone: "+1-555-0101", location: "Dubai, UAE" },
  summary: "Experienced Cabin Crew member with 5+ years in international aviation.",
  experience: [{
    id: nextId(), company: "Emirates Airlines", title: "Senior Cabin Crew",
    startDate: "2020-03", endDate: "Present", location: "Dubai, UAE",
    bullets: [
      "Delivered premium inflight service to First and Business Class passengers on long-haul international flights",
      "Managed cabin safety procedures and emergency protocols for A380 and B777 aircraft",
      "Trained and mentored 15+ new crew members on service standards and safety compliance",
    ],
  }],
  education: [{ id: nextId(), institution: "University of Hospitality", degree: "Bachelor of Tourism Management", startDate: "2014-09", endDate: "2018-06", gpa: "3.6" }],
  skills: [
    { id: nextId(), name: "Inflight Service", category: "Core", level: "expert" },
    { id: nextId(), name: "Safety Procedures", category: "Core", level: "expert" },
    { id: nextId(), name: "Crew Management", category: "Leadership", level: "advanced" },
    { id: nextId(), name: "First Aid", category: "Certification", level: "advanced" },
    { id: nextId(), name: "Languages", category: "Communication", level: "advanced" },
  ],
  languages: [
    { id: nextId(), name: "English", proficiency: "native" },
    { id: nextId(), name: "Arabic", proficiency: "fluent" },
    { id: nextId(), name: "French", proficiency: "conversational" },
  ],
  certifications: [
    { id: nextId(), name: "Cabin Crew Attestation", issuer: "GCAA", date: "2019" },
    { id: nextId(), name: "First Aid Certificate", issuer: "Red Cross", date: "2023" },
  ],
}, {
  names: ["Sarah Johnson"], employers: ["Emirates Airlines"],
  schools: ["University of Hospitality"], diplomas: ["Bachelor of Tourism Management"],
  dates: ["2020-03", "2014-09", "2018-06", "2019", "2023"],
  locations: ["Dubai, UAE"], languages: ["English", "Arabic", "French"],
  certifications: ["Cabin Crew Attestation", "First Aid Certificate"],
  projects: [], awards: [], expectedSectionCount: 6,
}, {
  id: "golden-001", name: "Cabin Crew - Sarah Johnson", industry: "airlines",
  description: "Experienced Cabin Crew with Emirates Airlines",
  tags: ["airline", "cabin-crew"],
});

// ── HOSPITALITY ──────────────────────────────────────────────────────
add({
  contact: { email: "ahmed.bh@email.com", phone: "+212-6XX-XXXXXX", location: "Marrakech, Morocco" },
  summary: "Luxury hotel professional with 8+ years in guest relations and front office management.",
  experience: [{
    id: nextId(), company: "Royal Mansour Marrakech", title: "Front Office Manager",
    startDate: "2019-04", endDate: "Present", location: "Marrakech, Morocco",
    bullets: [
      "Managed front desk operations for a 5-star luxury property with 53 exclusive riads",
      "Supervised team of 12 front desk agents ensuring VIP guest experience excellence",
      "Implemented Opera PMS optimization reducing check-in time by 30%",
    ],
  }],
  education: [{ id: nextId(), institution: "Institut de Tourisme", degree: "Diploma in Hospitality Management", startDate: "2012-09", endDate: "2015-06", gpa: "3.8" }],
  skills: [
    { id: nextId(), name: "Front Office Management", category: "Core", level: "expert" },
    { id: nextId(), name: "Guest Relations", category: "Core", level: "expert" },
    { id: nextId(), name: "Opera PMS", category: "Technical", level: "advanced" },
    { id: nextId(), name: "Team Management", category: "Leadership", level: "advanced" },
    { id: nextId(), name: "Complaint Resolution", category: "Soft", level: "expert" },
  ],
  languages: [
    { id: nextId(), name: "Arabic", proficiency: "native" },
    { id: nextId(), name: "French", proficiency: "fluent" },
    { id: nextId(), name: "English", proficiency: "fluent" },
  ],
  certifications: [{ id: nextId(), name: "Hospitality Leadership Certificate", issuer: "Cornell", date: "2021" }],
}, {
  names: ["Ahmed Ben Hassan"], employers: ["Royal Mansour Marrakech"],
  schools: ["Institut de Tourisme"], diplomas: ["Diploma in Hospitality Management"],
  dates: ["2019-04", "2012-09", "2015-06", "2021"],
  locations: ["Marrakech, Morocco"], languages: ["Arabic", "French", "English"],
  certifications: ["Hospitality Leadership Certificate"],
  projects: [], awards: [], expectedSectionCount: 6,
}, {
  id: "golden-002", name: "Front Office Manager - Ahmed Ben Hassan", industry: "hospitality",
  description: "Luxury hotel front office manager",
  tags: ["hospitality", "management"],
});

// ── IT / SOFTWARE ENGINEERING ────────────────────────────────────────
add({
  contact: { email: "m.chen@email.com", phone: "+1-555-0202", location: "San Francisco, CA" },
  summary: "Full-stack engineer with 6+ years building scalable web applications.",
  experience: [{
    id: nextId(), company: "TechStart Inc.", title: "Senior Software Engineer",
    startDate: "2021-01", endDate: "Present", location: "San Francisco, CA",
    bullets: [
      "Architected and built microservices-based platform serving 2M+ daily users using Node.js and TypeScript",
      "Led migration from monolithic to microservices architecture reducing deployment time by 60%",
      "Implemented CI/CD pipelines with GitHub Actions and Docker, achieving 99.9% uptime",
    ],
  }],
  education: [{ id: nextId(), institution: "MIT", degree: "B.S. Computer Science", startDate: "2013-09", endDate: "2017-06", gpa: "3.9" }],
  skills: [
    { id: nextId(), name: "TypeScript", category: "Languages", level: "expert" },
    { id: nextId(), name: "Node.js", category: "Runtime", level: "expert" },
    { id: nextId(), name: "React", category: "Frontend", level: "advanced" },
    { id: nextId(), name: "AWS", category: "Cloud", level: "advanced" },
    { id: nextId(), name: "Docker", category: "DevOps", level: "advanced" },
    { id: nextId(), name: "PostgreSQL", category: "Database", level: "advanced" },
    { id: nextId(), name: "GraphQL", category: "API", level: "intermediate" },
  ],
  languages: [
    { id: nextId(), name: "English", proficiency: "native" },
    { id: nextId(), name: "Mandarin", proficiency: "native" },
  ],
  certifications: [{ id: nextId(), name: "AWS Solutions Architect", issuer: "Amazon", date: "2023" }],
  projects: [{
    id: nextId(), name: "Open Source Data Pipeline",
    description: "Built a real-time data processing pipeline handling 10K events/sec",
    url: "github.com/mchen/pipeline", bullets: [],
  }],
}, {
  names: ["Maria Chen"], employers: ["TechStart Inc."],
  schools: ["MIT"], diplomas: ["B.S. Computer Science"],
  dates: ["2021-01", "2013-09", "2017-06", "2023"],
  locations: ["San Francisco, CA"], languages: ["English", "Mandarin"],
  certifications: ["AWS Solutions Architect"],
  projects: ["Open Source Data Pipeline"], awards: [], expectedSectionCount: 7,
}, {
  id: "golden-003", name: "Software Engineer - Maria Chen", industry: "technology",
  description: "Full-stack engineer with microservices experience",
  tags: ["it", "software-engineering"],
});

// ── HEALTHCARE ───────────────────────────────────────────────────────
add({
  contact: { email: "j.wilson@email.com", phone: "+1-555-0303", location: "Boston, MA" },
  summary: "Board-certified physician with 10+ years in internal medicine and patient care.",
  experience: [{
    id: nextId(), company: "Massachusetts General Hospital", title: "Attending Physician",
    startDate: "2018-03", endDate: "Present", location: "Boston, MA",
    bullets: [
      "Provided comprehensive internal medicine care to 1,500+ patients annually",
      "Supervised 8 resident physicians and 4 medical students in clinical rotations",
      "Implemented electronic health record optimization reducing documentation time by 25%",
    ],
  }],
  education: [
    { id: nextId(), institution: "Harvard Medical School", degree: "Doctor of Medicine (MD)", startDate: "2009-09", endDate: "2013-06" },
    { id: nextId(), institution: "Johns Hopkins University", degree: "B.S. Biology", startDate: "2005-09", endDate: "2009-06", gpa: "3.8" },
  ],
  skills: [
    { id: nextId(), name: "Internal Medicine", category: "Clinical", level: "expert" },
    { id: nextId(), name: "Patient Care", category: "Clinical", level: "expert" },
    { id: nextId(), name: "EHR Systems", category: "Technical", level: "advanced" },
    { id: nextId(), name: "Medical Education", category: "Academic", level: "advanced" },
  ],
  languages: [
    { id: nextId(), name: "English", proficiency: "native" },
    { id: nextId(), name: "Spanish", proficiency: "conversational" },
  ],
  certifications: [
    { id: nextId(), name: "Board Certification - Internal Medicine", issuer: "ABIM", date: "2014" },
    { id: nextId(), name: "ACLS", issuer: "AHA", date: "2023" },
  ],
}, {
  names: ["Dr. James Wilson", "James Wilson"], employers: ["Massachusetts General Hospital"],
  schools: ["Harvard Medical School", "Johns Hopkins University"],
  diplomas: ["Doctor of Medicine (MD)", "B.S. Biology"],
  dates: ["2018-03", "2009-09", "2013-06", "2005-09", "2009-06", "2014", "2023"],
  locations: ["Boston, MA"], languages: ["English", "Spanish"],
  certifications: ["Board Certification - Internal Medicine", "ACLS"],
  projects: [], awards: [], expectedSectionCount: 6,
}, {
  id: "golden-004", name: "Physician - Dr. James Wilson", industry: "healthcare",
  description: "Board-certified internal medicine physician",
  tags: ["healthcare", "medical"],
});

// ── FINANCE ──────────────────────────────────────────────────────────
add({
  contact: { email: "r.kim@email.com", phone: "+1-555-0505", location: "Chicago, IL" },
  summary: "Financial analyst with 5+ years in investment banking and portfolio management.",
  experience: [{
    id: nextId(), company: "Goldman Sachs", title: "Investment Banking Analyst",
    startDate: "2021-01", endDate: "Present", location: "Chicago, IL",
    bullets: [
      "Executed M&A transactions totaling $2.5B across 12 deals in technology and healthcare sectors",
      "Built complex financial models including DCF, LBO, and merger models for client presentations",
      "Conducted due diligence and valuation analysis for Fortune 500 clients",
    ],
  }],
  education: [
    { id: nextId(), institution: "University of Chicago Booth", degree: "MBA in Finance", startDate: "2019-09", endDate: "2021-06", gpa: "3.9" },
    { id: nextId(), institution: "Northwestern University", degree: "B.S. Economics", startDate: "2014-09", endDate: "2018-06", gpa: "3.8" },
  ],
  skills: [
    { id: nextId(), name: "Financial Modeling", category: "Core", level: "expert" },
    { id: nextId(), name: "M&A", category: "Core", level: "advanced" },
    { id: nextId(), name: "Valuation", category: "Core", level: "expert" },
    { id: nextId(), name: "Excel", category: "Technical", level: "expert" },
    { id: nextId(), name: "Bloomberg Terminal", category: "Technical", level: "advanced" },
  ],
  languages: [
    { id: nextId(), name: "English", proficiency: "native" },
    { id: nextId(), name: "Korean", proficiency: "fluent" },
  ],
  certifications: [{ id: nextId(), name: "CFA Level II", issuer: "CFA Institute", date: "2023" }],
}, {
  names: ["Robert Kim"], employers: ["Goldman Sachs"],
  schools: ["University of Chicago Booth", "Northwestern University"],
  diplomas: ["MBA in Finance", "B.S. Economics"],
  dates: ["2021-01", "2019-09", "2021-06", "2014-09", "2018-06", "2023"],
  locations: ["Chicago, IL"], languages: ["English", "Korean"],
  certifications: ["CFA Level II"],
  projects: [], awards: [], expectedSectionCount: 6,
}, {
  id: "golden-005", name: "Financial Analyst - Robert Kim", industry: "finance",
  description: "Investment banking analyst at Goldman Sachs",
  tags: ["finance", "banking"],
});

// ── FRESH GRADUATE ─────────────────────────────────────────────────
add({
  contact: { email: "o.tazi@email.com", phone: "+212-6XX-XXXXXX", location: "Rabat, Morocco" },
  summary: "Recent Computer Science graduate seeking entry-level software engineering position.",
  experience: [{
    id: nextId(), company: "Freelance Projects", title: "Junior Developer",
    startDate: "2024-06", endDate: "2025-01", location: "Remote",
    bullets: [
      "Built a full-stack e-commerce platform using Next.js and PostgreSQL",
      "Developed REST APIs serving 500+ daily active users",
      "Collaborated with design team to implement responsive UI components",
    ],
  }],
  education: [{ id: nextId(), institution: "ENSIAS", degree: "Bachelor in Computer Science", startDate: "2021-09", endDate: "2024-06", gpa: "3.5" }],
  skills: [
    { id: nextId(), name: "JavaScript", category: "Languages", level: "intermediate" },
    { id: nextId(), name: "React", category: "Frontend", level: "intermediate" },
    { id: nextId(), name: "Next.js", category: "Frontend", level: "intermediate" },
    { id: nextId(), name: "Python", category: "Languages", level: "intermediate" },
    { id: nextId(), name: "Git", category: "Tools", level: "intermediate" },
  ],
  languages: [
    { id: nextId(), name: "Arabic", proficiency: "native" },
    { id: nextId(), name: "French", proficiency: "fluent" },
    { id: nextId(), name: "English", proficiency: "fluent" },
  ],
  projects: [{
    id: nextId(), name: "E-Commerce Platform",
    description: "Full-stack marketplace built with Next.js and Stripe integration",
    bullets: [],
  }],
}, {
  names: ["Omar Tazi"], employers: ["Freelance Projects"],
  schools: ["ENSIAS"], diplomas: ["Bachelor in Computer Science"],
  dates: ["2024-06", "2025-01", "2021-09", "2024-06"],
  locations: ["Rabat, Morocco", "Remote"], languages: ["Arabic", "French", "English"],
  certifications: [], projects: ["E-Commerce Platform"], awards: [], expectedSectionCount: 6,
}, {
  id: "golden-006", name: "Fresh Graduate - Omar Tazi", industry: "technology",
  description: "Recent CS graduate seeking entry-level position",
  tags: ["fresh-graduate", "entry-level"],
});

// ── EXECUTIVE ──────────────────────────────────────────────────────
add({
  contact: { email: "j.martinez@email.com", phone: "+1-555-0606", location: "New York, NY" },
  summary: "C-suite executive with 20+ years in technology leadership and digital transformation.",
  experience: [{
    id: nextId(), company: "GlobalTech Corp", title: "Chief Technology Officer",
    startDate: "2019-01", endDate: "Present", location: "New York, NY",
    bullets: [
      "Led digital transformation strategy for $500M technology division with 2,000+ employees",
      "Drove 40% revenue growth through cloud migration and SaaS product innovation",
      "Established AI/ML center of excellence delivering $15M in annual efficiency savings",
    ],
  }],
  education: [
    { id: nextId(), institution: "Stanford University", degree: "MBA", startDate: "2005-09", endDate: "2007-06" },
    { id: nextId(), institution: "UC Berkeley", degree: "B.S. Electrical Engineering", startDate: "1998-09", endDate: "2002-06", gpa: "3.7" },
  ],
  skills: [
    { id: nextId(), name: "Digital Transformation", category: "Strategy", level: "expert" },
    { id: nextId(), name: "Technology Leadership", category: "Leadership", level: "expert" },
    { id: nextId(), name: "P&L Management", category: "Business", level: "expert" },
    { id: nextId(), name: "Cloud Strategy", category: "Technical", level: "expert" },
    { id: nextId(), name: "M&A Integration", category: "Strategy", level: "advanced" },
  ],
  languages: [
    { id: nextId(), name: "English", proficiency: "native" },
    { id: nextId(), name: "Spanish", proficiency: "fluent" },
  ],
}, {
  names: ["Jennifer Martinez"], employers: ["GlobalTech Corp"],
  schools: ["Stanford University", "UC Berkeley"],
  diplomas: ["MBA", "B.S. Electrical Engineering"],
  dates: ["2019-01", "2005-09", "2007-06", "1998-09", "2002-06"],
  locations: ["New York, NY"], languages: ["English", "Spanish"],
  certifications: [], projects: [], awards: [], expectedSectionCount: 5,
}, {
  id: "golden-007", name: "CTO - Jennifer Martinez", industry: "technology",
  description: "Chief Technology Officer with 20+ years experience",
  tags: ["executive", "c-suite"],
});

// ── ENGINEERING / CONSTRUCTION ──────────────────────────────────────
add({
  contact: { email: "c.renault@email.com", phone: "+33-6XX-XXXXXX", location: "Paris, France" },
  summary: "Civil engineer with 12+ years in large-scale infrastructure and construction management.",
  experience: [{
    id: nextId(), company: "Vinci Construction", title: "Senior Civil Engineer",
    startDate: "2018-02", endDate: "Present", location: "Paris, France",
    bullets: [
      "Managed $50M+ highway infrastructure project from planning through completion",
      "Led multidisciplinary team of 25 engineers, architects, and contractors",
      "Implemented BIM methodology reducing design conflicts by 40%",
    ],
  }],
  education: [{ id: nextId(), institution: "École Polytechnique", degree: "Master of Civil Engineering", startDate: "2008-09", endDate: "2013-06", gpa: "3.6" }],
  skills: [
    { id: nextId(), name: "Project Management", category: "Core", level: "expert" },
    { id: nextId(), name: "Structural Engineering", category: "Core", level: "expert" },
    { id: nextId(), name: "AutoCAD", category: "Technical", level: "advanced" },
    { id: nextId(), name: "BIM", category: "Technical", level: "advanced" },
    { id: nextId(), name: "Contract Management", category: "Business", level: "advanced" },
  ],
  languages: [
    { id: nextId(), name: "French", proficiency: "native" },
    { id: nextId(), name: "English", proficiency: "fluent" },
  ],
  certifications: [{ id: nextId(), name: "PMP", issuer: "PMI", date: "2020" }],
}, {
  names: ["Claire Renault"], employers: ["Vinci Construction"],
  schools: ["École Polytechnique"], diplomas: ["Master of Civil Engineering"],
  dates: ["2018-02", "2008-09", "2013-06", "2020"],
  locations: ["Paris, France"], languages: ["French", "English"],
  certifications: ["PMP"], projects: [], awards: [], expectedSectionCount: 6,
}, {
  id: "golden-008", name: "Civil Engineer - Claire Renault", industry: "engineering-construction",
  description: "Senior civil engineer with infrastructure expertise",
  tags: ["engineering", "construction"],
});

// ── CUSTOMER SERVICE ───────────────────────────────────────────────
add({
  contact: { email: "a.diallo@email.com", phone: "+212-5XX-XXXXXX", location: "Casablanca, Morocco" },
  summary: "Bilingual customer service professional with 4+ years in call center and client relations.",
  experience: [{
    id: nextId(), company: "Maroc Telecom", title: "Senior Customer Service Representative",
    startDate: "2021-03", endDate: "Present", location: "Casablanca, Morocco",
    bullets: [
      "Resolved 60+ customer inquiries daily via phone, email, and chat maintaining 95% satisfaction rate",
      "Trained 10+ new hires on CRM systems and customer service protocols",
      "Reduced average call handling time by 20% while maintaining quality scores above target",
    ],
  }],
  education: [{ id: nextId(), institution: "Université Hassan II", degree: "Bachelor in English Studies", startDate: "2015-09", endDate: "2019-06", gpa: "3.4" }],
  skills: [
    { id: nextId(), name: "Customer Service", category: "Core", level: "expert" },
    { id: nextId(), name: "CRM Systems", category: "Technical", level: "advanced" },
    { id: nextId(), name: "Complaint Resolution", category: "Soft", level: "expert" },
    { id: nextId(), name: "Call Center Operations", category: "Core", level: "advanced" },
    { id: nextId(), name: "Communication", category: "Soft", level: "expert" },
  ],
  languages: [
    { id: nextId(), name: "Arabic", proficiency: "native" },
    { id: nextId(), name: "French", proficiency: "fluent" },
    { id: nextId(), name: "English", proficiency: "fluent" },
  ],
}, {
  names: ["Amara Diallo"], employers: ["Maroc Telecom"],
  schools: ["Université Hassan II"], diplomas: ["Bachelor in English Studies"],
  dates: ["2021-03", "2015-09", "2019-06"],
  locations: ["Casablanca, Morocco"], languages: ["Arabic", "French", "English"],
  certifications: [], projects: [], awards: [], expectedSectionCount: 6,
}, {
  id: "golden-009", name: "Customer Service - Amara Diallo", industry: "customer-service",
  description: "Bilingual CS professional at Maroc Telecom",
  tags: ["customer-service", "call-center"],
});

// ── GOVERNMENT ─────────────────────────────────────────────────────
add({
  contact: { email: "p.thompson@email.com", phone: "+1-555-0707", location: "Washington, DC" },
  summary: "Public policy professional with 8+ years in federal program management.",
  experience: [{
    id: nextId(), company: "U.S. Department of State", title: "Program Manager",
    startDate: "2019-06", endDate: "Present", location: "Washington, DC",
    bullets: [
      "Managed $25M annual budget for international exchange programs across 15 countries",
      "Developed and implemented policy frameworks for cross-agency collaboration",
      "Led 40-person team through organizational restructuring with zero disruption",
    ],
  }],
  education: [{ id: nextId(), institution: "Georgetown University", degree: "MPA", startDate: "2014-09", endDate: "2016-06", gpa: "3.8" }],
  skills: [
    { id: nextId(), name: "Policy Analysis", category: "Core", level: "expert" },
    { id: nextId(), name: "Program Management", category: "Core", level: "expert" },
    { id: nextId(), name: "Budget Management", category: "Business", level: "advanced" },
    { id: nextId(), name: "Stakeholder Engagement", category: "Soft", level: "expert" },
  ],
  languages: [{ id: nextId(), name: "English", proficiency: "native" }],
}, {
  names: ["Patricia Thompson"], employers: ["U.S. Department of State"],
  schools: ["Georgetown University"], diplomas: ["MPA"],
  dates: ["2019-06", "2014-09", "2016-06"],
  locations: ["Washington, DC"], languages: ["English"],
  certifications: [], projects: [], awards: [], expectedSectionCount: 5,
}, {
  id: "golden-010", name: "Program Manager - Patricia Thompson", industry: "government",
  description: "Federal program manager with policy expertise",
  tags: ["government", "program-management"],
});

// ============================================================================
// Helpers
// ============================================================================

export function getGoldenResume(id: string): GoldenResume | undefined {
  return GOLDEN_CORPUS.find((r) => r.id === id);
}

export function getGoldenResumesByIndustry(industry: string): GoldenResume[] {
  return GOLDEN_CORPUS.filter((r) => r.industry === industry);
}

export function getGoldenResumesByTag(tag: string): GoldenResume[] {
  return GOLDEN_CORPUS.filter((r) => r.tags.indexOf(tag) !== -1);
}

export function getAllGoldenIndustries(): string[] {
  const industries = Array.from(GOLDEN_CORPUS.reduce((acc, r) => { acc.add(r.industry); return acc; }, new Set<string>()));
  return industries;
}

export default {
  GOLDEN_CORPUS,
  getGoldenResume,
  getGoldenResumesByIndustry,
  getGoldenResumesByTag,
  getAllGoldenIndustries,
};
