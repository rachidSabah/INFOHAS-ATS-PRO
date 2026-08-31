"use client";

/**
 * Task 30 — Z.ai Web card (authenticated chat.z.ai BROWSER SESSION).
 *
 * A SEPARATE integration from the official Z.ai API:
 *   credential_type = zai_web_session (never zai_api_key)
 *   adapter          = ZaiWebSessionAdapter (never ZaiApiAdapter)
 *
 * Login flow (user-owned, interactive — no protection is bypassed):
 *   1. "Open Z.ai" → chat.z.ai opens.
 *   2. User completes "Continue with Google" INSIDE Z.ai.
 *   3. While on chat.z.ai the user runs the "Z.ai → ATS Pro" bridge
 *      bookmarklet (same-origin session discovery + transfer).
 *   4. ATS Pro VALIDATES the session with a real Z.ai request before the
 *      card ever shows "Connected" — a found token is never trusted alone.
 */

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Icon } from "@/components/shared";
import { useApp } from "@/lib/store";
import { toast } from "sonner";
import {
  ZAI_WEB_PROVIDER_ID,
  type ZaiWebSession,
} from "@/lib/providers/zai-web/session-discovery";
import { buildZaiWebBookmarklet } from "@/lib/providers/zai-web/bridge";
import {
  forgetZaiWebSession,
  recallZaiWebSession,
  rememberZaiWebSession,
} from "@/lib/providers/zai-web/credential-store";
import type { ZaiWebSessionState } from "@/lib/providers/zai-web/session-validator";

const IMPORT_PATH = "/api/providers/zai-web/session-import";

