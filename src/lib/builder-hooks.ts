// ============================================================================
// Resume Builder Hooks — auto-save, undo/redo, live ATS scoring
// ============================================================================
// Versioned auto-save via IndexedDB with restore prompt on page load.
// Persistent undo/redo stacks that survive page refresh.
// ============================================================================

"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { ResumeData, JobDescription } from "@/lib/types";
import {
  type AutoSaveEntry,
  saveAutoSave,
  getLatestAutoSave,
  loadUndoRedo,
  saveUndoRedo,
  type UndoRedoEntry,
  type UndoRedoPersisted,
} from "@/lib/builder-persistence";

// ============================================================================
// Auto-save hook — versioned IndexedDB persistence
// ============================================================================
export function useAutoSave(resume: ResumeData | undefined, delay = 2000) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [lastSaved, setLastSaved] = useState(Date.now());
  const [saveCount, setSaveCount] = useState(0);
  const [restoreEntry, setRestoreEntry] = useState<AutoSaveEntry | null>(null);

  // Check for unsaved auto-save on mount
  useEffect(() => {
    if (!resume?.id) return;
    getLatestAutoSave(resume.id).then((entry) => {
      if (entry && entry.savedAt > Date.now() - 7 * 24 * 60 * 60 * 1000) {
        setRestoreEntry(entry);
      }
    });
  }, [resume?.id]);

  const dismissRestore = useCallback(() => {
    setRestoreEntry(null);
  }, []);

  useEffect(() => {
    if (!resume?.id) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      try {
        await saveAutoSave({
          resumeId: resume.id,
          resumeData: resume,
          savedAt: Date.now(),
          version: Math.floor(Date.now() / 1000),
        });
        setLastSaved(Date.now());
        setSaveCount((c) => c + 1);
      } catch (e) {
        console.warn("[useAutoSave] IndexedDB write failed:", e);
      }
    }, delay);
  }, [resume, delay]);

  return { lastSaved, saveCount, restoreEntry, dismissRestore };
}

// ============================================================================
// Undo/Redo history hook — IndexedDB-persisted, session-aware
// ============================================================================
export function useUndoRedo(resume: ResumeData | undefined, maxHistory = 100) {
  const [undoStack, setUndoStack] = useState<UndoRedoEntry[]>([]);
  const [redoStack, setRedoStack] = useState<UndoRedoEntry[]>([]);
  const [totalUndos, setTotalUndos] = useState(0);
  const [totalRedos, setTotalRedos] = useState(0);
  const loaded = useRef(false);
  const lastSnapshotLabel = useRef<string | undefined>(undefined);

  // Load persisted state on mount
  useEffect(() => {
    if (!resume?.id || loaded.current) return;
    loaded.current = true;
    loadUndoRedo(resume.id).then((data: UndoRedoPersisted) => {
      setUndoStack(data.undoStack);
      setRedoStack(data.redoStack);
      setTotalUndos(data.totalUndos);
      setTotalRedos(data.totalRedos);
    });
  }, [resume?.id]);

  // Persist whenever stacks change
  const persistRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!resume?.id || !loaded.current) return;
    if (persistRef.current) clearTimeout(persistRef.current);
    persistRef.current = setTimeout(() => {
      saveUndoRedo(resume.id, { undoStack, redoStack, totalUndos, totalRedos }).catch((e) =>
        console.warn("[useUndoRedo] persist failed:", e)
      );
    }, 300);
  }, [undoStack, redoStack, totalUndos, totalRedos, resume?.id]);

  const snapshot = useCallback(
    (label?: string) => {
      if (!resume) return;
      const sessionId = `sess-${Math.floor(Date.now() / 60000)}`; // Group by minute
      lastSnapshotLabel.current = label;
      setUndoStack((prev) => {
        const next = [
          ...prev,
          {
            data: { ...resume },
            timestamp: Date.now(),
            label: label ?? undefined,
            sessionId,
          },
        ];
        return next.slice(-maxHistory);
      });
      setRedoStack([]);
    },
    [resume, maxHistory]
  );

  const undo = useCallback(() => {
    if (undoStack.length === 0) return null;
    const prev = undoStack[undoStack.length - 1];
    setUndoStack((s) => s.slice(0, -1));
    setTotalUndos((c) => c + 1);
    if (resume) {
      setRedoStack((s) => [
        ...s,
        { data: { ...resume }, timestamp: Date.now(), sessionId: `redo-${Date.now()}` },
      ]);
    }
    return prev.data;
  }, [undoStack, resume]);

  const redo = useCallback(() => {
    if (redoStack.length === 0) return null;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((s) => s.slice(0, -1));
    setTotalRedos((c) => c + 1);
    if (resume) {
      setUndoStack((s) => [
        ...s,
        { data: { ...resume }, timestamp: Date.now(), sessionId: `undo-${Date.now()}` },
      ]);
    }
    return next.data;
  }, [redoStack, resume]);

  const jumpTo = useCallback(
    (index: number) => {
      if (index < 0 || index >= undoStack.length) return null;
      const target = undoStack[index];
      // Move everything after index to redo
      setUndoStack((s) => s.slice(0, index));
      if (resume) {
        setRedoStack((s) => [
          ...s,
          ...undoStack.slice(index + 1).map((e) => ({ ...e })),
          { data: { ...resume }, timestamp: Date.now() },
        ]);
      }
      return target.data;
    },
    [undoStack, resume]
  );

  return {
    snapshot,
    undo,
    redo,
    jumpTo,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
    undoStack,
    redoStack,
    totalUndos,
    totalRedos,
  };
}

// ============================================================================
// Live ATS Score hook — real-time keyword matching against JD
// ============================================================================
export interface ATSScore {
  overall: number;
  keywordDensity: number;
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
