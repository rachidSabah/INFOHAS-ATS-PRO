# EXPORT ARCHITECTURE AUDIT — Phase 5

**Date:** 2026-06-30  
**Branch:** phase5/enterprise-export-engine  
**Auditor:** Lead Software Architect / Rendering Engine Specialist

## 1. CURRENT ARCHITECTURE MAP

```
ResumeData (types.ts)
    │
    ├──► render-document.ts ───────► RenderDocument ────► Preview (RenderDocumentPreview.tsx)
    │                                                   └──► DOCX (export-docx-render.ts)
    │                                                   └──► PDF (export-pdf-render.ts)
    │
    ├──► render-engine.ts ────────► CanonicalResume ──► RenderNode[] (NO CONSUMER)
    │        (Phase 3)               │
    │                                └──► LayoutEngine ──► positioned RenderNode[]
    │
    └──► exporter.ts ─────────────► buildResumeHtml() ──► PDF (HTML→jsPDF)
                                   │                 └──► DOCX (docx library)
                                   │
                                   └──► exportResumeDOCX() ──► .docx Blob
                                   └──► exportResumePDF()  ──► .pdf Blob
```

## 2. THREE INTERMEDIATE FORMATS (THE CORE PROBLEM)

### Format A: `RenderDocument` (legacy, from render-document.ts)
- **Used by:** Preview (RenderDocumentPreview.tsx), DOCX (export-docx-render.ts), PDF (export-pdf-render.ts)
- **Type location:** `types.ts` ≈ 1241–1253
- **Sections type:** `RenderDocumentSection` with `RenderContentItem` (text, bullets, nested-bullets, table-row)
- **LIMITATIONS:**
  - No photo/image support
  - No footer support
  - No section dividers
  - No column layout
  - No page-level constructs
  - RenderNode-type positions missing
  - `toRenderDocument()` transforms ResumeData directly

### Format B: `RenderNode[]` (Phase 3, from types-phase3.ts)
- **Used by:** render-engine.ts only (NO renderer consumes it)
- **Type location:** `types-phase3.ts` lines 17–80
- **Node types:** document, page, header, contact-line, section, section-title, text-line, bullet-list, bullet-item, table-row, table-cell, nested-group, nested-group-label, nested-group-item, divider, page-break
- **LIMITATIONS:**
  - No photo/image node type
  - No footer node type
  - No dynamic section representation
  - Node styles have no column/width fraction
  - Position is nullable (layout may not have run)
  - No metadata for section types

### Format C: `buildResumeHtml()` (exporter.ts, ad-hoc)
- **Used by:** `exportResumePDF()` in exporter.ts
- **Directly emits HTML** from ResumeData — no intermediate representation at all
- **LIMITATIONS:**
  - Completely duplicated rendering logic
  - No reusability
  - Hard-coded A4 dimensions
  - No photo support
  - No dynamic sections support in the HTML path

## 3. FILE-BY-FILE ANALYSIS

### 3.1 `src/lib/exporter.ts` (1,389 lines)
**Role:** Main export orchestrator. Contains PDF (HTML→jsPDF), DOCX (docx library), and TXT export.
**Issues:**
- `buildResumeHtml()` (lines 73–≈600) builds complete HTML document from ResumeData with inline styles. Duplicates ALL section rendering logic.
- `exportResumeDOCX()` uses docx library but reads ResumeData directly, not from any intermediate format.
- `getDefaultResumeLayout()` (lines 22–63) reads from Zustand store — replicated in theme-engine.ts.
- No RenderNode or DocumentRenderTree consumption anywhere.
- Multiple section-rendering switch statements duplicated for each format.
- No shared typography — each format has its own font/size/color application.

### 3.2 `src/lib/render-engine.ts` (565 lines)
**Role:** Phase 3 — CanonicalResume → RenderNode pipeline.
**Issues:**
- Beautiful clean design, but UNUSED by any renderer.
- `canonicalResumeToRenderTree()` (lines 431–503) produces RenderNode[] but nothing consumes it.
- `renderResume()` (lines 510–565) runs the full pipeline but is never called from any exporter.
- Missing node types for photo, image, footer, dynamic sections.
- Section items limited to text, bullets, table-row, nested-bullets.

