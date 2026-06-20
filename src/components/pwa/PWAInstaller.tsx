"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/shared";
import { toast } from "sonner";

/**
 * PWAInstaller — registers the service worker and shows an install prompt
 * when the browser fires `beforeinstallprompt` (Chrome/Edge/Android).
 *
 * On iOS Safari, `beforeinstallprompt` never fires — iOS users must manually
 * tap Share → "Add to Home Screen". We detect iOS and show a one-time
 * instruction toast instead.
 *
 * The install banner appears:
 *   - After the user has used the app for at least 30 seconds (engagement heuristic)
 *   - Only once per session (localStorage flag `pwa-install-dismissed`)
 *   - Dismissible (X button) — won't show again until cleared
 */
export function PWAInstaller() {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [showBanner, setShowBanner] = useState(false);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // === Register the service worker ===
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then((registration) => {
          // Check for updates every 60 seconds
          setInterval(() => {
            registration.update().catch(() => {});
          }, 60000);
        })
        .catch(() => {});

      // === Listen for SW update messages ===
      navigator.serviceWorker.addEventListener("message", (event) => {
        if (event.data?.type === "SW_UPDATED" || event.data?.type === "CONTENT_UPDATED") {
          // New content available — show a toast with a reload action
          toast.info("Update available", {
            duration: 10000,
            description: "A new version of ResumeAI Pro is available.",
            action: {
              label: "Reload",
              onClick: () => {
                // Clear all caches before reload
                if ("caches" in window) {
                  caches.keys().then((names) => {
                    names.forEach((name) => caches.delete(name));
                  });
                }
                window.location.reload();
              },
            },
          });
        }
      });

      // === Listen for controller change (new SW took over) ===
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        // The new SW has taken control — if we haven't shown a toast yet,
        // reload the page to get the new content
        if (!sessionStorage.getItem("sw-reloaded")) {
          sessionStorage.setItem("sw-reloaded", "1");
          window.location.reload();
        }
      });
    }

    // === Detect if already installed (standalone mode) ===
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // iOS Safari
      (window.navigator as any).standalone === true;
    if (standalone) {
      setIsInstalled(true);
      return; // No need to show install prompt if already installed
    }

    // === Detect iOS (no beforeinstallprompt support) ===
    const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    setIsIOS(isIOSDevice);

    // === Listen for beforeinstallprompt (Chrome/Edge/Android) ===
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault(); // Prevent the default browser mini-infobar
      setDeferredPrompt(e);

      // Check if the user previously dismissed the banner
      const dismissed = localStorage.getItem("pwa-install-dismissed") === "true";
      if (!dismissed) {
        // Show the banner after a short engagement delay (30s)
        setTimeout(() => setShowBanner(true), 30000);
      }
    };
    window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);

    // === Listen for successful install ===
    const handleAppInstalled = () => {
      setIsInstalled(true);
      setShowBanner(false);
      setDeferredPrompt(null);
      toast.success("ResumeAI Pro installed! Find it on your home screen.");
      console.info("[PWA] App installed successfully");
    };
    window.addEventListener("appinstalled", handleAppInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  // === iOS instruction toast (one-time) ===
  useEffect(() => {
    if (!isIOS || isInstalled) return;
    const iosInstructed = localStorage.getItem("pwa-ios-instructed") === "true";
    if (iosInstructed) return;
    const timer = setTimeout(() => {
      toast.info("Install ResumeAI Pro as an app", {
        duration: 8000,
        description: "Tap the Share button in Safari, then 'Add to Home Screen' for the full app experience.",
        action: {
          label: "Got it",
          onClick: () => localStorage.setItem("pwa-ios-instructed", "true"),
        },
      });
      localStorage.setItem("pwa-ios-instructed", "true");
    }, 45000); // After 45s of engagement
    return () => clearTimeout(timer);
  }, [isIOS, isInstalled]);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") {
      console.info("[PWA] User accepted the install prompt");
    } else {
      console.info("[PWA] User dismissed the install prompt");
      localStorage.setItem("pwa-install-dismissed", "true");
    }
    setDeferredPrompt(null);
    setShowBanner(false);
  };

  const handleDismiss = () => {
    setShowBanner(false);
    localStorage.setItem("pwa-install-dismissed", "true");
  };

  if (isInstalled) return null;

  return (
    <AnimatePresence>
      {showBanner && (
        <motion.div
          initial={{ opacity: 0, y: 100 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 100 }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:w-96 z-50"
        >
          <div className="bg-card border border-border rounded-2xl shadow-premium p-4 flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand/10 flex items-center justify-center shrink-0">
              <Icon name="Download" className="w-5 h-5 text-brand" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-sm">Install ResumeAI Pro</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Add to your home screen for quick access and offline use. No app store needed.
              </p>
              <div className="flex gap-2 mt-3">
                <Button size="sm" onClick={handleInstall} className="bg-brand hover:bg-brand-dark text-white gap-1.5 h-7 text-xs">
                  <Icon name="Download" className="w-3.5 h-3.5" /> Install
                </Button>
                <Button size="sm" variant="ghost" onClick={handleDismiss} className="h-7 text-xs">
                  Not now
                </Button>
              </div>
            </div>
            <button
              onClick={handleDismiss}
              className="text-muted-foreground hover:text-foreground shrink-0"
              aria-label="Dismiss"
            >
              <Icon name="X" className="w-4 h-4" />
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
