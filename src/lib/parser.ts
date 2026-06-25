// ResumeAI Pro — client-side resume parser for PDF / DOCX / TXT
"use client";

import type { ResumeData } from "./types";
import { uid } from "./store";

/**
 * Parse an uploaded file into a ResumeData object.
 * Supports: .txt, .pdf (via pdfjs-dist), .docx (via mammoth)
 */
export function calculateParserConfidence(resume: ResumeData): number {
  let score = 0;
  if (resume.summary && resume.summary.trim().length > 20) score += 25;
  if (resume.experience && resume.experience.length > 0) score += 25;
  if (resume.education && resume.education.length > 0) score += 20;
  if (resume.languages && resume.languages.length > 0) score += 15;
  if (resume.skills && resume.skills.length > 0) score += 10;
  if (resume.contact && (resume.contact.email || resume.contact.phone)) score += 5;
  return score;
}

export function validateParsedResume(resume: ResumeData): boolean {
  return (
    resume.summary !== undefined &&
    resume.summary !== null &&
    resume.summary.trim().length > 0 &&
    resume.experience.length > 0 &&
    resume.education.length > 0 &&
    resume.languages.length > 0
  );
}

export function RepairParser(text: string, fileName: string): ResumeData {
  console.log("RepairParser: Validation or confidence failed. Trying secondary parser...");
  let parsed = secondaryParser(text, fileName);
  let confidence = calculateParserConfidence(parsed);
  let isValid = validateParsedResume(parsed);

  if (!isValid || confidence < 90) {
    console.log(`Secondary parser insufficient (confidence: ${confidence}, valid: ${isValid}). Trying heuristic parser...`);
    parsed = heuristicParser(text, fileName);
    confidence = calculateParserConfidence(parsed);
    isValid = validateParsedResume(parsed);
  }

  if (!isValid) {
    console.error("Heuristic parser failed to recover core sections. Throwing ParseError.");
    throw new Error("ParseError: Could not extract all required resume sections (Summary, Experience, Education, Languages) even after heuristic repair.");
  }

  return parsed;
}

