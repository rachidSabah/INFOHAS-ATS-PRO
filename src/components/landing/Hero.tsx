"use client";

import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Icon, Sparkles } from "@/components/shared";
import { useApp } from "@/lib/store";

export function Hero() {
  const openAuth = useApp((s) => s.openAuth);
  const setView = useApp((s) => s.setView);
  const isAuthed = useApp((s) => s.isAuthed);

  const goApp = () => (isAuthed ? setView("dashboard") : openAuth());

  return (
    <section className="relative overflow-hidden gradient-hero">
      <div className="absolute inset-0 grid-bg opacity-50" aria-hidden />
      <Sparkles count={18} />
      <div className="relative mx-auto max-w-7xl px-4 sm:px-6 pt-16 pb-20 sm:pt-24 sm:pb-28">
        <div className="grid lg:grid-cols-12 gap-10 items-center">
          {/* Left */}
          <div className="lg:col-span-7 flex flex-col gap-6">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="inline-flex items-center gap-2 self-start px-3 py-1.5 rounded-full bg-card border border-border shadow-card text-xs font-medium"
            >
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span className="text-muted-foreground">100% free forever — no paywalls, no watermarks</span>
            </motion.div>

            <motion.h1
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.05 }}
              className="font-display text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-balance leading-[1.05]"
            >
              Beat the bots.
              <br />
              <span className="gradient-text">Land the offer.</span>
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.12 }}
              className="text-lg text-muted-foreground text-pretty max-w-xl"
            >
              ResumeAI Pro is a premium, completely free AI resume builder, ATS checker, optimizer, cover letter generator, and interview prep platform — engineered to outperform Enhancv, without the paywall.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.18 }}
              className="flex flex-wrap gap-3"
            >
              <Button size="lg" onClick={goApp} className="bg-brand hover:bg-brand-dark text-white gap-2 shadow-glow">
                <Icon name="Sparkles" className="w-4 h-4" />
                Get started — it's free
              </Button>
              <a href="#ats-demo">
                <Button size="lg" variant="outline" className="gap-2">
                  <Icon name="ScanText" className="w-4 h-4" />
                  Try the ATS demo
                </Button>
              </a>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.55, delay: 0.25 }}
              className="flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground mt-2"
            >
              {[
                ["Users", "120,000+"],
                ["Resumes built", "1.4M+"],
                ["Avg ATS lift", "+27 pts"],
                ["Cost", "$0"],
              ].map(([k, v]) => (
                <div key={k} className="flex items-center gap-2">
                  <span className="font-semibold text-foreground">{v}</span>
                  <span>{k}</span>
                </div>
              ))}
            </motion.div>
          </div>

          {/* Right — animated mock */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="lg:col-span-5"
          >
            <HeroMock />
          </motion.div>
        </div>
      </div>
    </section>
  );
}

function HeroMock() {
  return (
    <div className="relative">
      <div className="absolute -inset-4 bg-gradient-to-tr from-brand/20 to-gold/20 blur-3xl rounded-3xl" aria-hidden />
      <div className="relative grid grid-cols-2 gap-3">
        <div className="col-span-2 rounded-2xl bg-card border border-border shadow-premium p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 rounded-lg gradient-brand flex items-center justify-center">
                <Icon name="ScanText" className="w-4 h-4 text-white" />
              </div>
              <div>
                <div className="text-sm font-semibold">ATS Score</div>
                <div className="text-[10px] text-muted-foreground">live analysis</div>
              </div>
            </div>
            <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700">+27 pts</span>
          </div>
          <div className="grid grid-cols-5 gap-2">
            {[
              ["ATS", 92, "#10B981"],
              ["Format", 95, "#1154A3"],
              ["Keywords", 78, "#F59E0B"],
              ["Content", 90, "#1154A3"],
              ["Grammar", 96, "#10B981"],
            ].map(([label, val, color]) => (
              <div key={label as string} className="flex flex-col items-center gap-1">
                <div className="w-full h-16 bg-secondary rounded-md relative overflow-hidden">
                  <motion.div
                    className="absolute bottom-0 left-0 right-0"
                    style={{ background: color as string }}
                    initial={{ height: 0 }}
                    animate={{ height: `${val}%` }}
                    transition={{ duration: 1, delay: 0.4 }}
                  />
                </div>
                <span className="text-[10px] text-muted-foreground">{label}</span>
                <span className="text-xs font-bold">{val}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-2xl bg-card border border-border shadow-card p-4">
          <div className="flex items-center gap-2 mb-2">
            <Icon name="FilePlus2" className="w-4 h-4 text-brand" />
            <span className="text-sm font-semibold">One-page A4</span>
          </div>
          <div className="aspect-[210/297] bg-white border border-border rounded shadow-inner overflow-hidden">
            <div className="p-2.5">
              <div className="h-1.5 w-2/3 bg-foreground/80 rounded mb-1" />
              <div className="h-1 w-1/2 bg-brand rounded mb-2" />
              <div className="h-px bg-border mb-1.5" />
              <div className="space-y-1">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex gap-1">
                    <div className="h-0.5 w-0.5 rounded-full bg-muted-foreground/60 mt-0.5" />
                    <div className="h-1 flex-1 bg-muted rounded" style={{ opacity: 0.5 + i * 0.08 }} />
                  </div>
                ))}
              </div>
              <div className="h-1.5 w-1/3 bg-foreground/70 rounded mt-2 mb-1" />
              <div className="space-y-1">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-1 bg-muted rounded" style={{ opacity: 0.4 + i * 0.12 }} />
                ))}
              </div>
            </div>
          </div>
          <div className="mt-2 text-[10px] text-emerald-600 font-medium flex items-center gap-1">
            <Icon name="CheckCircle2" className="w-3 h-3" /> Fits one A4 page
          </div>
        </div>

        <div className="rounded-2xl bg-card border border-border shadow-card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Icon name="MessagesSquare" className="w-4 h-4 text-gold" />
            <span className="text-sm font-semibold">Interview prep</span>
          </div>
          <div className="space-y-2">
            {[
              ["Technical", "Q3 · medium"],
              ["Behavioral", "Q1 · easy"],
              ["Company", "Q5 · hard"],
            ].map(([cat, q]) => (
              <div key={cat} className="rounded-lg bg-secondary/60 p-2">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{cat}</div>
                <div className="text-xs font-medium">{q}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
