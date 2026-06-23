// ResumeAI Pro — Provider Auth Card
// UI component for Puter.js and Z.ai Direct OAuth authentication.
// Shows connection status, account info, models, session expiry,
// and provides Login/Refresh/Disconnect actions.

"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
  onRefresh,
  onLogout,
  onToggleShared,
}: ProviderAuthCardProps) {
  const [loading, setLoading] = useState<string | null>(null);

  const handleLogin = useCallback(async () => {
    setLoading("login");
    try {
      await onLogin();
      toast.success(`${providerName} connected successfully!`);
    } catch (e: any) {
      toast.error(e?.message || `Failed to connect ${providerName}`);
    } finally {
      setLoading(null);
    }
  }, [onLogin, providerName]);

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
            {/* Account email */}
            <div className="flex items-center gap-2 text-sm">
              <Icon name="User" className="w-4 h-4 text-muted-foreground" />
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
        {!isConnected && (
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

        {/* Action buttons */}
        <div className="flex gap-2 pt-2 border-t border-border">
          {!isConnected ? (
            <Button
              onClick={handleLogin}
              disabled={loading !== null}
              className="gap-2 flex-1"
              style={{ background: brandColor, borderColor: brandColor }}
            >
              {loading === "login" ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Connecting…
                </>
              ) : (
                <>
                  <Icon name="LogIn" className="w-4 h-4" />
                  Sign in with {providerId === "puter" ? "Google" : "API Key"}
                </>
              )}
            </Button>
          ) : (
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
          )}
        </div>

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
      </CardContent>
    </Card>
  );
}
