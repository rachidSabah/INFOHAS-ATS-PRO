"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge, Icon } from "@/components/shared";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";

type ConnectState = "idle" | "connecting" | "authorized" | "error";

export function ConnectAntigravityDialog() {
  const [state, setState] = useState<ConnectState>("idle");
  const [token, setToken] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  const handlePasteToken = async () => {
    const trimmed = token.trim();
    if (!trimmed) {
      setErrorMsg("Please paste your Antigravity CLI access token.");
      setState("error");
      return;
    }

    setState("connecting");
    setErrorMsg("");

    try {
      // Import dynamically to avoid circular dependencies
      const { getAntigravityProvider } = await import("@/lib/providers/antigravity-provider");
      const provider = getAntigravityProvider();
      await provider.login(trimmed);
      setState("authorized");
      toast.success("Antigravity connected successfully!");
      // Auto-sync models
      fetch("/api/providers/antigravity/models/sync", { method: "POST" })
        .then(() => toast.success("Models synced."))
        .catch(() => {});
    } catch (e: any) {
      setState("error");
      setErrorMsg(e?.message || "Failed to connect with the provided token.");
    }
  };

  const handleDisconnect = async () => {
    try {
      const { getAntigravityProvider } = await import("@/lib/providers/antigravity-provider");
      const provider = getAntigravityProvider();
      await provider.logout();
    } catch {}
    setState("idle");
    setToken("");
    toast.success("Antigravity disconnected.");
  };

  return (
    <Card className="border-brand/20">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Icon name="Terminal" className="w-5 h-5 text-brand" /> Antigravity CLI
        </CardTitle>
        <CardDescription>
          Connect your own Antigravity CLI access token to unlock high-quality AI models.
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

        {/* Token paste area (when not connected) */}
        {state !== "authorized" && (
          <div className="space-y-3">
            <div className="p-3 rounded-lg bg-muted/40 border text-xs space-y-2">
              <p className="font-semibold text-sm flex items-center gap-1.5">
                <Icon name="Terminal" className="w-3.5 h-3.5" /> How to get your token
              </p>
              <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                <li><code className="bg-muted px-1 py-0.5 rounded text-[11px]">npm i -g antigravity</code></li>
                <li><code className="bg-muted px-1 py-0.5 rounded text-[11px]">agy auth</code> — opens Google sign-in</li>
                <li>Run <code className="bg-muted px-1 py-0.5 rounded text-[11px]">cat ~/.antigravity/credentials</code></li>
                <li>Copy the <strong>accessToken</strong> value and paste it below</li>
              </ol>
            </div>
            <Textarea
              placeholder="Paste your Antigravity access token here..."
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="font-mono text-xs h-24 resize-none"
            />
            <Button onClick={handlePasteToken} className="gap-2 w-full">
              <Icon name="Terminal" className="w-4 h-4" /> Connect with Token
            </Button>
          </div>
        )}

        {/* Connected state */}
        {state === "authorized" && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => {
              fetch("/api/providers/antigravity/models/sync", { method: "POST" })
                .then(() => toast.success("Models synced"))
                .catch(() => toast.error("Model sync failed"));
            }} className="gap-2">
              <Icon name="Refresh" className="w-4 h-4" /> Sync Models
            </Button>
            <Button variant="destructive" onClick={handleDisconnect} className="gap-2">
              <Icon name="LogOut" className="w-4 h-4" /> Disconnect
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
