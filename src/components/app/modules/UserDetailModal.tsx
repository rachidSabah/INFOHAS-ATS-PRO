"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge, Icon } from "@/components/shared";
import { useApp } from "@/lib/store";
import { toast } from "sonner";
import type { Role } from "@/lib/types";

export interface ManagedUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: "active" | "suspended";
  resumes: number;
  lastActive: string;
  provider: string;
  createdAt: string;
  avatarColor: string;
}

export function UserDetailModal({ user, onClose }: { user: ManagedUser; onClose: () => void }) {
  const currentUser = useApp((s) => s.user);
  const log = useApp((s) => s.log);

  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  const [role, setRole] = useState<Role>(user.role);
  const [status, setStatus] = useState<"active" | "suspended">(user.status);
  const [saving, setSaving] = useState(false);

  const isSelf = currentUser?.email === user.email;
  const canEditRole = currentUser?.role === "super_admin" && !isSelf;
  const canSuspend = currentUser?.role === "super_admin" && !isSelf;

  const save = async () => {
    setSaving(true);
    await new Promise((r) => setTimeout(r, 400));
    setSaving(false);
    log({
      actor: currentUser?.email ?? "admin",
      action: "User updated",
      category: "admin",
      details: `${user.email}: name="${name}", role=${role}, status=${status}`,
      severity: "info",
    });
    toast.success(`Changes saved for ${user.name}.`);
    onClose();
  };

  const resetPassword = () => {
    if (!confirm(`Send a password-reset email to ${user.email}?`)) return;
    log({
      actor: currentUser?.email ?? "admin",
      action: "Password reset triggered",
      category: "auth",
      details: `Reset email sent to ${user.email}`,
      severity: "warning",
    });
    toast.success(`Password-reset email sent to ${user.email}.`);
  };

  const initials = user.name.split(/\s+/).slice(0, 2).map((s) => s[0]?.toUpperCase()).join("");

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-0 sm:p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ y: 20, opacity: 0, scale: 0.97 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        exit={{ y: 20, opacity: 0, scale: 0.97 }}
        transition={{ type: "spring", damping: 26, stiffness: 280 }}
        className="bg-card rounded-t-2xl sm:rounded-2xl border border-border shadow-premium w-full sm:max-w-xl max-h-[95vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-card border-b border-border p-4 flex items-center justify-between">
          <h3 className="font-display font-bold text-lg flex items-center gap-2">
            <Icon name="User" className="w-5 h-5 text-brand" /> User details
          </h3>
          <Button variant="ghost" size="icon" onClick={onClose}><Icon name="X" className="w-4 h-4" /></Button>
        </div>

        <div className="p-5 space-y-5">
          {/* Avatar + identity */}
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full flex items-center justify-center text-white font-bold text-xl shrink-0" style={{ background: user.avatarColor }}>
              {initials || "?"}
            </div>
            <div className="min-w-0">
              <div className="font-semibold text-lg flex items-center gap-2">
                {user.name}
                {isSelf && <Badge variant="brand" className="text-[10px]">YOU</Badge>}
              </div>
              <div className="text-sm text-muted-foreground truncate">{user.email}</div>
              <div className="flex flex-wrap gap-1.5 mt-1">
                <Badge variant={user.role === "super_admin" ? "gold" : user.role === "admin" ? "brand" : "outline"} className="capitalize text-[10px]">{user.role.replace("_", " ")}</Badge>
                <Badge variant={user.status === "active" ? "success" : "danger"} className="capitalize text-[10px]">{user.status}</Badge>
                <Badge variant="outline" className="capitalize text-[10px]">{user.provider}</Badge>
              </div>
            </div>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-lg bg-secondary p-3 text-center">
              <div className="text-xl font-bold font-display">{user.resumes}</div>
              <div className="text-xs text-muted-foreground">Resumes</div>
            </div>
            <div className="rounded-lg bg-secondary p-3 text-center">
              <div className="text-xl font-bold font-display">{user.lastActive}</div>
              <div className="text-xs text-muted-foreground">Last active</div>
            </div>
            <div className="rounded-lg bg-secondary p-3 text-center">
              <div className="text-xl font-bold font-display">{new Date(user.createdAt).getFullYear()}</div>
              <div className="text-xs text-muted-foreground">Joined</div>
            </div>
          </div>

          {/* Editable fields */}
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Display name</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} disabled={isSelf ? false : !canEditRole} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Email</Label>
              <Input value={email} onChange={(e) => setEmail(e.target.value)} disabled />
              <p className="text-[11px] text-muted-foreground flex items-center gap-1"><Icon name="Lock" className="w-3 h-3" /> Email changes require user verification.</p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Role</Label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                disabled={!canEditRole}
                className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm disabled:opacity-50"
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
                <option value="super_admin">Super Admin</option>
              </select>
              {!canEditRole && <p className="text-[11px] text-muted-foreground">{isSelf ? "You can't change your own role." : "Only Super Admins can change roles."}</p>}
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Account status</Label>
              <div className="flex items-center justify-between gap-3 p-2 rounded-md border border-input h-9">
                <span className="text-sm">{status === "active" ? "Active" : "Suspended"}</span>
                <Switch checked={status === "active"} onCheckedChange={(v) => setStatus(v ? "active" : "suspended")} disabled={!canSuspend} />
              </div>
              {!canSuspend && <p className="text-[11px] text-muted-foreground">{isSelf ? "You can't suspend your own account." : "Only Super Admins can suspend users."}</p>}
            </div>
          </div>

          {/* Actions */}
          <div className="rounded-lg border border-border p-3 space-y-2">
            <div className="text-sm font-medium">Account actions</div>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={resetPassword} className="gap-1.5">
                <Icon name="Mail" className="w-3.5 h-3.5" /> Send password reset
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  log({ actor: currentUser?.email ?? "admin", action: "User data exported", category: "admin", details: user.email, severity: "info" });
                  toast.success(`Data export queued for ${user.email}.`);
                }}
                className="gap-1.5"
              >
                <Icon name="Download" className="w-3.5 h-3.5" /> Export user data
              </Button>
              {canSuspend && status === "active" ? (
                <Button size="sm" variant="outline" className="text-destructive gap-1.5" onClick={() => { setStatus("suspended"); toast.info("Mark as suspended, then Save to apply."); }}>
                  <Icon name="UserX" className="w-3.5 h-3.5" /> Suspend
                </Button>
              ) : canSuspend && status === "suspended" ? (
                <Button size="sm" variant="outline" className="text-emerald-600 gap-1.5" onClick={() => { setStatus("active"); toast.info("Mark as active, then Save to apply."); }}>
                  <Icon name="UserCheck" className="w-3.5 h-3.5" /> Reactivate
                </Button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="sticky bottom-0 bg-card border-t border-border p-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving} className="bg-brand hover:bg-brand-dark text-white gap-2">
            {saving ? <Icon name="Loader2" className="w-4 h-4 animate-spin" /> : <Icon name="Save" className="w-4 h-4" />}
            Save changes
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}
