"use client";

import { useState, useMemo, useRef } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, Icon, ScoreRing } from "@/components/shared";
import { useApp } from "@/lib/store";
import { scoreATS, scoreLabel } from "@/lib/ats";
import { parseResumeFile } from "@/lib/parser";
import { toast } from "sonner";
import type { ResumeData, JobDescription } from "@/lib/types";

export function ATSChecker() {
  const resumes = useApp((s) => s.resumes);
  const jds = useApp((s) => s.jobDescriptions);
  const addATS = useApp((s) => s.addATSReport);
  const incUsage = useApp((s) => s.incUsage);
  const log = useApp((s) => s.log);
  const setView = useApp((s) => s.setView);

  const [resumeId, setResumeId] = useState<string>(resumes[0]?.id ?? "");
  const [jdId, setJdId] = useState<string>("none");
  const [running, setRunning] = useState(false);
  const [report, setReport] = useState<ReturnType<typeof scoreATS> | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const resume = useMemo(() => resumes.find((r) => r.id === resumeId), [resumes, resumeId]);
  const jd = useMemo(() => jds.find((j) => j.id === jdId), [jds, jdId]);

  const run = async () => {
    if (!resume) {
      toast.error("Select or upload a resume first.");
      return;
    }
    setRunning(true);
    await new Promise((r) => setTimeout(r, 900)); // simulate AI provider latency
    const r = scoreATS(resume, jd);
    setReport(r);
    addATS(r);
    incUsage("atsChecks");
    log({ actor: "you", action: "ATS check completed", category: "resume", details: `Score ${r.scores.ats}/100 for "${resume.name}"`, severity: "info" });
    setRunning(false);
    toast.success(`ATS score: ${r.scores.ats}/100`);
  };

  const onUpload = async (files: FileList | null) => {
    if (!files?.[0]) return;
    const file = files[0];
    try {
      const parsed = await parseResumeFile(file);
      useApp.getState().addResume(parsed);
      setResumeId(parsed.id);
      toast.success(`Parsed ${file.name} successfully.`);
    } catch (e: any) {
      toast.error(e?.message || "Parse failed.");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const scores = report?.scores;
  const scoreRows: { label: string; value: number; key: keyof NonNullable<typeof scores> }[] = scores ? [
    { label: "ATS Overall", value: scores.ats, key: "ats" },
    { label: "Formatting", value: scores.formatting, key: "formatting" },
    { label: "Keywords", value: scores.keywords, key: "keywords" },
    { label: "Content", value: scores.content, key: "content" },
    { label: "Grammar", value: scores.grammar, key: "grammar" },
    { label: "Completeness", value: scores.completeness, key: "completeness" },
  ] : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold flex items-center gap-2">
          <Icon name="ScanText" className="w-6 h-6 text-brand" /> ATS Resume Checker
        </h1>
        <p className="text-sm text-muted-foreground mt-1">Six-axis scoring with actionable recommendations. Outperforms Enhancv — and it's free.</p>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-lg">1. Pick a resume</CardTitle>
            <CardDescription>Choose from your library or upload a new one.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <select
              value={resumeId}
              onChange={(e) => setResumeId(e.target.value)}
              className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
            >
              {resumes.length === 0 && <option value="">No resumes yet</option>}
              {resumes.map((r) => (
                <option key={r.id} value={r.id}>{r.name} {r.headline ? `— ${r.headline}` : ""}</option>
              ))}
            </select>
            <Button variant="outline" className="w-full gap-2" onClick={() => fileRef.current?.click()}>
              <Icon name="Upload" className="w-4 h-4" /> Upload new (PDF/DOCX/TXT)
            </Button>
            <input ref={fileRef} type="file" accept=".pdf,.docx,.txt" className="hidden" onChange={(e) => onUpload(e.target.files)} />
          </CardContent>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-lg">2. Compare to a job? (optional)</CardTitle>
            <CardDescription>Score against a saved job description.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <select
              value={jdId}
              onChange={(e) => setJdId(e.target.value)}
              className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm"
            >
              <option value="none">No JD — generic ATS check</option>
              {jds.map((j) => (
                <option key={j.id} value={j.id}>{j.title}{j.company ? ` — ${j.company}` : ""}</option>
              ))}
            </select>
            {jd && (
              <div className="rounded-lg bg-secondary p-3 text-xs">
                <div className="font-semibold">{jd.title}</div>
                <div className="text-muted-foreground mt-0.5">{jd.keywords.length} keywords · {jd.requiredSkills.length} required skills</div>
              </div>
            )}
            <Button variant="outline" className="w-full gap-2" onClick={() => setView("jd-scraper")}>
              <Icon name="Search" className="w-4 h-4" /> Scrape a new JD
            </Button>
          </CardContent>
        </Card>

        <Card className="lg:col-span-1 flex flex-col">
          <CardHeader>
            <CardTitle className="text-lg">3. Run the check</CardTitle>
            <CardDescription>Get your scores in ~1 second.</CardDescription>
          </CardHeader>
          <CardContent className="flex-1 flex flex-col items-center justify-center gap-3">
            <Button onClick={run} disabled={running || !resume} className="w-full bg-brand hover:bg-brand-dark text-white gap-2">
              {running ? <Icon name="Loader2" className="w-4 h-4 animate-spin" /> : <Icon name="ScanText" className="w-4 h-4" />}
              {running ? "Analyzing…" : "Run ATS check"}
            </Button>
            {!resume && <p className="text-xs text-muted-foreground text-center">Select or upload a resume to enable.</p>}
          </CardContent>
        </Card>
      </div>

      {report && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="grid lg:grid-cols-3 gap-6">
          {/* Score card */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><Icon name="Gauge" className="w-4 h-4 text-brand" /> Overall score</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-4">
              <ScoreRing value={report.scores.ats} size={160} stroke={12} label="ATS Score" />
              <Badge variant={report.scores.ats >= 85 ? "success" : report.scores.ats >= 70 ? "brand" : report.scores.ats >= 50 ? "warning" : "danger"}>
                {scoreLabel(report.scores.ats).label}
              </Badge>
              {report.jdMatchPercent != null && (
                <div className="text-xs text-muted-foreground text-center">
                  JD match: <span className="font-semibold text-foreground">{report.jdMatchPercent}%</span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Score breakdown */}
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><Icon name="BarChart3" className="w-4 h-4 text-brand" /> Score breakdown</CardTitle>
              <CardDescription>Six axes, weighted for real ATS systems.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {scoreRows.slice(1).map((row) => {
                const color = row.value >= 85 ? "#10B981" : row.value >= 70 ? "#1154A3" : row.value >= 50 ? "#F59E0B" : "#DC2626";
                return (
                  <div key={row.key}>
                    <div className="flex justify-between text-sm mb-1">
                      <span className="font-medium">{row.label}</span>
                      <span className="font-semibold" style={{ color }}>{row.value}/100</span>
                    </div>
                    <div className="h-2 bg-secondary rounded-full overflow-hidden">
                      <motion.div
                        className="h-full rounded-full"
                        style={{ background: color }}
                        initial={{ width: 0 }}
                        animate={{ width: `${row.value}%` }}
                        transition={{ duration: 0.6, delay: 0.1 }}
                      />
                    </div>
                  </div>
                );
              })}

              {report.missingKeywords.length > 0 && (
                <div className="mt-4 pt-4 border-t border-border">
                  <div className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                    <Icon name="KeyRound" className="w-4 h-4 text-gold" /> Missing keywords
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {report.missingKeywords.map((k) => (
                      <Badge key={k} variant="warning">{k}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {report.matchedKeywords.length > 0 && (
                <div className="mt-3">
                  <div className="text-sm font-semibold mb-2 flex items-center gap-1.5">
                    <Icon name="CheckCircle2" className="w-4 h-4 text-emerald-600" /> Matched keywords
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {report.matchedKeywords.map((k) => (
                      <Badge key={k} variant="success">{k}</Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recommendations */}
          <Card className="lg:col-span-3">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2"><Icon name="Lightbulb" className="w-4 h-4 text-gold" /> Recommendations ({report.recommendations.length})</CardTitle>
              <CardDescription>Concrete, actionable fixes — ranked by severity.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid sm:grid-cols-2 gap-3">
                {report.recommendations.map((rec) => {
                  const cfg: Record<string, { color: string; bg: string; icon: string }> = {
                    critical: { color: "#DC2626", bg: "#FEE2E2", icon: "AlertOctagon" },
                    warning: { color: "#F59E0B", bg: "#FEF3C7", icon: "AlertTriangle" },
                    info: { color: "#1154A3", bg: "#DBEAFE", icon: "Info" },
                    success: { color: "#10B981", bg: "#D1FAE5", icon: "CheckCircle2" },
                  };
                  const c = cfg[rec.severity] ?? cfg.info;
                  return (
                    <div key={rec.id} className="rounded-xl border border-border p-4 flex gap-3">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: c.bg, color: c.color }}>
                        <Icon name={c.icon} className="w-4 h-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold">{rec.title}</div>
                        <div className="text-xs text-muted-foreground mt-0.5 text-pretty">{rec.description}</div>
                        {rec.fix && <div className="text-xs text-foreground/80 mt-2"><span className="font-semibold">Fix:</span> {rec.fix}</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>

          {/* CTA to optimizer */}
          <Card className="lg:col-span-3 gradient-brand text-white">
            <CardContent className="p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div>
                <h3 className="font-display text-lg font-bold">Want to fix these automatically?</h3>
                <p className="text-sm text-white/80 mt-1">The Resume Optimizer will rewrite bullets, add missing keywords, and rebalance the layout — all on one A4 page.</p>
              </div>
              <Button onClick={() => setView("optimizer")} className="bg-white text-brand hover:bg-white/90 gap-2 shrink-0">
                <Icon name="Wand2" className="w-4 h-4" /> Open Optimizer
              </Button>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </div>
  );
}
