#!/usr/bin/env node
/**
 * Vercel build prebuild hook — platform-divergent runtime for /r/[id].
 *
 * WHY: the /r/[id] share page is a fully client-rendered page whose edge SSR
 * bundle measures ~1.5MB (the App Router client-reference graph pulls the
 * whole store + A4 renderer server-side). That exceeds Vercel Hobby's 1MB
 * Edge Function cap. Cloudflare Pages (next-on-pages) requires the route to
 * be `runtime = "edge"` AND has no such size limit. Next.js only accepts a
 * string literal for route segment config (a conditional export fails the
 * build), so the same source file must differ per platform:
 *
 *   - Vercel build (VERCEL=1 set by the platform, CI unset): this script
 *     rewrites the literal to "nodejs" BEFORE `next build` → the route ships
 *     as a Node serverless function (no size cap).
 *   - Everywhere else — GitHub Actions CI (CI=true), next-on-pages builds,
 *     local dev — the file is left untouched (edge).
 *
 * Wired via vercel.json "buildCommand":
 *   "node scripts/vercel-prebuild.mjs && next build"
 * Idempotent and safe to run repeatedly.
 */
import { readFileSync, writeFileSync } from "node:fs";

const FILE = new URL("../src/app/r/[id]/page.tsx", import.meta.url);
const EDGE = 'export const runtime = "edge";';
const NODE = 'export const runtime = "nodejs";';

const onVercelBuild = process.env.VERCEL === "1" && process.env.CI !== "true";

if (!onVercelBuild) {
  console.log("[vercel-prebuild] not a Vercel platform build (or CI) — no source changes, runtime stays 'edge'");
  process.exit(0);
}

let src = readFileSync(FILE, "utf8");
if (src.includes(NODE)) {
  console.log("[vercel-prebuild] /r/[id] already patched to 'nodejs' — nothing to do");
  process.exit(0);
}
if (!src.includes(EDGE)) {
  console.error(`[vercel-prebuild] expected literal not found in ${FILE} — page structure changed?`);
  process.exit(1);
}
writeFileSync(FILE, src.replace(EDGE, NODE));
console.log("[vercel-prebuild] VERCEL=1 build: /r/[id] runtime patched edge -> nodejs (1MB edge cap workaround)");
