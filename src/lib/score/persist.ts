import "server-only";
import { sql } from "drizzle-orm";

import { db } from "@/db";
import { scores } from "@/db/schema";
import { computeScore, SCORING_VERSION } from "./score";
import type { ScoreFacts, ScoreResult } from "./types";

/**
 * The only part of Phase 4 that touches the database.
 *
 * Facts in, scores out. Keeping the I/O in one small file is what lets
 * `computeScore` stay a pure function that a test can exercise exhaustively.
 */

interface FactRow {
  id: string;
  name: string;
  googleCategory: string | null;
  googleRating: string | null;
  googleReviewCount: number | null;
  businessStatus: "operational" | "closed_temporarily" | "closed_permanently";
  phoneE164: string | null;
  countryCode: string | null;
  websiteUrl: string | null;
  rootDomain: string | null;
  unclaimedListing: boolean | null;
  chainLocations: number;
  suppressed: boolean;
  enrichedAt: Date | null;
  email: string | null;
  whatsappPhone: string | null;
  linkedinUrl: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  xUrl: string | null;
  contactFormUrl: string | null;
  techStack: string[] | null;
  hasBooking: boolean | null;
  hasChat: boolean | null;
  hasOnlinePayment: boolean | null;
  domainAgeYears: string | null;
  crawlStatus: "ok" | "blocked" | "no_site" | "failed" | null;
}

/**
 * Loads every fact the scorer needs in one query.
 *
 * `chainLocations` is computed here rather than per business because it is a
 * count over the whole table — doing it per row would be the N+1 the review
 * checklist exists to catch.
 */
export async function loadFacts(options: {
  businessId?: string;
  limit?: number;
  /** Only businesses with no score at the current version. */
  onlyUnscored?: boolean;
} = {}): Promise<ScoreFacts[]> {
  const { businessId, limit = 1000, onlyUnscored = false } = options;

  const rows = await db.execute<FactRow & Record<string, unknown>>(sql`
    with name_counts as (
      select lower(name) as key, count(*)::int as n
        from businesses
       group by lower(name)
    )
    select b.id,
           b.name,
           b.google_category      as "googleCategory",
           b.google_rating        as "googleRating",
           b.google_review_count  as "googleReviewCount",
           b.business_status      as "businessStatus",
           b.phone_e164           as "phoneE164",
           b.country_code         as "countryCode",
           b.website_url          as "websiteUrl",
           b.root_domain          as "rootDomain",
           b.unclaimed_listing    as "unclaimedListing",
           coalesce(nc.n, 1)      as "chainLocations",
           (s.id is not null)     as "suppressed",
           e.fetched_at           as "enrichedAt",
           e.email, e.whatsapp_phone as "whatsappPhone",
           e.linkedin_url as "linkedinUrl", e.instagram_url as "instagramUrl",
           e.facebook_url as "facebookUrl", e.x_url as "xUrl",
           e.contact_form_url as "contactFormUrl",
           e.tech_stack as "techStack",
           e.has_booking as "hasBooking", e.has_chat as "hasChat",
           e.has_online_payment as "hasOnlinePayment",
           e.domain_age_years as "domainAgeYears",
           e.crawl_status as "crawlStatus"
      from businesses b
      left join enrichment e on e.business_id = b.id
      left join name_counts nc on nc.key = lower(b.name)
      left join suppressions s
             on (s.phone_e164 is not null and s.phone_e164 = b.phone_e164)
             or (s.root_domain is not null and s.root_domain = b.root_domain)
      left join scores sc
             on sc.business_id = b.id and sc.scoring_version = ${SCORING_VERSION}
     where (${businessId ? sql`b.id = ${businessId}::uuid` : sql`true`})
       and (${onlyUnscored ? sql`sc.id is null` : sql`true`})
     order by b.google_review_count desc nulls last
     limit ${Math.max(1, Math.floor(limit))}
  `);

  return [...rows].map(toFacts);
}

function toFacts(row: FactRow): ScoreFacts {
  return {
    businessId: row.id,
    name: row.name,
    googleCategory: row.googleCategory,
    googleRating: row.googleRating === null ? null : Number(row.googleRating),
    googleReviewCount: row.googleReviewCount,
    businessStatus: row.businessStatus,
    phoneE164: row.phoneE164,
    countryCode: row.countryCode,
    websiteUrl: row.websiteUrl,
    rootDomain: row.rootDomain,
    unclaimedListing: row.unclaimedListing,
    chainLocations: row.chainLocations ?? 1,
    suppressed: row.suppressed ?? false,
    enrichment: row.enrichedAt
      ? {
          email: row.email,
          whatsappPhone: row.whatsappPhone,
          linkedinUrl: row.linkedinUrl,
          instagramUrl: row.instagramUrl,
          facebookUrl: row.facebookUrl,
          xUrl: row.xUrl,
          contactFormUrl: row.contactFormUrl,
          techStack: row.techStack,
          hasBooking: row.hasBooking,
          hasChat: row.hasChat,
          hasOnlinePayment: row.hasOnlinePayment,
          domainAgeYears:
            row.domainAgeYears === null ? null : Number(row.domainAgeYears),
          crawlStatus: row.crawlStatus,
        }
      : null,
  };
}

export async function saveScores(results: ScoreResult[]): Promise<void> {
  if (results.length === 0) return;

  const rows = results.map((result) => ({
    businessId: result.businessId,
    scoringVersion: SCORING_VERSION,
    total: result.total,
    components: {
      ...result.components,
      excluded: result.excluded,
      exclusionReason: result.exclusionReason,
    },
    entityType: result.entityType,
    contactTier: result.contactTier,
    computedAt: new Date(),
  }));

  // Re-scoring the same version overwrites; a *new* version inserts alongside,
  // which is what keeps the feedback loop's history intact (§14).
  await db
    .insert(scores)
    .values(rows)
    .onConflictDoUpdate({
      target: [scores.businessId, scores.scoringVersion],
      set: {
        total: sql`excluded.total`,
        components: sql`excluded.components`,
        entityType: sql`excluded.entity_type`,
        contactTier: sql`excluded.contact_tier`,
        computedAt: sql`excluded.computed_at`,
      },
    });
}

export interface ScoreRunSummary {
  scored: number;
  qualified: number;
  excluded: number;
  businesses: number;
  serviceProviders: number;
  averageTotal: number;
}

/** Scores a slice of the database and writes the results. */
export async function runScoring(options: {
  businessId?: string;
  limit?: number;
  onlyUnscored?: boolean;
  threshold: number;
}): Promise<ScoreRunSummary> {
  const facts = await loadFacts(options);
  const results = facts.map(computeScore);
  await saveScores(results);

  const eligible = results.filter((r) => !r.excluded);

  return {
    scored: results.length,
    qualified: eligible.filter((r) => r.total >= options.threshold).length,
    excluded: results.length - eligible.length,
    businesses: results.filter((r) => r.entityType === "business").length,
    serviceProviders: results.filter((r) => r.entityType === "service_provider").length,
    averageTotal:
      results.length === 0
        ? 0
        : Math.round(results.reduce((sum, r) => sum + r.total, 0) / results.length),
  };
}
