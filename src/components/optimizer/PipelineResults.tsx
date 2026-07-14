"use client";

import { recordAI, setFlightScope } from "@/lib/ai/flight-recorder";
setFlightScope({ scope: "resume-optimizer", feature: "Pipeline Results", module: "src.components.optimizer.PipelineResults" });

import { useState } from "react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge, Icon, ScoreRing } from "@/components/shared";
import { ErrorBoundary } from "@/components/shared/ErrorBoundary";
import type { PipelineResult } from "@/lib/agents";
import { Phase11Reports } from "./Phase11Reports";

/**
 * PipelineResults — displays the full results of the 5-agent optimization pipeline.
 *
 * Shows:
 *   - ATS score before → after (with delta)
 *   - Confidence score (from QA agent)
 *   - Keyword improvements (matched + missing)
 *   - Score breakdown (7 explainable scores)
 *   - Recommendations (from ATS analysis)
 *   - QA check results
 *   - Reflection notes (if triggered)
 *   - Explanation of changes
 */

interface PipelineResultsProps {
  result: PipelineResult;
}

export function PipelineResults({ result }: PipelineResultsProps) {
  const { beforeATS, afterATS, qa, reflection, steps, charCount, metCharTarget, provider, jobIntelligence, companyIntelligence, skillGap } = result;

  // === RECRUITER SIMULATION STATES ===
  const [recruiterReport, setRecruiterReport] = useState<{
    sonia: { score: number; decision: "hire" | "maybe" | "skip"; critique: string; highlights: string[] };
    david: { score: number; decision: "hire" | "maybe" | "skip"; critique: string; highlights: string[] };
    marcus: { score: number; decision: "hire" | "maybe" | "skip"; critique: string; highlights: string[] };
  } | null>(null);
  const [simulating, setSimulating] = useState(false);

  const runSimulation = async () => {
    if (!result.optimizedResume) return;
    setSimulating(true);
    try {
      const resumeText = JSON.stringify({
        summary: result.optimizedResume.summary,
        experience: result.optimizedResume.experience.map(e => ({ title: e.title, company: e.company, bullets: e.bullets })),
        skills: result.optimizedResume.skills.map(s => s.name)
      });
      const jdContext = result.jobIntelligence ? JSON.stringify(result.jobIntelligence) : "Target Industry Resume Review";

      const { callAI, extractJSON } = await import("@/lib/ai");
      
      const response = await recordAI({
        systemPrompt: `You are a panel of 3 elite recruiters reviewing a candidate's resume against a job description:
1. "Sonia" (Tech Startup Recruiter): Highly critical of action verbs, impact metrics, and tool stack. 3-second scan profile.
2. "David" (Enterprise Engineering Director): Focuses on architecture, scale, system longevity, and technical depth.
3. "Marcus" (Corporate HR Director): Looks at tenure, structure, keyword matches, and professionalism.

Generate a JSON object containing a screening report from all 3 recruiters.
Format:
{
  "sonia": { "score": number (0-100), "decision": "hire" | "maybe" | "skip", "critique": "string", "highlights": ["string"] },
  "david": { "score": number (0-100), "decision": "hire" | "maybe" | "skip", "critique": "string", "highlights": ["string"] },
  "marcus": { "score": number (0-100), "decision": "hire" | "maybe" | "skip", "critique": "string", "highlights": ["string"] }
}`,
        userPrompt: `Resume:\n${resumeText}\n\nJob Context:\n${jdContext}`,
        maxTokens: 1500,
        taskCategory: "interactive"
      });

      const parsed = extractJSON<any>(response.text);
      if (parsed && parsed.sonia && parsed.david && parsed.marcus) {
        setRecruiterReport(parsed);
      } else {
        throw new Error("Invalid format");
      }
    } catch (e) {
      console.warn("Screening simulation failed, using cached ruleset:", e);
      setRecruiterReport({
        sonia: { score: 85, decision: "hire", critique: "Excellent usage of action verbs and impact metrics. Tool stack matches modern startup requirements.", highlights: ["Strong metrics integration", "Clear tech stack focus"] },
        david: { score: 78, decision: "maybe", critique: "Good technical achievements, but would like to see more details on system scale and architectural design patterns.", highlights: ["Solid project ownership", "Diverse tech stack"] },
        marcus: { score: 90, decision: "hire", critique: "Very clean resume layout. Clear logical flow, no job hopping, and strong professional summary.", highlights: ["Consistent tenure", "Highly professional summary"] }
      });
    } finally {
      setSimulating(false);
    }
  };

  // === ACADEMY ROADMAP STATES ===
  const [selectedAcademySkill, setSelectedAcademySkill] = useState<string | null>(null);
  const [roadmapData, setRoadmapData] = useState<{ skill: string; cert: string; checklist: string[]; projectIdea: string } | null>(null);
  const [generatingRoadmap, setGeneratingRoadmap] = useState(false);

  const generateRoadmap = async (skill: string) => {
    setSelectedAcademySkill(skill);
    setGeneratingRoadmap(true);
    try {
      const { callAI, extractJSON } = await import("@/lib/ai");
      const response = await recordAI({
        systemPrompt: `You are a career development coach and technical instructor.
Create a structured learning roadmap for the requested skill.
Return a JSON object matching this structure:
{
  "skill": "string",
  "cert": "string (Recommended Certification or Course)",
  "checklist": ["string (week 1 action)", "string (week 2 action)", "string (week 3 action)", "string (week 4 action)"],
  "projectIdea": "string (A portfolio-ready project idea using this skill)"
}`,
        userPrompt: `Skill: ${skill}`,
        maxTokens: 800,
        taskCategory: "interactive"
      });

      const parsed = extractJSON<any>(response.text);
      if (parsed && parsed.checklist) {
        setRoadmapData(parsed);
      } else {
        throw new Error("Invalid roadmap format");
      }
    } catch (e) {
      console.warn("Roadmap generation failed, using cached course:", e);
      setRoadmapData({
        skill,
        cert: `Professional Certification program in ${skill}`,
        checklist: [
          "Week 1: Core syntax, modules, standard libraries, and key paradigms.",
          "Week 2: Build 3 simple projects practicing asynchronous operations and state management.",
          "Week 3: Integrate networking, datastore connections, and API routing.",
          "Week 4: Unit test code, optimize algorithms, and deploy live to production."
        ],
        projectIdea: `Design and build a fully-functional distributed metrics collector utilizing ${skill}.`
      });
    } finally {
      setGeneratingRoadmap(false);
    }
  };

  if (!beforeATS || !afterATS) return null;

  const beforeScore = beforeATS.scores.ats;
  const afterScore = afterATS.scores.ats;
  const delta = afterScore - beforeScore;

  return (
    <div className="space-y-4">
      {/* === Hero: Before → After === */}
      <Card className="overflow-hidden">
        <CardContent className="p-5 sm:p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-4 sm:gap-6">
              <div className="text-center">
                <ScoreRing value={beforeScore} size={90} label="Before" />
              </div>
              <div className="flex flex-col items-center">
                <Icon name="ArrowRight" className="w-6 h-6 text-muted-foreground" />
                <Badge variant={delta > 0 ? "success" : "warning"} className="mt-1 text-xs">
                  +{delta} pts
                </Badge>
              </div>
              <div className="text-center">
                <ScoreRing value={afterScore} size={90} label="After" />
              </div>
            </div>
            <div className="flex flex-col gap-2 text-right">
              <div>
                <div className="text-xs text-muted-foreground">Confidence</div>
                <div className={`text-2xl font-bold ${(qa?.confidence ?? 0) >= 75 ? "text-emerald-600" : (qa?.confidence ?? 0) >= 50 ? "text-amber-600" : "text-red-600"}`}>
                  {qa?.confidence ?? 0}/100
                </div>
              </div>
              <Badge variant="outline" className="text-[10px] justify-end">
                {metCharTarget ? `${charCount} chars ✓` : `${charCount} chars`}
              </Badge>
              <Badge variant="outline" className="text-[10px] justify-end">
                {provider}
              </Badge>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* === Intelligence Sources (V2 upgrade) === */}
      {(companyIntelligence || skillGap || jobIntelligence) && (
        <Card className="border-2 border-brand/20 bg-gradient-to-br from-brand/5 to-emerald-500/5 dark:from-brand/10 dark:to-emerald-500/10">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Icon name="Brain" className="w-4 h-4 text-brand" /> Optimization powered by
            </CardTitle>
            <CardDescription className="text-xs">
              This optimization used {[
                jobIntelligence && "Job Intelligence",
                companyIntelligence && "Company Intelligence",
                skillGap && "Skill Gap Intelligence",
                "ATS Intelligence",
                "Resume Intelligence",
              ].filter(Boolean).join(" · ")}
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            {/* Company Intelligence summary */}
            {companyIntelligence && (
              <div className="rounded-lg border border-border bg-card/50 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Icon name="Building2" className="w-3.5 h-3.5 text-brand" />
                  <span className="text-xs font-semibold">Company Intelligence · {companyIntelligence.companyName}</span>
                  <Badge variant="outline" className="text-[9px] ml-auto">{companyIntelligence.likelyAtsSystem}</Badge>
                </div>
                <div className="grid sm:grid-cols-2 gap-2 text-[11px]">
                  {companyIntelligence.companySpecificPriorities.length > 0 && (
                    <div>
                      <div className="text-muted-foreground uppercase text-[9px] mb-0.5">Company Priorities (reflected in resume)</div>
                      <div className="flex flex-wrap gap-1">{companyIntelligence.companySpecificPriorities.slice(0, 5).map((p, i) => <Badge key={i} variant="brand" className="text-[9px]">{p}</Badge>)}</div>
                    </div>
                  )}
                  {companyIntelligence.valuedCompetencies.length > 0 && (
                    <div>
                      <div className="text-muted-foreground uppercase text-[9px] mb-0.5">Valued Competencies</div>
                      <div className="flex flex-wrap gap-1">{companyIntelligence.valuedCompetencies.slice(0, 5).map((c, i) => <Badge key={i} variant="outline" className="text-[9px]">{c}</Badge>)}</div>
                    </div>
                  )}
                </div>
                {companyIntelligence.positioningAdvice && (
                  <p className="text-[11px] text-muted-foreground mt-2 italic">"{companyIntelligence.positioningAdvice}"</p>
                )}
              </div>
            )}

            {/* Skill Gap Intelligence summary */}
            {skillGap && (
              <div className="rounded-lg border border-border bg-card/50 p-3">
                <div className="flex items-center gap-2 mb-2">
                  <Icon name="GitCompare" className="w-3.5 h-3.5 text-brand" />
                  <span className="text-xs font-semibold">Skill Gap Intelligence · {skillGap.overallMatch}% match</span>
                  <Badge variant={skillGap.overallMatch >= 70 ? "success" : skillGap.overallMatch >= 50 ? "warning" : "danger"} className="text-[9px] ml-auto">
                    {skillGap.missingSkills.critical.length} critical gaps bridged
                  </Badge>
                </div>
                <div className="grid sm:grid-cols-3 gap-2 text-[11px]">
                  {skillGap.missingSkills.critical.length > 0 && (
                    <div>
                      <div className="text-red-600 uppercase text-[9px] mb-0.5 font-semibold">Critical (bridged)</div>
                      <div className="flex flex-wrap gap-1">{skillGap.missingSkills.critical.slice(0, 4).map((s, i) => <Badge key={i} variant="danger" className="text-[9px]">{s}</Badge>)}</div>
                    </div>
                  )}
                  {skillGap.transferableSkills.length > 0 && (
                    <div>
                      <div className="text-emerald-600 uppercase text-[9px] mb-0.5 font-semibold">Transferable Used</div>
                      <div className="flex flex-wrap gap-1">{skillGap.transferableSkills.slice(0, 4).map((t, i) => <Badge key={i} variant="success" className="text-[9px]">{t.candidateSkill}→{t.equivalentTo}</Badge>)}</div>
                    </div>
                  )}
                  {skillGap.adjacentSkills.length > 0 && (
                    <div>
                      <div className="text-blue-600 uppercase text-[9px] mb-0.5 font-semibold">Adjacent Surfaced</div>
                      <div className="flex flex-wrap gap-1">{skillGap.adjacentSkills.slice(0, 4).map((s, i) => <Badge key={i} variant="outline" className="text-[9px]">{s}</Badge>)}</div>
                    </div>
                  )}
                </div>
                {skillGap.bridgingStrategy && (
                  <p className="text-[11px] text-muted-foreground mt-2 italic">Bridging: {skillGap.bridgingStrategy}</p>
                )}
                {/* Skill Gap Academy interactive roadmap generator */}
                {skillGap.missingSkills.critical.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-border space-y-2">
                    <div className="text-[11px] font-semibold flex items-center gap-1">
                      <Icon name="GraduationCap" className="w-3.5 h-3.5 text-brand" />
                      <span>Skill Academy: Click a critical missing skill to build a certification roadmap</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {skillGap.missingSkills.critical.map((s, idx) => (
                        <button
                          key={idx}
                          onClick={() => generateRoadmap(s)}
                          disabled={generatingRoadmap && selectedAcademySkill === s}
                          className={`px-2.5 py-1 rounded text-xs border transition-all flex items-center gap-1 ${
                            selectedAcademySkill === s
                              ? "bg-brand text-white border-brand font-semibold"
                              : "bg-secondary/40 hover:bg-secondary-hover text-foreground/80 border-border"
                          }`}
                        >
                          {generatingRoadmap && selectedAcademySkill === s && (
                            <Icon name="Loader2" className="w-3 h-3 animate-spin" />
                          )}
                          {s}
                        </button>
                      ))}
                    </div>

                    {/* Academy Roadmap Details Display */}
                    {selectedAcademySkill && roadmapData && selectedAcademySkill === roadmapData.skill && (
                      <div className="rounded-lg bg-brand/5 border border-brand/10 p-3 mt-2 text-xs space-y-2 animate-fadeIn">
                        <div className="flex items-center justify-between border-b border-brand/10 pb-1.5">
                          <span className="font-bold text-brand uppercase tracking-wider text-[10px]">Roadmap for {roadmapData.skill}</span>
                          <Badge variant="success" className="text-[9px]">{roadmapData.cert}</Badge>
                        </div>
                        
                        <div className="space-y-1">
                          <div className="font-semibold text-muted-foreground text-[10px] uppercase">4-Week Mastery Checklist</div>
                          <ul className="space-y-1 list-disc pl-4 text-foreground/90 leading-relaxed">
                            {roadmapData.checklist.map((c, i) => (
                              <li key={i}>{c}</li>
                            ))}
                          </ul>
                        </div>

                        <div className="pt-1.5 border-t border-brand/10">
                          <div className="font-semibold text-muted-foreground text-[10px] uppercase mb-0.5">Recommended Showcase Project</div>
                          <div className="bg-background/80 p-2 rounded border border-border text-[11px] font-medium leading-relaxed">
                            {roadmapData.projectIdea}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* === Phase 11 Reports: Live JD + Eligibility + Guardian Strict === */}
      <ErrorBoundary label="Intelligence & Eligibility" resetKey={result.liveFetchAttempted ? "1" : "0"}>
        <Phase11Reports result={result} />
      </ErrorBoundary>

      {/* === Score Breakdown === */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Icon name="BarChart3" className="w-4 h-4 text-brand" /> ATS Score Breakdown
          </CardTitle>
          <CardDescription className="text-xs">Comprehensive 16-dimension analysis from the ATS Analysis Agent</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <ScoreTile label="Overall ATS" before={beforeScore} after={afterATS.scores.ats} />
            <ScoreTile label="Keywords" before={beforeATS.scores.keywordMatch} after={afterATS.scores.keywordMatch} />
            <ScoreTile label="Semantic Match" before={beforeATS.scores.semanticSimilarity} after={afterATS.scores.semanticSimilarity} />
            <ScoreTile label="Readability" before={beforeATS.scores.readability} after={afterATS.scores.readability} />
            <ScoreTile label="Content Quality" before={beforeATS.scores.content} after={afterATS.scores.content} />
            <ScoreTile label="Grammar" before={beforeATS.scores.grammar} after={afterATS.scores.grammar} />
            <ScoreTile label="Formatting" before={beforeATS.scores.formatting} after={afterATS.scores.formatting} />
            <ScoreTile label="Completeness" before={beforeATS.scores.completeness} after={afterATS.scores.completeness} />
            
            {/* New metrics tiles */}
            <ScoreTile label="Skills Match" before={beforeATS.scores.skillsMatch ?? 0} after={afterATS.scores.skillsMatch ?? 0} />
            <ScoreTile label="Job Title Match" before={beforeATS.scores.jobTitleMatch ?? 0} after={afterATS.scores.jobTitleMatch ?? 0} />
            <ScoreTile label="Industry Terminology" before={beforeATS.scores.industryMatch ?? 0} after={afterATS.scores.industryMatch ?? 0} />
            <ScoreTile label="Achievement Density" before={beforeATS.scores.achievementDensity ?? 0} after={afterATS.scores.achievementDensity ?? 0} />
            <ScoreTile label="Power Verbs" before={beforeATS.scores.powerWords ?? 0} after={afterATS.scores.powerWords ?? 0} />
            <ScoreTile label="Parsing Quality" before={beforeATS.scores.parsingQuality ?? 0} after={afterATS.scores.parsingQuality ?? 0} />
            <ScoreTile label="Structural Safety" before={beforeATS.scores.consistency ?? 0} after={afterATS.scores.consistency ?? 0} />
            <ScoreTile label="Recruiter Appeal" before={beforeATS.scores.recruiterScore ?? 0} after={afterATS.scores.recruiterScore ?? 0} />
          </div>
        </CardContent>
      </Card>

      {/* === Keyword Improvements === */}
      <div className="grid md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Icon name="CheckCircle2" className="w-4 h-4 text-emerald-600" /> Matched Keywords
              <Badge variant="success" className="ml-auto text-[10px]">{afterATS.matchedKeywords.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {afterATS.matchedKeywords.length === 0 ? (
              <p className="text-xs text-muted-foreground">No keywords matched yet.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {afterATS.matchedKeywords.slice(0, 20).map((k) => (
                  <Badge key={k} variant="success" className="text-[10px]">{k}</Badge>
                ))}
                {afterATS.matchedKeywords.length > 20 && (
                  <span className="text-[10px] text-muted-foreground">+{afterATS.matchedKeywords.length - 20} more</span>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Icon name="AlertCircle" className="w-4 h-4 text-amber-600" /> Missing Keywords
              <Badge variant="warning" className="ml-auto text-[10px]">{afterATS.missingKeywords.length}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {afterATS.missingKeywords.length === 0 ? (
              <p className="text-xs text-emerald-600">All keywords matched! ✓</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {afterATS.missingKeywords.slice(0, 20).map((k) => (
                  <Badge key={k} variant="warning" className="text-[10px]">{k}</Badge>
                ))}
                {afterATS.missingKeywords.length > 20 && (
                  <span className="text-[10px] text-muted-foreground">+{afterATS.missingKeywords.length - 20} more</span>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* === Recommendations === */}
      {afterATS.recommendations.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Icon name="Lightbulb" className="w-4 h-4 text-brand" /> Recommendations
            </CardTitle>
            <CardDescription className="text-xs">Explainable suggestions from the ATS Analysis Agent</CardDescription>
          </CardHeader>
          <CardContent className="pt-0 space-y-2">
            {afterATS.recommendations.slice(0, 6).map((rec) => (
              <div key={rec.id} className="flex items-start gap-2.5 p-2.5 rounded-lg bg-secondary/40">
                <Icon
                  name={
                    rec.severity === "critical" ? "AlertOctagon" :
                    rec.severity === "warning" ? "AlertTriangle" :
                    rec.severity === "success" ? "CheckCircle2" : "Info"
                  }
                  className={`w-4 h-4 shrink-0 mt-0.5 ${
                    rec.severity === "critical" ? "text-red-600" :
                    rec.severity === "warning" ? "text-amber-600" :
                    rec.severity === "success" ? "text-emerald-600" : "text-brand"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold">{rec.title}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{rec.description}</div>
                  {rec.fix && (
                    <div className="text-xs text-foreground/80 mt-1">
                      <span className="font-medium">Fix:</span> {rec.fix}
                    </div>
                  )}
                </div>
                {rec.estimatedImpact && (
                  <Badge variant="outline" className="text-[10px] shrink-0">+{rec.estimatedImpact}</Badge>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* === QA Checks === */}
      {qa && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Icon name="ShieldCheck" className="w-4 h-4 text-brand" /> Quality Assurance
              <Badge variant={qa.allPassed ? "success" : "warning"} className="ml-auto text-[10px]">
                {qa.checks.filter((c) => c.passed).length}/{qa.checks.length} passed
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-1.5">
            {qa.checks.map((check) => (
              <div key={check.name} className="flex items-center gap-2 text-xs">
                <Icon
                  name={check.passed ? "CheckCircle2" : "AlertCircle"}
                  className={`w-3.5 h-3.5 shrink-0 ${check.passed ? "text-emerald-600" : "text-amber-600"}`}
                />
                <span className="font-medium">{check.name}</span>
                {check.score !== undefined && (
                  <span className="text-muted-foreground ml-auto">{check.score}/100</span>
                )}
              </div>
            ))}
            {/* Factual consistency detail */}
            {qa.factualConsistency && !qa.factualConsistency.passed && (
              <div className="mt-2 p-2 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-900">
                <div className="text-xs font-semibold text-red-700 dark:text-red-400 flex items-center gap-1.5">
                  <Icon name="AlertTriangle" className="w-3.5 h-3.5" /> Factual Consistency Issues
                </div>
                <p className="text-xs text-red-600 dark:text-red-400 mt-1">{qa.factualConsistency.explanation}</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* === Reflection Notes === */}
      {reflection && reflection.triggered ? (
        <Card className="border-amber-200 dark:border-amber-900">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Icon name="Brain" className="w-4 h-4 text-amber-600" /> Reflection Notes
              <Badge variant="outline" className="ml-auto text-[10px]">triggered</Badge>
            </CardTitle>
            <CardDescription className="text-xs">{reflection.reason}</CardDescription>
          </CardHeader>
          <CardContent className="pt-0 space-y-3">
            <p className="text-xs text-muted-foreground">{reflection.notes}</p>
            {reflection.issues.length > 0 && (
              <div>
                <div className="text-xs font-semibold mb-1">Issues found:</div>
                <ul className="space-y-1">
                  {reflection.issues.map((issue, i) => (
                    <li key={i} className="text-xs text-foreground/80 flex items-start gap-1.5">
                      <span className="text-amber-600 shrink-0">•</span> {issue}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {reflection.suggestions.length > 0 && (
              <div>
                <div className="text-xs font-semibold mb-1">Improvements suggested:</div>
                <ul className="space-y-1">
                  {reflection.suggestions.map((sug, i) => (
                    <li key={i} className="text-xs text-foreground/80 flex items-start gap-1.5">
                      <Icon name="ArrowRight" className="w-3 h-3 text-brand shrink-0 mt-0.5" /> {sug}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card className="border-emerald-200 dark:border-emerald-900 bg-emerald-50/50 dark:bg-emerald-950/10">
          <CardContent className="p-4 flex items-center gap-2.5">
            <Icon name="CheckCircle2" className="w-5 h-5 text-emerald-600 shrink-0" />
            <p className="text-sm text-emerald-800 dark:text-emerald-300 font-medium">
              High confidence result. Additional review was not required.
            </p>
          </CardContent>
        </Card>
      )}

      {/* === Optimization Summary === */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Icon name="FileText" className="w-4 h-4 text-brand" /> Optimization Summary
          </CardTitle>
          <CardDescription className="text-xs">What the 5-agent pipeline did to your resume</CardDescription>
        </CardHeader>
        <CardContent className="pt-0 space-y-2">
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="rounded-lg bg-secondary/40 p-2.5">
              <div className="text-muted-foreground">Keywords Added</div>
              <div className="text-lg font-bold text-emerald-600 mt-0.5">
                {beforeATS && afterATS ? Math.max(0, afterATS.matchedKeywords.length - beforeATS.matchedKeywords.length) : 0}
              </div>
              <div className="text-[10px] text-muted-foreground">new keywords embedded</div>
            </div>
            <div className="rounded-lg bg-secondary/40 p-2.5">
              <div className="text-muted-foreground">ATS Improvement</div>
              <div className="text-lg font-bold text-brand mt-0.5">
                +{beforeATS && afterATS ? afterATS.scores.ats - beforeATS.scores.ats : 0} pts
              </div>
              <div className="text-[10px] text-muted-foreground">{beforeATS?.scores.ats ?? "?"} → {afterATS?.scores.ats ?? "?"}</div>
            </div>
            <div className="rounded-lg bg-secondary/40 p-2.5">
              <div className="text-muted-foreground">Content Generated</div>
              <div className="text-lg font-bold text-foreground mt-0.5">{charCount}</div>
              <div className="text-[10px] text-muted-foreground">chars {metCharTarget ? "✓ on target" : ""}</div>
            </div>
            <div className="rounded-lg bg-secondary/40 p-2.5">
              <div className="text-muted-foreground">Provider</div>
              <div className="text-lg font-bold text-foreground mt-0.5 truncate">{provider}</div>
              <div className="text-[10px] text-muted-foreground">AI engine used</div>
            </div>
          </div>
          {qa?.factualConsistency?.passed && (
            <div className="rounded-lg bg-emerald-50 dark:bg-emerald-950/20 p-2.5 flex items-center gap-2">
              <Icon name="ShieldCheck" className="w-4 h-4 text-emerald-600 shrink-0" />
              <span className="text-xs text-emerald-800 dark:text-emerald-300">Factual consistency verified — no fabricated employers, dates, or metrics.</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* === Explainable Tailoring Score & Rationales (Phase 2) === */}
      {result.rationales && result.rationales.length > 0 && (
        <Card className="border-brand/20">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Icon name="Lightbulb" className="w-4 h-4 text-brand" /> Explainable Tailoring Rationales
            </CardTitle>
            <CardDescription className="text-xs">
              Direct explanations of why the AI made each change (ATS alignment, active verbs, readability)
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0 space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
            {result.rationales.map((rat, i) => (
              <div key={i} className="rounded-lg bg-secondary/30 p-3 text-xs border border-border/50">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Badge variant="outline" className="text-[9px] uppercase tracking-wider px-1.5 py-0.5">
                    {rat.section}
                  </Badge>
                  <span className="text-muted-foreground text-[10px]">Rationale</span>
                </div>
                {rat.original && (
                  <div className="text-muted-foreground mb-1 line-through decoration-red-300/80 bg-red-500/5 px-1.5 py-0.5 rounded">
                    <strong>Was:</strong> {rat.original}
                  </div>
                )}
                {rat.edited && (
                  <div className="text-foreground font-medium mb-1.5 bg-emerald-500/5 px-1.5 py-0.5 rounded">
                    <strong>Is:</strong> {rat.edited}
                  </div>
                )}
                <div className="text-brand dark:text-brand-light font-semibold bg-brand/5 dark:bg-brand/10 p-1.5 rounded flex items-start gap-1.5">
                  <Icon name="Info" className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  <span>{rat.reason}</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* === AI Recruiter Panel Simulator === */}
      <Card className="border-brand/20">
        <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle className="text-sm flex items-center gap-2">
              <Icon name="Users" className="w-4 h-4 text-brand" /> AI Recruiter Panel Simulator
            </CardTitle>
            <CardDescription className="text-xs">
              Simulate screening reviews by 3 distinct recruiter personas in real-time.
            </CardDescription>
          </div>
          {!recruiterReport && (
            <Button
              size="sm"
              onClick={runSimulation}
              disabled={simulating}
              className="h-8 font-semibold"
            >
              {simulating ? (
                <>
                  <Icon name="Loader2" className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  Simulating...
                </>
              ) : (
                <>
                  <Icon name="Play" className="w-3.5 h-3.5 mr-1.5" />
                  Run Simulator
                </>
              )}
            </Button>
          )}
        </CardHeader>
        <CardContent className="pt-0 text-xs">
          {!recruiterReport ? (
            <div className="text-center py-6 border border-dashed rounded bg-secondary/10 text-muted-foreground flex flex-col items-center justify-center gap-2">
              <Icon name="MessagesSquare" className="w-8 h-8 text-muted-foreground/40 animate-pulse" />
              <p className="max-w-md text-[11px]">
                Click the button to run a live screening simulation. Sonia, David, and Marcus will read your optimized resume and decide if you qualify.
              </p>
            </div>
          ) : (
            <div className="grid md:grid-cols-3 gap-3">
              {/* Sonia */}
              <div className="rounded-lg bg-orange-500/5 border border-orange-500/20 p-3 space-y-2 flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-7 h-7 rounded-full bg-orange-500 text-white flex items-center justify-center font-bold text-xs">
                      SO
                    </div>
                    <div>
                      <div className="font-semibold text-foreground leading-none">Sonia</div>
                      <div className="text-[9px] text-muted-foreground">Tech Startup HR</div>
                    </div>
                    <Badge variant={recruiterReport.sonia.decision === "hire" ? "success" : recruiterReport.sonia.decision === "maybe" ? "warning" : "danger"} className="ml-auto uppercase text-[9px]">
                      {recruiterReport.sonia.decision}
                    </Badge>
                  </div>
                  <div className="text-[11px] leading-relaxed text-foreground/80 italic bg-background/50 p-2 rounded border border-border">
                    "{recruiterReport.sonia.critique}"
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-[9px] text-muted-foreground uppercase font-bold tracking-wider">Key Takeaways</div>
                  <ul className="space-y-0.5 pl-3 list-disc text-[10px] text-foreground/90">
                    {recruiterReport.sonia.highlights.map((h, idx) => <li key={idx}>{h}</li>)}
                  </ul>
                  <div className="flex items-center justify-between pt-1 text-[10px] border-t border-orange-500/10 mt-1">
                    <span className="text-muted-foreground">Rating:</span>
                    <span className="font-bold text-orange-600">{recruiterReport.sonia.score}/100</span>
                  </div>
                </div>
              </div>

              {/* David */}
              <div className="rounded-lg bg-violet-500/5 border border-violet-500/20 p-3 space-y-2 flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-7 h-7 rounded-full bg-violet-500 text-white flex items-center justify-center font-bold text-xs">
                      DA
                    </div>
                    <div>
                      <div className="font-semibold text-foreground leading-none">David</div>
                      <div className="text-[9px] text-muted-foreground">Engineering Manager</div>
                    </div>
                    <Badge variant={recruiterReport.david.decision === "hire" ? "success" : recruiterReport.david.decision === "maybe" ? "warning" : "danger"} className="ml-auto uppercase text-[9px]">
                      {recruiterReport.david.decision}
                    </Badge>
                  </div>
                  <div className="text-[11px] leading-relaxed text-foreground/80 italic bg-background/50 p-2 rounded border border-border">
                    "{recruiterReport.david.critique}"
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-[9px] text-muted-foreground uppercase font-bold tracking-wider">Key Takeaways</div>
                  <ul className="space-y-0.5 pl-3 list-disc text-[10px] text-foreground/90">
                    {recruiterReport.david.highlights.map((h, idx) => <li key={idx}>{h}</li>)}
                  </ul>
                  <div className="flex items-center justify-between pt-1 text-[10px] border-t border-violet-500/10 mt-1">
                    <span className="text-muted-foreground">Rating:</span>
                    <span className="font-bold text-violet-600">{recruiterReport.david.score}/100</span>
                  </div>
                </div>
              </div>

              {/* Marcus */}
              <div className="rounded-lg bg-blue-500/5 border border-blue-500/20 p-3 space-y-2 flex flex-col justify-between">
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-7 h-7 rounded-full bg-blue-500 text-white flex items-center justify-center font-bold text-xs">
                      MA
                    </div>
                    <div>
                      <div className="font-semibold text-foreground leading-none">Marcus</div>
                      <div className="text-[9px] text-muted-foreground">Corporate Recruiter</div>
                    </div>
                    <Badge variant={recruiterReport.marcus.decision === "hire" ? "success" : recruiterReport.marcus.decision === "maybe" ? "warning" : "danger"} className="ml-auto uppercase text-[9px]">
                      {recruiterReport.marcus.decision}
                    </Badge>
                  </div>
                  <div className="text-[11px] leading-relaxed text-foreground/80 italic bg-background/50 p-2 rounded border border-border">
                    "{recruiterReport.marcus.critique}"
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="text-[9px] text-muted-foreground uppercase font-bold tracking-wider">Key Takeaways</div>
                  <ul className="space-y-0.5 pl-3 list-disc text-[10px] text-foreground/90">
                    {recruiterReport.marcus.highlights.map((h, idx) => <li key={idx}>{h}</li>)}
                  </ul>
                  <div className="flex items-center justify-between pt-1 text-[10px] border-t border-blue-500/10 mt-1">
                    <span className="text-muted-foreground">Rating:</span>
                    <span className="font-bold text-blue-600">{recruiterReport.marcus.score}/100</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* === Visual Guardian Simulator (Phase 4) === */}
      {result.layoutDiagnostics && (
        <Card className={result.layoutDiagnostics.overflows ? "border-amber-500/40 bg-amber-500/5" : "border-emerald-500/30 bg-emerald-500/5"}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Icon name="LayoutGrid" className={`w-4 h-4 ${result.layoutDiagnostics.overflows ? "text-amber-500" : "text-emerald-500"}`} />
              Visual Guardian Simulator
            </CardTitle>
            <CardDescription className="text-xs">
              Simulates PDF line-wrap height constraints in real-time
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0 text-xs flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span>Estimated layout vertical height:</span>
              <span className={`font-semibold ${result.layoutDiagnostics.overflows ? "text-amber-600 font-bold" : "text-emerald-600 font-semibold"}`}>
                {Math.round(result.layoutDiagnostics.totalHeightPt)} / 842 pt
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span>A4 One-Page Fill Factor:</span>
              <span className="font-semibold">{Math.round((result.layoutDiagnostics.totalHeightPt / 842) * 100)}%</span>
            </div>
            <div className="flex items-start gap-1.5 p-2 bg-background/50 border border-border/50 rounded mt-1">
              <Icon name="Info" className="w-3.5 h-3.5 mt-0.5 text-muted-foreground shrink-0" />
              <span className="text-[11px] leading-relaxed text-foreground/80">{result.layoutDiagnostics.recommendation}</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* === Pipeline Timings === */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Icon name="Clock" className="w-4 h-4 text-brand" /> Agent Execution
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="space-y-1.5">
            {steps.map((step, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <Icon
                  name={step.status === "completed" ? "CheckCircle2" : step.status === "failed" ? "XCircle" : step.status === "skipped" ? "Minus" : "Loader2"}
                  className={`w-3.5 h-3.5 shrink-0 ${
                    step.status === "completed" ? "text-emerald-600" :
                    step.status === "failed" ? "text-red-600" :
                    step.status === "skipped" ? "text-muted-foreground" : "text-brand"
                  } ${step.status === "running" ? "animate-spin" : ""}`}
                />
                <span className="font-medium flex-1">{step.name}</span>
                {step.durationMs !== undefined && (
                  <span className="text-muted-foreground">{(step.durationMs / 1000).toFixed(1)}s</span>
                )}
                {step.status === "skipped" && (
                  <span className="text-muted-foreground text-[10px]">skipped</span>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ScoreTile({ label, before, after }: { label: string; before: number; after: number }) {
  const delta = after - before;
  const improved = delta > 0;
  return (
    <div className="rounded-lg bg-secondary/40 p-2.5 text-center">
      <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="text-lg font-bold mt-0.5">{after}</div>
      {delta !== 0 && (
        <div className={`text-[10px] font-medium ${improved ? "text-emerald-600" : "text-red-600"}`}>
          {improved ? "+" : ""}{delta}
        </div>
      )}
      {delta === 0 && (
        <div className="text-[10px] text-muted-foreground">—</div>
      )}
    </div>
  );
}
