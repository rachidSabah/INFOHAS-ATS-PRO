#!/usr/bin/env python3
"""Replace the legacy optimize() + optimizeAviation() functions in Optimizer.tsx
with a single runPipeline() that calls the orchestrator."""

import re

FILE = "/home/z/my-project/src/components/app/modules/Optimizer.tsx"

with open(FILE, "r") as f:
    content = f.read()

# The new runPipeline function that replaces both optimize() and optimizeAviation()
NEW_FUNCTION = '''  // ============================================================================
  // runPipeline() — the SINGLE ENTRY POINT for resume optimization.
  //
  // This replaces the legacy inline optimize() + optimizeAviation() functions.
  // All optimization now flows through the 5-agent orchestrator:
  //   1. Job Intelligence Agent
  //   2. ATS Analysis Agent (before)
  //   3. Resume Optimizer Agent
  //   4. Quality Assurance Agent
  //   5. Reflection Agent (optional — triggers when confidence < 75 or ATS improvement < 5)
  //
  // The orchestrator handles:
  //   - AI call + JSON mapping (standard + aviation modes)
  //   - Content validation + leak prevention
  //   - Factual consistency check (compares optimized vs original)
  //   - Professional tone check
  //   - ATS scoring (before + after) with semantic similarity + readability
  //   - Reflection (when needed)
  //
  // Real-time progress is streamed via the onProgress callback.
  // ============================================================================
  const runPipeline = async () => {
    if (!resume || !jdParsed || !beforeReport) return;
    setAiThinking(true);
    setAiLog([]);
    setPipelineProgress(null);
    setPipelineResult(null);
    setOptimizedResume(null);
    setAfterReport(null);

    const directiveConfig = useApp.getState().optimizerDirective;
    const usingOverride = !!directiveConfig?.customDirectiveOverride?.trim();

    setAiLog((l) => [...l, `Directive source: ${usingOverride ? "CUSTOM OVERRIDE (from Optimizer Directive settings)" : "GENERATED (from structured config)"}`]);
    setAiLog((l) => [...l, `Mode: ${aviationMode ? `Aviation ATS (${airlineProfile})` : "Standard"}`]);
    setAiLog((l) => [...l, "Starting 5-agent pipeline…"]);

    try {
      const result = await runOptimizationPipeline({
        resume,
        jd: jdParsed,
        userDirectives: directiveConfig?.customDirectiveOverride?.trim() || undefined,
        aviationMode: aviationMode
          ? { airlineProfile, settings: aviationSettings }
          : undefined,
        enableReflection: true,
        checkExport: false,
        onProgress: (progress) => {
          setPipelineProgress(progress);
          if (progress.log) {
            setAiLog((l) => [...l, `[Step ${progress.stepNumber}/${progress.totalSteps}] ${progress.log}`]);
          }
        },
      });

      setPipelineResult(result);

      // Map pipeline result → local state
      if (result.optimizedResume) {
        setOptimizedResume(result.optimizedResume);
        addResume(result.optimizedResume);
      }

      // Map the richer ATSAnalysisResult back to the legacy ATSReport shape
      if (result.afterATS && result.optimizedResume) {
        const after = scoreATS(result.optimizedResume, jdParsed);
        after.scores.ats = result.afterATS.scores.ats;
        after.scores.content = result.afterATS.scores.content;
        after.scores.completeness = result.afterATS.scores.completeness;
        after.scores.keywords = result.afterATS.scores.keywordMatch;
        after.missingKeywords = result.afterATS.missingKeywords;
        after.matchedKeywords = result.afterATS.matchedKeywords;
        setAfterReport(after);
        addATS(after);
      }

      // Stream the per-step logs into the legacy aiLog panel
      for (const step of result.steps) {
        if (step.log) {
          setAiLog((l) => [...l, `${step.status === "failed" ? "⚠" : "✓"} ${step.name}: ${step.log}`]);
        }
      }

      incUsage("resumesGenerated");
      log({
        actor: "you",
        action: `Resume optimized (${aviationMode ? "Aviation ATS" : "Standard"} — 5-agent pipeline)`,
        category: "ai",
        details: `ATS ${result.beforeATS?.scores.ats ?? "?"} → ${result.afterATS?.scores.ats ?? "?"} via ${result.provider}${result.qa ? `, confidence=${result.qa.confidence}` : ""}${result.reflection?.triggered ? ", reflection triggered" : ""}`,
        severity: "info",
      });

      setAiThinking(false);
      setStep("done");

      const delta = (result.afterATS?.scores.ats ?? 0) - (result.beforeATS?.scores.ats ?? 0);
      const confidence = result.qa?.confidence ?? 0;
      toast.success(`Optimization complete — ATS ${result.beforeATS?.scores.ats ?? "?"} → ${result.afterATS?.scores.ats ?? "?"} (+${delta} pts) · Confidence ${confidence}/100`);
    } catch (e: any) {
      setAiLog((l) => [...l, `✗ Pipeline failed: ${e?.message || "unknown error"}`]);
      setAiThinking(false);
      toast.error(e?.message || "Optimization failed. Please try again.");
    }
  };

  // Legacy alias — the "Optimize" button still calls optimize().
  // Now it delegates to runPipeline().
  const optimize = runPipeline;'''

# Find the start of "const optimize = async () => {" and the end of optimizeAviation
# The block ends right before "const reset = () => {"
start_marker = "  const optimize = async () => {"
end_marker = "  const reset = () => {"

start_idx = content.find(start_marker)
end_idx = content.find(end_marker)

if start_idx == -1 or end_idx == -1:
    print(f"ERROR: Could not find markers. start={start_idx}, end={end_idx}")
    exit(1)

# Replace everything from start_marker to end_marker (exclusive) with the new function
new_content = content[:start_idx] + NEW_FUNCTION + "\n\n" + content[end_idx:]

with open(FILE, "w") as f:
    f.write(new_content)

print(f"✓ Replaced {end_idx - start_idx} chars of legacy code with {len(NEW_FUNCTION)} chars of new pipeline code")
print(f"  File reduced from {len(content)} to {len(new_content)} chars ({len(content) - len(new_content)} chars removed)")
