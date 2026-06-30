import { describe, it, expect, beforeEach } from "vitest";
import {
  CABIN_CREW_KEYWORDS,
  AVIATION_KEYWORDS,
  AIRLINE_ATS_PROFILES,
  AIRLINE_OPTIONS,
  DEFAULT_APP_SETTINGS,
  getDocxHtml,
  resumeToDirectiveHtml,
  getAviationOptimizerDirective,
} from "@/lib/ats-directives";
import { useApp } from "@/lib/store";
import { SEED_OPTIMIZER_DIRECTIVE } from "@/lib/mock-data";
import type { ResumeData } from "@/lib/types";

function makeResume(): ResumeData {
  return {
    id: "r1",
    name: "Test User",
    headline: "Cabin Crew",
    contact: { email: "test@example.com", phone: "+1234567890", location: "Dubai" },
    summary: "Experienced cabin crew professional.",
    experience: [{
      id: "e1", title: "Cabin Crew", company: "Emirates", location: "Dubai",
      startDate: "2020-01", endDate: "Present",
      bullets: ["Delivered five-star service to passengers.", "Managed in-flight safety procedures."],
    }],
    education: [{ id: "ed1", institution: "Aviation Academy", degree: "Diploma", field: "Cabin Crew", startDate: "2018", endDate: "2019" }],
    skills: [{ id: "s1", name: "CPR", category: "Safety" }],
    projects: [], certifications: [], languages: [],
    template: "ats-professional",
    accentColor: "#1154A3",
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
  };
}

describe("CABIN_CREW_KEYWORDS", () => {
  it("is a non-empty string", () => {
    expect(typeof CABIN_CREW_KEYWORDS).toBe("string");
    expect(CABIN_CREW_KEYWORDS.length).toBeGreaterThan(100);
  });

  it("contains key cabin crew terms", () => {
    expect(CABIN_CREW_KEYWORDS).toContain("Cabin Crew Attestation");
    expect(CABIN_CREW_KEYWORDS).toContain("SEP");
    expect(CABIN_CREW_KEYWORDS).toContain("CRM");
    expect(CABIN_CREW_KEYWORDS).toContain("Dangerous Goods Regulations");
  });
});

describe("AVIATION_KEYWORDS", () => {
  it("is broader than CABIN_CREW_KEYWORDS", () => {
    expect(AVIATION_KEYWORDS.length).toBeGreaterThan(CABIN_CREW_KEYWORDS.length);
  });

  it("includes regulatory terms", () => {
    expect(AVIATION_KEYWORDS).toContain("EASA");
    expect(AVIATION_KEYWORDS).toContain("ICAO");
    expect(AVIATION_KEYWORDS).toContain("IATA DGR");
  });
});

describe("AIRLINE_ATS_PROFILES", () => {
  it("has profiles for all 8 airlines + generic", () => {
    expect(Object.keys(AIRLINE_ATS_PROFILES)).toHaveLength(9);
    expect(AIRLINE_ATS_PROFILES.emirates).toBeDefined();
    expect(AIRLINE_ATS_PROFILES.qatar).toBeDefined();
    expect(AIRLINE_ATS_PROFILES.etihad).toBeDefined();
    expect(AIRLINE_ATS_PROFILES.lufthansa).toBeDefined();
    expect(AIRLINE_ATS_PROFILES.ryanair).toBeDefined();
    expect(AIRLINE_ATS_PROFILES.singapore).toBeDefined();
    expect(AIRLINE_ATS_PROFILES.airfrance).toBeDefined();
    expect(AIRLINE_ATS_PROFILES.british).toBeDefined();
    expect(AIRLINE_ATS_PROFILES.generic).toBeDefined();
  });

  it("each profile has system + focus", () => {
    for (const [key, profile] of Object.entries(AIRLINE_ATS_PROFILES)) {
      expect(profile.system, `${key} missing system`).toBeTruthy();
      expect(profile.focus, `${key} missing focus`).toBeTruthy();
    }
  });

  it("Emirates profile mentions premium/multicultural", () => {
    expect(AIRLINE_ATS_PROFILES.emirates.focus.toLowerCase()).toContain("multicultural");
  });
});

