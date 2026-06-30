// ============================================================================
// Resume Structure Guardian Agent
//
// Validates the final assembled resume for structural integrity.
// Detects:
//   - corrupted summary (double periods, duplicate sentences, fragments)
//   - missing company/dates on experience entries
//   - duplicate experiences (by ID or fingerprint)
//   - duplicate bullets within an experience
//   - malformed fragments ("s and", "..", "```")
//   - JD company names in headline or skills
//   - page overflow (char count > max)
//   - missing education/languages
//
// Any critical issue → REQUIRES_MANUAL_REVIEW
// ============================================================================

"use client";

import type { ResumeData } from "./types";
import { computeExperienceFingerprint } from "./experience-fingerprint";

export interface GuardianResult {
  passed: boolean;
  status: "PASS" | "REQUIRES_MANUAL_REVIEW";
  issues: string[];
  criticalIssues: string[];
  warnings: string[];
  score: number; // 0-100
}

const CRITICAL_PATTERNS = [
  /\b\s\s+and\b/i, // "s and" fragments
  /^\s*and\s+/i, // bullet starting with "and"
  /\.\./, // double periods
  /\.\.\./, // triple periods
  /```/, // code fences
  /\bundefined\b/i,
  /\bnull\b/i,
  /\[object object\]/i,
];

// Legacy static list — kept as fallback when no JD content is provided.
// Replaced by dynamic JD content extraction in runStructureGuardian when
// the jdContent optional parameter is passed.
const JD_COMPANY_NAMES = [
  "qatar duty free", "qatar airways group", "hamad international airport",
  "doha", "qatar", "dubai", "abu dhabi", "uae",
  "riyadh", "saudi arabia", "kuwait", "bahrain", "oman", "muscat",
];

/**
 * Extract meaningful company/location names from JD content for dynamic matching.
 * Picks capitalized multi-word phrases that appear in the first ~20% of the JD
 * (where company name usually sits), plus any clearly named entities.
 */
function extractJdEntities(jdContent: string): string[] {
  const entities: string[] = [];
  const lower = jdContent.toLowerCase();

  // Extract the first ~200 chars (usually contains company name block)
  const headerBlock = lower.slice(0, 200);
  // Look for "at X" or "company: X" patterns
  const namePatterns = [
    ...headerBlock.matchAll(/\bat\s+([a-z][a-z0-9&.\s]{2,40})/g),
    ...headerBlock.matchAll(/\bcompany[:\s]*([a-z][a-z0-9&.\s]{2,40})/g),
    ...headerBlock.matchAll(/\bemployer[:\s]*([a-z][a-z0-9&.\s]{2,40})/g),
    ...headerBlock.matchAll(/\b(?:hamad international airport|qatar airways|qatar duty free|doha|qatar)\b/g),
  ];

  for (const m of namePatterns) {
    const name = m[1] || m[0];
    const trimmed = name.trim().toLowerCase();
    if (trimmed.length > 2 && !entities.includes(trimmed)) {
      entities.push(trimmed);
    }
  }

  return entities;
}

/**
 * Check if headline text appears to be contaminated with contact information.
 * Returns a list of issues found.
 */
function checkHeadlineForContactContamination(headline: string, resume: ResumeData): string[] {
  const issues: string[] = [];
  if (!headline) return issues;

  const hl = headline.toLowerCase();
  const contact = resume.contact || {};

  // Check if headline contains the candidate's name (duplication)
  if (resume.name && resume.name.length > 2) {
    const nameParts = resume.name.toLowerCase().split(/\s+/).filter(Boolean);
    const nameMatchCount = nameParts.filter((part) => hl.includes(part)).length;
    if (nameMatchCount >= 2 && nameParts.length >= 2) {
      issues.push(`Headline contains candidate's name ("${resume.name}") — should be a professional title only`);
    }
  }

  // Check if headline contains phone number
  if (contact.phone) {
    const phoneDigits = contact.phone.replace(/\D/g, '');
    if (phoneDigits.length >= 6 && hl.includes(phoneDigits)) {
      issues.push(`Headline contains phone number`);
    } else {
      // Try matching part of the phone
      const phonePrefix = phoneDigits.slice(0, Math.min(6, phoneDigits.length));
      if (phonePrefix.length >= 4 && hl.includes(phonePrefix)) {
        issues.push(`Headline contains phone number`);
      }
    }
  }

  // Check if headline contains email
  if (contact.email) {
    const emailPrefix = contact.email.split('@')[0].toLowerCase();
    if (emailPrefix.length >= 4 && hl.includes(emailPrefix)) {
      issues.push(`Headline contains email address`);
    }
  }

  // Check if headline contains full address/street info
  if (contact.location) {
    const locParts = contact.location.toLowerCase().split(/[,;]/).map((s: string) => s.trim()).filter(Boolean);
    for (const part of locParts) {
      if (part.length >= 4 && hl.includes(part)) {
        issues.push(`Headline contains location/address ("${part}")`);
        break;
      }
    }
  }

  return issues;
}

