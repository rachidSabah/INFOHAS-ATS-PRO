# ResumeAI Pro

> **Land the offer. Beat the bots. Free forever.**
>
> A premium, completely free AI-powered resume builder, ATS checker, optimizer, cover letter generator, and interview prep platform. Engineered to outperform Enhancv — without the paywall.

![ResumeAI Pro](public/brand/og-image.png)

---

## Highlights

- **ATS Resume Checker** — six-axis scoring (ATS, formatting, keywords, content, grammar, completeness) with concrete recommendations
- **AI Resume Builder** — 7 templates, live A4 preview, **strict one-page enforcement** (`assert(pdf.pages === 1)`)
- **Resume Optimizer** — upload → paste JD → AI rewrite → optimized one-page resume
- **Cover Letter Generator** — modern, traditional, executive, short email templates · PDF / DOCX / TXT
- **Interview Prep** — technical, behavioral, situational, HR, company-specific questions with STAR examples + follow-ups
- **Job Description Scraper** — drop in any URL (LinkedIn / Indeed / Glassdoor / company careers page) or paste text
- **Multi-AI Provider System** — Puter.js (free, user-authenticated) + 15+ cloud providers with automatic failover
- **RBAC + Admin Dashboards** — User / Admin / Super Admin roles with full control panel
- **PWA + Cloudflare-Native** — installable, offline-friendly, pre-wired for Pages + Workers + D1 + R2 + KV + Queues
- **100% Free** — no paywalls, no watermarks, no feature restrictions, no email walls

---

## Tech stack

| Layer | Tech |
|-------|------|
| Frontend | Next.js 16 · React 19 · TypeScript · Tailwind CSS 4 · shadcn/ui · Zustand · TanStack Query · Framer Motion · React Hook Form + Zod |
| Backend | Cloudflare Workers · Hono · TypeScript |
| Database | Cloudflare D1 · Drizzle ORM |
| Storage | Cloudflare R2 |
| Cache | Cloudflare KV |
| Queues | Cloudflare Queues |
| Real-time | Cloudflare Durable Objects |
| Auth | Auth.js (NextAuth) · JWT · Google / GitHub / LinkedIn / Magic Link · Puter.js |
| PDF Engine | jsPDF (client-side, strict one-page A4) · docx · file-saver |
| Primary AI | Puter.js (free, users authenticate via Google) |
| Fallback AI | Z.ai SDK (built-in) · OpenAI · Claude · Gemini · DeepSeek · Groq · Mistral · Cohere · Perplexity · OpenRouter · Together · HuggingFace · Ollama · Azure OpenAI · AWS Bedrock · custom |
| Deployment | Cloudflare Pages · Cloudflare Workers · GitHub Actions |

---

## Quick start (local dev)

```bash
# 1. Install dependencies
bun install

# 2. Copy env template and fill in your values
cp .env.example .env
# (For local dev, you can leave most keys blank — Puter.js handles AI for free)

# 3. Run the dev server
bun run dev
# → http://localhost:3000
```

The app works fully in local dev without any external API keys — Puter.js (loaded from CDN) provides free AI when users click "Sign in with Google".

---

## Project structure

```
.
├── src/
│   ├── app/                    # Next.js App Router
│   │   ├── api/                # API routes (AI fallback, JD scraper)
│   │   ├── layout.tsx          # Root layout with fonts, PWA, Puter.js
│   │   ├── page.tsx            # Entry: landing or app shell
│   │   └── globals.css         # Design system (brand colors, A4 page styles)
│   ├── components/
│   │   ├── landing/            # Landing page sections
│   │   ├── app/                # App shell, sidebar, topbar, auth modal, modules
│   │   ├── resume/             # A4 preview component
│   │   └── shared.tsx          # Logo, Badge, ScoreRing, etc.
│   └── lib/
│       ├── types.ts            # All domain types
│       ├── store.ts            # Zustand store (persisted to localStorage)
│       ├── ai.ts               # Puter → server → local AI bridge with failover
│       ├── parser.ts           # Client-side PDF/DOCX/TXT resume parser
│       ├── ats.ts              # Six-axis ATS scoring engine
│       ├── exporter.ts         # PDF/DOCX/TXT exporters with one-page enforcement
│       ├── mock-data.ts        # Seed data
│       └── brand.ts            # Brand config + nav
├── public/
│   ├── brand/                  # Logo, favicons, PWA icons, OG image
│   ├── manifest.json           # PWA manifest
│   ├── robots.txt
│   └── sitemap.xml
├── workers/api/                # Cloudflare Workers (Hono) — production API
├── migrations/                 # D1 SQL migrations
├── scripts/backup.sh           # D1 + R2 backup script
├── .github/workflows/ci-cd.yml # CI/CD pipeline
├── wrangler.toml               # Cloudflare config
├── Dockerfile                  # Container build (optional)
├── docker-compose.yml          # Local multi-service stack (web + Ollama + MinIO)
└── .env.example                # All env vars documented
```

