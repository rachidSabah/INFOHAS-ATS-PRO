// ============================================================================
// Enterprise Industry Knowledge Engine — ResumeAI Pro
// ============================================================================
// Central registry of industry profiles, skill graphs, competency trees,
// synonym groups, and domain-specific knowledge.
//
// PURPOSE:
//   The source of truth for industry intelligence. Every enhancement engine
//   (Keyword, Semantic, Content, ATS Scoring) reads from this registry.
//
//   NOT a replacement for industry-ats.ts — that file drives the pipeline's
//   aviationMode and keyword prompts. This engine provides deterministic,
//   data-driven intelligence for semantic matching and enhancement.
//
// DESIGN PRINCIPLES:
//   - Data-driven (not AI-prompted) intelligence
//   - Extensible — new industries add one folder of data
//   - Deterministic — same input always produces same output
//   - No hallucination — every fact originates from this registry
// ============================================================================

// ============================================================================
// Types
// ============================================================================

export interface IndustrySkillNode {
  /** Skill name (canonical) */
  name: string;
  /** Category / domain */
  category: string;
  /** Weight: 0-1 importance in this industry */
  weight: number;
  /** Variants / synonyms of this skill */
  aliases: string[];
  /** Sub-skills / specializations */
  children: IndustrySkillNode[];
  /** Role-specific relevance (e.g., "senior" → 0.9, "entry" → 0.5) */
  roleRelevance?: Record<string, number>;
}

export interface IndustryCompetency {
  name: string;
  description: string;
  skills: string[]; // References IndustrySkillNode.name
  importance: "core" | "preferred" | "nice-to-have";
}

export interface IndustrySynonymGroup {
  canonical: string;
  aliases: string[];
  category: string;
}

export interface IndustryProfile {
  id: string;
  label: string;
  description: string;
  /** Skill tree organized by competency domains */
  skillGraph: IndustrySkillNode[];
  /** Competency clusters */
  competencies: IndustryCompetency[];
  /** Synonym groups for semantic matching */
  synonyms: IndustrySynonymGroup[];
  /** Priority keywords (top terms for this industry) */
  priorityKeywords: string[];
  /** Common software/platforms/tools */
  commonTools: string[];
  /** Desired tone */
  tone: "Formal" | "Balanced" | "Warm" | "Premium" | "Aggressive";
  /** Minimum ATS score floor (0-100) */
  minATSScore: number;
}

export interface SkillMatchResult {
  skill: string;
  matched: boolean;
  confidence: number; // 0-1
  matchedAs?: string; // The canonical form it matched to
  category?: string;
}

export interface IndustrySearchResult {
  industry: IndustryProfile;
  confidence: number;
  matchedTerms: string[];
}

// ============================================================================
// Registry — all industry profiles
// ============================================================================

// ── Hospitality (Hotels, Resorts, F&B) ─────────────────────────────────────

const HOSPITALITY_SKILL_GRAPH: IndustrySkillNode[] = [
  {
    name: "Guest Services",
    category: "Core Operations",
    weight: 1.0,
    aliases: ["Guest Relations", "Guest Experience", "Guest Satisfaction", "Guest Care", "Guest Engagement", "Customer Service", "Client Relations"],
    roleRelevance: { entry: 0.8, senior: 0.9, manager: 1.0 },
    children: [
      { name: "VIP Services", category: "Guest Services", weight: 0.9, aliases: ["VIP Handling", "VIP Programs", "Executive Guest Services"], children: [], roleRelevance: {} },
      { name: "Concierge Services", category: "Guest Services", weight: 0.8, aliases: ["Concierge", "Guest Assistance", "Travel Desk"], children: [], roleRelevance: {} },
      { name: "Complaint Resolution", category: "Guest Services", weight: 0.9, aliases: ["Complaint Handling", "Service Recovery", "Issue Resolution", "Problem Resolution"], children: [], roleRelevance: {} },
      { name: "Guest Feedback Management", category: "Guest Services", weight: 0.7, aliases: ["Feedback Collection", "Guest Surveys", "NPS Management"], children: [], roleRelevance: {} },
      { name: "Check-in/Check-out", category: "Guest Services", weight: 0.7, aliases: ["Arrival/Departure", "Front Desk Operations", "Room Assignments"], children: [], roleRelevance: {} },
    ],
  },
  {
    name: "Front Office",
    category: "Operations",
    weight: 0.9,
    aliases: ["Front Desk", "Reception", "Front of House"],
    roleRelevance: { entry: 1.0, senior: 0.7, manager: 0.8 },
    children: [
      { name: "Reservation Management", category: "Front Office", weight: 0.8, aliases: ["Booking Management", "Room Reservations", "Inventory Management"], children: [], roleRelevance: {} },
      { name: "Communication", category: "Front Office", weight: 0.8, aliases: ["Telephone Etiquette", "Interdepartmental Communication", "Radio Communication"], children: [], roleRelevance: {} },
      { name: "Cash Handling", category: "Front Office", weight: 0.6, aliases: ["Cashiering", "Payment Processing", "Billing"], children: [], roleRelevance: {} },
    ],
  },
  {
    name: "Food & Beverage",
    category: "Operations",
    weight: 0.8,
    aliases: ["F&B", "Food and Beverage", "Culinary Operations", "Dining Services"],
    roleRelevance: { entry: 0.6, senior: 0.7, manager: 0.8 },
    children: [
      { name: "Fine Dining Service", category: "F&B", weight: 0.9, aliases: ["Fine Dining", "Fine Restaurant Service", "A La Carte Service"], children: [], roleRelevance: {} },
      { name: "Banquet Operations", category: "F&B", weight: 0.7, aliases: ["Banqueting", "Event Catering", "Function Service"], children: [], roleRelevance: {} },
      { name: "Wine Knowledge", category: "F&B", weight: 0.6, aliases: ["Wine Service", "Sommelier", "Beverage Knowledge"], children: [], roleRelevance: {} },
    ],
  },
  {
    name: "Property Management Systems",
    category: "Technical",
    weight: 0.8,
    aliases: ["PMS", "Hotel Software", "Property Management", "Opera PMS", "Opera", "Micros", "Symphony"],
    roleRelevance: { entry: 0.6, senior: 0.7, manager: 0.8 },
    children: [],
  },
  {
    name: "Housekeeping",
    category: "Operations",
    weight: 0.6,
    aliases: ["Housekeeping Management", "Laundry Services", "Room Cleaning", "Public Area Cleaning"],
    roleRelevance: { entry: 0.7, senior: 0.5, manager: 0.7 },
    children: [],
  },
  {
    name: "Luxury Standards",
    category: "Brand",
    weight: 0.9,
    aliases: ["Forbes Standards", "AAA Diamond", "Luxury Brand Standards", "Butler Service", "Butler Protocols"],
    roleRelevance: { entry: 0.5, senior: 0.9, manager: 0.8 },
    children: [],
  },
  {
    name: "Upselling",
    category: "Revenue",
    weight: 0.7,
    aliases: ["Cross Selling", "Selling", "Revenue Enhancement", "Room Upselling"],
    children: [],
    roleRelevance: {},
  },
];

// ── Airlines / Cabin Crew ──────────────────────────────────────────────────

