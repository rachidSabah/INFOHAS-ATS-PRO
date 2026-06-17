"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, Icon, ScoreRing } from "@/components/shared";
import { useApp } from "@/lib/store";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

const USAGE_DATA = [
  { name: "Mon", resumes: 1240, ats: 980, downloads: 720 },
  { name: "Tue", resumes: 1380, ats: 1050, downloads: 810 },
  { name: "Wed", resumes: 1620, ats: 1180, downloads: 940 },
  { name: "Thu", resumes: 1490, ats: 1090, downloads: 880 },
  { name: "Fri", resumes: 1820, ats: 1340, downloads: 1080 },
  { name: "Sat", resumes: 980, ats: 720, downloads: 560 },
  { name: "Sun", resumes: 870, ats: 650, downloads: 510 },
];

const PROVIDER_DATA = [
  { name: "Puter.js", value: 68, color: "#1154A3" },
  { name: "Z.ai Fallback", value: 22, color: "#F59E0B" },
  { name: "OpenAI", value: 6, color: "#10B981" },
  { name: "Claude", value: 4, color: "#8B5CF6" },
];

const GEO_DATA = [
  { name: "United States", users: 48200 },
  { name: "India", users: 24800 },
  { name: "United Kingdom", users: 12600 },
  { name: "Germany", users: 9400 },
  { name: "Canada", users: 8200 },
  { name: "Brazil", users: 6800 },
  { name: "Australia", users: 5400 },
  { name: "Other", users: 14200 },
];

export function Admin() {
  const setView = useApp((s) => s.setView);
  const resumes = useApp((s) => s.resumes);
  const atsReports = useApp((s) => s.atsReports);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="ShieldCheck" className="w-6 h-6 text-brand" /> Admin Overview</h1>
        <p className="text-sm text-muted-foreground mt-1">Platform health, usage, and quick actions.</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total users", value: "128,420", trend: "+8.2%", icon: "Users", color: "#1154A3" },
          { label: "Resumes built", value: "1.42M", trend: "+12.4%", icon: "FileText", color: "#F59E0B" },
          { label: "ATS checks", value: "892K", trend: "+18.1%", icon: "ScanText", color: "#10B981" },
          { label: "Avg ATS score", value: "82", trend: "+4 pts", icon: "TrendingUp", color: "#8B5CF6" },
        ].map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="p-5">
              <div className="flex items-center justify-between mb-2">
                <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: `${kpi.color}15`, color: kpi.color }}>
                  <Icon name={kpi.icon} className="w-5 h-5" />
                </div>
                <Badge variant="success" className="text-[10px]"><Icon name="TrendingUp" className="w-2.5 h-2.5" /> {kpi.trend}</Badge>
              </div>
              <div className="text-2xl font-bold font-display">{kpi.value}</div>
              <div className="text-xs text-muted-foreground">{kpi.label}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Usage chart */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-lg">Weekly usage</CardTitle>
            <CardDescription>Resumes built, ATS checks, downloads.</CardDescription>
          </CardHeader>
          <CardContent>
            <div style={{ width: "100%", height: 240 }}>
              <ResponsiveContainer>
                <AreaChart data={USAGE_DATA} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
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
                  <YAxis tick={{ fontSize: 11 }} stroke="#94A3B8" />
                  <Tooltip contentStyle={{ borderRadius: 8, border: "1px solid #E2E8F0", fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Area type="monotone" dataKey="resumes" stroke="#1154A3" fill="url(#g1)" strokeWidth={2} />
                  <Area type="monotone" dataKey="ats" stroke="#F59E0B" fill="url(#g2)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Provider usage */}
        <Card>
          <CardHeader><CardTitle className="text-lg">AI provider usage</CardTitle></CardHeader>
          <CardContent>
            <div style={{ width: "100%", height: 240 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={PROVIDER_DATA} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
                    {PROVIDER_DATA.map((d) => <Cell key={d.name} fill={d.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-1 mt-2">
              {PROVIDER_DATA.map((p) => (
                <div key={p.name} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: p.color }} /> {p.name}</span>
                  <span className="font-semibold">{p.value}%</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Geo + Recent activity */}
      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-lg">Top countries</CardTitle></CardHeader>
          <CardContent>
            <div style={{ width: "100%", height: 200 }}>
              <ResponsiveContainer>
                <BarChart data={GEO_DATA} layout="vertical" margin={{ top: 0, right: 5, bottom: 0, left: 30 }}>
                  <XAxis type="number" tick={{ fontSize: 11 }} stroke="#94A3B8" />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} stroke="#94A3B8" width={100} />
                  <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="users" fill="#1154A3" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Recent activity</CardTitle>
              <Button size="sm" variant="outline" onClick={() => setView("logs")}>View all</Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {useApp((s) => s.logs).slice(0, 6).map((l) => (
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