---

## The one-page A4 rule (most important requirement)

Every generated resume PDF **must** fit on exactly one A4 page. The exporter enforces this:

```ts
maxPages = 1
paperSize = A4
allowOverflow = false

// Validation:
assert(pdf.pages === 1)
```

If content would overflow, the exporter automatically:
1. Compresses spacing (4 progressive compression passes)
2. Reduces font sizes
3. Strips optional sections (projects, certifications, languages, achievements)
4. Validates with `assert(pdf.pages === 1)` and **refuses to export** if validation fails

This is implemented in `src/lib/exporter.ts → exportResumePDF()`.

---

## Multi-AI provider system

### Primary: Puter.js (free, user-authenticated)

Loaded from CDN in `src/app/layout.tsx`. When a user clicks "Sign in with Puter" in the auth modal, they authenticate with their own Google account via Puter — all AI calls then run under their free Puter quota. No API key needed from the app owner.

### Fallback: Z.ai SDK (built-in)

If Puter is unavailable or rate-limited, the app falls back to `/api/ai/chat` which uses the Z.ai web dev SDK. This is bundled — no configuration needed.

### Custom providers (Super Admin → AI Providers)

Add any of 15+ supported providers by entering your own API URL, key, headers, parameters, model name, priority, timeout, max tokens, and temperature. Supported types:

`OpenAI · Claude · Gemini · DeepSeek · Groq · Mistral · Cohere · Perplexity · OpenRouter · Together · HuggingFace · Ollama · Azure OpenAI · AWS Bedrock · Custom / self-hosted LLM`

Future providers can be added without code changes — just register a new row in the `ai_providers` table.

### Automatic failover

The `callAI()` function in `src/lib/ai.ts` tries providers in priority order and rotates on:
- Timeout
- Rate limit (429)
- Quota exceeded
- Service unavailable (5xx)
- Network error

### Production failover

In production (Cloudflare Workers), the same logic lives in `workers/api/index.ts → /api/ai/chat`, which tries OpenAI → Anthropic → ... in order.

---

## Deployment

### Option A: Cloudflare Pages + Workers (recommended, free tier)

1. **Prerequisites**
   - Cloudflare account (free)
   - GitHub repo
   - Domain (optional, you can use the `*.pages.dev` subdomain)

2. **Set up Cloudflare resources**
   ```bash
   # Install Wrangler
   bun add -g wrangler

   # Login
   wrangler login

   # Create D1 database
   wrangler d1 create resumeai-pro-db
   # → copy the database_id into wrangler.toml

   # Create R2 bucket
   wrangler r2 bucket create resumeai-pro-storage

   # Create KV namespace
   wrangler kv namespace create CACHE
   # → copy the id into wrangler.toml

   # Create Queue
   wrangler queues create resumeai-pro-queue

   # Apply migrations
   wrangler d1 migrations apply resumeai-pro-db --remote
   ```

3. **Set secrets**
   ```bash
   wrangler secret put NEXTAUTH_SECRET
   wrangler secret put JWT_SECRET
   wrangler secret put ENCRYPTION_KEY
   # Optional: any provider keys you want available server-side
   wrangler secret put OPENAI_API_KEY
   ```

4. **Connect repo to Cloudflare Pages**
   - Dashboard → Pages → Create project → Connect to Git
   - Pick your repo, set:
     - Build command: `bun run build`
     - Output directory: `.next/standalone`
   - Add env vars from `.env.example`

5. **Deploy Workers**
   ```bash
   wrangler deploy --env production
   ```

