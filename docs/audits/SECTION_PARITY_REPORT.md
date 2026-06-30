# SECTION PARITY REPORT — Preview vs Export Section Consistency
## Date: 2026-06-30

## Method

Every section rendered by the Preview (A4Preview) should produce the same
content as the same section in DOCX and PDF exports. Section hash comparison
(`computeSectionHashes` + `compareSectionHashes`) detects discrepancies.

## Section Inventory

Below is every section type that `toRenderDocument()` produces, with its
expected content:

| Section Type | Source | Rendered in Preview | Rendered in DOCX | Rendered in PDF |
|-------------|--------|---------------------|------------------|-----------------|
| professionalProfile | resume.summary | ✅ via RenderDocumentPreview | ✅ via render-document.ts | ✅ via render-document.ts |
| professionalExperience | resume.experience[] | ✅ via RenderDocumentPreview | ✅ via render-document.ts | ✅ via render-document.ts |
| education | resume.education[] | ✅ via RenderDocumentPreview | ✅ via render-document.ts | ✅ via render-document.ts |
| skills | resume.skills[] | ✅ via RenderDocumentPreview | ✅ via render-document.ts | ✅ via render-document.ts |
| languages | resume.languages[] | ✅ via RenderDocumentPreview | ✅ via render-document.ts | ✅ via render-document.ts |
| additionalInformation | resume.additionalInfo + contact.personalDetails | ✅ via RenderDocumentPreview | ✅ via render-document.ts | ✅ via render-document.ts |
| dynamicSections | resume.dynamicSections[] | ✅ via RenderDocumentPreview | ✅ via render-document.ts | ✅ via render-document.ts |

**Note**: The above is only true when `useRenderDocument={true}` is set on A4Preview.
When using the legacy template path (default), each template has its own rendering
for each section, which may diverge from RenderDocument.

## Potential Divergence Sources

### 1. Skills rendering
- **RenderDocument**: Groups skills by category using colon parsing (`Category: skill1, skill2`)
- **Legacy templates**: Each template handles skills differently (some show categories, some don't)

### 2. Languages rendering
- **RenderDocument**: Renders as both text ("English – Fluent") AND bullet list
- **Legacy templates**: Varies — some show inline, some as bullets

### 3. Dynamic sections
- **RenderDocument**: Iterates dynamicSections[] in order
- **Legacy templates**: Some templates don't render dynamicSections at all

### 4. Additional Information
- **RenderDocument**: Renders personalDetails as label:value pairs + additionalInfo text
- **Legacy templates**: Most don't render additionalInfo

### 5. Section ordering
- **RenderDocument**: Fixed order: profile → experience → education → skills → languages → additionalInfo → dynamicSections
- **Legacy templates**: Each template has its own order

## Verification

The `validateRenderParity()` function in exporter.ts now runs before every DOCX/PDF
export. It computes section hashes and checks:
  - Non-empty sections
  - Experience section has content
  - Languages section exists when resume has languages

To verify parity across all renderers, run:
```typescript
import { computeSectionHashes, compareSectionHashes } from "@/lib/section-hash";

const rd = toRenderDocument(resume, layout);
const hashes = computeSectionHashes(rd);
// Store hashes, then compare after each renderer produces its output
```

## Section Format Standard

All renderers should follow these rules for each section:

### PROFESSIONAL SUMMARY
- Single paragraph of text
- No reformatting, no truncation

### PROFESSIONAL EXPERIENCE
- **Header row**: `Job Title | Company | Location` (left) + `Dates` (right)
- **Bullets**: achievement-focused, each bullet is one line
- No reordering of experience entries
- No reformatting of dates

### EDUCATION
- **Header row**: `School` (left) + `Dates` (right)
- **Detail row**: `Degree / Diploma` + `Location` if available
- No reordering of education entries

### SKILLS
- **Category header** (bold) followed by skills inline
- Ungrouped skills rendered as comma-separated list

### LANGUAGES
- Each language on its own line: `Language – Proficiency`
- No merging of languages
- No removal of proficiency levels

### ADDITIONAL INFORMATION
- Each personal detail as `Label: Value`
- Additional Info text as paragraphs

### DYNAMIC SECTIONS
- Title rendered as bold text
- Content rendered as text or bullets
- Preserved in original order
