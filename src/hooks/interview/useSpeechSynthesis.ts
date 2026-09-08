"use client";

// ============================================================================
// useSpeechSynthesis — thin Web Speech API wrapper (speechSynthesis).
//
// The TTS counterpart of useSpeechRecognition: speaks the interviewer's
// questions aloud during the voice mock interview. Pure browser API — no
// Puter auth, no network dependency, works with the OS voice pack.
//
// Chrome reliably CUTS OFF utterances longer than ~15s, so consumers should
// pass text through splitForSpeech() (see lib/interview/voice-conversation)
// and call speak() per chunk — this hook queues chunks in order and tracks
// overall speaking state until the queue drains.
//
// Server-safe: supported=false on the server / when the API is missing.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react";

export interface SpeakOptions {
  /** Preferred voice by voiceURI (falls back to the first matching lang). */
  voiceURI?: string;
  /** Locale tag, e.g. "en-US". Default "en-US". */
  lang?: string;
  /** 0.1–2. Default 1. */
  rate?: number;
  /** 0–2. Default 1. */
  pitch?: number;
}

export interface UseSpeechSynthesisResult {
  /** Whether speechSynthesis exists in this browser. */
  supported: boolean;
  /** True while any queued utterance is still speaking. */
  speaking: boolean;
  /** Available system voices (populated async — Chrome fires voiceschanged). */
  voices: Array<{ voiceURI: string; name: string; lang: string; default: boolean }>;
  /** Speak a chunk (or an array of chunks) in order. Cancels any prior speech. */
  speak: (text: string | string[], options?: SpeakOptions) => void;
  /** Stop immediately and clear the queue. */
  cancel: () => void;
}

function listVoices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return [];
  try {
    return window.speechSynthesis.getVoices() ?? [];
  } catch {
    return [];
  }
}

export function useSpeechSynthesis(): UseSpeechSynthesisResult {
  const supported = typeof window !== "undefined" && "speechSynthesis" in window;
  const [speaking, setSpeaking] = useState(false);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>(() => listVoices());
  // Monotonic token — increments per speak() call so stale onend callbacks
  // from a cancelled queue can never flip `speaking` back to false early.
  const queueToken = useRef(0);

  useEffect(() => {
    if (!supported) return;
    const synth = window.speechSynthesis;

    // Chrome populates voices asynchronously.
    const refresh = () => setVoices(listVoices());
    refresh();
    synth.addEventListener?.("voiceschanged", refresh);
    // Some browsers need a tick after mount before getVoices() is non-empty.
    const t = window.setTimeout(refresh, 250);

    // Safety: never leave speech running after unmount.
    return () => {
      synth.removeEventListener?.("voiceschanged", refresh);
      window.clearTimeout(t);
      try {
        synth.cancel();
      } catch {
        /* noop */
      }
    };
  }, [supported]);

  const cancel = useCallback(() => {
    if (!supported) return;
    queueToken.current += 1;
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* noop */
    }
    setSpeaking(false);
  }, [supported]);

  const speak = useCallback(
    (text: string | string[], options?: SpeakOptions) => {
      if (!supported) return;
      const chunks = (Array.isArray(text) ? text : [text]).map((c) => (c ?? "").trim()).filter(Boolean);
      if (chunks.length === 0) return;

      // New utterance always replaces whatever is queued/playing.
      cancel();
      const token = queueToken.current;
      const synth = window.speechSynthesis;

      const allVoices = voices.length ? voices : listVoices();
      const lang = options?.lang ?? "en-US";
      const chosen =
        allVoices.find((v) => options?.voiceURI && v.voiceURI === options.voiceURI) ??
        allVoices.find((v) => v.lang?.toLowerCase() === lang.toLowerCase()) ??
        allVoices.find((v) => v.lang?.toLowerCase().startsWith(lang.slice(0, 2).toLowerCase())) ??
        null;

      setSpeaking(true);
      let done = 0;
      chunks.forEach((chunk) => {
        const u = new SpeechSynthesisUtterance(chunk);
        if (chosen) u.voice = chosen;
        u.lang = chosen?.lang ?? lang;
        u.rate = Math.min(2, Math.max(0.1, options?.rate ?? 1));
        u.pitch = Math.min(2, Math.max(0, options?.pitch ?? 1));
        u.onend = () => {
          done += 1;
          if (done >= chunks.length && queueToken.current === token) setSpeaking(false);
        };
        u.onerror = () => {
          done += 1;
          if (done >= chunks.length && queueToken.current === token) setSpeaking(false);
        };
        try {
          synth.speak(u);
        } catch {
          done += 1;
          if (done >= chunks.length && queueToken.current === token) setSpeaking(false);
        }
      });
    },
    [supported, voices, cancel],
  );

  return { supported, speaking, voices: voices.map((v) => ({ voiceURI: v.voiceURI, name: v.name, lang: v.lang, default: v.default })), speak, cancel };
}
