import "server-only";
import { eq } from "drizzle-orm";

import { db } from "@/db";
import { appSettings } from "@/db/schema";
import { env } from "@/env";
import { CLAUDE_EFFORTS, type ClaudeEffort, type Settings } from "./settings-types";

/**
 * Runtime tuning, read from the database with `.env.local` as the fallback.
 *
 * Everything the operator might reasonably want to change mid-week lives here:
 * the score threshold, the ratio cap, the crawl TTL, and the Claude model,
 * effort and daily cap. Workers and the dashboard read the same function, so a
 * change on the Settings page reaches the next enrichment run without a restart.
 */

export { CLAUDE_EFFORTS };
export type { ClaudeEffort, Settings };

/** Free-plan allowances. Only used to draw the meters, never to gate a call. */
const DEFAULT_SERPAPI_QUOTA = 250;
const DEFAULT_APIFY_CREDITS = 5;

export function envDefaults(): Settings {
  return {
    scoreThreshold: env.SCORE_THRESHOLD,
    serviceProviderMaxRatio: env.SERVICE_PROVIDER_MAX_RATIO,
    enrichmentTtlDays: env.ENRICHMENT_TTL_DAYS,
    claudeModel: env.CLAUDE_MODEL,
    claudeEffort: env.CLAUDE_EFFORT,
    claudeDailyBriefCap: env.CLAUDE_DAILY_BRIEF_CAP,
    serpapiMonthlyQuota: DEFAULT_SERPAPI_QUOTA,
    apifyMonthlyCredits: DEFAULT_APIFY_CREDITS,
  };
}

/**
 * Never throws. A settings read that fails because Postgres is asleep must not
 * take down a page that is otherwise able to explain the outage.
 */
export async function getSettings(): Promise<Settings> {
  const defaults = envDefaults();

  try {
    const [row] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.id, "singleton"))
      .limit(1);

    if (!row) return defaults;

    return {
      scoreThreshold: row.scoreThreshold ?? defaults.scoreThreshold,
      serviceProviderMaxRatio: row.serviceProviderMaxRatio
        ? Number(row.serviceProviderMaxRatio)
        : defaults.serviceProviderMaxRatio,
      enrichmentTtlDays: row.enrichmentTtlDays ?? defaults.enrichmentTtlDays,
      claudeModel: row.claudeModel ?? defaults.claudeModel,
      claudeEffort: isEffort(row.claudeEffort) ? row.claudeEffort : defaults.claudeEffort,
      claudeDailyBriefCap: row.claudeDailyBriefCap ?? defaults.claudeDailyBriefCap,
      serpapiMonthlyQuota: row.serpapiMonthlyQuota ?? defaults.serpapiMonthlyQuota,
      apifyMonthlyCredits: row.apifyMonthlyCredits
        ? Number(row.apifyMonthlyCredits)
        : defaults.apifyMonthlyCredits,
    };
  } catch {
    return defaults;
  }
}

export async function updateSettings(patch: Partial<Settings>): Promise<Settings> {
  const values = {
    id: "singleton",
    scoreThreshold: patch.scoreThreshold,
    serviceProviderMaxRatio:
      patch.serviceProviderMaxRatio === undefined
        ? undefined
        : String(patch.serviceProviderMaxRatio),
    enrichmentTtlDays: patch.enrichmentTtlDays,
    claudeModel: patch.claudeModel,
    claudeEffort: patch.claudeEffort,
    claudeDailyBriefCap: patch.claudeDailyBriefCap,
    serpapiMonthlyQuota: patch.serpapiMonthlyQuota,
    apifyMonthlyCredits:
      patch.apifyMonthlyCredits === undefined
        ? undefined
        : String(patch.apifyMonthlyCredits),
    updatedAt: new Date(),
  };

  await db
    .insert(appSettings)
    .values(values)
    .onConflictDoUpdate({ target: appSettings.id, set: values });

  return getSettings();
}

function isEffort(value: string | null): value is ClaudeEffort {
  return value !== null && (CLAUDE_EFFORTS as string[]).includes(value);
}
