export interface ProviderCapabilities {
  freeTier: boolean;
  thirdPartyLimited: boolean;
  maxConcurrentRequests: number;
  retryable429: boolean;
  recommendedFallback: boolean;
  warningBadge?: string;
}

export const PROVIDER_CAPABILITIES: Record<string, ProviderCapabilities> = {
  opencode: {
    freeTier: true,
    thirdPartyLimited: true,
    maxConcurrentRequests: 1,
    retryable429: true,
    recommendedFallback: true,
    warningBadge: "⚠ Free model – third-party rate limits may apply.",
  },
  "opencode-zen": {
    freeTier: true,
    thirdPartyLimited: true,
    maxConcurrentRequests: 1,
    retryable429: true,
    recommendedFallback: true,
    warningBadge: "⚠ Free model – third-party rate limits may apply.",
  },
  puter: {
    freeTier: true,
    thirdPartyLimited: false,
    maxConcurrentRequests: 3,
    retryable429: false,
    recommendedFallback: true,
  },
  gemini: {
    freeTier: true,
    thirdPartyLimited: false,
    maxConcurrentRequests: Infinity,
    retryable429: true,
    recommendedFallback: true,
  },
  openai: {
    freeTier: false,
    thirdPartyLimited: false,
    maxConcurrentRequests: Infinity,
    retryable429: true,
    recommendedFallback: false,
  },
  claude: {
    freeTier: false,
    thirdPartyLimited: false,
    maxConcurrentRequests: Infinity,
    retryable429: true,
    recommendedFallback: false,
  },
  deepseek: {
    freeTier: false,
    thirdPartyLimited: false,
    maxConcurrentRequests: Infinity,
    retryable429: true,
    recommendedFallback: false,
  },
  groq: {
    freeTier: true,
    thirdPartyLimited: false,
    maxConcurrentRequests: 3,
    retryable429: true,
    recommendedFallback: false,
  },
  openrouter: {
    freeTier: false,
    thirdPartyLimited: false,
    maxConcurrentRequests: Infinity,
    retryable429: true,
    recommendedFallback: true,
  },
  mistral: {
    freeTier: false,
    thirdPartyLimited: false,
    maxConcurrentRequests: Infinity,
    retryable429: true,
    recommendedFallback: false,
  },
  nvidia: {
    freeTier: true,
    thirdPartyLimited: true,
    maxConcurrentRequests: 1, // rate-limited on concurrent calls
    retryable429: true,
    recommendedFallback: true,
    warningBadge: "⚠ Free model – Nvidia API rate limits may apply.",
  },
  zencode: {
    freeTier: true,
    thirdPartyLimited: true,
    maxConcurrentRequests: 1,
    retryable429: true,
    recommendedFallback: true,
    warningBadge: "⚠ Free model – ZenCode API rate limits may apply.",
  },
  custom: {
    freeTier: false,
    thirdPartyLimited: false,
    maxConcurrentRequests: Infinity,
    retryable429: true,
    recommendedFallback: false,
  },
};

export function getProviderCapabilities(type: string): ProviderCapabilities {
  return PROVIDER_CAPABILITIES[type] || {
    freeTier: false,
    thirdPartyLimited: false,
    maxConcurrentRequests: Infinity,
    retryable429: true,
    recommendedFallback: false,
  };
}

export function isOpenCodeZenFree(provider: any): boolean {
  if (!provider) return false;
  const type = provider.type || "";
  const modelName = (provider.modelName || "").toLowerCase();
  const name = (provider.name || "").toLowerCase();
  const isZen = type === "opencode" || type === "opencode-zen" || type === "zencode" || type === "nvidia" || name.includes("zen") || name.includes("nvidia");
  const isMistralFree = type === "mistral" && (modelName.includes("free") || modelName.includes("small") || modelName.includes("codestral") || modelName.includes("pixtral") || modelName.includes("tiny") || modelName.includes("trial"));
  const isModelFree = modelName ? (modelName.includes("free") || modelName.includes("instruct") || modelName.includes("llama")) : true;
  return (isZen && isModelFree) || isMistralFree;
}

export function isRateLimitError(error: any): boolean {
  if (!error) return false;
  if (error.statusCode === 429 || error.status === 429) return true;
  if (error.type === "FreeUsageLimitError") return true;
  const msg = (error.message || "").toLowerCase();
  if (msg.includes("429") || msg.includes("rate limit") || msg.includes("rate_limit") || msg.includes("too many requests") || msg.includes("free usage limit")) return true;
  return false;
}

export function getRateLimitErrorMessage(provider: any): string {
  if (isOpenCodeZenFree(provider)) {
    return `OpenCode Zen or Mistral free models are temporarily rate-limited. Please wait a few moments or switch to another provider.`;
  }
  return `This provider is temporarily rate-limited. Please wait a few moments or switch to another provider.`;
}

