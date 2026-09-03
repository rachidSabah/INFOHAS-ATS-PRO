// ============================================================================
// AI Health Manager — the SINGLE authoritative provider/model health registry
// (directive #9, #10).
//
// The Agent Configuration Center, Provider Settings, Benchmark Ping, the
// Supervisor and the Optimization Pipeline ALL read/write this same registry.
// There must NOT be separate competing health systems: the existing trackers
// (rate-limit tracker, provider cooldowns, circuit breaker) keep operating,
// but every observation they produce is funneled here through recordSuccess /
// recordFailure so the rest of the system can query ONE consistent view.
//
// Health states are explicit (directive #10) — never collapsed into a generic
// "provider failed". The registry preserves the real reason.
//
// Storage: in-memory singleton with optional sessionStorage mirror so a page
// refresh mid-job does not fabricate "unknown" health. Secrets are never
// stored here (directive #43).
// ============================================================================

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

/** Explicit health states (directive #10). NOT interchangeable. */
export type AIHealthState =
  | "healthy"
  | "degraded"
  | "rate_limited"
  | "quota_exhausted"
  | "authentication_required"
  | "unsupported_model"
  | "endpoint_error"
  | "timeout"
  | "unavailable"
  | "cooldown"
  | "unknown";

/** Model lifecycle states (directive #8) — distinct dimensions, never merged. */
export type ModelAvailabilityState =
  | "DISCOVERED"  // model exists in provider metadata
  | "SUPPORTED"   // provider declares it can execute that model
  | "HEALTHY"     // provider/model passed a real health test
  | "AVAILABLE"   // usable under current auth/quota/rate-limit conditions
  | "LOCKED";     // selected for the current optimization job

export type AIErrorCategory =
  | "none"
  | "invalid_request"        // 400
  | "authentication"         // 401/403
  | "not_found"              // 404 endpoint
  | "unsupported_model"      // provider rejected the model id
  | "rate_limit"             // 429 burst
  | "quota_exhausted"        // 429 monthly/usage-limit family
  | "server_error"           // 5xx
  | "timeout"
  | "network"
  | "unknown";

export interface AIHealthRecord {
  providerId: string;
  providerName: string;
  /** Canonical model id (exact provider-side identifier — directive #7). */
  canonicalModelId: string;
  state: AIHealthState;
  /** Most specific state for observability (state keeps the coarse band). */
  errorCategory: AIErrorCategory;
  /** Last raw error message — redacted, never contains secrets. */
  lastErrorMessage?: string;
  httpStatus?: number;
  latencyMs?: number;
  authState: "authenticated" | "not_authenticated" | "not_required" | "unknown";
  /** Lifecycle state of the model on this provider (directive #8). */
  availability: ModelAvailabilityState;
  rateLimitState: "none" | "burst" | "quota";
  /** Epoch ms until which the pair is cooling down (0 = none). */
  cooldownUntil: number;
  quotaState: "unknown" | "ok" | "low" | "exhausted";
  failureCount: number;
  successCount: number;
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastCheckedAt: string;
  capabilityCompatible: boolean;
}

export interface AIHealthSnapshot {
  records: AIHealthRecord[];
  takenAt: string;
}

export interface HealthObservation {
  providerId: string;
  providerName?: string;
  canonicalModelId: string;
  ok: boolean;
  latencyMs?: number;
  httpStatus?: number;
  errorMessage?: string;
  /** Explicit category when the caller already classified the error. */
  errorCategory?: AIErrorCategory;
  /** Explicit state when the caller already classified the outcome. */
  state?: AIHealthState;
}

// ----------------------------------------------------------------------------
// Failure classification (directive #10, #28) — HTTP status → category/state
// ----------------------------------------------------------------------------