/**
 * Run the Resume Structure Guardian on the final resume.
 *
 * Returns PASS if the resume is structurally sound, or
 * REQUIRES_MANUAL_REVIEW if critical issues are found.
 *
 * @param jdContent - Optional JD text for dynamic company name extraction.
 *                    When provided, detected company/location names from the JD
 *                    are used instead of the static JD_COMPANY_NAMES list.
 */
export function runStructureGuardian(
  resume: ResumeData,
  sourceResume: ResumeData,
  jdContent?: string,
): GuardianResult {
  const issues: string[] = [];
  const criticalIssues: string[] = [];
  const warnings: string[] = [];

  // ========================================================================
  // 1. SUMMARY VALIDATION
  // ========================================================================
  if (!resume.summary || resume.summary.trim().length < 30) {
    criticalIssues.push("Summary is missing or too short (< 30 chars)");
  } else {
    const summary = resume.summary;
    // Check for double periods
    if (/\.\./.test(summary)) {
      criticalIssues.push("Summary contains double periods (..)");
    }
    // Check for duplicate sentences
    const sentences = summary.split(/(?<=\.)\s+/).map((s) => s.toLowerCase().trim()).filter((s) => s.length > 10);
    const seen = new Set<string>();
    for (const s of sentences) {
      if (seen.has(s)) {
        criticalIssues.push(`Summary contains duplicate sentence: "${s.slice(0, 80)}..."`);
        break;
      }
      seen.add(s);
    }
    // Check for critical patterns
    for (const pattern of CRITICAL_PATTERNS) {
      if (pattern.test(summary)) {
        criticalIssues.push(`Summary contains malformed fragment matching /${pattern.source}/`);
        break;
      }
    }
    // Check for fragments shorter than 10 chars
    const fragments = sentences.filter((s) => s.length < 10 && s.length > 0);
    if (fragments.length > 0) {
      warnings.push(`Summary contains ${fragments.length} short fragment(s)`);
    }
  }

  // ========================================================================
  // 2. HEADLINE VALIDATION
  // ========================================================================

  // Build dynamic JD entity list (if JD content provided)
  const dynamicJdEntities = jdContent ? extractJdEntities(jdContent) : [];
  const allJdEntities = [...new Set([...JD_COMPANY_NAMES, ...dynamicJdEntities])];

  if (!resume.headline || resume.headline.trim().length === 0) {
    warnings.push("Headline is empty");
  } else {
    const headlineLower = resume.headline.toLowerCase();

    // Check against JD company names (static + dynamic)
    const containsJdCompany = allJdEntities.some((name) => headlineLower.includes(name));
    if (containsJdCompany) {
      criticalIssues.push(`Headline contains JD company name: "${resume.headline}"`);
    }

    // Check for contact contamination (name, phone, email, address in headline)
    const contactIssues = checkHeadlineForContactContamination(resume.headline, resume);
    if (contactIssues.length > 0) {
      criticalIssues.push(...contactIssues);
    }
  }

  // ========================================================================
  // 3. EXPERIENCE VALIDATION
  // ========================================================================
  if (!resume.experience || resume.experience.length === 0) {
    criticalIssues.push("Experience section is empty");
  } else {
    // Check experience count matches source
    if (resume.experience.length < sourceResume.experience.length) {
      criticalIssues.push(
        `Experience count mismatch: optimized has ${resume.experience.length}, source has ${sourceResume.experience.length}`,
      );
    }

    // Check for duplicate experiences (by ID or fingerprint)
    const seenIds = new Set<string>();
    const seenFps = new Set<string>();
    for (let i = 0; i < resume.experience.length; i++) {
      const exp = resume.experience[i];

      // Check ID uniqueness
      if (exp.id && seenIds.has(exp.id)) {
        criticalIssues.push(`Duplicate experience ID: "${exp.id}" (index ${i})`);
      }
      if (exp.id) seenIds.add(exp.id);

      // Check fingerprint uniqueness
      const fp = computeExperienceFingerprint(exp);
      if (seenFps.has(fp)) {
        criticalIssues.push(`Duplicate experience fingerprint: title="${exp.title}", company="${exp.company}" (index ${i})`);
      }
      seenFps.add(fp);

      // Check for missing critical fields
      if (!exp.title || exp.title.trim().length === 0) {
        warnings.push(`Experience[${i}] has no title`);
      }
      // Company is allowed to be empty (source may not have had one) — but warn
      if (!exp.company || exp.company.trim().length === 0) {
        warnings.push(`Experience[${i}] (title="${exp.title}") has no company — source may not have had one`);
      }
      // Dates: check if source had dates but optimized doesn't
      const srcExp = sourceResume.experience[i];
      if (srcExp) {
        if (srcExp.startDate && !exp.startDate) {
          criticalIssues.push(`Experience[${i}] (title="${exp.title}"): startDate dropped (source had "${srcExp.startDate}")`);
        }
        if (srcExp.endDate && !exp.endDate) {
          criticalIssues.push(`Experience[${i}] (title="${exp.title}"): endDate dropped (source had "${srcExp.endDate}")`);
        }
        if (srcExp.startDate && exp.startDate && srcExp.startDate !== exp.startDate) {
          criticalIssues.push(`Experience[${i}] (title="${exp.title}"): startDate changed "${srcExp.startDate}" → "${exp.startDate}"`);
        }
        if (srcExp.endDate && exp.endDate && srcExp.endDate !== exp.endDate) {
          criticalIssues.push(`Experience[${i}] (title="${exp.title}"): endDate changed "${srcExp.endDate}" → "${exp.endDate}"`);
        }
      }

      // Check for "Present" injection
      if (exp.endDate && /present|current/i.test(exp.endDate)) {
        const srcEnd = sourceResume.experience[i]?.endDate || "";
        if (!/present|current/i.test(srcEnd)) {
          criticalIssues.push(`Experience[${i}] (title="${exp.title}"): endDate injected as "Present" (source had "${srcEnd}")`);
        }
      }

      // Check for critical patterns in bullets
      if (exp.bullets && exp.bullets.length > 0) {
        // Check for duplicate bullets
        const seenBullets = new Set<string>();
        for (const bullet of exp.bullets) {
          const normalized = bullet.toLowerCase().replace(/\s+/g, " ").trim();
          if (seenBullets.has(normalized)) {
            warnings.push(`Experience[${i}] (title="${exp.title}"): duplicate bullet: "${bullet.slice(0, 60)}..."`);
          }
          seenBullets.add(normalized);

          for (const pattern of CRITICAL_PATTERNS) {
            if (pattern.test(bullet)) {
              criticalIssues.push(`Experience[${i}] bullet contains malformed fragment: "${bullet.slice(0, 80)}"`);
              break;
            }
          }
        }

        // Check for backticks
        if (exp.bullets.some((b) => b.includes("`"))) {
          warnings.push(`Experience[${i}] (title="${exp.title}"): bullet contains backtick`);
        }

        // Check for "within <Title>" hallucinations
        const titleLower = (exp.title || "").toLowerCase();
        if (titleLower) {
          for (const bullet of exp.bullets) {
            const bulletLower = bullet.toLowerCase();
            if (bulletLower.includes(`within ${titleLower}`)) {
              criticalIssues.push(`Experience[${i}] bullet contains "within ${exp.title}" hallucination: "${bullet.slice(0, 80)}..."`);
              break;
            }
          }
        }
      } else {
        warnings.push(`Experience[${i}] (title="${exp.title}") has no bullets`);
      }
    }
  }

  // ========================================================================
  // 4. EDUCATION VALIDATION
  // ========================================================================
  if (!resume.education || resume.education.length === 0) {
    if (sourceResume.education.length > 0) {
      criticalIssues.push("Education section is empty but source had education entries");
    }
  } else {
    if (resume.education.length < sourceResume.education.length) {
      criticalIssues.push(
        `Education count mismatch: optimized has ${resume.education.length}, source has ${sourceResume.education.length}`,
      );
    }
    for (let i = 0; i < resume.education.length; i++) {
      const edu = resume.education[i];
      // Check institution for date pollution
      if (edu.institution && /\d{4}\s*[–\-—]\s*\d{4}/.test(edu.institution)) {
        criticalIssues.push(`Education[${i}]: institution contains dates: "${edu.institution}"`);
      }
      // Check degree for "Specialized modules" pollution
      if (edu.degree && /specialized modules include/i.test(edu.degree)) {
        warnings.push(`Education[${i}]: degree contains "Specialized modules include" (should be in highlights)`);
      }
      // CRITICAL: Check for missing school name (institution)
      const srcEdu = sourceResume.education[i];
      if (srcEdu && srcEdu.institution && srcEdu.institution.trim() && (!edu.institution || !edu.institution.trim())) {
        criticalIssues.push(`Education[${i}]: school name missing — source had "${srcEdu.institution}"`);
      }
      // Check if school name changed (not allowed — immutable)
      if (srcEdu && srcEdu.institution && edu.institution && srcEdu.institution !== edu.institution) {
        criticalIssues.push(`Education[${i}]: school name changed "${srcEdu.institution}" → "${edu.institution}"`);
      }
    }
  }

  // ========================================================================
  // 5. LANGUAGES VALIDATION
  // ========================================================================
  if (!resume.languages || resume.languages.length === 0) {
    if (sourceResume.languages.length > 0) {
      criticalIssues.push("Languages section is empty but source had language entries");
    }
  } else {
    if (resume.languages.length < sourceResume.languages.length) {
      criticalIssues.push(
        `Languages count mismatch: optimized has ${resume.languages.length}, source has ${sourceResume.languages.length}`,
      );
    }
    for (let i = 0; i < resume.languages.length; i++) {
      const lang = resume.languages[i];
      if (!lang.name || lang.name.trim().length === 0) {
        criticalIssues.push(`Languages[${i}]: name is empty`);
      }
    }
  }

  // ========================================================================
  // 6. SKILLS VALIDATION
  // ========================================================================
  if (!resume.skills || resume.skills.length === 0) {
    warnings.push("Skills section is empty");
  } else {
    for (const skill of resume.skills) {
      const skillLower = (skill.name || "").toLowerCase();
      if (allJdEntities.some((name) => skillLower === name || skillLower.includes(name))) {
        criticalIssues.push(`Skill "${skill.name}" is a JD company name/location — should not be in skills`);
      }
    }
  }

  // ========================================================================
  // 7. PAGE OVERFLOW CHECK
  // ========================================================================
  const charCount = JSON.stringify({
    summary: resume.summary,
    experience: resume.experience,
    skills: resume.skills,
    education: resume.education,
    languages: resume.languages,
  }).length;
  if (charCount > 4500) {
    warnings.push(`Resume may exceed one page (char count: ${charCount})`);
  }

  // ========================================================================
  // 8. COMPUTE SCORE
  // ========================================================================
  const totalChecks = criticalIssues.length + warnings.length;
  const score = totalChecks === 0 ? 100 : Math.max(0, 100 - (criticalIssues.length * 20 + warnings.length * 5));

  const passed = criticalIssues.length === 0;
  const status = passed ? "PASS" : "REQUIRES_MANUAL_REVIEW";

  issues.push(...criticalIssues, ...warnings);

  if (passed) {
    console.info(`[Structure Guardian] PASS — score: ${score}/100, ${warnings.length} warning(s)`);
  } else {
    console.warn(`[Structure Guardian] ${status} — score: ${score}/100, ${criticalIssues.length} critical issue(s), ${warnings.length} warning(s)`, criticalIssues);
  }

  return {
    passed,
    status,
    issues,
    criticalIssues,
    warnings,
    score,
  };
}
