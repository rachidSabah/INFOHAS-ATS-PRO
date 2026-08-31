/**
 * Task 27 — AI Providers table must auto-fit its frame layer (no horizontal scroll).
 *
 * Live evidence (2026-08-31 user report): the 10-column provider table inside
 * AIProviders.tsx required horizontal scrolling on every desktop width because
 * (a) the table used auto layout with an unwrappable badge row, (b) every cell
 * carried px-4 padding, (c) 6 icon action buttons, and (d) no column was
 * breakpoint-gated. The app frame caps at ~1352px (main max-w-[1400px] − p-6),
 * while the table's natural min-width was ~1550px → permanent inner scroll.
 *
 * The fix contract (pure module provider-table-layout.ts):
 *  1. table-fixed layout — the table can NEVER exceed its container width.
 *  2. Breakpoint column disclosure — low-priority columns appear only when the
 *     frame is wide enough (xl = 1280, 2xl = 1536 viewport).
 *  3. A width budget that is verified arithmetically: fixed columns + cell
 *     padding + minimum flexible shares must fit the frame cap at every
 *     breakpoint where the visible set is shown.
 */

import { describe, it, expect } from "vitest";
import {
  PROVIDER_TABLE_COLUMNS,
  PROVIDER_TABLE_CELL_PADDING_PX,
  PROVIDER_TABLE_FRAME_CAP_PX,
  PROVIDER_TABLE_FLEXIBLE_MIN_PX,
  providerTableWidthBudget,
} from "./provider-table-layout";

const ALL_KEYS = [
  "provider",
  "type",
  "baseUrl",
  "model",
  "status",
  "priority",
  "concurrency",
  "requests",
  "lastUsed",
  "actions",
] as const;

describe("provider table layout contract (Task 27: auto-fit, no horizontal scroll)", () => {
  it("declares exactly the 10 columns in display order", () => {
    expect(PROVIDER_TABLE_COLUMNS.map((c) => c.key)).toEqual([...ALL_KEYS]);
  });

  it("keeps the 5 core columns visible at every viewport width", () => {
    const alwaysVisible = PROVIDER_TABLE_COLUMNS.filter((c) => c.visibleFrom === null);
    expect(alwaysVisible.map((c) => c.key).sort()).toEqual(
      ["actions", "concurrency", "model", "provider", "status"].sort()
    );
  });

  it("gates wide/low-priority columns behind xl and 2xl breakpoints", () => {
    const byKey = Object.fromEntries(PROVIDER_TABLE_COLUMNS.map((c) => [c.key, c]));
    // Priority + usage trivia appear from xl (1280px viewport)
    expect(byKey.priority.visibleFrom).toBe("xl");
    expect(byKey.requests.visibleFrom).toBe("xl");
    expect(byKey.lastUsed.visibleFrom).toBe("xl");
    // Widest reference columns appear only from 2xl (1536px viewport)
    expect(byKey.type.visibleFrom).toBe("2xl");
    expect(byKey.baseUrl.visibleFrom).toBe("2xl");
  });

  it("every gated column carries a `hidden …:table-cell` visibility class for th AND td", () => {
    for (const col of PROVIDER_TABLE_COLUMNS) {
      if (col.visibleFrom === null) {
        expect(col.thVisibilityClass, col.key).toBe("");
        expect(col.tdVisibilityClass, col.key).toBe("");
      } else {
        expect(col.thVisibilityClass, col.key).toBe(`hidden ${col.visibleFrom}:table-cell`);
        expect(col.tdVisibilityClass, col.key).toBe(`hidden ${col.visibleFrom}:table-cell`);
      }
    }
  });

  it("action column is wide enough for 6 icon buttons (24px) + gaps + cell padding", () => {
    const actions = PROVIDER_TABLE_COLUMNS.find((c) => c.key === "actions")!;
    // 6 × 24px buttons + 5 × 2px gaps (gap-0.5) + 24px cell padding (px-3)
    const required = 6 * 24 + 5 * 2 + PROVIDER_TABLE_CELL_PADDING_PX;
    expect(actions.fixedWidthPx).toBeGreaterThanOrEqual(required);
  });

  it("arithmetic budget: fixed columns + padding + minimum flexible shares fit the frame cap at every tier", () => {
    for (const viewport of ["base", "xl", "2xl"] as const) {
      const budget = providerTableWidthBudget(viewport);
      const needed =
        budget.fixedPx + budget.paddingPx + budget.flexibleColumns * 0 + PROVIDER_TABLE_FLEXIBLE_MIN_PX.provider + PROVIDER_TABLE_FLEXIBLE_MIN_PX.model;
      expect(
        needed,
        `${viewport}: fixed ${budget.fixedPx} + padding ${budget.paddingPx} + flexible minimums ${PROVIDER_TABLE_FLEXIBLE_MIN_PX.provider + PROVIDER_TABLE_FLEXIBLE_MIN_PX.model} must be ≤ frame cap ${PROVIDER_TABLE_FRAME_CAP_PX}`
      ).toBeLessThanOrEqual(PROVIDER_TABLE_FRAME_CAP_PX);
    }
  });

  it("arithmetic budget: flexible columns keep a usable share at the xl tier (8 visible columns)", () => {
    const budget = providerTableWidthBudget("xl");
    expect(budget.visibleColumns).toBe(8);
    const flexibleShare =
      PROVIDER_TABLE_FRAME_CAP_PX - budget.fixedPx - budget.paddingPx -
      PROVIDER_TABLE_FLEXIBLE_MIN_PX.provider - PROVIDER_TABLE_FLEXIBLE_MIN_PX.model;
    // At xl the two flexible columns must still have their minimums covered
    expect(flexibleShare).toBeGreaterThanOrEqual(0);
  });

  it("base tier shows only the 5 core columns (tablet / half-split windows stay compact)", () => {
    const budget = providerTableWidthBudget("base");
    expect(budget.visibleColumns).toBe(5);
  });
});
