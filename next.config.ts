import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // For Cloudflare Pages deployment, do NOT use "standalone" — next-on-pages handles output.
  // For Docker/Vercel deployment, change to output: "standalone".
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
  // Cloudflare Pages requires these experimental flags
  experimental: {
    // next-on-pages needs this for proper page resolution
    optimizePackageImports: ["lucide-react", "framer-motion"],
  },
  // Images: disable optimization (Cloudflare Pages doesn't support the default loader)
  images: {
    unoptimized: true,
  },
  // Ensure API routes work on Cloudflare
  api: {
    externalResolver: true,
  },
};

export default nextConfig;
