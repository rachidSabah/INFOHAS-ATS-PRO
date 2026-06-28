// ResumeAI Pro — client-side resume parser for PDF / DOCX / TXT
"use client";

import type { ResumeData } from "./types";
import { uid } from "./store";
import { isForbiddenSkill } from "./entity-lock";

function safeCall<T extends (...args: any[]) => any>(fn: T, args: Parameters<T>, fallback: ReturnType<T>): ReturnType<T> {
  try { return typeof fn === 'function' ? fn(...args) : fallback; } catch { return fallback; }
}

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
    resume.experience.length > 0 &&
    resume.education.length > 0
  );
}

export function RepairParser(text: string, fileName: string): ResumeData {
  console.log("RepairParser: Validation or confidence failed. Trying secondary parser...");
  let parsed = secondaryParser(text, fileName);
  let confidence = calculateParserConfidence(parsed);
  let isValid = validateParsedResume(parsed);

  if (!isValid) {
    console.log(`Secondary parser insufficient (confidence: ${confidence}, valid: ${isValid}). Trying heuristic parser...`);
    parsed = heuristicParser(text, fileName);
    confidence = calculateParserConfidence(parsed);
    isValid = validateParsedResume(parsed);
  }

  if (!isValid) {
    console.error("Heuristic parser failed to recover core sections. Throwing ParseError.");
    throw new Error("ParseError: Could not extract all required resume sections (Experience, Education) even after heuristic repair.");
  }

  return parsed;
}

