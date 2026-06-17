// ResumeAI Pro — client-side AI bridge.
// Strategy:
//   1. Puter.js (free, user authenticates with Google/GitHub/etc via Puter). Loaded from layout.
//   2. Local rule-based fallback (deterministic, always works for the demo).
//   3. Server-side /api/ai/chat (z-ai-web-dev-sdk) — used when explicitly requested.
//
// All AI calls are wrapped in failover with try/catch + provider rotation.

"use client";

import { useApp } from "./store";

declare global {
  interface Window {
    puter?: any;
  }
}

/**
 * OPTIMIZER DIRECTIVE — InfoHAS Pro template
 *
 * All optimized resumes produced by the Resume Optimizer MUST match this exact layout,
 * derived from the OUSSAMA EL FATIMI reference PDF. The AI must:
 *   1. Use this layout, these sections, this header style, this typography.
 *   2. Output structured content that fits the InfoHAS Pro template fields.
 *   3. Leave the right-side image frame empty (filled later by the user via upload).
 *   4. Produce content that fits ONE A4 page when rendered with the infohas-pro template.
 *
 * Layout spec (A4, 210 × 297 mm):
 * ┌──────────────────────────────────────────────┐
 * │ NAME (maroon #660033, Times Bold 13pt)        │  ┌────────────┐
 * │ Headline (black, Times 13pt)                  │  │            │
 * │ Location | Phone                              │  │  PHOTO     │
 * │ email                                         │  │  FRAME     │
 * │ Date of Birth : DD/MM/YYYY                    │  │ 54×81mm    │
 * │ ──── blue rule #0563C1 ────                   │  │ portrait   │
 * │                                               │  └────────────┘
 * │ PROFESSIONAL SUMMARY                          │   (top-right corner)
 * │   Summary paragraph wraps to fit LEFT of the  │
 * │   photo frame (text width ~70% until y=255pt, │
 * │   then full width).                           │
 * │                                               │
 * │ CORE COMPETENCIES & SKILLS                    │
 * │   • Category: bullet text                     │
 * │   • Category: bullet text                     │
 * │                                               │
 * │ PROFESSIONAL EXPERIENCE                       │
 * │   Job Title Company | Location  Start – End   │
 * │   • Achievement bullet                        │
 * │   • Achievement bullet                        │
 * │                                               │
 * │ EDUCATION                                     │
 * │   Degree Institution | Location | Dates       │
 * │   • Modules: ...                              │
 * │                                               │
 * │ LANGUAGES                                     │
 * │   Language: Proficiency (note)                │
 * └──────────────────────────────────────────────┘
 *
 * Typography:
 *   - Font: Times New Roman (Bold for name & section headers, Regular for body)
 *   - Name color: #660033 (dark maroon)
 *   - Section headers: uppercase, blue #0563C1, with blue underline
 *   - Body: black, 10-11pt
 *   - Bullets: • marker at left margin, text indented
 *
 * Section order (MANDATORY):
 *   1. PROFESSIONAL SUMMARY (1 paragraph, 60-90 words)
 *   2. CORE COMPETENCIES & SKILLS (4-6 grouped bullets)
 *   3. PROFESSIONAL EXPERIENCE (most recent first, 2-4 entries, 3-4 bullets each)
 *   4. EDUCATION (1-2 entries with optional modules bullet)
 *   5. LANGUAGES (1-4 entries with proficiency note)
 *
 * Constraints:
 *   - maxPages = 1, paperSize = A4, allowOverflow = false
 *   - assert(pdf.pages === 1)
 *   - The image frame on the right MUST be preserved as a placeholder; never fill with text.
 *   - All claims must be truthful to the source resume — never invent employers, dates, or metrics.
 *   - Embed target job-description keywords naturally in summary, skills, and experience.
 */
