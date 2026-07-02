import type { ResumeData } from "../types";
import { callAI, extractJSON } from "../ai";

export interface RepairResult {
  resume: ResumeData;
  repairs: Repair[];
  confidence: number;
}

export interface Repair {
  type: "missing-section" | "broken-field" | "hallucinated-entry" | "format-fix" | "duplicate-removal";
  section: string;
  detail: string;
  severity: "critical" | "warning" | "info";
}

export interface RepairConfig {
  maxRetries: number;
  requireStructuredOutput: boolean;
  strictJson: boolean;
  failOnMissingSections: boolean;
  failOnDirectiveBypass: boolean;
  failOnParserConfidenceBelow: number;
}

export const DEFAULT_REPAIR_CONFIG: RepairConfig = {
  maxRetries: 3,
  requireStructuredOutput: true,
  strictJson: true,
  failOnMissingSections: true,
  failOnDirectiveBypass: true,
  failOnParserConfidenceBelow: 90,
};

/**
 * ResumeRepairAgent — detects and fixes structural issues in parsed resumes.
 * Runs after Resume Parser and after Optimizer to ensure data integrity.
 */
export async function runResumeRepair(
  resume: ResumeData,
  originalResume?: ResumeData | null,
  config: RepairConfig = DEFAULT_REPAIR_CONFIG,
): Promise<RepairResult> {
  const repairs: Repair[] = [];
  let confidence = 100;

  // 1. Check for missing required sections
  if (!resume.summary || resume.summary.trim().length < 10) {
    repairs.push({ type: "missing-section", section: "summary", detail: "Summary is empty or too short", severity: "warning" });
    if (originalResume?.summary) {
      resume.summary = originalResume.summary;
      repairs.push({ type: "format-fix", section: "summary", detail: "Restored summary from original resume", severity: "info" });
    }
    confidence -= 10;
  }

  if (!resume.experience || resume.experience.length === 0) {
    repairs.push({ type: "missing-section", section: "experience", detail: "No experience entries found", severity: "critical" });
    if (originalResume?.experience) {
      resume.experience = originalResume.experience;
      repairs.push({ type: "format-fix", section: "experience", detail: "Restored experience from original resume", severity: "info" });
    }
    confidence -= 30;
  }

  if (!resume.education || resume.education.length === 0) {
    repairs.push({ type: "missing-section", section: "education", detail: "No education entries found", severity: "critical" });
    if (originalResume?.education) {
      resume.education = originalResume.education;
      repairs.push({ type: "format-fix", section: "education", detail: "Restored education from original resume", severity: "info" });
    }
    confidence -= 25;
  }

  if (!resume.skills || resume.skills.length === 0) {
    repairs.push({ type: "missing-section", section: "skills", detail: "No skills found", severity: "critical" });
    if (originalResume?.skills) {
      resume.skills = originalResume.skills;
      repairs.push({ type: "format-fix", section: "skills", detail: "Restored skills from original resume", severity: "info" });
    }
    confidence -= 20;
  }

  // 2. Check for broken fields in experience entries
  for (let i = 0; i < resume.experience.length; i++) {
    const exp = resume.experience[i];
    if (!exp.title || exp.title.trim().length === 0) {
      repairs.push({ type: "broken-field", section: `experience[${i}]`, detail: "Missing title", severity: "critical" });
      if (originalResume?.experience[i]?.title) {
        resume.experience[i].title = originalResume.experience[i].title;
        repairs.push({ type: "format-fix", section: `experience[${i}]`, detail: "Restored title from original", severity: "info" });
      }
      confidence -= 10;
    }
    if (!exp.company || exp.company.trim().length === 0) {
      repairs.push({ type: "broken-field", section: `experience[${i}]`, detail: "Missing company name", severity: "critical" });
      if (originalResume?.experience[i]?.company) {
        resume.experience[i].company = originalResume.experience[i].company;
        repairs.push({ type: "format-fix", section: `experience[${i}]`, detail: "Restored company from original", severity: "info" });
      }
      confidence -= 10;
    }
    if (!exp.bullets || exp.bullets.length === 0) {
      repairs.push({ type: "broken-field", section: `experience[${i}]`, detail: "No bullet points", severity: "warning" });
      if (originalResume?.experience[i]?.bullets) {
        resume.experience[i].bullets = originalResume.experience[i].bullets;
        repairs.push({ type: "format-fix", section: `experience[${i}]`, detail: "Restored bullets from original", severity: "info" });
      }
      confidence -= 5;
    }
  }

  // 3. Check contact info
  if (!resume.contact?.email && originalResume?.contact?.email) {
    resume.contact = { ...resume.contact, email: originalResume.contact.email };
    repairs.push({ type: "broken-field", section: "contact", detail: "Restored missing email", severity: "warning" });
    confidence -= 5;
  }
  if (!resume.name && originalResume?.name) {
    resume.name = originalResume.name;
    repairs.push({ type: "broken-field", section: "contact", detail: "Restored missing name", severity: "critical" });
    confidence -= 10;
  }

  confidence = Math.max(0, confidence);

  if (config.failOnMissingSections && confidence < config.failOnParserConfidenceBelow) {
    throw new Error(`ResumeRepair: confidence ${confidence}% is below threshold ${config.failOnParserConfidenceBelow}%. Repairs: ${repairs.map((r) => r.detail).join("; ")}`);
  }

  return { resume, repairs, confidence };
}
