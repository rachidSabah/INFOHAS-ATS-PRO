// ============================================================================
// Keyword Banks — unified source of truth for domain-specific keyword lists.
//
// Previously these were scattered across multiple files:
//   - ats.ts: COMMON_ATS_KEYWORDS, WEAK_VERBS
//   - ats-directives.ts: CABIN_CREW_KEYWORDS, AVIATION_KEYWORDS
//   - relevance-engine.ts: csKeywords, commKeywords, salesKeywords, transferable skills
//   - output-validator.ts: allowedAcronyms
//
// Centralizing them here makes the keyword banks easy to unit-test, extend,
// and audit without touching agent code.
// ============================================================================

// --- Generic ATS keywords (used when no JD is available) ---
export const COMMON_ATS_KEYWORDS = [
  "experience", "management", "development", "project", "team", "leadership",
  "analysis", "design", "software", "data", "business", "client", "system",
  "process", "solution", "technical", "communication", "collaboration",
  "stakeholder", "delivery", "strategy", "implementation", "optimization",
];

// --- Weak verbs that should be replaced with strong action verbs in bullets ---
export const WEAK_VERBS = [
  "responsible for", "worked on", "helped with", "tasked with", "duties included",
  "assisted in", "participated in", "involved in", "handled", "did",
];

// --- Strong action verbs (for optimizer suggestions) ---
export const STRONG_ACTION_VERBS = [
  "Led", "Built", "Increased", "Reduced", "Delivered", "Executed", "Managed",
  "Designed", "Implemented", "Achieved", "Launched", "Created", "Developed",
  "Optimized", "Transformed", "Spearheaded", "Architected", "Pioneered",
  "Streamlined", "Accelerated", "Generated", "Drove", "Established",
  "Negotiated", "Orchestrated", "Mentored", "Automated", "Consolidated",
];

// --- Allowed acronyms that won't be flagged as grammar errors ---
export const ALLOWED_ACRONYMS = [
  "ATS", "CV", "CEO", "CTO", "CFO", "COO", "CIO", "VP", "SVP", "EVP",
  "API", "SDK", "CLI", "GUI", "UI", "UX", "CSS", "HTML", "SQL", "REST",
  "JSON", "XML", "YAML", "TOML", "HTTP", "HTTPS", "DNS", "SSL", "TLS",
  "CI", "CD", "CDN", "CRM", "ERP", "SaaS", "PaaS", "IaaS", "AWS", "GCP",
  "MVP", "KPI", "OKR", "SLA", "SLO", "B2B", "B2C", "D2C", "FYI", "ETA",
  "PDF", "DOCX", "JPEG", "PNG", "SVG", "URL", "URI", "UUID", "ID",
  "AI", "ML", "DL", "NLP", "LLM", "RAG", "SEO", "SEM", "PPC", "ROAS",
  "CRM", "CMS", "DMS", "HRIS", "ATS", "LMS", "BI", "ETL", "OLAP", "OLTP",
];

// --- Aviation keyword banks (for Aviation ATS Mode) ---
export const CABIN_CREW_KEYWORDS = `
  Technical: Cabin Crew Attestation (CCA), CPR/AED Certified, Aviation First Aid, SEP (Safety and Emergency Procedures), Aircraft Type Qualifications (e.g., A380, B787), Cabin Crew Medical.
  Safety: Emergency Evacuation, Dangerous Goods Regulations (DGR), In-flight Firefighting, Ditching Procedures, Pre-flight Safety Checks, Aviation Security (AVSEC).
  Operational: CRM (Crew Resource Management), In-flight Service Delivery, Galley Management, Passenger Announcements (PA), Turnaround Operations, Special Handling (UMNR, PRM).
  Soft Skills: Customer Service Excellence, Conflict Resolution, Cultural Awareness, De-escalation, Decision Making Under Pressure, Situational Awareness.
`;

