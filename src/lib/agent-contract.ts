// ============================================================================
// Agent Contract — Standard response shape for all 22 agents
//
// Every agent must return AgentResult<T> with:
//   success: boolean
//   confidence: number (0-100)
//   retries: number
//   warnings: string[]
//   errors: string[]
//   metrics: Record<string, number>
//   output: T
//
// This ensures consistent error handling, retry logic, and observability
// across the entire pipeline.
// ============================================================================

"use client";

export interface AgentResult<T = any> {
  success: boolean;
  confidence: number; // 0-100
  retries: number;
  warnings: string[];
  errors: string[];
  metrics: Record<string, number>;
  output: T;
}

/**
 * Create a successful agent result.
 */
export function successResult<T>(output: T, opts?: {
  confidence?: number;
  warnings?: string[];
  metrics?: Record<string, number>;
  retries?: number;
}): AgentResult<T> {
  return {
    success: true,
    confidence: opts?.confidence ?? 100,
    retries: opts?.retries ?? 0,
    warnings: opts?.warnings ?? [],
    errors: [],
    metrics: opts?.metrics ?? {},
    output,
  };
}

/**
 * Create a failed agent result.
 */
export function failureResult<T>(errors: string[], opts?: {
  output?: T;
  confidence?: number;
  warnings?: string[];
  metrics?: Record<string, number>;
  retries?: number;
}): AgentResult<T> {
  return {
    success: false,
    confidence: opts?.confidence ?? 0,
    retries: opts?.retries ?? 0,
    warnings: opts?.warnings ?? [],
    errors,
    metrics: opts?.metrics ?? {},
    output: (opts?.output ?? null) as T,
  };
}

/**
 * Validate that an agent result has the required shape.
 * Throws if the contract is violated.
 */
export function validateAgentResult<T>(result: any): AgentResult<T> {
  if (!result || typeof result !== "object") {
    throw new Error("Agent result must be an object");
  }
  if (typeof result.success !== "boolean") {
    throw new Error("Agent result.success must be boolean");
  }
  if (typeof result.confidence !== "number") {
    result.confidence = result.success ? 100 : 0;
  }
  if (typeof result.retries !== "number") {
    result.retries = 0;
  }
  if (!Array.isArray(result.warnings)) {
    result.warnings = [];
  }
  if (!Array.isArray(result.errors)) {
    result.errors = [];
  }
  if (!result.metrics || typeof result.metrics !== "object") {
    result.metrics = {};
  }
  if (result.output === undefined) {
    result.output = null;
  }
  return result as AgentResult<T>;
}

/**
 * Wrap an async agent function with the standardized contract.
 * Automatically catches errors, counts retries, and validates output.
 */
export async function withAgentContract<T>(
  agentName: string,
  fn: () => Promise<T>,
  opts?: { maxRetries?: number; timeoutMs?: number },
): Promise<AgentResult<T>> {
  const maxRetries = opts?.maxRetries ?? 1;
  let lastError: string | null = null;
  let retries = 0;
  const warnings: string[] = [];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const output = await fn();
      retries = attempt;
      return {
        success: true,
        confidence: 100,
        retries,
        warnings,
        errors: [],
        metrics: { attempts: attempt + 1 },
        output,
      };
    } catch (e: any) {
      retries = attempt;
      lastError = e?.message ?? String(e);
      warnings.push(`Attempt ${attempt + 1} failed: ${lastError}`);
      if (attempt < maxRetries) {
        console.warn(`[Agent Contract] ${agentName} attempt ${attempt + 1} failed: ${lastError}. Retrying...`);
      }
    }
  }

  return {
    success: false,
    confidence: 0,
    retries,
    warnings,
    errors: [lastError ?? "Unknown error"],
    metrics: { attempts: retries + 1 },
    output: null as T,
  };
}
