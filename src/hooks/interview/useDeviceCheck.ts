"use client";

// ============================================================================
// useDeviceCheck — Sonru-style device & permission diagnostics.
// Pure browser API wrapper. No AI, no persistence.
//
// Uses:
//   navigator.mediaDevices.enumerateDevices()
//   navigator.mediaDevices.getUserMedia()
//   navigator.mediaDevices.ondevicechange
// ============================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  BrowserCompatibility,
  DeviceCapability,
  DeviceCheckSnapshot,
  MediaDeviceKind,
  MediaDeviceSummary,
  PermissionLike,
} from "./types";

function detectCompatibility(): BrowserCompatibility {
  const w: any = typeof window !== "undefined" ? window : {};
  const md = w.navigator?.mediaDevices;
  return {
    mediaDevices: !!md,
    getUserMedia: !!(md && typeof md.getUserMedia === "function"),
    enumerateDevices: !!(md && typeof md.enumerateDevices === "function"),
    mediaRecorder: typeof window !== "undefined" && "MediaRecorder" in window,
    // setSinkId is vendor-prefixed; presence is best-effort.
    setSinkId: typeof (w.HTMLMediaElement?.prototype?.setSinkId) === "function",
    displayMedia: !!(md && typeof md.getDisplayMedia === "function"),
    secureContext: !!w.isSecureContext,
  };
}

function toSummary(d: MediaDeviceInfo): MediaDeviceSummary {
  const kind = d.kind as MediaDeviceKind;
  const label = d.label || fallbackLabel(kind);
  return {
    deviceId: d.deviceId,
    label,
    kind,
    groupId: d.groupId || undefined,
  };
}

function fallbackLabel(kind: MediaDeviceKind): string {
  switch (kind) {
    case "videoinput":
      return "Camera";
    case "audioinput":
      return "Microphone";
    case "audiooutput":
      return "Speaker";
    default:
      return "Device";
  }
}

const EMPTY_SNAPSHOT = (compatibility: BrowserCompatibility): DeviceCheckSnapshot => ({
  supported: compatibility.mediaDevices && compatibility.getUserMedia,
  compatibility,
  cameraPermission: compatibility.getUserMedia ? "idle" : ("unsupported" as PermissionLike),
  micPermission: compatibility.getUserMedia ? "idle" : ("unsupported" as PermissionLike),
  camera: [],
  microphones: [],
  speakers: [],
  selectedCameraId: null,
  selectedMicId: null,
  selectedSpeakerId: null,
  previewCapabilities: null,
  previewActive: false,
  error: null,
  recoveryHint: null,
});

export interface UseDeviceCheckOptions {
  /** Live preview element the hook will attach the camera stream to. */
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  /** When true, request + attach the camera preview stream. */
  enablePreview?: boolean;
}

