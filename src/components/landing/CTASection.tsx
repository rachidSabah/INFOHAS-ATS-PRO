"use client";

import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/shared";
import { useApp } from "@/lib/store";

export function CTASection() {
  const openAuth = useApp((s) => s.openAuth);
  const setView = useApp((s) => s.setView);
  const isAuthed = useApp((s) => s.isAuthed);
  const goApp = () => (isAuthed ? setView("dashboard") : openAuth());

  return (
    <section className="py-20 sm:py-28">
      <div className="mx-auto max-w-5xl px-4 sm:px-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.97 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.5 }}
          className="relative rounded-3xl overflow-hidden gradient-brand text-white p-10 sm:p-14 text-center shadow-premium"
        >
          <div className="absolute inset-0 grid-bg opacity-20" aria-hidden />
          <div className="absolute -top-12 -left-12 w-56 h-56 rounded-full bg-gold/30 blur-3xl" />
          <div className="absolute -bottom-12 -right-12 w-56 h-56 rounded-full bg-white/10 blur-3xl" />
          <div className="relative">
            <h2 className="font-display text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-balance">
              Your next offer is on the other side of one A4 page.
            </h2>
            <p className="mt-4 text-white/85 max-w-2xl mx-auto text-pretty">
              Launch ResumeAI Pro, drop in your resume, and watch your ATS score jump — completely free, forever.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
              <Button size="lg" onClick={goApp} className="bg-white text-brand hover:bg-white/90 gap-2">
                <Icon name="Sparkles" className="w-4 h-4" />
                Launch the app
              </Button>
              <a href="#features">
                <Button size="lg" variant="outline" className="bg-transparent border-white/40 text-white hover:bg-white/10 hover:text-white gap-2">
                  See features
                  <Icon name="ArrowRight" className="w-4 h-4" />
                </Button>
              </a>
            </div>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-white/70">
              <span className="flex items-center gap-1"><Icon name="Check" className="w-3 h-3" /> No credit card</span>
              <span className="flex items-center gap-1"><Icon name="Check" className="w-3 h-3" /> No signup wall</span>
              <span className="flex items-center gap-1"><Icon name="Check" className="w-3 h-3" /> No watermarks</span>
              <span className="flex items-center gap-1"><Icon name="Check" className="w-3 h-3" /> Unlimited downloads</span>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
