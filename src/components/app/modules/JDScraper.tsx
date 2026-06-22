"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge, Icon } from "@/components/shared";
import { useApp, uid } from "@/lib/store";
import { callAI, extractJSON } from "@/lib/ai";
import { processAIResponse } from "@/lib/ai-response-processor";
import { toast } from "sonner";
import type { JobDescription } from "@/lib/types";

const SAMPLE_URLS = [
  "https://www.linkedin.com/jobs/view/1234567890/",
  "https://www.indeed.com/viewjob?jk=abc123",
  "https://www.glassdoor.com/job-listing/senior-engineer",
];

export function JDScraper() {
  const jds = useApp((s) => s.jobDescriptions);
  const addJD = useApp((s) => s.addJD);
  const removeJD = useApp((s) => s.removeJD);
  const setActiveJD = useApp((s) => s.setActiveJD);
  const setView = useApp((s) => s.setView);
  const log = useApp((s) => s.log);

  const [url, setUrl] = useState("");
  const [rawText, setRawText] = useState("");
  const [scraping, setScraping] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);

  const scrapeUrl = async () => {
    if (!url || !/^https?:\/\//.test(url)) {
      toast.error("Please enter a valid URL (including https://).");
      return;
    }
    setScraping(true);
    setLogLines([`Fetching ${url}…`]);
    // Abort the request after 20s so the spinner never spins forever.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch("/api/jd-scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
        signal: controller.signal,
      });

      // Safely parse JSON — handle empty/non-JSON responses
      const text = await res.text();
      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Server returned a non-JSON response (${res.status} ${res.statusText}). The site may be blocking our scraper.`);
      }

      if (!res.ok) throw new Error(data.error || `Fetch failed (${res.status})`);

      if (!data.text || data.text.trim().length < 30) {
        throw new Error("The page was fetched but no readable text was found. The site may use JavaScript rendering. Please paste the JD text manually.");
      }

      setLogLines((l) => [...l, `Retrieved ${data.text.length} chars.`, "Page text ready for AI extraction."]);
      setRawText(data.text);
      toast.success(`Scraped ${data.title || url}`);
    } catch (e: any) {
      const msg = e?.name === "AbortError"
        ? "The scrape request timed out after 20 seconds. The site may be slow or blocking our request — please paste the JD text manually below."
        : (e?.message || "Unknown error");
      setLogLines((l) => [...l, `⚠ ${msg}`, "Falling back: paste the JD text manually below."]);
      toast.error(msg.includes("paste") ? msg : "Couldn't fetch the URL. Please paste the JD text manually below — same AI extraction.");
    } finally {
      clearTimeout(timeout);
      setScraping(false);
    }
  };

  const extract = async () => {
    if (rawText.trim().length < 30) {
      toast.error("Please paste at least 30 characters of job description text.");
      return;
    }
    setExtracting(true);
    setLogLines((l) => [...l, "Calling AI to extract structure…"]);
    try {
      const result = await callAI({
        systemPrompt: "You are a job description parser. Extract structured data. Return ONLY valid JSON.",
        userPrompt: `Extract from this job description:\n\n${rawText}\n\nReturn JSON with keys: title, company, location, employmentType, salary, responsibilities (array of strings), requiredSkills (array), preferredSkills (array), technologies (array), experienceYears, education, keywords (array of 8-15 most important).`,
        maxTokens: 2000,
        taskCategory: "document",
      });

      // === DIAGNOSTICS ===
      console.group("Job URL Parsing");
      console.log("Provider:", result.provider);
      console.log("Raw Text Length:", rawText.length);
      console.log("AI Response Length:", result.text?.length ?? 0);
      console.log("AI Response Preview:", result.text?.slice(0, 200) ?? "(empty)");
      console.groupEnd();

      // Process through the AI Response Processing Layer — this catches
      // errors, repairs JSON, strips leaks, and validates safety
      const processed = processAIResponse<any>(result.text, result.provider, { expectJson: true });

      // === MORE DIAGNOSTICS ===
      console.log("Parsed JD:", processed.data);
      console.log("JD Description Length:", processed.data?.description?.length ?? "N/A");
      console.log("Keywords Extracted:", processed.data?.keywords?.length ?? 0);

      if (!processed.data) {
        // JSON parsing failed even after repair — use heuristic fallback
        setLogLines((l) => [...l, "⚠ AI did not return valid JSON — using heuristic fallback extraction."]);
        const words = rawText.toLowerCase().match(/\b[a-z][a-z0-9+#.]+\b/g) ?? [];
        const freq: Record<string, number> = {};
        for (const w of words) if (w.length > 2) freq[w] = (freq[w] || 0) + 1;
        const keywords = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k]) => k);
        const jd: JobDescription = {
          id: uid("jd"),
          title: "Parsed role",
          keywords,
          responsibilities: [],
          requiredSkills: [],
          preferredSkills: [],
          technologies: [],
          rawText,
          source: url ? "url" : "text",
          url: url || undefined,
          createdAt: new Date().toISOString(),
        };
        addJD(jd);
        toast.success(`Extracted ${keywords.length} keywords (heuristic fallback).`);
        setExtracting(false);
        return;
      }

      const data = processed.data;
      // === NORMALIZE: flatten any object values to strings ===
      const flattenLoc = (v: any): string | undefined => {
        if (!v) return undefined;
        if (typeof v === "string") return v;
        if (typeof v === "object") {
          const parts = [v.city, v.state, v.region, v.country, v.address].filter((x: any) => x && typeof x === "string");
          if (parts.length > 0) return parts.join(", ");
          return Object.values(v).filter(Boolean).join(", ");
        }
        return String(v);
      };
      const flattenStr = (v: any): string | undefined => {
        if (v === null || v === undefined) return undefined;
        if (typeof v === "string") return v;
        if (typeof v === "number" || typeof v === "boolean") return String(v);
        if (typeof v === "object") return JSON.stringify(v);
        return String(v);
      };
      const flattenArray = (v: any): string[] => {
        if (!Array.isArray(v)) return [];
        return v.map((x: any) => typeof x === "string" ? x : (typeof x === "object" ? JSON.stringify(x) : String(x))).filter(Boolean);
      };
      const jd: JobDescription = {
        id: uid("jd"),
        title: flattenStr(data.title) || "Untitled role",
        company: flattenStr(data.company),
        location: flattenLoc(data.location),
        employmentType: flattenStr(data.employmentType),
        salary: flattenStr(data.salary),
        responsibilities: flattenArray(data.responsibilities),
        requiredSkills: flattenArray(data.requiredSkills),
        preferredSkills: flattenArray(data.preferredSkills),
        technologies: flattenArray(data.technologies),
        experienceYears: flattenStr(data.experienceYears),
        education: flattenStr(data.education),
        keywords: flattenArray(data.keywords),
        rawText,
        source: url ? "url" : "text",
        url: url || undefined,
        createdAt: new Date().toISOString(),
      };
      addJD(jd);
      log({ actor: "you", action: "JD scraped & extracted", category: "ai", details: `${jd.title} at ${jd.company ?? "—"}`, severity: "info" });
      setLogLines((l) => [...l, `✓ Extracted ${jd.keywords.length} keywords, ${jd.requiredSkills.length} required skills.`, `Saved to library via ${result.provider}.`]);
      toast.success(`Extracted: ${jd.title}`);
      setUrl("");
      setRawText("");
    } catch (e: any) {
      setLogLines((l) => [...l, `⚠ ${e?.message}`, "Falling back to heuristic extraction."]);
      // Heuristic fallback
      const words = rawText.toLowerCase().match(/\b[a-z][a-z0-9+#.]+\b/g) ?? [];
      const freq: Record<string, number> = {};
      for (const w of words) if (w.length > 2) freq[w] = (freq[w] || 0) + 1;
      const keywords = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k]) => k);
      const jd: JobDescription = {
        id: uid("jd"),
        title: "Parsed role",
        keywords,
        responsibilities: [],
        requiredSkills: [],
        preferredSkills: [],
        technologies: [],
        rawText,
        source: url ? "url" : "text",
        url: url || undefined,
        createdAt: new Date().toISOString(),
      };
      addJD(jd);
      toast.success(`Extracted ${keywords.length} keywords (heuristic).`);
    } finally {
      setExtracting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="Search" className="w-6 h-6 text-brand" /> Job Description Scraper</h1>
        <p className="text-sm text-muted-foreground mt-1">Drop in any URL — LinkedIn, Indeed, Glassdoor, or a company careers page. We'll fetch, parse, and extract structured data.</p>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* URL scrape */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2"><Icon name="Link" className="w-4 h-4 text-brand" /> From a URL</CardTitle>
            <CardDescription>Works with LinkedIn, Indeed, Glassdoor, or any public job posting.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." className="flex-1" onKeyDown={(e) => e.key === "Enter" && scrapeUrl()} />
              <Button onClick={scrapeUrl} disabled={scraping} className="bg-brand hover:bg-brand-dark text-white gap-2">
                {scraping ? <Icon name="Loader2" className="w-4 h-4 animate-spin" /> : <Icon name="Download" className="w-4 h-4" />} Scrape
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SAMPLE_URLS.map((u) => (
                <button key={u} onClick={() => setUrl(u)} className="text-[10px] px-2 py-1 rounded-md bg-secondary hover:bg-secondary/70 text-muted-foreground truncate max-w-[180px]">
                  {u}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Note: some sites block server-side scraping. If that happens, paste the text instead — same AI extraction.</p>
          </CardContent>
        </Card>

        {/* Text paste */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2"><Icon name="ClipboardPaste" className="w-4 h-4 text-brand" /> From pasted text</CardTitle>
            <CardDescription>Copy-paste the JD and let the AI extract the structure.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={rawText}
              onChange={(e) => setRawText(e.target.value)}
              rows={6}
              placeholder="Paste the full job description here…"
            />
            <Button onClick={extract} disabled={extracting || rawText.length < 30} className="w-full bg-brand hover:bg-brand-dark text-white gap-2">
              {extracting ? <Icon name="Loader2" className="w-4 h-4 animate-spin" /> : <Icon name="Sparkles" className="w-4 h-4" />}
              {extracting ? "Extracting…" : "Extract with AI"}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Log */}
      {logLines.length > 0 && (
        <Card>
          <CardContent className="p-4">
            <div className="text-xs font-mono space-y-1 max-h-40 overflow-y-auto">
              {logLines.map((l, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="text-brand">›</span> <span className={l.startsWith("⚠") ? "text-amber-600" : l.startsWith("✓") ? "text-emerald-600" : ""}>{l}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Saved JDs */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg flex items-center gap-2"><Icon name="Library" className="w-4 h-4 text-brand" /> Saved job descriptions ({jds.length})</CardTitle>
              <CardDescription>Click any to use in the ATS checker or optimizer.</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-2 gap-3">
            {jds.map((j) => (
              <motion.div key={j.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="rounded-xl border border-border p-4 hover:shadow-premium transition">
                <div className="flex items-start justify-between mb-2">
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">{j.title}</div>
                    {j.company && <div className="text-xs text-muted-foreground">{j.company}{j.location ? ` · ${j.location}` : ""}</div>}
                  </div>
                  <Badge variant="outline" className="text-[10px] capitalize shrink-0 ml-2">{j.source}</Badge>
                </div>
                <div className="flex flex-wrap gap-1 mb-3">
                  {j.keywords.slice(0, 6).map((k) => <Badge key={k} variant="brand" className="text-[10px]">{k}</Badge>)}
                  {j.keywords.length > 6 && <Badge variant="outline" className="text-[10px]">+{j.keywords.length - 6}</Badge>}
                </div>
                <div className="flex gap-1.5">
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => { setActiveJD(j.id); setView("ats-checker"); }}>
                    <Icon name="ScanText" className="w-3.5 h-3.5 mr-1" /> ATS check
                  </Button>
                  <Button size="sm" variant="outline" className="flex-1" onClick={() => { setActiveJD(j.id); setView("optimizer"); }}>
                    <Icon name="Wand2" className="w-3.5 h-3.5 mr-1" /> Optimize
                  </Button>
                  <Button size="sm" variant="ghost" className="text-destructive" onClick={() => { removeJD(j.id); toast.success("Deleted."); }}>
                    <Icon name="Trash2" className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </motion.div>
            ))}
            {jds.length === 0 && (
              <div className="col-span-full text-center py-8">
                <Icon name="Library" className="w-10 h-10 text-muted-foreground/40 mx-auto" />
                <p className="text-sm text-muted-foreground mt-2">No saved JDs yet. Scrape or paste one above.</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
