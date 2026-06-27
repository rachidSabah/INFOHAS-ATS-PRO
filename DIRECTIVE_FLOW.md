# DIRECTIVE_FLOW.md — OptimizationDirectives System Architecture

> **Single Source of Truth for all optimization behavior.**  
> How user-configured directives flow from the UI through the Zustand store, into the Supervisor/Orchestrator, through the Locked Pipeline, and ultimately into every LLM agent prompt — plus how QA validates compliance.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [The OptimizationPolicy Type (37+ fields)](#2-the-optimizationpolicy-type-37-fields)
3. [UI → Store: OptimizerDirective.tsx](#3-ui--store-optimizerdirectivetsx)
4. [Store → Policy: buildOptimizationPolicy()](#4-store--policy-buildoptimizationpolicy)
5. [Policy → Prompt: formatPolicyForPrompt()](#5-policy--prompt-formatpolicyforprompt)
6. [Injection Mechanism: SYSTEM POLICY in Every Agent Prompt](#6-injection-mechanism-system-policy-in-every-agent-prompt)
7. [Orchestrator: Policy Assembly & Dispatch](#7-orchestrator-policy-assembly--dispatch)
8. [Section Ownership Enforcement](#8-section-ownership-enforcement)
9. [Immutable Entity Model](#9-immutable-entity-model)
10. [Built-in Profiles & applyProfileToConfig()](#10-built-in-profiles--applyprofiletoconfig)
11. [QA: checkPolicyCompliance() — 9 Checks](#11-qa-checkpolicycompliance--9-checks)
12. [ASCII Flow Diagram](#12-ascii-flow-diagram)
13. [File Reference](#13-file-reference)

---

## 1. System Overview

The directive system is a layered pipeline that translates **UI configuration → typed policy → serialized prompt text → LLM enforcement → compliance validation**.

```text
┌─────────────────────────────────────────────────────────────────────┐
│                    DIRECTIVE FLOW LAYERS                            │
├─────────────────────────────────────────────────────────────────────┤
│  L1: UI Widgets  (OptimizerDirective.tsx)                          │
│       ↓ Zustand store                                               │
│  L2: OptimizerDirectiveConfig (store state)                        │
│       ↓ buildOptimizationPolicy()                                   │
│  L3: OptimizationPolicy (typed policy object, 37+ fields)          │
│       ↓ formatPolicyForPrompt()                                     │
│  L4: "=== SYSTEM POLICY ===" string                                 │
│       ↓ prepended to system prompt                                  │
│  L5: LLM prompt (bullet-only-optimizer.ts)                         │
│       ↓ LLM responds                                                │
│  L6: OptimizerOutput → Resume Assembler                             │
│       ↓ checkPolicyCompliance()                                     │
│  L7: Compliance score + 9 checks (qa-agent.ts)                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 2. The OptimizationPolicy Type (37+ fields)

Defined in `directive-policy.ts` (lines 19-88). This is the **single, flat policy object** that agents cannot override.

### 2.1 Layout (4 fields)

| Field | Type | Source | Description |
|-------|------|--------|-------------|
| `version` | `string` | Hardcoded `"1.0"` | Policy schema version |
| `pageLimit` | `"one-page" \| "two-page" \| "auto"` | `directiveConfig.enforceOnePage` | Page count constraint |
| `layoutTemplate` | `"preserve-original" \| "modern" \| "professional"` | Hardcoded `"preserve-original"` | Layout style |
| `fontSize` | `number` | `directiveConfig.bodyFontSizePt` (default 10.5) | Body font size in pt |
| `lineHeight` | `number` | `directiveConfig.lineHeight` (default 1.2) | CSS line height |

### 2.2 Summary (3 fields)

| Field | Type | Source |
|-------|------|--------|
| `summaryLength` | `"short" \| "medium" \| "comprehensive"` | Derived from `summaryMinChars`/`summaryMaxChars` via `computeSummaryLength()` |
| `summaryMinWords` | `number` | `directiveConfig.summaryMinWords` (default 60) |
| `summaryMaxWords` | `number` | `directiveConfig.summaryMaxWords` (default 130) |

### 2.3 Optimization Level (2 fields)

| Field | Type | Source |
|-------|------|--------|
| `optimizationLevel` | `"conservative" \| "balanced" \| "aggressive"` | Derived from `atsAggressiveness` via `computeOptimizationLevel()` |
| `keywordStrategy` | `"minimal" \| "balanced" \| "ats-heavy"` | Derived from `atsAggressiveness` via `computeKeywordStrategy()` |

### 2.4 Skills (1 field)

| Field | Type | Source |
|-------|------|--------|
| `skillsStrategy` | `"real-skills-only" \| "enrich-with-keywords"` | `agentDirectives.skills.allowCompanyKeywords` |

### 2.5 Experience (1 field)

| Field | Type | Source |
|-------|------|--------|
| `experienceStrategy` | `"bullet-only" \| "bullet-and-title" \| "full-rewrite"` | Hardcoded `"bullet-only"` |

### 2.6 Immutable Entity Flags (6 booleans)

| Field | Default | Meaning |
|-------|---------|---------|
| `preserveCompanies` | `true` | Never rewrite company names |
| `preserveDates` | `true` | Never rewrite dates |
| `preserveEducation` | `true` | Never add/remove education |
| `preserveLanguages` | `true` | Never add/remove languages |
| `preserveCertifications` | `true` | Never add/remove certifications |
| `preserveContact` | `true` | Never change name, email, phone, location |

### 2.7 Forbidden Behaviors (5 booleans — all hardcoded `true`)

| Field | Meaning |
|-------|---------|
| `forbidKeywordDumping` | Prevent raw keyword list injection |
| `forbidTargetedKeywordsSection` | No "Targeted Keywords" section |
| `forbidFakeSkills` | No hallucinated skills |
| `forbidSectionReorder` | Keep original section order |
| `forbidSectionAddRemove` | Don't add/remove sections |

### 2.8 Hallucination Guard (1 field)

| Field | Values | Default |
|-------|--------|---------|
| `hallucinationPolicy` | `"strict" \| "lenient" \| "off"` | `"strict"` |

### 2.9 Supervisor Controls (3 fields)

| Field | Source | Default |
|-------|--------|---------|
| `supervisorStrictMode` | `agentDirectives.supervisor.strictMode` | `true` |
| `supervisorEnableRetries` | `agentDirectives.supervisor.enableRetries` | `true` |
| `supervisorEnableProviderSwitch` | `agentDirectives.supervisor.enableProviderSwitch` | `false` |

### 2.10 Formatting Rules (5 fields)

| Field | Default |
|-------|---------|
| `formattingRules.experienceHeader` | `"<Role> \| <Company> \| <Date>"` |
| `formattingRules.educationHeader` | `"<Diploma> \| <School> \| <Date>"` |
| `formattingRules.bulletPrefix` | `""` (empty) |
| `formattingRules.dateFormat` | `"Mon YYYY"` |
| `formattingRules.emptyCompanyFormat` | `"omit-line"` |

### 2.11 ATS (1 field)

| Field | Source |
|-------|--------|
| `atsStrategy` | Derived from `atsAggressiveness` (same as `keywordStrategy`) |

### 2.12 Character Limits (2 fields)

| Field | Default |
|-------|---------|
| `minTotalChars` | `2500` |
| `maxTotalChars` | `3800` |

### 2.13 Section Ownership Map (1 field)

| Field | Type | Value |
|-------|------|-------|
| `sectionOwnership` | `Record<string, string>` | See [Section 8](#8-section-ownership-enforcement) |

---

## 3. UI → Store: OptimizerDirective.tsx

**File:** `src/components/app/modules/OptimizerDirective.tsx`

### 3.1 Zustand Store Integration

```typescript
const config = useApp((s) => s.optimizerDirective);    // read
const update = useApp((s) => s.updateOptimizerDirective); // write
const reset = useApp((s) => s.resetOptimizerDirective);   // reset
```

### 3.2 Draft Pattern

The component uses a local `draft` state to batch edits:

```typescript
const [draft, setDraft] = useState<OptimizerDirectiveConfig>(config);
const [dirty, setDirty] = useState(false);
```

- `patch(p)` — merges partial updates into draft, marks dirty
- `save()` — calls `update(draft)` on the store → triggers reactivity
- `discard()` — reverts draft to store value
- `resetToDefaults()` — resets store to `SEED_OPTIMIZER_DIRECTIVE`

### 3.3 UI Sections

The component renders these card-based sections (lines 52-638):

| Section | Lines | Fields |
|---------|-------|--------|
| **Directive Profile** | 86-119 | Profile selector buttons |
| **Page Format** | 122-145 | Page size, margins |
| **Fonts** | 148-162 | Font family, sizes |
| **Colors** | 165-175 | Hex color pickers |
| **Spacing** | 178-188 | Line height, gaps, indent |
| **Photo** | 191-216 | Photo toggle, dimensions |
| **Content Limits** | 219-233 | Summary words, skill/exp/edu/language limits |
| **One-Page Enforcement** | 236-252 | Enforce one page, min font |
| **Custom Directive Override** | 255-284 | Raw text override |
| **Per-Agent Directives** | 287-638 | Supervisor, Summary, Skills, Experience, Education, Languages agent configs |

### 3.4 Profile Selector

```typescript
import { BUILT_IN_PROFILES, applyProfileToConfig } from "@/lib/directive-profiles";

// In the component:
Object.values(BUILT_IN_PROFILES).map((profile) => (
  <button onClick={() => {
    const merged = applyProfileToConfig(draft, profile);
    setDraft(merged);
    setDirty(true);
  }}>
    {profile.name}
  </button>
))
```

### 3.5 Live Preview

A read-only `<pre>` block at the bottom shows the generated directive text that will be sent to the AI:

```
{draft.customDirectiveOverride.trim() || generateDirectivePreview(draft)}
```

The `generateDirectivePreview()` function (lines 664-726) mirrors the logic in `ai.ts`'s `getOptimizerDirective()`.

---

## 4. Store → Policy: buildOptimizationPolicy()

**File:** `directive-policy.ts`, lines 146-219

### 4.1 Signature

```typescript
export function buildOptimizationPolicy(
  directiveConfig: OptimizerDirectiveConfig | null | undefined,
  sourceResume?: ResumeData,
): OptimizationPolicy
```

### 4.2 Translation Logic

This function bridges UI state → typed policy. Key decisions:

| Input | Policy Output | Logic |
|-------|--------------|-------|
| `enforceOnePage` | `pageLimit: "one-page"` or `"auto"` | Ternary |
| `summaryMinChars` + `summaryMaxChars` | `summaryLength` | `computeSummaryLength()` — avgChar < 600 → "short", < 1200 → "medium", else "comprehensive" |
| `atsAggressiveness` (0-100) | `optimizationLevel` + `keywordStrategy` + `atsStrategy` | `< 33` → minimal/conservative, `< 66` → balanced, else aggressive/ats-heavy |
| `allowCompanyKeywords` | `skillsStrategy` | `true` → "enrich-with-keywords", else "real-skills-only" |
| `rewriteCompany` | `preserveCompanies` | `!rewriteCompany` (i.e., preserve by default) |
| `rewriteDates` | `preserveDates` | `!rewriteDates` (i.e., preserve by default) |

### 4.3 Default Values

All fields have fallback defaults when `directiveConfig` is null/undefined:

```typescript
const atsAggressiveness = agentDirs?.summary?.atsAggressiveness ?? 50;
fontSize: directiveConfig?.bodyFontSizePt ?? 10.5;
lineHeight: directiveConfig?.lineHeight ?? 1.2;
summaryMinWords: directiveConfig?.summaryMinWords ?? 60;
summaryMaxWords: directiveConfig?.summaryMaxWords ?? 130;
```

---

## 5. Policy → Prompt: formatPolicyForPrompt()

**File:** `directive-policy.ts`, lines 229-276

### 5.1 Signature

```typescript
export function formatPolicyForPrompt(policy: OptimizationPolicy): string
```

### 5.2 Output Format

Returns a human-readable block like:

```
=== SYSTEM POLICY ===
Version: 1.0
Page Limit: one-page
Layout Template: preserve-original
Font Size: 10.5pt, Line Height: 1.2
Summary Length: medium (60-130 words)
Optimization Level: balanced
Keyword Strategy: balanced
Skills Strategy: real-skills-only
Experience Strategy: bullet-only
Immutable Entities (DO NOT MODIFY): Companies, Dates, Education, Languages, Certifications, Contact Info
Forbidden: Keyword dumping, 'Targeted Keywords' section, Fake or hallucinated skills, Reordering sections, Adding or removing sections
Hallucination Policy: strict
ATS Strategy: balanced
Character Target: 2500-3800 total
Formatting: Experience="<Role> | <Company> | <Date>", Education="<Diploma> | <School> | <Date>"
Section Ownership (single-agent per section):
  - summary: summary-agent
  - skills: skills-agent
  - experience: experience-agent
  - education: education-agent
  - languages: languages-agent
  - certifications: languages-agent
  - projects: additional-information-agent
=== END SYSTEM POLICY ===
```

### 5.3 Key Serialization Details

- **Immutable entities**: Dynamically builds a comma-separated list from the 6 `preserve*` booleans
- **Forbidden behaviors**: Dynamically builds from the 5 `forbid*` booleans
- **Section ownership**: Iterates `policy.sectionOwnership` entries and formats each as `  - {section}: {agent}`

---

## 6. Injection Mechanism: SYSTEM POLICY in Every Agent Prompt

**File:** `bullet-only-optimizer.ts`, lines 52-201

### 6.1 Where It Happens

In `buildOptimizerInput()` (line 97):

```typescript
const systemPrompt = `${optimizationPolicy ? optimizationPolicy + "\n\n" : ""}You are an expert ATS resume optimizer...`;
```

The `optimizationPolicy` parameter is the **formatted string** from `formatPolicyForPrompt()`. It is prepended to the **very beginning** of the system prompt, before any other instructions.

### 6.2 Enforcement Mechanism

1. **Policy is at the top** — LLMs pay most attention to initial instructions
2. **"SYSTEM POLICY" label** — cues the model that these are hard constraints
3. **Immutable Entities with "DO NOT MODIFY"** — explicit instruction
4. **Forbidden behaviors explicitly listed** — prevents common LLM failure modes
5. **Section ownership** — tells which agent owns which section

### 6.3 Agent Directive Section

After the SYSTEM POLICY block, the `buildAgentDirectiveSection()` function (lines 373-431) appends **per-agent directives** from the UI:

```typescript
╔═══════════════════════════════════════════════════════════════╗
║ AGENT DIRECTIVES (user-configured — MUST follow)             ║
╚═══════════════════════════════════════════════════════════════╝
SUMMARY AGENT DIRECTIVE:
- ATS Aggressiveness: 50/100 (moderate — embed keywords naturally)
- Preserve Facts: YES
- Summary Length: 300-800 characters

SKILLS AGENT DIRECTIVE:
- Max Keywords: 15
- Transferable Skills: NOT allowed
...
```

### 6.4 Call Chain

```
runBulletOnlyOptimizer()
  → buildOptimizerInput(resume, jd, intelligence, directiveConfig, optimizationPolicy)
    → systemPrompt = optimizationPolicy + "\n\n" + baseInstructions + agentDirectives + layoutDirectives
  → callAI({ systemPrompt, ... })
  → parseOptimizerOutput(rawResponse)
```

---

## 7. Orchestrator: Policy Assembly & Dispatch

**File:** `src/lib/agents/orchestrator.ts`

### 7.1 Policy Construction (lines 820-827)

```typescript
// Build policy from directive config — single source of truth for all agents
let optimizationPolicy: string | null = null;
try {
  const policy = buildOptimizationPolicy((directiveConfig as any) ?? null);
  optimizationPolicy = formatPolicyForPrompt(policy);
} catch (policyErr) {
  console.warn("[Orchestrator] Failed to build optimization policy:", ...);
}
```

### 7.2 Policy Dispatch (line 898)

The serialized policy string is passed to the locked pipeline:

```typescript
const { runLockedPipeline } = await import("../locked-pipeline");
const lockedResult = await runLockedPipeline(
  resume, jd, intelligenceContext,
  directiveConfig,    // raw config for layout directives
  optimizationPolicy  // formatted SYSTEM POLICY string
);
```

### 7.3 Pipeline Steps

| Step | Responsibility |
|------|---------------|
| 1. Job Intelligence | Analyzes JD → skills, keywords, industry |
| 2. Company + Skill Gap (parallel) | Company culture + skill gap analysis |
| 3. ATS Analysis (Before) | Scores original resume |
| 4. Resume Optimizer | Runs locked pipeline (bullet-only optimizer + assembler + guardian) |
| 5. Quality Assurance | Validates output (see Section 11) |
| 6. Reflection (optional) | Triggered when confidence < 75 or ATS improvement < 5 |

---

## 8. Section Ownership Enforcement

### 8.1 Default Ownership Map

Defined in `buildSectionOwnership()` (directive-policy.ts, lines 127-137):

| Section | Owning Agent |
|---------|-------------|
| `summary` | `summary-agent` |
| `skills` | `skills-agent` |
| `experience` | `experience-agent` |
| `education` | `education-agent` |
| `languages` | `languages-agent` |
| `certifications` | `languages-agent` |
| `projects` | `additional-information-agent` |

### 8.2 How It's Enforced

1. **Serialized into every prompt** via `formatPolicyForPrompt()` → "Section Ownership (single-agent per section):" block
2. **Agent isolation**: Each agent in the pipeline operates on only its assigned section via the Locked Pipeline architecture
3. **LLM cannot add/remove sections**: The `forbidSectionAddRemove` flag is hardcoded `true` in the policy
4. **Section reorder forbidden**: `forbidSectionReorder` is hardcoded `true`

### 8.3 Programmatic Enforcement

The section ownership map is also used programmatically to route output sections to the correct post-processing handlers.

---

## 9. Immutable Entity Model

### 9.1 Which Entities Are Frozen

| Entity | Flag | Enforcement | Reason |
|--------|------|-------------|--------|
| **Company names** | `preserveCompanies` | Fuzzy match via `enforceLockedFields()` | Prevents hallucinated employers |
| **Dates** | `preserveDates` | Exact string comparison | Chronological integrity |
| **Education** | `preserveEducation` | Count + fuzzy institution match | Degree verification |
| **Languages** | `preserveLanguages` | Exact set comparison | Language proficiency accuracy |
| **Certifications** | `preserveCertifications` | Name comparison | Credential integrity |
| **Contact info** | `preserveContact` | Exact string comparison | Never change name/email/phone |

### 9.2 Enforcement in orchestrator.ts

The `enforceLockedFields()` function (lines 99-267) runs **after** the optimizer produces output:

1. **Contact**: Forces `name`, `email`, `phone`, `location` from original
2. **Experience**: Matches by ID → fingerprint → restores company/location/dates
3. **Education**: Filters out hallucinated institutions → restores from original
4. **Languages**: Wholly replaces with original set
5. **Certifications**: Preserves original certification names

### 9.3 Hallucination Detection

Placeholder patterns used to reject AI-invented entries:

```typescript
const PLACEHOLDER_PATTERNS = [
  /projected\s*role/i, /previous\s*employer/i,
  /institution\s*name/i, /company\s*name/i,
  /xxx/i, /^n\/?a$/i, /placeholder/i,
  /example\s*company/i, /your\s*company/i, /sample/i,
];
```

---

## 10. Built-in Profiles & applyProfileToConfig()

**File:** `src/lib/directive-profiles.ts`

### 10.1 The 6 Built-in Profiles

| ID | Name | Tags | ATS Aggressiveness | Strict Mode | Retries | Provider Switch | Max Keywords | Max Expansion |
|----|------|------|-------------------|-------------|---------|----------------|-------------|---------------|
| `ats-conservative` | ATS Conservative | ats, safe, conservative | 25 | true | true | false | 15 | 20% |
| `ats-aggressive` | ATS Aggressive | ats, aggressive, keywords | 85 | false | true | true | 30 | 40% |
| `cabin-crew` | Cabin Crew / Aviation | aviation, hospitality, customer-service | 60 | true | true | false | 25 | 30% |
| `retail` | Retail / Sales | retail, sales, customer-service | 50 | true | true | false | 20 | 25% |
| `hospitality` | Hospitality | hospitality, tourism, service | 50 | true | true | false | 22 | 25% |
| `executive` | Executive / Leadership | executive, leadership, senior | 65 | true | true | true | 25 | 35% |

### 10.2 Profile Interface

```typescript
interface DirectiveProfile {
  id: string;
  name: string;
  description: string;
  tags: string[];
  overrides: Partial<OptimizerDirectiveConfig>;
}
```

### 10.3 applyProfileToConfig()

**Lines 192-213.** Deep-merges a profile's `overrides` into the base config:

```typescript
export function applyProfileToConfig(
  baseConfig: OptimizerDirectiveConfig,
  profile: DirectiveProfile,
): OptimizerDirectiveConfig {
```

**Merge strategy:**
1. Deep-merge `agentDirectives` if both exist (section-by-section: supervisor, summary, skills, experience, education, languages)
2. Spread other scalar overrides (page size, font, margins, etc.)

### 10.4 Profile Registry

```typescript
export const BUILT_IN_PROFILES: Record<string, DirectiveProfile> = {
  "ats-conservative": ATS_CONSERVATIVE,
  "ats-aggressive": ATS_AGGRESSIVE,
  "cabin-crew": CABIN_CREW,
  "retail": RETAIL,
  "hospitality": HOSPITALITY,
  "executive": EXECUTIVE,
};
```

Future: Merge with user-saved profiles from D1 (noted in a TODO at line 176).

---

## 11. QA: checkPolicyCompliance() — 9 Checks

**File:** `directive-policy.ts`, lines 292-472  
**Called from:** `qa-agent.ts`, lines 139-147

### 11.1 The 9 Compliance Checks

| # | Check Key | What It Validates | Fail Condition |
|---|-----------|-------------------|---------------|
| 1 | `companies_preserved` | Source companies exist in optimized (fuzzy match) | `preserveCompanies` enabled + fuzzy match fails |
| 2 | `dates_preserved` | Experience dates unchanged | `preserveDates` enabled + any date differs |
| 3 | `education_preserved` | Same number of education entries | `preserveEducation` enabled + count mismatch |
| 4 | `languages_preserved` | Same number of language entries | `preserveLanguages` enabled + count mismatch |
| 5 | `summary_length` | Summary within word bounds | Summary empty or outside `[summaryMinWords, summaryMaxWords]` |
| 6 | `no_targeted_keywords_section` | No "Targeted Keywords" in skills | `forbidTargetedKeywordsSection` + skill name/category contains "targeted keyword" |
| 7 | `experience_count_preserved` | Experience entries not dropped | Optimized has fewer entries than source |
| 8 | `character_range` | Total JSON length within `[minTotalChars, maxTotalChars]` | Out of bounds |
| 9 | `bullet_only_compliance` | Experience headers (title/company/dates) unchanged from source | `experienceStrategy === "bullet-only"` + header mismatch |

### 11.2 Scoring

```typescript
const complianceScore = totalChecks > 0
  ? Math.round((passedCount / totalChecks) * 100)
  : 100;
```

### 11.3 QA Threshold in qa-agent.ts

```typescript
const passed = complianceScore >= 90; // 90% threshold
```

Checks that are **skipped** (because the corresponding policy flag is not enforced, or no source resume available) are counted as **passed**.

### 11.4 Return Value

```typescript
{
  complianceScore: number;    // 0-100
  checks: ComplianceCheck[];  // { check: string, passed: boolean, detail?: string }
}
```

### 11.5 QA Integration

In `qa-agent.ts`, the `runQA()` function (lines 104-252):

1. Runs `checkPolicyCompliance()` when both `optimizationPolicy` and `originalResume` are provided
2. Creates a `DirectiveComplianceResult` with pass/fail at ≥90 score
3. Adds it as a `"Directive Compliance"` check to the QA checks list
4. The check has weight **2.5** (highest tier, tied with Factual Consistency)
5. Failure contributes to lowering overall confidence
6. If confidence < 75 or any critical check fails, the Reflection Agent triggers

---

## 12. ASCII Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                          OPTIMIZATION DIRECTIVE FLOW                             │
├─────────────────────────────────────────────────────────────────────────────────┤
│                                                                                  │
│  ┌────────────────────┐                                                          │
│  │ OptimizerDirective  │  UI Widget (React component)                           │
│  │     .tsx            │                                                        │
│  │                    │  Reads/writes Zustand store via:                        │
│  │  [Profile Buttons] │    useApp(s => s.optimizerDirective)                   │
│  │  [Sliders/Switches]│    useApp(s => s.updateOptimizerDirective)             │
│  └────────┬───────────┘                                                        │
│           │                                                                      │
│           │  applyProfileToConfig(draft, profile)                                │
│           ▼                                                                      │
│  ┌───────────────────┐                                                          │
│  │   Zustand Store   │  OptimizerDirectiveConfig                                 │
│  │  (useApp state)   │  e.g. { enforceOnePage, fontFamily, bodyFontSizePt,      │
│  └────────┬──────────┘         agentDirectives: { summary, skills, ... } }      │
│           │                                                                      │
│           │  orchestrator.ts reads store:                                        │
│           │    directiveConfig = useApp.getState().optimizerDirective            │
│           ▼                                                                      │
│  ┌───────────────────┐                                                          │
│  │ buildOptimization │  Translates OptimizerDirectiveConfig → OptimizationPolicy │
│  │   Policy()        │  (37+ fields, typed interface)                           │
│  └────────┬──────────┘                                                          │
│           │                                                                      │
│           ▼                                                                      │
│  ┌───────────────────┐                                                          │
│  │ formatPolicyFor   │  Serializes OptimizationPolicy → human-readable string   │
│  │   Prompt()        │  "=== SYSTEM POLICY ===" block                           │
│  └────────┬──────────┘                                                          │
│           │                                                                      │
│           ▼                                                                      │
│  ┌──────────────────────────────────────────────────────────────────────────┐   │
│  │                      SUPERVISOR / ORCHESTRATOR                            │   │
│  │  (orchestrator.ts: _runOptimizationPipelineInner)                        │   │
│  │                                                                          │   │
│  │  1. Job Intelligence Agent  ── analyzes JD                               │   │
│  │  2. Company + Skill Gap     ── parallel analysis                         │   │
│  │  3. ATS Analysis (Before)   ── score original resume                     │   │
│  │  4. Resume Optimizer ─────────────────────────────────────┐              │   │
│  └─────────────────────────────────────────────────────────┬──┘              │   │
│                                                            │                 │   │
│              ┌─────────────────────────────────────────────┘                 │   │
│              ▼                                                               │   │
│  ┌──────────────────────────────┐                                           │   │
│  │      locked-pipeline         │  Dynamic import                           │   │
│  │  runLockedPipeline(          │                                           │   │
│  │    resume, jd,               │                                           │   │
│  │    intelligenceContext,      │                                           │   │
│  │    directiveConfig,          │                                           │   │
│  │    optimizationPolicy)       │  ← formatted "=== SYSTEM POLICY ==="      │   │
│  └────────┬─────────────────────┘                                           │   │
│           │                                                                  │   │
│           ▼                                                                  │   │
│  ┌──────────────────────────────┐                                           │   │
│  │  bullet-only-optimizer.ts    │                                           │   │
│  │                              │                                           │   │
│  │  buildOptimizerInput() ──────┤────────────────────────────┐              │   │
│  │    ↓                         │                            │              │   │
│  │  systemPrompt =              │                            │              │   │
│  │    "=== SYSTEM POLICY ==="   │  PREPENDED AT TOP          │              │   │
│  │    + "\n\n"                  │  OF EVERY LLM PROMPT       │              │   │
│  │    + "You are an expert..."  │                            │              │   │
│  │    + agentDirectives        │                            │              │   │
│  │    + layoutDirectives       │                            │              │   │
│  │                              │                            │              │   │
│  │  callAI(systemPrompt) ───────┼────────► LLM              │              │   │
│  │    ↓                         │                            │              │   │
│  │  parseOptimizerOutput()      │ ← { summary, headline,    │              │   │
│  │    ↓                         │     skills, experiences   │              │   │
│  │  OptimizerOutput             │     [{id, bullets}] }     │              │   │
│  └────────┬─────────────────────┘                           │              │   │
│           │                                                 │              │   │
│           ▼                                                 │              │   │
│  ┌──────────────────────────────┐                           │              │   │
│  │    Resume Assembler          │  Merges LLM output with   │              │   │
│  │                              │  source resume: entity    │              │   │
│  │  • Restores companies/dates  │  lock + assembly          │              │   │
│  │  • Restores education/langs  │                           │              │   │
│  │  • Preserves contact info    │                           │              │   │
│  └────────┬─────────────────────┘                           │              │   │
│           │                                                 │              │   │
│           ▼                                                 │              │   │
│  ┌──────────────────────────────┐                           │              │   │
│  │  Structure Guardian          │  Validates output         │              │   │
│  │  (fingerprint/score)         │  structure + content      │              │   │
│  └──────────────────────────────┘                           │              │   │
│                                                                │              │   │
│  ==========================================================  │              │   │
│  QA PATH (Step 5)                                             │              │   │
│  ==========================================================  │              │   │
│           │                                                   │              │   │
│           ▼                                                   │              │   │
│  ┌──────────────────────────────┐                             │              │   │
│  │   qa-agent.ts                │                             │              │   │
│  │                              │                             │              │   │
│  │  runQA(optimizedResume,      │                             │              │   │
│  │        jd, ji,               │                             │              │   │
│  │        originalResume,       │                             │              │   │
│  │        { checkExport },      │                             │              │   │
│  │        optimizationPolicy)   │                             │              │   │
│  │         ↓                    │                             │              │   │
│  │  checkPolicyCompliance(      │                             │              │   │
│  │    optimizedResume,          │                             │              │   │
│  │    sourceResume,             │                             │              │   │
│  │    policy)                   │                             │              │   │
│  │         ↓                    │                             │              │   │
│  │  complianceScore =           │                             │              │   │
│  │    passedCount / totalChecks │                             │              │   │
│  │        × 100                 │                             │              │   │
│  │         ↓                    │                             │              │   │
│  │  passed = score >= 90        │                             │              │   │
│  │                              │                             │              │   │
│  │  Weighted with other          │                             │              │   │
│  │  QA checks → confidence      │                             │              │   │
│  └──────────────────────────────┘                             │              │   │
│                                                                │              │   │
│  ==========================================================  │              │   │
│  COMPLIANCE CHECKS (9)                                        │              │   │
│  ==========================================================  │              │   │
│  1. ✓ companies_preserved        (fuzzy match)                │              │   │
│  2. ✓ dates_preserved            (exact match)                │              │   │
│  3. ✓ education_preserved        (count match)                │              │   │
│  4. ✓ languages_preserved        (count match)                │              │   │
│  5. ✓ summary_length             (word bounds)                │              │   │
│  6. ✓ no_targeted_keywords_section (forbidden section)        │              │   │
│  7. ✓ experience_count_preserved (entries not dropped)        │              │   │
│  8. ✓ character_range            (2500-3800 chars)            │              │   │
│  9. ✓ bullet_only_compliance     (headers unchanged)          │              │   │
│                                                                │              │   │
└────────────────────────────────────────────────────────────────────────────────┘
```

---

## 13. File Reference

| File | Purpose | Key Exports |
|------|---------|-------------|
| `src/lib/directive-policy.ts` | Policy type, builder, serializer, compliance checker | `OptimizationPolicy`, `buildOptimizationPolicy()`, `formatPolicyForPrompt()`, `checkPolicyCompliance()` |
| `src/lib/directive-profiles.ts` | Built-in profiles + applyProfileToConfig() | `DirectiveProfile`, `BUILT_IN_PROFILES`, `applyProfileToConfig()`, `getAllProfiles()` |
| `src/lib/bullet-only-optimizer.ts` | LLM prompt construction + response parsing | `runBulletOnlyOptimizer()`, `buildOptimizerInput()`, `parseOptimizerOutput()`, `buildAgentDirectiveSection()` |
| `src/lib/agents/orchestrator.ts` | Pipeline coordinator — builds policy, dispatches to locked pipeline | `runOptimizationPipeline()`, `enforceLockedFields()` |
| `src/lib/agents/qa-agent.ts` | Full QA pipeline including directive compliance | `runQA()`, `checkFactualConsistency()`, `checkProfessionalTone()`, `checkExportQuality()` |
| `src/components/app/modules/OptimizerDirective.tsx` | React UI for directive configuration | `OptimizerDirective` component, `AgentDirectivesSection`, `generateDirectivePreview()` |

---

*Document generated from source code analysis. Last updated: June 27, 2026.*
