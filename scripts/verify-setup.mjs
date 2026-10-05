/**
 * Phase 0 verification — confirms every external service in .env.local responds.
 *
 *   node --env-file=.env.local scripts/verify-setup.mjs
 *
 * Nothing here consumes billable quota: each check hits a free metadata or
 * account endpoint rather than a search, scrape, or generation call.
 * Secret values are never printed; error text is redacted before display.
 */

import net from "node:net";

const SECRETS = [
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  process.env.DATABASE_URL,
  process.env.SERPAPI_KEY,
  process.env.APIFY_TOKEN,
  process.env.GEMINI_API_KEY,
].filter((v) => v && v.length > 8);

/** Strip any secret that leaked into an error message before it reaches stdout. */
const redact = (text) =>
  SECRETS.reduce((acc, secret) => acc.split(secret).join("[REDACTED]"), String(text));

const results = [];
const record = (name, ok, detail) => results.push({ name, ok, detail });

const missing = (name, value) => {
  if (value) return false;
  record(name, false, "not set in .env.local");
  return true;
};

/**
 * Queries a table that deliberately does not exist. A working key returns a
 * PostgREST "relation not found" error; a bad key returns 401 before PostgREST
 * ever looks at the table. The `/rest/v1/` root is not usable here — it accepts
 * service_role only, so it reports a false failure for a perfectly good anon key.
 */
async function checkSupabaseRest(label, key) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (missing(label, key) || missing("Supabase URL", url)) return;

  try {
    const res = await fetch(`${url}/rest/v1/__verify_probe__?select=id`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });

    if (res.status === 401 || res.status === 403) {
      record(label, false, "key rejected — wrong key, or copied from a different project");
      return;
    }
    // 404 / PGRST205 means authentication succeeded and the table simply isn't there.
    record(label, true, `authenticated (HTTP ${res.status} on a probe table)`);
  } catch (err) {
    record(label, false, redact(err.message));
  }
}

/**
 * The pooler string holds the DB password, so this validates shape and then
 * opens a bare TCP socket to prove the host and port are reachable.
 */
async function checkDatabaseUrl() {
  const raw = process.env.DATABASE_URL;
  if (missing("Postgres pooler", raw)) return;

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    record("Postgres pooler", false, "not a valid URL — paste the whole connection string");
    return;
  }

  if (!parsed.protocol.startsWith("postgres")) {
    record("Postgres pooler", false, `expected a postgres:// URL, got ${parsed.protocol}//`);
    return;
  }
  if (!parsed.password) {
    record("Postgres pooler", false, "no password in the string — replace [YOUR-PASSWORD]");
    return;
  }
  // Supabase ships the connection string with a bracketed placeholder. It is
  // truthy, so a presence check alone lets it through and the failure surfaces
  // much later as an opaque auth error.
  if (/^\[.*\]$/.test(decodeURIComponent(parsed.password))) {
    record(
      "Postgres pooler",
      false,
      "password is still the [PLACEHOLDER] from the dashboard — paste your real DB password",
    );
    return;
  }
  if (!parsed.username.includes(".")) {
    record(
      "Postgres pooler",
      false,
      `user is "${parsed.username}" — the pooler needs "postgres.<project-ref>"`,
    );
    return;
  }
  if (!parsed.hostname.includes("pooler")) {
    record(
      "Postgres pooler",
      false,
      `host is ${parsed.hostname} — that's the direct connection, use the Transaction pooler`,
    );
    return;
  }

  const port = Number(parsed.port) || 5432;
  const reachable = await new Promise((resolve) => {
    const socket = net.createConnection({ host: parsed.hostname, port, timeout: 8000 });
    socket.on("connect", () => (socket.destroy(), resolve(true)));
    socket.on("timeout", () => (socket.destroy(), resolve(false)));
    socket.on("error", () => resolve(false));
  });

  record(
    "Postgres pooler",
    reachable,
    reachable ? `reachable on port ${port}` : `cannot reach ${parsed.hostname}:${port}`,
  );
}

async function checkSerpApi() {
  const key = process.env.SERPAPI_KEY;
  if (missing("SerpApi", key)) return;

  try {
    const res = await fetch(`https://serpapi.com/account?api_key=${key}`);
    const body = await res.json();
    if (!res.ok || body.error) {
      record("SerpApi", false, redact(body.error ?? `HTTP ${res.status}`));
      return;
    }
    const left = body.total_searches_left ?? body.plan_searches_left ?? "?";
    record("SerpApi", true, `${left} searches left this month`);
  } catch (err) {
    record("SerpApi", false, redact(err.message));
  }
}

async function checkApify() {
  const token = process.env.APIFY_TOKEN;
  if (missing("Apify", token)) return;

  try {
    const res = await fetch("https://api.apify.com/v2/users/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      record("Apify", false, res.status === 401 ? "token rejected" : `HTTP ${res.status}`);
      return;
    }
    const { data } = await res.json();
    record("Apify", true, `signed in as ${data?.username ?? "unknown"}`);
  } catch (err) {
    record("Apify", false, redact(err.message));
  }
}

async function checkGemini() {
  const key = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL ?? "gemini-2.5-flash";
  if (missing("Gemini", key)) return;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${key}`,
    );
    const body = await res.json();
    if (!res.ok) {
      record("Gemini", false, redact(body?.error?.message ?? `HTTP ${res.status}`));
      return;
    }
    const names = (body.models ?? []).map((m) => m.name.replace("models/", ""));
    const hasModel = names.some((n) => n.startsWith(model));
    record(
      "Gemini",
      hasModel,
      hasModel ? `${model} available` : `${model} not in this key's model list`,
    );
  } catch (err) {
    record("Gemini", false, redact(err.message));
  }
}

await checkSupabaseRest("Supabase anon key", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
await checkSupabaseRest("Supabase service_role", process.env.SUPABASE_SERVICE_ROLE_KEY);
await checkDatabaseUrl();
await checkSerpApi();
await checkApify();
await checkGemini();

const width = Math.max(...results.map((r) => r.name.length));
console.log("");
for (const { name, ok, detail } of results) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name.padEnd(width)}  ${detail}`);
}

const failed = results.filter((r) => !r.ok);
console.log(
  failed.length === 0
    ? "\nAll checks passed. Phase 0 complete.\n"
    : `\n${failed.length} of ${results.length} checks failed.\n`,
);
process.exit(failed.length === 0 ? 0 : 1);