export function getRecommendedFallbacks(allProviders: any[], currentProviderId?: string): any[] {
  const fallbackOrder = ["puter", "gemini", "mistral", "nvidia", "openrouter", "zencode", "opencode"];
  return fallbackOrder
    .map((type) => {
      if (type === "opencode" || type === "nvidia" || type === "zencode" || type === "mistral") {
        const nonFree = allProviders.find((p) => p.type === type && p.isActive && p.id !== currentProviderId && !isOpenCodeZenFree(p));
        if (nonFree) return nonFree;
        return allProviders.find((p) => p.type === type && p.isActive && p.id !== currentProviderId);
      }
      return allProviders.find((p) => p.type === type && p.isActive && p.id !== currentProviderId);
    })
    .filter(Boolean)
    .filter((p, i, arr) => arr.findIndex((x) => x.id === p.id) === i);
}

export let activeRequestsCount = 0;
export let optimizationRequestCounter = 0;
export let isOptimizationRunning = false;

export function incrementActiveRequests() { activeRequestsCount++; }
export function decrementActiveRequests() { if (activeRequestsCount > 0) activeRequestsCount--; }
export function incrementOptimizationRequests() { if (isOptimizationRunning) optimizationRequestCounter++; }
export function startOptimizationTracking() { isOptimizationRunning = true; optimizationRequestCounter = 0; }
export function stopOptimizationTracking() { isOptimizationRunning = false; }

class SequentialRequestQueue {
  private queue: Array<() => Promise<void>> = [];
  private running = 0;
  private maxConcurrent: number;

  constructor(maxConcurrent: number) {
    this.maxConcurrent = maxConcurrent;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.maxConcurrent === Infinity) {
      return fn();
    }
    while (this.running >= this.maxConcurrent) {
      await new Promise<void>((resolve) => {
        this.queue.push(async () => { resolve(); });
      });
    }
    this.running++;
    try {
      return await fn();
    } finally {
      this.running--;
      const next = this.queue.shift();
      if (next) next();
    }
  }
}

const requestQueues = new Map<string, SequentialRequestQueue>();

export function getRequestQueue(provider: any): SequentialRequestQueue {
  const providerType = typeof provider === "string" ? provider : (provider?.type || "custom");
  const modelName = typeof provider === "string" ? "" : (provider?.modelName || "");
  const key = `${providerType}:${modelName}`;
  if (!requestQueues.has(key)) {
    const isZenFree = typeof provider === "string"
      ? (providerType === "opencode" || providerType === "opencode-zen")
      : isOpenCodeZenFree(provider);
    const maxConcurrent = isZenFree ? 1 : (getProviderCapabilities(providerType).maxConcurrentRequests);
    requestQueues.set(key, new SequentialRequestQueue(maxConcurrent));
  }
  return requestQueues.get(key)!;
}

export async function withRateLimitRetry<T>(fn: () => Promise<T>, provider: any): Promise<T> {
  const caps = getProviderCapabilities(provider.type || "custom");
  if (!caps.retryable429) {
    incrementOptimizationRequests();
    incrementActiveRequests();
    try {
      return await fn();
    } finally {
      decrementActiveRequests();
    }
  }
  const maxAttempts = 3;
  const backoffMs = [1000, 2000, 4000];
  let lastError: any;
  let rateLimited = false;
  let retryCount = 0;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    incrementOptimizationRequests();
    incrementActiveRequests();
    try {
      const res = await fn();
      console.log({
        provider: provider.type,
        model: provider.modelName,
        requestsPerOptimization: isOptimizationRunning ? optimizationRequestCounter : 0,
        concurrentRequests: activeRequestsCount,
        rateLimited,
        retryCount,
      });
      return res;
    } catch (error: any) {
      lastError = error;
      if (!isRateLimitError(error)) {
        throw error;
      }
      rateLimited = true;
      retryCount = attempt + 1;
      if (attempt === maxAttempts - 1) {
        break;
      }
      const delay = backoffMs[attempt] ?? 4000;
      console.warn(`[RateLimitRetry] ${provider.name || provider.type} returned 429. Backing off ${delay}ms before attempt ${attempt + 2}/${maxAttempts}.`);
      console.log({
        provider: provider.type,
        model: provider.modelName,
        requestsPerOptimization: isOptimizationRunning ? optimizationRequestCounter : 0,
        concurrentRequests: activeRequestsCount,
        rateLimited,
        retryCount,
      });
      await new Promise((r) => setTimeout(r, delay));
    } finally {
      decrementActiveRequests();
    }
  }
  const friendlyMsg = getRateLimitErrorMessage(provider);
  const enhancedError = new Error(friendlyMsg);
  (enhancedError as any).rateLimited = true;
  (enhancedError as any).originalError = lastError;
  (enhancedError as any).provider = provider.name || provider.type;
  console.log({
    provider: provider.type,
    model: provider.modelName,
    requestsPerOptimization: isOptimizationRunning ? optimizationRequestCounter : 0,
    concurrentRequests: activeRequestsCount,
    rateLimited,
    retryCount,
  });
  throw enhancedError;
}