export function secondaryParser(text: string, fileName: string): ResumeData {
  const normalizedText = text.replace(/\r/g, "");
  
  // Section regexes
  const expRegex = /(?:PROFESSIONAL EXPERIENCE|WORK EXPERIENCE|EXPERIENCE|EMPLOYMENT HISTORY|HISTORY)([\s\S]*?)(?=(?:EDUCATION|LANGUAGES|SKILLS|CORE COMPETENCIES|CERTIFICATIONS|PROJECTS|REFERENCES|SUMMARY|PROFESSIONAL SUMMARY|$))/i;
  const eduRegex = /(?:EDUCATION|ACADEMIC BACKGROUND|ACADEMIC)([\s\S]*?)(?=(?:PROFESSIONAL EXPERIENCE|WORK EXPERIENCE|EXPERIENCE|LANGUAGES|SKILLS|CORE COMPETENCIES|CERTIFICATIONS|PROJECTS|REFERENCES|SUMMARY|PROFESSIONAL SUMMARY|$))/i;
  const langRegex = /(?:LANGUAGES|LANGUAGE)([\s\S]*?)(?=(?:PROFESSIONAL EXPERIENCE|WORK EXPERIENCE|EXPERIENCE|EDUCATION|SKILLS|CORE COMPETENCIES|CERTIFICATIONS|PROJECTS|REFERENCES|SUMMARY|PROFESSIONAL SUMMARY|$))/i;
  const skillsRegex = /(?:SKILLS|TECHNICAL SKILLS|CORE SKILLS|CORE COMPETENCIES|CORE COMPETENCIES & SKILLS|COMPETENCIES)([\s\S]*?)(?=(?:PROFESSIONAL EXPERIENCE|WORK EXPERIENCE|EXPERIENCE|EDUCATION|LANGUAGES|CERTIFICATIONS|PROJECTS|REFERENCES|SUMMARY|PROFESSIONAL SUMMARY|$))/i;
  const certsRegex = /(?:CERTIFICATIONS|CERTIFICATES|LICENSES)([\s\S]*?)(?=(?:PROFESSIONAL EXPERIENCE|WORK EXPERIENCE|EXPERIENCE|EDUCATION|LANGUAGES|SKILLS|CORE COMPETENCIES|PROJECTS|REFERENCES|SUMMARY|PROFESSIONAL SUMMARY|$))/i;
  const projRegex = /(?:PROJECTS|PERSONAL PROJECTS|SIDE PROJECTS)([\s\S]*?)(?=(?:PROFESSIONAL EXPERIENCE|WORK EXPERIENCE|EXPERIENCE|EDUCATION|LANGUAGES|SKILLS|CORE COMPETENCIES|CERTIFICATIONS|REFERENCES|SUMMARY|PROFESSIONAL SUMMARY|$))/i;
  const summaryRegex = /(?:SUMMARY|PROFESSIONAL SUMMARY|PROFILE|OBJECTIVE)([\s\S]*?)(?=(?:PROFESSIONAL EXPERIENCE|WORK EXPERIENCE|EXPERIENCE|EDUCATION|LANGUAGES|SKILLS|CORE COMPETENCIES|CERTIFICATIONS|PROJECTS|REFERENCES|$))/i;

  const expMatch = normalizedText.match(expRegex);
  const eduMatch = normalizedText.match(eduRegex);
  const langMatch = normalizedText.match(langRegex);
  const skillsMatch = normalizedText.match(skillsRegex);
  const certsMatch = normalizedText.match(certsRegex);
  const projMatch = normalizedText.match(projRegex);
  const summaryMatch = normalizedText.match(summaryRegex);

  const expLines = expMatch ? expMatch[1].split("\n").map(l => l.trim()).filter(Boolean) : [];
  const eduLines = eduMatch ? eduMatch[1].split("\n").map(l => l.trim()).filter(Boolean) : [];
  const langLines = langMatch ? langMatch[1].split("\n").map(l => l.trim()).filter(Boolean) : [];
  const skillsLines = skillsMatch ? skillsMatch[1].split("\n").map(l => l.trim()).filter(Boolean) : [];
  const certsLines = certsMatch ? certsMatch[1].split("\n").map(l => l.trim()).filter(Boolean) : [];
  const projLines = projMatch ? projMatch[1].split("\n").map(l => l.trim()).filter(Boolean) : [];
  const summary = summaryMatch ? summaryMatch[1].trim() : undefined;

  const experience = parseExperiences(expLines);
  const education = parseEducation(eduLines);
  const skills = skillsLines
    .flatMap((l) => l.split(/[,;•|]/))
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length < 40)
    .map((s) => ({ id: uid("s"), name: s }));
  const projects = parseProjects(projLines);
  const certifications = certsLines.map((c) => ({ id: uid("c"), name: c }));
  const languages = langLines
    .flatMap((l) => l.split(/[,;]/))
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const match = s.match(/^([A-Za-z]+)\s*[\(:]\s*(Native|Fluent|Proficient|Conversational|Intermediate|Basic|Advanced|Professional)\s*\)?$/i);
      if (match) {
        const proficiency = match[2].toLowerCase();
        const normalizedProf = (["basic", "conversational", "fluent", "native"].includes(proficiency) ? proficiency : "fluent") as "basic" | "conversational" | "fluent" | "native";
        return { id: uid("l"), name: match[1], proficiency: normalizedProf };
      }
      return { id: uid("l"), name: s, proficiency: "fluent" as const };
    });

  // Extract contact
  const firstLines = normalizedText.split("\n").slice(0, 15).join("\n");
  const emailMatch = firstLines.match(EMAIL_RE);
  const phoneMatch = firstLines.match(PHONE_RE);
  const urlMatches = Array.from(firstLines.matchAll(new RegExp(URL_RE.source, "gi"))).map((m) => m[0]);
  const linkedin = urlMatches.find((u) => /linkedin/i.test(u));
  const github = urlMatches.find((u) => /github/i.test(u));
  const website = urlMatches.find((u) => !/linkedin|github/i.test(u));
  // Try to find a location pattern near the top
  // Allow 1-3 capitalized words before the comma (e.g. "San Francisco, CA", "New York City, NY").
  // Also allow capitalized country/state names after the comma (e.g. "Rabat, Morocco", "London, United Kingdom").
  const locationLine = normalizedText.split("\n").slice(0, 15).find((l) => /\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2},\s?[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\b/.test(l));
  const location = locationLine?.match(/\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2},\s?[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\b/)?.[1];

  let name = "Untitled";
  const nameLines = normalizedText.split("\n").slice(0, 5);
  for (const l of nameLines) {
    const words = l.trim().split(/\s+/);
    if (words.length >= 2 && words.length <= 5 && !/\d/.test(l) && l.length < 60) {
      name = l.replace(/[^a-zA-Z\s.\-']/g, "").trim() || name;
      break;
    }
  }

  const now = new Date().toISOString();
  return {
    id: uid("r"),
    name,
    contact: { email: emailMatch?.[1], phone: phoneMatch?.[1]?.trim(), location, website, linkedin, github },
    summary,
    experience,
    education,
    skills,
    projects,
    certifications,
    languages,
    template: "ats-professional",
    accentColor: "#1154A3",
    createdAt: now,
    updatedAt: now,
    source: "upload",
    fileName,
  };
}

export function heuristicParser(text: string, fileName: string): ResumeData {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  let currentSection = "header";
  
  const sectionLines: { [key: string]: string[] } = {
    header: [],
    summary: [],
    experience: [],
    education: [],
    languages: [],
    skills: [],
    certifications: [],
    projects: [],
  };

  for (const line of lines) {
    const lower = line.toLowerCase();
    
    if (/(?:summary|profile|objective)/i.test(lower) && lower.length < 30) {
      currentSection = "summary";
      continue;
    } else if (/(?:experience|work|employment|history)/i.test(lower) && lower.length < 30) {
      currentSection = "experience";
      continue;
    } else if (/(?:education|academic)/i.test(lower) && lower.length < 30) {
      currentSection = "education";
      continue;
    } else if (/(?:languages|language)/i.test(lower) && lower.length < 30) {
      currentSection = "languages";
      continue;
    } else if (/(?:skills|competencies)/i.test(lower) && lower.length < 30) {
      currentSection = "skills";
      continue;
    } else if (/(?:certifications|certificates)/i.test(lower) && lower.length < 30) {
      currentSection = "certifications";
      continue;
    } else if (/(?:projects)/i.test(lower) && lower.length < 30) {
      currentSection = "projects";
      continue;
    }

    sectionLines[currentSection].push(line);
  }

  const summary = sectionLines.summary.join(" ").trim() || undefined;
  const experience = parseExperiences(sectionLines.experience);
  const education = parseEducation(sectionLines.education);
  const skills = sectionLines.skills
    .flatMap((l) => l.split(/[,;•|]/))
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length < 40)
    .map((s) => ({ id: uid("s"), name: s }));
  const projects = parseProjects(sectionLines.projects);
  const certifications = sectionLines.certifications.map((c) => ({ id: uid("c"), name: c }));
  const languages = sectionLines.languages
    .flatMap((l) => l.split(/[,;]/))
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => ({ id: uid("l"), name: s, proficiency: "fluent" as const }));

  // Contact info
  const headerText = sectionLines.header.join("\n");
  const emailMatch = headerText.match(EMAIL_RE);
  const phoneMatch = headerText.match(PHONE_RE);
  const urlMatches = Array.from(headerText.matchAll(new RegExp(URL_RE.source, "gi"))).map((m) => m[0]);
  const linkedin = urlMatches.find((u) => /linkedin/i.test(u));
  const github = urlMatches.find((u) => /github/i.test(u));
  const website = urlMatches.find((u) => !/linkedin|github/i.test(u));
  const locationLine = sectionLines.header.find((l) => /\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2},\s?[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\b/.test(l));
  const location = locationLine?.match(/\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2},\s?[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\b/)?.[1];

  let name = "Untitled";
  for (const l of sectionLines.header.slice(0, 5)) {
    const words = l.split(/\s+/);
    if (words.length >= 2 && words.length <= 5 && !/\d/.test(l) && l.length < 60) {
      name = l.replace(/[^a-zA-Z\s.\-']/g, "").trim() || name;
      break;
    }
  }

  const now = new Date().toISOString();
  return {
    id: uid("r"),
    name,
    contact: { email: emailMatch?.[1], phone: phoneMatch?.[1]?.trim(), location, website, linkedin, github },
    summary,
    experience,
    education,
    skills,
    projects,
    certifications,
    languages,
    template: "ats-professional",
    accentColor: "#1154A3",
    createdAt: now,
    updatedAt: now,
    source: "upload",
    fileName,
  };
}

export async function parseResumeFile(file: File): Promise<ResumeData> {
  const name = file.name.toLowerCase();
  let rawText = "";

  if (name.endsWith(".txt")) {
    rawText = await file.text();
  } else if (name.endsWith(".pdf")) {
    rawText = await parsePdf(file);
  } else if (name.endsWith(".docx")) {
    rawText = await parseDocx(file);
  } else if (name.endsWith(".doc")) {
    rawText = await file.text().catch(() => "");
    if (!rawText.trim()) {
      throw new Error(
        "Legacy .doc files are not directly parseable in-browser. Please save as .docx or .pdf and try again."
      );
    }
  } else {
    throw new Error("Unsupported file type. Please upload PDF, DOCX, or TXT.");
  }

  if (rawText.trim().length < 30) {
    throw new Error("The file appears to be empty or could not be parsed.");
  }

  const primaryResult = extractResumeFromText(rawText, file.name);
  const primaryConfidence = calculateParserConfidence(primaryResult);
  const isValid = validateParsedResume(primaryResult);

  if (!isValid || primaryConfidence < 90) {
    console.warn(`Primary parser incomplete (valid: ${isValid}, confidence: ${primaryConfidence}). Running RepairParser...`);
    return RepairParser(rawText, file.name);
  }

  return primaryResult;
}

async function parsePdf(file: File): Promise<string> {
  // Load pdf.js v3.11.174 from CDN — most reliable approach for all environments
  // (browser, Cloudflare Pages, Edge runtime). Uses script tag injection.
  if (!(window as any).pdfjsLib) {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      script.onload = () => {
        (window as any).pdfjsLib.GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        resolve();
      };
      script.onerror = () => reject(new Error("Failed to load PDF.js from CDN."));
      document.head.appendChild(script);
    });
  }

  const pdfjsLib = (window as any).pdfjsLib;
  const arrayBuffer = await file.arrayBuffer();

  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const textParts: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();

    let lastY: number | null = null;
    let pageText = "";

    for (const item of textContent.items) {
      if (item.str && item.str.trim()) {
        // Add newline if Y position changed significantly (preserves line breaks)
        if (lastY !== null && Math.abs(item.transform[5] - lastY) > 5) {
          pageText += "\n";
        } else if (pageText && !pageText.endsWith(" ") && !pageText.endsWith("\n")) {
          pageText += " ";
        }
        pageText += item.str;
        lastY = item.transform[5];
      }
    }

    if (pageText.trim()) {
      textParts.push(pageText.trim());
    }
  }

  return textParts.join("\n\n");
}

