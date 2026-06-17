"use client";

import { useState, useRef } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, Icon } from "@/components/shared";
import { useApp, uid } from "@/lib/store";
import { parseResumeFile, blankResume } from "@/lib/parser";
import { toast } from "sonner";
import type { ResumeData } from "@/lib/types";

export function MyResumes() {
  const resumes = useApp((s) => s.resumes);
  const addResume = useApp((s) => s.addResume);
  const removeResume = useApp((s) => s.removeResume);
  const setActiveResume = useApp((s) => s.setActiveResume);
  const setView = useApp((s) => s.setView);
  const incUsage = useApp((s) => s.incUsage);
  const log = useApp((s) => s.log);

  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const onFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    const file = files[0];
    if (file.size > 20 * 1024 * 1024) {
      toast.error("File too large. Maximum 20MB.");
      return;
    }
    setUploading(true);
    try {
      const parsed = await parseResumeFile(file);
      addResume(parsed);
      incUsage("resumesGenerated");
      log({ actor: "you", action: `Uploaded resume: ${file.name}`, category: "resume", details: `${parsed.experience.length} experiences parsed`, severity: "info" });
      toast.success(`Parsed ${file.name}. ${parsed.experience.length} experiences, ${parsed.skills.length} skills extracted.`);
      setActiveResume(parsed.id);
      setView("builder");
    } catch (e: any) {
      toast.error(e?.message || "Failed to parse file.");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const startBlank = () => {
    const r = blankResume();
    addResume(r);
    setActiveResume(r.id);
    setView("builder");
    toast.success("Started a new resume from scratch.");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2">
            <Icon name="FileText" className="w-6 h-6 text-brand" /> My Resumes
          </h1>
          <p className="text-sm text-muted-foreground mt-1">Upload an existing resume or start from a template. All parsing happens in your browser.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={startBlank} className="gap-2">
            <Icon name="Plus" className="w-4 h-4" /> Blank resume
          </Button>
          <Button onClick={() => fileRef.current?.click()} className="bg-brand hover:bg-brand-dark text-white gap-2">
            <Icon name="Upload" className="w-4 h-4" /> Upload resume
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".pdf,.doc,.docx,.txt"
            className="hidden"
            onChange={(e) => onFiles(e.target.files)}
          />
        </div>
      </div>

      {/* Upload dropzone */}
      <Card>
        <CardContent className="p-0">
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); onFiles(e.dataTransfer.files); }}
            onClick={() => fileRef.current?.click()}
            className={`rounded-xl border-2 border-dashed m-4 p-10 text-center cursor-pointer transition ${dragOver ? "border-brand bg-brand-light/40" : "border-border hover:border-brand/50 hover:bg-secondary/40"}`}
          >
            {uploading ? (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-3">
                <Icon name="Loader2" className="w-10 h-10 text-brand animate-spin" />
                <div className="font-medium">Parsing your resume…</div>
                <div className="text-xs text-muted-foreground">Extracting text, contacts, experience, skills, education</div>
              </motion.div>
            ) : (
              <div className="flex flex-col items-center gap-3">
                <div className="w-14 h-14 rounded-2xl gradient-brand text-white flex items-center justify-center shadow-glow">
                  <Icon name="Upload" className="w-6 h-6" />
                </div>
                <div className="font-semibold">Drop your resume here, or click to browse</div>
                <div className="text-xs text-muted-foreground">Supports PDF, DOC, DOCX, TXT — up to 20 MB</div>
                <div className="flex gap-2 mt-2">
                  <Badge variant="brand"><Icon name="ShieldCheck" className="w-3 h-3" /> Parsed in-browser</Badge>
                  <Badge variant="gold"><Icon name="Lock" className="w-3 h-3" /> Never uploaded to a server</Badge>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Resumes list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">All resumes ({resumes.length})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {resumes.map((r) => (
              <div key={r.id} className="rounded-xl border border-border bg-card p-4 hover:shadow-premium transition">
                <div className="flex items-start justify-between mb-2">
                  <div className="min-w-0">
                    <div className="font-semibold truncate">{r.name}</div>
                    {r.headline && <div className="text-xs text-muted-foreground truncate">{r.headline}</div>}
                  </div>
                  <Badge variant={r.source === "upload" ? "brand" : "outline"} className="text-[10px] capitalize shrink-0 ml-2">
                    {r.source?.replace("-", " ")}
                  </Badge>
                </div>
                <div className="grid grid-cols-3 gap-2 my-3 text-center">
                  <div className="rounded-lg bg-secondary p-2">
                    <div className="text-sm font-bold">{r.experience.length}</div>
                    <div className="text-[10px] text-muted-foreground">Jobs</div>
                  </div>
                  <div className="rounded-lg bg-secondary p-2">
                    <div className="text-sm font-bold">{r.skills.length}</div>
                    <div className="text-[10px] text-muted-foreground">Skills</div>
                  </div>
                  <div className="rounded-lg bg-secondary p-2">
                    <div className="text-sm font-bold">{r.education.length}</div>
                    <div className="text-[10px] text-muted-foreground">Edu</div>
                  </div>
                </div>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => { setActiveResume(r.id); setView("builder"); }}>
                    <Icon name="Pencil" className="w-3.5 h-3.5 mr-1" /> Edit
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => { setActiveResume(r.id); setView("ats-checker"); }}>
                    <Icon name="ScanText" className="w-3.5 h-3.5" />
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={() => { removeResume(r.id); toast.success("Resume deleted"); }}>
                    <Icon name="Trash2" className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
            {resumes.length === 0 && (
              <div className="col-span-full text-center py-8">
                <Icon name="FileText" className="w-10 h-10 text-muted-foreground/40 mx-auto" />
                <p className="text-sm text-muted-foreground mt-2">No resumes yet. Upload one above or start from blank.</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
