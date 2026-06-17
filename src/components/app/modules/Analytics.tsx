"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, Icon, ScoreRing } from "@/components/shared";
import { useApp } from "@/lib/store";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, LineChart, Line,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, RadialBarChart, RadialBar,
} from "recharts";

const SCORE_TREND = [
  { name: "Week 1", avg: 68 },
  { name: "Week 2", avg: 71 },
  { name: "Week 3", avg: 74 },
  { name: "Week 4", avg: 78 },
  { name: "Week 5", avg: 80 },
  { name: "Week 6", avg: 82 },
];

const TEMPLATE_USAGE = [
  { name: "ATS Pro", value: 42, color: "#1154A3" },
  { name: "Modern", value: 24, color: "#F59E0B" },
  { name: "Executive", value: 14, color: "#10B981" },
  { name: "Corporate", value: 9, color: "#8B5CF6" },
  { name: "Other", value: 11, color: "#94A3B8" },
];

const FUNNEL = [
  { stage: "Visitors", value: 100 },
  { stage: "Sign-ups", value: 38 },
  { stage: "First resume", value: 28 },
  { stage: "ATS check", value: 22 },
  { stage: "Download", value: 17 },
  { stage: "Return (7d)", value: 11 },
];

export function Analytics() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="BarChart3" className="w-6 h-6 text-brand" /> Analytics</h1>
        <p className="text-sm text-muted-foreground mt-1">Deep platform metrics. Powered by Cloudflare Analytics Engine.</p>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Avg ATS score", value: "82", trend: "+4 pts", icon: "Gauge", color: "#1154A3" },
          { label: "Conversion rate", value: "17%", trend: "+2.1%", icon: "Target", color: "#F59E0B" },
          { label: "Avg session", value: "8m 42s", trend: "+18s", icon: "Timer", color: "#10B981" },
          { label: "Retention (7d)", value: "64%", trend: "+3.2%", icon: "Repeat", color: "#8B5CF6" },
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
        {/* Score trend */}
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-lg">ATS score trend</CardTitle><CardDescription>Platform-wide average over 6 weeks.</CardDescription></CardHeader>
          <CardContent>
            <div style={{ width: "100%", height: 240 }}>
              <ResponsiveContainer>
                <LineChart data={SCORE_TREND} margin={{ top: 5, right: 10, bottom: 0, left: -20 }}>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#94A3B8" />
                  <YAxis domain={[60, 90]} tick={{ fontSize: 11 }} stroke="#94A3B8" />
                  <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                  <Line type="monotone" dataKey="avg" stroke="#1154A3" strokeWidth={3} dot={{ r: 4, fill: "#1154A3" }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Template usage */}
        <Card>
          <CardHeader><CardTitle className="text-lg">Template usage</CardTitle></CardHeader>
          <CardContent>
            <div style={{ width: "100%", height: 200 }}>
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={TEMPLATE_USAGE} dataKey="value" nameKey="name" innerRadius={45} outerRadius={75} paddingAngle={2}>
                    {TEMPLATE_USAGE.map((d) => <Cell key={d.name} fill={d.color} />)}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="space-y-1 mt-2">
              {TEMPLATE_USAGE.map((t) => (
                <div key={t.name} className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ background: t.color }} /> {t.name}</span>
                  <span className="font-semibold">{t.value}%</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Funnel */}
      <Card>
        <CardHeader><CardTitle className="text-lg">Conversion funnel</CardTitle><CardDescription>From landing to returning user.</CardDescription></CardHeader>
        <CardContent>
          <div style={{ width: "100%", height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={FUNNEL} margin={{ top: 5, right: 10, bottom: 0, left: -20 }}>
                <XAxis dataKey="stage" tick={{ fontSize: 11 }} stroke="#94A3B8" />
                <YAxis tick={{ fontSize: 11 }} stroke="#94A3B8" unit="%" />
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