const AIRLINE_SKILL_GRAPH: IndustrySkillNode[] = [
  {
    name: "Passenger Service",
    category: "Core Operations",
    weight: 1.0,
    aliases: ["Customer Service", "Passenger Assistance", "Guest Service", "Traveler Support", "Client Service", "Passenger Care", "Guest Care", "Client Assistance"],
    roleRelevance: { entry: 1.0, senior: 0.9, manager: 0.8 },
    children: [
      { name: "In-flight Service", category: "Passenger Service", weight: 0.9, aliases: ["Cabin Service", "Onboard Service", "In-flight Operations", "Meal Service", "Beverage Service"], children: [], roleRelevance: {} },
      { name: "Special Assistance", category: "Passenger Service", weight: 0.7, aliases: ["PRM Assistance", "UMNR Handling", "Unaccompanied Minor", "Special Needs"], children: [], roleRelevance: {} },
      { name: "Passenger Safety", category: "Passenger Service", weight: 1.0, aliases: ["Safety Procedures", "Cabin Safety", "Emergency Procedures", "Safety Demonstrations"], children: [], roleRelevance: { entry: 1.0, senior: 1.0, manager: 1.0 } },
      { name: "First Aid", category: "Passenger Service", weight: 0.8, aliases: ["CPR", "AED", "Medical Emergency", "Emergency First Aid"], children: [], roleRelevance: {} },
    ],
  },
  {
    name: "Safety & Emergency",
    category: "Compliance",
    weight: 1.0,
    aliases: ["Safety Compliance", "Aviation Safety", "Safety Management", "Safety Protocols"],
    roleRelevance: { entry: 1.0, senior: 1.0, manager: 1.0 },
    children: [
      { name: "SEP", category: "Safety", weight: 0.9, aliases: ["Safety & Emergency Procedures", "Safety Equipment", "Emergency Equipment"], children: [], roleRelevance: {} },
      { name: "CRM", category: "Safety", weight: 0.9, aliases: ["Crew Resource Management", "Crew Coordination", "Team Coordination"], children: [], roleRelevance: {} },
      { name: "Evacuation Procedures", category: "Safety", weight: 0.8, aliases: ["Emergency Evacuation", "Slide Evacuation", "Rapid Deplaning"], children: [], roleRelevance: {} },
      { name: "Fire Fighting", category: "Safety", weight: 0.7, aliases: ["Fire Prevention", "Fire Extinguisher", "Smoke Management"], children: [], roleRelevance: {} },
    ],
  },
  {
    name: "Cultural Awareness",
    category: "Soft Skills",
    weight: 0.9,
    aliases: ["Multicultural", "Cross-cultural", "Cultural Sensitivity", "Multicultural Awareness", "Cultural Competence"],
    roleRelevance: { entry: 0.8, senior: 0.9, manager: 0.9 },
    children: [],
  },
  {
    name: "Service Excellence",
    category: "Core Operations",
    weight: 0.9,
    aliases: ["Service Quality", "Premium Service", "Hospitality", "Exceptional Service"],
    roleRelevance: { entry: 0.9, senior: 1.0, manager: 0.9 },
    children: [],
  },
  {
    name: "Crew Coordination",
    category: "Operations",
    weight: 0.7,
    aliases: ["Crew Teamwork", "Team Coordination", "Crew Collaboration", "Intercrew Communication"],
    roleRelevance: { entry: 0.6, senior: 0.7, manager: 0.9 },
    children: [],
  },
  {
    name: "Aviation Systems",
    category: "Technical",
    weight: 0.6,
    aliases: ["Flight Systems", "Cabin Systems", "PA System", "Interphone"],
    roleRelevance: { entry: 0.5, senior: 0.6, manager: 0.5 },
    children: [],
  },
];

// ── Airport Operations (Ground) ────────────────────────────────────────────

const AIRPORT_SKILL_GRAPH: IndustrySkillNode[] = [
  {
    name: "Ground Operations",
    category: "Core Operations",
    weight: 1.0,
    aliases: ["Ground Handling", "Ramp Operations", "Ground Services", "Airport Ground Operations"],
    roleRelevance: { entry: 1.0, senior: 0.9, manager: 0.9 },
    children: [
      { name: "Check-in Operations", category: "Ground", weight: 0.8, aliases: ["Check-in", "Ticketing", "Check-in Process", "Online Check-in"], children: [], roleRelevance: {} },
      { name: "Boarding Processes", category: "Ground", weight: 0.8, aliases: ["Boarding", "Gate Operations", "Boarding Gates", "Priority Boarding"], children: [], roleRelevance: {} },
      { name: "Baggage Handling", category: "Ground", weight: 0.7, aliases: ["Baggage Services", "Baggage Claim", "Lost & Found", "Baggage Tracing"], children: [], roleRelevance: {} },
      { name: "Flight Irregularities", category: "Ground", weight: 0.7, aliases: ["Flight Disruption", "Delay Management", "Cancellation Handling", "Rebooking"], children: [], roleRelevance: {} },
    ],
  },
  {
    name: "Passenger Services",
    category: "Passenger",
    weight: 0.9,
    aliases: ["Passenger Assistance", "Passenger Handling", "Customer Service", "Passenger Care"],
    roleRelevance: { entry: 1.0, senior: 0.8, manager: 0.7 },
    children: [
      { name: "Special Assistance (PRM)", category: "Passenger", weight: 0.7, aliases: ["PRM", "Mobility Assistance", "Special Needs Passengers"], children: [], roleRelevance: {} },
      { name: "Lounge Services", category: "Passenger", weight: 0.5, aliases: ["Airport Lounge", "VIP Lounge", "Lounge Operations"], children: [], roleRelevance: {} },
    ],
  },
  {
    name: "Departure Control Systems",
    category: "Technical",
    weight: 0.8,
    aliases: ["DCS", "Departure Control", "Check-in Systems", "Amadeus", "Sabre", "Galileo", "Amadeus Altea"],
    roleRelevance: { entry: 0.7, senior: 0.8, manager: 0.6 },
    children: [],
  },
  {
    name: "Safety Compliance",
    category: "Compliance",
    weight: 0.9,
    aliases: ["Aviation Safety", "IATA Regulations", "ICAO Standards", "Safety Standards", "Ramp Safety"],
    roleRelevance: { entry: 0.7, senior: 0.8, manager: 1.0 },
    children: [],
  },
  {
    name: "Load Control",
    category: "Operations",
    weight: 0.6,
    aliases: ["Weight & Balance", "Load Sheet", "Aircraft Loading", "Load Planning"],
    roleRelevance: { entry: 0.3, senior: 0.6, manager: 0.7 },
    children: [],
  },
];

// ── Retail / Luxury Retail ─────────────────────────────────────────────────

const RETAIL_SKILL_GRAPH: IndustrySkillNode[] = [
  {
    name: "Sales",
    category: "Core",
    weight: 1.0,
    aliases: ["Selling", "Consultative Selling", "Retail Sales", "Point of Sale", "Sales Transactions"],
    roleRelevance: { entry: 1.0, senior: 0.9, manager: 0.7 },
    children: [
      { name: "Upselling", category: "Sales", weight: 0.7, aliases: ["Cross Selling", "Add-on Sales", "Product Upgrades"], children: [], roleRelevance: {} },
      { name: "Product Knowledge", category: "Sales", weight: 0.8, aliases: ["Product Expertise", "Merchandise Knowledge", "Brand Knowledge"], children: [], roleRelevance: {} },
    ],
  },
  {
    name: "Customer Service",
    category: "Core",
    weight: 1.0,
    aliases: ["Client Service", "Customer Care", "Guest Service", "Shopper Assistance", "Client Relations", "Customer Relations"],
    roleRelevance: { entry: 1.0, senior: 0.9, manager: 0.8 },
    children: [
      { name: "Complaint Resolution", category: "Customer Service", weight: 0.7, aliases: ["Complaint Handling", "Returns Processing", "Issue Resolution"], children: [], roleRelevance: {} },
      { name: "Clienteling", category: "Customer Service", weight: 0.8, aliases: ["Client Management", "Personal Shopping", "Client Book"], children: [], roleRelevance: {} },
    ],
  },
  {
    name: "Visual Merchandising",
    category: "Operations",
    weight: 0.7,
    aliases: ["Merchandising", "VM", "Display", "Product Presentation", "Window Displays"],
    roleRelevance: { entry: 0.5, senior: 0.7, manager: 0.8 },
    children: [],
  },
  {
    name: "Inventory Management",
    category: "Operations",
    weight: 0.7,
    aliases: ["Stock Management", "Stock Control", "Inventory Control", "Replenishment"],
    roleRelevance: { entry: 0.6, senior: 0.7, manager: 0.8 },
    children: [],
  },
  {
    name: "Luxury Brand Knowledge",
    category: "Premium",
    weight: 0.9,
    aliases: ["Luxury Retail", "Premium Brands", "Luxury Goods", "Designer Knowledge", "Fashion Brands"],
    roleRelevance: { entry: 0.6, senior: 0.9, manager: 0.8 },
    children: [],
  },
];

