"use client";

import { motion } from "framer-motion";
import { SectionTitle, Icon, Badge } from "@/components/shared";

const POSTS = [
  {
    tag: "ATS",
    title: "The 2026 ATS cheat sheet: what bots actually scan for",
    excerpt: "We analyzed 1.4M resumes across 38 ATS systems. Here's exactly which sections, keywords, and formats move the needle — and which are myths.",
    readTime: "8 min",
    date: "Dec 1, 2025",
    color: "#1154A3",
  },
  {
    tag: "Career",
    title: "How to write bullets that recruiters actually finish reading",
    excerpt: "Recruiters spend 6.2 seconds on the first pass. Use the verb-number-impact framework to make every bullet earn its real estate.",
    readTime: "6 min",
    date: "Nov 22, 2025",
    color: "#F59E0B",
  },
  {
    tag: "Interview",
    title: "STAR method: 5 examples that aren't 'I led a project'",
    excerpt: "Most STAR examples are vague filler. Here are five real ones that impressed hiring managers — and how to write yours with the same texture.",
    readTime: "7 min",
    date: "Nov 10, 2025",
    color: "#10B981",
  },
];

export function BlogTeaser() {
  return (
    <section id="blog" className="py-20 sm:py-28 bg-secondary/40">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <SectionTitle
          eyebrow="From the blog"
          title={<>Hiring intel, <span className="gradient-text">decoded.</span></>}
          subtitle="Practical, data-backed advice for getting past the bots and past the recruiters."
        />
        <div className="mt-12 grid md:grid-cols-3 gap-5">
          {POSTS.map((p, i) => (
            <motion.article
              key={i}
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.4, delay: i * 0.08 }}
              className="group rounded-2xl bg-card border border-border shadow-card overflow-hidden hover:shadow-premium transition cursor-pointer"
            >
              <div className="aspect-[16/9] relative overflow-hidden" style={{ background: `linear-gradient(135deg, ${p.color}18, ${p.color}08)` }}>
                <div className="absolute inset-0 grid-bg opacity-40" />
                <div className="absolute bottom-3 left-3">
                  <span className="text-xs font-semibold px-2 py-1 rounded-md" style={{ background: p.color, color: "white" }}>{p.tag}</span>
                </div>
                <Icon name="FileText" className="absolute top-4 right-4 w-6 h-6" style={{ color: p.color }} />
              </div>
              <div className="p-5">
                <div className="flex items-center gap-3 text-xs text-muted-foreground mb-2">
                  <span>{p.date}</span>
                  <span>•</span>
                  <span className="flex items-center gap-1"><Icon name="Clock" className="w-3 h-3" /> {p.readTime}</span>
                </div>
                <h3 className="font-display font-bold text-base leading-snug group-hover:text-brand transition">{p.title}</h3>
                <p className="text-sm text-muted-foreground mt-2 text-pretty">{p.excerpt}</p>
                <div className="mt-4 flex items-center gap-1 text-xs font-semibold text-brand">
                  Read article <Icon name="ArrowRight" className="w-3 h-3 group-hover:translate-x-1 transition" />
                </div>
              </div>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  );
}
