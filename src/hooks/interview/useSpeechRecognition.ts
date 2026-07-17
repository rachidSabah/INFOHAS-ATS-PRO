"use client";

// ============================================================================
// useSpeechRecognition — thin Web Speech API wrapper (SpeechRecognition).
//
// Reused by both the video session (VideoInterviewSession.tsx) and the voice
// session (VoiceInterviewSession.tsx) to produce a live transcript that is
// then fed into `evaluateAnswer` as `answerText` and into the filler-word /
// WPM helpers in `useFillerWordDetector`.
//
// Pure browser API. Server-safe: returns `supported=false` on the server and
// when the Web Speech API is missing (Firefox does not yet ship it). Non-fatal
// error handling: "no-speech" / "aborted" are silently suppressed.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react";

export interface UseSpeechRecognitionOptions {
  /** Locale for recognition. Default "en-US". */
  lang?: string;
  /** Whether to return interim (non-final) results. Default false (final only). */
  interimResults?: boolean;
  /** Whether to keep listening after a result. Default true. */
  continuous?: boolean;
  /** Called when a final result arrives. */
  onResult?: (finalTranscript: string) => void;
}

export interface UseSpeechRecognitionResult {
  /** Whether the Web Speech API is available in this browser. */
  supported: boolean;
  /** Whether recognition is currently active. */
  listening: boolean;
  /** Accumulated final transcript (cleared on `reset()`). */
  transcript: string;
  /** Most recent interim (in-progress) transcript. */
  interimTranscript: string;
  /** Last error message (e.g. "Audio capture failed"). Empty when healthy. */
  error: string | null;
  /** Start listening. No-op if already listening or unsupported. */
  start: () => void;
  /** Stop listening. Safe to call when not listening. */
  stop: () => void;
  /** Reset the accumulated transcript. */
  reset: () => void;
}

// Minimum type surface for the vendor-prefixed Web Speech API. We do not depend
// on the @types/speech-recognition package to keep the bundle slim.
interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: { length: number; [index: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionErrorEventLike {
  error: string;
  message?: string;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((ev: SpeechRecognitionEventLike) => void) | null;
  onerror: ((ev: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as any;
  return (w.SpeechRecognition || w.webkitSpeechRecognition) ?? null;
}

export function useSpeechRecognition(
  options: UseSpeechRecognitionOptions = {}
): UseSpeechRecognitionResult {
  const {
    lang = "en-US",
    interimResults = false,
    continuous = true,
    onResult,
  } = options;

  const ctorRef = useRef<SpeechRecognitionCtor | null>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const onResultRef = useRef(onResult);
  // Update the ref in an effect (NOT during render) so the recognition
  // callback always uses the latest closure without re-subscribing.
  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  const [supported, setSupported] = useState(false);
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [interimTranscript, setInterimTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const shouldListenRef = useRef(false);

  useEffect(() => {
    const ctor = getSpeechRecognitionCtor();
    ctorRef.current = ctor;
    setSupported(!!ctor);
    return () => {
      try {
        recRef.current?.abort();
      } catch {
        /* ignore */
      }
      recRef.current = null;
    };
  }, []);

  const start = useCallback(() => {
    if (!ctorRef.current) {
      setError("Speech recognition is not supported in this browser. The interview will continue, but live transcription will be unavailable.");
      return;
    }
    if (recRef.current) {
      // Already started.
      return;
    }
    try {
      const rec = new ctorRef.current();
      rec.lang = lang;
      rec.continuous = continuous;
      rec.interimResults = interimResults;
      rec.maxAlternatives = 1;
      rec.onstart = () => {
        setListening(true);
        setError(null);
      };
      rec.onresult = (ev: SpeechRecognitionEventLike) => {
        let interim = "";
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const r = ev.results[i];
          if (r.isFinal) {
            const text = r[0]?.transcript ?? "";
            setTranscript((prev) => (prev ? prev + " " : "") + text.trim());
            if (onResultRef.current) onResultRef.current(text.trim());
          } else {
            interim += r[0]?.transcript ?? "";
          }
        }
        setInterimTranscript(interim);
      };
      rec.onerror = (ev: SpeechRecognitionErrorEventLike) => {
        // Suppress benign errors that fire constantly during normal use.
        if (ev.error === "no-speech" || ev.error === "aborted" || ev.error === "audio-capture") {
          return;
        }
        // "not-allowed" / "service-not-allowed" indicate a permission denial.
        if (ev.error === "not-allowed" || ev.error === "service-not-allowed") {
          setError("Microphone permission denied for speech recognition.");
          shouldListenRef.current = false;
          return;
        }
        setError(ev.message || ev.error || "Speech recognition error.");
      };
      rec.onend = () => {
        setListening(false);
        // Auto-restart if the user hasn't explicitly stopped. Web Speech API
        // stops on its own after a few seconds of silence; we want to keep
        // going for the full recording duration.
        if (shouldListenRef.current) {
          try {
            rec.start();
          } catch {
            /* may throw if restarted too quickly; ignore */
          }
        }
      };
      shouldListenRef.current = true;
      rec.start();
      recRef.current = rec;
    } catch (e: any) {
      setError(e?.message || "Could not start speech recognition.");
    }
  }, [lang, continuous, interimResults]);

  const stop = useCallback(() => {
    shouldListenRef.current = false;
    const rec = recRef.current;
    recRef.current = null;
    if (rec) {
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
    }
    setListening(false);
    setInterimTranscript("");
  }, []);

  const reset = useCallback(() => {
    setTranscript("");
    setInterimTranscript("");
    setError(null);
  }, []);

  return {
    supported,
    listening,
    transcript,
    interimTranscript,
    error,
    start,
    stop,
    reset,
  };
}