// ── Call Center / Customer Service ─────────────────────────────────────────

const CALL_CENTER_SKILL_GRAPH: IndustrySkillNode[] = [
  {
    name: "Call Handling",
    category: "Core",
    weight: 1.0,
    aliases: ["Inbound Calls", "Outbound Calls", "Phone Support", "Call Management", "Telephone Service"],
    roleRelevance: { entry: 1.0, senior: 0.9, manager: 0.6 },
    children: [
      { name: "High Volume Call Handling", category: "Call Handling", weight: 0.8, aliases: ["High Call Volume", "Heavy Call Load", "Multi-line Handling"], children: [], roleRelevance: {} },
      { name: "Call Scripting", category: "Call Handling", weight: 0.5, aliases: ["Script Adherence", "Call Flow", "Guided Script"], children: [], roleRelevance: {} },
    ],
  },
  {
    name: "Customer Service",
    category: "Core",
    weight: 1.0,
    aliases: ["Client Service", "Customer Support", "Help Desk", "Service Desk", "User Support", "Client Support"],
    roleRelevance: { entry: 1.0, senior: 0.9, manager: 0.8 },
    children: [
      { name: "Issue Resolution", category: "Customer Service", weight: 0.9, aliases: ["Problem Solving", "Ticket Resolution", "Case Resolution", "Complaint Resolution"], children: [], roleRelevance: {} },
      { name: "First Call Resolution", category: "Customer Service", weight: 0.8, aliases: ["FCR", "First Contact Resolution", "One-touch Resolution"], children: [], roleRelevance: {} },
    ],
  },
  {
    name: "CRM Systems",
    category: "Technical",
    weight: 0.8,
    aliases: ["Customer Relationship Management", "Salesforce", "Zendesk", "Freshdesk", "HubSpot", "ServiceNow"],
    roleRelevance: { entry: 0.6, senior: 0.8, manager: 0.7 },
    children: [],
  },
  {
    name: "Communication",
    category: "Soft Skills",
    weight: 0.9,
    aliases: ["Verbal Communication", "Written Communication", "Professional Communication", "Active Listening"],
    roleRelevance: { entry: 1.0, senior: 0.9, manager: 0.8 },
    children: [],
  },
  {
    name: "Conflict Resolution",
    category: "Soft Skills",
    weight: 0.8,
    aliases: ["De-escalation", "Difficult Customers", "Angry Callers", "Conflict Management"],
    roleRelevance: { entry: 0.8, senior: 0.9, manager: 0.9 },
    children: [],
  },
  {
    name: "Multitasking",
    category: "Soft Skills",
    weight: 0.7,
    aliases: ["Multi-tasking", "Simultaneous Systems", "Quick Switching"],
    roleRelevance: { entry: 0.9, senior: 0.7, manager: 0.5 },
    children: [],
  },
];

// ── IT / Software Engineering ──────────────────────────────────────────────

const IT_SKILL_GRAPH: IndustrySkillNode[] = [
  {
    name: "Software Engineering",
    category: "Core",
    weight: 1.0,
    aliases: ["Software Development", "Programming", "Application Development", "Software Design", "Coding", "Engineering"],
    roleRelevance: { entry: 1.0, senior: 1.0, manager: 0.8 },
    children: [
      { name: "Frontend Development", category: "Engineering", weight: 0.8, aliases: ["Frontend", "UI Development", "Client-side Development", "Web Development"], children: [], roleRelevance: {} },
      { name: "Backend Development", category: "Engineering", weight: 0.8, aliases: ["Backend", "Server-side Development", "API Development"], children: [], roleRelevance: {} },
      { name: "Full Stack Development", category: "Engineering", weight: 0.9, aliases: ["Full Stack", "End-to-end Development"], children: [], roleRelevance: {} },
      { name: "API Design", category: "Engineering", weight: 0.8, aliases: ["API Development", "REST API", "GraphQL", "API Architecture"], children: [], roleRelevance: {} },
    ],
  },
  {
    name: "System Design",
    category: "Architecture",
    weight: 0.9,
    aliases: ["Architecture", "Software Architecture", "Technical Architecture", "Solution Design"],
    roleRelevance: { entry: 0.4, senior: 1.0, manager: 0.9 },
    children: [
      { name: "Microservices", category: "Architecture", weight: 0.8, aliases: ["Microservices Architecture", "Service-oriented", "Distributed Systems"], children: [], roleRelevance: {} },
      { name: "Scalability", category: "Architecture", weight: 0.8, aliases: ["Scaling", "High Availability", "Performance Optimization"], children: [], roleRelevance: {} },
    ],
  },
  {
    name: "Cloud Computing",
    category: "Infrastructure",
    weight: 0.9,
    aliases: ["Cloud", "AWS", "Azure", "GCP", "Cloud Architecture", "Cloud Services"],
    roleRelevance: { entry: 0.5, senior: 0.9, manager: 0.8 },
    children: [
      { name: "Kubernetes", category: "Cloud", weight: 0.8, aliases: ["K8s", "Container Orchestration", "Container Management"], children: [], roleRelevance: {} },
      { name: "Docker", category: "Cloud", weight: 0.8, aliases: ["Containers", "Containerization"], children: [], roleRelevance: {} },
      { name: "Serverless", category: "Cloud", weight: 0.7, aliases: ["Lambda", "Functions", "FaaS"], children: [], roleRelevance: {} },
    ],
  },
  {
    name: "DevOps",
    category: "Infrastructure",
    weight: 0.8,
    aliases: ["DevOps Engineering", "Site Reliability", "SRE", "Platform Engineering"],
    roleRelevance: { entry: 0.5, senior: 0.9, manager: 0.7 },
    children: [
      { name: "CI/CD", category: "DevOps", weight: 0.9, aliases: ["Continuous Integration", "Continuous Deployment", "Pipeline Automation"], children: [], roleRelevance: {} },
      { name: "Infrastructure as Code", category: "DevOps", weight: 0.8, aliases: ["IaC", "Terraform", "CloudFormation", "Pulumi"], children: [], roleRelevance: {} },
      { name: "Monitoring", category: "DevOps", weight: 0.7, aliases: ["Observability", "Alerting", "Logging", "Metrics"], children: [], roleRelevance: {} },
    ],
  },
  {
    name: "Databases",
    category: "Data",
    weight: 0.7,
    aliases: ["Database Management", "SQL", "NoSQL", "Data Storage"],
    roleRelevance: { entry: 0.6, senior: 0.8, manager: 0.5 },
    children: [],
  },
  {
    name: "Agile Methodologies",
    category: "Process",
    weight: 0.7,
    aliases: ["Agile", "Scrum", "Kanban", "Sprint", "Agile Development"],
    roleRelevance: { entry: 0.6, senior: 0.7, manager: 0.9 },
    children: [],
  },
];

// ── Finance ────────────────────────────────────────────────────────────────

