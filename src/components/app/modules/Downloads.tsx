"use client";

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, Icon } from "@/components/shared";
import { useApp } from "@/lib/store";
import {
  exportResumePDF, exportResumeDOCX, exportResumeTXT,
  exportCoverLetterPDF, exportCoverLetterDOCX, exportCoverLetterTXT,
  exportInterviewPDF, exportInterviewDOCX,
} from "@/lib/exporter";

export function Downloads() {
  const resumes = useApp((s) => s.resumes);
  const coverLetters = useApp((s) => s.coverLetters);
  const interviews = useApp((s) => s.interviews);
  const incUsage = useApp((s) => s.incUsage);
  const log = useApp((s) => s.log);

  const downloadResume = (r: any, fmt: "pdf" | "docx" | "txt") => {
    if (fmt === "pdf") { const res = exportResumePDF(r, { enforceOnePage: true }); if (!res.ok) return; }
    if (fmt === "docx") exportResumeDOCX(r);
    if (fmt === "txt") exportResumeTXT(r);
    incUsage("downloads");
    log({ actor: "you", action: `Downloaded resume (${fmt})`, category: "export", details: `${r.name}_resume.${fmt}`, severity: "info" });
  };

  const downloadCL = (c: any, fmt: "pdf" | "docx" | "txt") => {
    if (fmt === "pdf") exportCoverLetterPDF(c);
    if (fmt === "docx") exportCoverLetterDOCX(c);
    if (fmt === "txt") exportCoverLetterTXT(c);
    incUsage("downloads");
    log({ actor: "you", action: `Downloaded cover letter (${fmt})`, category: "export", details: `${c.title}.${fmt}`, severity: "info" });
  };

  const downloadIV = (p: any, fmt: "pdf" | "docx") => {
    if (fmt === "pdf") exportInterviewPDF(p);
    if (fmt === "docx") exportInterviewDOCX(p);
    incUsage("downloads");
    log({ actor: "you", action: `Downloaded interview prep (${fmt})`, category: "export", details: `${p.role}.pdf`, severity: "info" });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold flex items-center gap-2"><Icon name="Download" className="w-6 h-6 text-brand" /> Downloads</h1>
        <p className="text-sm text-muted-foreground mt-1">All your generated files in one place. Free, unlimited, no watermarks.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Icon name="FileText" className="w-4 h-4 text-brand" /> Resumes ({resumes.length})</CardTitle>
          <CardDescription>PDF (one A4 page guaranteed) · DOCX · TXT</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {resumes.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border">
              <div className="min-w-0">
                <div className="font-semibold text-sm truncate">{r.name}_resume</div>
                <div className="text-xs text-muted-foreground">{r.headline ?? r.template}</div>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <Button size="sm" variant="outline" onClick={() => downloadResume(r, "pdf")} className="gap-1.5"><Icon name="Download" className="w-3.5 h-3.5" /> PDF</Button>
                <Button size="sm" variant="outline" onClick={() => downloadResume(r, "docx")} className="gap-1.5"><Icon name="FileType" className="w-3.5 h-3.5" /> DOCX</Button>
                <Button size="sm" variant="outline" onClick={() => downloadResume(r, "txt")} className="gap-1.5"><Icon name="FileText" className="w-3.5 h-3.5" /> TXT</Button>
              </div>
            </div>
          ))}
          {resumes.length === 0 && <Empty icon="FileText" label="No resumes yet" />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Icon name="Mail" className="w-4 h-4 text-brand" /> Cover letters ({coverLetters.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {coverLetters.map((c) => (
            <div key={c.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border">
              <div className="min-w-0">
                <div className="font-semibold text-sm truncate">{c.title}</div>
                <div className="text-xs text-muted-foreground capitalize">{c.template} · {c.content.split(/\s+/).length} words</div>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <Button size="sm" variant="outline" onClick={() => downloadCL(c, "pdf")} className="gap-1.5"><Icon name="Download" className="w-3.5 h-3.5" /> PDF</Button>
                <Button size="sm" variant="outline" onClick={() => downloadCL(c, "docx")} className="gap-1.5"><Icon name="FileType" className="w-3.5 h-3.5" /> DOCX</Button>
                <Button size="sm" variant="outline" onClick={() => downloadCL(c, "txt")} className="gap-1.5"><Icon name="FileText" className="w-3.5 h-3.5" /> TXT</Button>
              </div>
            </div>
          ))}
          {coverLetters.length === 0 && <Empty icon="Mail" label="No cover letters yet" />}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2"><Icon name="MessagesSquare" className="w-4 h-4 text-brand" /> Interview packages ({interviews.length})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {interviews.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border">
              <div className="min-w-0">
                <div className="font-semibold text-sm truncate">{p.role ?? "Interview prep"}{p.company ? ` — ${p.company}` : ""}</div>
                <div className="text-xs text-muted-foreground">{p.questions.length} questions</div>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <Button size="sm" variant="outline" onClick={() => downloadIV(p, "pdf")} className="gap-1.5"><Icon name="Download" className="w-3.5 h-3.5" /> PDF</Button>
                <Button size="sm" variant="outline" onClick={() => downloadIV(p, "docx")} className="gap-1.5"><Icon name="FileType" className="w-3.5 h-3.5" /> DOCX</Button>
              </div>
            </div>
          ))}
          {interviews.length === 0 && <Empty icon="MessagesSquare" label="No interview packages yet" />}
        </CardContent>
      </Card>

      <Card className="gradient-brand text-white">
        <CardContent className="p-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Icon name="Gift" className="w-6 h-6" />
            <div>
              <div className="font-semibold">All downloads are free, forever.</div>
              <div className="text-xs text-white/80">No watermarks. No usage limits. No email required.</div>
            </div>
          </div>
          <Badge variant="gold">100% Free</Badge>
        </CardContent>
      </Card>
    </div>
  );
}

function Empty({ icon, label }: { icon: string; label: string }) {
  return (
    <div className="text-center py-8">
      <Icon name={icon} className="w-8 h-8 text-muted-foreground/40 mx-auto" />
      <p className="text-sm text-muted-foreground mt-2">{label}</p>
    </div>
  );
}
