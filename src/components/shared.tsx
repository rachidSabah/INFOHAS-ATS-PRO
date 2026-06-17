// Shared UI primitives & helpers for ResumeAI Pro
"use client";

import * as React from "react";
import * as Lucide from "lucide-react";
import { cn } from "@/lib/utils";

/** Render a lucide icon by name (string). Falls back to a circle. */
export function Icon({ name, className, ...props }: { name: string } & React.ComponentProps<typeof Lucide.Circle>) {
  const C = (Lucide as any)[name] as React.ComponentType<any> | undefined;
  const Comp = C ?? Lucide.Circle;
  return <Comp className={className} {...props} />;
}

export function Logo({ size = 32, withText = true, className }: { size?: number; withText?: boolean; className?: string }) {
  return (
    <div className={cn("flex items-center gap-2.5 select-none", className)}>
      <div
        className="relative rounded-xl overflow-hidden shadow-sm"
        style={{ width: size, height: size }}
        aria-hidden
      >
        <img src="/brand/logo.png" alt="" width={size} height={size} className="w-full h-full object-cover" />
      </div>
      {withText && (
        <div className="leading-none">
          <span className="font-display font-extrabold tracking-tight text-[1.05em] text-foreground">
            Resume<span className="gradient-text">AI</span>
          </span>
          <span className="ml-1 font-display font-bold text-[0.7em] text-gold">PRO</span>
        </div>
      )}
    </div>
  );
}

export function Badge({ children, variant = "default", className }: { children: React.ReactNode; variant?: "default" | "brand" | "gold" | "outline" | "success" | "warning" | "danger"; className?: string }) {
  const variants: Record<string, string> = {
    default: "bg-secondary text-secondary-foreground",
    brand: "bg-brand-light text-brand dark:bg-brand/15 dark:text-brand",
    gold: "bg-amber-100 text-amber-700 dark:bg-amber-400/10 dark:text-amber-300",
    outline: "border border-border text-foreground",
    success: "bg-emerald-100 text-emerald-700 dark:bg-emerald-400/10 dark:text-emerald-300",
    warning: "bg-orange-100 text-orange-700 dark:bg-orange-400/10 dark:text-orange-300",
    danger: "bg-red-100 text-red-700 dark:bg-red-400/10 dark:text-red-300",
  };
  return <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium", variants[variant], className)}>{children}</span>;
}

export function ScoreRing({ value, size = 120, stroke = 10, label }: { value: number; size?: number; stroke?: number; label?: string }) {
  const radius = (size - stroke) / 2;
  const circ = 2 * Math.PI * radius;
  const off = circ - (value / 100) * circ;
  const color = value >= 85 ? "#10B981" : value >= 70 ? "#1154A3" : value >= 50 ? "#F59E0B" : "#DC2626";
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" className="text-muted" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={circ} strokeDashoffset={off} strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.8s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold font-display" style={{ color }}>{value}</span>
        {label && <span className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>}
      </div>
    </div>
  );
}

export function SectionTitle({ eyebrow, title, subtitle, center = true }: { eyebrow?: string; title: React.ReactNode; subtitle?: string; center?: boolean }) {
  return (
    <div className={cn("flex flex-col gap-3 max-w-2xl", center && "mx-auto text-center items-center")}>
      {eyebrow && (
        <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-light text-brand text-xs font-semibold dark:bg-brand/15">
          {eyebrow}
        </span>
      )}
      <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-balance">{title}</h2>
      {subtitle && <p className="text-muted-foreground text-base sm:text-lg text-pretty">{subtitle}</p>}
    </div>
  );
}

export function Sparkles({ count = 12, className }: { count?: number; className?: string }) {
  const items = Array.from({ length: count });
  return (
    <div className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)} aria-hidden>
      {items.map((_, i) => (
        <span
          key={i}
          className="absolute rounded-full"
          style={{
            width: 2 + Math.random() * 3,
            height: 2 + Math.random() * 3,
            top: `${Math.random() * 100}%`,
            left: `${Math.random() * 100}%`,
            background: Math.random() > 0.5 ? "var(--brand)" : "var(--gold)",
            opacity: 0.4 + Math.random() * 0.4,
            animation: `float-up ${1 + Math.random() * 2}s ease-out ${Math.random() * 2}s both`,
          }}
        />
      ))}
    </div>
  );
}

export function StatPill({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-card border border-border shadow-card">
      <Icon name={icon} className="w-4 h-4 text-brand" />
      <div className="leading-none">
        <div className="text-sm font-semibold">{value}</div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}
