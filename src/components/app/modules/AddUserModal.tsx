"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon } from "@/components/shared";
import { useApp } from "@/lib/store";
import { toast } from "sonner";
import { validatePassword, passwordStrength } from "@/lib/auth-utils";
import type { Role } from "@/lib/types";

/**
 * Super-admin modal: create a user account manually from User Management.
 * The admin supplies identity + an initial password and picks role/status
 * up front — the new account is usable immediately (no approval round-trip
 * unless the admin explicitly sets the status to Pending or Suspended).
 */

/** Cryptographically-random password that always satisfies the policy:
 *  16 chars with guaranteed upper, lower, digit and special characters. */
function generateStrongPassword(): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const special = "!@#$%^&*";
  const all = upper + lower + digits + special;
  const pick = (set: string) => set[crypto.getRandomValues(new Uint32Array(1))[0] % set.length];
  // One guaranteed char from each class, then fill the rest from the mix.
  const chars = [pick(upper), pick(lower), pick(digits), pick(special)];
  while (chars.length < 16) chars.push(pick(all));
  // Fisher–Yates shuffle so the guaranteed chars aren't always at the front.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.getRandomValues(new Uint32Array(1))[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

const STRENGTH_LABEL = ["Too weak", "Weak", "Fair", "Strong", "Excellent"];
const STRENGTH_COLOR = ["#DC2626", "#F59E0B", "#F59E0B", "#10B981", "#10B981"];

export function AddUserModal({ onClose }: { onClose: () => void }) {
  const adminCreateUser = useApp((s) => s.adminCreateUser);
  const currentUser = useApp((s) => s.user);

  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole] = useState<Role>("user");
  const [status, setStatus] = useState<"approved" | "pending" | "suspended">("approved");
  const [submitting, setSubmitting] = useState(false);

  const pwCheck = password ? validatePassword(password) : null;
  const emailTouched = email.trim().length > 0;
  const emailValid = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
  const canSubmit = emailTouched && emailValid && name.trim().length > 0 && !!pwCheck?.valid && !submitting;

  const submit = async () => {
    setSubmitting(true);
    // Give the button its pressed state one frame — the action itself is sync.
    await new Promise((r) => setTimeout(r, 200));
    const result = adminCreateUser({ name, email, username, password, role, status });
    setSubmitting(false);
    if (!result.ok) {
      toast.error(result.error || "Could not create the user.");
      return;
    }
    toast.success(`User ${result.user?.name} created (${role.replace("_", " ")}, ${status}). They can sign in now.`);
    onClose();
  };

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
            <Icon name="UserPlus" className="w-5 h-5 text-brand" /> Add user manually
          </h3>
          <Button variant="ghost" size="icon" onClick={onClose}><Icon name="X" className="w-4 h-4" /></Button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-muted-foreground">
            Create an account without waiting for self-registration. Share the initial password with
            the user securely — they can change it after signing in.
          </p>

          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Full name *</Label>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sarah Johnson" autoFocus />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Username</Label>
              <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Auto from email if empty" />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">Email *</Label>
            <Input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="user@company.com"
              className={!emailTouched || emailValid ? "" : "border-destructive"}
            />
            {emailTouched && !emailValid && (
              <p className="text-[11px] text-destructive">Enter a valid email address.</p>
            )}
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Initial password *</Label>
              <div className="flex gap-1">
                <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs gap-1" onClick={() => setPassword(generateStrongPassword())}>
                  <Icon name="Wand2" className="w-3 h-3" /> Generate
                </Button>
                <Button type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setShowPassword((v) => !v)}>
                  <Icon name={showPassword ? "EyeOff" : "Eye"} className="w-3 h-3" />
                </Button>
              </div>
            </div>
            <Input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Min 12 chars, Aa1!"
              className="pr-10"
            />
            {pwCheck && !pwCheck.valid && (
              <p className="text-[11px] text-amber-600">Missing: {pwCheck.errors.join(", ").toLowerCase()}</p>
            )}
            {pwCheck && pwCheck.valid && (
              <p className="text-[11px]" style={{ color: STRENGTH_COLOR[passwordStrength(password)] }}>
                {STRENGTH_LABEL[passwordStrength(password)]} password
              </p>
            )}
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Role</Label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
              >
                <option value="user">User</option>
                <option value="admin">Admin</option>
                <option value="super_admin">Super Admin</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Initial status</Label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as typeof status)}
                className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm"
              >
                <option value="approved">Approved — can sign in now</option>
                <option value="pending">Pending — awaits approval</option>
                <option value="suspended">Suspended — blocked until reactivated</option>
              </select>
            </div>
          </div>

          {(role === "super_admin" || role === "admin") && currentUser && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 flex items-start gap-2">
              <Icon name="ShieldAlert" className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700 dark:text-amber-400">
                You are granting <strong>{role === "super_admin" ? "Super Admin" : "Admin"}</strong> privileges.
                Admins can manage users and view analytics; Super Admins can also change AI providers,
                branding, and other platform settings.
              </p>
            </div>
          )}
        </div>

        <div className="sticky bottom-0 bg-card border-t border-border p-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={!canSubmit} className="bg-brand hover:bg-brand-dark text-white gap-2">
            {submitting ? <Icon name="Loader2" className="w-4 h-4 animate-spin" /> : <Icon name="UserPlus" className="w-4 h-4" />}
            Create user
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}
