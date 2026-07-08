// ============================================================================
// Enterprise ATS Intelligence Engine — ResumeAI Pro
// ============================================================================
// Modular profiles, profile detection, competency models, simulators,
// dual scoring explainer, achievement engine, and airline language translation.
// ============================================================================

import type { ResumeData, JobDescription } from "../types";

// ============================================================================
// 1. Supported ATS Platforms & Mappings
// ============================================================================

export interface AtsPlatformProfile {
  id: string;
  name: string;
  version: string;
  parsingStyle: string;
  formattingPreferences: string;
  recruiterWorkflow: string;
  optimizationStrategy: string;
  structuralSensitivity: {
    prefersTables: boolean;
    prefersColumns: boolean;
    strictDates: boolean;
    specialCharactersRisk: boolean;
  };
}

export const ATS_PLATFORM_PROFILES: Record<string, AtsPlatformProfile> = {
  oracle_recruiting_cloud: {
    id: "oracle_recruiting_cloud",
    name: "Oracle Recruiting Cloud",
    version: "24B",
    parsingStyle: "Semantic OCR + NLP extraction. Strong parser for text streams but highly sensitive to formatting anomalies.",
    formattingPreferences: "Avoid multi-columns and text boxes. Prefers simple left-to-right single column layouts. Do not use graphics, icons, or progress bars.",
    recruiterWorkflow: "Recruiters filter by specific system competencies and check match rankings first, then review text resumes directly.",
    optimizationStrategy: "Place keywords in standard section headings. Avoid headers/footers for key details like name and contact info.",
    structuralSensitivity: { prefersTables: false, prefersColumns: false, strictDates: true, specialCharactersRisk: true }
  },
  oracle_hcm: {
    id: "oracle_hcm",
    name: "Oracle HCM",
    version: "V11",
    parsingStyle: "Relational database parsing. Strips formatting and parses into profile fields.",
    formattingPreferences: "Plain text, standard system fonts (Arial, Calibri). Do not use text wrapping or decorative dividers.",
    recruiterWorkflow: "Scans for specific credentials and certifications (e.g., SEP, CRM) before human screen.",
    optimizationStrategy: "Ensure certifications are listed in a separate, clean section with explicit dates.",
    structuralSensitivity: { prefersTables: false, prefersColumns: false, strictDates: true, specialCharactersRisk: true }
  },
  taleo: {
    id: "taleo",
    name: "Taleo",
    version: "EE 23",
    parsingStyle: "Strict hierarchical parsing. Highly sensitive to fonts, tables, and sections. Easily confuses columns.",
    formattingPreferences: "Completely single-column. No tables. Standard date format (MM/YYYY). No headers, no footers.",
    recruiterWorkflow: "Recruiters use search queries with Boolean operators and filter candidates by requisition-specific questions.",
    optimizationStrategy: "Explicitly repeat core job titles. Use standard headings (Work History, Education, Skills) verbatim.",
    structuralSensitivity: { prefersTables: false, prefersColumns: false, strictDates: true, specialCharactersRisk: true }
  },
  cazar: {
    id: "cazar",
    name: "Cazar",
    version: "v4.2",
    parsingStyle: "Parser optimized for regional recruitment (Middle East). Good language identification (English/Arabic).",
    formattingPreferences: "Supports clean layouts, tables, and languages. Prefers standard layout format.",
    recruiterWorkflow: "Recruiters rely on nationality, languages, and specific airlines background filters.",
    optimizationStrategy: "List languages (Arabic, English, French, etc.) clearly with proficiency levels (Native, Fluent).",
    structuralSensitivity: { prefersTables: true, prefersColumns: false, strictDates: false, specialCharactersRisk: false }
  },
  sap_successfactors: {
    id: "sap_successfactors",
    name: "SAP SuccessFactors",
    version: "2024",
    parsingStyle: "Enterprise XML Schema Parser. Maps text blocks directly into SuccessFactors Employee Central profiles.",
    formattingPreferences: "Prefers simple tables for metadata but single column for experience. Strict on date fields.",
    recruiterWorkflow: "Candidates are scored against pre-defined profile values. Recruiter views structured profiles first.",
    optimizationStrategy: "Align experience bullets with corporate values. Keep bullet structures clean and standardized.",
    structuralSensitivity: { prefersTables: true, prefersColumns: false, strictDates: true, specialCharactersRisk: true }
  },
  workday: {
    id: "workday",
    name: "Workday Recruiting",
    version: "v42",
    parsingStyle: "High-performance block parsing. Scans and creates automated profile applications. Tends to merge side-by-side columns.",
    formattingPreferences: "Avoid multi-columns. Use simple horizontal separators. Do not place dates on the same line as titles if using columns.",
    recruiterWorkflow: "Workday flags candidates with high matching keywords. Recruiter clicks through structured fields first.",
    optimizationStrategy: "Make sure contact information is not in headers. Write skills clearly in bullet lists.",
    structuralSensitivity: { prefersTables: false, prefersColumns: false, strictDates: true, specialCharactersRisk: false }
  },
  greenhouse: {
    id: "greenhouse",
    name: "Greenhouse",
    version: "2026",
    parsingStyle: "Modern search-oriented indexing. Good at parsing standard PDFs. Keeps original formatting intact for recruiter viewing.",
    formattingPreferences: "recruiter-friendly layouts, clean modern typography, logical sections. Supports tables and clean columns.",
    recruiterWorkflow: "Greenhouse doesn't score/reject automatically; it presents candidate cards to recruiters. Human review is fast, so first impressions matter.",
    optimizationStrategy: "Optimize for human recruiters. Use high-impact verbs, professional summaries, and readable typography.",
    structuralSensitivity: { prefersTables: true, prefersColumns: true, strictDates: false, specialCharactersRisk: false }
  },
  lever: {
    id: "lever",
    name: "Lever",
    version: "v5",
    parsingStyle: "Natural language indexing. Indexes the full text of the resume. Recruiter views the PDF/Word file directly in the browser.",
    formattingPreferences: "Very flexible, but keep it highly readable. Avoid complex graphic structures that degrade text rendering.",
    recruiterWorkflow: "Recruiters use search bars to query terms. Highly visual, fast-paced manual screening.",
    optimizationStrategy: "Embed synonyms and context terms. Ensure visual hierarchy is clear to support a 6-second scan.",
    structuralSensitivity: { prefersTables: true, prefersColumns: true, strictDates: false, specialCharactersRisk: false }
  },
  smartrecruiters: {
    id: "smartrecruiters",
    name: "SmartRecruiters",
    version: "v10",
    parsingStyle: "SmartAssistant AI parsing. Matches resume entities directly to Job description profile fields.",
    formattingPreferences: "Standard, clean headings. Avoid icons and complex bullet characters.",
    recruiterWorkflow: "SmartAssistant matches candidates and assigns a match score (0-100%). Recruiters filter by score.",
    optimizationStrategy: "Maximize semantic keyword matching. Weave technical and soft skills directly into work experiences.",
    structuralSensitivity: { prefersTables: false, prefersColumns: false, strictDates: true, specialCharactersRisk: true }
  },
  icims: {
    id: "icims",
    name: "iCIMS",
    version: "2025",
    parsingStyle: "Traditional pattern matching parser. Translates sections into relational database fields.",
    formattingPreferences: "Strict single column. Standard fonts. Avoid fancy bullet symbols or headers.",
    recruiterWorkflow: "Recruiters search the database using specific key skills and work experience duration filters.",
    optimizationStrategy: "Include precise work history dates. List core keywords in both a summary and a skills list.",
    structuralSensitivity: { prefersTables: false, prefersColumns: false, strictDates: true, specialCharactersRisk: true }
  },
  jobvite: {
    id: "jobvite",
    name: "Jobvite",
    version: "v9",
    parsingStyle: "Resume compiler mapping. Good at standard headings, poor at nested tables or complex templates.",
    formattingPreferences: "Clean, standard format. Avoid progress circles, charts, or images.",
    recruiterWorkflow: "Sorts applicants by matching scores. Recruiters screen from top scoring profiles downward.",
    optimizationStrategy: "Optimize headings verbatim (e.g. 'Professional Experience'). Use standard bullet points.",
    structuralSensitivity: { prefersTables: false, prefersColumns: false, strictDates: true, specialCharactersRisk: false }
  },
  avature: {
    id: "avature",
    name: "Avature",
    version: "v8",
    parsingStyle: "CRM-first indexing. Parses contact info, current employer, and skills for search filters.",
    formattingPreferences: "Flexible, but requires clean contact details. Do not write contact info inside images.",
    recruiterWorkflow: "Used heavily for talent pools. Recruiters search by location, previous employers, and tags.",
    optimizationStrategy: "Clearly list location (City, Country), current company, and exact job titles.",
    structuralSensitivity: { prefersTables: true, prefersColumns: true, strictDates: false, specialCharactersRisk: false }
  },
  cornerstone: {
    id: "cornerstone",
    name: "Cornerstone Recruiting",
    version: "v12",
    parsingStyle: "Relational database parsing. Strict on credentials and degrees.",
    formattingPreferences: "Simple, formal formatting. Avoid multi-columns or creative section headers.",
    recruiterWorkflow: "Recruiters screen based on mandatory credentials, certifications, and educational background first.",
    optimizationStrategy: "Write education and degrees clearly with standard names (e.g., 'Bachelor of Science').",
    structuralSensitivity: { prefersTables: false, prefersColumns: false, strictDates: true, specialCharactersRisk: true }
  },
  ukg_recruiting: {
    id: "ukg_recruiting",
    name: "UKG Recruiting",
    version: "v3",
    parsingStyle: "HRIS-aligned parsing. Good at pulling company names, job titles, and dates.",
    formattingPreferences: "Standard left-aligned single column. Minimal special formatting.",
    recruiterWorkflow: "Integrated into employee portal. Recruiters verify details and timeline accuracy.",
    optimizationStrategy: "Ensure chronological timeline is perfectly sequential, without gaps or overlapping dates.",
    structuralSensitivity: { prefersTables: false, prefersColumns: false, strictDates: true, specialCharactersRisk: false }
  },
  generic: {
    id: "generic",
    name: "Generic Enterprise ATS",
    version: "Standard",
    parsingStyle: "Hierarchical block parser.",
    formattingPreferences: "Standard single column. Arial/Calibri, 10-12pt. No tables or columns.",
    recruiterWorkflow: "Keyword matches and Boolean search filters.",
    optimizationStrategy: "Tailor profile directly to job description keywords. Write clear action-oriented bullet points.",
    structuralSensitivity: { prefersTables: false, prefersColumns: false, strictDates: true, specialCharactersRisk: true }
  }
};