export const OPTIMIZER_DIRECTIVE = `You are the ResumeAI Pro Optimizer. Every optimized resume you produce MUST follow the InfoHAS Pro template — a single-page A4 layout derived from the OUSSAMA EL FATIMI reference resume.

LAYOUT (A4, 210 × 297 mm):
- Top-left header zone (~60% width): candidate NAME in dark maroon (#660033, Times New Roman Bold, 13pt), then headline, then 3-4 contact lines (location | phone, email, date of birth). A thin blue rule (#0563C1) sits under the header text.
- Top-right corner: an empty portrait image frame (~54 × 81 mm, 2:3 ratio). The image frame MUST be preserved as a placeholder — never fill it with text. The user uploads their photo later.
- Body: Times New Roman, single column. The PROFESSIONAL SUMMARY wraps to fit LEFT of the photo frame (text ends at ~70% page width until the photo's bottom edge, then uses full width).
- Section headers: UPPERCASE, blue (#0563C1), bold, with a thin blue underline. Spacing between sections is generous.
- Bullets use the • marker, text indented.

SECTION ORDER (MANDATORY — in this exact order, no other sections):
1. PROFESSIONAL SUMMARY — one paragraph, 60-90 words. Embed 2-3 target keywords naturally.
2. CORE COMPETENCIES & SKILLS — 4-6 grouped bullets. Each bullet is "Category: skill, skill, skill".
3. PROFESSIONAL EXPERIENCE — most recent first, 2-4 entries. Each entry: "Job Title Company | Location  Start – End" then 3-4 achievement bullets with measurable outcomes (start with action verbs: Led, Built, Increased, Reduced, Delivered, Executed).
4. EDUCATION — 1-2 entries: "Degree Institution | Location | Dates" then optional "• Modules: ..." bullet.
5. LANGUAGES — 1-4 entries: "Language: Proficiency (optional note)".

CONTENT RULES:
- Truthful to the source resume. Never invent employers, dates, or metrics not supported by the source.
- Embed target job-description keywords naturally (do not list them blankly).
- Quantify bullets where the source supports it (%, $, counts, time saved).
- Trim verbosity. Every word earns its place.

OUTPUT FORMAT:
Return ONLY valid JSON with this exact shape:
{
  "name": "FULL NAME",
  "headline": "Target Role Title",
  "location": "City, Country",
  "phone": "+X ...",
  "email": "...",
  "dateOfBirth": "DD/MM/YYYY" | "",
  "summary": "60-90 word professional summary paragraph...",
  "skills": [
    { "category": "Sales Techniques", "items": ["Substitute Selling", "Complimentary Selling", "F.A.B. method"] },
    ...
  ],
  "experience": [
    {
      "title": "Job Title",
      "company": "Company",
      "location": "City, Country",
      "startDate": "Mon YYYY",
      "endDate": "Mon YYYY" | "Present",
      "bullets": ["Achievement bullet 1...", "Achievement bullet 2...", "Achievement bullet 3..."]
    },
    ...
  ],
  "education": [
    {
      "degree": "Degree Name",
      "institution": "Institution",
      "location": "City, Country" | "",
      "startDate": "YYYY",
      "endDate": "YYYY",
      "modules": "Module 1, Module 2, ..." | ""
    },
    ...
  ],
  "languages": [
    { "name": "English", "proficiency": "Fluent", "note": "Effective written and spoken communication" | "" },
    ...
  ],
  "missingKeywordsAdded": ["keyword1", "keyword2", ...],
  "bulletsRewritten": 5
}

ONE-PAGE CONSTRAINT: The output must fit on exactly one A4 page when rendered with the InfoHAS Pro template. If content is too long, condense — do not split. assert(pdf.pages === 1).`;

export interface AICallOptions {
  systemPrompt?: string;
  userPrompt: string;
  maxTokens?: number;
  temperature?: number;
  // If true, prefer the local generator (no network). Used for instant demo.
  preferLocal?: boolean;
  // If true, force the server route.
  preferServer?: boolean;
}

export interface AICallResult {
  text: string;
  provider: string;
  latencyMs: number;
  tokensEstimate: number;
}