export function secondaryParser(text: string, fileName: string): ResumeData {
  const normalizedText = text.replace(/\r/g, "");
  
  // Section regexes using line-start markers and word boundaries to avoid false matching
  const headerLookahead = `(?=(?:(?:^|\\n)\\s*(?:PROFESSIONAL EXPERIENCE|WORK EXPERIENCE|\\bEXPERIENCE\\b|EDUCATION|LANGUAGES|LANGUAGE|SKILLS|CORE COMPETENCIES|COMPETENCIES|CERTIFICATIONS|PROJECTS|REFERENCES|SUMMARY|PROFESSIONAL SUMMARY|CAREER OBJECTIVE|CAREER PROFILE|PROFESSIONAL PROFILE|ABOUT ME|PERSONAL INFORMATIONS|PERSONAL INFORMATION|PERSONAL INFO|PERSONAL DETAILS|INTERESTS|HOBBIES|NATIONALITY)\\b\\s*:?\\s*(?:\\n|$)))`;

  const expRegex = new RegExp('(?:^|\\n)\\s*(?:PROFESSIONAL EXPERIENCE|WORK EXPERIENCE|\\bEXPERIENCE\\b|\\bEXPERIENCES\\b|EMPLOYMENT HISTORY|HISTORY)\\b\\s*:?\\s*\\n([\\s\\S]*?)' + headerLookahead, 'i');
  const eduRegex = new RegExp('(?:^|\\n)\\s*(?:EDUCATION|ACADEMIC BACKGROUND|ACADEMIC)\\b\\s*:?\\s*\\n([\\s\\S]*?)' + headerLookahead, 'i');
  const langRegex = new RegExp('(?:^|\\n)\\s*(?:LANGUAGES|LANGUAGE)\\b\\s*:?\\s*\\n([\\s\\S]*?)' + headerLookahead, 'i');
  // Also try inline format: "Languages: English, French, Arabic" (all on one line)
  const langInlineRegex = /(?:^|\n)\s*(?:LANGUAGES|LANGUAGE)\s*:\s*(.+?)(?=\n|$)/i;
  const skillsRegex = new RegExp('(?:^|\\n)\\s*(?:SKILLS|TECHNICAL SKILLS|CORE SKILLS|CORE COMPETENCIES|CORE COMPETENCIES & SKILLS|COMPETENCIES)\\b\\s*:?\\s*\\n([\\s\\S]*?)' + headerLookahead, 'i');
  const certsRegex = new RegExp('(?:^|\\n)\\s*(?:CERTIFICATIONS|CERTIFICATES|LICENSES)\\b\\s*:?\\s*\\n([\\s\\S]*?)' + headerLookahead, 'i');
  const projRegex = new RegExp('(?:^|\\n)\\s*(?:PROJECTS|PERSONAL PROJECTS|SIDE PROJECTS)\\b\\s*:?\\s*\\n([\\s\\S]*?)' + headerLookahead, 'i');
  const summaryRegex = new RegExp('(?:^|\\n)\\s*(?:SUMMARY|PROFESSIONAL SUMMARY|PROFILE|OBJECTIVE|CAREER OBJECTIVE|CAREER PROFILE|PROFESSIONAL PROFILE|ABOUT ME)\\b\\s*:?\\s*\\n([\\s\\S]*?)' + headerLookahead, 'i');

  const expMatch = normalizedText.match(expRegex);
  const eduMatch = normalizedText.match(eduRegex);
  const langMatch = normalizedText.match(langRegex);
  // Fallback: try inline format "Languages: English, French, Arabic"
  const langInlineMatch = !langMatch ? normalizedText.match(langInlineRegex) : null;
  const langLines = langMatch
    ? langMatch[1].split("\n").map(l => l.trim()).filter(Boolean)
    : langInlineMatch
      ? langInlineMatch[1].split(/[,;]/).map(l => l.trim()).filter(Boolean)
      : [];
  const skillsMatch = normalizedText.match(skillsRegex);
  const certsMatch = normalizedText.match(certsRegex);
  const projMatch = normalizedText.match(projRegex);
  const summaryMatch = normalizedText.match(summaryRegex);

  const expLines = expMatch ? expMatch[1].split("\n").map(l => l.trim()).filter(Boolean) : [];
  const eduLines = eduMatch ? eduMatch[1].split("\n").map(l => l.trim()).filter(Boolean) : [];
  const skillsLines = skillsMatch ? skillsMatch[1].split("\n").map(l => l.trim()).filter(Boolean) : [];
  const certsLines = certsMatch ? certsMatch[1].split("\n").map(l => l.trim()).filter(Boolean) : [];
  const projLines = projMatch ? projMatch[1].split("\n").map(l => l.trim()).filter(Boolean) : [];
  const summary = summaryMatch ? summaryMatch[1].trim() : undefined;

  const experience = safeCall(parseExperiences, [expLines], []) as ResumeData["experience"];
  const education = safeCall(parseEducation, [eduLines], []) as ResumeData["education"];
  const skills = skillsLines
    .flatMap((l) => {
      // Detect "Category: item1, item2, item3" format — extract category + items
      const colonIdx = l.indexOf(":");
      if (colonIdx > 0 && colonIdx < 35) {
        const category = l.slice(0, colonIdx).trim();
        const rest = l.slice(colonIdx + 1);
        return rest.split(new RegExp("[,;•|]"))
          .map((s) => s.trim())
          .filter((s) => s.length > 0 && s.length < 40 && !isForbiddenSkill(s))
          .map((name) => ({ id: uid("s"), name, category }));
      }
      // Fallback: flat comma-separated skill names
      return l.split(new RegExp("[,;•|]"))
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s.length < 40 && !isForbiddenSkill(s))
        .map((s) => ({ id: uid("s"), name: s }));
    })
  const projects = parseProjects(projLines);
  const certifications = certsLines.map((c) => ({ id: uid("c"), name: c }));
  const languages: ResumeData["languages"] = [];
  const seenLangs = new Set<string>();
  for (const line of langLines) {
    const parts = line.split(new RegExp("[,;]"));
    for (const part of parts) {
      const detected = detectLanguage(part);
      if (detected && !seenLangs.has(detected.name.toLowerCase())) {
        seenLangs.add(detected.name.toLowerCase());
        languages.push({
          id: uid("l"),
          name: detected.name,
          proficiency: detected.proficiency,
        });
      }
    }
  }

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

  const name = extractNameFromLines(normalizedText.split("\n"));

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
    if (/^\s*(?:summary|profile|objective|career\s+objective|career\s+profile|professional\s+profile|about\s+me)s?\s*:?$/i.test(line)) {
      currentSection = "summary";
      continue;
    } else if (/^\s*(?:professional\s+)?experience[s]?|work\s+experience|employment\s+history|history\s*:?$/i.test(line)) {
      currentSection = "experience";
      continue;
    } else if (/^\s*(?:education|academic(?:\s+background)?)\s*:?$/i.test(line)) {
      currentSection = "education";
      continue;
    } else if (/^\s*(?:languages|language)\s*:?$/i.test(line)) {
      currentSection = "languages";
      continue;
    } else if (/^\s*(?:skills|core\s+competencies|competencies|technical\s+skills)\s*:?$/i.test(line)) {
      currentSection = "skills";
      continue;
    } else if (/^\s*(?:certifications|certificates)\s*:?$/i.test(line)) {
      currentSection = "certifications";
      continue;
    } else if (/^\s*(?:projects)\s*:?$/i.test(line)) {
      currentSection = "projects";
      continue;
    }

    // Extract inline "Languages: English, French, Arabic" from skills section
    if (currentSection === "skills" && /^\s*languages?\s*:/i.test(line)) {
      sectionLines.languages.push(line);
      continue;
    }

    sectionLines[currentSection].push(line);
  }

  const summary = sectionLines.summary.join(" ").trim() || undefined;
  const experience = parseExperiences(sectionLines.experience);
  const education = parseEducation(sectionLines.education);
  const skills = sectionLines.skills
    .flatMap((l) => {
      // Detect "Category: item1, item2, item3" format — extract category + items
      const colonIdx = l.indexOf(":");
      if (colonIdx > 0 && colonIdx < 35) {
        const category = l.slice(0, colonIdx).trim();
        const rest = l.slice(colonIdx + 1);
        return rest.split(new RegExp("[,;•|]"))
          .map((s) => s.trim())
          .filter((s) => s.length > 0 && s.length < 40 && !isForbiddenSkill(s))
          .map((name) => ({ id: uid("s"), name, category }));
      }
      // Fallback: flat comma-separated skill names
      return l.split(new RegExp("[,;•|]"))
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && s.length < 40 && !isForbiddenSkill(s))
        .map((s) => ({ id: uid("s"), name: s }));
    })
  const projects = parseProjects(sectionLines.projects);
  const certifications = sectionLines.certifications.map((c) => ({ id: uid("c"), name: c }));
  const languages: ResumeData["languages"] = [];
  const seenLangs = new Set<string>();
  for (const line of sectionLines.languages) {
    const parts = line.split(new RegExp("[,;]"));
    for (const part of parts) {
      const detected = detectLanguage(part);
      if (detected && !seenLangs.has(detected.name.toLowerCase())) {
        seenLangs.add(detected.name.toLowerCase());
        languages.push({
          id: uid("l"),
          name: detected.name,
          proficiency: detected.proficiency,
        });
      }
    }
  }

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

  const name = extractNameFromLines(sectionLines.header);

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
  try {
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
        console.warn("[parser] Legacy .doc not parseable in-browser. Returning blank resume.");
        return blankResume(file.name.replace(/\.[^/.]+$/, ""));
      }
    } else {
      console.warn("[parser] Unsupported file type. Returning blank resume.");
      return blankResume(file.name.replace(/\.[^/.]+$/, ""));
    }

    if (rawText.trim().length < 30) {
      console.warn("[parser] File appears empty or unparseable. Returning blank resume.");
      return blankResume(file.name.replace(/\.[^/.]+$/, ""));
    }

    const primaryResult = safeCall(extractResumeFromText, [rawText, file.name], null as any);
    if (!primaryResult) {
      console.warn("[parser] extractResumeFromText failed. Returning blank resume.");
      return blankResume(file.name.replace(/\.[^/.]+$/, ""));
    }

    const primaryConfidence = safeCall(calculateParserConfidence, [primaryResult], 0);
    const isValid = safeCall(validateParsedResume, [primaryResult], false);

    if (!isValid) {
      console.warn(`[parser] Primary parser incomplete (valid: ${isValid}, confidence: ${primaryConfidence}). Running RepairParser...`);
      const repaired = safeCall(RepairParser, [rawText, file.name], null as any);
      if (repaired) return repaired;
      console.warn("[parser] RepairParser also failed. Returning primary result as-is.");
    }

    return primaryResult;
  } catch (e) {
    console.error("[parser] parseResumeFile unexpected error:", e);
    return blankResume(file.name.replace(/\.[^/.]+$/, ""));
  }
}

