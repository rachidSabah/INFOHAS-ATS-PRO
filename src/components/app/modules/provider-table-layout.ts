/**
 * Task 27 — AI Providers table responsive auto-fit contract.
 *
 * Problem (user report 2026-08-31): the 10-column provider table required
 * horizontal scrolling inside its card frame at every desktop width. The app
 * frame is capped: `main` = max-w-[1400px] with p-6 → ~1352px of usable table
 * width at most, while the table's natural min-width (10 × px-4 cells, an
 * unwrappable name+badge row, six 28px action buttons, unclamped URLs) was
 * ~1550px — so `overflow-x-auto` scrolled forever.
 *
 * Fix strategy (pure, testable contract consumed by AIProviders.tsx):
 *  1. `table-fixed w-full` on the <table> — the table can never exceed the
 *     container; over-long cell content truncates (with `title` tooltips)
 *     instead of pushing columns wider.
 *  2. Breakpoint column disclosure — the widest / least-critical columns are
 *     hidden below Tailwind xl (1280px) and 2xl (1536px) viewports:
 *       - always (5 core): provider, model, status, concurrency, actions
 *       - xl+ (+3): priority, requests, last used
 *       - 2xl+ (+2): type, base URL (full 10-column table)
 *  3. Verified width budget — fixed column widths + cell padding + minimum
 *     flexible shares for provider/model must fit the 1352px frame cap at
 *     every tier; `providerTableWidthBudget()` makes that arithmetic
 *     checkable (see provider-table-layout.test.ts).
 */

/** Horizontal padding of every td/th: Tailwind px-3 = 12px per side. */
export const PROVIDER_TABLE_CELL_PADDING_PX = 24;

/**
 * Usable table width cap: `main` max-w-[1400px] minus its p-6 horizontal
 * padding (48px). The table can never be wider than this in the app shell.
 */
export const PROVIDER_TABLE_FRAME_CAP_PX = 1400 - 48;

/** Minimum usable widths for the two flexible (no fixed width) columns. */
export const PROVIDER_TABLE_FLEXIBLE_MIN_PX = { provider: 160, model: 150 } as const;

export type ProviderColumnKey =
  | "provider"
  | "type"
  | "baseUrl"
  | "model"
  | "status"
  | "priority"
  | "concurrency"
  | "requests"
  | "lastUsed"
  | "actions";

export type ProviderColumnVisibility = "xl" | "2xl" | null;

export interface ProviderTableColumn {
  key: ProviderColumnKey;
  label: string;
  /**
   * Visibility utility classes. Applied verbatim to the <th> and to the
   * matching <td> so both disappear together below the breakpoint.
   */
  thVisibilityClass: string;
  tdVisibilityClass: string;
  /** Fixed width in px for table-fixed layout; null = flexible (shares the remaining space with the other flexible column). */
  fixedWidthPx: number | null;
  /** Literal Tailwind width utility applied to the <th> (table-fixed reads widths from the header row). Empty for flexible columns. */
  widthClass: string;
  /** Viewport breakpoint from which the column is visible; null = always visible. */
  visibleFrom: ProviderColumnVisibility;
}

/**
 * Column layout for the AI Providers table, in display order.
 * Widths are hand-budgeted against PROVIDER_TABLE_FRAME_CAP_PX — see
 * providerTableWidthBudget() and the arithmetic tests.
 */
