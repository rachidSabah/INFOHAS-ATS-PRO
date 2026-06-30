// ============================================================================
// Section Hash — Deterministic content fingerprinting for render parity
// ============================================================================
// Every section across Preview, DOCX, and PDF produces a hash. If any hash
// mismatches, the renderers have diverged and the export should be aborted.

import type { RenderDocument, RenderContentItem } from "./types";

/**
 * Compute a deterministic hash for a given text string.
 * Stable across runs — same input always produces same hash.
 */
export function computeSectionHash(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16).padStart(8, "0");
}

export interface SectionHashEntry {
  type: string;
  title: string;
  hash: string;
  charCount: number;
}

/**
 * Serialize a RenderContentItem to flat text for hashing.
 */
export function serializeContentItem(item: RenderContentItem): string {
  switch (item.kind) {
    case "text":
      return item.text;
    case "bullets":
      return item.bullets.join("\n");
    case "table-row":
      return (item.cells || []).map((c) => c.text).join(" ");
    case "nested-bullets":
      return item.groups.map((g) => g.label + ": " + g.items.join(", ")).join("\n");
    default:
      return "";
  }
}

/**
 * Compute hashes for every section in a RenderDocument.
 */
export function computeSectionHashes(rd: RenderDocument): SectionHashEntry[] {
  return rd.sections.map((section) => {
    const fullText = section.items.map(serializeContentItem).join("\n");
    return {
      type: section.type,
      title: section.title,
      hash: computeSectionHash(fullText),
      charCount: fullText.length,
    };
  });
}

/**
 * Compare two sets of section hashes. Returns a diff list.
 * If all diffs are empty, the renderers are in parity.
 */
export function compareSectionHashes(
  expected: SectionHashEntry[],
  actual: SectionHashEntry[],
): { match: boolean; diffs: string[] } {
  const diffs: string[] = [];

  if (expected.length !== actual.length) {
    diffs.push(
      `Section count mismatch: expected ${expected.length} sections, got ${actual.length}`,
    );
  }

  const maxLen = Math.max(expected.length, actual.length);
  for (let i = 0; i < maxLen; i++) {
    const e = expected[i];
    const a = actual[i];
    if (!e || !a) {
      diffs.push(`Section at index ${i} is missing from ${!e ? "expected" : "actual"}`);
      continue;
    }
    if (e.hash !== a.hash) {
      diffs.push(
        `Section "${e.type}" (idx ${i}) hash mismatch: ` +
        `expected ${e.hash} (${e.charCount} chars), ` +
        `got ${a.hash} (${a.charCount} chars)`,
      );
    }
  }

  return { match: diffs.length === 0, diffs };
}