const FINANCE_SKILL_GRAPH: IndustrySkillNode[] = [
  {
    name: "Financial Analysis",
    category: "Core",
    weight: 1.0,
    aliases: ["Financial Modeling", "Financial Reporting", "Financial Planning", "FP&A", "Financial Forecasting"],
    roleRelevance: { entry: 0.8, senior: 1.0, manager: 1.0 },
    children: [
      { name: "Valuation", category: "Financial Analysis", weight: 0.8, aliases: ["DCF Valuation", "LBO Modeling", "Comparable Analysis", "Company Valuation"], children: [], roleRelevance: {} },
      { name: "Budgeting", category: "Financial Analysis", weight: 0.8, aliases: ["Budget Management", "Budget Planning", "Budgeting & Forecasting"], children: [], roleRelevance: {} },
      { name: "Variance Analysis", category: "Financial Analysis", weight: 0.7, aliases: ["Budget vs Actual", "Cost Variance", "Expense Analysis"], children: [], roleRelevance: {} },
    ],
  },
  {
    name: "Accounting",
    category: "Core",
    weight: 0.9,
    aliases: ["General Ledger", "Accounts Payable", "Accounts Receivable", "Bookkeeping", "Financial Accounting"],
    roleRelevance: { entry: 0.9, senior: 0.9, manager: 0.8 },
    children: [
      { name: "GAAP", category: "Accounting", weight: 0.7, aliases: ["US GAAP", "IFRS", "Accounting Standards", "Financial Reporting Standards"], children: [], roleRelevance: {} },
      { name: "SOX Compliance", category: "Accounting", weight: 0.7, aliases: ["Sarbanes-Oxley", "Internal Controls", "Compliance Controls"], children: [], roleRelevance: {} },
    ],
  },
  {
    name: "Risk Management",
    category: "Compliance",
    weight: 0.7,
    aliases: ["Risk Assessment", "Risk Analysis", "Financial Risk", "Credit Risk", "Operational Risk"],
    roleRelevance: { entry: 0.5, senior: 0.8, manager: 0.9 },
    children: [
      { name: "Compliance", category: "Risk", weight: 0.7, aliases: ["Regulatory Compliance", "AML", "KYC", "Anti-Money Laundering"], children: [], roleRelevance: {} },
    ],
  },
  {
    name: "Financial Systems",
    category: "Technical",
    weight: 0.7,
    aliases: ["Bloomberg Terminal", "SAP", "Oracle Financials", "QuickBooks", "FactSet", "Capital IQ"],
    roleRelevance: { entry: 0.5, senior: 0.7, manager: 0.6 },
    children: [],
  },
  {
    name: "Excel",
    category: "Technical",
    weight: 0.8,
    aliases: ["Advanced Excel", "VBA", "Excel Modeling", "Spreadsheets", "Pivot Tables"],
    roleRelevance: { entry: 0.9, senior: 0.9, manager: 0.7 },
    children: [],
  },
];

// ── Healthcare ─────────────────────────────────────────────────────────────

const HEALTHCARE_SKILL_GRAPH: IndustrySkillNode[] = [
  {
    name: "Patient Care",
    category: "Core",
    weight: 1.0,
    aliases: ["Clinical Care", "Patient Management", "Care Delivery", "Direct Patient Care", "Patient Support"],
    roleRelevance: { entry: 1.0, senior: 1.0, manager: 0.8 },
    children: [
      { name: "Clinical Assessment", category: "Patient Care", weight: 0.9, aliases: ["Patient Assessment", "Health Assessment", "Vital Signs", "Patient Evaluation"], children: [], roleRelevance: {} },
      { name: "Medication Administration", category: "Patient Care", weight: 0.8, aliases: ["Drug Administration", "Medication Management", "Pharmaceutical Care"], children: [], roleRelevance: {} },
      { name: "Wound Care", category: "Patient Care", weight: 0.6, aliases: ["Wound Management", "Dressing Changes", "Wound Assessment"], children: [], roleRelevance: {} },
    ],
  },
  {
    name: "Clinical Systems",
    category: "Technical",
    weight: 0.8,
    aliases: ["EHR", "EMR", "Electronic Health Records", "Epic", "Cerner", "Meditech"],
    roleRelevance: { entry: 0.6, senior: 0.8, manager: 0.7 },
    children: [],
  },
  {
    name: "HIPAA Compliance",
    category: "Compliance",
    weight: 0.9,
    aliases: ["HIPAA", "Patient Privacy", "Health Privacy", "Patient Confidentiality", "Data Protection"],
    roleRelevance: { entry: 0.8, senior: 0.9, manager: 1.0 },
    children: [],
  },
  {
    name: "Quality Improvement",
    category: "Operations",
    weight: 0.7,
    aliases: ["Quality Assurance", "Patient Safety", "Clinical Quality", "Healthcare Quality"],
    roleRelevance: { entry: 0.4, senior: 0.7, manager: 0.9 },
    children: [],
  },
  {
    name: "Medical Coding",
    category: "Technical",
    weight: 0.6,
    aliases: ["ICD-10", "CPT Coding", "Medical Billing", "Coding", "Clinical Coding"],
    roleRelevance: { entry: 0.6, senior: 0.7, manager: 0.5 },
    children: [],
  },
];

// ── Engineering / Construction ─────────────────────────────────────────────

const ENGINEERING_SKILL_GRAPH: IndustrySkillNode[] = [
  {
    name: "Engineering Design",
    category: "Core",
    weight: 1.0,
    aliases: ["Design Engineering", "Technical Design", "Detailed Design", "Engineering Drawings"],
    roleRelevance: { entry: 0.9, senior: 1.0, manager: 0.8 },
    children: [
      { name: "CAD", category: "Design", weight: 0.8, aliases: ["AutoCAD", "SolidWorks", "Revit", "3D Modeling", "Computer-aided Design"], children: [], roleRelevance: {} },
      { name: "Technical Drawings", category: "Design", weight: 0.7, aliases: ["Blueprints", "Schematics", "Plans & Specifications"], children: [], roleRelevance: {} },
    ],
  },
  {
    name: "Project Management",
    category: "Core",
    weight: 0.8,
    aliases: ["Project Planning", "Project Coordination", "Project Delivery", "Program Management"],
    roleRelevance: { entry: 0.4, senior: 0.8, manager: 1.0 },
    children: [
      { name: "Construction Management", category: "Project", weight: 0.8, aliases: ["Site Management", "Construction Supervision", "Project Supervision"], children: [], roleRelevance: {} },
      { name: "Budget Management", category: "Project", weight: 0.7, aliases: ["Cost Control", "Cost Management", "Project Budgeting"], children: [], roleRelevance: {} },
    ],
  },
  {
    name: "Safety Management",
    category: "Compliance",
    weight: 0.8,
    aliases: ["Health & Safety", "HSE", "Occupational Safety", "Safety Compliance", "Safety Protocols"],
    roleRelevance: { entry: 0.7, senior: 0.8, manager: 1.0 },
    children: [],
  },
  {
    name: "Quality Control",
    category: "Operations",
    weight: 0.7,
    aliases: ["QC", "Quality Assurance", "QA/QC", "Inspection", "Quality Management"],
    roleRelevance: { entry: 0.6, senior: 0.7, manager: 0.8 },
    children: [],
  },
];

// ── All industry synonyms (cross-industry semantic mapping) ────────────────

