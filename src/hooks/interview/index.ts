// ============================================================================
// Interview media layer — public exports (Phase 1 + Sonru simulator extensions).
// Pure browser-API primitives reused by the Sonru-style video session, the
// voice session, the device-check route, and the audio meter UI.
// ============================================================================

export { useDeviceCheck } from "./useDeviceCheck";
export { useMediaRecorder } from "./useMediaRecorder";
export { useAudioMeter } from "./useAudioMeter";
export { useSpeechRecognition } from "./useSpeechRecognition";
export {
  useFillerWordDetector,
  analyzeFillerWords,
  normalizeWpmToScore,
  normalizeFillerCountToScore,
  FILLER_WORDS,
} from "./useFillerWordDetector";
export type { UseDeviceCheckOptions } from "./useDeviceCheck";
export type { UseMediaRecorderOptions, UseMediaRecorderResult } from "./useMediaRecorder";
export type { UseAudioMeterResult } from "./useAudioMeter";
export type {
  UseSpeechRecognitionOptions,
  UseSpeechRecognitionResult,
} from "./useSpeechRecognition";
export type { FillerStats } from "./useFillerWordDetector";
export * from "./types";
