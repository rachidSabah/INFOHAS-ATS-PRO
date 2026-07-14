// ============================================================================
// Interview Personas — multi-persona interviewer simulation (Part 1 of 8.1.1).
//
// Pure data + context builders. Reused by src/lib/interview/ai.ts so the
// question generator can simulate different interviewers (HR, Cabin Crew
// Manager, Chief Purser, Safety Trainer, etc.). No AI logic here — just the
// descriptive scaffolding the generator turns into a system prompt.
//
// EXTENSIBILITY: every persona declares its own role competencies and
// behavioural competencies, plus a question-generation profile. No company
// names or hard-coded company logic live here — company knowledge is supplied
// separately (see CompanyProfile in ai.ts) so the same personas work for any
// company.
// ============================================================================

export interface InterviewPersona {
  id: string;
  /** Display name shown in the UI. */
  name: string;
  /** Role the persona plays in the interview. */
  role: string;
  /** Short label for chips/badges. */
  shortLabel: string;
  icon: string;
  accent: string;
  /** What this interviewer cares about — biases the questions. */
  focusAreas: string[];
  /** Tone/style instructions fed to the generator. */
  styleGuidance: string;
  /** Example question angles this persona favors. */
  questionAngles: string[];
  /** Whether this persona is aviation/role-specific. */
  category: "general" | "aviation" | "corporate";
  /** Role-specific competencies this persona probes (aviation/role-aligned). */
  roleCompetencies: string[];
  /** Behavioural / soft-skill competencies this persona weighs most. */
  behaviouralCompetencies: string[];
  /** Profile controlling how questions are generated for this persona. */
  questionProfile: QuestionGenerationProfile;
}

/** How a persona shapes the generated question set. */
export interface QuestionGenerationProfile {
  /** Preferred question categories to over-weight for this persona. */
  emphasizeCategories: InterviewQuestionCategory[];
  /** Whether to prefer STAR-style behavioural follow-ups. */
  prefersStarFollowUps: boolean;
  /** Whether to weight situational / "what would you do" scenarios. */
  situationalBias: number; // 0..1
  /** Whether to probe competency gaps flagged by ATS / skill-gap analysis. */
  probesCompetencyGaps: boolean;
  /** A one-line instruction for the generator on how to phrase questions. */
  phrasing: string;
}

export type InterviewQuestionCategory =
  | "technical"
  | "behavioral"
  | "situational"
  | "hr"
  | "company";

