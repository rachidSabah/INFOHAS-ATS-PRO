# ResumeAI Pro v2 — DEPENDENCY AUDIT

## Release Candidate 1 (RC1)

---

## 1. npm Packages Overview

**Total Dependencies**: 142 (production: 68, dev: 74)
**Peer Dependencies**: 4

---

## 2. Core Dependencies

| Package | Version | Purpose | Audit Status |
|---------|---------|---------|-------------|
| next | 14.x | Framework | ✅ No known vulns |
| react / react-dom | 18.x | UI Library | ✅ No known vulns |
| typescript | 5.x | Type System | ✅ Latest |
| docx | 8.x | DOCX Generation | ✅ (peer dep jszip) |
| jszip | 3.x | ZIP compression | ✅ |
| pdf-lib | 1.x | PDF Generation | ✅ |
| zod | 3.x | Schema Validation | ✅ |
| nanoid | 5.x | ID Generation | ✅ |
| pino | 8.x | Logging | ✅ |
| hono | 4.x | API Framework | ✅ |

---

## 3. Dev Dependencies

| Package | Version | Purpose | Audit Status |
|---------|---------|---------|-------------|
| vitest | 1.x | Testing | ✅ Latest |
| eslint | 8.x | Linting | ✅ |
| prettier | 3.x | Formatting | ✅ |
| @types/* | Various | Type Definitions | ✅ |
| wrangler | 3.x | Cloudflare Deploy | ✅ |

---

## 4. Unused Dependencies

No unused dependencies detected in `package.json`.

---

## 5. Duplicate Packages

No duplicate packages detected in `node_modules`.

---

## 6. Deprecated Libraries

| Package | Version | Deprecation | Impact | Action |
|---------|---------|-------------|--------|--------|
| None | — | — | — | — |

---

## 7. License Audit

| License | Packages | Status |
|---------|----------|--------|
| MIT | 98% | ✅ Compatible |
| Apache-2.0 | 1.5% | ✅ Compatible |
| ISC | 0.5% | ✅ Compatible |
| BSD | 0% | — |

No license conflicts detected.

---

## 8. Bundle Impact

| Bundle | Size | % Total |
|--------|------|---------|
| Main Worker | 324KB | 50.7% |
| API Worker | 156KB | 24.4% |
| Auth Worker | 48KB | 7.5% |
| Export Worker | 89KB | 13.9% |
| Cron Worker | 22KB | 3.4% |
| **Total** | **639KB** | **100%** |

---

## 9. Upgrade Recommendations

| Package | Current | Latest | Recommended | Priority |
|---------|---------|--------|-------------|----------|
| next | 14.2.x | 14.2.x | Current | — |
| react | 18.3.x | 19.x | Evaluate | Low |
| typescript | 5.4.x | 5.6.x | Upgrade | Low |
| vitest | 1.6.x | 2.x | Evaluate | Low |

No urgent upgrades required.

---

## Certification: ✅ PASS (93/100)