const estTokens = (s: string) => Math.ceil(s.length / 4);

/**
 * Main AI entrypoint. Tries Puter → server (z-ai) → local rule-based fallback.
 */
export async function callAI(opts: AICallOptions): Promise<AICallResult> {
  const t0 = performance.now();

  if (!opts.preferServer) {
    // 1) Try Puter.js
    try {
      if (typeof window !== "undefined" && window.puter?.ai?.chat) {
        // Ensure user is signed in to Puter (free)
        try {
          if (window.puter.auth && typeof window.puter.auth.isSignedIn === "function") {
            const signedIn = window.puter.auth.isSignedIn();
            if (!signedIn) {
              await window.puter.auth.signIn();
            }
          }
        } catch {
          /* sign-in optional; some endpoints allow anonymous */
        }
        const messages = opts.systemPrompt
          ? [
              { role: "system", content: opts.systemPrompt },
              { role: "user", content: opts.userPrompt },
            ]
          : [{ role: "user", content: opts.userPrompt }];

        const resp = await window.puter.ai.chat(messages, {
          model: "claude-sonnet-4",
          max_tokens: opts.maxTokens ?? 4096,
          temperature: opts.temperature ?? 0.7,
        });
        const text =
          typeof resp === "string"
            ? resp
            : resp?.message?.content ??
              resp?.text ??
              (Array.isArray(resp?.message?.content)
                ? resp.message.content.map((c: any) => c?.text ?? "").join("")
                : JSON.stringify(resp));
        if (text && text.trim().length > 0) {
          return {
            text: typeof text === "string" ? text : String(text),
            provider: "Puter.js",
            latencyMs: Math.round(performance.now() - t0),
            tokensEstimate: estTokens(opts.userPrompt + (opts.systemPrompt ?? "")),
          };
        }
      }
    } catch (e) {
      console.warn("[AI] Puter failed, trying next provider:", e);
    }
  }

  if (!opts.preferLocal) {
    // 2) Try server fallback (z-ai-web-dev-sdk)
    try {
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemPrompt: opts.systemPrompt,
          userPrompt: opts.userPrompt,
          maxTokens: opts.maxTokens,
          temperature: opts.temperature,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data?.text && data.text.trim().length > 0) {
          return {
            text: data.text,
            provider: "Z.ai Fallback",
            latencyMs: Math.round(performance.now() - t0),
            tokensEstimate: estTokens(opts.userPrompt + (opts.systemPrompt ?? "")),
          };
        }
      }
    } catch (e) {
      console.warn("[AI] Server fallback failed, using local generator:", e);
    }
  }

  // 3) Local deterministic fallback
  const text = localGenerate(opts);
  return {
    text,
    provider: "Local Engine",
    latencyMs: Math.round(performance.now() - t0),
    tokensEstimate: estTokens(opts.userPrompt),
  };
}

/**
 * Deterministic local generator — produces useful, structured output for the demo.
 * Inspects the prompt for keywords (cover letter, interview, summary, bullets, jd, ats)
 * and returns a templated but tailored response.
 */
function localGenerate(opts: AICallOptions): string {
  const prompt = (opts.userPrompt || "").toLowerCase();
  const sp = (opts.systemPrompt || "").toLowerCase();

  // Try to extract a JSON hint or use heuristics
  if (prompt.includes("cover letter") || sp.includes("cover letter")) {
    return localCoverLetter(opts.userPrompt);
  }
  if (prompt.includes("interview") || sp.includes("interview")) {
    return localInterview(opts.userPrompt);
  }
  if (prompt.includes("summary") || sp.includes("professional summary")) {
    return localSummary(opts.userPrompt);
  }
  if (prompt.includes("bullet") || sp.includes("bullet point")) {
    return localBullets(opts.userPrompt);
  }
  if (prompt.includes("job description") || prompt.includes("extract") || sp.includes("scraper")) {
    return localJD(opts.userPrompt);
  }
  if (prompt.includes("ats") || sp.includes("ats")) {
    return localATS(opts.userPrompt);
  }
  if (prompt.includes("rewrite") || prompt.includes("optimize")) {
    return localRewrite(opts.userPrompt);
  }
  return "I'm operating in offline mode and couldn't reach the cloud AI providers. Please ensure you're signed in via Puter.js (the 'Sign in with Google' button) for full AI capabilities, or try again in a moment.";
}

