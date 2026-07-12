import * as React from "react";

export interface HighlightTarget {
  text: string;
  type: "keyword" | "cliche";
}

/**
 * Safely render any value as a string. Prevents React error #31
 * ("Objects are not valid as a React child") when the AI returns an
 * object where a string is expected.
 */
export function safeRender(v: any): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map((x) => safeRender(x)).filter(Boolean).join(", ");
  if (typeof v === "object") {
    const values = Object.values(v).filter((x) => x !== null && x !== undefined && x !== "");
    if (values.length > 0) return values.map((x) => safeRender(x)).join(", ");
    return "";
  }
  return String(v);
}

export function renderHighlightedText(
  text: string,
  heatmapMode: boolean,
  matchedKeywords: string[] = [],
  cliches: string[] = []
): React.ReactNode {
  if (!text) return "";
  
  // Split by bold segments: **bold** or *bold*
  const boldRegex = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  const parts = text.split(boldRegex);

  const keywords = [...matchedKeywords];
  const buzzwords = [...cliches];
  
  // Sort by length descending to avoid partial matches on nested words
  const allTargets = [
    ...keywords.map(k => ({ text: k, type: "keyword" as const })),
    ...buzzwords.map(b => ({ text: b, type: "cliche" as const }))
  ].sort((a, b) => b.text.length - a.text.length);

  // Helper to highlight words inside a string segment
  const highlightText = (str: string, isBold: boolean, keyPrefix: string): React.ReactNode => {
    if (!heatmapMode || allTargets.length === 0) {
      return isBold ? <strong key={keyPrefix} className="font-bold text-slate-900">{str}</strong> : str;
    }

    const escaped = allTargets
      .map(t => t.text.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&"))
      .filter(Boolean);
    if (escaped.length === 0) {
      return isBold ? <strong key={keyPrefix} className="font-bold text-slate-900">{str}</strong> : str;
    }

    const regex = new RegExp(`\\b(${escaped.join("|")})\\b`, "gi");
    const subParts = str.split(regex);

    return subParts.map((subPart, idx) => {
      const match = allTargets.find(t => t.text.toLowerCase() === subPart.toLowerCase());
      if (match) {
        const isKeyword = match.type === "keyword";
        return (
          <span
            key={`${keyPrefix}-${idx}`}
            style={{
              backgroundColor: isKeyword ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)",
              borderBottom: isKeyword ? "2px dashed #10B981" : "2px dashed #EF4444",
              padding: "0.2px 1.5px",
              borderRadius: "2px",
              fontWeight: isBold ? "bold" : 500,
              color: isBold ? "#0f172a" : undefined,
              cursor: "help",
              position: "relative"
            }}
            title={isKeyword ? "Matched target job keyword!" : "Generic cliché word. Try to replace with action/metrics."}
          >
            {subPart}
          </span>
        );
      }
      return isBold ? <strong key={`${keyPrefix}-${idx}`} className="font-bold text-slate-900">{subPart}</strong> : subPart;
    });
  };

  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return highlightText(part.slice(2, -2), true, `bold-${idx}`);
    }
    if (part.startsWith("*") && part.endsWith("*")) {
      return highlightText(part.slice(1, -1), true, `bold-${idx}`);
    }
    return highlightText(part, false, `plain-${idx}`);
  }) as any;
}