const GLOBAL_SYNONYMS: IndustrySynonymGroup[] = [
  { canonical: "Customer Service", aliases: ["Customer Service", "Client Service", "Guest Service", "Client Relations", "Customer Relations", "Customer Support", "Client Support", "Customer Care", "Client Care", "Service Excellence", "Service Delivery", "Service Quality"], category: "soft-skill" },
  { canonical: "Communication", aliases: ["Communication", "Verbal Communication", "Written Communication", "Professional Communication", "Business Communication", "Corporate Communication", "Interpersonal Communication"], category: "soft-skill" },
  { canonical: "Leadership", aliases: ["Leadership", "Team Leadership", "People Management", "Team Management", "Staff Management", "Personnel Management", "Team Lead", "Team Leader"], category: "soft-skill" },
  { canonical: "Problem Solving", aliases: ["Problem Solving", "Issue Resolution", "Problem Resolution", "Troubleshooting", "Analytical Problem Solving", "Critical Thinking"], category: "soft-skill" },
  { canonical: "Teamwork", aliases: ["Teamwork", "Collaboration", "Team Collaboration", "Cross-functional Collaboration", "Team Coordination", "Cooperative Work"], category: "soft-skill" },
  { canonical: "Project Management", aliases: ["Project Management", "Project Planning", "Project Coordination", "Project Delivery", "Program Management", "Project Administration"], category: "soft-skill" },
  { canonical: "Time Management", aliases: ["Time Management", "Prioritization", "Deadline Management", "Scheduling", "Task Management", "Organizational Skills"], category: "soft-skill" },
  { canonical: "Negotiation", aliases: ["Negotiation", "Contract Negotiation", "Business Negotiation", "Vendor Negotiation", "Client Negotiation", "Price Negotiation", "Deal Negotiation"], category: "soft-skill" },
  { canonical: "Data Analysis", aliases: ["Data Analysis", "Data Analytics", "Analytics", "Data Interpretation", "Data-driven", "Data Mining", "Business Intelligence", "BI", "Data Visualization"], category: "technical" },
  { canonical: "Sales", aliases: ["Sales", "Business Development", "Account Management", "Revenue Generation", "Business Growth", "Client Acquisition", "New Business", "B2B Sales", "B2C Sales"], category: "commercial" },
  { canonical: "Operations Management", aliases: ["Operations", "Operations Management", "Operational Management", "Business Operations", "General Operations", "Operational Excellence"], category: "management" },
  { canonical: "Training", aliases: ["Training", "Employee Training", "Staff Training", "Training & Development", "L&D", "Learning & Development", "Onboarding", "Training Delivery"], category: "hr" },
  { canonical: "Compliance", aliases: ["Compliance", "Regulatory Compliance", "Regulatory Affairs", "Compliance Management", "Policy Compliance"], category: "compliance" },
  { canonical: "Strategy", aliases: ["Strategy", "Strategic Planning", "Business Strategy", "Strategic Management", "Corporate Strategy", "Strategic Development"], category: "management" },
  { canonical: "Process Improvement", aliases: ["Process Improvement", "Process Optimization", "Continuous Improvement", "Lean", "Six Sigma", "Kaizen", "Business Process Improvement"], category: "operations" },
  { canonical: "Reporting", aliases: ["Reporting", "Report Generation", "Management Reporting", "Performance Reporting", "KPI Reporting", "Dashboards"], category: "technical" },
  { canonical: "Conflict Resolution", aliases: ["Conflict Resolution", "De-escalation", "Conflict Management", "Mediation", "Difficult Conversations", "Dispute Resolution"], category: "soft-skill" },
  { canonical: "Presentation", aliases: ["Presentation", "Public Speaking", "Presentations", "Client Presentations", "Pitching", "Pitch Deck", "Presentation Skills"], category: "soft-skill" },
  { canonical: "Research", aliases: ["Research", "Research & Development", "R&D", "Market Research", "Technical Research", "Analysis", "Investigation"], category: "technical" },
  { canonical: "Written Communication", aliases: ["Written Communication", "Report Writing", "Business Writing", "Technical Writing", "Documentation", "Content Writing", "Copywriting"], category: "soft-skill" },
];

// ============================================================================
// Industry Profile Registry
// ============================================================================

