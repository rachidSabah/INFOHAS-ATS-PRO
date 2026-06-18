"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge, Icon } from "@/components/shared";
import { useApp } from "@/lib/store";
import { toast } from "sonner";
import { UserDetailModal, type ManagedUser } from "./UserDetailModal";
import { validatePassword } from "@/lib/auth-utils";

const AVATAR_COLORS = ["#1154A3", "#F59E0B", "#10B981", "#8B5CF6", "#EC4899", "#0EA5E9", "#DC2626", "#0B1F3A"];

export function Users() {
  const users = useApp((s) => s.users);
  const currentUser = useApp((s) => s.user);
  const approveUser = useApp((s) => s.approveUser);
  const suspendUser = useApp((s) => s.suspendUser);
  const unsuspendUser = useApp((s) => s.unsuspendUser);
  const deleteUser = useApp((s) => s.deleteUser);
  const promoteToAdmin = useApp((s) => s.promoteToAdmin);
  const demoteToUser = useApp((s) => s.demoteToUser);
  const resetUserPassword = useApp((s) => s.resetUserPassword);
  const log = useApp((s) => s.log);

  const [q, setQ] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [selected, setSelected] = useState<ManagedUser | null>(null);
  const [resetTarget, setResetTarget] = useState<ManagedUser | null>(null);
  const [newPassword, setNewPassword] = useState("");

  const filtered = users.filter((u) => {
    if (roleFilter !== "all" && u.role !== roleFilter) return false;
    if (statusFilter !== "all" && u.status !== statusFilter) return false;
    if (q && !`${u.name} ${u.email} ${u.username ?? ""}`.toLowerCase().includes(q.toLowerCase())) return false;
    return true;
  });

  const stats = {
    total: users.length,
    approved: users.filter((u) => u.status === "approved").length,
    pending: users.filter((u) => u.status === "pending").length,
    suspended: users.filter((u) => u.status === "suspended").length,
    deleted: users.filter((u) => u.status === "deleted").length,
  };

  const toManaged = (u: any): ManagedUser => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    status: u.status === "suspended" ? "suspended" : "active",
    resumes: u.usage?.resumesGenerated ?? 0,
    lastActive: u.lastActiveAt ? new Date(u.lastActiveAt).toLocaleDateString() : "Never",
    provider: u.provider || "email",
    createdAt: u.createdAt,
    avatarColor: AVATAR_COLORS[users.indexOf(u) % AVATAR_COLORS.length],
  });

  const handleAction = (action: string, user: any) => {
    const isSelf = user.email === currentUser?.email;
    if (isSelf && action !== "view") {
      toast.error("You cannot perform this action on your own account.");
      return;
    }
    switch (action) {
      case "approve": approveUser(user.id); toast.success(`${user.name} approved.`); break;
      case "suspend": suspendUser(user.id); toast.success(`${user.name} suspended.`); break;
      case "unsuspend": unsuspendUser(user.id); toast.success(`${user.name} reactivated.`); break;
      case "delete": if (confirm(`Delete ${user.name}? (soft delete — data preserved)`)) { deleteUser(user.id); toast.success(`${user.name} deleted.`); } break;
      case "promote": promoteToAdmin(user.id); toast.success(`${user.name} promoted to admin.`); break;
      case "demote": demoteToUser(user.id); toast.success(`${user.name} demoted to user.`); break;
      case "reset": setResetTarget(toManaged(user)); setNewPassword(""); break;
    }
  };

  const handleResetPassword = () => {
    if (!resetTarget) return;
    const check = validatePassword(newPassword);
    if (!check.valid) {
      toast.error(`Password requirements: ${check.errors.join(", ")}`);
      return;
    }
    // Find the user by email
    const targetUser = users.find((u) => u.id === resetTarget.id);
    if (targetUser) {
      resetUserPassword(targetUser.id, newPassword);
      toast.success(`Password reset for ${resetTarget.name}.`);
    }
    setResetTarget(null);
    setNewPassword("");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="Users" className="w-6 h-6 text-brand" /> User Management</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage users, roles, and status. Approve, suspend, promote, or delete accounts.</p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        {[
          { label: "Total", value: stats.total, icon: "Users", color: "#1154A3" },
          { label: "Approved", value: stats.approved, icon: "CheckCircle2", color: "#10B981" },
          { label: "Pending", value: stats.pending, icon: "Clock", color: "#F59E0B" },
          { label: "Suspended", value: stats.suspended, icon: "Ban", color: "#DC2626" },
          { label: "Deleted", value: stats.deleted, icon: "Trash2", color: "#6B7280" },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: `${s.color}15`, color: s.color }}>
                <Icon name={s.icon} className="w-4 h-4" />
              </div>
              <div><div className="text-lg font-bold font-display">{s.value}</div><div className="text-xs text-muted-foreground">{s.label}</div></div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="text-lg">All Users ({filtered.length})</CardTitle>
            <div className="flex flex-wrap gap-2">
              <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} className="h-9 px-3 rounded-md border border-input bg-background text-sm">
                <option value="all">All roles</option>
                <option value="user">User</option>
                <option value="admin">Admin</option>
                <option value="super_admin">Super Admin</option>
              </select>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-9 px-3 rounded-md border border-input bg-background text-sm">
                <option value="all">All statuses</option>
                <option value="approved">Approved</option>
                <option value="pending">Pending</option>
                <option value="suspended">Suspended</option>
                <option value="deleted">Deleted</option>
              </select>
              <div className="relative w-full sm:w-64">
                <Icon name="Search" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="pl-9 h-9" />
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
                  <th className="px-4 py-2 font-semibold">Status</th>
                  <th className="px-4 py-2 font-semibold">Registered</th>
                  <th className="px-4 py-2 font-semibold">Last Login</th>
                  <th className="px-4 py-2 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u, idx) => {
                  const isSelf = u.email === currentUser?.email;
                  const canManage = currentUser?.role === "super_admin" && !isSelf;
                  return (
                    <tr key={u.id} className="border-b border-border hover:bg-secondary/30">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0" style={{ background: AVATAR_COLORS[idx % AVATAR_COLORS.length] }}>
                            {u.name.split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("")}
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium flex items-center gap-1.5">{u.name}{isSelf && <Badge variant="brand" className="text-[9px]">YOU</Badge>}</div>
                            <div className="text-xs text-muted-foreground truncate">{u.email}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3"><Badge variant={u.role === "super_admin" ? "gold" : u.role === "admin" ? "brand" : "outline"} className="capitalize text-[10px]">{u.role.replace("_", " ")}</Badge></td>
                      <td className="px-4 py-3 text-xs capitalize text-muted-foreground">{u.provider}</td>
                      <td className="px-4 py-3"><Badge variant={u.status === "approved" ? "success" : u.status === "pending" ? "warning" : u.status === "suspended" ? "danger" : "outline"} className="capitalize text-[10px]">{u.status}</Badge></td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{new Date(u.createdAt).toLocaleDateString()}</td>
                      <td className="px-4 py-3 text-xs text-muted-foreground">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : "Never"}</td>
                      <td className="px-4 py-3">
                        <div className="flex gap-0.5 justify-end flex-wrap">
                          {u.status === "pending" && <IconBtn icon="Check" label="Approve" color="#10B981" onClick={() => handleAction("approve", u)} disabled={!canManage} />}
                          {u.status === "approved" && <IconBtn icon="Ban" label="Suspend" color="#DC2626" onClick={() => handleAction("suspend", u)} disabled={!canManage} />}
                          {u.status === "suspended" && <IconBtn icon="UserCheck" label="Unsuspend" color="#10B981" onClick={() => handleAction("unsuspend", u)} disabled={!canManage} />}
                          {u.role === "user" && <IconBtn icon="ArrowUp" label="Promote to admin" color="#1154A3" onClick={() => handleAction("promote", u)} disabled={!canManage} />}
                          {u.role === "admin" && <IconBtn icon="ArrowDown" label="Demote to user" color="#64748B" onClick={() => handleAction("demote", u)} disabled={!canManage} />}
                          <IconBtn icon="KeyRound" label="Reset password" color="#F59E0B" onClick={() => handleAction("reset", u)} disabled={!canManage} />
                          <IconBtn icon="Eye" label="View details" onClick={() => setSelected(toManaged(u))} />
                          {u.status !== "deleted" && <IconBtn icon="Trash2" label="Delete" color="#DC2626" onClick={() => handleAction("delete", u)} disabled={!canManage} />}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {selected && <UserDetailModal user={selected} onClose={() => setSelected(null)} />}
      {resetTarget && (
        <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setResetTarget(null)}>
          <div className="bg-card rounded-2xl border border-border shadow-premium w-full max-w-md p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-display font-bold text-lg flex items-center gap-2"><Icon name="KeyRound" className="w-5 h-5 text-brand" /> Reset Password</h3>
            <p className="text-sm text-muted-foreground">Set a new password for <strong>{resetTarget.name}</strong> ({resetTarget.email})</p>
            <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Min 12 chars, Aa1!" />
            {newPassword && <p className="text-xs text-muted-foreground">Password must have 12+ chars, uppercase, lowercase, number, special char</p>}
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setResetTarget(null)}>Cancel</Button>
              <Button onClick={handleResetPassword} className="bg-brand hover:bg-brand-dark text-white">Reset password</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function IconBtn({ icon, label, onClick, color, disabled }: { icon: string; label: string; onClick: () => void; color?: string; disabled?: boolean }) {
  return (
    <button onClick={onClick} title={label} aria-label={label} disabled={disabled} className="w-7 h-7 rounded-md hover:bg-secondary flex items-center justify-center text-muted-foreground hover:text-foreground transition disabled:opacity-30 disabled:cursor-not-allowed" style={color ? { color } : undefined}>
      <Icon name={icon} className="w-3.5 h-3.5" />
    </button>
  );
}
