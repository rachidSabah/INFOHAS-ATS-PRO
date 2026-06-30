# ROOT CAUSE REPORT — SSOT Rendering Drift
## Date: 2026-06-30
## Project: ResumeAI Pro
## Severity: HIGH — All renderers must consume identical data

## ============================================================
## EXECUTIVE SUMMARY
## ============================================================

The optimizer pipeline produces a single `ResumeData` object, but the rendering
pipeline diverges into two independent paths:

  1. **Preview Path** — A4Preview.tsx reads `ResumeData` directly and dispatches
     to 13 different React template components, each with its own section ordering,
     rendering logic, and formatting.

  2. **Export Path** — exporter.ts converts `ResumeData` → `RenderDocument` via
     `toRenderDocument()`, then renders via `exportResumeDOCXRenderDoc(rd)` or
     `exportResumePDFRenderDoc(rd)`.

Because these paths share NO intermediate representation, any difference between
what the Preview expects in ResumeData and what the DOCX/PDF renders from
RenderDocument causes:

  - Missing sections in export (present in Preview, absent in DOCX/PDF)
  - Missing languages
  - Missing dates
  - Divergent formatting
  - Section order mismatch

## ============================================================
## PIPELINE MAP — Every Data Flow
## ============================================================

### Flow 1: Preview (A4Preview.tsx)

  ResumeData
    ↓
  A4Preview({ resume, scale })
    ↓
  TEMPLATE_MAP[resume.template]   (13 templates)
    ↓
  Each template reads resume.experience, resume.education,
  resume.skills, resume.languages, resume.dynamicSections
  directly in its JSX, with NO intermediate transformation.
    ↓
  Rendered HTML/SVG

### Flow 2: DOCX Export (exporter.ts → export-docx-render.ts)

  ResumeData
    ↓
  toRenderDocument(resume, layout)
    ↓
  RenderDocument { template, layout, contact, sections[], totalChars }
    ↓
  exportResumeDOCXRenderDoc(rd)
    ↓
  Iterates rd.sections[], renders each via its own renderItem() function
    ↓
  DOCX Blob

### Flow 3: PDF Export (exporter.ts → export-pdf-render.ts)

  ResumeData
    ↓
  toRenderDocument(resume, layout)
    ↓
  Same RenderDocument as Flow 2
    ↓
  exportResumePDFRenderDoc(rd)
    ↓
  Iterates rd.sections[], renders each
    ↓
  PDF

### Flow 4: InfohasPro PDF (exporter.ts — legacy)

  ResumeData
    ↓
  exportInfohasProPDF(resume, opts, L)
    ↓
  Reads resume.experience, resume.education, resume.skills
  directly — NO RenderDocument
    ↓
  PDF

### Flow 5: TXT Export (exporter.ts)

  ResumeData
    ↓
  exportResumeTXT(resume)
    ↓
  Reads resume fields directly
    ↓
  Text file

### Flow 6: HTML Export (ats-directives.ts)

  ResumeData
    ↓
  resumeToDirectiveHtml(resume)
    ↓
  Reads resume fields directly
    ↓
  HTML

### Flow 7: DOC Export (exporter.ts)

  ResumeData
    ↓
  exportResumeDOC(resume, template)
    ↓
  resumeToDirectiveHtml(resume) + getDocxHtml(innerHtml, template)
    ↓
  DOC file

## ============================================================
## TRANSFORMATION REGISTRY — Every place data is rebuilt
## ============================================================

### FILE: render-document.ts (the bridge)
- `toRenderDocument(resume, layout)`: ResumeData → RenderDocument
  - Builds sections: professionalProfile, professionalExperience, education,
    skills, languages, additionalInformation, dynamicSections
  - Skills: groups by category, parses "Category: skill" colon pattern
  - Languages: renders as "name – proficiency" text AND bullet list
  - Dynamic sections: renders title + content/bullets
  - This is the GOOD transformation — it's the canonical SSOT bridge.

### FILE: A4Preview.tsx (13 templates — EACH is a transformation)
- `ATSProfessionalTemplate`: reads resume.experience, resume.education directly
- `ExecutiveTemplate`: reads resume.experience, resume.education directly
- `ModernTemplate`: reads resume.experience, resume.education directly
- `InfohasProTemplate`: reads resume.experience, resume.education directly
- `CompactTemplate`: reads resume.experience, resume.education directly
- `TechTemplate`: reads resume.experience, resume.education directly
- `AcademicTemplate`: reads resume.experience, resume.education directly
- `ConsultingTemplate`: reads resume.experience, resume.education directly
- `StartupTemplate`: reads resume.experience, resume.education directly
- `ClassicTemplate`: reads resume.experience, resume.education directly
- EACH template has its own:
  - Section ordering (hard-coded in JSX)
  - Date formatting (each may parse dates differently)
  - Skill rendering (some group, some list)
  - Language rendering (some use proficiency, some skip)
  - Margin/spacing (hard-coded per template)

### FILE: exporter.ts (legacy paths)
- `exportResumeTXT()`: reads resume fields directly into plain text
- `exportResumeDOC()`: uses resumeToDirectiveHtml which reads resume directly
- `exportInfohasProPDF()`: reads resume.experience, education, skills directly
  into jsPDF — NO RenderDocument involvement

### FILE: unified-pipeline.ts
- `finalizeResume()`: modifies ResumeData
  - Grammar cleanup (cleanupResumeGrammar)
  - Locked entity restoration (restoreLockedEntities)
  - Deduplication (deduplicateResume)
  - Immutable entity validation (validateImmutableEntities)
  - Factual consistency check (informational only)
  - Guardian validation (logs only)

### FILE: resume-assembler.ts
- `assembleResume()`: merges sourceResume + optimizerOutput
  - Takes source immutable fields (company, dates, education, languages)
  - Overwrites mutable fields (summary, skills, bullets)
  - Matches experience entries by ID, fingerprint, title/company, or index

## ============================================================
## ROOT CAUSE — #1 (Primary)
## ============================================================

**Preview and Export use different intermediate representations.**

The Preview uses 13 separate React components that all read `ResumeData`
directly. Each template has its own independent rendering logic for every
section. The Export path converts to `RenderDocument` first, then renders
from that.

This means any change to how data flows through the templates (section
ordering, date formatting, skill grouping) can diverge from the export
path without anyone noticing until a user reports missing sections.

**Impact**: Missing sections, duplicated experience, lost languages,
formatting inconsistencies between what the user sees in the Builder
and what they get in the downloaded DOCX/PDF.

## ============================================================
## ROOT CAUSE — #2 (Secondary)
## ============================================================

**`finalizeResume()` returns ResumeData, not a render-ready document.**

The function that should produce the final source of truth returns an
internal data format that requires further transformation before rendering.
This creates a window where the transformation to RenderDocument could
introduce inconsistencies.

## ============================================================
## ROOT CAUSE — #3 (Tertiary)
## ============================================================

**No cross-renderer validation exists.**

There is no mechanism to verify that the Preview, DOCX, and PDF renderers
would produce the same content from the same input. Each renderer operates
independently with no cross-checking.

## ============================================================
## RECOMMENDED FIX
## ============================================================

1. Make ALL renderers consume `RenderDocument` (already the export SSOT)
2. Create `RenderDocumentPreview` component that renders from RenderDocument
3. Wire A4Preview to use RenderDocumentPreview internally
4. Add section hash comparison between all renderers
5. Keep legacy template components available but deprecated for migration