const INDUSTRY_PROFILES: Record<string, IndustryProfile> = {
  airlines: {
    id: "airlines",
    label: "Airlines (Cabin Crew)",
    description: "Cabin crew, flight attendant, airline cabin operations, in-flight service",
    skillGraph: AIRLINE_SKILL_GRAPH,
    competencies: [
      { name: "Safety & Emergency", description: "SEP, CRM, evacuation, first aid, fire fighting", skills: ["Passenger Safety", "SEP", "CRM", "Evacuation Procedures", "First Aid", "Fire Fighting"], importance: "core" },
      { name: "Passenger Service", description: "In-flight service, special assistance, cultural awareness", skills: ["Passenger Service", "In-flight Service", "Special Assistance", "Cultural Awareness"], importance: "core" },
      { name: "Service Excellence", description: "Premium service, hospitality, guest relations", skills: ["Service Excellence", "Passenger Service", "Crew Coordination"], importance: "core" },
    ],
    synonyms: [
      { canonical: "Passenger Assistance", aliases: ["Passenger Assistance", "Guest Assistance", "Passenger Support", "Traveler Assistance", "Customer Assistance"], category: "service" },
      { canonical: "Safety Procedures", aliases: ["Safety Procedures", "Emergency Procedures", "Safety Protocols", "Safety Drills", "Safety Demonstrations"], category: "safety" },
    ],
    priorityKeywords: ["Safety", "Cabin Crew", "Passenger Service", "SEP", "CRM", "First Aid", "Cultural Awareness", "Multicultural", "Service Excellence", "In-flight Service"],
    commonTools: ["Cabin Systems", "PA System", "DCS", "Sabre", "Amadeus"],
    tone: "Premium",
    minATSScore: 65,
  },
  "airport-operations": {
    id: "airport-operations",
    label: "Airport Operations (Ground)",
    description: "Ground operations, check-in, boarding, ramp, passenger services at airports",
    skillGraph: AIRPORT_SKILL_GRAPH,
    competencies: [
      { name: "Ground Operations", description: "Check-in, boarding, baggage, ramp", skills: ["Ground Operations", "Check-in Operations", "Boarding Processes", "Baggage Handling", "Load Control"], importance: "core" },
      { name: "Passenger Services", description: "PRM, lounge, flight irregularities", skills: ["Passenger Services", "Special Assistance (PRM)", "Flight Irregularities", "Lounge Services"], importance: "core" },
      { name: "Technical Systems", description: "DCS, Amadeus, Sabre", skills: ["Departure Control Systems"], importance: "core" },
    ],
    synonyms: [
      { canonical: "Ground Handling", aliases: ["Ground Handling", "Ground Operations", "Ramp Services", "Airport Ground Services"], category: "operations" },
    ],
    priorityKeywords: ["Ground Operations", "Check-in", "Boarding", "Baggage Handling", "Passenger Services", "DCS", "Amadeus", "Sabre", "Safety Compliance", "Ramp Safety"],
    commonTools: ["Amadeus", "Sabre", "Galileo", "DCS", "BRS"],
    tone: "Balanced",
    minATSScore: 60,
  },
  hospitality: {
    id: "hospitality",
    label: "Hospitality (Hotels & Resorts)",
    description: "Hotels, resorts, front office, guest services, F&B, concierge",
    skillGraph: HOSPITALITY_SKILL_GRAPH,
    competencies: [
      { name: "Guest Services", description: "Check-in, concierge, VIP, complaint resolution", skills: ["Guest Services", "VIP Services", "Concierge Services", "Complaint Resolution", "Guest Feedback Management", "Check-in/Check-out"], importance: "core" },
      { name: "Operations", description: "Front office, housekeeping, F&B", skills: ["Front Office", "Food & Beverage", "Housekeeping", "Property Management Systems"], importance: "core" },
      { name: "Luxury Standards", description: "Forbes, AAA, butler service", skills: ["Luxury Standards", "Upselling"], importance: "preferred" },
    ],
    synonyms: [
      { canonical: "Hotel Operations", aliases: ["Hotel Operations", "Resort Operations", "Lodging Operations", "Accommodation Operations"], category: "operations" },
    ],
    priorityKeywords: ["Guest Services", "Front Office", "Concierge", "Fine Dining", "Opera PMS", "VIP Services", "Guest Satisfaction", "Luxury", "Forbes Standards", "Upselling"],
    commonTools: ["Opera PMS", "Micros", "Symphony", "Fidelio", "HotSOS"],
    tone: "Premium",
    minATSScore: 65,
  },
  retail: {
    id: "retail",
    label: "Retail",
    description: "Retail sales, visual merchandising, inventory, luxury retail",
    skillGraph: RETAIL_SKILL_GRAPH,
    competencies: [
      { name: "Sales", description: "Selling, upselling, product knowledge", skills: ["Sales", "Upselling", "Product Knowledge"], importance: "core" },
      { name: "Customer Service", description: "Clienteling, complaint resolution", skills: ["Customer Service", "Clienteling", "Complaint Resolution"], importance: "core" },
      { name: "Operations", description: "Merchandising, inventory", skills: ["Visual Merchandising", "Inventory Management"], importance: "preferred" },
    ],
    synonyms: [],
    priorityKeywords: ["Sales", "Customer Service", "Visual Merchandising", "Inventory Management", "Upselling", "Clienteling", "Product Knowledge", "Luxury Retail"],
    commonTools: ["POS Systems", "Salesforce", "ERP"],
    tone: "Balanced",
    minATSScore: 60,
  },
  "customer-service": {
    id: "customer-service",
    label: "Customer Service / Call Center",
    description: "Call center, help desk, customer support, contact center",
    skillGraph: CALL_CENTER_SKILL_GRAPH,
    competencies: [
      { name: "Call Handling", description: "Inbound/outbound, high volume, scripting", skills: ["Call Handling", "High Volume Call Handling", "Communication"], importance: "core" },
      { name: "Customer Service", description: "Issue resolution, FCR, CRM", skills: ["Customer Service", "Issue Resolution", "First Call Resolution", "CRM Systems"], importance: "core" },
      { name: "Soft Skills", description: "Conflict resolution, multitasking", skills: ["Communication", "Conflict Resolution", "Multitasking"], importance: "core" },
    ],
    synonyms: [],
    priorityKeywords: ["Customer Service", "Call Handling", "Issue Resolution", "FCR", "CRM", "Communication", "Conflict Resolution", "Multitasking", "Zendesk", "Salesforce"],
    commonTools: ["Zendesk", "Freshdesk", "Salesforce", "ServiceNow", "HubSpot", "Avaya"],
    tone: "Balanced",
    minATSScore: 60,
  },
  technology: {
    id: "technology",
    label: "Technology / IT",
    description: "Software engineering, DevOps, data science, cybersecurity, cloud",
    skillGraph: IT_SKILL_GRAPH,
    competencies: [
      { name: "Software Engineering", description: "Full-stack, frontend, backend, API design", skills: ["Software Engineering", "Frontend Development", "Backend Development", "Full Stack Development", "API Design", "System Design"], importance: "core" },
      { name: "Cloud & DevOps", description: "Kubernetes, Docker, CI/CD, IaC", skills: ["Cloud Computing", "DevOps", "Kubernetes", "Docker", "CI/CD", "Infrastructure as Code"], importance: "core" },
      { name: "Process", description: "Agile, Scrum, databases", skills: ["Databases", "Agile Methodologies", "System Design"], importance: "preferred" },
    ],
    synonyms: [],
    priorityKeywords: ["Software Engineering", "System Design", "Cloud", "AWS", "Azure", "API", "Microservices", "CI/CD", "Kubernetes", "Docker", "Agile", "DevOps"],
    commonTools: ["AWS", "Azure", "GCP", "Kubernetes", "Docker", "Terraform", "Git", "Jira", "Confluence"],
    tone: "Balanced",
    minATSScore: 60,
  },
  finance: {
    id: "finance",
    label: "Finance",
    description: "Financial analysis, accounting, investment banking, FP&A",
    skillGraph: FINANCE_SKILL_GRAPH,
    competencies: [
      { name: "Financial Analysis", description: "Modeling, valuation, budgeting, forecasting", skills: ["Financial Analysis", "Valuation", "Budgeting", "Variance Analysis"], importance: "core" },
      { name: "Accounting", description: "GAAP, SOX, reporting", skills: ["Accounting", "GAAP", "SOX Compliance"], importance: "core" },
      { name: "Risk & Compliance", description: "Risk management, AML/KYC", skills: ["Risk Management", "Compliance"], importance: "preferred" },
    ],
    synonyms: [],
    priorityKeywords: ["Financial Analysis", "Financial Modeling", "Accounting", "GAAP", "IFRS", "Budgeting", "Forecasting", "Variance Analysis", "Risk Management", "Compliance", "SOX"],
    commonTools: ["Bloomberg Terminal", "FactSet", "Capital IQ", "QuickBooks", "SAP", "Oracle Financials", "Excel"],
    tone: "Formal",
    minATSScore: 65,
  },
  healthcare: {
    id: "healthcare",
    label: "Healthcare",
    description: "Clinical, nursing, healthcare administration, medical",
    skillGraph: HEALTHCARE_SKILL_GRAPH,
    competencies: [
      { name: "Patient Care", description: "Assessment, medication, wound care", skills: ["Patient Care", "Clinical Assessment", "Medication Administration", "Wound Care"], importance: "core" },
      { name: "Compliance & Quality", description: "HIPAA, EHR, quality improvement", skills: ["HIPAA Compliance", "Clinical Systems", "Quality Improvement"], importance: "core" },
      { name: "Administration", description: "Medical coding, billing", skills: ["Medical Coding"], importance: "preferred" },
    ],
    synonyms: [],
    priorityKeywords: ["Patient Care", "Clinical", "HIPAA", "EHR", "Epic", "Cerner", "Patient Safety", "Quality Improvement", "Medical Coding", "BLS", "ACLS"],
    commonTools: ["Epic", "Cerner", "Meditech", "EClinicalWorks", "Allscripts"],
    tone: "Formal",
    minATSScore: 65,
  },
  "engineering-construction": {
    id: "engineering-construction",
    label: "Engineering & Construction",
    description: "Civil, mechanical, electrical engineering, construction management",
    skillGraph: ENGINEERING_SKILL_GRAPH,
    competencies: [
      { name: "Design", description: "CAD, technical drawings, design engineering", skills: ["Engineering Design", "CAD", "Technical Drawings"], importance: "core" },
      { name: "Project Management", description: "Construction management, budget, timeline", skills: ["Project Management", "Construction Management", "Budget Management"], importance: "core" },
      { name: "Safety & Quality", description: "HSE, QC, inspections", skills: ["Safety Management", "Quality Control"], importance: "core" },
    ],
    synonyms: [],
    priorityKeywords: ["Engineering Design", "Project Management", "Construction Management", "CAD", "AutoCAD", "Revit", "HSE", "Quality Control", "Safety Management"],
    commonTools: ["AutoCAD", "Revit", "SolidWorks", "Primavera", "MS Project", "SAP"],
    tone: "Formal",
    minATSScore: 60,
  },
  education: {
    id: "education",
    label: "Education",
    description: "Teaching, academic administration, curriculum development, training",
    skillGraph: [
      {
        name: "Teaching",
        category: "Core",
        weight: 1.0,
        aliases: ["Instruction", "Classroom Teaching", "Lecturing", "Teaching Delivery", "Lesson Delivery"],
        roleRelevance: { entry: 1.0, senior: 0.9, manager: 0.7 },
        children: [
          { name: "Curriculum Development", category: "Teaching", weight: 0.8, aliases: ["Curriculum Design", "Lesson Planning", "Course Development", "Syllabus Design"], children: [], roleRelevance: {} },
          { name: "Student Assessment", category: "Teaching", weight: 0.7, aliases: ["Assessment", "Grading", "Evaluation", "Student Evaluation"], children: [], roleRelevance: {} },
          { name: "Classroom Management", category: "Teaching", weight: 0.8, aliases: ["Classroom Discipline", "Behavior Management", "Group Management"], children: [], roleRelevance: {} },
        ],
      },
      {
        name: "Academic Administration",
        category: "Administration",
        weight: 0.8,
        aliases: ["Educational Administration", "School Administration", "Academic Coordination", "Academic Affairs"],
        roleRelevance: { entry: 0.3, senior: 0.7, manager: 1.0 },
        children: [
          { name: "Accreditation", category: "Administration", weight: 0.7, aliases: ["Program Accreditation", "Quality Assurance", "Institutional Accreditation"], children: [], roleRelevance: {} },
          { name: "Student Services", category: "Administration", weight: 0.6, aliases: ["Student Support", "Student Counseling", "Student Affairs"], children: [], roleRelevance: {} },
        ],
      },
      {
        name: "E-Learning",
        category: "Technical",
        weight: 0.7,
        aliases: ["Online Learning", "Distance Education", "Virtual Classroom", "LMS", "Learning Management System", "Moodle", "Blackboard", "Canvas"],
        roleRelevance: { entry: 0.5, senior: 0.7, manager: 0.6 },
        children: [],
      },
    ],
    competencies: [
      { name: "Teaching", description: "Instruction, curriculum, assessment", skills: ["Teaching", "Curriculum Development", "Student Assessment", "Classroom Management"], importance: "core" },
      { name: "Administration", description: "Academic coordination, accreditation", skills: ["Academic Administration", "Accreditation", "Student Services"], importance: "preferred" },
    ],
    synonyms: [],
    priorityKeywords: ["Teaching", "Education", "Curriculum Development", "Classroom Management", "Student Assessment", "E-Learning", "LMS", "Accreditation"],
    commonTools: ["Moodle", "Blackboard", "Canvas", "Google Classroom", "Zoom"],
    tone: "Formal",
    minATSScore: 60,
  },
  government: {
    id: "government",
    label: "Government & Public Sector",
    description: "Public administration, policy, civil service, regulatory affairs",
    skillGraph: [
      {
        name: "Public Administration",
        category: "Core",
        weight: 1.0,
        aliases: ["Government Administration", "Civil Service", "Public Sector", "Administrative Services"],
        roleRelevance: { entry: 0.8, senior: 0.9, manager: 1.0 },
        children: [
          { name: "Policy Development", category: "Administration", weight: 0.8, aliases: ["Policy Analysis", "Policy Making", "Policy Research"], children: [], roleRelevance: {} },
          { name: "Regulatory Compliance", category: "Administration", weight: 0.8, aliases: ["Compliance", "Regulatory Affairs", "Government Regulations"], children: [], roleRelevance: {} },
          { name: "Stakeholder Engagement", category: "Administration", weight: 0.7, aliases: ["Stakeholder Management", "Community Engagement", "Public Consultation"], children: [], roleRelevance: {} },
        ],
      },
      {
        name: "Public Service",
        category: "Service",
        weight: 0.9,
        aliases: ["Citizen Services", "Public Facing Services", "Community Service", "Customer Service"],
        roleRelevance: { entry: 1.0, senior: 0.8, manager: 0.7 },
        children: [
          { name: "Program Management", category: "Service", weight: 0.7, aliases: ["Program Administration", "Project Management", "Grant Management"], children: [], roleRelevance: {} },
          { name: "Budget Management", category: "Service", weight: 0.7, aliases: ["Public Budgeting", "Fiscal Management", "Government Budgeting"], children: [], roleRelevance: {} },
        ],
      },
    ],
    competencies: [
      { name: "Public Administration", description: "Policy, compliance, stakeholder management", skills: ["Public Administration", "Policy Development", "Regulatory Compliance", "Stakeholder Engagement"], importance: "core" },
      { name: "Public Service", description: "Citizen services, program management", skills: ["Public Service", "Program Management", "Budget Management"], importance: "core" },
    ],
    synonyms: [],
    priorityKeywords: ["Public Administration", "Policy", "Regulatory Compliance", "Government", "Civil Service", "Stakeholder Engagement", "Program Management", "Citizen Services"],
    commonTools: ["SAP", "Oracle", "SharePoint", "Microsoft Office"],
    tone: "Formal",
    minATSScore: 65,
  },
  "logistics-supply-chain": {
    id: "logistics-supply-chain",
    label: "Logistics & Supply Chain",
    description: "Supply chain management, logistics, warehousing, procurement, transportation",
    skillGraph: [
      {
        name: "Supply Chain Management",
        category: "Core",
        weight: 1.0,
        aliases: ["SCM", "Supply Chain", "Supply Chain Operations", "End-to-end Supply Chain"],
        roleRelevance: { entry: 0.7, senior: 1.0, manager: 1.0 },
        children: [
          { name: "Inventory Management", category: "SCM", weight: 0.9, aliases: ["Stock Management", "Inventory Control", "Stock Control", "Warehouse Inventory"], children: [], roleRelevance: {} },
          { name: "Procurement", category: "SCM", weight: 0.8, aliases: ["Purchasing", "Sourcing", "Vendor Management", "Supplier Management", "Strategic Sourcing"], children: [], roleRelevance: {} },
          { name: "Logistics Planning", category: "SCM", weight: 0.8, aliases: ["Logistics", "Transportation Management", "Route Planning", "Fleet Management"], children: [], roleRelevance: {} },
        ],
      },
      {
        name: "Warehousing",
        category: "Operations",
        weight: 0.8,
        aliases: ["Warehouse Operations", "Warehouse Management", "Distribution Center", "DC Operations"],
        roleRelevance: { entry: 0.9, senior: 0.8, manager: 0.8 },
        children: [
          { name: "WMS", category: "Warehousing", weight: 0.7, aliases: ["Warehouse Management System", "SAP EWM", "Manhattan Associates", "Blue Yonder"], children: [], roleRelevance: {} },
          { name: "Shipping & Receiving", category: "Warehousing", weight: 0.6, aliases: ["Inbound/Outbound", "Loading/Unloading", "Dock Operations"], children: [], roleRelevance: {} },
        ],
      },
      {
        name: "Demand Planning",
        category: "Planning",
        weight: 0.7,
        aliases: ["Forecasting", "Demand Forecasting", "Demand Management", "Supply Planning"],
        roleRelevance: { entry: 0.4, senior: 0.8, manager: 0.9 },
        children: [],
      },
    ],
    competencies: [
      { name: "Supply Chain", description: "SCM, inventory, procurement, logistics", skills: ["Supply Chain Management", "Inventory Management", "Procurement", "Logistics Planning", "Demand Planning"], importance: "core" },
      { name: "Operations", description: "Warehousing, WMS, shipping", skills: ["Warehousing", "WMS", "Shipping & Receiving"], importance: "core" },
    ],
    synonyms: [],
    priorityKeywords: ["Supply Chain", "Logistics", "Inventory Management", "Procurement", "Warehousing", "WMS", "Demand Planning", "Transportation", "Sourcing", "Vendor Management"],
    commonTools: ["SAP SCM", "Oracle SCM", "Manhattan Associates", "Blue Yonder", "Kinaxis"],
    tone: "Balanced",
    minATSScore: 60,
  },
};

