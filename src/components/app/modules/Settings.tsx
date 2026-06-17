"use client";

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

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="Settings" className="w-6 h-6 text-brand" /> Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">Account, appearance, data, and privacy.</p>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-lg">Account</CardTitle><CardDescription>Your profile information.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Name"><Input defaultValue={user?.name} /></Field>
            <Field label="Email"><Input defaultValue={user?.email} disabled /></Field>
            <Field label="Role"><Input value={user?.role?.replace("_", " ")} disabled className="capitalize" /></Field>
            <Field label="Auth provider"><Input value={user?.provider} disabled className="capitalize" /></Field>
          </div>
          <Button variant="outline" onClick={() => toast.success("Profile saved.")} className="gap-2"><Icon name="Save" className="w-4 h-4" /> Save changes</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">Appearance</CardTitle><CardDescription>Customize how the app looks.</CardDescription></CardHeader>
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

      <Card>
        <CardHeader><CardTitle className="text-lg">Usage</CardTitle><CardDescription>All free, all unlimited.</CardDescription></CardHeader>
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

      <Card>
        <CardHeader><CardTitle className="text-lg">Privacy & data</CardTitle><CardDescription>Your data stays on your device.</CardDescription></CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg border border-border p-3 flex items-start gap-3">
            <Icon name="ShieldCheck" className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <div className="font-medium text-sm">Local-first storage</div>
              <div className="text-xs text-muted-foreground">Resumes, cover letters, and settings are stored in your browser's localStorage. They never touch a server unless you explicitly connect a cloud AI provider.</div>
            </div>
          </div>
          <div className="rounded-lg border border-border p-3 flex items-start gap-3">
            <Icon name="Trash2" className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
            <div className="flex-1">
              <div className="font-medium text-sm">Clear all local data</div>
              <div className="text-xs text-muted-foreground">Remove all resumes, cover letters, and settings from this browser.</div>
            </div>
            <Button variant="outline" size="sm" className="text-destructive" onClick={() => {
              if (confirm("This will delete all your local data. Continue?")) {
                localStorage.removeItem("resumeai-pro");
                location.reload();
              }
            }}>Clear</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5 flex items-center justify-between">
          <div>
            <div className="font-medium text-sm">Sign out</div>
            <div className="text-xs text-muted-foreground">End your current session.</div>
          </div>
          <Button variant="outline" onClick={signOut} className="gap-2"><Icon name="LogOut" className="w-4 h-4" /> Sign out</Button>
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
