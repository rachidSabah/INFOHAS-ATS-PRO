// ResumeAI Pro — mock/seed data for demo
import type {
  User, ResumeData, JobDescription, AIProvider, PromptTemplate,
  BrandingConfig, FeatureFlags, AuditLog, CoverLetter, InterviewPackage, ATSReport,
} from "./types";
import { BRAND } from "./brand";

export const SEED_USER: User = {
  id: "u_demo_001",
  name: "Alex Morgan",
  email: "alex.morgan@example.com",
  avatarUrl: "",
  role: "super_admin", // demo: full access
  provider: "email",
  createdAt: "2025-09-12T10:00:00Z",
  lastActiveAt: new Date().toISOString(),
  usage: { resumesGenerated: 14, atsChecks: 27, coverLetters: 9, interviewPreps: 6, downloads: 41 },
  status: "active",
};

export const SEED_RESUMES: ResumeData[] = [
  {
    id: "r_seed_001",
    name: "Alex Morgan",
    headline: "Senior Frontend Engineer",
    contact: {
      email: "alex.morgan@example.com",
      phone: "+1 (415) 555-0182",
      location: "San Francisco, CA",
      website: "alexmorgan.dev",
      linkedin: "linkedin.com/in/alexmorgan",
      github: "github.com/alexmorgan",
    },
    summary:
      "Senior Frontend Engineer with 7+ years building performant, accessible web applications at scale. Shipped products used by 40M+ monthly users. Specialized in React, TypeScript, and design systems. Reduced Largest Contentful Paint by 38% across 12 properties.",
    experience: [
      {
        id: "e1",
        company: "Vercel",
        title: "Senior Frontend Engineer",
        location: "Remote",
        startDate: "2022-03",
        endDate: "Present",
        bullets: [
          "Led migration of marketing site to Next.js App Router, cutting build times by 62% and improving Lighthouse scores from 71 to 98.",
          "Built design system used by 28 engineers across 6 teams; reduced UI bug rate by 41% over 12 months.",
          "Mentored 4 junior engineers; 3 promoted within a year.",
        ],
      },
      {
        id: "e2",
        company: "Airbnb",
        title: "Frontend Engineer",
        location: "San Francisco, CA",
        startDate: "2019-06",
        endDate: "2022-02",
        bullets: [
          "Implemented new search experience serving 40M monthly users; increased booking conversion by 6.4%.",
          "Owned accessibility audit and remediation for the host dashboard, achieving WCAG 2.1 AA compliance.",
        ],
      },
    ],
    education: [
      {
        id: "ed1",
        institution: "University of California, Berkeley",
        degree: "B.S.",
        field: "Computer Science",
        startDate: "2014-09",
        endDate: "2018-05",
        gpa: "3.8",
      },
    ],
    skills: [
      { id: "s1", name: "React", category: "Frontend", level: "expert" },
      { id: "s2", name: "TypeScript", category: "Languages", level: "expert" },
      { id: "s3", name: "Next.js", category: "Frontend", level: "expert" },
      { id: "s4", name: "Tailwind CSS", category: "Styling", level: "expert" },
      { id: "s5", name: "Node.js", category: "Backend", level: "advanced" },
      { id: "s6", name: "GraphQL", category: "API", level: "advanced" },
      { id: "s7", name: "Accessibility (WCAG)", category: "Quality", level: "advanced" },
      { id: "s8", name: "Performance Optimization", category: "Quality", level: "expert" },
    ],
    projects: [
      {
        id: "p1",
        name: "OpenResumeKit",
        description: "Open-source ATS-friendly resume component library.",
        url: "github.com/alexmorgan/openresumekit",
        bullets: ["1.4k GitHub stars", "Used by 200+ job seekers in beta"],
      },
    ],
    certifications: [
      { id: "c1", name: "AWS Certified Cloud Practitioner", issuer: "Amazon Web Services", date: "2023-08" },
    ],
    languages: [
      { id: "l1", name: "English", proficiency: "native" },
      { id: "l2", name: "Spanish", proficiency: "conversational" },
    ],
    achievements: ["Speaker — React Summit 2024", "Top 1% contributor — Vercel internal OSS"],
    template: "ats-professional",
    accentColor: "#1154A3",
    createdAt: "2025-10-01T10:00:00Z",
    updatedAt: "2025-12-04T14:30:00Z",
    source: "manual",
    fileName: "alex_morgan_resume.pdf",
  },
];

export const SEED_JDS: JobDescription[] = [
  {
    id: "jd_seed_001",
    title: "Senior Frontend Engineer",
    company: "Stripe",
    location: "Remote (US)",
    employmentType: "Full-time",
    salary: "$180,000 – $240,000",
    responsibilities: [
      "Build and maintain customer-facing UI used by millions of businesses.",
      "Collaborate with design and backend teams to ship reliable features.",
      "Drive performance and accessibility improvements across the dashboard.",
      "Mentor mid-level engineers and lead technical design reviews.",
    ],
    requiredSkills: ["React", "TypeScript", "JavaScript", "HTML", "CSS", "Accessibility", "Performance"],
    preferredSkills: ["Next.js", "GraphQL", "Node.js", "Testing", "Design Systems"],
    technologies: ["React", "TypeScript", "Next.js", "GraphQL", "Vite", "Playwright", "Storybook"],
    experienceYears: "5+ years",
    education: "B.S. in Computer Science or equivalent experience",
    keywords: ["React", "TypeScript", "accessibility", "performance", "design systems", "Next.js", "GraphQL", "WCAG", "frontend"],
    source: "text",
    createdAt: "2025-11-22T09:00:00Z",
  },
];

