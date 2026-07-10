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

interface Particle {
  id: number;
  x: number;
  y: number;
  size: number;
  color: string;
}

export function ScoreRing({ value, size = 120, stroke = 10, label }: { value: number; size?: number; stroke?: number; label?: string }) {
  const [displayValue, setDisplayValue] = React.useState(0);
  const [particles, setParticles] = React.useState<Particle[]>([]);
  const prevValueRef = React.useRef(0);

  // Numeric count-up/down animation
  React.useEffect(() => {
    let start = displayValue;
    const end = value;
    if (start === end) return;
    
    // Trigger particle burst if score increased
    if (end > prevValueRef.current && prevValueRef.current > 0) {
      const colors = ["#10B981", "#3B82F6", "#F59E0B", "#8B5CF6", "#EC4899"];
      const newParticles = Array.from({ length: 14 }).map((_, i) => {
        const angle = (i / 14) * 2 * Math.PI + (Math.random() - 0.5) * 0.3;
        const distance = size / 2 + Math.random() * 20;
        return {
          id: Math.random() + i,
          x: Math.cos(angle) * distance,
          y: Math.sin(angle) * distance,
          size: 4 + Math.random() * 5,
          color: colors[Math.floor(Math.random() * colors.length)]
        };
      });
      setParticles(newParticles);
      setTimeout(() => setParticles([]), 800);
    }
    prevValueRef.current = end;

    const duration = 800; // ms
    const startTime = performance.now();

    let animId: number;
    const step = (now: number) => {
      const progress = Math.min((now - startTime) / duration, 1);
      // Ease out quad
      const easeProgress = progress * (2 - progress);
      const current = Math.round(start + (end - start) * easeProgress);
      setDisplayValue(current);

      if (progress < 1) {
        animId = requestAnimationFrame(step);
      }
    };
    animId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(animId);
  }, [value, size]);

  const radius = (size - stroke) / 2;
  const circ = 2 * Math.PI * radius;
  const off = circ - (displayValue / 100) * circ;
  const color = displayValue >= 85 ? "#10B981" : displayValue >= 70 ? "#1154A3" : displayValue >= 50 ? "#F59E0B" : "#DC2626";

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <style>{`
        @keyframes particle-fly-fade {
          0% {
            transform: translate(0px, 0px) scale(1);
            opacity: 1;
          }
          100% {
            opacity: 0;
            transform: translate(var(--x, 0px), var(--y, 0px)) scale(0.2);
          }
        }
      `}</style>
      
      {/* Particle Burst Overlay */}
      {particles.map((p) => (
        <span
          key={p.id}
          className="absolute rounded-full pointer-events-none"
          style={{
            width: p.size,
            height: p.size,
            backgroundColor: p.color,
            boxShadow: `0 0 8px ${p.color}`,
            "--x": `${p.x}px`,
            "--y": `${p.y}px`,
            animation: "particle-fly-fade 0.8s forwards cubic-bezier(0.1, 0.8, 0.3, 1)",
            zIndex: 10
          } as React.CSSProperties}
        />
      ))}

      {/* SVG score circle */}
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="currentColor" className="text-muted/20" strokeWidth={stroke} />
        <circle
          cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={circ} strokeDashoffset={off} strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.1s ease" }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-2xl font-bold font-display" style={{ color }}>{displayValue}</span>
        {label && <span className="text-[9px] uppercase tracking-wide text-muted-foreground font-semibold">{label}</span>}
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

/**
 * Deterministic seeded pseudo-random generator.
 * Same seed → same sequence, so server and client produce identical output
 * (no React hydration mismatch). Uses a simple mulberry32 algorithm.
 */
function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function Sparkles({ count = 12, className }: { count?: number; className?: string }) {
  // Generate sparkle properties deterministically (seeded by index) so the server
  // and client produce identical HTML — avoids React hydration mismatches.
  // We use a fixed seed so the layout is stable across reloads too.
  const items = React.useMemo(() => {
    const rand = seededRandom(42); // fixed seed for stable output
    return Array.from({ length: count }).map(() => {
      const sizeRoll = rand();
      const topRoll = rand();
      const leftRoll = rand();
      const colorRoll = rand();
      const opacityRoll = rand();
      const durRoll = rand();
      const delayRoll = rand();
      return {
        width: 2 + sizeRoll * 3,
        height: 2 + sizeRoll * 3, // use same roll for w/h so sparkles are round
        top: `${topRoll * 100}%`,
        left: `${leftRoll * 100}%`,
        background: colorRoll > 0.5 ? "var(--brand)" : "var(--gold)",
        opacity: 0.4 + opacityRoll * 0.4,
        animation: `float-up ${1 + durRoll * 2}s ease-out ${delayRoll * 2}s both`,
      };
    });
  }, [count]);

  return (
    <div className={cn("pointer-events-none absolute inset-0 overflow-hidden", className)} aria-hidden>
      {items.map((s, i) => (
        <span
          key={i}
          className="absolute rounded-full"
          style={s}
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

export { AICopilotPanel } from "./shared/AICopilotPanel";
