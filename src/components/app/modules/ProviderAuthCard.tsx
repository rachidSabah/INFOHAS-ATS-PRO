// ResumeAI Pro — Provider Auth Card
// UI component for Puter.js and Z.ai Direct OAuth authentication.
// Shows connection status, account info, models, session expiry,
// and provides Login/Refresh/Disconnect actions.
// Supports both Google OAuth and API Key authentication for Z.ai.

"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge, Icon } from "@/components/shared";
import { toast } from "sonner";
import type { ProviderAuthStatus } from "@/lib/providers/interface";

interface ProviderAuthCardProps {
  /** Provider identifier */
  providerId: "puter" | "zai-direct";
  /** Display name */
  providerName: string;
  /** Icon name from lucide-react */
  iconName: string;
  /** Brand color for accents */
  brandColor: string;
  /** Description text */
  description: string;
  /** Available models when connected */
  models: string[];
  /** Current auth status */
  status: ProviderAuthStatus;
  /** Sign in handler */
  onLogin: () => Promise<void>;
  /** Google OAuth sign-in handler (optional, only for Z.ai) */
  onLoginWithGoogle?: () => Promise<void>;
  /** Complete Google login with API key handler */
  onCompleteGoogleLogin?: (apiKey: string) => Promise<void>;
  /** Get pending Google user info */
  pendingGoogleUser?: { email: string; sub: string; picture?: string } | null;
  /** Clear pending Google user */
  onClearPendingGoogleUser?: () => void;
  /** Refresh session handler */
  onRefresh: () => Promise<void>;
  /** Disconnect handler */
  onLogout: () => Promise<void>;
  /** Toggle shared admin account */
  onToggleShared?: (enabled: boolean) => Promise<void>;
}