export const AVIATION_KEYWORDS = `
  Technical: Cabin Crew Attestation (CCA), ATP Certificate, Type Ratings (A320, B737, B777, B787, A350, A380), CRM Certification, Aviation First Aid, CPR/AED, SEP (Safety and Emergency Procedures), Aircraft Type Qualifications, Cabin Crew Medical, ICAO Language Proficiency (Level 4+).
  Safety: Emergency Evacuation, Dangerous Goods Regulations (DGR), In-flight Firefighting, Ditching Procedures, Pre-flight Safety Checks, Aviation Security (AVSEC), Smoke Removal, Rapid Decompression, Cabin Pressurization.
  Operational: Crew Resource Management (CRM), In-flight Service Delivery, Galley Management, Passenger Announcements (PA), Turnaround Operations, Special Handling (UMNR, PRM, CIP), Duty-Free Sales, Cash & Card Handling, Passenger Boarding, Disembarkation Procedures.
  Service: Customer Service Excellence, Conflict Resolution, Cultural Awareness, De-escalation, Decision Making Under Pressure, Situational Awareness, Multicultural Team Collaboration, Premium Cabin Service, Fine Dining Service, Beverage Service.
  Regulatory: EASA Part-CC, FAA Part 121/135, CAA CAP 789, ICAO Annex 6, IATA DGR, Aviation Audits (IOSA), Safety Management Systems (SMS).
  Languages: English (ICAO Level 4+), Arabic, French, German, Spanish, Mandarin, Hindi, Urdu — cross-cultural communication.
`;

// --- Industry keyword banks (for semantic matching when no JD is available) ---
export const INDUSTRY_KEYWORDS: Record<string, string[]> = {
  technology: [
    "software", "engineering", "development", "programming", "architecture",
    "API", "database", "cloud", "AWS", "Azure", "GCP", "DevOps", "CI/CD",
    "microservices", "JavaScript", "TypeScript", "Python", "Java", "Go", "Rust",
    "React", "Vue", "Angular", "Node.js", "Next.js", "GraphQL", "REST",
    "Kubernetes", "Docker", "Terraform", "monitoring", "scalability",
  ],
  finance: [
    "financial", "analysis", "modeling", "valuation", "DCF", "LBO", "M&A",
    "due diligence", "forecasting", "budgeting", "P&L", "balance sheet",
    "cash flow", "revenue", "EBITDA", "ROI", "IRR", "NPV", "risk management",
    "compliance", "SOX", "GAAP", "IFRS", "audit", "treasury", "FP&A",
  ],
  healthcare: [
    "clinical", "patient", "healthcare", "medical", "nursing", "HIPAA",
    "EHR", "EMR", "epic", "cerner", "telehealth", "patient care", "treatment",
    "diagnosis", "medication", "pharmacy", "laboratory", "radiology",
    "ICD-10", "CPT", "billing", "insurance", "verification", "charting",
  ],
  marketing: [
    "campaign", "SEO", "SEM", "content", "social media", "email marketing",
    "brand", "analytics", "Google Analytics", "Facebook Ads", "Google Ads",
    "conversion", "CTR", "CPC", "CPM", "ROAS", "attribution", "funnel",
    "landing page", "A/B testing", "marketing automation", "HubSpot", "Marketo",
  ],
  sales: [
    "sales", "quota", "pipeline", "CRM", "Salesforce", "prospecting",
    "lead generation", "cold calling", "account management", "negotiation",
    "closing", "revenue", "forecast", "territory", "B2B", "B2C", "SaaS",
    "upselling", "cross-selling", "retention", "churn", "CAC", "LTV",
  ],
  consulting: [
    "consulting", "strategy", "framework", "case study", "stakeholder",
    "recommendations", "deliverables", "analysis", "research", "data analysis",
    "presentation", "client engagement", "project management", "change management",
    "process improvement", "benchmarking", "interviews", "synthesis", "hypothesis",
  ],
  aviation: [
    "cabin crew", "flight attendant", "aviation", "airline", "passenger",
    "safety", "emergency", "CRM", "SEP", "first aid", "CPR", "AED",
    "service excellence", "multicultural", "premium service", "hospitality",
    "evacuation", "dangerous goods", "DGR", "security", "AVSEC",
  ],
  "airline-airport-services": [
    "ground operations", "check-in", "boarding", "ramp", "turnaround",
    "ground handling", "baggage handling", "departure control", "DCS",
    "passenger services", "airport services", "ground staff", "load sheet",
    "Amadeus", "Sabre", "IATA AHM", "ramp safety", "weight and balance",
    "disembarkation", "baggage reconciliation",
  ],
  "airport-duty-free": [
    "duty free", "duty-free", "travel retail", "airport retail",
    "fragrance", "cosmetics", "liquor", "tobacco", "tax-free",
    "visual merchandising", "POS system", "sales associate", "confectionery",
    "luxury goods", "customs regulations", "foreign currency",
    "stock management", "upselling", "cross-selling", "conversion rate",
  ],
  hospitality: [
    "hotel", "resort", "guest", "concierge", "front office", "housekeeping",
    "butler", "fine dining", "banquet", "room service", "opera pms",
    "forbes", "aaa diamond", "luxury hotel", "5-star", "five star",
    "guest satisfaction", "guest relations", "valet", "loyalty program",
    "HACCP", "micros", "food and beverage", "VIP services",
  ],
  retail: [
    "retail", "store", "customer service", "sales", "merchandising",
    "inventory", "POS", "cash handling", "visual merchandising", "loss prevention",
    "customer experience", "loyalty", "CRM", "stock management", "supplier",
    "purchasing", "forecasting", "planogram", "SKU", "footfall", "conversion",
  ],
};

