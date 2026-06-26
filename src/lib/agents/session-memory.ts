// ============================================================================
// Session Memory — Round-Tracking Session for Optimization Supervisor
//
// Wraps the existing supervisor-memory.ts into a singleton session that
// the supervisor can use to carry state between optimization rounds.
//
// Key features:
//   - Tracks each optimization round (round number, resume ID, ATS scores,
//     strategies tried, successes, failures, user directives)
//   - Provides a compact getSummary() text for the next round's prompt,
//     so the supervisor knows what worked / what didn't / what the user
//     rejected
//   - Ad-hoc memory items (remember/recall/forget) so the supervisor can
//     store notes across rounds
//   - Singleton — one session per optimization lifecycle
// ============================================================================

import {
  createSupervisorMemory,
  writeMemory,
  readMemory,
  completeMemory,
  getMemorySummary,
} from "../supervisor-memory";
import type { SupervisorMemory } from "../pipeline-orchestration-types";

// ============================================================================
// Types
// ============================================================================

export interface SessionRound {
  round: number;
  resumeId: string;
  startedAt: string;
  completedAt?: string;
  beforeATS?: number;
  afterATS?: number;
  strategies: string[];
  successes: string[];
  failures: string[];
  directives: Record<string, any>;
}

// ============================================================================
// Singleton Session
// ============================================================================

let _instance: OptimizationSession | null = null;

export class OptimizationSession {
  private _rounds: SessionRound[] = [];
  private _currentRound: SessionRound | null = null;
  private _memories: Record<string, string> = {};
  private _memory: SupervisorMemory | null = null;
  private _roundCounter = 0;

  // ---- Private constructor (singleton) ----

  private constructor() {}

  // ---- Singleton accessors ----

  static getInstance(): OptimizationSession {
    if (!_instance) {
      _instance = new OptimizationSession();
    }
    return _instance;
  }

  static reset(): void {
    _instance = null;
  }

  // ---- Round management ----

  /**
   * Start a new optimization round.
   * Returns the round number (1-based).
   */
  startRound(resumeId: string, directives: Record<string, any> = {}): number {
    this._roundCounter++;
    const round: SessionRound = {
      round: this._roundCounter,
      resumeId,
      startedAt: new Date().toISOString(),
      strategies: [],
      successes: [],
      failures: [],
      directives,
    };
    this._currentRound = round;
    this._rounds.push(round);

    // Create a fresh supervisor memory for this round
    this._memory = createSupervisorMemory(`round_${this._roundCounter}_${Date.now()}`);

    // Store round metadata in supervisor memory scratchpad
    writeMemory(this._memory, "sessionRound", {
      round: this._roundCounter,
      resumeId,
      directives,
    });

    return this._roundCounter;
  }

  /**
   * Mark the current round as complete with results.
   */
  completeRound(result: {
    beforeATS: number;
    afterATS: number;
    strategies: string[];
    successes: string[];
    failures: string[];
  }): void {
    if (!this._currentRound) {
      console.warn("[SessionMemory] No active round to complete");
      return;
    }

    this._currentRound.completedAt = new Date().toISOString();
    this._currentRound.beforeATS = result.beforeATS;
    this._currentRound.afterATS = result.afterATS;
    this._currentRound.strategies = result.strategies;
    this._currentRound.successes = result.successes;
    this._currentRound.failures = result.failures;

    // Complete the underlying supervisor memory
    if (this._memory) {
      completeMemory(this._memory);
      writeMemory(this._memory, "sessionRoundResult", result);
    }

    this._currentRound = null;
  }

  // ---- Queries ----

  getCurrentRound(): SessionRound | null {
    return this._currentRound;
  }

  getHistory(): SessionRound[] {
    return [...this._rounds];
  }

  /**
   * Return the underlying SupervisorMemory for the current round,
   * so the supervisor can read/write shared sections (jobIntelligence,
   * skillGapAnalysis, atsKeywords, etc.) through the existing API.
   */
  getMemory(): SupervisorMemory | null {
    return this._memory;
  }

  // ---- Summary for supervisor prompt ----

  /**
   * Produce a compact text summary of all completed rounds.
   * This is fed into the next round's supervisor prompt so the LLM
   * knows what happened previously and can adapt its strategy.
   */
  getSummary(): string {
    const completed = this._rounds.filter((r) => r.completedAt);
    if (completed.length === 0) return "";

    const lines: string[] = ["Previous optimization history:"];

    for (const round of completed) {
      const date = new Date(round.startedAt).toISOString().slice(0, 10);
      const diff =
        round.beforeATS !== undefined && round.afterATS !== undefined
          ? `+${round.afterATS - round.beforeATS} pts (before: ${round.beforeATS}, after: ${round.afterATS})`
          : "(no score data)";

      lines.push(`  Round ${round.round} (${date}): ${diff}`);
      lines.push(`    Resume: ${round.resumeId}`);

      if (round.strategies.length > 0) {
        lines.push(`    Strategies: ${round.strategies.join(", ")}`);
      }
      if (round.successes.length > 0) {
        lines.push(`    Successes: ${round.successes.join(", ")}`);
      }
      if (round.failures.length > 0) {
        lines.push(`    Failures: ${round.failures.join(", ")}`);
      }

      const directiveKeys = Object.keys(round.directives);
      if (directiveKeys.length > 0) {
        const prefs = directiveKeys
          .map((k) => `${k}: ${JSON.stringify(round.directives[k])}`)
          .join(", ");
        lines.push(`    User preferences: ${prefs}`);
      }
    }

    // Append any persistent memory items
    const memKeys = Object.keys(this._memories);
    if (memKeys.length > 0) {
      lines.push("");
      lines.push("  Session memory:");
      for (const key of memKeys) {
        lines.push(`    "${key}": "${this._memories[key]}"`);
      }
    }

    return lines.join("\n");
  }

  // ---- Ad-hoc memory (remember/recall) ----

  /**
   * Store a named memory item that persists across rounds.
   */
  remember(key: string, value: string): void {
    this._memories[key] = value;
    // Also mirror into supervisor memory scratchpad
    if (this._memory) {
      const existing = readMemory<Record<string, string>>(this._memory, "sessionMemories") ?? {};
      existing[key] = value;
      writeMemory(this._memory, "sessionMemories", existing);
    }
  }

  /**
   * Retrieve a previously stored memory item.
   */
  recall(key: string): string | undefined {
    return this._memories[key];
  }

  /**
   * Remove a memory item.
   */
  forget(key: string): void {
    delete this._memories[key];
    if (this._memory) {
      const existing = readMemory<Record<string, string>>(this._memory, "sessionMemories") ?? {};
      delete existing[key];
      writeMemory(this._memory, "sessionMemories", existing);
    }
  }

  /**
   * Get all stored memory items.
   */
  getAllMemories(): Record<string, string> {
    return { ...this._memories };
  }
}
