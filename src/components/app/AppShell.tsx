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
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/shared";
import { toast } from "sonner";
import type { ViewKey, AIProvider } from "@/lib/types";

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
  const fallbackOfferOpen = useApp((s) => s.fallbackOfferOpen);

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
      <AnimatePresence>
        {fallbackOfferOpen && <FallbackOfferModal />}
      </AnimatePresence>
    </div>
  );
}

function FallbackOfferModal() {
  const fallbackOfferChoices = useApp((s) => s.fallbackOfferChoices);
  const closeFallbackOffer = useApp((s) => s.closeFallbackOffer);
  const setDefaultProvider = useApp((s) => s.setDefaultProvider);

  const handleSelect = (providerId: string, providerName: string) => {
    setDefaultProvider(providerId);
    closeFallbackOffer();
    toast.success(`Switched default provider to ${providerName}. Please retry your operation.`);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={closeFallbackOffer}
    >
      <motion.div
        initial={{ y: 20, opacity: 0, scale: 0.97 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 20, opacity: 0, scale: 0.97 }}
        transition={{ type: "spring", damping: 26, stiffness: 280 }}
        className="bg-card rounded-2xl border border-border shadow-premium w-full max-w-md overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-6 border-b border-border flex items-start gap-4">
          <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center shrink-0">
            <Icon name="AlertTriangle" className="w-5 h-5 text-amber-500" />
          </div>
          <div className="flex-1">
            <h3 className="font-display font-bold text-lg text-foreground">
              Rate Limit Encountered
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              OpenCode Zen free models are temporarily rate-limited for third-party applications. Switch to a recommended fallback provider to continue.
            </p>
          </div>
          <Button variant="ghost" size="icon" className="-mt-1 -mr-2" onClick={closeFallbackOffer}>
            <Icon name="X" className="w-4 h-4" />
          </Button>
        </div>

        <div className="p-6 space-y-3">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Recommended Fallbacks
          </div>

          {fallbackOfferChoices.length === 0 ? (
            <p className="text-sm text-muted-foreground">No fallback providers configured. Please go to AI Providers settings to configure a provider.</p>
          ) : (
            <div className="space-y-2">
              {fallbackOfferChoices.map((p: AIProvider) => {
                let badgeText = "Recommended Fallback";
                if (p.type === "puter") badgeText = "Free & Keyless (Puter.js)";
                else if (p.type === "gemini") badgeText = "Google Gemini API";
                else if (p.type === "openrouter") badgeText = "OpenRouter API";
                else if (p.type === "opencode") badgeText = "Paid Zen Model";

                return (
                  <button
                    key={p.id}
                    onClick={() => handleSelect(p.id, p.name)}
                    className="w-full text-left p-3.5 rounded-xl border border-border bg-card hover:bg-accent/50 hover:border-brand/40 transition-all flex items-center justify-between group"
                  >
                    <div>
                      <div className="font-medium text-foreground group-hover:text-brand transition-colors">
                        {p.name}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {badgeText} · {p.modelName || "Default Model"}
                      </div>
                    </div>
                    <Icon name="ChevronRight" className="w-4 h-4 text-muted-foreground group-hover:text-brand group-hover:translate-x-0.5 transition-all" />
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="p-4 bg-muted/40 border-t border-border flex justify-end gap-2">
          <Button variant="outline" onClick={closeFallbackOffer}>
            Cancel
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}