### 3.3 `src/lib/export-docx-render.ts` (193 lines)
**Role:** DOCX renderer consuming RenderDocument.
**Issues:**
- Consumes RenderDocument (Format A), NOT RenderNode (Format B).
- Duplicates typography application (font, size, color).
- No awareness of page breaks, widows, orphans.
- No photo support.

### 3.4 `src/lib/export-pdf-render.ts` (242 lines)
**Role:** PDF renderer consuming RenderDocument.
**Issues:**
- Consumes RenderDocument (Format A), NOT RenderNode (Format B).
- Duplicates typography application.
- Inline `hexToRgb()` — typos (`hexToRgb` string "hex").
- Hardcoded "times" font — no theme-based font selection.
- No photo support.
- No page break awareness.

### 3.5 `src/lib/render-document.ts`
**Role:** Builds RenderDocument from ResumeData.
**Issues:**
- Legacy format created before Phase 3 RenderNode existed.
- Should be DEPRECATED in favor of render-engine.ts → RenderNode.

### 3.6 `src/lib/theme-engine.ts`
**Role:** Builds ResumeTheme from template + overrides.
**Status:** Partially good — theme is well-defined. But still separate from layout model in `getDefaultResumeLayout()`.

### 3.7 `src/lib/layout-engine.ts` (213 lines)
**Role:** Page layout, positioning, overflow detection.
**Issues:**
- `estimateNodeHeightMm()` is rough (chars/75 = one line).
- No actual word-wrapping measurement — only estimation.
- No widows/orphans control.
- No `keepWithNext` / `keepTogether` support.
- Photography not accounted for.

### 3.8 Preview Components
- `A4Preview.tsx` — uses `toRenderDocument()` then passes to `RenderDocumentPreview`
- `RenderDocumentPreview.tsx` — renders RenderDocument as React JSX
- `RenderNodePreview.tsx` — renders RenderNode tree as React JSX (Phase 3, but only in preview)
- **None uses the same rendering path as the export pipeline.**

## 4. GAPS ANALYSIS

| Feature | Preview | DOCX | PDF | RenderNode |
|---------|---------|------|-----|------------|
| Name/Header | ✅ | ✅ | ✅ | ✅ |
| Contact line | ✅ | ✅ | ✅ | ✅ |
| Section title | ✅ | ✅ | ✅ | ✅ |
| Body text | ✅ | ✅ | ✅ | ✅ |
| Bullets | ✅ | ✅ | ✅ | ✅ |
| Table rows | ✅ | ✅ | ✅ | ✅ |
| Nested bullets | ✅ | ✅ | ✅ | ✅ |
| Dividers | ❌ | ❌ | ❌ | ✅ |
| Photo | ❌ | ❌ | ❌ | ❌ |
| Footer | ❌ | ❌ | ❌ | ❌ |
| Page breaks | ❌ | ❌ | ❌ | ❌ |
| Dynamic sections | ❌ | ❌ | ❌ | ✅ |
| Additional info | ❌ | ❌ | ❌ | ✅ |
| Skills (categorized) | ❌ | ❌ | ❌ | ✅ |
| Widows/orphans | ❌ | ❌ | ❌ | ❌ |
| Columns | ❌ | ❌ | ❌ | ❌ |
| Font matching | Partial | Partial | Partial | ✅ |
| Margin matching | Partial | ✅ | ✅ | ✅ |
| Layout calc shared | ❌ | ❌ | ❌ | N/A |

## 5. DUPLICATION COUNT
- **3 independent section-renderer switch statements** (exporter.ts HTML, exporter.ts DOCX, export-docx-render.ts)
- **2 independent layout calculations** (exporter.ts margins, layout-engine.ts)
- **3 independent typography applications** (exporter.ts inline styles, export-docx-render.ts, export-pdf-render.ts)
- **2 intermediate formats** (RenderDocument + RenderNode)

## 6. RECOMMENDED ARCHITECTURE

