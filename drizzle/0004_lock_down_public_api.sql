-- Close the PostgREST hole.
--
-- Supabase exposes every table in `public` through PostgREST at
-- <project>.supabase.co/rest/v1/<table>, authenticated with the anon key.
-- Drizzle creates tables with RLS *disabled*, so until this migration ran,
-- anyone holding the project URL and the anon key could read, insert, update
-- and delete every row. Verified against the live project: `GET /businesses`
-- returned all 20 rows and `DELETE /businesses?id=eq.<uuid>` returned 204.
--
-- The app never uses the Supabase JS client or PostgREST. It talks to Postgres
-- directly over DATABASE_URL as the `postgres` role, which has BYPASSRLS, so
-- enabling RLS with no policies at all costs the app nothing and removes the
-- HTTP API entirely for anon and authenticated callers.
--
-- If a policy is ever needed here, that is the moment to reconsider: this is a
-- single-operator tool with no end users to write policies for.

ALTER TABLE "app_settings"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "briefs"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "businesses"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "enrichment"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "legacy_leads"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "legacy_searches"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pipeline"         ENABLE ROW LEVEL SECURITY;
ALTER TABLE "pipeline_events"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "run_results"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "scores"           ENABLE ROW LEVEL SECURITY;
ALTER TABLE "search_runs"      ENABLE ROW LEVEL SECURITY;
ALTER TABLE "spend_ledger"     ENABLE ROW LEVEL SECURITY;
ALTER TABLE "suppressions"     ENABLE ROW LEVEL SECURITY;

-- Belt and braces: even if a future migration re-enables a table without RLS,
-- the roles PostgREST authenticates as hold no privileges on this schema.
REVOKE ALL ON ALL TABLES IN SCHEMA "public" FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA "public" FROM anon, authenticated;
REVOKE USAGE ON SCHEMA "public" FROM anon, authenticated;

ALTER DEFAULT PRIVILEGES IN SCHEMA "public" REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA "public" REVOKE ALL ON SEQUENCES FROM anon, authenticated;
