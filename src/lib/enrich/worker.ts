import "server-only";
import { sql } from "drizzle-orm";

import { db } from "@/db";
import { enrichment, spendLedger } from "@/db/schema";
import { getSettings } from "@/lib/settings";
import { enrichBusiness, type EnrichOptions } from "./enrich-one";
import { CRAWL_DELAY_MS } from "./fetcher";
import type { EnrichmentResult, EnrichTarget } from "./types";

/**
 * The unattended half of Phase 3: pick what is stale, crawl it, write it down.
 *
 * Runs locally (n8n or `npm run enrich`) because a 200-site crawl takes minutes
 * and Vercel Hobby functions do not live that long (§5).
 */

/** A crawl that failed is retried eventually, but far sooner than the full TTL. */
export const FAILED_RETRY_DAYS = 14;

export interface EnrichQueueOptions {
  limit: number;
  ttlDays: number;
  /** Re-crawl sites that previously blocked us or errored. */
  includeFailed?: boolean;
  /** Restrict to one business, for the "re-crawl this lead" button. */
  businessId?: string;
  /** Ignore the TTL entirely. Only ever set by an explicit operator request. */
  force?: boolean;
}

/**
 * Businesses whose enrichment is missing or stale.
 *
 * The TTL test lives in SQL rather than in TypeScript so that a second worker
 * started by mistake selects the same rows and re-does work, rather than
 * selecting different rows and doubling the crawl load on the same sites.
 */
export async function selectQueue({
  limit,
  ttlDays,
  includeFailed = false,
  businessId,
  force = false,
}: EnrichQueueOptions): Promise<EnrichTarget[]> {
  const rows = await db.execute<EnrichTarget & Record<string, unknown>>(sql`
    select b.id,
           b.name,
           b.website_url    as "websiteUrl",
           b.root_domain    as "rootDomain",
           b.book_online_url as "bookOnlineUrl",
           b.city
      from businesses b
      left join enrichment e on e.business_id = b.id
      left join suppressions s
             on (s.phone_e164 is not null and s.phone_e164 = b.phone_e164)
             or (s.root_domain is not null and s.root_domain = b.root_domain)
     where b.business_status = 'operational'
       and s.id is null
       and (${businessId ? sql`b.id = ${businessId}::uuid` : sql`true`})
       and (
             ${force ? sql`true` : sql`false`}
          or e.business_id is null
          or (e.crawl_status = 'ok'
              and e.fetched_at < now() - ${sql.raw(`interval '${Math.max(1, Math.floor(ttlDays))} days'`)})
          or (${includeFailed ? sql`true` : sql`false`}
              and e.crawl_status <> 'ok'
              and e.fetched_at < now() - ${sql.raw(`interval '${FAILED_RETRY_DAYS} days'`)})
       )
     order by b.google_review_count desc nulls last, b.first_seen_at asc
     limit ${Math.max(1, Math.floor(limit))}
  `);

  return [...rows];
}

/** Writes one result, replacing any previous row for that business. */
export async function saveEnrichment(result: EnrichmentResult): Promise<void> {
  const values = {
    businessId: result.businessId,
    email: result.email,
    whatsappPhone: result.whatsappPhone,
    linkedinUrl: result.linkedinUrl,
    instagramUrl: result.instagramUrl,
    facebookUrl: result.facebookUrl,
    xUrl: result.xUrl,
    contactFormUrl: result.contactFormUrl,
    techStack: result.techStack,
    hasBooking: result.hasBooking,
    hasChat: result.hasChat,
    hasOnlinePayment: result.hasOnlinePayment,
    domainRegisteredAt: result.domainRegisteredAt,
    domainAgeYears:
      result.domainAgeYears === null ? null : String(result.domainAgeYears),
    crawlStatus: result.crawlStatus,
    crawlError: result.crawlError,
    fetchedAt: new Date(),
  };

  // A re-crawl that was blocked, failed, or found no site carries no contact or
  // tech data — `enrichBusiness` returns the empty defaults for those outcomes.
  // Writing those over a row that a previous successful crawl filled would
  // silently delete a real email. So on anything but `ok`, record what happened
  // and leave the findings alone; the operator sees the status and can retry.
  const set =
    result.crawlStatus === "ok"
      ? values
      : {
          crawlStatus: values.crawlStatus,
          crawlError: values.crawlError,
          fetchedAt: values.fetchedAt,
        };

  await db
    .insert(enrichment)
    .values(values)
    .onConflictDoUpdate({ target: enrichment.businessId, set });

  if (result.usedGemini) {
    await db.insert(spendLedger).values({
      provider: "gemini",
      operation: "extract",
      units: "1",
      businessId: result.businessId,
    });
  }
}

export interface EnrichRunSummary {
  attempted: number;
  ok: number;
  blocked: number;
  noSite: number;
  failed: number;
  geminiCalls: number;
}

export interface EnrichRunOptions extends Partial<EnrichQueueOptions> {
  enrichOptions?: EnrichOptions;
  /** Called after each business so a CLI can print progress live. */
  onProgress?: (target: EnrichTarget, result: EnrichmentResult, index: number, total: number) => void;
  sleep?: (ms: number) => Promise<void>;
}

/**
 * Crawls the queue one business at a time.
 *
 * Sequential on purpose. Parallelism would multiply the load we place on small
 * shared hosts, and the run is unattended anyway — wall-clock time is the one
 * resource this project has in surplus.
 */
export async function runEnrichment(
  options: EnrichRunOptions = {},
): Promise<EnrichRunSummary> {
  const settings = await getSettings();
  const {
    limit = 50,
    ttlDays = settings.enrichmentTtlDays,
    includeFailed = false,
    businessId,
    force = false,
    enrichOptions,
    onProgress,
    sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms)),
  } = options;

  const queue = await selectQueue({ limit, ttlDays, includeFailed, businessId, force });

  const summary: EnrichRunSummary = {
    attempted: 0,
    ok: 0,
    blocked: 0,
    noSite: 0,
    failed: 0,
    geminiCalls: 0,
  };

  for (const [index, target] of queue.entries()) {
    const result = await enrichBusiness(target, enrichOptions);
    await saveEnrichment(result);

    summary.attempted += 1;
    if (result.crawlStatus === "ok") summary.ok += 1;
    else if (result.crawlStatus === "blocked") summary.blocked += 1;
    else if (result.crawlStatus === "no_site") summary.noSite += 1;
    else summary.failed += 1;
    if (result.usedGemini) summary.geminiCalls += 1;

    onProgress?.(target, result, index, queue.length);

    // Politeness between *sites*, not just between pages of one site.
    if (index < queue.length - 1 && result.crawlStatus !== "no_site") {
      await sleep(CRAWL_DELAY_MS);
    }
  }

  return summary;
}
