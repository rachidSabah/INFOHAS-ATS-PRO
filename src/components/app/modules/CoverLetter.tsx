"use client";

import { useState, useMemo } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge, Icon, ScoreRing } from "@/components/shared";
import { useApp, uid } from "@/lib/store";
import { callAI, extractJSON } from "@/lib/ai";
import { detectIndustry, INDUSTRY_PROFILES } from "@/lib/industry-ats";
import { exportCoverLetterPDF, exportCoverLetterDOCX, exportCoverLetterTXT } from "@/lib/exporter";
import { toast } from "sonner";
import type { CoverLetter } from "@/lib/types";

// ============================================================================
// Tone options
// ============================================================================
const TONES = [
  { id: "Professional", label: "Professional", desc: "Balanced, confident, standard business tone" },
  { id: "Executive", label: "Executive", desc: "Strategic, outcomes-led, C-suite level" },
  { id: "Friendly", label: "Friendly", desc: "Warm, approachable, human connection" },
  { id: "Formal", label: "Formal", desc: "Traditional, precise, highly structured" },
  { id: "Enthusiastic", label: "Enthusiastic", desc: "Energetic, passionate, shows excitement" },
  { id: "Balanced", label: "Balanced", desc: "Mix of professional and warm" },
] as const;

export function CoverLetter() {
  const coverLetters = useApp((s) => s.coverLetters);
  const resumes = useApp((s) => s.resumes);
  const jds = useApp((s) => s.jobDescriptions);
  const addCoverLetter = useApp((s) => s.addCoverLetter);
  const updateCoverLetter = useApp((s) => s.updateCoverLetter);
  const removeCoverLetter = useApp((s) => s.removeCoverLetter);
  const incUsage = useApp((s) => s.incUsage);
  const log = useApp((s) => s.log);

  const [activeId, setActiveId] = useState<string>(coverLetters[0]?.id ?? "");
  const [generating, setGenerating] = useState(false);
  const [selectedTone, setSelectedTone] = useState<string>("Professional");
  const [matchScore, setMatchScore] = useState<number | null>(null);
  const [keywordsUsed, setKeywordsUsed] = useState<string[]>([]);
  const [sectionsReferenced, setSectionsReferenced] = useState<string[]>([]);

  const active = coverLetters.find((c) => c.id === activeId) ?? null;

  // === Auto-detect industry from JD + resume ===
  const industryDetection = useMemo(() => {
    const resume = resumes[0];
    const jd = jds[0];
    if (!jd) return null;
    const jdText = jd.rawText ?? jd.keywords.join(" ");
    const resumeText = `${resume?.name ?? ""} ${resume?.headline ?? ""} ${resume?.summary ?? ""} ${resume?.experience.map((e) => e.title + " " + e.company).join(" ")}`;
    return detectIndustry(jdText, resumeText);
  }, [resumes, jds]);

  const industryProfile = industryDetection ? INDUSTRY_PROFILES[industryDetection.industryId] : null;

  // === Dynamic Cover Letter Generation ===
  const generate = async () => {
    const resume = resumes[0];
    const jd = jds[0];

    if (!resume) {
      toast.error("Please upload or create a resume first.");
      return;
    }
    if (!jd) {
      toast.error("Please add a job description first.");
      return;
    }

    setGenerating(true);
    setMatchScore(null);
    setKeywordsUsed([]);
    setSectionsReferenced([]);

    try {
      // Build context from optimized resume (preferred) or original
      const resumeContext = JSON.stringify({
        name: resume.name,
        headline: resume.headline,
        summary: resume.summary,
        experience: resume.experience.map((e) => ({
          title: e.title,
          company: e.company,
          location: e.location,
          startDate: e.startDate,
          endDate: e.endDate,
          bullets: e.bullets,
        })),
        skills: resume.skills.map((s) => s.name),
        education: resume.education.map((ed) => ({ degree: ed.degree, institution: ed.institution })),
        languages: resume.languages.map((l) => l.name),
        certifications: resume.certifications.map((c) => c.name),
      });

      const jdContext = jd.rawText ?? JSON.stringify({
        title: jd.title,
        company: jd.company,
        location: jd.location,
        responsibilities: jd.responsibilities,
        requiredSkills: jd.requiredSkills,
        preferredSkills: jd.preferredSkills,
        keywords: jd.keywords,
      });

      const industryContext = industryProfile ? `
INDUSTRY: ${industryProfile.label}
INDUSTRY WRITING GUIDANCE: ${industryProfile.writingGuidance}
INDUSTRY KEYWORDS: ${industryProfile.priorityKeywords.join(", ")}
` : "";

      const result = await callAI({
        systemPrompt: `You are an Expert Cover Letter Writer, Senior Recruiter, and ATS Specialist. You write highly personalized, recruiter-grade cover letters that sound human and professional. You NEVER fabricate experience, skills, or achievements — you only use information from the candidate's resume. You adapt language to the detected industry. Always return ONLY valid JSON.

TONE: ${selectedTone}
${industryContext}

COVER LETTER STRUCTURE:
1. Professional Greeting (address the hiring manager or "Dear Hiring Manager")
2. Introduction (hook: why this role at this company excites you)
3. Why This Company (reference the company's mission/values/position if known from the job description)
4. Why This Role (connect your experience to the specific responsibilities)
5. Relevant Experience (2-3 key achievements from your resume that align with JD requirements)
6. Value Proposition (what you bring that others don't)
7. Closing Statement (confident CTA — request an interview)
8. Professional Signature

CONTENT RULES:
- Target 350-500 words (preferably ~450 words)
- One page maximum
- Sound HUMAN — avoid generic AI language ("dynamic professional", "passionate about", "track record of", "I excel in", "my professional journey", "I am confident")
- Use strong action verbs: Delivered, Implemented, Improved, Optimized, Led, Designed
- Reference SPECIFIC achievements from the resume with measurable outcomes (numbers, %, $)
- Incorporate keywords from the job description naturally (no stuffing)
- Industry-adaptive language (use industry terminology from the keyword bank)
- NEVER mention skills not present in the resume
- NEVER fabricate company information — only use what's in the JD
- ATS-friendly: include key JD keywords naturally

GROUNDING REQUIREMENTS (CRITICAL):
- You MUST reference at least 3 different resume sections in the cover letter:
  1. Professional Summary (background + years of experience)
  2. Experience (at least 2 specific achievements with metrics from actual roles)
  3. Skills (at least 3 relevant skills from the resume)
- If the resume has Languages, mention them.
- If the resume has Certifications, mention them.
- If the resume has Education relevant to the role, mention it.
- The sectionsReferenced array MUST list ALL sections you actually used.

Return JSON:
{
  "content": "The full cover letter text (plain text, no markdown)",
  "matchScore": 85,
  "keywordsUsed": ["keyword1", "keyword2"],
  "sectionsReferenced": ["Professional Summary", "Experience", "Skills", "Languages", "Certifications"]
}`,
        userPrompt: `CANDIDATE'S RESUME (primary source of truth — use ONLY this information):
${resumeContext}

JOB DESCRIPTION:
${jdContext}

COMPANY: ${jd.company || "the company"}
JOB TITLE: ${jd.title || "the role"}
INDUSTRY: ${industryProfile?.label || "Generic"}

Generate a highly personalized, recruiter-grade cover letter that aligns the candidate's experience with the job requirements. Use the candidate's REAL achievements and skills — never fabricate. Incorporate JD keywords naturally. Adapt language to the ${industryProfile?.label || "relevant"} industry.

Return ONLY valid JSON.`,
        maxTokens: 2000,
        temperature: 0.5,
        taskCategory: "document",
      });

      // Parse the AI response
      let data: { content: string; matchScore: number; keywordsUsed: string[]; sectionsReferenced: string[] };
      try {
        const raw = extractJSON<any>(result.text);
        // === NORMALIZATION: handle multiple possible key names ===
        // The AI may return { content: "..." }, { letter: "..." }, { text: "..." },
        // or just a plain string. Normalize to { content, matchScore, ... }.
        const content = raw.content || raw.letter || raw.text || raw.coverLetter || raw.body || "";
        if (content && typeof content === "string" && content.trim().length > 50) {
          data = {
            content,
            matchScore: raw.matchScore || raw.match_score || raw.score || 75,
            keywordsUsed: Array.isArray(raw.keywordsUsed) ? raw.keywordsUsed
              : Array.isArray(raw.keywords_used) ? raw.keywords_used
              : Array.isArray(raw.keywords) ? raw.keywords
              : jd.keywords.slice(0, 8),
            sectionsReferenced: Array.isArray(raw.sectionsReferenced) ? raw.sectionsReferenced
              : Array.isArray(raw.sections_referenced) ? raw.sections_referenced
              : Array.isArray(raw.sections) ? raw.sections
              : ["Professional Summary", "Experience", "Skills"],
          };
        } else {
          // JSON parsed but content is missing/empty — treat the raw text as content
          data = {
            content: result.text,
            matchScore: 75,
            keywordsUsed: jd.keywords.slice(0, 8),
            sectionsReferenced: ["Professional Summary", "Experience", "Skills"],
          };
        }
      } catch {
        // Fallback: treat the entire response as cover letter content
        data = {
          content: result.text,
          matchScore: 75,
          keywordsUsed: jd.keywords.slice(0, 8),
          sectionsReferenced: ["Summary", "Experience", "Skills"],
        };
      }

      const cl: CoverLetter = {
        id: uid("cl"),
        title: `Cover Letter — ${jd.company || "Target Company"}`,
        template: "modern",
        content: data.content || result.text,
        resumeId: resume.id,
        jdId: jd.id,
        company: jd.company,
        role: jd.title,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      addCoverLetter(cl);
      setActiveId(cl.id);
      setMatchScore(data.matchScore ?? 75);
      setKeywordsUsed(data.keywordsUsed ?? []);
      setSectionsReferenced(data.sectionsReferenced ?? []);
      incUsage("coverLetters");
      log({
        actor: "you",
        action: "Cover letter generated (dynamic)",
        category: "ai",
        details: `${selectedTone} tone · ${industryProfile?.label || "Generic"} industry · ${data.matchScore ?? 75}% match via ${result.provider}`,
        severity: "info",
      });
      toast.success(`Cover letter generated — ${data.matchScore ?? 75}% match via ${result.provider}`);
    } catch (e: any) {
      toast.error(e?.message || "Generation failed. Please try again.");
    } finally {
      setGenerating(false);
    }
  };

  const updateContent = (content: string) => {
    if (!active) return;
    updateCoverLetter(active.id, { content });
  };

  // === Empty state ===
  if (!active && coverLetters.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="Mail" className="w-6 h-6 text-brand" /> Cover Letter Generator</h1>
          <p className="text-sm text-muted-foreground mt-1">Dynamic, context-aware cover letters tailored to your optimized resume and job description.</p>
        </div>

        {/* Context summary */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="grid sm:grid-cols-2 gap-3 text-xs">
              <div className="rounded-lg bg-secondary/40 p-2.5 flex items-center justify-between">
                <span className="text-muted-foreground">Resume:</span>
                <span className="font-semibold">{resumes[0]?.name ?? "Not uploaded"}</span>
              </div>
              <div className="rounded-lg bg-secondary/40 p-2.5 flex items-center justify-between">
                <span className="text-muted-foreground">Job Description:</span>
                <span className="font-semibold">{jds[0]?.title ?? "Not added"}</span>
              </div>
              <div className="rounded-lg bg-secondary/40 p-2.5 flex items-center justify-between">
                <span className="text-muted-foreground">Company:</span>
                <span className="font-semibold">{jds[0]?.company ?? "Not specified"}</span>
              </div>
              <div className="rounded-lg bg-secondary/40 p-2.5 flex items-center justify-between">
                <span className="text-muted-foreground">Detected Industry:</span>
                <span className="font-semibold">{industryProfile?.label ?? "Generic"}</span>
              </div>
            </div>
            {industryDetection && industryDetection.confidence >= 15 && (
              <div className="rounded-lg bg-brand/5 dark:bg-brand/10 border border-brand/20 p-2.5 flex items-start gap-2">
                <Icon name="Info" className="w-3.5 h-3.5 text-brand shrink-0 mt-0.5" />
                <p className="text-xs text-muted-foreground">
                  Industry detected: <strong>{industryProfile?.label}</strong>. The cover letter will be tailored with {industryProfile?.label.toLowerCase()} terminology and writing style.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Tone selector */}
        <Card>
          <CardHeader><CardTitle className="text-base">Select Tone</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {TONES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSelectedTone(t.id)}
                  className={`flex flex-col items-start p-3 rounded-lg border-2 transition text-left ${
                    selectedTone === t.id ? "border-brand bg-brand/10" : "border-border hover:border-brand/40"
                  }`}
                >
                  <span className={`text-sm font-medium ${selectedTone === t.id ? "text-brand" : "text-foreground"}`}>{t.label}</span>
                  <span className="text-[10px] text-muted-foreground mt-0.5">{t.desc}</span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Generate button */}
        <Card>
          <CardContent className="p-5 sm:p-6 text-center">
            <Icon name="Sparkles" className="w-10 h-10 text-brand mx-auto" />
            <h3 className="mt-3 font-semibold text-base">Generate Your Cover Letter</h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
              AI-generated from your resume and job description. Tailored to {industryProfile?.label || "your industry"} with {selectedTone.toLowerCase()} tone. Recruiter-grade, ATS-friendly, one page.
            </p>
            <Button onClick={generate} disabled={generating || !resumes[0] || !jds[0]} className="bg-brand hover:bg-brand-dark text-white gap-2 mt-4">
              {generating ? <Icon name="Loader2" className="w-4 h-4 animate-spin" /> : <Icon name="Wand2" className="w-4 h-4" />}
              {generating ? "Generating…" : "Generate Cover Letter"}
            </Button>
            {(!resumes[0] || !jds[0]) && (
              <p className="text-xs text-amber-600 mt-2">
                {!resumes[0] ? "Upload a resume first. " : ""}
                {!jds[0] ? "Add a job description first." : ""}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // === Active cover letter view ===
  if (!active) return null;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="Mail" className="w-6 h-6 text-brand" /> Cover Letter Generator</h1>
          <p className="text-sm text-muted-foreground mt-1">Edit the draft, then export in your preferred format.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => { removeCoverLetter(active.id); setActiveId(coverLetters.find(c => c.id !== active.id)?.id ?? ""); toast.success("Deleted."); }}>
            <Icon name="Trash2" className="w-4 h-4" />
          </Button>
          <Button variant="outline" size="sm" onClick={() => exportCoverLetterTXT(active)} className="gap-1.5"><Icon name="FileText" className="w-3.5 h-3.5" /> TXT</Button>
          <Button variant="outline" size="sm" onClick={() => { exportCoverLetterDOCX(active); incUsage("downloads"); toast.success("DOCX exported."); }} className="gap-1.5"><Icon name="FileType" className="w-3.5 h-3.5" /> DOCX</Button>
          <Button size="sm" onClick={() => { exportCoverLetterPDF(active); incUsage("downloads"); log({ actor: "you", action: "Cover letter exported (PDF)", category: "export", details: `${active.title}.pdf`, severity: "info" }); toast.success("PDF exported."); }} className="bg-brand hover:bg-brand-dark text-white gap-1.5"><Icon name="Download" className="w-3.5 h-3.5" /> PDF</Button>
        </div>
      </div>

      <div className="grid lg:grid-cols-12 gap-4">
        {/* Editor + metadata */}
        <div className="lg:col-span-7 space-y-3">
          {/* Match score + keywords */}
          {matchScore !== null && (
            <Card>
              <CardContent className="p-4">
                <div className="flex items-center gap-4 flex-wrap">
                  <ScoreRing value={matchScore} size={60} label="Match" />
                  <div className="flex-1 min-w-0 space-y-2">
                    {keywordsUsed.length > 0 && (
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">Keywords Used ({keywordsUsed.length})</div>
                        <div className="flex flex-wrap gap-1">
                          {keywordsUsed.slice(0, 12).map((k, i) => <Badge key={i} variant="success" className="text-[9px]">{k}</Badge>)}
                        </div>
                      </div>
                    )}
                    {sectionsReferenced.length > 0 && (
                      <div>
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">Resume Sections Referenced</div>
                        <div className="flex flex-wrap gap-1">
                          {sectionsReferenced.map((s, i) => <Badge key={i} variant="outline" className="text-[9px]">{s}</Badge>)}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Edit</CardTitle>
                <Badge variant="outline">{active.company ? `${active.role ?? ""} at ${active.company}` : active.template}</Badge>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid sm:grid-cols-2 gap-3">
                <Field label="Title">
                  <Input value={active.title} onChange={(e) => updateCoverLetter(active.id, { title: e.target.value })} />
                </Field>
                <Field label="Company">
                  <Input value={active.company ?? ""} onChange={(e) => updateCoverLetter(active.id, { company: e.target.value })} />
                </Field>
              </div>
              <Field label="Content">
                <Textarea
                  value={active.content}
                  onChange={(e) => updateContent(e.target.value)}
                  rows={18}
                  className="font-serif text-[15px] leading-relaxed"
                />
                <p className="text-xs text-muted-foreground mt-1">{active.content.split(/\s+/).length} words {active.content.split(/\s+/).length > 500 && <span className="text-amber-600">· exceeds 500-word target</span>}</p>
              </Field>
            </CardContent>
          </Card>

          {/* Generate another */}
          <Card>
            <CardHeader><CardTitle className="text-base">Generate Another</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1.5 block">Tone</Label>
                <div className="flex flex-wrap gap-1.5">
                  {TONES.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setSelectedTone(t.id)}
                      className={`text-xs px-2.5 py-1 rounded-full border transition ${
                        selectedTone === t.id ? "border-brand bg-brand/10 text-brand font-medium" : "border-border text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
              <Button onClick={generate} disabled={generating} className="bg-brand hover:bg-brand-dark text-white gap-2">
                {generating ? <Icon name="Loader2" className="w-4 h-4 animate-spin" /> : <Icon name="Sparkles" className="w-4 h-4" />}
                {generating ? "Generating…" : `Generate with ${selectedTone} tone`}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Preview */}
        <div className="lg:col-span-5">
          <div className="sticky top-20">
            <div className="rounded-xl bg-secondary/60 p-4 max-h-[calc(100vh-160px)] overflow-y-auto">
              <div className="a4-page !w-full !min-h-0 !max-h-none p-[16mm]" style={{ transformOrigin: "top" }}>
                <div className="text-[10pt] leading-relaxed text-slate-800" style={{ fontFamily: "'Inter', sans-serif" }}>
                  <div className="border-b-2 pb-3 mb-4" style={{ borderColor: "#1154A3" }}>
                    <div className="text-[14pt] font-bold text-slate-900">{active.title}</div>
                    {active.role && active.company && <div className="text-[10pt] text-slate-600 mt-0.5">{active.role} at {active.company}</div>}
                    <div className="text-[9pt] text-slate-500 mt-1" suppressHydrationWarning>{new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</div>
                  </div>
                  {active.content.split(/\n\s*\n/).map((p, i) => (
                    <p key={i} className="mb-3 text-pretty">{p.trim()}</p>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Saved letters */}
      <Card>
        <CardHeader><CardTitle className="text-base">All cover letters ({coverLetters.length})</CardTitle></CardHeader>
        <CardContent>
          {coverLetters.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">No cover letters yet. Generate one above.</p>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {coverLetters.map((c) => (
                <button key={c.id} onClick={() => setActiveId(c.id)} className={`text-left rounded-lg border p-3 transition ${c.id === active.id ? "border-brand bg-brand-light/40" : "border-border hover:border-brand/40"}`}>
                  <div className="font-semibold text-sm truncate">{c.title}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{c.content.split(/\s+/).length} words{c.company ? ` · ${c.company}` : ""}</div>
                </button>
              ))}
            </div>
          )}
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
