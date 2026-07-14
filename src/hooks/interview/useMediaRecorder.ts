"use client";

// ============================================================================
// useMediaRecorder — record the active camera+mic MediaStream with MediaRecorder.
// Supports: start / pause / resume / stop / restart, max-duration auto-stop,
// elapsed-time tracking, and MIME-type negotiation. Pure browser API.
//
// The recorder does NOT own the stream — it receives it from useDeviceCheck
// (or any other source) so the same preview stream is reused for recording.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import type { RecorderSnapshot, RecorderState } from "./types";
import { useAudioMeter } from "./useAudioMeter";

function pickMimeType(): string {
  if (typeof window === "undefined" || !("MediaRecorder" in window)) return "";
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4",
  ];
  for (const c of candidates) {
    try {
      if (MediaRecorder.isTypeSupported(c)) return c;
    } catch {
      /* ignore */
    }
  }
  return "";
}

export interface UseMediaRecorderOptions {
  /** Auto-stop after this many ms (Sonru "Maximum Recording Time"). */
  maxDurationMs?: number;
  /** Called when a recording is finalized (manually or by max-duration). */
  onComplete?: (blob: Blob, mimeType: string, durationMs: number) => void;
}

export interface UseMediaRecorderResult extends RecorderSnapshot {
  level: number;
  peak: number;
  micActive: boolean;
  start: (stream: MediaStream) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
  restart: (stream: MediaStream) => void;
  clear: () => void;
}

export function useMediaRecorder(options: UseMediaRecorderOptions = {}): UseMediaRecorderResult {
  const { maxDurationMs = null, onComplete } = options;

  // Keep the latest onComplete in a ref so finalize() always calls the current
  // closure (the component's handler depends on changing state like currentIndex).
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const [snapshot, setSnapshot] = useState<RecorderSnapshot>(() => ({
    state: "idle",
    elapsedMs: 0,
    maxDurationMs,
    blob: null,
    mimeType: "",
    error: null,
    supported: typeof window !== "undefined" && "MediaRecorder" in window,
  }));

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startTsRef = useRef<number>(0);
  const accumulatedRef = useRef<number>(0);
  const rafRef = useRef<number | null>(null);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const meter = useAudioMeter();

  const tick = useCallback(() => {
    const base = accumulatedRef.current;
    const inc = startTsRef.current ? performance.now() - startTsRef.current : 0;
    setSnapshot((s) => ({ ...s, elapsedMs: base + inc }));
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  const stopRaf = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  const clearMaxTimer = useCallback(() => {
    if (maxTimerRef.current != null) {
      clearTimeout(maxTimerRef.current);
      maxTimerRef.current = null;
    }
  }, []);

  const finalize = useCallback(
    (recorder: MediaRecorder, mimeType: string) => {
      const blob = new Blob(chunksRef.current, { type: mimeType || "video/webm" });
      stopRaf();
      clearMaxTimer();
      meter.stop();
      setSnapshot((s) => ({
        ...s,
        state: "stopped",
        blob,
        mimeType: mimeType || s.mimeType,
        elapsedMs: accumulatedRef.current,
      }));
      onCompleteRef.current?.(blob, mimeType || "video/webm", accumulatedRef.current);
    },
    [clearMaxTimer, meter, stopRaf]
  );

  const start = useCallback(
    (stream: MediaStream) => {
      if (typeof window === "undefined" || !("MediaRecorder" in window)) {
        setSnapshot((s) => ({
          ...s,
          error: "MediaRecorder is not supported in this browser.",
          state: "error",
        }));
        return;
      }
      // Tear down any prior recorder.
      const prior = recorderRef.current;
      if (prior && prior.state !== "inactive") prior.stop();
      chunksRef.current = [];
      accumulatedRef.current = 0;

      const mimeType = pickMimeType();
      let recorder: MediaRecorder;
      try {
        recorder = mimeType
          ? new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2_500_000, audioBitsPerSecond: 128_000 })
          : new MediaRecorder(stream);
      } catch (e: any) {
        setSnapshot((s) => ({ ...s, error: `Could not start recorder: ${e?.message || e}`, state: "error" }));
        return;
      }

      recorderRef.current = recorder;
      streamRef.current = stream;

      recorder.ondataavailable = (ev) => {
        if (ev.data && ev.data.size > 0) chunksRef.current.push(ev.data);
      };
      recorder.onstop = () => {
        const mime = recorder.mimeType || mimeType;
        finalize(recorder, mime);
      };
      recorder.onerror = (ev: any) => {
        const msg = ev?.error?.message || "Recording error.";
        stopRaf();
        clearMaxTimer();
        meter.stop();
        setSnapshot((s) => ({ ...s, error: msg, state: "error" }));
      };

      startTsRef.current = performance.now();
      recorder.start(250); // timeslice → periodic dataavailable
      setSnapshot((s) => ({
        ...s,
        state: "recording",
        blob: null,
        mimeType,
        error: null,
        elapsedMs: 0,
        maxDurationMs,
      }));
      rafRef.current = requestAnimationFrame(tick);
      meter.start(stream);

      if (maxDurationMs && maxDurationMs > 0) {
        clearMaxTimer();
        maxTimerRef.current = setTimeout(() => {
          if (recorderRef.current && recorderRef.current.state === "recording") {
            recorderRef.current.stop();
          }
        }, maxDurationMs);
      }
    },
    [finalize, maxDurationMs, meter, tick]
  );

  const pause = useCallback(() => {
    const r = recorderRef.current;
    if (r && r.state === "recording") {
      accumulatedRef.current += performance.now() - startTsRef.current;
      r.pause();
      stopRaf();
      meter.stop();
      setSnapshot((s) => ({ ...s, state: "paused", elapsedMs: accumulatedRef.current }));
    }
  }, [meter, stopRaf]);

  const resume = useCallback(() => {
    const r = recorderRef.current;
    if (r && r.state === "paused") {
      startTsRef.current = performance.now();
      r.resume();
      rafRef.current = requestAnimationFrame(tick);
      if (streamRef.current) meter.start(streamRef.current);
      setSnapshot((s) => ({ ...s, state: "recording" }));
    }
  }, [meter, tick]);

  const stop = useCallback(() => {
    const r = recorderRef.current;
    if (r && r.state !== "inactive") {
      accumulatedRef.current += startTsRef.current ? performance.now() - startTsRef.current : 0;
      r.stop();
    }
  }, []);

  const restart = useCallback(
    (stream: MediaStream) => {
      // Reset and start fresh on the same stream.
      chunksRef.current = [];
      accumulatedRef.current = 0;
      start(stream);
    },
    [start]
  );

  const clear = useCallback(() => {
    stopRaf();
    clearMaxTimer();
    meter.stop();
    chunksRef.current = [];
    accumulatedRef.current = 0;
    recorderRef.current = null;
    streamRef.current = null;
    setSnapshot((s) => ({ ...s, state: "idle", blob: null, error: null, elapsedMs: 0 }));
  }, [clearMaxTimer, meter, stopRaf]);

  useEffect(
    () => () => {
      stopRaf();
      clearMaxTimer();
      meter.stop();
      try {
        const r = recorderRef.current;
        if (r && r.state !== "inactive") r.stop();
      } catch {
        /* ignore */
      }
    },
    [clearMaxTimer, meter, stopRaf]
  );

  return {
    ...snapshot,
    level: meter.level,
    peak: meter.peak,
    micActive: meter.active,
    start,
    pause,
    resume,
    stop,
    restart,
    clear,
  };
}
