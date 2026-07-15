// ============================================================================
// Shared Context Builder — Phase 8.1.3.2A
//
// ONE reusable context-assembly abstraction for the Enterprise AI Core.
//
// MANDATE:
//   - Assembles context sections into a deterministic, ordered payload plus a
//     stable hash. It does NOT execute AI and contains NO business logic.
//   - It is additive and opt-in: features that assemble context inline keep
//     working unchanged. Features may migrate to this builder incrementally.
//   - Entity references (resumeId, jdId, sessionId, …) are captured as
//     metadata for the Flight Recorder; large payloads are included in the
//     rendered context string only when the caller explicitly adds them.
//
// The builder returns:
//   - `text`      — the concatenated context string a feature can drop into a prompt
//   - `hash`      — stable FNV-1a hash of the ordered sections (for replay/dedup)
//   - `metadata`  — entity refs + sizes for the Flight Recorder / diagnostics
// ============================================================================

import { hashString } from "./flight-recorder";
import type { FlightScope } from "./flight-recorder";

// ----------------------------------------------------------------------------
// Supported context section kinds (Phase 8.1.3.2A). One shared enum; features
// reuse these instead of inventing their own labels.
// ----------------------------------------------------------------------------

export type ContextSectionKind =
  | "resume"
  | "job-description"
  | "company-intelligence"
  | "ats-analysis"
  | "resume-intelligence"
  | "interview-memory"
  | "adaptive-interview-state"
  | "persona"
  | "scenario"
  | "flight-metadata"
  | "execution-metadata"
  | "user-preferences"
  | "execution-configuration"
  | "conversation"
  | "feature"
  | "future-mcp"
  | "future-hermes";

export interface ContextSection {
  kind: ContextSectionKind;
  /** Optional short heading rendered above the content, e.g. "TARGET JOB". */
  heading?: string;
  /** The rendered content. Objects are JSON-stringified deterministically. */
  content: string;
}

/** Entity references captured for the Flight Recorder (never payloads). */
export interface ContextRefs {
  resumeId?: string;
  resumeVersion?: string;
  jdId?: string;
  company?: string;
  interviewSessionId?: string;
  scenarioId?: string;
  personaId?: string;
  userId?: string;
}

export interface ContextBuilderOptions {
  scope?: FlightScope;
  feature?: string;
  refs?: ContextRefs;
}

export interface BuiltContext {
  text: string;
  hash: string;
  size: number;
  assemblyMs: number;
  sections: Array<{ kind: ContextSectionKind; size: number }>;
  refs: ContextRefs;
  scope?: FlightScope;
  feature?: string;
  source: "ContextBuilder";
}

// ----------------------------------------------------------------------------
// Builder
// ----------------------------------------------------------------------------

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export class ContextBuilder {
  private sections: ContextSection[] = [];
  private opts: ContextBuilderOptions;

  constructor(opts: ContextBuilderOptions = {}) {
    this.opts = opts;
  }

  /** Add a context section. `content` may be a string or any serializable value. */
  add(kind: ContextSectionKind, content: unknown, heading?: string): this {
    this.sections.push({ kind, heading, content: stringify(content) });
    return this;
  }

  // Typed convenience adders (all optional, all thin wrappers over add()).
  resume(v: unknown, heading = "RESUME"): this { return this.add("resume", v, heading); }
  jobDescription(v: unknown, heading = "JOB DESCRIPTION"): this { return this.add("job-description", v, heading); }
  companyIntelligence(v: unknown, heading = "COMPANY INTELLIGENCE"): this { return this.add("company-intelligence", v, heading); }
  atsAnalysis(v: unknown, heading = "ATS ANALYSIS"): this { return this.add("ats-analysis", v, heading); }
  resumeIntelligence(v: unknown, heading = "RESUME INTELLIGENCE"): this { return this.add("resume-intelligence", v, heading); }
  interviewMemory(v: unknown, heading = "INTERVIEW MEMORY"): this { return this.add("interview-memory", v, heading); }
  adaptiveState(v: unknown, heading = "ADAPTIVE STATE"): this { return this.add("adaptive-interview-state", v, heading); }
  persona(v: unknown, heading = "PERSONA"): this { return this.add("persona", v, heading); }
  scenario(v: unknown, heading = "SCENARIO"): this { return this.add("scenario", v, heading); }
  userPreferences(v: unknown, heading = "USER PREFERENCES"): this { return this.add("user-preferences", v, heading); }
  executionConfiguration(v: unknown, heading = "EXECUTION CONFIG"): this { return this.add("execution-configuration", v, heading); }
  conversation(v: unknown, heading = "CONVERSATION"): this { return this.add("conversation", v, heading); }
  feature(v: unknown, heading = "FEATURE CONTEXT"): this { return this.add("feature", v, heading); }
  mcp(v: unknown, heading = "MCP CONTEXT"): this { return this.add("future-mcp", v, heading); }
  hermes(v: unknown, heading = "HERMES CONTEXT"): this { return this.add("future-hermes", v, heading); }

  /** Merge sections from another ContextBuilder. */
  compose(other: ContextBuilder): this {
    this.sections.push(...other.sections);
    return this;
  }

  build(): BuiltContext {
    const t0 = performance.now();
    const rendered = this.sections
      .map((s) => (s.heading ? `${s.heading}:\n${s.content}` : s.content))
      .join("\n\n");
    const t1 = performance.now();

    return {
      text: rendered,
      hash: hashString(
        JSON.stringify({
          sections: this.sections.map((s) => [s.kind, s.content]),
          refs: this.opts.refs ?? {},
        }),
      ),
      size: rendered.length,
      assemblyMs: t1 - t0,
      sections: this.sections.map((s) => ({ kind: s.kind, size: s.content.length })),
      refs: this.opts.refs ?? {},
      scope: this.opts.scope,
      feature: this.opts.feature,
      source: "ContextBuilder",
    };
  }
}

/** Serialize a BuiltContext for diagnostics (no payloads, only shape). */
export function serializeContext(ctx: BuiltContext): string {
  return JSON.stringify({
    hash: ctx.hash,
    size: ctx.size,
    scope: ctx.scope,
    feature: ctx.feature,
    refs: ctx.refs,
    sections: ctx.sections,
  });
}