async function parseDocx(file: File): Promise<string> {
  const mammoth = await import("mammoth/mammoth.browser");
  const arrayBuffer = await file.arrayBuffer();
  // mammoth.browser default export shape varies by build
  const m: any = (mammoth as any).default ?? mammoth;
  const result = await m.extractRawText({ arrayBuffer });
  return result.value || "";
}

const EMAIL_RE = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/;
const PHONE_RE = /(\+?[\d\s().-]{10,})/;
const URL_RE = /(https?:\/\/[^\s]+|linkedin\.com\/[^\s]+|github\.com\/[^\s]+)/i;

/**
 * Heuristic resume text → ResumeData extractor.
 * Not perfect, but good enough for initial parsing and to seed the builder.
 */
export function extractResumeFromText(text: string, fileName: string): ResumeData {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const joined = lines.join("\n");

  // Name = first non-empty line if it has 2-4 words and no digits
  let name = "Untitled";
  for (const l of lines.slice(0, 5)) {
    const words = l.split(/\s+/);
    if (words.length >= 2 && words.length <= 5 && !/\d/.test(l) && l.length < 60) {
      name = l.replace(/[^a-zA-Z\s.\-']/g, "").trim() || name;
      break;
    }
  }

  const emailMatch = joined.match(EMAIL_RE);
  const phoneMatch = joined.match(PHONE_RE);
  const urlMatches = Array.from(joined.matchAll(new RegExp(URL_RE.source, "gi"))).map((m) => m[0]);
  const linkedin = urlMatches.find((u) => /linkedin/i.test(u));
  const github = urlMatches.find((u) => /github/i.test(u));
  const website = urlMatches.find((u) => !/linkedin|github/i.test(u));

  // Try to find a location pattern near the top
  // Allow 1-3 capitalized words before the comma (e.g. "San Francisco, CA", "New York City, NY").
  // Also allow capitalized country/state names after the comma (e.g. "Rabat, Morocco", "London, United Kingdom").
  const locationLine = lines.slice(0, 12).find((l) => /\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2},\s?[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\b/.test(l));
  const location = locationLine?.match(/\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2},\s?[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\b/)?.[1];

  // Sections — match common headers
  const sectionIndex = (labels: string[]) =>
    lines.findIndex((l) => labels.some((lbl) => new RegExp(`^\\s*${lbl}\\s*:?$`, "i").test(l)));

  const expStart = sectionIndex(["experience", "work experience", "professional experience", "employment"]);
  const eduStart = sectionIndex(["education", "academic background"]);
  const skillsStart = sectionIndex(["skills", "technical skills", "core skills", "core competencies"]);
  const projStart = sectionIndex(["projects", "side projects", "personal projects"]);
  const certStart = sectionIndex(["certifications", "certificates", "licenses"]);
  const langStart = sectionIndex(["languages"]);
  const achStart = sectionIndex(["achievements", "key achievements", "awards", "honors", "awards & honors"]);
  const summaryStart = sectionIndex(["summary", "professional summary", "profile", "objective"]);

  const nextSectionStart = (start: number) => {
    if (start < 0) return lines.length;
    const candidates = [expStart, eduStart, skillsStart, projStart, certStart, langStart, achStart, summaryStart]
      .filter((i) => i > start);
    return candidates.length ? Math.min(...candidates) : lines.length;
  };

  const sliceSection = (start: number) => {
    if (start < 0) return [] as string[];
    return lines.slice(start + 1, nextSectionStart(start));
  };

  const summary = summaryStart >= 0 ? sliceSection(summaryStart).join(" ").trim() : undefined;

  // Experience: parse blocks separated by blank lines or company/title patterns
  const expLines = sliceSection(expStart);
  const experience = parseExperiences(expLines);

  // Education
  const eduLines = sliceSection(eduStart);
  const education = parseEducation(eduLines);

  // Skills
  const skillLines = sliceSection(skillsStart);
  const skills = skillLines
    .flatMap((l) => l.split(/[,;•|]/))
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length < 40)
    .map((s) => ({ id: uid("s"), name: s }));

  // Projects — split by blank lines or "•"/"-" prefixed entries to support multiple projects
  const projLines = sliceSection(projStart);
  const projects = parseProjects(projLines);

  // Certifications
  const certLines = sliceSection(certStart);
  const certifications = certLines.map((c) => ({ id: uid("c"), name: c }));

  // Languages — try to detect proficiency from common patterns like "English (Fluent)" or "French: Native"
  const langLines = sliceSection(langStart);
  const languages = langLines
    .flatMap((l) => l.split(/[,;]/))
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      // Try to extract proficiency from patterns like "English (Fluent)" or "French: Native"
      const match = s.match(/^([A-Za-z]+)\s*[\(:]\s*(Native|Fluent|Proficient|Conversational|Intermediate|Basic|Advanced|Professional)\s*\)?$/i);
      if (match) {
        const proficiency = match[2].toLowerCase();
        const normalizedProf = (["basic", "conversational", "fluent", "native"].includes(proficiency) ? proficiency : "fluent") as "basic" | "conversational" | "fluent" | "native";
        return { id: uid("l"), name: match[1], proficiency: normalizedProf };
      }
      return { id: uid("l"), name: s, proficiency: "fluent" as const };
    });

  // Achievements (new — extracted as an array of { title, description })
  const achLines = sliceSection(achStart);
  const achievements = achLines.map((line) => ({
    id: uid("a"),
    title: line.length > 60 ? line.slice(0, 57) + "…" : line,
    description: line,
  }));

  const now = new Date().toISOString();
  return {
    id: uid("r"),
    name,
    headline: lines[1] && lines[1].length < 60 ? lines[1] : undefined,
    contact: {
      email: emailMatch?.[1],
      phone: phoneMatch?.[1]?.trim(),
      location,
      website,
      linkedin,
      github,
    },
    summary,
    experience,
    education,
    skills,
    projects,
    certifications,
    languages,
    achievements: achievements.map((a) => a.title),
    template: "ats-professional",
    accentColor: "#1154A3",
    createdAt: now,
    updatedAt: now,
    source: "upload",
    fileName,
  };
}

