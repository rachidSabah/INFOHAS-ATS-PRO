"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge, Icon } from "@/components/shared";
import { useApp } from "@/lib/store";
import { api as cloudApi } from "@/lib/cloud-api";
import { UnsavedBanner } from "./unsaved-changes";
import { toast } from "sonner";
import type { FeatureFlags as Flags } from "@/lib/types";

// Default seed values to allow "Reset to Defaults"
const DEFAULT_SEED_FLAGS: Record<keyof Flags, boolean> = {
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
  pipeline_websocket_enabled: false,
  enableAIGuardian: true,
  enableSelfHealing: true,
  enableModelArena: true,
  enableDurablePipeline: true,
  enableRateGovernor: true,
};

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
  { key: "pipeline_websocket_enabled", label: "WebSocket Pipeline", desc: "Enable real-time WebSocket connection to the pipeline worker.", icon: "Network", severity: "safe" },
  { key: "enableAIGuardian", label: "AI Guardian Auditor", desc: "Enforce honesty via the Guardian Agent to filter fact fabrications.", icon: "ShieldAlert", severity: "safe" },
  { key: "enableSelfHealing", label: "Autonomous Self-Healing", desc: "Automatically schedule self-healing scripts to repair API nodes on failures.", icon: "Activity", severity: "safe" },
  { key: "enableModelArena", label: "Multi-Model Variant Arena", desc: "Run optimization variants in parallel on different providers and choose the highest-scoring layout/ATS output.", icon: "Swords", severity: "safe" },
  { key: "enableDurablePipeline", label: "Durable Pipeline Queue", desc: "Run optimizer stages as durable D1 jobs (resumable, retry with backoff on rate limits, stage checkpoints). Falls back to the inline pipeline on any failure.", icon: "DatabaseZap", severity: "safe" },
  { key: "enableRateGovernor", label: "Rate Governor", desc: "Proactively pace AI calls per provider (token bucket + Retry-After) so parallel agents avoid hitting provider 429 limits.", icon: "Gauge", severity: "safe" },
  { key: "maintenanceMode", label: "Maintenance Mode", desc: "Take the entire app offline for users.", icon: "Wrench", severity: "danger" },
];

export function FeatureFlags() {
  const flags = useApp((s) => s.flags);
  const updateFlag = useApp((s) => s.updateFlag);
  const log = useApp((s) => s.log);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "feature" | "safe" | "danger">("all");
  const [savingAll, setSavingAll] = useState(false);
  // Unsaved-changes tracking (same contract as the other Super Admin panels):
  // toggles/reset mark the panel dirty until the explicit save-all confirms
  // every flag reached D1. Cleared only on a fully successful save.
  const [dirty, setDirty] = useState(false);
  const toggleFlag = (key: keyof Flags, val: boolean) => {
    updateFlag(key, val);
    setDirty(true);
  };

  const filteredFlags = FLAGS.filter((f) => {
    const matchesSearch = f.label.toLowerCase().includes(search.toLowerCase()) || 
                          f.desc.toLowerCase().includes(search.toLowerCase());
    const matchesFilter = filter === "all" || f.severity === filter;
    return matchesSearch && matchesFilter;
  });

  // Explicit Save button — persists EVERY flag to D1 (PUT /api/settings/flags/:key)
  // so the whole flag set is guaranteed refresh-proof even if an individual
  // fire-and-forget toggle sync failed earlier. Toggles still apply instantly;
  // this button is the authoritative "commit to server" affordance.
  const handleSaveAll = async () => {
    setSavingAll(true);
    try {
      const entries = Object.entries(flags) as [keyof Flags, boolean][];
      const results = await Promise.allSettled(entries.map(([k, v]) => cloudApi.updateFlag(k, v)));
      const failed = results.filter((r) => r.status === "rejected").length;
      if (failed === 0) {
        setDirty(false);
        log({ actor: "you", action: "All feature flags saved to cloud", category: "admin", details: `${entries.length} flags persisted`, severity: "info" });
        toast.success("All feature flags saved — they survive refresh now.");
      } else {
        log({ actor: "you", action: "Feature flag save partially failed", category: "admin", details: `${failed}/${entries.length} failed`, severity: "warning" });
        toast.error(`${failed} flag(s) failed to save — check your connection and retry.`);
      }
    } finally {
      setSavingAll(false);
    }
  };

  const handleResetDefaults = () => {
    Object.entries(DEFAULT_SEED_FLAGS).forEach(([key, val]) => {
      toggleFlag(key as keyof Flags, val);
    });
    log({ actor: "you", action: "Reset all flags to defaults", category: "admin", details: "All flags", severity: "warning" });
    toast.success("All feature flags reset to system defaults.");
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="Flag" className="w-6 h-6 text-brand" /> Feature Flags</h1>
          <p className="text-sm text-muted-foreground mt-1">Toggle features on or off instantly, without redeploying.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleSaveAll} disabled={savingAll} size="sm" className="gap-1.5 text-xs bg-brand hover:bg-brand-dark text-white">
            <Icon name="Save" className="w-3.5 h-3.5" />
            {savingAll ? "Saving…" : "Save All Flags"}
          </Button>
          <Button onClick={handleResetDefaults} variant="outline" size="sm" className="gap-1.5 text-xs">
            <Icon name="RotateCcw" className="w-3.5 h-3.5" />
            Reset to Defaults
          </Button>
        </div>
      </div>

      {dirty && (
        <UnsavedBanner saveLabel="Save All Flags">
          You have unsaved flags. Click &quot;Save All Flags&quot; to confirm them on the server.
        </UnsavedBanner>
      )}

      {/* Search and Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <Input
          placeholder="Search flags..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-xs h-9 text-xs"
        />
        <div className="flex gap-1.5 border border-border rounded-lg p-0.5 bg-secondary/20">
          {(["all", "feature", "safe", "danger"] as const).map((t) => (
            <Button
              key={t}
              onClick={() => setFilter(t)}
              variant={filter === t ? "secondary" : "ghost"}
              className="h-7 px-2.5 text-[10px] uppercase font-semibold tracking-wider rounded-md"
            >
              {t}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        {filteredFlags.map((f) => {
          const on = flags[f.key];
          return (
            <Card key={f.key} className={`${on ? "" : "opacity-75"} border border-border/80 transition-all hover:border-brand/35`}>
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
                  checked={!!on}
                  onCheckedChange={(v) => {
                    toggleFlag(f.key, v);
                    log({ actor: "you", action: `Flag ${f.key} ${v ? "ON" : "OFF"}`, category: "admin", details: f.label, severity: v ? "info" : "warning" });
                    toast.success(`${f.label} ${v ? "enabled" : "disabled"}.`);
                  }}
                />
              </CardContent>
            </Card>
          );
        })}
        {filteredFlags.length === 0 && (
          <div className="col-span-full text-center py-10 text-xs text-muted-foreground">
            No feature flags found matching the filters.
          </div>
        )}
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
