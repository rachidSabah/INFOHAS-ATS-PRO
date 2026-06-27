// ============================================================================
// Resume Builder Hooks — auto-save, undo/redo, live ATS scoring
// ============================================================================
"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { ResumeData, JobDescription } from "@/lib/types";

// ============================================================================
// Auto-save hook — debounced localStorage persistence
// ============================================================================
export function useAutoSave(resume: ResumeData | undefined, delay = 2000) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [lastSaved, setLastSaved] = useState(Date.now());

  useEffect(() => {
    if (!resume?.id) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      localStorage.setItem("resume-builder-autosave", JSON.stringify({
        resumeId: resume.id,
        resumeData: resume,
        savedAt: Date.now(),
      }));
      setLastSaved(Date.now());
    }, delay);
  }, [resume, delay]);

  return { lastSaved };
}

// ============================================================================
// Undo/Redo history hook
// ============================================================================
interface HistoryEntry { data: Partial<ResumeData>; timestamp: number; }

export function useUndoRedo(resume: ResumeData | undefined, maxHistory = 50) {
  const [undoStack, setUndoStack] = useState<HistoryEntry[]>([]);
  const [redoStack, setRedoStack] = useState<HistoryEntry[]>([]);

  const snapshot = useCallback(() => {
    if (!resume) return;
    setUndoStack((prev) => {
      const next = [...prev, { data: { ...resume }, timestamp: Date.now() }];
      return next.slice(-maxHistory);
    });
    setRedoStack([]);
  }, [resume, maxHistory]);

  const undo = useCallback(() => {
    if (undoStack.length === 0) return null;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack((s) => s.slice(0, -1));
    if (resume) setRedoStack((s) => [...s, { data: { ...resume }, timestamp: Date.now() }]);
    return prev.data;
  }, [undoStack, resume]);

  const redo = useCallback(() => {
    if (redoStack.length === 0) return null;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((s) => s.slice(0, -1));
    if (resume) setUndoStack((s) => [...s, { data: { ...resume }, timestamp: Date.now() }]);
    return next.data;
  }, [redoStack, resume]);

  return { snapshot, undo, redo, canUndo: undoStack.length > 0, canRedo: redoStack.length > 0 };
}

// ============================================================================
// Live ATS Score hook — real-time keyword matching against JD
// ============================================================================
export interface ATSScore {
  overall: number;           // 0-100
  keywordDensity: number;    // % of JD keywords found in resume
  missingKeywords: string[];
  sectionScores: {
    summary: number;
    skills: number;
    experience: number;
    education: number;
  };
  recommendations: string[];
}

export function useLiveATSScore(resume: ResumeData | undefined, jd: JobDescription | undefined): ATSScore | null {
  const [score, setScore] = useState<ATSScore | null>(null);

  useEffect(() => {
    if (!resume || !jd) { setScore(null); return; }
    const debounce = setTimeout(() => {
      const jdKeywords = (jd.keywords || []).map(k => k.toLowerCase());
      const resumeText = [
        resume.summary || "",
        ...(resume.skills || []).map(s => s.name),
        ...(resume.experience || []).flatMap(e => e.bullets),
      ].join(" ").toLowerCase();

      const found: string[] = [];
      const missing: string[] = [];
      for (const kw of jdKeywords) {
        if (resumeText.includes(kw)) found.push(kw);
        else missing.push(kw);
      }

      const keywordDensity = jdKeywords.length > 0 ? Math.round((found.length / jdKeywords.length) * 100) : 0;

      // Section scores
      const summaryText = (resume.summary || "").toLowerCase();
      const summaryMatch = jdKeywords.filter(k => summaryText.includes(k)).length;
      const summaryScore = jdKeywords.length > 0 ? Math.round((summaryMatch / jdKeywords.length) * 100) : 0;

      const skillsText = (resume.skills || []).map(s => s.name).join(" ").toLowerCase();
      const skillsMatch = jdKeywords.filter(k => skillsText.includes(k)).length;
      const skillsScore = jdKeywords.length > 0 ? Math.round((skillsMatch / jdKeywords.length) * 100) : 0;

      const expText = (resume.experience || []).flatMap(e => e.bullets).join(" ").toLowerCase();
      const expMatch = jdKeywords.filter(k => expText.includes(k)).length;
      const expScore = jdKeywords.length > 0 ? Math.round((expMatch / jdKeywords.length) * 100) : 0;

      const recommendations: string[] = [];
      if (keywordDensity < 50) recommendations.push("Add more JD keywords to summary and bullets");
      if (summaryScore < 40) recommendations.push("Expand summary to include key qualifications");
      if (skillsScore < 50) recommendations.push("Add missing skills: " + missing.slice(0, 3).join(", "));
      if ((resume.experience || []).some(e => e.bullets.length < 2)) recommendations.push("Add 2-4 achievement bullets per experience");

      setScore({
        overall: Math.round((keywordDensity * 0.4) + (summaryScore * 0.2) + (skillsScore * 0.2) + (expScore * 0.2)),
        keywordDensity,
        missingKeywords: missing.slice(0, 5),
        sectionScores: { summary: summaryScore, skills: skillsScore, experience: expScore, education: 0 },
        recommendations,
      });
    }, 800);
    return () => clearTimeout(debounce);
  }, [resume, jd]);

  return score;
}