const DATE_RANGE_RE = /(?:(?:\w+\s+\d{4})|(?:\d{4}))\s*(?:[\-–—]|\bto\b)\s*(?:present|(?:\w+\s+\d{4})|(?:\d{4}))|(?:\w+\s*(?:[\-–—]|\bto\b)\s*\w+\s+\d{4})/i;

/**
 * Common title-ending keywords. When the left side of "Title Company | Location"
 * contains one of these, the company likely starts right after it.
 *
 * Examples:
 *   "Senior Customer Experience Specialist Vercel" → split after "Specialist"
 *   "Customer Experience Associate Airbnb"          → split after "Associate"
 *   "Technical Support Specialist University of ..." → split after "Specialist"
 *
 * The list is ordered roughly by specificity (rarer endings first).
 */
const TITLE_END_KEYWORDS = [
  // Senior-level / leadership
  "Manager", "Director", "Lead", "Head", "Chief", "Officer", "President",
  "VP", "SVP", "EVP", "CFO", "CEO", "CTO", "COO", "CIO", "CMO",
  // Individual contributors
  "Engineer", "Developer", "Designer", "Architect", "Analyst", "Consultant",
  "Specialist", "Associate", "Assistant", "Coordinator", "Administrator",
  "Representative", "Agent", "Intern", "Trainee", "Apprentice",
  // Industry-specific
  "Pilot", "Captain", "Lieutenant", "Sergeant", "Officer", "Marshal",
  "Nurse", "Therapist", "Technician", "Mechanic", "Electrician",
  "Teacher", "Professor", "Lecturer", "Instructor", "Tutor",
  "Accountant", "Auditor", "Banker", "Trader", "Broker",
  "Lawyer", "Attorney", "Paralegal", "Judge",
  "Writer", "Editor", "Reporter", "Journalist",
  "Chef", "Cook", "Baker", "Host", "Hostess", "Waiter", "Waitress",
];

