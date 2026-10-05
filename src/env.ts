import "server-only";
import { z } from "zod";

/**
 * Server-side environment, validated once at first import.
 * A missing or malformed variable fails loudly at boot rather than at 2am
 * in the middle of an enrichment run.
 *
 * This module must never be imported from a client component — it holds secrets.
 */

const schema = z.object({
  // Supabase
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  DATABASE_URL: z.string().url(),

  // Lead sources
  SERPAPI_KEY: z.string().min(1),
  APIFY_TOKEN: z.string().min(1),

  // Bulk extraction
  GEMINI_API_KEY: z.string().min(1),
  GEMINI_MODEL: z.string().default("gemini-2.5-flash"),

  // Claude briefing worker
  CLAUDE_MODEL: z.string().default("opus"),
  CLAUDE_EFFORT: z.enum(["low", "medium", "high", "xhigh", "max"]).default("medium"),
  CLAUDE_DAILY_BRIEF_CAP: z.coerce.number().int().positive().default(15),

  // Pipeline tuning
  SCORE_THRESHOLD: z.coerce.number().int().min(0).max(100).default(65),
  SERVICE_PROVIDER_MAX_RATIO: z.coerce.number().min(0).max(1).default(0.3),
  ENRICHMENT_TTL_DAYS: z.coerce.number().int().positive().default(90),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const missing = parsed.error.issues
    .map((issue) => `  ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  throw new Error(`Invalid environment configuration:\n${missing}`);
}

export const env = parsed.data;
