"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, Icon, ScoreRing } from "@/components/shared";
import { useApp } from "@/lib/store";

export function SuperAdmin() {
  const setView = useApp((s) => s.setView);
  const providers = useApp((s) => s.providers);
  const prompts = useApp((s) => s.prompts);
  const logs = useApp((s) => s.logs);
  const flags = useApp((s) => s.flags);

  const activeProviders = providers.filter((p) => p.isActive).length;
  const activePrompts = prompts.filter((p) => p.isActive).length;
  const systemHealth = Math.round(
    (activeProviders / Math.max(1, providers.length)) * 0.4 +
    (activePrompts / Math.max(1, prompts.length)) * 0.3 +
    (flags.maintenanceMode ? 0 : 0.3)
  * 100
  );

  const quickLinks = [
    { label: "AI Providers", desc: `${activeProviders} active of ${providers.length}`, icon: "Cpu", view: "ai-providers", color: "#1154A3" },
    { label: "Prompt Library", desc: `${prompts.length} templates · ${activePrompts} active`, icon: "Brain", view: "prompts", color: "#8B5CF6" },
    { label: "Branding", desc: "Customize logo, colors, email", icon: "Palette", view: "branding", color: "#EC4899" },
    { label: "Feature Flags", desc: `${Object.values(flags).filter(Boolean).length}/${Object.keys(flags).length} enabled`, icon: "Flag", view: "feature-flags", color: "#F59E0B" },
    { label: "Audit Logs", desc: `${logs.length} recent events`, icon: "ScrollText", view: "logs", color: "#10B981" },
    { label: "Users", desc: "Manage accounts & roles", icon: "Users", view: "users", color: "#0EA5E9" },
    { label: "Analytics", desc: "Platform metrics & funnel", icon: "BarChart3", view: "analytics", color: "#1154A3" },
    { label: "Admin Overview", desc: "KPIs & usage", icon: "ShieldCheck", view: "admin", color: "#10B981" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="Crown" className="w-6 h-6 text-gold" /> Super Admin Overview</h1>
        <p className="text-sm text-muted-foreground mt-1">Full system control. Configure AI providers, branding, prompts, flags, and audit logs.</p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* System health */}
        <Card className="gradient-brand text-white">
          <CardContent className="p-6 flex flex-col items-center justify-center text-center">
            <div className="relative">
              <ScoreRing value={Math.min(100, systemHealth)} size={120} label="Health" />
            </div>
            <div className="mt-3 font-semibold">System health</div>
            <div className="text-xs text-white/70 mt-1">
              {flags.maintenanceMode ? "Maintenance mode ON" : "All systems operational"}
            </div>
          </CardContent>
        </Card>

        {/* Stats */}
        <div className="lg:col-span-2 grid sm:grid-cols-2 gap-4">
          {[
            { label: "AI providers", value: `${activeProviders}/${providers.length}`, icon: "Cpu", color: "#1154A3" },
            { label: "Active prompts", value: `${activePrompts}/${prompts.length}`, icon: "Brain", color: "#8B5CF6" },
            { label: "Audit logs (24h)", value: logs.length, icon: "ScrollText", color: "#10B981" },
            { label: "Flags enabled", value: `${Object.values(flags).filter(Boolean).length}/${Object.keys(flags).length}`, icon: "Flag", color: "#F59E0B" },
          ].map((s) => (
            <Card key={s.label}>
              <CardContent className="p-5 flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: `${s.color}15`, color: s.color }}>
                  <Icon name={s.icon} className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-xl font-bold font-display">{s.value}</div>
                  <div className="text-xs text-muted-foreground">{s.label}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Quick links */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Super admin tools</CardTitle>
          <CardDescription>Jump directly to any control panel.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {quickLinks.map((q) => (
              <button key={q.label} onClick={() => setView(q.view as any)} className="group text-left rounded-xl border border-border p-4 hover:shadow-premium hover:-translate-y-0.5 transition-all">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-3" style={{ background: `${q.color}15`, color: q.color }}>
                  <Icon name={q.icon} className="w-5 h-5" />
                </div>
                <div className="font-semibold text-sm flex items-center gap-1">
                  {q.label}
                  <Icon name="ArrowRight" className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition" />
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">{q.desc}</div>
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Recent logs */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Recent audit events</CardTitle>
            <Button size="sm" variant="outline" onClick={() => setView("logs")}>View all</Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {logs.slice(0, 10).map((l) => {
              const sevColor = l.severity === "info" ? "brand" : l.severity === "warning" ? "warning" : "danger";
              return (
                <div key={l.id} className="flex items-start gap-3 p-2 rounded-lg hover:bg-secondary/40">
                  <Badge variant={sevColor as any} className="text-[10px] capitalize shrink-0">{l.severity}</Badge>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium truncate">{l.action}</div>
                    <div className="text-xs text-muted-foreground truncate">{l.details}</div>
                  </div>
                  <div className="text-xs text-muted-foreground shrink-0 whitespace-nowrap">{new Date(l.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
