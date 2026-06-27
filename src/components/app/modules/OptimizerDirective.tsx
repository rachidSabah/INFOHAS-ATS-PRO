"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge, Icon } from "@/components/shared";
import { useApp } from "@/lib/store";
import { SEED_OPTIMIZER_DIRECTIVE } from "@/lib/mock-data";
import { toast } from "sonner";
import type { OptimizerDirectiveConfig, AgentDirectives } from "@/lib/types";
import { BUILT_IN_PROFILES, applyProfileToConfig } from "@/lib/directive-profiles";

export function OptimizerDirective() {
  const config = useApp((s) => s.optimizerDirective);
  const update = useApp((s) => s.updateOptimizerDirective);
  const reset = useApp((s) => s.resetOptimizerDirective);

  // Local draft so the user can edit multiple fields then save all at once
  const [draft, setDraft] = useState<OptimizerDirectiveConfig>(config);
  const [dirty, setDirty] = useState(false);

  const patch = (p: Partial<OptimizerDirectiveConfig>) => {
    setDraft((d) => ({ ...d, ...p }));
    setDirty(true);
  };

  const save = () => {
    update(draft);
    setDirty(false);
    toast.success("Optimizer directive saved. New AI optimizations will use these parameters.");
  };

  const resetToDefaults = () => {
    if (!confirm("Reset ALL optimizer directive parameters to factory defaults? This cannot be undone.")) return;
    setDraft(SEED_OPTIMIZER_DIRECTIVE);
    reset();
    setDirty(false);
    toast.success("Optimizer directive reset to factory defaults.");
  };

  const discard = () => {
    setDraft(config);
    setDirty(false);
    toast.info("Changes discarded.");
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2">
            <Icon name="SlidersHorizontal" className="w-6 h-6 text-brand" /> Optimizer Directive
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Configure the layout parameters for the InfoHAS Pro resume optimizer. These values override the hardcoded defaults and are injected into the AI prompt and rendering components.
          </p>
        </div>
        <div className="flex gap-2">
          {dirty && (
            <Button variant="outline" onClick={discard} className="gap-2">
              <Icon name="RotateCcw" className="w-4 h-4" /> Discard
            </Button>
          )}
          <Button variant="outline" onClick={resetToDefaults} className="gap-2 text-destructive hover:text-destructive">
            <Icon name="Trash2" className="w-4 h-4" /> Reset to defaults
          </Button>
          <Button onClick={save} disabled={!dirty} className="bg-brand hover:bg-brand-dark text-white gap-2">
            <Icon name="Save" className="w-4 h-4" /> Save directive
          </Button>
        </div>
      </div>

      {dirty && (
        <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3 flex items-center gap-2">
          <Icon name="AlertTriangle" className="w-4 h-4 text-amber-600" />
          <span className="text-sm text-amber-800 dark:text-amber-200">You have unsaved changes. Click "Save directive" to apply them.</span>
        </div>
      )}

      {/* DIRECTIVE PROFILE SELECTOR */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Icon name="Layers" className="w-4 h-4 text-brand" /> Directive Profile</CardTitle>
          <CardDescription>
            Select a pre-built directive profile to instantly configure all optimization parameters for a specific use case. 
            This is the recommended way to tune optimization behavior — no manual settings required.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {Object.values(BUILT_IN_PROFILES).map((profile) => (
              <button
                key={profile.id}
                onClick={() => {
                  const merged = applyProfileToConfig(draft, profile);
                  if (merged) {
                    setDraft(merged);
                    setDirty(true);
                    toast.info(`Profile "${profile.name}" applied — review and save changes.`);
                  }
                }}
                className="relative flex flex-col items-start p-3 rounded-lg border border-input bg-background hover:bg-secondary/40 hover:border-brand/40 transition-all text-left"
              >
                <span className="text-sm font-semibold">{profile.name}</span>
                <span className="text-[10px] text-muted-foreground mt-0.5">{profile.tags.join(", ")}</span>
                <span className="text-xs text-muted-foreground mt-1 line-clamp-2">{profile.description}</span>
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Selecting a profile modifies all applicable fields above. You can then fine-tune individual settings before saving.
          </p>
        </CardContent>
      </Card>

      {/* PAGE FORMAT */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Icon name="FileText" className="w-4 h-4 text-brand" /> Page Format</CardTitle>
          <CardDescription>Page size and margins (in millimeters). These control the physical layout of the exported PDF.</CardDescription>
        </CardHeader>
        <CardContent className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <Label htmlFor="pageSize">Page Size</Label>
            <select
              id="pageSize"
              value={draft.pageSize}
              onChange={(e) => patch({ pageSize: e.target.value as "A4" | "Letter" })}
              className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm mt-1"
            >
              <option value="A4">A4 (210 × 297 mm)</option>
              <option value="Letter">Letter (216 × 279 mm)</option>
            </select>
          </div>
          <NumberField label="Top Margin (mm)" value={draft.marginTopMm} onChange={(v) => patch({ marginTopMm: v })} step={0.1} min={0} max={50} />
          <NumberField label="Bottom Margin (mm)" value={draft.marginBottomMm} onChange={(v) => patch({ marginBottomMm: v })} step={0.1} min={0} max={50} />
          <NumberField label="Left Margin (mm)" value={draft.marginLeftMm} onChange={(v) => patch({ marginLeftMm: v })} step={0.1} min={0} max={50} />
          <NumberField label="Right Margin (mm)" value={draft.marginRightMm} onChange={(v) => patch({ marginRightMm: v })} step={0.1} min={0} max={50} />
        </CardContent>
      </Card>

      {/* FONTS */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Icon name="Type" className="w-4 h-4 text-brand" /> Fonts</CardTitle>
          <CardDescription>Font family and sizes (in points). The AI uses these to control text hierarchy.</CardDescription>
        </CardHeader>
        <CardContent className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <Label htmlFor="fontFamily">Font Family</Label>
            <Input id="fontFamily" value={draft.fontFamily} onChange={(e) => patch({ fontFamily: e.target.value })} className="mt-1" placeholder="Times New Roman" />
          </div>
          <NumberField label="Body Font Size (pt)" value={draft.bodyFontSizePt} onChange={(v) => patch({ bodyFontSizePt: v })} step={0.5} min={8} max={14} />
          <NumberField label="Section Title Size (pt)" value={draft.sectionTitleSizePt} onChange={(v) => patch({ sectionTitleSizePt: v })} step={0.5} min={10} max={16} />
          <NumberField label="Name Size (pt)" value={draft.nameSizePt} onChange={(v) => patch({ nameSizePt: v })} step={0.5} min={12} max={20} />
        </CardContent>
      </Card>

      {/* COLORS */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Icon name="Palette" className="w-4 h-4 text-brand" /> Colors</CardTitle>
          <CardDescription>Hex color codes for the candidate name, section headers, and body text.</CardDescription>
        </CardHeader>
        <CardContent className="grid sm:grid-cols-3 gap-4">
          <ColorField label="Name Color" value={draft.nameColor} onChange={(v) => patch({ nameColor: v })} />
          <ColorField label="Section Title Color" value={draft.sectionTitleColor} onChange={(v) => patch({ sectionTitleColor: v })} />
          <ColorField label="Body Text Color" value={draft.bodyTextColor} onChange={(v) => patch({ bodyTextColor: v })} />
        </CardContent>
      </Card>

      {/* SPACING */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Icon name="MoveVertical" className="w-4 h-4 text-brand" /> Spacing</CardTitle>
          <CardDescription>Line height, section gaps, and bullet indentation. Tighter spacing = more content per page.</CardDescription>
        </CardHeader>
        <CardContent className="grid sm:grid-cols-3 gap-4">
          <NumberField label="Line Height (CSS)" value={draft.lineHeight} onChange={(v) => patch({ lineHeight: v })} step={0.05} min={1} max={2} />
          <NumberField label="Section Gap (mm)" value={draft.sectionGapMm} onChange={(v) => patch({ sectionGapMm: v })} step={0.5} min={0} max={20} />
          <NumberField label="Bullet Indent (mm)" value={draft.bulletIndentMm} onChange={(v) => patch({ bulletIndentMm: v })} step={0.5} min={0} max={15} />
        </CardContent>
      </Card>

      {/* PHOTO */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Icon name="Image" className="w-4 h-4 text-brand" /> Photo</CardTitle>
          <CardDescription>Configure the passport-style photo in the header. If disabled, the photo section is removed entirely.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Photo Enabled</Label>
              <p className="text-xs text-muted-foreground">Show the photo frame in the header</p>
            </div>
            <Switch checked={draft.photoEnabled} onCheckedChange={(v) => patch({ photoEnabled: v })} />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <Label>Show Placeholder if No Photo</Label>
              <p className="text-xs text-muted-foreground">If false, the photo section is removed entirely when no photo is uploaded</p>
            </div>
            <Switch checked={draft.showPlaceholderIfNoPhoto} onCheckedChange={(v) => patch({ showPlaceholderIfNoPhoto: v })} />
          </div>
          <div className="grid sm:grid-cols-2 gap-4">
            <NumberField label="Photo Width (mm)" value={draft.photoWidthMm} onChange={(v) => patch({ photoWidthMm: v })} step={1} min={10} max={80} />
            <NumberField label="Photo Height (mm)" value={draft.photoHeightMm} onChange={(v) => patch({ photoHeightMm: v })} step={1} min={15} max={100} />
          </div>
        </CardContent>
      </Card>

      {/* CONTENT LIMITS */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Icon name="ListChecks" className="w-4 h-4 text-brand" /> Content Limits</CardTitle>
          <CardDescription>Control how much content the AI generates per section. Lower values = tighter one-page fit.</CardDescription>
        </CardHeader>
        <CardContent className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <NumberField label="Summary Min Words" value={draft.summaryMinWords} onChange={(v) => patch({ summaryMinWords: v })} step={5} min={20} max={150} />
          <NumberField label="Summary Max Words" value={draft.summaryMaxWords} onChange={(v) => patch({ summaryMaxWords: v })} step={5} min={40} max={200} />
          <NumberField label="Max Skill Groups" value={draft.skillsMaxGroups} onChange={(v) => patch({ skillsMaxGroups: v })} step={1} min={2} max={8} />
          <NumberField label="Max Experience Entries" value={draft.experienceMaxEntries} onChange={(v) => patch({ experienceMaxEntries: v })} step={1} min={1} max={8} />
          <NumberField label="Bullets per Experience" value={draft.experienceBulletsPerEntry} onChange={(v) => patch({ experienceBulletsPerEntry: v })} step={1} min={2} max={8} />
          <NumberField label="Max Education Entries" value={draft.educationMaxEntries} onChange={(v) => patch({ educationMaxEntries: v })} step={1} min={1} max={5} />
          <NumberField label="Max Language Entries" value={draft.languagesMaxEntries} onChange={(v) => patch({ languagesMaxEntries: v })} step={1} min={1} max={8} />
        </CardContent>
      </Card>

      {/* ONE-PAGE ENFORCEMENT */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Icon name="FileCheck" className="w-4 h-4 text-brand" /> One-Page Enforcement</CardTitle>
          <CardDescription>Enforce that the resume fits on exactly one page. The AI will compress content rather than splitting.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <Label>Enforce One Page</Label>
              <p className="text-xs text-muted-foreground">assert(pdf.pages === 1) — never generate a second page</p>
            </div>
            <Switch checked={draft.enforceOnePage} onCheckedChange={(v) => patch({ enforceOnePage: v })} />
          </div>
          <NumberField label="Minimum Font Size (pt)" value={draft.minFontSizePt} onChange={(v) => patch({ minFontSizePt: v })} step={0.5} min={8} max={12} />
          <p className="text-xs text-muted-foreground">The AI will never reduce the font size below this value when compressing content.</p>
        </CardContent>
      </Card>

      {/* CUSTOM DIRECTIVE OVERRIDE (ADVANCED) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Icon name="Code" className="w-4 h-4 text-brand" /> Custom Directive Override
            <Badge variant="outline" className="text-[10px] ml-2">Advanced</Badge>
          </CardTitle>
          <CardDescription>
            If non-empty, this COMPLETELY REPLACES the auto-generated directive text sent to the AI. Use this for advanced fine-tuning that the structured fields above can't express. Leave empty to use the auto-generated directive from the fields above.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={draft.customDirectiveOverride}
            onChange={(e) => patch({ customDirectiveOverride: e.target.value })}
            rows={10}
            placeholder="Leave empty to use the auto-generated directive from the fields above. Or paste a custom directive here to override everything..."
            className="font-mono text-xs"
          />
          <div className="flex items-center gap-2">
            <Badge variant={draft.customDirectiveOverride.trim() ? "brand" : "outline"} className="text-[10px]">
              {draft.customDirectiveOverride.trim() ? "OVERRIDE ACTIVE" : "Auto-generated (from fields above)"}
            </Badge>
            {draft.customDirectiveOverride.trim() && (
              <Button size="sm" variant="ghost" onClick={() => patch({ customDirectiveOverride: "" })} className="text-destructive">
                Clear override (use fields)
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* PER-AGENT DIRECTIVES */}
      <AgentDirectivesSection draft={draft} patch={patch} />

      {/* Live preview of generated directive */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Icon name="Eye" className="w-4 h-4 text-brand" /> Generated Directive Preview</CardTitle>
          <CardDescription>This is the directive text that will be sent to the AI (read-only — edit the fields above to change it).</CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="text-xs bg-secondary/60 dark:bg-secondary/30 rounded-lg p-4 overflow-auto max-h-96 whitespace-pre-wrap font-mono">
{draft.customDirectiveOverride.trim() || generateDirectivePreview(draft)}
          </pre>
        </CardContent>
      </Card>

      {/* Save bar at bottom */}
      {dirty && (
        <div className="sticky bottom-4 z-10">
          <Card className="bg-brand text-white border-brand shadow-premium">
            <CardContent className="p-4 flex items-center justify-between gap-3">
              <span className="text-sm font-medium flex items-center gap-2">
                <Icon name="AlertTriangle" className="w-4 h-4" /> You have unsaved changes
              </span>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={discard} className="text-white hover:bg-white/10">Discard</Button>
                <Button size="sm" onClick={save} className="bg-white text-brand hover:bg-white/90 gap-2">
                  <Icon name="Save" className="w-4 h-4" /> Save directive
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// === Helper components ===

function NumberField({ label, value, onChange, step, min, max }: { label: string; value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number }) {
  return (
    <div>
      <Label>{label}</Label>
      <Input
        type="number"
        value={value}
        onChange={(e) => {
          const v = parseFloat(e.target.value);
          if (!isNaN(v)) onChange(v);
        }}
        step={step}
        min={min}
        max={max}
        className="mt-1"
      />
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex gap-2 mt-1 items-center">
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-9 h-9 rounded-md border border-input cursor-pointer"
        />
        <Input value={value} onChange={(e) => onChange(e.target.value)} className="flex-1 font-mono text-xs" placeholder="#000000" />
      </div>
    </div>
  );
}

// === Agent Directives Section ===

function AgentDirectivesSection({ draft, patch }: { draft: OptimizerDirectiveConfig; patch: (p: Partial<OptimizerDirectiveConfig>) => void }) {
  const updateAgent = <K extends keyof AgentDirectives>(key: K, value: Partial<AgentDirectives[K]>) => {
    patch({
      agentDirectives: {
        ...draft.agentDirectives,
        [key]: { ...draft.agentDirectives[key], ...value },
      },
    });
  };

  return (
    <>
      {/* Section header */}
      <div className="flex items-center gap-2 pt-4">
        <Icon name="Bot" className="w-5 h-5 text-brand" />
        <h2 className="font-display text-xl font-bold">Per-Agent Directives</h2>
        <Badge variant="outline" className="text-[10px] ml-2">New</Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        Configure what each agent in the multi-agent pipeline is allowed to do. These directives are injected into each agent's prompt and enforced by the Resume Structure Guardian.
      </p>

      {/* Supervisor Directive */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Icon name="Shield" className="w-4 h-4 text-brand" /> Supervisor Agent
          </CardTitle>
          <CardDescription>Controls orchestration, retries, provider switching, and strict mode enforcement.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <SwitchRow
            label="Strict Mode"
            description="Hard-fail on any critical issue (no graceful degradation). Returns REQUIRES_MANUAL_REVIEW."
            checked={draft.agentDirectives.supervisor.strictMode}
            onChange={(v) => updateAgent("supervisor", { strictMode: v })}
          />
          <SwitchRow
            label="Enable Retries"
            description="Retry failed optimization attempts (up to 4 attempts)."
            checked={draft.agentDirectives.supervisor.enableRetries}
            onChange={(v) => updateAgent("supervisor", { enableRetries: v })}
          />
          <SwitchRow
            label="Enable Provider Switch"
            description="Switch to next AI provider when current one fails or times out."
            checked={draft.agentDirectives.supervisor.enableProviderSwitch}
            onChange={(v) => updateAgent("supervisor", { enableProviderSwitch: v })}
          />
          <SwitchRow
            label="Enforce Immutable Entities"
            description="Post-optimization enforcement of company names, dates, education, languages."
            checked={draft.agentDirectives.supervisor.enforceImmutableEntities}
            onChange={(v) => updateAgent("supervisor", { enforceImmutableEntities: v })}
          />
          <SwitchRow
            label="Enable Debug Logs"
            description="Emit detailed console logs for each pipeline stage (source, optimizer input/output, assembler, guardian)."
            checked={draft.agentDirectives.supervisor.enableDebugLogs}
            onChange={(v) => updateAgent("supervisor", { enableDebugLogs: v })}
          />
          <SwitchRow
            label="Enable Diff Viewer"
            description="Show before/after diff viewer in the UI after optimization completes."
            checked={draft.agentDirectives.supervisor.enableDiffViewer}
            onChange={(v) => updateAgent("supervisor", { enableDiffViewer: v })}
          />
        </CardContent>
      </Card>

      {/* Summary Agent Directive */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Icon name="AlignLeft" className="w-4 h-4 text-brand" /> Summary Agent
          </CardTitle>
          <CardDescription>Controls professional summary rewriting and ATS keyword injection.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label>ATS Aggressiveness</Label>
              <Badge variant="outline" className="text-[10px]">{draft.agentDirectives.summary.atsAggressiveness}/100</Badge>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={draft.agentDirectives.summary.atsAggressiveness}
              onChange={(e) => updateAgent("summary", { atsAggressiveness: parseInt(e.target.value) })}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground mt-1">
              {draft.agentDirectives.summary.atsAggressiveness < 30 ? "Minimal — only rephrase existing content" :
               draft.agentDirectives.summary.atsAggressiveness < 70 ? "Moderate — embed keywords naturally" :
               "Aggressive — maximize keyword density (risk of stuffing)"}
            </p>
          </div>
          <SwitchRow
            label="Preserve Facts"
            description="Never add facts (employers, locations, languages, education) not in source resume."
            checked={draft.agentDirectives.summary.preserveFacts}
            onChange={(v) => updateAgent("summary", { preserveFacts: v })}
          />
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              label="Min Characters"
              value={draft.agentDirectives.summary.minCharacters}
              onChange={(v) => updateAgent("summary", { minCharacters: v })}
              step={50}
              min={100}
              max={1000}
            />
            <NumberField
              label="Max Characters"
              value={draft.agentDirectives.summary.maxCharacters}
              onChange={(v) => updateAgent("summary", { maxCharacters: v })}
              step={50}
              min={300}
              max={1500}
            />
          </div>
        </CardContent>
      </Card>

      {/* Skills Agent Directive */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Icon name="Tags" className="w-4 h-4 text-brand" /> Skills Agent
          </CardTitle>
          <CardDescription>Controls skills enrichment and forbidden keyword filtering.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <NumberField
            label="Max Keywords"
            value={draft.agentDirectives.skills.maxKeywords}
            onChange={(v) => updateAgent("skills", { maxKeywords: v })}
            step={1}
            min={5}
            max={30}
          />
          <SwitchRow
            label="Allow Transferable Skills"
            description="Add transferable skills that bridge gaps between candidate experience and JD requirements."
            checked={draft.agentDirectives.skills.allowTransferableSkills}
            onChange={(v) => updateAgent("skills", { allowTransferableSkills: v })}
          />
          <div className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-3 space-y-2">
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-red-800 dark:text-red-200">Allow Company Keywords</Label>
                <p className="text-xs text-red-700 dark:text-red-300">FORBIDDEN — company names as skills (e.g., "Qatar Duty Free")</p>
              </div>
              <Switch
                checked={draft.agentDirectives.skills.allowCompanyKeywords}
                onCheckedChange={(v) => updateAgent("skills", { allowCompanyKeywords: v })}
                disabled
              />
            </div>
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-red-800 dark:text-red-200">Allow Location Keywords</Label>
                <p className="text-xs text-red-700 dark:text-red-300">FORBIDDEN — location names as skills (e.g., "Doha", "Qatar")</p>
              </div>
              <Switch
                checked={draft.agentDirectives.skills.allowLocationKeywords}
                onCheckedChange={(v) => updateAgent("skills", { allowLocationKeywords: v })}
                disabled
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Experience Agent Directive */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Icon name="Briefcase" className="w-4 h-4 text-brand" /> Experience Agent
          </CardTitle>
          <CardDescription>Controls bullet rewriting and immutable field protection.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <SwitchRow
            label="Rewrite Bullets Only"
            description="Only rewrite bullet points. Never modify title, company, dates, or location."
            checked={draft.agentDirectives.experience.rewriteBulletsOnly}
            onChange={(v) => updateAgent("experience", { rewriteBulletsOnly: v })}
          />
          <div className="rounded-lg bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 p-3 space-y-2">
            <p className="text-xs font-medium text-red-800 dark:text-red-200">Immutable Fields (FORBIDDEN to rewrite in locked pipeline):</p>
            <div className="grid grid-cols-2 gap-2">
              <ImmutableSwitch
                label="Rewrite Title"
                checked={draft.agentDirectives.experience.rewriteTitle}
                onChange={(v) => updateAgent("experience", { rewriteTitle: v })}
              />
              <ImmutableSwitch
                label="Rewrite Company"
                checked={draft.agentDirectives.experience.rewriteCompany}
                onChange={(v) => updateAgent("experience", { rewriteCompany: v })}
              />
              <ImmutableSwitch
                label="Rewrite Dates"
                checked={draft.agentDirectives.experience.rewriteDates}
                onChange={(v) => updateAgent("experience", { rewriteDates: v })}
              />
              <ImmutableSwitch
                label="Rewrite Location"
                checked={draft.agentDirectives.experience.rewriteLocation}
                onChange={(v) => updateAgent("experience", { rewriteLocation: v })}
              />
            </div>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <Label>Max Expansion</Label>
              <Badge variant="outline" className="text-[10px]">{draft.agentDirectives.experience.maxExpansionPercent}%</Badge>
            </div>
            <input
              type="range"
              min={0}
              max={50}
              step={5}
              value={draft.agentDirectives.experience.maxExpansionPercent}
              onChange={(e) => updateAgent("experience", { maxExpansionPercent: parseInt(e.target.value) })}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Maximum percentage by which bullets can expand vs original length. 0% = same length, 50% = allow 50% longer.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Education Agent Directive */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Icon name="GraduationCap" className="w-4 h-4 text-brand" /> Education Agent
          </CardTitle>
          <CardDescription>Formatting only — no inference or additions.</CardDescription>
        </CardHeader>
        <CardContent>
          <SwitchRow
            label="Format Only"
            description="Only format education entries. Never add, remove, or infer education."
            checked={draft.agentDirectives.education.formatOnly}
            onChange={(v) => updateAgent("education", { formatOnly: v })}
          />
        </CardContent>
      </Card>

      {/* Languages Agent Directive */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Icon name="Languages" className="w-4 h-4 text-brand" /> Languages Agent
          </CardTitle>
          <CardDescription>Formatting only — no inference or additions.</CardDescription>
        </CardHeader>
        <CardContent>
          <SwitchRow
            label="Format Only"
            description="Only format language entries. Never add, remove, or infer languages."
            checked={draft.agentDirectives.languages.formatOnly}
            onChange={(v) => updateAgent("languages", { formatOnly: v })}
          />
        </CardContent>
      </Card>

      {/* Guardian Agent Directive */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Icon name="ShieldCheck" className="w-4 h-4 text-brand" /> Guardian Agent
          </CardTitle>
          <CardDescription>Controls final validation sensitivity. Configure which checks trigger VETO (block export) vs warning (allow with notice).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <SwitchRow
            label="Enforce Entity Integrity"
            description="VETO on any company/school/language mismatch between original and optimized."
            checked={draft.agentDirectives.guardian.enforceEntityIntegrity}
            onChange={(v) => updateAgent("guardian", { enforceEntityIntegrity: v })}
          />
          <SwitchRow
            label="Enforce Page Utilization"
            description="VETO when page usage is below 85% (disabling makes it advisory-only)."
            checked={draft.agentDirectives.guardian.enforcePageUtilization}
            onChange={(v) => updateAgent("guardian", { enforcePageUtilization: v })}
          />
          <SwitchRow
            label="Enforce Content Length"
            description="VETO when total resume content is below minimum character threshold."
            checked={draft.agentDirectives.guardian.enforceContentLength}
            onChange={(v) => updateAgent("guardian", { enforceContentLength: v })}
          />
          <SwitchRow
            label="Enforce No Duplicates"
            description="VETO when duplicate sentences are detected in the optimized resume."
            checked={draft.agentDirectives.guardian.enforceNoDuplicates}
            onChange={(v) => updateAgent("guardian", { enforceNoDuplicates: v })}
          />
          <SwitchRow
            label="Enforce Summary Quality"
            description="VETO when summary is too short or generic (below word count target)."
            checked={draft.agentDirectives.guardian.enforceSummaryQuality}
            onChange={(v) => updateAgent("guardian", { enforceSummaryQuality: v })}
          />
          <NumberField
            label="Minimum Guardian Score"
            value={draft.agentDirectives.guardian.minimumScore}
            onChange={(v) => updateAgent("guardian", { minimumScore: v })}
            step={5}
            min={50}
            max={100}
          />
        </CardContent>
      </Card>
    </>
  );
}

function SwitchRow({ label, description, checked, onChange }: { label: string; description: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <Label>{label}</Label>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function ImmutableSwitch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between bg-white dark:bg-secondary/30 rounded-md p-2 border border-red-100 dark:border-red-900/50">
      <Label className="text-xs text-red-800 dark:text-red-200">{label}</Label>
      <Switch checked={checked} onCheckedChange={onChange} disabled />
    </div>
  );
}

// === Directive preview generator (mirrors the logic in ai.ts) ===

function generateDirectivePreview(c: OptimizerDirectiveConfig): string {
  return `You are the ResumeAI Pro Optimizer. You MUST preserve the EXACT layout framework described below.

═══════════════════════════════════════════════════════════════
PAGE FORMAT
═══════════════════════════════════════════════════════════════
- Document size: ${c.pageSize}
- Maximum pages: 1
- Required pages: EXACTLY 1
- NEVER generate a second page.
${c.enforceOnePage ? "- Validation: assert(pdf.pages === 1)" : ""}

═══════════════════════════════════════════════════════════════
MARGINS (very compact)
═══════════════════════════════════════════════════════════════
- Top: ${c.marginTopMm}mm
- Bottom: ${c.marginBottomMm}mm
- Left: ${c.marginLeftMm}mm
- Right: ${c.marginRightMm}mm

═══════════════════════════════════════════════════════════════
FONT RULES
═══════════════════════════════════════════════════════════════
- Primary font: ${c.fontFamily}
- Body size: ${c.bodyFontSizePt}pt
- Section titles: ${c.sectionTitleSizePt}pt, BOLD, UPPERCASE, color ${c.sectionTitleColor}
- Name: BOLD, ${c.nameSizePt}pt, color ${c.nameColor}, UPPERCASE
- Body text: color ${c.bodyTextColor}

═══════════════════════════════════════════════════════════════
SPACING
═══════════════════════════════════════════════════════════════
- Line height: ${c.lineHeight}
- Section gap: ${c.sectionGapMm}mm
- Bullet indent: ${c.bulletIndentMm}mm

═══════════════════════════════════════════════════════════════
PHOTO
═══════════════════════════════════════════════════════════════
${c.photoEnabled ? `- Photo: ${c.photoWidthMm}×${c.photoHeightMm}mm, top-right corner
- ${c.showPlaceholderIfNoPhoto ? "Show empty placeholder if no photo uploaded" : "If no photo exists, remove photo section entirely. Do NOT use placeholders."}` : "- Photo section DISABLED. Do not include any photo."}

═══════════════════════════════════════════════════════════════
CONTENT LIMITS
═══════════════════════════════════════════════════════════════
- Summary: ${c.summaryMinWords}-${c.summaryMaxWords} words, single paragraph, no bullets
- Skills: max ${c.skillsMaxGroups} groups
- Experience: max ${c.experienceMaxEntries} entries, ${c.experienceBulletsPerEntry} bullets each
- Education: max ${c.educationMaxEntries} entries
- Languages: max ${c.languagesMaxEntries} entries

═══════════════════════════════════════════════════════════════
ONE-PAGE COMPRESSION
═══════════════════════════════════════════════════════════════
${c.enforceOnePage ? `If content exceeds one page, apply IN THIS ORDER:
1. Compress summary
2. Reduce bullet length
3. Remove repetitive achievements
4. Reduce spacing
5. Reduce font size to MINIMUM ${c.minFontSizePt}pt
6. Merge similar skills
NEVER create page two. assert(pdf.pages === 1).` : "Multi-page output allowed if content exceeds one page."}

${c.agentDirectives ? `
═══════════════════════════════════════════════════════════════
AGENT RULES (MANDATORY)
═══════════════════════════════════════════════════════════════
Summary: ${c.summaryMinWords}-${c.summaryMaxWords} words. ATS: ${c.agentDirectives.summary.atsAggressiveness}/100. No hallucinations. No parentheses.
Skills: Max ${c.skillsMaxGroups} groups. Never Targeted Keywords. No company/location names as skills.
Experience: ${c.agentDirectives.experience.rewriteBulletsOnly ? "Rewrite bullets ONLY." : ""} Role | Company | Date format. Preserve chronology.
Education: Diploma | School | Date format. Never remove schools.
Languages: Preserve all. Max ${c.languagesMaxEntries} entries.
Guardian: Min score ${c.agentDirectives.guardian.minimumScore}. VETO: entities=${c.agentDirectives.guardian.enforceEntityIntegrity}, duplicates=${c.agentDirectives.guardian.enforceNoDuplicates}.
` : ""}\`;
}
