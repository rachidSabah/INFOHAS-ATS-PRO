"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { Icon } from "@/components/shared";
import { Button } from "@/components/ui/button";

/**
 * GlobalErrorCatcher — intercepts unhandled promise rejections and window
 * errors that fall through React's error boundaries, showing a non-blocking
 * toast so the user knows something happened without losing their work.
 *
 * Mount once at the app shell level. Errors are logged to console for
 * diagnostics but don't crash the entire UI.
 */
export function GlobalErrorCatcher() {
  const installed = useRef(false);

  useEffect(() => {
    if (installed.current) return;
    installed.current = true;

    const handleRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const message =
        reason instanceof Error ? reason.message : String(reason);

      console.warn("[GlobalErrorCatcher] Unhandled promise rejection:", reason);

      // Don't spam the user with too many toasts
      // Only show for meaningful (non-abort) errors
      if (
        message &&
        !message.includes("abort") &&
        !message.includes("AbortError")
      ) {
        toast.error("A background operation failed", {
          description: message.slice(0, 120),
          duration: 4000,
          action: {
            label: "Dismiss",
            onClick: () => {},
          },
        });
      }

      // Prevent default browser "Unhandled Promise Rejection" console noise
      // (we already logged it ourselves)
      event.preventDefault();
    };

    const handleError = (event: ErrorEvent) => {
      // Ignore extension errors and browser-internal noise
      if (!event.filename || event.filename.includes("extensions")) return;

      console.warn("[GlobalErrorCatcher] Uncaught error:", event.error ?? event.message);
    };

    window.addEventListener("unhandledrejection", handleRejection);
    window.addEventListener("error", handleError);

    return () => {
      window.removeEventListener("unhandledrejection", handleRejection);
      window.removeEventListener("error", handleError);
    };
  }, []);

  // This component renders nothing
  return null;
}