export const AIRLINE_ATS_MAPPINGS: Record<string, { atsId: string; companyName: string }> = {
  emirates: { atsId: "oracle_recruiting_cloud", companyName: "Emirates Airline" },
  etihad: { atsId: "oracle_recruiting_cloud", companyName: "Etihad Airways" },
  qatar: { atsId: "cazar", companyName: "Qatar Airways" },
  gulf: { atsId: "oracle_recruiting_cloud", companyName: "Gulf Air" },
  saudia: { atsId: "oracle_recruiting_cloud", companyName: "Saudia" },
  riyadh: { atsId: "oracle_recruiting_cloud", companyName: "Riyadh Air" },
  arabia: { atsId: "generic", companyName: "Air Arabia" },
  flydubai: { atsId: "generic", companyName: "flydubai" },
  oman: { atsId: "generic", companyName: "Oman Air" },
  kuwait: { atsId: "generic", companyName: "Kuwait Airways" },
  maroc: { atsId: "generic", companyName: "Royal Air Maroc" }
};

// ============================================================================
// 2. Profile Detection Engine
// ============================================================================

export function detectATSFromContext(
  url?: string,
  jdText?: string,
  companyName?: string
): { atsId: string; confidence: number; reason: string } {
  const jdLower = (jdText || "").toLowerCase();
  const urlLower = (url || "").toLowerCase();
  const companyLower = (companyName || "").toLowerCase().replace(/airline|airways|air/g, "").trim();

  // Rule 1: Check known airline/employer mappings
  for (const [key, mapping] of Object.entries(AIRLINE_ATS_MAPPINGS)) {
    if (companyLower.includes(key) || jdLower.includes(mapping.companyName.toLowerCase())) {
      const profile = ATS_PLATFORM_PROFILES[mapping.atsId] || ATS_PLATFORM_PROFILES.generic;
      return {
        atsId: mapping.atsId,
        confidence: 95,
        reason: `Matched known employer profile for ${mapping.companyName} utilizing ${profile.name}.`
      };
    }
  }

  // Rule 2: Check URL patterns
  if (urlLower.includes("myworkdayjobs")) {
    return { atsId: "workday", confidence: 99, reason: "Detected Workday domain signature in Careers URL." };
  }
  if (urlLower.includes("taleo.net") || urlLower.includes("taleo.com")) {
    return { atsId: "taleo", confidence: 99, reason: "Detected Taleo domain signature in Careers URL." };
  }
  if (urlLower.includes("greenhouse.io")) {
    return { atsId: "greenhouse", confidence: 99, reason: "Detected Greenhouse domain signature in Careers URL." };
  }
  if (urlLower.includes("lever.co")) {
    return { atsId: "lever", confidence: 99, reason: "Detected Lever domain signature in Careers URL." };
  }
  if (urlLower.includes("smartrecruiters.com")) {
    return { atsId: "smartrecruiters", confidence: 99, reason: "Detected SmartRecruiters domain signature in Careers URL." };
  }
  if (urlLower.includes("icims.com")) {
    return { atsId: "icims", confidence: 99, reason: "Detected iCIMS domain signature in Careers URL." };
  }
  if (urlLower.includes("jobvite.com")) {
    return { atsId: "jobvite", confidence: 99, reason: "Detected Jobvite domain signature in Careers URL." };
  }
  if (urlLower.includes("avature.net")) {
    return { atsId: "avature", confidence: 99, reason: "Detected Avature domain signature in Careers URL." };
  }
  if (urlLower.includes("cornerstoneondemand.com")) {
    return { atsId: "cornerstone", confidence: 99, reason: "Detected Cornerstone domain signature in Careers URL." };
  }
  if (urlLower.includes("ultipro.com")) {
    return { atsId: "ukg_recruiting", confidence: 99, reason: "Detected UKG / Ultipro domain signature in Careers URL." };
  }
  if (urlLower.includes("successfactors")) {
    return { atsId: "sap_successfactors", confidence: 99, reason: "Detected SAP SuccessFactors signature in Careers URL." };
  }
  if (urlLower.includes("oraclecloud.com") || urlLower.includes("hcm")) {
    return { atsId: "oracle_recruiting_cloud", confidence: 95, reason: "Detected Oracle Cloud signature in Careers URL." };
  }
  if (urlLower.includes("cazar.com")) {
    return { atsId: "cazar", confidence: 99, reason: "Detected Cazar domain signature in Careers URL." };
  }

  // Rule 3: Search text for signatures
  if (jdLower.includes("workday")) return { atsId: "workday", confidence: 70, reason: "Careers text mentions Workday portal." };
  if (jdLower.includes("successfactors")) return { atsId: "sap_successfactors", confidence: 70, reason: "Careers text mentions SuccessFactors portal." };
  if (jdLower.includes("taleo")) return { atsId: "taleo", confidence: 70, reason: "Careers text mentions Taleo." };
  if (jdLower.includes("greenhouse")) return { atsId: "greenhouse", confidence: 75, reason: "Job description mentions Greenhouse application flow." };
  if (jdLower.includes("lever.co") || jdLower.includes("lever application")) return { atsId: "lever", confidence: 75, reason: "Job description mentions Lever application flow." };
  if (jdLower.includes("smartrecruiters")) return { atsId: "smartrecruiters", confidence: 75, reason: "Job description mentions SmartRecruiters." };
  if (jdLower.includes("icims")) return { atsId: "icims", confidence: 70, reason: "Job description mentions iCIMS." };

  // Fallback
  return {
    atsId: "generic",
    confidence: 30,
    reason: "No strong ATS indicators. Selecting generic corporate ATS profile."
  };
}

