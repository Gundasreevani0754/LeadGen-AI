import "server-only";
import { sql } from "drizzle-orm";

import { db } from "./index";
import { briefs, businesses, pipeline, searchRuns } from "./schema";

export type DbSnapshot =
  | {
      connected: true;
      businesses: number;
      enriched: number;
      briefed: number;
      inPipeline: number;
      runs: number;
    }
  | { connected: false; error: string };

/**
 * Reads the counts the Overview page needs, and never throws.
 *
 * A dashboard that crashes when Postgres is unreachable is useless precisely when
 * you need to know what's wrong. On failure this returns the reason so the UI can
 * show it plainly.
 */
export async function getDbSnapshot(): Promise<DbSnapshot> {
  try {
    const [row] = await db
      .select({
        businesses: sql<number>`(select count(*)::int from ${businesses})`,
        enriched: sql<number>`(select count(*)::int from enrichment where crawl_status = 'ok')`,
        briefed: sql<number>`(select count(*)::int from ${briefs})`,
        inPipeline: sql<number>`(select count(*)::int from ${pipeline} where status <> 'new')`,
        runs: sql<number>`(select count(*)::int from ${searchRuns})`,
      })
      .from(sql`(select 1) as _`);

    return { connected: true, ...row };
  } catch (error) {
    return { connected: false, error: describeDbError(error) };
  }
}

/**
 * Drizzle wraps driver failures in a "Failed query: <the entire SQL>" message,
 * which buries the one line that actually says what went wrong. Prefer the
 * underlying driver error, and name the common misconfigurations outright.
 */
function describeDbError(error: unknown): string {
  const cause = error instanceof Error ? error.cause : undefined;
  const driver = cause instanceof Error ? cause : error;
  const message =
    driver instanceof Error ? driver.message : String(driver ?? "unknown error");
  const code =
    driver && typeof driver === "object" && "code" in driver
      ? String((driver as { code: unknown }).code)
      : undefined;

  switch (code) {
    case "28P01":
      return "Password authentication failed. DATABASE_URL still has the wrong password — check that the [YOUR-PASSWORD] placeholder was replaced.";
    case "ENOTFOUND":
    case "ECONNREFUSED":
      return `Cannot reach the database host (${code}). Confirm DATABASE_URL points at the transaction pooler on port 6543.`;
    case "42P01":
      return "A table is missing. Run `npm run db:migrate`.";
    default:
      return code ? `${code}: ${message}` : message;
  }
}
