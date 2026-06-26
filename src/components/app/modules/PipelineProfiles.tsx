"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge, Icon } from "@/components/shared";
import { useApp } from "@/lib/store";
import { SEED_PIPELINE_PROFILES } from "@/lib/pipeline-orchestration-seeds";
import { toast } from "sonner";
import type { PipelineProfile, PipelineProfileType } from "@/lib/pipeline-orchestration-types";

export function PipelineProfiles() {
  const profiles = useApp((s) => s.pipelineProfiles);
  const selectedProfileId = useApp((s) => s.selectedProfileId);
  const selectProfile = useApp((s) => s.selectPipelineProfile);
  const updateProfile = useApp((s) => s.updatePipelineProfile);
  const addProfile = useApp((s) => s.addPipelineProfile);
  const removeProfile = useApp((s) => s.removePipelineProfile);
  const reset = useApp((s) => s.resetPipelineOrchestration);

  const [editingProfile, setEditingProfile] = useState<PipelineProfile | null>(null);

  const selectedProfile = profiles.find((p) => p.id === selectedProfileId);

  const handleSelect = (id: string) => {
    selectProfile(id);
    const profile = profiles.find((p) => p.id === id);
    toast.success(`Pipeline profile changed to "${profile?.name}". All pipelines will now use this profile.`);
  };

  const handleCreateCustom = () => {
    const newProfile: PipelineProfile = {
      id: `profile-custom-${Date.now()}`,
      name: "Custom Profile",
      description: "User-defined pipeline profile with full manual configuration.",
      type: "custom" as PipelineProfileType,
      enabledAgents: selectedProfile?.enabledAgents || [],
      parallelGroups: selectedProfile?.parallelGroups || [],
      enableV3PostOptimization: true,
      useLockedPipeline: true,
      enableTargetedRegeneration: true,
      matchingStrategy: "hybrid",
      hybridMatchingThreshold: 75,
      maxRetries: 4,
      validationThresholds: selectedProfile?.validationThresholds || {
        minAtsScore: 70, minFactualConsistency: 95, minKeywordCoverage: 65,
        minHtmlValidation: 90, minGrammarScore: 90, minRecruiterReadability: 85,
        minSemanticSimilarity: 80, minConfidenceScore: 80, minQualityScore: 85,
        enforceOnePage: true,
      },
      isBuiltIn: false,
      isDefault: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    addProfile(newProfile);
    setEditingProfile(newProfile);
    toast.success("Custom profile created. Edit the fields below and save.");
  };

  const handleSaveEdit = () => {
    if (!editingProfile) return;
    updateProfile(editingProfile.id, editingProfile);
    setEditingProfile(null);
    toast.success("Profile saved.");
  };

  const handleReset = () => {
    if (!confirm("Reset ALL pipeline orchestration to factory defaults? This includes profiles, agent configs, and prompt versions.")) return;
    reset();
    setEditingProfile(null);
    toast.success("Pipeline orchestration reset to factory defaults.");
  };

  const profileTypeColors: Record<string, string> = {
    "legacy-v2": "#6B7280",
    "legacy-v3": "#0EA5E9",
    "locked": "#10B981",
    "hybrid": "#6366F1",
    "custom": "#F59E0B",
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2">
            <Icon name="Workflow" className="w-6 h-6 text-brand" /> Pipeline Profiles
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Select a predefined orchestration strategy or create a custom profile. The Supervisor Agent loads the selected profile at runtime and builds the execution plan dynamically.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleReset} className="gap-2 text-destructive hover:text-destructive">
            <Icon name="Trash2" className="w-4 h-4" /> Reset All
          </Button>
          <Button onClick={handleCreateCustom} className="bg-brand hover:bg-brand-dark text-white gap-2">
            <Icon name="Plus" className="w-4 h-4" /> Create Custom
          </Button>
        </div>
      </div>

      {/* Profile cards */}
      <div className="grid gap-4 md:grid-cols-2">
        {profiles.map((profile) => (
          <Card
            key={profile.id}
            className={`cursor-pointer transition-all hover:shadow-premium ${
              selectedProfileId === profile.id ? "ring-2 ring-brand border-brand" : ""
            }`}
            onClick={() => handleSelect(profile.id)}
          >
            <CardHeader>
              <div className="flex items-start justify-between">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    {profile.name}
                    {selectedProfileId === profile.id && (
                      <Badge variant="brand" className="text-[10px]">ACTIVE</Badge>
                    )}
                    {profile.isDefault && (
                      <Badge variant="outline" className="text-[10px]">RECOMMENDED</Badge>
                    )}
                  </CardTitle>
                  <CardDescription className="mt-1">{profile.description}</CardDescription>
                </div>
                <div
                  className="w-3 h-3 rounded-full mt-1"
                  style={{ backgroundColor: profileTypeColors[profile.type] || "#6B7280" }}
                />
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="outline" className="text-[10px]">
                  {profile.useLockedPipeline ? "Locked Pipeline" : "Legacy Pipeline"}
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  V3: {profile.enableV3PostOptimization ? "ON" : "OFF"}
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  Regeneration: {profile.enableTargetedRegeneration ? "ON" : "OFF"}
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  Matching: {profile.matchingStrategy}
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  Retries: {profile.maxRetries}
                </Badge>
              </div>
              <div className="flex items-center justify-between pt-2">
                <span className="text-xs text-muted-foreground">
                  {profile.enabledAgents.length} agents · {profile.parallelGroups.length} stages
                </span>
                {!profile.isBuiltIn && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      setEditingProfile(profile);
                    }}
                    className="h-7 text-xs"
                  >
                    <Icon name="Pencil" className="w-3 h-3 mr-1" /> Edit
                  </Button>
                )}
                {!profile.isBuiltIn && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeProfile(profile.id);
                      toast.success("Custom profile removed.");
                    }}
                    className="h-7 text-xs text-destructive hover:text-destructive"
                  >
                    <Icon name="Trash2" className="w-3 h-3" />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Edit modal for custom profiles */}
      {editingProfile && (
        <Card className="border-brand">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Icon name="Pencil" className="w-4 h-4 text-brand" /> Edit: {editingProfile.name}
            </CardTitle>
            <CardDescription>Configure the custom pipeline profile.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label>Profile Name</Label>
                <Input
                  value={editingProfile.name}
                  onChange={(e) => setEditingProfile({ ...editingProfile, name: e.target.value })}
                  className="mt-1"
                />
              </div>
              <div>
                <Label>Description</Label>
                <Input
                  value={editingProfile.description}
                  onChange={(e) => setEditingProfile({ ...editingProfile, description: e.target.value })}
                  className="mt-1"
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Use Locked Pipeline</Label>
                  <p className="text-xs text-muted-foreground">Bullet-only optimizer + Resume Assembler. LLM cannot generate full resume.</p>
                </div>
                <Switch
                  checked={editingProfile.useLockedPipeline}
                  onCheckedChange={(v) => setEditingProfile({ ...editingProfile, useLockedPipeline: v })}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label>Enable V3 Post-Optimization</Label>
                  <p className="text-xs text-muted-foreground">Keyword Embedding, Fact Verification, Layout Optimization agents.</p>
                </div>
                <Switch
                  checked={editingProfile.enableV3PostOptimization}
                  onCheckedChange={(v) => setEditingProfile({ ...editingProfile, enableV3PostOptimization: v })}
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <Label>Enable Targeted Regeneration</Label>
                  <p className="text-xs text-muted-foreground">Re-run only failed sections instead of the entire resume.</p>
                </div>
                <Switch
                  checked={editingProfile.enableTargetedRegeneration}
                  onCheckedChange={(v) => setEditingProfile({ ...editingProfile, enableTargetedRegeneration: v })}
                />
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <Label>Matching Strategy</Label>
                <select
                  value={editingProfile.matchingStrategy}
                  onChange={(e) => setEditingProfile({ ...editingProfile, matchingStrategy: e.target.value as any })}
                  className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm mt-1"
                >
                  <option value="strict">Strict (ID only)</option>
                  <option value="hybrid">Hybrid (ID → fingerprint → title/company)</option>
                  <option value="fuzzy">Fuzzy (includes index fallback)</option>
                </select>
              </div>
              <div>
                <Label>Hybrid Matching Threshold: {editingProfile.hybridMatchingThreshold}</Label>
                <input
                  type="range"
                  min={50}
                  max={100}
                  step={5}
                  value={editingProfile.hybridMatchingThreshold}
                  onChange={(e) => setEditingProfile({ ...editingProfile, hybridMatchingThreshold: parseInt(e.target.value) })}
                  className="w-full mt-3"
                />
              </div>
            </div>

            <div>
              <Label>Max Retries: {editingProfile.maxRetries}</Label>
              <input
                type="range"
                min={1}
                max={6}
                step={1}
                value={editingProfile.maxRetries}
                onChange={(e) => setEditingProfile({ ...editingProfile, maxRetries: parseInt(e.target.value) })}
                className="w-full mt-2"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setEditingProfile(null)}>Cancel</Button>
              <Button onClick={handleSaveEdit} className="bg-brand hover:bg-brand-dark text-white gap-2">
                <Icon name="Save" className="w-4 h-4" /> Save Profile
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Info card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Icon name="Info" className="w-4 h-4 text-brand" /> How Profiles Work</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>1. The Supervisor Agent loads the selected profile at the start of each pipeline run.</p>
          <p>2. The profile determines: which agents run, in what order, which providers/models they use, and what quality gates are enforced.</p>
          <p>3. Built-in profiles (Legacy V2, Legacy V3, Locked, Hybrid) are read-only but can be cloned to create custom profiles.</p>
          <p>4. Custom profiles are fully editable and persisted to D1.</p>
          <p>5. Changes take effect immediately — no restart required. All pipelines, routes, and agents use the selected profile.</p>
          <p>6. Per-agent configuration (provider, model, temperature, prompts, retry, fallback) is available in the Agent Configuration Center.</p>
        </CardContent>
      </Card>
    </div>
  );
}
