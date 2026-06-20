// ============================================================================
// Dynamic Industry ATS System
// ============================================================================
// Replaces the hardcoded Aviation ATS Mode with a dynamic system that
// auto-detects the industry from the job description + resume, then selects
// the appropriate industry-specific keyword bank, ATS profile, and optimization
// directive.
//
// Aviation remains as one of the industry profiles (not removed — preserved
// as "Aviation" profile per spec).

import { INDUSTRY_KEYWORDS, CABIN_CREW_KEYWORDS, AVIATION_KEYWORDS, COMMON_ATS_KEYWORDS } from "./keyword-banks";

// ============================================================================
// Industry ATS Profiles
// ============================================================================

export interface IndustryAtsProfile {
  id: string;
  label: string;
  description: string;
  /** Industry-specific keyword bank (injected into the AI prompt) */
  keywordBank: string;
  /** Writing guidance specific to this industry */
  writingGuidance: string;
  /** Priority keywords for this industry */
  priorityKeywords: string[];
  /** Tone preference */
  tone: "Formal" | "Balanced" | "Warm" | "Premium" | "Aggressive";
  /** Common ATS systems used in this industry */
  commonAtsSystems: string[];
  /** Section priorities (which sections matter most) */
  sectionPriorities: string[];
}

// === Aviation (preserved from original) ===
const AVIATION_PROFILE: IndustryAtsProfile = {
  id: "aviation",
  label: "Aviation (Cabin Crew)",
  description: "Cabin crew, flight attendant, airline cabin operations",
  keywordBank: `${CABIN_CREW_KEYWORDS}\n${AVIATION_KEYWORDS}`,
  writingGuidance: `Emphasize MULTICULTURAL exposure, safety procedures, passenger service excellence.
Highlight any SEP, CRM, First Aid, CPR/AED certifications.
Tone: Premium, confident, service-oriented.`,
  priorityKeywords: ["Multicultural", "Premium Service", "Safety", "Hospitality", "Cultural Awareness", "Service Excellence", "SEP", "CRM"],
  tone: "Premium",
  commonAtsSystems: ["Workday", "SuccessFactors", "Taleo"],
  sectionPriorities: ["Professional Summary", "Core Competencies & Skills", "Professional Experience", "Education", "Languages"],
};

// === Airline Airport Services (Ground Operations) ===
const AIRLINE_AIRPORT_SERVICES_PROFILE: IndustryAtsProfile = {
  id: "airline-airport-services",
  label: "Airline Airport Services",
  description: "Ground operations, check-in, boarding, ramp, passenger services at airports",
  keywordBank: `Ground Operations: Check-in, Boarding, Disembarkation, Ramp Operations, Turnaround Management, Ground Handling, Aircraft Pushback, Baggage Handling, Load Sheet, Weight & Balance.
Passenger Services: Passenger Assistance, Special Assistance (PRM, UMNR, CIP), Lounge Access, Boarding Pass Issuance, Flight Irregularity Handling, Denied Boarding, Rebooking, Compensation.
Systems: Amadeus, Sabre, Galileo, DCS (Departure Control System), BRS (Baggage Reconciliation System), ACARS.
Safety: Ramp Safety, FOD (Foreign Object Debris), Ground Safety, Fueling Safety, De-icing, Marshalling.
Compliance: IATA AHM (Airport Handling Manual), ICAO Annex 14, SGHA (Standard Ground Handling Agreement).
Metrics: On-Time Performance (OTP), Turnaround Time, Baggage Mishandling Rate, Passenger Satisfaction.`,
  writingGuidance: `Highlight ground operations experience — check-in, boarding, ramp, baggage.
Mention specific DCS/systems used (Amadeus, Sabre, DCS).
Quantify operational metrics (OTP, turnaround time, baggage handling).
Emphasize safety compliance and IATA/AHM knowledge.
Tone: Professional, operational, safety-conscious.`,
  priorityKeywords: ["Ground Operations", "Check-in", "Boarding", "Passenger Services", "Ramp", "Turnaround", "DCS", "IATA AHM", "OTP"],
  tone: "Balanced",
  commonAtsSystems: ["Workday", "SuccessFactors", "Taleo"],
  sectionPriorities: ["Professional Summary", "Core Competencies & Skills", "Professional Experience", "Education", "Languages"],
};

