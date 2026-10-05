import "server-only";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { env } from "@/env";
import * as schema from "./schema";

/**
 * Drizzle client over Supabase's transaction pooler (port 6543).
 *
 * `prepare: false` is required: the pooler runs in transaction mode, where a
 * connection is handed to a different client between statements, so server-side
 * prepared statements cannot be relied upon.
 *
 * The client is cached on globalThis so Next.js hot reloads in development don't
 * open a new pool on every file change and exhaust the pooler's connection limit.
 */

const globalForDb = globalThis as unknown as {
  __leadgenSql?: ReturnType<typeof postgres>;
};

const client =
  globalForDb.__leadgenSql ??
  postgres(env.DATABASE_URL, {
    prepare: false,
    max: 5,
    idle_timeout: 20,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__leadgenSql = client;
}

export const db = drizzle(client, { schema });
export { schema };
