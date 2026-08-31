"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge, Icon } from "@/components/shared";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import { useApp } from "@/lib/store";
import { ANTIGRAVITY_CLIENT_ID, ANTIGRAVITY_SCOPES } from "@/lib/providers/antigravity-auth";

type ConnectState = "idle" | "connecting" | "authorized" | "error";

// ── Google Identity Services (GIS) token client ───────────────────────────────
// Uses the implicit / token model — no redirect URI needed.
// The token is returned directly via a JavaScript callback in the browser.
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient: (cfg: {
            client_id: string;
            scope: string;
            callback: (resp: { access_token?: string; error?: string }) => void;
            error_callback?: (err: any) => void;
          }) => { requestAccessToken: () => void };
        };
      };
    };
  }
}

function loadGISScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) { resolve(); return; }
    const existing = document.getElementById("gis-script");
    if (existing) { existing.addEventListener("load", () => resolve()); return; }
    const script = document.createElement("script");
    script.id = "gis-script";
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Google Identity Services script."));
    document.head.appendChild(script);
  });
}

const STEPS = [
  { num: "1", label: "Install the CLI", code: "npm i -g antigravity", icon: "Package" },
  { num: "2", label: "Authenticate with Google", code: "agy auth", note: "Opens your browser for Google sign-in", icon: "Chrome" },
  {
    num: "3",
    label: "Copy your token (Windows)",
    code: String.raw`type %USERPROFILE%\.antigravity\credentials`,
    note: 'Or open the file in Notepad — copy the "accessToken" value',
    icon: "Terminal",
  },
];

