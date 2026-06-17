"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon, Logo } from "@/components/shared";
import { useApp, uid } from "@/lib/store";
import { toast } from "sonner";
import { BRAND, getRoleForEmail } from "@/lib/brand";
import { validateRealEmail } from "@/lib/email-validation";
import type { User } from "@/lib/types";

// Google Identity Services type
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: any) => void;
          prompt: (callback?: (notification: any) => void) => void;
          renderButton: (element: HTMLElement, config: any) => void;
          cancel: () => void;
        };
      };
    };
  }
}

// Decode a Google JWT credential to extract user info (module-level so it can be used in effects)
function decodeGoogleJwt(credential: string): { email: string; name: string; picture: string; email_verified: boolean } | null {
  try {
    const payload = credential.split(".")[1];
    const decoded = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return {
      email: decoded.email || "",
      name: decoded.name || decoded.given_name || "",
      picture: decoded.picture || "",
      email_verified: decoded.email_verified === true,
    };
  } catch {
    return null;
  }
}

interface GitHubDeviceState {
  userCode: string;
  verificationUri: string;
  deviceCode: string;
  interval: number;
}

export function AuthModal() {
  const open = useApp((s) => s.authOpen);
  const close = useApp((s) => s.closeAuth);
  const signIn = useApp((s) => s.signIn);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState<string | null>(null);
  const [githubDevice, setGithubDevice] = useState<GitHubDeviceState | null>(null);
  const githubPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const googleButtonRef = useRef<HTMLDivElement>(null);
  const googleInitializedRef = useRef(false);

  // Helper: sign in a user from OAuth profile data
  const signInFromOAuth = useCallback((provider: string, oauthEmail: string, oauthName: string, avatarUrl?: string) => {
    const emailCheck = validateRealEmail(oauthEmail);
    if (!emailCheck.valid) {
      toast.error(`OAuth returned an invalid email: ${oauthEmail}`);
      setLoading(null);
      return;
    }
    const user: User = {
      id: uid("u"),
      name: oauthName || oauthEmail.split("@")[0],
      email: oauthEmail,
      avatarUrl: avatarUrl || "",
      role: getRoleForEmail(oauthEmail),
      provider: provider as any,
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      usage: { resumesGenerated: 0, atsChecks: 0, coverLetters: 0, interviewPreps: 0, downloads: 0 },
      status: "active",
    };
    setLoading(null);
    signIn(user);
    const providerLabel = provider === "google" ? "Google" : provider === "github" ? "GitHub" : provider === "puter" ? "Puter.js" : provider;
    toast.success(`Signed in with ${providerLabel} as ${oauthEmail}. Welcome to ${BRAND.name}!`);
  }, [signIn]);

  // Listen for OAuth postMessage callbacks from popup windows (server-based OAuth flow)
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== "object") return;
      if (data.type === "OAUTH_SUCCESS" && data.email) {
        signInFromOAuth(data.provider, data.email, data.name, data.avatarUrl);
      } else if (data.type === "OAUTH_ERROR") {
        setLoading(null);
        toast.error(data.error || `${data.provider} sign-in failed.`);
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [signInFromOAuth]);

  // Cleanup GitHub polling on unmount
  useEffect(() => {
    return () => {
      if (githubPollRef.current) clearInterval(githubPollRef.current);
    };
  }, []);

  // === Google Identity Services — initialize when modal opens ===
  // This uses the browser's existing Google session. If the user is already
  // logged into Google, the One Tap prompt shows "Continue as [name]" automatically.
  // Also renders an inline Google Sign-In button that uses the same session.
  useEffect(() => {
    if (!open) return;

    const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || "";
    if (!googleClientId) return; // Google not configured

    // Wait for GIS script to load (it's async in layout.tsx)
    let cancelled = false;
    const initGoogle = () => {
      if (cancelled) return;
      if (typeof window === "undefined" || !window.google?.accounts?.id) {
        // GIS not loaded yet — retry in 200ms
        setTimeout(initGoogle, 200);
        return;
      }
      if (googleInitializedRef.current) {
        // Already initialized — just re-prompt
        window.google.accounts.id.prompt();
        return;
      }
      googleInitializedRef.current = true;

      // Initialize GIS with auto_select — if the user has exactly ONE Google account
      // logged in, they're signed in automatically (no click needed).
      // If they have multiple accounts, One Tap shows "Choose an account".
      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: (response: any) => {
          if (response.credential) {
            const userInfo = decodeGoogleJwt(response.credential);
            if (userInfo && userInfo.email && userInfo.email_verified) {
              signInFromOAuth("google", userInfo.email, userInfo.name, userInfo.picture);
            } else if (userInfo && !userInfo.email_verified) {
              toast.error("Your Google email is not verified. Please verify it and try again.");
              setLoading(null);
            } else {
              toast.error("Failed to decode Google credential.");
              setLoading(null);
            }
          } else {
            setLoading((c) => (c === "google" ? null : c));
          }
        },
        auto_select: true, // Auto-sign-in if user has one Google account logged in
        cancel_on_tap_outside: false,
        context: "use", // "use" context = "Continue as [name]" instead of "Sign in"
      });

      // Show the One Tap prompt — "Continue as [name]" for logged-in users
      window.google.accounts.id.prompt();

      // Render the inline Google button (replaces the manual button)
      if (googleButtonRef.current) {
        try {
          window.google.accounts.id.renderButton(googleButtonRef.current, {
            type: "standard",
            theme: "outline",
            size: "large",
            text: "continue_with",
            shape: "rectangular",
            width: 320,
            locale: "en",
          });
        } catch {
          // renderButton can fail if the element is not visible — ignore
        }
      }
    };

    initGoogle();
    return () => {
      cancelled = true;
    };
  }, [open, signInFromOAuth]);

  const handleOAuth = async (provider: "google" | "github" | "linkedin" | "puter") => {
    setLoading(provider);

    // === GOOGLE — handled by GIS on mount (One Tap + renderButton) ===
    // If the user clicks the Google area manually, re-trigger the One Tap prompt
    if (provider === "google") {
      if (typeof window !== "undefined" && window.google?.accounts?.id) {
        window.google.accounts.id.prompt();
      } else {
        // GIS not loaded — fall back to server OAuth popup
        const popup = window.open("/api/auth/google", "google-oauth", "width=500,height=650,scrollbars=yes");
        if (!popup) {
          toast.error("Google sign-in popup was blocked. Please allow popups and try again.");
          setLoading(null);
          return;
        }
        const checkClosed = setInterval(() => {
          if (popup.closed) {
            clearInterval(checkClosed);
            setLoading((c) => (c === "google" ? null : c));
          }
        }, 1000);
      }
      return;
    }

    // === GITHUB — Device Flow (client-side, no secret needed) ===
    // Uses /api/auth/github/device to get a device code, then polls /api/auth/github/device/poll
    if (provider === "github") {
      try {
        const res = await fetch("/api/auth/github/device", { method: "POST" });
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error || "GitHub sign-in is not configured.");
          setLoading(null);
          return;
        }
        // Show the user code to the user
        setGithubDevice({
          userCode: data.user_code,
          verificationUri: data.verification_uri,
          deviceCode: data.device_code,
          interval: data.interval || 5,
        });

        // Start polling
        const poll = async () => {
          try {
            const pollRes = await fetch("/api/auth/github/device/poll", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ device_code: data.device_code }),
            });
            const pollData = await pollRes.json();

            if (pollData.type === "OAUTH_SUCCESS" && pollData.email) {
              // Success — sign in
              if (githubPollRef.current) clearInterval(githubPollRef.current);
              setGithubDevice(null);
              signInFromOAuth("github", pollData.email, pollData.name, pollData.avatarUrl);
            } else if (pollData.error === "authorization_pending") {
              // Keep polling
            } else if (pollData.error === "slow_down") {
              // Increase interval and keep polling
              if (githubPollRef.current) {
                clearInterval(githubPollRef.current);
                githubPollRef.current = setInterval(poll, (pollData.interval || data.interval + 5) * 1000);
              }
            } else if (pollData.error === "expired_token") {
              if (githubPollRef.current) clearInterval(githubPollRef.current);
              setGithubDevice(null);
              setLoading(null);
              toast.error("GitHub device code expired. Please try again.");
            } else if (pollData.error === "access_denied") {
              if (githubPollRef.current) clearInterval(githubPollRef.current);
              setGithubDevice(null);
              setLoading(null);
              toast.error("GitHub authorization was denied.");
            } else if (pollData.error) {
              if (githubPollRef.current) clearInterval(githubPollRef.current);
              setGithubDevice(null);
              setLoading(null);
              toast.error(pollData.error);
            }
          } catch {
            // Network error — keep polling
          }
        };

        githubPollRef.current = setInterval(poll, (data.interval || 5) * 1000);
      } catch (e: any) {
        toast.error(e?.message || "GitHub sign-in failed.");
        setLoading(null);
      }
      return;
    }

    // === PUTER — real Puter.js sign-in ===
    if (provider === "puter") {
      let oauthEmail = "";
      let oauthName = "";

      if (typeof window !== "undefined" && window.puter?.auth) {
        try {
          await window.puter.auth.signIn();
          const puterUser = await window.puter.auth.getUser();
          oauthEmail = puterUser?.email || puterUser?.username || "";
          oauthName = puterUser?.username || puterUser?.name || "";
        } catch {
          // Popup closed or failed
        }
      }

      if (!oauthEmail) {
        setLoading(null);
        toast.error("Puter sign-in was cancelled or failed. Please try again.");
        return;
      }

      signInFromOAuth("puter", oauthEmail, oauthName);
      return;
    }

    // === LINKEDIN — not yet configured ===
    if (provider === "linkedin") {
      setLoading(null);
      toast.info("LinkedIn OAuth requires a LinkedIn Developer app. Use Google, GitHub, or email sign-in.");
      return;
    }
  };

  const handleEmail = async () => {
    const emailCheck = validateRealEmail(email);
    if (!emailCheck.valid) {
      toast.error(emailCheck.error || "Please enter a valid email.");
      return;
    }
    if (password.length < 4) {
      toast.error("Password must be at least 4 characters.");
      return;
    }
    setLoading("email");
    await new Promise((r) => setTimeout(r, 700));
    const user: User = {
      id: uid("u"),
      name: name || email.split("@")[0],
      email,
      role: getRoleForEmail(email),
      provider: "email",
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      usage: { resumesGenerated: 0, atsChecks: 0, coverLetters: 0, interviewPreps: 0, downloads: 0 },
      status: "active",
    };
    setLoading(null);
    signIn(user);
    toast.success(`Welcome to ${BRAND.name}!`);
  };

  const handleMagic = async () => {
    if (!email || !/.+@.+\..+/.test(email)) {
      toast.error("Enter your email first to receive a magic link.");
      return;
    }
    setLoading("magic");
    await new Promise((r) => setTimeout(r, 700));
    setLoading(null);
    toast.success(`Magic link sent to ${email}. (Demo: click 'Continue' below to sign in.)`);
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm"
          onClick={close}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ type: "spring", damping: 24, stiffness: 300 }}
            className="relative w-full max-w-md bg-card rounded-2xl border border-border shadow-premium overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            {/* Header band */}
            <div className="gradient-brand text-white p-6 relative">
              <button onClick={close} className="absolute top-4 right-4 w-8 h-8 rounded-full bg-white/15 hover:bg-white/25 flex items-center justify-center" aria-label="Close">
                <Icon name="X" className="w-4 h-4" />
              </button>
              <Logo size={36} className="[&_span]:text-white [&_.gradient-text]:text-white" />
              <h2 className="font-display text-xl font-bold mt-3">
                {mode === "signin" ? "Welcome back" : "Create your account"}
              </h2>
              <p className="text-sm text-white/80 mt-1">
                100% free forever. No credit card. No paywall.
              </p>
            </div>

            <div className="p-6 space-y-4">
              {/* Google Sign-In — GIS renders this button inline using the browser's Google session.
                  If the user is already logged into Google, One Tap shows "Continue as [name]" automatically. */}
              <div className="space-y-3">
                {/* GIS-rendered Google button — shows "Continue with Google" with the user's Google account */}
                <div className="flex justify-center min-h-[44px]">
                  <div ref={googleButtonRef} />
                </div>
                {/* Fallback manual button — shown only if GIS hasn't rendered yet or Google isn't configured */}
                {loading === "google" && (
                  <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                    <Icon name="Loader2" className="w-4 h-4 animate-spin" /> Connecting to Google…
                  </div>
                )}

                {/* Other OAuth providers */}
                <div className="grid grid-cols-3 gap-2">
                  <Button variant="outline" onClick={() => handleOAuth("github")} disabled={!!loading} className="gap-1.5 text-xs">
                    {loading === "github" ? <Icon name="Loader2" className="w-3.5 h-3.5 animate-spin" /> : <Icon name="Github" className="w-3.5 h-3.5" />} GitHub
                  </Button>
                  <Button variant="outline" onClick={() => handleOAuth("linkedin")} disabled={!!loading} className="gap-1.5 text-xs">
                    {loading === "linkedin" ? <Icon name="Loader2" className="w-3.5 h-3.5 animate-spin" /> : <Icon name="Linkedin" className="w-3.5 h-3.5" />} LinkedIn
                  </Button>
                  <Button variant="outline" onClick={() => handleOAuth("puter")} disabled={!!loading} className="gap-1.5 text-xs border-brand text-brand hover:bg-brand-light">
                    {loading === "puter" ? <Icon name="Loader2" className="w-3.5 h-3.5 animate-spin" /> : <Icon name="Sparkles" className="w-3.5 h-3.5" />} Puter
                  </Button>
                </div>
              </div>

              {/* GitHub Device Flow UI — shown when device code is requested */}
              {githubDevice && (
                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-lg border-2 border-brand/30 bg-brand-light/30 dark:bg-brand/5 p-4 text-center space-y-3"
                >
                  <div className="flex items-center justify-center gap-2 text-sm font-semibold">
                    <Icon name="Github" className="w-4 h-4" /> GitHub Device Authorization
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Enter this code on GitHub to authorize ResumeAI Pro:
                  </p>
                  <div className="text-2xl font-bold font-mono tracking-[0.3em] py-2 bg-card rounded-md border border-border select-all">
                    {githubDevice.userCode}
                  </div>
                  <a
                    href={githubDevice.verificationUri}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-sm text-brand font-medium hover:underline"
                  >
                    <Icon name="ExternalLink" className="w-3.5 h-3.5" />
                    Open {githubDevice.verificationUri}
                  </a>
                  <div className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                    <Icon name="Loader2" className="w-3 h-3 animate-spin" />
                    Waiting for authorization…
                  </div>
                  <button
                    onClick={() => {
                      if (githubPollRef.current) clearInterval(githubPollRef.current);
                      setGithubDevice(null);
                      setLoading(null);
                    }}
                    className="text-xs text-muted-foreground hover:text-destructive"
                  >
                    Cancel
                  </button>
                </motion.div>
              )}

              <div className="relative">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border" /></div>
                <div className="relative flex justify-center"><span className="px-2 bg-card text-xs text-muted-foreground">or continue with email</span></div>
              </div>

              {mode === "signup" && (
                <div className="space-y-1.5">
                  <Label htmlFor="auth-name">Full name</Label>
                  <Input id="auth-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Alex Morgan" />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="auth-email">Email</Label>
                <Input id="auth-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="auth-pass">Password</Label>
                <Input id="auth-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" onKeyDown={(e) => e.key === "Enter" && handleEmail()} />
              </div>

              <Button onClick={handleEmail} disabled={!!loading} className="w-full bg-brand hover:bg-brand-dark text-white gap-2">
                {loading === "email" ? <Icon name="Loader2" className="w-4 h-4 animate-spin" /> : <Icon name="ArrowRight" className="w-4 h-4" />}
                {mode === "signin" ? "Sign in" : "Create account"}
              </Button>

              <Button onClick={handleMagic} variant="ghost" disabled={!!loading} className="w-full text-xs gap-1.5">
                <Icon name="Mail" className="w-3.5 h-3.5" /> Send me a magic link instead
              </Button>

              <p className="text-center text-xs text-muted-foreground">
                {mode === "signin" ? "New to ResumeAI Pro?" : "Already have an account?"}{" "}
                <button onClick={() => setMode(mode === "signin" ? "signup" : "signin")} className="text-brand font-medium hover:underline">
                  {mode === "signin" ? "Create an account" : "Sign in"}
                </button>
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