function localCoverLetter(prompt: string): string {
  const company = extract(prompt, /at ([A-Z][a-zA-Z0-9&. ]+?)[.,\n]/, "the company");
  const role = extract(
    prompt,
    /\b(role|position)[:\s]+([a-zA-Z][a-zA-Z0-9\- ]{2,40})/,
    "the role"
  );
  return `Dear ${company} Hiring Team,

When I read about this ${role} opportunity at ${company}, two things came to mind: the team that owns the customer-facing experience is the team that makes or breaks the product promise, and that's exactly the team I want to join.

Over the past several years I've built and scaled web applications used by millions of users — leading migrations to modern frameworks, owning accessibility remediation end-to-end, and shipping design systems used across multiple teams. I measure success by the metrics that matter: faster builds, higher Lighthouse scores, lower bug rates, and shipped features that move the needle.

I'd love to bring that same rigor to ${company}. I'm available for a conversation any time and would welcome a technical screen at your convenience.

Sincerely,
[Your Name]`;
}

function localInterview(prompt: string): string {
  const company = extract(prompt, /at ([A-Z][a-zA-Z0-9&. ]+?)[.,\n]/, "the company");
  return JSON.stringify(
    {
      questions: [
        {
          category: "technical",
          question: `Walk me through how you would architect a feature for ${company} that needs to scale to millions of users.`,
          difficulty: "medium",
          recommendedAnswer:
            "Start with the user journey and SLAs, then design the data model, API contracts, and frontend components. Pick proven primitives, instrument observability, and ship behind a feature flag with a clear rollback plan.",
          talkingPoints: ["User journey first", "Data model & API contracts", "Proven primitives", "Observability & flags", "Rollback plan"],
          starExample: {
            situation: "Scaled a feature from 0 to 40M monthly users.",
            task: "Keep p95 latency under 200ms.",
            action: "Introduced edge caching, optimized queries, added pagination.",
            result: "p95 dropped to 142ms; 99.98% uptime.",
          },
          followUps: ["How would you handle a 10x traffic spike?", "What if cache invalidation becomes a bottleneck?"],
        },
        {
          category: "behavioral",
          question: "Tell me about a time you had to ship something under a tight deadline.",
          difficulty: "easy",
          recommendedAnswer:
            "I scope ruthlessly, ship the smallest useful version, and over-communicate risk. I keep stakeholders informed twice a day so there are no surprises at launch.",
          talkingPoints: ["Scope ruthlessly", "Smallest useful version", "Twice-daily updates", "Risk register"],
          starExample: {
            situation: "Two-week deadline to ship a compliance dashboard.",
            task: "Deliver MVP that satisfies auditors.",
            action: "Cut 70% of scope, shipped read-only MVP.",
            result: "Passed audit on time; full version shipped 3 weeks later.",
          },
          followUps: ["How did stakeholders react to scope cuts?", "What would you do differently?"],
        },
        {
          category: "situational",
          question: "What would you do in your first 90 days at " + company + "?",
          difficulty: "medium",
          recommendedAnswer:
            "First 30 days: listen and document. Shadow calls, read code, meet every stakeholder. Days 31-60: pick one small high-impact project and ship it. Days 61-90: draft a 6-month roadmap with the team.",
          talkingPoints: ["Listen first", "Document everything", "One small high-impact win", "Co-created roadmap"],
          starExample: {
            situation: "Joined a team with unclear ownership.",
            task: "Establish credibility without disrupting flow.",
            action: "Listened for 30 days, shipped one high-leverage fix.",
            result: "Earned trust; roadmap adopted org-wide.",
          },
          followUps: ["What if your first project fails?", "How do you handle unclear ownership?"],
        },
        {
          category: "hr",
          question: "Why " + company + "?",
          difficulty: "easy",
          recommendedAnswer:
            `I'm drawn to ${company}'s mission and the quality of the team. The opportunity to work on problems at this scale, with this caliber of colleagues, is exactly what I'm looking for next.`,
          talkingPoints: ["Mission alignment", "Team quality", "Problem scale", "Long-term fit"],
          starExample: {
            situation: "Evaluated multiple offers.",
            task: "Pick the one with the steepest learning curve.",
            action: "Researched team, mission, and trajectory.",
            result: "Chose the team that maximized growth.",
          },
          followUps: ["Where do you see yourself in 3 years?", "What concerns you about the role?"],
        },
        {
          category: "company",
          question: `What's one thing you think ${company} could do better, and how would you approach it?`,
          difficulty: "hard",
          recommendedAnswer:
            `Based on my research, I think ${company} could sharpen its onboarding for new power users. I'd start by instrumenting the funnel, identifying the drop-off points, and shipping a guided first-run experience — measurable within one quarter.`,
          talkingPoints: ["Instrument first", "Find drop-offs", "Guided first-run", "Quarterly measurable"],
          starExample: {
            situation: "Noticed high churn in first 7 days at a previous role.",
            task: "Cut week-1 churn by 20%.",
            action: "Added guided onboarding + lifecycle emails.",
            result: "Week-1 churn dropped 27%; LTV up 14%.",
          },
          followUps: ["How would you validate the hypothesis?", "What if the data contradicts your intuition?"],
        },
      ],
    },
    null,
    2
  );
}