export function ConnectAntigravityDialog() {
  const storeProvider = useApp((s) => s.providers.find((p) => p.id === "p_antigravity"));
  const isAuthorizedInStore = !!storeProvider?.apiKey && storeProvider?.isActive;
  const setView = useApp((s) => s.setView);

  const [state, setState] = useState<ConnectState>("idle");
  const [token, setToken] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [copiedStep, setCopiedStep] = useState<number | null>(null);
  const [gisLoading, setGisLoading] = useState(false);

  // Sync state from store
  useEffect(() => {
    if (isAuthorizedInStore) setState("authorized");
    else if (state === "authorized") setState("idle");
  }, [isAuthorizedInStore]);

  // Restore session on mount
  useEffect(() => {
    (async () => {
      try {
        const { getAntigravityProvider } = await import("@/lib/providers/antigravity-provider");
        const session = await getAntigravityProvider().restore();
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

  // ── In-browser Google OAuth (GIS token model — no redirect URI) ────────────
  const handleGoogleSignIn = useCallback(async () => {
    setGisLoading(true);
    setErrorMsg("");
    try {
      await loadGISScript();

      const client = window.google!.accounts.oauth2.initTokenClient({
        client_id: ANTIGRAVITY_CLIENT_ID,
        scope: ANTIGRAVITY_SCOPES.join(" "),
        callback: async (resp) => {
          if (resp.error || !resp.access_token) {
            setState("error");
            setErrorMsg(resp.error || "Google sign-in was cancelled or failed.");
            setGisLoading(false);
            return;
          }

          const accessToken = resp.access_token;
          setState("connecting");
          try {
            const { getAntigravityProvider } = await import("@/lib/providers/antigravity-provider");
            await getAntigravityProvider().login(accessToken);
            useApp.getState().updateProvider("p_antigravity", {
              isActive: true,
              apiKey: accessToken,
              status: "healthy",
            });
            setState("authorized");
            toast.success("Antigravity connected via Google sign-in!");
          } catch (e: any) {
            setState("error");
            setErrorMsg(e?.message || "Failed to save token after Google sign-in.");
          }
          setGisLoading(false);
        },
        error_callback: (err: any) => {
          setState("error");
          setErrorMsg(err?.message || "Google sign-in failed.");
          setGisLoading(false);
        },
      });

      client.requestAccessToken();
    } catch (e: any) {
      setState("error");
      setErrorMsg(e?.message || "Failed to initialise Google sign-in.");
      setGisLoading(false);
    }
  }, []);

  // ── Manual token paste ─────────────────────────────────────────────────────
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
      await getAntigravityProvider().login(trimmed);
      useApp.getState().updateProvider("p_antigravity", {
        isActive: true,
        apiKey: trimmed,
        status: "healthy",
      });
      setState("authorized");
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
      await getAntigravityProvider().logout();
      useApp.getState().updateProvider("p_antigravity", { isActive: false, apiKey: "" });
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
          Connect using Google sign-in or paste your CLI token.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Status */}
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

        {state !== "authorized" && (
          <div className="space-y-4">

            {/* ── Option A: In-browser Google Sign-In (no terminal needed) ── */}
            <div className="rounded-xl border border-brand/30 bg-brand/5 p-4 space-y-3">
              <p className="text-xs font-semibold text-brand flex items-center gap-1.5">
                <Icon name="Star" className="w-3.5 h-3.5" />
                Recommended — Sign in with Google (no terminal needed)
              </p>
              <p className="text-[11px] text-muted-foreground">
                Uses Google Identity Services directly in your browser. Your already-signed-in Google session will be reused — one click, no commands.
              </p>
              <Button
                onClick={handleGoogleSignIn}
                disabled={gisLoading || state === "connecting"}
                className="gap-2 w-full bg-brand hover:bg-brand-dark text-white font-semibold shadow-premium"
              >
                {gisLoading
                  ? <><Icon name="Loader2" className="w-4 h-4 animate-spin" />Opening Google Sign-In…</>
                  : <><Icon name="LogIn" className="w-4 h-4" />Sign in with Google</>
                }
              </Button>
            </div>

            {/* Divider */}
            <div className="relative flex py-1 items-center">
              <div className="flex-grow border-t border-border" />
              <span className="flex-shrink mx-3 text-[10px] text-muted-foreground uppercase tracking-wider">or use CLI token</span>
              <div className="flex-grow border-t border-border" />
            </div>

            {/* ── Option B: Manual token (if CLI already installed) ── */}
            <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
              <p className="text-xs font-semibold text-foreground/80 flex items-center gap-1.5">
                <Icon name="Terminal" className="w-3.5 h-3.5" />
                Already have the CLI installed? Get your token:
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
                        title="Copy"
                      >
                        <Icon name={copiedStep === idx ? "Check" : "Copy"} className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {step.note && <p className="text-[11px] text-muted-foreground mt-0.5">{step.note}</p>}
                  </div>
                </div>
              ))}

              <div className="space-y-2 pt-1">
                <label className="text-xs font-medium text-foreground/80 flex items-center gap-1.5">
                  <Icon name="Key" className="w-3.5 h-3.5 text-brand" />
                  Paste accessToken
                </label>
                <Textarea
                  placeholder='ya29.a0AfB_byC… (paste the "accessToken" from the credentials file)'
                  value={token}
                  onChange={(e) => { setToken(e.target.value); if (state === "error") setState("idle"); }}
                  className="font-mono text-xs h-20 resize-none"
                  disabled={state === "connecting"}
                />
                <Button
                  onClick={handlePasteToken}
                  disabled={state === "connecting" || !token.trim()}
                  variant="outline"
                  className="gap-2 w-full"
                >
                  {state === "connecting"
                    ? <><Icon name="Loader2" className="w-4 h-4 animate-spin" />Connecting…</>
                    : <><Icon name="Plug" className="w-4 h-4" />Connect with Token</>
                  }
                </Button>
              </div>
            </div>

            {/* Info */}
            <div className="flex items-start gap-2 p-2.5 rounded-lg bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/50">
              <Icon name="Info" className="w-3.5 h-3.5 text-blue-500 shrink-0 mt-0.5" />
              <p className="text-[11px] text-blue-700 dark:text-blue-300">
                Your Google token is stored only in your browser session and never sent to any third-party server.
              </p>
            </div>

            <div className="pt-2.5 border-t border-border mt-1">
              <p className="text-[10px] text-muted-foreground flex items-center gap-1">
                <Icon name="Plug" className="w-3.5 h-3.5 text-brand" />
                Want to connect custom local tools?
              </p>
              <Button
                variant="link"
                size="sm"
                onClick={() => setView("integrations")}
                className="text-[11px] p-0 text-brand font-semibold h-auto mt-0.5"
              >
                Configure MCP Servers &rarr;
              </Button>
            </div>
          </div>
        )}

        {/* Connected */}
        {state === "authorized" && (
          <div className="space-y-3">
            <div className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/50 flex items-center gap-2">
              <Icon name="CheckCircle2" className="w-4 h-4 text-emerald-600 shrink-0" />
              {/* Task 29 — truthful integration copy: Google sign-in is the AUTH
                  MECHANISM of this CLI integration, not evidence that AI features
                  are using the Google Gemini API provider (a separate REST
                  integration with its own key and Base URL). */}
              <p className="text-xs text-emerald-700 dark:text-emerald-300">
                Antigravity CLI is connected. Models routed to this provider run through the Antigravity CLI integration (Integration type: CLI · Base URL: not applicable).
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={async () => {
                try {
                  const { getAntigravityProvider } = await import("@/lib/providers/antigravity-provider");
                  const models = await getAntigravityProvider().listModels();
                  // Task 29 — model ownership: synced models are stored on the
                  // ANTIGRAVITY provider only (provider_id = antigravity). They are
                  // never written to any Google Gemini API provider, and Google-family
                  // model ids (gemini-*) remain Antigravity models — ownership is the
                  // integration a model is callable through, not its name.
                  useApp.getState().updateProvider("p_antigravity", { enabledModels: models });
                  toast.success(`Models synced: ${models.length} model(s) → provider: Antigravity CLI (CLI integration)`);
                } catch {
                  toast.error("Model sync failed.");
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
