// ResumeAI Pro — Batch Resume Optimizer
// Upload up to 10 resume files, pick a target JD, and process them all sequentially.
// Each file is parsed → optimized → saved to library. Finished batch exports as a ZIP.

"use client";

import { useState, useRef, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge, Icon } from "@/components/shared";
import { useApp, uid } from "@/lib/store";
import { callAI, extractJSON } from "@/lib/ai";
import { parseResumeFile } from "@/lib/parser";
import { toast } from "sonner";
import type { ResumeData } from "@/lib/types";

// ============================================================================
// Types
// ============================================================================

type ItemStatus =
  | "pending"
  | "parsing"
  | "optimizing"
  | "done"
  | "failed";

interface BatchItem {
  id: string;
  file: File;
  status: ItemStatus;
  statusLabel: string;
  error?: string;
  optimizedResume?: ResumeData;
}

// ============================================================================
// Helpers
// ============================================================================

/** Trigger a browser download for an arbitrary blob. */
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Build a simple ZIP archive entirely in-browser with no external dependencies.
 * Implements the ZIP local-file-header + central-directory format (ZIP32).
 * Supports only STORE method (no compression) which is sufficient for PDFs / text blobs.
 */
async function buildZip(entries: { name: string; data: Uint8Array }[]): Promise<Blob> {
  const enc = new TextEncoder();

  function u16(n: number) {
    const buf = new Uint8Array(2);
    buf[0] = n & 0xff;
    buf[1] = (n >> 8) & 0xff;
    return buf;
  }
  function u32(n: number) {
    const buf = new Uint8Array(4);
    buf[0] = n & 0xff;
    buf[1] = (n >> 8) & 0xff;
    buf[2] = (n >> 16) & 0xff;
    buf[3] = (n >> 24) & 0xff;
    return buf;
  }

  /** CRC-32 via lookup table */
  function crc32(data: Uint8Array): number {
    const table = (() => {
      const t = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        t[i] = c;
      }
      return t;
    })();
    let crc = 0xffffffff;
    for (const byte of data) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  function concat(...arrays: Uint8Array[]): Uint8Array {
    const total = arrays.reduce((s, a) => s + a.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const a of arrays) { out.set(a, offset); offset += a.length; }
    return out;
  }

  const localHeaders: Uint8Array[] = [];
  const centralHeaders: Uint8Array[] = [];
  let offset = 0;

  const modDate = new Date();
  const dosTime = (modDate.getHours() << 11) | (modDate.getMinutes() << 5) | Math.floor(modDate.getSeconds() / 2);
  const dosDate = ((modDate.getFullYear() - 1980) << 9) | ((modDate.getMonth() + 1) << 5) | modDate.getDate();

  for (const entry of entries) {
    const nameBytes = enc.encode(entry.name);
    const crc = crc32(entry.data);
    const size = entry.data.length;

    // Local file header (signature 0x04034b50)
    const local = concat(
      new Uint8Array([0x50, 0x4b, 0x03, 0x04]), // signature
      u16(20),           // version needed
      u16(0),            // general purpose bit flag
      u16(0),            // compression method: STORE
      u16(dosTime),
      u16(dosDate),
      u32(crc),
      u32(size),         // compressed size
      u32(size),         // uncompressed size
      u16(nameBytes.length),
      u16(0),            // extra field length
      nameBytes,
      entry.data,
    );
    localHeaders.push(local);

    // Central directory header (signature 0x02014b50)
    const central = concat(
      new Uint8Array([0x50, 0x4b, 0x01, 0x02]), // signature
      u16(20),           // version made by
      u16(20),           // version needed
      u16(0),
      u16(0),            // STORE
      u16(dosTime),
      u16(dosDate),
      u32(crc),
      u32(size),
      u32(size),
      u16(nameBytes.length),
      u16(0),            // extra length
      u16(0),            // comment length
      u16(0),            // disk number start
      u16(0),            // internal attrs
      u32(0),            // external attrs
      u32(offset),       // relative offset of local header
      nameBytes,
    );
    centralHeaders.push(central);
    offset += local.length;
  }

  const centralDir = concat(...centralHeaders);
  const centralSize = centralDir.length;
  const centralOffset = offset;

  // End of central directory (signature 0x06054b50)
  const eocd = concat(
    new Uint8Array([0x50, 0x4b, 0x05, 0x06]),
    u16(0),              // disk number
    u16(0),              // disk with central dir
    u16(entries.length),
    u16(entries.length),
    u32(centralSize),
    u32(centralOffset),
    u16(0),              // comment length
  );

  const full = concat(...localHeaders, centralDir, eocd);
  return new Blob([full], { type: "application/zip" });
}

