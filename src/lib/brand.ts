// ResumeAI Pro brand config
export const BRAND = {
  name: "ResumeAI Pro",
  shortName: "ResumeAI",
  tagline: "Land the offer. Beat the bots. Free forever.",
  description:
    "Premium AI-powered resume builder, ATS checker, optimizer, cover letter generator, and interview prep — completely free, no paywalls, no watermarks.",
  url: "https://resumeai.pro",
  email: "hello@resumeai.pro",
  logoUrl: "/brand/logo.svg",
  logoPngUrl: "/brand/logo.png",
  primaryColor: "#1154A3",
  accentColor: "#F59E0B",
  social: {
    github: "https://github.com/rachidSabah/INFOHAS-ATS-PRO",
    twitter: "https://twitter.com/resumeaipro",
  },
  freeForever: true,
} as const;

export const TEMPLATES: { id: string; name: string; description: string; premium?: boolean }[] = [
  { id: "ats-professional", name: "ATS Professional", description: "Single-column, bot-friendly, parses 100% cleanly." },
  { id: "executive", name: "Executive", description: "Refined serif header, ideal for senior leadership." },
  { id: "modern", name: "Modern", description: "Two-column with accent sidebar for skills & links." },
  { id: "corporate", name: "Corporate", description: "Classic structure with strong section rules." },
  { id: "europass", name: "Europass", description: "European-standard layout with photo placeholder." },
  { id: "creative", name: "Creative", description: "Bold color blocks for design-forward roles." },
  { id: "minimal", name: "Minimal", description: "Maximum whitespace, maximum focus." },
];

export const NAV_USER: { key: string; label: string; icon: string; group: string }[] = [
  { key: "dashboard", label: "Overview", icon: "LayoutDashboard", group: "Workspace" },
  { key: "resumes", label: "My Resumes", icon: "FileText", group: "Workspace" },
  { key: "ats-checker", label: "ATS Checker", icon: "ScanText", group: "Tools" },
  { key: "builder", label: "Resume Builder", icon: "FilePlus2", group: "Tools" },
  { key: "optimizer", label: "Resume Optimizer", icon: "Wand2", group: "Tools" },
  { key: "cover-letter", label: "Cover Letters", icon: "Mail", group: "Tools" },
  { key: "interview", label: "Interview Prep", icon: "MessagesSquare", group: "Tools" },
  { key: "jd-scraper", label: "Job Scraper", icon: "Search", group: "Tools" },
  { key: "ai-tools", label: "AI Tools", icon: "Sparkles", group: "Tools" },
  { key: "downloads", label: "Downloads", icon: "Download", group: "Workspace" },
  { key: "settings", label: "Settings", icon: "Settings", group: "Workspace" },
];

export const NAV_ADMIN: { key: string; label: string; icon: string; group: string }[] = [
  { key: "admin", label: "Admin Overview", icon: "ShieldCheck", group: "Admin" },
  { key: "users", label: "Users", icon: "Users", group: "Admin" },
  { key: "analytics", label: "Analytics", icon: "BarChart3", group: "Admin" },
];

export const NAV_SUPER: { key: string; label: string; icon: string; group: string }[] = [
  { key: "super-admin", label: "Super Overview", icon: "Crown", group: "Super Admin" },
  { key: "ai-providers", label: "AI Providers", icon: "Cpu", group: "Super Admin" },
  { key: "prompts", label: "Prompt Library", icon: "Brain", group: "Super Admin" },
  { key: "branding", label: "Branding", icon: "Palette", group: "Super Admin" },
  { key: "feature-flags", label: "Feature Flags", icon: "Flag", group: "Super Admin" },
  { key: "logs", label: "Audit Logs", icon: "ScrollText", group: "Super Admin" },
];
