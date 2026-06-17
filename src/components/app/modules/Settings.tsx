"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge, Icon } from "@/components/shared";
import { useApp } from "@/lib/store";
import { toast } from "sonner";

export function Settings() {
  const user = useApp((s) => s.user);
  const theme = useApp((s) => s.theme);
  const toggleTheme = useApp((s) => s.toggleTheme);
  const signOut = useApp((s) => s.signOut);
  const updateUserName = useApp((s) => s.updateUserName);
  const updateUserEmail = useApp((s) => s.updateUserEmail);
  const changePassword = useApp((s) => s.changePassword);
  const log = useApp((s) => s.log);

  // Profile form state
  const [name, setName] = useState(user?.name ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [savingProfile, setSavingProfile] = useState(false);

  // Password form state
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [savingPw, setSavingPw] = useState(false);

  // Password strength
  const strength = computeStrength(newPw);
  const strengthLabel = ["Too weak", "Weak", "Fair", "Good", "Strong"][strength];
  const strengthColor = ["#DC2626", "#DC2626", "#F59E0B", "#1154A3", "#10B981"][strength];

  const onSaveProfile = async () => {
    if (!name.trim() || name.trim().length < 2) {
      toast.error("Name must be at least 2 characters.");
      return;
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      toast.error("Please enter a valid email address.");
      return;
    }
    setSavingProfile(true);
    await new Promise((r) => setTimeout(r, 400));
    const nameChanged = name.trim() !== user?.name;
    const emailChanged = email.trim().toLowerCase() !== user?.email;
    if (nameChanged) updateUserName(name.trim());
    if (emailChanged) updateUserEmail(email.trim());
    setSavingProfile(false);
    if (nameChanged || emailChanged) {
      toast.success("Profile updated.");
    } else {
      toast.info("No changes to save.");
    }
  };

  const onChangePw = async () => {
    if (newPw !== confirmPw) {
      toast.error("New password and confirmation don't match.");
      return;
    }
    setSavingPw(true);
    await new Promise((r) => setTimeout(r, 500));
    const result = changePassword(currentPw, newPw);
    setSavingPw(false);
    if (result.ok) {
      toast.success("Password changed successfully.");
      setCurrentPw("");
      setNewPw("");
      setConfirmPw("");
    } else {
      toast.error(result.error || "Failed to change password.");
    }
  };

  const isOAuthUser = user && user.provider !== "email";

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="Settings" className="w-6 h-6 text-brand" /> Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Account, security, appearance, data, and privacy.</p>
      </div>

      {/* Profile (name + email) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Icon name="User" className="w-4 h-4 text-brand" /> Profile</CardTitle>
          <CardDescription>Your display name and email. Used across the app and on exported resumes.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Display name">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" maxLength={80} />
            </Field>
            <Field label="Email address">
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                disabled={isOAuthUser}
              />
              {isOAuthUser && (
                <p className="text-[11px] text-muted-foreground mt-1 flex items-center gap-1">
                  <Icon name="Lock" className="w-3 h-3" /> Email is managed by your {user?.provider} account.
                </p>
              )}
            </Field>
            <Field label="Role">
              <Input value={user?.role?.replace("_", " ") ?? ""} disabled className="capitalize" />
            </Field>
            <Field label="Auth provider">
              <Input value={user?.provider ?? ""} disabled className="capitalize" />
            </Field>
          </div>
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">Last active: {user?.lastActiveAt ? new Date(user.lastActiveAt).toLocaleString() : "—"}</p>
            <Button onClick={onSaveProfile} disabled={savingProfile} className="bg-brand hover:bg-brand-dark text-white gap-2">
              {savingProfile ? <Icon name="Loader2" className="w-4 h-4 animate-spin" /> : <Icon name="Save" className="w-4 h-4" />}
              Save profile
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Change password */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Icon name="KeyRound" className="w-4 h-4 text-brand" /> Security — Change password</CardTitle>
          <CardDescription>
            {isOAuthUser
              ? `You signed in via ${user?.provider}. Set a password to also be able to sign in with email.`
              : "Update your password. Use at least 8 characters with letters and numbers."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid sm:grid-cols-3 gap-3">
            <Field label="Current password">
              <div className="relative">
                <Input
                  type={showCurrent ? "text" : "password"}
                  value={currentPw}
                  onChange={(e) => setCurrentPw(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                  className="pr-9"
                />
                <button type="button" onClick={() => setShowCurrent((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Toggle visibility">
                  <Icon name={showCurrent ? "EyeOff" : "Eye"} className="w-4 h-4" />
                </button>
              </div>
            </Field>
            <Field label="New password">
              <div className="relative">
                <Input
                  type={showNew ? "text" : "password"}
                  value={newPw}
                  onChange={(e) => setNewPw(e.target.value)}
                  placeholder="Min 8 chars, letters + numbers"
                  autoComplete="new-password"
                  className="pr-9"
                />
                <button type="button" onClick={() => setShowNew((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Toggle visibility">
                  <Icon name={showNew ? "EyeOff" : "Eye"} className="w-4 h-4" />
                </button>
              </div>
            </Field>
            <Field label="Confirm new password">
              <div className="relative">
                <Input
                  type={showConfirm ? "text" : "password"}
                  value={confirmPw}
                  onChange={(e) => setConfirmPw(e.target.value)}
                  placeholder="Repeat new password"
                  autoComplete="new-password"
                  className="pr-9"
                  onKeyDown={(e) => e.key === "Enter" && onChangePw()}
                />
                <button type="button" onClick={() => setShowConfirm((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Toggle visibility">
                  <Icon name={showConfirm ? "EyeOff" : "Eye"} className="w-4 h-4" />
                </button>
              </div>
            </Field>
          </div>

          {/* Strength meter */}
          {newPw && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Password strength</span>
                <span className="font-semibold" style={{ color: strengthColor }}>{strengthLabel}</span>
              </div>
              <div className="flex gap-1">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div
                    key={i}
                    className="h-1.5 flex-1 rounded-full transition-all"
                    style={{ background: i < strength ? strengthColor : "var(--muted)" }}
                  />
                ))}
              </div>
              <ul className="text-[11px] text-muted-foreground grid grid-cols-2 gap-x-3 gap-y-0.5 mt-2">
                <li className={newPw.length >= 8 ? "text-emerald-600" : ""}>{newPw.length >= 8 ? "✓" : "○"} At least 8 characters</li>
                <li className={/[A-Za-z]/.test(newPw) ? "text-emerald-600" : ""}>{/[A-Za-z]/.test(newPw) ? "✓" : "○"} Contains a letter</li>
                <li className={/\d/.test(newPw) ? "text-emerald-600" : ""}>{/\d/.test(newPw) ? "✓" : "○"} Contains a number</li>
                <li className={newPw === confirmPw && confirmPw ? "text-emerald-600" : ""}>{newPw === confirmPw && confirmPw ? "✓" : "○"} Passwords match</li>
              </ul>
            </div>
          )}

          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Icon name="ShieldCheck" className="w-3 h-3" />
              In production, passwords are bcrypt-hashed and verified server-side via Cloudflare Workers.
            </p>
            <Button
              onClick={onChangePw}
              disabled={savingPw || !currentPw || !newPw || !confirmPw}
              className="bg-brand hover:bg-brand-dark text-white gap-2"
            >
              {savingPw ? <Icon name="Loader2" className="w-4 h-4 animate-spin" /> : <Icon name="KeyRound" className="w-4 h-4" />}
              Change password
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Appearance */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Icon name="Palette" className="w-4 h-4 text-brand" /> Appearance</CardTitle>
          <CardDescription>Customize how the app looks.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between p-3 rounded-lg border border-border">
            <div>
              <div className="font-medium text-sm">Dark mode</div>
              <div className="text-xs text-muted-foreground">Switch between light and dark themes.</div>
            </div>
            <Switch checked={theme === "dark"} onCheckedChange={toggleTheme} />
          </div>
        </CardContent>
      </Card>

      {/* Usage */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Icon name="Activity" className="w-4 h-4 text-brand" /> Usage</CardTitle>
          <CardDescription>All free, all unlimited. Your lifetime totals.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            {[
              ["Resumes", user?.usage.resumesGenerated],
              ["ATS checks", user?.usage.atsChecks],
              ["Cover letters", user?.usage.coverLetters],
              ["Interview preps", user?.usage.interviewPreps],
              ["Downloads", user?.usage.downloads],
            ].map(([label, val]) => (
              <div key={label as string} className="rounded-lg bg-secondary p-3 text-center">
                <div className="text-2xl font-bold font-display">{val}</div>
                <div className="text-xs text-muted-foreground">{label}</div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Privacy & data */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Icon name="ShieldCheck" className="w-4 h-4 text-brand" /> Privacy & data</CardTitle>
          <CardDescription>Your data stays on your device in dev. In production, it's encrypted at rest in Cloudflare D1 + R2.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg border border-border p-3 flex items-start gap-3">
            <Icon name="Lock" className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <div className="font-medium text-sm">Local-first storage</div>
              <div className="text-xs text-muted-foreground">Resumes, cover letters, and settings are stored in your browser's localStorage. They never touch a server unless you explicitly connect a cloud AI provider.</div>
            </div>
          </div>
          <div className="rounded-lg border border-border p-3 flex items-start gap-3">
            <Icon name="Download" className="w-5 h-5 text-brand shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="font-medium text-sm">Export all my data</div>
              <div className="text-xs text-muted-foreground">Download a JSON backup of everything you've created (resumes, cover letters, interview packages, JDs).</div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const state = useApp.getState();
                const data = {
                  user: state.user,
                  resumes: state.resumes,
                  coverLetters: state.coverLetters,
                  interviews: state.interviews,
                  jobDescriptions: state.jobDescriptions,
                  atsReports: state.atsReports,
                  exportedAt: new Date().toISOString(),
                };
                const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = `resumeai-pro-backup-${new Date().toISOString().slice(0, 10)}.json`;
                a.click();
                URL.revokeObjectURL(url);
                toast.success("Data exported.");
              }}
              className="gap-1.5"
            >
              <Icon name="Download" className="w-3.5 h-3.5" /> Export
            </Button>
          </div>
          <div className="rounded-lg border border-border p-3 flex items-start gap-3">
            <Icon name="Trash2" className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="font-medium text-sm">Clear all local data</div>
              <div className="text-xs text-muted-foreground">Remove all resumes, cover letters, settings, and credentials from this browser. This cannot be undone.</div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive gap-1.5"
              onClick={() => {
                if (confirm("This will delete ALL your local data (resumes, cover letters, settings, login). Continue?")) {
                  localStorage.removeItem("resumeai-pro");
                  log({ actor: "you", action: "Cleared all local data", category: "system", details: "User wiped localStorage", severity: "warning" });
                  setTimeout(() => location.reload(), 300);
                }
              }}
            >
              <Icon name="Trash2" className="w-3.5 h-3.5" /> Clear
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Sessions / sign out */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Icon name="LogOut" className="w-4 h-4 text-brand" /> Session</CardTitle>
          <CardDescription>End your current session on this device.</CardDescription>
        </CardHeader>
        <CardContent className="flex items-center justify-between">
          <div>
            <div className="font-medium text-sm">Signed in as</div>
            <div className="text-xs text-muted-foreground">{user?.email} · since {user?.createdAt ? new Date(user.createdAt).toLocaleDateString() : "—"}</div>
          </div>
          <Button variant="outline" onClick={signOut} className="gap-2">
            <Icon name="LogOut" className="w-4 h-4" /> Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function computeStrength(pw: string): number {
  if (!pw) return 0;
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(4, score);
}