export const INTERVIEW_PERSONAS: InterviewPersona[] = [
  {
    id: "hr",
    name: "HR Recruiter",
    role: "Human Resources Screening",
    shortLabel: "HR",
    icon: "UserCheck",
    accent: "#8B5CF6",
    focusAreas: ["motivation", "cultural fit", "availability", "career goals", "communication basics"],
    styleGuidance:
      "Adopt a friendly, conversational HR screening tone. Probe motivation, reliability, and culture fit. Keep questions accessible and behaviour-based.",
    questionAngles: ["Why this role?", "Tell me about yourself", "Where do you see yourself in 5 years?", "Why should we hire you?"],
    category: "general",
    roleCompetencies: ["screening fit", "motivation alignment"],
    behaviouralCompetencies: ["communication", "self-awareness", "cultural fit", "reliability"],
    questionProfile: {
      emphasizeCategories: ["hr", "behavioral"],
      prefersStarFollowUps: false,
      situationalBias: 0.2,
      probesCompetencyGaps: true,
      phrasing: "Keep questions accessible and conversational; ground them in motivation and fit rather than technical depth.",
    },
  },
  {
    id: "cabin-crew-manager",
    name: "Cabin Crew Manager",
    role: "In-flight Service Leadership",
    shortLabel: "Crew Mgr",
    icon: "Plane",
    accent: "#1154A3",
    focusAreas: ["customer service", "teamwork", "conflict resolution", "grooming standards", "service excellence"],
    styleGuidance:
      "Adopt the tone of an experienced Cabin Crew Manager. Emphasize 5-star hospitality, passenger handling, teamwork in a pressurized cabin, and brand representation.",
    questionAngles: ["Describe a difficult passenger situation", "How do you handle conflict with a colleague mid-flight?", "What does service excellence mean to you?"],
    category: "aviation",
    roleCompetencies: ["customer service", "cabin teamwork", "conflict resolution", "grooming standards", "service excellence"],
    behaviouralCompetencies: ["empathy", "composure", "teamwork", "brand representation"],
    questionProfile: {
      emphasizeCategories: ["behavioral", "situational"],
      prefersStarFollowUps: true,
      situationalBias: 0.6,
      probesCompetencyGaps: true,
      phrasing: "Frame questions around real cabin-service scenarios; expect STAR answers that show passenger handling and teamwork.",
    },
  },
  {
    id: "chief-purser",
    name: "Chief Purser",
    role: "Cabin Service Director",
    shortLabel: "Purser",
    icon: "Crown",
    accent: "#EC4899",
    focusAreas: ["leadership", "protocol", "safety-service balance", "VIP handling", "decision-making"],
    styleGuidance:
      "Adopt the tone of a Chief Purser / Cabin Service Director. Focus on leadership under pressure, VIP and premium-cabin expectations, and balancing safety with service.",
    questionAngles: ["How would you lead a junior crew member?", "Describe managing a VIP complaint", "Prioritize a safety vs service dilemma"],
    category: "aviation",
    roleCompetencies: ["leadership", "cabin protocol", "safety-service balance", "VIP handling", "decision-making"],
    behaviouralCompetencies: ["leadership", "decisiveness", "composure under pressure", "judgement"],
    questionProfile: {
      emphasizeCategories: ["behavioral", "situational"],
      prefersStarFollowUps: true,
      situationalBias: 0.7,
      probesCompetencyGaps: true,
      phrasing: "Ask leadership-leaning situational questions; probe how they balance safety with premium service and handle VIP expectations.",
    },
  },
  {
    id: "safety-trainer",
    name: "Safety Trainer",
    role: "Cabin Safety & Emergency Procedures",
    shortLabel: "Safety",
    icon: "ShieldCheck",
    accent: "#10B981",
    focusAreas: ["safety procedures", "emergency response", "regulatory compliance", "calm under pressure", "CRM"],
    styleGuidance:
      "Adopt the tone of a Safety Trainer. Probe emergency response, regulatory compliance (SEP), Crew Resource Management, and composure during emergencies.",
    questionAngles: ["Walk me through an emergency evacuation role", "How do you stay calm in an emergency?", "Explain your understanding of CRM"],
    category: "aviation",
    roleCompetencies: ["safety procedures", "emergency response", "regulatory compliance", "CRM", "calm under pressure"],
    behaviouralCompetencies: ["composure", "situational awareness", "discipline", "team coordination"],
    questionProfile: {
      emphasizeCategories: ["situational", "behavioral"],
      prefersStarFollowUps: false,
      situationalBias: 0.8,
      probesCompetencyGaps: true,
      phrasing: "Pose emergency/safety scenarios; assess composure, regulatory knowledge, and Crew Resource Management.",
    },
  },
  {
    id: "hiring-manager",
    name: "Hiring Manager",
    role: "Line / Department Manager",
    shortLabel: "Mgr",
    icon: "Briefcase",
    accent: "#F59E0B",
    focusAreas: ["technical competence", "role-specific deliverables", "problem solving", "ownership"],
    styleGuidance:
      "Adopt the tone of a direct Hiring Manager. Focus on the technical and operational realities of the role, past deliverables, and problem-solving.",
    questionAngles: ["Describe a project you owned end-to-end", "How do you prioritize competing deadlines?", "Tell me about a failure and what you learned"],
    category: "corporate",
    roleCompetencies: ["technical competence", "role-specific deliverables", "problem solving", "ownership"],
    behaviouralCompetencies: ["ownership", "analytical thinking", "accountability"],
    questionProfile: {
      emphasizeCategories: ["technical", "behavioral"],
      prefersStarFollowUps: true,
      situationalBias: 0.3,
      probesCompetencyGaps: true,
      phrasing: "Drill into past deliverables and problem-solving; expect concrete, owned outcomes.",
    },
  },
  {
    id: "panel",
    name: "Panel Interviewer",
    role: "Combined Panel",
    shortLabel: "Panel",
    icon: "Users",
    accent: "#3B82F6",
    focusAreas: ["well-roundedness", "competency coverage", "cross-functional fit"],
    styleGuidance:
      "Adopt a balanced panel-interview tone covering multiple competencies. Mix behavioural, situational, and role-specific questions.",
    questionAngles: ["Tell me about a time you influenced a stakeholder", "How do you handle ambiguous priorities?", "Give an example of cross-team collaboration"],
    category: "general",
    roleCompetencies: ["cross-functional fit", "well-roundedness"],
    behaviouralCompetencies: ["influence", "adaptability", "collaboration"],
    questionProfile: {
      emphasizeCategories: ["behavioral", "situational", "hr"],
      prefersStarFollowUps: true,
      situationalBias: 0.4,
      probesCompetencyGaps: true,
      phrasing: "Mix behavioural, situational, and role-specific questions to cover a broad competency set.",
    },
  },
];

/** Fast id → persona lookup (used by the generator to assign personaId). */
export const PERSONAS_BY_ID: Record<string, InterviewPersona> = Object.fromEntries(
  INTERVIEW_PERSONAS.map((p) => [p.id, p])
);

export function getPersona(id: string): InterviewPersona | undefined {
  return PERSONAS_BY_ID[id];
}

export function defaultPersonaRotation(): InterviewPersona[] {
  // A natural interview arc: screening → role-specific → leadership → safety → panel.
  return ["hr", "hiring-manager", "cabin-crew-manager", "chief-purser", "safety-trainer", "panel"]
    .map(getPersona)
    .filter((p): p is InterviewPersona => Boolean(p));
}

/** Build a compact persona-context string for the generator prompt. */
export function buildPersonaContext(personas: InterviewPersona[]): string {
  if (!personas.length) return "";
  return `INTERVIEW PANEL (simulate these interviewer personas, rotating by question):
${personas
  .map(
    (p, i) =>
      `${i + 1}. ${p.name} (${p.role}) — focus: ${p.focusAreas.join(", ")}. Style: ${p.styleGuidance}`
  )
  .join("\n")}

Assign each generated question to the most appropriate persona (set the "personaId" and "personaName" fields).
Vary the persona across questions so the candidate experiences a multi-interviewer panel.`;
}
