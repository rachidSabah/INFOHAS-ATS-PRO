"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge, Icon } from "@/components/shared";
import { useApp } from "@/lib/store";
import { ProviderManager } from "@/lib/ai/services";
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";

const PROVIDER_COLORS = ["#1154A3", "#F59E0B", "#10B981", "#8B5CF6", "#EC4899", "#0EA5E9", "#DC2626", "#94A3B8"];

export function ProviderAnalytics() {
  const providers = useApp((s) => s.providers);
  const logs = useApp((s) => s.providerLogs);

  const agg = ProviderManager.aggregateUsage();

  // Build chart data
  const requestsPerProvider = providers
    .filter((p) => p.usage.requests > 0)
    .map((p) => ({ name: p.name.split(" ")[0], requests: p.usage.requests, tokens: p.usage.tokens, errors: p.usage.errors, cost: p.usage.cost, color: PROVIDER_COLORS[providers.indexOf(p) % PROVIDER_COLORS.length] }));

  // Success vs error pie
  const successErrors = [
    { name: "Success", value: agg.requests - agg.errors, color: "#10B981" },
    { name: "Errors", value: agg.errors, color: "#DC2626" },
  ].filter((d) => d.value > 0);

  // Latency per provider
  const latencyPerProvider = providers
    .filter((p) => p.usage.requests > 0)
    .map((p) => ({ name: p.name.split(" ")[0], latency: p.usage.avgLatencyMs }));

  // Token usage over last logs (last 7 days)
  const last7Days = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (6 - i));
    const dayLogs = logs.filter((l) => {
      const ld = new Date(l.createdAt);
      return ld.toDateString() === d.toDateString();
    });
    return {
      name: d.toLocaleDateString("en-US", { weekday: "short" }),
      requests: dayLogs.length,
      tokens: dayLogs.reduce((n, l) => n + (l.inputTokens ?? 0) + (l.outputTokens ?? 0), 0),
    };
  });

  return (
    <div className="space-y-6">
      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: "Total requests", value: agg.requests.toLocaleString(), icon: "Activity", color: "#1154A3" },
          { label: "Success rate", value: `${agg.successRate.toFixed(1)}%`, icon: "CheckCircle2", color: "#10B981" },
          { label: "Error rate", value: `${agg.errorRate.toFixed(1)}%`, icon: "AlertCircle", color: "#DC2626" },
          { label: "Avg latency", value: `${agg.avgLatencyMs}ms`, icon: "Timer", color: "#F59E0B" },
          { label: "Total tokens", value: agg.tokens.toLocaleString(), icon: "Coins", color: "#8B5CF6" },
          { label: "Est. cost", value: `$${agg.cost.toFixed(4)}`, icon: "DollarSign", color: "#EC4899" },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${s.color}15`, color: s.color }}>
                <Icon name={s.icon} className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <div className="text-lg font-bold font-display truncate">{s.value}</div>
                <div className="text-xs text-muted-foreground truncate">{s.label}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-6">
        {/* Requests per provider */}
        <Card>
          <CardHeader><CardTitle className="text-base">Requests per provider</CardTitle><CardDescription>Total requests by provider.</CardDescription></CardHeader>
          <CardContent>
            {requestsPerProvider.length > 0 ? (
              <div style={{ width: "100%", height: 240 }}>
                <ResponsiveContainer>
                  <BarChart data={requestsPerProvider} margin={{ top: 5, right: 5, bottom: 0, left: -20 }}>
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#94A3B8" />
                    <YAxis tick={{ fontSize: 11 }} stroke="#94A3B8" />
                    <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                    <Bar dataKey="requests" radius={[4, 4, 0, 0]}>
                      {requestsPerProvider.map((d, i) => <Cell key={i} fill={d.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : <EmptyChart />}
          </CardContent>
        </Card>

        {/* Success vs error */}
        <Card>
          <CardHeader><CardTitle className="text-base">Success vs errors</CardTitle><CardDescription>Across all providers.</CardDescription></CardHeader>
          <CardContent>
            {successErrors.length > 0 ? (
              <div style={{ width: "100%", height: 240 }}>
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={successErrors} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
                      {successErrors.map((d) => <Cell key={d.name} fill={d.color} />)}
                    </Pie>
                    <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : <EmptyChart />}
          </CardContent>
        </Card>

        {/* Latency per provider */}
        <Card>
          <CardHeader><CardTitle className="text-base">Average latency per provider</CardTitle><CardDescription>Milliseconds — lower is better.</CardDescription></CardHeader>
          <CardContent>
            {latencyPerProvider.length > 0 ? (
              <div style={{ width: "100%", height: 240 }}>
                <ResponsiveContainer>
                  <BarChart data={latencyPerProvider} layout="vertical" margin={{ top: 5, right: 5, bottom: 0, left: 30 }}>
                    <XAxis type="number" tick={{ fontSize: 11 }} stroke="#94A3B8" unit="ms" />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} stroke="#94A3B8" width={80} />
                    <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                    <Bar dataKey="latency" fill="#1154A3" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : <EmptyChart />}
          </CardContent>
        </Card>

        {/* Token usage 7 days */}
        <Card>
          <CardHeader><CardTitle className="text-base">Token usage (last 7 days)</CardTitle><CardDescription>From request logs.</CardDescription></CardHeader>
          <CardContent>
            <div style={{ width: "100%", height: 240 }}>
              <ResponsiveContainer>
                <AreaChart data={last7Days} margin={{ top: 5, right: 5, bottom: 0, left: -10 }}>
                  <defs>
                    <linearGradient id="tok" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#8B5CF6" stopOpacity={0.4} />
                      <stop offset="100%" stopColor="#8B5CF6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} stroke="#94A3B8" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#94A3B8" />
                  <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                  <Area type="monotone" dataKey="tokens" stroke="#8B5CF6" fill="url(#tok)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Per-provider breakdown table */}
      <Card>
        <CardHeader><CardTitle className="text-base">Per-provider breakdown</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-secondary/40">
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-semibold">Provider</th>
                  <th className="px-4 py-2 font-semibold text-right">Requests</th>
                  <th className="px-4 py-2 font-semibold text-right">Tokens</th>
                  <th className="px-4 py-2 font-semibold text-right">Errors</th>
                  <th className="px-4 py-2 font-semibold text-right">Avg latency</th>
                  <th className="px-4 py-2 font-semibold text-right">Cost</th>
                </tr>
              </thead>
              <tbody>
                {providers.map((p) => (
                  <tr key={p.id} className="border-b border-border hover:bg-secondary/30">
                    <td className="px-4 py-2 font-medium">{p.name}</td>
                    <td className="px-4 py-2 text-right font-mono">{p.usage.requests.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right font-mono">{p.usage.tokens.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right font-mono text-red-600">{p.usage.errors.toLocaleString()}</td>
                    <td className="px-4 py-2 text-right font-mono">{p.usage.avgLatencyMs}ms</td>
                    <td className="px-4 py-2 text-right font-mono">${p.usage.cost.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function EmptyChart() {
  return (
    <div className="h-[240px] flex items-center justify-center text-sm text-muted-foreground">
      <div className="text-center">
        <Icon name="BarChart3" className="w-10 h-10 mx-auto text-muted-foreground/40" />
        <p className="mt-2">No usage data yet</p>
      </div>
    </div>
  );
}
