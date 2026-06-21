"use client";

import { useEffect } from "react";
import { useApp } from "@/lib/store";
import { LandingPage } from "@/components/landing/LandingPage";
import { AppShell } from "@/components/app/AppShell";
import { AuthModal } from "@/components/app/AuthModal";
import { canAccessApp } from "@/lib/auth-utils";
import { syncAllFromCloud, migrateLocalStorageToCloud, setUserId } from "@/lib/cloud-api";
import { Icon } from "@/components/shared";
import { Button } from "@/components/ui/button";

export default function Home() {
  const view = useApp((s) => s.view);
  const isAuthed = useApp((s) => s.isAuthed);
  const theme = useApp((s) => s.theme);
  const authOpen = useApp((s) => s.authOpen);
  const openAuth = useApp((s) => s.openAuth);
  const user = useApp((s) => s.user);
  const signOut = useApp((s) => s.signOut);
  const setView = useApp((s) => s.setView);
  const synced = useApp((s) => s.synced);
  const needsRehydrate = useApp((s) => s._needsRehydrate);
  const rehydrateSession = useApp((s) => s.rehydrateSession);

  // === SSR-SAFE REHYDRATION ===
  // On the server and the first client render, the store has user=null and
  // view="landing" (matching the server HTML). After hydration, this effect
  // applies the restored user/theme/reports from localStorage so the user
  // stays logged in across refreshes — without triggering a React 19
  // hydration mismatch.
  useEffect(() => {
    if (needsRehydrate) {
      rehydrateSession();
    }
  }, [needsRehydrate, rehydrateSession]);

  // === V3.0.3: Restore pipeline snapshot on app load ===
  // After rehydration, restore the Supervisor's pipeline state from
  // localStorage so the user's in-progress optimization survives refresh,
  // logout/login, and browser crash. Any agent that was "running" when the
  // snapshot was taken is marked "pending" (since we can't resume an
  // in-flight AI call) — the user can re-trigger it.
  useEffect(() => {
    if (isAuthed) {
      import("@/lib/agents/supervisor").then(({ restoreFromSnapshot }) => {
        const restored = restoreFromSnapshot();
        if (restored) {
          console.info("[pipeline] Restored pipeline state from snapshot.");
        }
      }).catch(() => {});
    }
  }, [isAuthed]);

  // Apply theme class (runs after rehydrateSession sets the real theme)
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.classList.toggle("dark", theme === "dark");
    }
  }, [theme]);

  // Sync all data from D1 on app mount
  useEffect(() => {
    if (isAuthed && !synced && user) {
      setUserId(user.id); // Restore user ID for API calls (important after refresh)
      // Use .finally() so `synced` is set even if syncAllFromCloud rejects.
      // Otherwise a sync failure would leave `synced=false` forever, blocking
      // future sync attempts and leaving the user with stale seed data.
      syncAllFromCloud(useApp)
        .then(() => useApp.setState({ synced: true }))
        .catch((e) => {
          console.warn("[syncAllFromCloud] failed (non-fatal):", e);
          useApp.setState({ synced: true });
        });
      // Also migrate old localStorage data if present — guard against rejection
      migrateLocalStorageToCloud(useApp).catch((e) => console.warn("[migrateLocalStorageToCloud] failed (non-fatal):", e));
    }
  }, [isAuthed, synced, user]);

  // If authed but stuck on landing view, go to dashboard
  useEffect(() => {
    if (isAuthed && view === "landing") {
      setView("dashboard");
    }
  }, [isAuthed, view, setView]);

  // Open auth modal when user tries to access app without being authed
  useEffect(() => {
    if (!isAuthed && view !== "landing" && !authOpen) {
      openAuth();
    }
  }, [isAuthed, view, authOpen, openAuth]);

  const showLanding = !isAuthed || view === "landing";

  // Check if the signed-in user can access the app
  const accessCheck = canAccessApp(user);

  return (
    <>
      {showLanding ? (
        <LandingPage />
      ) : !accessCheck.allowed ? (
        // Approval gate — pending/suspended/deleted users see this instead of the app
        <ApprovalGate
          status={user?.status ?? "pending"}
          message={accessCheck.reason ?? "Access denied"}
          onSignOut={signOut}
        />
      ) : (
        <AppShell />
      )}
      <AuthModal />
    </>
  );
}

function ApprovalGate({ status, message, onSignOut }: { status: string; message: string; onSignOut: () => void }) {
  const icon = status === "pending" ? "Clock" : status === "suspended" ? "Ban" : "UserX";
  const color = status === "pending" ? "#F59E0B" : "#DC2626";
  const title = status === "pending" ? "Account Awaiting Approval" : status === "suspended" ? "Account Suspended" : "Account Unavailable";

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-background">
      <div className="max-w-md w-full bg-card rounded-2xl border border-border shadow-premium overflow-hidden">
        <div className="p-8 text-center">
          <div className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ background: `${color}15` }}>
            <Icon name={icon} className="w-8 h-8" style={{ color }} />
          </div>
          <h1 className="font-display text-xl font-bold mb-2">{title}</h1>
          <p className="text-sm text-muted-foreground mb-6 text-pretty">{message}</p>
          {status === "pending" && (
            <div className="rounded-lg bg-secondary/60 p-4 mb-6 text-left">
              <p className="text-xs font-semibold mb-2 flex items-center gap-1.5">
                <Icon name="Info" className="w-3.5 h-3.5 text-brand" /> What happens next?
              </p>
              <ul className="text-xs text-muted-foreground space-y-1">
                <li>• An administrator will review your account</li>
                <li>• You'll be able to access all features once approved</li>
                <li>• This usually takes less than 24 hours</li>
                <li>• You can sign out and check back later</li>
              </ul>
            </div>
          )}
          <Button onClick={onSignOut} variant="outline" className="gap-2">
            <Icon name="LogOut" className="w-4 h-4" /> Sign out
          </Button>
        </div>
      </div>
    </div>
  );
}