// === Airport Duty Free Sales ===
const AIRPORT_DUTY_FREE_PROFILE: IndustryAtsProfile = {
  id: "airport-duty-free",
  label: "Airport Duty Free Sales",
  description: "Duty-free retail sales, airport shopping, travel retail",
  keywordBank: `Sales: Duty-Free Sales, Travel Retail, Upselling, Cross-selling, Product Demonstration, Promotional Campaigns, Sales Targets, Revenue Generation, Conversion Rate.
Products: Fragrances, Cosmetics, Liquor, Tobacco, Confectionery, Electronics, Luxury Goods, Fashion, Souvenirs, Local Specialties.
Operations: Visual Merchandising, Stock Management, Inventory Control, Cash Handling, Card Transactions, Foreign Currency, Tax-Free Forms, Refund Processing.
Customer Service: Multicultural Customer Service, Language Skills, Product Knowledge, Customer Engagement, VIP/CIP Service, Personal Shopping.
Compliance: Customs Regulations, Duty-Free Allowances, Age Verification, Liquor/Tobacco Restrictions, Security Screening Awareness.
Systems: POS Systems, SAP Retail, Inventory Management Systems, Sales Analytics.
Metrics: Sales per Square Meter, Average Transaction Value, Units per Transaction, Conversion Rate, Customer Satisfaction.`,
  writingGuidance: `Quantify sales achievements (e.g. "exceeded sales targets by 120%", "managed $50K daily revenue").
Highlight product knowledge across categories (fragrances, cosmetics, liquor, luxury).
Emphasize multicultural customer service and language skills.
Mention POS systems and visual merchandising experience.
Tone: Energetic, sales-driven, customer-focused.`,
  priorityKeywords: ["Duty-Free Sales", "Travel Retail", "Upselling", "Visual Merchandising", "Multicultural", "POS", "Sales Targets", "Conversion Rate"],
  tone: "Aggressive",
  commonAtsSystems: ["Workday", "SuccessFactors", "Taleo"],
  sectionPriorities: ["Professional Summary", "Core Competencies & Skills", "Professional Experience", "Education", "Languages"],
};

// === Hospitality (5-Star Hotels) ===
const HOSPITALITY_PROFILE: IndustryAtsProfile = {
  id: "hospitality",
  label: "Hospitality (5-Star Hotels)",
  description: "Luxury hotels, resorts, front office, guest services, F&B, concierge",
  keywordBank: `Front Office: Guest Registration, Check-in/Check-out, Reservation Management, Room Assignment, Guest Relations, Concierge Services, Bell Desk, Valet, Loyalty Programs.
Food & Beverage: Fine Dining Service, Banquet Operations, Room Service, Bar Service, Wine Knowledge, Menu Planning, Food Safety, HACCP, Allergen Management.
Guest Services: VIP Services, Butler Service, Personalized Service, Complaint Resolution, Guest Satisfaction, Guest Feedback Management, Special Requests.
Operations: Housekeeping Management, Laundry Services, Facility Management, Property Management System (PMS), Opera, Micros, Symphony.
Luxury Standards: Forbes Travel Guide Standards, AAA Diamond Ratings, Luxury Brand Standards, Butler Protocols, Etiquette, Personal Grooming.
Languages: English, Arabic, French, Mandarin, Russian, German — multicultural guest communication.
Metrics: Guest Satisfaction Score (GSS), NPS, RevPAR, ADR, Occupancy Rate, Repeat Guest Rate.`,
  writingGuidance: `Emphasize LUXURY service standards — Forbes/AAA ratings, brand standards.
Quantify guest satisfaction scores and service metrics.
Highlight specific hotel systems (Opera, Micros, Symphony).
Mention fine dining, banquet, or butler experience if applicable.
Emphasize multicultural communication and language skills.
Tone: Premium, elegant, service-excellence-focused.`,
  priorityKeywords: ["Guest Services", "Luxury", "Concierge", "Fine Dining", "Opera PMS", "VIP Services", "Guest Satisfaction", "Forbes Standards", "Multicultural"],
  tone: "Premium",
  commonAtsSystems: ["Workday", "SuccessFactors", "Taleo"],
  sectionPriorities: ["Professional Summary", "Core Competencies & Skills", "Professional Experience", "Education", "Languages"],
};

