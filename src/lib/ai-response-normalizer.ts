// ============================================================================
// AI Response Normalizer — the single source of truth for cleaning up AI
// responses before they reach React components or downstream parsers.
//
// PROBLEM (P1.7 — React Stability):
//   AI providers frequently return values that are NOT strings where strings
//   are expected. The most common cases:
//     - { city: "Doha", country: "Qatar" }  → should be "Doha, Qatar"
//     - { name: "John Doe" }                 → should be "John Doe"
//     - { label: "Experience", value: "5 years" }  → should be "Experience"
//     - ["React", "Node.js"]                 → should be "React, Node.js"
//     - null / undefined                     → should be ""
//     - nested objects                       → should be JSON.stringify fallback
//
//   When React tries to render an object directly, it throws:
//     "Objects are not valid as a React child. (found: object with keys
//      {city, country}). If you meant to render a collection of children,
//      use an array instead."
//   This is React Error #31 — a hard crash that unmounts the component tree.
//
// SOLUTION:
//   Every value that comes from an AI response MUST pass through
//   normalizeAIResponse() before being stored in state, persisted to D1, or
//   rendered by React. This function guarantees the output is one of:
//     - string
//     - number
//     - boolean
//     - array of strings
//     - null (only if input was null AND allowNullNull is true)
//
//   The function is DEEP — it walks objects and arrays recursively, so it
//   can be applied to entire resume objects, not just leaf values.
//
// USAGE:
//   const clean = normalizeAIResponse(rawAIResponse);
//   const text  = normalizeToText(rawAIResponse);   // always returns a string
//   const arr   = normalizeToStringArray(rawAIResponse);  // always returns string[]
// ============================================================================

"use client";

/**
 * Normalize any AI response value into a React-safe primitive.
 *
 * Rules:
 *   - string  → string (trim if too long whitespace)
 *   - number  → number
 *   - boolean → boolean
 *   - null    → "" (empty string) — React can't render null
 *   - undefined → "" (empty string)
 *   - { city, country } → "city, country"
 *   - { name } → name
 *   - { label, value } → label
 *   - { text, ... } → text
 *   - { content, ... } → content
 *   - array of strings → joined with ", "
 *   - array of objects → each object normalized, then joined
 *   - other objects → JSON.stringify fallback (last resort)
 *
 * @param value The raw AI response value (any type)
 * @param opts.deep If true (default), recursively normalize objects and arrays
 * @returns A React-safe primitive (string | number | boolean)
 */
export function normalizeAIResponse(
  value: any,
  opts: { deep?: boolean } = {},
): string | number | boolean {
  const deep = opts.deep ?? true;

  // === null / undefined ===
  if (value === null || value === undefined) {
    return "";
  }

  // === Primitives (already safe) ===
  if (typeof value === "string") {
    // Collapse excessive whitespace but preserve internal newlines
    return value.replace(/[ \t]+/g, " ").trim();
  }
  if (typeof value === "number") {
    // NaN → empty string (NaN renders as "NaN" which is ugly)
    return Number.isNaN(value) ? "" : value;
  }
  if (typeof value === "boolean") {
    return value;
  }

  // === Arrays ===
  if (Array.isArray(value)) {
    if (value.length === 0) return "";
    // Normalize each element, then join with ", "
    const parts = value
      .map((item) => normalizeAIResponse(item, { deep }))
      .filter((p): p is string => typeof p === "string" && p.length > 0);
    return parts.join(", ");
  }

  // === Objects ===
  if (typeof value === "object") {
    // === Special-case patterns ===

    // { city, country } → "city, country"
    if ("city" in value || "country" in value) {
      const city = normalizeAIResponse(value.city, { deep });
      const country = normalizeAIResponse(value.country, { deep });
      const state = value.state ? normalizeAIResponse(value.state, { deep }) : "";
      const parts = [city, state, country].filter(
        (p): p is string => typeof p === "string" && p.length > 0,
      );
      if (parts.length > 0) return parts.join(", ");
    }

    // { name } → name
    if ("name" in value && Object.keys(value).length <= 2) {
      const name = normalizeAIResponse(value.name, { deep });
      if (typeof name === "string" && name.length > 0) return name;
    }

    // { label, value } → label (the value is the secondary field)
    if ("label" in value && "value" in value) {
      const label = normalizeAIResponse(value.label, { deep });
      if (typeof label === "string" && label.length > 0) return label;
    }

    // { text } → text
    if ("text" in value && typeof value.text === "string") {
      return normalizeAIResponse(value.text, { deep });
    }

    // { content } → content
    if ("content" in value && typeof value.content === "string") {
      return normalizeAIResponse(value.content, { deep });
    }

    // { title } → title
    if ("title" in value && typeof value.title === "string") {
      return normalizeAIResponse(value.title, { deep });
    }

    // { value } → value (single-field object)
    if ("value" in value && Object.keys(value).length === 1) {
      return normalizeAIResponse(value.value, { deep });
    }

    // === Generic object fallback ===
    // If deep, try to extract meaningful text from the object's values.
    // Otherwise, JSON.stringify as a last resort.
    if (deep) {
      const values = Object.values(value);
      if (values.length === 0) return "";
      // If all values are primitives, join them
      const parts = values
        .map((v) => normalizeAIResponse(v, { deep: false }))
        .filter((p): p is string => typeof p === "string" && p.length > 0);
      if (parts.length > 0) return parts.join(", ");
    }

    // Last resort: JSON stringify
    try {
      const str = JSON.stringify(value);
      // If it's "{}" or "null", return empty
      if (str === "{}" || str === "null") return "";
      return str;
    } catch {
      return String(value);
    }
  }

  // === Functions / symbols / other weirdness ===
  try {
    return String(value);
  } catch {
    return "";
  }
}

