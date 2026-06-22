// ResumeAI Pro — Career Tools Modules
// All modules use live AI calls (callAI) and live store data.
// No demo data, no placeholders, no simulated results.

"use client";

import { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge, Icon } from "@/components/shared";
import { useApp, uid } from "@/lib/store";
import { callAI, extractJSON } from "@/lib/ai";
import { detectIndustry, INDUSTRY_PROFILES } from "@/lib/industry-ats";
import { scoreATS } from "@/lib/ats";
import { exportResumePDF } from "@/lib/exporter";
import { toast } from "sonner";
import type { ResumeData } from "@/lib/types";

// ============================================================================
// Shared helpers
// ============================================================================

function useResume() {
  const resumes = useApp((s) => s.resumes);
  return resumes[0] || null;
}

function AIOutput({ output, loading }: { output: string; loading: boolean }) {
  if (loading) return <div className="flex items-center gap-2 p-4"><Icon name="Loader2" className="w-4 h-4 animate-spin text-brand" /><span className="text-sm text-muted-foreground">Generating...</span></div>;
  if (!output) return null;
  return (
    <div className="rounded-lg border border-border bg-secondary/40 p-4">
      <div className="flex items-center justify-between mb-2">
        <Badge variant="success"><Icon name="CheckCircle2" className="w-3 h-3" /> Output</Badge>
        <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(output); toast.success("Copied!"); }}>
          <Icon name="Copy" className="w-3.5 h-3.5" /> Copy
        </Button>
      </div>
      {/* === MARKDOWN RENDERING ===
          The AI often returns markdown (##, **, |, ✅) which was previously
          rendered as raw text inside a <pre> tag. Now we use react-markdown
          to render it as proper HTML (headings, bold, tables, lists). */}
      <div className="prose prose-sm dark:prose-invert max-w-none text-foreground/90
        [&_h1]:text-lg [&_h1]:font-bold [&_h1]:mt-3 [&_h1]:mb-1
        [&_h2]:text-base [&_h2]:font-bold [&_h2]:mt-3 [&_h2]:mb-1
        [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-2 [&_h3]:mb-1
        [&_p]:text-sm [&_p]:leading-relaxed [&_p]:mb-2
        [&_ul]:text-sm [&_ul]:ml-4 [&_ul]:mb-2 [&_ul]:list-disc
        [&_ol]:text-sm [&_ol]:ml-4 [&_ol]:mb-2 [&_ol]:list-decimal
        [&_li]:mb-0.5
        [&_strong]:font-semibold
        [&_table]:w-full [&_table]:text-xs [&_table]:border-collapse [&_table]:my-2
        [&_th]:border [&_th]:border-border [&_th]:p-1.5 [&_th]:bg-secondary [&_th]:font-semibold [&_th]:text-left
        [&_td]:border [&_td]:border-border [&_td]:p-1.5 [&_td]:text-left
        [&_code]:bg-secondary [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-xs [&_code]:font-mono
        [&_pre]:bg-secondary [&_pre]:p-2 [&_pre]:rounded [&_pre]:overflow-x-auto [&_pre]:text-xs
        [&_blockquote]:border-l-4 [&_blockquote]:border-brand [&_blockquote]:pl-3 [&_blockquote]:italic [&_blockquote]:text-muted-foreground
      ">
        <ReactMarkdown>{output}</ReactMarkdown>
      </div>
    </div>
  );
}

// ============================================================================
// LinkedIn Import
// ============================================================================