// === Technology ===
const TECHNOLOGY_PROFILE: IndustryAtsProfile = {
  id: "technology",
  label: "Technology",
  description: "Software engineering, DevOps, data science, IT",
  keywordBank: `Technical: Software Engineering, Full-Stack, Frontend, Backend, Mobile Development, DevOps, Cloud Architecture, Microservices, API Design, System Design, Database Optimization, CI/CD, Infrastructure as Code.
Languages: JavaScript, TypeScript, Python, Java, Go, Rust, C++, C#, Ruby, PHP, Swift, Kotlin.
Frameworks: React, Vue, Angular, Next.js, Node.js, Express, Django, Flask, Spring Boot, FastAPI.
Cloud: AWS, Azure, GCP, Kubernetes, Docker, Terraform, Serverless, Lambda.
Databases: PostgreSQL, MySQL, MongoDB, Redis, Elasticsearch, DynamoDB.
Practices: Agile, Scrum, TDD, Code Review, Pair Programming, Documentation, Monitoring, Alerting.`,
  writingGuidance: `Quantify technical achievements (e.g. "reduced latency by 40%", "scaled to 10M users").
Mention specific technologies, frameworks, and tools used.
Highlight system design, architecture decisions, and performance optimizations.
Tone: Technical, precise, data-driven.`,
  priorityKeywords: ["Software Engineering", "System Design", "Cloud", "API", "Scalability", "Agile", "CI/CD"],
  tone: "Balanced",
  commonAtsSystems: ["Greenhouse", "Lever", "Workday", "Ashby"],
  sectionPriorities: ["Professional Summary", "Core Competencies & Skills", "Professional Experience", "Projects", "Education"],
};

// === Finance ===
const FINANCE_PROFILE: IndustryAtsProfile = {
  id: "finance",
  label: "Finance",
  description: "Financial analysis, accounting, investment banking, FP&A",
  keywordBank: `Technical: Financial Analysis, Financial Modeling, DCF Valuation, LBO Modeling, M&A Analysis, Due Diligence, Forecasting, Budgeting, Variance Analysis, P&L Management, Balance Sheet Analysis, Cash Flow Management.
Regulatory: GAAP, IFRS, SOX Compliance, Basel III, Dodd-Frank, AML/KYC.
Tools: Excel (Advanced), Bloomberg Terminal, FactSet, Capital IQ, QuickBooks, SAP, Oracle Financials.
Metrics: ROI, IRR, NPV, EBITDA, Revenue Growth, Margin Improvement, Cost Reduction.
Certifications: CFA, CPA, FRM, ACA, ACCA.`,
  writingGuidance: `Quantify financial impact (e.g. "managed $50M portfolio", "reduced costs by 15%").
Use financial terminology naturally — show domain expertise.
Highlight regulatory compliance and risk management experience.
Tone: Formal, precise, numbers-focused.`,
  priorityKeywords: ["Financial Analysis", "Modeling", "Forecasting", "Budgeting", "Compliance", "Risk Management", "GAAP"],
  tone: "Formal",
  commonAtsSystems: ["Workday", "SuccessFactors", "Taleo", "iCIMS"],
  sectionPriorities: ["Professional Summary", "Core Competencies & Skills", "Professional Experience", "Education", "Certifications"],
};

// === Marketing ===
const MARKETING_PROFILE: IndustryAtsProfile = {
  id: "marketing",
  label: "Marketing",
  description: "Digital marketing, brand management, content, growth",
  keywordBank: `Digital: SEO, SEM, PPC, Social Media Marketing, Email Marketing, Content Marketing, Marketing Automation, Conversion Rate Optimization, A/B Testing, Landing Page Optimization.
Analytics: Google Analytics, Google Tag Manager, Facebook Pixel, Attribution Modeling, Funnel Analysis, Cohort Analysis.
Platforms: Google Ads, Facebook Ads Manager, LinkedIn Ads, HubSpot, Marketo, Mailchimp, Salesforce Marketing Cloud.
Metrics: ROAS, CTR, CPC, CPM, Conversion Rate, Customer Acquisition Cost (CAC), Lifetime Value (LTV), Engagement Rate.
Strategy: Brand Strategy, Go-to-Market, Positioning, Competitive Analysis, Customer Journey Mapping.`,
  writingGuidance: `Quantify marketing results (e.g. "increased conversion by 35%", "grew email list to 500K").
Show campaign results with specific metrics.
Highlight creativity + data-driven decision making.
Tone: Creative, energetic, results-focused.`,
  priorityKeywords: ["Digital Marketing", "SEO", "Campaign Management", "Analytics", "Content Strategy", "Growth", "Conversion"],
  tone: "Balanced",
  commonAtsSystems: ["Workday", "Greenhouse", "Lever"],
  sectionPriorities: ["Professional Summary", "Core Competencies & Skills", "Professional Experience", "Projects", "Education"],
};