// ── Generic (fallback when no industry matches) ────────────────────────────

const GENERIC_PROFILE: IndustryProfile = {
  id: "generic",
  label: "General",
  description: "General-purpose ATS optimization without industry-specific knowledge",
  skillGraph: [],
  competencies: [],
  synonyms: GLOBAL_SYNONYMS,
  priorityKeywords: ["Leadership", "Communication", "Teamwork", "Problem Solving", "Project Management"],
  commonTools: [],
  tone: "Balanced",
  minATSScore: 50,
};

// ============================================================================
// Engine Functions
// ============================================================================

/**
 * Detect the most likely industry from a job description or resume text.
 */
export function detectIndustry(
  texts: string[],
): IndustrySearchResult {
  const text = texts.join(" ").toLowerCase();
  const scores: { id: string; score: number; matchedTerms: string[] }[] = [];

  for (const profile of Object.values(INDUSTRY_PROFILES)) {
    let score = 0;
    const matchedTerms: string[] = [];

    // Check priority keywords
    for (const kw of profile.priorityKeywords) {
      if (text.includes(kw.toLowerCase())) {
        score += 3;
        matchedTerms.push(kw);
      }
    }

    // Check skill graph terms (2 levels)
    for (const node of profile.skillGraph) {
      for (const alias of [node.name, ...node.aliases]) {
        if (text.includes(alias.toLowerCase())) {
          score += 2;
          if (!matchedTerms.includes(node.name)) matchedTerms.push(node.name);
          break;
        }
      }
      for (const child of node.children) {
        for (const alias of [child.name, ...child.aliases]) {
          if (text.includes(alias.toLowerCase())) {
            score += 1;
            break;
          }
        }
      }
    }

    // Check description terms
    const descTerms = profile.description.toLowerCase().split(", ");
    for (const term of descTerms) {
      if (text.includes(term)) {
        score += 1;
      }
    }

    if (score > 0) {
      scores.push({ id: profile.id, score, matchedTerms });
    }
  }

  if (scores.length === 0) {
    return { industry: GENERIC_PROFILE, confidence: 0, matchedTerms: [] };
  }

  // Sort by score descending
  scores.sort((a, b) => b.score - a.score);
  const top = scores[0];
  const profile = INDUSTRY_PROFILES[top.id] || GENERIC_PROFILE;

  // Normalize confidence to 0-1 range
  const maxPossible = 50; // heuristic max
  const confidence = Math.min(top.score / maxPossible, 1);

  return { industry: profile, confidence, matchedTerms: top.matchedTerms };
}

