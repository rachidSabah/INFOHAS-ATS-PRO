"use client";

import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Icon, Badge, ScoreRing } from "@/components/shared";
import { useApp } from "@/lib/store";
import { TEMPLATES } from "@/lib/brand";

export function Dashboard() {
  const user = useApp((s) => s.user);
  const resumes = useApp((s) => s.resumes);
  const jds = useApp((s) => s.jobDescriptions);
  const coverLetters = useApp((s) => s.coverLetters);
  const interviews = useApp((s) => s.interviews);
  const atsReports = useApp((s) => s.atsReports);
  const setView = useApp((s) => s.setView);
  const setActiveResume = useApp((s) => s.setActiveResume);
  const providers = useApp((s) => s.providers);

  const latestReport = atsReports[0];
  const activeProviders = providers.filter((p) => p.isActive).length;

  const stats = [
    { label: "Resumes", value: resumes.length, icon: "FileText", color: "#1154A3", action: () => setView("resumes") },
    { label: "ATS checks", value: atsReports.length, icon: "ScanText", color: "#10B981", action: () => setView("ats-checker") },
    { label: "Cover letters", value: coverLetters.length, icon: "Mail", color: "#F59E0B", action: () => setView("cover-letter") },
    { label: "Interview preps", value: interviews.length, icon: "MessagesSquare", color: "#8B5CF6", action: () => setView("interview") },
  ];

  const quickActions = [
    { title: "Check ATS score", desc: "Upload your resume and get an instant ATS analysis.", icon: "ScanText", color: "#10B981", action: () => setView("ats-checker") },
    { title: "Build a new resume", desc: "Start from a template — fits one A4 page, guaranteed.", icon: "FilePlus2", color: "#1154A3", action: () => setView("builder") },
    { title: "Optimize for a job", desc: "Match your resume to a job description with AI.", icon: "Wand2", color: "#F59E0B", action: () => setView("optimizer") },
    { title: "Generate cover letter", desc: "Modern, traditional, executive, or email.", icon: "Mail", color: "#8B5CF6", action: () => setView("cover-letter") },
    { title: "Prep for interviews", desc: "Get STAR-method answers for your target role.", icon: "MessagesSquare", color: "#EC4899", action: () => setView("interview") },
    { title: "Scrape a job posting", desc: "Extract keywords from any URL.", icon: "Search", color: "#0EA5E9", action: () => setView("jd-scraper") },
  ];

  return (
    <div className="space-y-6">
      {/* Welcome */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-2xl gradient-brand text-white p-6 sm:p-8 relative overflow-hidden"
      >
        <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute bottom-0 right-0 w-60 h-60 rounded-full bg-gold/20 blur-3xl" />
        <div className="relative">
          <Badge variant="gold"><Icon name="Sparkles" className="w-3 h-3" /> {user?.role === "super_admin" ? "Super Admin" : user?.role === "admin" ? "Admin" : "Pro"} account</Badge>
          <h1 className="font-display text-2xl sm:text-3xl font-bold mt-3">
            Welcome back, {user?.name?.split(" ")[0]}.
          </h1>
          <p className="text-white/85 mt-1 max-w-xl text-pretty">
            Your AI-powered career toolkit is ready. Pick a quick action below or jump into any module from the sidebar.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <Button onClick={() => setView("builder")} className="bg-white text-brand hover:bg-white/90 gap-2">
              <Icon name="FilePlus2" className="w-4 h-4" /> New resume
            </Button>
            <Button onClick={() => setView("ats-checker")} variant="outline" className="bg-transparent border-white/40 text-white hover:bg-white/10 hover:text-white gap-2">
              <Icon name="ScanText" className="w-4 h-4" /> Check ATS
            </Button>
          </div>
        </div>
      </motion.div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s, i) => (
          <motion.button
            key={s.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            onClick={s.action}
            className="text-left"
          >
            <Card className="hover:shadow-premium hover:-translate-y-0.5 transition-all">
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: `${s.color}14`, color: s.color }}>
                    <Icon name={s.icon} className="w-5 h-5" />
                  </div>
                  <span className="text-2xl font-bold font-display">{s.value}</span>
                </div>
                <div className="mt-2 text-sm text-muted-foreground">{s.label}</div>
              </CardContent>
            </Card>
          </motion.button>
        ))}
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Quick actions */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Icon name="Zap" className="w-4 h-4 text-gold" /> Quick actions</CardTitle>
            <CardDescription>Jump into the most-used tools.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid sm:grid-cols-2 gap-3">
              {quickActions.map((a) => (
                <button
                  key={a.title}
                  onClick={a.action}
                  className="group text-left rounded-xl border border-border bg-card p-4 hover:shadow-premium hover:-translate-y-0.5 transition-all"
                >
                  <div className="flex items-start gap-3">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${a.color}14`, color: a.color }}>
                      <Icon name={a.icon} className="w-5 h-5" />
                    </div>
                    <div className="min-w-0">
                      <div className="font-semibold text-sm flex items-center gap-1">
                        {a.title}
                        <Icon name="ArrowRight" className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100 group-hover:translate-x-0.5 transition" />
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 text-pretty">{a.desc}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Latest ATS + AI status */}
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Icon name="Activity" className="w-4 h-4 text-brand" /> Latest ATS report</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center">
              {latestReport ? (
                <>
                  <ScoreRing value={latestReport.scores.ats} size={120} label="ATS Score" />
                  <div className="mt-3 text-xs text-muted-foreground text-center">
                    {latestReport.jdMatchPercent != null ? `${latestReport.jdMatchPercent}% JD match` : "No JD comparison"}
                  </div>
                  <Button size="sm" variant="outline" className="mt-3 w-full" onClick={() => setView("ats-checker")}>
                    View report
                  </Button>
                </>
              ) : (
                <div className="text-center py-4">
                  <Icon name="ScanText" className="w-10 h-10 text-muted-foreground/40 mx-auto" />
                  <p className="text-sm text-muted-foreground mt-2">No reports yet</p>
                  <Button size="sm" className="mt-3 bg-brand hover:bg-brand-dark text-white" onClick={() => setView("ats-checker")}>
                    Run first check
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Icon name="Cpu" className="w-4 h-4 text-gold" /> AI providers</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold font-display">{activeProviders} <span className="text-sm font-normal text-muted-foreground">active</span></div>
              <div className="mt-3 space-y-1.5">
                {providers.slice(0, 3).map((p) => (
                  <div key={p.id} className="flex items-center justify-between text-xs">
                    <span className="truncate">{p.name}</span>
                    <span className={`w-1.5 h-1.5 rounded-full ${p.status === "healthy" ? "bg-emerald-500" : p.status === "degraded" ? "bg-amber-500" : "bg-red-500"}`} />
                  </div>
                ))}
              </div>
              <Button size="sm" variant="outline" className="mt-3 w-full" onClick={() => setView("ai-providers")}>
                Manage providers
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Recent resumes */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2"><Icon name="FileText" className="w-4 h-4 text-brand" /> Your resumes</CardTitle>
              <CardDescription>{resumes.length} total · {jds.length} job descriptions saved</CardDescription>
            </div>
            <Button size="sm" onClick={() => setView("builder")} className="bg-brand hover:bg-brand-dark text-white gap-2">
              <Icon name="Plus" className="w-4 h-4" /> New
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {resumes.map((r) => {
              const template = TEMPLATES.find((t) => t.id === r.template);
              return (
                <button
                  key={r.id}
                  onClick={() => { setActiveResume(r.id); setView("builder"); }}
                  className="group text-left rounded-xl border border-border bg-card p-4 hover:shadow-premium hover:-translate-y-0.5 transition-all"
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-sm font-semibold truncate">{r.name}</div>
                    <Badge variant="outline" className="text-[10px]">{template?.name ?? r.template}</Badge>
                  </div>
                  {r.headline && <div className="text-xs text-muted-foreground truncate">{r.headline}</div>}
                  <div className="mt-2 flex items-center gap-3 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1"><Icon name="Briefcase" className="w-3 h-3" /> {r.experience.length} exp</span>
                    <span className="flex items-center gap-1"><Icon name="Wrench" className="w-3 h-3" /> {r.skills.length} skills</span>
                  </div>
                  <div className="mt-3 text-xs text-brand font-medium flex items-center gap-1">
                    Open builder <Icon name="ArrowRight" className="w-3 h-3 group-hover:translate-x-0.5 transition" />
                  </div>
                </button>
              );
            })}
            {resumes.length === 0 && (
              <div className="col-span-full text-center py-8">
                <p className="text-sm text-muted-foreground">No resumes yet. Start with a template.</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