6. **Set up GitHub Actions** (optional, for automated CI/CD)
   - Add repo secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `NEXTAUTH_SECRET`, `JWT_SECRET`, `ENCRYPTION_KEY`
   - Push to `main` → CI/CD auto-deploys

### Option B: Docker (self-host)

```bash
# Build & run with docker compose
docker compose up --build

# With optional local LLM (Ollama):
docker compose --profile llm up --build
```

App: http://localhost:3000 · MinIO console: http://localhost:9001 · Ollama API: http://localhost:11434

### Option C: Vercel / Netlify (works, but loses Cloudflare Workers features)

Standard Next.js deployment — `vercel deploy` or connect repo to Netlify. AI provider failover will use the Puter.js + Z.ai client-side path only.

---

## Security

- ✅ JWT-based auth with secure cookies
- ✅ CSRF protection (SameSite=Strict cookies + token binding)
- ✅ XSS protection (React auto-escaping + CSP via `secureHeaders`)
- ✅ SQL injection protection (D1 prepared statements via Drizzle)
- ✅ Rate limiting (Cloudflare KV-backed, 60 RPM default)
- ✅ Encryption at rest (API keys encrypted with `ENCRYPTION_KEY`)
- ✅ Audit logs (every admin action, AI call, and export is logged)
- ✅ RBAC (User / Admin / Super Admin) enforced on every API route
- ✅ Secrets via Cloudflare Workers secrets / GitHub Actions secrets — never hardcoded

---

## PWA

The app is installable on desktop and mobile. The PWA manifest is at `public/manifest.json` with:
- Standalone display mode
- Custom splash screen colors
- Shortcut icons for ATS Checker, Resume Builder, Cover Letter
- Maskable icons for Android adaptive display

To install: open the app in Chrome/Edge → click the install icon in the address bar.

---

## Accessibility

- ✅ WCAG 2.1 AA compliant
- ✅ Full keyboard navigation
- ✅ Screen reader support (semantic HTML, ARIA labels)
- ✅ High-contrast color scheme
- ✅ Reduced-motion support (Framer Motion respects `prefers-reduced-motion`)
- ✅ 44px minimum touch targets on mobile

---

## Testing

```bash
# Unit + integration tests (bun:test)
bun test

# E2E tests (Playwright)
bunx playwright test

# Lint + type-check
bun run lint
bunx tsc --noEmit
```

---

## Backup & restore

```bash
# Manual backup
./scripts/backup.sh

# Restore D1
wrangler d1 execute resumeai-pro-db --file=./backups/YYYYMMDD-HHMMSS/d1.sql --remote
```

The backup script is also scheduled via the `triggers.crons` section in `wrangler.toml` (daily 3am UTC).

---

## Branding customization

All branding (logo, colors, app name, email/PDF branding) can be customized live in **Super Admin → Branding**. Changes are stored in the `branding` table and applied across the app, PDFs, and emails.

To regenerate favicons / PWA icons after a logo change, use the **Regenerate icons** button in the Branding module (runs a Node script that produces all sizes from `public/brand/logo.png`).

---

## Roadmap

- [ ] Real-time collaborative resume editing (Durable Objects)
- [ ] AI resume translator (30+ languages, template-aware)
- [ ] White-label / sponsorship slots (non-intrusive)
- [ ] Mobile app (React Native sharing the same API)
- [ ] Browser extension (1-click JD scrape from LinkedIn / Indeed)

---

## License & monetization

**ResumeAI Pro is completely free, forever.** No subscriptions, no premium tiers, no paywalls, no watermarks, no feature restrictions.

Optional, non-intrusive monetization:
- Donations (one-time and recurring)
- Sponsorships (logo placement on landing page only — never inside the app)
- White-label licensing (self-hosted enterprise deployments)

Advertisements are supported by a feature flag but **disabled by default**. If enabled, they must never block features.

---

## Credits

Built by the ResumeAI Pro team. Logo © ResumeAI Pro.

---

## ⚠️ Security note (for the project owner)

The original build specification included plaintext API tokens for GitHub and Cloudflare. Those tokens should be considered **compromised** — please revoke them immediately at:

- GitHub: https://github.com/settings/tokens
- Cloudflare: https://dash.cloudflare.com/profile/api-tokens

Then create fresh tokens and add them as **GitHub Actions secrets** (never in source). This repo's `.env.example` is a template only — no real secrets are included.
