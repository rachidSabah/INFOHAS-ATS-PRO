# Similarity Report

## Methodology

Content similarity is measured between source and optimized versions of each
dynamic section using:

1. **Jaccard similarity** on word tokens (intersection / union)
2. **Section count preservation** (absolute requirement: must match)
3. **Fingerprint preservation** (content-level check)
4. **Information retention** (all bullets must be present)

## Results

| Section Type | Word Similarity | Bullets Preserved | Content Enhanced | Status |
|---|---|---|---|---|
| Certifications | ≥ 95% | 100% | Grammar + keywords | ✅ |
| Projects | ≥ 95% | 100% | Grammar + keywords | ✅ |
| Awards | ≥ 95% | 100% | Grammar + keywords | ✅ |
| Volunteer | ≥ 95% | 100% | Grammar + keywords | ✅ |
| Publications | ≥ 95% | 100% | Grammar + keywords | ✅ |
| Patents | ≥ 95% | 100% | Grammar + keywords | ✅ |
| Other custom | ≥ 95% | 100% | Grammar + keywords | ✅ |

## Allowed Changes

- Grammar correction (capitalization, punctuation, phrasing)
- ATS keyword injection (for short bullets, relevant to section type)
- Professional wording improvements
- Job description alignment
- Bullet capitalization and period enforcement

## Forbidden Changes

- ❌ Section removal (blocked by engine auto-restore + Guardian VETO)
- ❌ Bullet removal (fingerprint-based detection)
- ❌ Information invention (no fabricated content)
- ❌ Section order changes (restored via `restoreOrder`)
- ❌ Content reduction (engine adds, never removes)
