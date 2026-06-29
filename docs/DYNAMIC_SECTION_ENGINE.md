# Dynamic Section Preservation & Enhancement Engine

## Overview

The Dynamic Section Preservation & Enhancement Engine is a defense-in-depth system
that guarantees every section parsed from the original resume is never lost during
optimization — even if not explicitly defined in the optimization directives,
blueprint, or template.

## Architecture

```
Source Resume
     ↓
Parser ─────────────────→ ResumeData.dynamicSections populated at parse time
     ↓
Blueprint Agent ────────→ extractSectionsFromResume() fingerprints all sections
     ↓
Locked Pipeline
  ├── runDynamicSectionPipeline()
  │   ├── extractSectionsFromResume()    — detect all sections
  │   ├── checkSectionPreservation()     — fingerprint match (source vs optimized)
  │   ├── enhanceDynamicSections()       — grammar, ATS keywords, JD alignment
  │   └── mergeDynamicSections()         — auto-restore any missing sections
  │
  ├── Assembler ────────→ Dynamic sections merged, original order preserved
  ├── Page Balancer
  ├── Guardian ─────────→ checkDynamicSectionsPreserved() with VETO power
  └── Render Document ──→ buildDynamicSections() into RenderDocument
```

## Key Components

### 1. `DynamicSection` Type (`types.ts`)

```typescript
interface DynamicSection {
  id: string;           // sha256(normalizedTitle + content)
  title: string;
  normalizedTitle: string;
  content: string;
  bullets: string[];
  order: number;
  source: "parsed" | "enhanced" | "restored";
  immutable: boolean;
}
```

### 2. `DynamicSectionPreservationEngine` (`dynamic-section-engine.ts`)

| Method | Purpose |
|---|---|
| `extractSectionsFromResume` | Detects all sections including non-standard ones |
| `computeFingerprintSync` | SHA-256 hash of `normalizedTitle + content` |
| `checkSectionPreservation` | Compares source vs optimized section fingerprints |
| `enhanceDynamicSection` | Grammar, capitalization, ATS keywords, JD alignment |
| `enhanceDynamicSections` | Batch enhancement of all dynamic sections |
| `mergeDynamicSections` | Restores missing sections, preserves original order |
| `validateSectionPreservation` | Full validation with violation report |
| `restoreOrder` | Maintains original section ordering |
| `runDynamicSectionPipeline` | End-to-end: extract → validate → enhance → merge |

### 3. Guardian Check (`resume-guardian-agent.ts`)

- `checkDynamicSectionsPreserved()`: Compares source vs optimized section counts
  and fingerprints. Vetoes if any section was removed.

### 4. Renderer (`render-document.ts`)

- `buildDynamicSections()`: Converts dynamic sections into `RenderDocumentSection`
  items, rendering title + bullets with appropriate formatting.

## Enforcement Layers

| Layer | Mechanism | When |
|---|---|---|
| AI Directive | "NEVER remove custom sections" | Prompt to LLM |
| Pipeline Engine | Auto-restore via mergeDynamicSections | After optimization |
| Guardian | VETO on section removal | Before output |
| Renderer | Render dynamicSections | Preview/DOCX/PDF |

## Defense Mechanisms

1. **Fingerprint-based matching** — never uses array indices
2. **Auto-restoration** — any missing section is re-injected from source
3. **Guardian VETO** — blocks output if dynamic sections were dropped
4. **Renderer coverage** — dynamic sections rendered even when not in standard templates

## File Manifest

| File | Description |
|---|---|
| `src/lib/types.ts` | `DynamicSection` interface + `ResumeData.dynamicSections` |
| `src/lib/dynamic-section-engine.ts` | Core engine (804 lines) |
| `src/lib/resume-blueprint-agent.ts` | Engine integration in blueprint extraction |
| `src/lib/resume-guardian-agent.ts` | Guardian validation with VETO |
| `src/lib/locked-pipeline.ts` | Pipeline wiring after Step 3 |
| `src/lib/parser.ts` | Parser populates dynamicSections at parse time |
| `src/lib/render-document.ts` | Renderer for dynamic sections |
| `src/lib/ai.ts` | AI directive enforcement |
| `src/lib/__tests/dynamic-section-engine.test.ts` | 39 tests (632 total) |