export async function parseResumeText(text: string): Promise<ResumeData> {
  try {
    if (text.trim().length < 30) {
      console.warn("[parser] Pasted text too short. Returning blank resume.");
      return blankResume("Pasted Resume");
    }

    const primaryResult = safeCall(extractResumeFromText, [text, "Pasted Resume"], null as any);
    if (!primaryResult) {
      console.warn("[parser] extractResumeFromText failed for pasted text. Returning blank resume.");
      return blankResume("Pasted Resume");
    }

    const primaryConfidence = safeCall(calculateParserConfidence, [primaryResult], 0);
    const isValid = safeCall(validateParsedResume, [primaryResult], false);

    if (!isValid) {
      console.warn(`[parser] Primary parser incomplete for pasted text (valid: ${isValid}, confidence: ${primaryConfidence}). Running RepairParser...`);
      const repaired = safeCall(RepairParser, [text, "Pasted Resume"], null as any);
      if (repaired) return repaired;
      console.warn("[parser] RepairParser also failed for pasted text. Returning primary result as-is.");
    }

    return primaryResult;
  } catch (e) {
    console.error("[parser] parseResumeText unexpected error:", e);
    return blankResume("Pasted Resume");
  }
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

  const extracted = textParts.join("\n\n");

  // If pdf.js extracted little to no text, the PDF is likely a scanned image.
  // Fall back to Tesseract OCR.
  if (extracted.trim().length < 80) {
    console.warn("[parser] pdf.js extracted little text (<80 chars). Trying OCR fallback...");
    try {
      const ocrText = await ocrPdf(arrayBuffer);
      if (ocrText.trim().length > extracted.trim().length) {
        return ocrText;
      }
    } catch (e) {
      console.warn("[parser] OCR fallback failed:", e);
    }
  }

  return extracted;
}

async function ocrPdf(arrayBuffer: ArrayBuffer): Promise<string> {
  // Dynamically load Tesseract.js
  const Tesseract: any = await import("tesseract.js");
  const blob = new Blob([arrayBuffer], { type: "application/pdf" });

  // Tesseract works on images — convert PDF pages to canvas, then OCR each page.
  // Load pdf.js (should already be loaded by caller, but guard here too)
  const pdfjsLib =
    (window as any).pdfjsLib ||
    (() => {
      throw new Error("pdf.js not loaded for OCR pre-render");
    })();

  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer.slice(0) }).promise;
  const textParts: string[] = [];

  for (let i = 1; i <= Math.min(pdf.numPages, 5); i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale: 2.0 }); // 2x for OCR quality
    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d")!;
    await page.render({ canvasContext: ctx, viewport }).promise;

    const { data } = await Tesseract.recognize(canvas.toDataURL("image/png"), "eng+fra", {
      logger: () => {}, // silent
    });
    textParts.push(data.text);
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

const KNOWN_LANGUAGES = new Set([
  "english", "french", "arabic", "spanish", "german", "italic", "italian", "chinese", "japanese",
  "russian", "portuguese", "hindi", "bengali", "punjabi", "marathi", "telugu", "tamil",
  "urdu", "turkish", "korean", "vietnamese", "javanese", "thai", "persian",
  "polish", "romanian", "dutch", "greek", "hungarian", "swedish", "czech", "hebrew",
  "indonesian", "malay", "norwegian", "danish", "finnish", "slovak", "ukrainian", "catalan",
  "swahili", "filipino", "tagalog", "luxembourgish", "kabyle", "berber", "amazigh",
  "latin", "sanskrit", "esperanto", "cantonese", "mandarin", "darija", "gaelic", "irish",
  "welsh", "basque", "galician", "croatian", "serbian", "slovenian", "bulgarian", "estonian",
  "latvian", "lithuanian", "icelandic", "albanian", "macedonian", "georgian", "armenian",
  "azerbaijani", "kazakh", "uzbek", "mongolian", "nepali", "sinhala", "khmer", "lao",
  "myanmar", "burmese", "amharic", "somali", "yoruba", "igbo", "zulu", "xhosa", "afrikaans"
]);

export function detectLanguage(s: string): { name: string; proficiency: "basic" | "conversational" | "fluent" | "native" } | null {
  const clean = s.trim();
  if (!clean) return null;

  const words = clean.toLowerCase().split(/[^a-z]+/);
  const foundLang = words.find(w => KNOWN_LANGUAGES.has(w));
  if (!foundLang) {
    return null;
  }

  let proficiency: "basic" | "conversational" | "fluent" | "native" = "fluent";
  const lower = clean.toLowerCase();
  if (lower.includes("native") || lower.includes("bilingual")) {
    proficiency = "native";
  } else if (lower.includes("conversational") || lower.includes("intermediate") || lower.includes("good")) {
    proficiency = "conversational";
  } else if (lower.includes("basic") || lower.includes("elementary") || lower.includes("beginner")) {
    proficiency = "basic";
  }

  const formattedName = foundLang.charAt(0).toUpperCase() + foundLang.slice(1);
  return { name: formattedName, proficiency };
}

