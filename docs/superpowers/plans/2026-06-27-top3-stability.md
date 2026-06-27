# Top 3 Stability Components — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Resume Snapshot Engine (instant rollback/undo), Agent Event Bus (standardized monitoring), and Parallel Pipeline Execution (concurrent agent calls).

**Architecture:** Three new focused modules. Snapshot Engine saves pre-optimization state to localStorage + store, enabling rollback and diff. Event Bus is a lightweight pub/sub for agent lifecycle events. Parallel Pipeline splits the bullet-only optimizer into concurrent summary/skills/experience LLM calls that assemble after completion.

**Tech Stack:** TypeScript, Zustand store, localStorage persistence, Vitest testing. No new dependencies.

---

## File Structure Map

| File | Create/Modify | Responsibility |
|------|--------------|----------------|
| `src/lib/resume-snapshot-engine.ts` | **Create** | Snapshot types, create/restore/compare |
| `src/lib/agent-event-bus.ts` | **Create** | Pub/sub event bus for agent lifecycle |
| `src/lib/parallel-pipeline.ts` | **Create** | Parallel LLM calls for summary/skills/experience |
| `src/lib/store.ts` | **Modify** | Add `snapshots` array + `addSnapshot`/`restoreSnapshot` actions |
| `src/lib/locked-pipeline.ts` | **Modify** | Integrate snapshot capture + event bus emissions |
| `src/lib/__tests__/snapshot-engine.test.ts` | **Create** | Tests for snapshot engine |
| `src/lib/__tests__/agent-event-bus.test.ts` | **Create** | Tests for event bus |
| `src/lib/__tests__/parallel-pipeline.test.ts` | **Create** | Tests for parallel pipeline |

---

### Task 1: Resume Snapshot Engine — Types + Core Functions

**Files:**
- Create: `src/lib/resume-snapshot-engine.ts`
- Create: `src/lib/__tests__/snapshot-engine.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/__tests__/snapshot-engine.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { createSnapshot, restoreResumeFromSnapshot, compareSnapshots } from "../resume-snapshot-engine";
import type { ResumeData } from "../types";

const MOCK_RESUME: ResumeData = {
  id: "r_test1",
  name: "John Doe",
  headline: "Software Engineer",
  contact: { email: "john@test.com", phone: "+123", location: "NYC" },
  summary: "Experienced engineer with 5 years...",
  experience: [
    { id: "exp_1", title: "Senior Dev", company: "Acme Corp", location: "NYC",
      startDate: "2020-01", endDate: "2024-01", bullets: ["Built API", "Led team"] }
  ],
  education: [
    { id: "ed_1", institution: "MIT", degree: "BS CS", startDate: "2016", endDate: "2020" }
  ],
  skills: [{ id: "s1", name: "TypeScript", category: "Languages" }],
  languages: [{ name: "English", proficiency: "Fluent" }],
  certifications: [],
  projects: [],
  template: "ats-professional",
  accentColor: "#1154A3",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  source: "manual",
};

describe("Resume Snapshot Engine", () => {
  describe("createSnapshot", () => {
    it("creates a snapshot with resumeId, snapshotId, and timestamp", () => {
      const snapshot = createSnapshot(MOCK_RESUME);
      expect(snapshot.resumeId).toBe("r_test1");
      expect(snapshot.snapshotId).toMatch(/^snap_/);
      expect(snapshot.timestamp).toBeTruthy();
      expect(snapshot.fullResume).toEqual(MOCK_RESUME);
    });

    it("includes blueprint with experience count", () => {
      const snapshot = createSnapshot(MOCK_RESUME);
      expect(snapshot.blueprint.experience.length).toBe(1);
      expect(snapshot.blueprint.education.length).toBe(1);
      expect(snapshot.blueprint.experience[0].company).toBe("Acme Corp");
    });

    it("includes experience fingerprints for matching", () => {
      const snapshot = createSnapshot(MOCK_RESUME);
      expect(snapshot.experienceFingerprints.length).toBe(1);
      expect(snapshot.experienceFingerprints[0].expId).toBe("exp_1");
      expect(snapshot.experienceFingerprints[0].fingerprint).toBeTruthy();
    });
  });

  describe("restoreResumeFromSnapshot", () => {
    it("returns the full resume from a snapshot", () => {
      const snapshot = createSnapshot(MOCK_RESUME);
      const restored = restoreResumeFromSnapshot(snapshot);
      expect(restored).toEqual(MOCK_RESUME);
      expect(restored.name).toBe("John Doe");
    });

    it("returns null for invalid snapshot", () => {
      expect(restoreResumeFromSnapshot(null as any)).toBeNull();
      expect(restoreResumeFromSnapshot({} as any)).toBeNull();
    });
  });

  describe("compareSnapshots", () => {
    it("returns empty diff for identical resumes", () => {
      const before = createSnapshot(MOCK_RESUME);
      const after = createSnapshot(MOCK_RESUME);
      const diff = compareSnapshots(before, after);
      expect(diff.changes).toEqual([]);
    });

    it("detects changed summary", () => {
      const before = createSnapshot(MOCK_RESUME);
      const modified = { ...MOCK_RESUME, summary: "New summary text" };
      const after = createSnapshot(modified);
      const diff = compareSnapshots(before, after);
      expect(diff.changes).toContainEqual(
        expect.objectContaining({ field: "summary" })
      );
    });

    it("detects dropped experience entry", () => {
      const before = createSnapshot(MOCK_RESUME);
      const modified = { ...MOCK_RESUME, experience: [] };
      const after = createSnapshot(modified);
      const diff = compareSnapshots(before, after);
      expect(diff.changes.length).toBeGreaterThan(0);
      expect(diff.changes.some(c => c.field === "experience")).toBe(true);
    });

    it("detects added experience entry (hallucination)", () => {
      const before = createSnapshot(MOCK_RESUME);
      const modified = {
        ...MOCK_RESUME,
        experience: [...MOCK_RESUME.experience, {
          id: "exp_hallucination", title: "Fake Role", company: "FakeCorp",
          location: "Nowhere", startDate: "2024", endDate: "2025", bullets: ["Did nothing"]
        }]
      };
      const after = createSnapshot(modified);
      const diff = compareSnapshots(before, after);
      expect(diff.hallucinations.length).toBe(1);
      expect(diff.hallucinations[0]).toContain("FakeCorp");
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/snapshot-engine.test.ts`
Expected: ALL FAIL — `createSnapshot is not a function`

