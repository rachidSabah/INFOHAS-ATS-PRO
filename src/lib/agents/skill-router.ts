// Agent Skill Router — lightweight task classifier that routes AI tasks
// to the appropriate model tier based on complexity and required skill.
//
//   const task = AgentSkillRouter.classify("optimizer", prompt);
//   const route = AgentSkillRouter.getRoute(task);
//   const res = await ProviderRouter.chat({ messages, model: route.modelName });
//
// No Zustand dependency — takes providers as parameters or uses defaults.

import type { AIProvider } from "../types";
import { ProviderRouter } from "../ai/services/router";

// ============================================================================
// TYPES
// ============================================================================

export type TaskComplexity = "simple" | "moderate" | "complex";

export type AgentSkill =
  | "formatting"
  | "analysis"
  | "optimization"
  | "generation"
  | "qa"
  | "reflection";

export interface AgentTask {
  agentName: string;
  complexity: TaskComplexity;
  skill: AgentSkill;
  estimatedTokens?: number;
  preferredModel?: string;
  preferredProviderId?: string;
}

export interface SkillRoute {
  complexity: TaskComplexity;
  skill: AgentSkill;
  providerId?: string;
  modelName?: string;
  preferredProviderId?: string;
  cacheable: boolean;
}

// ============================================================================
// TASK CACHE — simple in-memory cache with 5-minute TTL
// ============================================================================

const CACHE_TTL_MS = 5 * 60 * 1000;

class _TaskCache {
  private store = new Map<string, { result: string; createdAt: number }>();

  has(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (Date.now() - entry.createdAt > CACHE_TTL_MS) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  get(key: string): string | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() - entry.createdAt > CACHE_TTL_MS) {
      this.store.delete(key);
      return null;
    }
    return entry.result;
  }

  set(key: string, result: string): void {
    this.store.set(key, { result, createdAt: Date.now() });
  }

  /** Remove expired entries (optional maintenance) */
  prune(): void {
    const now = Date.now();
    this.store.forEach((entry, key) => {
      if (now - entry.createdAt > CACHE_TTL_MS) this.store.delete(key);
    });
  }
}

export const TaskCache = new _TaskCache();

// ============================================================================
// AGENT SKILL ROUTER
// ============================================================================

export class AgentSkillRouter {
  /** Per-agent provider overrides: agentName → { providerId, modelName? } */
  private static overrides = new Map<
    string,
    { providerId: string; modelName?: string }
  >();

  // —— Default routes keyed by complexity+skill ——

  private static readonly DEFAULT_ROUTES: Record<
    string,
    Omit<SkillRoute, "complexity" | "skill">
  > = {
    "simple_formatting": {
      modelName: "gpt-4o-mini",
      cacheable: true,
    },
    "simple_analysis": {
      modelName: "gpt-4o-mini",
      cacheable: true,
    },
    "simple_generation": {
      modelName: "gpt-4o-mini",
      cacheable: true,
    },
    "moderate_analysis": {
      cacheable: false,
    },
    "moderate_generation": {
      cacheable: false,
    },
    "moderate_qa": {
      cacheable: true,
    },
    "moderate_formatting": {
      modelName: "gpt-4o-mini",
      cacheable: true,
    },
    "complex_optimization": {
      cacheable: false,
    },
    "complex_generation": {
      cacheable: false,
    },
    "complex_reflection": {
      cacheable: false,
    },
    "moderate_reflection": {
      cacheable: false,
    },
  };

  /**
   * Classify an AI task by agent name and prompt content.
   * Returns an AgentTask with detected complexity and skill.
   */
  static classify(
    agentName: string,
    prompt: string,
    estimatedTokens?: number,
  ): AgentTask {
    const complexity = this.detectComplexity(agentName, prompt);
    const skill = this.detectSkill(agentName, prompt);
    const override = this.overrides.get(agentName);

    return {
      agentName,
      complexity,
      skill,
      estimatedTokens,
      preferredModel: override?.modelName,
      preferredProviderId: override?.providerId,
    };
  }

