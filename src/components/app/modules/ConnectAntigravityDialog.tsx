"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge, Icon } from "@/components/shared";
import { toast } from "sonner";
import type { DeviceCodeResponse } from "@/lib/providers/antigravity-auth";
import { getAntigravityProvider } from "@/lib/providers/antigravity-provider";

type ConnectState = "idle" | "generating" | "waiting" | "authorized" | "error";

export function ConnectAntigravityDialog() {
  const [state, setState] = useState<ConnectState>("idle");
  const [deviceData, setDeviceData] = useState<DeviceCodeResponse | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [errorMsg, setErrorMsg] = useState("");
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (pollRef.current) { clearTimeout(pollRef.current); pollRef.current = null; }
  }, []);

  useEffect(() => {
    return () => clearTimers();
  }, [clearTimers]);

  const handleConnect = async () => {
    setState("generating");
    setErrorMsg("");
    clearTimers();

    try {
      const provider = getAntigravityProvider();
      const data = await provider.initiateDeviceFlow();
      setDeviceData(data);
      setTimeLeft(data.expiresIn);
      setState("waiting");

      // Start expiration countdown
      timerRef.current = setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 1) {
            clearTimers();
            setState("error");
            setErrorMsg("Code expired. Please connect again.");
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      // Start polling
      const doPoll = async () => {
        const result = await provider.pollForToken(data.deviceCode, data.interval);
        if (result.status === "authorized") {
          clearTimers();
          setState("authorized");
          toast.success("Antigravity connected successfully!");
          // Auto-sync models
          try {
            await provider.listModels();
            toast.success("Antigravity models synced.");
          } catch { /* models will sync on first use */ }
        } else if (result.status === "pending") {
          // Poll again after interval
          pollRef.current = setTimeout(doPoll, (data.interval || 5) * 1000);
        } else {
          clearTimers();
          setState("error");
          setErrorMsg(result.error || "Connection failed.");
        }
      };
      pollRef.current = setTimeout(doPoll, data.interval * 1000);
    } catch (e: any) {
      setState("error");
      setErrorMsg(e?.message || "Failed to initiate connection.");
    }
  };

  const handleCancel = () => {
    clearTimers();
    setState("idle");
    setDeviceData(null);
    setErrorMsg("");
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text).then(() => toast.success("Copied!"));
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <Card className="border-brand/20">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Icon name="Terminal" className="w-5 h-5 text-brand" /> Antigravity CLI
        </CardTitle>
        <CardDescription>
          Connect using OAuth Device Authorization Flow. No email or password required.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status badge */}
        <div className="flex items-center gap-2">
          <Badge variant={state === "authorized" ? "success" : state === "error" ? "danger" : state === "waiting" ? "warning" : "default"}>
            {state === "idle" && "Not connected"}
            {state === "generating" && "Generating code..."}
            {state === "waiting" && "Awaiting authorization"}
            {state === "authorized" && "Connected"}
            {state === "error" && "Error"}
          </Badge>
          {state === "authorized" && (
            <Badge variant="success">Models will sync automatically</Badge>
          )}
        </div>

        {/* Device authorization flow UI */}
        {state === "waiting" && deviceData && (
          <div className="space-y-4 p-4 rounded-lg bg-muted/30 border border-border">
            {/* Step 1: Visit URL */}
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Step 1: Visit this URL</p>
              <div className="flex items-center gap-2 p-2 rounded-md bg-background border border-border">
                <code className="text-sm flex-1 break-all font-mono">{deviceData.verificationUrl}</code>
                <Button variant="ghost" size="sm" onClick={() => copyToClipboard(deviceData.verificationUrl)} className="shrink-0">
                  <Icon name="Copy" className="w-3.5 h-3.5" />
                </Button>
                <Button variant="outline" size="sm" onClick={() => window.open(deviceData.verificationUrl, "_blank")} className="shrink-0 gap-1">
                  <Icon name="ExternalLink" className="w-3.5 h-3.5" /> Open
                </Button>
              </div>
            </div>

            {/* Step 2: Enter code */}
            <div className="space-y-1">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Step 2: Enter this code</p>
              <div className="flex items-center gap-2">
                <code className="text-2xl font-bold font-mono tracking-[0.25em] bg-background px-4 py-2 rounded-md border border-border select-all">
                  {deviceData.userCode}
                </code>
                <Button variant="ghost" size="sm" onClick={() => copyToClipboard(deviceData.userCode)}>
                  <Icon name="Copy" className="w-3.5 h-3.5" />
                </Button>
              </div>
            </div>

            {/* Expiration timer */}
            <div className="flex items-center gap-2 text-sm">
              <Icon name="Timer" className="w-4 h-4 text-muted-foreground" />
              <span className="text-muted-foreground">Code expires in:</span>
              <span className={`font-mono font-bold ${timeLeft < 60 ? "text-destructive" : ""}`}>
                {formatTime(timeLeft)}
              </span>
            </div>

            {/* Cancel */}
            <Button variant="outline" onClick={handleCancel} className="gap-2">
              <Icon name="X" className="w-4 h-4" /> Cancel
            </Button>
          </div>
        )}

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
          {state === "generating" && (
            <Button disabled className="gap-2">
              <Icon name="Loader" className="w-4 h-4 animate-spin" /> Generating...
            </Button>
          )}
          {state === "authorized" && (
            <Button variant="outline" onClick={() => {
              const provider = getAntigravityProvider();
              provider.listModels().then(() => toast.success("Models synced"));
            }} className="gap-2">
              <Icon name="Refresh" className="w-4 h-4" /> Sync Models
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