/** Convert a ResumeData object to a human-readable plain-text resume */
function resumeToText(r: ResumeData): string {
  const lines: string[] = [];
  lines.push(r.name || "Resume");
  if (r.headline) lines.push(r.headline);
  if (r.email || r.phone || r.location) {
    lines.push([r.email, r.phone, r.location].filter(Boolean).join(" · "));
  }
  if (r.linkedin || r.website) {
    lines.push([r.linkedin, r.website].filter(Boolean).join(" · "));
  }
  lines.push("");

  if (r.summary) {
    lines.push("PROFESSIONAL SUMMARY");
    lines.push("─".repeat(40));
    lines.push(r.summary);
    lines.push("");
  }

  if (r.experience?.length) {
    lines.push("EXPERIENCE");
    lines.push("─".repeat(40));
    for (const exp of r.experience) {
      lines.push(`${exp.title} — ${exp.company}${exp.location ? `, ${exp.location}` : ""}`);
      lines.push(`${exp.startDate} – ${exp.endDate || "Present"}`);
      for (const b of exp.bullets ?? []) lines.push(`• ${b}`);
      lines.push("");
    }
  }

  if (r.education?.length) {
    lines.push("EDUCATION");
    lines.push("─".repeat(40));
    for (const edu of r.education) {
      lines.push(`${edu.degree}${edu.field ? ` in ${edu.field}` : ""} — ${edu.school}`);
      if (edu.startDate || edu.endDate) lines.push(`${edu.startDate ?? ""} – ${edu.endDate ?? "Present"}`);
      lines.push("");
    }
  }

  if (r.skills?.length) {
    lines.push("SKILLS");
    lines.push("─".repeat(40));
    lines.push(r.skills.map((s) => s.name).join(", "));
    lines.push("");
  }

  if (r.certifications?.length) {
    lines.push("CERTIFICATIONS");
    lines.push("─".repeat(40));
    for (const c of r.certifications) {
      lines.push(`${c.name}${c.issuer ? ` — ${c.issuer}` : ""}${c.date ? ` (${c.date})` : ""}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

// ============================================================================
// Status badge helper
// ============================================================================

const STATUS_CONFIG: Record<ItemStatus, { label: string; variant: "default" | "secondary" | "warning" | "success" | "destructive"; icon: string }> = {
  pending: { label: "Pending", variant: "secondary", icon: "Clock" },
  parsing: { label: "Parsing…", variant: "warning", icon: "Loader2" },
  optimizing: { label: "Optimizing…", variant: "warning", icon: "Loader2" },
  done: { label: "Done", variant: "success", icon: "CheckCircle2" },
  failed: { label: "Failed", variant: "destructive", icon: "XCircle" },
};

// ============================================================================
// Main Component
// ============================================================================

export function BatchOptimizer() {
  const addResume = useApp((s) => s.addResume);
  const incUsage = useApp((s) => s.incUsage);
  const log = useApp((s) => s.log);

  const [items, setItems] = useState<BatchItem[]>([]);
  const [jdText, setJdText] = useState("");
  const [running, setRunning] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ---------- File management ----------

  const addFiles = useCallback((files: FileList | File[]) => {
    const accepted = Array.from(files).filter((f) => {
      const ext = f.name.split(".").pop()?.toLowerCase();
      return ext === "pdf" || ext === "docx";
    });
    if (accepted.length === 0) {
      toast.error("Only PDF and DOCX files are supported.");
      return;
    }
    setItems((prev) => {
      const remaining = 10 - prev.length;
      if (remaining <= 0) { toast.error("Maximum 10 files per batch."); return prev; }
      const toAdd = accepted.slice(0, remaining).map((f) => ({
        id: uid("bi"),
        file: f,
        status: "pending" as ItemStatus,
        statusLabel: "Pending",
      }));
      if (accepted.length > remaining) toast.warning(`Only ${remaining} slot(s) remaining — added first ${remaining} file(s).`);
      return [...prev, ...toAdd];
    });
  }, []);

  const removeItem = (id: string) => {
    if (running) return;
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  // ---------- Drag & drop ----------

  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const onDragLeave = () => setIsDragging(false);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    addFiles(e.dataTransfer.files);
  };

  // ---------- Update a single item (functional update) ----------

  const patchItem = (id: string, patch: Partial<BatchItem>) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  // ---------- Process one resume ----------

  const processOne = async (item: BatchItem, jd: string): Promise<ResumeData | null> => {
    try {
      // Step 1 – Parse
      patchItem(item.id, { status: "parsing", statusLabel: "Parsing file…" });
      const parsed = await parseResumeFile(item.file);

      // Step 2 – Optimize via AI
      patchItem(item.id, { status: "optimizing", statusLabel: "Optimizing with AI…" });

      const optResult = await callAI({
        systemPrompt:
          "You are a Senior ATS Optimization Expert. Optimize the resume for the job description below. " +
          "Return ONLY valid JSON with fields: name, headline, summary, skills (array of {name, category}), " +
          "experience (array of {title, company, location, startDate, endDate, bullets[]}). " +
          "NEVER fabricate experience. Improve bullets and keywords to match the JD.",
        userPrompt:
          `SOURCE RESUME:\n${JSON.stringify({
            name: parsed.name,
            headline: parsed.headline,
            summary: parsed.summary,
            experience: parsed.experience?.map((e) => ({ title: e.title, company: e.company, bullets: e.bullets })),
            skills: parsed.skills?.map((s) => s.name),
          })}\n\nTARGET JOB DESCRIPTION:\n${jd.slice(0, 2500)}\n\nReturn JSON only.`,
        maxTokens: 3000,
        temperature: 0.35,
        taskCategory: "document",
      });

      let optData: any;
      try { optData = extractJSON<any>(optResult.text); }
      catch { throw new Error("AI returned invalid JSON — could not parse optimization result."); }

      const optimized: ResumeData = {
        ...parsed,
        id: uid("r"),
        headline: optData.headline || parsed.headline,
        summary: optData.summary || parsed.summary,
        skills: (optData.skills ?? []).map((s: any) =>
          typeof s === "string" ? { id: uid("s"), name: s, category: "Skills" } : { id: uid("s"), ...s }
        ),
        experience: (optData.experience ?? []).map((e: any) => ({
          id: uid("e"),
          title: e.title || "",
          company: e.company || "",
          location: e.location || "",
          startDate: e.startDate || "",
          endDate: e.endDate || "Present",
          bullets: e.bullets ?? [],
        })),
        template: parsed.template || "ats-professional",
        source: "ai-optimized",
        fileName: `Optimized_${item.file.name}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Save to library
      addResume(optimized);
      incUsage("resumesGenerated");
      log({
        actor: "you",
        action: `Batch Optimizer: processed ${item.file.name}`,
        category: "ai",
        details: `Provider: ${optResult.provider}`,
        severity: "info",
      });

      patchItem(item.id, { status: "done", statusLabel: "Done", optimizedResume: optimized });
      return optimized;
    } catch (err: any) {
      patchItem(item.id, {
        status: "failed",
        statusLabel: "Failed",
        error: err?.message || "Unknown error",
      });
      return null;
    }
  };

  // ---------- Run all sequentially ----------

  const runAll = async () => {
    if (items.length === 0) { toast.error("Add at least one resume file."); return; }
    if (!jdText.trim() || jdText.trim().length < 50) {
      toast.error("Paste a full job description (min 50 characters)."); return;
    }
    setRunning(true);

    const toProcess = items.filter((i) => i.status !== "done");
    for (const item of toProcess) {
      await processOne(item, jdText);
    }

    const doneCount = items.filter((i) => i.status === "done").length +
      toProcess.filter((i) => i.status === "done").length;

    toast.success(`Batch complete — ${doneCount} resume(s) optimized and saved to library.`);
    setRunning(false);
  };

  // ---------- ZIP download ----------

  const downloadZip = async () => {
    const ready = items.filter((i) => i.status === "done" && i.optimizedResume);
    if (ready.length === 0) { toast.error("No completed resumes to download."); return; }
    toast.info("Building ZIP archive…");

    const enc = new TextEncoder();
    const entries = ready.map((item) => ({
      name: `Optimized_${item.file.name.replace(/\.(pdf|docx)$/i, "")}.txt`,
      data: enc.encode(resumeToText(item.optimizedResume!)),
    }));

    const zip = await buildZip(entries);
    downloadBlob(zip, `BatchOptimized_Resumes_${new Date().toISOString().split("T")[0]}.zip`);
    incUsage("downloads");
    toast.success(`Downloaded ZIP with ${entries.length} resume(s).`);
  };

  // ---------- Stats ----------

  const doneCount = items.filter((i) => i.status === "done").length;
  const failedCount = items.filter((i) => i.status === "failed").length;
  const pendingCount = items.filter((i) => i.status === "pending").length;

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div className="space-y-6 p-6 max-w-5xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Batch Resume Optimizer</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Upload up to 10 resumes, provide a target job description, and let AI optimize them all — one by one. Completed resumes save automatically to your library.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* ── Left: File upload + queue ── */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Icon name="FileStack" className="w-4 h-4 text-brand" />
                Resume Files
                <Badge variant="secondary" className="ml-auto">{items.length} / 10</Badge>
              </CardTitle>
              <CardDescription>PDF or DOCX — up to 10 files, max 5 MB each.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Drop zone */}
              <div
                className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                  isDragging
                    ? "border-brand bg-brand/5"
                    : "border-border hover:border-brand/50 hover:bg-muted/30"
                }`}
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                onClick={() => !running && fileInputRef.current?.click()}
              >
                <Icon
                  name="UploadCloud"
                  className={`w-8 h-8 mx-auto mb-2 ${isDragging ? "text-brand" : "text-muted-foreground"}`}
                />
                <p className="text-sm font-medium">
                  {isDragging ? "Drop files here" : "Drag & drop resumes here"}
                </p>
                <p className="text-xs text-muted-foreground mt-1">or click to browse</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx"
                  multiple
                  className="hidden"
                  disabled={running}
                  onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }}
                />
              </div>

              {/* File queue */}
              {items.length > 0 && (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {items.map((item) => {
                    const cfg = STATUS_CONFIG[item.status];
                    return (
                      <div
                        key={item.id}
                        className="flex items-center gap-2 rounded-lg border border-border bg-secondary/30 px-3 py-2 text-sm"
                      >
                        <Icon
                          name={cfg.icon}
                          className={`w-3.5 h-3.5 shrink-0 ${
                            item.status === "parsing" || item.status === "optimizing"
                              ? "animate-spin text-brand"
                              : item.status === "done"
                              ? "text-green-500"
                              : item.status === "failed"
                              ? "text-destructive"
                              : "text-muted-foreground"
                          }`}
                        />
                        <span className="truncate flex-1 font-medium text-foreground/90">
                          {item.file.name}
                        </span>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {item.statusLabel}
                        </span>
                        {!running && item.status !== "optimizing" && item.status !== "parsing" && (
                          <button
                            onClick={() => removeItem(item.id)}
                            className="shrink-0 text-muted-foreground hover:text-destructive transition-colors"
                            aria-label={`Remove ${item.file.name}`}
                          >
                            <Icon name="X" className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {item.status === "failed" && item.error && (
                          <span className="text-xs text-destructive truncate max-w-[120px]" title={item.error}>
                            {item.error}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {items.length === 0 && (
                <p className="text-center text-sm text-muted-foreground py-2">
                  No files added yet.
                </p>
              )}
            </CardContent>
          </Card>

          {/* Stats row */}
          {items.length > 0 && (
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-lg border border-border bg-secondary/30 p-3 text-center">
                <div className="text-xl font-bold text-green-500">{doneCount}</div>
                <div className="text-xs text-muted-foreground">Completed</div>
              </div>
              <div className="rounded-lg border border-border bg-secondary/30 p-3 text-center">
                <div className="text-xl font-bold text-muted-foreground">{pendingCount}</div>
                <div className="text-xs text-muted-foreground">Pending</div>
              </div>
              <div className="rounded-lg border border-border bg-secondary/30 p-3 text-center">
                <div className="text-xl font-bold text-destructive">{failedCount}</div>
                <div className="text-xs text-muted-foreground">Failed</div>
              </div>
            </div>
          )}
        </div>

        {/* ── Right: JD input + actions ── */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Icon name="FileText" className="w-4 h-4 text-brand" />
                Target Job Description
              </CardTitle>
              <CardDescription>Paste the full JD. All resumes will be optimized against this role.</CardDescription>
            </CardHeader>
            <CardContent>
              <Label htmlFor="batch-jd" className="sr-only">Job Description</Label>
              <Textarea
                id="batch-jd"
                placeholder="Paste the complete job description here…&#10;&#10;We're looking for a Senior Software Engineer…"
                className="min-h-[240px] font-mono text-xs resize-y"
                value={jdText}
                onChange={(e) => setJdText(e.target.value)}
                disabled={running}
              />
              <div className="flex items-center justify-between mt-2">
                <span className="text-xs text-muted-foreground">{jdText.trim().length} chars</span>
                {jdText.trim().length > 0 && (
                  <button
                    onClick={() => setJdText("")}
                    className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    disabled={running}
                  >
                    Clear
                  </button>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Action buttons */}
          <div className="space-y-2">
            <Button
              id="batch-optimizer-run"
              className="w-full"
              disabled={running || items.length === 0}
              onClick={runAll}
            >
              {running ? (
                <>
                  <Icon name="Loader2" className="w-4 h-4 mr-2 animate-spin" />
                  Processing…
                </>
              ) : (
                <>
                  <Icon name="Wand2" className="w-4 h-4 mr-2" />
                  Optimize All ({items.filter((i) => i.status !== "done").length} remaining)
                </>
              )}
            </Button>

            <Button
              id="batch-optimizer-download"
              variant="outline"
              className="w-full"
              disabled={running || doneCount === 0}
              onClick={downloadZip}
            >
              <Icon name="Archive" className="w-4 h-4 mr-2" />
              Download All as ZIP ({doneCount} ready)
            </Button>

            {!running && items.length > 0 && (
              <Button
                variant="ghost"
                className="w-full text-muted-foreground"
                onClick={() => {
                  setItems([]);
                  setJdText("");
                }}
              >
                <Icon name="Trash2" className="w-4 h-4 mr-2" />
                Clear All
              </Button>
            )}
          </div>

          {/* Tips */}
          <Card className="bg-muted/30 border-dashed">
            <CardContent className="pt-4 space-y-2 text-xs text-muted-foreground">
              <p className="flex items-start gap-2">
                <Icon name="Info" className="w-3.5 h-3.5 mt-0.5 shrink-0 text-brand" />
                Resumes are processed one at a time to avoid API rate limits.
              </p>
              <p className="flex items-start gap-2">
                <Icon name="CheckCircle2" className="w-3.5 h-3.5 mt-0.5 shrink-0 text-green-500" />
                Only successfully optimized resumes are saved to your library.
              </p>
              <p className="flex items-start gap-2">
                <Icon name="Archive" className="w-3.5 h-3.5 mt-0.5 shrink-0 text-brand" />
                The ZIP download bundles all completed resumes as formatted text files.
              </p>
              <p className="flex items-start gap-2">
                <Icon name="RefreshCw" className="w-3.5 h-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                Failed items can be retried — just click Optimize All again.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
