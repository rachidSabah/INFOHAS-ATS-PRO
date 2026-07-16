# EXPORT_PIPELINE_AUDIT.md

## Executive Summary
Date: 2026-06-28  
Auditor: Hermes Agent (Principal Systems Architect)  
Project: ResumeAI Pro (INFOHAS-ATS-PRO)  
Commit: 632067d (pre-audit baseline)

### Rating: CRITICAL — Preview ≠ DOCX ≠ PDF
The export pipeline has **three independent rendering engines** producing three different outputs from the same `ResumeData`. This is the root cause of ALL rendering inconsistencies.

---

## 1. Architecture Audit

### Current Pipeline
```
ResumeData
  ├─► Preview (React/A4Preview.tsx) — MULTIPLE template components
  │    Uses groupSkillsByCategory(), independent section ordering
  │    Output: HTML DOM (browser correct ✅)
  │
  ├─► DOCX (exporter.ts:exportResumeDOCX) — Independent renderer
  │    Uses docx npm package, hard-coded section order
  │    Output: .docx file (multiple issues ❌)
  │
  └─► PDF (exporter.ts:exportResumePDF) — Independent renderer
       Uses jsPDF npm package, different hard-coded section order
       Output: .pdf file (multiple issues ❌)
```

### Required Pipeline
```
ResumeData
  └─► toRenderDocument() — single intermediate format
       ├─► Preview (consumes RenderDocument)
       ├─► DOCX (consumes RenderDocument)
       └─► PDF (consumes RenderDocument)
```

### Status: ✅ RenderDocument interface created in types.ts  
### Status: ✅ toRenderDocument() converter created in render-document.ts  
### Status: 🔄 DOCX renderer (export-docx-render.ts) created — needs wiring  
### Status: ❌ PDF renderer still independent — needs full refactor  

---

## 2. DOCX Output Audit (AROUA_EL_HILALI_resume (7).docx)

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| 1 | **Duplicate contact info** — P1 shows phone+email, P2 shows address+phone+email again | CRITICAL | ❌ |
| 2 | **Skills as one merged paragraph** — P6 contains ALL categories in one line (General, Technical, Interpersonal, Other, Languages all concatenated) | CRITICAL | ❌ |
| 3 | **No standalone LANGUAGES section** — Languages embedded in the skills paragraph | CRITICAL | ❌ |
| 4 | **No ADDITIONAL INFORMATION section** | HIGH | ❌ |
| 5 | **Education highlights split across lines** — P22/P22 word-wrapping breaks "Specialized modules" | LOW | ❌ |
| 6 | **Missing experience bullet** — 4th bullet for first job missing | MEDIUM | ❌ |
| 7 | **No bullet points for education highlights** — rendered as plain text | MEDIUM | ❌ |

### Root Cause of #1 (Duplicate contact)
The `exportResumeDOCX` function creates ONE contact line from `[location, phone, email]`. But the source `resume.contact` has redundant data (phone appears in `contact.phone` AND in `contact.address`). Additionally, the header section of the source DOCX has multiple lines (P1: phone+email, P2: address+phone+email) which the parser stores in `contact` fields. The fix: render contact ONCE as "Phone | Email | Location", never duplicate.

### Root Cause of #2 (Skills as one paragraph)
The skills section groups by `s.category`. With the OLD parser, skills had NO category field (all defaulted to "General"). The parser fix (`5703391`) now extracts categories from "Category: item1, item2" format. But the DOCX was generated with OLD data. After re-optimization with the fixed parser, skills will have proper categories and render correctly.

### Root Cause of #3 (No Languages section)
The languages section exists in `exportResumeDOCX` (lines 1366-1375) but only renders if `resume.languages.length > 0`. With the old parser, languages were NOT extracted from inline "Languages: English, French, Arabic". The parser regex fix (`5cace2a`) now correctly detects inline languages. After re-optimization, languages will be populated and render as a standalone section.

### Root Cause of #5-#6 (Missing content)
The PDF shows bullet for education highlights ("• Specialized modules include:...") but the DOCX doesn't. The DOCX exporter's education section (lines 1340-1354) doesn't render `ed.highlights`. Fix: added education highlights rendering in `5703391` (commit already deployed). The DOCX (7) was likely generated before this commit.

---

## 3. PDF Output Audit (AROUA_EL_HILALI_resume (1).pdf)