export function ConnectZaiWebDialog() {
  const providers = useApp((s) => s.providers);
  const updateProvider = useApp((s) => s.updateProvider);
  const provider = providers.find((p) => p.id === "p_zai_web");

  const [status, setStatus] = useState<"idle" | "bridging" | "connected" | "error">("idle");
  const [validationState, setValidationState] = useState<ZaiWebSessionState | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [bridgeCopied, setBridgeCopied] = useState(false);
  const [showFallback, setShowFallback] = useState(false);
  const [pastedToken, setPastedToken] = useState("");

  useEffect(() => {
    if (provider?.enabledModels?.length && status === "idle") {
      setStatus("connected");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openZai = () => {
    window.open("https://chat.z.ai/", "_blank", "noopener,noreferrer");
    setStatusMessage("Sign in to Z.ai with 'Continue with Google', then run the bridge bookmarklet on that tab.");
    setStatus("bridging");
  };

  const copyBridge = async () => {
    const bookmarklet = buildZaiWebBookmarklet({
      importUrl: `${window.location.origin}${IMPORT_PATH}`,
    });
    try {
      await navigator.clipboard.writeText(bookmarklet);
      setBridgeCopied(true);
      toast.success("Bridge bookmarklet copied. Add it as a bookmark, then click it while on chat.z.ai.");
    } catch {
      toast.error("Clipboard unavailable — copy failed.");
    }
  };

  const testConnection = async () => {
    const { zaiWebSessionAdapter } = await import("@/lib/ai/providers/zai-web-adapter");
    const result = await zaiWebSessionAdapter.testConnection({
      id: ZAI_WEB_PROVIDER_ID,
      name: "Z.ai Web",
      type: "zai-web",
    } as any);
    setValidationState(result.ok ? "connected" : validationState);
    setStatusMessage(result.message);
    if (result.ok) {
      setStatus("connected");
      updateProvider("p_zai_web", { isActive: true, status: "healthy" });
    } else {
      updateProvider("p_zai_web", { status: "degraded" });
    }
  };

  const syncModels = async () => {
    try {
      const { zaiWebSessionAdapter } = await import("@/lib/ai/providers/zai-web-adapter");
      const models = await zaiWebSessionAdapter.listModels({
        id: ZAI_WEB_PROVIDER_ID,
        name: "Z.ai Web",
        type: "zai-web",
        enabledModels: provider?.enabledModels ?? [],
      } as any);
      // Ownership: discovered models belong to Z.ai Web (p_zai_web) only —
      // never to the official Z.ai API integration or any other provider.
      updateProvider("p_zai_web", {
        enabledModels: models,
        isActive: true,
        modelName: provider?.modelName || models[0] || "",
      });
      toast.success(`Models synced: ${models.length} model(s) → provider: Z.ai Web (web-session integration)`);
    } catch (e: any) {
      toast.error(e?.message?.slice(0, 180) || "Z.ai Web model sync failed.");
    }
  };

  const disconnect = async () => {
    try {
      await fetch(IMPORT_PATH, { method: "DELETE" });
    } catch {
      /* server copy may not exist — still clear local state */
    }
    await forgetZaiWebSession({
      store: async () => ({ ok: true as const }),
      clear: async () => {},
    });
    updateProvider("p_zai_web", {
      enabledModels: [],
      isActive: false,
      status: "untested",
      modelName: "",
    });
    setStatus("idle");
    setValidationState(null);
    setStatusMessage("Z.ai Web session removed. Only the zai-web credential, model assignments and metadata were touched.");
    toast.success("Z.ai Web disconnected.");
  };

  const importFromClipboard = async () => {
    const token = pastedToken.trim();
    if (token.length < 16) {
      toast.error("Paste the session token copied by the bridge.");
      return;
    }
    const session: ZaiWebSession = { authenticated: true, token, source: "other" };
    rememberZaiWebSession(session);
    try {
      const res = await fetch(IMPORT_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          provider_id: ZAI_WEB_PROVIDER_ID,
          credential_type: "zai_web_session",
          token,
          source: "clipboard",
        }),
      });
      const data = (await res.json().catch(() => ({}))) as any;
      setValidationState(data?.state ?? null);
      setStatusMessage(data?.message || `Import result: HTTP ${res.status}.`);
      if (data?.validated) {
        setStatus("connected");
        updateProvider("p_zai_web", { isActive: true, status: "healthy" });
        toast.success("Z.ai web session validated — Z.ai Web connected.");
      } else {
        toast.warning(data?.message?.slice(0, 160) || "Session stored but not yet validated. Run Test Connection.");
      }
    } catch {
      toast.error("Import endpoint unreachable — the session stays memory-only on this device.");
    }
    setPastedToken("");
  };

  const connected = status === "connected";
  const session = recallZaiWebSession();

  return (
    <Card className="border-border/60">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon name="Globe" className="w-5 h-5 text-brand" />
            <span className="font-medium text-sm">Z.ai Web</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300 font-mono">
              web-session
            </span>
          </div>
          <span
            className={`w-2.5 h-2.5 rounded-full ${
              connected ? "bg-emerald-500" : status === "error" ? "bg-red-500" : "bg-muted-foreground/30"
            }`}
            aria-label={connected ? "Connected" : "Not connected"}
          />
        </div>

        <p className="text-xs text-muted-foreground">
          Use Z.ai through your authenticated chat.z.ai web session. Separate from the official Z.ai API — no API key, no Google credentials stored.
        </p>

        {connected ? (
          <div className="space-y-1 text-xs">
            <p className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
              <Icon name="CheckCircle2" className="w-3.5 h-3.5" /> Status: Connected
            </p>
            <p className="text-muted-foreground">Authentication: Google / Z.ai Web Session</p>
            <p className="text-muted-foreground">
              Session: {session?.token ? "Active" : "Active (server-stored)"}
              {validationState ? ` · Validation: ${validationState}` : ""}
            </p>
            <p className="text-muted-foreground">Models: {provider?.enabledModels?.length ?? 0} discovered</p>
          </div>
        ) : (
          <div className="space-y-1 text-xs text-muted-foreground">
            <p>Status: {status === "bridging" ? "Waiting for Z.ai session…" : "Not Connected"}</p>
            <p>Session: —</p>
            <p>Models: —</p>
          </div>
        )}

        {statusMessage && (
          <p className="text-[11px] text-muted-foreground bg-muted/50 rounded-md p-2" role="status">
            {statusMessage}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={openZai} className="gap-1.5">
            <Icon name="LogIn" className="w-3.5 h-3.5" /> Open Z.ai (Login with Google)
          </Button>
          <Button variant="outline" size="sm" onClick={copyBridge} className="gap-1.5">
            <Icon name={bridgeCopied ? "Check" : "Bookmark"} className="w-3.5 h-3.5" />
            {bridgeCopied ? "Bridge copied" : "Copy Z.ai → ATS bridge"}
          </Button>
          {connected && (
            <>
              <Button variant="outline" size="sm" onClick={syncModels} className="gap-1.5">
                <Icon name="RefreshCw" className="w-3.5 h-3.5" /> Sync Models
              </Button>
              <Button variant="outline" size="sm" onClick={testConnection} className="gap-1.5">
                <Icon name="PlugZap" className="w-3.5 h-3.5" /> Test Connection
              </Button>
              <Button variant="ghost" size="sm" onClick={disconnect} className="gap-1.5 text-destructive hover:text-destructive">
                <Icon name="LogOut" className="w-3.5 h-3.5" /> Disconnect
              </Button>
            </>
          )}
        </div>

        <div className="text-[11px] text-muted-foreground space-y-1">
          <p>
            1. Open Z.ai → 2. Continue with Google → 3. click the bridge bookmark on the chat.z.ai tab. The bridge runs
            on chat.z.ai itself and transfers only your Z.ai session — Google credentials are never requested or stored.
          </p>
          <button
            type="button"
            className="underline underline-offset-2 hover:text-foreground"
            onClick={() => setShowFallback((v) => !v)}
          >
            {showFallback ? "Hide clipboard fallback" : "Clipboard fallback (if the bridge can't reach ATS Pro)"}
          </button>
          {showFallback && (
            <div className="flex gap-1.5 pt-1">
              <input
                type="password"
                value={pastedToken}
                onChange={(e) => setPastedToken(e.target.value)}
                placeholder="Paste the session token copied by the bridge"
                className="flex-1 h-8 text-xs rounded-md border bg-background px-2"
                autoComplete="off"
              />
              <Button size="sm" variant="secondary" onClick={importFromClipboard}>
                Import
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
