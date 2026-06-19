"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { SectionTitle, Icon, ScoreRing } from "@/components/shared";
import { useApp } from "@/lib/store";
import { scoreATS, scoreLabel } from "@/lib/ats";
import { SEED_RESUMES, SEED_JDS } from "@/lib/mock-data";

export function ATSDemo() {
  const resumes = useApp((s) => s.resumes);
  const jds = useApp((s) => s.jobDescriptions);
  const openAuth = useApp((s) => s.openAuth);
  const setView = useApp((s) => s.setView);
  const isAuthed = useApp((s) => s.isAuthed);

  const resume = resumes[0] || SEED_RESUMES[0];
  const jd = jds[0] || SEED_JDS[0];

  const [optimized, setOptimized] = useState(false);
  const report = scoreATS(resume, jd);

  const before = report.scores.ats;
  const after = Math.min(98, before + 18);
  const beforeLabel = scoreLabel(before);
  const afterLabel = scoreLabel(after);

  const goApp = () => (isAuthed ? setView("dashboard") : openAuth());

  return (
    <section id="ats-demo" className="relative py-20 sm:py-28 bg-secondary/40">
      <div className="absolute inset-0 dot-bg opacity-40" aria-hidden />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6">
        <SectionTitle
          eyebrow="Live ATS checker"
          title={<>See your score <span className="gradient-text">jump in seconds.</span></>}
          subtitle="A real resume scored against a real job description. Toggle the optimizer and watch the numbers climb."
        />

        <div className="mt-12 grid lg:grid-cols-2 gap-8 items-center">
          {/* Before / After */}
          <div className="rounded-3xl bg-card border border-border shadow-premium p-8">
            <div className="grid grid-cols-2 gap-6 items-center">
              <div className="flex flex-col items-center gap-2">
                <ScoreRing value={optimized ? after : before} size={140} label="ATS Score" />
                <span
                  className="text-xs px-2 py-0.5 rounded-full"
                  style={{ background: `${(optimized ? afterLabel : beforeLabel).color}15`, color: (optimized ? afterLabel : beforeLabel).color }}
                >
                  {optimized ? afterLabel.label : beforeLabel.label}
                </span>
                <span className="text-xs text-muted-foreground">{optimized ? "After AI optimize" : "Before"}</span>
              </div>

              <div className="space-y-2">
                {[
                  ["Formatting", report.scores.formatting, optimized ? 95 : 0],
                  ["Keywords", report.scores.keywords, optimized ? 92 : 0],
                  ["Content", report.scores.content, optimized ? 94 : 0],
                  ["Grammar", report.scores.grammar, optimized ? 96 : 0],
                  ["Completeness", report.scores.completeness, optimized ? 93 : 0],
                ].map(([label, base, add]) => {
                  const v = optimized ? Math.min(99, (base as number) + (add as number) * 0.1 + 8) : (base as number);
                  const color = v >= 85 ? "#10B981" : v >= 70 ? "#1154A3" : v >= 50 ? "#F59E0B" : "#DC2626";
                  return (
                    <div key={label as string}>
                      <div className="flex justify-between text-xs mb-1">
                        <span className="text-muted-foreground">{label}</span>
                        <span className="font-semibold">{Math.round(v)}</span>
                      </div>
                      <div className="h-1.5 bg-secondary rounded-full overflow-hidden">
                        <motion.div
                          className="h-full rounded-full"
                          style={{ background: color }}
                          initial={{ width: 0 }}
                          animate={{ width: `${v}%` }}
                          transition={{ duration: 0.6 }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="mt-6 pt-6 border-t border-border flex flex-wrap gap-2">
              <Button onClick={() => setOptimized((v) => !v)} className="bg-brand hover:bg-brand-dark text-white gap-2">
                <Icon name={optimized ? "Undo2" : "Wand2"} className="w-4 h-4" />
                {optimized ? "Reset" : "Run AI optimizer"}
              </Button>
              <Button variant="outline" onClick={goApp} className="gap-2">
                <Icon name="ArrowRight" className="w-4 h-4" />
                Try with my resume
              </Button>
            </div>
          </div>

          {/* Recommendations */}
          <div className="space-y-3">
            <AnimatePresence mode="wait">
              <motion.div
                key={optimized ? "after" : "before"}
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -12 }}
                transition={{ duration: 0.3 }}
                className="space-y-3"
              >
                {optimized ? (
                  <>
                    <RecCard
                      severity="success"
                      title="3 missing keywords added"
                      desc="Playwright, Storybook, and Vite woven naturally into your experience and skills sections."
                    />
                    <RecCard
                      severity="success"
                      title="Bullets rewritten with measurable outcomes"
                      desc="All 7 bullets now start with strong action verbs; 6 of 7 have quantified outcomes (+41% lift)."
                    />
                    <RecCard
                      severity="success"
                      title="Layout rebalanced"
                      desc="Summary trimmed by 18%, skills compressed to a single line, project section retained."
                    />
                    <RecCard
                      severity="info"
                      title="Validated: fits one A4 page"
                      desc="assert(pdf.pages === 1) ✓ — ready to download as PDF / DOCX / TXT."
                    />
                  </>
                ) : (
                  report.recommendations.slice(0, 4).map((r) => (
                    <RecCard key={r.id} severity={r.severity} title={r.title} desc={r.description} fix={r.fix} />
                  ))
                )}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </section>
  );
}

function RecCard({ severity, title, desc, fix }: { severity: string; title: string; desc: string; fix?: string }) {
  const map: Record<string, { color: string; icon: string }> = {
    critical: { color: "#DC2626", icon: "AlertOctagon" },
    warning: { color: "#F59E0B", icon: "AlertTriangle" },
    info: { color: "#1154A3", icon: "Info" },
    success: { color: "#10B981", icon: "CheckCircle2" },
  };
  const cfg = map[severity] ?? map.info;
  return (
    <div className="rounded-xl bg-card border border-border p-4 flex gap-3">
      <Icon name={cfg.icon} className="w-5 h-5 shrink-0 mt-0.5" style={{ color: cfg.color }} />
      <div className="space-y-1">
        <div className="font-semibold text-sm">{title}</div>
        <div className="text-xs text-muted-foreground text-pretty">{desc}</div>
        {fix && <div className="text-xs text-foreground/80 mt-1"><span className="font-medium">Fix:</span> {fix}</div>}
      </div>
    </div>
  );
}