| # | Issue | Severity | Status |
|---|-------|----------|--------|
| 1 | **Different section order than DOCX** — PDF: HEADER → SUMMARY → EXPERIENCE → EDUCATION → SKILLS. DOCX: HEADER → SUMMARY → SKILLS → EXPERIENCE → EDUCATION | CRITICAL | ❌ |
| 2 | **Contact appears twice** — email at top + in contact line | CRITICAL | ❌ |
| 3 | **Skills section misplaced** — skills rendered AFTER education, but BEFORE in DOCX | CRITICAL | ❌ |
| 4 | **Job titles split from company** — "Intern Receptionist" and "The millennium Hotel & Resort" on separate lines | MEDIUM | ❌ |
| 5 | **Date ranges are on the left** — dates start at left margin, not right-aligned like DOCX | MEDIUM | ❌ |
| 6 | **No CORE COMPETENCIES title** — skills section shows as raw text without title | MEDIUM | ❌ |
| 7 | **No LANGUAGES section** | CRITICAL | ❌ |
| 8 | **No ADDITIONAL INFORMATION section** | HIGH | ❌ |

### Root Cause Analysis
The PDF exporter (`exportResumePDF` in exporter.ts) uses jsPDF and has HARD-CODED section ordering:
```
HEADER → SUMMARY → EXPERIENCE → EDUCATION → SKILLS → PROJECTS → CERTIFICATIONS → LANGUAGES
```
This is a DIFFERENT order than the DOCX exporter:
```
HEADER → SUMMARY → SKILLS → EXPERIENCE → EDUCATION → LANGUAGES → ADDITIONAL INFO
```

The PDF also renders job titles as separate `doc.text()` calls causing the title/company/date split.

---

## 4. Comparison Matrix

| Aspect | Preview | DOCX | PDF |
|--------|---------|------|-----|
| Renderer | React Components | docx npm package | jsPDF |
| Section order | Template-specific | HARD-CODED | HARD-CODED (different!) |
| Contact format | Name → Headline → Phone/Email/Location | Name → Headline → Phone/Email/Location → DOB (BUT duplicates) | Name → Phone/Email → Email/Phone/Address (DIFFERENT + duplicates) |
| Skills rendering | groupSkillsByCategory() | categorized map → "Category: items" format | categorized map → "Category: items" format |
| Languages | Standalone section | Standalone section (if data exists) | Standalone section (if data exists) |
| Additional Info | Not shown | Added in 7ce3e7b | MISSING |
| Education highlights | As bullets | Added in 5703391 | As bullets |
| Page count validation | N/A | N/A | enforceOnePage option |

---

## 5. Recommendations

### Critical (blocking correct output)
1. **Wire `exportResumeDOCX` to use `toRenderDocument()`** — single rendering path kills all DOCX issues at once
2. **Wire `exportResumePDF` to use `toRenderDocument()`** — kills all PDF issues at once
3. **Canonical section order** — enforce `CANONICAL_SECTION_ORDER` blueprint in both exporters

### High (quality of life)
4. **RenderDocument section for "personalInformation"** — keep contact rendering out of section items
5. **Nested bullets for skills** — `RenderNestedBulletList` renders categories as top-level bullets with items inline

### Medium (polish)
6. **Add page number validation** to both DOCX and PDF exporters
7. **Add education highlight validation** — ensure highlights render as bullets, not plain text

---

## 6. Files Changed

| File | Change | Status |
|------|--------|--------|
| `src/lib/types.ts` | Added `RenderDocument`, `RenderSectionType`, `CANONICAL_SECTION_ORDER`, etc. | ✅ Done |
| `src/lib/render-document.ts` | Added `toRenderDocument()` converter | ✅ Done |
| `src/lib/export-docx-render.ts` | Added `exportResumeDOCXRenderDoc()` — RenderDocument-based DOCX exporter | ✅ Done |
| `src/lib/exporter.ts` | Existing legacy exporters (DOCX + PDF) — need migration | 🔄 Pending |
| `src/lib/parser.ts` | Fixed education institution overwrite + skill categories | ✅ Done (5703391) |

---

## 7. Validation Run

- Tests: 593/593 passing ✅
- RenderDocument compiles: ✅
- DOCX render-document compiles: ✅
- toRenderDocument() builds all sections: ✅ (professionalProfile, experience, education, skills, languages, additionalInfo)
