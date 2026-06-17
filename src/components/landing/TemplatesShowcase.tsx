"use client";

import { motion } from "framer-motion";
import { SectionTitle, Icon, Badge } from "@/components/shared";
import { TEMPLATES } from "@/lib/brand";

export function TemplatesShowcase() {
  return (
    <section id="templates" className="py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <SectionTitle
          eyebrow="Resume templates"
          title={<>ATS-tested templates, <span className="gradient-text">built to fit.</span></>}
          subtitle="Every template fits on exactly one A4 page — no exceptions. Pick a look, we'll handle the layout."
        />

        <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {TEMPLATES.map((t, i) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.4, delay: (i % 4) * 0.06 }}
              className="group relative rounded-2xl bg-card border border-border shadow-card overflow-hidden hover:shadow-premium transition-all hover:-translate-y-1"
            >
              <div className="aspect-[210/297] bg-white p-4 overflow-hidden relative">
                <TemplatePreview id={t.id} />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition flex items-end p-3">
                  <div className="text-white text-xs font-medium">Preview template</div>
                </div>
              </div>
              <div className="p-4 border-t border-border">
                <div className="flex items-center justify-between">
                  <h3 className="font-display font-bold text-sm">{t.name}</h3>
                  {!t.premium && <Badge variant="success">Free</Badge>}
                </div>
                <p className="text-xs text-muted-foreground mt-1">{t.description}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

function TemplatePreview({ id }: { id: string }) {
  if (id === "ats-professional") {
    return (
      <div className="text-[6px] leading-tight text-slate-700 space-y-1">
        <div className="text-[10px] font-bold text-slate-900">Alex Morgan</div>
        <div className="text-[6px] text-blue-700">Senior Frontend Engineer</div>
        <div className="text-[5px] text-slate-500">alex@example.com • SF, CA • linkedin</div>
        <div className="border-t border-slate-300 pt-0.5">
          <div className="font-bold text-[6px] text-blue-700">SUMMARY</div>
          <div className="space-y-0.5 mt-0.5">
            <div className="h-0.5 bg-slate-200 rounded" />
            <div className="h-0.5 bg-slate-200 rounded w-4/5" />
          </div>
        </div>
        <div>
          <div className="font-bold text-[6px] text-blue-700">EXPERIENCE</div>
          <div className="font-bold text-[6px] mt-0.5">Vercel — Sr. Engineer</div>
          <div className="space-y-0.5 mt-0.5">
            <div className="h-0.5 bg-slate-200 rounded" />
            <div className="h-0.5 bg-slate-200 rounded w-3/4" />
            <div className="h-0.5 bg-slate-200 rounded w-2/3" />
          </div>
        </div>
        <div>
          <div className="font-bold text-[6px] text-blue-700">SKILLS</div>
          <div className="h-0.5 bg-slate-200 rounded mt-0.5" />
        </div>
      </div>
    );
  }
  if (id === "executive") {
    return (
      <div className="text-[6px] leading-tight text-slate-700 space-y-1">
        <div className="text-center">
          <div className="text-[11px] font-bold text-slate-900" style={{ fontFamily: "Georgia, serif" }}>ALEX MORGAN</div>
          <div className="text-[6px] text-slate-600 italic">Senior Frontend Engineer</div>
          <div className="text-[5px] text-slate-500 mt-0.5">alex@example.com • SF, CA</div>
        </div>
        <div className="border-t-2 border-slate-800 pt-1">
          <div className="text-center font-bold text-[6px] tracking-wider">SUMMARY</div>
        </div>
      </div>
    );
  }
  if (id === "modern") {
    return (
      <div className="flex h-full text-[6px] leading-tight text-slate-700">
        <div className="w-1/3 bg-blue-700 text-white p-1.5 space-y-1">
          <div className="text-[8px] font-bold">Alex Morgan</div>
          <div className="text-[5px] opacity-90">Sr. Engineer</div>
          <div className="border-t border-white/30 pt-0.5">
            <div className="font-bold text-[5px]">CONTACT</div>
            <div className="text-[5px] opacity-90 mt-0.5">alex@example.com</div>
            <div className="text-[5px] opacity-90">SF, CA</div>
          </div>
          <div>
            <div className="font-bold text-[5px]">SKILLS</div>
            <div className="text-[5px] opacity-90 mt-0.5">React</div>
            <div className="text-[5px] opacity-90">TypeScript</div>
            <div className="text-[5px] opacity-90">Next.js</div>
          </div>
        </div>
        <div className="flex-1 p-1.5 space-y-1">
          <div className="font-bold text-[6px] text-blue-700">SUMMARY</div>
          <div className="h-0.5 bg-slate-200 rounded" />
          <div className="font-bold text-[6px] text-blue-700 mt-1">EXPERIENCE</div>
          <div className="font-bold text-[6px]">Vercel — Sr. Engineer</div>
          <div className="space-y-0.5">
            <div className="h-0.5 bg-slate-200 rounded" />
            <div className="h-0.5 bg-slate-200 rounded w-3/4" />
          </div>
        </div>
      </div>
    );
  }
  // Default minimal preview for others
  return (
    <div className="text-[6px] leading-tight text-slate-700 space-y-1">
      <div className="text-[10px] font-bold text-slate-900">{id.charAt(0).toUpperCase() + id.slice(1)}</div>
      <div className="border-t border-slate-300 pt-0.5 space-y-0.5">
        <div className="h-0.5 bg-slate-200 rounded" />
        <div className="h-0.5 bg-slate-200 rounded w-4/5" />
        <div className="h-0.5 bg-slate-200 rounded w-3/4" />
      </div>
    </div>
  );
}
