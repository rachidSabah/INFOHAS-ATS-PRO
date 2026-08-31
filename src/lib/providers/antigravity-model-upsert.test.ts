/**
 * Task 29 — Antigravity model sync must use STABLE IDs (no endless duplicates).
 *
 * Spec: "Do not duplicate models endlessly on repeated synchronization. Use
 * stable IDs." Audit finding: the OAuth callback inserted one row per model
 * per sync with `crypto.randomUUID()` as PRIMARY KEY + INSERT OR REPLACE —
 * the REPLACE keyed on the NEW random id, so every "Sync Models" click added
 * 8 duplicate rows to provider_models (same provider_id + model_id, new id).
 *
 * Contract (pure helper consumed by the callback route):
 *  1. Deterministic row id: `${providerId}:${modelId}` — repeated syncs are
 *     idempotent upserts, never new rows.
 *  2. The statement conflicts on (provider_id, model_id) and DO UPDATEs —
 *     preserving enabled state semantics: re-sync re-enables nothing that the
 *     user disabled except refreshing the model_name.
 *  3. Model ownership is explicit: provider_id is always 'antigravity' for
 *     this integration — synced models can never drift into google-gemini.
 */

import { describe, it, expect } from "vitest";
import { antigravityModelUpsert } from "./antigravity-model-upsert";

describe("antigravityModelUpsert (stable-id sync contract)", () => {
  it("builds a parameterized upsert keyed on (provider_id, model_id)", () => {
    const { sql, params } = antigravityModelUpsert("gemini-1.5-flash");
    expect(sql.toUpperCase()).toContain("ON CONFLICT(PROVIDER_ID, MODEL_ID) DO UPDATE");
    expect(params).toContain("antigravity");
    expect(params).toContain("gemini-1.5-flash");
  });

  it("row id is DETERMINISTIC: provider:model, not a random UUID", () => {
    const a = antigravityModelUpsert("claude-3-opus");
    const b = antigravityModelUpsert("claude-3-opus");
    expect(a.params[0]).toBe("antigravity:claude-3-opus");
    expect(a.params).toEqual(b.params);
  });

  it("different models map to different stable rows", () => {
    const a = antigravityModelUpsert("gpt-4o");
    const b = antigravityModelUpsert("deepseek-chat");
    expect(a.params[0]).not.toBe(b.params[0]);
  });

  it("upsert does NOT reset enabled to 1 for existing rows (user disable state survives re-sync)", () => {
    const { sql } = antigravityModelUpsert("gpt-4o");
    expect(sql.toUpperCase()).not.toMatch(/DO UPDATE SET[\s\S]*ENABLED\s*=\s*1/);
  });
});
