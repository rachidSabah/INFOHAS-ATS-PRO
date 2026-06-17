"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Icon, Logo } from "@/components/shared";
import { useApp, uid } from "@/lib/store";
import { toast } from "sonner";
import { BRAND } from "@/lib/brand";
import { validateRealEmail } from "@/lib/email-validation";
import { validatePassword, passwordStrength } from "@/lib/auth-utils";
import type { User } from "@/lib/types";

export function AuthModal() {
  const open = useApp((s) => s.authOpen);
  const close = useApp((s) => s.closeAuth);
  const signIn = useApp((s) => s.signIn);
  const signInWithEmail = useApp((s) => s.signInWithEmail);
  const registerWithEmail = useApp((s) => s.registerWithEmail);
  const signInWithPuter = useApp((s) => s.signInWithPuter);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [username, setUsername] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState<string | null>(null);

  // === Puter.js sign in ===
  const handlePuter = async () => {
    setLoading("puter");
    const result = await signInWithPuter();
    if (!result.ok) {
      toast.error(result.error || "Puter sign-in failed.");
    } else if (result.user) {
      if (result.user.status === "pending") {
        toast.success("Signed in via Puter. Your account is awaiting admin approval.");
      } else {
        toast.success(`Welcome to ${BRAND.name}!`);
      }
    }
    setLoading(null);
  };

  // === Email sign in ===
  const handleEmailSignIn = async () => {
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
    await new Promise((r) => setTimeout(r, 400));
    const result = signInWithEmail(email, password);
    setLoading(null);
    if (!result.ok) {
      toast.error(result.error || "Sign in failed.");
    } else if (result.user) {
      if (result.user.status === "pending") {
        toast.success("Signed in. Your account is awaiting admin approval.");
      } else {
        toast.success(`Welcome back, ${result.user.name}!`);
      }
    }
  };

  // === Email registration ===
  const handleEmailSignUp = async () => {
    const emailCheck = validateRealEmail(email);
    if (!emailCheck.valid) {
      toast.error(emailCheck.error || "Please enter a valid email.");
      return;
    }
    const pwCheck = validatePassword(password);
    if (!pwCheck.valid) {
      toast.error(`Password requirements: ${pwCheck.errors.join(", ")}`);
      return;
    }
    if (name.trim().length < 2) {
      toast.error("Please enter your name.");
      return;
    }
    setLoading("email");
    await new Promise((r) => setTimeout(r, 400));
    const result = registerWithEmail(email, password, name, username);
    setLoading(null);
    if (!result.ok) {
      toast.error(result.error || "Registration failed.");
    } else if (result.user) {
      toast.success("Account created! Your account is pending admin approval. You'll be notified when approved.");
    }
  };

  const strength = passwordStrength(password);
  const strengthLabel = ["Too weak", "Weak", "Fair", "Good", "Strong"][strength];
  const strengthColor = ["#DC2626", "#DC2626", "#F59E0B", "#1154A3", "#10B981"][strength];

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
              {/* Continue with Puter */}
              <Button onClick={handlePuter} disabled={!!loading} className="w-full bg-brand hover:bg-brand-dark text-white gap-2 h-11">
                {loading === "puter" ? <Icon name="Loader2" className="w-4 h-4 animate-spin" /> : <Icon name="Sparkles" className="w-4 h-4" />}
                Continue with Puter (free AI)
              </Button>

              <div className="relative">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border" /></div>
                <div className="relative flex justify-center"><span className="px-2 bg-card text-xs text-muted-foreground">or with email</span></div>
              </div>

              {/* Email/Password form */}
              {mode === "signup" && (
                <div className="space-y-1.5">
                  <Label htmlFor="auth-name">Full name</Label>
                  <Input id="auth-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="John Doe" />
                </div>
              )}
              {mode === "signup" && (
                <div className="space-y-1.5">
                  <Label htmlFor="auth-username">Username (optional)</Label>
                  <Input id="auth-username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="johndoe" />
                </div>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="auth-email">Email</Label>
                <Input id="auth-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@gmail.com" onKeyDown={(e) => e.key === "Enter" && (mode === "signin" ? handleEmailSignIn() : handleEmailSignUp())} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="auth-pass">Password</Label>
                <div className="relative">
                  <Input
                    id="auth-pass"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder={mode === "signup" ? "Min 12 chars, Aa1!" : "••••••••"}
                    className="pr-9"
                    onKeyDown={(e) => e.key === "Enter" && (mode === "signin" ? handleEmailSignIn() : handleEmailSignUp())}
                  />
                  <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Toggle visibility">
                    <Icon name={showPassword ? "EyeOff" : "Eye"} className="w-4 h-4" />
                  </button>
                </div>
                {mode === "signup" && password && (
                  <div className="space-y-1">
                    <div className="flex gap-1">
                      {[0, 1, 2, 3, 4].map((i) => (
                        <div key={i} className="h-1.5 flex-1 rounded-full transition-all" style={{ background: i < strength ? strengthColor : "var(--muted)" }} />
                      ))}
                    </div>
                    <span className="text-[10px]" style={{ color: strengthColor }}>{strengthLabel}</span>
                  </div>
                )}
              </div>

              <Button
                onClick={mode === "signin" ? handleEmailSignIn : handleEmailSignUp}
                disabled={!!loading}
                className="w-full bg-brand hover:bg-brand-dark text-white gap-2"
              >
                {loading === "email" ? <Icon name="Loader2" className="w-4 h-4 animate-spin" /> : <Icon name="ArrowRight" className="w-4 h-4" />}
                {mode === "signin" ? "Sign in" : "Create account"}
              </Button>

              <p className="text-center text-xs text-muted-foreground">
                {mode === "signin" ? "New to ResumeAI Pro?" : "Already have an account?"}{" "}
                <button onClick={() => setMode(mode === "signin" ? "signup" : "signin")} className="text-brand font-medium hover:underline">
                  {mode === "signin" ? "Create an account" : "Sign in"}
                </button>
              </p>

              {mode === "signup" && (
                <p className="text-center text-[11px] text-muted-foreground">
                  New accounts require admin approval before accessing features.
                </p>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