/**
 * Get a specific industry profile by ID.
 */
export function getIndustryProfile(industryId: string): IndustryProfile {
  return INDUSTRY_PROFILES[industryId] || GENERIC_PROFILE;
}

/**
 * Get the skill graph for a specific industry.
 */
export function getSkillGraph(industryId: string): IndustrySkillNode[] {
  const profile = INDUSTRY_PROFILES[industryId] || GENERIC_PROFILE;
  return profile.skillGraph;
}

/**
 * Get all synonym groups relevant to an industry (global + industry-specific).
 */
export function getSynonyms(industryId?: string): IndustrySynonymGroup[] {
  const syns = [...GLOBAL_SYNONYMS];
  if (industryId) {
    const profile = INDUSTRY_PROFILES[industryId];
    if (profile) {
      syns.push(...profile.synonyms);
    }
  }
  return syns;
}

/**
 * Get all registered industry IDs.
 */
export function getAllIndustryIds(): string[] {
  return Object.keys(INDUSTRY_PROFILES);
}

/**
 * Build a flat list of all skill names (canonical + aliases) for an industry.
 */
export function getAllSkillNames(industryId: string): string[] {
  const profile = INDUSTRY_PROFILES[industryId];
  if (!profile) return [];
  const names: string[] = [];
  function collect(nodes: IndustrySkillNode[]) {
    for (const node of nodes) {
      names.push(node.name);
      names.push(...node.aliases);
      collect(node.children);
    }
  }
  collect(profile.skillGraph);
  return Array.from(new Set(names));
}

/**
 * Resolve a skill term to its canonical form (returns null if no match).
 */
export function resolveToCanonical(
  term: string,
  industryId?: string,
): { canonical: string; category?: string } | null {
  const termLower = term.toLowerCase().trim();

  // Check global synonyms first
  for (const group of GLOBAL_SYNONYMS) {
    if (group.canonical.toLowerCase() === termLower) return { canonical: group.canonical, category: group.category };
    for (const alias of group.aliases) {
      if (alias.toLowerCase() === termLower) return { canonical: group.canonical, category: group.category };
    }
  }

  // Check industry-specific synonyms
  if (industryId) {
    const profile = INDUSTRY_PROFILES[industryId];
    if (profile) {
      for (const group of profile.synonyms) {
        if (group.canonical.toLowerCase() === termLower) return { canonical: group.canonical, category: group.category };
        for (const alias of group.aliases) {
          if (alias.toLowerCase() === termLower) return { canonical: group.canonical, category: group.category };
        }
      }
    }
  }

  // Check skill graph names
  const checkNodes = (nodes: IndustrySkillNode[]): { canonical: string; category?: string } | null => {
    for (const node of nodes) {
      if (node.name.toLowerCase() === termLower) return { canonical: node.name, category: node.category };
      for (const alias of node.aliases) {
        if (alias.toLowerCase() === termLower) return { canonical: node.name, category: node.category };
      }
      const found = checkNodes(node.children);
      if (found) return found;
    }
    return null;
  };

  if (industryId) {
    const profile = INDUSTRY_PROFILES[industryId];
    if (profile) {
      const found = checkNodes(profile.skillGraph);
      if (found) return found;
    }
  }

  // Check all profiles' skill graphs as last resort
  for (const profile of Object.values(INDUSTRY_PROFILES)) {
    const found = checkNodes(profile.skillGraph);
    if (found) return found;
  }

  return null;
}

/**
 * Find matching skills in a resume text against the skill graph.
 */
export function findMatchingSkills(
  resumeSkills: string[],
  industryId: string,
): SkillMatchResult[] {
  const profile = INDUSTRY_PROFILES[industryId];
  if (!profile) return [];

  const results: SkillMatchResult[] = [];

  for (const skill of resumeSkills) {
    const canonical = resolveToCanonical(skill, industryId);
    if (canonical) {
      results.push({
        skill,
        matched: true,
        confidence: 1.0,
        matchedAs: canonical.canonical,
        category: canonical.category,
      });
    } else {
      // Check for partial matches in skill graph
      let bestMatch: { canonical: string; category?: string } | null = null;
      let bestScore = 0;

      const checkNodes = (nodes: IndustrySkillNode[]) => {
        for (const node of nodes) {
          const sim = similarity(skill, node.name);
          if (sim > bestScore) {
            bestScore = sim;
            bestMatch = { canonical: node.name, category: node.category };
          }
          for (const alias of node.aliases) {
            const simAlias = similarity(skill, alias);
            if (simAlias > bestScore) {
              bestScore = simAlias;
              bestMatch = { canonical: node.name, category: node.category };
            }
          }
          checkNodes(node.children);
        }
      };
      checkNodes(profile.skillGraph);

      if (bestMatch && bestScore > 0.6) {
        results.push({
          skill,
          matched: false,
          confidence: bestScore,
          matchedAs: bestMatch.canonical,
          category: bestMatch.category,
        });
      } else {
        results.push({
          skill,
          matched: false,
          confidence: 0,
        });
      }
    }
  }

  return results;
}

/**
 * Compute missing skills: skills required by the industry but not in the resume.
 */
export function findMissingSkills(
  resumeSkills: string[],
  industryId: string,
  threshold = 0.8,
): { skill: string; category: string; weight: number; variants: string[] }[] {
  const profile = INDUSTRY_PROFILES[industryId];
  if (!profile) return [];

  const allResolved = new Set(
    resumeSkills
      .map((s) => {
        const r = resolveToCanonical(s, industryId);
        return r?.canonical.toLowerCase();
      })
      .filter(Boolean) as string[],
  );

  const missing: { skill: string; category: string; weight: number; variants: string[] }[] = [];

  // Check top-level nodes in skill graph
  for (const node of profile.skillGraph) {
    const nodeNameLower = node.name.toLowerCase();
    if (
      node.weight >= threshold &&
      !allResolved.has(nodeNameLower) &&
      !resumeSkills.some((s) => s.toLowerCase().includes(nodeNameLower))
    ) {
      missing.push({
        skill: node.name,
        category: node.category,
        weight: node.weight,
        variants: node.aliases.slice(0, 3),
      });
    }
  }

  return missing;
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Simple string similarity (0-1) using bigram overlap.
 */
export function similarity(a: string, b: string): number {
  const aLower = a.toLowerCase().trim();
  const bLower = b.toLowerCase().trim();
  if (aLower === bLower) return 1;

  const bigrams = (s: string): Set<string> => {
    const set = new Set<string>();
    for (let i = 0; i < s.length - 1; i++) {
      set.add(s.slice(i, i + 2));
    }
    return set;
  };

  const aBigrams = bigrams(aLower);
  const bBigrams = bigrams(bLower);

  if (aBigrams.size === 0 || bBigrams.size === 0) return 0;

  let intersection = 0;
  aBigrams.forEach((bg) => {
    if (bBigrams.has(bg)) intersection++;
  });

  return (2 * intersection) / (aBigrams.size + bBigrams.size);
}

export default {
  detectIndustry,
  getIndustryProfile,
  getSkillGraph,
  getSynonyms,
  getAllIndustryIds,
  getAllSkillNames,
  resolveToCanonical,
  findMatchingSkills,
  findMissingSkills,
  similarity,
};