/**
 * Try to split "Title Company" into { title, company } by looking for a
 * title-ending keyword. The company is everything after the keyword.
 *
 * Returns null if no keyword is found.
 *
 * Examples:
 *   "Senior Customer Experience Specialist Vercel"
 *     → { title: "Senior Customer Experience Specialist", company: "Vercel" }
 *
 *   "Technical Support Specialist University of California, Berkeley"
 *     → { title: "Technical Support Specialist",
 *         company: "University of California, Berkeley" }
 *
 *   "Customer Experience Associate Airbnb"
 *     → { title: "Customer Experience Associate", company: "Airbnb" }
 */
function splitTitleAndCompany(combined: string): { title: string; company: string } | null {
  const trimmed = combined.trim();
  if (!trimmed) return null;

  let bestSplit: { title: string; company: string; index: number } | null = null;

  // Try each keyword — find the one furthest to the right that appears as a whole word.
  // We use word boundaries to avoid matching "Manager" inside "Management".
  for (const kw of TITLE_END_KEYWORDS) {
    // Build a regex that matches the keyword as a whole word, case-insensitive.
    // Allow a trailing period (e.g. "Mgr.").
    const re = new RegExp(`\\b${kw.replace(/\./g, "\\.")}\\b`, "i");
    const match = trimmed.match(re);
    if (!match) continue;
    if (match.index === undefined) continue;

    const endPos = match.index + match[0].length;
    const title = trimmed.slice(0, endPos).trim();
    const company = trimmed.slice(endPos).trim();

    // Sanity: company should be non-empty AND not just punctuation.
    if (!company || !/[A-Za-z0-9]/.test(company)) continue;

    // Sanity: title should be at least 2 words (avoid matching single-word titles).
    const titleWords = title.split(/\s+/);
    if (titleWords.length < 2 && title.toLowerCase() !== kw.toLowerCase()) continue;

    if (bestSplit === null || match.index > bestSplit.index) {
      bestSplit = { title, company, index: match.index };
    }
  }

  return bestSplit ? { title: bestSplit.title, company: bestSplit.company } : null;
}