const QUOTA_PATTERNS = /monthly usage limit|usage limit reached|quota exhausted|billing hard limit|insufficient_quota|FreeUsageLimitError/i;
const RATE_LIMIT_PATTERNS = /rate.?limit|too many requests|429/i;
const UNSUPPORTED_MODEL_PATTERNS = /model[s]?[\s`"'/.\w-]{0,60}?(?:not.?found|does.?not.?exist|(?:is.?)?not.?supported|unsupported|invalid model)|not.?found.?for.?api.?version|decommissioned/i;
const AUTH_PATTERNS = /unauthorized|invalid.?(api.?)?key|authentication|forbidden|permission denied/i;
const TIMEOUT_PATTERNS = /timed? ?out|timeout|ETIMEDOUT|deadline exceeded/i;

/** Classify a raw failure into an explicit category + health state. */
export function classifyProviderFailure(input: {
  httpStatus?: number;
  errorMessage?: string;
  errorCategory?: AIErrorCategory;
}): { category: AIErrorCategory; state: AIHealthState } {
  const status = input.httpStatus ?? 0;
  const msg = input.errorMessage ?? "";
  if (input.errorCategory && input.errorCategory !== "none") {
    return { category: input.errorCategory, state: stateForCategory(input.errorCategory) };
  }
  // A 2xx without an error body is a healthy observation.
  if (status >= 200 && status < 300 && !msg) return { category: "none", state: "healthy" };
  // Order matters: quota/rate-limit before generic auth, model errors before 404.
  if (UNSUPPORTED_MODEL_PATTERNS.test(msg)) return { category: "unsupported_model", state: "unsupported_model" };
  if (QUOTA_PATTERNS.test(msg)) return { category: "quota_exhausted", state: "quota_exhausted" };
  if (status === 429 || RATE_LIMIT_PATTERNS.test(msg)) return { category: "rate_limit", state: "rate_limited" };
  if (status === 401 || status === 403 || AUTH_PATTERNS.test(msg)) return { category: "authentication", state: "authentication_required" };
  if (TIMEOUT_PATTERNS.test(msg)) return { category: "timeout", state: "timeout" };
  if (status === 400) return { category: "invalid_request", state: "unavailable" };
  if (status === 404) return { category: "not_found", state: "endpoint_error" };
  if (status >= 500) return { category: "server_error", state: "degraded" };
  if (status === 0 && msg) return { category: "network", state: "unavailable" };
  if (msg) return { category: "unknown", state: "unavailable" };
  return { category: "unknown", state: "unknown" };
}

function stateForCategory(category: AIErrorCategory): AIHealthState {
  switch (category) {
    case "authentication": return "authentication_required";
    case "not_found": return "endpoint_error";
    case "unsupported_model": return "unsupported_model";
    case "rate_limit": return "rate_limited";
    case "quota_exhausted": return "quota_exhausted";
    case "server_error": return "degraded";
    case "timeout": return "timeout";
    case "invalid_request": return "unavailable";
    case "network": return "unavailable";
    case "none": return "healthy";
    default: return "unknown";
  }
}

/** Redact anything that looks like a credential from an error message. */
export function redactSecrets(message: string | undefined): string | undefined {
  if (!message) return undefined;
  return message
    .replace(/(sk|pk|rk|ghp|gho|github_pat|xoxb|xoxp|AIza)[-_A-Za-z0-9]{8,}/g, "[redacted]")
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{8,}/gi, "Bearer [redacted]")
    .replace(/(api[_-]?key|token|password|secret)(["'\s:=]+)[^\s"',;]+/gi, "$1$2[redacted]")
    .slice(0, 400);
}

// ----------------------------------------------------------------------------
// Registry
// ----------------------------------------------------------------------------

const MIRROR_KEY = "resumeai-ai-health-registry";

function keyOf(providerId: string, canonicalModelId: string): string {
  return `${providerId}::${canonicalModelId || "*"}`;
}

type Listener = (snapshot: AIHealthSnapshot) => void;

export class AIHealthManagerImpl {
  private records = new Map<string, AIHealthRecord>();
  private listeners = new Set<Listener>();

  constructor() {
    this.restore();
  }

  // -- core read/write ------------------------------------------------------

  getHealth(providerId: string, canonicalModelId: string): AIHealthRecord {
    const k = keyOf(providerId, canonicalModelId);
    return (
      this.records.get(k) ?? this.blankRecord(providerId, canonicalModelId)
    );
  }

  snapshot(): AIHealthSnapshot {
    return {
      records: [...this.records.values()].map((r) => ({ ...r })),
      takenAt: new Date().toISOString(),
    };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  /** Register a model as DISCOVERED via live provider metadata (directive #32). */
  registerDiscovered(providerId: string, providerName: string, modelIds: string[]): void {
    for (const m of modelIds) {
      const k = keyOf(providerId, m);
      const existing = this.records.get(k);
      if (existing) {
        // Never downgrade a validated state back to DISCOVERED.
        if (existing.availability === "DISCOVERED") existing.lastCheckedAt = new Date().toISOString();
        continue;
      }
      this.records.set(k, {
        ...this.blankRecord(providerId, m),
        providerName,
        availability: "DISCOVERED",
        state: "unknown",
      });
    }
    this.persistAndNotify();
  }

  /** Mark provider-declared support for a model (SUPPORTED ⊇ DISCOVERED). */
  markSupported(providerId: string, canonicalModelId: string, providerName?: string): void {
    const r = this.getHealth(providerId, canonicalModelId);
    if (r.availability === "DISCOVERED") r.availability = "SUPPORTED";
    if (providerName) r.providerName = providerName;
    this.records.set(keyOf(providerId, canonicalModelId), r);
    this.persistAndNotify();
  }

  /** Mark a pair as LOCKED to the current optimization job (directive #8). */
  markLocked(providerId: string, canonicalModelId: string): void {
    const r = this.getHealth(providerId, canonicalModelId);
    r.availability = "LOCKED";
    this.records.set(keyOf(providerId, canonicalModelId), r);
    this.persistAndNotify();
  }

  clearLocks(): void {
    for (const r of this.records.values()) {
      if (r.availability === "LOCKED") r.availability = "SUPPORTED";
    }
    this.persistAndNotify();
  }

  // -- observation API (the ONLY way states change) -------------------------

  recordSuccess(obs: HealthObservation): AIHealthRecord {
    const r = this.getHealth(obs.providerId, obs.canonicalModelId);
    if (obs.providerName) r.providerName = obs.providerName;
    r.successCount += 1;
    r.failureCount = 0; // a real success resets the failure streak
    r.state = "healthy";
    r.errorCategory = "none";
    r.lastErrorMessage = undefined;
    r.httpStatus = obs.httpStatus ?? 200;
    r.latencyMs = obs.latencyMs ?? r.latencyMs;
    r.lastSuccessAt = new Date().toISOString();
    r.lastCheckedAt = r.lastSuccessAt;
    r.cooldownUntil = 0;
    r.rateLimitState = "none";
    if (r.quotaState === "exhausted") r.quotaState = "ok";
    if (r.authState === "not_authenticated") r.authState = "authenticated";
    // A real executed success proves the provider can run this model.
    if (r.availability === "DISCOVERED" || r.availability === "SUPPORTED") {
      r.availability = "HEALTHY";
    }
    this.records.set(keyOf(obs.providerId, obs.canonicalModelId), r);
    this.persistAndNotify();
    logHealth("success", r);
    return r;
  }

  recordFailure(obs: HealthObservation): AIHealthRecord {
    const r = this.getHealth(obs.providerId, obs.canonicalModelId);
    if (obs.providerName) r.providerName = obs.providerName;
    const { category, state } = classifyProviderFailure(obs);
    r.failureCount += 1;
    r.state = obs.state && obs.state !== "unknown" ? obs.state : state;
    r.errorCategory = category;
    r.lastErrorMessage = redactSecrets(obs.errorMessage);
    r.httpStatus = obs.httpStatus;
    r.lastFailureAt = new Date().toISOString();
    r.lastCheckedAt = r.lastFailureAt;
    if (obs.latencyMs != null) r.latencyMs = obs.latencyMs;

    switch (category) {
      case "rate_limit":
        r.rateLimitState = "burst";
        r.cooldownUntil = defaultCooldown(r.state, 3 * 60_000);
        break;
      case "quota_exhausted":
        r.rateLimitState = "quota";
        r.quotaState = "exhausted";
        r.cooldownUntil = defaultCooldown(r.state, 30 * 60_000);
        break;
      case "authentication":
        r.authState = "not_authenticated";
        r.cooldownUntil = defaultCooldown(r.state, 30 * 60_000);
        break;
      case "unsupported_model":
        r.capabilityCompatible = false;
        // A provider that cannot execute the model never stays HEALTHY on it.
        if (r.availability === "HEALTHY" || r.availability === "SUPPORTED") r.availability = "DISCOVERED";
        r.cooldownUntil = defaultCooldown(r.state, 10 * 60_000);
        break;
      case "timeout":
        r.cooldownUntil = defaultCooldown(r.state, 90_000);
        break;
      case "not_found":
        r.cooldownUntil = defaultCooldown(r.state, 10 * 60_000);
        break;
      default:
        break;
    }
    this.records.set(keyOf(obs.providerId, obs.canonicalModelId), r);
    this.persistAndNotify();
    logHealth("failure", r);
    return r;
  }

  /** Probe/benchmark outcome for an exact provider+model pair (directive #31). */
  recordBenchmark(obs: HealthObservation): AIHealthRecord {
    return obs.ok ? this.recordSuccess(obs) : this.recordFailure(obs);
  }

  /** Explicit cooldown override (e.g. Retry-After header). Epoch ms until. */
  setCooldown(providerId: string, canonicalModelId: string, untilEpochMs: number, state: AIHealthState = "cooldown"): void {
    const r = this.getHealth(providerId, canonicalModelId);
    r.state = state;
    r.cooldownUntil = Math.max(r.cooldownUntil, untilEpochMs);
    r.lastCheckedAt = new Date().toISOString();
    this.records.set(keyOf(providerId, canonicalModelId), r);
    this.persistAndNotify();
  }

  /** True when the pair is usable right now (auth ok, not cooling, quota ok). */
  isAvailableNow(providerId: string, canonicalModelId: string, now = Date.now()): boolean {
    const r = this.getHealth(providerId, canonicalModelId);
    if (r.cooldownUntil > now) return false;
    if (r.state === "authentication_required" || r.state === "quota_exhausted") return false;
    if (r.quotaState === "exhausted") return false;
    if (r.availability === "DISCOVERED") return false; // never validated anywhere
    return true;
  }

  /** Ranked list of healthy+available candidates, best first. */
  rankedAvailable(providerIds?: string[], now = Date.now()): AIHealthRecord[] {
    return [...this.records.values()]
      .filter((r) => (providerIds ? providerIds.includes(r.providerId) : true))
      .filter((r) => r.state === "healthy" || (r.state === "degraded" && r.cooldownUntil <= now))
      .filter((r) => this.isAvailableNow(r.providerId, r.canonicalModelId, now))
      .sort((a, b) => rankOf(b) - rankOf(a));
  }

  /** Reset everything (tests / sign-out). */
  reset(): void {
    this.records.clear();
    this.persistAndNotify();
  }

  // -- internals ------------------------------------------------------------

  private blankRecord(providerId: string, canonicalModelId: string): AIHealthRecord {
    return {
      providerId,
      providerName: providerId,
      canonicalModelId,
      state: "unknown",
      errorCategory: "none",
      authState: "unknown",
      availability: "DISCOVERED",
      rateLimitState: "none",
      cooldownUntil: 0,
      quotaState: "unknown",
      failureCount: 0,
      successCount: 0,
      lastCheckedAt: new Date().toISOString(),
      capabilityCompatible: true,
    };
  }

  private persistAndNotify(): void {
    this.persist();
    const snap = this.snapshot();
    for (const l of this.listeners) {
      try { l(snap); } catch { /* listener errors never break the registry */ }
    }
  }

  private persist(): void {
    try {
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.setItem(MIRROR_KEY, JSON.stringify(this.snapshot()));
      }
    } catch { /* storage may be unavailable in tests / private mode */ }
  }

  private restore(): void {
    try {
      if (typeof sessionStorage === "undefined") return;
      const raw = sessionStorage.getItem(MIRROR_KEY);
      if (!raw) return;
      const snap = JSON.parse(raw) as AIHealthSnapshot;
      for (const r of snap.records ?? []) {
        this.records.set(keyOf(r.providerId, r.canonicalModelId), r);
      }
    } catch { /* corrupted mirror — start clean */ }
  }
}

function defaultCooldown(_state: AIHealthState, fallbackMs: number): number {
  return Date.now() + fallbackMs;
}

/** Rank: healthy first, then lowest latency, then fewest failures. */
function rankOf(r: AIHealthRecord): number {
  let score = 100;
  if (r.state === "healthy") score += 50;
  else if (r.state === "degraded") score += 10;
  if (r.latencyMs != null) score += Math.max(0, 25 - Math.min(25, r.latencyMs / 200));
  score -= Math.min(40, r.failureCount * 5);
  if (r.availability === "HEALTHY") score += 5;
  return score;
}

function logHealth(kind: "success" | "failure", r: AIHealthRecord): void {
  // Structured observability (directive #46) — never logs secrets.
  const line = `[AI_HEALTH] provider=${r.providerName} model=${r.canonicalModelId} state=${r.state} category=${r.errorCategory} availability=${r.availability} failures=${r.failureCount}${r.httpStatus ? ` http=${r.httpStatus}` : ""}`;
  if (kind === "success") console.info(line);
  else console.warn(line);
}

/** Module singleton — THE health registry (directive #9). */
export const aiHealthManager = new AIHealthManagerImpl();

/** Convenience: observe from a thrown error object (router/adapters). */
export function observeError(providerId: string, canonicalModelId: string, err: any, providerName?: string): AIHealthRecord {
  return aiHealthManager.recordFailure({
    providerId,
    providerName,
    canonicalModelId,
    ok: false,
    httpStatus: err?.statusCode || err?.status || undefined,
    errorMessage: err?.message || String(err ?? "unknown error"),
  });
}
