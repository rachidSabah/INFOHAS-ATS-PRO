"use client";

import { motion } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge, Icon, ScoreRing } from "@/components/shared";
import type { PipelineResult } from "@/lib/agents";

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
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* === Score Breakdown === */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Icon name="BarChart3" className="w-4 h-4 text-brand" /> ATS Score Breakdown
          </CardTitle>
          <CardDescription className="text-xs">7 explainable scores from the ATS Analysis Agent</CardDescription>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <ScoreTile label="Overall" before={beforeScore} after={afterATS.scores.ats} />
            <ScoreTile label="Keywords" before={beforeATS.scores.keywordMatch} after={afterATS.scores.keywordMatch} />
            <ScoreTile label="Semantic" before={beforeATS.scores.semanticSimilarity} after={afterATS.scores.semanticSimilarity} />
            <ScoreTile label="Readability" before={beforeATS.scores.readability} after={afterATS.scores.readability} />
            <ScoreTile label="Content" before={beforeATS.scores.content} after={afterATS.scores.content} />
            <ScoreTile label="Grammar" before={beforeATS.scores.grammar} after={afterATS.scores.grammar} />
            <ScoreTile label="Formatting" before={beforeATS.scores.formatting} after={afterATS.scores.formatting} />
            <ScoreTile label="Completeness" before={beforeATS.scores.completeness} after={afterATS.scores.completeness} />
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
