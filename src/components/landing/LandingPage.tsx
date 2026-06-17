"use client";

import { LandingNav } from "./LandingNav";
import { Hero } from "./Hero";
import { Features } from "./Features";
import { ATSDemo } from "./ATSDemo";
import { TemplatesShowcase } from "./TemplatesShowcase";
import { Testimonials } from "./Testimonials";
import { BlogTeaser } from "./BlogTeaser";
import { FAQ } from "./FAQ";
import { NewsletterContact } from "./NewsletterContact";
import { CTASection } from "./CTASection";
import { LandingFooter } from "./LandingFooter";

export function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background">
      <LandingNav />
      <main className="flex-1">
        <Hero />
        <Features />
        <ATSDemo />
        <TemplatesShowcase />
        <Testimonials />
        <BlogTeaser />
        <FAQ />
        <CTASection />
        <NewsletterContact />
      </main>
      <LandingFooter />
    </div>
  );
}
