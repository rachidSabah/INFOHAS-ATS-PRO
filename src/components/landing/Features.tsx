"use client";

import { motion } from "framer-motion";
import { SectionTitle, Icon } from "@/components/shared";

const FEATURES = [
  {
    icon: "ScanText",
    title: "ATS Resume Checker",
    desc: "Six-axis scoring — ATS, formatting, keywords, content, grammar, completeness. Detailed recommendations, missing keywords, weak sections, and concrete fixes.",
    color: "#1154A3",
  },
  {
    icon: "FilePlus2",
    title: "AI Resume Builder",
    desc: "Seven ATS-tested templates. Live A4 preview. Strict one-page enforcement — we never let your resume spill to a second page.",
    color: "#F59E0B",
  },
  {
    icon: "Wand2",
    title: "Resume Optimizer",
    desc: "Upload your resume, paste a job description, and let the AI rewrite your bullets, embed missing keywords, and rebalance the layout — all on one page.",
    color: "#10B981",
  },
  {
    icon: "Mail",
    title: "Cover Letter Generator",
    desc: "Modern, traditional, executive, and short email templates. AI-drafted, fully editable, exported to PDF / DOCX / TXT in one click.",
    color: "#8B5CF6",
  },
  {
    icon: "Search",
    title: "Job Description Scraper",
    desc: "Drop in any URL — LinkedIn, Indeed, Glassdoor, or a company careers page — and we extract title, company, skills, requirements, keywords, and salary.",
    color: "#EC4899",
  },
  {
    icon: "MessagesSquare",
    title: "Interview Prep",
    desc: "Technical, behavioral, situational, HR, and company-specific questions — each with a recommended answer, STAR example, talking points, and follow-ups.",
    color: "#0EA5E9",
  },
  {
    icon: "Cpu",
    title: "Multi-AI Provider System",
    desc: "Puter.js, OpenAI, Claude, Gemini, DeepSeek, Groq, Mistral, Cohere, Perplexity, OpenRouter, Together, HuggingFace, Ollama, Azure, Bedrock, custom — with automatic failover.",
    color: "#1154A3",
  },
  {
    icon: "ShieldCheck",
    title: "RBAC + Admin Dashboards",
    desc: "User, Admin, and Super Admin roles. Manage AI providers, prompts, branding, feature flags, audit logs — all from a premium control panel.",
    color: "#F59E0B",
  },
  {
    icon: "Smartphone",
    title: "PWA + Cloudflare-Ready",
    desc: "Installable on desktop and mobile, offline-friendly, and pre-wired for Cloudflare Pages + Workers + D1 + R2 + KV + Queues.",
    color: "#10B981",
  },
];

export function Features() {
  return (
    <section id="features" className="relative py-20 sm:py-28">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <SectionTitle
          eyebrow="Everything you need"
          title={<>One platform. <span className="gradient-text">Every tool.</span></>}
          subtitle="Stop stitching together free trials. ResumeAI Pro gives you the full premium suite — completely free, forever."
        />

        <div className="mt-12 grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map((f, i) => (
            <motion.div
              key={f.title}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.4, delay: (i % 3) * 0.08 }}
              className="group relative rounded-2xl bg-card border border-border shadow-card p-6 hover:shadow-premium hover:-translate-y-0.5 transition-all"
            >
              <div
                className="w-12 h-12 rounded-xl flex items-center justify-center mb-4 transition-transform group-hover:scale-110"
                style={{ background: `${f.color}14`, color: f.color }}
              >
                <Icon name={f.icon} className="w-5 h-5" />
              </div>
              <h3 className="font-display font-bold text-lg mb-2">{f.title}</h3>
              <p className="text-sm text-muted-foreground text-pretty">{f.desc}</p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