export const SEED_PROVIDERS: AIProvider[] = [
  {
    id: "p_puter",
    name: "Puter.js (Free, user-auth)",
    type: "puter",
    apiUrl: "https://api.puter.com",
    priority: 1,
    isActive: true,
    isBuiltIn: true,
    timeout: 30000,
    maxTokens: 4096,
    temperature: 0.7,
    modelName: "claude-sonnet-4",
    status: "healthy",
    usage: { requests: 1842, tokens: 940220, errors: 12, avgLatencyMs: 1820 },
  },
  {
    id: "p_zai",
    name: "Z.ai Fallback (built-in)",
    type: "z-ai-fallback",
    apiUrl: "internal",
    priority: 99,
    isActive: true,
    isBuiltIn: true,
    timeout: 20000,
    maxTokens: 4096,
    temperature: 0.7,
    modelName: "glm-4.6",
    status: "healthy",
    usage: { requests: 612, tokens: 281044, errors: 3, avgLatencyMs: 980 },
  },
  {
    id: "p_openai",
    name: "OpenAI (user-supplied)",
    type: "openai",
    apiUrl: "https://api.openai.com/v1",
    priority: 10,
    isActive: false,
    timeout: 30000,
    maxTokens: 4096,
    temperature: 0.7,
    modelName: "gpt-4o-mini",
    status: "down",
    usage: { requests: 0, tokens: 0, errors: 0, avgLatencyMs: 0 },
  },
];

export const SEED_PROMPTS: PromptTemplate[] = [
  {
    id: "pt_001",
    name: "ATS Resume Rewrite",
    category: "rewrite",
    content:
      "You are a senior ATS optimization expert. Rewrite the candidate's resume bullets to be ATS-friendly, quantified, and impactful. Keep all claims truthful. Use strong action verbs, add measurable outcomes where context permits, and embed target keywords naturally.\n\nTarget keywords: {{keywords}}\n\nOriginal resume:\n{{resume}}",
    version: 3,
    isActive: true,
    variables: ["keywords", "resume"],
  },
  {
    id: "pt_002",
    name: "Cover Letter — Modern",
    category: "cover-letter",
    content:
      "Write a modern, concise, ATS-friendly cover letter (~280 words) for {{role}} at {{company}}. Match the candidate's voice to the company's industry. Open with a specific, non-generic hook. Close with a confident CTA.\n\nCandidate resume:\n{{resume}}\n\nJob description:\n{{jd}}",
    version: 2,
    isActive: true,
    variables: ["role", "company", "resume", "jd"],
  },
  {
    id: "pt_003",
    name: "Interview Question Generator",
    category: "interview",
    content:
      "Generate a balanced interview preparation package for {{role}} at {{company}}. Include 3 technical, 3 behavioral, 2 situational, 2 HR, and 2 company-specific questions. For each, provide a recommended answer, 3-4 talking points, a STAR example, difficulty (easy/medium/hard), and 2 follow-up questions.\n\nCandidate resume:\n{{resume}}\n\nJob description:\n{{jd}}",
    version: 1,
    isActive: true,
    variables: ["role", "company", "resume", "jd"],
  },
];

export const SEED_BRANDING: BrandingConfig = {
  appName: BRAND.name,
  tagline: BRAND.tagline,
  primaryColor: BRAND.primaryColor,
  accentColor: BRAND.accentColor,
  logoUrl: BRAND.logoUrl,
  emailFromName: BRAND.name,
  emailFromAddress: BRAND.email,
  pdfFooterText: "Generated by ResumeAI Pro — resumeai.pro",
};

export const SEED_FLAGS: FeatureFlags = {
  enableResumeBuilder: true,
  enableATSChecker: true,
  enableOptimizer: true,
  enableCoverLetter: true,
  enableInterviewPrep: true,
  enableJDScraper: true,
  enableAIFailover: true,
  enableDonations: true,
  enableAds: false,
  maintenanceMode: false,
};

export const SEED_LOGS: AuditLog[] = [
  { id: "l1", timestamp: new Date(Date.now() - 1000 * 60 * 4).toISOString(), actor: "alex.morgan@example.com", action: "ATS check completed", category: "resume", details: "Score 87/100 for resume r_seed_001", severity: "info" },
  { id: "l2", timestamp: new Date(Date.now() - 1000 * 60 * 18).toISOString(), actor: "system", action: "AI provider failover", category: "ai", details: "Puter → Z.ai fallback (rate limit)", severity: "warning" },
  { id: "l3", timestamp: new Date(Date.now() - 1000 * 60 * 62).toISOString(), actor: "alex.morgan@example.com", action: "Cover letter exported (PDF)", category: "export", details: "cover_letter_stripe.pdf", severity: "info" },
  { id: "l4", timestamp: new Date(Date.now() - 1000 * 60 * 120).toISOString(), actor: "admin@resumeai.pro", action: "Prompt updated", category: "admin", details: "ATS Resume Rewrite v2 → v3", severity: "info" },
  { id: "l5", timestamp: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(), actor: "system", action: "Backup completed", category: "system", details: "R2 snapshot OK (128 MB)", severity: "info" },
];