export function useDeviceCheck(options: UseDeviceCheckOptions = {}) {
  const { videoRef, enablePreview = true } = options;

  const compatibility = useMemo(() => detectCompatibility(), []);
  const [snapshot, setSnapshot] = useState<DeviceCheckSnapshot>(() => EMPTY_SNAPSHOT(compatibility));

  const streamRef = useRef<MediaStream | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  // ---- derived helpers ------------------------------------------------------

  const setError = useCallback((error: string | null, recoveryHint: string | null = null) => {
    setSnapshot((s) => ({ ...s, error, recoveryHint }));
  }, []);

  const refresh = useCallback(() => setRefreshToken((t) => t + 1), []);

  // ---- enumerate devices (labels only available after permission) ----------
  const enumerate = useCallback(async () => {
    if (!compatibility.enumerateDevices) {
      setSnapshot((s) => ({
        ...s,
        supported: false,
        cameraPermission: "unsupported",
        micPermission: "unsupported",
        error: "This browser does not support device enumeration (navigator.mediaDevices.enumerateDevices).",
        recoveryHint: "Use an up-to-date Chrome, Edge, Safari, or Firefox. Ensure the page is served over https:// or localhost.",
      }));
      return;
    }
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const camera = devices.filter((d) => d.kind === "videoinput").map(toSummary);
      const microphones = devices.filter((d) => d.kind === "audioinput").map(toSummary);
      const speakers = devices.filter((d) => d.kind === "audiooutput").map(toSummary);
      setSnapshot((s) => ({
        ...s,
        camera,
        microphones,
        speakers,
        selectedCameraId: s.selectedCameraId ?? camera[0]?.deviceId ?? null,
        selectedMicId: s.selectedMicId ?? microphones[0]?.deviceId ?? null,
        selectedSpeakerId: s.selectedSpeakerId ?? speakers[0]?.deviceId ?? null,
      }));
    } catch (e: any) {
      setError(`Could not list devices: ${e?.message || e}`, "Retry the device check. If the problem persists, restart your browser.");
    }
  }, [compatibility.enumerateDevices]);

  // ---- request permission + open preview -----------------------------------
  const requestCameraAndMic = useCallback(
    async (constraints?: { video?: MediaTrackConstraints | boolean; audio?: MediaTrackConstraints | boolean }) => {
      if (!compatibility.getUserMedia) {
        setError(
          "Camera/microphone access is not available in this context.",
          "Serve the app over https:// or use localhost, and use a browser with mediaDevices.getUserMedia support."
        );
        return null;
      }
      // Stop any previous stream before requesting a new one.
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      try {
        // When the caller passes `video: false`, request audio-only. This is
        // used by the Sonru voice-only mode (VoiceInterviewSession). Defaults
        // remain 720p video + audio.
        const wantsVideo = constraints?.video !== false;
        const stream = await navigator.mediaDevices.getUserMedia({
          video: wantsVideo
            ? (constraints?.video ?? ({ width: { ideal: 1280 }, height: { ideal: 720 } } as MediaTrackConstraints))
            : false,
          audio: constraints?.audio ?? true,
        });
        streamRef.current = stream;

        // Mirror selection into snapshot for the selectors.
        const camTrack = stream.getVideoTracks()[0];
        const micTrack = stream.getAudioTracks()[0];
        const camId = camTrack?.getSettings().deviceId ?? null;
        const micId = micTrack?.getSettings().deviceId ?? null;
        const caps = readCapabilities(camTrack);

        if (videoRef?.current && camTrack) {
          videoRef.current.srcObject = stream;
          try {
            await videoRef.current.play().catch(() => {});
          } catch {
            /* autoplay policies may defer; handled by user gesture context */
          }
        }

        setSnapshot((s) => ({
          ...s,
          supported: true,
          cameraPermission: camTrack ? "granted" : s.cameraPermission,
          micPermission: micTrack ? "granted" : s.micPermission,
          selectedCameraId: camId ?? s.selectedCameraId,
          selectedMicId: micId ?? s.selectedMicId,
          previewCapabilities: caps,
          previewActive: !!camTrack,
          error: null,
          recoveryHint: null,
        }));

        // Labels are now available — re-enumerate.
        await enumerate();
        return stream;
      } catch (e: any) {
        return handleGumError(e, setError, setSnapshot);
      }
    },
    [compatibility.getUserMedia, enumerate, videoRef]
  );

  // ---- select a different device -------------------------------------------
  const selectDevice = useCallback(
    async (kind: MediaDeviceKind, deviceId: string) => {
      if (kind === "audiooutput") {
        setSnapshot((s) => ({ ...s, selectedSpeakerId: deviceId }));
        // Apply sink selection to the preview element if supported.
        const el = videoRef?.current as any;
        if (el?.setSinkId && deviceId) {
          try {
            await el.setSinkId(deviceId);
          } catch {
            /* setSinkId may be unsupported; non-fatal */
          }
        }
        return;
      }
      setSnapshot((s) => ({
        ...s,
        ...(kind === "videoinput" ? { selectedCameraId: deviceId } : { selectedMicId: deviceId }),
      }));
      if (enablePreview) {
        await requestCameraAndMic(
          kind === "videoinput"
            ? { video: deviceId ? { deviceId: { exact: deviceId } } : true, audio: snapshot.selectedMicId ? { deviceId: { exact: snapshot.selectedMicId } } : true }
            : { video: snapshot.selectedCameraId ? { deviceId: { exact: snapshot.selectedCameraId } } : true, audio: deviceId ? { deviceId: { exact: deviceId } } : true }
        );
      }
    },
    [enablePreview, requestCameraAndMic, snapshot.selectedCameraId, snapshot.selectedMicId, videoRef]
  );

  // ---- stop preview ---------------------------------------------------------
  const stopPreview = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (videoRef?.current) {
      videoRef.current.srcObject = null;
    }
    setSnapshot((s) => ({ ...s, previewActive: false, previewCapabilities: null }));
  }, [videoRef]);

  // ---- lifecycle ------------------------------------------------------------
  useEffect(() => {
    enumerate();
    const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    const onChange = () => {
      enumerate();
      refresh();
    };
    md?.addEventListener?.("devicechange", onChange);
    return () => {
      md?.removeEventListener?.("devicechange", onChange);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [enumerate, refresh]);

  return {
    snapshot,
    compatibility,
    enumerate,
    requestCameraAndMic,
    selectDevice,
    stopPreview,
    refresh,
    /** Returns the currently active preview MediaStream (or null). */
    getStream: () => streamRef.current,
  };
}

// ----------------------------------------------------------------------------
// internal helpers
// ----------------------------------------------------------------------------

function readCapabilities(track?: MediaStreamTrack | null): DeviceCapability | null {
  if (!track) return null;
  const s = track.getSettings() as any;
  return {
    width: typeof s.width === "number" ? s.width : 0,
    height: typeof s.height === "number" ? s.height : 0,
    fps: typeof s.frameRate === "number" ? Math.round(s.frameRate) : 0,
  };
}

function handleGumError(
  e: any,
  setError: (msg: string, hint: string | null) => void,
  setSnapshot: React.Dispatch<React.SetStateAction<DeviceCheckSnapshot>>
) {
  const name = e?.name || "";
  const msg = e?.message || String(e || "Unknown error");
  let recovery: string | null = null;
  let perm: PermissionLike = "denied";

  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      perm = "denied";
      recovery =
        "Permission was denied. Click the camera/microphone icon in your browser's address bar, set it to Allow, then reload and run the device check again.";
      break;
    case "NotFoundError":
    case "OverconstrainedError":
      perm = "prompt";
      recovery =
        "No matching camera or microphone was found. Connect a device, or choose a different device from the selector, then retry.";
      break;
    case "NotReadableError":
      recovery =
        "The camera or microphone is already in use by another application (e.g. Zoom, Teams, OBS). Close it and retry.";
      break;
    default:
      recovery = "Retry the device check. If the problem persists, restart your browser and ensure the page is served over a secure context.";
  }

  setSnapshot((s) => ({
    ...s,
    cameraPermission: name.includes("audio") ? s.cameraPermission : perm,
    micPermission: name.includes("video") ? s.micPermission : perm,
  }));
  setError(`Media access failed (${name}): ${msg}`, recovery);
  return null;
}
