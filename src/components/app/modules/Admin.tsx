"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, Icon } from "@/components/shared";
import { useApp } from "@/lib/store";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

export function Admin() {
  const setView = useApp((s) => s.setView);
  const users = useApp((s) => s.users);
  const resumes = useApp((s) => s.resumes);
  const atsReports = useApp((s) => s.atsReports);
  const providers = useApp((s) => s.providers);
  const logs = useApp((s) => s.logs);
  const coverLetters = useApp((s) => s.coverLetters);
  const interviews = useApp((s) => s.interviews);

  // Live KPI data from actual store
  const totalUsers = users.length;
  const totalResumes = resumes.length;
  const totalATS = atsReports.length;
  const avgATS = atsReports.length > 0
    ? Math.round(atsReports.reduce((sum, r) => sum + (r.scores?.ats || 0), 0) / atsReports.length)
    : 0;

  const kpis = [
    { label: "Total users", value: totalUsers.toString(), icon: "Users", color: "#1154A3" },
    { label: "Resumes built", value: totalResumes.toString(), icon: "FileText", color: "#F59E0B" },
    { label: "ATS checks", value: totalATS.toString(), icon: "ScanText", color: "#10B981" },
    { label: "Avg ATS score", value: avgATS.toString(), icon: "TrendingUp", color: "#8B5CF6" },
  ];

  // Live provider data from actual store
  const activeProviders = providers.filter((p) => p.isActive);
  const providerData = activeProviders.map((p, i) => ({
    name: p.name,
    value: p.usage?.requests || 0,
    color: ["#1154A3", "#F59E0B", "#10B981", "#8B5CF6", "#EC4899", "#0EA5E9"][i % 6],
  })).filter((p) => p.value > 0);

  // Live usage data from logs (last 7 days)
  const now = new Date();
  const usageData = Array.from({ length: 7 }, (_, i) => {
    const date = new Date(now);
    date.setDate(date.getDate() - (6 - i));
    const dayName = date.toLocaleDateString("en", { weekday: "short" });
    const dayLogs = logs.filter((l) => {
      const logDate = new Date(l.timestamp);
      return logDate.toDateString() === date.toDateString();
    });
    return {
      name: dayName,
      resumes: dayLogs.filter((l) => /resume|upload|optim/i.test(l.action)).length,
      ats: dayLogs.filter((l) => /ats|score/i.test(l.action)).length,
      downloads: dayLogs.filter((l) => /export|download/i.test(l.action)).length,
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="ShieldCheck" className="w-6 h-6 text-brand" /> Admin Overview</h1>
        <p className="text-sm text-muted-foreground mt-1">Platform health, usage, and quick actions.</p>
      </div>

      {/* KPI cards — live data */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {kpis.map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-2">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: `${kpi.color}15`, color: kpi.color }}>
                  <Icon name={kpi.icon} className="w-5 h-5" />
                </div>
              </div>
              <div className="text-2xl font-bold font-display">{kpi.value}</div>
              <div className="text-xs text-muted-foreground">{kpi.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Usage chart — live data from logs */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">Weekly activity</CardTitle>
            <CardDescription>Resume actions, ATS checks, and exports (from audit logs).</CardDescription>
          </CardHeader>
          <CardContent>
            {usageData.every((d) => d.resumes === 0 && d.ats === 0 && d.downloads === 0) ? (
              <div className="flex items-center justify-center h-[240px] text-sm text-muted-foreground">
                <div className="text-center">
                  <Icon name="BarChart3" className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  No activity yet this week. Usage will appear here as users interact with the platform.
                </div>
              </div>
            ) : (
              <div style={{ width: "100%", height: 240 }}>
                <ResponsiveContainer>
                  <AreaChart data={usageData} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
                    <defs>
                      <linearGradient id="g1" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#1154A3" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="#1154A3" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="g2" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#F59E0B" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="#F59E0B" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#94A3B8" />
                    <YAxis tick={{ fontSize: 11 }} stroke="#94A3B8" allowDecimals={false} />
                    <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #E2E8F0", fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Area type="monotone" dataKey="resumes" stroke="#1154A3" fill="url(#g1)" strokeWidth={2} />
                    <Area type="monotone" dataKey="ats" stroke="#F59E0B" fill="url(#g2)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Provider usage — live data from provider usage stats */}
        <Card>
          <CardHeader><CardTitle className="text-lg">AI provider usage</CardTitle></CardHeader>
          <CardContent>
            {providerData.length === 0 ? (
              <div className="flex items-center justify-center h-[240px] text-sm text-muted-foreground">
                <div className="text-center">
                  <Icon name="Cpu" className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  No provider usage yet. Usage will appear here as AI features are used.
                </div>
              </div>
            ) : (
              <>
                <div style={{ width: "100%", height: 240 }}>
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={providerData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
                        {providerData.map((d) => <Cell key={d.name} fill={d.color} />)}
                      </Pie>
                      <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-1 mt-2">
                  {providerData.map((p) => (
                    <div key={p.name} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: p.color }} /> {p.name}</span>
                      <span className="font-semibold">{p.value} requests</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent activity — live data from audit logs */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg">Recent activity</CardTitle>
            <Button size="sm" variant="outline" onClick={() => setView("logs")}>View all</Button>
          </div>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No activity yet.</p>
          ) : (
            <div className="space-y-2">
              {logs.slice(0, 6).map((l) => (
                <div key={l.id} className="flex items-start gap-3 text-xs">
                  <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${l.severity === "info" ? "bg-brand" : l.severity === "warning" ? "bg-amber-500" : "bg-red-500"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{l.action}</div>
                    <div className="text-muted-foreground truncate">{l.details}</div>
                  </div>
                  <span className="text-muted-foreground shrink-0">{new Date(l.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