export const SEED_COVER_LETTERS: CoverLetter[] = [
  {
    id: "cl_seed_001",
    title: "Cover Letter — Stripe",
    template: "modern",
    content:
      "Dear Stripe Hiring Team,\n\nWhen I read that Stripe's mission is to increase the GDP of the internet, two things came to mind: the team that ships the dashboard UI is the team that makes that promise tangible for millions of businesses, and that's exactly the team I want to join.\n\nOver the past seven years I've built and scaled React applications used by 40M+ monthly users — most recently leading Vercel's marketing migration to the App Router, cutting build times by 62% and lifting Lighthouse scores from 71 to 98. I've owned WCAG 2.1 AA remediation end-to-end and shipped the design system that now backs six internal teams.\n\nI'd love to bring that rigor to Stripe's dashboard. I'm available for a conversation any time and would welcome a technical screen.\n\nSincerely,\nAlex Morgan",
    resumeId: "r_seed_001",
    jdId: "jd_seed_001",
    company: "Stripe",
    role: "Senior Frontend Engineer",
    createdAt: "2025-11-22T11:00:00Z",
    updatedAt: "2025-11-22T11:20:00Z",
  },
];

export const SEED_INTERVIEW: InterviewPackage[] = [
  {
    id: "iv_seed_001",
    resumeId: "r_seed_001",
    jdId: "jd_seed_001",
    company: "Stripe",
    role: "Senior Frontend Engineer",
    createdAt: "2025-11-22T12:00:00Z",
    questions: [
      {
        id: "q1",
        category: "technical",
        question: "Walk me through how you'd optimize a React dashboard that takes 4s to become interactive.",
        difficulty: "medium",
        recommendedAnswer:
          "Profile first with React DevTools and Lighthouse. Common culprits: over-rendering list rows, large client bundles, and unoptimized images. I'd introduce React.memo / useMemo where referential equality matters, code-split routes, virtualize long lists, and move heavy work to web workers.",
        talkingPoints: ["Measure before optimizing", "Bundle splitting", "Virtualization", "Web workers", "Rerender audit"],
        starExample: {
          situation: "Vercel marketing site had a 71 Lighthouse score.",
          task: "Reach 95+ within a quarter.",
          action: "Migrated to App Router, code-split, introduced route-level suspense.",
          result: "Lighthouse hit 98; LCP dropped 38%.",
        },
        followUps: ["How would you measure success?", "What if the bottleneck were the network?"],
      },
      {
        id: "q2",
        category: "behavioral",
        question: "Tell me about a time you disagreed with a teammate on a technical decision.",
        difficulty: "easy",
        recommendedAnswer:
          "I prefer to disagree by building, not arguing. I'll prototype the alternative quickly, document the trade-offs in a one-pager, and let the team decide with data. This keeps relationships intact and surfaces the best decision.",
        talkingPoints: ["Prototype-first", "Documented trade-offs", "Data-driven decision", "Relationship preservation"],
        starExample: {
          situation: "Disagreed on CSS-in-JS vs Tailwind at Vercel.",
          task: "Pick the right styling system for the design system.",
          action: "Built a side-by-side benchmark, ran it past design.",
          result: "Team chose Tailwind; UI bug rate dropped 41%.",
        },
        followUps: ["What if you couldn't prototype?", "How do you handle stalemates?"],
      },
    ],
  },
];

export const SEED_ATS_REPORTS: ATSReport[] = [
  {
    id: "ats_seed_001",
    resumeId: "r_seed_001",
    scores: { ats: 87, formatting: 92, keywords: 78, content: 90, grammar: 95, completeness: 84 },
    recommendations: [
      { id: "rec1", severity: "warning", category: "Keywords", title: "Add 3 missing keywords", description: "Job description emphasizes WCAG, design systems, and Playwright — currently underrepresented.", fix: "Mention Playwright in test coverage and WCAG in your accessibility work explicitly." },
      { id: "rec2", severity: "info", category: "Formatting", title: "Contact phone format", description: "Phone uses parentheses which some ATS parsers dislike.", fix: "Use +1-415-555-0182 format." },
      { id: "rec3", severity: "success", category: "Content", title: "Strong quantified bullets", description: "62%, 41%, 98 Lighthouse — excellent measurable outcomes." },
    ],
    missingKeywords: ["Playwright", "Storybook", "Vite"],
    matchedKeywords: ["React", "TypeScript", "Next.js", "GraphQL", "Accessibility", "Performance"],
    weakSections: [],
    jdMatchPercent: 87,
    createdAt: "2025-12-01T10:00:00Z",
  },
];
