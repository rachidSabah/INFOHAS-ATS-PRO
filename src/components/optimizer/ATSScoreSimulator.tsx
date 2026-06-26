"use client";

import { useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge, Icon, ScoreRing } from "@/components/shared";
import type { ResumeData, JobDescription } from "@/lib/types";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface KeywordDensityItem {
  keyword: string;
  count: number;
  density: number; // 0-1
}

export interface ATSReadinessResult {
  readinessScore: number;
  keywordDensityScore: number;
  sectionCompletenessScore: number;
  keywordDensity: KeywordDensityItem[];
  matchedKeywords: string[];
  missingKeywords: string[];
  sectionBreakdown: Record<
    string,
    { score: number; status: "complete" | "partial" | "missing"; suggestion: string }
  >;
}

// ─── Pure computation function (no React hooks) ─────────────────────────────

export function computeATSReadiness(
  resume: ResumeData,
  jd?: JobDescription | null,
): ATSReadinessResult {
  const resumeText = extractResumeText(resume).toLowerCase();

  // --- Keyword density ---
  let keywordDensity: KeywordDensityItem[] = [];
  let matchedKeywords: string[] = [];
  let missingKeywords: string[] = [];
  let keywordDensityScore = 0;

  if (jd && jd.keywords && jd.keywords.length > 0) {
    const jdKeywords = [...new Set(jd.keywords.map((k) => k.toLowerCase().trim()).filter(Boolean))];
    const totalJdKeywords = jdKeywords.length;

    for (const kw of jdKeywords) {
      // Count occurrences in the resume text (case-insensitive word-boundary match)
      const regex = new RegExp(`\\b${escapeRegex(kw)}\\b`, "gi");
      const matches = resumeText.match(regex);
      const count = matches ? matches.length : 0;
      const density = totalJdKeywords > 0 ? count / Math.max(count, 1) : 0;

      keywordDensity.push({ keyword: kw, count, density });
      if (count > 0) {
        matchedKeywords.push(kw);
      } else {
        missingKeywords.push(kw);
      }
    }

    // Weighted density score: (matched / total) * 50 + (average frequency capped) * 50
    const matchRatio = totalJdKeywords > 0 ? matchedKeywords.length / totalJdKeywords : 0;
    const totalMatches = keywordDensity.reduce((sum, kd) => sum + kd.count, 0);
    const avgFrequency = totalJdKeywords > 0 ? totalMatches / totalJdKeywords : 0;
    const cappedAvgFreq = Math.min(avgFrequency, 1);

    const rawScore = matchRatio * 50 + cappedAvgFreq * 50;
    keywordDensityScore = Math.min(Math.round(rawScore), 100);

    // Sort keyword density by count descending
    keywordDensity.sort((a, b) => b.count - a.count);
  } else {
    // No JD provided — keyword score is 0 but we treat readiness differently
    keywordDensityScore = 0;
  }

  // --- Section completeness ---
  const sectionBreakdown: Record<
    string,
    { score: number; status: "complete" | "partial" | "missing"; suggestion: string }
  > = {};

  // Experience
  const expCount = resume.experience.length;
  const totalBullets = resume.experience.reduce((sum, e) => sum + e.bullets.length, 0);
  let expScore = 0;
  if (expCount === 0) {
    expScore = 0;
    sectionBreakdown["experience"] = {
      score: 0,
      status: "missing",
      suggestion: "Add work experience entries — ATS systems heavily weight this section.",
    };
  } else {
    const bulletScore = Math.min(totalBullets / (expCount * 2), 1) * 50;
    const entryScore = Math.min(expCount / 2, 1) * 50;
    expScore = Math.round(bulletScore + entryScore);
    sectionBreakdown["experience"] = {
      score: expScore,
      status: expScore >= 80 ? "complete" : expScore >= 40 ? "partial" : "missing",
      suggestion:
        totalBullets < expCount * 2
          ? "Aim for at least 2 bullet points per experience entry."
          : "Experience section looks solid.",
    };
  }

  // Education
  const eduCount = resume.education.length;
  const eduHasDetails = resume.education.some((e) => e.degree && e.institution);
  let eduScore = 0;
  if (eduCount === 0) {
    eduScore = 0;
    sectionBreakdown["education"] = {
      score: 0,
      status: "missing",
      suggestion: "Add education entries including degree and institution.",
    };
  } else {
    const presentScore = Math.min(eduCount / 2, 1) * 50;
    const detailScore = eduHasDetails ? 50 : 0;
    eduScore = Math.round(presentScore + detailScore);
    sectionBreakdown["education"] = {
      score: eduScore,
      status: eduScore >= 80 ? "complete" : eduScore >= 40 ? "partial" : "missing",
      suggestion: eduHasDetails
        ? "Education section is complete."
        : "Include degree name and institution for each education entry.",
    };
  }

  // Skills
  const skillCount = resume.skills.length;
  let skillScore = 0;
  if (skillCount === 0) {
    skillScore = 0;
    sectionBreakdown["skills"] = {
      score: 0,
      status: "missing",
      suggestion: "Add at least 6-8 relevant skills to pass keyword screening.",
    };
  } else {
    skillScore = Math.min(Math.round((skillCount / 8) * 100), 100);
    sectionBreakdown["skills"] = {
      score: skillScore,
      status: skillScore >= 80 ? "complete" : skillScore >= 40 ? "partial" : "missing",
      suggestion:
        skillCount < 6
          ? "Add more skills — aim for at least 6-8 relevant to the target role."
          : "Skills section is well populated.",
    };
  }

  // Summary
  const summaryLen = resume.summary ? resume.summary.trim().length : 0;
  let summaryScore = 0;
  if (!resume.summary || summaryLen === 0) {
    summaryScore = 0;
    sectionBreakdown["summary"] = {
      score: 0,
      status: "missing",
      suggestion: "A professional summary helps ATS and recruiters grasp your profile quickly.",
    };
  } else {
    summaryScore = Math.min(Math.round((summaryLen / 150) * 100), 100);
    sectionBreakdown["summary"] = {
      score: summaryScore,
      status: summaryScore >= 80 ? "complete" : summaryScore >= 40 ? "partial" : "missing",
      suggestion:
        summaryLen < 50
          ? "Your summary is too short — aim for 100-200 characters."
          : summaryLen < 100
            ? "Consider expanding your summary for better impact."
            : "Summary section looks good.",
    };
  }

  // Languages (bonus section)
  const langCount = resume.languages.length;
  let langScore = 0;
  if (langCount === 0) {
    langScore = 0;
    sectionBreakdown["languages"] = {
      score: 0,
      status: "missing",
      suggestion: "Languages are optional but add completeness for multilingual roles.",
    };
  } else {
    langScore = Math.min(Math.round((langCount / 2) * 100), 100);
    sectionBreakdown["languages"] = {
      score: langScore,
      status: langScore >= 80 ? "complete" : "partial",
      suggestion: "Languages section adds a nice touch.",
    };
  }

  // Average section completeness score
  const sectionScores = Object.values(sectionBreakdown).map((s) => s.score);
  const sectionCompletenessScore =
    sectionScores.length > 0
      ? Math.round(sectionScores.reduce((a, b) => a + b, 0) / sectionScores.length)
      : 0;

  // --- Readiness score ---
  // If JD is provided: 50% keyword density + 50% section completeness
  // If no JD: purely section completeness
  const readinessScore =
    jd && jd.keywords && jd.keywords.length > 0
      ? Math.round(keywordDensityScore * 0.5 + sectionCompletenessScore * 0.5)
      : sectionCompletenessScore;

  return {
    readinessScore,
    keywordDensityScore,
    sectionCompletenessScore,
    keywordDensity,
    matchedKeywords,
    missingKeywords,
    sectionBreakdown,
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractResumeText(resume: ResumeData): string {
  const parts: string[] = [];

  if (resume.summary) parts.push(resume.summary);

  for (const exp of resume.experience) {
    parts.push(exp.title, exp.company);
    parts.push(...exp.bullets);
  }

  for (const edu of resume.education) {
    parts.push(edu.degree, edu.institution, edu.field ?? "");
    if (edu.highlights) parts.push(...edu.highlights);
  }

  for (const sk of resume.skills) {
    parts.push(sk.name);
  }

  for (const proj of resume.projects) {
    parts.push(proj.name, proj.description ?? "");
    if (proj.bullets) parts.push(...proj.bullets);
  }

  for (const cert of resume.certifications) {
    parts.push(cert.name);
  }

  for (const lang of resume.languages) {
    parts.push(lang.name);
  }

  return parts.join(" ");
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── Component ───────────────────────────────────────────────────────────────

interface ATSScoreSimulatorProps {
  resume: ResumeData;
  jd?: JobDescription | null;
  compact?: boolean;
}

export function ATSScoreSimulator({ resume, jd, compact = false }: ATSScoreSimulatorProps) {
  const result = useMemo(() => computeATSReadiness(resume, jd ?? null), [resume, jd]);

  const {
    readinessScore,
    keywordDensityScore,
    sectionCompletenessScore,
    keywordDensity,
    matchedKeywords,
    missingKeywords,
    sectionBreakdown,
  } = result;

  // ─── Compact view ──────────────────────────────────────────────────────

  if (compact) {
    return (
      <AnimatePresence mode="wait">
        <motion.div
          key={readinessScore}
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
          className="flex items-center gap-4"
        >
          <ScoreRing value={readinessScore} size={64} stroke={6} label="Readiness" />
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-foreground">ATS Readiness</span>
              <Badge
                variant={
                  readinessScore >= 75 ? "success" : readinessScore >= 50 ? "warning" : "danger"
                }
              >
                {readinessScore >= 75
                  ? "Good"
                  : readinessScore >= 50
                    ? "Needs Work"
                    : "Poor"}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {missingKeywords.length > 0
                ? `${missingKeywords.length} missing keyword${missingKeywords.length > 1 ? "s" : ""}`
                : jd
                  ? "All keywords matched"
                  : "Add a JD for keyword analysis"}
            </p>
            {missingKeywords.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {missingKeywords.slice(0, 3).map((kw) => (
                  <Badge key={kw} variant="danger" className="text-[10px]">
                    {kw}
                  </Badge>
                ))}
                {missingKeywords.length > 3 && (
                  <span className="text-[10px] text-muted-foreground">
                    +{missingKeywords.length - 3} more
                  </span>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </AnimatePresence>
    );
  }

  // ─── Full view ─────────────────────────────────────────────────────────

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={readinessScore}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="space-y-4"
      >
        {/* === Hero: Score Ring + Summary === */}
        <Card className="overflow-hidden">
          <CardContent className="p-5 sm:p-6">
            <div className="flex items-start gap-5 flex-wrap">
              <motion.div
                key={readinessScore}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 200, damping: 15 }}
              >
                <ScoreRing value={readinessScore} size={100} stroke={8} label="Readiness" />
              </motion.div>
              <div className="flex-1 min-w-0 space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-display text-lg font-bold">ATS Readiness Score</h3>
                  <Badge
                    variant={
                      readinessScore >= 75 ? "success" : readinessScore >= 50 ? "warning" : "danger"
                    }
                  >
                    {readinessScore >= 75
                      ? "Ready"
                      : readinessScore >= 50
                        ? "Needs Improvement"
                        : "Critical"}
                  </Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  {jd && jd.keywords?.length
                    ? "Score based on keyword density (50%) and section completeness (50%)."
                    : "Score based on section completeness only — add a job description for keyword analysis."}
                </p>
                <div className="flex flex-wrap gap-3 text-sm">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: "#1154A3" }}
                    />
                    <span className="text-muted-foreground">Keywords:</span>
                    <span className="font-semibold">{keywordDensityScore}%</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: "#10B981" }}
                    />
                    <span className="text-muted-foreground">Completeness:</span>
                    <span className="font-semibold">{sectionCompletenessScore}%</span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* === Key Metrics: Matched / Missing keywords === */}
        {jd && jd.keywords?.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Icon name="Tags" className="w-4 h-4 text-brand" />
                Keyword Match
                <span className="text-xs font-normal text-muted-foreground ml-auto">
                  {matchedKeywords.length} / {jd.keywords.length} matched
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-3">
              {/* Keyword density bar chart */}
              {keywordDensity.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Keyword density</p>
                  <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                    {keywordDensity.map((kd) => (
                      <motion.div
                        key={kd.keyword}
                        initial={{ width: 0, opacity: 0 }}
                        animate={{ width: "100%", opacity: 1 }}
                        transition={{ duration: 0.4, delay: 0.05 }}
                        className="flex items-center gap-2"
                      >
                        <span className="text-xs w-24 truncate shrink-0 text-foreground" title={kd.keyword}>
                          {kd.keyword}
                        </span>
                        <div className="flex-1 h-4 bg-muted rounded-full overflow-hidden">
                          <motion.div
                            initial={{ width: 0 }}
                            animate={{
                              width: `${Math.min((kd.count / 3) * 100, 100)}%`,
                            }}
                            transition={{ duration: 0.5, ease: "easeOut" }}
                            className={`h-full rounded-full ${kd.count > 0 ? "bg-brand" : "bg-muted-foreground/20"}`}
                          />
                        </div>
                        <span className="text-xs tabular-nums w-6 text-right text-muted-foreground">
                          {kd.count}
                        </span>
                      </motion.div>
                    ))}
                  </div>
                </div>
              )}

              {/* Missing keywords pills */}
              {missingKeywords.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-1.5">
                    Missing keywords
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {missingKeywords.map((kw) => (
                      <Badge key={kw} variant="danger" className="text-[11px]">
                        <Icon name="X" className="w-2.5 h-2.5 mr-0.5" />
                        {kw}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* === Section Completeness === */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Icon name="LayoutDashboard" className="w-4 h-4 text-brand" />
              Section Completeness
            </CardTitle>
            <CardDescription className="text-xs">
              How well each resume section is populated
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            {Object.entries(sectionBreakdown).map(([section, data]) => (
              <motion.div
                key={section}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.25 }}
                className="space-y-1"
              >
                <div className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-medium capitalize">{section}</span>
                    <span
                      className={`inline-flex items-center gap-0.5 text-xs font-medium ${
                        data.status === "complete"
                          ? "text-emerald-600"
                          : data.status === "partial"
                            ? "text-amber-600"
                            : "text-red-600"
                      }`}
                    >
                      <Icon
                        name={
                          data.status === "complete"
                            ? "CheckCircle"
                            : data.status === "partial"
                              ? "AlertCircle"
                              : "XCircle"
                        }
                        className="w-3 h-3"
                      />
                      {data.status}
                    </span>
                  </div>
                  <span className="text-xs tabular-nums text-muted-foreground">{data.score}%</span>
                </div>
                <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${data.score}%` }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                    className={`h-full rounded-full ${
                      data.score >= 80
                        ? "bg-emerald-500"
                        : data.score >= 40
                          ? "bg-amber-500"
                          : "bg-red-500"
                    }`}
                  />
                </div>
                <p className="text-[11px] text-muted-foreground pl-0.5">{data.suggestion}</p>
              </motion.div>
            ))}
          </CardContent>
        </Card>

        {/* === What to Improve === */}
        {(missingKeywords.length > 0 ||
          Object.values(sectionBreakdown).some((s) => s.status !== "complete")) && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Icon name="Lightbulb" className="w-4 h-4 text-amber-500" />
                What to Improve
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0 space-y-2">
              {/* Missing keywords */}
              {missingKeywords.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-start gap-2"
                >
                  <Icon name="Key" className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
                  <div className="text-sm">
                    <span className="font-medium">Missing keywords: </span>
                    <span className="text-muted-foreground">
                      Add <strong>{missingKeywords.slice(0, 5).join(", ")}</strong>
                      {missingKeywords.length > 5 && ` and ${missingKeywords.length - 5} more`} to
                      your resume bullets and skills.
                    </span>
                  </div>
                </motion.div>
              )}

              {/* Weak sections */}
              {Object.entries(sectionBreakdown)
                .filter(([, s]) => s.status !== "complete")
                .map(([section, data]) => (
                  <motion.div
                    key={section}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-start gap-2"
                  >
                    <Icon name="FileText" className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                    <div className="text-sm">
                      <span className="font-medium capitalize">{section}: </span>
                      <span className="text-muted-foreground">{data.suggestion}</span>
                    </div>
                  </motion.div>
                ))}
            </CardContent>
          </Card>
        )}

        {/* === No JD notice === */}
        {(!jd || !jd.keywords || jd.keywords.length === 0) && (
          <Card className="border-dashed border-muted-foreground/30">
            <CardContent className="p-4 flex items-center gap-3 text-sm text-muted-foreground">
              <Icon name="Info" className="w-5 h-5 shrink-0 text-brand" />
              <span>
                For a full readiness analysis including keyword density, provide a job description
                with keywords.
              </span>
            </CardContent>
          </Card>
        )}
      </motion.div>
    </AnimatePresence>
  );
}
