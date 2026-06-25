// ============================================================================
// Agent Timeout Policy
//
// Per-agent timeout configuration with automatic retry → switch model →
// switch provider → fallback chain.
//
// Memory: 15s | Parser: 20s | Research: 60s | Job Intelligence: 60s
// Optimizer: 60s | Interview: 45s | Cover Letter: 45s | QA: 30s | Reflection: 30s
// ============================================================================

"use client";

export interface AgentTimeoutConfig {
  agentName: string;
  timeoutMs: number;
  maxRetries: number;
  retryDelayMs: number;
}

export const AGENT_TIMEOUTS: Record<string, AgentTimeoutConfig> = {
  "memory": { agentName: "Memory", timeoutMs: 15_000, maxRetries: 1, retryDelayMs: 1000 },
  "resume-parser": { agentName: "Resume Parser", timeoutMs: 20_000, maxRetries: 1, retryDelayMs: 1000 },
  "job-parser": { agentName: "Job Parser", timeoutMs: 20_000, maxRetries: 1, retryDelayMs: 1000 },
  "research": { agentName: "Research", timeoutMs: 60_000, maxRetries: 1, retryDelayMs: 2000 },
  "job-intelligence": { agentName: "Job Intelligence", timeoutMs: 60_000, maxRetries: 2, retryDelayMs: 2000 },
  "company-intelligence": { agentName: "Company Intelligence", timeoutMs: 60_000, maxRetries: 2, retryDelayMs: 2000 },
  "skill-gap": { agentName: "Skill Gap", timeoutMs: 60_000, maxRetries: 2, retryDelayMs: 2000 },
  "ats-analysis": { agentName: "ATS Analysis", timeoutMs: 30_000, maxRetries: 1, retryDelayMs: 1000 },
  "optimizer": { agentName: "Resume Optimizer", timeoutMs: 120_000, maxRetries: 2, retryDelayMs: 5000 },
  "qa": { agentName: "Quality Assurance", timeoutMs: 30_000, maxRetries: 1, retryDelayMs: 1000 },
  "reflection": { agentName: "Reflection", timeoutMs: 30_000, maxRetries: 1, retryDelayMs: 1000 },
  "interview": { agentName: "Interview Prep", timeoutMs: 45_000, maxRetries: 2, retryDelayMs: 2000 },
  "cover-letter": { agentName: "Cover Letter", timeoutMs: 45_000, maxRetries: 2, retryDelayMs: 2000 },
  "career-coach": { agentName: "Career Coach", timeoutMs: 45_000, maxRetries: 2, retryDelayMs: 2000 },
};

/**
 * Get the timeout config for an agent.
 * Returns default config if agent not found.
 */
export function getAgentTimeout(agentId: string): AgentTimeoutConfig {
  return AGENT_TIMEOUTS[agentId] || {
    agentName: agentId,
    timeoutMs: 60_000,
    maxRetries: 1,
    retryDelayMs: 2000,
  };
}

/**
 * Execute an async function with a timeout.
 * If the timeout is reached, throws an Error with the agent name.
 */
export async function withAgentTimeout<T>(
  agentId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const config = getAgentTimeout(agentId);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const result = await Promise.race([
      fn(),
      new Promise<never>((_, reject) => {
        controller.signal.addEventListener("abort", () => {
          reject(new Error(`${config.agentName} timed out after ${config.timeoutMs / 1000}s`));
        });
      }),
    ]);
    clearTimeout(timer);
    return result;
  } catch (e: any) {
    clearTimeout(timer);
    throw e;
  }
}

/**
 * Execute an async function with timeout + retry.
 * On timeout: retry → switch model → switch provider → fallback.
 *
 * Returns the result, or throws if all retries exhausted.
 */
export async function withAgentTimeoutAndRetry<T>(
  agentId: string,
  fn: (attempt: number) => Promise<T>,
): Promise<T> {
  const config = getAgentTimeout(agentId);
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      return await withAgentTimeout(agentId, () => fn(attempt));
    } catch (e: any) {
      lastError = e;
      const isTimeout = /timed out/i.test(e?.message || "");

      if (attempt < config.maxRetries) {
        const delay = isTimeout ? config.retryDelayMs * (attempt + 1) : config.retryDelayMs;
        console.warn(
          `[Agent Timeout] ${config.agentName} attempt ${attempt + 1} failed: ${e?.message}. ` +
          `Retrying in ${delay}ms...`
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  throw lastError ?? new Error(`${config.agentName} failed after ${config.maxRetries + 1} attempts`);
}
