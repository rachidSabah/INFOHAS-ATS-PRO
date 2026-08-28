"use client";
import { parseResumeFile } from "@/lib/parser";
import { useState } from "react";

export default function DebugParse() {
  const [out, setOut] = useState<string>("");
  const [busy, setBusy] = useState(false);

  async function onFile(e: any) {
    const f = e.target.files?.[0];
    if (!f) return;
    setBusy(true);
    setOut("parsing...");
    try {
      const r = await parseResumeFile(f);
      const summary = {
        name: r.name,
        headline: r.headline,
        summary: (r.summary || "").slice(0, 120),
        experienceCount: (r.experience || []).length,
        educationCount: (r.education || []).length,
        skillsCount: (r.skills || []).length,
        languagesCount: (r.languages || []).length,
        exp0: r.experience?.[0] ? { title: r.experience[0].title, company: r.experience[0].company, bullets: (r.experience[0].bullets||[]).slice(0,2) } : null,
      };
      setOut(JSON.stringify(summary, null, 2));
    } catch (err: any) {
      setOut("ERROR: " + (err?.message || err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: 24, fontFamily: "monospace" }}>
      <h1>Debug Parse</h1>
      <input id="file" type="file" onChange={onFile} disabled={busy} />
      <pre id="out" style={{ whiteSpace: "pre-wrap", marginTop: 16 }}>{out}</pre>
    </div>
  );
}