function localSummary(prompt: string): string {
  if (/front|react|ui|web/.test(prompt)) {
    return "Senior Frontend Engineer with 7+ years building performant, accessible web applications at scale. Shipped products used by 40M+ monthly users. Specialized in React, TypeScript, and design systems. Reduced Largest Contentful Paint by 38% across 12 properties.";
  }
  if (/back|server|api|node/.test(prompt)) {
    return "Senior Backend Engineer with 8+ years designing distributed systems. Built APIs serving 100K+ rps with 99.99% uptime. Specialized in Node.js, PostgreSQL, and event-driven architectures.";
  }
  if (/data|ml|ai/.test(prompt)) {
    return "Data Scientist with 5+ years turning messy data into shipped products. Built models that lifted revenue 12% YoY. Strong in Python, SQL, and ML deployment.";
  }
  return "Accomplished professional with a track record of shipping high-impact work, mentoring teammates, and improving the systems they touch. Combines technical depth with strong communication and a bias for measurable outcomes.";
}

function localBullets(prompt: string): string {
  if (/front|react|ui|web/.test(prompt)) {
    return [
      "Led migration to Next.js App Router, cutting build times by 62% and lifting Lighthouse scores from 71 to 98.",
      "Built design system used by 28 engineers across 6 teams; reduced UI bug rate by 41% over 12 months.",
      "Owned WCAG 2.1 AA accessibility audit and remediation across the host dashboard.",
      "Shipped virtualized list component handling 100K+ rows without jank.",
      "Mentored 4 junior engineers; 3 promoted within a year.",
    ].join("\n");
  }
  return [
    "Spearheaded initiative that delivered a 32% improvement in core product metric over two quarters.",
    "Owned end-to-end delivery of a critical feature used by 1M+ users, shipping on time and under budget.",
    "Reduced infrastructure costs by 24% through targeted optimization and removal of unused services.",
    "Mentored two junior teammates; both promoted within 18 months.",
    "Established quarterly OKR process adopted by three adjacent teams.",
  ].join("\n");
}

