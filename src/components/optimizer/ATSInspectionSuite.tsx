"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, Icon } from "@/components/shared";
import { toast } from "sonner";
import { callAI } from "@/lib/ai";
import type { ResumeData, JobDescription } from "@/lib/types";

// ============================================================================
// Props Definition
// ============================================================================
interface ATSInspectionSuiteProps {
  resume: ResumeData;
  optimized: ResumeData;
  jd: JobDescription;
  missingKeywords: string[];
  onUpdateResume: (updated: ResumeData) => void;
}

export function ATSInspectionSuite({
  resume,
  optimized,
  jd,
  missingKeywords = [],
  onUpdateResume,
}: ATSInspectionSuiteProps) {
  const [activeTab, setActiveTab] = useState<"parser-view" | "keyword-assist">("keyword-assist");
  const [analyzingKeyword, setAnalyzingKeyword] = useState<string | null>(null);
  const [suggestedRewrite, setSuggestedRewrite] = useState<{ targetId: string; targetBulletIndex: number; oldText: string; newText: string } | null>(null);
  const [applyingRewrite, setApplyingRewrite] = useState(false);

  // Generate plain text render of the resume (as parser sees it)
  const getPlainText = () => {
    let text = "";
    text += `${optimized.name.toUpperCase()}\n`;
    text += `Email: ${optimized.email} | Phone: ${optimized.phone} | Location: ${optimized.location}\n`;
    if (optimized.headline) text += `Headline: ${optimized.headline}\n`;
    text += `=========================================\n\n`;

    if (optimized.summary) {
      text += `PROFESSIONAL SUMMARY\n`;
      text += `-----------------------------------------\n`;
      text += `${optimized.summary}\n\n`;
    }

    if (optimized.experience && optimized.experience.length > 0) {
      text += `PROFESSIONAL EXPERIENCE\n`;
      text += `-----------------------------------------\n`;
      optimized.experience.forEach((exp) => {
        text += `${exp.title.toUpperCase()} | ${exp.company.toUpperCase()} (${exp.location || ""})\n`;
        text += `${exp.startDate} - ${exp.endDate}\n`;
        if (exp.bullets && exp.bullets.length > 0) {
          exp.bullets.forEach((bullet) => {
            text += `* ${bullet}\n`;
          });
        }
        text += `\n`;
      });
    }

    if (optimized.education && optimized.education.length > 0) {
      text += `EDUCATION\n`;
      text += `-----------------------------------------\n`;
      optimized.education.forEach((edu) => {
        text += `${edu.degree.toUpperCase()} - ${edu.institution.toUpperCase()}\n`;
        text += `${edu.startDate} - ${edu.endDate}\n`;
        if (edu.highlights && edu.highlights.length > 0) {
          edu.highlights.forEach((h) => {
            text += `  - ${h}\n`;
          });
        }
        text += `\n`;
      });
    }

    if (optimized.skills && optimized.skills.length > 0) {
      text += `CORE SKILLS\n`;
      text += `-----------------------------------------\n`;
      text += optimized.skills.map((s) => s.name).join(", ") + "\n\n";
    }

    return text;
  };

  // Analyze keyword placement using AI
  const analyzePlacement = async (keyword: string) => {
    setAnalyzingKeyword(keyword);
    setSuggestedRewrite(null);
    try {
      const result = await callAI({
        systemPrompt: `You are an Expert Resume Optimizer. Suggest exactly where and how to weave a missing keyword into the candidate's resume experience bullets. Identify one specific bullet point from the resume that matches best. Return ONLY JSON: {"experienceId": "...", "bulletIndex": 0, "oldBulletText": "...", "newBulletText": "..."}`,
        userPrompt: `MISSING KEYWORD: ${keyword}
RESUME EXPERIENCE ENTRIES:
${JSON.stringify(
  optimized.experience.map((e) => ({
    id: e.id,
    company: e.company,
    title: e.title,
    bullets: e.bullets,
  })),
  null,
  2
)}
Return only JSON. Ensure oldBulletText matches the original bullet in the experience ID exactly.`,
        temperature: 0.2
      });

      let data;
      try {
        data = JSON.parse(result.text);
      } catch {
        const clean = result.text.match(/\{[\s\S]*\}/)?.[0] || "{}";
        data = JSON.parse(clean);
      }

      if (data.experienceId && data.oldBulletText && data.newBulletText) {
        setSuggestedRewrite({
          targetId: data.experienceId,
          targetBulletIndex: data.bulletIndex ?? 0,
          oldText: data.oldBulletText,
          newText: data.newBulletText
        });
      } else {
        toast.error("Could not find a suitable bullet to weave this keyword.");
      }
    } catch (e) {
      toast.error("Analysis failed.");
    } finally {
      setAnalyzingKeyword(null);
    }
  };

  // Apply suggested rewrite to optimized resume
  const applyRewrite = () => {
    if (!suggestedRewrite) return;
    setApplyingRewrite(true);

    try {
      const updatedExperience = optimized.experience.map((exp) => {
        if (exp.id === suggestedRewrite.targetId) {
          const updatedBullets = [...exp.bullets];
          // We can match either by index or direct text match to be extra safe
          const idx = updatedBullets.indexOf(suggestedRewrite.oldText);
          if (idx !== -1) {
            updatedBullets[idx] = suggestedRewrite.newText;
          } else if (suggestedRewrite.targetBulletIndex < updatedBullets.length) {
            updatedBullets[suggestedRewrite.targetBulletIndex] = suggestedRewrite.newText;
          } else {
            updatedBullets.push(suggestedRewrite.newText);
          }
          return { ...exp, bullets: updatedBullets };
        }
        return exp;
      });

      onUpdateResume({
        ...optimized,
        experience: updatedExperience,
      });

      toast.success("Keyword successfully injected into your experience bullets!");
      setSuggestedRewrite(null);
    } catch (e) {
      toast.error("Failed to apply rewrite.");
    } finally {
      setApplyingRewrite(false);
    }
  };

  return (
    <Card className="border-border">
      <CardHeader className="pb-2 border-b border-border">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Icon name="SearchCode" className="w-5 h-5 text-brand" /> ATS Inspection Suite
            </CardTitle>
            <CardDescription className="text-xs">Inspect how the ATS parses your resume and get assist in weaving missing keywords.</CardDescription>
          </div>

          <div className="flex bg-secondary/60 rounded-lg p-0.5 border border-border text-xs">
            <button
              onClick={() => setActiveTab("keyword-assist")}
              className={`px-3 py-1.5 font-medium rounded-md transition-all ${
                activeTab === "keyword-assist"
                  ? "bg-background text-brand shadow-sm font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Keyword Assist
            </button>
            <button
              onClick={() => setActiveTab("parser-view")}
              className={`px-3 py-1.5 font-medium rounded-md transition-all ${
                activeTab === "parser-view"
                  ? "bg-background text-foreground shadow-sm font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              ATS Plain-Text
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4 sm:p-5">
        {activeTab === "parser-view" ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider">Simulated ATS Plain-Text Extraction</span>
              <Badge variant="outline" className="text-[10px]">Taleo/Workday Compatible</Badge>
            </div>
            <pre className="p-3 bg-neutral-950 text-emerald-400 font-mono text-[11px] leading-relaxed rounded-md h-72 overflow-y-auto border border-neutral-800 whitespace-pre-wrap select-all">
              {getPlainText()}
            </pre>
            <p className="text-[10px] text-muted-foreground italic flex items-center gap-1">
              <Icon name="Info" className="w-3.5 h-3.5 text-brand" /> Double-click the text above to select all, or copy it directly for plain-text testing.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1">
              <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider block">Target Job Description Keywords</span>
              <p className="text-xs text-muted-foreground">Select a missing keyword to analyze context-natural placement inside your experiences.</p>
            </div>

            {missingKeywords.length === 0 ? (
              <div className="py-4 text-center text-xs text-emerald-600 bg-emerald-50/50 dark:bg-emerald-950/10 rounded-lg border border-emerald-200">
                <Icon name="CheckCircle" className="w-5 h-5 mx-auto mb-1 text-emerald-600" />
                All target keywords are successfully matched in your optimized resume!
              </div>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {missingKeywords.map((k) => (
                  <button
                    key={k}
                    onClick={() => analyzePlacement(k)}
                    disabled={analyzingKeyword !== null}
                    className={`text-xs px-2.5 py-1 rounded-full border flex items-center gap-1 transition-all ${
                      analyzingKeyword === k
                        ? "bg-brand/20 border-brand text-brand font-semibold animate-pulse"
                        : "bg-background hover:bg-brand/5 border-border hover:border-brand/40"
                    }`}
                  >
                    <Icon name="Plus" className="w-3 h-3 text-brand" /> {k}
                  </button>
                ))}
              </div>
            )}

            {suggestedRewrite && (
              <div className="rounded-lg border border-amber-300 bg-amber-50/30 dark:bg-amber-950/10 p-3 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] uppercase font-bold text-amber-600">Suggested Keyword Placement</span>
                  <Badge variant="warning">Injection Ready</Badge>
                </div>
                <div className="text-xs space-y-2">
                  <div>
                    <span className="font-semibold text-muted-foreground text-[10px] uppercase block">Current Bullet</span>
                    <p className="bg-background border border-border p-2 rounded text-neutral-700">{suggestedRewrite.oldText}</p>
                  </div>
                  <div>
                    <span className="font-semibold text-brand text-[10px] uppercase block">Weaved Placement</span>
                    <p className="bg-brand/5 border border-brand/20 p-2 rounded text-foreground font-medium">{suggestedRewrite.newText}</p>
                  </div>
                </div>
                <div className="flex justify-end gap-2 text-xs">
                  <Button onClick={() => setSuggestedRewrite(null)} variant="outline" size="sm">Dismiss</Button>
                  <Button onClick={applyRewrite} disabled={applyingRewrite} size="sm" className="bg-brand hover:bg-brand-dark text-white gap-1">
                    {applyingRewrite ? <Icon name="Loader2" className="w-3.5 h-3.5 animate-spin" /> : <Icon name="Check" className="w-3.5 h-3.5" />}
                    Inject this version
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
