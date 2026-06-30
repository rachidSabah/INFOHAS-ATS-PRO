// ============================================================================
// Language Detection — extracted from parser.ts to avoid circular imports
// ============================================================================

"use client";

const KNOWN_LANGUAGES = new Set([
  "english", "french", "arabic", "spanish", "german", "italian", "chinese", "japanese",
  "russian", "portuguese", "hindi", "bengali", "punjabi", "marathi", "telugu", "tamil",
  "urdu", "turkish", "korean", "vietnamese", "javanese", "thai", "persian",
  "polish", "romanian", "dutch", "nederlands", "greek", "hungarian", "swedish", "czech", "hebrew",
  "indonesian", "malay", "norwegian", "danish", "finnish", "slovak", "ukrainian", "catalan",
  "swahili", "filipino", "tagalog", "luxembourgish", "kabyle", "berber", "amazigh",
  "latin", "sanskrit", "esperanto", "cantonese", "mandarin", "darija", "gaelic", "irish",
  "welsh", "basque", "galician", "croatian", "serbian", "slovenian", "bulgarian", "estonian",
  "latvian", "lithuanian", "icelandic", "albanian", "macedonian", "georgian", "armenian",
  "azerbaijani", "kazakh", "uzbek", "mongolian", "nepali", "sinhala", "khmer", "lao",
  "myanmar", "burmese", "amharic", "somali", "yoruba", "igbo", "zulu", "xhosa", "afrikaans"
]);

export function detectLanguage(s: string): { name: string; proficiency: "basic" | "conversational" | "fluent" | "native" } | null {
  const clean = s.trim();
  if (!clean) return null;

  const words = clean.toLowerCase().split(/[^a-z]+/);
  const foundLang = words.find(w => w.length >= 2 && KNOWN_LANGUAGES.has(w));
  if (!foundLang) {
    return null;
  }

  let proficiency: "basic" | "conversational" | "fluent" | "native" = "fluent";
  const lower = clean.toLowerCase();
  if (lower.includes("native") || lower.includes("bilingual")) {
    proficiency = "native";
  } else if (lower.includes("conversational") || lower.includes("intermediate") || lower.includes("good")) {
    proficiency = "conversational";
  } else if (lower.includes("basic") || lower.includes("elementary") || lower.includes("beginner")) {
    proficiency = "basic";
  }

  const formattedName = foundLang.charAt(0).toUpperCase() + foundLang.slice(1);
  return { name: formattedName, proficiency };
}