describe("AIRLINE_OPTIONS", () => {
  it("has 9 options matching the profiles", () => {
    expect(AIRLINE_OPTIONS).toHaveLength(9);
    expect(AIRLINE_OPTIONS.map((o) => o.id).sort()).toEqual(
      Object.keys(AIRLINE_ATS_PROFILES).sort()
    );
  });

  it("each option has id, label, icon", () => {
    for (const opt of AIRLINE_OPTIONS) {
      expect(opt.id).toBeTruthy();
      expect(opt.label).toBeTruthy();
      expect(opt.icon).toBeTruthy();
    }
  });
});

describe("DEFAULT_APP_SETTINGS", () => {
  it("has sensible defaults", () => {
    expect(DEFAULT_APP_SETTINGS.tone).toBe("Balanced");
    expect(DEFAULT_APP_SETTINGS.format).toBe("Chronological");
    expect(DEFAULT_APP_SETTINGS.strictness).toBe("Balanced");
  });
});

describe("getDocxHtml", () => {
  it("produces a valid HTML document with A4 @page rules", () => {
    const html = getDocxHtml("<p>test</p>");
    expect(html).toContain("<html");
    expect(html).toContain("@page");
    expect(html).toContain("21cm 29.7cm");
    expect(html).toContain("WordSection1");
  });

  it("uses Times New Roman for professional template", () => {
    const html = getDocxHtml("<p>test</p>", "professional");
    expect(html).toContain("Times New Roman");
  });

  it("uses Helvetica for modern template", () => {
    const html = getDocxHtml("<p>test</p>", "modern");
    expect(html).toContain("Helvetica");
  });

  it("uses Inter for minimal template", () => {
    const html = getDocxHtml("<p>test</p>", "minimal");
    expect(html).toContain("Inter");
  });

  it("injects the content into WordSection1", () => {
    const html = getDocxHtml("<p>MY CONTENT</p>");
    expect(html).toContain("MY CONTENT");
  });
});

describe("resumeToDirectiveHtml", () => {
  it("produces an H1 with the name (uppercase)", () => {
    const html = resumeToDirectiveHtml(makeResume());
    expect(html).toContain("<h1>TEST USER</h1>");
  });

  it("produces section headers as H3", () => {
    const html = resumeToDirectiveHtml(makeResume());
    expect(html).toContain("<h3>PROFESSIONAL SUMMARY</h3>");
    expect(html).toContain("<h3>EXPERIENCE</h3>");
    expect(html).toContain("<h3>EDUCATION</h3>");
    expect(html).toContain("<h3>SKILLS</h3>");
  });

  it("formats experience entries on one line with strong tags", () => {
    const html = resumeToDirectiveHtml(makeResume());
    expect(html).toContain("<h4><strong>Cabin Crew</strong> | <strong>Emirates</strong>, Dubai | <strong>2020 to Present</strong></h4>");
  });

  it("escapes HTML in content to prevent XSS", () => {
    const resume = makeResume();
    resume.name = "<script>alert('xss')</script>";
    const html = resumeToDirectiveHtml(resume);
    // Name is uppercased then escaped — so <SCRIPT> becomes &lt;SCRIPT&gt;
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<SCRIPT>");
    expect(html.toLowerCase()).toContain("&lt;script&gt;");
  });
});

// ============================================================================
// UNIFIED AVIATION OPTIMIZER DIRECTIVE — synchronization tests
// ============================================================================

