# Phase 3 — Canonical Resume Rendering Engine
## Architecture Report
## Date: 2026-06-30

---

## Overview

Phase 3 establishes a **Canonical Resume Rendering Engine** where every visual
representation of a resume (Preview, DOCX, PDF, HTML, TXT) originates from one
immutable object — the **CanonicalResume** — through a single **ResumeRenderEngine**
that produces a **RenderNode[]** tree consumed identically by all renderers.

---

## Architecture

```
ResumeData
    │
    ▼
┌─────────────────────────────────────────┐
│  buildCanonicalResume()                  │  ← only place CanonicalResume is created
│  - validates                             │
│  - normalizes section order              │
│  - applies theme                         │
│  - preserves every section               │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│  CanonicalResume — Single Source of Truth │
│  - sections[] in display order            │
│  - resolved theme                         │
│  - validation state                       │
└─────────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────────┐
│  canonicalResumeToRenderTree()           │  ← only place RenderNode[] is created
│  - each section → typed nodes            │
│  - theme applied as node styles          │
│  - every node has: id, type, style,      │
│    visibility, position, content         │
└─────────────────────────────────────────┘
    │
    ├──► RenderNodePreview — A4 preview
    ├──► export-docx-render — DOCX
    ├──► export-pdf-render — PDF
    ├──► export-html-render — HTML
    └──► export-txt-render — TXT
```

---

## New Files

| File | Lines | Purpose |
|------|-------|---------|
| `src/lib/types-phase3.ts` | 270+ | `CanonicalResume`, `RenderNode`, `ResumeTheme`, engine types |
| `src/lib/theme-engine.ts` | 160 | `buildTheme()` — resolves theme from template + layout |
| `src/lib/layout-engine.ts` | 170 | Page layout, overflow detection, node positioning |
| `src/lib/one-page-validator.ts` | 140 | Progressive compression (4 levels, no content removal) |
| `src/lib/render-engine.ts` | 565 | `buildCanonicalResume()`, `canonicalResumeToRenderTree()`, `renderResume()` |
| `src/components/resume/RenderNodePreview.tsx` | 200+ | React component rendering RenderNode[] tree |
| `src/lib/__tests__/render-engine.test.ts` | 490+ | 37 snapshot tests for the full pipeline |

---

## Engine Components

### CanonicalResume (`types-phase3.ts`)
```
{
  id, name, headline, contact,
  sections: [{
    id, type, title, order,
    items: text | bullets | table-row | nested-bullets,
    originalEntityCount, originalBulletCount, isDynamic
  }],
  theme, template,
  isValid, validationErrors
}
```

### RenderNode (`types-phase3.ts`)
```
{
  id: string,              // uniquely generated (rn-N)
  type: RenderNodeType,    // document | section-title | text-line | bullet-item | ...
  parentId: string | null,
  children: RenderNode[],  // sub-nodes (future tree support)
  content: string,         // display text
  style: { fontFamily, fontSizePt, bold, color, margin*, padding* },
  visibility: "visible" | "hidden" | "collapsed",
  position: { page, order, xMm, yMm, widthMm, heightMm } | null,
  metadata?: Record<string, unknown>
}
```

### ResumeTheme (`types-phase3.ts`)
Resolved theme with:
- **Typography**: fontFamily, nameSizePt, sectionTitleSizePt, bodyFontSizePt, minFontSizePt, lineHeight
- **Colors**: nameColor, sectionTitleColor, bodyTextColor, accentColor, backgroundColor
- **Spacing**: sectionGapMm, headerGapMm, bulletIndentMm, paragraphSpacingMm, margins
- **Layout**: pageSize (A4/Letter), columns, enforceOnePage
- **Visual**: showDividers, borderStyle, iconStyle (bullet/checkmark/arrow)

### ThemeEngine (`theme-engine.ts`)
- `buildTheme(template, accentColor?, layout?)` → full `ResumeTheme`
- Template-specific icon styles: modern=checkmark, creative=arrow, standard=bullet
- Template-specific dividers: executive/corporate/academic/consulting=true

### LayoutEngine (`layout-engine.ts`)
- `createPageLayout(page#, theme)` — calculates A4/Letter dimensions
- `estimateNodeHeightMm(node, width, theme)` — per-node type height estimation
- `layoutNodes(nodes, theme)` — positions all nodes across pages, detects overflow
- `detectOverflow(estimatedMm, theme)` — binary overflow check
- `suggestCompression(overflowMm, theme)` — suggests spacing/font reduction steps

### OnePageValidator (`one-page-validator.ts`)
4-level progressive compression system:
- **Level 0**: default (4.2mm line, 3mm section gap, 10pt font)
- **Level 1**: reduced line spacing (3.7mm)
- **Level 2**: reduced section gaps (2mm) + tighter margins
- **Level 3**: compact margins (4mm) + 9pt font
- **Level 4**: minimum font (8pt) + tightest spacing
- **Never removes content** — only adjusts spacing and font size
- `compressToOnePage(chars, theme)` → `CompressionResult` with steps applied
- `applyCompression(theme, result)` → adjusted `ResumeTheme`

### ResumeRenderEngine (`render-engine.ts`)
Full pipeline entry point:
```
renderResume(resumeData, themeOverrides?) → RenderEngineResult
{
  canonicalResume: CanonicalResume,  // validated SSOT
  renderTree: RenderNode[],          // render tree (layout before positioning)
  layout: LayoutResult,              // positioned pages
  theme: ResumeTheme,                // resolved theme
  warnings: string[],                // compression warnings, validation
}
```

---

## Render Rules (Contract)

**Do NOT:**
- Merge, repair, deduplicate, restore, optimize, compress content
- Rebuild, modify, sort sections
- Change bullets, dates, or order
- Reference AI output, temporary state, or editor state directly

**DO:**
- Consume only `CanonicalResume` or `RenderNode[]`
- Validate section hashes before export
- Apply theme styling consistently
- Render exactly what the input specifies

---

## Test Coverage

**37 Phase 3 tests**, all passing:

- `buildCanonicalResume` (9 tests)
  - Creates from ResumeData correctly
  - Builds sections in correct order
  - Preserves experience, education, languages
  - Preserves dynamic sections, additional info
  - Validates missing name
  - Returns empty sections for empty resume

- `canonicalResumeToRenderTree` (6 tests)
  - Produces flat RenderNode array
  - Always has document root
  - Creates header, section-title, bullet-item, nested-group nodes
  - Assigns unique IDs
  - Handles empty resume

- `renderResume` full pipeline (4 tests)
  - Complete without errors
  - Produces layout result
  - Usable page dimensions
  - One-page compression when needed

- `buildTheme` (4 tests)
  - Default values, iconStyle per template, divider per template, layout overrides

- `createPageLayout`, `estimateTotalHeightMm`, `detectOverflow`, `suggestCompression`

- `compressToOnePage`, `applyCompression`

- **Section hash parity** (2 critical tests)
  - RenderNode tree produces same section content as RenderDocument
  - Rendered section count matches canonical section count

---

## Full Regression

**874 tests pass** (49 files, up from 837/48 before Phase 3)
Zero regressions in existing codebase.

---

## Remaining Work

1. **Wire `useRenderDocument={true}` into Builder UI** — enable the new SSOT preview in the app
2. **Update DOCX/PDF/TXT/HTML exporters** to consume `RenderNode[]` directly (currently use `RenderDocument`)
3. **Add section-hash CI gate** — abort export on hash mismatch
4. **Migrate all 13 legacy template components** to RenderNode pipeline
