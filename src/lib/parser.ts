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
  const pdfjs: any = await import("pdfjs-dist/build/pdf.mjs");
  // Use CDN worker URL — works in all environments (browser, Cloudflare Pages, etc.)
  // The bundled worker import doesn't resolve correctly in Edge/Workers environments
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version || "4.0.379"}/pdf.worker.min.mjs`;
  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const strings = content.items.map((it: any) => it.str);
    text += strings.join(" ") + "\n";
  }
  return text;
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
 * Not perfect, but good enough for the demo and to seed the builder.
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
  const summaryStart = sectionIndex(["summary", "professional summary", "profile", "objective"]);

  const nextSectionStart = (start: number) => {
    if (start < 0) return lines.length;
    const candidates = [expStart, eduStart, skillsStart, projStart, certStart, langStart, summaryStart]
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

  // Projects
  const projLines = sliceSection(projStart);
  const projects = projLines.length
    ? [{ id: uid("p"), name: projLines[0] || "Project", description: projLines.slice(1).join(" "), bullets: [] }]
    : [];

  // Certifications
  const certLines = sliceSection(certStart);
  const certifications = certLines.map((c) => ({ id: uid("c"), name: c }));

  // Languages
  const langLines = sliceSection(langStart);
  const languages = langLines
    .flatMap((l) => l.split(/[,;]/))
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => ({ id: uid("l"), name: s, proficiency: "fluent" as const }));

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
  return [
    {
      id: uid("ed"),
      institution: lines[0] || "Institution",
      degree: lines[1] || "Degree",
      startDate: "",
      endDate: "",
      highlights: lines.slice(2, 4),
    },
  ];
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
