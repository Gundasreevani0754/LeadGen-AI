# Deploying

The dashboard goes on Vercel. The workers stay on your machine — that split is
deliberate and permanent (spec §5): Vercel Hobby functions time out in seconds,
a 200-site crawl takes minutes, and `claude -p` runs on your subscription, which
has no API key to give a server.

| Part | Where it runs |
|---|---|
| Dashboard — all seven surfaces, PDF export | Vercel |
| `npm run enrich` — crawl, extract, RDAP | Your machine / n8n |
| `npm run brief` — Claude briefing | Your machine only |
| `npm run score`, `npm run feedback` | Either |

## 1. Environment variables

Vercel → Project → Settings → Environment Variables. Everything in `.env.local`
except the Claude and worker-tuning values, which only the local workers read.

**Required for the dashboard:**

| Variable | Notes |
|---|---|
| `DATABASE_URL` | Supabase **transaction pooler**, port 6543. Not the direct connection — serverless opens too many connections for it. |
| `NEXT_PUBLIC_SUPABASE_URL` | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public by design. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only. Never prefix a secret with `NEXT_PUBLIC_`. |
| `SERPAPI_KEY` | The generator runs sourcing from the dashboard. |
| `APIFY_TOKEN` | |
| `GEMINI_API_KEY` | Only needed if you ever trigger enrichment from the UI. |

**Optional** (these are only defaults now — the Settings page overrides them in
the database): `SCORE_THRESHOLD`, `SERVICE_PROVIDER_MAX_RATIO`,
`ENRICHMENT_TTL_DAYS`, `CLAUDE_MODEL`, `CLAUDE_EFFORT`,
`CLAUDE_DAILY_BRIEF_CAP`, `GEMINI_MODEL`.

`src/env.ts` validates all of them at boot, so a missing or malformed value
fails the deploy loudly instead of at 2am mid-run.

## 2. Deploy

```bash
npx vercel link
npx vercel --prod
```

Next.js is detected automatically; no `vercel.json` is needed. Push-to-deploy
from the `rebuild` branch works too once the project is linked.

## 3. After the first deploy

- Open `/` — if the database is unreachable the Overview says so plainly and
  prints the driver error rather than showing a blank page.
- Open `/settings` and save once. That writes the `app_settings` row, after
  which tuning is a click rather than a redeploy.

## Security posture

What is in place, and what is deliberately not:

- **Security headers** on every route (`next.config.ts`): CSP, `nosniff`,
  `frame-ancestors 'none'`, `form-action 'self'`, a strict Referrer-Policy and
  HSTS.
- **Input validation** with zod on every server action, and uuid checks on both
  PDF routes before any id reaches a `::uuid` cast.
- **Rate limiting** (`src/lib/rate-limit.ts`) on everything that spends money or
  crawls someone else's site: sourcing, briefs, re-crawls, PDF rendering.
- **SSRF guard** on the crawler, because target URLs come from Google Maps
  listings rather than from you.
- **Row-level security on every table** (`drizzle/0004_lock_down_public_api.sql`).
  This matters more than it sounds: Supabase publishes every table in `public`
  through PostgREST at `<project>.supabase.co/rest/v1/<table>`, and Drizzle
  creates tables with RLS off. Until that migration ran, the anon key read and
  deleted rows from the live database. The app talks to Postgres directly as a
  role that bypasses RLS, so enabling it costs nothing and removes the HTTP API
  entirely. If you ever add a table by hand, enable RLS on it the same day.
- **No auth.** There is none, by design (spec §1: not multi-tenant, no public
  access). That is fine on localhost and **not** fine on a public Vercel URL —
  anyone with the link can spend your SerpApi quota. Before you leave a
  production deployment up, put Vercel Authentication in front of it:
  Project → Settings → Deployment Protection → Vercel Authentication. It is on
  the free plan and limits access to your own Vercel account.

The CSP keeps `'unsafe-inline'` for scripts, which Next's hydration bootstrap
needs. Removing it means threading a per-request nonce through the root layout —
worth doing for an app that takes input from strangers, which this one does not.

## Rotating the old Gemini key

`.env` at the repo root belongs to the archived Flask app. It was **never
committed** (`git log -- .env` is empty) and its key is a different, older one
than the rebuild uses. Nothing reads it any more, so:

1. Revoke it at <https://aistudio.google.com/app/apikey>.
2. Delete `.env`.

The key in `.env.local` stays — that is the live one.