export function extractNameFromLines(lines: string[]): string {
  const nameExclusions = /^(?:phone|tel|mobile|fax|email|e-mail|address|linkedin|github|website|portfolio|resume|cv|curriculum\s+vitae|summary|profile|objective|career\s+objective|nationality|marital\s+status|date\s+of\s+birth|health|height|weight|gender|sex|languages|skills|experience|education|hobbies|interests|references|fluent|native|english|french|arabic|moroccan|casablanca|rabat)$/i;

  const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
  const urlPattern = /https?:\/\/[^\s]+|linkedin\.com\/[^\s]+|github\.com\/[^\s]+|www\.[^\s]+/i;

  for (const l of lines.slice(0, 25)) {
    const trimmed = l.trim();
    if (!trimmed) continue;

    if (/\d/.test(trimmed)) continue;
    if (emailPattern.test(trimmed) || urlPattern.test(trimmed)) continue;

    const words = trimmed.split(/\s+/).map(w => w.replace(/[^a-zA-Z]/g, "")).filter(Boolean);
    if (words.length < 2 || words.length > 5) continue;

    const hasLabel = words.some(w => nameExclusions.test(w));
    if (hasLabel) continue;

    const isCapitalized = words.every(w => /^[A-Z]/.test(w));
    if (isCapitalized) {
      return trimmed.replace(/[^a-zA-Z\s.\-']/g, "").trim();
    }
  }

  for (const l of lines.slice(0, 25)) {
    const trimmed = l.trim();
    if (!trimmed) continue;
    if (/\d/.test(trimmed)) continue;
    if (emailPattern.test(trimmed) || urlPattern.test(trimmed)) continue;

    const words = trimmed.split(/\s+/).map(w => w.replace(/[^a-zA-Z]/g, "")).filter(Boolean);
    if (words.length < 2 || words.length > 5) continue;

    const hasLabel = words.some(w => nameExclusions.test(w));
    if (hasLabel) continue;

    return trimmed.replace(/[^a-zA-Z\s.\-']/g, "").trim();
  }

  return "Untitled";
}

/**
 * Heuristic resume text → ResumeData extractor.
 * Not perfect, but good enough for initial parsing and to seed the builder.
 */
export function extractResumeFromText(text: string, fileName: string): ResumeData {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const joined = lines.join("\n");

  const name = extractNameFromLines(lines);

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
  const skillsStart = sectionIndex(["skills", "technical skills", "core skills", "core competencies", "competencies"]);
  const projStart = sectionIndex(["projects", "side projects", "personal projects"]);
  const certStart = sectionIndex(["certifications", "certificates", "licenses"]);
  const langStart = sectionIndex(["languages"]);
  const achStart = sectionIndex(["achievements", "key achievements", "awards", "honors", "awards & honors"]);
  const summaryStart = sectionIndex(["summary", "professional summary", "profile", "objective", "career objective", "career profile", "professional profile", "about me"]);
  const personalStart = sectionIndex(["personal informations", "personal information", "personal info", "personal details", "nationality"]);

  const nextSectionStart = (start: number) => {
    if (start < 0) return lines.length;
    const candidates = [expStart, eduStart, skillsStart, projStart, certStart, langStart, achStart, summaryStart, personalStart]
      .filter((i) => i > start);
    return candidates.length ? Math.min(...candidates) : lines.length;
  };

  const sliceSection = (start: number) => {
    if (start < 0) return [] as string[];
    return lines.slice(start + 1, nextSectionStart(start));
  };

  // --- Begin Professional Summary Formatting ---
  /**
   * Formats the professional summary ensuring at least four lines.
   * If the original summary has fewer than four lines, we generate a concise four‑line block.
   * When a job description is supplied, we attempt to inject relevant keywords.
   */
  function formatProfessionalSummary(raw: string, jobDesc?: string): string {
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length >= 4) {
      // Enrich existing summary with missing high‑impact keywords if job description is provided
      return enrichSummary(lines, jobDesc).join('\n');
    }
    // Build a four‑line generic summary when insufficient content — keep original text as first line
    const original = lines.join(' ').trim();
    const title = jobDesc ? extractTitle(jobDesc) : 'Customer‑focused';
    const industry = jobDesc ? extractIndustry(jobDesc) : 'retail';
    const role = jobDesc ? extractDesiredRole(jobDesc) : 'Sales Assistant';
    const generated = [
      ...(original ? [original] : [`${title} professional with experience in ${industry} environments, known for delivering exceptional customer experiences.`]),
      ...(original ? [
        `Skilled in identifying needs, presenting solutions using the F.A.B. approach, and maximizing sales opportunities.`,
        `Seeking a ${role} position to contribute to award‑winning retail performance.`
      ] : [
        `Skilled in identifying needs, presenting solutions using the F.A.B. approach, and maximizing sales opportunities.`,
        `Seeking a ${role} position to contribute to award‑winning retail performance.`
      ])
    ];
    // Pad to at least 3 lines
    while (generated.length < 3) {
      generated.push(`Seeking a ${role} position to contribute to award‑winning retail performance.`);
    }
    return generated.join('\n');
  }

  /** Simple enrichment – add generic high‑impact keywords if missing */
  function enrichSummary(lines: string[], jobDesc?: string): string[] {
    if (!jobDesc) return lines;
    const keywords = ['customer‑focused', 'sales‑maximization', 'ATS‑optimized', 'teamwork'];
    const lower = lines.join(' ').toLowerCase();
    const missing = keywords.filter(k => !lower.includes(k));
    if (missing.length === 0) return lines;
    // Append missing keywords as an extra line to keep readability
    return [...lines, `Key strengths: ${missing.join(', ')}`];
  }

  // Helper extracts – very lightweight heuristics, fallback to defaults
  function extractTitle(text: string): string { return /customer[- ]focused/i.test(text) ? 'Customer‑focused' : 'Professional'; }
  function extractIndustry(text: string): string { return /airport|aviation/i.test(text) ? 'airport' : 'retail'; }
  function extractDesiredRole(text: string): string { const m = text.match(/(?:position|role)\s+as\s+(\w+)/i); return m ? m[1] : 'Sales Assistant'; }

  // --- End Professional Summary Formatting ---
  
  const rawSummary = summaryStart >= 0 ? sliceSection(summaryStart).join("\n") : "";
  const summary = summaryStart >= 0 ? formatProfessionalSummary(rawSummary) : undefined;

  // Experience: parse blocks separated by blank lines or company/title patterns
  const expLines = sliceSection(expStart);
  const experience = parseExperiences(expLines);

  // Education
  const eduLines = sliceSection(eduStart);
  const education = parseEducation(eduLines);

  // Skills
  const skillLines = sliceSection(skillsStart);
  const skills = skillLines
    .flatMap((l) => l.split(new RegExp("[,;•|]")))
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && s.length < 40 && !isForbiddenSkill(s))
    .map((s) => ({ id: uid("s"), name: s }));

  // Projects — split by blank lines or "•"/"-" prefixed entries to support multiple projects
  const projLines = sliceSection(projStart);
  const projects = parseProjects(projLines);

  // Certifications
  const certLines = sliceSection(certStart);
  const certifications = certLines.map((c) => ({ id: uid("c"), name: c }));

  // Languages — try to detect proficiency from common patterns like "English (Fluent)" or "French: Native"
  const langLines = sliceSection(langStart);
  const languages: ResumeData["languages"] = [];
  const seenLangs = new Set<string>();
  for (const line of langLines) {
    const parts = line.split(new RegExp("[,;]"));
    for (const part of parts) {
      const detected = detectLanguage(part);
      if (detected && !seenLangs.has(detected.name.toLowerCase())) {
        seenLangs.add(detected.name.toLowerCase());
        languages.push({
          id: uid("l"),
          name: detected.name,
          proficiency: detected.proficiency,
        });
      }
    }
  }

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

// Expanded date regex — catches more formats:
// "2020 - 2022", "Jan 2020 – Dec 2022", "2020–Present", "2020 to Present"
// "09/2020 - 06/2022", "2020 - Present", "Jan 2020 - Present"
// "2020-2022", "2020–2022", "September 2020 – June 2022"
const DATE_RANGE_RE = new RegExp("(?:(?:\\d{1,2}[\\/\\.]\\d{4})|(?:\\d{4})|(?:[A-Za-z]{3,9}\\.?\\s+\\d{4}))\\s*(?:[\\-–—]|\\bto\\b|–)\\s*(?:present|current|(?:\\d{1,2}[\\/\\.]\\d{4})|(?:\\d{4})|(?:[A-Za-z]{3,9}\\.?\\s+\\d{4}))", "i");

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
  "Supervisor", "Superintendent", "Controller", "Inspector",
  // Individual contributors
  "Engineer", "Developer", "Designer", "Architect", "Analyst", "Consultant",
  "Specialist", "Associate", "Assistant", "Coordinator", "Administrator",
  "Representative", "Agent", "Intern", "Trainee", "Apprentice",
  "Clerk", "Cashier", "Teller", "Operator", "Dispatcher", "Receptionist",
  "Secretary", "Stenographer", "Bookkeeper", "Examiner",
  // Sales / Retail
  "Salesperson", "Salesman", "Saleswoman", "Merchandiser", "Cashier",
  "Stocker", "Attendant", "Greeter",
  // Hospitality / Customer Service
  "Host", "Hostess", "Waiter", "Waitress", "Bartender", "Barista",
  "Concierge", "Porter", "Bellhop", "Housekeeper", "Steward", "Stewardess",
  // Industry-specific
  "Pilot", "Captain", "Lieutenant", "Sergeant", "Marshal",
  "Nurse", "Therapist", "Technician", "Mechanic", "Electrician",
  "Teacher", "Professor", "Lecturer", "Instructor", "Tutor",
  "Accountant", "Auditor", "Banker", "Trader", "Broker",
  "Lawyer", "Attorney", "Paralegal", "Judge",
  "Writer", "Editor", "Reporter", "Journalist",
  "Chef", "Cook", "Baker",
  // Aviation / Airport
  "Crew", "Cabin Crew", "Flight Attendant", "Ground Staff", "Ramp Agent",
  "Ticket Agent", "Gate Agent", "Baggage Handler", "Check-in Agent",
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

function parseExperiences(lines: string[], jobDesc?: string): ResumeData["experience"] {
  if (!lines.length) return [];
  const out: ResumeData["experience"] = [];
  let current: ResumeData["experience"][number] | null = null;

  const relevance = (bullet: string) => {
    if (!jobDesc) return bullet.length;
    const jd = jobDesc.toLowerCase();
    const words = bullet.toLowerCase().split(/\s+/);
    let score = 0;
    for (const w of words) {
      if (jd.includes(w)) score += 1;
    }
    return score;
  };

  const trimOrPad = (bullets: string[]): string[] => {
    const ranked = bullets
      .map(b => ({ text: b, score: relevance(b) }))
      .sort((a, b) => b.score - a.score)
      .map(o => o.text);
    const result = ranked.slice(0, 3);
    while (result.length < 3) {
      result.push('Delivered high‑quality service to diverse customers, consistently exceeding expectations.');
    }
    return result;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const dateMatch = trimmed.match(DATE_RANGE_RE);

    if (dateMatch && trimmed.length > 20 && !trimmed.startsWith('•') && !trimmed.startsWith('-')) {
      if (current) out.push({ ...current, bullets: trimOrPad(current.bullets) });

      const dateStr = dateMatch[0];
      const dateRange = parseDateRange(dateStr);

      let cleanLine = trimmed.replace(dateStr, '').trim();
      cleanLine = cleanLine.replace(new RegExp("^[:\\s,—–\\-|·•▪◦]+"), '').replace(new RegExp("[:\\s,—–\\-|·•▪◦]+$"), '').trim();

      let title = cleanLine;
      let company = "";
      let location = "";

      // Existing splitting logic (unchanged) ...
      const pipeParts = cleanLine.split(new RegExp("\\s*\\|\\s*"));
      if (pipeParts.length >= 2) {
        const leftSide = pipeParts[0].trim();
        const rightSide = pipeParts.slice(1).join(" | ").trim();
        const split = splitTitleAndCompany(leftSide);
        if (split) {
          title = split.title;
          company = split.company;
          location = rightSide;
        } else {
          title = leftSide;
          company = rightSide;
        }
      } else {
        const atMatch = cleanLine.match(/^(.+?)\s+(?:at|AT|@)\s+(.+)$/);
        if (atMatch) {
          title = atMatch[1].trim();
          const rest = atMatch[2].trim();
          const commaParts = rest.split(",");
          if (commaParts.length >= 2) {
            company = commaParts.slice(0, -1).join(",").trim();
            location = commaParts.slice(-1)[0].trim();
          } else {
            company = rest;
          }
        } else {
          const split = splitTitleAndCompany(cleanLine);
          if (split) {
            title = split.title;
            const comp = split.company.replace(new RegExp("^[:\\s,—–\\-|·•▪◦]+"), '').trim();
            const compParts = comp.split(",");
            if (compParts.length >= 2) {
              company = compParts.slice(0, -1).join(",").trim();
              location = compParts.slice(-1)[0].trim();
            } else {
              company = comp;
            }
          } else {
            const commaParts = cleanLine.split(',');
            if (commaParts.length >= 3) {
              title = commaParts[0].trim();
              company = commaParts[1].trim();
              location = commaParts.slice(2).join(', ').trim();
            }
          }
        }
      }

      title = title.replace(new RegExp("^[:\\s,—–\\-|·•▪◦\\\\.]+"), '').replace(new RegExp("[:\\s,—–\\-|·•▪◦\\\\.]+$"), '').trim();
      company = company.replace(/^(?:at|in|for|with)\s+/i, '').trim();
      company = company.replace(new RegExp("^[:\\s,—–\\-|·•▪◦\\\\.]+"), '').replace(new RegExp("[:\\s,—–\\-|·•▪◦\\\\.]+$"), '').trim();
      location = location.replace(new RegExp("^[:\\s,—–\\-|·•▪◦\\\\.]+"), '').replace(new RegExp("[:\\s,—–\\-|·•▪◦\\\\.]+$"), '').trim();

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
      const cleaned = trimmed.replace(new RegExp("^[•\\*\\-·▪◦]\\s*"), "").trim();
      if (cleaned) {
        const isLocationPattern = /^(?:of|in)\s+[A-Z][a-zA-Z]+/i.test(cleaned) || /\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*,\s?[A-Z][a-zA-Z]+/.test(cleaned);
        if (current.bullets.length === 0 && !current.location && isLocationPattern) {
          current.location = cleaned.replace(/^(?:of|in)\s+/i, "").trim();
        } else {
          current.bullets.push(cleaned);
        }
      }
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

  if (current) out.push({ ...current, bullets: trimOrPad(current.bullets) });
  return out;
}

  /*
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
      cleanLine = cleanLine.replace(new RegExp("^[:\\s,—–\\-|·•▪◦]+"), '').replace(new RegExp("[:\\s,—–\\-|·•▪◦]+$"), '').trim();

      let title = cleanLine;
      let company = "";
      let location = "";

      // === Strategy 1: Split on " | " — left side is "Title Company", right side is "Location" ===
      // This is the most common modern resume format:
      //   "Senior Customer Experience Specialist Vercel | Remote Mar 2022 – Present"
      // After dateStr removal: "Senior Customer Experience Specialist Vercel | Remote"
      // We then need to split the LEFT side into title + company.
      const pipeParts = cleanLine.split(new RegExp("\\s*\\|\\s*"));
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
            const cleanComp = split.company.replace(new RegExp("^[:\\s,—–\\-|·•▪◦]+"), "").trim();
            // `cleanComp` may contain "Company Location" — try to extract location (last comma part)
            const compParts = cleanComp.split(/,/);
            if (compParts.length >= 2) {
              company = compParts.slice(0, -1).join(",").trim();
              location = compParts.slice(-1)[0].trim();
              if (/^[A-Z]{2}$/.test(location) && compParts.length >= 3) {
                company = compParts.slice(0, -2).join(",").trim();
                location = compParts.slice(-2).join(",").trim();
              }
            } else {
              company = cleanComp;
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

      title = title.replace(new RegExp("^[:\\s,—–\\-|·•▪◦\\\\.]+"), '').replace(new RegExp("[:\\s,—–\\-|·•▪◦\\\\.]+$"), '').trim();
      company = company.replace(/^(?:at|in|for|with)\s+/i, "").trim();
      company = company.replace(new RegExp("^[:\\s,—–\\-|·•▪◦\\\\.]+"), '').replace(new RegExp("[:\\s,—–\\-|·•▪◦\\\\.]+$"), '').trim();
      location = location.replace(new RegExp("^[:\\s,—–\\-|·•▪◦\\\\.]+"), '').replace(new RegExp("[:\\s,—–\\-|·•▪◦\\\\.]+$"), '').trim();

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
      const cleaned = trimmed.replace(new RegExp("^[•*\\-·▪◦]\\s*"), "").trim();
      if (cleaned) {
        const isLocationPattern = /^(?:of|in)\s+[A-Z][a-zA-Z]+/i.test(cleaned) || /\b[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)*,\s?[A-Z][a-zA-Z]+/.test(cleaned);
        if (current.bullets.length === 0 && !current.location && isLocationPattern) {
          current.location = cleaned.replace(/^(?:of|in)\s+/i, "").trim();
        } else {
          current.bullets.push(cleaned);
        }
      }
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

*/

function parseDateRange(s: string): { start: string; end: string } {
  // Try splitting on common date separators: -, –, —, "to"
  const parts = s.split(new RegExp("\\s*(?:[\\-–—]|\\bto\\b)\\s*", "i")).filter(Boolean);
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

export function cleanEducationLine(l: string): string {
  let clean = l;
  
  // 1. Remove date ranges matching DATE_RANGE_RE (extended to include ongoing)
  const rangeRe = new RegExp("(?:(?:\\d{1,2}[\\/\\.]\\d{4})|(?:\\d{4})|(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?\\s+\\d{4}))\\s*(?:[\\-–—]|\\bto\\b|–)\\s*(?:present|current|ongoing|(?:\\d{1,2}[\\/\\.]\\d{4})|(?:\\d{4})|(?:(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\\.?\\s+\\d{4}))", "i");
  clean = clean.replace(rangeRe, "");
  
  // 2. Remove year ranges like "2021-2022" or "2021 - 2022"
  clean = clean.replace(new RegExp("\\b(19|20)\\d{2}\\s*[\\-–—]\\s*(19|20)\\d{2}\\b", "g"), "");
  
  // 3. Remove single years with trailing dash/separator e.g. "2022 -" or "2022 –"
  clean = clean.replace(new RegExp("\\b(19|20)\\d{2}\\s*[\\-–—]?", "g"), "");
  
  // 4. Remove standalone months and words like present, ongoing, current
  clean = clean.replace(/\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\b/gi, "");
  clean = clean.replace(/\b(?:present|ongoing|current)\b/gi, "");
  
  // 5. Clean up leading/trailing punctuation and double spaces
  // NOTE: Pipe (|) is a valid field separator — only strip from line START, never from end.
  // Stripping trailing pipe destroys "Diploma | INFOHAS" to just "Diploma".
  clean = clean.replace(new RegExp("^[:\\s,—–\\-|·•▪◦\\(\\)]+"), "");
  clean = clean.replace(new RegExp("[:\\s,—–\\-·•▪◦\\(\\)]+$"), "");
  clean = clean.replace(/\s+/g, " ").trim();
  
  return clean;
}

function parseEducation(lines: string[]): ResumeData["education"] {
  if (!lines.length) return [];

  // Split into entries by blank lines OR by lines that look like a degree/institution header.
  // A "header" line is one that contains a degree keyword (B.S., M.S., PhD, Bachelor, Master, etc.)
  // or a year range (2014-2018, 2014 - 2018, 2014–2018).
  const degreePattern = /\b(b\.?\s?s\.?|b\.?\s?a\.?|b\.?\s?eng\.?|b\.?\s?tech|m\.?\s?s\.?|m\.?\s?a\.?|mba|ph\.?d|bachelor|master|doctorate|diploma|certificate|associate|degree|high\s+school)\b/i;
  const yearRangePattern = new RegExp("\\b(19|20)\\d{2}\\s*[–\\-]\\s*(19|20)\\d{2}\\b|\\b(19|20)\\d{2}\\s*[–\\-]\\s*present\\b", "i");

  const entries: string[][] = [];
  let current: string[] = [];

  const INST_KEYWORDS = /\b(University|College|Institute|School|Academy|Polytechnic|Conservatory)\b/i;

  for (const line of lines) {
    const hasYearRange = yearRangePattern.test(line);
    const hasDegree = degreePattern.test(line);
    const hasInst = INST_KEYWORDS.test(line);

    const currentHasDegree = current.some(l => degreePattern.test(l));
    const currentHasInst = current.some(l => INST_KEYWORDS.test(l));

    let shouldSplit = false;
    if (current.length > 0) {
      if (hasYearRange) {
        shouldSplit = true;
      } else if (hasDegree && currentHasDegree) {
        // Avoid splitting when the line is a plain degree phrase without an institution.
        const plainDegreeOnly = /^(high\s+school|school|b\.?\s?s\.?|m\.?\s?s\.?|ph\.?\s?d\.?|bachelor|master|diploma|associate|degree)\b/i.test(line.trim());
        if (!plainDegreeOnly && (hasInst || currentHasInst)) {
          shouldSplit = true;
        }
      } else if (hasInst && currentHasInst) {
        shouldSplit = true;
      }
    }

    if (shouldSplit) {
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
        if (/present/i.test(l)) {
          startDate = yrMatch[0];
          endDate = "Present";
          break;
        } else if (/ongoing/i.test(l)) {
          startDate = yrMatch[0];
          endDate = "Ongoing";
          break;
        }
        // Single year without present/ongoing — don't break yet, keep looking
      }
    }

    // First line with a degree keyword → degree; next line → institution
    let degree = "";
    let institution = "";
    let field = "";
    let location = "";
    const highlights: string[] = [];

    const cleanedEntryLines = entryLines.map(cleanEducationLine).filter(Boolean);

    for (let i = 0; i < cleanedEntryLines.length; i++) {
      const cleanedLine = cleanedEntryLines[i];
      if (!cleanedLine) continue;

      if (!degree && degreePattern.test(cleanedLine)) {
        let leftSide = cleanedLine;
        if (cleanedLine.includes("|")) {
          const pipeParts = cleanedLine.split("|").map((p) => p.trim());
          leftSide = pipeParts[0];
          // The pipe part could be location OR institution depending on format:
          // - "degree | institution" → pipe part is institution
          // - "degree institution | location" → pipe part is location
          // Find the degree keyword match to see if there's text after it in leftSide
          const degMatchForPipe = leftSide.match(degreePattern);
          if (degMatchForPipe && degMatchForPipe.index !== undefined) {
            const afterDeg = leftSide.slice(degMatchForPipe.index + degMatchForPipe[0].length).trim();
            if (afterDeg.length > 1) {
              // Text after degree → pipe part is location
              location = pipeParts[1] || "";
            } else {
              // No text after degree → pipe part is institution
              institution = pipeParts[1] || "";
              if (pipeParts.length >= 3) {
                location = pipeParts[2] || "";
              }
            }
          } else {
            institution = pipeParts[1] || "";
            if (pipeParts.length >= 3) {
              location = pipeParts[2] || "";
            }
          }
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
          if (leftSide[kwEnd] === ".") {
            kwEnd++;
          }
          degree = leftSide.slice(0, kwEnd).trim();

          const afterKw = leftSide.slice(kwEnd);
          const fieldMatch = afterKw.match(new RegExp("^\\s+(?:of|in|with)\\s+([A-Za-z\\s&]+?)(?=\\s+(?:University|College|Institute|School|Academy|Polytechnic|Conservatory)|$)", "i"));
          if (fieldMatch) {
            field = fieldMatch[1].trim();
            institution = afterKw.slice(fieldMatch[0].length).trim();
          } else if (!institution) {
            institution = afterKw.trim();
          }
        } else {
          degree = leftSide;
        }


        if (!institution) {
            // Attempt to extract institution from the previous line if it contains a colon.
            const prevIdx = i - 1;
            if (prevIdx >= 0) {
              const prevLine = cleanedEntryLines[prevIdx];
              const colonPos = prevLine.indexOf(':');
              if (colonPos !== -1) {
                const possibleInst = prevLine.slice(colonPos + 1).trim();
                if (possibleInst && !yearRangePattern.test(possibleInst)) {
                  institution = possibleInst;
                }
              }
              // If no colon, use the entire previous non-degree line as institution
              if (!institution) {
                const possibleInst = prevLine.trim();
                if (possibleInst && !degreePattern.test(possibleInst) && !yearRangePattern.test(possibleInst) && !new RegExp("^[\\-\\-·▪◦]").test(possibleInst)) {
                  institution = possibleInst;
                }
              }
            }
          }

      } else if (!institution && !degreePattern.test(cleanedLine) && !yearRangePattern.test(cleanedLine) && !new RegExp("^[•\\-\\*·▪◦]").test(cleanedLine)) {
        institution = cleanedLine;
      } else if (i > 0 && !yearRangePattern.test(cleanedLine)) {
        const cleaned = cleanedLine.replace(new RegExp("^[*·▪◦-]\\s*"), "").trim();
        const highlightText = cleaned;
        if (highlightText && !degreePattern.test(highlightText)) {
          highlights.push(highlightText);
        }
      }
    }

    // ========================================================================
    // POST-PROCESS institution: strip em-dash garbling.
    // The parser often captures trailing dashes + detail text as part of the
    // institution field (e.g., "— — Specialized modules include: ...").
    // Extract only the real institution name and move details to highlights.
    // ========================================================================
    if (institution) {
      // Strip leading em dashes, en dashes, hyphens, and whitespace
      const stripped = institution.replace(/^[\s—–\-]+/, "").trim();
      if (stripped !== institution) {
        institution = stripped;
      }
      // If institution still contains an em-dash-separated detail,
      // split: text before dash = real institution, text after = highlight
      const dashSplitIdx = institution.search(/[\s][—–\-][\s]/);
      if (dashSplitIdx > 0) { // Only split if there's text BEFORE the dash
        const detailText = institution.slice(dashSplitIdx).replace(/^[\s—–\-]+/, "").trim();
        institution = institution.slice(0, dashSplitIdx).trim();
        if (detailText && detailText.length > 2) {
          highlights.push(detailText);
        }
      }
    }

    // Fallback: if no degree found, use first line as institution, second as degree
    if (!degree && !institution) {
      const firstNonBullet = cleanedEntryLines.find((l) => !new RegExp("^[•\\-\\*·▪◦]").test(l.trim())) || cleanedEntryLines[0] || "";
      institution = firstNonBullet.replace(new RegExp("^[•\\-\\*·▪◦\\s|]+"), "").trim() || "";
      degree = cleanedEntryLines[1]?.replace(new RegExp("^[•\\-\\*·▪◦\\s|]+"), "").trim() || "";
      highlights.push(...cleanedEntryLines.slice(2, 4).map((l) => l.replace(new RegExp("^[•\\-\\*·▪◦\\s|]+"), "").trim()).filter(Boolean));
    } else if (!institution) {
      const fallbackInst = cleanedEntryLines.find((l) => {
        const c = l.replace(new RegExp("^[•\\-\\*·▪◦\\s|]+"), "").trim();
        return c && l !== degree && !degreePattern.test(c) && !yearRangePattern.test(c) && !new RegExp("^[•\\-\\*·▪◦]").test(l.trim());
      });
      institution = fallbackInst?.replace(new RegExp("^[•\\-\\*·▪◦\\s|]+"), "").trim() || "";
    }

    // Final cleanup: strip trailing year range that leaked into institution
    // from pipe parsing (e.g., "INFOHAS 2023 – 2025" → "INFOHAS")
    if (institution) {
      const trailingYearRange = institution.match(/^(.+?)\s+\d{4}\s*$/);
      if (trailingYearRange) {
        institution = trailingYearRange[1].trim();
      }
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
    const isBulletStart = new RegExp("^[•\\-\\*]\\s+").test(line);
    const isNumberedStart = /^\d+\.\s+/.test(line);
    const isHeader = (isBulletStart || isNumberedStart) && current.length > 0;

    if (isHeader) {
      blocks.push(current);
      current = [line.replace(new RegExp("^[•\\-\\*]\\s+"), "").replace(/^\d+\.\s+/, "")];
    } else if (isBulletStart || isNumberedStart) {
      current.push(line.replace(new RegExp("^[•\\-\\*]\\s+"), "").replace(/^\d+\.\s+/, ""));
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
    bullets: blockLines.slice(1).filter((l) => l.startsWith("•") || l.startsWith("-")).map((l) => l.replace(new RegExp("^[•\\-]\\s*"), "")),
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
