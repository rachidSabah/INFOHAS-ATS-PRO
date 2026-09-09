#!/usr/bin/env node
/**
 * Assemble desktop-resources/ for the Electron (Windows) packaging.
 *
 * Input  (produced by CI or a local build):
 *   .next/standalone/           — self-contained Node server (BUILD_STANDALONE=1 next build)
 *   .next/static/               — client bundles (not auto-copied by standalone output)
 *   public/                     — static assets
 *   prisma/desktop-template.db  — empty SQLite DB with the full schema
 *                                 (created via: DATABASE_URL=file:./prisma/desktop-template.db
 *                                  npx prisma db push --skip-generate)
 *
 * Output (consumed by electron-builder extraResources):
 *   desktop-resources/
 *     standalone/server.js + .next/static + public + node_modules
 *     template.db
 *
 * Cross-platform: pure node:fs — runs identically on ubuntu (CI lint) and
 * windows-latest (packaging runner).
 */
import { cpSync, rmSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const fail = (msg) => {
  console.error(`[prepare-standalone] FATAL: ${msg}`);
  process.exit(1);
};

const standaloneSrc = path.join(root, ".next", "standalone");
const staticSrc = path.join(root, ".next", "static");
const publicSrc = path.join(root, "public");
const templateSrc = path.join(root, "prisma", "desktop-template.db");

if (!existsSync(standaloneSrc)) {
  fail("missing .next/standalone — run with BUILD_STANDALONE=1: `npx next build`");
}
if (!existsSync(staticSrc)) fail("missing .next/static — build output incomplete");
if (!existsSync(publicSrc)) fail("missing public/ — checkout incomplete");
if (!existsSync(templateSrc)) {
  fail("missing prisma/desktop-template.db — run: DATABASE_URL=file:./prisma/desktop-template.db npx prisma db push --skip-generate");
}

const out = path.join(root, "desktop-resources");
rmSync(out, { recursive: true, force: true });
mkdirSync(path.join(out, "standalone", ".next"), { recursive: true });

console.log("[prepare-standalone] copying .next/standalone ...");
cpSync(standaloneSrc, path.join(out, "standalone"), { recursive: true });
console.log("[prepare-standalone] copying .next/static -> standalone/.next/static ...");
cpSync(staticSrc, path.join(out, "standalone", ".next", "static"), { recursive: true });
console.log("[prepare-standalone] copying public -> standalone/public ...");
cpSync(publicSrc, path.join(out, "standalone", "public"), { recursive: true });
console.log("[prepare-standalone] copying template.db ...");
copyFileSync(templateSrc, path.join(out, "template.db"));

console.log(`[prepare-standalone] OK -> ${out}`);