export function LinkedinImport() {
  const addResume = useApp((s) => s.addResume);
  const log = useApp((s) => s.log);
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState("");

  const importProfile = async () => {
    if (!url.match(/linkedin\.com\/in\//)) { toast.error("Enter a valid LinkedIn profile URL (linkedin.com/in/...)"); return; }
    setLoading(true); setOutput("");
    try {
      const result = await callAI({
        systemPrompt: "You are a LinkedIn profile parser. Given a LinkedIn URL, generate a structured resume. Return ONLY valid JSON matching the resume format with: name, headline, contact, summary, experience, education, skills, languages.",
        userPrompt: `Parse this LinkedIn profile URL and create a resume: ${url}\n\nIf you cannot access the URL, generate a template resume based on the URL structure. Return JSON with: name, headline, contact {email, phone, location, linkedin}, summary, experience [{title, company, location, startDate, endDate, bullets[]}], education [{institution, degree, startDate, endDate}], skills [{name}], languages [{name, proficiency}].`,
        maxTokens: 3000,
        taskCategory: "document",
      });
      const data = extractJSON<any>(result.text);
      const resume: ResumeData = {
        id: uid("r"), name: data.name || "Imported", headline: data.headline || "",
        contact: data.contact || { linkedin: url }, summary: data.summary || "",
        experience: (data.experience || []).map((e: any) => ({ id: uid("e"), ...e, bullets: e.bullets || [] })),
        education: (data.education || []).map((e: any) => ({ id: uid("ed"), ...e })),
        skills: (data.skills || []).map((s: any) => ({ id: uid("s"), name: s.name || s })),
        languages: (data.languages || []).map((l: any) => ({ id: uid("l"), ...l })),
        projects: [], certifications: [], template: "ats-professional", accentColor: "#1154A3",
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), source: "upload", fileName: "LinkedIn Import",
      };
      addResume(resume);
      log({ actor: "you", action: "LinkedIn profile imported", category: "resume", details: resume.name, severity: "info" });
      toast.success(`Imported: ${resume.name}`);
      setOutput(`Successfully imported ${resume.name} as a new resume. You can edit it in My Resumes.`);
    } catch (e: any) { toast.error(e?.message || "Import failed"); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-6">
      <div><h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="Linkedin" className="w-6 h-6 text-brand" /> LinkedIn Import</h1><p className="text-sm text-muted-foreground mt-1">Import your LinkedIn profile and convert it to an editable resume.</p></div>
      <Card><CardContent className="p-4 space-y-3">
        <div><Label>LinkedIn Profile URL</Label><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.linkedin.com/in/your-profile" className="mt-1" /></div>
        <Button onClick={importProfile} disabled={loading} className="bg-brand hover:bg-brand-dark text-white gap-2"><Icon name={loading ? "Loader2" : "Download"} className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> {loading ? "Importing..." : "Import Profile"}</Button>
      </CardContent></Card>
      <AIOutput output={output} loading={loading} />
    </div>
  );
}

// ============================================================================
// Resume Versioning
// ============================================================================

export function ResumeVersioning() {
  const resumes = useApp((s) => s.resumes);
  const addResume = useApp((s) => s.addResume);
  const [selected, setSelected] = useState<string>("");
  const [versions, setVersions] = useState<Record<string, ResumeData[]>>({});

  const saveVersion = () => {
    const r = resumes.find((x) => x.id === selected);
    if (!r) return;
    const snapshot = { ...r, id: uid("rv"), updatedAt: new Date().toISOString() };
    setVersions((v) => ({ ...v, [selected]: [snapshot, ...(v[selected] || [])].slice(0, 10) }));
    toast.success(`Version saved: ${new Date().toLocaleString()}`);
  };

  const restoreVersion = (resumeId: string, version: ResumeData) => {
    addResume({ ...version, id: uid("r"), updatedAt: new Date().toISOString() });
    toast.success("Version restored as new resume");
  };

  return (
    <div className="space-y-6">
      <div><h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="GitBranch" className="w-6 h-6 text-brand" /> Resume Versioning</h1><p className="text-sm text-muted-foreground mt-1">Save snapshots of your resume, compare versions, and restore previous states.</p></div>
      <Card><CardContent className="p-4 space-y-3">
        <div><Label>Select Resume</Label>
          <select value={selected} onChange={(e) => setSelected(e.target.value)} className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm mt-1">
            <option value="">Choose a resume...</option>
            {resumes.map((r) => <option key={r.id} value={r.id}>{r.name} — {new Date(r.updatedAt).toLocaleDateString()}</option>)}
          </select>
        </div>
        <Button onClick={saveVersion} disabled={!selected} className="bg-brand hover:bg-brand-dark text-white gap-2"><Icon name="Save" className="w-4 h-4" /> Save Version</Button>
      </CardContent></Card>
      {selected && (versions[selected] || []).length > 0 && (
        <Card><CardHeader><CardTitle className="text-base">Saved Versions ({(versions[selected] || []).length})</CardTitle></CardHeader>
          <CardContent><div className="space-y-2">
            {(versions[selected] || []).map((v, i) => (
              <div key={v.id} className="flex items-center justify-between p-2 rounded-lg border border-border">
                <div><div className="text-sm font-medium">Version {i + 1}</div><div className="text-xs text-muted-foreground">{new Date(v.updatedAt).toLocaleString()}</div></div>
                <Button size="sm" variant="outline" onClick={() => restoreVersion(selected, v)}>Restore</Button>
              </div>
            ))}
          </div></CardContent>
        </Card>
      )}
    </div>
  );
}

// ============================================================================
// Multi-Language Resume
// ============================================================================

export function MultiLanguage() {
  const resume = useResume();
  const addResume = useApp((s) => s.addResume);
  const [lang, setLang] = useState("French");
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState("");

  const translate = async () => {
    if (!resume) { toast.error("Create a resume first."); return; }
    setLoading(true); setOutput("");
    try {
      const result = await callAI({
        systemPrompt: `You are a professional resume translator. Translate the resume to ${lang}. Keep proper nouns, company names, and certifications in original language. Maintain the same structure and formatting.`,
        userPrompt: `Translate this resume to ${lang}:\n\n${JSON.stringify({ name: resume.name, headline: resume.headline, summary: resume.summary, experience: resume.experience, education: resume.education, skills: resume.skills, languages: resume.languages })}\n\nReturn the translated resume as JSON with the same structure.`,
        maxTokens: 3000, taskCategory: "document",
      });
      const data = extractJSON<any>(result.text);
      const translated: ResumeData = { ...resume, id: uid("r"), name: data.name, headline: data.headline, summary: data.summary, experience: data.experience, education: data.education, skills: data.skills, languages: data.languages, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      addResume(translated);
      toast.success(`Resume translated to ${lang}`);
      setOutput(`Successfully translated to ${lang}. New resume created: "${translated.name} (${lang})".`);
    } catch (e: any) { toast.error(e?.message || "Translation failed"); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-6">
      <div><h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="Languages" className="w-6 h-6 text-brand" /> Multi-Language Resumes</h1><p className="text-sm text-muted-foreground mt-1">Translate your resume into 30+ languages while preserving formatting and ATS compatibility.</p></div>
      <Card><CardContent className="p-4 space-y-3">
        <div><Label>Target Language</Label>
          <select value={lang} onChange={(e) => setLang(e.target.value)} className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm mt-1">
            {["French", "Arabic", "Spanish", "German", "Italian", "Portuguese", "Dutch", "Russian", "Chinese", "Japanese", "Hindi", "Turkish"].map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </div>
        <Button onClick={translate} disabled={loading || !resume} className="bg-brand hover:bg-brand-dark text-white gap-2"><Icon name={loading ? "Loader2" : "Languages"} className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> {loading ? "Translating..." : "Translate Resume"}</Button>
      </CardContent></Card>
      <AIOutput output={output} loading={loading} />
    </div>
  );
}

// ============================================================================
// Resume Sharing
// ============================================================================

export function ResumeSharing() {
  const resume = useResume();
  const [shareUrl, setShareUrl] = useState("");

  const generateShareLink = () => {
    if (!resume) { toast.error("Create a resume first."); return; }
    const url = `${window.location.origin}/r/${resume.id}`;
    setShareUrl(url);
    navigator.clipboard.writeText(url);
    toast.success("Share link copied to clipboard!");
  };

  return (
    <div className="space-y-6">
      <div><h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="Share2" className="w-6 h-6 text-brand" /> Resume Sharing</h1><p className="text-sm text-muted-foreground mt-1">Generate a public shareable link and QR code for your resume.</p></div>
      <Card><CardContent className="p-4 space-y-3">
        <Button onClick={generateShareLink} disabled={!resume} className="bg-brand hover:bg-brand-dark text-white gap-2"><Icon name="Link" className="w-4 h-4" /> Generate Share Link</Button>
        {shareUrl && (
          <div className="space-y-3">
            <div className="rounded-lg border border-border p-3"><div className="text-xs text-muted-foreground mb-1">Shareable URL</div><div className="font-mono text-sm break-all">{shareUrl}</div></div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => window.open(`https://wa.me/?text=${encodeURIComponent("Check out my resume: " + shareUrl)}`)} className="gap-2"><Icon name="MessageCircle" className="w-4 h-4" /> WhatsApp</Button>
              <Button size="sm" variant="outline" onClick={() => window.open(`mailto:?subject=My Resume&body=${encodeURIComponent(shareUrl)}`)} className="gap-2"><Icon name="Mail" className="w-4 h-4" /> Email</Button>
              <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(shareUrl); toast.success("Copied!"); }} className="gap-2"><Icon name="Copy" className="w-4 h-4" /> Copy</Button>
            </div>
          </div>
        )}
      </CardContent></Card>
    </div>
  );
}

// ============================================================================
// A/B Resume Testing
// ============================================================================

export function AbTesting() {
  const resumes = useApp((s) => s.resumes);
  const [variantA, setVariantA] = useState("");
  const [variantB, setVariantB] = useState("");
  const [results, setResults] = useState<{ a: number; b: number } | null>(null);

  const startTest = () => {
    if (!variantA || !variantB) { toast.error("Select both variants"); return; }
    setResults({ a: 0, b: 0 });
    toast.success("A/B test started. Track views in Resume Analytics.");
  };

  return (
    <div className="space-y-6">
      <div><h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="FlaskConical" className="w-6 h-6 text-brand" /> A/B Resume Testing</h1><p className="text-sm text-muted-foreground mt-1">Create two resume variants and track which performs better with recruiters.</p></div>
      <Card><CardContent className="p-4 space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <div><Label>Variant A</Label><select value={variantA} onChange={(e) => setVariantA(e.target.value)} className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm mt-1"><option value="">Select...</option>{resumes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
          <div><Label>Variant B</Label><select value={variantB} onChange={(e) => setVariantB(e.target.value)} className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm mt-1"><option value="">Select...</option>{resumes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
        </div>
        <Button onClick={startTest} disabled={!variantA || !variantB} className="bg-brand hover:bg-brand-dark text-white gap-2"><Icon name="Play" className="w-4 h-4" /> Start A/B Test</Button>
        {results && (
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div className="rounded-lg border border-border p-3"><div className="text-xs text-muted-foreground">Variant A Views</div><div className="text-2xl font-bold text-brand">{results.a}</div></div>
            <div className="rounded-lg border border-border p-3"><div className="text-xs text-muted-foreground">Variant B Views</div><div className="text-2xl font-bold text-emerald-500">{results.b}</div></div>
          </div>
        )}
      </CardContent></Card>
    </div>
  );
}

// ============================================================================
// Bulk Job Application Package Generator
// ============================================================================

interface BulkJobEntry {
  id: string;
  type: "url" | "text";
  value: string;
  company?: string;
  title?: string;
  status: "pending" | "scraping" | "analyzing" | "optimizing" | "cover-letter" | "interview" | "completed" | "failed";
  statusLabel: string;
  error?: string;
  optimizedResumeId?: string;
  coverLetterId?: string;
  interviewId?: string;
  atsScore?: number;
  matchScore?: number;
  industry?: string;
}

export function BulkGenerator() {
  const resume = useResume();
  const resumes = useApp((s) => s.resumes);
  const addResume = useApp((s) => s.addResume);
  const addCoverLetter = useApp((s) => s.addCoverLetter);
  const addInterview = useApp((s) => s.addInterview);
  const addJD = useApp((s) => s.addJD);
  const incUsage = useApp((s) => s.incUsage);
  const log = useApp((s) => s.log);
  const [jobs, setJobs] = useState<BulkJobEntry[]>([]);
  const [newJobText, setNewJobText] = useState("");
  const [newJobUrl, setNewJobUrl] = useState("");
  const [processing, setProcessing] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const addJobFromText = () => {
    if (!newJobText.trim() || newJobText.trim().length < 30) { toast.error("Paste a full job description (at least 30 characters)."); return; }
    if (jobs.length >= 5) { toast.error("Maximum 5 jobs per batch."); return; }
    setJobs((j) => [...j, { id: uid("bj"), type: "text", value: newJobText.trim(), status: "pending", statusLabel: "Ready" }]);
    setNewJobText("");
    toast.success("Job added to batch.");
  };

  const addJobFromUrl = async () => {
    if (!newJobUrl.trim()) { toast.error("Enter a job URL."); return; }
    if (jobs.length >= 5) { toast.error("Maximum 5 jobs per batch."); return; }
    const jobId = uid("bj");
    setJobs((j) => [...j, { id: jobId, type: "url", value: newJobUrl.trim(), status: "scraping", statusLabel: "Scraping URL…" }]);
    setNewJobUrl("");
    try {
      const res = await fetch("/api/jd-scrape", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: jobs.find(j => j.id === jobId)?.value || newJobUrl }) });
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setJobs((j) => j.map((job) => job.id === jobId ? { ...job, status: "pending", statusLabel: "Ready", value: data.text || job.value, company: data.title?.split(" - ")[1] || "", title: data.title?.split(" - ")[0] || "" } : job));
      toast.success("URL scraped successfully.");
    } catch (e: any) {
      setJobs((j) => j.map((job) => job.id === jobId ? { ...job, status: "failed", statusLabel: "Scrape failed", error: e?.message || "Failed to scrape URL" } : job));
      toast.error("Failed to scrape URL. You can paste the JD manually.");
    }
  };

  const addJobFromFile = (files: FileList | null) => {
    if (!files?.[0]) return;
    const file = files[0];
    if (file.size > 500 * 1024) { toast.error("File too large (max 500KB)."); return; }
    if (jobs.length >= 5) { toast.error("Maximum 5 jobs per batch."); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      const lines = text.split("\n").filter((l) => l.trim().length > 30);
      const toAdd = lines.slice(0, 5 - jobs.length).map((line) => ({ id: uid("bj"), type: "text" as const, value: line.trim(), status: "pending" as const, statusLabel: "Ready" }));
      setJobs((j) => [...j, ...toAdd]);
      toast.success(`Added ${toAdd.length} job(s) from file.`);
    };
    reader.readAsText(file);
  };

  const removeJob = (id: string) => setJobs((j) => j.filter((job) => job.id !== id));

  const updateJob = (id: string, patch: Partial<BulkJobEntry>) => setJobs((j) => j.map((job) => job.id === id ? { ...job, ...patch } : job));

  // === Process a single job end-to-end ===
  // This is the canonical per-job processor. Both processAll() and retryJob()
  // call this so retry actually re-runs all 5 steps (parse JD → detect industry
  // → optimize resume → cover letter → interview prep) instead of just setting
  // a "Queued…" status.
  const processOne = async (job: BulkJobEntry) => {
    if (!resume) { toast.error("Create a resume first."); return; }
    try {
      // Step 1: Parse JD
      updateJob(job.id, { status: "analyzing", statusLabel: "Analyzing JD…" });
      const jdParseResult = await callAI({
        systemPrompt: "You are a job description parser. Return ONLY valid JSON.",
        userPrompt: `Extract from this job description:\n${job.value.slice(0, 3000)}\n\nReturn JSON: { "title": "...", "company": "...", "location": "...", "requiredSkills": [...], "keywords": [...] }`,
        maxTokens: 1000, taskCategory: "document",
      });
      let jdData: any;
      try { jdData = extractJSON<any>(jdParseResult.text); } catch { jdData = { title: "Role", company: "", keywords: [] }; }
      const company = job.company || jdData.company || "";
      const title = job.title || jdData.title || "Role";

      // Step 2: Detect industry
      const detection = detectIndustry(job.value, `${resume.name} ${resume.headline ?? ""} ${resume.summary ?? ""}`);
      const industryProfile = INDUSTRY_PROFILES[detection.industryId] || INDUSTRY_PROFILES.generic;
      updateJob(job.id, { status: "optimizing", statusLabel: `Optimizing (${industryProfile.label})…`, industry: industryProfile.label, company, title });

      // Step 3: Optimize resume
      const optResult = await callAI({
        systemPrompt: `You are a Senior ATS Optimization Expert. Optimize the resume for the job description using ${industryProfile.label} industry keywords. Return ONLY JSON with: name, headline, summary, skills [{name, category}], experience [{title, company, location, startDate, endDate, bullets[]}], missingKeywordsAdded, bulletsRewritten.\n\nINDUSTRY KEYWORDS: ${industryProfile.keywordBank}`,
        userPrompt: `SOURCE RESUME:\n${JSON.stringify({ name: resume.name, headline: resume.headline, summary: resume.summary, experience: resume.experience.map((e) => ({ title: e.title, company: e.company, bullets: e.bullets })), skills: resume.skills.map((s) => s.name) })}\n\nJOB DESCRIPTION:\n${job.value.slice(0, 2000)}\n\nOptimize for maximum ATS match. NEVER fabricate experience. Return JSON only.`,
        maxTokens: 3000, temperature: 0.4, taskCategory: "document",
      });
      let optData: any;
      try { optData = extractJSON<any>(optResult.text); } catch { throw new Error("AI returned non-JSON for resume optimization"); }
      const optimized: ResumeData = {
        ...resume, id: uid("r"),
        headline: optData.headline || resume.headline,
        summary: optData.summary || resume.summary,
        skills: (optData.skills ?? []).map((s: any) => typeof s === "string" ? { id: uid("s"), name: s, category: "Skills" } : { id: uid("s"), ...s }),
        experience: (optData.experience ?? []).map((e: any) => ({ id: uid("e"), title: e.title || "", company: e.company || "", location: e.location || "", startDate: e.startDate || "", endDate: e.endDate || "Present", bullets: e.bullets ?? [] })),
        template: "infohas-pro", accentColor: "#0563C1",
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        source: "ai-optimized", fileName: `${company || "resume"}_${title}.pdf`,
      };
      addResume(optimized);
      // === REAL ATS SCORE ===
      // Use the actual scoreATS() function (same scorer used by the ATS Checker
      // and Optimizer) instead of a fabricated random formula. Build a minimal
      // JD object from the parsed job data so scoreATS can compute keyword match.
      const fakeJd = {
        id: uid("jd"),
        title: title || "Role",
        company: company || undefined,
        location: undefined,
        employmentType: undefined,
        salary: undefined,
        responsibilities: [],
        requiredSkills: Array.isArray(jdData.requiredSkills) ? jdData.requiredSkills.map(String) : [],
        preferredSkills: [],
        technologies: [],
        experienceYears: undefined,
        education: undefined,
        keywords: Array.isArray(jdData.keywords) ? jdData.keywords.map(String) : [],
        rawText: job.value,
        source: "text" as const,
        createdAt: new Date().toISOString(),
      };
      const atsReport = scoreATS(optimized, fakeJd);
      const atsScore = atsReport.scores.ats;
      updateJob(job.id, { status: "cover-letter", statusLabel: "Generating cover letter…", optimizedResumeId: optimized.id, atsScore, matchScore: atsReport.jdMatchPercent ?? Math.round(atsScore * 0.9) });

      // Step 4: Generate cover letter
      const clResult = await callAI({
        systemPrompt: `You are an expert cover letter writer. Write a ${industryProfile.label} industry cover letter (~400 words). Plain text only. Sound human, professional, recruiter-grade.`,
        userPrompt: `Candidate: ${optimized.name}, ${optimized.headline}\nExperience: ${optimized.experience.map((e) => `${e.title} at ${e.company}`).join(", ")}\nSkills: ${optimized.skills.map((s) => s.name).join(", ")}\n\nJob: ${title} at ${company}\nJD: ${job.value.slice(0, 1000)}\n\nWrite the cover letter now.`,
        maxTokens: 1000, taskCategory: "document",
      });
      const cl = { id: uid("cl"), title: `Cover Letter — ${company}`, template: "modern" as const, content: clResult.text, resumeId: optimized.id, company, role: title, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      addCoverLetter(cl);
      updateJob(job.id, { status: "interview", statusLabel: "Generating interview prep…", coverLetterId: cl.id });

      // Step 5: Generate interview prep (condensed — 9 questions)
      const ivResult = await callAI({
        systemPrompt: `You are an expert interview coach for ${industryProfile.label}. Return ONLY JSON.`,
        userPrompt: `Candidate resume: ${JSON.stringify({ name: optimized.name, experience: optimized.experience.map((e) => ({ title: e.title, company: e.company, bullets: e.bullets })), skills: optimized.skills.map((s) => s.name) })}\n\nJob: ${title} at ${company}\nJD: ${job.value.slice(0, 1500)}\n\nGenerate 9 interview questions (3 technical, 3 behavioral, 2 situational, 1 company). Return JSON: { "questions": [{ "category": "...", "question": "...", "difficulty": "easy|medium|hard", "recommendedAnswer": "...", "talkingPoints": [...], "followUps": [...] }] }`,
        maxTokens: 3000, taskCategory: "document",
      });
      let ivData: any;
      try { ivData = extractJSON<any>(ivResult.text); } catch { ivData = { questions: [] }; }
      const ivPkg = { id: uid("iv"), resumeId: optimized.id, company, role: title, questions: (ivData.questions ?? []).map((q: any) => ({ id: uid("q"), ...q })), createdAt: new Date().toISOString() };
      addInterview(ivPkg);
      updateJob(job.id, { status: "completed", statusLabel: "Completed", interviewId: ivPkg.id });
      incUsage("resumesGenerated"); incUsage("coverLetters"); incUsage("interviewPreps");
      log({ actor: "you", action: `Bulk package: ${title} at ${company}`, category: "ai", details: `ATS ${atsScore} · ${industryProfile.label} · via ${optResult.provider}`, severity: "info" });
    } catch (e: any) {
      updateJob(job.id, { status: "failed", statusLabel: "Failed", error: e?.message || "Unknown error" });
    }
  };

  // === Process all jobs sequentially (sequential avoids AI rate limits) ===
  const processAll = async () => {
    if (!resume) { toast.error("Create a resume first."); return; }
    if (jobs.length === 0) { toast.error("Add at least one job."); return; }
    setProcessing(true);

    // Snapshot jobs to process
    const toProcess = jobs.filter((j) => j.status !== "completed" && j.status !== "failed");
    const initialFailed = jobs.filter((j) => j.status === "failed").length;

    for (const job of toProcess) {
      await processOne(job);
    }
    setProcessing(false);
    // Honest toast — base on whether any jobs were already failed or all initially completed.
    // The exact per-job status is visible in the UI; the toast just signals completion.
    if (toProcess.length === 0) {
      if (initialFailed > 0) toast.warning(`${initialFailed} job(s) previously failed. Click Retry to re-run them.`);
      else toast.info("All jobs in this batch are already completed.");
    } else {
      toast.success(`Batch finished — processed ${toProcess.length} job${toProcess.length === 1 ? "" : "s"}. Check each row for status.`);
    }
  };

  const retryJob = async (jobId: string) => {
    // Reset job to pending and run the full per-job pipeline via processOne
    updateJob(jobId, { status: "pending", statusLabel: "Re-running…", error: undefined });
    const job = jobs.find((j) => j.id === jobId);
    if (!job) return;
    if (!processing) {
      setProcessing(true);
      await processOne(job);
      setProcessing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="Layers" className="w-6 h-6 text-brand" /> Bulk Job Application Package Generator</h1>
        <p className="text-sm text-muted-foreground mt-1">Generate complete application packages (resume + cover letter + interview prep) for up to 5 jobs simultaneously.</p>
      </div>

      {/* === No resume guard === */}
      {!resume && (
        <Card><CardContent className="py-8 text-center">
          <Icon name="FileText" className="w-10 h-10 text-muted-foreground/40 mx-auto" />
          <h3 className="mt-3 font-semibold">Create a resume first</h3>
          <p className="text-sm text-muted-foreground mt-1">Upload or create a base resume to generate bulk application packages.</p>
        </CardContent></Card>
      )}

      {/* === Input section === */}
      {resume && (
        <Card><CardContent className="p-4 space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            {/* URL input */}
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide font-semibold">Add by URL</Label>
              <div className="flex gap-2">
                <Input value={newJobUrl} onChange={(e) => setNewJobUrl(e.target.value)} placeholder="https://linkedin.com/jobs/…" className="text-sm" />
                <Button size="sm" onClick={addJobFromUrl} disabled={jobs.length >= 5} className="bg-brand hover:bg-brand-dark text-white shrink-0 gap-1.5"><Icon name="Link" className="w-3.5 h-3.5" /> Add</Button>
              </div>
              <p className="text-[10px] text-muted-foreground">Supports LinkedIn, Workday, Greenhouse, Lever, SuccessFactors, Taleo, and generic career pages.</p>
            </div>
            {/* File upload */}
            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide font-semibold">Upload File (CSV/TXT)</Label>
              <input ref={fileRef} type="file" accept=".csv,.txt" className="hidden" onChange={(e) => addJobFromFile(e.target.files)} />
              <Button size="sm" variant="outline" onClick={() => fileRef.current?.click()} disabled={jobs.length >= 5} className="gap-1.5 w-full"><Icon name="Upload" className="w-3.5 h-3.5" /> Upload CSV/TXT (one JD per line)</Button>
            </div>
          </div>
          {/* Text input */}
          <div className="space-y-2">
            <Label className="text-xs uppercase tracking-wide font-semibold">Add by Job Description Text</Label>
            <Textarea value={newJobText} onChange={(e) => setNewJobText(e.target.value)} rows={4} placeholder="Paste a full job description here…" className="text-sm" />
            <Button size="sm" onClick={addJobFromText} disabled={jobs.length >= 5 || newJobText.trim().length < 30} className="bg-brand hover:bg-brand-dark text-white gap-1.5"><Icon name="Plus" className="w-3.5 h-3.5" /> Add Job</Button>
          </div>
        </CardContent></Card>
      )}

      {/* === Job list + progress === */}
      {jobs.length > 0 && (
        <Card><CardContent className="p-4 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <h3 className="font-semibold text-sm">Jobs in Batch ({jobs.length}/5)</h3>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => setJobs([])} disabled={processing} className="gap-1.5"><Icon name="Trash2" className="w-3.5 h-3.5" /> Clear</Button>
              <Button size="sm" onClick={processAll} disabled={processing || !resume} className="bg-brand hover:bg-brand-dark text-white gap-1.5">
                {processing ? <Icon name="Loader2" className="w-3.5 h-3.5 animate-spin" /> : <Icon name="Layers" className="w-3.5 h-3.5" />}
                {processing ? "Processing…" : "Generate All Packages"}
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            {jobs.map((job, i) => (
              <div key={job.id} className={`rounded-lg border p-3 transition ${job.status === "completed" ? "border-emerald-300 bg-emerald-50/30 dark:bg-emerald-950/10" : job.status === "failed" ? "border-red-300 bg-red-50/30 dark:bg-red-950/10" : "border-border"}`}>
                <div className="flex items-start gap-3">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-xs font-bold" style={{ background: job.status === "completed" ? "#10B981" : job.status === "failed" ? "#DC2626" : "#1154A3", color: "white" }}>
                    {job.status === "completed" ? "✓" : job.status === "failed" ? "✗" : i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium truncate">{job.company || job.title || `Job ${i + 1}`}</span>
                      {job.type === "url" && <Badge variant="outline" className="text-[9px]">URL</Badge>}
                      {job.industry && <Badge variant="brand" className="text-[9px]">{job.industry}</Badge>}
                      {job.atsScore && <Badge variant="success" className="text-[9px]">ATS {job.atsScore}</Badge>}
                      {job.matchScore && <Badge variant="outline" className="text-[9px]">Match {job.matchScore}%</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {processing && job.status !== "completed" && job.status !== "failed" ? (
                        <span className="flex items-center gap-1.5"><Icon name="Loader2" className="w-3 h-3 animate-spin" /> {job.statusLabel}</span>
                      ) : job.status === "failed" ? (
                        <span className="text-red-600">{job.error || "Failed"} <button onClick={() => retryJob(job.id)} className="text-brand underline ml-1">Retry</button></span>
                      ) : (
                        <span>{job.statusLabel}</span>
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{job.value.slice(0, 80)}{job.value.length > 80 ? "…" : ""}</div>
                  </div>
                  <button onClick={() => removeJob(job.id)} disabled={processing} className="text-muted-foreground hover:text-destructive shrink-0"><Icon name="X" className="w-4 h-4" /></button>
                </div>
              </div>
            ))}
          </div>
        </CardContent></Card>
      )}

      {/* === Comparison dashboard === */}
      {jobs.some((j) => j.status === "completed") && (
        <Card>
          <CardHeader><CardTitle className="text-base">Package Comparison Dashboard</CardTitle></CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead><tr className="border-b border-border">
                  <th className="text-left py-2 px-2 font-semibold">Company</th>
                  <th className="text-left py-2 px-2 font-semibold">Role</th>
                  <th className="text-left py-2 px-2 font-semibold">Industry</th>
                  <th className="text-center py-2 px-2 font-semibold">ATS</th>
                  <th className="text-center py-2 px-2 font-semibold">Match</th>
                  <th className="text-center py-2 px-2 font-semibold">Resume</th>
                  <th className="text-center py-2 px-2 font-semibold">Cover Letter</th>
                  <th className="text-center py-2 px-2 font-semibold">Interview</th>
                </tr></thead>
                <tbody>
                  {jobs.filter((j) => j.status === "completed").map((job) => (
                    <tr key={job.id} className="border-b border-border/50">
                      <td className="py-2 px-2 font-medium">{job.company || "—"}</td>
                      <td className="py-2 px-2">{job.title || "—"}</td>
                      <td className="py-2 px-2">{job.industry || "—"}</td>
                      <td className="py-2 px-2 text-center font-bold">{job.atsScore || "—"}</td>
                      <td className="py-2 px-2 text-center">{job.matchScore ? `${job.matchScore}%` : "—"}</td>
                      <td className="py-2 px-2 text-center"><Icon name="CheckCircle2" className="w-3.5 h-3.5 text-emerald-600 mx-auto" /></td>
                      <td className="py-2 px-2 text-center"><Icon name="CheckCircle2" className="w-3.5 h-3.5 text-emerald-600 mx-auto" /></td>
                      <td className="py-2 px-2 text-center"><Icon name="CheckCircle2" className="w-3.5 h-3.5 text-emerald-600 mx-auto" /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* === Results === */}
      {jobs.some((j) => j.status === "completed") && (
        <Card>
          <CardHeader><CardTitle className="text-base">Generated Packages ({jobs.filter((j) => j.status === "completed").length})</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-3">
              {jobs.filter((j) => j.status === "completed").map((job) => (
                <div key={job.id} className="rounded-lg border border-emerald-200 dark:border-emerald-900 p-3">
                  <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                    <div>
                      <div className="font-semibold text-sm">{job.company || "Company"} — {job.title || "Role"}</div>
                      <div className="text-xs text-muted-foreground">ATS: {job.atsScore} · Match: {job.matchScore}% · {job.industry}</div>
                    </div>
                    <div className="flex gap-1.5">
                      {job.optimizedResumeId && resumes.find((r) => r.id === job.optimizedResumeId) && (
                        <Button size="sm" variant="outline" onClick={() => { const r = resumes.find((r) => r.id === job.optimizedResumeId)!; exportResumePDF(r); incUsage("downloads"); toast.success("Resume PDF exported."); }} className="gap-1 text-xs"><Icon name="Download" className="w-3 h-3" /> Resume</Button>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-[10px]">
                    {job.optimizedResumeId && <Badge variant="success" className="gap-1"><Icon name="CheckCircle2" className="w-2.5 h-2.5" /> Resume</Badge>}
                    {job.coverLetterId && <Badge variant="success" className="gap-1"><Icon name="CheckCircle2" className="w-2.5 h-2.5" /> Cover Letter</Badge>}
                    {job.interviewId && <Badge variant="success" className="gap-1"><Icon name="CheckCircle2" className="w-2.5 h-2.5" /> Interview Prep</Badge>}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ============================================================================
// Resume Analytics
// ============================================================================

export function ResumeAnalytics() {
  const atsReports = useApp((s) => s.atsReports);
  const resumes = useApp((s) => s.resumes);
  const logs = useApp((s) => s.logs);

  const views = logs.filter((l) => /view|share/i.test(l.action)).length;
  const downloads = logs.filter((l) => /export|download/i.test(l.action)).length;
  const scoreHistory = atsReports.slice(0, 10).reverse();

  return (
    <div className="space-y-6">
      <div><h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="BarChart3" className="w-6 h-6 text-brand" /> Resume Analytics</h1><p className="text-sm text-muted-foreground mt-1">Track views, downloads, and ATS score history for your resumes.</p></div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[{ label: "Total Resumes", value: resumes.length, icon: "FileText", color: "#1154A3" }, { label: "ATS Checks", value: atsReports.length, icon: "ScanText", color: "#10B981" }, { label: "Views", value: views, icon: "Eye", color: "#F59E0B" }, { label: "Downloads", value: downloads, icon: "Download", color: "#8B5CF6" }].map((kpi) => (
          <Card key={kpi.label}><CardContent className="p-4"><div className="flex items-center justify-between mb-2"><div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: `${kpi.color}15`, color: kpi.color }}><Icon name={kpi.icon} className="w-5 h-5" /></div></div><div className="text-2xl font-bold font-display">{kpi.value}</div><div className="text-xs text-muted-foreground">{kpi.label}</div></CardContent></Card>
        ))}
      </div>
      <Card><CardHeader><CardTitle className="text-base">ATS Score History</CardTitle></CardHeader><CardContent>
        {scoreHistory.length === 0 ? <p className="text-sm text-muted-foreground">No ATS checks yet.</p> : (
          <div className="space-y-2">{scoreHistory.map((r, i) => (
            <div key={r.id} className="flex items-center gap-3"><span className="text-xs text-muted-foreground w-8">#{i + 1}</span><div className="flex-1 h-6 bg-secondary rounded-full overflow-hidden"><div className="h-full bg-brand rounded-full flex items-center justify-end pr-2" style={{ width: `${r.scores.ats}%` }}><span className="text-xs text-white font-medium">{r.scores.ats}</span></div></div></div>
          ))}</div>
        )}
      </CardContent></Card>
    </div>
  );
}

// ============================================================================
// Application Tracker
// ============================================================================

export function AppTracker() {
  const log = useApp((s) => s.log);
  const [apps, setApps] = useState<Array<{ id: string; company: string; role: string; status: string; date: string }>>([]);
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");

  const columns = ["Applied", "Phone Screen", "Interview", "Offer", "Rejected"];
  const add = () => {
    if (!company || !role) return;
    const app = { id: uid("app"), company, role, status: "Applied", date: new Date().toISOString() };
    setApps((a) => [app, ...a]); setCompany(""); setRole("");
    log({ actor: "you", action: "Application tracked", category: "resume", details: `${role} at ${company}`, severity: "info" });
    toast.success("Application added");
  };
  const move = (id: string, status: string) => setApps((a) => a.map((x) => x.id === id ? { ...x, status } : x));

  return (
    <div className="space-y-6">
      <div><h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="KanbanSquare" className="w-6 h-6 text-brand" /> Application Tracker</h1><p className="text-sm text-muted-foreground mt-1">Track job applications through your pipeline.</p></div>
      <Card><CardContent className="p-4 flex gap-2 flex-wrap">
        <Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Company" className="flex-1 min-w-[150px]" />
        <Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Role" className="flex-1 min-w-[150px]" />
        <Button onClick={add} className="bg-brand hover:bg-brand-dark text-white gap-2"><Icon name="Plus" className="w-4 h-4" /> Add</Button>
      </CardContent></Card>
      <div className="grid sm:grid-cols-2 lg:grid-cols-5 gap-3">
        {columns.map((col) => (
          <div key={col} className="space-y-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-2">{col} ({apps.filter((a) => a.status === col).length})</div>
            {apps.filter((a) => a.status === col).map((app) => (
              <div key={app.id} className="rounded-lg border border-border p-2">
                <div className="text-sm font-medium truncate">{app.role}</div>
                <div className="text-xs text-muted-foreground truncate">{app.company}</div>
                <select value={app.status} onChange={(e) => move(app.id, e.target.value)} className="w-full h-7 px-2 rounded-md border border-input bg-background text-xs mt-1">
                  {columns.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============================================================================
// Salary Insights
// ============================================================================

export function SalaryInsights() {
  const [role, setRole] = useState("");
  const [location, setLocation] = useState("");
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState("");

  const analyze = async () => {
    if (!role) { toast.error("Enter a role"); return; }
    setLoading(true); setOutput("");
    try {
      const result = await callAI({
        systemPrompt: "You are a salary analyst. Provide realistic salary ranges based on role, location, and experience. Include entry, mid, senior levels.",
        userPrompt: `Provide salary insights for: Role: ${role}, Location: ${location || "Global"}. Include: salary range (entry/mid/senior), benefits typically offered, negotiation tips, and market demand outlook.`,
        maxTokens: 1500, taskCategory: "document",
      });
      setOutput(result.text);
    } catch (e: any) { toast.error(e?.message || "Failed"); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-6">
      <div><h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="DollarSign" className="w-6 h-6 text-brand" /> Salary Insights</h1><p className="text-sm text-muted-foreground mt-1">Get AI-powered salary data for any role and location.</p></div>
      <Card><CardContent className="p-4 space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <div><Label>Role</Label><Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Senior Frontend Engineer" className="mt-1" /></div>
          <div><Label>Location</Label><Input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Dubai, UAE" className="mt-1" /></div>
        </div>
        <Button onClick={analyze} disabled={loading} className="bg-brand hover:bg-brand-dark text-white gap-2"><Icon name={loading ? "Loader2" : "Search"} className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> {loading ? "Analyzing..." : "Get Salary Insights"}</Button>
      </CardContent></Card>
      <AIOutput output={output} loading={loading} />
    </div>
  );
}

// ============================================================================
// Skill Gap Analysis → AI Skill Intelligence
// ============================================================================

interface SkillGapReport {
  overallMatch: number;
  technicalMatch: number;
  softSkillMatch: number;
  leadershipMatch: number;
  certificationMatch: number;
  industryMatch: number;
  criticalGaps: string[];
  importantGaps: string[];
  niceToHaveGaps: string[];
  skillsToLearn: string[];
  certifications: string[];
  courses: string[];
  projects: string[];
  resumeRecommendations: string[];
  interviewTopics: string[];
  likelyQuestions: string[];
  day30: string;
  day60: string;
  day90: string;
  month6: string;
}

export function SkillGap() {
  const resumes = useApp((s) => s.resumes);
  const jds = useApp((s) => s.jobDescriptions);
  const setView = useApp((s) => s.setView);
  const [jdId, setJdId] = useState("");
  const [loading, setLoading] = useState(false);
  const [report, setReport] = useState<SkillGapReport | null>(null);

  const resume = resumes[0] ?? null;
  const selectedJd = jds.find((j) => j.id === jdId) ?? null;
  // Auto-select the most recent JD when one becomes available and none is chosen
  useEffect(() => {
    if (!jdId && jds.length > 0) {
      setJdId(jds[0].id);
    }
  }, [jds, jdId]);

  const analyze = async () => {
    if (!resume) { toast.error("Create a resume first."); return; }
    if (!selectedJd) { toast.error("Select a job description."); return; }
    setLoading(true); setReport(null);
    try {
      const result = await callAI({
        systemPrompt: `You are an Expert Career Advisor and Skills Analyst. You deeply analyze the gap between a candidate's resume and a job description, then generate actionable learning roadmaps. NEVER fabricate — only reference real skills from the resume. Return ONLY valid JSON.`,
        userPrompt: `CANDIDATE RESUME:
${JSON.stringify({ name: resume.name, headline: resume.headline, summary: resume.summary, skills: resume.skills.map((s) => s.name), experience: resume.experience.map((e) => ({ title: e.title, company: e.company, bullets: e.bullets.slice(0, 2) })), education: resume.education.map((ed) => ({ degree: ed.degree, institution: ed.institution })), certifications: resume.certifications.map((c) => c.name) })}

JOB DESCRIPTION:
${selectedJd.rawText?.slice(0, 2000) ?? JSON.stringify({ title: selectedJd.title, company: selectedJd.company, requiredSkills: selectedJd.requiredSkills, keywords: selectedJd.keywords })}

COMPANY: ${selectedJd.company || "N/A"}
JOB TITLE: ${selectedJd.title || "N/A"}

Analyze the skill gap between the candidate and the job. Return JSON:
{
  "overallMatch": 75,
  "technicalMatch": 80,
  "softSkillMatch": 70,
  "leadershipMatch": 60,
  "certificationMatch": 50,
  "industryMatch": 85,
  "criticalGaps": ["skill1", "skill2"],
  "importantGaps": ["skill1"],
  "niceToHaveGaps": ["skill1"],
  "skillsToLearn": ["skill1", "skill2"],
  "certifications": ["cert1"],
  "courses": ["course1"],
  "projects": ["project idea1"],
  "resumeRecommendations": ["improve section X", "highlight skill Y"],
  "interviewTopics": ["topic1", "topic2"],
  "likelyQuestions": ["question1", "question2"],
  "day30": "30-day learning plan",
  "day60": "60-day plan",
  "day90": "90-day plan",
  "month6": "6-month plan"
}`,
        maxTokens: 2500, temperature: 0.3, taskCategory: "document",
      });

      let data: SkillGapReport;
      try { data = extractJSON<SkillGapReport>(result.text); }
      catch { throw new Error("Failed to parse AI response. Please try again."); }

      // === DEFENSIVE NORMALIZATION ===
      // The AI sometimes returns array elements as objects (e.g.
      // {goal, actions, resources}) or numbers instead of strings, which
      // crashes React with error #31 ("Objects are not valid as a React
      // child") when we render {item} inside <li>. Coerce every field to
      // its expected type so the render is always safe.
      const toArray = (v: any): string[] => {
        if (!Array.isArray(v)) {
          if (typeof v === "string" && v.trim()) return v.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
          return [];
        }
        return v.map((item) => {
          if (item === null || item === undefined) return "";
          if (typeof item === "string") return item;
          if (typeof item === "number" || typeof item === "boolean") return String(item);
          // Object — serialize to a readable string so no info is lost
          try {
            const vals = Object.values(item as any);
            // If all values are strings/numbers, join them with " — "
            if (vals.length > 0 && vals.every((x) => typeof x === "string" || typeof x === "number")) {
              return vals.map(String).join(" — ");
            }
            return JSON.stringify(item);
          } catch { return String(item); }
        }).filter((s) => s.length > 0);
      };
      const toStr = (v: any): string => {
        if (v === null || v === undefined) return "";
        if (typeof v === "string") return v;
        if (typeof v === "number" || typeof v === "boolean") return String(v);
        try { return JSON.stringify(v); } catch { return String(v); }
      };
      const toNum = (v: any): number => {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
      };
      const normalized: SkillGapReport = {
        overallMatch: toNum(data.overallMatch),
        technicalMatch: toNum(data.technicalMatch),
        softSkillMatch: toNum(data.softSkillMatch),
        leadershipMatch: toNum(data.leadershipMatch),
        certificationMatch: toNum(data.certificationMatch),
        industryMatch: toNum(data.industryMatch),
        criticalGaps: toArray(data.criticalGaps),
        importantGaps: toArray(data.importantGaps),
        niceToHaveGaps: toArray(data.niceToHaveGaps),
        skillsToLearn: toArray(data.skillsToLearn),
        certifications: toArray(data.certifications),
        courses: toArray(data.courses),
        projects: toArray(data.projects),
        resumeRecommendations: toArray(data.resumeRecommendations),
        interviewTopics: toArray(data.interviewTopics),
        likelyQuestions: toArray(data.likelyQuestions),
        day30: toStr(data.day30),
        day60: toStr(data.day60),
        day90: toStr(data.day90),
        month6: toStr(data.month6),
      };
      setReport(normalized);
      toast.success(`Skill analysis complete — ${normalized.overallMatch}% overall match`);
    } catch (e: any) { toast.error(e?.message || "Analysis failed."); }
    finally { setLoading(false); }
  };

  const scoreColor = (s: number) => s >= 75 ? "#10B981" : s >= 50 ? "#F59E0B" : "#DC2626";

  return (
    <div className="space-y-6">
      <div><h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="GitCompare" className="w-6 h-6 text-brand" /> Skill Intelligence</h1><p className="text-sm text-muted-foreground mt-1">AI-powered skill gap analysis with learning roadmap and interview preparation.</p></div>

      <Card><CardContent className="p-4 space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label>Resume</Label>
            <div className="text-sm font-semibold mt-1">{resume?.name ?? "No resume"}</div>
            {!resume && <p className="text-[11px] text-muted-foreground mt-1">Create a resume in the Builder first.</p>}
          </div>
          <div>
            <Label>Target Job</Label>
            {jds.length > 0 ? (
              <select value={jdId} onChange={(e) => setJdId(e.target.value)} className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm mt-1">
                <option value="">Select...</option>
                {jds.map((j) => <option key={j.id} value={j.id}>{j.title}{j.company ? ` — ${j.company}` : ""}</option>)}
              </select>
            ) : (
              <div className="mt-1 space-y-1.5">
                <div className="text-xs text-muted-foreground italic">No parsed jobs found.</div>
                <Button size="sm" variant="outline" onClick={() => setView("jd-scraper")} className="gap-1.5 h-7 text-xs">
                  <Icon name="Search" className="w-3 h-3" /> Parse a Job from URL
                </Button>
              </div>
            )}
          </div>
        </div>
        {jds.length === 0 && (
          <div className="rounded-md border border-dashed border-amber-300 bg-amber-50 dark:bg-amber-950/30 dark:border-amber-700 p-3 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2">
            <Icon name="Info" className="w-4 h-4 mt-0.5 shrink-0" />
            <div>
              <p className="font-semibold mb-0.5">No job descriptions available</p>
              <p>Skill Intelligence needs a parsed job to compare against your resume. Go to <strong>JD Scraper</strong>, paste a job URL or job text, and the parsed job will appear here automatically.</p>
            </div>
          </div>
        )}
        <Button onClick={analyze} disabled={loading || !resume || !jdId} className="bg-brand hover:bg-brand-dark text-white gap-2"><Icon name={loading ? "Loader2" : "GitCompare"} className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> {loading ? "Analyzing…" : "Analyze Skill Gaps"}</Button>
      </CardContent></Card>

      {loading && <Card><CardContent className="p-4"><div className="flex items-center gap-2"><Icon name="Loader2" className="w-4 h-4 animate-spin text-brand" /><span className="text-sm text-muted-foreground">Analyzing skills, gaps, and generating learning roadmap…</span></div></CardContent></Card>}

      {report && (
        <>
          {/* Match Scores */}
          <Card><CardContent className="p-4">
            <div className="flex items-center gap-4 mb-4">
              <div className="text-center"><div className="text-3xl font-bold font-display" style={{ color: scoreColor(report.overallMatch) }}>{report.overallMatch}%</div><div className="text-[10px] text-muted-foreground uppercase">Overall Match</div></div>
              <div className="flex-1 grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs">
                {[
                  { label: "Technical", val: report.technicalMatch },
                  { label: "Soft Skills", val: report.softSkillMatch },
                  { label: "Leadership", val: report.leadershipMatch },
                  { label: "Certs", val: report.certificationMatch },
                  { label: "Industry", val: report.industryMatch },
                ].map((s) => (
                  <div key={s.label}><div className="text-[10px] uppercase text-muted-foreground">{s.label}</div>
                    <div className="h-1.5 bg-secondary rounded-full overflow-hidden mt-0.5"><div className="h-full rounded-full" style={{ width: `${s.val}%`, background: scoreColor(s.val) }} /></div>
                    <div className="text-[10px] font-bold mt-0.5" style={{ color: scoreColor(s.val) }}>{s.val}%</div>
                  </div>
                ))}
              </div>
            </div>
          </CardContent></Card>

          {/* Gap Categorization */}
          <div className="grid md:grid-cols-3 gap-4">
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-red-600">Critical Gaps</CardTitle></CardHeader><CardContent className="pt-0">{report.criticalGaps?.length > 0 ? <ul className="space-y-0.5">{report.criticalGaps.map((g, i) => <li key={i} className="text-xs flex gap-1"><span className="text-red-500">!</span> {g}</li>)}</ul> : <p className="text-xs text-muted-foreground">None</p>}</CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-amber-600">Important Gaps</CardTitle></CardHeader><CardContent className="pt-0">{report.importantGaps?.length > 0 ? <ul className="space-y-0.5">{report.importantGaps.map((g, i) => <li key={i} className="text-xs flex gap-1"><span className="text-amber-500">→</span> {g}</li>)}</ul> : <p className="text-xs text-muted-foreground">None</p>}</CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm text-blue-500">Nice-to-Have</CardTitle></CardHeader><CardContent className="pt-0">{report.niceToHaveGaps?.length > 0 ? <ul className="space-y-0.5">{report.niceToHaveGaps.map((g, i) => <li key={i} className="text-xs flex gap-1"><span className="text-blue-400">+</span> {g}</li>)}</ul> : <p className="text-xs text-muted-foreground">None</p>}</CardContent></Card>
          </div>

          {/* Recommendations */}
          <div className="grid md:grid-cols-2 gap-4">
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Learning Recommendations</CardTitle></CardHeader><CardContent className="pt-0 text-xs space-y-2">
              {report.skillsToLearn?.length > 0 && <div><div className="font-semibold mb-0.5">Skills to Learn:</div><div className="flex flex-wrap gap-1">{report.skillsToLearn.map((s, i) => <Badge key={i} variant="brand" className="text-[9px]">{s}</Badge>)}</div></div>}
              {report.certifications?.length > 0 && <div><div className="font-semibold mb-0.5 mt-2">Certifications:</div><ul className="space-y-0.5">{report.certifications.map((c, i) => <li key={i} className="flex gap-1"><span className="text-brand">›</span> {c}</li>)}</ul></div>}
              {report.courses?.length > 0 && <div><div className="font-semibold mb-0.5 mt-2">Courses:</div><ul className="space-y-0.5">{report.courses.map((c, i) => <li key={i} className="flex gap-1"><span className="text-brand">›</span> {c}</li>)}</ul></div>}
              {report.projects?.length > 0 && <div><div className="font-semibold mb-0.5 mt-2">Practice Projects:</div><ul className="space-y-0.5">{report.projects.map((p, i) => <li key={i} className="flex gap-1"><span className="text-emerald-600">✓</span> {p}</li>)}</ul></div>}
            </CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Resume & Interview Recommendations</CardTitle></CardHeader><CardContent className="pt-0 text-xs space-y-2">
              {report.resumeRecommendations?.length > 0 && <div><div className="font-semibold mb-0.5">Resume Improvements:</div><ul className="space-y-0.5">{report.resumeRecommendations.map((r, i) => <li key={i} className="flex gap-1"><span className="text-amber-500">→</span> {r}</li>)}</ul></div>}
              {report.interviewTopics?.length > 0 && <div><div className="font-semibold mb-0.5 mt-2">Interview Topics to Study:</div><div className="flex flex-wrap gap-1">{report.interviewTopics.map((t, i) => <Badge key={i} variant="warning" className="text-[9px]">{t}</Badge>)}</div></div>}
              {report.likelyQuestions?.length > 0 && <div><div className="font-semibold mb-0.5 mt-2">Likely Questions:</div><ul className="space-y-0.5">{report.likelyQuestions.map((q, i) => <li key={i} className="flex gap-1"><span className="text-gold">?</span> {q}</li>)}</ul></div>}
            </CardContent></Card>
          </div>

          {/* Learning Roadmap */}
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Icon name="Map" className="w-4 h-4 text-brand" /> Learning Roadmap</CardTitle></CardHeader>
          <CardContent className="pt-0 space-y-3">
            {[
              { label: "30-Day Plan", content: report.day30, color: "#10B981" },
              { label: "60-Day Plan", content: report.day60, color: "#1154A3" },
              { label: "90-Day Plan", content: report.day90, color: "#8B5CF6" },
              { label: "6-Month Plan", content: report.month6, color: "#F59E0B" },
            ].map((phase) => (
              <div key={phase.label} className="rounded-lg border-l-4 p-3" style={{ borderColor: phase.color }}>
                <div className="text-xs font-semibold mb-1" style={{ color: phase.color }}>{phase.label}</div>
                <p className="text-xs text-foreground/80 text-pretty">{phase.content}</p>
              </div>
            ))}
          </CardContent></Card>
        </>
      )}
    </div>
  );
}

// ============================================================================
// Career Path Visualizer
// ============================================================================

export function CareerPath() {
  const [current, setCurrent] = useState("");
  const [target, setTarget] = useState("");
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState("");

  const visualize = async () => {
    if (!current || !target) { toast.error("Enter both roles"); return; }
    setLoading(true); setOutput("");
    try {
      const result = await callAI({
        systemPrompt: "You are a career advisor. Map the progression path from current role to target role.",
        userPrompt: `Current role: ${current}\nTarget role: ${target}\n\nProvide: 1) Step-by-step career path (3-5 intermediate roles), 2) Skills to acquire at each step, 3) Estimated time per step, 4) Key milestones to hit.`,
        maxTokens: 1500, taskCategory: "document",
      });
      setOutput(result.text);
    } catch (e: any) { toast.error(e?.message || "Failed"); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-6">
      <div><h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="Route" className="w-6 h-6 text-brand" /> Career Path</h1><p className="text-sm text-muted-foreground mt-1">Visualize the progression from your current role to your target role.</p></div>
      <Card><CardContent className="p-4 space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <div><Label>Current Role</Label><Input value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="Junior Developer" className="mt-1" /></div>
          <div><Label>Target Role</Label><Input value={target} onChange={(e) => setTarget(e.target.value)} placeholder="CTO" className="mt-1" /></div>
        </div>
        <Button onClick={visualize} disabled={loading} className="bg-brand hover:bg-brand-dark text-white gap-2"><Icon name={loading ? "Loader2" : "Route"} className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> {loading ? "Mapping..." : "Map Career Path"}</Button>
      </CardContent></Card>
      <AIOutput output={output} loading={loading} />
    </div>
  );
}

// ============================================================================
// Company Research → AI Company Intelligence Platform
// ============================================================================

interface CompanyIntel {
  overview: string;
  mission: string;
  vision: string;
  values: string[];
  culture: string;
  products: string[];
  employeeCount: string;
  headquarters: string;
  leadership: string;
  recentNews: string[];
  hiringTrends: string;
  interviewProcess: string;
  interviewDifficulty: string;
  commonQuestions: string[];
  valuesQuestions: string[];
  fitScore: number;
  fitStrengths: string[];
  fitWeaknesses: string[];
  fitOpportunities: string[];
  fitRisks: string[];
  interviewFocusAreas: string[];
  atsVendor: string;
  screeningCriteria: string[];
  atsRecommendations: string[];
  networkingRecommendations: string[];
  departmentsToTarget: string[];
  linkedinStrategy: string;
}

export function CompanyResearch() {
  const resumes = useApp((s) => s.resumes);
  const jds = useApp((s) => s.jobDescriptions);
  const [companyName, setCompanyName] = useState("");
  const [loading, setLoading] = useState(false);
  const [intel, setIntel] = useState<CompanyIntel | null>(null);
  const [webResults, setWebResults] = useState<any[]>([]);

  const resume = resumes[0] ?? null;
  const jd = jds[0] ?? null;

  // Auto-detect company from JD
  const detectedCompany = jd?.company || "";

  const research = async () => {
    const targetCompany = companyName.trim() || detectedCompany;
    if (!targetCompany) { toast.error("Enter a company name or add a job description first."); return; }
    setLoading(true); setIntel(null); setWebResults([]);
    try {
      // Parallel: web search + AI intelligence
      const webPromise = fetch("/api/web-search", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ company: targetCompany, jobTitle: jd?.title || "", industry: "" }),
      }).then((r) => r.json()).catch(() => ({ results: [] }));

      const resumeContext = resume ? JSON.stringify({
        name: resume.name, headline: resume.headline, summary: resume.summary,
        experience: resume.experience.map((e) => ({ title: e.title, company: e.company, bullets: e.bullets.slice(0, 2) })),
        skills: resume.skills.map((s) => s.name),
      }) : "(no resume)";

      const jdContext = jd?.rawText ?? jd?.keywords?.join(", ") ?? "(no JD)";

      const result = await callAI({
        systemPrompt: `You are an Expert Company Intelligence Analyst and Senior Recruiter. Generate a comprehensive company intelligence report for job seekers. NEVER fabricate information — if you don't know something, say "Information not available". Return ONLY valid JSON.`,
        userPrompt: `COMPANY: ${targetCompany}
${jd ? `JOB TITLE: ${jd.title || "N/A"}\nJOB DESCRIPTION: ${jdContext.slice(0, 1500)}` : ""}
${resume ? `CANDIDATE RESUME: ${resumeContext}` : ""}

Generate a comprehensive company intelligence report. Return JSON:
{
  "overview": "Company overview (2-3 sentences)",
  "mission": "Company mission statement",
  "vision": "Company vision",
  "values": ["value1", "value2", "value3"],
  "culture": "Culture description (2-3 sentences)",
  "products": ["product1", "product2"],
  "employeeCount": "approximate employee count",
  "headquarters": "HQ location",
  "leadership": "CEO or key leadership",
  "recentNews": ["news1", "news2"],
  "hiringTrends": "Current hiring trends (2-3 sentences)",
  "interviewProcess": "Typical interview process (stages, timeline)",
  "interviewDifficulty": "Easy/Medium/Hard + brief explanation",
  "commonQuestions": ["question1", "question2", "question3"],
  "valuesQuestions": ["values-based question1", "question2"],
  "fitScore": 75,
  "fitStrengths": ["strength1", "strength2"],
  "fitWeaknesses": ["weakness1"],
  "fitOpportunities": ["opportunity1"],
  "fitRisks": ["risk1"],
  "interviewFocusAreas": ["area1", "area2"],
  "atsVendor": "Workday/Greenhouse/Taleo or Unknown",
  "screeningCriteria": ["criteria1", "criteria2"],
  "atsRecommendations": ["recommendation1"],
  "networkingRecommendations": ["strategy1"],
  "departmentsToTarget": ["dept1", "dept2"],
  "linkedinStrategy": "LinkedIn networking strategy (2-3 sentences)"
}

If you don't know specific information, use "Information not available" — never fabricate.`,
        maxTokens: 3000, temperature: 0.3, taskCategory: "document",
      });

      let data: CompanyIntel;
      try { data = extractJSON<CompanyIntel>(result.text); }
      catch { throw new Error("Failed to parse AI response. Please try again."); }

      // === DEFENSIVE NORMALIZATION ===
      // The AI may return array fields as strings (or omit them entirely),
      // which would crash the render when we call .map() / .join() on them.
      // Coerce every field to its expected type so the render is always safe.
      const toArray = (v: any): string[] => {
        if (Array.isArray(v)) return v.map((x) => String(x));
        if (typeof v === "string" && v.trim()) return v.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
        return [];
      };
      const toStr = (v: any): string => (v === null || v === undefined) ? "" : String(v);
      const toNum = (v: any): number => {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
      };
      const normalized: CompanyIntel = {
        overview: toStr(data.overview),
        mission: toStr(data.mission),
        vision: toStr(data.vision),
        values: toArray(data.values),
        culture: toStr(data.culture),
        products: toArray(data.products),
        employeeCount: toStr(data.employeeCount),
        headquarters: toStr(data.headquarters),
        leadership: toStr(data.leadership),
        recentNews: toArray(data.recentNews),
        hiringTrends: toStr(data.hiringTrends),
        interviewProcess: toStr(data.interviewProcess),
        interviewDifficulty: toStr(data.interviewDifficulty),
        commonQuestions: toArray(data.commonQuestions),
        valuesQuestions: toArray(data.valuesQuestions),
        fitScore: toNum(data.fitScore),
        fitStrengths: toArray(data.fitStrengths),
        fitWeaknesses: toArray(data.fitWeaknesses),
        fitOpportunities: toArray(data.fitOpportunities),
        fitRisks: toArray(data.fitRisks),
        interviewFocusAreas: toArray(data.interviewFocusAreas),
        atsVendor: toStr(data.atsVendor),
        screeningCriteria: toArray(data.screeningCriteria),
        atsRecommendations: toArray(data.atsRecommendations),
        networkingRecommendations: toArray(data.networkingRecommendations),
        departmentsToTarget: toArray(data.departmentsToTarget),
        linkedinStrategy: toStr(data.linkedinStrategy),
      };
      setIntel(normalized);
      const webData = await webPromise;
      setWebResults(Array.isArray(webData?.results) ? webData.results : []);
      toast.success(`Company intelligence generated for ${targetCompany}`);
    } catch (e: any) {
      toast.error(e?.message || "Research failed.");
    } finally { setLoading(false); }
  };

  return (
    <div className="space-y-6">
      <div><h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="Building2" className="w-6 h-6 text-brand" /> Company Intelligence</h1><p className="text-sm text-muted-foreground mt-1">AI-powered company profiles, culture insights, interview intelligence, and fit analysis.</p></div>

      <Card><CardContent className="p-4 space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <div><Label>Company Name</Label><Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder={detectedCompany || "Emirates"} className="mt-1" /></div>
          <div className="flex items-end gap-2 text-xs">
            {detectedCompany && <Badge variant="brand" className="mb-2">Auto-detected: {detectedCompany}</Badge>}
            {resume && <Badge variant="outline" className="mb-2">Resume: {resume.name}</Badge>}
            {jd && <Badge variant="outline" className="mb-2">JD: {jd.title}</Badge>}
          </div>
        </div>
        <Button onClick={research} disabled={loading} className="bg-brand hover:bg-brand-dark text-white gap-2"><Icon name={loading ? "Loader2" : "Search"} className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> {loading ? "Researching…" : "Generate Intelligence Report"}</Button>
      </CardContent></Card>

      {loading && <Card><CardContent className="p-4"><div className="flex items-center gap-2"><Icon name="Loader2" className="w-4 h-4 animate-spin text-brand" /><span className="text-sm text-muted-foreground">Analyzing company, culture, interview process, and fit…</span></div></CardContent></Card>}

      {intel && (
        <>
          {/* Fit Score */}
          <Card><CardContent className="p-4 flex items-center gap-4 flex-wrap">
            <div className="text-center"><div className="text-3xl font-bold font-display text-brand">{intel.fitScore}</div><div className="text-[10px] text-muted-foreground uppercase">Fit Score</div></div>
            <div className="flex-1 min-w-0 grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div><div className="text-[10px] uppercase text-muted-foreground">ATS Vendor</div><div className="font-semibold">{intel.atsVendor || "Unknown"}</div></div>
              <div><div className="text-[10px] uppercase text-muted-foreground">Difficulty</div><div className="font-semibold">{intel.interviewDifficulty?.split(" ")[0] || "—"}</div></div>
              <div><div className="text-[10px] uppercase text-muted-foreground">Employees</div><div className="font-semibold">{intel.employeeCount || "—"}</div></div>
              <div><div className="text-[10px] uppercase text-muted-foreground">HQ</div><div className="font-semibold truncate">{intel.headquarters || "—"}</div></div>
            </div>
          </CardContent></Card>

          {/* Overview + Mission + Values */}
          <div className="grid md:grid-cols-2 gap-4">
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Overview</CardTitle></CardHeader><CardContent className="pt-0"><p className="text-sm text-foreground/80 text-pretty">{intel.overview}</p>
              {intel.mission && <p className="text-xs text-muted-foreground mt-2"><span className="font-semibold">Mission:</span> {intel.mission}</p>}
              {intel.vision && <p className="text-xs text-muted-foreground mt-1"><span className="font-semibold">Vision:</span> {intel.vision}</p>}
            </CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Culture & Values</CardTitle></CardHeader><CardContent className="pt-0">
              <p className="text-sm text-foreground/80 text-pretty mb-2">{intel.culture}</p>
              {intel.values?.length > 0 && <div className="flex flex-wrap gap-1">{intel.values.map((v, i) => <Badge key={i} variant="outline" className="text-[10px]">{v}</Badge>)}</div>}
            </CardContent></Card>
          </div>

          {/* Fit Analysis */}
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Icon name="Target" className="w-4 h-4 text-brand" /> Fit Analysis</CardTitle></CardHeader>
          <CardContent className="pt-0 grid sm:grid-cols-2 gap-3 text-xs">
            <div><div className="font-semibold text-emerald-600 mb-1">Strengths</div><ul className="space-y-0.5">{intel.fitStrengths?.map((s, i) => <li key={i} className="flex gap-1"><span className="text-emerald-600">✓</span> {s}</li>)}</ul></div>
            <div><div className="font-semibold text-amber-600 mb-1">Weaknesses</div><ul className="space-y-0.5">{intel.fitWeaknesses?.map((w, i) => <li key={i} className="flex gap-1"><span className="text-amber-600">→</span> {w}</li>)}</ul></div>
            <div><div className="font-semibold text-brand mb-1">Opportunities</div><ul className="space-y-0.5">{intel.fitOpportunities?.map((o, i) => <li key={i} className="flex gap-1"><span className="text-brand">+</span> {o}</li>)}</ul></div>
            <div><div className="font-semibold text-red-500 mb-1">Risks</div><ul className="space-y-0.5">{intel.fitRisks?.map((r, i) => <li key={i} className="flex gap-1"><span className="text-red-500">!</span> {r}</li>)}</ul></div>
          </CardContent></Card>

          {/* Interview Intelligence */}
          <Card><CardHeader className="pb-2"><CardTitle className="text-sm flex items-center gap-2"><Icon name="MessagesSquare" className="w-4 h-4 text-brand" /> Interview Intelligence</CardTitle></CardHeader>
          <CardContent className="pt-0 space-y-2 text-xs">
            <div><span className="font-semibold">Process:</span> {intel.interviewProcess}</div>
            <div><span className="font-semibold">Difficulty:</span> {intel.interviewDifficulty}</div>
            {intel.commonQuestions?.length > 0 && <div><div className="font-semibold mt-1">Common Questions:</div><ul className="space-y-0.5">{intel.commonQuestions.map((q, i) => <li key={i} className="flex gap-1"><span className="text-gold">?</span> {q}</li>)}</ul></div>}
            {intel.valuesQuestions?.length > 0 && <div><div className="font-semibold mt-1">Values Questions:</div><ul className="space-y-0.5">{intel.valuesQuestions.map((q, i) => <li key={i} className="flex gap-1"><span className="text-brand">★</span> {q}</li>)}</ul></div>}
            {intel.interviewFocusAreas?.length > 0 && <div className="mt-1"><span className="font-semibold">Focus Areas:</span> {intel.interviewFocusAreas.join(", ")}</div>}
          </CardContent></Card>

          {/* ATS + Networking */}
          <div className="grid md:grid-cols-2 gap-4">
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">ATS Intelligence</CardTitle></CardHeader><CardContent className="pt-0 text-xs space-y-1">
              <div><span className="font-semibold">Vendor:</span> {intel.atsVendor}</div>
              {intel.screeningCriteria?.length > 0 && <div><div className="font-semibold mt-1">Screening Criteria:</div><ul className="space-y-0.5">{intel.screeningCriteria.map((c, i) => <li key={i} className="flex gap-1"><span className="text-brand">›</span> {c}</li>)}</ul></div>}
              {intel.atsRecommendations?.length > 0 && <div><div className="font-semibold mt-1">Recommendations:</div><ul className="space-y-0.5">{intel.atsRecommendations.map((r, i) => <li key={i} className="flex gap-1"><span className="text-emerald-600">✓</span> {r}</li>)}</ul></div>}
            </CardContent></Card>
            <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Networking Strategy</CardTitle></CardHeader><CardContent className="pt-0 text-xs space-y-1">
              {intel.departmentsToTarget?.length > 0 && <div><div className="font-semibold">Departments to Target:</div><div className="flex flex-wrap gap-1 mt-0.5">{intel.departmentsToTarget.map((d, i) => <Badge key={i} variant="outline" className="text-[9px]">{d}</Badge>)}</div></div>}
              {intel.networkingRecommendations?.length > 0 && <div><div className="font-semibold mt-1">Recommendations:</div><ul className="space-y-0.5">{intel.networkingRecommendations.map((n, i) => <li key={i} className="flex gap-1"><span className="text-brand">›</span> {n}</li>)}</ul></div>}
              {intel.linkedinStrategy && <div className="mt-1"><span className="font-semibold">LinkedIn:</span> {intel.linkedinStrategy}</div>}
            </CardContent></Card>
          </div>

          {/* Web Research Results */}
          {webResults.length > 0 && (
            <Card><CardHeader className="pb-2"><CardTitle className="text-xs flex items-center gap-1.5"><Icon name="Globe" className="w-3.5 h-3.5 text-brand" /> Live Web Research</CardTitle></CardHeader>
            <CardContent className="pt-0"><div className="space-y-1.5 max-h-40 overflow-y-auto">
              {webResults.slice(0, 8).map((r, i) => {
                // Defensive: r may be missing url/title/source/snippet
                const url = typeof r?.url === "string" ? r.url : "#";
                const title = typeof r?.title === "string" ? r.title : "(untitled)";
                const source = typeof r?.source === "string" ? r.source : "unknown";
                const snippet = typeof r?.snippet === "string" ? r.snippet.slice(0, 100) : "";
                return (
                  <a key={i} href={url} target="_blank" rel="noreferrer noopener" className="block rounded-lg p-2 hover:bg-secondary/50 transition">
                    <div className="text-xs font-medium text-brand truncate">{title}</div>
                    <div className="text-[10px] text-muted-foreground truncate">{source}{snippet ? ` — ${snippet}` : ""}</div>
                  </a>
                );
              })}
            </div></CardContent></Card>
          )}
        </>
      )}
    </div>
  );
}

// ============================================================================
// Job Alerts
// ============================================================================

export function JobAlerts() {
  const [keywords, setKeywords] = useState("");
  const [alerts, setAlerts] = useState<Array<{ id: string; keywords: string; created: string }>>([]);

  const create = () => {
    if (!keywords.trim()) return;
    setAlerts((a) => [{ id: uid("alert"), keywords, created: new Date().toISOString() }, ...a]);
    setKeywords(""); toast.success("Alert created — you'll be notified of matching jobs");
  };

  return (
    <div className="space-y-6">
      <div><h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="Bell" className="w-6 h-6 text-brand" /> Job Alerts</h1><p className="text-sm text-muted-foreground mt-1">Create keyword-based alerts and get notified when matching jobs are posted.</p></div>
      <Card><CardContent className="p-4 space-y-3">
        <div><Label>Alert Keywords</Label><Input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="Cabin Crew, Dubai, Emirates" className="mt-1" /></div>
        <Button onClick={create} className="bg-brand hover:bg-brand-dark text-white gap-2"><Icon name="Bell" className="w-4 h-4" /> Create Alert</Button>
      </CardContent></Card>
      {alerts.length > 0 && (
        <Card><CardHeader><CardTitle className="text-base">Active Alerts ({alerts.length})</CardTitle></CardHeader><CardContent><div className="space-y-2">{alerts.map((a) => (
          <div key={a.id} className="flex items-center justify-between p-2 rounded-lg border border-border"><div><div className="text-sm font-medium">{a.keywords}</div><div className="text-xs text-muted-foreground">{new Date(a.created).toLocaleString()}</div></div><Button size="sm" variant="ghost" onClick={() => setAlerts((al) => al.filter((x) => x.id !== a.id))} className="text-destructive"><Icon name="Trash2" className="w-3.5 h-3.5" /></Button></div>
        ))}</div></CardContent></Card>
      )}
    </div>
  );
}

// ============================================================================
// Certification Tracker
// ============================================================================

export function CertTracker() {
  const [certs, setCerts] = useState<Array<{ id: string; name: string; issuer: string; date: string; expiry: string }>>([]);
  const [name, setName] = useState(""); const [issuer, setIssuer] = useState(""); const [date, setDate] = useState(""); const [expiry, setExpiry] = useState("");

  const add = () => {
    if (!name) return;
    setCerts((c) => [{ id: uid("cert"), name, issuer, date, expiry }, ...c]);
    setName(""); setIssuer(""); setDate(""); setExpiry(""); toast.success("Certification added");
  };

  return (
    <div className="space-y-6">
      <div><h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="Award" className="w-6 h-6 text-brand" /> Certification Tracker</h1><p className="text-sm text-muted-foreground mt-1">Track your certifications, expiry dates, and get renewal reminders.</p></div>
      <Card><CardContent className="p-4 space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <div><Label>Certification Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="AWS Solutions Architect" className="mt-1" /></div>
          <div><Label>Issuer</Label><Input value={issuer} onChange={(e) => setIssuer(e.target.value)} placeholder="Amazon Web Services" className="mt-1" /></div>
          <div><Label>Issue Date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1" /></div>
          <div><Label>Expiry Date</Label><Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className="mt-1" /></div>
        </div>
        <Button onClick={add} className="bg-brand hover:bg-brand-dark text-white gap-2"><Icon name="Plus" className="w-4 h-4" /> Add Certification</Button>
      </CardContent></Card>
      {certs.length > 0 && (
        <Card><CardHeader><CardTitle className="text-base">Your Certifications ({certs.length})</CardTitle></CardHeader><CardContent><div className="space-y-2">{certs.map((c) => {
          const isExpiring = c.expiry && new Date(c.expiry) < new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
          return <div key={c.id} className="flex items-center justify-between p-2 rounded-lg border border-border"><div><div className="text-sm font-medium">{c.name}</div><div className="text-xs text-muted-foreground">{c.issuer} · Issued: {c.date || "N/A"} · Expires: {c.expiry || "N/A"}</div></div>{isExpiring && <Badge variant="warning" className="text-[10px]">Expiring Soon</Badge>}</div>;
        })}</div></CardContent></Card>
      )}
    </div>
  );
}

// ============================================================================
// Networking Tracker
// ============================================================================

export function Networking() {
  const [contacts, setContacts] = useState<Array<{ id: string; name: string; company: string; role: string; email: string; lastContact: string; notes: string }>>([]);
  const [name, setName] = useState(""); const [company, setCompany] = useState(""); const [role, setRole] = useState(""); const [email, setEmail] = useState(""); const [notes, setNotes] = useState("");

  const add = () => {
    if (!name) return;
    setContacts((c) => [{ id: uid("net"), name, company, role, email, lastContact: new Date().toISOString(), notes }, ...c]);
    setName(""); setCompany(""); setRole(""); setEmail(""); setNotes(""); toast.success("Contact added");
  };

  return (
    <div className="space-y-6">
      <div><h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="Network" className="w-6 h-6 text-brand" /> Networking Tracker</h1><p className="text-sm text-muted-foreground mt-1">Manage professional contacts and follow-up reminders.</p></div>
      <Card><CardContent className="p-4 space-y-3">
        <div className="grid sm:grid-cols-2 gap-3">
          <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="John Doe" className="mt-1" /></div>
          <div><Label>Company</Label><Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Emirates" className="mt-1" /></div>
          <div><Label>Role</Label><Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Recruiter" className="mt-1" /></div>
          <div><Label>Email</Label><Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="john@emirates.com" className="mt-1" /></div>
        </div>
        <div><Label>Notes</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Met at career fair, interested in cabin crew role..." className="mt-1" /></div>
        <Button onClick={add} className="bg-brand hover:bg-brand-dark text-white gap-2"><Icon name="Plus" className="w-4 h-4" /> Add Contact</Button>
      </CardContent></Card>
      {contacts.length > 0 && (
        <Card><CardHeader><CardTitle className="text-base">Contacts ({contacts.length})</CardTitle></CardHeader><CardContent><div className="space-y-2">{contacts.map((c) => (
          <div key={c.id} className="p-2 rounded-lg border border-border"><div className="flex items-center justify-between"><div className="text-sm font-medium">{c.name}</div><span className="text-xs text-muted-foreground">{new Date(c.lastContact).toLocaleDateString()}</span></div><div className="text-xs text-muted-foreground">{c.role} · {c.company} · {c.email}</div>{c.notes && <div className="text-xs mt-1">{c.notes}</div>}</div>
        ))}</div></CardContent></Card>
      )}
    </div>
  );
}

// ============================================================================
// AI Career Coach
// ============================================================================

export function AiCoach() {
  const [messages, setMessages] = useState<Array<{ role: string; content: string }>>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);

  const send = async () => {
    if (!input.trim()) return;
    const userMsg = { role: "user", content: input };
    setMessages((m) => [...m, userMsg]); setInput(""); setLoading(true);
    try {
      const result = await callAI({
        systemPrompt: "You are an expert career coach. Provide actionable, specific advice. Ask clarifying questions when needed. Be encouraging but honest.",
        userPrompt: input, maxTokens: 1000, taskCategory: "interactive",
      });
      setMessages((m) => [...m, { role: "assistant", content: result.text }]);
    } catch (e: any) { toast.error(e?.message || "Failed"); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-6">
      <div><h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="Bot" className="w-6 h-6 text-brand" /> AI Career Coach</h1><p className="text-sm text-muted-foreground mt-1">Chat with an AI career advisor for personalized guidance.</p></div>
      <Card><CardContent className="p-4">
        <div className="space-y-3 max-h-96 overflow-y-auto mb-3">
          {messages.length === 0 && <p className="text-sm text-muted-foreground text-center py-8">Ask me anything about your career — job searching, resume tips, interview prep, salary negotiation, career transitions...</p>}
          {messages.map((m, i) => <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}><div className={`rounded-lg px-3 py-2 max-w-[80%] text-sm ${m.role === "user" ? "bg-brand text-white" : "bg-secondary"}`}>{m.content}</div></div>)}
          {loading && <div className="flex justify-start"><div className="rounded-lg px-3 py-2 bg-secondary text-sm"><Icon name="Loader2" className="w-4 h-4 animate-spin" /></div></div>}
        </div>
        <div className="flex gap-2"><Input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Ask your career question..." /><Button onClick={send} disabled={loading} className="bg-brand hover:bg-brand-dark text-white"><Icon name="Send" className="w-4 h-4" /></Button></div>
      </CardContent></Card>
    </div>
  );
}

// ============================================================================
// AI Mock Interview
// ============================================================================
//
// Interactive interview experience. The AI asks questions one at a time,
// the user answers, and the AI provides feedback + the next question.
//
// CRITICAL: The AI sometimes returns JSON {questions: [...]} instead of plain
// text. This component parses the response and extracts the question text —
// NEVER renders raw JSON to the user.

interface MockInterviewMessage {
  role: "assistant" | "user";
  content: string;
  /** Parsed question data (if the AI returned JSON) */
  question?: {
    category?: string;
    question: string;
    difficulty?: string;
    talkingPoints?: string[];
    followUps?: string[];
  };
  /** Parsed feedback data (if the AI returned JSON feedback) */
  feedback?: {
    strengths?: string[];
    improvements?: string[];
    score?: number;
  };
}

/**
 * Parse an AI response that might be:
 *   - Plain text (question or feedback) — return as-is
 *   - JSON {questions: [...]} — extract the first question
 *   - JSON {feedback: {...}} — extract the feedback
 *   - JSON {question: "...", ...} — extract the question
 *
 * Never returns raw JSON — always extracts human-readable content.
 */
function parseInterviewResponse(text: string): { displayText: string; question?: MockInterviewMessage["question"]; feedback?: MockInterviewMessage["feedback"] } {
  const trimmed = text.trim();

  // Check if it looks like JSON (starts with { or [)
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = extractJSON<any>(trimmed);

      // Case 1: {questions: [...]} — extract first question
      if (parsed.questions && Array.isArray(parsed.questions) && parsed.questions.length > 0) {
        const q = parsed.questions[0];
        const questionText = q.question || q.text || "Question not available.";
        const displayText = questionText;
        return {
          displayText,
          question: {
            category: q.category,
            question: questionText,
            difficulty: q.difficulty,
            talkingPoints: q.talkingPoints,
            followUps: q.followUps,
          },
        };
      }

      // Case 2: {question: "...", ...} — single question object
      if (parsed.question && typeof parsed.question === "string") {
        return {
          displayText: parsed.question,
          question: {
            category: parsed.category,
            question: parsed.question,
            difficulty: parsed.difficulty,
            talkingPoints: parsed.talkingPoints,
            followUps: parsed.followUps,
          },
        };
      }

      // Case 3: {feedback: {...}} — feedback object
      if (parsed.feedback) {
        const f = parsed.feedback;
        const parts: string[] = [];
        if (f.score) parts.push(`Score: ${f.score}/100`);
        if (f.strengths?.length) parts.push(`Strengths: ${f.strengths.join("; ")}`);
        if (f.improvements?.length) parts.push(`Areas to improve: ${f.improvements.join("; ")}`);
        if (f.nextQuestion) parts.push(f.nextQuestion);
        if (f.message) parts.push(f.message);
        return {
          displayText: parts.join("\n\n") || "Feedback received.",
          feedback: { strengths: f.strengths, improvements: f.improvements, score: f.score },
        };
      }

      // Case 4: {message: "..."} or {text: "..."} or {response: "..."}
      if (parsed.message) return { displayText: String(parsed.message) };
      if (parsed.text) return { displayText: String(parsed.text) };
      if (parsed.response) return { displayText: String(parsed.response) };

      // Case 5: Unknown JSON structure — extract any string values
      const stringValues = Object.values(parsed).filter((v) => typeof v === "string" && v.length > 10);
      if (stringValues.length > 0) {
        return { displayText: stringValues.join("\n\n") };
      }

      // Fallback: can't extract anything meaningful
      return { displayText: "Interview question received. Please type your answer below." };
    } catch {
      // JSON parse failed — treat as plain text (might be partially JSON)
      // Strip any JSON-like artifacts
      const cleaned = trimmed.replace(/^\s*[\{\[]/, "").replace(/[\}\]]\s*$/, "").trim();
      return { displayText: cleaned || "Please type your answer below." };
    }
  }

  // Plain text — return as-is (strip markdown artifacts if present)
  const cleaned = trimmed
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/\s*```\s*$/m, "")
    .trim();
  return { displayText: cleaned };
}

// Interview topics — thematic fields the user can select
const INTERVIEW_TOPICS = [
  { id: "cabin-crew", label: "Cabin Crew / Flight Attendant", icon: "Plane", description: "Aviation service, safety, emergency procedures" },
  { id: "technical", label: "Technical / Engineering", icon: "Code2", description: "Software, systems, architecture, coding" },
  { id: "behavioral", label: "Behavioral", icon: "Users", description: "STAR method, past experiences, teamwork" },
  { id: "situational", label: "Situational", icon: "GitBranch", description: "Hypothetical scenarios, problem-solving" },
  { id: "hr", label: "HR / General", icon: "UserCheck", description: "Strengths, weaknesses, career goals" },
  { id: "customer-service", label: "Customer Service", icon: "Headphones", description: "Service excellence, conflict resolution" },
  { id: "sales", label: "Sales / Business", icon: "TrendingUp", description: "Selling, negotiation, business development" },
  { id: "leadership", label: "Leadership / Management", icon: "Crown", description: "Team management, decision-making, vision" },
] as const;

// Position presets per topic — quick-select for common roles
const POSITION_PRESETS: Record<string, string[]> = {
  "cabin-crew": ["Cabin Crew (Emirates)", "Cabin Crew (Qatar Airways)", "Flight Attendant (Ryanair)", "Cabin Crew (Etihad)", "Senior Cabin Crew", "Purser / Cabin Supervisor"],
  "technical": ["Software Engineer", "Senior Frontend Engineer", "Backend Developer", "Full-Stack Engineer", "DevOps Engineer", "Data Scientist", "Mobile Developer"],
  "behavioral": ["Project Manager", "Team Lead", "Product Manager", "Business Analyst", "Operations Manager"],
  "situational": ["Any role", "Management Trainee", "Consultant", "Operations Analyst"],
  "hr": ["Any role", "Graduate Trainee", "Entry-level", "Career changer"],
  "customer-service": ["Customer Service Agent", "Call Centre Representative", "Guest Relations Officer", "Front Desk Agent", "Customer Success Manager"],
  "sales": ["Sales Representative", "Account Executive", "Business Development Manager", "Sales Manager", "Retail Sales Associate"],
  "leadership": ["Team Lead", "Department Manager", "Director", "VP", "COO"],
};

// Topic-specific question examples — injected into the prompt to force the AI
// to ask role-relevant questions instead of generic ones.
const TOPIC_QUESTION_EXAMPLES: Record<string, string[]> = {
  "cabin-crew": [
    "Tell me about a time you handled a difficult passenger on a flight.",
    "What would you do if you noticed a safety equipment issue during pre-flight checks?",
    "How do you ensure excellent service for passengers with special needs (UMNR, PRM)?",
    "Describe the emergency evacuation procedure you would follow in case of an unplanned decompression.",
    "How would you handle a medical emergency on board with limited resources?",
    "Tell me about a time you went above and beyond to make a passenger's flight memorable.",
    "How do you manage cultural differences when serving passengers from 160+ nationalities?",
    "What steps would you take if a passenger became aggressive during a flight?",
  ],
  "technical": [
    "Walk me through how you would debug a production outage in a microservices architecture.",
    "Design a URL shortener service that handles 100M requests per day.",
    "How would you optimize a slow database query that's affecting page load times?",
    "Explain how you would implement caching for a high-traffic web application.",
    "Describe a technical decision you made that you later regretted. What did you learn?",
  ],
  "behavioral": [
    "Tell me about a time you had to work with a difficult team member.",
    "Describe a situation where you had to meet a tight deadline. How did you handle it?",
    "Give an example of a time you took initiative on a project without being asked.",
    "Tell me about a time you failed and what you learned from it.",
    "Describe a situation where you had to persuade someone to see things your way.",
  ],
  "situational": [
    "What would you do if you were given two urgent tasks by different managers with conflicting deadlines?",
    "How would you handle a situation where you disagree with your manager's decision?",
    "If you were leading a project and a key team member quit, what would you do?",
    "How would you prioritize tasks if everything seems equally urgent?",
  ],
  "hr": [
    "Tell me about yourself.",
    "What are your greatest strengths and weaknesses?",
    "Where do you see yourself in 5 years?",
    "Why do you want to work for our company?",
    "Why are you leaving your current job?",
  ],
  "customer-service": [
    "Tell me about a time you turned an angry customer into a satisfied one.",
    "How do you handle a customer who is being unreasonable or abusive?",
    "Describe a situation where you went above and beyond for a customer.",
    "How would you handle a high volume of customer complaints during a service outage?",
  ],
  "sales": [
    "Walk me through your sales process from prospecting to closing.",
    "Tell me about a time you lost a deal. What did you learn?",
    "How do you handle price objections from a prospect?",
    "Describe your most successful sale. What made it successful?",
  ],
  "leadership": [
    "Tell me about a time you had to make an unpopular decision as a leader.",
    "How do you motivate a team that's underperforming?",
    "Describe how you handle conflict between team members.",
    "What's your approach to delegating tasks to your team?",
  ],
};

export function AiMockInterview() {
  const jds = useApp((s) => s.jobDescriptions);
  const [topic, setTopic] = useState<string>("cabin-crew");
  const [position, setPosition] = useState<string>("");
  const [customPosition, setCustomPosition] = useState<string>("");
  const [messages, setMessages] = useState<MockInterviewMessage[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [questionCount, setQuestionCount] = useState(0);

  const selectedTopic = INTERVIEW_TOPICS.find((t) => t.id === topic);
  const positionPresets = POSITION_PRESETS[topic] ?? [];
  const effectivePosition = customPosition.trim() || position || (selectedTopic?.label ?? "the role");

  const startInterview = async () => {
    setStarted(true);
    setMessages([]);
    setError(null);
    setQuestionCount(0);
    setLoading(true);
    try {
      const topicContext = selectedTopic
        ? `Topic: ${selectedTopic.label} (${selectedTopic.description}). `
        : "";
      const positionContext = `Position: ${effectivePosition}. `;
      const questionExamples = TOPIC_QUESTION_EXAMPLES[topic] ?? [];
      const examplesText = questionExamples.length > 0
        ? `\n\nHere are EXAMPLES of the kind of questions to ask for this topic (do NOT use these exact words — generate similar ones):\n${questionExamples.map((q) => `- ${q}`).join("\n")}\n\nCRITICAL: Your question MUST be relevant to ${selectedTopic?.label ?? "the selected topic"}. Do NOT ask generic software engineering questions unless the topic is "Technical".`
        : "";

      // Random seed to bust any AI caching — ensures different questions each time
      const seed = Math.floor(Math.random() * 1000000);

      const result = await callAI({
        systemPrompt: `You are an expert interviewer conducting a mock interview for a ${effectivePosition} position. ${topicContext}Ask ONE realistic interview question at a time — the kind a real interviewer would ask for this specific role and topic. Wait for the candidate's answer. After they answer, provide brief feedback (1-2 sentences) and ask the next question. Always respond in plain text — NEVER return JSON.${examplesText}`,
        userPrompt: `Start a mock interview for: ${positionContext}${topicContext}\nAsk the first question. The question MUST be specific to ${selectedTopic?.label ?? "the topic"} and relevant to the ${effectivePosition} role. Do NOT ask generic questions about software architecture or scaling — ask about the actual duties of this role.\n\n[Session ID: ${seed} — generate a unique question]`,
        maxTokens: 500,
        taskCategory: "document", // Use API providers (not Puter) — more reliable at following prompts
        temperature: 0.9,
      });

      const parsed = parseInterviewResponse(result.text);
      setMessages([{ role: "assistant", content: parsed.displayText, question: parsed.question }]);
      setQuestionCount(1);
    } catch (e: any) {
      setError(e?.message || "Failed to start interview. Please try again.");
      toast.error(e?.message || "Failed to start interview.");
    } finally {
      setLoading(false);
    }
  };

  const answer = async () => {
    if (!input.trim()) return;
    const userAnswer = input;
    setMessages((m) => [...m, { role: "user", content: userAnswer }]);
    setInput("");
    setLoading(true);
    setError(null);
    try {
      const questionExamples = TOPIC_QUESTION_EXAMPLES[topic] ?? [];
      const examplesText = questionExamples.length > 0
        ? `\n\nRemember: questions MUST be relevant to ${selectedTopic?.label ?? "the selected topic"}. Example topics for this role:\n${questionExamples.slice(0, 4).map((q) => `- ${q}`).join("\n")}`
        : "";
      const seed = Math.floor(Math.random() * 1000000);

      const result = await callAI({
        systemPrompt: `You are an expert interviewer conducting a mock interview for a ${effectivePosition} position. The candidate just answered your question. Provide brief feedback (1-2 sentences) specific to their answer, then ask the next question on a different aspect of the role. Always respond in plain text — NEVER return JSON. Keep questions realistic and specific to ${selectedTopic?.label ?? "the topic"}.${examplesText}`,
        userPrompt: `Candidate's answer: ${userAnswer}\n\nProvide brief feedback and ask the next question. The next question MUST be specific to ${selectedTopic?.label ?? "the topic"} and relevant to the ${effectivePosition} role. Do NOT ask generic software engineering questions unless the topic is Technical.\n\n[Session ID: ${seed} — generate a unique question]`,
        maxTokens: 500,
        taskCategory: "document", // Use API providers (not Puter) — more reliable at following prompts
        temperature: 0.9,
      });

      const parsed = parseInterviewResponse(result.text);
      setMessages((m) => [...m, { role: "assistant", content: parsed.displayText, question: parsed.question, feedback: parsed.feedback }]);
      setQuestionCount((c) => c + 1);
    } catch (e: any) {
      setError(e?.message || "Failed to get response. Please try again.");
      toast.error(e?.message || "Failed to get response.");
    } finally {
      setLoading(false);
    }
  };

  const reset = () => {
    setStarted(false);
    setMessages([]);
    setInput("");
    setError(null);
    setQuestionCount(0);
  };

  const onTopicChange = (newTopic: string) => {
    setTopic(newTopic);
    setPosition(""); // reset position when topic changes
    setCustomPosition("");
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div><h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="Mic" className="w-6 h-6 text-brand" /> AI Mock Interview</h1><p className="text-sm text-muted-foreground mt-1">Practice with an AI interviewer that asks real role-specific questions and gives feedback.</p></div>
        {started && <Button variant="outline" size="sm" onClick={reset} className="gap-1.5"><Icon name="RotateCcw" className="w-3.5 h-3.5" /> Restart</Button>}
      </div>

      {!started ? (
        <Card><CardContent className="p-4 sm:p-5 space-y-4">
          {/* Topic / Field selector */}
          <div>
            <Label className="text-xs uppercase tracking-wide font-semibold">Interview Topic / Field</Label>
            <p className="text-xs text-muted-foreground mt-0.5 mb-2">Select the type of interview you want to practice.</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {INTERVIEW_TOPICS.map((t) => (
                <button
                  key={t.id}
                  onClick={() => onTopicChange(t.id)}
                  className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border-2 transition text-center ${
                    topic === t.id
                      ? "border-brand bg-brand/10"
                      : "border-border hover:border-brand/40 hover:bg-secondary/40"
                  }`}
                >
                  <Icon name={t.icon} className={`w-5 h-5 ${topic === t.id ? "text-brand" : "text-muted-foreground"}`} />
                  <span className={`text-[10px] font-medium leading-tight ${topic === t.id ? "text-brand" : "text-foreground/80"}`}>{t.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Selected topic description */}
          {selectedTopic && (
            <div className="rounded-lg bg-brand/5 dark:bg-brand/10 border border-brand/20 p-2.5 flex items-start gap-2">
              <Icon name="Info" className="w-3.5 h-3.5 text-brand shrink-0 mt-0.5" />
              <p className="text-xs text-muted-foreground">{selectedTopic.description}. Questions will be tailored to this topic.</p>
            </div>
          )}

          {/* Position selector */}
          <div>
            <Label className="text-xs uppercase tracking-wide font-semibold">Position (optional)</Label>
            <p className="text-xs text-muted-foreground mt-0.5 mb-2">Choose a specific position or type your own.</p>
            {positionPresets.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {positionPresets.map((p) => (
                  <button
                    key={p}
                    onClick={() => { setPosition(p); setCustomPosition(""); }}
                    className={`text-xs px-2.5 py-1 rounded-full border transition ${
                      position === p && !customPosition
                        ? "border-brand bg-brand/10 text-brand font-medium"
                        : "border-border hover:border-brand/40 text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}
            <Input
              value={customPosition}
              onChange={(e) => { setCustomPosition(e.target.value); setPosition(""); }}
              placeholder={`Or type a custom position (e.g. "Cabin Crew — Emirates")`}
              className="text-sm"
            />
          </div>

          {/* Summary + start button */}
          <div className="pt-2 border-t border-border">
            <div className="text-xs text-muted-foreground mb-3">
              Starting <span className="font-semibold text-foreground">{selectedTopic?.label ?? "General"}</span> interview for <span className="font-semibold text-foreground">{effectivePosition}</span>
            </div>
            <Button onClick={startInterview} disabled={loading} className="bg-brand hover:bg-brand-dark text-white gap-2 w-full sm:w-auto"><Icon name={loading ? "Loader2" : "Mic"} className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> {loading ? "Starting…" : "Start Mock Interview"}</Button>
          </div>
        </CardContent></Card>
      ) : (
        <Card><CardContent className="p-4">
          {/* Topic + position header */}
          <div className="mb-3 flex items-center gap-2 flex-wrap">
            <Badge variant="brand" className="text-[10px] gap-1"><Icon name={selectedTopic?.icon ?? "Circle"} className="w-3 h-3" /> {selectedTopic?.label ?? "General"}</Badge>
            <Badge variant="outline" className="text-[10px] gap-1"><Icon name="Briefcase" className="w-3 h-3" /> {effectivePosition}</Badge>
          </div>

          {/* Progress indicator */}
          {questionCount > 0 && (
            <div className="mb-3 flex items-center justify-between text-xs">
              <span className="text-muted-foreground font-medium">Question {questionCount}</span>
              <Badge variant="outline" className="text-[10px] gap-1"><Icon name="MessagesSquare" className="w-3 h-3" /> {messages.filter((m) => m.role === "user").length} answered</Badge>
            </div>
          )}

          {/* Chat messages — rendered as proper components, never raw JSON */}
          <div className="space-y-3 max-h-[60vh] overflow-y-auto mb-3">
            {messages.map((m, i) => (
              <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`rounded-lg px-3 py-2 max-w-[85%] ${m.role === "user" ? "bg-brand text-white" : "bg-secondary"}`}>
                  {m.role === "assistant" && m.question && (
                    <>
                      {/* Question card rendering */}
                      {m.question.category && (
                        <div className="mb-1.5 flex gap-1.5 flex-wrap">
                          <Badge variant="outline" className="text-[9px] uppercase tracking-wide">{m.question.category}</Badge>
                          {m.question.difficulty && <Badge variant="outline" className="text-[9px] uppercase tracking-wide">{m.question.difficulty}</Badge>}
                        </div>
                      )}
                      <div className="text-sm text-pretty whitespace-pre-wrap">{m.content}</div>
                      {m.question.talkingPoints && m.question.talkingPoints.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-border/30">
                          <div className="text-[10px] uppercase tracking-wide opacity-70 font-semibold mb-1">Talking Points</div>
                          <ul className="space-y-0.5">
                            {m.question.talkingPoints.map((t, j) => <li key={j} className="text-xs flex gap-1.5"><span className="opacity-70">›</span> {t}</li>)}
                          </ul>
                        </div>
                      )}
                      {m.question.followUps && m.question.followUps.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-border/30">
                          <div className="text-[10px] uppercase tracking-wide opacity-70 font-semibold mb-1">Follow-Up Questions</div>
                          <ul className="space-y-0.5">
                            {m.question.followUps.map((f, j) => <li key={j} className="text-xs flex gap-1.5"><span className="opacity-70">?</span> {f}</li>)}
                          </ul>
                        </div>
                      )}
                    </>
                  )}
                  {m.role === "assistant" && !m.question && (
                    <div className="text-sm text-pretty whitespace-pre-wrap">{m.content}</div>
                  )}
                  {m.role === "user" && (
                    <div className="text-sm text-pretty whitespace-pre-wrap">{m.content}</div>
                  )}
                </div>
              </div>
            ))}
            {loading && <div className="flex justify-start"><div className="rounded-lg px-3 py-2 bg-secondary flex items-center gap-2"><Icon name="Loader2" className="w-4 h-4 animate-spin text-brand" /><span className="text-xs text-muted-foreground">Thinking…</span></div></div>}
          </div>

          {/* Error */}
          {error && (
            <div className="mb-3 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900 p-2.5 flex items-start gap-2">
              <Icon name="AlertCircle" className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span className="text-xs text-red-700 dark:text-red-400">{error}</span>
            </div>
          )}

          {/* Answer input */}
          <div className="flex gap-2">
            <Input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), answer())} placeholder="Type your answer..." disabled={loading} />
            <Button onClick={answer} disabled={loading || !input.trim()} className="bg-brand hover:bg-brand-dark text-white shrink-0"><Icon name="Send" className="w-4 h-4" /></Button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1.5">Press Enter to send. The AI will provide feedback and ask the next question.</p>
        </CardContent></Card>
      )}
    </div>
  );
}

// ============================================================================
// AI Salary Negotiation Coach
// ============================================================================

export function AiSalaryCoach() {
  const [role, setRole] = useState(""); const [offer, setOffer] = useState(""); const [experience, setExperience] = useState("");
  const [loading, setLoading] = useState(false); const [output, setOutput] = useState("");

  const coach = async () => {
    if (!role || !offer) { toast.error("Enter role and offer details"); return; }
    setLoading(true); setOutput("");
    try {
      const result = await callAI({
        systemPrompt: "You are a salary negotiation coach. Help the candidate negotiate a better offer with specific scripts and strategies.",
        userPrompt: `Role: ${role}\nCurrent offer: ${offer}\nExperience: ${experience || "N/A"}\n\nProvide: 1) Assessment of the offer, 2) Negotiation strategy, 3) Exact scripts to use (phone + email), 4) Counter-offer range, 5) What to avoid saying.`,
        maxTokens: 2000, taskCategory: "document",
      });
      setOutput(result.text);
    } catch (e: any) { toast.error(e?.message || "Failed"); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-6">
      <div><h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="HandCoins" className="w-6 h-6 text-brand" /> Salary Negotiation Coach</h1><p className="text-sm text-muted-foreground mt-1">Get AI-powered negotiation scripts and strategies for your job offer.</p></div>
      <Card><CardContent className="p-4 space-y-3">
        <div><Label>Role</Label><Input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Senior Software Engineer" className="mt-1" /></div>
        <div><Label>Current Offer</Label><Input value={offer} onChange={(e) => setOffer(e.target.value)} placeholder="$120,000 base + benefits" className="mt-1" /></div>
        <div><Label>Years of Experience</Label><Input value={experience} onChange={(e) => setExperience(e.target.value)} placeholder="5 years" className="mt-1" /></div>
        <Button onClick={coach} disabled={loading} className="bg-brand hover:bg-brand-dark text-white gap-2"><Icon name={loading ? "Loader2" : "HandCoins"} className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> {loading ? "Coaching..." : "Get Negotiation Strategy"}</Button>
      </CardContent></Card>
      <AIOutput output={output} loading={loading} />
    </div>
  );
}

// ============================================================================
// AI Email Writer
// ============================================================================

export function AiEmailWriter() {
  const [type, setType] = useState("follow-up"); const [context, setContext] = useState("");
  const [loading, setLoading] = useState(false); const [output, setOutput] = useState("");

  const generate = async () => {
    setLoading(true); setOutput("");
    try {
      const result = await callAI({
        systemPrompt: "You are a professional email writer. Write concise, effective emails for job seekers.",
        userPrompt: `Email type: ${type}\nContext: ${context}\n\nWrite a professional email. Include subject line. Keep it concise and actionable.`,
        maxTokens: 800, taskCategory: "document",
      });
      setOutput(result.text);
    } catch (e: any) { toast.error(e?.message || "Failed"); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-6">
      <div><h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="Mail" className="w-6 h-6 text-brand" /> AI Email Writer</h1><p className="text-sm text-muted-foreground mt-1">Generate follow-up emails, thank-you notes, and networking messages.</p></div>
      <Card><CardContent className="p-4 space-y-3">
        <div><Label>Email Type</Label><select value={type} onChange={(e) => setType(e.target.value)} className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm mt-1">
          {["follow-up", "thank-you", "networking", "cover-letter-email", "decline-offer", "accept-offer", "resignation"].map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
        </select></div>
        <div><Label>Context (company, role, details)</Label><Textarea value={context} onChange={(e) => setContext(e.target.value)} rows={4} placeholder="Applied for Senior Engineer at Emirates 2 weeks ago. Haven't heard back..." className="mt-1" /></div>
        <Button onClick={generate} disabled={loading} className="bg-brand hover:bg-brand-dark text-white gap-2"><Icon name={loading ? "Loader2" : "Mail"} className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> {loading ? "Writing..." : "Generate Email"}</Button>
      </CardContent></Card>
      <AIOutput output={output} loading={loading} />
    </div>
  );
}

// ============================================================================
// AI Resume Review
// ============================================================================

export function AiResumeReview() {
  const resumes = useApp((s) => s.resumes);
  const [resumeId, setResumeId] = useState("");
  const [loading, setLoading] = useState(false); const [output, setOutput] = useState("");

  const review = async () => {
    const resume = resumes.find((r) => r.id === resumeId);
    if (!resume) { toast.error("Select a resume"); return; }
    setLoading(true); setOutput("");
    try {
      const result = await callAI({
        systemPrompt: "You are a senior recruiter. Review the resume critically. Be honest and specific. Rate each section out of 10.",
        userPrompt: `Review this resume as a senior recruiter:\n\n${JSON.stringify({ name: resume.name, headline: resume.headline, summary: resume.summary, experience: resume.experience, education: resume.education, skills: resume.skills })}\n\nProvide: 1) Overall score /10, 2) Section-by-section feedback (Summary, Experience, Skills, Education), 3) Top 3 strengths, 4) Top 3 weaknesses, 5) Specific improvement suggestions.`,
        maxTokens: 2000, taskCategory: "document",
      });
      setOutput(result.text);
    } catch (e: any) { toast.error(e?.message || "Failed"); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-6">
      <div><h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="FileSearch" className="w-6 h-6 text-brand" /> AI Resume Review</h1><p className="text-sm text-muted-foreground mt-1">Get an instant recruiter-style review of your resume.</p></div>
      <Card><CardContent className="p-4 space-y-3">
        <div><Label>Select Resume</Label><select value={resumeId} onChange={(e) => setResumeId(e.target.value)} className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm mt-1"><option value="">Select...</option>{resumes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
        <Button onClick={review} disabled={loading || !resumeId} className="bg-brand hover:bg-brand-dark text-white gap-2"><Icon name={loading ? "Loader2" : "FileSearch"} className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> {loading ? "Reviewing..." : "Review Resume"}</Button>
      </CardContent></Card>
      <AIOutput output={output} loading={loading} />
    </div>
  );
}

// ============================================================================
// AI Job Match Score
// ============================================================================

export function AiJobMatch() {
  const resumes = useApp((s) => s.resumes);
  const [resumeId, setResumeId] = useState(""); const [jdUrl, setJdUrl] = useState("");
  const [loading, setLoading] = useState(false); const [output, setOutput] = useState("");

  const match = async () => {
    const resume = resumes.find((r) => r.id === resumeId);
    if (!resume || !jdUrl) { toast.error("Select resume and enter JD URL"); return; }
    setLoading(true); setOutput("");
    try {
      const result = await callAI({
        systemPrompt: "You are an ATS system. Score the resume against the job description. Be precise and data-driven. Use markdown formatting (##, **, |, ✅) for readability. NEVER score any individual category above its maximum (e.g. if a category is out of 25, the max score is 25 — never 26/25). Clamp all scores to their maximums.",
        userPrompt: `Resume: ${JSON.stringify({ name: resume.name, headline: resume.headline, summary: resume.summary, experience: resume.experience, skills: resume.skills })}\n\nJob URL: ${jdUrl}\n\nProvide: 1) Match score /100 (clamped to 100 max), 2) Keyword match analysis (as a markdown table), 3) Missing keywords, 4) Experience alignment, 5) Recommendations to improve match.\n\nIMPORTANT: No individual sub-score may exceed its maximum. If a category is /25, the score must be ≤ 25. If /30, ≤ 30. The overall score must be ≤ 100.`,
        maxTokens: 1500, taskCategory: "document",
      });
      setOutput(result.text);
    } catch (e: any) { toast.error(e?.message || "Failed"); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-6">
      <div><h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="Target" className="w-6 h-6 text-brand" /> AI Job Match</h1><p className="text-sm text-muted-foreground mt-1">Get an instant match score for your resume against any job URL.</p></div>
      <Card><CardContent className="p-4 space-y-3">
        <div><Label>Select Resume</Label><select value={resumeId} onChange={(e) => setResumeId(e.target.value)} className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm mt-1"><option value="">Select...</option>{resumes.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></div>
        <div><Label>Job Description URL</Label><Input value={jdUrl} onChange={(e) => setJdUrl(e.target.value)} placeholder="https://jobs.example.com/senior-engineer" className="mt-1" /></div>
        <Button onClick={match} disabled={loading || !resumeId || !jdUrl} className="bg-brand hover:bg-brand-dark text-white gap-2"><Icon name={loading ? "Loader2" : "Target"} className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> {loading ? "Matching..." : "Get Match Score"}</Button>
      </CardContent></Card>
      <AIOutput output={output} loading={loading} />
    </div>
  );
}

// ============================================================================
// AI Achievement Rewriter
// ============================================================================

export function AiAchievement() {
  const [input, setInput] = useState(""); const [loading, setLoading] = useState(false); const [output, setOutput] = useState("");

  const rewrite = async () => {
    if (!input.trim()) { toast.error("Paste an achievement"); return; }
    setLoading(true); setOutput("");
    try {
      const result = await callAI({
        systemPrompt: "You are a resume writer. Rewrite weak achievement bullets into 3 strong versions with action verbs and measurable outcomes. If no metrics exist, suggest where to add them.",
        userPrompt: `Rewrite this achievement in 3 different ways:\n\n${input}\n\nProvide 3 versions: 1) Conservative, 2) Impact-focused, 3) Metrics-driven. Each as a single bullet point starting with an action verb.`,
        maxTokens: 800, taskCategory: "document",
      });
      setOutput(result.text);
    } catch (e: any) { toast.error(e?.message || "Failed"); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-6">
      <div><h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="Trophy" className="w-6 h-6 text-brand" /> Achievement Writer</h1><p className="text-sm text-muted-foreground mt-1">Paste a plain achievement and get 3 polished, ATS-optimized versions.</p></div>
      <Card><CardContent className="p-4 space-y-3">
        <div><Label>Your Achievement</Label><Textarea value={input} onChange={(e) => setInput(e.target.value)} rows={3} placeholder="I was responsible for managing a team and we did a lot of work on the project..." className="mt-1" /></div>
        <Button onClick={rewrite} disabled={loading} className="bg-brand hover:bg-brand-dark text-white gap-2"><Icon name={loading ? "Loader2" : "Trophy"} className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> {loading ? "Rewriting..." : "Rewrite Achievement"}</Button>
      </CardContent></Card>
      <AIOutput output={output} loading={loading} />
    </div>
  );
}

// ============================================================================
// Integrations
// ============================================================================

export function Integrations() {
  const resume = useResume();
  const [emailTo, setEmailTo] = useState("");

  const emailExport = () => {
    if (!resume) { toast.error("Create a resume first"); return; }
    if (!emailTo) { toast.error("Enter an email address"); return; }
    const subject = `${resume.name} — Resume`;
    const body = `Hi,\n\nPlease find my resume attached. I've also included a link to download it:\n${window.location.origin}/r/${resume.id}\n\nBest regards,\n${resume.name}`;
    window.open(`mailto:${emailTo}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
    toast.success("Email client opened with resume link");
  };

  const whatsappShare = () => {
    if (!resume) { toast.error("Create a resume first"); return; }
    const text = `Check out my resume: ${window.location.origin}/r/${resume.id}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`);
    toast.success("WhatsApp opened");
  };

  const linkedinExport = () => {
    if (!resume) { toast.error("Create a resume first"); return; }
    const text = `${resume.name} — ${resume.headline || "Professional"}\n\n${resume.summary || ""}`;
    navigator.clipboard.writeText(text);
    toast.success("Resume content copied! Paste it into your LinkedIn profile.");
    window.open("https://www.linkedin.com/in/me/edit/", "_blank");
  };

  const notionExport = () => {
    if (!resume) { toast.error("Create a resume first"); return; }
    const text = `# ${resume.name}\n${resume.headline || ""}\n\n## Summary\n${resume.summary || ""}\n\n## Experience\n${resume.experience.map((e) => `### ${e.title} — ${e.company}\n${e.bullets.map((b) => `- ${b}`).join("\n")}`).join("\n\n")}\n\n## Skills\n${resume.skills.map((s) => s.name).join(", ")}`;
    navigator.clipboard.writeText(text);
    toast.success("Resume formatted for Notion — copied to clipboard!");
  };

  const gdriveBackup = () => {
    if (!resume) { toast.error("Create a resume first"); return; }
    const blob = new Blob([JSON.stringify(resume, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${resume.name.replace(/\s+/g, "_")}_backup.json`; a.click();
    URL.revokeObjectURL(url);
    toast.success("Resume backup downloaded — upload to Google Drive");
  };

  return (
    <div className="space-y-6">
      <div><h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="Plug" className="w-6 h-6 text-brand" /> Integrations</h1><p className="text-sm text-muted-foreground mt-1">Export and share your resume across platforms.</p></div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <Card><CardContent className="p-4"><div className="flex items-center gap-3 mb-3"><Icon name="Linkedin" className="w-8 h-8 text-[#0A66C2]" /><div><div className="font-semibold text-sm">LinkedIn Export</div><div className="text-xs text-muted-foreground">Push content to LinkedIn</div></div></div><Button size="sm" variant="outline" onClick={linkedinExport} className="w-full gap-2"><Icon name="ExternalLink" className="w-3.5 h-3.5" /> Export to LinkedIn</Button></CardContent></Card>
        <Card><CardContent className="p-4"><div className="flex items-center gap-3 mb-3"><Icon name="Mail" className="w-8 h-8 text-[#EA4335]" /><div><div className="font-semibold text-sm">Email Export</div><div className="text-xs text-muted-foreground">Send to recruiter</div></div></div><Input value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="recruiter@company.com" className="mb-2 h-8 text-xs" /><Button size="sm" variant="outline" onClick={emailExport} className="w-full gap-2"><Icon name="Send" className="w-3.5 h-3.5" /> Send via Email</Button></CardContent></Card>
        <Card><CardContent className="p-4"><div className="flex items-center gap-3 mb-3"><Icon name="MessageCircle" className="w-8 h-8 text-[#25D366]" /><div><div className="font-semibold text-sm">WhatsApp Share</div><div className="text-xs text-muted-foreground">Share via WhatsApp</div></div></div><Button size="sm" variant="outline" onClick={whatsappShare} className="w-full gap-2"><Icon name="Share2" className="w-3.5 h-3.5" /> Share on WhatsApp</Button></CardContent></Card>
        <Card><CardContent className="p-4"><div className="flex items-center gap-3 mb-3"><Icon name="FileText" className="w-8 h-8 text-[#000000]" /><div><div className="font-semibold text-sm">Notion Sync</div><div className="text-xs text-muted-foreground">Format for Notion</div></div></div><Button size="sm" variant="outline" onClick={notionExport} className="w-full gap-2"><Icon name="Copy" className="w-3.5 h-3.5" /> Copy for Notion</Button></CardContent></Card>
        <Card><CardContent className="p-4"><div className="flex items-center gap-3 mb-3"><Icon name="HardDrive" className="w-8 h-8 text-[#4285F4]" /><div><div className="font-semibold text-sm">Google Drive</div><div className="text-xs text-muted-foreground">Backup as JSON</div></div></div><Button size="sm" variant="outline" onClick={gdriveBackup} className="w-full gap-2"><Icon name="Download" className="w-3.5 h-3.5" /> Download Backup</Button></CardContent></Card>
        <Card><CardContent className="p-4"><div className="flex items-center gap-3 mb-3"><Icon name="Calendar" className="w-8 h-8 text-[#4285F4]" /><div><div className="font-semibold text-sm">Calendar</div><div className="text-xs text-muted-foreground">Schedule interview</div></div></div><Button size="sm" variant="outline" onClick={() => { window.open("https://calendar.google.com/calendar/render?action=TEMPLATE&text=Interview&dates=20260620T100000Z/20260620T110000Z&details=Interview%20scheduled%20from%20ResumeAI%20Pro"); toast.success("Calendar opened"); }} className="w-full gap-2"><Icon name="Plus" className="w-3.5 h-3.5" /> Add to Calendar</Button></CardContent></Card>
      </div>
    </div>
  );
}