// ============================================================================
// 3. Airline Competency Ontology
// ============================================================================

export interface AirlineCompetencyNode {
  name: string;
  description: string;
  aliases: string[];
  synonyms: string[];
  industryTerminology: string[];
  behavioralIndicators: string[];
  resumeEvidence: string;
  interviewEvidence: string;
  relatedAtsKeywords: string[];
  semanticVariations: string[];
}

export const AIRLINE_COMPETENCY_ONTOLOGY: Record<string, AirlineCompetencyNode> = {
  customer_focus: {
    name: "Customer Focus",
    description: "Aligning service delivery with guest expectations and delivering personalized premium care.",
    aliases: ["Guest Relations", "Client Orientation", "Customer Service", "Passenger Care"],
    synonyms: ["Hospitality Excellence", "Passenger-Centricity", "Guest Service Focus"],
    industryTerminology: ["5-Star Hospitality", "Premium Guest Services", "Service Standards", "Guest Profiling"],
    behavioralIndicators: [
      "Anticipates passenger needs before they arise.",
      "Delivers personalized service to premium/VIP guest tiers.",
      "Maintains warm, welcoming demeanor under flight operational constraints."
    ],
    resumeEvidence: "Delivered premium hospitality services to 250+ passengers per sector, consistently scoring 98% in onboard feedback.",
    interviewEvidence: "Describing a scenario where a passenger was accommodated with a personalized meal choice due to strict dietary restrictions.",
    relatedAtsKeywords: ["Customer Satisfaction", "Passenger Assistance", "Guest Experience", "Service Delivery", "Client Relations"],
    semanticVariations: ["customer focus", "guest first", "passenger care", "service orientation"]
  },
  passenger_experience: {
    name: "Passenger Experience",
    description: "Creating memorable and comfortable travel journeys for passengers across all cabin classes.",
    aliases: ["Traveler Experience", "Onboard Comfort", "In-flight Experience", "Pax Experience"],
    synonyms: ["Cabin Comfort", "Flight Journey Optimization", "Passenger Journey"],
    industryTerminology: ["Special Assistance (PRM, UMNR)", "Frequent Flyer (CIP/VIP)", "In-flight Amenity Management", "Premium Lounge Standard"],
    behavioralIndicators: [
      "Assists passengers with seating, baggage, and comfort requests.",
      "Coordinates with ground staff for seamless boarding/disembarkation transitions.",
      "Communicates cabin product details (entertainment, Wi-Fi) effectively."
    ],
    resumeEvidence: "Enhanced passenger experience for First Class passengers, resulting in a 15% increase in brand loyalty index scores.",
    interviewEvidence: "Explaining how an anxious first-time flyer was comforted and supported throughout a long-haul sector.",
    relatedAtsKeywords: ["Passenger Experience", "Boarding Assist", "Loyalty Program", "VIP Care", "First Class Cabin"],
    semanticVariations: ["passenger experience", "traveler experience", "pax experience", "inflight comfort"]
  },
  cabin_safety: {
    name: "Cabin Safety",
    description: "Securing the cabin environment, ensuring equipment compliance, and enforcing regulatory safety protocols.",
    aliases: ["Cabin Safety Management", "Safety Compliance", "Onboard Safety"],
    synonyms: ["Safety Checks", "SEP Compliance", "Cabin Security"],
    industryTerminology: ["SEP (Safety & Emergency Procedures)", "DGR (Dangerous Goods Regulations)", "Pre-flight Safety Briefing", "Emergency Exit Rows"],
    behavioralIndicators: [
      "Performs strict pre-flight safety equipment checks in allocated galley/cabin zone.",
      "Enforces passenger safety compliance (seatbelts, baggage stowage) politely but firmly.",
      "Identifies and isolates potential cabin safety hazards immediately."
    ],
    resumeEvidence: "Maintained 100% safety compliance across 150+ international sectors, strictly adhering to CAA and ICAO regulations.",
    interviewEvidence: "Detailing an incident where an unsecured cabin item was identified and secured during severe turbulence.",
    relatedAtsKeywords: ["Safety Regulations", "CAA Compliance", "Aviation Safety", "SEP Standards", "Emergency Equipment"],
    semanticVariations: ["cabin safety", "safety compliance", "emergency procedures", "safety check"]
  },
  crew_resource_management: {
    name: "Crew Resource Management",
    description: "Optimizing communication, decision-making, and teamwork within the multi-cultural flight crew environment.",
    aliases: ["CRM", "Inter-crew Collaboration", "Team Resource Management"],
    synonyms: ["Crew Coordination", "Flight Teamwork", "Synergy Management"],
    industryTerminology: ["NITS Briefing", "Cockpit-Cabin Communication", "Cross-cultural Crew Synergy", "Debriefing Protocols"],
    behavioralIndicators: [
      "Participates actively in pre-flight briefings with pilots and cabin crew.",
      "Communicates critical cabin status details clearly using standard aviation terminology.",
      "Resolves crew scheduling or operational conflicts productively."
    ],
    resumeEvidence: "Practiced high-level Crew Resource Management (CRM) in diverse teams of 12+ nationalities, ensuring seamless sector operations.",
    interviewEvidence: "Sharing how structured CRM protocols were used to coordinate a medical response on an ultra-long-haul flight.",
    relatedAtsKeywords: ["Crew Resource Management", "Team Collaboration", "Operational Safety", "Crisis Management", "Communication Flow"],
    semanticVariations: ["crew resource management", "crm", "crew teamwork", "cockpit communication"]
  },
  conflict_resolution: {
    name: "Conflict Resolution",
    description: "De-escalating disruptive situations and resolving passenger disputes in a professional, safety-conscious manner.",
    aliases: ["De-escalation", "Disruptive Passenger Management", "Complaint Handling"],
    synonyms: ["Mediation", "Passenger De-escalation", "Dispute Handling"],
    industryTerminology: ["Unruly Passenger Protocol", "De-escalation Techniques", "Service Recovery Protocol", "Threat Levels"],
    behavioralIndicators: [
      "Identifies signs of passenger distress or agitation early.",
      "Uses active listening and neutral body language to calm tense interactions.",
      "Follows standard regulatory procedures for handling disruptive behavior."
    ],
    resumeEvidence: "Successfully resolved 30+ high-stress passenger conflicts, preventing escalations and maintaining cabin tranquility.",
    interviewEvidence: "Discussing how a dispute over seating was resolved by actively listening and offering an alternative solution that satisfied both parties.",
    relatedAtsKeywords: ["Conflict De-escalation", "Problem Solving", "Customer Relations", "Behavior Management", "Regulatory Action"],
    semanticVariations: ["conflict resolution", "passenger dispute", "de-escalate", "unruly passenger"]
  },
  cross_cultural_communication: {
    name: "Cross-Cultural Communication",
    description: "Communicating effectively and respectfully with passengers and crew from diverse global backgrounds.",
    aliases: ["Multicultural Service", "Diversity Awareness", "Intercultural Communication"],
    synonyms: ["Global Communication", "Cultural Sensitivity", "Multicultural Synergy"],
    industryTerminology: ["Multinational Crew", "Global Passenger Demographics", "Non-verbal Cues", "Cultural Nuances"],
    behavioralIndicators: [
      "Adapts language and speaking pace for non-native English speakers.",
      "Respects dietary, religious, and social customs of international passengers.",
      "Leverages language skills to assist passengers in their native tongues."
    ],
    resumeEvidence: "Leveraged multilingual capabilities (English, Arabic, French) to assist a diverse passenger base across global flight routes.",
    interviewEvidence: "Explaining how cross-cultural awareness was key to resolving a misunderstanding with an international passenger.",
    relatedAtsKeywords: ["Multilingual Assistance", "Cultural Sensitivity", "Global Customer Service", "International Relations", "Diversity"],
    semanticVariations: ["cross cultural", "multicultural", "cultural sensitivity", "language skills"]
  },
  service_recovery: {
    name: "Service Recovery",
    description: "Restoring guest satisfaction immediately following a service failure or operational breakdown.",
    aliases: ["Onboard Compensation", "Service Correction", "Complaint Rectification"],
    synonyms: ["Complaint Resolution", "Service Fix", "Passenger Retention"],
    industryTerminology: ["Service Recovery Voucher", "Upgrade Protocol", "In-flight Apology", "Customer Relations Logging"],
    behavioralIndicators: [
      "Acknowledges service failures (e.g. broken IFE, missing meal) promptly and sincerely.",
      "Offers immediate alternative solutions or standard commercial compensation.",
      "Logs service issues accurately for downstream customer relations tracking."
    ],
    resumeEvidence: "Initiated 45+ service recovery actions, converting negative situations into positive brand experiences for high-value flyers.",
    interviewEvidence: "Recounting a time when a business class seat was malfunctioning, and immediate service recovery was executed via a seat swap and complimentary lounge access.",
    relatedAtsKeywords: ["Service Recovery", "Problem Solving", "Customer Retention", "Onboard Assistance", "Brand Loyalty"],
    semanticVariations: ["service recovery", "complaint resolution", "compensation", "service correction"]
  },
  aviation_safety: {
    name: "Aviation Safety",
    description: "Adhering to international aviation regulations and maintaining a safety-first mindset in all operations.",
    aliases: ["Flight Safety", "Aviation Security", "Operational Safety"],
    synonyms: ["Aeronautical Safety", "CAA Regulations", "Regulatory Compliance"],
    industryTerminology: ["ICAO Annex 6", "FAA / EASA Standards", "SMS (Safety Management System)", "Captain's Authority"],
    behavioralIndicators: [
      "Maintains absolute familiarity with emergency escape slide operations and cabin doors.",
      "Enforces sterile flight deck rules strictly during takeoff and landing.",
      "Reports any cabin equipment anomalies to the Senior Cabin Crew / Captain."
    ],
    resumeEvidence: "Consistently rated 'Excellent' in aviation safety audits; completed annual recurrent SEP exams with scores above 98%.",
    interviewEvidence: "Describing how a safety hazard (such as a blocked exit or malfunctioning latch) was identified and resolved pre-takeoff.",
    relatedAtsKeywords: ["Aviation Safety", "SEP Certification", "Safety Audits", "ICAO Standards", "Regulatory Compliance"],
    semanticVariations: ["aviation safety", "flight safety", "safety audits", "sms compliance"]
  }
};

