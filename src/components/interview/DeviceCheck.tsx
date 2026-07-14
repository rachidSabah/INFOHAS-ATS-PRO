"use client";

// ============================================================================
// DeviceCheck — Sonru-style camera / microphone / speaker diagnostics.
// Consumes the shared useDeviceCheck hook (Phase 1). Built entirely from the
// existing design system (Card, Button, Badge, Select, Progress, Icon).
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge, Icon } from "@/components/shared";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useDeviceCheck, useAudioMeter } from "@/hooks/interview";
import type { PermissionLike } from "@/hooks/interview/types";

function PermissionBadge({ value, label }: { value: PermissionLike; label: string }) {
  const map: Record<PermissionLike, { text: string; cls: string; icon: string }> = {
    granted: { text: "Granted", cls: "border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300", icon: "CheckCircle2" },
    denied: { text: "Denied", cls: "border-red-300 bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300", icon: "XCircle" },
    prompt: { text: "Not set", cls: "border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300", icon: "AlertCircle" },
    unsupported: { text: "Unsupported", cls: "border-muted bg-muted/50 text-muted-foreground", icon: "Ban" },
    idle: { text: "Not checked", cls: "border-border bg-secondary/40 text-muted-foreground", icon: "Circle" },
  };
  const m = map[value];
  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-medium border ${m.cls}`}>
      <Icon name={m.icon} className="w-3 h-3" />
      <span>{label}: {m.text}</span>
    </div>
  );
}

export function DeviceCheck() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const { snapshot, compatibility, requestCameraAndMic, selectDevice, stopPreview, refresh, getStream } =
    useDeviceCheck({ videoRef, enablePreview: true });

  const startCheck = useCallback(() => {
    requestCameraAndMic();
  }, [requestCameraAndMic]);

  const compatRows: { label: string; ok: boolean }[] = [
    { label: "Secure context (https/localhost)", ok: compatibility.secureContext },
    { label: "mediaDevices API", ok: compatibility.mediaDevices },
    { label: "getUserMedia", ok: compatibility.getUserMedia },
    { label: "enumerateDevices", ok: compatibility.enumerateDevices },
    { label: "MediaRecorder", ok: compatibility.mediaRecorder },
    { label: "Speaker selection (setSinkId)", ok: compatibility.setSinkId },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-4xl mx-auto px-4 py-6 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2">
              <Icon name="Camera" className="w-6 h-6 text-brand" />
              <h1 className="font-display text-2xl font-bold">Device Check</h1>
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Verify your camera, microphone, and speakers before starting a video interview.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={refresh} className="gap-1.5">
              <Icon name="RotateCcw" className="w-3.5 h-3.5" /> Re-scan
            </Button>
            <Link href="/" className="text-sm text-muted-foreground hover:text-foreground gap-1.5 inline-flex items-center">
              <Icon name="ArrowLeft" className="w-4 h-4" /> Back
            </Link>
          </div>
        </div>

        {/* Unsupported banner */}
        {!snapshot.supported && (
          <Card className="border-amber-300 bg-amber-50 dark:bg-amber-950/20">
            <CardContent className="p-4 flex items-start gap-2">
              <Icon name="AlertTriangle" className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div className="text-sm text-amber-800 dark:text-amber-200">
                <p className="font-semibold">Device check is not fully supported here.</p>
                <p className="mt-1">Use an up-to-date Chrome, Edge, Safari, or Firefox served over https:// or localhost.</p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Live preview + controls */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Icon name="Video" className="w-4 h-4 text-brand" /> Camera Preview
            </CardTitle>
            <CardDescription>Grant permission to see your live camera feed and mic level.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="relative rounded-xl overflow-hidden bg-black aspect-video flex items-center justify-center">
              <video
                ref={videoRef}
                className="w-full h-full object-cover"
                playsInline
                muted
                autoPlay
              />
              {!snapshot.previewActive && (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-white/70 gap-2">
                  <Icon name="CameraOff" className="w-10 h-10" />
                  <span className="text-xs">Camera off</span>
                </div>
              )}
              {snapshot.previewActive && (
                <div className="absolute top-2 left-2">
                  <span className="flex items-center gap-1.5 text-[10px] font-medium text-white bg-black/50 px-2 py-1 rounded-full">
                    <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" /> LIVE
                  </span>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={snapshot.previewActive ? stopPreview : startCheck}
                className="bg-brand hover:bg-brand-dark text-white gap-1.5"
                size="sm"
              >
                <Icon name={snapshot.previewActive ? "VideoOff" : "Video"} className="w-4 h-4" />
                {snapshot.previewActive ? "Stop preview" : "Start camera & mic"}
              </Button>

              <PermissionBadge value={snapshot.cameraPermission} label="Camera" />
              <PermissionBadge value={snapshot.micPermission} label="Microphone" />
            </div>

            {snapshot.previewCapabilities && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
                <div className="rounded-lg bg-secondary/40 p-2">
                  <div className="text-muted-foreground">Resolution</div>
                  <div className="font-semibold">
                    {snapshot.previewCapabilities.width || "?"}×{snapshot.previewCapabilities.height || "?"}
                  </div>
                </div>
                <div className="rounded-lg bg-secondary/40 p-2">
                  <div className="text-muted-foreground">Frame rate</div>
                  <div className="font-semibold">{snapshot.previewCapabilities.fps || "?"} fps</div>
                </div>
                <div className="rounded-lg bg-secondary/40 p-2">
                  <div className="text-muted-foreground">Status</div>
                  <div className="font-semibold">{snapshot.previewActive ? "Active" : "Idle"}</div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Error / recovery */}
        {snapshot.error && (
          <Card className="border-red-300 bg-red-50 dark:bg-red-950/20">
            <CardContent className="p-4 space-y-2">
              <div className="flex items-start gap-2">
                <Icon name="AlertCircle" className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                <p className="text-sm text-red-700 dark:text-red-300">{snapshot.error}</p>
              </div>
              {snapshot.recoveryHint && (
                <p className="text-xs text-red-600/90 dark:text-red-300/90 pl-7">{snapshot.recoveryHint}</p>
              )}
            </CardContent>
          </Card>
        )}

        {/* Device selectors */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Icon name="Cpu" className="w-4 h-4 text-brand" /> Available Devices
            </CardTitle>
            <CardDescription>Select the camera, microphone, and speaker you want to use.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <DeviceSelector
              label="Camera"
              icon="Camera"
              value={snapshot.selectedCameraId ?? ""}
              items={snapshot.camera}
              onSelect={(id) => selectDevice("videoinput", id)}
            />
            <DeviceSelector
              label="Microphone"
              icon="Mic"
              value={snapshot.selectedMicId ?? ""}
              items={snapshot.microphones}
              onSelect={(id) => selectDevice("audioinput", id)}
            />
            <DeviceSelector
              label="Speaker"
              icon="Volume2"
              value={snapshot.selectedSpeakerId ?? ""}
              items={snapshot.speakers}
              onSelect={(id) => selectDevice("audiooutput", id)}
            />
          </CardContent>
        </Card>

        {/* Microphone level test */}
        {snapshot.previewActive && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Icon name="Activity" className="w-4 h-4 text-brand" /> Microphone Input Level
              </CardTitle>
              <CardDescription>Speak to confirm your microphone is capturing audio.</CardDescription>
            </CardHeader>
            <CardContent>
              <MicLevelMeter getStream={getStream} />
            </CardContent>
          </Card>
        )}

        {/* Browser compatibility */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Icon name="ShieldCheck" className="w-4 h-4 text-brand" /> Browser Compatibility
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid sm:grid-cols-2 gap-2">
              {compatRows.map((r) => (
                <div
                  key={r.label}
                  className="flex items-center justify-between text-xs rounded-lg border border-border px-3 py-2"
                >
                  <span className="text-muted-foreground">{r.label}</span>
                  <Icon
                    name={r.ok ? "CheckCircle2" : "XCircle"}
                    className={`w-4 h-4 ${r.ok ? "text-emerald-600" : "text-red-500"}`}
                  />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Sub-components
// ----------------------------------------------------------------------------

function DeviceSelector({
  label,
  icon,
  value,
  items,
  onSelect,
}: {
  label: string;
  icon: string;
  value: string;
  items: { deviceId: string; label: string }[];
  onSelect: (id: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold flex items-center gap-1.5">
        <Icon name={icon} className="w-3.5 h-3.5" /> {label}
      </label>
      {items.length === 0 ? (
        <div className="text-xs text-muted-foreground rounded-md border border-dashed border-border px-3 py-2">
          No {label.toLowerCase()} detected yet — start the camera & mic to enumerate devices.
        </div>
      ) : (
        <Select value={value} onValueChange={onSelect}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder={`Select a ${label.toLowerCase()}`} />
          </SelectTrigger>
          <SelectContent>
            {items.map((d) => (
              <SelectItem key={d.deviceId} value={d.deviceId}>
                {d.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>
  );
}

function MicLevelMeter({ getStream }: { getStream: () => MediaStream | null }) {
  const [level, setLevel] = useState(0);
  const meter = useAudioMeter();

  useEffect(() => {
    const stream = getStream();
    if (stream && stream.getAudioTracks().length > 0) {
      meter.start(stream);
    }
    return () => meter.stop();
  }, [getStream, meter]);

  // Bridge the hook's level into local state for rendering.
  useEffect(() => {
    let raf: number | null = null;
    const tick = () => {
      setLevel(meter.level);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      if (raf != null) cancelAnimationFrame(raf);
    };
  }, [meter]);

  const pct = Math.round(level * 100);
  const color = pct > 75 ? "#DC2626" : pct > 35 ? "#F59E0B" : "#10B981";
  return (
    <div className="space-y-2">
      <div className="h-3 bg-secondary rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
      </div>
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>Input level</span>
        <span>{pct}%</span>
      </div>
    </div>
  );
}