// === Healthcare ===
const HEALTHCARE_PROFILE: IndustryAtsProfile = {
  id: "healthcare",
  label: "Healthcare",
  description: "Clinical, nursing, healthcare administration, medical",
  keywordBank: `Clinical: Patient Care, Clinical Assessment, Treatment Planning, Medication Administration, Wound Care, Vital Signs Monitoring, Patient Education, Care Coordination.
Systems: EHR/EMR (Epic, Cerner, Meditech), HIPAA Compliance, ICD-10, CPT Coding, Medical Billing.
Specialties: Emergency, ICU, Pediatrics, Geriatrics, Surgical, Psychiatry, Oncology.
Admin: Healthcare Administration, Quality Improvement, Joint Commission, Patient Safety, Regulatory Compliance.
Certifications: BLS, ACLS, PALS, RN, LPN, CNA, CPR.`,
  writingGuidance: `Emphasize patient outcomes and safety.
Mention specific certifications (BLS, ACLS, RN, etc.).
Highlight experience with EHR systems.
Tone: Professional, compassionate, detail-oriented.`,
  priorityKeywords: ["Patient Care", "Clinical", "HIPAA", "EHR", "Patient Safety", "Quality Improvement", "Compliance"],
  tone: "Formal",
  commonAtsSystems: ["Workday", "Taleo", "iCIMS"],
  sectionPriorities: ["Professional Summary", "Core Competencies & Skills", "Professional Experience", "Education", "Certifications", "Licenses"],
};

// === Sales ===
const SALES_PROFILE: IndustryAtsProfile = {
  id: "sales",
  label: "Sales",
  description: "Sales, business development, account management",
  keywordBank: `Sales: B2B Sales, B2C Sales, SaaS Sales, Enterprise Sales, Consultative Selling, Solution Selling, SPIN Selling, Challenger Sale.
Pipeline: Lead Generation, Prospecting, Cold Calling, Qualification, Discovery, Demo, Proposal, Negotiation, Closing.
Account Management: Account Planning, Upselling, Cross-Selling, Renewal, Churn Prevention, Customer Success.
Tools: Salesforce, HubSpot CRM, Pipedrive, Outreach, SalesLoft, Gong.
Metrics: Quota Attainment, Revenue, ARR/MRR, Win Rate, Sales Cycle, Deal Size, Pipeline Coverage.`,
  writingGuidance: `Quantify sales achievements (e.g. "exceeded quota by 120%", "closed $2M in ARR").
Show progression in deal size and complexity.
Highlight relationship-building and negotiation skills.
Tone: Confident, results-driven, energetic.`,
  priorityKeywords: ["Sales", "Quota", "Revenue", "Pipeline", "Account Management", "Negotiation", "CRM"],
  tone: "Aggressive",
  commonAtsSystems: ["Salesforce", "Workday", "Greenhouse"],
  sectionPriorities: ["Professional Summary", "Core Competencies & Skills", "Professional Experience", "Education"],
};

// === Customer Service ===
const CUSTOMER_SERVICE_PROFILE: IndustryAtsProfile = {
  id: "customer-service",
  label: "Customer Service",
  description: "Customer support, call center, guest relations",
  keywordBank: `Service: Customer Service Excellence, Complaint Resolution, Conflict Resolution, De-escalation, Active Listening, Empathy, Problem Solving.
Operations: Call Center, Helpdesk, Ticketing System, SLA Management, First Contact Resolution, Average Handle Time.
Tools: Zendesk, Freshdesk, Intercom, Salesforce Service Cloud, LiveChat.
Metrics: CSAT, NPS, First Response Time, Resolution Rate, Customer Retention.
Skills: Multilingual Communication, Cross-cultural Communication, Quality Assurance, Training.`,
  writingGuidance: `Quantify service metrics (e.g. "maintained 98% CSAT", "resolved 200+ tickets daily").
Show ability to handle difficult situations.
Highlight language skills and cultural awareness.
Tone: Warm, empathetic, professional.`,
  priorityKeywords: ["Customer Service", "CSAT", "Resolution", "Communication", "Problem Solving", "Multilingual"],
  tone: "Warm",
  commonAtsSystems: ["Workday", "SuccessFactors", "Taleo"],
  sectionPriorities: ["Professional Summary", "Core Competencies & Skills", "Professional Experience", "Education", "Languages"],
};