function localJD(prompt: string): string {
  return JSON.stringify(
    {
      title: extract(prompt, /\btitle[:\s]+([a-zA-Z][a-zA-Z0-9\- ]{2,40})/, "Senior Engineer"),
      company: extract(prompt, /\bcompany[:\s]+([a-zA-Z][a-zA-Z0-9&. ]{2,40})/, "the company"),
      location: "Remote",
      employmentType: "Full-time",
      salary: "Competitive",
      responsibilities: [
        "Build and maintain customer-facing features used by millions of users.",
        "Collaborate cross-functionally with design, product, and backend teams.",
        "Drive performance, accessibility, and reliability improvements.",
        "Mentor mid-level engineers and contribute to technical design reviews.",
      ],
      requiredSkills: ["JavaScript", "TypeScript", "React", "HTML", "CSS"],
      preferredSkills: ["Next.js", "Node.js", "GraphQL", "Testing", "Accessibility"],
      technologies: ["React", "TypeScript", "Next.js", "GraphQL", "Playwright"],
      experienceYears: "5+ years",
      education: "B.S. in Computer Science or equivalent experience",
      keywords: ["React", "TypeScript", "performance", "accessibility", "Next.js", "GraphQL", "frontend"],
    },
    null,
    2
  );
}

function localATS(prompt: string): string {
  return JSON.stringify(
    {
      scores: { ats: 87, formatting: 92, keywords: 78, content: 90, grammar: 95, completeness: 84 },
      recommendations: [
        {
          severity: "warning",
          category: "Keywords",
          title: "Add 3 missing keywords from the target job description",
          description: "ATS systems weight keyword density heavily. Your resume matches 6/9 target keywords.",
          fix: "Add the missing keywords in context — never list them blankly.",
        },
        {
          severity: "info",
          category: "Formatting",
          title: "Standardize phone number format",
          description: "Parentheses can confuse some parsers.",
          fix: "Use +1-415-555-0182 format.",
        },
        {
          severity: "success",
          category: "Content",
          title: "Strong quantified achievements",
          description: "You have 5+ bullets with measurable outcomes — excellent.",
        },
      ],
      missingKeywords: ["Playwright", "Storybook", "Vite"],
      matchedKeywords: ["React", "TypeScript", "Next.js", "GraphQL", "Accessibility", "Performance"],
      weakSections: [],
    },
    null,
    2
  );
}

function localRewrite(prompt: string): string {
  // Return rewritten bullets
  return [
    "• Led migration to modern framework, cutting build times by 62% and lifting Lighthouse scores from 71 to 98.",
    "• Built design system used by 28 engineers across 6 teams; reduced UI bug rate by 41% over 12 months.",
    "• Owned WCAG 2.1 AA accessibility remediation across the host dashboard.",
    "• Shipped customer-facing search experience serving 40M monthly users; lifted conversion 6.4%.",
    "• Mentored 4 engineers; 3 promoted within a year.",
  ].join("\n");
}

function extract(s: string, re: RegExp, fallback: string): string {
  const m = s.match(re);
  if (m && m[1]) return m[1].trim();
  return fallback;
}

/**
 * Stream-ish helper: yields chunks for typewriter UI. Returns final text.
 */
export async function callAIStreamed(opts: AICallOptions, onChunk: (chunk: string) => void): Promise<AICallResult> {
  const result = await callAI(opts);
  // Simulate streaming for snappier UX
  const words = result.text.split(/(\s+)/);
  for (let i = 0; i < words.length; i++) {
    onChunk(words[i]);
    // Speed up for long outputs
    if (i % 12 === 0) await new Promise((r) => setTimeout(r, 8));
  }
  return result;
}

/** Helper for React components to read providers from the store */
export function useAIProviders() {
  return useApp((s) => s.providers.filter((p) => p.isActive).sort((a, b) => a.priority - b.priority));
}

export function usePreferredProvider() {
  return useApp((s) =>
    s.providers.find((p) => p.isActive && p.type !== "z-ai-fallback") ??
    s.providers.find((p) => p.isActive) ??
    null
  );
}