```
ResumeData
    │
    ▼
buildCanonicalResume() ← render-engine.ts (Phase 3)
    │
    ▼
CanonicalResume
    │
    ▼
canonicalResumeToDocumentTree() ← NEW: DocumentRenderTree builder
    │
    ▼
  ┌─────────────────────────────────────┐
  │      DocumentRenderTree (SSOT)      │
  │  - Document node                     │
  │    ├► Page nodes                     │
  │    │  ├► Header (name, contact)      │
  │    │  ├► Sections                    │
  │    │  │  ├► ProfileRenderer          │
  │    │  │  ├► ExperienceRenderer       │
  │    │  │  ├► EducationRenderer        │
  │    │  │  ├► SkillsRenderer           │
  │    │  │  ├► LanguagesRenderer        │
  │    │  │  ├► CertificationsRenderer   │
  │    │  │  ├► ProjectsRenderer         │
  │    │  │  ├► AchievementsRenderer     │
  │    │  │  ├► AdditionalInfoRenderer   │
  │    │  │  └► DynamicSectionRenderer   │
  │    │  ├► Photo (top-right)           │
  │    │  ├► Divider                     │
  │    │  ├► Table                       │
  │    │  └► Footer                      │
  |    └─► Paginated pages               │
  └─────────────────────────────────────┘
    │         │            │
    ▼         ▼            ▼
 Preview   DOCX          PDF
 (React)   (docx lib)    (jsPDF)
```

## 7. KEY DESIGN DECISIONS

1. **Extend RenderNode** (Phase 3) rather than creating yet another format.
2. **Add missing node types**: photo, image, footer, page-break, spacer, table (proper).
3. **TypographyEngine** — single source for font, size, color, spacing across all renderers.
4. **LayoutEngine** — single source for margins, columns, pagination, widows/orphans.
5. **SectionRenderers** — each section type knows how to emit RenderNodes. Registered by section type.
6. **PaginationEngine** — page-splitting logic shared across all outputs.
7. **PhotoEngine** — crop, resize, placement.
8. **Preview rewrites** to consume RenderNode tree, NOT RenderDocument.
9. **exporter.ts refactored** — Replace inline HTML builder with unified tree→format translators.
10. **DOCX/PDF translators** consume DocumentRenderTree, not ResumeData.

## 8. FILES TO CREATE
- `src/lib/document-render-tree/types.ts` — Enhanced RenderNode with photo, footer, image
- `src/lib/document-render-tree/typography-engine.ts` — Single typography source
- `src/lib/document-render-tree/layout-engine.ts` — Enhanced layout with pagination
- `src/lib/document-render-tree/pagination-engine.ts` — Page splitting logic
- `src/lib/document-render-tree/photo-engine.ts` — Photo cropping/placement
- `src/lib/document-render-tree/section-renderers/` — One per section type
- `src/lib/document-render-tree/document-tree-builder.ts` — CanonicalResume → DocumentRenderTree
- `src/lib/document-render-tree/docx-translator.ts` — DocumentRenderTree → DOCX
- `src/lib/document-render-tree/pdf-translator.ts` — DocumentRenderTree → PDF
- `src/lib/document-render-tree/preview-renderer.tsx` — DocumentRenderTree → React
- `src/lib/document-render-tree/index.ts` — Barrel export

## 9. FILES TO MODIFY
- `src/lib/render-engine.ts` — Add document tree builder, deprecate old export
- `src/components/resume/A4Preview.tsx` — Use DocumentRenderTree
- `src/components/resume/RenderNodePreview.tsx` — Extend for new node types
- `src/lib/exporter.ts` — Replace section rendering with translator calls
- `src/lib/export-docx-render.ts` — Replace with DocumentRenderTree translator
- `src/lib/export-pdf-render.ts` — Replace with DocumentRenderTree translator

## 10. FILES UNCHANGED (per Phase 5 constraints)
- Parser, Blueprint, Guardian, Supervisor, ATS Engine, Optimizer
- AI providers, Provider routing
- Fingerprint system
- Resume optimization logic

---

*End of Export Architecture Audit*
