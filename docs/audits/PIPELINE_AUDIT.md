# PIPELINE AUDIT — Render Pipeline Mapping
## Date: 2026-06-30

## Summary

This document maps every render path in ResumeAI Pro, identifying where
ResumeData is transformed and how each renderer consumes its input.

## The Canonical Pipeline

```
Parser → ResumeData
  │
  ▼
assembleResume(sourceResume, optimizerOutput) → ResumeData
  │  Source fields: name, contact, experience[].company/title/location/dates,
  │                 education[], languages[], certifications[]
  │  Optimizer fields: summary, headline, skills[], experience[].bullets
  │
  ▼
finalizeResume(resume, sourceResume) → ResumeData
  │  Grammar cleanup, locked entity restore, deduplication
  │
  ▼
toRenderDocument(resume, layout) → RenderDocument ◄── SINGLE SOURCE OF TRUTH
  │  Sections: professionalProfile, professionalExperience, education,
  │  skills, languages, additionalInformation, dynamicSections
  │
  ├──► RenderDocumentPreview (React — Preview tab)
  ├──► exportResumeDOCXRenderDoc(rd) → DOCX Blob
  └──► exportResumePDFRenderDoc(rd) → PDF
```

## All Render Paths

### Path 1: A4Preview (Builder Preview)
| Step | File | Transforms? |
|------|------|-------------|
| 1. | A4Preview.tsx | Dispatches to TEMPLATE_MAP[resume.template] |
| 2a. | 13 React template components | **YES** — each reads ResumeData directly with own rendering |
| 2b. | **RenderDocumentPreview** (NEW) | **NO** — reads RenderDocument (same as export) |

**Verdict**: 2b is the SSOT-correct path. 2a is legacy and should be phased out.

### Path 2: DOCX Export
| Step | File | Transforms? |
|------|------|-------------|
| 1. | exporter.ts → exportResumeDOCX() | Export Gate (validation only) |
| 2. | render-document.ts → toRenderDocument() | **YES** — canonical ResumeData→RenderDocument conversion |
| 3. | export-docx-render.ts → exportResumeDOCXRenderDoc() | **NO** — renders sections from RenderDocument |

**Verdict**: SSOT-correct. Uses RenderDocument.

### Path 3: PDF Export (standard)
| Step | File | Transforms? |
|------|------|-------------|
| 1. | exporter.ts → exportResumePDF() | Export Gate (validation only) |
| 2. | render-document.ts → toRenderDocument() | **YES** — canonical ResumeData→RenderDocument conversion |
| 3. | export-pdf-render.ts → exportResumePDFRenderDoc() | **NO** — renders sections from RenderDocument |

**Verdict**: SSOT-correct. Uses RenderDocument.

### Path 4: PDF Export (infohas-pro legacy)
| Step | File | Transforms? |
|------|------|-------------|
| 1. | exporter.ts → exportInfohasProPDF() | **YES** — reads ResumeData directly into jsPDF with its own layout |

**Verdict**: DEPRECATED. Does NOT use RenderDocument.

### Path 5: TXT Export
| Step | File | Transforms? |
|------|------|-------------|
| 1. | exporter.ts → exportResumeTXT() | **YES** — reads ResumeData directly into plain text |

**Verdict**: DEPRECATED. Does NOT use RenderDocument.

### Path 6: HTML / DOC Export
| Step | File | Transforms? |
|------|------|-------------|
| 1. | ats-directives.ts → resumeToDirectiveHtml() | **YES** — reads ResumeData directly into HTML |
| 2. | exporter.ts → exportResumeDOC() | applies DOC wrapper template |

**Verdict**: DEPRECATED. Does NOT use RenderDocument.

## Transformations Found

| File | Function | What it changes |
|------|----------|----------------|
| render-document.ts | toRenderDocument() | ResumeData→RenderDocument (canonical, OK) |
| render-document.ts | buildSkillsSection() | Skills: groups by category, parses colons |
| render-document.ts | buildLanguagesSection() | Languages: name-proficiency format |
| render-document.ts | buildDynamicSections() | Dynamic sections→RenderContentItems |
| resume-assembler.ts | assembleResume() | Merges source+optimizer (canonical, OK) |
| unified-pipeline.ts | finalizeResume() | Grammar cleanup, deduplication (canonical, OK) |
| exporter.ts | exportResumeTXT() | ResumeData→plain text (DEPRECATED) |
| exporter.ts | exportInfohasProPDF() | ResumeData→jsPDF (DEPRECATED) |
| ats-directives.ts | resumeToDirectiveHtml() | ResumeData→HTML (DEPRECATED) |

## Recommendations

1. **Convert A4Preview to use RenderDocument by default** — set `useRenderDocument={true}` everywhere in the Builder. The `useRenderDocument` prop is the migration path. Once all users confirm parity, remove the legacy template path.

2. **Convert infohas-pro PDF** to use RenderDocument like the standard PDF path.

3. **Convert TXT/HTML/DOC exports** to convert from RenderDocument instead of ResumeData directly.

4. **Add section hash to CI** — the `compareSectionHashes()` function should be called in tests to verify render parity across all renderers.
