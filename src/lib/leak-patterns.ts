// ============================================================================
// Leak Patterns — unified source of truth for AI error leak detection.
//
// Previously there were two parallel lists:
//   - ai-error-filter.ts: ERROR_LEAK_PATTERNS (43 patterns)
//   - ai-response-processor.ts: LEAK_PATTERNS (80+ patterns, superset)
//
// They had drifted. This module unifies them into one list, adds missing
// provider names (Gemini, Mistral, Cohere, Groq, OpenRouter, Together,
// HuggingFace, Ollama), and is re-exported from both original modules so
// existing imports keep working.
//
// These patterns prevent AI provider errors, debug messages, and analysis
// artifacts from ever leaking into resume content or exported PDFs.
// ============================================================================

export const LEAK_PATTERNS: RegExp[] = [
  // --- Provider / API errors ---
  /api\s?key\s?(invalid|missing|wrong|expired|unauthorized|revoked)/i,
  /rate\s?limit\s?(exceeded|reached|hit)/i,
  /quota\s?(exceeded|reached|exhausted)/i,
  /timeout\s?(exceeded|reached|occurred)/i,
  /network\s?(error|failure|timeout)/i,
  /connection\s?(refused|reset|failed|closed)/i,
  /dns\s?(resolution\s?failed|error)/i,
  /ssl\s?(certificate\s?error|handshake\s?failed)/i,
  /cors\s?(error|blocked|failed)/i,
  /503\s?service\s?unavailable/i,
  /502\s?bad\s?gateway/i,
  /500\s?internal\s?server\s?error/i,
  /429\s?too\s?many\s?requests/i,
  /401\s?unauthorized/i,
  /403\s?forbidden/i,
  /404\s?not\s?found/i,
  /request\s?failed\s?with\s?status\s?code\s?\d+/i,
  /fetch\s?failed/i,
  /econnrefused/i,
  /enetunreach/i,
  /socket\s?hang\s?up/i,

  // --- AI provider names (should never appear in resume content) ---
  /\b(claude|claude-sonnet|claude-opus|claude-haiku|gpt-4o?-?mini?|gpt-5?-?nano?|gpt-3\.5|gpt-4|chatgpt|openai)\b/i,
  /\b(deepseek|deepseek-v[34]|deepseek-chat|deepseek-coder|deepseek-r1)\b/i,
  /\b(putern?\.?js|puter\.com|puter\s?auth)\b/i,
  /\b(gemini|gemini-pro|gemini-flash|gemini-ultra|google\s?ai|bard|palm)\b/i,
  /\b(mistral|mixtral|codestral|mistral-large|mistral-small)\b/i,
  /\b(cohere|command-r|command-r\+|coral|capybara)\b/i,
  /\b(groq|llama-3|llama-2|llama-3\.1|llama-3\.3|llama-4)\b/i,
  /\b(openrouter|openrouter\.ai)\b/i,
  /\b(together\s?ai|together\.ai|togethercomputer)\b/i,
  /\b(hugging\s?face|huggingface|hf\.co|inference\.api)\b/i,
  /\b(ollama|llama\.cpp|ggml|gguf)\b/i,
  /\b(anthropic|anthropic\.com)\b/i,
  /\b(perplexity|sonar|pplx)\b/i,
  /\b(xai|grok|grok-2|grok-3|grok-4)\b/i,

  // --- JSON / parsing errors ---
  /unexpected\s?token\s?['"]?[A-Za-z]/i,
  /unexpected\s?end\s?of\s?(json|input|string)/i,
  /json\s?(parse\s?)?error/i,
  /syntax\s?error/i,
  /invalid\s?json/i,
  /malformed\s?json/i,
  /unable\s?to\s?parse/i,
  /parse\s?failed/i,
  /token\s?unexpected/i,

  // --- AI fallback / retry messages ---
  /falling\s?back\s?to/i,
  /fallback\s?(mode|activated|engaged)/i,
  /retrying/i,
  /please\s?try\s?(again|later)/i,
  /try\s?again\s?(later|in\s?a\s?moment)/i,
  /an\s?error\s?occurred/i,
  /something\s?went\s?wrong/i,
  /oops/i,
  /unable\s?to\s?(complete|process|generate|optimize)/i,
  /failed\s?to\s?(generate|optimize|process|parse|analyze)/i,
  /could\s?not\s?(generate|optimize|process|parse|analyze|complete)/i,
  /cannot\s?(generate|optimize|process|parse|analyze|complete)/i,
  /no\s?response\s?(from|received)/i,
  /empty\s?response/i,
  /blank\s?response/i,

  // --- AI system / debug messages ---
  /as\s?an\s?ai/i,
  /as\s?a\s?language\s?model/i,
  /i\s?(cannot|can't|am\s?unable\s?to)\s?(generate|create|provide)/i,
  /i\s?don't\s?have\s?(access|information)/i,
  /my\s?(training|knowledge)\s?(data|cutoff)/i,
  /i\s?apologize/i,
  /i'm\s?sorry/i,
  /however\s?,?\s?i\s?(must|should)\s?(note|mention|clarify)/i,
  /please\s?note\s?that\s?i\s?am/i,

  // --- Analysis artifacts (should never be in the resume content itself) ---
  /the\s?(original|source)\s?resume\s?(lacks|is\s?missing|needs)/i,
  /from\s?the\s?(job\s?description|jd):/i,
  /ats\s?analysis/i,
  /ats\s?score/i,
  /keyword\s?match(?:ing|es)?\s?(score|percentage|rate)?/i,
  /optimization\s?(notes|applied|complete)/i,
  /ai\s?notes/i,
  /analysis\s?report/i,
  /summary\s?critique/i,
  /the\s?resume\s?(could|should|would)\s?(be|benefit)/i,
  /improvements?\s?(made|applied|suggested)/i,
  /changes\s?(made|applied)/i,
  /here\s?(is|are)\s?(the|your)\s?(optimized|revised|updated)/i,
  /based\s?on\s?(the|your)\s?(input|resume|job)/i,
  /requirement\s?match/i,
  /missing\s?keywords?\s?(found|identified|added)/i,

  // --- Markdown / formatting artifacts ---
  /^```json\s*$/m,
  /^```\s*$/m,
  /^```[a-z]*\s*$/m,
  /^\s*\*+\s*$/, // horizontal rule of asterisks
  /^---+$/m, // horizontal rule of dashes

  // --- System / debug messages ---
  /console\.(log|error|warn|debug|info)/i,
  /stack\s?trace/i,
  /at\s+\S+\s+\(\S+:\d+:\d+\)/i, // stack frame
  /debug\s?mode/i,
  /development\s?mode/i,
  /test\s?mode/i,
];

/**
 * Check if a text string contains any AI error leak patterns.
 * Returns the list of matched patterns (empty if clean).
 */
export function detectLeaks(text: string): string[] {
  if (!text || typeof text !== "string") return [];
  const matches: string[] = [];
  for (const pattern of LEAK_PATTERNS) {
    if (pattern.test(text)) {
      matches.push(pattern.source);
    }
  }
  return matches;
}

/**
 * Check if a text string is clean (no leaks).
 */
export function isClean(text: string): boolean {
  if (!text || typeof text !== "string") return true;
  return !LEAK_PATTERNS.some((p) => p.test(text));
}

/**
 * Strip leak patterns from text, replacing them with empty strings.
 * Returns the cleaned text + list of repairs made.
 */
export function stripLeaks(text: string): { cleaned: string; repairs: string[] } {
  if (!text || typeof text !== "string") return { cleaned: text, repairs: [] };
  const repairs: string[] = [];
  let cleaned = text;
  for (const pattern of LEAK_PATTERNS) {
    if (pattern.test(cleaned)) {
      cleaned = cleaned.replace(pattern, "");
      repairs.push(pattern.source);
    }
  }
  // Clean up extra whitespace left behind
  cleaned = cleaned.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  return { cleaned, repairs };
}