// === Education ===
const EDUCATION_PROFILE: IndustryAtsProfile = {
  id: "education",
  label: "Education",
  description: "Teaching, academic, training, instructional design",
  keywordBank: `Teaching: Curriculum Development, Lesson Planning, Differentiated Instruction, Classroom Management, Student Assessment, Rubric Design, Project-Based Learning.
Pedagogy: Constructivist Approach, Scaffolding, Formative Assessment, Summative Assessment, Bloom's Taxonomy, Universal Design for Learning.
EdTech: Learning Management Systems (Canvas, Blackboard, Moodle), Google Classroom, Zoom, Interactive Whiteboards.
Specializations: Special Education, ESL/ELL, STEM, Early Childhood, Higher Education, Adult Learning.
Certifications: Teaching License, CELTA, TEFL, Google Certified Educator, Microsoft Educator.`,
  writingGuidance: `Highlight teaching outcomes and student achievement.
Mention specific curricula, methodologies, and technologies.
Show commitment to inclusive education and professional development.
Tone: Professional, academic, encouraging.`,
  priorityKeywords: ["Curriculum", "Instruction", "Assessment", "Classroom Management", "Pedagogy", "Student Achievement"],
  tone: "Formal",
  commonAtsSystems: ["Workday", "Taleo", "SchoolSpring"],
  sectionPriorities: ["Professional Summary", "Core Competencies & Skills", "Professional Experience", "Education", "Certifications"],
};

// === Human Resources ===
const HR_PROFILE: IndustryAtsProfile = {
  id: "human-resources",
  label: "Human Resources",
  description: "HR, recruitment, talent acquisition, people operations",
  keywordBank: `HR: Talent Acquisition, Recruitment, Onboarding, Employee Relations, Performance Management, Compensation & Benefits, HRIS, Compliance.
Recruiting: Sourcing, Screening, Interviewing, Offer Negotiation, Employer Branding, ATS Management, Diversity & Inclusion.
Systems: Workday, BambooHR, Greenhouse, Lever, iCIMS, ADP, Paychex.
Compliance: EEO, FLSA, FMLA, ADA, OSHA, Labor Law.
Development: Training & Development, Leadership Coaching, Succession Planning, Employee Engagement, Culture.`,
  writingGuidance: `Quantify HR impact (e.g. "reduced time-to-hire by 30%", "managed 500+ employees").
Show knowledge of employment law and compliance.
Highlight HR systems expertise.
Tone: Professional, approachable, discreet.`,
  priorityKeywords: ["Talent Acquisition", "Employee Relations", "HRIS", "Compliance", "Onboarding", "Performance Management"],
  tone: "Formal",
  commonAtsSystems: ["Workday", "BambooHR", "SuccessFactors"],
  sectionPriorities: ["Professional Summary", "Core Competencies & Skills", "Professional Experience", "Education", "Certifications"],
};

// === Operations ===
const OPERATIONS_PROFILE: IndustryAtsProfile = {
  id: "operations",
  label: "Operations",
  description: "Operations management, supply chain, logistics, project management",
  keywordBank: `Operations: Process Optimization, Lean Six Sigma, Kaizen, 5S, Value Stream Mapping, Capacity Planning, Quality Management.
Supply Chain: Inventory Management, Procurement, Supplier Relations, Logistics, Distribution, Forecasting, ERP.
Project Management: Agile, Waterfall, PMP, PRINCE2, Scrum, Kanban, Risk Management, Stakeholder Management.
Metrics: KPI, OEE, Cycle Time, Throughput, Cost per Unit, On-Time Delivery, Defect Rate.
Systems: SAP, Oracle, Microsoft Dynamics, Jira, Asana, Monday.com.`,
  writingGuidance: `Quantify operational improvements (e.g. "reduced cycle time by 25%", "saved $1.2M annually").
Show process improvement methodology experience.
Highlight cross-functional collaboration.
Tone: Precise, analytical, results-focused.`,
  priorityKeywords: ["Process Improvement", "Lean Six Sigma", "Supply Chain", "KPI", "Project Management", "Optimization"],
  tone: "Balanced",
  commonAtsSystems: ["Workday", "SuccessFactors", "Taleo"],
  sectionPriorities: ["Professional Summary", "Core Competencies & Skills", "Professional Experience", "Education", "Certifications"],
};

