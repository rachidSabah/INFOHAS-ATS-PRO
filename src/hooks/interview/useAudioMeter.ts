"use client";

// ============================================================================
// useAudioMeter — live microphone input level (0..1) via Web Audio AnalyserNode.
// Pure browser API. Designed to be fed the active MediaRecorder stream's
// audio track. Renders nothing; exposes `level` for a volume meter UI.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react";

export interface UseAudioMeterResult {
  level: number;
  peak: number;
  /** Whether the level is currently above a speech threshold. */
  active: boolean;
  start: (stream: MediaStream) => void;
  stop: () => void;
}

export function useAudioMeter(threshold = 0.08): UseAudioMeterResult {
  const [level, setLevel] = useState(0);
  const [peak, setPeak] = useState(0);
  const [active, setActive] = useState(false);

  const ctxRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const dataRef = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const peakRef = useRef(0);

  const stop = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    try {
      sourceRef.current?.disconnect();
    } catch {
      /* ignore */
    }
    if (ctxRef.current && ctxRef.current.state !== "closed") {
      ctxRef.current.close().catch(() => {});
    }
    ctxRef.current = null;
    sourceRef.current = null;
    analyserRef.current = null;
    dataRef.current = null;
    peakRef.current = 0;
    setLevel(0);
    setPeak(0);
    setActive(false);
  }, []);

  const start = useCallback(
    (stream: MediaStream) => {
      // Avoid double-start on the same stream.
      if (analyserRef.current && rafRef.current != null) return;
      stop();

      const AudioCtx: typeof AudioContext =
        (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;

      const ctx = new AudioCtx();
      ctxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.7;
      source.connect(analyser);
      sourceRef.current = source;
      analyserRef.current = analyser;
      dataRef.current = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));

      const tick = () => {
        const analyser = analyserRef.current;
        const data = dataRef.current;
        if (!analyser || !data) return;
        analyser.getByteTimeDomainData(data);
        // RMS of the time-domain signal → perceptual-ish 0..1 level.
        let sumSquares = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sumSquares += v * v;
        }
        const rms = Math.sqrt(sumSquares / data.length);
        const norm = Math.min(1, rms * 2.2);
        peakRef.current = Math.max(peakRef.current * 0.96, norm);
        setLevel(norm);
        setPeak(peakRef.current);
        setActive(norm >= threshold);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    },
    [stop, threshold]
  );

  useEffect(() => () => stop(), [stop]);

  return { level, peak, active, start, stop };
}