function parseExperiences(lines: string[]): ResumeData["experience"] {
  if (!lines.length) return [];
  const out: ResumeData["experience"] = [];
  let current: ResumeData["experience"][number] | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    const dateMatch = trimmed.match(DATE_RANGE_RE);

    if (dateMatch && trimmed.length > 20 && !trimmed.startsWith('•') && !trimmed.startsWith('-')) {
      if (current) out.push(current);

      const dateStr = dateMatch[0];
      const dateRange = parseDateRange(dateStr);

      let cleanLine = trimmed.replace(dateStr, '').trim();
      cleanLine = cleanLine.replace(/^[:\s,—–\-|·•▪◦]+/, '').replace(/[:\s,—–\-|·•▪◦]+$/, '').trim();

      let title = cleanLine;
      let company = "";
      let location = "";

      // === Strategy 1: Split on " | " — left side is "Title Company", right side is "Location" ===
      // This is the most common modern resume format:
      //   "Senior Customer Experience Specialist Vercel | Remote Mar 2022 – Present"
      // After dateStr removal: "Senior Customer Experience Specialist Vercel | Remote"
      // We then need to split the LEFT side into title + company.
      const pipeParts = cleanLine.split(/\s*\|\s*/);
      if (pipeParts.length >= 2) {
        const leftSide = pipeParts[0].trim();
        const rightSide = pipeParts.slice(1).join(" | ").trim();

        // The right side is the LOCATION (not the company).
        // The left side contains both title and company — try to split them.
        const split = splitTitleAndCompany(leftSide);
        if (split) {
          title = split.title;
          company = split.company;
          location = rightSide;
        } else {
          // Couldn't split left side — assume the entire left is the title and
          // the right side might be the company (legacy fallback).
          title = leftSide;
          company = rightSide;
          location = "";
        }
      } else {
        // === Strategy 2: Split on " at " / " AT " ===
        // Format: "Title at Company Location Dates" (after date removal: "Title at Company Location")
        const atMatch = cleanLine.match(/^(.+?)\s+(?:at|AT|@)\s+(.+)$/);
        if (atMatch) {
          title = atMatch[1].trim();
          const rest = atMatch[2].trim();
          // The rest could be "Company Location" — try to find the location (last comma-separated part)
          const commaParts = rest.split(/,/);
          if (commaParts.length >= 2) {
            // Last comma-part is likely "City, State" or just "State" — combine the last 1-2 parts as location
            company = commaParts.slice(0, -1).join(",").trim();
            location = commaParts.slice(-1)[0].trim();
            // If location looks like a 2-letter state code, also include the previous part
            if (/^[A-Z]{2}$/.test(location) && commaParts.length >= 3) {
              company = commaParts.slice(0, -2).join(",").trim();
              location = commaParts.slice(-2).join(",").trim();
            }
          } else {
            // No comma — try title-end keyword split
            const split = splitTitleAndCompany(rest);
            if (split) {
              company = split.title; // everything before the keyword becomes the "company" — but that's wrong
              // Actually, "at" already split title from company. So `rest` is just "Company Location".
              // Try title-end keyword on `rest` to extract location.
              company = rest;
              location = "";
            } else {
              company = rest;
              location = "";
            }
          }
        } else {
          // === Strategy 3: No " | " and no " at " — try title-end keyword split on the whole line ===
          // Format: "Title Company Location Dates" — after date removal: "Title Company Location"
          const split = splitTitleAndCompany(cleanLine);
          if (split) {
            title = split.title;
            // `split.company` may contain "Company Location" — try to extract location (last comma part)
            const compParts = split.company.split(/,/);
            if (compParts.length >= 2) {
              company = compParts.slice(0, -1).join(",").trim();
              location = compParts.slice(-1)[0].trim();
              if (/^[A-Z]{2}$/.test(location) && compParts.length >= 3) {
                company = compParts.slice(0, -2).join(",").trim();
                location = compParts.slice(-2).join(",").trim();
              }
            } else {
              company = split.company;
              location = "";
            }
          } else {
            // === Strategy 4: Legacy comma split ===
            const commaParts = cleanLine.split(',');
            if (commaParts.length >= 2) {
              title = commaParts[0].trim();
              company = commaParts[1].trim();
              if (commaParts.length > 2) {
                location = commaParts.slice(2).join(', ').trim();
              }
            }
          }
        }
      }

      current = {
        id: uid("e"),
        title,
        company,
        location,
        startDate: dateRange.start,
        endDate: dateRange.end,
        bullets: [],
      };
    } else if (current) {
      const cleaned = trimmed.replace(/^[•\-*·▪◦]\s*/, "").trim();
      if (cleaned) current.bullets.push(cleaned);
    } else {
      current = {
        id: uid("e"),
        title: trimmed,
        company: "",
        location: "",
        startDate: "",
        endDate: "",
        bullets: [],
      };
    }
  }

  if (current) out.push(current);
  return out;
}

function parseDateRange(s: string): { start: string; end: string } {
  // Try splitting on common date separators: -, –, —, "to"
  const parts = s.split(/\s*(?:[\-–—]|\bto\b)\s*/i).filter(Boolean);
  if (parts.length === 2) {
    let start = parts[0].trim();
    let end = parts[1].trim();
    return { start, end };
  }
  // If only one part and it looks like a single year, use it as startDate
  // with empty endDate (NOT "Present" — that was the bug)
  if (parts.length === 1) {
    return { start: parts[0].trim(), end: "" };
  }
  // Can't parse — return empty (NOT "Present")
  return { start: s, end: "" };
}

