"use client";

import { useEffect } from "react";
import { useApp } from "@/lib/store";
import { LandingPage } from "@/components/landing/LandingPage";
import { AppShell } from "@/components/app/AppShell";
import { AuthModal } from "@/components/app/AuthModal";

export default function Home() {
  const view = useApp((s) => s.view);
  const isAuthed = useApp((s) => s.isAuthed);
  const theme = useApp((s) => s.theme);
  const authOpen = useApp((s) => s.authOpen);
  const openAuth = useApp((s) => s.openAuth);
  const reconcileRole = useApp((s) => s.reconcileRole);

  // Apply theme class
  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.classList.toggle("dark", theme === "dark");
    }
  }, [theme]);

  // On mount: reconcile the signed-in user's role against the email allowlist.
  // This downgrades any stale super_admin sessions that were created before the
  // email-based access control was enforced.
  useEffect(() => {
    reconcileRole();
  }, [reconcileRole]);

  // If authed but stuck on landing view (e.g. after reload), go to dashboard
  const setView = useApp((s) => s.setView);
  useEffect(() => {
    if (isAuthed && view === "landing") {
      setView("dashboard");
    }
  }, [isAuthed, view, setView]);

  // Open auth modal automatically when user clicks a CTA that set view != landing without being authed
  useEffect(() => {
    if (!isAuthed && view !== "landing" && !authOpen) {
      openAuth();
    }
  }, [isAuthed, view, authOpen, openAuth]);

  const showLanding = !isAuthed || view === "landing";

  return (
    <>
      {showLanding ? <LandingPage /> : <AppShell />}
      <AuthModal />
    </>
  );
}
