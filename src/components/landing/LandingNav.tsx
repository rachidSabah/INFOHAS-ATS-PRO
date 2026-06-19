"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Logo, Icon } from "@/components/shared";
import { useApp } from "@/lib/store";
import { BRAND } from "@/lib/brand";

const NAV = [
  { href: "#features", label: "Features" },
  { href: "#ats-demo", label: "ATS Checker" },
  { href: "#templates", label: "Templates" },
  { href: "#testimonials", label: "Testimonials" },
  { href: "#faq", label: "FAQ" },
  { href: "#blog", label: "Blog" },
];

export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  const openAuth = useApp((s) => s.openAuth);
  const setView = useApp((s) => s.setView);
  const isAuthed = useApp((s) => s.isAuthed);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const goApp = () => {
    if (isAuthed) setView("dashboard");
    else openAuth();
  };

  return (
    <header className={`sticky top-0 z-50 transition-all ${scrolled ? "glass shadow-card" : ""}`}>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 h-16 flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center" aria-label={BRAND.name}>
          <Logo size={34} />
        </Link>

        <nav className="hidden md:flex items-center gap-1" aria-label="Main">
          {NAV.map((n) => (
            <a
              key={n.href}
              href={n.href}
              className="px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/70 transition"
            >
              {n.label}
            </a>
          ))}
        </nav>

        <div className="hidden md:flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={goApp} className="text-sm">
            Sign in
          </Button>
          <Button size="sm" onClick={goApp} className="bg-brand hover:bg-brand-dark text-white gap-1.5">
            <Icon name="Rocket" className="w-4 h-4" />
            Launch app
          </Button>
        </div>

        <button
          className="md:hidden p-2 rounded-md hover:bg-secondary"
          onClick={() => setOpen((v) => !v)}
          aria-label="Toggle menu"
          aria-expanded={open}
        >
          <Icon name={open ? "X" : "Menu"} className="w-5 h-5" />
        </button>
      </div>

      {open && (
        <motion.div
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          className="md:hidden glass border-t border-border"
        >
          <nav className="px-4 py-3 flex flex-col gap-1" aria-label="Mobile">
            {NAV.map((n) => (
              <a
                key={n.href}
                href={n.href}
                onClick={() => setOpen(false)}
                className="px-3 py-2 rounded-md text-sm font-medium text-muted-foreground hover:bg-secondary"
              >
                {n.label}
              </a>
            ))}
            <div className="flex gap-2 mt-2">
              <Button variant="outline" size="sm" className="flex-1" onClick={goApp}>Sign in</Button>
              <Button size="sm" className="flex-1 bg-brand hover:bg-brand-dark text-white" onClick={goApp}>Launch</Button>
            </div>
          </nav>
        </motion.div>
      )}
    </header>
  );
}