function parseEducation(lines: string[]): ResumeData["education"] {
  if (!lines.length) return [];

  // Split into entries by blank lines OR by lines that look like a degree/institution header.
  // A "header" line is one that contains a degree keyword (B.S., M.S., PhD, Bachelor, Master, etc.)
  // or a year range (2014-2018, 2014 - 2018, 2014–2018).
  const degreePattern = /\b(b\.?\s?s\.?|b\.?\s?a\.?|b\.?\s?eng\.?|b\.?\s?tech|m\.?\s?s\.?|m\.?\s?a\.?|mba|ph\.?d|bachelor|master|doctorate|diploma|certificate|associate|degree|high\s+school)\b/i;
  const yearRangePattern = /\b(19|20)\d{2}\s*[–\-]\s*(19|20)\d{2}\b|\b(19|20)\d{2}\s*[–\-]\s*present\b/i;

  const entries: string[][] = [];
  let current: string[] = [];

  for (const line of lines) {
    const isHeader = degreePattern.test(line) || yearRangePattern.test(line);
    // If we hit a header line and we already have content in current, start a new entry
    if (isHeader && current.length > 0) {
      entries.push(current);
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) entries.push(current);

  // If we only found 1 entry via splitting, but it has many lines, try splitting by blank-line gaps
  if (entries.length === 1 && lines.length > 5) {
    const blankSplit: string[][] = [];
    let curr: string[] = [];
    for (const line of lines) {
      if (line === "") {
        if (curr.length > 0) blankSplit.push(curr);
        curr = [];
      } else {
        curr.push(line);
      }
    }
    if (curr.length > 0) blankSplit.push(curr);
    if (blankSplit.length > 1) {
      entries.length = 0;
      entries.push(...blankSplit);
    }
  }

  // Parse each entry
  return entries.map((entryLines) => {
    // Try to extract year range from any line
    let startDate = "";
    let endDate = "";
    for (const l of entryLines) {
      const yrMatch = l.match(/\b(19|20)\d{2}\b/g);
      if (yrMatch && yrMatch.length >= 2) {
        startDate = yrMatch[0];
        endDate = yrMatch[1];
        break;
      } else if (yrMatch && yrMatch.length === 1) {
        startDate = yrMatch[0];
        if (/present/i.test(l)) endDate = "Present";
        break;
      }
    }

    // First line with a degree keyword → degree; next line → institution
    let degree = "";
    let institution = "";
    let field = "";
    let location = "";
    const highlights: string[] = [];

    // === Institution keyword detection ===
    // Common patterns: "University of X", "X University", "X College", "X Institute",
    // "X School of Y". When the degree line contains one of these, the institution
    // name is likely embedded in the same line.
    const INST_KEYWORDS = /\b(University|College|Institute|School|Academy|Polytechnic|Conservatory)\b/i;

    for (let i = 0; i < entryLines.length; i++) {
      const l = entryLines[i];
      // Strip leading bullet markers and pipe characters
      const cleanedLine = l.replace(/^[•\-\*·▪◦\s|]+/, "").trim();
      if (!cleanedLine) continue;

      if (!degree && degreePattern.test(cleanedLine)) {
        // First, strip the trailing " | YEAR – YEAR" or " | YEAR" suffix
        const lineWithoutDate = cleanedLine
          .replace(/\s*\|\s*\d{4}\s*[–\-]\s*\d{4}\s*$/, "")
          .replace(/\s*\|\s*\d{4}\s*[–\-]\s*present\s*$/i, "")
          .replace(/\s*\|\s*\d{4}\s*$/, "")
          .replace(/\s*\|\s*$/, "")
          .trim();

        // Check if there is a pipe separating degree/institution from location
        let leftSide = lineWithoutDate;
        if (lineWithoutDate.includes("|")) {
          const pipeParts = lineWithoutDate.split("|").map((p) => p.trim());
          leftSide = pipeParts[0];
          location = pipeParts[1] || "";
        }

        // Try to separate degree + field from institution in leftSide.
        // We find the rightmost degree keyword match.
        const degMatches = Array.from(leftSide.matchAll(new RegExp(degreePattern.source, "gi")));
        let bestDegMatch: any = null;
        for (const m of degMatches) {
          if (m.index !== undefined) {
            if (bestDegMatch === null || m.index > bestDegMatch.index) {
              bestDegMatch = m;
            }
          }
        }

        if (bestDegMatch) {
          let kwEnd = bestDegMatch.index + bestDegMatch[0].length;
          // Consume trailing dot (e.g. "B.S.") so it is included in degree
          if (leftSide[kwEnd] === ".") {
            kwEnd++;
          }
          degree = leftSide.slice(0, kwEnd).trim();

          const afterKw = leftSide.slice(kwEnd);
          // Look for an optional "in/of/with [Field]" suffix followed by an institution keyword, comma, pipe, or end of line
          const fieldMatch = afterKw.match(/^\s+(?:of|in|with)\s+([A-Za-z\s&]+?)(?=\s+(?:University|College|Institute|School|Academy|Polytechnic|Conservatory|,|\|)|$)/i);
          if (fieldMatch) {
            field = fieldMatch[1].trim();
            institution = afterKw.slice(fieldMatch[0].length).trim();
          } else {
            institution = afterKw.trim();
          }
        } else {
          degree = leftSide;
        }

        // Fallback: If no institution was extracted via keyword boundary, try INST_KEYWORDS
        if (!institution) {
          const instMatch = lineWithoutDate.match(INST_KEYWORDS);
          if (instMatch && instMatch.index !== undefined) {
            const instStart = instMatch.index;
            institution = lineWithoutDate.slice(instStart).trim();
            if (field) {
              const fieldInstIdx = field.toLowerCase().indexOf(instMatch[0].toLowerCase());
              if (fieldInstIdx >= 0) {
                field = field.slice(0, fieldInstIdx).trim();
              }
            }
          }
        }
      } else if (!institution && !degreePattern.test(cleanedLine) && !yearRangePattern.test(cleanedLine) && !/^[•\-\*·▪◦]/.test(cleanedLine)) {
        // Only use this line as institution if we haven't already extracted one
        // from the degree line, AND it's not a bullet line.
        institution = cleanedLine;
      } else if (i > 0 && !yearRangePattern.test(cleanedLine)) {
        // Highlight (bullet) line
        const highlightText = cleanedLine.replace(/^[•\-\*·▪◦\s]+/, "").trim();
        if (highlightText && !degreePattern.test(highlightText)) {
          highlights.push(highlightText);
        }
      }
    }

    // Fallback: if no degree found, use first line as institution, second as degree
    if (!degree && !institution) {
      const firstNonBullet = entryLines.find((l) => !/^[•\-\*·▪◦]/.test(l.trim())) || entryLines[0] || "Institution";
      institution = firstNonBullet.replace(/^[•\-\*·▪◦\s|]+/, "").trim() || "Institution";
      degree = entryLines[1]?.replace(/^[•\-\*·▪◦\s|]+/, "").trim() || "Degree";
      highlights.push(...entryLines.slice(2, 4).map((l) => l.replace(/^[•\-\*·▪◦\s|]+/, "").trim()).filter(Boolean));
    } else if (!institution) {
      // Last-resort fallback: look for any non-degree, non-year, non-bullet line
      const fallbackInst = entryLines.find((l) => {
        const c = l.replace(/^[•\-\*·▪◦\s|]+/, "").trim();
        return c && l !== degree && !degreePattern.test(c) && !yearRangePattern.test(c) && !/^[•\-\*·▪◦]/.test(l.trim());
      });
      institution = fallbackInst?.replace(/^[•\-\*·▪◦\s|]+/, "").trim() || "Institution";
    }

    return {
      id: uid("ed"),
      institution,
      degree,
      field: field || undefined,
      location: location || undefined,
      startDate,
      endDate,
      highlights: highlights.slice(0, 4),
    };
  });
}

/**
 * Parse the projects section into multiple project entries.
 * Previously this collapsed all projects into a single entry — now it splits
 * by blank lines OR by lines starting with bullet markers (•, -, *) or
 * numbered entries (1., 2.).
 */
function parseProjects(lines: string[]): ResumeData["projects"] {
  if (!lines.length) return [];

  // Split into project blocks
  const blocks: string[][] = [];
  let current: string[] = [];

  for (const line of lines) {
    const isBulletStart = /^[•\-\*]\s+/.test(line);
    const isNumberedStart = /^\d+\.\s+/.test(line);
    const isHeader = (isBulletStart || isNumberedStart) && current.length > 0;

    if (isHeader) {
      blocks.push(current);
      current = [line.replace(/^[•\-\*]\s+/, "").replace(/^\d+\.\s+/, "")];
    } else if (isBulletStart || isNumberedStart) {
      current.push(line.replace(/^[•\-\*]\s+/, "").replace(/^\d+\.\s+/, ""));
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) blocks.push(current);

  // If no bullet/numbered structure detected, try splitting by blank lines
  if (blocks.length === 1 && lines.length > 3) {
    const blankSplit: string[][] = [];
    let curr: string[] = [];
    for (const line of lines) {
      if (line === "") {
        if (curr.length > 0) blankSplit.push(curr);
        curr = [];
      } else {
        curr.push(line);
      }
    }
    if (curr.length > 0) blankSplit.push(curr);
    if (blankSplit.length > 1) {
      blocks.length = 0;
      blocks.push(...blankSplit);
    }
  }

  return blocks.map((blockLines) => ({
    id: uid("p"),
    name: blockLines[0] || "Project",
    description: blockLines.slice(1).join(" ").trim() || undefined,
    bullets: blockLines.slice(1).filter((l) => l.startsWith("•") || l.startsWith("-")).map((l) => l.replace(/^[•\-]\s*/, "")),
  }));
}

/**
 * Create a blank resume from a template.
 */
export function blankResume(name = "Untitled Resume"): ResumeData {
  const now = new Date().toISOString();
  return {
    id: uid("r"),
    name: "Your Name",
    headline: "Your Professional Title",
    contact: { email: "you@example.com", phone: "", location: "" },
    summary: "Write a 2-3 line professional summary highlighting your years of experience, core expertise, and a measurable outcome.",
    experience: [
      {
        id: uid("e"),
        company: "Company Name",
        title: "Job Title",
        location: "",
        startDate: "2022-01",
        endDate: "Present",
        bullets: ["Achievement with measurable outcome (e.g. 'Increased conversion by 18%').", "Second achievement highlighting scope and impact."],
      },
    ],
    education: [
      {
        id: uid("ed"),
        institution: "University Name",
        degree: "B.S.",
        field: "Your Field",
        startDate: "2014-09",
        endDate: "2018-05",
      },
    ],
    skills: [
      { id: uid("s"), name: "Skill 1", category: "Category" },
      { id: uid("s"), name: "Skill 2", category: "Category" },
      { id: uid("s"), name: "Skill 3", category: "Category" },
    ],
    projects: [],
    certifications: [],
    languages: [],
    template: "ats-professional",
    accentColor: "#1154A3",
    createdAt: now,
    updatedAt: now,
    source: "manual",
  };
}
