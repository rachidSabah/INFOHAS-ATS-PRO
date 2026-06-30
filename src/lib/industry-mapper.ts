// ============================================================================
// Industry Mapper — bridges industry detection → pipeline aviationMode
// ============================================================================
// Converts the output of detectIndustry() into the aviationMode object the
// pipeline's orchestrator expects, with the right airline profile + settings.
//
// Aviation-adjacent industries (aviation, airline-airport-services,
// airport-duty-free) get a real aviationMode that triggers the aviationOptimize
// path. All other industries fall through to the standard optimizer path, where
// Job Intelligence and Company Intelligence already provide industry context.
// ============================================================================

import { detectIndustry, INDUSTRY_PROFILES } from "./industry-ats";
import { DEFAULT_APP_SETTINGS, type AppSettings } from "./ats-directives";
import type { IndustryAtsProfile } from "./industry-ats";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface IndustryDetectionResult {
  industryId: string;
  confidence: number;
  detectedRole: string;
  detectedAts: string;
}

export interface IndustryMapperResult {
  /** The aviationMode to pass to the pipeline (undefined unless aviation-adjacent) */
  aviationMode?: {
    airlineProfile: string;
    settings: AppSettings;
  };
  /** Full detection details from detectIndustry() */
  detection: IndustryDetectionResult;
  /** The matched industry profile (or generic fallback) */
  profile: IndustryAtsProfile;
  /** Settings derived from the profile's tone */
  suggestedSettings: AppSettings;
}

// ---------------------------------------------------------------------------
// Aviation-adjacent industries that get the aviationOptimize pipeline path
// ---------------------------------------------------------------------------
const AVIATION_ADJACENT_INDUSTRIES = new Set([
  "aviation",
  "airline-airport-services",
  "airport-duty-free",
]);

// ---------------------------------------------------------------------------
// Mapper
// ---------------------------------------------------------------------------

/**
 * Map JD + resume text to an industry-specific optimization mode.
 *
 * This bridges `detectIndustry()` → the pipeline's `aviationMode`:
 *   - Aviation-adjacent industries get a real `aviationMode` → aviationOptimize path
 *   - All other industries get `undefined` → standard optimizer path
 *     (Job Intelligence + Company Intelligence provide industry context there)
 *
 * The mapper also returns the matched profile + suggested settings so the UI
 * can display the detected industry without duplicating detection logic.
 */
export function mapToIndustryMode(
  jdText: string,
  resumeText?: string,
): IndustryMapperResult {
  const detection = detectIndustry(jdText, resumeText ?? "");
  const profile: IndustryAtsProfile =
    INDUSTRY_PROFILES[detection.industryId] ?? INDUSTRY_PROFILES.generic!;

  // Suggested settings from the profile's tone (format/strictness keep defaults)
  const suggestedSettings: AppSettings = {
    tone: profile.tone,
    format: DEFAULT_APP_SETTINGS.format,
    strictness: DEFAULT_APP_SETTINGS.strictness,
  };

  // Only produce aviationMode for genuinely aviation-adjacent industries
  // with sufficient confidence
  if (
    AVIATION_ADJACENT_INDUSTRIES.has(detection.industryId) &&
    detection.confidence >= 20
  ) {
    return {
      aviationMode: {
        airlineProfile: detection.industryId,
        settings: suggestedSettings,
      },
      detection,
      profile,
      suggestedSettings,
    };
  }

  // Non-aviation industries → no aviationMode; standard pipeline handles it
  return {
    detection,
    profile,
    suggestedSettings,
  };
}
