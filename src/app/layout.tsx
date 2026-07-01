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
        {/*
          BANNER SUPPRESSION STRATEGY:
          Puter.js prints an ASCII-art banner to console.log on script init.
          Setting puter.quiet = true AFTER init does NOT undo the banner —
          it has already been printed. Setting window.puter = { quiet: true }
          BEFORE the script loads is also unreliable because Puter overwrites
          window.puter.

          The only reliable approach: intercept console.log BEFORE Puter loads,
          filter out the banner lines (multi-line ASCII art that contains
          "Puter" / "the internet OS" / "console.puter.com"), then restore
          console.log after a short delay. This keeps real logs from app code
          while hiding the banner.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html: `
              (function() {
                var _origLog = console.log.bind(console);
                var _suppressUntil = Date.now() + 4000; // 4s window
                var _bannerRegexes = [
                  /puter\\.js/i,
                  /the internet os/i,
                  /console\\.puter\\.com/i,
                  /dollars? in free ai/i,
                  /^\\s*█+█*\\s*$/,
                  /^\\s*[╔╗╚╝║═─│┌┐└┘├┤┬┴┼]+\\s*$/,
                ];
                console.log = function() {
                  if (Date.now() > _suppressUntil) {
                    // Window elapsed — restore real console.log
                    console.log = _origLog;
                    return _origLog.apply(null, arguments);
                  }
                  var args = Array.prototype.slice.call(arguments);
                  var text = args.map(function(a) {
                    return typeof a === 'string' ? a : (a && a.toString ? a.toString() : '');
                  }).join(' ');
                  for (var i = 0; i < _bannerRegexes.length; i++) {
                    if (_bannerRegexes[i].test(text)) return; // swallow
                  }
                  return _origLog.apply(null, arguments);
                };
                // Auto-restore after 4s no matter what
                setTimeout(function() { console.log = _origLog; }, 4500);
              })();
            `,
          }}
        />
        {/* Puter.js SDK — lazy-loaded on-demand by the Puter provider when the user
            explicitly selects a Puter model. No eager WebSocket connection = no
            console noise. */}
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
