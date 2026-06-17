"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge, Icon } from "@/components/shared";
import { useApp } from "@/lib/store";
import { toast } from "sonner";
import { UserDetailModal, type ManagedUser } from "./UserDetailModal";

const AVATAR_COLORS = ["#1154A3", "#F59E0B", "#10B981", "#8B5CF6", "#EC4899", "#0EA5E9", "#DC2626", "#0B1F3A"];

const INITIAL_USERS: ManagedUser[] = [
  { id: "u1", name: "Alex Morgan", email: "alex.morgan@example.com", role: "super_admin", status: "active", resumes: 14, lastActive: "2 min ago", provider: "email", createdAt: "2025-09-12", avatarColor: AVATAR_COLORS[0] },
  { id: "u2", name: "Priya Sharma", email: "priya@figma.com", role: "user", status: "active", resumes: 8, lastActive: "1 hour ago", provider: "google", createdAt: "2025-10-04", avatarColor: AVATAR_COLORS[1] },
  { id: "u3", name: "Marcus Lee", email: "marcus@datadog.com", role: "user", status: "active", resumes: 12, lastActive: "3 hours ago", provider: "github", createdAt: "2025-09-22", avatarColor: AVATAR_COLORS[2] },
  { id: "u4", name: "Dana Williams", email: "dana@secondchance.org", role: "admin", status: "active", resumes: 3, lastActive: "5 hours ago", provider: "email", createdAt: "2025-08-15", avatarColor: AVATAR_COLORS[3] },
  { id: "u5", name: "Yuki Tanaka", email: "yuki@airbnb.com", role: "user", status: "active", resumes: 6, lastActive: "1 day ago", provider: "linkedin", createdAt: "2025-10-30", avatarColor: AVATAR_COLORS[4] },
  { id: "u6", name: "Hassan Ahmed", email: "hassan@vertex.io", role: "user", status: "suspended", resumes: 2, lastActive: "3 days ago", provider: "google", createdAt: "2025-11-01", avatarColor: AVATAR_COLORS[5] },
  { id: "u7", name: "Elena Rodriguez", email: "elena@stripe.com", role: "user", status: "active", resumes: 9, lastActive: "5 days ago", provider: "puter", createdAt: "2025-07-19", avatarColor: AVATAR_COLORS[6] },
];

