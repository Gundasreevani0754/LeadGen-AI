# n8n workflows

`leadgen-enrichment.json` is the Phase 3 worker on a schedule. Import it from
n8n's **Workflows → Import from file**.

Two things to set after importing:

1. **Working directory.** The Execute Command nodes run `npm run enrich` and
   `npm run score`, which must run from the repo root. Either start n8n from the
   repo root, or edit each command to `cd "<path to repo>" && npm run …`.
2. **Nothing else.** The worker reads `.env.local` itself via `--env-file`, so no
   credentials are stored in n8n.

## Why Execute Command rather than HTTP nodes

The enrichment worker already enforces the TTL, the politeness delay and the
spend ledger. Re-implementing that as a chain of HTTP nodes would move those
guarantees out of tested code and into a diagram. n8n's job here is scheduling
and visibility, which is exactly what it is good at.

## Running it by hand instead

n8n is optional. The same work runs directly:

```bash
npm run enrich -- --limit 40
npm run score
```
