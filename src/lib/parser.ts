1|// ResumeAI Pro — client-side resume parser for PDF / DOCX / TXT
2|"use client";
3|
4|import type { ResumeData } from "./types";
5|import { uid } from "./store";
6|
7|/**
8| * Parse an uploaded file into a ResumeData object.
9| * Supports: .txt, .pdf (via pdfjs-dist), .docx (via mammoth)
10| */
11|export function calculateParserConfidence(resume: ResumeData): number {
12|  let score = 0;
13|  if (resume.summary && resume.summary.trim().length > 20) score += 25;
14|  if (resume.experience && resume.experience.length > 0) score += 25;
15|  if (resume.education && resume.education.length > 0) score += 20;
16|  if (resume.languages && resume.languages.length > 0) score += 15;
17|  if (resume.skills && resume.skills.length > 0) score += 10;
18|  if (resume.contact && (resume.contact.email || resume.contact.phone)) score += 5;
19|  return score;
20|}
21|
22|export function validateParsedResume(resume: ResumeData): boolean {
23|  return (
24|    resume.summary !== undefined &&
25|    resume.summary !== null &&
26|    resume.summary.trim().length > 0 &&
27|    resume.experience.length > 0 &&
28|    resume.education.length > 0 &&
29|    resume.languages.length > 0
30|  );
31|}
32|
33|export function RepairParser(text: string, fileName: string): ResumeData {
34|  console.log("RepairParser: Validation or confidence failed. Trying secondary parser...");
35|  let parsed = secondaryParser(text, fileName);
36|  let confidence = calculateParserConfidence(parsed);
37|  let isValid = validateParsedResume(parsed);
38|
39|  if (!isValid || confidence < 90) {
40|    console.log(`Secondary parser insufficient (confidence: ${confidence}, valid: ${isValid}). Trying heuristic parser...`);
41|    parsed = heuristicParser(text, fileName);
42|    confidence = calculateParserConfidence(parsed);
43|    isValid = validateParsedResume(parsed);
44|  }
45|
46|  if (!isValid) {
47|    console.error("Heuristic parser failed to recover core sections. Throwing ParseError.");
48|    throw new Error("ParseError: Could not extract all required resume sections (Summary, Experience, Education, Languages) even after heuristic repair.");
49|  }
50|
51|  return parsed;
52|}
53|
54|export function secondaryParser(text: string, fileName: string): ResumeData {
55|  const normalizedText = text.replace(/\r/g, "");
56|  
57|  // Section regexes using line-start markers and word boundaries to avoid false matching
  const headerLookahead = `(?=(?:(?:^|\\n)\\s*(?:PROFESSIONAL EXPERIENCE|WORK EXPERIENCE|\\bEXPERIENCE\\b|EDUCATION|LANGUAGES|LANGUAGE|SKILLS|CORE COMPETENCIES|COMPETENCIES|CERTIFICATIONS|PROJECTS|REFERENCES|SUMMARY|PROFESSIONAL SUMMARY|CAREER OBJECTIVE|CAREER PROFILE|PROFESSIONAL PROFILE|ABOUT ME|PERSONAL INFORMATIONS|PERSONAL INFORMATION|PERSONAL INFO|PERSONAL DETAILS|INTERESTS|HOBBIES|NATIONALITY|EXPÉRIENCE PROFESSIONNELLE|EXPÉRIENCES PROFESSIONNELLES|FORMATION|FORMATIONS|LANGUES|COMPÉTENCES|COMPÉTENCES CLÉS|PROFIL|PROFIL PROFESSIONNEL|CERTIFICATS|PROJETS|CENTRES D’INTÉRÊT|LOISIRS)\\b\\s*:?\\s*(?:\\n|$)))`;
59|
60|  const expRegex = new RegExp('(?:^|\\n)\\s*(?:PROFESSIONAL EXPERIENCE|WORK EXPERIENCE|\\bEXPERIENCE\\b|\\bEXPERIENCES\\b|EMPLOYMENT HISTORY|HISTORY|EXPÉRIENCE PROFESSIONNELLE|EXPÉRIENCES PROFESSIONNELLES)\\b\\s*:?\\s*\\n([\\s\\S]*?)' + headerLookahead, 'i');
61|  const eduRegex = new RegExp('(?:^|\\n)\\s*(?:EDUCATION|ACADEMIC BACKGROUND|ACADEMIC|FORMATION|FORMATIONS)\\b\\s*:?\\s*\\n([\\s\\S]*?)' + headerLookahead, 'i');
62|  const langRegex = new RegExp('(?:^|\\n)\\s*(?:LANGUAGES|LANGUAGE|LANGUES)\\b\\s*:?\\s*\\n([\\s\\S]*?)' + headerLookahead, 'i');
63|  const skillsRegex = new RegExp('(?:^|\\n)\\s*(?:SKILLS|TECHNICAL SKILLS|CORE SKILLS|CORE COMPETENCIES|CORE COMPETENCIES & SKILLS|COMPETENCIES|COMPÉTENCES|COMPÉTENCES CLÉS)\\b\\s*:?\\s*\\n([\\s\\S]*?)' + headerLookahead, 'i');
64|  const certsRegex = new RegExp('(?:^|\\n)\\s*(?:CERTIFICATIONS|CERTIFICATES|LICENSES|CERTIFICATS)\\b\\s*:?\\s*\\n([\\s\\S]*?)' + headerLookahead, 'i');
65|  const projRegex = new RegExp('(?:^|\\n)\\s*(?:PROJECTS|PERSONAL PROJECTS|SIDE PROJECTS|PROJETS)\\b\\s*:?\\s*\\n([\\s\\S]*?)' + headerLookahead, 'i');
66|  const summaryRegex = new RegExp('(?:^|\\n)\\s*(?:SUMMARY|PROFESSIONAL SUMMARY|PROFILE|OBJECTIVE|CAREER OBJECTIVE|CAREER PROFILE|PROFESSIONAL PROFILE|ABOUT ME|PROFIL|PROFIL PROFESSIONNEL)\\b\\s*:?\\s*\\n([\\s\\S]*?)' + headerLookahead, 'i');
67|
68|  const expMatch = normalizedText.match(expRegex);
69|  const eduMatch = normalizedText.match(eduRegex);
70|  const langMatch = normalizedText.match(langRegex);
71|  const skillsMatch = normalizedText.match(skillsRegex);
72|  const certsMatch = normalizedText.match(certsRegex);
73|  const projMatch = normalizedText.match(projRegex);
74|  const summaryMatch = normalizedText.match(summaryRegex);
75|
76|  const expLines = expMatch ? expMatch[1].split("\n").map(l => l.trim()).filter(Boolean) : [];
77|  const eduLines = eduMatch ? eduMatch[1].split("\n").map(l => l.trim()).filter(Boolean) : [];
78|  const langLines = langMatch ? langMatch[1].split("\n").map(l => l.trim()).filter(Boolean) : [];
79|  const skillsLines = skillsMatch ? skillsMatch[1].split("\n").map(l => l.trim()).filter(Boolean) : [];
80|  const certsLines = certsMatch ? certsMatch[1].split("\n").map(l => l.trim()).filter(Boolean) : [];
81|  const projLines = projMatch ? projMatch[1].split("\n").map(l => l.trim()).filter(Boolean) : [];
82|  const summary = summaryMatch ? summaryMatch[1].trim() : undefined;
83|
84|  const experience = parseExperiences(expLines);
85|  const education = parseEducation(eduLines);
86|  const skills = skillsLines
87|    .flatMap((l) => l.split(/[,;•|]/))
88|    .map((s) => s.trim())
89|    .filter((s) => s.length > 0 && s.length < 40)
90|    .map((s) => ({ id: uid("s"), name: s }));
91|  const projects = parseProjects(projLines);
92|  const certifications = certsLines.map((c) => ({ id: uid("c"), name: c }));
93|  const languages: ResumeData["languages"] = [];
94|  const seenLangs = new Set<string>();
95|  for (const line of langLines) {
96|    const parts = line.split(/[,;]/);
97|    for (const part of parts) {
98|      const detected = detectLanguage(part);
99|      if (detected && !seenLangs.has(detected.name.toLowerCase())) {
100|        seenLangs.add(detected.name.toLowerCase());
101|        languages.push({
102|          id: uid("l"),
103|          name: detected.name,
104|          proficiency: detected.proficiency,
105|        });
106|      }
107|    }
108|  }
109|
110|  // Extract contact
111|  const firstLines = normalizedText.split("\n").slice(0, 15).join("\n");
112|  const emailMatch = firstLines.match(EMAIL_RE);
113|  const phoneMatch = firstLines.match(PHONE_RE);
114|  const urlMatches = Array.from(firstLines.matchAll(new RegExp(URL_RE.source, "gi"))).map((m) => m[0]);
115|  const linkedin = urlMatches.find((u) => /linkedin/i.test(u));
116|  const github = urlMatches.find((u) => /github/i.test(u));
117|  const website = urlMatches.find((u) => !/linkedin|github/i.test(u));
118|  // Try to find a location pattern near the top
119|  // Allow 1-3 capitalized words before the comma (e.g. "San Francisco, CA", "New York City, NY").
120|  // Also allow capitalized country/state names after the comma (e.g. "Rabat, Morocco", "London, United Kingdom").
121|  const locationLine = normalizedText.split("\n").slice(0, 15).find((l) => /\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2},\s?[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\b/.test(l));
122|  const location = locationLine?.match(/\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2},\s?[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\b/)?.[1];
123|
124|  const name = extractNameFromLines(normalizedText.split("\n"));
125|
126|  const now = new Date().toISOString();
127|  return {
128|    id: uid("r"),
129|    name,
130|    contact: { email: emailMatch?.[1], phone: phoneMatch?.[1]?.trim(), location, website, linkedin, github },
131|    summary,
132|    experience,
133|    education,
134|    skills,
135|    projects,
136|    certifications,
137|    languages,
138|    template: "ats-professional",
139|    accentColor: "#1154A3",
140|    createdAt: now,
141|    updatedAt: now,
142|    source: "upload",
143|    fileName,
144|  };
145|}
146|
147|export function heuristicParser(text: string, fileName: string): ResumeData {
148|  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
149|  let currentSection = "header";
150|  
151|  const sectionLines: { [key: string]: string[] } = {
152|    header: [],
153|    summary: [],
154|    experience: [],
155|    education: [],
156|    languages: [],
157|    skills: [],
158|    certifications: [],
159|    projects: [],
160|  };
161|
162|  for (const line of lines) {
163|    if (/^\s*(?:summary|profile|objective|career\s+objective|career\s+profile|professional\s+profile|about\s+me|profil|profil\s+professionnel)s?\s*:?$/i.test(line)) {
164|      currentSection = "summary";
165|      continue;
166|    } else if (/^\s*(?:professional\s+)?experience[s]?|work\s+experience|employment\s+history|history|expérience\s+professionnelle|expériences\s+professionnelles\s*:?$/i.test(line)) {
167|      currentSection = "experience";
168|      continue;
169|    } else if (/^\s*(?:education|academic(?:\s+background)?|formation|formations)\s*:?$/i.test(line)) {
170|      currentSection = "education";
171|      continue;
172|    } else if (/^\s*(?:languages|language|langues)\s*:?$/i.test(line)) {
173|      currentSection = "languages";
174|      continue;
175|    } else if (/^\s*(?:skills|core\s+competencies|competencies|technical\s+skills|compétences|compétences\s+clés)\s*:?$/i.test(line)) {
176|      currentSection = "skills";
177|      continue;
178|    } else if (/^\s*(?:certifications|certificates|certificats)\s*:?$/i.test(line)) {
179|      currentSection = "certifications";
180|      continue;
181|    } else if (/^\s*(?:projects)\s*:?$/i.test(line)) {
182|      currentSection = "projects";
183|      continue;
184|    }
185|
186|    sectionLines[currentSection].push(line);
187|  }
188|
189|  const summary = sectionLines.summary.join(" ").trim() || undefined;
190|  const experience = parseExperiences(sectionLines.experience);
191|  const education = parseEducation(sectionLines.education);
192|  const skills = sectionLines.skills
193|    .flatMap((l) => l.split(/[,;•|]/))
194|    .map((s) => s.trim())
195|    .filter((s) => s.length > 0 && s.length < 40)
196|    .map((s) => ({ id: uid("s"), name: s }));
197|  const projects = parseProjects(sectionLines.projects);
198|  const certifications = sectionLines.certifications.map((c) => ({ id: uid("c"), name: c }));
199|  const languages: ResumeData["languages"] = [];
200|  const seenLangs = new Set<string>();
201|  for (const line of sectionLines.languages) {
202|    const parts = line.split(/[,;]/);
203|    for (const part of parts) {
204|      const detected = detectLanguage(part);
205|      if (detected && !seenLangs.has(detected.name.toLowerCase())) {
206|        seenLangs.add(detected.name.toLowerCase());
207|        languages.push({
208|          id: uid("l"),
209|          name: detected.name,
210|          proficiency: detected.proficiency,
211|        });
212|      }
213|    }
214|  }
215|
216|  // Contact info
217|  const headerText = sectionLines.header.join("\n");
218|  const emailMatch = headerText.match(EMAIL_RE);
219|  const phoneMatch = headerText.match(PHONE_RE);
220|  const urlMatches = Array.from(headerText.matchAll(new RegExp(URL_RE.source, "gi"))).map((m) => m[0]);
221|  const linkedin = urlMatches.find((u) => /linkedin/i.test(u));
222|  const github = urlMatches.find((u) => /github/i.test(u));
223|  const website = urlMatches.find((u) => !/linkedin|github/i.test(u));
224|  const locationLine = sectionLines.header.find((l) => /\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2},\s?[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\b/.test(l));
225|  const location = locationLine?.match(/\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2},\s?[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\b/)?.[1];
226|
227|  const name = extractNameFromLines(sectionLines.header);
228|
229|  const now = new Date().toISOString();
230|  return {
231|    id: uid("r"),
232|    name,
233|    contact: { email: emailMatch?.[1], phone: phoneMatch?.[1]?.trim(), location, website, linkedin, github },
234|    summary,
235|    experience,
236|    education,
237|    skills,
238|    projects,
239|    certifications,
240|    languages,
241|    template: "ats-professional",
242|    accentColor: "#1154A3",
243|    createdAt: now,
244|    updatedAt: now,
245|    source: "upload",
246|    fileName,
247|  };
248|}
249|
250|export async function parseResumeFile(file: File): Promise<ResumeData> {
251|  const name = file.name.toLowerCase();
252|  let rawText = "";
253|
254|  if (name.endsWith(".txt")) {
255|    rawText = await file.text();
256|  } else if (name.endsWith(".pdf")) {
257|    rawText = await parsePdf(file);
258|  } else if (name.endsWith(".docx")) {
259|    rawText = await parseDocx(file);
260|  } else if (name.endsWith(".doc")) {
261|    rawText = await file.text().catch(() => "");
262|    if (!rawText.trim()) {
263|      throw new Error(
264|        "Legacy .doc files are not directly parseable in-browser. Please save as .docx or .pdf and try again."
265|      );
266|    }
267|  } else {
268|    throw new Error("Unsupported file type. Please upload PDF, DOCX, or TXT.");
269|  }
270|
271|  if (rawText.trim().length < 30) {
272|    throw new Error("The file appears to be empty or could not be parsed.");
273|  }
274|
275|  const primaryResult = extractResumeFromText(rawText, file.name);
276|  const primaryConfidence = calculateParserConfidence(primaryResult);
277|  const isValid = validateParsedResume(primaryResult);
278|
279|  if (!isValid || primaryConfidence < 90) {
280|    console.warn(`Primary parser incomplete (valid: ${isValid}, confidence: ${primaryConfidence}). Running RepairParser...`);
281|    return RepairParser(rawText, file.name);
282|  }
283|
284|  return primaryResult;
285|}
286|
287|export async function parseResumeText(text: string): Promise<ResumeData> {
288|  if (text.trim().length < 30) {
289|    throw new Error("The text appears to be too short to be a valid resume.");
290|  }
291|
292|  const primaryResult = extractResumeFromText(text, "Pasted Resume");
293|  const primaryConfidence = calculateParserConfidence(primaryResult);
294|  const isValid = validateParsedResume(primaryResult);
295|
296|  if (!isValid || primaryConfidence < 90) {
297|    console.warn(`Primary parser incomplete (valid: ${isValid}, confidence: ${primaryConfidence}). Running RepairParser...`);
298|    return RepairParser(text, "Pasted Resume");
299|  }
300|
301|  return primaryResult;
302|}
303|
304|async function parsePdf(file: File): Promise<string> {
305|  // Load pdf.js v3.11.174 from CDN — most reliable approach for all environments
306|  // (browser, Cloudflare Pages, Edge runtime). Uses script tag injection.
307|  if (!(window as any).pdfjsLib) {
308|    await new Promise<void>((resolve, reject) => {
309|      const script = document.createElement("script");
310|      script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
311|      script.onload = () => {
312|        (window as any).pdfjsLib.GlobalWorkerOptions.workerSrc =
313|          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
314|        resolve();
315|      };
316|      script.onerror = () => reject(new Error("Failed to load PDF.js from CDN."));
317|      document.head.appendChild(script);
318|    });
319|  }
320|
321|  const pdfjsLib = (window as any).pdfjsLib;
322|  const arrayBuffer = await file.arrayBuffer();
323|
324|  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
325|  const textParts: string[] = [];
326|
327|  for (let i = 1; i <= pdf.numPages; i++) {
328|    const page = await pdf.getPage(i);
329|    const textContent = await page.getTextContent();
330|
331|    let lastY: number | null = null;
332|    let pageText = "";
333|
334|    for (const item of textContent.items) {
335|      if (item.str && item.str.trim()) {
336|        // Add newline if Y position changed significantly (preserves line breaks)
337|        if (lastY !== null && Math.abs(item.transform[5] - lastY) > 5) {
338|          pageText += "\n";
339|        } else if (pageText && !pageText.endsWith(" ") && !pageText.endsWith("\n")) {
340|          pageText += " ";
341|        }
342|        pageText += item.str;
343|        lastY = item.transform[5];
344|      }
345|    }
346|
347|    if (pageText.trim()) {
348|      textParts.push(pageText.trim());
349|    }
350|  }
351|
352|  return textParts.join("\n\n");
353|}
354|
355|async function parseDocx(file: File): Promise<string> {
356|  const mammoth = await import("mammoth/mammoth.browser");
357|  const arrayBuffer = await file.arrayBuffer();
358|  // mammoth.browser default export shape varies by build
359|  const m: any = (mammoth as any).default ?? mammoth;
360|  const result = await m.extractRawText({ arrayBuffer });
361|  return result.value || "";
362|}
363|
364|const EMAIL_RE = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/;
365|const PHONE_RE = /(\+?[\d\s().-]{10,})/;
366|const URL_RE = /(https?:\/\/[^\s]+|linkedin\.com\/[^\s]+|github\.com\/[^\s]+)/i;
367|
368|const KNOWN_LANGUAGES = new Set([
369|  "english", "french", "arabic", "spanish", "german", "italic", "italian", "chinese", "japanese",
370|  "russian", "portuguese", "hindi", "bengali", "punjabi", "marathi", "telugu", "tamil",
371|  "urdu", "turkish", "korean", "vietnamese", "javanese", "thai", "persian",
372|  "polish", "romanian", "dutch", "greek", "hungarian", "swedish", "czech", "hebrew",
373|  "indonesian", "malay", "norwegian", "danish", "finnish", "slovak", "ukrainian", "catalan",
374|  "swahili", "filipino", "tagalog", "luxembourgish", "kabyle", "berber", "amazigh",
375|  "latin", "sanskrit", "esperanto", "cantonese", "mandarin", "darija", "gaelic", "irish",
376|  "welsh", "basque", "galician", "croatian", "serbian", "slovenian", "bulgarian", "estonian",
377|  "latvian", "lithuanian", "icelandic", "albanian", "macedonian", "georgian", "armenian",
378|  "azerbaijani", "kazakh", "uzbek", "mongolian", "nepali", "sinhala", "khmer", "lao",
379|  "myanmar", "burmese", "amharic", "somali", "yoruba", "igbo", "zulu", "xhosa", "afrikaans"
380|]);
381|
382|export function detectLanguage(s: string): { name: string; proficiency: "basic" | "conversational" | "fluent" | "native" } | null {
383|  const clean = s.trim();
384|  if (!clean) return null;
385|
386|  const words = clean.toLowerCase().split(/[^a-z]+/);
387|  const foundLang = words.find(w => KNOWN_LANGUAGES.has(w));
388|  if (!foundLang) {
389|    return null;
390|  }
391|
392|  let proficiency: "basic" | "conversational" | "fluent" | "native" = "fluent";
393|  const lower = clean.toLowerCase();
394|  if (lower.includes("native") || lower.includes("bilingual")) {
395|    proficiency = "native";
396|  } else if (lower.includes("conversational") || lower.includes("intermediate") || lower.includes("good")) {
397|    proficiency = "conversational";
398|  } else if (lower.includes("basic") || lower.includes("elementary") || lower.includes("beginner")) {
399|    proficiency = "basic";
400|  }
401|
402|  const formattedName = foundLang.charAt(0).toUpperCase() + foundLang.slice(1);
403|  return { name: formattedName, proficiency };
404|}
405|
406|export function extractNameFromLines(lines: string[]): string {
407|  const nameExclusions = /^(?:phone|tel|mobile|fax|email|e-mail|address|linkedin|github|website|portfolio|resume|cv|curriculum\s+vitae|summary|profile|objective|career\s+objective|nationality|marital\s+status|date\s+of\s+birth|health|height|weight|gender|sex|languages|skills|experience|education|hobbies|interests|references|fluent|native|english|french|arabic|moroccan|casablanca|rabat)$/i;
408|
409|  const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
410|  const urlPattern = /https?:\/\/[^\s]+|linkedin\.com\/[^\s]+|github\.com\/[^\s]+|www\.[^\s]+/i;
411|
412|  for (const l of lines.slice(0, 25)) {
413|    const trimmed = l.trim();
414|    if (!trimmed) continue;
415|
416|    if (/\d/.test(trimmed)) continue;
417|    if (emailPattern.test(trimmed) || urlPattern.test(trimmed)) continue;
418|
419|    const words = trimmed.split(/\s+/).map(w => w.replace(/[^a-zA-Z]/g, "")).filter(Boolean);
420|    if (words.length < 2 || words.length > 5) continue;
421|
422|    const hasLabel = words.some(w => nameExclusions.test(w));
423|    if (hasLabel) continue;
424|
425|    const isCapitalized = words.every(w => /^[A-Z]/.test(w));
426|    if (isCapitalized) {
427|      return trimmed.replace(/[^a-zA-Z\s.\-']/g, "").trim();
428|    }
429|  }
430|
431|  for (const l of lines.slice(0, 25)) {
432|    const trimmed = l.trim();
433|    if (!trimmed) continue;
434|    if (/\d/.test(trimmed)) continue;
435|    if (emailPattern.test(trimmed) || urlPattern.test(trimmed)) continue;
436|
437|    const words = trimmed.split(/\s+/).map(w => w.replace(/[^a-zA-Z]/g, "")).filter(Boolean);
438|    if (words.length < 2 || words.length > 5) continue;
439|
440|    const hasLabel = words.some(w => nameExclusions.test(w));
441|    if (hasLabel) continue;
442|
443|    return trimmed.replace(/[^a-zA-Z\s.\-']/g, "").trim();
444|  }
445|
446|  return "Untitled";
447|}
448|
449|/**
450| * Heuristic resume text → ResumeData extractor.
451| * Not perfect, but good enough for initial parsing and to seed the builder.
452| */
453|export function extractResumeFromText(text: string, fileName: string): ResumeData {
454|  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
455|  const joined = lines.join("\n");
456|
457|  const name = extractNameFromLines(lines);
458|
459|  const emailMatch = joined.match(EMAIL_RE);
460|  const phoneMatch = joined.match(PHONE_RE);
461|  const urlMatches = Array.from(joined.matchAll(new RegExp(URL_RE.source, "gi"))).map((m) => m[0]);
462|  const linkedin = urlMatches.find((u) => /linkedin/i.test(u));
463|  const github = urlMatches.find((u) => /github/i.test(u));
464|  const website = urlMatches.find((u) => !/linkedin|github/i.test(u));
465|
466|  // Try to find a location pattern near the top
467|  // Allow 1-3 capitalized words before the comma (e.g. "San Francisco, CA", "New York City, NY").
468|  // Also allow capitalized country/state names after the comma (e.g. "Rabat, Morocco", "London, United Kingdom").
469|  const locationLine = lines.slice(0, 12).find((l) => /\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2},\s?[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\b/.test(l));
470|  const location = locationLine?.match(/\b([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+){0,2},\s?[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)\b/)?.[1];
471|
472|  // Sections — match common headers
473|  const sectionIndex = (labels: string[]) =>
474|    lines.findIndex((l) => labels.some((lbl) => new RegExp(`^\\s*${lbl}\\s*:?$`, "i").test(l)));
475|
476|  const expStart = sectionIndex(["experience", "work experience", "professional experience", "employment"]);
477|  const eduStart = sectionIndex(["education", "academic background"]);
478|  const skillsStart = sectionIndex(["skills", "technical skills", "core skills", "core competencies", "competencies"]);
479|  const projStart = sectionIndex(["projects", "side projects", "personal projects"]);
480|  const certStart = sectionIndex(["certifications", "certificates", "licenses"]);
481|  const langStart = sectionIndex(["languages"]);
482|  const achStart = sectionIndex(["achievements", "key achievements", "awards", "honors", "awards & honors"]);
483|  const summaryStart = sectionIndex(["summary", "professional summary", "profile", "objective", "career objective", "career profile", "professional profile", "about me"]);
484|  const personalStart = sectionIndex(["personal informations", "personal information", "personal info", "personal details", "nationality"]);
485|
486|  const nextSectionStart = (start: number) => {
487|    if (start < 0) return lines.length;
488|    const candidates = [expStart, eduStart, skillsStart, projStart, certStart, langStart, achStart, summaryStart, personalStart]
489|      .filter((i) => i > start);
490|    return candidates.length ? Math.min(...candidates) : lines.length;
491|  };
492|
493|  const sliceSection = (start: number) => {
494|    if (start < 0) return [] as string[];
495|    return lines.slice(start + 1, nextSectionStart(start));
496|  };
497|
498|  const summary = summaryStart >= 0 ? sliceSection(summaryStart).join(" ").trim() : undefined;
499|
500|  // Experience: parse blocks separated by blank lines or company/title patterns
501|