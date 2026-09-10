"use client";
// The Edge Runtime declaration is REQUIRED here: next-on-pages (Cloudflare
// Pages build) refuses any non-static route without it. The SSR shell stays
// tiny because the heavy tree (store + A4 renderer, ~1.5MB server-side) is
// loaded via next/dynamic with ssr:false below — which also keeps this Edge
// Function far under Vercel Hobby's 1MB cap (it measured 1.52MB when the
// imports lived in this file, failing the Vercel build).
export const runtime = "edge";

import dynamic from "next/dynamic";

const PublicResumeContent = dynamic(() => import("./PublicResumeContent"), {
  ssr: false,
  loading: () => (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="animate-spin w-8 h-8 border-2 border-brand border-t-transparent rounded-full" />
    </div>
  ),
});

/**
 * Public resume reader — client-rendered via PublicResumeContent.tsx
 * (local store → cloud share snapshot → legacy ?d= blob resolution).
 */
export default function PublicResumePage() {
  return <PublicResumeContent />;
}
