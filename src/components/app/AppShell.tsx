"use client";

import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { useApp } from "@/lib/store";
import { Dashboard } from "./modules/Dashboard";
import { MyResumes } from "./modules/MyResumes";
import { ATSChecker } from "./modules/ATSChecker";
import { Builder } from "./modules/Builder";
import { Optimizer } from "./modules/Optimizer";
import { CoverLetter } from "./modules/CoverLetter";
import { Interview } from "./modules/Interview";
import { JDScraper } from "./modules/JDScraper";
import { AITools } from "./modules/AITools";
import { Downloads } from "./modules/Downloads";
import { Settings } from "./modules/Settings";
import { Admin } from "./modules/Admin";
import { Users } from "./modules/Users";
import { UserApprovals } from "./modules/UserApprovals";
import { Analytics } from "./modules/Analytics";
import { SuperAdmin } from "./modules/SuperAdmin";
import { AIProviders } from "./modules/AIProviders";
import { AIModels } from "./modules/AIModels";
import { AIProviderSettings } from "./modules/AIProviderSettings";
import { Prompts } from "./modules/Prompts";
import { Branding } from "./modules/Branding";
import { FeatureFlags } from "./modules/FeatureFlags";
import { Logs } from "./modules/Logs";
import { OptimizerDirective } from "./modules/OptimizerDirective";
import { AIDevAgent } from "./modules/AIDevAgent";
import { AIWorkspace } from "./modules/AIWorkspace";
import {
  LinkedinImport, ResumeVersioning, MultiLanguage, ResumeSharing, AbTesting,
  BulkGenerator, ResumeAnalytics, AppTracker, SalaryInsights, SkillGap,
  CareerPath, CompanyResearch, JobAlerts, CertTracker, Networking,
  AiCoach, AiMockInterview, AiSalaryCoach, AiEmailWriter,
  AiJobMatch, AiAchievement, Integrations,
} from "./modules/CareerTools";
import { ResumeReviewPlatform } from "./modules/ResumeReviewPlatform";
import { SafeRender } from "./SafeRender";
import type { ViewKey } from "@/lib/types";

const VIEW_COMPONENTS: Record<ViewKey, React.FC> = {
  landing: Dashboard, // never used (landing renders separately)
  dashboard: Dashboard,
  resumes: MyResumes,
  "ats-checker": ATSChecker,
  builder: Builder,
  optimizer: Optimizer,
  "cover-letter": CoverLetter,
  interview: Interview,
  "jd-scraper": JDScraper,
  "ai-tools": AITools,
  downloads: Downloads,
  settings: Settings,
  admin: Admin,
  users: Users,
  "user-approvals": UserApprovals,
  "suspended-users": UserApprovals, // reuse — shows same component, filtered differently
  analytics: Analytics,
  "super-admin": SuperAdmin,
  "ai-providers": AIProviders,
  "ai-models": AIModels,
  "ai-settings": AIProviderSettings,
  "ai-logs": Logs,
  prompts: Prompts,
  branding: Branding,
  "feature-flags": FeatureFlags,
  "optimizer-directive": OptimizerDirective,
  "ai-dev-agent": AIDevAgent,
  "ai-workspace": AIWorkspace,
  "linkedin-import": LinkedinImport,
  "resume-versioning": ResumeVersioning,
  "multi-language": MultiLanguage,
  "resume-sharing": ResumeSharing,
  "ab-testing": AbTesting,
  "bulk-generator": BulkGenerator,
  "resume-analytics": ResumeAnalytics,
  "app-tracker": AppTracker,
  "salary-insights": SalaryInsights,
  "skill-gap": SkillGap,
  "career-path": CareerPath,
  "company-research": CompanyResearch,
  "job-alerts": JobAlerts,
  "cert-tracker": CertTracker,
  "networking": Networking,
  "ai-coach": AiCoach,
  "ai-mock-interview": AiMockInterview,
  "ai-salary-coach": AiSalaryCoach,
  "ai-email-writer": AiEmailWriter,
  "ai-resume-review": ResumeReviewPlatform,
  "ai-job-match": AiJobMatch,
  "ai-achievement": AiAchievement,
  "integrations": Integrations,
  logs: Logs,
};

// ============================================================================
// Access control — which views require which role.
// ============================================================================
// The sidebar already hides these views from non-superadmin users, but this
// map enforces access control at the AppShell level too. If a user somehow
// navigates to a restricted view (via browser history, URL, or programmatic
// setView), they'll be redirected to the dashboard instead of seeing the
// restricted content.

const SUPER_ADMIN_VIEWS: ViewKey[] = [
  "super-admin",
  "user-approvals",
  "suspended-users",
  "ai-providers",
  "ai-models",
  "ai-settings",
  "ai-logs",
  "prompts",
  "branding",
  "feature-flags",
  "optimizer-directive",
  "ai-dev-agent",
  "ai-workspace",
  "logs",
];

const ADMIN_VIEWS: ViewKey[] = [
  "admin",
  "users",
  "analytics",
];

/**
 * Check if the user's role allows access to the given view.
 *   - "user" → only NAV_USER views (dashboard, resumes, tools, settings, downloads)
 *   - "admin" → NAV_USER + NAV_ADMIN views (admin overview, users, analytics)
 *   - "super_admin" → all views (including AI providers, branding, feature flags, logs)
 */
function canAccessView(view: ViewKey, role: string): boolean {
  // Super admin can access everything
  if (role === "super_admin") return true;
  // Admin can access user + admin views (but NOT super-admin views)
  if (role === "admin") {
    return !SUPER_ADMIN_VIEWS.includes(view);
  }
  // Regular user can only access user views (NOT admin or super-admin views)
  return !SUPER_ADMIN_VIEWS.includes(view) && !ADMIN_VIEWS.includes(view);
}

export function AppShell() {
  const view = useApp((s) => s.view) as ViewKey;
  const setView = useApp((s) => s.setView);
  const user = useApp((s) => s.user);
  const role = user?.role ?? "user";

  // Access control: if the current view requires a higher role than the user
  // has, redirect to the dashboard. This prevents non-superadmin users from
  // seeing AI Providers, API settings, branding, feature flags, etc. even if
  // they somehow trigger setView("ai-providers").
  useEffect(() => {
    if (!canAccessView(view, role)) {
      console.warn(`[AppShell] Access denied: user role "${role}" cannot view "${view}". Redirecting to dashboard.`);
      setView("dashboard");
    }
  }, [view, role, setView]);

  // If the view is restricted, render the dashboard while the redirect effect runs
  const effectiveView = canAccessView(view, role) ? view : "dashboard";
  // Build a friendly label for the error boundary based on the view
  const viewLabel = effectiveView.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const ActiveView = VIEW_COMPONENTS[effectiveView] ?? Dashboard;

  return (
    <div className="min-h-screen flex bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar />
        <main className="flex-1 p-4 sm:p-6 max-w-[1400px] w-full mx-auto overflow-x-hidden">
          <AnimatePresence mode="wait">
            <motion.div
              key={effectiveView}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
            >
              <SafeRender label={viewLabel}>
                <ActiveView />
              </SafeRender>
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