- [ ] **Step 3: Write snapshot engine implementation**

```typescript
// src/lib/resume-snapshot-engine.ts
import type { ResumeData } from "./types";
import { extractBlueprint, type ResumeBlueprint } from "./resume-blueprint-agent";
import { extractTemplateBlueprint, type ResumeTemplateBlueprint } from "./resume-template-blueprint-agent";
import { computeExperienceFingerprint } from "./experience-fingerprint";

let _snapCounter = 0;
function nextSnapId(): string {
  _snapCounter++;
  return `snap_${Date.now()}_${_snapCounter}`;
}

export interface ExperienceFingerprintEntry {
  expId: string;
  fingerprint: string;
  company: string;
  title: string;
}

export interface ResumeSnapshot {
  resumeId: string;
  snapshotId: string;
  timestamp: string;
  /** Full resume data for instant rollback */
  fullResume: ResumeData;
  /** Immutable entity blueprint */
  blueprint: ResumeBlueprint;
  /** Template/layout blueprint */
  templateBlueprint: ResumeTemplateBlueprint;
  /** Experience fingerprints for cross-optimization matching */
  experienceFingerprints: ExperienceFingerprintEntry[];
  /** Label for UI display */
  label?: string;
}

export interface SnapshotDiff {
  changes: { field: string; before: unknown; after: unknown }[];
  hallucinations: string[];
  summary: string;
}

/**
 * Create a snapshot of a resume before optimization.
 * Captures: full resume, blueprint, template, and fingerprints.
 */
export function createSnapshot(resume: ResumeData, label?: string): ResumeSnapshot {
  const blueprint = extractBlueprint(resume);
  const templateBlueprint = extractTemplateBlueprint(resume);
  const experienceFingerprints: ExperienceFingerprintEntry[] = resume.experience.map((exp) => ({
    expId: exp.id,
    fingerprint: computeExperienceFingerprint(exp),
    company: exp.company,
    title: exp.title,
  }));

  return {
    resumeId: resume.id,
    snapshotId: nextSnapId(),
    timestamp: new Date().toISOString(),
    fullResume: JSON.parse(JSON.stringify(resume)), // deep clone
    blueprint,
    templateBlueprint,
    experienceFingerprints,
    label,
  };
}

/**
 * Restore a resume from a snapshot. Returns null if snapshot is invalid.
 */
export function restoreResumeFromSnapshot(snapshot: ResumeSnapshot | null | undefined): ResumeData | null {
  if (!snapshot || !snapshot.fullResume || !snapshot.fullResume.id) {
    return null;
  }
  // Return a deep clone so mutations don't affect the snapshot
  return JSON.parse(JSON.stringify(snapshot.fullResume));
}

/**
 * Compare two snapshots and produce a human-readable diff.
 */
export function compareSnapshots(before: ResumeSnapshot, after: ResumeSnapshot): SnapshotDiff {
  const changes: { field: string; before: unknown; after: unknown }[] = [];
  const hallucinations: string[] = [];

  const bResume = before.fullResume;
  const aResume = after.fullResume;

  // Check summary
  if (bResume.summary !== aResume.summary) {
    changes.push({ field: "summary", before: bResume.summary, after: aResume.summary });
  }

  // Check headline
  if (bResume.headline !== aResume.headline) {
    changes.push({ field: "headline", before: bResume.headline, after: aResume.headline });
  }

  // Check experience count
  if (bResume.experience.length !== aResume.experience.length) {
    changes.push({
      field: "experience",
      before: `${bResume.experience.length} entries`,
      after: `${aResume.experience.length} entries`,
    });
  }

  // Detect hallucinated companies (in after but not in before)
  const beforeCompanies = new Set(bResume.experience.map((e) => e.company.toLowerCase()));
  const beforeFingerprints = new Set(
    before.experienceFingerprints.map((f) => f.fingerprint)
  );
  for (const exp of aResume.experience) {
    if (!beforeCompanies.has(exp.company.toLowerCase())) {
      const fp = computeExperienceFingerprint(exp);
      if (!beforeFingerprints.has(fp)) {
        hallucinations.push(`Hallucinated employer: "${exp.company}" — "${exp.title}"`);
      }
    }
  }

  // Check education
  if (bResume.education.length !== aResume.education.length) {
    changes.push({
      field: "education",
      before: `${bResume.education.length} entries`,
      after: `${aResume.education.length} entries`,
    });
  }

  // Check languages
  if (bResume.languages.length !== aResume.languages.length) {
    changes.push({
      field: "languages",
      before: `${bResume.languages.length} entries`,
      after: `${aResume.languages.length} entries`,
    });
  }

  // Check changed institutions
  const beforeInstitutions = new Set(bResume.education.map((e) => e.institution.toLowerCase()));
  for (const ed of aResume.education) {
    if (ed.institution && !beforeInstitutions.has(ed.institution.toLowerCase())) {
      hallucinations.push(`Changed institution: "${ed.institution}" (not in original)`);
    }
  }

  const summary = changes.length === 0 && hallucinations.length === 0
    ? "No changes detected — optimized resume matches original structure."
    : `${changes.length} structural change(s), ${hallucinations.length} hallucination(s) detected.`;

  return { changes, hallucinations, summary };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/snapshot-engine.test.ts`
