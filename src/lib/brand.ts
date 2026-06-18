// ResumeAI Pro brand config

/**
 * ACCESS CONTROL — Super Admin email allowlist.
 * Only this email receives the super_admin role on sign-in.
 * All other users get the "user" role by default.
 * To add more super admins, push additional emails to this array.
 */
export const SUPER_ADMIN_EMAILS: string[] = [
  "relsabah@gmail.com",
];

/**
 * Admin email allowlist (can manage users, view analytics — but NOT
 * AI providers, branding, prompts, feature flags, or audit logs).
 */
export const ADMIN_EMAILS: string[] = [
  "relsabah@gmail.com",
];

/**
 * Determine the role for a given email at sign-in time.
 * Super admin check is case-insensitive and trims whitespace.
 */
export function getRoleForEmail(email: string): "super_admin" | "admin" | "user" {
  const normalized = email.trim().toLowerCase();
  if (SUPER_ADMIN_EMAILS.some((e) => e.toLowerCase() === normalized)) return "super_admin";
  if (ADMIN_EMAILS.some((e) => e.toLowerCase() === normalized)) return "admin";
  return "user";
}

export function isSuperAdmin(email?: string | null): boolean {
  if (!email) return false;
  return SUPER_ADMIN_EMAILS.some((e) => e.toLowerCase() === email.trim().toLowerCase());
}

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
  { key: "users", label: "Users", icon: "Users", group: "Super Admin" },
  { key: "user-approvals", label: "User Approvals", icon: "UserCheck", group: "Super Admin" },
  { key: "suspended-users", label: "Suspended Users", icon: "Ban", group: "Super Admin" },
  { key: "ai-providers", label: "AI Providers", icon: "Cpu", group: "Super Admin" },
  { key: "ai-models", label: "AI Models", icon: "Boxes", group: "Super Admin" },
  { key: "prompts", label: "AI Prompts", icon: "Brain", group: "Super Admin" },
  { key: "ai-settings", label: "AI Routing", icon: "Sliders", group: "Super Admin" },
  { key: "branding", label: "Branding", icon: "Palette", group: "Super Admin" },
  { key: "feature-flags", label: "Feature Flags", icon: "Flag", group: "Super Admin" },
  { key: "optimizer-directive", label: "Optimizer Directive", icon: "SlidersHorizontal", group: "Super Admin" },
  { key: "logs", label: "Audit Logs", icon: "ScrollText", group: "Super Admin" },
];
