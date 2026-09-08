"use client";

// ResumeAI Pro — Local QR code renderer
//
// Generates QR codes IN THE BROWSER via the `qrcode` package. This replaces
// the previous external api.qrserver.com <img> integration: resume URLs (and
// historically, resume data embedded in those URLs) must never be sent to a
// third-party service just to draw a QR code.

import { useEffect, useState } from "react";

interface QrCodeProps {
  /** The payload to encode (usually a share URL). */
  text: string;
  /** Rendered image width/height in px (default 200). */
  size?: number;
  className?: string;
  /** Accessible label for the image. */
  alt?: string;
  /** When set, the QR is wrapped in an <a download> so it can be saved. */
  downloadName?: string;
}

export function QrCode({ text, size = 200, className, alt = "QR code", downloadName }: QrCodeProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDataUrl(null);
    setFailed(false);
    if (!text) { setFailed(true); return; }
    // Lazy import keeps the QR encoder out of every chunk that mounts QrCode
    // consumers only conditionally — and out of SSR entirely.
    import("qrcode")
      .then((QR) =>
        QR.toDataURL(text, {
          width: size,
          margin: 1,
          errorCorrectionLevel: "M",
          color: { dark: "#111827", light: "#FFFFFF" },
        }),
      )
      .then((url) => { if (!cancelled) setDataUrl(url); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [text, size]);

  if (failed) {
    return (
      <div
        className={`flex items-center justify-center rounded-md border border-dashed border-border text-[10px] text-muted-foreground ${className || ""}`}
        style={{ width: size, height: size }}
      >
        QR unavailable
      </div>
    );
  }

  if (!dataUrl) {
    return (
      <div
        className={`flex items-center justify-center rounded-md border border-border bg-muted/40 animate-pulse ${className || ""}`}
        style={{ width: size, height: size }}
      />
    );
  }

  const img = <img src={dataUrl} alt={alt} width={size} height={size} className={className} />;
  if (downloadName) {
    return (
      <a href={dataUrl} download={downloadName} title="Click to download the QR code" className="inline-block">
        {img}
      </a>
    );
  }
  return img;
}
