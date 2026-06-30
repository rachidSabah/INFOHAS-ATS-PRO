// ============================================================================
// Sentence Completeness Validator
//
// Validates that every sentence in the resume ends correctly.
// Rejects truncated sentences like:
//   "demonstrating strong computer"
//   "providing accurate"
//   "excellent communication and"
// ============================================================================

"use client";

/**
 * Check if a sentence is complete (ends with period, exclamation, or question mark).
 * Returns the sentence if complete, or the fixed version if it can be fixed.
 */
export function validateSentenceCompleteness(text: string): {
  valid: boolean;
  issues: string[];
  cleaned: string;
} {
  if (!text || text.trim().length === 0) {
    return { valid: true, issues: [], cleaned: text };
  }

  const issues: string[] = [];
  let cleaned = text;

  // Split into sentences by period, exclamation, or question mark
  // But keep the delimiter
  const sentences = cleaned.match(/[^.!?]*[.!?]+|[^.!?]+$/g) || [cleaned];

  for (const sentence of sentences) {
    const trimmed = sentence.trim();
    if (!trimmed) continue;

    // Check if sentence ends with proper punctuation
    if (!/[.!?]$/.test(trimmed)) {
      // Check if it's a truncated sentence (ends with a preposition, conjunction, or incomplete phrase)
      const lastWord = trimmed.split(/\s+/).pop()?.toLowerCase() || "";
      const TRUNCATION_INDICATORS = [
        "and", "or", "but", "of", "in", "on", "at", "with", "for",
        "to", "by", "from", "the", "a", "an", "is", "are", "was",
        "were", "be", "been", "being", "have", "has", "had",
        "will", "would", "could", "should", "may", "might", "must",
        "can", "shall", "do", "does", "did", "not", "no",
      ];

      if (TRUNCATION_INDICATORS.includes(lastWord)) {
        issues.push(`Truncated sentence: "...${trimmed.slice(-60)}"`);
        // Fix: add a period at the end
        cleaned = cleaned.replace(trimmed, trimmed + ".");
      } else if (trimmed.length > 0 && !/[.!?;:]$/.test(trimmed)) {
        // Sentence doesn't end with any punctuation — add period
        // But only if it looks like a complete thought (more than 3 words)
        const wordCount = trimmed.split(/\s+/).length;
        if (wordCount > 3) {
          issues.push(`Sentence missing terminal punctuation: "${trimmed.slice(0, 60)}..."`);
          cleaned = cleaned.replace(trimmed, trimmed + ".");
        }
      }
    }

    // Check for truncated phrases (incomplete clauses)
    const TRUNCATED_PATTERNS = [
      /\bdemonstrating\s+strong\s+\w+\s*$/i,
      /\bproviding\s+accurate\s*$/i,
      /\bexcellent\s+communication\s+and\s*$/i,
      /\bwith\s+a\s+solid\s+understanding\s+of\s*$/i,
      /\bskills\s+and\s*$/i,
      /\bexperience\s+in\s*$/i,
    ];

    for (const pattern of TRUNCATED_PATTERNS) {
      if (pattern.test(trimmed)) {
        issues.push(`Truncated phrase detected: "${trimmed.slice(-80)}"`);
        break;
      }
    }
  }

  // Fix double periods that may have been introduced
  cleaned = cleaned.replace(/\.\./g, ".");

  return {
    valid: issues.length === 0,
    issues,
    cleaned,
  };
}

/**
 * Validate all text fields in a resume for sentence completeness.
 */
export function validateResumeSentenceCompleteness(resume: {
  summary?: string;
  headline?: string;
  experience?: Array<{ title?: string; company?: string; bullets?: string[] }>;
  education?: Array<{ degree?: string; institution?: string; highlights?: string[] }>;
  skills?: Array<{ name?: string; category?: string }>;
  additionalInfo?: string;
}): {
  valid: boolean;
  issues: string[];
  cleaned: typeof resume;
} {
  const allIssues: string[] = [];
  const cleaned = JSON.parse(JSON.stringify(resume)) as typeof resume;

  // Validate summary
  if (cleaned.summary) {
    const result = validateSentenceCompleteness(cleaned.summary);
    allIssues.push(...result.issues);
    cleaned.summary = result.cleaned;
  }

  // Validate headline
  if (cleaned.headline) {
    const result = validateSentenceCompleteness(cleaned.headline);
    allIssues.push(...result.issues);
    cleaned.headline = result.cleaned;
  }

  // Validate experience bullets
  if (cleaned.experience) {
    for (const exp of cleaned.experience) {
      if (exp.bullets) {
        exp.bullets = exp.bullets.map((b) => {
          const result = validateSentenceCompleteness(b);
          allIssues.push(...result.issues);
          return result.cleaned;
        });
      }
    }
  }

  // Validate education highlights
  if (cleaned.education) {
    for (const edu of cleaned.education) {
      if (edu.highlights) {
        edu.highlights = edu.highlights.map((h) => {
          const result = validateSentenceCompleteness(h);
          allIssues.push(...result.issues);
          return result.cleaned;
        });
      }
    }
  }

  // Validate additional info
  if (cleaned.additionalInfo) {
    const result = validateSentenceCompleteness(cleaned.additionalInfo);
    allIssues.push(...result.issues);
    cleaned.additionalInfo = result.cleaned;
  }

  return {
    valid: allIssues.length === 0,
    issues: allIssues,
    cleaned,
  };
}
