# LeadGen AI — Autotech

The lead-generation pipeline behind **Autotech**, the automation agency I
co-run. It sources real local businesses from Google Maps data, enriches them
from their own web presence, scores them deterministically, and writes a short
brief on the strongest prospects. Outreach stays human, by design.

Built as an internal tool: a single operator workspace, so there is no auth,
billing, or multi-tenancy.

Built by [Sreevani Gunda](https://github.com/Gundasreevani0754).

```
source (SerpApi/Apify) → dedupe → enrich (crawl + Gemini + RDAP)
   → score (plain TypeScript) → brief (claude -p) → one-pager PDF → pipeline
```

## Quick start

```bash
npm install
cp .env.local.example .env.local   # then fill in your own keys
npm run verify        # pings every service, prints pass/fail
npm run db:migrate
npm run dev
```

Then: **[docs/running.md](docs/running.md)** — the daily loop, every worker, and
what each one costs.

## Documentation

| Document | What it covers |
|---|---|
| [docs/running.md](docs/running.md) | Running the dashboard and the workers |
| [docs/deploy.md](docs/deploy.md) | Vercel, environment variables, security posture |
| [legacy/README.md](legacy/README.md) | The original Flask app and why its data is quarantined |

## Stack

Next.js 15 (App Router) · TypeScript · Tailwind · Supabase Postgres · Drizzle ·
SerpApi + Apify · Gemini 2.5 Flash · Claude Opus via `claude -p` ·
`@react-pdf/renderer` · n8n

Everything runs on a free tier. Nothing here needs a credit card.

## The two rules that shape the code

1. **No invented facts.** Every field is sourced or empty. No guessed emails —
   that is precisely how the previous version failed, and why its data is
   quarantined rather than migrated.
2. **No model decides what is good.** Code scores leads from facts; Claude only
   writes *about* leads that code already approved.

## Tests

```bash
npm test          # 178 tests, no network, no database
npm run typecheck
npm run lint
npm run build
```