// ============================================================================
// 4. Internal ATS Parser Simulator
// ============================================================================

export interface ParserSimulationResult {
  parseScore: number;
  risks: string[];
  warnings: string[];
}

export function simulateATSParser(
  resume: ResumeData,
  atsId: string
): ParserSimulationResult {
  const profile = ATS_PLATFORM_PROFILES[atsId] || ATS_PLATFORM_PROFILES.generic;
  const risks: string[] = [];
  const warnings: string[] = [];

  let parserStability = 100;

  // 1. Column detection
  // Multi-column layouts are very risky in Taleo and Workday
  if (!profile.structuralSensitivity.prefersColumns) {
    // If the resume has layout indications of multiple columns (e.g. side-by-side elements)
    // We simulate this risk by analyzing if skills lists are long or if contact details are side-by-side
    if (resume.skills.length > 15) {
      risks.push(`High Skill count (${resume.skills.length}) may suggest tabular or column formatting. ${profile.name} parser is sensitive to tables/columns.`);
      parserStability -= 10;
    }
  }

  // 2. Date Ambiguity
  // E.g., '2023 - Present' or 'Ongoing' or missing months
  for (const exp of resume.experience) {
    if (!exp.startDate || !exp.endDate) {
      warnings.push(`Ambiguous dates in role "${exp.title}" at "${exp.company}". ATS parser might fail to compute employment duration.`);
      parserStability -= 8;
    } else {
      // Check if dates are year-only (e.g. exactly 4 digits)
      const isYearOnlyStart = /^\d{4}$/.test(exp.startDate.trim());
      const isYearOnlyEnd = /^\d{4}$/.test(exp.endDate.trim());
      if (isYearOnlyStart || isYearOnlyEnd) {
        warnings.push(`Role "${exp.title}" date format is year-only. Standardize to MM/YYYY to prevent ATS calculation errors.`);
        parserStability -= 5;
      }
    }
  }

  // 3. Contact Info Formatting
  if (resume.contact.phone && /[\(\)]/.test(resume.contact.phone)) {
    warnings.push("Phone number contains parentheses (e.g., (123)). Some older ATS parsers (like Taleo EE) fail to index numbers with special characters.");
    parserStability -= 5;
  }
  if (!resume.contact.email || !resume.contact.email.includes("@")) {
    risks.push("CRITICAL: Invalid or missing email address. ATS parser will fail to create a candidate profile.");
    parserStability -= 30;
  }

  // 4. Special Characters Risk
  // Check bullets for problematic characters
  const bullets = resume.experience.flatMap((e) => e.bullets);
  let hasSpecialChars = false;
  for (const b of bullets) {
    if (/[•✈✓]/.test(b)) {
      hasSpecialChars = true;
    }
  }
  if (hasSpecialChars && profile.structuralSensitivity.specialCharactersRisk) {
    warnings.push(`Decorative bullet characters detected. ${profile.name} can convert these into garbled text (e.g., '' or boxes).`);
    parserStability -= 7;
  }

  // 5. standard headings
  // Headings that might be too creative
  const sectionsText = [resume.summary, resume.skills.length ? "skills" : "", resume.experience.length ? "experience" : ""].join(" ").toLowerCase();
  if (sectionsText && !sectionsText.includes("professional summary") && !sectionsText.includes("work experience") && !sectionsText.includes("experience")) {
    warnings.push("Creative section headers detected. Use standard headings (e.g., 'Work Experience') to ensure correct block classification.");
    parserStability -= 10;
  }

  return {
    parseScore: Math.max(10, parserStability),
    risks,
    warnings
  };
}