Expected: ALL PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/resume-snapshot-engine.ts src/lib/__tests__/snapshot-engine.test.ts
git commit -m "feat(snapshot): add Resume Snapshot Engine — create/restore/compare"
```

---

### Task 2: Agent Event Bus

**Files:**
- Create: `src/lib/agent-event-bus.ts`
- Create: `src/lib/__tests__/agent-event-bus.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/__tests__/agent-event-bus.test.ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createEventBus, type AgentEvent, type EventBus } from "../agent-event-bus";

describe("Agent Event Bus", () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = createEventBus();
  });

  it("emits an event and subscribers receive it", () => {
    const received: AgentEvent[] = [];
    bus.subscribe((e) => received.push(e));

    bus.emit({
      agent: "ExperienceAgent",
      action: "modifyBullet",
      resumeId: "r_123",
      success: true,
    });

    expect(received.length).toBe(1);
    expect(received[0].agent).toBe("ExperienceAgent");
    expect(received[0].action).toBe("modifyBullet");
    expect(received[0].timestamp).toBeTruthy();
  });

  it("auto-fills timestamp and defaults", () => {
    const received: AgentEvent[] = [];
    bus.subscribe((e) => received.push(e));

    bus.emit({ agent: "GuardianAgent", action: "validate", resumeId: "r_1" });

    expect(received[0].timestamp).toBeTruthy();
    expect(received[0].duration).toBe(0);
    expect(received[0].tokens).toBe(0);
  });

  it("supports unsubscribe", () => {
    const received: AgentEvent[] = [];
    const unsub = bus.subscribe((e) => received.push(e));

    bus.emit({ agent: "A", action: "x", resumeId: "r" });
    expect(received.length).toBe(1);

    unsub();
    bus.emit({ agent: "B", action: "y", resumeId: "r" });
    expect(received.length).toBe(1); // still 1 — unsubscribed
  });

  it("stores event history", () => {
    bus.emit({ agent: "A", action: "a1", resumeId: "r1" });
    bus.emit({ agent: "B", action: "a2", resumeId: "r2", tokens: 450, duration: 1200 });

    const history = bus.getHistory();
    expect(history.length).toBe(2);
    expect(history[0].agent).toBe("A");
    expect(history[1].agent).toBe("B");
    expect(history[1].tokens).toBe(450);
    expect(history[1].duration).toBe(1200);
  });

  it("limits history to 1000 entries", () => {
    for (let i = 0; i < 1100; i++) {
      bus.emit({ agent: "Test", action: `action_${i}`, resumeId: "r" });
    }
    expect(bus.getHistory().length).toBe(1000);
  });

  it("clearHistory empties the history", () => {
    bus.emit({ agent: "A", action: "x", resumeId: "r" });
    bus.clearHistory();
    expect(bus.getHistory().length).toBe(0);
  });

  it("getStats returns current stats", () => {
    bus.emit({ agent: "A", action: "x", resumeId: "r", success: true, tokens: 100, duration: 500 });
    bus.emit({ agent: "B", action: "y", resumeId: "r", success: false, tokens: 200, duration: 300 });

    const stats = bus.getStats();
    expect(stats.totalEvents).toBe(2);
    expect(stats.successfulEvents).toBe(1);
    expect(stats.failedEvents).toBe(1);
    expect(stats.totalTokens).toBe(300);
    expect(stats.totalDuration).toBe(800);
  });

  it("multiple buses are isolated", () => {
    const bus1 = createEventBus();
    const bus2 = createEventBus();

    const r1: AgentEvent[] = [];
    const r2: AgentEvent[] = [];
    bus1.subscribe((e) => r1.push(e));
    bus2.subscribe((e) => r2.push(e));

    bus1.emit({ agent: "One", action: "x", resumeId: "r" });
    expect(r1.length).toBe(1);
    expect(r2.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/agent-event-bus.test.ts`
Expected: ALL FAIL — `createEventBus is not a function`

- [ ] **Step 3: Write event bus implementation**

```typescript
// src/lib/agent-event-bus.ts

export interface AgentEvent {
  /** Agent name (e.g., "ExperienceAgent", "GuardianAgent") */
  agent: string;
  /** Action performed (e.g., "modifyBullet", "validate", "assemble") */
  action: string;
  /** Resume ID being operated on */
  resumeId: string;
  /** ISO 8601 timestamp — auto-filled if omitted */
  timestamp?: string;
  /** Duration in milliseconds */
  duration?: number;
  /** Tokens consumed */
  tokens?: number;
  /** Provider used */
  provider?: string;
  /** Whether the action succeeded */
  success?: boolean;
  /** Arbitrary metadata */
  metadata?: Record<string, unknown>;
}

export interface EventBusStats {
  totalEvents: number;
  successfulEvents: number;
  failedEvents: number;
  totalTokens: number;
  totalDuration: number;
}

export interface EventBus {
  emit: (event: Omit<AgentEvent, "timestamp"> & { timestamp?: string }) => void;
  subscribe: (handler: (event: AgentEvent) => void) => () => void;
  getHistory: () => AgentEvent[];
  clearHistory: () => void;
  getStats: () => EventBusStats;
}

const MAX_HISTORY = 1000;
type Subscriber = (event: AgentEvent) => void;

/**
 * Create a new event bus instance.
 * Each bus is isolated — events emitted on one do not reach subscribers of another.
 */
export function createEventBus(): EventBus {
  const subscribers = new Set<Subscriber>();
  const history: AgentEvent[] = [];

  const emit = (event: Omit<AgentEvent, "timestamp"> & { timestamp?: string }) => {
    const fullEvent: AgentEvent = {
      timestamp: new Date().toISOString(),
      duration: 0,
      tokens: 0,
      success: true,
      ...event,
    };

    // Add to history with cap
    history.push(fullEvent);
    if (history.length > MAX_HISTORY) {
      history.shift();
    }

    // Notify all subscribers
    for (const sub of subscribers) {
      try {
        sub(fullEvent);
      } catch (err) {
        console.warn("[EventBus] Subscriber error:", err);
      }
    }
  };

  const subscribe = (handler: Subscriber): (() => void) => {
    subscribers.add(handler);
    return () => { subscribers.delete(handler); };
  };

  const getHistory = (): AgentEvent[] => [...history];

  const clearHistory = (): void => {
    history.length = 0;
  };

  const getStats = (): EventBusStats => {
    let successfulEvents = 0;
    let failedEvents = 0;
    let totalTokens = 0;
    let totalDuration = 0;

    for (const ev of history) {
      if (ev.success) successfulEvents++;
      else failedEvents++;
      totalTokens += ev.tokens ?? 0;
      totalDuration += ev.duration ?? 0;
    }

    return {
      totalEvents: history.length,
      successfulEvents,
      failedEvents,
      totalTokens,
      totalDuration,
    };
  };

  return { emit, subscribe, getHistory, clearHistory, getStats };
}

/** Global singleton bus for the app. Use createEventBus() for isolated instances. */
export const globalEventBus = createEventBus();
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/agent-event-bus.test.ts`
Expected: ALL PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/agent-event-bus.ts src/lib/__tests__/agent-event-bus.test.ts
git commit -m "feat(events): add Agent Event Bus — pub/sub for agent lifecycle monitoring"
```

---

### Task 3: Parallel Pipeline Execution

**Files:**
- Create: `src/lib/parallel-pipeline.ts`
- Create: `src/lib/__tests__/parallel-pipeline.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/lib/__tests__/parallel-pipeline.test.ts
import { describe, it, expect } from "vitest";
import { runParallelOptimizer, type ParallelOptimizerInput, type ParallelOptimizerResult } from "../parallel-pipeline";
import type { ResumeData, JobDescription } from "../types";

const MOCK_RESUME: ResumeData = {
  id: "r_parallel_test",
  name: "Test User",
  headline: "Dev",
  contact: { email: "test@test.com", phone: "", location: "" },
  summary: "Old summary text that needs optimization.",
  experience: [
    {
      id: "exp_p1", title: "Engineer", company: "TestCo", location: "SF",
      startDate: "2020", endDate: "2024",
      bullets: ["Did stuff", "Built things"],
    },
  ],
  education: [
    { id: "ed_p1", institution: "State U", degree: "BS", startDate: "2016", endDate: "2020" },
  ],
  skills: [
    { id: "s_p1", name: "JavaScript", category: "Languages" },
    { id: "s_p2", name: "React", category: "Frontend" },
  ],
  languages: [{ name: "English", proficiency: "Fluent" }],
  certifications: [],
  projects: [],
  template: "ats-professional",
  accentColor: "#1154A3",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  source: "manual",
};

const MOCK_JD: JobDescription = {
  id: "jd_p1",
  title: "Senior Engineer",
  company: "BigCo",
  rawText: "Looking for a senior engineer with React and TypeScript experience.",
  responsibilities: ["Build features", "Lead team"],
  requiredSkills: ["React", "TypeScript", "Node.js"],
  preferredSkills: ["GraphQL"],
  keywords: ["React", "TypeScript", "Senior", "Lead"],
};

describe("Parallel Optimizer", () => {
  it("returns a result with summary optimized", async () => {
    const input: ParallelOptimizerInput = {
      resume: MOCK_RESUME,
      jd: MOCK_JD,
      directiveConfig: null,
    };
    const result: ParallelOptimizerResult = await runParallelOptimizer(input);

    expect(result.resume).toBeDefined();
    expect(result.resume.id).toBe("r_parallel_test");
    // Summary should differ from original (AI optimized)
    expect(result.resume.summary).not.toBe(MOCK_RESUME.summary);
    expect(result.resume.summary.length).toBeGreaterThan(30);
  });

  it("preserves all education entries from source", async () => {
    const input: ParallelOptimizerInput = {
      resume: MOCK_RESUME,
      jd: MOCK_JD,
      directiveConfig: null,
    };
    const result = await runParallelOptimizer(input);

    expect(result.resume.education.length).toBe(1);
    expect(result.resume.education[0].institution).toBe("State U");
    expect(result.resume.education[0].degree).toBe("BS");
  });

  it("preserves all languages from source", async () => {
    const input: ParallelOptimizerInput = {
      resume: MOCK_RESUME,
      jd: MOCK_JD,
      directiveConfig: null,
    };
    const result = await runParallelOptimizer(input);

    expect(result.resume.languages.length).toBe(1);
    expect(result.resume.languages[0].name).toBe("English");
    expect(result.resume.languages[0].proficiency).toBe("Fluent");
  });

  it("preserves experience company names and dates", async () => {
    const input: ParallelOptimizerInput = {
      resume: MOCK_RESUME,
      jd: MOCK_JD,
      directiveConfig: null,
    };
    const result = await runParallelOptimizer(input);

    expect(result.resume.experience.length).toBe(1);
    expect(result.resume.experience[0].company).toBe("TestCo");
    expect(result.resume.experience[0].title).toBe("Engineer");
    expect(result.resume.experience[0].startDate).toBe("2020");
    expect(result.resume.experience[0].endDate).toBe("2024");
  });

  it("returns provider name and char count", async () => {
    const input: ParallelOptimizerInput = {
      resume: MOCK_RESUME,
      jd: MOCK_JD,
      directiveConfig: null,
    };
    const result = await runParallelOptimizer(input);

    expect(result.provider).toBeTruthy();
    expect(typeof result.provider).toBe("string");
    expect(result.charCount).toBeGreaterThan(100);
    expect(result.keywordsAdded).toBeGreaterThanOrEqual(0);
  });

  it("does not modify contact info", async () => {
    const input: ParallelOptimizerInput = {
      resume: MOCK_RESUME,
      jd: MOCK_JD,
      directiveConfig: null,
    };
    const result = await runParallelOptimizer(input);

    expect(result.resume.contact.email).toBe("test@test.com");
    expect(result.resume.contact.phone).toBe("");
    expect(result.resume.name).toBe("Test User");
  });

  it("emits events for each agent on the event bus", async () => {
    const { globalEventBus } = await import("../agent-event-bus");
    globalEventBus.clearHistory();

    const input: ParallelOptimizerInput = {
      resume: MOCK_RESUME,
      jd: MOCK_JD,
      directiveConfig: null,
    };
    await runParallelOptimizer(input);

    const history = globalEventBus.getHistory();
    // Should have at least: summary agent emit, skills agent emit, experience agent emit, assembler emit
    const agents = [...new Set(history.map((h) => h.agent))];
    expect(agents).toContain("SummaryAgent");
    expect(agents).toContain("SkillsAgent");
    expect(agents).toContain("ExperienceAgent");
    expect(agents).toContain("ResumeAssembler");
  });

  it("returns warnings but no errors for valid input", async () => {
    const input: ParallelOptimizerInput = {
      resume: MOCK_RESUME,
      jd: MOCK_JD,
      directiveConfig: null,
    };
    const result = await runParallelOptimizer(input);

    expect(Array.isArray(result.warnings)).toBe(true);
    expect(Array.isArray(result.errors)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/__tests__/parallel-pipeline.test.ts`
Expected: ALL FAIL — `runParallelOptimizer is not a function`

- [ ] **Step 3: Write parallel pipeline implementation**

```typescript
// src/lib/parallel-pipeline.ts
import type { ResumeData, JobDescription, OptimizerDirectiveConfig } from "./types";
import { callAI, extractJSON, OPTIMIZER_CALL_TIMEOUT_MS } from "./ai";
import { assembleResume } from "./resume-assembler";
import { ensureExperienceIds } from "./entity-lock";
import { createSnapshot, compareSnapshots } from "./resume-snapshot-engine";
import { globalEventBus } from "./agent-event-bus";

export interface ParallelOptimizerInput {
  resume: ResumeData;
  jd: JobDescription;
  directiveConfig?: OptimizerDirectiveConfig | null;
  optimizationPolicy?: string | null;
}

export interface ParallelOptimizerResult {
  resume: ResumeData;
  provider: string;
  charCount: number;
  keywordsAdded: number;
  warnings: string[];
  errors: string[];
}

interface SummaryResult { summary: string; headline: string; }
interface SkillsResult { skills: { name: string; category: string }[]; }
interface ExperienceResult { experiences: { id: string; bullets: string[] }[]; }

/**
 * Run summary, skills, and experience optimizers in parallel.
 * Education, languages, contact, and certifications always come from source.
 */
export async function runParallelOptimizer(
  input: ParallelOptimizerInput,
): Promise<ParallelOptimizerResult> {
  const { resume, jd, directiveConfig, optimizationPolicy } = input;
  const warnings: string[] = [];
  const errors: string[] = [];
  const idReadyResume = ensureExperienceIds(resume);

  // Take snapshot before optimization
  const beforeSnapshot = createSnapshot(idReadyResume, "pre-optimization");
  globalEventBus.emit({
    agent: "SnapshotEngine",
    action: "snapshot_created",
    resumeId: resume.id,
    success: true,
    metadata: { snapshotId: beforeSnapshot.snapshotId },
  });

  // Build the shared context for all agents
  const jdKeywords = jd.keywords ?? [];
  const jdText = jd.rawText ?? JSON.stringify({
    title: jd.title,
    company: jd.company,
    responsibilities: jd.responsibilities,
    requiredSkills: jd.requiredSkills,
    keywords: jd.keywords,
  });

  const sourceContext = JSON.stringify({
    name: resume.name,
    summary: resume.summary,
    experience: resume.experience.map((e) => ({
      id: e.id, title: e.title, company: e.company,
      location: e.location, startDate: e.startDate, endDate: e.endDate,
      bullets: e.bullets,
    })),
  });

  // ========================================================================
  // Run Summary, Skills, and Experience agents IN PARALLEL
  // ========================================================================
  const startTime = Date.now();

  const [summaryResult, skillsResult, experienceResult] = await Promise.all([
    runSummaryAgent(sourceContext, jdText, jdKeywords, directiveConfig, optimizationPolicy),
    runSkillsAgent(sourceContext, resume.skills, jdText, jdKeywords, directiveConfig, optimizationPolicy),
    runExperienceAgent(sourceContext, resume.experience, jdText, jdKeywords, directiveConfig, optimizationPolicy),
  ]);

  const parallelDuration = Date.now() - startTime;
  warnings.push(`Parallel optimization completed in ${parallelDuration}ms`);

  // ========================================================================
  // Assemble final resume (education + languages from source)
  // ========================================================================
  globalEventBus.emit({
    agent: "ResumeAssembler",
    action: "assemble",
    resumeId: resume.id,
    duration: 0,
  });
  const assembleStart = Date.now();

  const optimizerOutput = {
    summary: summaryResult.summary,
    headline: summaryResult.headline,
    skills: skillsResult.skills,
    experiences: experienceResult.experiences,
  };

  const assembleResult = assembleResume(idReadyResume, optimizerOutput);
  warnings.push(...assembleResult.warnings);

  globalEventBus.emit({
    agent: "ResumeAssembler",
    action: "assemble_complete",
    resumeId: resume.id,
    duration: Date.now() - assembleStart,
    success: true,
  });

  // ========================================================================
  // Compare snapshots for diff
  // ========================================================================
  const afterSnapshot = createSnapshot(assembleResult.resume, "post-optimization");
  const diff = compareSnapshots(beforeSnapshot, afterSnapshot);
  warnings.push(`Snapshot diff: ${diff.summary}`);
  if (diff.hallucinations.length > 0) {
    errors.push(...diff.hallucinations);
  }

  // ========================================================================
  // Compute metrics
  // ========================================================================
  const charCount = JSON.stringify({
    summary: assembleResult.resume.summary,
    experience: assembleResult.resume.experience,
    skills: assembleResult.resume.skills,
    education: assembleResult.resume.education,
    languages: assembleResult.resume.languages,
  }).length;

  const keywordsAdded = jdKeywords.filter((k) =>
    assembleResult.resume.summary.toLowerCase().includes(k.toLowerCase())
  ).length;

  return {
    resume: assembleResult.resume,
    provider: summaryResult.provider,
    charCount,
    keywordsAdded,
    warnings,
    errors,
  };
}

// ============================================================================
// Individual agent runners
// ============================================================================

async function runSummaryAgent(
  sourceContext: string,
  jdText: string,
  jdKeywords: string[],
  directiveConfig?: OptimizerDirectiveConfig | null,
  optimizationPolicy?: string | null,
): Promise<{ summary: string; headline: string; provider: string }> {
  const startTime = Date.now();
  const systemPrompt = `You are a professional resume summary writer. Optimize the summary to be ATS-friendly.
${optimizationPolicy ? `POLICY: ${optimizationPolicy}` : ""}
RULES:
- Write 60-90 words
- Use action-oriented language
- Embed target keywords naturally: ${jdKeywords.join(", ")}
- NEVER invent experience, certifications, or metrics
- NEVER use parentheses
Return ONLY JSON: {"summary": "...", "headline": "..."}`;

  const userPrompt = `SOURCE RESUME:\n${sourceContext}\n\nTARGET JOB:\n${jdText}\n\nReturn ONLY valid JSON.`;

  const result = await callAI({
    systemPrompt,
    userPrompt,
    maxTokens: 2000,
    temperature: 0.2,
    taskCategory: "document",
    timeoutMs: OPTIMIZER_CALL_TIMEOUT_MS,
    isOptimizerCall: true,
  });

  const parsed = extractJSON<{ summary?: string; headline?: string }>(result.text);
  const summaryOut = parsed?.summary || "Summary optimization failed — using original.";
  const headlineOut = parsed?.headline || "";

  globalEventBus.emit({
    agent: "SummaryAgent",
    action: "optimize_summary",
    resumeId: "",
    duration: Date.now() - startTime,
    tokens: result.tokensEstimate ?? 0,
    provider: result.provider,
    success: !!parsed,
  });

  return { summary: summaryOut, headline: headlineOut, provider: result.provider };
}

async function runSkillsAgent(
  sourceContext: string,
  existingSkills: { name: string; category: string }[],
  jdText: string,
  jdKeywords: string[],
  directiveConfig?: OptimizerDirectiveConfig | null,
  optimizationPolicy?: string | null,
): Promise<{ skills: { name: string; category: string }[]; provider: string }> {
  const startTime = Date.now();
  const systemPrompt = `You are a skills optimizer. Reorder and enhance skills for ATS compatibility.
${optimizationPolicy ? `POLICY: ${optimizationPolicy}` : ""}
RULES:
- Keep ALL existing skills
- Reorder: JD-relevant skills FIRST
- Group by category (Languages, Frontend, Backend, Tools, etc.)
- Only add skills that are genuinely present in the experience
- NEVER add skills the candidate doesn't have
- Target keywords: ${jdKeywords.join(", ")}
Return ONLY JSON: {"skills": [{"name": "...", "category": "..."}]}`;

  const existingSkillsJson = JSON.stringify(existingSkills);
  const userPrompt = `SOURCE RESUME:\n${sourceContext}\nEXISTING SKILLS:\n${existingSkillsJson}\n\nTARGET JOB:\n${jdText}\n\nReturn ONLY valid JSON.`;

  const result = await callAI({
    systemPrompt,
    userPrompt,
    maxTokens: 1500,
    temperature: 0.15,
    taskCategory: "document",
    timeoutMs: OPTIMIZER_CALL_TIMEOUT_MS,
    isOptimizerCall: true,
  });

  const parsed = extractJSON<{ skills?: { name: string; category: string }[] }>(result.text);
  const skills = parsed?.skills || existingSkills.map((s) => ({ name: s.name, category: s.category || "General" }));

  globalEventBus.emit({
    agent: "SkillsAgent",
    action: "optimize_skills",
    resumeId: "",
    duration: Date.now() - startTime,
    tokens: result.tokensEstimate ?? 0,
    provider: result.provider,
    success: !!parsed,
  });

  return { skills, provider: result.provider };
}

async function runExperienceAgent(
  sourceContext: string,
  experiences: { id: string; title: string; company: string; bullets: string[] }[],
  jdText: string,
  jdKeywords: string[],
  directiveConfig?: OptimizerDirectiveConfig | null,
  optimizationPolicy?: string | null,
): Promise<{ experiences: { id: string; bullets: string[] }[]; provider: string }> {
  const startTime = Date.now();
  const systemPrompt = `You are a resume bullet optimizer. Rewrite only the bullet points — NEVER change companies, dates, or roles.
${optimizationPolicy ? `POLICY: ${optimizationPolicy}` : ""}
RULES:
- Rewrite each bullet to be more impactful
- Use strong action verbs: Spearheaded, Orchestrated, Streamlined, Delivered
- Embed keywords naturally: ${jdKeywords.join(", ")}
- NEVER add metrics, percentages, or dollar amounts that aren't in the original
- NEVER change the bullet count (same number of bullets per experience)
- NEVER invent new experience entries
- Return the SAME experience IDs as provided
Return ONLY JSON: {"experiences": [{"id": "exp_1", "bullets": ["...", "..."]}]}`;

  const expJson = JSON.stringify(experiences.map((e) => ({ id: e.id, title: e.title, company: e.company, bullets: e.bullets })));
  const userPrompt = `SOURCE EXPERIENCES:\n${expJson}\n\nTARGET JOB:\n${jdText}\n\nSOURCE RESUME:\n${sourceContext}\n\nReturn ONLY valid JSON.`;

  const result = await callAI({
    systemPrompt,
    userPrompt,
    maxTokens: 4000,
    temperature: 0.15,
    taskCategory: "document",
    timeoutMs: OPTIMIZER_CALL_TIMEOUT_MS,
    isOptimizerCall: true,
  });

  const parsed = extractJSON<{ experiences?: { id: string; bullets: string[] }[] }>(result.text);
  const expOut = parsed?.experiences?.map((e) => ({
    id: e.id,
    bullets: e.bullets || [],
  })) || experiences.map((e) => ({ id: e.id, bullets: e.bullets }));

  globalEventBus.emit({
    agent: "ExperienceAgent",
    action: "optimize_bullets",
    resumeId: "",
    duration: Date.now() - startTime,
    tokens: result.tokensEstimate ?? 0,
    provider: result.provider,
    success: !!parsed,
  });

  return { experiences: expOut, provider: result.provider };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/__tests__/parallel-pipeline.test.ts`
Expected: ALL PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/parallel-pipeline.ts src/lib/__tests__/parallel-pipeline.test.ts
git commit -m "feat(pipeline): add Parallel Pipeline Execution — concurrent summary/skills/experience agents"
```

---

### Task 4: Integrate Snapshot Engine + Event Bus into Locked Pipeline

**Files:**
- Modify: `src/lib/locked-pipeline.ts`

- [ ] **Step 1: Add snapshot capture at start and end of locked pipeline**

In `src/lib/locked-pipeline.ts`, add after the imports (around line 35):

```typescript
import { createSnapshot, compareSnapshots } from "./resume-snapshot-engine";
import { globalEventBus } from "./agent-event-bus";
```

Then in `runLockedPipeline`, after Step 1 (line 98, after `idReadyResume` is created):

```typescript
  // ========================================================================
  // Step 1c: Create pre-optimization snapshot (for rollback + diff)
  // ========================================================================
  const beforeSnapshot = createSnapshot(idReadyResume, "pre-optimization");
  globalEventBus.emit({
    agent: "LockedPipeline",
    action: "snapshot_created",
    resumeId: sourceResume.id,
    success: true,
    metadata: { snapshotId: beforeSnapshot.snapshotId },
  });
```

And after assembly (around line 173, after `assembleResult`):

```typescript
      // Emit assembler event
      globalEventBus.emit({
        agent: "ResumeAssembler",
        action: "assemble_complete",
        resumeId: sourceResume.id,
        duration: 0,
        success: true,
        metadata: { matchedById: assembleResult.matchedById, unmatched: assembleResult.unmatched },
      });
```

And in the return block (around line 359), add snapshot comparison:

```typescript
      // Create post-optimization snapshot and diff
      const afterSnapshot = createSnapshot(assembleResult.resume, "post-optimization");
      const snapshotDiff = compareSnapshots(beforeSnapshot, afterSnapshot);
      if (snapshotDiff.hallucinations.length > 0) {
        errors.push(...snapshotDiff.hallucinations);
        globalEventBus.emit({
          agent: "SnapshotEngine",
          action: "hallucinations_detected",
          resumeId: sourceResume.id,
          success: false,
          metadata: { count: snapshotDiff.hallucinations.length, details: snapshotDiff.hallucinations },
        });
      }
      warnings.push(`Snapshot diff: ${snapshotDiff.summary}`);
```

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: ALL 498+ tests pass, plus new snapshot + event bus + parallel pipeline tests

- [ ] **Step 3: Commit**

```bash
git add src/lib/locked-pipeline.ts
git commit -m "feat(pipeline): integrate Snapshot Engine + Event Bus into locked pipeline"
```

---

### Task 5: Add Snapshot Store Persistence

**Files:**
- Modify: `src/lib/store.ts`

- [ ] **Step 1: Add snapshots to store state and actions**

In `src/lib/store.ts`:

Add import at top:
```typescript
import type { ResumeSnapshot } from "./resume-snapshot-engine";
```

Add to state type (around line 103, after `aiDevSettings`):
```typescript
  snapshots: ResumeSnapshot[];
```

Add to actions type (around line 231):
```typescript
  addSnapshot: (snapshot: ResumeSnapshot) => void;
  restoreSnapshot: (snapshotId: string) => ResumeData | null;
  clearSnapshots: (resumeId?: string) => void;
```

Add seed value (around line 442):
```typescript
      snapshots: [],
```

Add action implementations (around line 1330):
```typescript
      addSnapshot: (snapshot) => {
        set((s) => ({ snapshots: [...s.snapshots, snapshot] }));
        // Persist to localStorage
        try {
          const existing = JSON.parse(localStorage.getItem("resumeai-snapshots") || "[]");
          existing.push(snapshot);
          // Keep only last 50 snapshots
          if (existing.length > 50) existing.splice(0, existing.length - 50);
          localStorage.setItem("resumeai-snapshots", JSON.stringify(existing));
        } catch {}
      },
      restoreSnapshot: (snapshotId) => {
        const snapshot = get().snapshots.find((s) => s.snapshotId === snapshotId);
        if (!snapshot) return null;
        return JSON.parse(JSON.stringify(snapshot.fullResume));
      },
      clearSnapshots: (resumeId) => {
        set((s) => ({
          snapshots: resumeId
            ? s.snapshots.filter((sn) => sn.resumeId !== resumeId)
            : [],
        }));
        try {
          if (resumeId) {
            const existing = JSON.parse(localStorage.getItem("resumeai-snapshots") || "[]");
            localStorage.setItem("resumeai-snapshots",
              JSON.stringify(existing.filter((s: ResumeSnapshot) => s.resumeId !== resumeId)));
          } else {
            localStorage.removeItem("resumeai-snapshots");
          }
        } catch {}
      },
```

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: ALL tests pass (no regressions)

- [ ] **Step 3: Commit**

```bash
git add src/lib/store.ts
git commit -m "feat(store): add snapshot persistence — addSnapshot/restoreSnapshot/clearSnapshots"
```

---

### Task 6: Final Integration — Wire Parallel Pipeline into Orchestrator

**Files:**
- Modify: `src/lib/agents/orchestrator.ts`

- [ ] **Step 1: Add parallel pipeline as an option in the orchestrator**

In `src/lib/agents/orchestrator.ts`, add import:

```typescript
import { runParallelOptimizer } from "../parallel-pipeline";
```

Then in the optimizer try block (around line 895-920), add a parallel path option:

```typescript
          // Check if parallel pipeline is enabled
          const useParallel = process.env.NEXT_PUBLIC_USE_PARALLEL_PIPELINE === "true";

          if (useParallel) {
            log("Resume Optimizer", "Using parallel optimization pipeline (summary + skills + experience in parallel).");
            const parallelResult = await runParallelOptimizer({
              resume,
              jd,
              directiveConfig,
              optimizationPolicy,
            });
            optimizeResult = {
              resume: parallelResult.resume,
              provider: parallelResult.provider,
              charCount: parallelResult.charCount,
              keywordsAdded: parallelResult.keywordsAdded,
            };
            for (const w of parallelResult.warnings) {
              console.warn(`[Parallel Pipeline] ${w}`);
            }
            log("Resume Optimizer",
              `✓ Parallel pipeline complete: ${parallelResult.charCount} chars, ` +
              `provider: ${parallelResult.provider}, keywords: ${parallelResult.keywordsAdded}`
            );
          } else {
            // ... existing locked pipeline code ...
          }
```

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: ALL tests pass

- [ ] **Step 3: Commit**

```bash
git add src/lib/agents/orchestrator.ts
git commit -m "feat(orchestrator): wire parallel pipeline as opt-in (NEXT_PUBLIC_USE_PARALLEL_PIPELINE)"
```

---

## Self-Review Checklist

**1. Spec coverage:**
- [x] Resume Snapshot Engine — Task 1 (engine) + Task 5 (store persistence)
- [x] Agent Event Bus — Task 2 (bus)
- [x] Parallel Pipeline Execution — Task 3 (pipeline) + Task 6 (orchestrator wiring)
- [x] Integration into existing pipeline — Task 4 (locked pipeline)

**2. Placeholder scan:** No TBD, TODO, or "implement later" found.

**3. Type consistency:**
- `ResumeSnapshot` type used in Task 1, Task 4, Task 5 — consistent
- `AgentEvent` type used in Task 2, Task 4 — consistent
- `ParallelOptimizerInput/Result` used in Task 3, Task 6 — consistent
- `globalEventBus` singleton exported in Task 2, used in Task 3, Task 4 — consistent
- `createSnapshot`/`compareSnapshots` created in Task 1, used in Task 3, Task 4 — consistent