export function Users() {
  const currentUser = useApp((s) => s.user);
  const log = useApp((s) => s.log);
  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [users, setUsers] = useState<ManagedUser[]>(INITIAL_USERS);
  const [selected, setSelected] = useState<ManagedUser | null>(null);

  const filtered = users.filter((u) => {
    if (roleFilter !== "all" && u.role !== roleFilter) return false;
    if (statusFilter !== "all" && u.status !== statusFilter) return false;
    if (q && !(`${u.name} ${u.email}`.toLowerCase().includes(q.toLowerCase()))) return false;
    return true;
  });

  const totalResumes = users.reduce((n, u) => n + u.resumes, 0);
  const activeCount = users.filter((u) => u.status === "active").length;
  const suspendedCount = users.filter((u) => u.status === "suspended").length;

  const onSaveUser = (updated: ManagedUser) => {
    setUsers((list) => list.map((u) => (u.id === updated.id ? updated : u)));
    setSelected(null);
  };

  const toggleSuspend = (u: ManagedUser) => {
    if (u.email === currentUser?.email) {
      toast.error("You can't suspend your own account.");
      return;
    }
    if (currentUser?.role !== "super_admin") {
      toast.error("Only Super Admins can suspend users.");
      return;
    }
    const newStatus = u.status === "active" ? "suspended" : "active";
    setUsers((list) => list.map((x) => (x.id === u.id ? { ...x, status: newStatus } : x)));
    log({ actor: currentUser?.email ?? "admin", action: `User ${newStatus === "suspended" ? "suspended" : "reactivated"}`, category: "admin", details: u.email, severity: "warning" });
    toast.success(`${u.name} ${newStatus === "suspended" ? "suspended" : "reactivated"}.`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="Users" className="w-6 h-6 text-brand" /> Users</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage user accounts, roles, and status. Click any user to view or edit their details.</p>
        </div>
        <Button
          onClick={() => {
            const email = prompt("Enter the new user's email:");
            if (!email || !/.+@.+\..+/.test(email)) { if (email) toast.error("Invalid email."); return; }
            const name = (prompt("Display name:") || email.split("@")[0]).trim();
            const newUser: ManagedUser = {
              id: `u_${Date.now()}`,
              name,
              email,
              role: "user",
              status: "active",
              resumes: 0,
              lastActive: "just now",
              provider: "email",
              createdAt: new Date().toISOString().slice(0, 10),
              avatarColor: AVATAR_COLORS[users.length % AVATAR_COLORS.length],
            };
            setUsers((list) => [newUser, ...list]);
            log({ actor: currentUser?.email ?? "admin", action: "User invited", category: "admin", details: email, severity: "info" });
            toast.success(`Invitation sent to ${email}.`);
          }}
          className="bg-brand hover:bg-brand-dark text-white gap-2"
        >
          <Icon name="UserPlus" className="w-4 h-4" /> Invite user
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          { label: "Total users", value: users.length, icon: "Users", color: "#1154A3" },
          { label: "Active", value: activeCount, icon: "UserCheck", color: "#10B981" },
          { label: "Suspended", value: suspendedCount, icon: "UserX", color: "#DC2626" },
          { label: "Total resumes", value: totalResumes, icon: "FileText", color: "#F59E0B" },
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

      {/* Filters + table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-lg">All users ({filtered.length})</CardTitle>
            <div className="flex flex-wrap gap-2">
              <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="h-9 px-3 rounded-md border border-input bg-background text-sm">
                <option value="all">All roles</option>
                <option value="user">User</option>
                <option value="admin">Admin</option>
                <option value="super_admin">Super Admin</option>
              </select>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-9 px-3 rounded-md border border-input bg-background text-sm">
                <option value="all">All statuses</option>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
              </select>
              <div className="relative w-full sm:w-64">
                <Icon name="Search" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or email…" className="pl-9 h-9" />
              </div>
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
                  <th className="px-4 py-2 font-semibold text-right">Resumes</th>
                  <th className="px-4 py-2 font-semibold">Last active</th>
                  <th className="px-4 py-2 font-semibold">Status</th>
                  <th className="px-4 py-2 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <tr key={u.id} className="border-b border-border hover:bg-secondary/30 cursor-pointer" onClick={() => setSelected(u)}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0" style={{ background: u.avatarColor }}>
                          {u.name.split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("")}
                        </div>
                        <div className="min-w-0">
                          <div className="font-medium flex items-center gap-1.5">
                            {u.name}
                            {u.email === currentUser?.email && <Badge variant="brand" className="text-[9px]">YOU</Badge>}
                          </div>
                          <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={u.role === "super_admin" ? "gold" : u.role === "admin" ? "brand" : "outline"} className="capitalize">
                        {u.role.replace("_", " ")}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-xs capitalize text-muted-foreground">{u.provider}</td>
                    <td className="px-4 py-3 text-xs text-right font-mono">{u.resumes}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{u.lastActive}</td>
                    <td className="px-4 py-3">
                      <Badge variant={u.status === "active" ? "success" : "danger"} className="capitalize">{u.status}</Badge>
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => setSelected(u)} title="View / edit" className="w-7 h-7 rounded-md hover:bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground">
                          <Icon name="Eye" className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => toggleSuspend(u)} title={u.status === "active" ? "Suspend" : "Reactivate"} className={`w-7 h-7 rounded-md hover:bg-secondary flex items-center justify-center ${u.status === "active" ? "text-destructive" : "text-emerald-600"}`}>
                          <Icon name={u.status === "active" ? "UserX" : "UserCheck"} className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr><td colSpan={7} className="text-center py-12 text-muted-foreground">No users match your filters.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {selected && (
        <UserDetailModal
          user={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}