export const PROVIDER_TABLE_COLUMNS: ProviderTableColumn[] = [
  {
    key: "provider",
    label: "Provider",
    thVisibilityClass: "",
    tdVisibilityClass: "",
    fixedWidthPx: null, // flexible
    widthClass: "",
    visibleFrom: null,
  },
  {
    key: "type",
    label: "Type",
    thVisibilityClass: "hidden 2xl:table-cell",
    tdVisibilityClass: "hidden 2xl:table-cell",
    fixedWidthPx: 72,
    widthClass: "w-[72px]",
    visibleFrom: "2xl",
  },
  {
    key: "baseUrl",
    label: "Base URL",
    thVisibilityClass: "hidden 2xl:table-cell",
    tdVisibilityClass: "hidden 2xl:table-cell",
    fixedWidthPx: 160,
    widthClass: "w-[160px]",
    visibleFrom: "2xl",
  },
  {
    key: "model",
    label: "Model",
    thVisibilityClass: "",
    tdVisibilityClass: "",
    fixedWidthPx: null, // flexible
    widthClass: "",
    visibleFrom: null,
  },
  {
    key: "status",
    label: "Status",
    thVisibilityClass: "",
    tdVisibilityClass: "",
    fixedWidthPx: 80,
    widthClass: "w-20",
    visibleFrom: null,
  },
  {
    key: "priority",
    label: "Priority",
    thVisibilityClass: "hidden xl:table-cell",
    tdVisibilityClass: "hidden xl:table-cell",
    fixedWidthPx: 56,
    widthClass: "w-14",
    visibleFrom: "xl",
  },
  {
    key: "concurrency",
    label: "Concurrency",
    thVisibilityClass: "",
    tdVisibilityClass: "",
    fixedWidthPx: 112,
    widthClass: "w-28",
    visibleFrom: null,
  },
  {
    key: "requests",
    label: "Requests",
    thVisibilityClass: "hidden xl:table-cell",
    tdVisibilityClass: "hidden xl:table-cell",
    fixedWidthPx: 64,
    widthClass: "w-16",
    visibleFrom: "xl",
  },
  {
    key: "lastUsed",
    label: "Last used",
    thVisibilityClass: "hidden xl:table-cell",
    tdVisibilityClass: "hidden xl:table-cell",
    fixedWidthPx: 72,
    widthClass: "w-[72px]",
    visibleFrom: "xl",
  },
  {
    key: "actions",
    label: "Actions",
    thVisibilityClass: "",
    tdVisibilityClass: "",
    // 6 × 24px icon buttons + 5 × 2px gaps (gap-0.5) + 24px cell padding
    fixedWidthPx: 184,
    widthClass: "w-[184px]",
    visibleFrom: null,
  },
];

export type ProviderTableTier = "base" | "xl" | "2xl";

/** Tailwind viewport widths for the disclosure breakpoints. */
const TIER_VIEWPORT_PX: Record<Exclude<ProviderColumnVisibility, null>, number> = {
  xl: 1280,
  "2xl": 1536,
};

/**
 * Width budget for a disclosure tier. `base` models any viewport below xl —
 * the conservative case (narrowest realistic desktop frame ≈ 1024px minus
 * sidebar, but the arithmetic below checks against the frame cap, which is
 * only reached at 2xl; smaller viewports simply show fewer columns and
 * table-fixed clamps the rest).
 */
export function providerTableWidthBudget(tier: ProviderTableTier): {
  visibleColumns: number;
  fixedPx: number;
  paddingPx: number;
  flexibleColumns: number;
} {
  // A column is visible in this tier when its breakpoint ≤ the tier's viewport
  // (base = 0 → only the always-visible core set).
  const tierViewport = tier === "base" ? 0 : TIER_VIEWPORT_PX[tier];
  const visibleColumns = PROVIDER_TABLE_COLUMNS.filter(
    (c) => c.visibleFrom === null || TIER_VIEWPORT_PX[c.visibleFrom] <= tierViewport
  );
  const fixedPx = visibleColumns.reduce((sum, c) => sum + (c.fixedWidthPx ?? 0), 0);
  return {
    visibleColumns: visibleColumns.length,
    fixedPx,
    paddingPx: visibleColumns.length * PROVIDER_TABLE_CELL_PADDING_PX,
    flexibleColumns: visibleColumns.filter((c) => c.fixedWidthPx === null).length,
  };
}