// === Generic (fallback) ===
const GENERIC_PROFILE: IndustryAtsProfile = {
  id: "generic",
  label: "Generic ATS",
  description: "General ATS optimization (Workday / SuccessFactors / Taleo compatible)",
  keywordBank: COMMON_ATS_KEYWORDS.join(", "),
  writingGuidance: `Use strong action verbs, quantify achievements, and tailor content to the job description.
Focus on transferable skills and measurable outcomes.
Tone: Professional, balanced.`,
  priorityKeywords: [],
  tone: "Balanced",
  commonAtsSystems: ["Workday", "SuccessFactors", "Taleo"],
  sectionPriorities: ["Professional Summary", "Core Competencies & Skills", "Professional Experience", "Education", "Languages"],
};

// ============================================================================
// Industry Profile Registry
// ============================================================================

export const INDUSTRY_PROFILES: Record<string, IndustryAtsProfile> = {
  aviation: AVIATION_PROFILE,
  "airline-airport-services": AIRLINE_AIRPORT_SERVICES_PROFILE,
  "airport-duty-free": AIRPORT_DUTY_FREE_PROFILE,
  hospitality: HOSPITALITY_PROFILE,
  technology: TECHNOLOGY_PROFILE,
  finance: FINANCE_PROFILE,
  marketing: MARKETING_PROFILE,
  healthcare: HEALTHCARE_PROFILE,
  sales: SALES_PROFILE,
  "customer-service": CUSTOMER_SERVICE_PROFILE,
  education: EDUCATION_PROFILE,
  "human-resources": HR_PROFILE,
  operations: OPERATIONS_PROFILE,
  generic: GENERIC_PROFILE,
};

export const INDUSTRY_OPTIONS = Object.values(INDUSTRY_PROFILES).map((p) => ({
  id: p.id,
  label: p.label,
  description: p.description,
}));

// ============================================================================
// Industry Detection
// ============================================================================

/**
 * Detect the industry from a job description + resume.
 * Uses keyword matching against the INDUSTRY_KEYWORDS banks.
 * Returns the detected industry ID + confidence score.
 */
export function detectIndustry(jdText: string, resumeText: string = ""): {
  industryId: string;
  confidence: number;
  detectedRole: string;
  detectedAts: string;
} {
  const combinedText = `${jdText} ${resumeText}`.toLowerCase();

  // Score each industry by counting keyword matches
  const scores: Record<string, number> = {};
  for (const [industryId, keywords] of Object.entries(INDUSTRY_KEYWORDS)) {
    let score = 0;
    for (const keyword of keywords) {
      if (combinedText.includes(keyword.toLowerCase())) {
        score += 1;
      }
    }
    scores[industryId] = score;
  }

  // Also check aviation-specific terms
  const aviationTerms = ["cabin crew", "flight attendant", "airline", "aviation", "cabin safety", "sep", "dgr"];
  let aviationScore = 0;
  for (const term of aviationTerms) {
    if (combinedText.includes(term)) aviationScore += 2; // weight aviation higher since it's specific
  }
  scores.aviation = (scores.aviation || 0) + aviationScore;

  // Find the best match
  let bestIndustry = "generic";
  let bestScore = 0;
  for (const [industryId, score] of Object.entries(scores)) {
    if (score > bestScore) {
      bestScore = score;
      bestIndustry = industryId;
    }
  }

  // Confidence = score / (max possible score for that industry)
  const maxPossible = INDUSTRY_KEYWORDS[bestIndustry]?.length || 10;
  const confidence = bestScore > 0 ? Math.min(100, Math.round((bestScore / maxPossible) * 150)) : 0;

  // If confidence is too low, fall back to generic
  if (confidence < 15) {
    bestIndustry = "generic";
  }

  // Detect role from JD title
  const detectedRole = detectRole(jdText);

  // Detect ATS system
  const detectedAts = detectAtsSystem(jdText);

  return {
    industryId: bestIndustry,
    confidence,
    detectedRole,
    detectedAts,
  };
}

