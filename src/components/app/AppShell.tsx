"use client";

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
  logs: Logs,
};

export function AppShell() {
  const view = useApp((s) => s.view) as ViewKey;
  const ActiveView = VIEW_COMPONENTS[view] ?? Dashboard;

  return (
    <div className="min-h-screen flex bg-background">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar />
        <main className="flex-1 p-4 sm:p-6 max-w-[1400px] w-full mx-auto overflow-x-hidden">
          <AnimatePresence mode="wait">
            <motion.div
              key={view}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
            >
              <ActiveView />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
