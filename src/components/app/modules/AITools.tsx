"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge, Icon } from "@/components/shared";
import { useApp, uid } from "@/lib/store";
import { callAI } from "@/lib/ai";
import { toast } from "sonner";

const TOOLS = [
  { id: "summary", name: "Professional Summary Generator", icon: "AlignLeft", desc: "Generate a 2-3 line summary from your experience.", color: "#1154A3" },
  { id: "bullets", name: "Bullet Point Generator", icon: "List", desc: "Rewrite weak bullets with measurable outcomes.", color: "#F59E0B" },
  { id: "linkedin", name: "LinkedIn Profile Generator", icon: "Linkedin", desc: "Generate a full LinkedIn About + Experience section.", color: "#0EA5E9" },
  { id: "translator", name: "Resume Translator", icon: "Languages", desc: "Translate your resume to 30+ languages.", color: "#10B981" },
  { id: "career", name: "Career Advisor", icon: "Compass", desc: "Get tailored next-role suggestions.", color: "#8B5CF6" },
  { id: "keywords", name: "Keyword Generator", icon: "KeyRound", desc: "Extract industry keywords from your field.", color: "#EC4899" },
  { id: "skills", name: "Skill Suggestions", icon: "Wrench", desc: "Suggest skills you should add based on your role.", color: "#1154A3" },
  { id: "rewrite", name: "Resume Rewriter", icon: "RefreshCcw", desc: "Rewrite your entire resume section-by-section.", color: "#F59E0B" },
];

export function AITools() {
  const resumes = useApp((s) => s.resumes);
  const incUsage = useApp((s) => s.incUsage);
  const log = useApp((s) => s.log);

  const [active, setActive] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [running, setRunning] = useState(false);

  const resume = resumes[0];

  const run = async () => {
    if (!active) return;
    setRunning(true);
    setOutput("");
    try {
      let sys = "You are ResumeAI Pro, an expert career assistant. Respond clearly and concisely.";
      let user = input;
      if (active === "summary") {
        user = `Generate a 2-3 line professional summary for:\n${input || JSON.stringify(resume?.experience)}`;
      } else if (active === "bullets") {
        user = `Rewrite these bullets with strong action verbs and measurable outcomes (one per line):\n${input}`;
      } else if (active === "linkedin") {
        user = `Generate a LinkedIn About section (~250 words) and 3 experience entries from this resume:\n${input || JSON.stringify(resume ?? {})}`;
      } else if (active === "translator") {
        user = `Translate this resume content to French (keep proper nouns):\n${input}`;
      } else if (active === "career") {
        user = `Suggest 5 next career roles with rationale, based on:\n${input || JSON.stringify(resume?.experience)}`;
      } else if (active === "keywords") {
        user = `Extract the 15 most important ATS keywords for this role/field:\n${input}`;
      } else if (active === "skills") {
        user = `Suggest 10 skills (with brief justification) this candidate should add:\n${input || JSON.stringify(resume?.skills)}`;
      } else if (active === "rewrite") {
        user = `Rewrite this resume section to be ATS-friendly and impactful:\n${input}`;
      }
      const result = await callAI({ systemPrompt: sys, userPrompt: user, maxTokens: 1500, taskCategory: "document" });
      setOutput(result.text);
      incUsage("resumesGenerated");
      log({ actor: "you", action: `AI tool: ${active}`, category: "ai", details: `via ${result.provider}`, severity: "info" });
      toast.success(`Generated via ${result.provider}`);
    } catch (e: any) {
      toast.error(e?.message || "Failed.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="Sparkles" className="w-6 h-6 text-brand" /> AI Tools</h1>
        <p className="text-sm text-muted-foreground mt-1">Eleven AI-powered generators. Free, unlimited. Pick a tool and start writing.</p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {TOOLS.map((t) => (
          <button
            key={t.id}
            onClick={() => { setActive(t.id); setInput(""); setOutput(""); }}
            className={`text-left rounded-xl border p-4 transition ${active === t.id ? "border-brand bg-brand-light/40 shadow-premium" : "border-border hover:border-brand/40 hover:shadow-card"}`}
          >
            <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-3" style={{ background: `${t.color}15`, color: t.color }}>
              <Icon name={t.icon} className="w-5 h-5" />
            </div>
            <div className="font-semibold text-sm">{t.name}</div>
            <div className="text-xs text-muted-foreground mt-1">{t.desc}</div>
          </button>
        ))}
      </div>

      {active && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <Icon name={TOOLS.find((t) => t.id === active)?.icon ?? "Sparkles"} className="w-4 h-4 text-brand" />
                {TOOLS.find((t) => t.id === active)?.name}
              </CardTitle>
              <Button size="sm" variant="ghost" onClick={() => setActive(null)}><Icon name="X" className="w-4 h-4" /></Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              rows={6}
              placeholder="Paste your content here, or leave blank to use your current resume…"
            />
            <Button onClick={run} disabled={running} className="bg-brand hover:bg-brand-dark text-white gap-2">
              {running ? <Icon name="Loader2" className="w-4 h-4 animate-spin" /> : <Icon name="Sparkles" className="w-4 h-4" />}
              {running ? "Generating…" : "Generate"}
            </Button>
            {output && (
              <div className="rounded-lg border border-border bg-secondary/40 p-4">
                <div className="flex items-center justify-between mb-2">
                  <Badge variant="success"><Icon name="CheckCircle2" className="w-3 h-3" /> Output</Badge>
                  <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(output); toast.success("Copied to clipboard."); }}>
                    <Icon name="Copy" className="w-3.5 h-3.5" /> Copy
                  </Button>
                </div>
                <pre className="whitespace-pre-wrap text-sm font-sans text-foreground/90 text-pretty">{output}</pre>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
