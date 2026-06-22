import type { Metadata, Viewport } from "next";
import { Inter, Sora, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { PWAInstaller } from "@/components/pwa/PWAInstaller";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://resumeai.pro"),
  title: {
    default: "ResumeAI Pro — Free AI Resume Builder & ATS Checker",
    template: "%s · ResumeAI Pro",
  },
  description:
    "Premium, completely free AI-powered resume builder, ATS checker, optimizer, cover letter generator, and interview prep platform. Built to outperform Enhancv — without the paywall.",
  keywords: [
    "ATS resume checker",
    "AI resume builder",
    "resume optimizer",
    "cover letter generator",
    "interview prep",
    "free resume builder",
    "ResumeAI Pro",
  ],
  authors: [{ name: "ResumeAI Pro" }],
  applicationName: "ResumeAI Pro",
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/brand/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/brand/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/brand/logo.svg", type: "image/svg+xml" },
    ],
    shortcut: "/brand/favicon.ico",
    apple: "/brand/apple-touch-icon.png",
  },
  openGraph: {
    title: "ResumeAI Pro — Free AI Resume Builder & ATS Checker",
    description:
      "Premium, completely free AI-powered resume builder, ATS checker, optimizer, cover letter generator, and interview prep platform.",
    url: "https://resumeai.pro",
    siteName: "ResumeAI Pro",
    images: [{ url: "/brand/og-image.png", width: 1200, height: 630, alt: "ResumeAI Pro" }],
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "ResumeAI Pro — Free AI Resume Builder & ATS Checker",
    description:
      "Premium, completely free AI-powered resume builder, ATS checker, optimizer, cover letter generator, and interview prep platform.",
    images: ["/brand/twitter-card.png"],
  },
  category: "productivity",
  alternates: { canonical: "/" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#1154A3" },
    { media: "(prefers-color-scheme: dark)", color: "#0A0F1E" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* PWA — iOS Safari standalone mode + status bar styling */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="ResumeAI Pro" />
        {/* Puter.js — free, keyless, user-authenticated AI provider.
            Loaded from the official CDN per https://docs.puter.com/getting-started/.
            `async` so it doesn't block page render; Puter attaches to window.puter
            and is available by the time user interactions happen. */}
        {/* Suppress Puter's console banner — MUST be set BEFORE the Puter script loads.
            Puter checks window.puter?.quiet on init and skips the banner if true. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              window.puter = window.puter || {};
              window.puter.quiet = true;
              // Use Object.defineProperty to make quiet survive Puter overwriting window.puter
              var _quietVal = true;
              try {
                Object.defineProperty(window, 'puter', {
                  get: function() { return window.__puter_real || { quiet: true }; },
                  set: function(v) { v.quiet = true; window.__puter_real = v; },
                  configurable: true,
                });
              } catch(e) {}
            `,
          }}
        />
        <script src="https://js.puter.com/v2/" async></script>
        <script
          dangerouslySetInnerHTML={{
            __html: `
              // Set quiet again after Puter loads (belt and suspenders)
              window.addEventListener('load', function() {
                try { if (window.puter) window.puter.quiet = true; } catch(e) {}
              });
              var _pc = setInterval(function() {
                try { if (window.puter) { window.puter.quiet = true; clearInterval(_pc); } } catch(e) {}
              }, 50);
              setTimeout(function() { clearInterval(_pc); }, 5000);
            `,
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "WebApplication",
              name: "ResumeAI Pro",
              applicationCategory: "BusinessApplication",
              operatingSystem: "Any",
              offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
              description:
                "Premium, completely free AI-powered resume builder, ATS checker, optimizer, cover letter generator, and interview prep platform.",
            }),
          }}
        />
      </head>
      <body
        className={`${inter.variable} ${sora.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
        <SonnerToaster position="top-right" richColors closeButton />
        {/* PWA: service worker registration + install prompt */}
        <PWAInstaller />
      </body>
    </html>
  );
}
