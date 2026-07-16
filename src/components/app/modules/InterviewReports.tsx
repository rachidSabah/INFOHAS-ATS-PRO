"use client";

// ============================================================================
// Phase 8.1.5 (P7) — Executive Recruiter Report + Export UI.
// generateExecutiveReport(ci) -> renderReportMarkdown(report). Export to
// PDF (jsPDF) / Word (docx) / Markdown / Print / Download / Share.
// PRESENTATION ONLY — no AI, no recomputation.
// ============================================================================

import { useMemo, useState } from "react";
import jsPDF from "jspdf";
import { Document, Packer, Paragraph, HeadingLevel, TextRun } from "docx";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Icon } from "@/components/shared";
import { useApp } from "@/lib/store";
import { generateExecutiveReport, renderReportMarkdown } from "@/lib/recruiter/executive-report";
import { useSessionIntelligence } from "@/components/recruiter/useSessionIntelligence";

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function safeName(s?: string) {
  return (s ?? "candidate").replace(/\s+/g, "_").toLowerCase();
}

export function InterviewReports() {
  const setView = useApp((s) => s.setView);
  const { sessions, selectedId, setSelectedId, ci } = useSessionIntelligence();
  const [copied, setCopied] = useState(false);

  const report = useMemo(() => (ci ? generateExecutiveReport(ci) : null), [ci]);
  const markdown = useMemo(() => (report ? renderReportMarkdown(report) : ""), [report]);

  if (sessions.length === 0 || !report) {
    return (
      <div className="space-y-6">
        <Header onBack={() => setView("recruiter")} />
        <Card><CardContent className="p-10 text-center text-muted-foreground">
          <Icon name="FileText" className="w-10 h-10 mx-auto mb-3 opacity-50" />
          <p className="text-sm">No interview report available yet.</p>
        </CardContent></Card>
      </div>
    );
  }

  const exportPDF = () => {
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    doc.setFontSize(10);
    let y = 48;
    for (const rawLine of markdown.split("\n")) {
      // wrap long lines to page width (~90 chars at 10pt)
      const wrapped = doc.splitTextToSize(rawLine || " ", 515) as string[];
      for (const line of wrapped) {
        if (y > 800) { doc.addPage(); y = 48; }
        doc.text(line, 40, y);
        y += 14;
      }
    }
    doc.save(`${safeName(report.candidate.name)}_executive_report.pdf`);
  };

  const exportWord = async () => {
    const doc = new Document({
      sections: [{
        children: markdown.split("\n").map((line) =>
          line.startsWith("# ") || line.startsWith("## ")
            ? new Paragraph({ text: line.replace(/^#+\s/, ""), heading: HeadingLevel.HEADING_1 })
            : new Paragraph({ children: [new TextRun(line || " ")] }),
        ),
      }],
    });
    const blob = await Packer.toBlob(doc);
    download(blob, `${safeName(report.candidate.name)}_executive_report.docx`);
  };

  const exportMarkdown = () => download(new Blob([markdown], { type: "text/markdown" }), `${safeName(report.candidate.name)}_executive_report.md`);

  const share = async () => {
    if (navigator.share) {
      try { await navigator.share({ title: "Executive Recruiter Report", text: markdown }); } catch { /* user cancelled */ }
    } else {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="space-y-6">
      <Header onBack={() => setView("recruiter")} />

      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h2 className="font-display text-xl font-bold">{report.candidate.name ?? "Candidate"}</h2>
          <p className="text-sm text-muted-foreground">Recommendation: {report.hiringRecommendation.replace("_", " ").toUpperCase()}</p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button size="sm" onClick={exportPDF}><Icon name="FileDown" className="w-4 h-4 mr-2" /> PDF</Button>
          <Button size="sm" onClick={exportWord}><Icon name="FileText" className="w-4 h-4 mr-2" /> Word</Button>
          <Button size="sm" variant="outline" onClick={exportMarkdown}><Icon name="Download" className="w-4 h-4 mr-2" /> Markdown</Button>
          <Button size="sm" variant="outline" onClick={() => window.print()}><Icon name="Printer" className="w-4 h-4 mr-2" /> Print</Button>
          <Button size="sm" variant="outline" onClick={share}><Icon name={copied ? "Check" : "Share2"} className="w-4 h-4 mr-2" /> {copied ? "Copied" : "Share"}</Button>
        </div>
      </div>

      {sessions.length > 1 && (
        <Card><CardContent className="p-4 flex flex-wrap gap-2">
          {sessions.map((s) => (
            <button key={s.id} onClick={() => setSelectedId(s.id)}
              className={`px-3 py-1.5 rounded-lg border text-sm ${s.id === selectedId ? "border-brand bg-brand/10" : "border-border hover:bg-accent/50"}`}>
              {s.role ?? s.company ?? "Candidate"}
            </button>
          ))}
        </CardContent></Card>
      )}

      <Tabs defaultValue="preview">
        <TabsList>
          <TabsTrigger value="preview">Preview</TabsTrigger>
          <TabsTrigger value="markdown">Markdown</TabsTrigger>
        </TabsList>
        <TabsContent value="preview" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Section title="Executive Summary" body={report.executiveSummary} />
            <Section title="Candidate Summary" body={report.candidateSummary} />
            <Section title="Interview Overview" body={report.interviewOverview} />
            <Section title="Risk Assessment" body={report.riskAssessment} />
            <Card className="md:col-span-2">
              <CardHeader><CardTitle className="text-base">Competencies</CardTitle></CardHeader>
              <CardContent className="space-y-1.5">
                {report.competencies.map((c) => (
                  <div key={c.label} className="flex items-center gap-3 text-sm">
                    <span className="w-44 truncate">{c.label}</span>
                    <span className="font-medium w-10">{c.score}</span>
                    {c.risk && <span className="text-xs text-red-500">risk</span>}
                  </div>
                ))}
              </CardContent>
            </Card>
            <ListSection title="Strengths" items={report.strengths} />
            <ListSection title="Weaknesses" items={report.weaknesses} />
            <ListSection title="Follow-up Questions" items={report.followUpQuestions} />
            <ListSection title="Training Plan" items={report.trainingPlan} />
          </div>
        </TabsContent>
        <TabsContent value="markdown" className="mt-4">
          <Card><CardContent>
            <pre className="text-xs whitespace-pre-wrap max-h-[600px] overflow-auto">{markdown}</pre>
          </CardContent></Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Section({ title, body }: { title: string; body: string }) {
  return (
    <Card><CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent><p className="text-sm text-pretty">{body}</p></CardContent></Card>
  );
}

function ListSection({ title, items }: { title: string; items: string[] }) {
  return (
    <Card><CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent><ul className="list-disc pl-5 space-y-1 text-sm">{items.map((i, k) => <li key={k}>{i}</li>)}</ul></CardContent></Card>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <div className="flex items-center gap-3">
      <Button variant="ghost" size="icon" onClick={onBack} aria-label="Back to recruiter">
        <Icon name="ArrowLeft" className="w-4 h-4" />
      </Button>
      <div>
        <h1 className="font-display text-2xl font-bold">Executive Reports</h1>
        <p className="text-sm text-muted-foreground">Structured recruiter reports with export.</p>
      </div>
    </div>
  );
}