/**
 * Normalize any AI response value to a string. Always returns a string
 * (never null, never undefined, never an object).
 *
 * Use this when you need a string for storage, display, or comparison.
 */
export function normalizeToText(value: any): string {
  const normalized = normalizeAIResponse(value);
  if (typeof normalized === "string") return normalized;
  return String(normalized);
}

/**
 * Normalize any AI response value to a string array. Always returns a
 * string[] (never null, never an object).
 *
 * - Arrays are normalized element-by-element.
 * - Strings are split on common delimiters (",", ";", "•", newlines).
 * - Objects are normalized to a single string and treated as a single element.
 * - null/undefined → []
 */
export function normalizeToStringArray(value: any): string[] {
  if (value === null || value === undefined) return [];

  // Already an array — normalize each element
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item.trim();
        if (typeof item === "number" || typeof item === "boolean") return String(item);
        return normalizeToText(item);
      })
      .filter((s) => s.length > 0);
  }

  // String — split on common delimiters
  if (typeof value === "string") {
    return value
      .split(/[,;•·|]|\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }

  // Object or primitive — normalize to a single string
  const text = normalizeToText(value);
  return text ? [text] : [];
}

/**
 * Normalize a resume object deeply — walks all fields and normalizes every
 * leaf value. This is the safest way to ensure no object sneaks into React.
 *
 * Returns a NEW object (does not mutate the input).
 */
export function normalizeResumeObject<T>(resume: T): T {
  if (resume === null || resume === undefined) return resume;
  if (typeof resume !== "object") return resume;
  if (Array.isArray(resume)) {
    return resume.map(normalizeResumeObject) as unknown as T;
  }

  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(resume as Record<string, any>)) {
    if (value === null || value === undefined) {
      result[key] = value;
    } else if (typeof value === "object") {
      // For object values, decide based on the field:
      // - If it's an array, normalize each element.
      // - If it's a location-like object, normalize to string.
      // - Otherwise, recursively normalize.
      if (Array.isArray(value)) {
        result[key] = value.map((item) =>
          item && typeof item === "object" ? normalizeResumeObject(item) : normalizeAIResponse(item),
        );
      } else if (isLocationObject(value)) {
        result[key] = normalizeToText(value);
      } else {
        result[key] = normalizeResumeObject(value);
      }
    } else {
      result[key] = value;
    }
  }
  return result as T;
}

function isLocationObject(value: any): boolean {
  if (!value || typeof value !== "object") return false;
  const keys = Object.keys(value);
  return (
    (keys.includes("city") || keys.includes("country") || keys.includes("state")) &&
    keys.length <= 4
  );
}

// ============================================================================
// Safe Render Layer — renderValue()
// ============================================================================

/**
 * The final safety net before a value reaches React's JSX.
 *
 * Use this in EVERY component that renders AI-generated content:
 *   <div>{renderValue(resume.contact.location)}</div>
 *   <span>{renderValue(experience.company)}</span>
 *
 * This function guarantees the return value is one of:
 *   - string
 *   - number
 *   - boolean
 *   - null (React handles null gracefully — renders nothing)
 *   - array of the above
 *
 * It NEVER returns a plain object — that's what causes React Error #31.
 */
export function renderValue(value: any): React.ReactNode {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number") return Number.isNaN(value) ? null : value;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    // Normalize each element to a primitive
    return value.map((v) => renderValue(v));
  }
  // Object — normalize to a string
  return normalizeToText(value);
}

// Import React types lazily to avoid circular deps in non-React contexts.
// The function works without React — it just returns the value.
// (We use `any` here so this file can be imported from worker code too.)
type ReactNode = any;
