"use client";

import Link from "next/link";
import { Logo, Icon } from "@/components/shared";
import { BRAND } from "@/lib/brand";
import { useApp } from "@/lib/store";

const COLUMNS = [
  {
    title: "Product",
    links: [
      ["ATS Checker", "#ats-demo"],
      ["Resume Builder", "#templates"],
      ["Resume Optimizer", "#features"],
      ["Cover Letters", "#features"],
      ["Interview Prep", "#features"],
    ],
  },
  {
    title: "Resources",
    links: [
      ["Blog", "#blog"],
      ["FAQ", "#faq"],
      ["ATS Guide", "#blog"],
      ["Templates", "#templates"],
      ["Testimonials", "#testimonials"],
    ],
  },
  {
    title: "Company",
    links: [
      ["About", "#"],
      ["Contact", "#contact"],
      ["Privacy", "#"],
      ["Terms", "#"],
      ["Security", "#"],
    ],
  },
];

export function LandingFooter() {
  const openAuth = useApp((s) => s.openAuth);
  const setView = useApp((s) => s.setView);
  const isAuthed = useApp((s) => s.isAuthed);
  const toggleTheme = useApp((s) => s.toggleTheme);
  const theme = useApp((s) => s.theme);

  const goApp = () => (isAuthed ? setView("dashboard") : openAuth());

  return (
    <footer className="bg-sidebar text-sidebar-foreground mt-auto">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-14">
        <div className="grid lg:grid-cols-12 gap-10">
          <div className="lg:col-span-4">
            <div className="flex items-center">
              <Logo size={36} className="[&_span]:text-sidebar-foreground [&_.gradient-text]:text-gold" />
            </div>
            <p className="mt-4 text-sm text-sidebar-foreground/70 max-w-sm text-pretty">
              {BRAND.description}
            </p>
            <div className="mt-6 flex gap-3">
              <a
                href={BRAND.social.github}
                target="_blank"
                rel="noreferrer noopener"
                className="w-9 h-9 rounded-lg bg-sidebar-accent hover:bg-sidebar-accent/70 flex items-center justify-center transition"
                aria-label="GitHub"
              >
                <Icon name="Github" className="w-4 h-4" />
              </a>
              <a
                href={BRAND.social.twitter}
                target="_blank"
                rel="noreferrer noopener"
                className="w-9 h-9 rounded-lg bg-sidebar-accent hover:bg-sidebar-accent/70 flex items-center justify-center transition"
                aria-label="Twitter"
              >
                <Icon name="Twitter" className="w-4 h-4" />
              </a>
              <button
                onClick={goApp}
                className="px-3 h-9 rounded-lg gradient-gold text-sidebar flex items-center gap-1.5 text-xs font-semibold hover:opacity-90 transition"
              >
                <Icon name="Rocket" className="w-3.5 h-3.5" /> Launch app
              </button>
            </div>
          </div>

          <div className="lg:col-span-8 grid sm:grid-cols-3 gap-8">
            {COLUMNS.map((c) => (
              <div key={c.title}>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/60 mb-3">{c.title}</h4>
                <ul className="space-y-2">
                  {c.links.map(([label, href]) => (
                    <li key={label}>
                      <a href={href} className="text-sm text-sidebar-foreground/80 hover:text-gold transition">
                        {label}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-12 pt-6 border-t border-sidebar-border flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-sidebar-foreground/60">
            © {new Date().getFullYear()} {BRAND.name}. Free forever. Built with ♥ for job seekers everywhere.
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={toggleTheme}
              className="text-xs text-sidebar-foreground/70 hover:text-gold flex items-center gap-1.5"
              aria-label="Toggle theme"
            >
              <Icon name={theme === "light" ? "Moon" : "Sun"} className="w-4 h-4" />
              {theme === "light" ? "Dark" : "Light"} mode
            </button>
            <span className="text-xs text-sidebar-foreground/40">·</span>
            <span className="text-xs text-sidebar-foreground/60 flex items-center gap-1">
              <Icon name="ShieldCheck" className="w-3.5 h-3.5 text-emerald-400" /> 100% free
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
