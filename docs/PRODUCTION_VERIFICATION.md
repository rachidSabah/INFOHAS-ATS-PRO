# Production Verification (checklist)

This checklist is for the **live deploy**, which is performed by a human with
Cloudflare credentials (the build sandbox has none). All *local* gates are
already green (see `docs/reports/DEPLOYMENT_READINESS.md`).

## Pre-deploy (local, already done)

- [x] `npx tsc --noEmit` → 0 errors
- [x] `npm run lint` → pass
- [x] `npx vitest run` → 1404 passing
- [x] `npm run build` → success
- [x] `npx @cloudflare/next-on-pages --skip-build` → Pages output generated
- [x] `npx wrangler deploy --dry-run` → Worker validates

## Deploy

```bash
./scripts/deploy.sh            # pages + worker + migrations
# or stepwise:
./scripts/deploy.sh pages
./scripts/deploy.sh worker
./scripts/deploy.sh migrate
```

Set Worker secrets once:

```bash
wrangler secret put NEXTAUTH_SECRET
wrangler secret put ENCRYPTION_KEY
```

## Post-deploy smoke test

Run these against your live URLs (`<pages>` = Pages project, `<worker>` =
Worker). Replace with your domains.

### 1. Health
```bash
curl -s https://<worker>/api/health | grep -q '"ok":true' && echo "PASS health" || echo "FAIL health"
```

### 2. App loads (no console errors)
- [ ] Visit `<pages>/` — landing renders.
- [ ] Open DevTools → Console: **no** errors/warnings.
- [ ] Visit `<pages>/interview` — Interview Prep loads.

### 3. Auth
- [ ] Sign in with Puter (Google) succeeds; AI calls work without app keys.
- [ ] Super Admin view (`Live Interview`, `Recruiter Intelligence`, `Flight
      Recorder`, `Scenario/Persona Management`) appears for `super_admin` role.

### 4. Core features
- [ ] Resume Builder: create/edit a resume, export PDF (one-page A4 enforced).
- [ ] Resume Optimizer: upload → paste JD → optimize.
- [ ] ATS Engine: six-axis score + recommendations.
- [ ] Interview Engine: generate adaptive questions; run a Live Interview;
      finish → session appears in Recruiter Intelligence.
- [ ] Recruiter Dashboard: candidate list, competency analytics, explainability,
      executive report (PDF/Word/Markdown/Print/Share).
- [ ] Flight Recorder Console: execution timeline + engine verdicts render.

### 5. API routes (no 5xx)
- [ ] `GET <pages>/api/health` → 200
- [ ] `POST <pages>/api/providers/test` with a test key → 200/valid JSON
- [ ] Provider proxy respects SSRF allowlist (private URL → 403)

### 6. Database
- [ ] `wrangler d1 execute resumeai-pro-db --remote --command="SELECT count(*) FROM ai_providers"` returns rows (migrations 0001–0015 applied).
- [ ] A completed interview persists and is queryable.

## Rollback

See `OPERATIONS.md` → Rollback. Promote a prior Pages deployment or
`wrangler deploy --oldest` for the Worker.

## If something fails

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| Health 500 | Worker not deployed / secret missing | `wrangler deploy`; set `NEXTAUTH_SECRET` |
| Migrations missing tables | `d1 migrations apply` not run | run `./scripts/deploy.sh migrate` |
| Pages 404 on `/api/*` | `_routes.json` wrong | ensure `public/_routes.json` excludes `/api/*` |
| CORS errors in browser | `CORS_ORIGIN="*"` vs custom domain | set `CORS_ORIGIN` to your origin (DEPLOYMENT.md) |
