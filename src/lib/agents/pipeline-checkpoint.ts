// ============================================================================
// Pipeline Checkpoint & Resume (S4 — Task 18)
//
// When the optimizer exhausts all validated attempts, the pipeline ends in
// an honest RECOVERABLE_ERROR state with every completed intelligence
// artifact preserved (directive §15/§29/§48). Before this module, the RETRY
// re-ran ALL agents — including the AI-costly Job Intelligence, Company
// Intelligence and Skill Gap calls that had already succeeded.
//
// A checkpoint captures those preserved artifacts so the retry can RESUME:
//   - buildCheckpointFromResult: extract the AI artifacts (only) — the ATS
//     analysis is local/deterministic and is never checkpointed
//   - isCheckpointUsable: binds the checkpoint to the same JD (title/company
//     fingerprint) and a freshness window (default 24h — intelligence data
//     older than that may no longer reflect the posting)
//
// The orchestrator accepts `checkpoint` in PipelineInput and restores each
// artifact instead of re-calling its agent, marking the step log so the
// trajectory shows "restored from checkpoint".
// ============================================================================

/** Maximum age of a checkpoint before its intelligence data is stale. */
export const CHECKPOINT_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

export interface PipelineCheckpoint {
  /** Preserved Job Intelligence artifact (identity preserved on restore). */
  jobIntelligence?: unknown;
  /** Preserved Company Intelligence artifact. */
  companyIntelligence?: unknown;
  /** Preserved Skill Gap analysis artifact. */
  skillGap?: unknown;
  /** ISO timestamp of when the checkpoint was captured. */
  savedAt: string;
  /** JD fingerprint the artifacts were computed against. */
  jdFingerprint: string;
}

/** Minimal shape the builder needs from a PipelineResult. */
export interface CheckpointableResult {
  jobIntelligence?: unknown;
  companyIntelligence?: unknown;
  skillGap?: unknown;
}

/** Minimal JD shape needed for fingerprinting (both title spellings tolerated). */
export interface CheckpointJD {
  title?: string;
  jobTitle?: string;
  company?: string;
  description?: string;
  rawText?: string;
}

/**
 * Stable fingerprint of the JD the intelligence artifacts were computed
 * against. Title + company + a description probe (length + head) — cheap,
 * deterministic, and robust to trivial whitespace noise.
 */
export function jdFingerprint(jd: CheckpointJD): string {
  const title = (jd?.title ?? jd?.jobTitle ?? "").trim().toLowerCase();
  const company = (jd?.company ?? "").trim().toLowerCase();
  const desc = (jd?.rawText ?? jd?.description ?? "").replace(/\s+/g, " ").trim();
  const probe = `${desc.length}:${desc.slice(0, 120)}`;
  return `${title}|${company}|${probe}`;
}

/**
 * Build a checkpoint from a (possibly recoverable) pipeline result.
 * Returns null when there is nothing worth resuming.
 */
export function buildCheckpointFromResult(
  result: CheckpointableResult | null | undefined,
  jd: CheckpointJD,
): PipelineCheckpoint | null {
  if (!result) return null;
  const hasAny =
    result.jobIntelligence != null ||
    result.companyIntelligence != null ||
    result.skillGap != null;
  if (!hasAny) return null;

  const checkpoint: PipelineCheckpoint = {
    savedAt: new Date().toISOString(),
    jdFingerprint: jdFingerprint(jd),
  };
  // Identity-preserving assignment (no cloning) so the retry's result
  // carries the SAME artifacts the previous run produced.
  if (result.jobIntelligence != null) checkpoint.jobIntelligence = result.jobIntelligence;
  if (result.companyIntelligence != null) checkpoint.companyIntelligence = result.companyIntelligence;
  if (result.skillGap != null) checkpoint.skillGap = result.skillGap;
  return checkpoint;
}

/**
 * Whether a checkpoint can be used for a retry against `jd`.
 * Null-safe; freshness evaluated against `nowMs` (defaults to Date.now()).
 */
export function isCheckpointUsable(
  checkpoint: PipelineCheckpoint | null | undefined,
  jd: CheckpointJD,
  nowMs: number = Date.now(),
): boolean {
  if (!checkpoint) return false;
  if (!checkpoint.jdFingerprint) return false;
  if (checkpoint.jdFingerprint !== jdFingerprint(jd)) return false;
  const saved = Date.parse(checkpoint.savedAt);
  if (Number.isNaN(saved)) return false;
  if (nowMs - saved > CHECKPOINT_MAX_AGE_MS) return false;
  if (nowMs < saved) return false; // clock skew — treat as stale
  return true;
}
