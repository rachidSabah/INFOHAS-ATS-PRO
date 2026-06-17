"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge, Icon } from "@/components/shared";
import { useApp } from "@/lib/store";
import { toast } from "sonner";

const MOCK_USERS = [
  { id: "u1", name: "Alex Morgan", email: "alex.morgan@example.com", role: "super_admin", status: "active", resumes: 14, lastActive: "2 min ago", provider: "email" },
  { id: "u2", name: "Priya Sharma", email: "priya@figma.com", role: "user", status: "active", resumes: 8, lastActive: "1 hour ago", provider: "google" },
  { id: "u3", name: "Marcus Lee", email: "marcus@datadog.com", role: "user", status: "active", resumes: 12, lastActive: "3 hours ago", provider: "github" },
  { id: "u4", name: "Dana Williams", email: "dana@secondchance.org", role: "admin", status: "active", resumes: 3, lastActive: "5 hours ago", provider: "email" },
  { id: "u5", name: "Yuki Tanaka", email: "yuki@airbnb.com", role: "user", status: "active", resumes: 6, lastActive: "1 day ago", provider: "linkedin" },
  { id: "u6", name: "Hassan Ahmed", email: "hassan@vertex.io", role: "user", status: "suspended", resumes: 2, lastActive: "3 days ago", provider: "google" },
  { id: "u7", name: "Elena Rodriguez", email: "elena@stripe.com", role: "user", status: "active", resumes: 9, lastActive: "5 days ago", provider: "puter" },
];

export function Users() {
  const [q, setQ] = useState("");
  const users = MOCK_USERS.filter(u => u.name.toLowerCase().includes(q.toLowerCase()) || u.email.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="Users" className="w-6 h-6 text-brand" /> Users</h1>
        <p className="text-sm text-muted-foreground mt-1">Manage user accounts, roles, and status.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total users", value: "128,420", icon: "Users", color: "#1154A3" },
          { label: "Active (24h)", value: "8,240", icon: "Activity", color: "#10B981" },
          { label: "New (7d)", value: "1,820", icon: "UserPlus", color: "#F59E0B" },
          { label: "Suspended", value: "42", icon: "UserX", color: "#DC2626" },
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

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-lg">All users</CardTitle>
            <div className="relative w-full sm:w-64">
              <Icon name="Search" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search users…" className="pl-9 h-9" />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-secondary/50">
                <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-2 font-semibold">User</th>
                  <th className="px-4 py-2 font-semibold">Role</th>
                  <th className="px-4 py-2 font-semibold">Provider</th>
                  <th className="px-4 py-2 font-semibold">Resumes</th>
                  <th className="px-4 py-2 font-semibold">Last active</th>
                  <th className="px-4 py-2 font-semibold">Status</th>
                  <th className="px-4 py-2 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-b border-border hover:bg-secondary/30">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full bg-brand text-white flex items-center justify-center text-xs font-semibold">{u.name.split(" ").map(s => s[0]).join("")}</div>
                        <div>
                          <div className="font-medium">{u.name}</div>
                          <div className="text-xs text-muted-foreground">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={u.role === "super_admin" ? "gold" : u.role === "admin" ? "brand" : "outline"} className="capitalize">
                        {u.role.replace("_", " ")}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs capitalize text-muted-foreground">{u.provider}</td>
                    <td className="px-4 py-3 text-xs">{u.resumes}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{u.lastActive}</td>
                    <td className="px-4 py-3">
                      <Badge variant={u.status === "active" ? "success" : "danger"} className="capitalize">{u.status}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <Button size="sm" variant="ghost" onClick={() => toast.info("User detail view coming soon.")} aria-label="View"><Icon name="Eye" className="w-3.5 h-3.5" /></Button>
                        <Button size="sm" variant="ghost" onClick={() => toast.success(`Role toggled for ${u.name}`)} aria-label="Edit role"><Icon name="Pencil" className="w-3.5 h-3.5" /></Button>
                        <Button size="sm" variant="ghost" className="text-destructive" onClick={() => toast.success(`${u.status === "active" ? "Suspended" : "Reactivated"} ${u.name}`)} aria-label="Suspend"><Icon name={u.status === "active" ? "UserX" : "UserCheck"} className="w-3.5 h-3.5" /></Button>
                      </div>
                    </td>
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
