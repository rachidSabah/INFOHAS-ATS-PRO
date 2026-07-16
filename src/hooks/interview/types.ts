// ============================================================================
// Shared types for the Enterprise AI Interview Preparation media layer.
// Phase 1 only covers browser-API media primitives (device detection,
// recording, audio metering). No persistence or AI in this file.
// ============================================================================

export type MediaDeviceKind = "videoinput" | "audioinput" | "audiooutput";

export interface MediaDeviceSummary {
  deviceId: string;
  label: string;
  kind: MediaDeviceKind;
  groupId?: string;
}

export type PermissionLike = "granted" | "denied" | "prompt" | "unsupported" | "idle";

export interface BrowserCompatibility {
  mediaDevices: boolean;
  getUserMedia: boolean;
  enumerateDevices: boolean;
  mediaRecorder: boolean;
  setSinkId: boolean;
  displayMedia: boolean;
  secureContext: boolean;
}

export interface DeviceCapability {
  width: number;
  height: number;
  /** Detected frames-per-second (best-effort). 0 when undetermined. */
  fps: number;
}

export interface DeviceCheckSnapshot {
  supported: boolean;
  compatibility: BrowserCompatibility;
  cameraPermission: PermissionLike;
  micPermission: PermissionLike;
  camera: MediaDeviceSummary[];
  microphones: MediaDeviceSummary[];
  speakers: MediaDeviceSummary[];
  selectedCameraId: string | null;
  selectedMicId: string | null;
  selectedSpeakerId: string | null;
  previewCapabilities: DeviceCapability | null;
  previewActive: boolean;
  error: string | null;
  /** Human-readable recovery instructions for the current error (if any). */
  recoveryHint: string | null;
}

export type RecorderState = "idle" | "recording" | "paused" | "stopped" | "error";

export interface RecorderSnapshot {
  state: RecorderState;
  elapsedMs: number;
  maxDurationMs: number | null;
  blob: Blob | null;
  mimeType: string;
  error: string | null;
  supported: boolean;
}

// ----------------------------------------------------------------------------
// Recording + session persistence (metadata only; blobs live in IndexedDB)
// ----------------------------------------------------------------------------

export interface InterviewRecordingMeta {
  /** IndexedDB key for the blob (stable id). */
  id: string;
  /** Owning interview session id. */
  sessionId: string;
  questionId: string;
  questionNumber: number;
  resumeId?: string;
  jdId?: string;
  userId?: string;
  mimeType: string;
  sizeBytes: number;
  durationMs: number;
  createdAt: string;
}

export interface InterviewSessionRecord {
  id: string;
  resumeId?: string;
  jdId?: string;
  company?: string;
  role?: string;
  /** Sonru phases: preparation → recording → review → complete. */
  status: "in_progress" | "completed" | "abandoned";
  recordings: InterviewRecordingMeta[];
  startedAt: string;
  completedAt?: string;
  /** Overall report blob (filled on completion). */
  reportRef?: string;
  /**
   * Completed interview memory (answered questions + competencies). Optional —
   * present once a live session finishes. Consumed by the Recruiter Intelligence
   * read-model (buildCandidateIntelligence) for full analytics. Mirrors the
   * lightweight-metadata pattern used for recordings.
   */
  memory?: unknown;
  /** FlightRecords captured during this session (reflection/qa/validation/decision). */
  records?: unknown[];
}
