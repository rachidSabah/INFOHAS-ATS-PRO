"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { SectionTitle, Icon } from "@/components/shared";

const FAQS = [
  {
    q: "Is ResumeAI Pro really completely free?",
    a: "Yes. No subscriptions, no premium tiers, no paywalls, no watermarks, no feature restrictions. Unlimited resumes, ATS checks, downloads, templates, cover letters, and interview prep — forever. We're sustained by optional donations and non-intrusive sponsorships that never block features.",
  },
  {
    q: "How does the AI work without me paying for an API key?",
    a: "ResumeAI Pro uses Puter.js as its primary AI provider — when you click 'Sign in with Google' (or GitHub, etc.) inside the app, you authenticate with Puter and the AI calls run under your own free Puter account. We also bundle a built-in Z.ai fallback, plus support for 15+ custom providers (OpenAI, Claude, Gemini, DeepSeek, Groq, Mistral, Cohere, Perplexity, OpenRouter, Together, HuggingFace, Ollama, Azure OpenAI, AWS Bedrock, and self-hosted LLMs) in the Super Admin dashboard.",
  },
  {
    q: "Will my resume really fit on one A4 page?",
    a: "Always. We enforce maxPages = 1, paperSize = A4, allowOverflow = false at the export layer. If your content would overflow, we automatically compress spacing, reduce font size, condense bullets, AI-rewrite to be more concise, remove optional sections, and rebalance the layout. We validate with assert(pdf.pages === 1) and refuse to export if validation fails.",
  },
  {
    q: "Which file formats are supported for upload and export?",
    a: "Upload: PDF, DOC, DOCX, TXT (max 20MB). Export: PDF, DOCX, TXT for resumes and cover letters; PDF and DOCX for interview prep packages. Files are parsed and generated entirely in your browser — your data never leaves your device unless you explicitly connect a cloud AI provider.",
  },
  {
    q: "Can I use my own AI provider instead of Puter?",
    a: "Yes. In Super Admin → AI Providers you can add any of the 15+ supported providers (OpenAI, Claude, Gemini, DeepSeek, Groq, Mistral, Cohere, Perplexity, OpenRouter, Together, HuggingFace, Ollama, Azure OpenAI, AWS Bedrock, custom, or self-hosted) by entering your own API URL, key, headers, parameters, model name, priority, timeout, max tokens, and temperature. Automatic failover rotates between active providers on timeout, rate limit, quota, error, or service unavailable.",
  },
  {
    q: "How is this deployed? Can I self-host?",
    a: "ResumeAI Pro is Cloudflare-native: Pages for the frontend, Workers + Hono for the backend, D1 + Drizzle for the database, R2 for storage, KV for cache, Queues for async work, and Durable Objects for real-time. The repository includes wrangler.toml, .env.example, GitHub Actions CI/CD, Docker + Docker Compose, and backup scripts. Self-hosting takes about 15 minutes.",
  },
  {
    q: "Is my data private and secure?",
    a: "Yes. JWT-based auth with secure cookies, CSRF protection, XSS protection, SQL injection protection, rate limiting, encryption at rest, encrypted API keys, and full audit logging. File parsing runs client-side whenever possible. We never sell your data — there are no ads to sell your attention to either.",
  },
  {
    q: "What about accessibility and international users?",
    a: "We're WCAG-compliant with full keyboard navigation, screen reader support, and high-contrast mode. Templates include a Europass variant for European job markets, and the AI resume translator supports 30+ languages. The app is fully responsive and installable as a PWA on desktop and mobile.",
  },
];

export function FAQ() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section id="faq" className="py-20 sm:py-28">
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <SectionTitle
          eyebrow="FAQ"
          title={<>Everything you want to know</>}
          subtitle="Still have questions? Drop us a note — we reply within 24 hours."
        />
        <div className="mt-12 space-y-3">
          {FAQS.map((f, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 12 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.35, delay: i * 0.04 }}
              className="rounded-xl bg-card border border-border shadow-card overflow-hidden"
            >
              <button
                onClick={() => setOpen(open === i ? null : i)}
                className="w-full flex items-center justify-between gap-4 p-5 text-left hover:bg-secondary/50 transition"
                aria-expanded={open === i}
              >
                <span className="font-semibold text-sm sm:text-base">{f.q}</span>
                <Icon
                  name="ChevronDown"
                  className={`w-5 h-5 text-muted-foreground transition-transform shrink-0 ${open === i ? "rotate-180" : ""}`}
                />
              </button>
              <AnimatePresence initial={false}>
                {open === i && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    className="overflow-hidden"
                  >
                    <div className="px-5 pb-5 text-sm text-muted-foreground text-pretty leading-relaxed">{f.a}</div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
