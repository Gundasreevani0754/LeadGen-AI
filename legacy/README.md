# Legacy — the original Flask app

Archived in Phase 9. Kept in git history, out of the way of the rebuild.

```
legacy/
├── app.py              the whole original application
├── templates/          login, register, dashboard, results, history
├── static/
├── requirements.txt
├── render.yaml         its Render.com deploy config
├── .env.example
├── instance/           leadforge.db — SQLite: 2 users, 2 searches, 100 leads
└── exports/            the Excel files it produced (local only — not in this repo)
```

Nothing in here runs, and nothing in the rebuild imports from it.

## Why its data is quarantined rather than migrated

Phase 9 was specified as "import the legacy data so old companies immediately
participate in dedupe". Reading the data changed the plan.

`app.py` sent one prompt to Gemini asking it to produce 50 leads, and instructed
the model to *construct* email addresses from likely patterns. The result is what
you would expect: `Innovatech Solutions Pvt. Ltd.` with
`priya.sharma@innovatech.com` — a company that does not exist, a person who does
not exist, and an address that was assembled rather than found.

Letting those rows into `businesses` would have broken the rebuild's first
guardrail — no invented facts — and, worse, would have seeded dedupe with
fabricated phone numbers and domains. A real business found later could then be
silently discarded as a duplicate of a hallucination.

So the import lands in `legacy_searches` and `legacy_leads` instead. Both tables
are joined to nothing in the pipeline: not sourced against, not enriched, not
scored, not briefed. `npm run migrate:legacy` is idempotent and reads from this
folder.

**210 rows are preserved:** 100 leads and 2 searches from the SQLite database,
plus 110 rows across the three Excel exports (the earliest file's 10 rows exist
nowhere else).

## The old Gemini key

`legacy/.env.example` is a template and holds no secret. The real `.env` at the
repo root was **never committed** — `git log -- .env` is empty — and its Gemini
key is a different, older key than the rebuild uses.

Nothing reads it any more. Revoke it at
<https://aistudio.google.com/app/apikey> and delete the file.
