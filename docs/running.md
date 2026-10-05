# Running the pipeline

Everything you can do with the rebuild. All nine phases are complete. The dashboard is the thing
you open every morning; the workers are what you run (or schedule) to feed it.

## Once, per machine

```bash
npm install
npm run verify        # pings all six services, prints pass/fail
npm run db:migrate    # applies any new migrations
```

`.env.local` holds every key. Nothing reads a key from anywhere else.

## The dashboard

```bash
npm run dev
```

Seven surfaces at http://localhost:3000:

| Surface | What it is for |
|---|---|
| Overview | Today's queue, quota meters, funnel, follow-ups due |
| Generator | Source a niche — free check first, then spend |
| Leads | The working table: filter, sort, select, bulk-move |
| Lead detail | The one-pager. Contacts, gaps, score breakdown, the angle |
| Pipeline | Kanban across the seven statuses |
| History | Every run, what it cost, what it yielded, replay |
| Settings | Threshold, ratio cap, TTL, Claude model, effort, daily cap, suppression list |

## The daily loop

```bash
npm run enrich -- --limit 40     # crawl, extract, RDAP, then re-score
npm run brief -- --dry-run       # see today's batch without spending
npm run brief                    # write the batch, capped per day
```

Then work the queue on the Overview.

### `npm run enrich`

Crawls each business's site one at a time, two seconds apart, with an identifying
User-Agent, honouring `robots.txt`. Pulls email, WhatsApp, socials and a contact
form; detects the platform and the automation gaps; looks up domain age via RDAP.
Gemini Flash is called only for the fields the regexes miss, and everything it
returns is checked against the page text before it is stored.

| Flag | Effect |
|---|---|
| `--limit N` | How many businesses to crawl (default 50) |
| `--business <uuid>` | Just this one |
| `--force` | Ignore the 90-day TTL and re-crawl |
| `--retry-failed` | Include sites that previously blocked us, after 14 days |
| `--no-gemini` | Deterministic extraction only |
| `--no-score` | Skip the re-score at the end |

Anything enriched inside the TTL is skipped and costs nothing, so re-running is
always safe.

### `npm run score`

Pure computation over what is already stored. No network, no quota. Run it after
changing a threshold, or with `--only-unscored` to fill in gaps.

### `npm run brief`

Batches the day's qualified leads into **one** `claude -p` session on your
subscription. Batching is the point: a single invocation loads tens of thousands
of tokens of context before it reads the prompt, and one session pays that once.

| Flag | Effect |
|---|---|
| `--dry-run` | Show the batch, start no session |
| `--limit N` | Fewer than the daily cap |
| `--business <uuid>` | One lead |
| `--regenerate` | Spend a second brief on a lead that already has one |

The daily cap comes from Settings. The unique index on `briefs.business_id` is
what makes double-spending impossible, whatever the code does.

## One-pagers

A single-page PDF per lead, generated from the same records the dashboard shows.

- **One lead:** the **One-pager** button on lead detail.
- **Several:** select rows in the leads table and press **One-pagers** — one file,
  one page each, up to 100.

Your side of the page — name, role, phone, email, website, tagline — lives in
`src/lib/pdf/brand.ts`. It ships with placeholders; edit that one file and every
future PDF picks it up. The prospect's side comes from the database, and the
footer names which sources each figure came from.

## What is actually converting

```bash
npm run feedback
```

Joins what happened to your leads against the score components they were given,
so the weights in `src/lib/score/score.ts` can eventually be set from evidence
rather than guesswork. The same report is on the **Pipeline** page under the
board.

It only counts leads that were actually contacted, and it keeps dead ones in the
denominator — a lead you called that went nowhere is the most useful row in the
table. Segments under five leads are marked as noise. At 100 worked leads it
tells you it is time to re-tune; when you do, bump `SCORING_VERSION` so the old
scores stay interpretable.

Marking a lead **Dead** suppresses its phone and domain permanently. The full
list, and a way to release an entry, is at the bottom of Settings.

## Unattended

Import `n8n/leadgen-enrichment.json` into a local n8n. It runs the enrichment and
scoring commands nightly, plus a weekly query that keeps the Supabase free project
from pausing. See `n8n/README.md` for the one setting you need to change.

## Tests

```bash
npm test          # 173 tests, no network, no database
npm run typecheck
npm run lint
npm run build
```

## The old Flask app

Archived under `legacy/` — see `legacy/README.md`. Its data is imported into
`legacy_searches` and `legacy_leads` with `npm run migrate:legacy` (idempotent),
and deliberately kept out of the pipeline: the old app invented its leads, so
letting them into `businesses` would poison dedupe with companies that do not
exist.

## Deploying

See [deploy.md](deploy.md). Short version: the dashboard goes on Vercel, the
workers stay on your machine, and put Vercel Deployment Protection in front of
it before leaving a public URL up — there is no login.

## Where the money goes

Every provider call is written to `spend_ledger`, and the Overview draws the
meters from it. If a number there looks wrong, the ledger is the source of truth
and each row names the run or the business that caused it.
