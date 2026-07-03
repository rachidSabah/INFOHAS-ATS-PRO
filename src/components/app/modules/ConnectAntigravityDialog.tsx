"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge, Icon } from "@/components/shared";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { useApp } from "@/lib/store";

type ConnectState = "idle" | "connecting" | "authorized" | "error";

const STEPS = [
  {
    num: "1",
    label: "Install the CLI",
    code: "npm i -g antigravity",
    icon: "Package",
  },
  {
    num: "2",
    label: "Authenticate with Google",
    code: "agy auth",
    note: "Opens your browser for Google sign-in",
    icon: "Chrome",
  },
  {
    num: "3",
    label: "Copy your token",
    code: "cat ~/.antigravity/credentials",
    note: 'Copy the "accessToken" value from the output',
    icon: "Terminal",
  },
];

export function ConnectAntigravityDialog() {
  const storeProvider = useApp((s) => s.providers.find((p) => p.id === "p_antigravity"));
  const isAuthorizedInStore = !!storeProvider?.apiKey && storeProvider?.isActive;

  const [state, setState] = useState<ConnectState>("idle");
  const [token, setToken] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [copiedStep, setCopiedStep] = useState<number | null>(null);

  // Sync state with store on mount and when store changes
  useEffect(() => {
    if (isAuthorizedInStore) {
      setState("authorized");
    } else if (state === "authorized") {
      setState("idle");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthorizedInStore]);

  // Restore saved session on mount
  useEffect(() => {
    (async () => {
      try {
        const { getAntigravityProvider } = await import("@/lib/providers/antigravity-provider");
        const provider = getAntigravityProvider();
        const session = await provider.restore();
        if (session?.authenticated) {
          setState("authorized");
          const sp = useApp.getState().providers.find((p: any) => p.id === "p_antigravity");
          if (sp && !sp.isActive) {
            useApp.getState().updateProvider("p_antigravity", {
              isActive: true,
              apiKey: session.accessToken || undefined,
              status: "healthy",
            });
          }
        }
      } catch {}
    })();
  }, []);

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
      const { getAntigravityProvider } = await import("@/lib/providers/antigravity-provider");
      const provider = getAntigravityProvider();
      await provider.login(trimmed);
      setState("authorized");
      useApp.getState().updateProvider("p_antigravity", {
        isActive: true,
        apiKey: trimmed,
        status: "healthy",
      });
      setToken("");
      toast.success("Antigravity CLI connected successfully!");
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
      useApp.getState().updateProvider("p_antigravity", {
        isActive: false,
        apiKey: "",
      });
    } catch {}
    setState("idle");
    setToken("");
    toast.success("Antigravity disconnected.");
  };

  const copyToClipboard = (text: string, idx: number) => {
    navigator.clipboard.writeText(text);
    setCopiedStep(idx);
    setTimeout(() => setCopiedStep(null), 1500);
  };

  return (
    <Card className="border-brand/20">
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Icon name="Terminal" className="w-5 h-5 text-brand" /> Antigravity CLI
        </CardTitle>
        <CardDescription>
          Connect using your local Antigravity CLI token. Run the 3 commands below and paste the token.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status badge */}
        <div className="flex items-center gap-2">
          <Badge variant={state === "authorized" ? "success" : state === "error" ? "danger" : "default"}>
            {state === "idle" && <><Icon name="Plug" className="w-3 h-3 mr-1" />Not connected</>}
            {state === "connecting" && <><Icon name="Loader2" className="w-3 h-3 mr-1 animate-spin" />Connecting…</>}
            {state === "authorized" && <><Icon name="CheckCircle2" className="w-3 h-3 mr-1" />Connected</>}
            {state === "error" && <><Icon name="XCircle" className="w-3 h-3 mr-1" />Error</>}
          </Badge>
          {storeProvider?.apiKey && state === "authorized" && (
            <span className="text-xs text-muted-foreground font-mono truncate max-w-[140px]">
              {storeProvider.apiKey.slice(0, 12)}…
            </span>
          )}
        </div>

        {/* Error */}
        {state === "error" && errorMsg && (
          <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/30 flex items-start gap-2">
            <Icon name="AlertTriangle" className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
            <p className="text-xs text-destructive">{errorMsg}</p>
          </div>
        )}

        {/* Not connected — show setup steps + token input */}
        {state !== "authorized" && (
          <div className="space-y-4">
            {/* Step-by-step instructions */}
            <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
              <p className="text-xs font-semibold text-foreground/80 flex items-center gap-1.5">
                <Icon name="BookOpen" className="w-3.5 h-3.5 text-brand" />
                3 steps to connect
              </p>
              {STEPS.map((step, idx) => (
                <div key={idx} className="flex items-start gap-3">
                  <div className="w-6 h-6 rounded-full bg-brand/10 border border-brand/20 text-brand text-[11px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                    {step.num}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground/80">{step.label}</p>
                    <div className="flex items-center gap-1.5 mt-1">
                      <code className="bg-secondary border border-border px-2 py-0.5 rounded text-[11px] font-mono text-foreground/90 flex-1 truncate">
                        {step.code}
                      </code>
                      <button
                        onClick={() => copyToClipboard(step.code, idx)}
                        className="text-muted-foreground hover:text-brand transition-colors shrink-0"
                        title="Copy command"
                      >
                        <Icon name={copiedStep === idx ? "Check" : "Copy"} className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {step.note && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">{step.note}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Token paste */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-foreground/80 flex items-center gap-1.5">
                <Icon name="Key" className="w-3.5 h-3.5 text-brand" />
                Paste your accessToken here
              </label>
              <Textarea
                placeholder='ya29.a0AfB_byC... (paste the "accessToken" value from the credentials file)'
                value={token}
                onChange={(e) => { setToken(e.target.value); if (state === "error") setState("idle"); }}
                className="font-mono text-xs h-20 resize-none"
                disabled={state === "connecting"}
              />
              <Button
                onClick={handlePasteToken}
                disabled={state === "connecting" || !token.trim()}
                className="gap-2 w-full bg-brand hover:bg-brand-dark text-white"
              >
                {state === "connecting"
                  ? <><Icon name="Loader2" className="w-4 h-4 animate-spin" />Connecting…</>
                  : <><Icon name="Plug" className="w-4 h-4" />Connect Antigravity CLI</>
                }
              </Button>
            </div>

            {/* Info note */}
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/50">
              <Icon name="Info" className="w-3.5 h-3.5 text-blue-500 shrink-0 mt-0.5" />
              <p className="text-[11px] text-blue-700 dark:text-blue-300">
                The Antigravity CLI authenticates via your Google account locally. The token is stored securely in your browser and never sent to any third-party server.
              </p>
            </div>
          </div>
        )}

        {/* Connected state */}
        {state === "authorized" && (
          <div className="space-y-3">
            <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50 flex items-center gap-2">
              <Icon name="CheckCircle2" className="w-4 h-4 text-emerald-600 shrink-0" />
              <p className="text-xs text-emerald-700 dark:text-emerald-300">
                Antigravity CLI is connected. AI features are now using your account.
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={async () => {
                try {
                  const { getAntigravityProvider } = await import("@/lib/providers/antigravity-provider");
                  const models = await getAntigravityProvider().listModels();
                  useApp.getState().updateProvider("p_antigravity", { enabledModels: models });
                  toast.success(`Models synced: ${models.length} model(s)`);
                } catch {
                  toast.error("Model sync failed — provider not authenticated");
                }
              }} className="gap-2 flex-1">
                <Icon name="RefreshCw" className="w-4 h-4" /> Sync Models
              </Button>
              <Button variant="destructive" onClick={handleDisconnect} className="gap-2">
                <Icon name="LogOut" className="w-4 h-4" /> Disconnect
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