// ============================================================================
// 5. Recruiter Intelligence Simulator
// ============================================================================

export interface RecruiterSimulationResult {
  recruiterScore: number;
  breakdown: {
    firstImpression: number;
    careerStability: number;
    jobRelevance: number;
    achievementQuality: number;
    safetyMindset: number;
    serviceRecovery: number;
  };
  recommendations: string[];
}

export function simulateRecruiter(
  resume: ResumeData,
  jd?: JobDescription | null
): RecruiterSimulationResult {
  const recommendations: string[] = [];
  const text = JSON.stringify(resume).toLowerCase();

  // A. First Impression (Formatting, completeness, length)
  let firstImpression = 95;
  if (!resume.summary || resume.summary.length < 150) {
    firstImpression -= 15;
    recommendations.push("Professional summary is too brief. Provide a 3-4 sentence elevator pitch establishing your experience.");
  }
  if (resume.summary && resume.summary.length > 550) {
    firstImpression -= 10;
    recommendations.push("Summary exceeds 90 words. Shorten it to keep the recruiter engaged during the initial scan.");
  }
  if (resume.skills.length < 5) {
    firstImpression -= 10;
    recommendations.push("List at least 8 key skills categorized logically to showcase your core competencies.");
  }

  // B. Career Stability (avoid gaps, short tenures)
  let careerStability = 90;
  // If there are too many short tenures (e.g. < 6 months)
  let shortTenures = 0;
  for (const exp of resume.experience) {
    // Simple duration estimate
    if (exp.startDate && exp.endDate) {
      if (exp.endDate.toLowerCase().includes("present")) continue;
      const startYear = parseInt(exp.startDate.split("-")[0]);
      const endYear = parseInt(exp.endDate.split("-")[0]);
      if (!isNaN(startYear) && !isNaN(endYear)) {
        if (endYear - startYear === 0) {
          shortTenures++;
        }
      }
    }
  }
  if (shortTenures >= 2) {
    careerStability -= 15;
    recommendations.push("Multiple short tenures detected. Frame contract positions explicitly as 'Contract' or 'Project-based' to show stability.");
  }

  // C. Job Relevance
  let jobRelevance = 75;
  if (jd) {
    const jdKeywords = jd.keywords || [];
    let matchCount = 0;
    for (const kw of jdKeywords) {
      if (text.includes(kw.toLowerCase())) matchCount++;
    }
    const matchPct = jdKeywords.length > 0 ? (matchCount / jdKeywords.length) * 100 : 75;
    jobRelevance = Math.round(50 + matchPct / 2);
    if (matchPct < 40) {
      recommendations.push("Low relevance to target job. Embed more exact terminology and match key requirements listed in the JD.");
    }
  }

  // D. Achievement Quality (Action verbs + metrics)
  let achievementQuality = 80;
  const totalBullets = resume.experience.flatMap((e) => e.bullets);
  if (totalBullets.length > 0) {
    const quantified = totalBullets.filter((b) => /\d+%|\$\d|\d+x|\d{2,}/.test(b)).length;
    const quantifiedPct = (quantified / totalBullets.length) * 100;
    achievementQuality = Math.round(40 + quantifiedPct * 0.6);

    if (quantifiedPct < 30) {
      recommendations.push("Most bullet points describe daily tasks rather than achievements. Add numbers (percentages, passenger counts, turnaround times) to show impact.");
    }
  } else {
    achievementQuality = 20;
    recommendations.push("No experience bullets found. Add descriptive work achievements.");
  }

  // E. Airline specific: Safety Mindset
  let safetyMindset = 50;
  const safetyKeywords = ["safety", "sep", "emergency", "evacuation", "dgr", "compliance", "first aid", "regulatory", "sms"];
  let safetyMatches = 0;
  for (const sk of safetyKeywords) {
    if (text.includes(sk)) safetyMatches++;
  }
  safetyMindset = Math.min(100, 30 + safetyMatches * 15);
  if (safetyMindset < 60) {
    recommendations.push("Safety mindset is underrepresented. In cabin crew or airport roles, safety is the number one priority — explicitly reference safety checks, procedures, or compliance.");
  }

  // F. Airline specific: Service Recovery
  let serviceRecovery = 50;
  const serviceKeywords = ["service recovery", "guest satisfaction", "premium service", "passenger care", "resolution", "multicultural", "vip"];
  let serviceMatches = 0;
  for (const sk of serviceKeywords) {
    if (text.includes(sk)) serviceMatches++;
  }
  serviceRecovery = Math.min(100, 30 + serviceMatches * 15);
  if (serviceRecovery < 60) {
    recommendations.push("Service recovery and premium hospitality evidence are low. Detail how you handled guest complaints or VIP service levels.");
  }

  const recruiterScore = Math.round(
    firstImpression * 0.15 +
    careerStability * 0.15 +
    jobRelevance * 0.25 +
    achievementQuality * 0.25 +
    safetyMindset * 0.10 +
    serviceRecovery * 0.10
  );

  return {
    recruiterScore,
    breakdown: {
      firstImpression,
      careerStability,
      jobRelevance,
      achievementQuality,
      safetyMindset,
      serviceRecovery
    },
    recommendations
  };
}

