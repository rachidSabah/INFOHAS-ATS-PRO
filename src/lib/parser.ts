// ResumeAI Pro — client-side resume parser for PDF / DOCX / TXT
"use client";

import type { ResumeData } from "./types";
import { uid } from "./store";

/**
 * Parse an uploaded file into a ResumeData object.
 * Supports: .txt, .pdf (via pdfjs-dist), .docx (via mammoth)
 */
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
    // Legacy .doc — best-effort
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

  return extractResumeFromText(rawText, file.name);
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
  const locationLine = lines.slice(0, 12).find((l) => /\b([A-Z][a-zA-Z]+,\s?[A-Z]{2})\b/.test(l));
  const location = locationLine?.match(/\b([A-Z][a-zA-Z]+,\s?[A-Z]{2})\b/)?.[1];

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

function parseExperiences(lines: string[]): ResumeData["experience"] {
  if (!lines.length) return [];
  const out: ResumeData["experience"] = [];
  let current: ResumeData["experience"][number] | null = null;

  // Try to detect a "Title — Company | Date" header line
  const headerRe = /^(.+?)[\s,—–-]+(.+?)[\s,|·]+((?:\d{4}\s*[-–—]\s*(?:present|\d{4})?|(?:present|\d{4})).*)$/i;

  for (const line of lines) {
    const headerMatch = line.match(headerRe);
    if (headerMatch) {
      if (current) out.push(current);
      const [_, title, company, dates] = headerMatch;
      const dateRange = parseDateRange(dates);
      current = {
        id: uid("e"),
        title: title.trim(),
        company: company.trim(),
        startDate: dateRange.start,
        endDate: dateRange.end,
        bullets: [],
      };
    } else if (current) {
      // Bullet or plain line
      const cleaned = line.replace(/^[•\-*·▪◦]\s*/, "").trim();
      if (cleaned) current.bullets.push(cleaned);
    } else {
      // First line with no header match — treat as title only
      current = {
        id: uid("e"),
        title: line,
        company: "",
        startDate: "",
        endDate: "Present",
        bullets: [],
      };
    }
  }
  if (current) out.push(current);
  return out;
}

function parseDateRange(s: string): { start: string; end: string } {
  const m = s.match(/(\d{4})\s*[-–—]\s*(present|\d{4})/i);
  if (m) return { start: m[1], end: m[2] };
  const single = s.match(/(\d{4})/);
  if (single) return { start: single[1], end: "Present" };
  return { start: "", end: "Present" };
}

function parseEducation(lines: string[]): ResumeData["education"] {
  if (!lines.length) return [];

  // Split into entries by blank lines OR by lines that look like a degree/institution header.
  // A "header" line is one that contains a degree keyword (B.S., M.S., PhD, Bachelor, Master, etc.)
  // or a year range (2014-2018, 2014 - 2018, 2014–2018).
  const degreePattern = /\b(b\.?\s?s\.?|b\.?\s?a\.?|b\.?\s?eng\.?|b\.?\s?tech|m\.?\s?s\.?|m\.?\s?a\.?|mba|ph\.?d|bachelor|master|doctorate|diploma|certificate|associate)\b/i;
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
    const highlights: string[] = [];

    for (let i = 0; i < entryLines.length; i++) {
      const l = entryLines[i];
      if (!degree && degreePattern.test(l)) {
        // Extract degree + field (e.g. "B.S. in Computer Science")
        degree = l;
        const fieldMatch = l.match(/\bin\s+(.+)$/i);
        if (fieldMatch) {
          field = fieldMatch[1].trim();
          degree = l.replace(/\s+in\s+.+$/i, "").trim();
        }
      } else if (!institution && !degreePattern.test(l) && !yearRangePattern.test(l)) {
        institution = l;
      } else if (i > 1 && !yearRangePattern.test(l)) {
        highlights.push(l);
      }
    }

    // Fallback: if no degree found, use first line as institution, second as degree
    if (!degree && !institution) {
      institution = entryLines[0] || "Institution";
      degree = entryLines[1] || "Degree";
      highlights.push(...entryLines.slice(2, 4));
    } else if (!institution) {
      institution = entryLines.find((l) => l !== degree && !degreePattern.test(l) && !yearRangePattern.test(l)) || "Institution";
    }

    return {
      id: uid("ed"),
      institution,
      degree,
      field: field || undefined,
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
