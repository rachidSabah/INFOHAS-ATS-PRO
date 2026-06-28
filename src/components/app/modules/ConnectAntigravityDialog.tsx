"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge, Icon } from "@/components/shared";
import { toast } from "sonner";

type ConnectState = "idle" | "connecting" | "authorized" | "error";

export function ConnectAntigravityDialog() {
  const [state, setState] = useState<ConnectState>("idle");
  const [errorMsg, setErrorMsg] = useState("");

  // Listen for OAuth popup callback messages
  const handleMessage = useCallback((event: MessageEvent) => {
    if (event.data?.type === "antigravity-auth") {
      if (event.data.status === "success") {
        // Save tokens via the provider
        try {
          const provider = getAntigravityProvider();
          await provider.login(event.data.accessToken);
          if (event.data.refreshToken) {
            // Store refresh token for later use
            await provider.saveRefreshToken(event.data.refreshToken, event.data.expiresIn || 3600);
          }
        } catch { /* session save may fail — token still stored in memory */ }
        setState("authorized");
        toast.success("Antigravity connected successfully!");
        // Auto-sync models
        fetch("/api/providers/antigravity/models/sync", { method: "POST" })
          .then(() => toast.success("Models synced."))
          .catch(() => {});
      } else if (event.data.status === "error") {
        setState("error");
        setErrorMsg(event.data.error || "Authorization failed.");
      }
    }
  }, []);

  useEffect(() => {
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [handleMessage]);

  const handleConnect = async () => {
    setState("connecting");
    setErrorMsg("");

    try {
      // Step 1: POST /start to get auth URL (authenticated — uses frontend session)
      const startRes = await fetch("/api/providers/antigravity/start", { method: "POST" });
      if (!startRes.ok) {
        const errData = await startRes.json().catch(() => ({}));
        throw new Error(errData.error || `Start auth failed (${startRes.status})`);
      }
      const { authUrl } = await startRes.json();

      // Step 2: Open Google OAuth in popup
      const popup = window.open(authUrl, "antigravity-auth", "width=600,height=700");
      if (!popup) {
        // Popup blocked — redirect directly
        window.location.href = authUrl;
        return;
      }
      // The popup will redirect to Google login, then back to the callback,
      // which posts a message to this window on success.
      // If popup is closed without auth, detect it
      const checkClosed = setInterval(() => {
        if (popup.closed) {
          clearInterval(checkClosed);
          if (state === "connecting") {
            setState("error");
            setErrorMsg("Authentication window was closed. Please try again.");
          }
        }
      }, 1000);
    } catch (e: any) {
      setState("error");
      setErrorMsg(e?.message || "Failed to connect.");
    }
  };

  return (
    <Card className="border-brand/20">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Icon name="Terminal" className="w-5 h-5 text-brand" /> Antigravity CLI
        </CardTitle>
        <CardDescription>
          Connect using Google OAuth. A popup will open for you to sign in with Google.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status badge */}
        <div className="flex items-center gap-2">
          <Badge variant={state === "authorized" ? "success" : state === "error" ? "danger" : "default"}>
            {state === "idle" && "Not connected"}
            {state === "connecting" && "Connecting..."}
            {state === "authorized" && "Connected"}
            {state === "error" && "Error"}
          </Badge>
        </div>

        {/* Error state */}
        {state === "error" && (
          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30 flex items-start gap-2">
            <Icon name="AlertTriangle" className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-destructive">Connection failed</p>
              <p className="text-xs text-muted-foreground mt-1">{errorMsg}</p>
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2">
          {state === "idle" && (
            <Button onClick={handleConnect} className="gap-2 bg-brand hover:bg-brand-dark">
              <Icon name="Terminal" className="w-4 h-4" /> Connect Antigravity
            </Button>
          )}
          {state === "connecting" && (
            <Button disabled className="gap-2">
              <Icon name="Loader" className="w-4 h-4 animate-spin" /> Opening Google login...
            </Button>
          )}
          {state === "authorized" && (
            <Button variant="outline" onClick={() => {
              fetch("/api/providers/antigravity/models/sync", { method: "POST" })
                .then(() => toast.success("Models synced"))
                .catch(() => toast.error("Model sync failed"));
            }} className="gap-2">
              <Icon name="Refresh" className="w-4 h-4" /> Sync Models
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