// ============================================================================
// 6. Dual Scoring Engine
// ============================================================================

export interface DualScoringResult {
  atsScore: number;
  recruiterScore: number;
  differenceReason: string;
  recommendations: string[];
}

export function evaluateDualScoring(
  atsScore: number,
  recruiterScore: number,
  parsingScore: number,
  resume: ResumeData
): DualScoringResult {
  const recommendations: string[] = [];
  let differenceReason = "";

  const diff = atsScore - recruiterScore;

  if (Math.abs(diff) <= 8) {
    differenceReason = "Your resume is well-balanced. It is optimized for keyword indexing by the ATS while remaining highly readable and engaging for human recruiters.";
  } else if (diff > 8) {
    differenceReason = `Your resume is optimized for ATS indexing (Score: ${atsScore}) but scores lower on human recruiter appeal (Score: ${recruiterScore}). This typically occurs when a resume is rich in keywords but relies on passive language, fails to quantify results, or is formatted in a way that dilutes readability.`;
    recommendations.push("Shift focus toward human-centric readability. Rewrite keyword-stuffed sections into standard action-oriented sentences.");
  } else {
    differenceReason = `Your resume has high recruiter appeal (Score: ${recruiterScore}) but lacks matching keywords required to rank high in the ATS (Score: ${atsScore}). It may be filtered out before a human recruiter ever gets to see it.`;
    recommendations.push("Identify missing keywords from the job description and embed them naturally into your summary and skills list.");
  }

  if (parsingScore < 75) {
    recommendations.push(`WARNING: ATS Parsing Stability is low (${parsingScore}%). Standardize date formats and phone details to prevent truncation or data loss.`);
  }

  return {
    atsScore,
    recruiterScore,
    differenceReason,
    recommendations
  };
}

