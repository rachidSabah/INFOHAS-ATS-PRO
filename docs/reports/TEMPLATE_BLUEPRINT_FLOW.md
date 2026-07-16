# Template Blueprint Flow

> **File:** `src/lib/resume-template-blueprint-agent.ts`
> **Role:** Frozen layout contract — captured pre-optimization, validated post-optimization.

---

## 1. Template Blueprint Concept

### What It Is

A **Template Blueprint** is a frozen snapshot of a resume's structural layout and formatting properties, captured *before* any optimization occurs. It represents the "layout contract" that the user chose when picking a template.

The blueprint is an object (`ResumeTemplateBlueprint`) containing:

- Section order (which sections appear and in what sequence)
- Font sizes for name, section titles, body text, and headlines
- Heading labels used for each section (e.g. "PROFESSIONAL EXPERIENCE" vs "WORK EXPERIENCE")
- Layout type (`single-column` or `two-column`)
- Education formatting preferences (diploma-first ordering, separator style)
- Experience formatting preferences (role-first ordering, separator style)
- Profile photo presence flag
- Accent color override
- Page margins (top, right, bottom, left in mm)

### Why It's Needed

Optimization agents — particularly LLM-based ones — can inadvertently alter structural layout properties when rewriting content. Without a blueprint:

- A section order could be re-arranged (breaking the template's intended flow)
- A `two-column` layout could be collapsed into `single-column`
- Education/experience formatting separators could be changed
- Font sizes or margins could be modified

The blueprint provides **an immutable reference** against which the optimized output is validated, ensuring the user's chosen template layout is preserved exactly.

---

## 2. The 14 Template Types in the Registry

The `TEMPLATE_REGISTRY` maps every member of the `ResumeTemplate` union type to its known layout defaults. The 14 templates are:

| # | Template ID    | Layout Type      | Section Count | Notable Characteristics |
|---|----------------|------------------|---------------|------------------------|
| 1 | `ats-professional` | single-column | 7 | Standard ATS-friendly layout, "PROFESSIONAL EXPERIENCE" heading |
| 2 | `executive`        | single-column | 6 | Larger name (16pt), "EXECUTIVE SUMMARY" / "CORE COMPETENCIES" |
| 3 | `modern`           | single-column | 8 | Skills before experience, "PROFILE" heading, diploma *last* |
| 4 | `corporate`        | single-column | 6 | 8mm top/bottom margins, "CORE COMPETENCIES" |
| 5 | `europass`         | two-column   | 7 | Only two-column non-infohas template, "WORK EXPERIENCE" |
| 6 | `creative`         | single-column | 6 | Largest name (18pt), bullet separators (` • `), "WHAT I DO" / "WORK" |
| 7 | `minimal`          | single-column | 5 | Smallest fonts, comma separators, no `certifications` section |
| 8 | `infohas-pro`      | two-column   | 8 | Two-column, supports photo & DOB fields |
| 9 | `compact`          | single-column | 6 | Tightest margins (4/5mm), smallest fonts (12pt/10pt/9pt) |
| 10 | `tech`             | single-column | 7 | "TECHNICAL SKILLS" heading, skills before experience |
| 11 | `academic`         | single-column | 7 | Education before experience, "RESEARCH & TEACHING EXPERIENCE" |
| 12 | `consulting`       | single-column | 6 | "SELECTED ENGAGEMENTS", "AREAS OF EXPERTISE" |
| 13 | `startup`          | single-column | 7 | "ABOUT" heading, "SKILLS & TOOLS", "SIDE PROJECTS" |
| 14 | `classic`          | single-column | 6 | Largest margins (7.62/9.53mm), 11pt body text |

Additional sections that appear across templates include: `headline`, `summary`, `experience`, `education`, `skills`, `languages`, `certifications`, `projects`.

**Default Fallback:** If an unknown template value is encountered, the `DEFAULT_TEMPLATE_META` object is used with conservative defaults (single-column, 14pt name, 11pt section titles, 10pt body, 6.35/8.89mm margins).

---

## 3. `extractTemplateBlueprint()`

### Signature

```typescript
function extractTemplateBlueprint(resume: ResumeData): ResumeTemplateBlueprint
```

### What It Captures

The function takes a `ResumeData` object (pre- or post-optimization) and produces a full blueprint snapshot:

| Blueprint Property | Source |
|---|---|
| `sectionOrder` | Copied from `TEMPLATE_REGISTRY[template]` |
| `fontSizes` | Copied from `TEMPLATE_REGISTRY[template]` |
| `headings` | Copied from `TEMPLATE_REGISTRY[template]` |
| `layoutType` | Copied from `TEMPLATE_REGISTRY[template]` |
| `educationFormat` | Copied from `TEMPLATE_REGISTRY[template]` |
| `experienceFormat` | Copied from `TEMPLATE_REGISTRY[template]` |
| `hasProfilePhoto` | `!!resume.photoUrl` (truthy check) |
| `accentColor` | `resume.accentColor ?? null` |
| `margins` | Unpacked from registry tuple → `{ top, right, bottom, left }` |

### Extraction Logic

```typescript
export function extractTemplateBlueprint(resume: ResumeData): ResumeTemplateBlueprint {
  const templateKey: ResumeTemplate = resume.template;
  const meta = TEMPLATE_REGISTRY[templateKey] ?? DEFAULT_TEMPLATE_META;
  const margins = meta.margins;

  return {
    sectionOrder: [...meta.sectionOrder],           // shallow copy to prevent mutation
    fontSizes: { ...meta.fontSizes },                // shallow copy to prevent mutation
    headings: { ...meta.headings },                  // shallow copy to prevent mutation
    layoutType: meta.layoutType,
    educationFormat: { ...meta.educationFormat },
    experienceFormat: { ...meta.experienceFormat },
    hasProfilePhoto: !!resume.photoUrl,
    accentColor: resume.accentColor ?? null,
    margins: {
      top: margins[0],
      right: margins[1],
      bottom: margins[2],
      left: margins[3],
    },
  };
}
```

**Key design decisions:**
- Array and object properties are **shallow-copied** (spread syntax) so the caller cannot mutate the registry data.
- `hasProfilePhoto` and `accentColor` are **runtime values from the actual resume data** — they are the only dynamic fields, since a user may add/remove a photo or choose a custom accent color at any time.
- Margins are stored as a tuple `[top, right, bottom, left]` in the registry and unpacked to a named object for clarity.

---

## 4. `validateTemplatePreserved()`

### Signature

```typescript
function validateTemplatePreserved(
  original: ResumeTemplateBlueprint,
  optimized: ResumeData,
): boolean
```

### What It Checks

Four critical layout attributes **must** remain unchanged between the original blueprint and the optimized resume:

| # | Check | Property | Critical | Why |
|---|-------|----------|----------|-----|
| 1 | **Section Order** | `sectionOrder` | ✅ Yes | Reordering sections breaks the template's intended flow |
| 2 | **Layout Type** | `layoutType` | ✅ Yes | Switching from `two-column` to `single-column` changes the entire page structure |
| 3 | **Education Format** | `educationFormat.diplomaFirst` + `educationFormat.separator` | ✅ Yes | Changes how degrees vs institutions are displayed |
| 4 | **Experience Format** | `experienceFormat.roleFirst` + `experienceFormat.separator` | ✅ Yes | Changes how job titles vs company names are presented |

### Comparison Logic

```typescript
export function validateTemplatePreserved(
  original: ResumeTemplateBlueprint,
  optimized: ResumeData,
): boolean {
  const optimizedBlueprint = extractTemplateBlueprint(optimized);

  if (!arraysEqual(original.sectionOrder, optimizedBlueprint.sectionOrder)) return false;
  if (original.layoutType !== optimizedBlueprint.layoutType) return false;
  if (
    original.educationFormat.diplomaFirst !==
      optimizedBlueprint.educationFormat.diplomaFirst ||
    original.educationFormat.separator !==
      optimizedBlueprint.educationFormat.separator
  ) return false;
  if (
    original.experienceFormat.roleFirst !==
      optimizedBlueprint.experienceFormat.roleFirst ||
    original.experienceFormat.separator !==
      optimizedBlueprint.experienceFormat.separator
  ) return false;

  return true;
}
```

### Detailed Variant: `validateTemplatePreservedDetailed()`

Returns a `TemplatePreservationResult` with per-check diagnostics:

```typescript
interface TemplatePreservationResult {
  valid: boolean;
  checks: {
    sectionOrder:      { passed: boolean; expected: string[]; actual: string[] };
    layoutType:        { passed: boolean; expected: string; actual: string };
    educationFormat:   { passed: boolean; expected: {...}; actual: {...} };
    experienceFormat:  { passed: boolean; expected: {...}; actual: {...} };
  };
}
```

This detailed variant enables **granular error reporting** — the caller can surface exactly which check failed and what the expected vs actual values were.

### Helper: `arraysEqual()`

```typescript
function arraysEqual<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
```

Strict reference-equality comparison (`===`), used for `sectionOrder` string arrays.

---

## 5. How It Connects to the Locked Pipeline

The locked pipeline (`src/lib/locked-pipeline.ts`) is the mandatory optimization pipeline. The template blueprint agent provides the **before/after validation** that bookends it:

```
┌─────────────────────────────────────────────────────────────────────┐
│                      LOCKED PIPELINE                               │
│                                                                     │
│  Source Resume                                                      │
│       │                                                             │
│       ▼                                                             │
│  [extractTemplateBlueprint()]  ───→  Save blueprint                │
│       │                                                             │
│       ▼                                                             │
│  Step 1: Ensure IDs & Lock Entities                                 │
│  Step 2: Run Bullet-Only Optimizer                                  │
│  Step 3: Assemble Resume                                            │
│  Step 4: Validate Fingerprints                                      │
│  Step 5: Structure Guardian                                         │
│       │                                                             │
│       ▼                                                             │
│  [validateTemplatePreserved(blueprint, result)]  ───→  PASS/BLOCK  │
│       │                                                             │
│       ▼                                                             │
│  Guardian Agent (final VETO gate)                                   │
└─────────────────────────────────────────────────────────────────────┘
```

**Current status:** The template blueprint validation is **not yet integrated** into the locked pipeline's step sequence; it exists as a standalone agent ready for integration. The locked pipeline currently uses:
- `structure-guardian.ts` for structural integrity checks (Step 5)
- `resume-guardian-agent.ts` as the final VETO gate (Check 6: `template_preserved` — simple string equality check on `template` field)
- `layout-validator.ts` for one-page layout validation

The template blueprint agent would slot in as a **more precise layout-preservation check** — validating the full set of layout attributes rather than just whether the template name string changed.

---

## 6. Integration with `resume-guardian-agent.ts`

The Resume Guardian Agent (`src/lib/resume-guardian-agent.ts`) is the **final VETO gate** before export. It currently runs 12 checks, of which two relate to template/layout preservation:

### Check 6: `checkTemplatePreserved()` (simple string check)

```typescript
function checkTemplatePreserved(optimized: ResumeData, source: ResumeData): GuardianCheck {
  if (optimized.template === source.template) {
    return {
      name: "template_preserved",
      passed: true,
      critical: true,
      detail: `Template unchanged: "${source.template}"`,
    };
  }
  return {
    name: "template_preserved",
    passed: false,
    critical: true,
    detail: `Template changed: "${source.template}" → "${optimized.template}"`,
  };
}
```

This only checks that the `template` string field hasn't changed. **It does not validate layout internals** (section order, fonts, margins, formatting preferences).

### Check 7: `checkLayoutPreserved()` (uses Structure Guardian)

```typescript
function checkLayoutPreserved(optimized: ResumeData, source: ResumeData): GuardianCheck {
  const sgResult = runStructureGuardian(optimized, source);
  // ...checks for critical issues...
}
```

The Structure Guardian (`structure-guardian.ts`) detects corruption, malformed fragments, and structural anomalies — but it is **not** a template-specific layout checker.

### Proposed Integration Point

The template blueprint agent's `validateTemplatePreservedDetailed()` would be ideal as a **new guardian check** (or replacement for the simple `checkTemplatePreserved`). It would slot into `runGuardianValidation()`:

```typescript
// Proposed addition to runGuardianValidation():
import { extractTemplateBlueprint, validateTemplatePreservedDetailed } from "./resume-template-blueprint-agent";

function checkTemplateLayoutPreserved(
  optimized: ResumeData,
  source: ResumeData
): GuardianCheck {
  const original = extractTemplateBlueprint(source);
  const result = validateTemplatePreservedDetailed(original, optimized);

  if (result.valid) {
    return {
      name: "template_layout_preserved",
      passed: true,
      critical: true,
      detail: `All 4 layout attributes preserved (sectionOrder, layoutType, educationFormat, experienceFormat)`,
    };
  }

  const failures = Object.entries(result.checks)
    .filter(([_, c]) => !c.passed)
    .map(([name, c]) => `${name}: expected ${JSON.stringify((c as any).expected)} got ${JSON.stringify((c as any).actual)}`);

  return {
    name: "template_layout_preserved",
    passed: false,
    critical: true,
    detail: `Template layout violations: ${failures.join("; ")}`,
  };
}
```

---

## 7. ASCII Diagram

```
╔══════════════════════════════════════════════════════════════════════╗
║                TEMPLATE BLUEPRINT FLOW                              ║
╚══════════════════════════════════════════════════════════════════════╝

                              ┌─────────────────┐
                              │   Source Resume  │
                              │  (ResumeData)    │
                              └────────┬────────┘
                                       │
                                       ▼
                        ┌──────────────────────────────────┐
                        │     extractTemplateBlueprint()   │
                        │                                  │
                        │  ┌────────────────────────────┐  │
                        │  │ Properties extracted:     │  │
                        │  │ • sectionOrder            │  │
                        │  │ • fontSizes               │  │
                        │  │ • headings                │  │
                        │  │ • layoutType              │  │
                        │  │ • educationFormat         │  │
                        │  │ • experienceFormat        │  │
                        │  │ • hasProfilePhoto         │  │
                        │  │ • accentColor             │  │
                        │  │ • margins                 │  │
                        │  └────────────────────────────┘  │
                        └──────────────┬───────────────────┘
                                       │
                                       ▼
                        ┌──────────────────────────────────┐
                        │   ResumeTemplateBlueprint        │
                        │   (frozen contract)              │
                        └──────────────┬───────────────────┘
                                       │
                    ┌──────────────────┼──────────────────┐
                    │                  │                  │
                    ▼                  ▼                  ▼
         ┌─────────────────┐   ┌──────────────┐   ┌──────────────────┐
         │ Locked Pipeline │   │  Optimizer   │   │  Guardian Agent  │
         │ (runs steps     │   │  Agents      │   │  (VETO gate)     │
         │  1-5)           │   │  (write      │   │                  │
         │                 │   │  content)    │   │  Uses blueprint  │
         │ Stores blueprint│   │              │   │  for layout      │
         │ for reference   │   │              │   │  integrity check │
         └────────┬────────┘   └──────┬───────┘   └──────────────────┘
                  │                   │                      │
                  └───────────────────┼──────────────────────┘
                                      │
                                      ▼
                        ┌──────────────────────────────────┐
                        │   Optimized Resume               │
                        │   (ResumeData)                   │
                        └──────────────┬───────────────────┘
                                       │
                                       ▼
                        ┌──────────────────────────────────┐
                        │  validateTemplatePreserved()     │
                        │  (or Detailed variant)           │
                        │                                  │
                        │  Compares against blueprint:     │
                        │  1. sectionOrder  ──── ? ──────┐ │
                        │  2. layoutType   ──── ? ──────┤ │
                        │  3. eduFormat    ──── ? ──────┤→│ ✓ PASS / ✗ BLOCK
                        │  4. expFormat    ──── ? ──────┘ │
                        └──────────────┬───────────────────┘
                                       │
                            ┌──────────┴──────────┐
                            ▼                     ▼
                     ┌────────────┐       ┌──────────────┐
                     │  ✓ PASS    │       │  ✗ BLOCK     │
                     │            │       │              │
                     │ Proceed to │       │ Log failure  │
                     │ export     │       │ + diagnostics│
                     └────────────┘       └──────────────┘
```

---

## 8. Code Examples

### Example 1: Extracting a Blueprint

```typescript
import { extractTemplateBlueprint } from "./resume-template-blueprint-agent";
import type { ResumeData } from "./types";

const sourceResume: ResumeData = {
  id: "res-123",
  name: "Jane Doe",
  template: "ats-professional",
  accentColor: "#2563eb",
  photoUrl: undefined,
  // ... other fields ...
};

const blueprint = extractTemplateBlueprint(sourceResume);

console.log(blueprint.layoutType);        // "single-column"
console.log(blueprint.sectionOrder);      // ["headline","summary","experience","education","skills","languages","certifications"]
console.log(blueprint.fontSizes.name);    // "14pt"
console.log(blueprint.margins.top);       // 6.35
console.log(blueprint.accentColor);       // "#2563eb"
console.log(blueprint.hasProfilePhoto);   // false
```

### Example 2: Validating Preservation

```typescript
import { extractTemplateBlueprint, validateTemplatePreserved } from "./resume-template-blueprint-agent";

// Before optimization:
const originalBlueprint = extractTemplateBlueprint(sourceResume);

// After optimization — validate:
if (!validateTemplatePreserved(originalBlueprint, optimizedResume)) {
  throw new Error("Template layout was altered during optimization — BLOCKED");
}
```

### Example 3: Detailed Diagnostics

```typescript
import {
  extractTemplateBlueprint,
  validateTemplatePreservedDetailed,
} from "./resume-template-blueprint-agent";

const original = extractTemplateBlueprint(sourceResume);
const result = validateTemplatePreservedDetailed(original, optimizedResume);

if (!result.valid) {
  console.error("Template blueprint violations detected:");
  for (const [checkName, check] of Object.entries(result.checks)) {
    if (!check.passed) {
      console.error(`  ✗ ${checkName}:`);
      console.error(`    Expected: ${JSON.stringify(check.expected)}`);
      console.error(`    Actual:   ${JSON.stringify(check.actual)}`);
    }
  }
}
```

### Example 4: Full Pipeline Integration Pattern

```typescript
import { extractTemplateBlueprint, validateTemplatePreservedDetailed } from "./resume-template-blueprint-agent";
import { runLockedPipeline } from "./locked-pipeline";

async function optimizeResumeWithBlueprint(sourceResume: ResumeData, jd: JobDescription) {
  // Step 1: Freeze the blueprint BEFORE optimization
  const blueprint = extractTemplateBlueprint(sourceResume);
  console.log(`[Blueprint] Template: ${sourceResume.template}, Layout: ${blueprint.layoutType}`);

  // Step 2: Run the locked pipeline
  const result = await runLockedPipeline(sourceResume, jd, /*...*/);

  // Step 3: Validate layout preservation AFTER optimization
  const validation = validateTemplatePreservedDetailed(blueprint, result.resume);

  if (!validation.valid) {
    const failed = Object.entries(validation.checks)
      .filter(([_, c]) => !c.passed)
      .map(([n, _]) => n);
    console.error(`[Blueprint] BLOCKED — layout changed: ${failed.join(", ")}`);
    throw new Error(`Template blueprint violation: ${failed.join(", ")}`);
  }

  console.log(`[Blueprint] ✓ All layout attributes preserved`);
  return result;
}
```

---

## 9. Full File Reference

### `src/lib/resume-template-blueprint-agent.ts` (755 lines)

| Section | Lines | Description |
|---|---|---|
| Header & Doc Comment | 1–22 | Purpose, rules, and two key functions |
| `ResumeTemplateBlueprint` interface | 32–74 | The frozen layout contract shape |
| `MarginSet` type | 84 | Tuple type for margins `[top, right, bottom, left]` |
| `TemplateMeta` interface | 86–94 | Internal registry entry shape |
| `TEMPLATE_REGISTRY` | 96–516 | 14 template entries with full defaults |
| `DEFAULT_TEMPLATE_META` | 522–549 | Fallback defaults for unknown templates |
| `extractTemplateBlueprint()` | 570–592 | Main extraction function |
| `validateTemplatePreserved()` | 612–650 | Boolean validation function |
| `TemplatePreservationResult` interface | 656–672 | Detailed diagnostic result shape |
| `validateTemplatePreservedDetailed()` | 682–740 | Detailed validation with per-check diagnostics |
| `arraysEqual()` helper | 749–755 | Shallow array comparison |

### Related Files

| File | Path | Role |
|---|---|---|
| Types | `src/lib/types.ts` | Defines `ResumeTemplate` union type and `ResumeData` interface |
| Resume Guardian Agent | `src/lib/resume-guardian-agent.ts` | Final VETO gate — runs 12 checks including template preservation |
| Structure Guardian | `src/lib/structure-guardian.ts` | Structural integrity checks (corruption, malformed data) |
| Layout Validator | `src/lib/layout-validator.ts` | One-page layout validation |
| Locked Pipeline | `src/lib/locked-pipeline.ts` | Mandatory optimization pipeline orchestration |
| Resume Assembler | `src/lib/resume-assembler.ts` | Merges source + optimizer output, renders final layout |
| Entity Lock | `src/lib/entity-lock.ts` | Entity fingerprinting and integrity verification |
| Experience Fingerprint | `src/lib/experience-fingerprint.ts` | Experience entry fingerprint validation |

---

## 10. Known Issues & Limitations

### 1. Not Yet Integrated into the Locked Pipeline
The template blueprint agent is a **standalone utility** — it does not currently run as part of `locked-pipeline.ts`. The locked pipeline uses `structure-guardian.ts` and `resume-guardian-agent.ts` for validation. The blueprint agent would need to be explicitly wired into the pipeline's step sequence to provide its benefits automatically.

### 2. Guardian Agent Uses Simpler Check
`resume-guardian-agent.ts`'s `checkTemplatePreserved()` only compares the `template` string field (`optimized.template === source.template`). It does **not** validate section order, layout type, formatting preferences, or margins. A malicious or buggy optimizer could change the internal layout while keeping the same `template` string — the simple check would not catch this.

### 3. No Deep Validation of Section Content
The blueprint only validates **structural metadata** (section order, layout type, formatting preferences). It does **not** validate that the *content inside* each section (bullet points, dates, company names) matches. Content integrity is handled by `entity-lock.ts` (hallucination detection) and `experience-fingerprint.ts` (fingerprint validation).

### 4. Font Sizes / Headings / Margins Not Validated
Although `extractTemplateBlueprint()` captures `fontSizes`, `headings`, and `margins`, the `validateTemplatePreserved()` function **does not check them** — it only checks the four critical attributes listed in §4. Rationale: font sizes and margins are rendered by the resume assembler and are not subject to LLM influence. If this changes, the validation function would need extension.

### 5. Registry is Static
The `TEMPLATE_REGISTRY` is hardcoded. If new templates are added to the `ResumeTemplate` union, the registry must be updated manually to match. There is no runtime discovery mechanism.

### 6. Fallback Masking
If an unknown template string is encountered, `DEFAULT_TEMPLATE_META` is used silently. This means a typo in the template field would not be caught — the blueprint would be generated against the wrong defaults. Consider adding a warning log when the fallback is triggered.

### 7. Shallow Copies Are Not Deep Freezes
The blueprint uses shallow copies (`[...meta.sectionOrder]`, `{...meta.fontSizes}`). While this prevents registry mutation by callers, the properties themselves are plain objects/arrays and could still be modified if someone holds a reference and mutates. In practice this is not a concern since the blueprint is typically consumed and discarded, but a `Object.freeze()` deep freeze could be added for strict immutability.

### 8. No Async / Performance Considerations
The extraction and validation functions are synchronous and fast (O(n) where n is section count, typically ≤ 8). No performance concerns.

### 9. `arraysEqual()` Uses Strict Reference Equality
The helper uses `===` for element comparison. This is correct for `string[]` (section names) but would fail for object arrays. It is not a general-purpose utility.

### 10. No Integration Tests
There are currently no tests that verify the template blueprint agent is exercised during pipeline runs. Unit tests exist in the `__tests__/` directory for related components, but no test validates the full extract → validate → pipeline flow.
