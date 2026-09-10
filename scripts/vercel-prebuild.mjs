#!/usr/bin/env node
/**
 * Vercel build prebuild hook — platform-divergent runtimes (edge on CF, node on Vercel).
 *
 * WHY TWO CLASSES OF PATCH:
 *
 * 1. /r/[id] — 1MB Edge bundle cap. The /r/[id] share page is a fully
 *    client-rendered page whose edge SSR bundle measures ~1.5MB (the App
 *    Router client-reference graph pulls the whole store + A4 renderer
 *    server-side). That exceeds Vercel Hobby's 1MB Edge Function cap.
 *    Cloudflare Pages (next-on-pages) requires the route to be
 *    `runtime = "edge"` AND has no such size limit.
 *
 * 2. /api/providers/test + /api/providers/chat — 30s Edge wall-clock cap.
 *    Vercel Hobby Edge Functions die at ~30s wall clock and SILENTLY IGNORE
 *    the maxDuration export. Reasoning-route Zen models (nemotron-3-ultra-free
 *    answers in 8–33s+) and optimizer calls (timeoutMs up to 120000) blow
 *    through it → FUNCTION_INVOCATION_TIMEOUT (incident 2026-09-11). Node
 *    serverless functions (Fluid compute) honor maxDuration up to 300s on
 *    Hobby. On Cloudflare these routes MUST stay edge (next-on-pages).
 *
 * Next.js only accepts a string literal for route segment config (a
 * conditional export fails the build: "can't recognize the exported config
 * field"), so the same source files must differ per platform:
 *
 *   - Vercel build (VERCEL=1 set by the platform, CI unset): this script
 *     rewrites the literal to "nodejs" and injects `export const maxDuration`
 *     BEFORE `next build` → the routes ship as Node serverless functions.
 *   - Everywhere else — GitHub Actions CI (CI=true), next-on-pages builds,
 *     local dev — the files are left untouched (edge) → CF behavior unchanged.
 *
 * Wired via vercel.json "buildCommand":
 *   "node scripts/vercel-prebuild.mjs && next build"
 * Idempotent and safe to run repeatedly.
 */
import { readFileSync, writeFileSync } from "node:fs";

/** @type {{ label: string, file: URL, edge: string, node: string, maxDuration: string | null }[]} */
const PATCHES = [
  {
    label: "/r/[id] page (1MB edge bundle cap workaround)",
    file: new URL("../src/app/r/[id]/page.tsx", import.meta.url),
    edge: 'export const runtime = "edge";',
    node: 'export const runtime = "nodejs";',
    maxDuration: null,
  },
  {
    label: "/api/providers/test (Edge 30s wall-clock cap)",
    file: new URL("../src/app/api/providers/test/route.ts", import.meta.url),
    edge: 'export const runtime = "edge";',
    node: 'export const runtime = "nodejs";',
    maxDuration: "90", // test calls abort at ≤60s client-side; margin for proxy overhead
  },
  {
    label: "/api/providers/chat (Edge 30s wall-clock cap)",
    file: new URL("../src/app/api/providers/chat/route.ts", import.meta.url),
    edge: 'export const runtime = "edge";',
    node: 'export const runtime = "nodejs";',
    maxDuration: "150", // optimizer calls request up to 120s; matches the Zen relay cap
  },
];

const onVercelBuild = process.env.VERCEL === "1" && process.env.CI !== "true";

if (!onVercelBuild) {
  console.log("[vercel-prebuild] not a Vercel platform build (or CI) — no source changes, all runtimes stay 'edge'");
  process.exit(0);
}

let failures = 0;
for (const p of PATCHES) {
  const rel = p.file.pathname.split("/src/").pop();
  let src;
  try {
    src = readFileSync(p.file, "utf8");
  } catch {
    console.error(`[vercel-prebuild] cannot read ${rel} — file moved?`);
    failures++;
    continue;
  }
  if (src.includes(p.node)) {
    console.log(`[vercel-prebuild] ${rel} already patched to 'nodejs' — nothing to do`);
    continue;
  }
  if (!src.includes(p.edge)) {
    console.error(`[vercel-prebuild] expected literal not found in ${rel} — route structure changed?`);
    failures++;
    continue;
  }
  let out = src.replace(p.edge, p.node);
  if (p.maxDuration && !out.includes("export const maxDuration")) {
    out = out.replace(
      p.node,
      `${p.node}\n// Vercel-only (injected by scripts/vercel-prebuild.mjs): Edge functions ignore\n// maxDuration and die at 30s; Node (Fluid compute) honors it.\nexport const maxDuration = ${p.maxDuration};`
    );
  }
  writeFileSync(p.file, out);
  console.log(`[vercel-prebuild] VERCEL=1 build: ${rel} runtime patched edge -> nodejs${p.maxDuration ? ` + maxDuration=${p.maxDuration}` : ""}`);
}

if (failures > 0) {
  console.error(`[vercel-prebuild] ${failures} patch(es) failed — aborting build rather than deploying a regression`);
  process.exit(1);
}