export function ProviderAuthCard({
  providerId,
  providerName,
  iconName,
  brandColor,
  description,
  models,
  status,
  onLogin,
  onLoginWithGoogle,
  onCompleteGoogleLogin,
  pendingGoogleUser,
  onClearPendingGoogleUser,
  onRefresh,
  onLogout,
  onToggleShared,
}: ProviderAuthCardProps) {
  const [loading, setLoading] = useState<string | null>(null);
  const [googleApiKeyInput, setGoogleApiKeyInput] = useState("");
  const [showGoogleKeyPrompt, setShowGoogleKeyPrompt] = useState(false);

  // Show the Google API key prompt when there's a pending Google user
  useEffect(() => {
    if (pendingGoogleUser && !status.authenticated) {
      setShowGoogleKeyPrompt(true);
    }
  }, [pendingGoogleUser, status.authenticated]);

  const handleLogin = useCallback(async () => {
    setLoading("login");
    try {
      await onLogin();
      toast.success(`${providerName} connected successfully!`);
    } catch (e: any) {
      // Check if this is the special "Google auth succeeded, need API key" error
      if (e?.message?.startsWith("GOOGLE_AUTH_SUCCESS_NEED_API_KEY:")) {
        toast.info("Google sign-in successful! Now paste your Z.ai API key to complete the connection.", { duration: 6000 });
      } else {
        toast.error(e?.message || `Failed to connect ${providerName}`);
      }
    } finally {
      setLoading(null);
    }
  }, [onLogin, providerName]);

  const handleGoogleLogin = useCallback(async () => {
    if (!onLoginWithGoogle) return;
    setLoading("google");
    try {
      await onLoginWithGoogle();
      toast.success(`${providerName} connected via Google!`);
    } catch (e: any) {
      // Check if this is the special "need API key" error
      if (e?.message?.startsWith("GOOGLE_AUTH_SUCCESS_NEED_API_KEY:")) {
        toast.info("Google sign-in successful! Now paste your Z.ai API key below to complete the connection.", { duration: 8000 });
      } else {
        toast.error(e?.message || `Failed to sign in with Google for ${providerName}`);
      }
    } finally {
      setLoading(null);
    }
  }, [onLoginWithGoogle, providerName]);

  const handleCompleteGoogleLogin = useCallback(async () => {
    if (!onCompleteGoogleLogin || !googleApiKeyInput.trim()) {
      toast.error("Please paste your Z.ai API key.");
      return;
    }
    setLoading("google-complete");
    try {
      await onCompleteGoogleLogin(googleApiKeyInput.trim());
      toast.success(`${providerName} connected via Google OAuth! Your API key is now linked to your Google account for future auto-login.`);
      setGoogleApiKeyInput("");
      setShowGoogleKeyPrompt(false);
    } catch (e: any) {
      toast.error(e?.message || "Failed to connect Z.ai with Google.");
    } finally {
      setLoading(null);
    }
  }, [onCompleteGoogleLogin, googleApiKeyInput, providerName]);

  const handleRefresh = useCallback(async () => {
    setLoading("refresh");
    try {
      await onRefresh();
      toast.success(`${providerName} session refreshed.`);
    } catch (e: any) {
      toast.error(e?.message || `Failed to refresh ${providerName} session.`);
    } finally {
      setLoading(null);
    }
  }, [onRefresh, providerName]);

  const handleLogout = useCallback(async () => {
    if (!confirm(`Disconnect ${providerName}? You will need to sign in again to use it.`)) return;
    setLoading("logout");
    try {
      await onLogout();
      toast.success(`${providerName} disconnected.`);
      setShowGoogleKeyPrompt(false);
    } catch (e: any) {
      toast.error(e?.message || `Failed to disconnect ${providerName}.`);
    } finally {
      setLoading(null);
    }
  }, [onLogout, providerName]);

  const isConnected = status.connected && status.authenticated;
  const isExpired = status.expiresAt ? Date.now() >= status.expiresAt : false;
  const isExpiringSoon = status.expiresAt
    ? !isExpired && Date.now() >= status.expiresAt - 5 * 60 * 1000
    : false;

  // Format expiry time
  const expiryText = status.expiresAt
    ? new Date(status.expiresAt).toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

  // Time until expiry
  const timeUntilExpiry = status.expiresAt
    ? (() => {
        const diff = status.expiresAt - Date.now();
        if (diff <= 0) return "Expired";
        if (diff < 60 * 1000) return `${Math.floor(diff / 1000)}s`;
        if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60 / 1000)}m`;
        if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 60 / 60 / 1000)}h`;
        return `${Math.floor(diff / 24 / 60 / 60 / 1000)}d`;
      })()
    : null;

  return (
    <Card className={`overflow-hidden border-2 transition-colors ${isConnected ? "border-green-500/30" : "border-border"}`}>
      {/* Top accent bar */}
      <div className="h-1" style={{ background: isConnected ? "#10B981" : brandColor }} />

      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
              style={{ background: `${brandColor}15`, color: brandColor }}
            >
              <Icon name={iconName} className="w-5 h-5" />
            </div>
            <div>
              <div className="font-display">{providerName}</div>
              <div className="text-xs font-normal text-muted-foreground">{description}</div>
            </div>
          </CardTitle>
          <div className="flex items-center gap-2">
            {/* Auth method badge */}
            {isConnected && status.authMethod && (
              <Badge variant="outline" className="text-[9px] gap-1">
                <Icon name={status.authMethod === "google_oauth" ? "Shield" : "Key"} className="w-2.5 h-2.5" />
                {status.authMethod === "google_oauth" ? "Google" : status.authMethod === "puter_oauth" ? "OAuth" : "API Key"}
              </Badge>
            )}
            {/* Status indicator */}
            <div className="flex items-center gap-1.5">
              <div
                className={`w-2.5 h-2.5 rounded-full ${
                  isConnected && !isExpired
                    ? "bg-green-500 shadow-[0_0_6px_rgba(16,185,129,0.5)]"
                    : isExpired
                      ? "bg-amber-500"
                      : "bg-muted-foreground/30"
                }`}
              />
              <span className="text-xs font-medium">
                {!isConnected ? "Not Connected" : isExpired ? "Session Expired" : isExpiringSoon ? "Expiring Soon" : "Connected"}
              </span>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pt-0">
        {/* Account info (when connected) */}
        {isConnected && (
          <div className="space-y-3">
            {/* Account email + Google avatar */}
            <div className="flex items-center gap-2 text-sm">
              {status.googlePicture ? (
                <img src={status.googlePicture} alt="" className="w-4 h-4 rounded-full" referrerPolicy="no-referrer" />
              ) : (
                <Icon name="User" className="w-4 h-4 text-muted-foreground" />
              )}
              <span className="text-muted-foreground">Account:</span>
              <span className="font-medium">{status.email || "Connected"}</span>
            </div>

            {/* Session expiry */}
            {expiryText && (
              <div className="flex items-center gap-2 text-sm">
                <Icon name="Clock" className="w-4 h-4 text-muted-foreground" />
                <span className="text-muted-foreground">Session expires:</span>
                <span className={`font-medium ${isExpired ? "text-red-500" : isExpiringSoon ? "text-amber-500" : ""}`}>
                  {expiryText}
                  {timeUntilExpiry && !isExpired && (
                    <span className="text-muted-foreground font-normal ml-1">({timeUntilExpiry} remaining)</span>
                  )}
                </span>
              </div>
            )}

            {/* Available models */}
            {models.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-sm">
                  <Icon name="Layers" className="w-4 h-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Available models:</span>
                </div>
                <div className="flex flex-wrap gap-1.5 ml-6">
                  {models.slice(0, 6).map((m) => (
                    <Badge key={m} variant="outline" className="text-[10px] font-mono">
                      {m}
                    </Badge>
                  ))}
                  {models.length > 6 && (
                    <Badge variant="outline" className="text-[10px]">
                      +{models.length - 6} more
                    </Badge>
                  )}
                </div>
              </div>
            )}

            {/* Shared admin account toggle */}
            {onToggleShared && (
              <div className="flex items-center gap-3 pt-1 border-t border-border">
                <Switch
                  id={`shared-${providerId}`}
                  checked={status.sharedAdminAccount}
                  onCheckedChange={async (checked) => {
                    try {
                      await onToggleShared(checked);
                      toast.success(checked ? "Shared admin account enabled." : "Shared admin account disabled.");
                    } catch {
                      toast.error("Failed to toggle shared account mode.");
                    }
                  }}
                />
                <label htmlFor={`shared-${providerId}`} className="text-xs text-muted-foreground cursor-pointer leading-tight">
                  Use this account for all users
                  <span className="block text-[10px] text-muted-foreground/70 mt-0.5">
                    When enabled, all optimization requests use this authenticated session
                  </span>
                </label>
              </div>
            )}
          </div>
        )}

        {/* Not connected state */}
        {!isConnected && !showGoogleKeyPrompt && (
          <div className="py-4 text-center">
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-3"
              style={{ background: `${brandColor}08` }}
            >
              <Icon name={iconName} className="w-8 h-8" style={{ color: `${brandColor}40` }} />
            </div>
            <p className="text-sm text-muted-foreground mb-1">
              {providerName} is not connected
            </p>
            <p className="text-xs text-muted-foreground/70">
              Sign in to use {providerName} as an AI provider for optimizations
            </p>
          </div>
        )}

        {/* Google OAuth API key prompt — shown after Google auth succeeds but before API key is linked */}
        {showGoogleKeyPrompt && pendingGoogleUser && (
          <div className="p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800 space-y-3">
            <div className="flex items-center gap-2">
              {pendingGoogleUser.picture ? (
                <img src={pendingGoogleUser.picture} alt="" className="w-6 h-6 rounded-full" referrerPolicy="no-referrer" />
              ) : (
                <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center">
                  <Icon name="Check" className="w-3.5 h-3.5 text-white" />
                </div>
              )}
              <div>
                <p className="text-xs font-medium text-green-700 dark:text-green-400">
                  Signed in as {pendingGoogleUser.email}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  Now paste your Z.ai API key to complete the connection
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Input
                type="password"
                placeholder="Paste your Z.ai API key..."
                value={googleApiKeyInput}
                onChange={(e) => setGoogleApiKeyInput(e.target.value)}
                className="h-8 text-xs font-mono"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && googleApiKeyInput.trim()) {
                    handleCompleteGoogleLogin();
                  }
                }}
              />
              <Button
                size="sm"
                className="h-8 gap-1.5 shrink-0"
                style={{ background: "#1154A3" }}
                disabled={loading !== null || !googleApiKeyInput.trim()}
                onClick={handleCompleteGoogleLogin}
              >
                {loading === "google-complete" ? (
                  <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                ) : (
                  <Icon name="Plug" className="w-3.5 h-3.5" />
                )}
                Link
              </Button>
            </div>
            <p className="text-[9px] text-muted-foreground">
              Your API key will be linked to your Google account. Next time you sign in with Google, you won&apos;t need to enter it again.
            </p>
            <button
              className="text-[10px] text-muted-foreground hover:text-foreground underline"
              onClick={() => {
                setShowGoogleKeyPrompt(false);
                setGoogleApiKeyInput("");
                onClearPendingGoogleUser?.();
              }}
            >
              Cancel
            </button>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex gap-2 pt-2 border-t border-border">
          {!isConnected && !showGoogleKeyPrompt ? (
            <>
              {/* Google OAuth button (for Z.ai) — always show, disabled with setup hint if not configured */}
              {providerId === "zai-direct" && (
                <Button
                  onClick={onLoginWithGoogle ? handleGoogleLogin : undefined}
                  disabled={loading !== null || !onLoginWithGoogle}
                  className="gap-2 flex-1 bg-white hover:bg-gray-50 text-gray-700 border border-gray-300 shadow-sm dark:bg-gray-800 dark:hover:bg-gray-700 dark:text-gray-200 dark:border-gray-600 disabled:opacity-70 disabled:cursor-not-allowed"
                  title={!onLoginWithGoogle ? "Set NEXT_PUBLIC_GOOGLE_CLIENT_ID in .env to enable Google sign-in" : undefined}
                >
                  {loading === "google" ? (
                    <>
                      <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                      Connecting…
                    </>
                  ) : (
                    <>
                      {/* Google "G" logo */}
                      <svg className="w-4 h-4" viewBox="0 0 24 24">
                        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
                        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
                        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
                      </svg>
                      {onLoginWithGoogle ? "Sign in with Google" : "Google (Setup Required)"}
                    </>
                  )}
                </Button>
              )}
              {/* API Key button (fallback) */}
              <Button
                onClick={handleLogin}
                disabled={loading !== null}
                className={`gap-2 ${onLoginWithGoogle ? "" : "flex-1"}`}
                variant={onLoginWithGoogle ? "outline" : "default"}
                style={!onLoginWithGoogle ? { background: brandColor, borderColor: brandColor } : undefined}
              >
                {loading === "login" ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Connecting…
                  </>
                ) : (
                  <>
                    <Icon name="Key" className="w-4 h-4" />
                    API Key
                  </>
                )}
              </Button>
            </>
          ) : isConnected ? (
            <>
              <Button
                variant="outline"
                onClick={handleRefresh}
                disabled={loading !== null}
                className="gap-1.5"
                size="sm"
              >
                {loading === "refresh" ? (
                  <div className="w-3.5 h-3.5 border-2 border-muted-foreground/30 border-t-muted-foreground rounded-full animate-spin" />
                ) : (
                  <Icon name="RefreshCw" className="w-3.5 h-3.5" />
                )}
                Refresh Session
              </Button>
              <Button
                variant="outline"
                onClick={handleLogout}
                disabled={loading !== null}
                className="gap-1.5 text-red-600 hover:text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
                size="sm"
              >
                {loading === "logout" ? (
                  <div className="w-3.5 h-3.5 border-2 border-red-300 border-t-red-500 rounded-full animate-spin" />
                ) : (
                  <Icon name="LogOut" className="w-3.5 h-3.5" />
                )}
                Disconnect
              </Button>
            </>
          ) : null}

        {/* Auth required warning when expired */}
        {isConnected && isExpired && (
          <div className="flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950/20 rounded-lg border border-amber-200 dark:border-amber-800">
            <Icon name="AlertTriangle" className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-medium text-amber-700 dark:text-amber-400">Session expired</p>
              <p className="text-[11px] text-amber-600/80 dark:text-amber-500/80">
                Your {providerName} session has expired. Click "Refresh Session" to reconnect, or "Disconnect" and sign in again.
              </p>
            </div>
          </div>
        )}
      </div>
      </CardContent>
    </Card>
  );
}
