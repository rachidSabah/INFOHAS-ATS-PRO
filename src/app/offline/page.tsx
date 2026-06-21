"use client";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/shared";

/**
 * Offline fallback page — shown by the service worker when the network fails
 * and no cached version of the requested page is available.
 */
export default function OfflinePage() {
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="max-w-md w-full bg-card rounded-2xl border border-border shadow-premium p-8 text-center">
        <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center bg-amber-100 dark:bg-amber-950/30">
          <Icon name="WifiOff" className="w-8 h-8 text-amber-600" />
        </div>
        <h1 className="font-display text-xl font-bold mb-2">You're offline</h1>
        <p className="text-sm text-muted-foreground mb-6 text-pretty">
          ResumeAI Pro needs an internet connection to load your data and run AI features.
          Please check your connection and try again.
        </p>
        <Button onClick={() => location.reload()} className="bg-brand hover:bg-brand-dark text-white gap-2">
          <Icon name="RefreshCw" className="w-4 h-4" /> Retry connection
        </Button>
        <p className="text-xs text-muted-foreground mt-4">
          Tip: Once you've loaded the app while online, cached pages will work offline.
        </p>
      </div>
    </div>
  );
}