/**
 * Extract the role/title from a job description.
 */
function detectRole(jdText: string): string {
  // Try to find a job title pattern in the first few lines
  const lines = jdText.split("\n").slice(0, 10).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    // Common patterns: "Job Title: X", "Position: X", "Role: X", or just a title-like line
    if (/^(job title|position|role|title)\s*[:\-]/i.test(line)) {
      return line.replace(/^(job title|position|role|title)\s*[:\-]\s*/i, "").trim();
    }
    // A line that looks like a title (2-8 words, no sentences)
    const words = line.split(/\s+/);
    if (words.length >= 2 && words.length <= 8 && !line.endsWith(".") && line.length < 60) {
      return line;
    }
  }
  return "the role";
}

/**
 * Detect the ATS system from a job description URL or content.
 */
function detectAtsSystem(jdText: string): string {
  const lower = jdText.toLowerCase();
  if (lower.includes("workday")) return "Workday";
  if (lower.includes("successfactors")) return "SuccessFactors";
  if (lower.includes("taleo")) return "Taleo";
  if (lower.includes("greenhouse")) return "Greenhouse";
  if (lower.includes("lever")) return "Lever";
  if (lower.includes("icims")) return "iCIMS";
  if (lower.includes("smartrecruiters")) return "SmartRecruiters";
  if (lower.includes("jobvite")) return "Jobvite";
  return "Generic ATS";
}

// ============================================================================
// Dynamic Industry Directive Generator
// ============================================================================

/**
 * Generate an industry-specific optimization directive.
 * This replaces the hardcoded aviation-only directive with a dynamic one
 * that adapts to any industry.
 */
export function getIndustryOptimizerDirective(
  industryId: string,
  employer: string,
  tone: string,
  format: string,
  strictness: string,
): string {
  const profile = INDUSTRY_PROFILES[industryId] || INDUSTRY_PROFILES.generic;

  const strictnessInstruction =
    strictness === "Aggressive"
      ? "MAXIMUM keyword density — embed every priority keyword naturally."
      : strictness === "Conservative"
        ? "Conservative — embed only the most relevant priority keywords."
        : "Balanced — embed priority keywords naturally without stuffing.";

  return `
═══════════════════════════════════════════════════════════════
INDUSTRY ATS MODE — ACTIVE
═══════════════════════════════════════════════════════════════
OPTIMIZATION PROFILE: ${profile.label}
INDUSTRY DESCRIPTION: ${profile.description}
TARGET EMPLOYER: ${employer || "Generic"}
TONE: ${tone}
FORMAT: ${format}
STRICTNESS: ${strictnessInstruction}

═══════════════════════════════════════════════════════════════
INDUSTRY KEYWORD BANK (weave relevant keywords naturally)
═══════════════════════════════════════════════════════════════
${profile.keywordBank}

${profile.priorityKeywords.length > 0 ? `PRIORITY KEYWORDS: ${profile.priorityKeywords.join(", ")}` : ""}

═══════════════════════════════════════════════════════════════
INDUSTRY WRITING GUIDANCE
═══════════════════════════════════════════════════════════════
${profile.writingGuidance}

═══════════════════════════════════════════════════════════════
SECTION PRIORITIES (in order of importance)
═══════════════════════════════════════════════════════════════
${profile.sectionPriorities.map((s, i) => `${i + 1}. ${s}`).join("\n")}

═══════════════════════════════════════════════════════════════
CONTENT TARGET — STRICT ENFORCEMENT
═══════════════════════════════════════════════════════════════
Target: ~2,900 characters of resume body content.
Each bullet: 110-180 characters (wraps to 2 lines for justified text).
Summary: 4-6 lines (~60-90 words) with priority keywords embedded naturally.

═══════════════════════════════════════════════════════════════
OUTPUT FORMAT — STRICT JSON (same as OPTIMIZER_DIRECTIVE)
═══════════════════════════════════════════════════════════════
Return ONLY valid JSON with the standard resume shape:
{ "name": "...", "headline": "...", "summary": "...", "skills": [...], "experience": [...], "education": [...], "languages": [...], "missingKeywordsAdded": [...], "bulletsRewritten": N }
`;
}