  /**
   * Resolve the best provider+model route for a given task.
   * Checks overrides first, then falls back to default routing.
   */
  static getRoute(task: AgentTask): SkillRoute {
    // If the agent has a manual override, use it
    if (task.preferredProviderId) {
      return {
        complexity: task.complexity,
        skill: task.skill,
        providerId: task.preferredProviderId,
        modelName: task.preferredModel,
        preferredProviderId: task.preferredProviderId,
        cacheable: task.skill === "formatting" || task.skill === "qa",
      };
    }

    const key = `${task.complexity}_${task.skill}`;
    const defaults = this.DEFAULT_ROUTES[key];

    if (!defaults) {
      // Fallback for unknown combos — moderate tier, uncacheable
      return {
        complexity: task.complexity,
        skill: task.skill,
        cacheable: false,
      };
    }

    return {
      complexity: task.complexity,
      skill: task.skill,
      ...defaults,
    };
  }

  /**
   * Set a permanent provider/model override for a specific agent.
   * When set, getRoute will always return this provider+model for that agent.
   */
  static setProviderOverride(
    agentName: string,
    providerId: string,
    modelName?: string,
  ): void {
    this.overrides.set(agentName, { providerId, modelName });
  }

  /** Remove a provider override for an agent. */
  static clearProviderOverride(agentName: string): void {
    this.overrides.delete(agentName);
  }

  /** Get all current provider overrides. */
  static getProviderOverrides(): Map<
    string,
    { providerId: string; modelName?: string }
  > {
    return new Map(this.overrides);
  }

  // ========================================================================
  // PRIVATE HELPERS
  // ========================================================================

  /**
   * Detect task complexity from agent name and prompt content.
   *
   * Simple: formatting, grammar, spell-check, basic ATS scoring
   * Moderate: skill gap, company intelligence, QA, analysis
   * Complex: optimization, restructuring, reflection
   */
  private static detectComplexity(
    agentName: string,
    prompt: string,
  ): TaskComplexity {
    const name = agentName.toLowerCase();
    const lower = prompt.toLowerCase();

    // —— Simple keywords (cheap/free models) ——

    const simplePatterns = [
      /formatt(?:er|ing)/,
      /grammar/,
      /spell[-\s]?check/,
      /basic\s+ats/,
      /score\s+ats/,
      /ats\s+score/,
      /simple\s+rewrite/,
    ];
    for (const p of simplePatterns) {
      if (p.test(name) || p.test(lower)) return "simple";
    }

    // —— Complex keywords (best available model) ——

    const complexPatterns = [
      /optimiz(?:er|ation|e)/,
      /restructur(?:e|ing|er)/,
      /reflect(?:ion|or)?/,
      /overhaul/,
      /complete\s+rewrite/,
      /full\s+optimization/,
    ];
    for (const p of complexPatterns) {
      if (p.test(name) || p.test(lower)) return "complex";
    }

    // —— Everything else defaults to moderate ——

    return "moderate";
  }

  /**
   * Detect required skill from agent name.
   */
  private static detectSkill(agentName: string, prompt: string): AgentSkill {
    const name = agentName.toLowerCase();
    const lower = prompt.toLowerCase();

    if (
      /formatt(?:er|ing)/.test(name) ||
      /grammar/.test(name) ||
      /spell/.test(name)
    ) {
      return "formatting";
    }

    if (
      /optimiz(?:er|ation|e)/.test(name) ||
      /rewrite/.test(name) ||
      /resume[-_]?improve/.test(name) ||
      /bullet[-_]?improve/.test(name)
    ) {
      return "optimization";
    }

    if (/qa/.test(name) || /quality/.test(name)) {
      return "qa";
    }

    if (
      /reflect(?:ion|or)?/.test(name) ||
      /critique/.test(name) ||
      /review/.test(name)
    ) {
      return "reflection";
    }

    if (
      /analyz?(?:er|e|is)/.test(name) ||
      /intelligen(?:ce|t)/.test(name) ||
      /skill[-_]?gap/.test(name) ||
      /company/.test(name) ||
      /ats/.test(name)
    ) {
      return "analysis";
    }

    // Check prompt for generation signals
    if (
      /generate|create|write\s+(a|an|new)|draft|compose/.test(lower)
    ) {
      return "generation";
    }

    // Default — analysis covers most agents
    return "analysis";
  }
}