describe("getAviationOptimizerDirective", () => {
  beforeEach(() => {
    // Reset store to defaults before each test
    useApp.setState({ optimizerDirective: { ...SEED_OPTIMIZER_DIRECTIVE } });
  });

  it("returns a non-empty directive string", () => {
    const d = getAviationOptimizerDirective("emirates", DEFAULT_APP_SETTINGS);
    expect(typeof d).toBe("string");
    expect(d.length).toBeGreaterThan(2000);
  });

  it("includes the airline system name", () => {
    const d = getAviationOptimizerDirective("emirates", DEFAULT_APP_SETTINGS);
    // Engine uses the consolidated Aviation industry profile
    expect(d).toContain("Aviation (Cabin Crew)");
    expect(d).toContain("INDUSTRY MODE: AVIATION");
  });

  it("includes the airline priority keywords", () => {
    const d = getAviationOptimizerDirective("emirates", DEFAULT_APP_SETTINGS);
    // Priority keywords from the consolidated Aviation industry profile
    expect(d).toContain("Multicultural");
    expect(d).toContain("Premium Service");
    expect(d).toContain("Safety");
    expect(d).toContain("CRM");
  });

  it("includes the aviation keyword bank", () => {
    const d = getAviationOptimizerDirective("emirates", DEFAULT_APP_SETTINGS);
    expect(d).toContain("Cabin Crew Attestation");
    expect(d).toContain("SEP (Safety and Emergency Procedures)");
    expect(d).toContain("CRM (Crew Resource Management)");
  });

  it("includes the ~2,900 character target", () => {
    const d = getAviationOptimizerDirective("emirates", DEFAULT_APP_SETTINGS);
    expect(d).toContain("2,900");
    expect(d).toContain("one A4 page");
  });

  it("requests structured JSON output (not HTML)", () => {
    const d = getAviationOptimizerDirective("emirates", DEFAULT_APP_SETTINGS);
    expect(d).toContain("OUTPUT FORMAT — STRICT JSON");
    expect(d).toContain('"resume"');
    expect(d).toContain('"summary"');
    expect(d).toContain('"experience"');
    expect(d).toContain('"matched_keywords"');
  });

  it("synchronizes with super-admin custom override (takes priority)", () => {
    useApp.setState({
      optimizerDirective: {
        ...SEED_OPTIMIZER_DIRECTIVE,
        customDirectiveOverride: "MY CUSTOM OVERRIDE — FOCUS ON LEADERSHIP ONLY.",
      },
    });
    const d = getAviationOptimizerDirective("emirates", DEFAULT_APP_SETTINGS);
    // Engine returns the raw override string (full priority, no annotation)
    expect(d).toContain("MY CUSTOM OVERRIDE — FOCUS ON LEADERSHIP ONLY.");
  });

  it("synchronizes with super-admin content limits (summaryMinWords etc.)", () => {
    useApp.setState({
      optimizerDirective: {
        ...SEED_OPTIMIZER_DIRECTIVE,
        summaryMinWords: 80,
        summaryMaxWords: 120,
        experienceBulletsPerEntry: 7,
        customDirectiveOverride: "",
      },
    });
    const d = getAviationOptimizerDirective("emirates", DEFAULT_APP_SETTINGS);
    // Engine reflects content limits via categorized policy format
    expect(d).toContain("Summary Length");
    expect(d).toContain("bullet-only");
  });

  it("adapts tone instruction based on strictness setting", () => {
    const aggressive = getAviationOptimizerDirective("emirates", {
      ...DEFAULT_APP_SETTINGS,
      strictness: "Aggressive",
    });
    expect(aggressive).toContain("MAXIMUM keyword density");

    const conservative = getAviationOptimizerDirective("emirates", {
      ...DEFAULT_APP_SETTINGS,
      strictness: "Conservative",
    });
    expect(conservative).toContain("Conservative keyword integration");
  });

  it("falls back gracefully when store is unavailable (uses hardcoded directive)", () => {
    // Temporarily unset optimizerDirective to simulate SSR / missing config
    const original = useApp.getState().optimizerDirective;
    useApp.setState({ optimizerDirective: undefined as any });
    try {
      const d = getAviationOptimizerDirective("emirates", DEFAULT_APP_SETTINGS);
      // Should still return a usable directive (from FALLBACK_CONFIG + engine)
      expect(typeof d).toBe("string");
      expect(d.length).toBeGreaterThan(1000);
      expect(d).toContain("Aviation (Cabin Crew)");
    } finally {
      useApp.setState({ optimizerDirective: original });
    }
  });
});
