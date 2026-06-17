"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge, Icon } from "@/components/shared";
import { useApp } from "@/lib/store";
import { toast } from "sonner";
import type { FeatureFlags as Flags } from "@/lib/types";

const FLAGS: { key: keyof Flags; label: string; desc: string; icon: string; severity: "safe" | "feature" | "danger" }[] = [
  { key: "enableResumeBuilder", label: "Resume Builder", desc: "Allow users to create and edit resumes.", icon: "FilePlus2", severity: "feature" },
  { key: "enableATSChecker", label: "ATS Checker", desc: "Enable the ATS scoring engine.", icon: "ScanText", severity: "feature" },
  { key: "enableOptimizer", label: "Resume Optimizer", desc: "Enable AI-powered resume optimization.", icon: "Wand2", severity: "feature" },
  { key: "enableCoverLetter", label: "Cover Letter Generator", desc: "Enable cover letter creation.", icon: "Mail", severity: "feature" },
  { key: "enableInterviewPrep", label: "Interview Prep", desc: "Enable interview question generation.", icon: "MessagesSquare", severity: "feature" },
  { key: "enableJDScraper", label: "Job Description Scraper", desc: "Allow URL-based JD scraping.", icon: "Search", severity: "feature" },
  { key: "enableAIFailover", label: "AI Failover", desc: "Automatically switch providers on failure.", icon: "RefreshCcw", severity: "safe" },
  { key: "enableDonations", label: "Donations", desc: "Show optional donation prompts.", icon: "Heart", severity: "safe" },
  { key: "enableAds", label: "Advertisements", desc: "Non-intrusive ads. Must never block features.", icon: "Megaphone", severity: "safe" },
  { key: "maintenanceMode", label: "Maintenance Mode", desc: "Take the entire app offline for users.", icon: "Wrench", severity: "danger" },
];

export function FeatureFlags() {
  const flags = useApp((s) => s.flags);
  const updateFlag = useApp((s) => s.updateFlag);
  const log = useApp((s) => s.log);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="Flag" className="w-6 h-6 text-brand" /> Feature Flags</h1>
        <p className="text-sm text-muted-foreground mt-1">Toggle features on or off instantly, without redeploying.</p>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        {FLAGS.map((f) => {
          const on = flags[f.key];
          return (
            <Card key={f.key} className={on ? "" : "opacity-70"}>
              <CardContent className="p-4 flex items-start gap-3">
                <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${f.severity === "danger" ? "bg-red-100 text-red-700 dark:bg-red-400/10 dark:text-red-300" : f.severity === "feature" ? "bg-brand-light text-brand dark:bg-brand/15" : "bg-amber-100 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300"}`}>
                  <Icon name={f.icon} className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="font-semibold text-sm">{f.label}</div>
                    {f.severity === "danger" && <Badge variant="danger" className="text-[10px]">Danger</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">{f.desc}</div>
                </div>
                <Switch
                  checked={on}
                  onCheckedChange={(v) => {
                    updateFlag(f.key, v);
                    log({ actor: "you", action: `Flag ${f.key} ${v ? "ON" : "OFF"}`, category: "admin", details: f.label, severity: v ? "info" : "warning" });
                    toast.success(`${f.label} ${v ? "enabled" : "disabled"}.`);
                  }}
                />
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="bg-amber-100/40 dark:bg-amber-400/5 border-amber-300/50">
        <CardContent className="p-4 flex items-start gap-3">
          <Icon name="AlertTriangle" className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div className="text-sm">
            <div className="font-semibold">Use with care</div>
            <div className="text-xs text-muted-foreground mt-1">Disabling core features will immediately hide them from all users. Maintenance mode blocks all non-admin access.</div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
