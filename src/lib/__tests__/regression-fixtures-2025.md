# Regression Fixtures — 2025 (for manual + automated validation)

## A1/B4: Contact deduplication
**Input**: Resume with "PERSONAL INFORMATION" trailing section containing email/phone/address  
**Expected**: Contact info extracted once in header; no dynamic section for "Personal Information"  
**Files**: `fixtures/a1-contact-dedup/`

## A2/B3: Language extraction
**Input**: Resume with "Languages: English, French, Arabic (Fluent)" and "Languages: Dutch / Nederlands"  
**Expected**: English, French, Arabic, Dutch/Nederlands extracted correctly. "Italic" NOT identified as a language.  
**Files**: `fixtures/a2-language-extraction/`

## A3: Headline/Guardian
**Input**: Resume with "Customer Service Professional" as headline, JD with "Air France" as company  
**Expected**: Headline preserved. Guardian does NOT flag "Air France" as a skill.  
**Files**: `fixtures/a3-headline-guardian/`

## A4: Prompt contract enforcement
**Input**: Resume sent to any AI provider  
**Expected**: The prompt always includes "DO NOT change IDs", "Only modify" bullets/summary/skills, content preservation directives  
**Files**: `fixtures/a4-prompt-contract/`

## A5: Fast-fail structural validation
**Input**: Empty resume (no experience, no education)  
**Expected**: Before any AI call, throws "PROVIDER-INDEPENDENT STRUCTURAL FAILURE"  
**Files**: `fixtures/a5-fast-fail/`

## A6: Degraded optimization status
**Input**: All AI providers fail  
**Expected**: Pipeline returns source resume as-is with `isDegraded: true`, provider="degraded-optimization", and `reportDegradedOptimization()` called  
**Files**: `fixtures/a6-degraded/`

## B1: Bullet immutability
**Input**: Resume with specific bullets; optimizer tries to drop one  
**Expected**: Bullets are preserved; content violation detected  
**Files**: `fixtures/b1-bullet-integrity/`

## B2: Skills/Languages/Header integrity
**Input**: Optimized output missing a skill, language, or contact field  
**Expected**: Content violation detected; retry triggered  
**Files**: `fixtures/b2-skills-lang-header/`

## B3: Export gate (structural warnings block export)
**Input**: Resume with "Duplicate dynamic section" warning  
**Expected**: `canExport` returns `false`, export blocked  
**Files**: `fixtures/b3-export-gate/`

## B4: Provider cooldown
**Input**: Provider in cooldown; routing request for same provider  
**Expected**: Provider skipped; fallback provider selected  
**Files**: `fixtures/b4-provider-cooldown/`

---

## Automated Test Plan

Each fixture above should be validated by:

```typescript
import { describe, it, expect } from "vitest";
import { extractResumeFromText } from "../parser";
import { detectLanguage } from "../parser-detect";
import { runStructureGuardian } from "../structure-guardian";
import { runBulletOnlyOptimizer } from "../bullet-only-optimizer";
import { routeProvider } from "../provider-router";
import { validateForExport } from "../export-validator";
import { isProviderInCooldown } from "../provider-cooldown";
import type { ResumeData, JobDescription } from "../types";
```

### Test: Contact dedup (A1)
```typescript
it("should not create dynamic section for Personal Information", async () => {
  const text = `NAME\nname@email.com\n...\nPERSONAL INFORMATION\nname@email.com\n+1234567890\nAddress: somewhere`;
  const parsed = await parseResumeText(text);
  const contactSection = (parsed.dynamicSections ?? []).find(
    ds => /personal|contact/i.test(ds.normalizedTitle)
  );
  expect(contactSection).toBeUndefined();
});
```

### Test: Language extraction (A2)
```typescript
it("should NOT detect 'italic' as a language", () => {
  expect(detectLanguage("italic")).toBeNull();
  expect(detectLanguage("Italic font style")).toBeNull();
});

it("should detect Nederlands as Dutch", () => {
  const result = detectLanguage("Nederlands");
  expect(result).not.toBeNull();
  expect(result?.name).toBe("Nederlands");
});
```

### Test: Structural fail-fast (A5)
```typescript
it("should fail fast on empty resume", async () => {
  await expect(
    runBulletOnlyOptimizer(emptyResume, jd, "", {}, [])
  ).rejects.toThrow("PROVIDER-INDEPENDENT STRUCTURAL FAILURE");
});
```
