"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import type { ResumeData, JobDescription } from "@/lib/types";
import {
  computeATSReadiness,
  type ATSReadinessResult,
} from "@/components/optimizer/ATSScoreSimulator";

export interface ATSMatchScoreState {
  /** 0-100 readiness score, or null if no JD provided */
  score: number | null;
  /** Label for the score tier */
  label: string;
  /** Full breakdown from the scoring engine */
  breakdown: ATSReadinessResult | null;
  /** Whether the computation is stale (user is still typing) */
  stale: boolean;
  /** Whether a JD is loaded */
  hasJD: boolean;
}

const TIERS = [
  { min: 85, label: "Excellent" },
  { min: 70, label: "Good" },
  { min: 50, label: "Needs Work" },
  { min: 0, label: "Critical" },
];

function scoreLabel(score: number): string {
  for (const t of TIERS) {
    if (score >= t.min) return t.label;
  }
  return "Unknown";
}

/**
 * Debounced real-time ATS match score hook.
 *
 * @param resume - The current resume being edited
 * @param jd - Optional job description to score against
 * @param debounceMs - Debounce delay (default 400ms)
 */
export function useATSMatchScore(
  resume: ResumeData,
  jd?: JobDescription | null,
  debounceMs = 400,
): ATSMatchScoreState {
  // Track resume identity for stale detection
  const resumeRef = useRef(resume);
  const [stale, setStale] = useState(false);
  const [version, setVersion] = useState(0);

  // Debounce — mark stale on change, settle after delay
  useEffect(() => {
    resumeRef.current = resume;
    setStale(true);
    const timer = setTimeout(() => {
      setVersion((v) => v + 1);
      setStale(false);
    }, debounceMs);
    return () => clearTimeout(timer);
  }, [resume, debounceMs]);

  // Compute on settled version
  const breakdown = useMemo<ATSReadinessResult | null>(() => {
    if (!jd) return null;
    // Use the debounced version to force re-compute
    if (version < 0) return null; // fallthrough
    return computeATSReadiness(resume, jd);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, jd]);

  const score = breakdown?.readinessScore ?? null;

  return {
    score,
    label: score !== null ? scoreLabel(score) : "",
    breakdown,
    stale,
    hasJD: !!jd,
  };
}