// --- Transferable skills (for cross-industry matching) ---
export const TRANSFERABLE_SKILLS: Record<string, string[]> = {
  leadership: ["led", "managed", "supervised", "directed", "oversaw", "headed", "coordinated", "spearheaded"],
  communication: ["communicated", "presented", "negotiated", "facilitated", "liaised", "briefed", "articulated"],
  problemsolving: ["solved", "resolved", "troubleshot", "diagnosed", "analyzed", "investigated", "identified"],
  projectmanagement: ["planned", "executed", "delivered", "coordinated", "scheduled", "budgeted", "milestoned"],
  teamwork: ["collaborated", "partnered", "cooperated", "contributed", "supported", "assisted", "mentored"],
  analytics: ["analyzed", "measured", "tracked", "reported", "forecasted", "modeled", "quantified"],
  customerservice: ["served", "assisted", "resolved", "supported", "responded", "handled", "addressed"],
  processimprovement: ["improved", "optimized", "streamlined", "automated", "standardized", "redesigned", "enhanced"],
};

// --- Forbidden section names (analysis artifacts that must never appear as resume sections) ---
export const FORBIDDEN_SECTIONS = [
  "ats analysis", "ats score", "ats report", "ats breakdown",
  "requirements match", "requirement match", "job match", "jd match",
  "optimization notes", "optimization report", "optimization applied",
  "ai notes", "ai analysis", "ai report", "ai suggestions",
  "analysis", "analysis report", "analysis breakdown",
  "summary critique", "critique", "review", "feedback",
  "missing keywords", "matched keywords", "keyword analysis",
  "improvements", "recommendations", "suggestions",
  "debug", "debug info", "debug data",
  "error", "errors", "error report",
  "system", "system messages", "system info",
];

// --- Allowed resume section names (in canonical order) ---
export const ALLOWED_SECTIONS = [
  "professional summary", "summary", "profile", "objective", "about",
  "core competencies", "competencies", "skills", "technical skills", "core skills",
  "professional experience", "experience", "work experience", "employment history",
  "education", "academic background", "academic history",
  "languages", "language skills",
  "certifications", "licenses", "professional development",
  "projects", "key projects", "selected projects",
  "achievements", "key achievements", "awards", "honors",
  "publications", "research", "presentations",
  "volunteer", "volunteer experience", "community service",
  "affiliations", "professional affiliations", "memberships",
  "interests", "hobbies", "additional information",
];

/**
 * Get industry-specific keywords for semantic matching.
 * Falls back to COMMON_ATS_KEYWORDS if the industry is unknown.
 */
export function getIndustryKeywords(industry: string): string[] {
  const normalized = industry.toLowerCase().trim();
  return INDUSTRY_KEYWORDS[normalized] ?? COMMON_ATS_KEYWORDS;
}

/**
 * Check if a section title is forbidden (an analysis artifact).
 */
export function isForbiddenSection(title: string): boolean {
  const normalized = title.toLowerCase().trim();
  return FORBIDDEN_SECTIONS.some((s) => normalized.includes(s));
}

/**
 * Check if a section title is allowed (a real resume section).
 */
export function isAllowedSection(title: string): boolean {
  const normalized = title.toLowerCase().trim();
  return ALLOWED_SECTIONS.some((s) => normalized === s || normalized.startsWith(s) || s.startsWith(normalized));
}