// ============================================================================
// 7. Achievement Classification & Enhancement
// ============================================================================

export interface BulletAnalysis {
  bullet: string;
  category: "responsibility" | "achievement" | "safety" | "compliance" | "customer_service" | "leadership";
  isQuantified: boolean;
  improvedWording?: string;
  suggestion?: string;
}

export function classifyAndEnhanceBullet(bullet: string): BulletAnalysis {
  const lower = bullet.toLowerCase();
  let category: BulletAnalysis["category"] = "responsibility";

  if (lower.includes("safety") || lower.includes("emergency") || lower.includes("sep") || lower.includes("evacuation")) {
    category = "safety";
  } else if (lower.includes("compliance") || lower.includes("regulations") || lower.includes("audit") || lower.includes("dgr")) {
    category = "compliance";
  } else if (lower.includes("lead") || lower.includes("train") || lower.includes("supervis") || lower.includes("coordinat") || lower.includes("manage")) {
    category = "leadership";
  } else if (lower.includes("customer") || lower.includes("passenger") || lower.includes("guest") || lower.includes("service") || lower.includes("recovery")) {
    category = "customer_service";
  } else if (lower.includes("achievement") || lower.includes("increased") || lower.includes("reduced") || lower.includes("delivered") || lower.includes("built")) {
    category = "achievement";
  }

  const isQuantified = /\d|%|\$|×|x\d/.test(bullet);

  let improvedWording: string | undefined;
  let suggestion: string | undefined;

  if (!isQuantified) {
    suggestion = "This bullet point is descriptive but lacks a quantified outcome. Add a metric (e.g. count of passengers, service rating, sector count) to prove your impact.";
  }

  // Suggest improvements based on category
  if (category === "customer_service" && !isQuantified) {
    improvedWording = bullet
      .replace(/responsible for helping passengers/i, "Delivered exceptional passenger assistance, resolving flight inquiries for 250+ passengers per sector")
      .replace(/helped customers/i, "Delivered exceptional guest experiences and initiated service recovery procedures to maintain a 98% satisfaction rating");
  } else if (category === "safety" && !isQuantified) {
    improvedWording = bullet
      .replace(/responsible for safety/i, "Enforced strict cabin safety rules and checked all emergency exit row seating parameters pre-flight")
      .replace(/followed safety rules/i, "Maintained 100% compliance with Safety and Emergency Procedures (SEP) and EASA regulations");
  }

  return {
    bullet,
    category,
    isQuantified,
    improvedWording,
    suggestion
  };
}

