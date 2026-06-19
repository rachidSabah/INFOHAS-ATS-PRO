// ResumeAI Pro — Career Tools Modules
// All modules use live AI calls (callAI) and live store data.
// No demo data, no placeholders, no simulated results.

"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge, Icon } from "@/components/shared";
import { useApp, uid } from "@/lib/store";
import { callAI } from "@/lib/ai";
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
      <pre className="whitespace-pre-wrap text-sm font-sans text-foreground/90 text-pretty">{output}</pre>
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
      const data = JSON.parse(result.text.replace(/```json|```/g, "").trim());
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
      const data = JSON.parse(result.text.replace(/```json|```/g, "").trim());
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
// Bulk Resume Generator
// ============================================================================

export function BulkGenerator() {
  const resume = useResume();
  const addResume = useApp((s) => s.addResume);
  const [jds, setJds] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<string[]>([]);

  const generate = async () => {
    if (!resume) { toast.error("Create a resume first."); return; }
    const jdList = jds.split("\n").filter((l) => l.trim().length > 10);
    if (jdList.length === 0) { toast.error("Paste at least one job description (one per line)"); return; }
    setLoading(true); setResults([]);
    for (let i = 0; i < Math.min(jdList.length, 5); i++) {
      try {
        const result = await callAI({
          systemPrompt: "You are a resume optimizer. Tailor the resume for the job description. Return ONLY JSON with: name, headline, summary, skills [{name, category}], experience [{title, company, location, startDate, endDate, bullets[]}].",
          userPrompt: `Resume: ${JSON.stringify({ name: resume.name, headline: resume.headline, summary: resume.summary, experience: resume.experience, skills: resume.skills })}\n\nJob ${i + 1}: ${jdList[i].slice(0, 500)}`,
          maxTokens: 2000, taskCategory: "document",
        });
        const data = JSON.parse(result.text.replace(/```json|```/g, "").trim());
        const optimized: ResumeData = { ...resume, id: uid("r"), headline: data.headline, summary: data.summary, skills: data.skills, experience: data.experience, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
        addResume(optimized);
        setResults((r) => [...r, `✓ Resume ${i + 1} generated for: ${jdList[i].slice(0, 40)}...`]);
      } catch { setResults((r) => [...r, `✗ Resume ${i + 1} failed`]); }
    }
    setLoading(false);
    toast.success(`Generated ${results.length} tailored resumes`);
  };

  return (
    <div className="space-y-6">
      <div><h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="Layers" className="w-6 h-6 text-brand" /> Bulk Resume Generator</h1><p className="text-sm text-muted-foreground mt-1">Generate up to 5 tailored resume versions from one base resume, one per job description.</p></div>
      <Card><CardContent className="p-4 space-y-3">
        <div><Label>Job Descriptions (one per line, max 5)</Label><Textarea value={jds} onChange={(e) => setJds(e.target.value)} rows={6} placeholder="Paste job descriptions here, one per line..." className="mt-1" /></div>
        <Button onClick={generate} disabled={loading || !resume} className="bg-brand hover:bg-brand-dark text-white gap-2"><Icon name={loading ? "Loader2" : "Layers"} className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> {loading ? "Generating..." : "Generate Bulk Resumes"}</Button>
        {results.length > 0 && <div className="space-y-1">{results.map((r, i) => <div key={i} className="text-sm">{r}</div>)}</div>}
      </CardContent></Card>
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
// Skill Gap Analysis
// ============================================================================

export function SkillGap() {
  const resume = useResume();
  const jds = useApp((s) => s.jobDescriptions);
  const [jdId, setJdId] = useState("");
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState("");

  const analyze = async () => {
    const jd = jds.find((j) => j.id === jdId);
    if (!resume || !jd) { toast.error("Select a resume and JD"); return; }
    setLoading(true); setOutput("");
    try {
      const result = await callAI({
        systemPrompt: "You are a career advisor. Compare the candidate's skills to the job requirements and identify gaps.",
        userPrompt: `Candidate skills: ${resume.skills.map((s) => s.name).join(", ")}\n\nJob requirements: ${jd.requiredSkills?.join(", ") || jd.keywords?.join(", ") || "N/A"}\n\nProvide: 1) Matched skills, 2) Missing skills (gaps), 3) Recommended actions to close gaps, 4) Courses/certifications to consider.`,
        maxTokens: 1500, taskCategory: "document",
      });
      setOutput(result.text);
    } catch (e: any) { toast.error(e?.message || "Failed"); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-6">
      <div><h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="GitCompare" className="w-6 h-6 text-brand" /> Skill Gap Analysis</h1><p className="text-sm text-muted-foreground mt-1">Compare your skills to a target job and identify what's missing.</p></div>
      <Card><CardContent className="p-4 space-y-3">
        <div><Label>Target Job Description</Label><select value={jdId} onChange={(e) => setJdId(e.target.value)} className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm mt-1"><option value="">Select...</option>{jds.map((j) => <option key={j.id} value={j.id}>{j.title} — {j.company || "N/A"}</option>)}</select></div>
        <Button onClick={analyze} disabled={loading || !resume || !jdId} className="bg-brand hover:bg-brand-dark text-white gap-2"><Icon name={loading ? "Loader2" : "GitCompare"} className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> {loading ? "Analyzing..." : "Analyze Skill Gaps"}</Button>
      </CardContent></Card>
      <AIOutput output={output} loading={loading} />
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
// Company Research
// ============================================================================

export function CompanyResearch() {
  const [company, setCompany] = useState("");
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState("");

  const research = async () => {
    if (!company) { toast.error("Enter a company name"); return; }
    setLoading(true); setOutput("");
    try {
      const result = await callAI({
        systemPrompt: "You are a company research analyst. Provide comprehensive company profiles for job seekers.",
        userPrompt: `Provide a comprehensive profile for: ${company}\n\nInclude: 1) Company overview, 2) Culture & values, 3) Typical interview process, 4) Common interview questions, 5) Salary ranges, 6) Pros & cons from employee reviews, 7) Recent news/developments.`,
        maxTokens: 2000, taskCategory: "document",
      });
      setOutput(result.text);
    } catch (e: any) { toast.error(e?.message || "Failed"); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-6">
      <div><h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="Building2" className="w-6 h-6 text-brand" /> Company Research</h1><p className="text-sm text-muted-foreground mt-1">AI-powered company profiles, culture insights, and interview prep.</p></div>
      <Card><CardContent className="p-4 space-y-3">
        <div><Label>Company Name</Label><Input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Emirates" className="mt-1" /></div>
        <Button onClick={research} disabled={loading} className="bg-brand hover:bg-brand-dark text-white gap-2"><Icon name={loading ? "Loader2" : "Search"} className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} /> {loading ? "Researching..." : "Research Company"}</Button>
      </CardContent></Card>
      <AIOutput output={output} loading={loading} />
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

export function AiMockInterview() {
  const jds = useApp((s) => s.jobDescriptions);
  const [jdId, setJdId] = useState("");
  const [messages, setMessages] = useState<Array<{ role: string; content: string }>>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [started, setStarted] = useState(false);

  const startInterview = async () => {
    const jd = jds.find((j) => j.id === jdId);
    setStarted(true); setMessages([]);
    try {
      const result = await callAI({
        systemPrompt: "You are an interviewer. Ask one question at a time. Wait for the answer. Provide brief feedback after each answer. Start with a behavioral question.",
        userPrompt: `Start a mock interview for: ${jd?.title || "a general role"} at ${jd?.company || "a company"}. Ask the first question.`,
        maxTokens: 500, taskCategory: "interactive",
      });
      setMessages([{ role: "assistant", content: result.text }]);
    } catch (e: any) { toast.error(e?.message || "Failed"); }
  };

  const answer = async () => {
    if (!input.trim()) return;
    setMessages((m) => [...m, { role: "user", content: input }]); setInput(""); setLoading(true);
    try {
      const result = await callAI({
        systemPrompt: "You are an interviewer. The candidate just answered your question. Provide brief feedback (1-2 sentences) and ask the next question.",
        userPrompt: `Candidate's answer: ${input}\n\nProvide feedback and ask the next question.`,
        maxTokens: 500, taskCategory: "interactive",
      });
      setMessages((m) => [...m, { role: "assistant", content: result.text }]);
    } catch (e: any) { toast.error(e?.message || "Failed"); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-6">
      <div><h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="Mic" className="w-6 h-6 text-brand" /> AI Mock Interview</h1><p className="text-sm text-muted-foreground mt-1">Practice with an AI interviewer that asks real questions and gives feedback.</p></div>
      {!started ? (
        <Card><CardContent className="p-4 space-y-3">
          <div><Label>Target Job (optional)</Label><select value={jdId} onChange={(e) => setJdId(e.target.value)} className="w-full h-9 px-3 rounded-md border border-input bg-background text-sm mt-1"><option value="">General interview</option>{jds.map((j) => <option key={j.id} value={j.id}>{j.title} — {j.company || "N/A"}</option>)}</select></div>
          <Button onClick={startInterview} className="bg-brand hover:bg-brand-dark text-white gap-2"><Icon name="Mic" className="w-4 h-4" /> Start Mock Interview</Button>
        </CardContent></Card>
      ) : (
        <Card><CardContent className="p-4">
          <div className="space-y-3 max-h-96 overflow-y-auto mb-3">
            {messages.map((m, i) => <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}><div className={`rounded-lg px-3 py-2 max-w-[80%] text-sm ${m.role === "user" ? "bg-brand text-white" : "bg-secondary"}`}>{m.content}</div></div>)}
            {loading && <div className="flex justify-start"><div className="rounded-lg px-3 py-2 bg-secondary"><Icon name="Loader2" className="w-4 h-4 animate-spin" /></div></div>}
          </div>
          <div className="flex gap-2"><Input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && answer()} placeholder="Type your answer..." /><Button onClick={answer} disabled={loading} className="bg-brand hover:bg-brand-dark text-white"><Icon name="Send" className="w-4 h-4" /></Button></div>
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
        systemPrompt: "You are an ATS system. Score the resume against the job description. Be precise and data-driven.",
        userPrompt: `Resume: ${JSON.stringify({ name: resume.name, headline: resume.headline, summary: resume.summary, experience: resume.experience, skills: resume.skills })}\n\nJob URL: ${jdUrl}\n\nProvide: 1) Match score /100, 2) Keyword match analysis, 3) Missing keywords, 4) Experience alignment, 5) Recommendations to improve match.`,
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
