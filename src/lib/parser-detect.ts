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

// French language names → canonical English names (parser.ts has the same
// map — this copy exists to avoid a circular import, keep both in sync).
// The product's core market (Morocco) writes resumes with French content:
// "Français: courant", "Arabe: langue maternelle", etc.
const FRENCH_LANGUAGE_NAME_MAP: Record<string, string> = {
  arabe: "arabic",
  francais: "french",
  anglais: "english",
  espagnol: "spanish",
  allemand: "german",
  italien: "italian",
  neerlandais: "dutch",
  portugais: "portuguese",
  turc: "turkish",
  russe: "russian",
  chinois: "chinese",
  japonais: "japanese",
  perse: "persian",
  hindi: "hindi",
  amazigh: "amazigh",
  berbere: "berber",
  tachelhit: "tachelhit",
  darija: "darija",
};

export function detectLanguage(s: string): { name: string; proficiency: "basic" | "conversational" | "fluent" | "native" } | null {
  const clean = s.trim();
  if (!clean) return null;

  const lower = clean.toLowerCase();
  // Accent-aware split: [^a-z] used to treat é/è/ç as separators, shredding
  // "français" into ["fran", "ais"] and losing the language entirely.
  const words = lower.split(/[^a-zà-ÿ]+/);
  let foundLang = words.find(w => w.length >= 2 && KNOWN_LANGUAGES.has(w));
  if (!foundLang) {
    // Map French-language names onto the canonical English set
    foundLang = words.map(w => FRENCH_LANGUAGE_NAME_MAP[w]).find(Boolean);
  }
  if (!foundLang) {
    return null;
  }

  let proficiency: "basic" | "conversational" | "fluent" | "native" = "fluent";
  if (lower.includes("native") || lower.includes("bilingual") || lower.includes("bilingue") || lower.includes("langue maternelle")) {
    proficiency = "native";
  } else if (lower.includes("conversational") || lower.includes("intermediate") || lower.includes("good") || lower.includes("courant") || lower.includes("scolaire")) {
    proficiency = "conversational";
  } else if (lower.includes("basic") || lower.includes("elementary") || lower.includes("beginner") || lower.includes("notions")) {
    proficiency = "basic";
  }

  const formattedName = foundLang.charAt(0).toUpperCase() + foundLang.slice(1);
  return { name: formattedName, proficiency };
}
