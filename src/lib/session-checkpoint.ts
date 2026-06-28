/**
 * session-checkpoint.ts — Optimization Session Checkpoint & Recovery System
 *
 * Stores parsed resume data at each optimization stage and supports
 * recovery from the latest checkpoint when a provider fails.
 *
 * Stages: parsing → summary → experience → education → skills → languages → assembly
 */

import type { ResumeData } from "./types";
import type { OptimizationStage } from "./types";

// ============================================================================
// In-memory session checkpoint store (also persisted to D1 when available)
// ============================================================================

interface SessionCheckpoint {
  sessionId: string;
  userId: string;
  stage: OptimizationStage;
  data: ResumeData;
  originalResume: string;
  jobDescription: string;
  timestamp: number;
}

const store: Record<string, SessionCheckpoint> = {};

let sessionCounter = 0;

// ============================================================================
// Session lifecycle
// ============================================================================

/**
 * Create a new optimization session.
 */
export function createSession(
  userId: string,
  originalResume: string,
  jobDescription: string
): string {
  sessionCounter++;
  const sessionId = `session_${Date.now()}_${sessionCounter}`;
  store[sessionId] = {
    sessionId,
    userId,
    stage: "parsing",
    data: null as any,
    originalResume,
    jobDescription,
    timestamp: Date.now(),
  };
  console.log(`[Checkpoint] Session created: ${sessionId}`);
  return sessionId;
}

/**
 * Save a checkpoint — stores the current resume data at a given stage.
 * Also persists to D1 via API when available.
 */
export async function saveCheckpoint(
  sessionId: string,
  stage: OptimizationStage,
  data: ResumeData
): Promise<void> {
  const session = store[sessionId];
  if (!session) {
    console.warn(`[Checkpoint] Session not found: ${sessionId}`);
    return;
  }

  session.stage = stage;
  session.data = data;
  session.timestamp = Date.now();

  // Persist to D1 via API (fire-and-forget)
  persistCheckpointToD1(sessionId, stage, data).catch(() => {});
}

/**
 * Get the latest checkpoint for a session.
 */
export function getLatestCheckpoint(sessionId: string): {
  stage: OptimizationStage;
  data: ResumeData;
} | null {
  const session = store[sessionId];
  if (!session || !session.data) return null;
  return { stage: session.stage, data: session.data };
}

/**
 * Resume from a checkpoint — returns the latest saved data.
 * If no checkpoint exists, returns null (caller must re-parse).
 */
export function resumeFromCheckpoint(
  sessionId: string
): { stage: OptimizationStage; data: ResumeData } | null {
  return getLatestCheckpoint(sessionId);
}

/**
 * Get the stage at which optimization should resume.
 * Scans stages in order and returns the first incomplete stage.
 */
export function getNextIncompleteStage(
  sessionId: string,
  stages: OptimizationStage[]
): OptimizationStage | null {
  const checkpoint = store[sessionId];
  if (!checkpoint || !checkpoint.data) return stages[0];

  const currentIndex = stages.indexOf(checkpoint.stage);
  if (currentIndex === -1) return stages[0];

  // If we're at the last stage, we're done
  if (currentIndex >= stages.length - 1) return null;

  // Return the next stage after the current one
  return stages[currentIndex + 1];
}

/**
 * Close a session on completion or failure.
 */
export function closeSession(sessionId: string, error?: string): void {
  const session = store[sessionId];
  if (!session) return;

  if (error) {
    console.log(`[Checkpoint] Session ${sessionId} failed: ${error}`);
  } else {
    console.log(`[Checkpoint] Session ${sessionId} completed`);
  }

  // Keep in memory for 5 minutes, then auto-cleanup
  setTimeout(() => {
    delete store[sessionId];
  }, 5 * 60 * 1000);
}

// ============================================================================
// D1 persistence (via fetch API)
// ============================================================================

async function persistCheckpointToD1(
  sessionId: string,
  stage: string,
  data: ResumeData
): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    await fetch("/api/optimization/save-checkpoint", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId, stage, data }),
    });
  } catch {
    // Checkpoints work in memory regardless
  }
}

// ============================================================================
// Pre-defined optimization stages
// ============================================================================

export const OPTIMIZATION_STAGES: OptimizationStage[] = [
  "parsing",
  "summary",
  "experience",
  "education",
  "skills",
  "languages",
  "assembly",
];