// ============================================================================
// 8. Airline Language Engine
// ============================================================================

const AIRLINE_VOCABULARY_MAP: Record<string, string> = {
  "customer support": "Passenger Assistance",
  "customer service": "Passenger Experience",
  "safety rules": "Safety Compliance",
  "helped customers": "Delivered Exceptional Passenger Experience",
  "help customers": "Deliver Exceptional Passenger Experience",
  "teamwork": "Crew Resource Management (CRM)",
  "problem solving": "Operational Decision Making",
  "baggage": "Cabin Baggage",
  "luggage": "Passenger Luggage",
  "coworkers": "Crew Members",
  "co-workers": "Flight Crew",
  "flight": "Sector Operation",
  "boss": "Purser / Cabin Senior",
  "supervisor": "Cabin Senior / Senior Flight Purser",
  "work with flight crew": "practice Crew Resource Management (CRM)"
};

export function translateToAirlineLanguage(text: string): string {
  let translated = text;
  for (const [generic, airline] of Object.entries(AIRLINE_VOCABULARY_MAP)) {
    const regex = new RegExp(`\\b${generic}\\b`, "gi");
    translated = translated.replace(regex, airline);
  }
  return translated;
}

// ============================================================================
// 9. Continuous Validation & Factual Consistency
// ============================================================================

export interface FactualValidationReport {
  valid: boolean;
  issues: string[];
}

export function validateFactualConsistency(
  original: ResumeData,
  optimized: ResumeData
): FactualValidationReport {
  const issues: string[] = [];

  // 1. Verify Employer Names
  const originalEmployers = new Set(original.experience.map((e) => e.company.toLowerCase().trim()));
  for (const optExp of optimized.experience) {
    const optCompany = optExp.company.toLowerCase().trim();
    if (optCompany && !originalEmployers.has(optCompany)) {
      // Find closest name match to prevent minor formatting/spacing warning false positives
      let existsCloseMatch = false;
      for (const origComp of originalEmployers) {
        if (origComp.includes(optCompany) || optCompany.includes(origComp)) {
          existsCloseMatch = true;
        }
      }
      if (!existsCloseMatch) {
        issues.push(`Hallucinated employer detected: "${optExp.company}" is not present in the original resume. All facts must remain consistent.`);
      }
    }
  }

  // 2. Verify Date Boundaries
  // The optimized experience entries must match the original dates
  for (const optExp of optimized.experience) {
    const origExp = original.experience.find((e) => e.id === optExp.id);
    if (origExp) {
      if (optExp.startDate !== origExp.startDate || optExp.endDate !== origExp.endDate) {
        issues.push(`Date modification detected for "${optExp.title}" at "${optExp.company}". Original: ${origExp.startDate} to ${origExp.endDate}, Optimized: ${optExp.startDate} to ${optExp.endDate}.`);
      }
    }
  }

  // 3. Verify Education Integrity
  const originalSchools = new Set(original.education.map((e) => e.institution.toLowerCase().trim()));
  for (const optEdu of optimized.education) {
    const optSchool = optEdu.institution.toLowerCase().trim();
    if (optSchool && !originalSchools.has(optSchool)) {
      issues.push(`Hallucinated institution detected: "${optEdu.institution}" was not in the original educational background.`);
    }
  }

  return {
    valid: issues.length === 0,
    issues
  };
}
