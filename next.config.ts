import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // For Cloudflare Pages deployment, do NOT use "standalone" — next-on-pages handles output.
  // (next-on-pages wraps `vercel build` OFFLINE as a build tool only — no Vercel
  // account, project or hosting involved; the .vercel/output dir is its convention.)
  // For Docker deployment, change to "standalone".
  // Desktop (Electron/Windows) packaging opts in via BUILD_STANDALONE=1 so the
  // regular Pages CI build is completely unaffected.
  ...(process.env.BUILD_STANDALONE === "1" ? { output: "standalone" as const } : {}),
  typescript: {
    // Phase 9.0 (production hardening): type errors must FAIL the build.
    // The codebase is type-clean (tsc --noEmit passes), so this is safe and
    // prevents masked type regressions from shipping.
    ignoreBuildErrors: false,
  },
  reactStrictMode: false,
  // Cloudflare Pages requires these experimental flags
  experimental: {
    // next-on-pages needs this for proper page resolution
    optimizePackageImports: ["lucide-react", "framer-motion", "recharts", "date-fns", "react-syntax-highlighter"],
  },
  // Images: disable optimization (Cloudflare Pages doesn't support the default loader)
  images: {
    unoptimized: true,
  },
  // Note: Next.js 16 removed the top-level `api` config key.
  // `externalResolver` was only needed for custom servers and is no longer
  // required for Cloudflare Pages (the Edge runtime handles routing natively).
};

export default nextConfig;
