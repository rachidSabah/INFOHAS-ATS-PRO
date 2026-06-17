"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon, Logo } from "@/components/shared";
import { useApp, uid } from "@/lib/store";
import { toast } from "sonner";
import { BRAND, getRoleForEmail } from "@/lib/brand";
import type { User } from "@/lib/types";

export function AuthModal() {
  const open = useApp((s) => s.authOpen);
  const close = useApp((s) => s.closeAuth);
  const signIn = useApp((s) => s.signIn);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [loading, setLoading] = useState<string | null>(null);

  const handleOAuth = async (provider: "google" | "github" | "linkedin" | "puter") => {
    setLoading(provider);
    await new Promise((r) => setTimeout(r, 700));

    // For Puter.js: try to actually sign in via the global window.puter
    if (provider === "puter" && typeof window !== "undefined" && window.puter?.auth) {
      try {
        await window.puter.auth.signIn();
      } catch (e) {
        // Continue with mock even if Puter popup is closed
      }
    }

    const oauthEmail = `${provider}.user@example.com`;
    const user: User = {
      id: uid("u"),
      name: provider === "puter" ? "Puter User" : `${provider.charAt(0).toUpperCase() + provider.slice(1)} User`,
      email: oauthEmail,
      role: getRoleForEmail(oauthEmail),
      provider: provider === "puter" ? "puter" : provider === "google" ? "google" : provider === "github" ? "github" : "linkedin",
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      usage: { resumesGenerated: 0, atsChecks: 0, coverLetters: 0, interviewPreps: 0, downloads: 0 },
      status: "active",
    };
    setLoading(null);
    signIn(user);
    toast.success(`Signed in via ${provider === "puter" ? "Puter.js" : provider}. Welcome to ${BRAND.name}!`);
  };

  const handleEmail = async () => {
    if (!email || !/.+@.+\..+/.test(email)) {
      toast.error("Please enter a valid email.");
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
              {/* OAuth buttons */}
              <div className="grid grid-cols-2 gap-2">
                <Button variant="outline" onClick={() => handleOAuth("google")} disabled={!!loading} className="gap-2">
                  {loading === "google" ? <Icon name="Loader2" className="w-4 h-4 animate-spin" /> : <Icon name="Chrome" className="w-4 h-4" />} Google
                </Button>
                <Button variant="outline" onClick={() => handleOAuth("github")} disabled={!!loading} className="gap-2">
                  {loading === "github" ? <Icon name="Loader2" className="w-4 h-4 animate-spin" /> : <Icon name="Github" className="w-4 h-4" />} GitHub
                </Button>
                <Button variant="outline" onClick={() => handleOAuth("linkedin")} disabled={!!loading} className="gap-2">
                  {loading === "linkedin" ? <Icon name="Loader2" className="w-4 h-4 animate-spin" /> : <Icon name="Linkedin" className="w-4 h-4" />} LinkedIn
                </Button>
                <Button variant="outline" onClick={() => handleOAuth("puter")} disabled={!!loading} className="gap-2 border-brand text-brand hover:bg-brand-light">
                  {loading === "puter" ? <Icon name="Loader2" className="w-4 h-4 animate-spin" /> : <Icon name="Sparkles" className="w-4 h-4" />} Puter (free AI)
                </Button>
              </div>

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
