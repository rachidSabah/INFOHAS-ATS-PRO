"use client";

import { motion } from "framer-motion";
import { SectionTitle, Icon, Badge } from "@/components/shared";

const ITEMS = [
  {
    quote:
      "I'd been using Enhancv for two years and paying $24.99/mo. ResumeAI Pro gave me a higher ATS score — for free. The one-page enforcement alone is worth switching for.",
    name: "Priya Sharma",
    role: "Product Designer → Senior at Figma",
    avatar: "PS",
    color: "#EC4899",
  },
  {
    quote:
      "Three resume tools, three rejection emails. After running my resume through ResumeAI Pro's optimizer I got two onsite interviews within a week. The keyword gap analysis is unreal.",
    name: "Marcus Lee",
    role: "Backend Engineer → Staff at Datadog",
    avatar: "ML",
    color: "#1154A3",
  },
  {
    quote:
      "I run a career nonprofit for returning citizens. ResumeAI Pro lets us give every single person a premium resume, cover letter, and interview prep — completely free. It's a game-changer.",
    name: "Dana Williams",
    role: "Founder, SecondChance Careers",
    avatar: "DW",
    color: "#10B981",
  },
  {
    quote:
      "The interview prep package was the difference-maker. The STAR examples were so specific I literally used one verbatim in my final round. Got the offer.",
    name: "Yuki Tanaka",
    role: "Data Scientist → Airbnb",
    avatar: "YT",
    color: "#F59E0B",
  },
  {
    quote:
      "I manage recruiting for a 200-person startup. I now recommend ResumeAI Pro to every candidate we reject — it makes our pipeline measurably stronger.",
    name: "Hassan Ahmed",
    role: "Head of Talent, Vertex",
    avatar: "HA",
    color: "#8B5CF6",
  },
  {
    quote:
      "As a non-traditional candidate with no CS degree, the AI builder helped me reframe my self-taught experience into bullets that actually landed. I'm now a junior at Stripe.",
    name: "Elena Rodriguez",
    role: "Self-taught → Junior Engineer at Stripe",
    avatar: "ER",
    color: "#0EA5E9",
  },
];

export function Testimonials() {
  return (
    <section id="testimonials" className="py-20 sm:py-28 bg-secondary/40">
      <div className="mx-auto max-w-7xl px-4 sm:px-6">
        <SectionTitle
          eyebrow="Loved by job seekers"
          title={<>120,000+ offers and counting</>}
          subtitle="From bootcamp grads to senior leaders, people trust ResumeAI Pro to get past the bots and past the recruiters."
        />

        <div className="mt-12 columns-1 md:columns-2 lg:columns-3 gap-5 [column-fill:_balance]">
          {ITEMS.map((t, i) => (
            <motion.figure
              key={i}
              initial={{ opacity: 0, y: 16 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.4, delay: (i % 3) * 0.08 }}
              className="break-inside-avoid mb-5 rounded-2xl bg-card border border-border shadow-card p-6 hover:shadow-premium transition"
            >
              <div className="flex items-center gap-1 mb-3">
                {Array.from({ length: 5 }).map((_, j) => (
                  <Icon key={j} name="Star" className="w-4 h-4 fill-gold text-gold" />
                ))}
              </div>
              <blockquote className="text-sm text-foreground/90 leading-relaxed text-pretty">"{t.quote}"</blockquote>
              <figcaption className="mt-4 flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-white font-semibold text-xs"
                  style={{ background: t.color }}
                >
                  {t.avatar}
                </div>
                <div>
                  <div className="text-sm font-semibold">{t.name}</div>
                  <div className="text-xs text-muted-foreground">{t.role}</div>
                </div>
              </figcaption>
            </motion.figure>
          ))}
        </div>

        <div className="mt-12 flex flex-wrap items-center justify-center gap-4">
          <Badge variant="brand"><Icon name="Heart" className="w-3 h-3" /> 4.9/5 average rating</Badge>
          <Badge variant="gold"><Icon name="TrendingUp" className="w-3 h-3" /> +27 pts avg ATS lift</Badge>
          <Badge variant="success"><Icon name="Globe" className="w-3 h-3" /> Used in 142 countries</Badge>
        </div>
      </div>
    </section>
  );
}
