import { CareerMaterial } from "./types";

interface SearchResult {
  material: CareerMaterial;
  score: number;
  snippet: string;
}

/**
 * Clean and tokenize text
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

/**
 * Calculate TF-IDF scores for career materials based on query keywords
 */
export function searchCareerMaterials(
  materials: CareerMaterial[],
  query: string,
  limit: number = 3
): SearchResult[] {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0 || materials.length === 0) return [];

  const results: SearchResult[] = [];
  const totalDocs = materials.length;

  // Calculate Document Frequency (DF) for each query token
  const df: Record<string, number> = {};
  for (const token of queryTokens) {
    let count = 0;
    for (const doc of materials) {
      if (doc.contentText.toLowerCase().includes(token)) {
        count++;
      }
    }
    df[token] = count;
  }

  for (const doc of materials) {
    const docTokens = tokenize(doc.contentText);
    const docLen = docTokens.length;
    if (docLen === 0) continue;

    // Calculate Term Frequency (TF) for query tokens in this document
    let score = 0;
    const termCounts: Record<string, number> = {};
    for (const token of docTokens) {
      termCounts[token] = (termCounts[token] || 0) + 1;
    }

    for (const token of queryTokens) {
      const count = termCounts[token] || 0;
      if (count > 0) {
        const tf = count / docLen;
        const idf = Math.log((1 + totalDocs) / (1 + (df[token] || 0))) + 1;
        score += tf * idf;
      }
    }

    if (score > 0) {
      // Find a snippet around matching keywords
      let snippet = doc.contentText.slice(0, 200);
      const lowerContent = doc.contentText.toLowerCase();
      for (const token of queryTokens) {
        const idx = lowerContent.indexOf(token);
        if (idx !== -1) {
          const start = Math.max(0, idx - 80);
          const end = Math.min(doc.contentText.length, idx + 120);
          snippet = (start > 0 ? "..." : "") + doc.contentText.slice(start, end).trim() + (end < doc.contentText.length ? "..." : "");
          break;
        }
      }

      results.push({
        material: doc,
        score,
        snippet,
      });
    }
  }

  // Sort by score descending
  return results.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Format search results as context blocks for the AI prompt
 */
export function formatRAGContext(results: SearchResult[]): string {
  if (results.length === 0) return "";
  return [
    "=== CANDIDATE CAREER FACT CORPUS (RAG RETRIEVED) ===",
    "The following factual snippets were retrieved from the candidate's career documents, certificates, and past projects.",
    "Use these actual facts, achievements, and metrics to fill skills gaps or add relevant details if appropriate:",
    ...results.map((r, i) => `[Fact #${i + 1}] Category: ${r.material.category}, Source: ${r.material.title}\nContent: ${r.snippet}\n`),
    "====================================================="
  ].join("\n");
}
