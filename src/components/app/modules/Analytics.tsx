"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge, Icon } from "@/components/shared";
import { useApp } from "@/lib/store";
import {
  BarChart, Bar, PieChart, Pie, Cell, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";

export function Analytics() {
  const resumes = useApp((s) => s.resumes);
  const atsReports = useApp((s) => s.atsReports);
  const coverLetters = useApp((s) => s.coverLetters);
  const interviews = useApp((s) => s.interviews);
  const users = useApp((s) => s.users);
  const downloads = useApp((s) => s.logs).filter((l) => /export|download/i.test(l.action));

  // Live KPIs from actual store data
  const avgATS = atsReports.length > 0
    ? Math.round(atsReports.reduce((sum, r) => sum + (r.scores?.ats || 0), 0) / atsReports.length)
    : 0;

  const kpis = [
    { label: "Avg ATS score", value: avgATS.toString(), icon: "Gauge", color: "#1154A3" },
    { label: "Total resumes", value: resumes.length.toString(), icon: "FileText", color: "#F59E0B" },
    { label: "Cover letters", value: coverLetters.length.toString(), icon: "Mail", color: "#10B981" },
    { label: "Downloads", value: downloads.length.toString(), icon: "Download", color: "#8B5CF6" },
  ];

  // Live ATS score trend from actual reports
  const scoreTrend = atsReports.slice(0, 10).reverse().map((r, i) => ({
    name: `#${i + 1}`,
    avg: r.scores?.ats || 0,
  }));

  // Live template usage from actual resumes
  const templateCounts: Record<string, number> = {};
  for (const r of resumes) {
    const tpl = r.template || "default";
    templateCounts[tpl] = (templateCounts[tpl] || 0) + 1;
  }
  const templateUsage = Object.entries(templateCounts).map(([name, value], i) => ({
    name,
    value,
    color: ["#1154A3", "#F59E0B", "#10B981", "#8B5CF6", "#EC4899", "#94A3B8"][i % 6],
  }));

  // Live funnel from actual data
  const totalUsersCount = users.length;
  const usersWithResumes = users.filter((u) => resumes.some((r) => r.id?.includes(u.id))).length; // simplified
  const funnel = [
    { stage: "Users", value: totalUsersCount },
    { stage: "Resumes", value: resumes.length },
    { stage: "ATS checks", value: atsReports.length },
    { stage: "Cover letters", value: coverLetters.length },
    { stage: "Downloads", value: downloads.length },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="BarChart3" className="w-6 h-6 text-brand" /> Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">Live platform metrics from actual user data.</p>
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
        {/* Score trend — live data */}
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-lg">ATS score trend</CardTitle><CardDescription>Recent ATS check scores.</CardDescription></CardHeader>
          <CardContent>
            {scoreTrend.length === 0 ? (
              <div className="flex items-center justify-center h-[240px] text-sm text-muted-foreground">
                <div className="text-center">
                  <Icon name="LineChart" className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  No ATS checks yet. Scores will appear here as users run ATS checks.
                </div>
              </div>
            ) : (
              <div style={{ width: "100%", height: 240 }}>
                <ResponsiveContainer>
                  <LineChart data={scoreTrend} margin={{ top: 5, right: 10, bottom: 0, left: -20 }}>
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#94A3B8" />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} stroke="#94A3B8" />
                    <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                    <Line type="monotone" dataKey="avg" stroke="#1154A3" strokeWidth={3} dot={{ r: 4, fill: "#1154A3" }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Template usage — live data */}
        <Card>
          <CardHeader><CardTitle className="text-lg">Template usage</CardTitle></CardHeader>
          <CardContent>
            {templateUsage.length === 0 ? (
              <div className="flex items-center justify-center h-[200px] text-sm text-muted-foreground">
                <div className="text-center">
                  <Icon name="PieChart" className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  No resumes yet.
                </div>
              </div>
            ) : (
              <>
                <div style={{ width: "100%", height: 200 }}>
                  <ResponsiveContainer>
                    <PieChart>
                      <Pie data={templateUsage} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} paddingAngle={2}>
                        {templateUsage.map((d) => <Cell key={d.name} fill={d.color} />)}
                      </Pie>
                      <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="space-y-1 mt-2">
                  {templateUsage.map((t) => (
                    <div key={t.name} className="flex items-center justify-between text-xs">
                      <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: t.color }} /> {t.name}</span>
                      <span className="font-semibold">{t.value}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Funnel — live data */}
      <Card>
        <CardHeader><CardTitle className="text-lg">User activity funnel</CardTitle><CardDescription>From registered users to downloads.</CardDescription></CardHeader>
        <CardContent>
          <div style={{ width: "100%", height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={funnel} margin={{ top: 5, right: 10, bottom: 0, left: -20 }}>
                <XAxis dataKey="stage" tick={{ fontSize: 11 }} stroke="#94A3B8" />
                <YAxis tick={{ fontSize: 11 }} stroke="#94A3B8" allowDecimals={false} />
                <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                <Bar dataKey="value" fill="#1154A3" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
