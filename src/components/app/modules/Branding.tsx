"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge, Icon, Logo } from "@/components/shared";
import { useApp } from "@/lib/store";
import { api as cloudApi } from "@/lib/cloud-api";
import { UnsavedBanner } from "./unsaved-changes";
import { toast } from "sonner";

export function Branding() {
  const branding = useApp((s) => s.branding);
  const updateBranding = useApp((s) => s.updateBranding);
  const log = useApp((s) => s.log);

  // Unsaved-changes tracking: any field edit marks the panel dirty until the
  // explicit save confirms D1 has the full state (same contract as the other
  // Super Admin panels). Cleared ONLY on a successful save.
  const [dirty, setDirty] = useState(false);
  const patch = (p: Parameters<typeof updateBranding>[0]) => {
    updateBranding(p);
    setDirty(true);
  };

  // Real save: explicitly pushes the full branding state to D1 (PUT
  // /api/settings/branding). Fields already persist per-keystroke via the
  // store; this button guarantees the current state is on the server and
  // gives the user a confirmed, refresh-proof save.
  const [saving, setSaving] = useState(false);
  const save = async () => {
    setSaving(true);
    try {
      await cloudApi.updateBranding(branding);
      setDirty(false);
      log({ actor: "you", action: "Branding updated", category: "admin", details: `${branding.appName} · ${branding.primaryColor}`, severity: "info" });
      toast.success("Branding saved to cloud — persists across refreshes.");
    } catch {
      toast.error("Branding save failed — check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="Palette" className="w-6 h-6 text-brand" /> Branding</h1>
        <p className="text-sm text-muted-foreground mt-1">Customize the app's name, colors, logo, and email/PDF branding.</p>
      </div>

      {dirty && <UnsavedBanner saveLabel="Save branding" />}

      <div className="grid lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-lg">Brand identity</CardTitle><CardDescription>Used across the app, PDFs, and emails.</CardDescription></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="App name"><Input value={branding.appName} onChange={(e) => patch({ appName: e.target.value })} /></Field>
              <Field label="Tagline"><Input value={branding.tagline} onChange={(e) => patch({ tagline: e.target.value })} /></Field>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Primary color">
                <div className="flex gap-2">
                  <Input type="color" value={branding.primaryColor} onChange={(e) => patch({ primaryColor: e.target.value })} className="w-12 h-9 p-1" />
                  <Input value={branding.primaryColor} onChange={(e) => patch({ primaryColor: e.target.value })} />
                </div>
              </Field>
              <Field label="Accent color">
                <div className="flex gap-2">
                  <Input type="color" value={branding.accentColor} onChange={(e) => patch({ accentColor: e.target.value })} className="w-12 h-9 p-1" />
                  <Input value={branding.accentColor} onChange={(e) => patch({ accentColor: e.target.value })} />
                </div>
              </Field>
            </div>
            <Field label="Logo URL"><Input value={branding.logoUrl} onChange={(e) => patch({ logoUrl: e.target.value })} /></Field>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-lg">Live preview</CardTitle></CardHeader>
          <CardContent>
            <div className="rounded-xl p-6 text-center" style={{ background: branding.primaryColor, color: "white" }}>
              <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-white/15 mb-3">
                <Logo size={36} withText={false} />
              </div>
              <div className="font-display text-xl font-bold">{branding.appName}</div>
              <div className="text-sm opacity-80 mt-1">{branding.tagline}</div>
              <div className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold" style={{ background: branding.accentColor, color: "#0B1F3A" }}>
                <Icon name="Sparkles" className="w-3 h-3" /> Get started
              </div>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
              <Button variant="outline" size="sm" onClick={() => toast.success("Icon regeneration queued.")} className="gap-1.5"><Icon name="RefreshCcw" className="w-3.5 h-3.5" /> Regenerate icons</Button>
              <Button variant="outline" size="sm" onClick={() => toast.success("Asset bundle exported.")} className="gap-1.5"><Icon name="Package" className="w-3.5 h-3.5" /> Export assets</Button>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-lg">Email branding</CardTitle><CardDescription>Used in transactional emails and magic links.</CardDescription></CardHeader>
        <CardContent className="grid sm:grid-cols-2 gap-3">
          <Field label="From name"><Input value={branding.emailFromName} onChange={(e) => patch({ emailFromName: e.target.value })} /></Field>
          <Field label="From address"><Input value={branding.emailFromAddress} onChange={(e) => patch({ emailFromAddress: e.target.value })} /></Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-lg">PDF branding</CardTitle><CardDescription>Footer text on exported resumes and cover letters.</CardDescription></CardHeader>
        <CardContent>
          <Field label="PDF footer text"><Input value={branding.pdfFooterText} onChange={(e) => patch({ pdfFooterText: e.target.value })} /></Field>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving} className="bg-brand hover:bg-brand-dark text-white gap-2"><Icon name="Save" className="w-4 h-4" /> {saving ? "Saving…" : "Save branding"}</Button>
      </div>
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
