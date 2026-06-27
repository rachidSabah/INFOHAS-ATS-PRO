// ============================================================================
// Intelligent Rate-Limit Tracker & Auto-Failover Engine
//
// In-memory tracking of provider quotas, cooldowns, and health.
// Auto-failover: when a model hits rate limit, rank alternatives and continue.
// ============================================================================

export interface QuotaEntry {
  providerId: string;
  modelName: string;
  requestsRemaining: number;  // estimated, -1 = unknown
  tokensRemaining: number;    // estimated, -1 = unknown
  resetAt: number;            // Unix ms
  last429At: number;
  consecutive429s: number;
}

export interface FailoverDecision {
  action: "retry_alternate" | "cooldown" | "fallback_provider" | "local_engine";
  alternativeModel?: string;
  alternativeProvider?: string;
  reason: string;
}

class RateLimitTracker {
  private quotas: Map<string, QuotaEntry> = new Map();

  /** Mark a model as receiving a 429 */
  record429(providerId: string, modelName: string): void {
    const key = `${providerId}:${modelName}`;
    const existing = this.quotas.get(key);
    const now = Date.now();
    if (existing) {
      existing.last429At = now;
      existing.consecutive429s++;
      existing.requestsRemaining = 0;
    } else {
      this.quotas.set(key, {
        providerId, modelName,
        requestsRemaining: 0,
        tokensRemaining: 0,
        resetAt: now + 180_000, // 3 min default
        last429At: now,
        consecutive429s: 1,
      });
    }
  }

  /** Record a successful request — reset consecutive 429 count */
  recordSuccess(providerId: string, modelName: string): void {
    const key = `${providerId}:${modelName}`;
    const entry = this.quotas.get(key);
    if (entry) {
      entry.consecutive429s = 0;
      if (entry.requestsRemaining <= 0) entry.requestsRemaining = 1;
    }
  }

  /** Check if a model is currently rate-limited */
  isRateLimited(providerId: string, modelName?: string): boolean {
    const keys = modelName
      ? [`${providerId}:${modelName}`]
      : Array.from(this.quotas.keys()).filter(k => k.startsWith(`${providerId}:`));

    const now = Date.now();
    for (const key of keys) {
      const entry = this.quotas.get(key);
      if (!entry) continue;
      if (now < entry.resetAt && entry.consecutive429s > 0) return true;
      if (entry.consecutive429s >= 3) return true; // sticky after 3 consecutive
      if (entry.requestsRemaining === 0 && now < entry.resetAt) return true;
    }
    return false;
  }

  /** Get remaining cooldown ms, 0 if not rate-limited */
  getCooldownRemainingMs(providerId: string, modelName?: string): number {
    const key = modelName ? `${providerId}:${modelName}` : `${providerId}:`;
    const entry = Array.from(this.quotas.entries()).find(([k]) => k.startsWith(key))?.[1];
    if (!entry) return 0;
    const remaining = entry.resetAt - Date.now();
    return remaining > 0 ? remaining : 0;
  }

  /** Find the best available model from a list, skipping rate-limited ones */
  findBestAvailable(
    candidates: Array<{ providerId: string; modelName: string; score?: number }>,
  ): { providerId: string; modelName: string } | null {
    const available = candidates.filter((c) => !this.isRateLimited(c.providerId, c.modelName));
    if (available.length === 0) return null;
    // Sort by score descending, then by consecutive429s ascending
    available.sort((a, b) => {
      const scoreDiff = (b.score || 0) - (a.score || 0);
      if (scoreDiff !== 0) return scoreDiff;
      const a429 = this.quotas.get(`${a.providerId}:${a.modelName}`)?.consecutive429s || 0;
      const b429 = this.quotas.get(`${b.providerId}:${b.modelName}`)?.consecutive429s || 0;
      return a429 - b429;
    });
    return available[0];
  }

  /** Update estimated quota from response headers */
  updateQuota(providerId: string, modelName: string, remaining: number, resetAt?: number): void {
    const key = `${providerId}:${modelName}`;
    const existing = this.quotas.get(key);
    if (existing) {
      existing.requestsRemaining = remaining;
      if (resetAt) existing.resetAt = resetAt;
    } else {
      this.quotas.set(key, {
        providerId, modelName,
        requestsRemaining: remaining,
        tokensRemaining: -1,
        resetAt: resetAt || Date.now() + 60000,
        last429At: 0,
        consecutive429s: 0,
      });
    }
  }

  /** Clear all tracked data */
  clearAll(): void { this.quotas.clear(); }

  /** Clear a specific provider/model */
  clear(providerId: string, modelName?: string): void {
    const key = modelName ? `${providerId}:${modelName}` : `${providerId}:`;
    Array.from(this.quotas.keys()).filter(k => k.startsWith(key)).forEach(k => this.quotas.delete(k));
  }

  /** Get summary stats */
  getStats(): { totalTracked: number; rateLimited: number; avg429Count: number } {
    const all = Array.from(this.quotas.values());
    return {
      totalTracked: all.length,
      rateLimited: all.filter(e => this.isRateLimited(e.providerId, e.modelName)).length,
      avg429Count: all.length > 0 ? all.reduce((s, e) => s + e.consecutive429s, 0) / all.length : 0,
    };
  }
}

export const rateLimitTracker = new RateLimitTracker();
