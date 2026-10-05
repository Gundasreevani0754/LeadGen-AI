import "server-only";
import { sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import { SCORING_VERSION } from "@/lib/score/score";
import type { ContactTier, EntityType, GapSignal } from "@/lib/score/types";
import {
  PIPELINE_STATUSES,
  type LeadDetail,
  type ScoreComponentsJson,
  type LeadRow,
  type PipelineBoard,
  type PipelineStatus,
} from "./constants";

/**
 * Every read the dashboard performs, in one place.
 *
 * These are hand-written SQL rather than query-builder chains because each one
 * joins five tables and selects a jsonb path or two; the SQL is the clearer
 * artefact, and it is what would be pasted into Supabase's editor to debug a
 * number the operator disagrees with.
 */

export {
  PIPELINE_STATUSES,
  STATUS_LABELS,
} from "./constants";
export type {
  LeadDetail,
  LeadRow,
  PipelineBoard,
  PipelineStatus,
  ScoreComponentsJson,
} from "./constants";

export type LeadSort = "score" | "reviews" | "rating" | "name" | "recent";

export interface LeadFilters {
  q?: string;
  status?: PipelineStatus | "all";
  entity?: EntityType | "all";
  tier?: ContactTier | "all";
  minScore?: number;
  /** Only leads at or above the current threshold. */
  qualifiedOnly?: boolean;
  briefed?: "yes" | "no" | "all";
  sort?: LeadSort;
  dir?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

const SORT_COLUMNS: Record<LeadSort, string> = {
  score: "s.total",
  reviews: "b.google_review_count",
  rating: "b.google_rating",
  name: "lower(b.name)",
  recent: "b.first_seen_at",
};

/**
 * The leads table.
 *
 * Businesses with no score yet are included on purpose — "sourced but never
 * enriched" is a state the operator needs to be able to see and act on, and
 * hiding it would make the funnel numbers impossible to reconcile.
 */
export async function listLeads(filters: LeadFilters = {}): Promise<LeadRow[]> {
  const {
    q,
    status = "all",
    entity = "all",
    tier = "all",
    minScore,
    qualifiedOnly = false,
    briefed = "all",
    sort = "score",
    dir = "desc",
    limit = 100,
    offset = 0,
  } = filters;

  const conditions: SQL[] = [];

  if (q && q.trim()) {
    const pattern = `%${q.trim().toLowerCase()}%`;
    conditions.push(
      sql`(lower(b.name) like ${pattern} or lower(coalesce(b.city, '')) like ${pattern} or lower(coalesce(b.google_category, '')) like ${pattern})`,
    );
  }
  if (status !== "all") {
    conditions.push(sql`coalesce(p.status::text, 'new') = ${status}`);
  }
  if (entity !== "all") {
    conditions.push(sql`s.entity_type::text = ${entity}`);
  }
  if (tier !== "all") {
    conditions.push(sql`s.contact_tier::text = ${tier}`);
  }
  if (minScore !== undefined) {
    conditions.push(sql`coalesce(s.total, 0) >= ${minScore}`);
  }
  if (qualifiedOnly) {
    conditions.push(sql`coalesce((s.components ->> 'excluded')::boolean, false) = false`);
  }
  if (briefed === "yes") conditions.push(sql`br.id is not null`);
  if (briefed === "no") conditions.push(sql`br.id is null`);

  const where =
    conditions.length > 0
      ? sql`where ${sql.join(conditions, sql` and `)}`
      : sql``;

  const orderColumn = SORT_COLUMNS[sort] ?? SORT_COLUMNS.score;
  const direction = dir === "asc" ? "asc" : "desc";

  const rows = await db.execute<Record<string, unknown>>(sql`
    select b.id,
           b.name,
           b.city,
           b.google_category     as "category",
           b.phone_e164          as "phoneE164",
           b.website_url         as "websiteUrl",
           b.google_rating       as "rating",
           b.google_review_count as "reviewCount",
           s.total               as "score",
           s.entity_type         as "entityType",
           s.contact_tier        as "contactTier",
           (s.components -> 'gaps') as "gaps",
           e.tech_stack          as "techStack",
           e.domain_age_years    as "domainAgeYears",
           e.crawl_status        as "crawlStatus",
           e.email,
           coalesce(p.status::text, 'new') as "status",
           p.next_action_at      as "nextActionAt",
           (br.id is not null)   as "hasBrief",
           (sup.id is not null)  as "suppressed"
      from businesses b
      left join scores s on s.business_id = b.id and s.scoring_version = ${SCORING_VERSION}
      left join enrichment e on e.business_id = b.id
      left join pipeline p on p.business_id = b.id
      left join briefs br on br.business_id = b.id
      left join suppressions sup
             on (sup.phone_e164 is not null and sup.phone_e164 = b.phone_e164)
             or (sup.root_domain is not null and sup.root_domain = b.root_domain)
    ${where}
     order by ${sql.raw(orderColumn)} ${sql.raw(direction)} nulls last, b.name asc
     limit ${Math.max(1, Math.floor(limit))}
    offset ${Math.max(0, Math.floor(offset))}
  `);

  return [...rows].map(toLeadRow);
}

function toLeadRow(row: Record<string, unknown>): LeadRow {
  return {
    id: String(row.id),
    name: String(row.name),
    city: asNullableString(row.city),
    category: asNullableString(row.category),
    phoneE164: asNullableString(row.phoneE164),
    websiteUrl: asNullableString(row.websiteUrl),
    rating: asNumber(row.rating),
    reviewCount: asNumber(row.reviewCount),
    score: asNumber(row.score),
    entityType: (row.entityType as EntityType | null) ?? null,
    contactTier: (row.contactTier as ContactTier | null) ?? null,
    gaps: Array.isArray(row.gaps) ? (row.gaps as GapSignal[]) : [],
    techStack: Array.isArray(row.techStack) ? (row.techStack as string[]) : [],
    domainAgeYears: asNumber(row.domainAgeYears),
    crawlStatus: asNullableString(row.crawlStatus),
    email: asNullableString(row.email),
    status: (row.status as PipelineStatus) ?? "new",
    nextActionAt: row.nextActionAt ? new Date(String(row.nextActionAt)) : null,
    hasBrief: Boolean(row.hasBrief),
    suppressed: Boolean(row.suppressed),
  };
}

// ---------------------------------------------------------------------------
// Lead detail
// ---------------------------------------------------------------------------

export async function getLeadDetail(id: string): Promise<LeadDetail | null> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    select b.*,
           s.total               as "score",
           s.entity_type         as "entityType",
           s.contact_tier        as "contactTier",
           s.components          as "components",
           e.email, e.whatsapp_phone as "whatsappPhone",
           e.linkedin_url as "linkedinUrl", e.instagram_url as "instagramUrl",
           e.facebook_url as "facebookUrl", e.x_url as "xUrl",
           e.contact_form_url as "contactFormUrl",
           e.tech_stack as "techStack", e.has_booking as "hasBooking",
           e.has_chat as "hasChat", e.has_online_payment as "hasOnlinePayment",
           e.domain_registered_at as "domainRegisteredAt",
           e.domain_age_years as "domainAgeYears",
           e.crawl_status as "crawlStatus", e.crawl_error as "crawlError",
           e.fetched_at as "fetchedAt",
           coalesce(p.status::text, 'new') as "status",
           p.owner_note as "ownerNote", p.next_action_at as "nextActionAt",
           br.pain_hypothesis as "painHypothesis", br.opening_line as "openingLine",
           br.audit_markdown as "auditMarkdown", br.model as "briefModel",
           br.effort as "briefEffort", br.generated_at as "briefGeneratedAt",
           br.regenerated_count as "regeneratedCount",
           (br.id is not null) as "hasBrief",
           (sup.id is not null) as "suppressed"
      from businesses b
      left join scores s on s.business_id = b.id and s.scoring_version = ${SCORING_VERSION}
      left join enrichment e on e.business_id = b.id
      left join pipeline p on p.business_id = b.id
      left join briefs br on br.business_id = b.id
      left join suppressions sup
             on (sup.phone_e164 is not null and sup.phone_e164 = b.phone_e164)
             or (sup.root_domain is not null and sup.root_domain = b.root_domain)
     where b.id = ${id}::uuid
     limit 1
  `);

  const row = rows[0];
  if (!row) return null;

  const base = toLeadRow({
    ...row,
    category: row.google_category,
    phoneE164: row.phone_e164,
    websiteUrl: row.website_url,
    rating: row.google_rating,
    reviewCount: row.google_review_count,
    gaps: (row.components as ScoreComponentsJson | null)?.gaps ?? [],
  });

  return {
    ...base,
    address: asNullableString(row.address),
    countryCode: asNullableString(row.country_code),
    googleMapsUrl: asNullableString(row.google_maps_url),
    bookOnlineUrl: asNullableString(row.book_online_url),
    unclaimedListing: row.unclaimed_listing === null ? null : Boolean(row.unclaimed_listing),
    businessStatus: String(row.business_status),
    firstSeenAt: new Date(String(row.first_seen_at)),
    lastSeenAt: new Date(String(row.last_seen_at)),
    placeId: asNullableString(row.place_id),
    rootDomain: asNullableString(row.root_domain),

    whatsappPhone: asNullableString(row.whatsappPhone),
    linkedinUrl: asNullableString(row.linkedinUrl),
    instagramUrl: asNullableString(row.instagramUrl),
    facebookUrl: asNullableString(row.facebookUrl),
    xUrl: asNullableString(row.xUrl),
    contactFormUrl: asNullableString(row.contactFormUrl),
    hasBooking: row.hasBooking === null ? null : Boolean(row.hasBooking),
    hasChat: row.hasChat === null ? null : Boolean(row.hasChat),
    hasOnlinePayment: row.hasOnlinePayment === null ? null : Boolean(row.hasOnlinePayment),
    domainRegisteredAt: asNullableString(row.domainRegisteredAt),
    fetchedAt: row.fetchedAt ? new Date(String(row.fetchedAt)) : null,
    crawlError: asNullableString(row.crawlError),

    components: (row.components as ScoreComponentsJson | null) ?? null,
    ownerNote: asNullableString(row.ownerNote),
    brief: row.painHypothesis
      ? {
          painHypothesis: String(row.painHypothesis),
          openingLine: String(row.openingLine),
          auditMarkdown: String(row.auditMarkdown),
          model: String(row.briefModel),
          effort: String(row.briefEffort),
          generatedAt: new Date(String(row.briefGeneratedAt)),
          regeneratedCount: Number(row.regeneratedCount ?? 0),
        }
      : null,
  };
}

/**
 * The lead either side of this one in score order.
 *
 * This is what lets the operator work a queue without going back to the list —
 * the single interaction the spec calls out as the difference between a table
 * and a working surface (§12).
 */
export async function getNeighbours(id: string): Promise<{
  previous: { id: string; name: string } | null;
  next: { id: string; name: string } | null;
}> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    with ranked as (
      select b.id, b.name,
             row_number() over (order by coalesce(s.total, -1) desc, b.name asc) as rn
        from businesses b
        left join scores s on s.business_id = b.id and s.scoring_version = ${SCORING_VERSION}
    ),
    current as (select rn from ranked where id = ${id}::uuid)
    select r.id, r.name, r.rn - (select rn from current) as offset_from_current
      from ranked r
     where r.rn in ((select rn - 1 from current), (select rn + 1 from current))
  `);

  let previous: { id: string; name: string } | null = null;
  let next: { id: string; name: string } | null = null;

  for (const row of rows) {
    const entry = { id: String(row.id), name: String(row.name) };
    if (Number(row.offset_from_current) < 0) previous = entry;
    else next = entry;
  }

  return { previous, next };
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export interface FunnelSnapshot {
  sourced: number;
  enriched: number;
  scored: number;
  qualified: number;
  briefed: number;
  contacted: number;
  replied: number;
  callsBooked: number;
  won: number;
  dead: number;
}

export async function getFunnel(threshold: number): Promise<FunnelSnapshot> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    select
      (select count(*)::int from businesses) as sourced,
      (select count(*)::int from enrichment where crawl_status in ('ok', 'no_site')) as enriched,
      (select count(*)::int from scores where scoring_version = ${SCORING_VERSION}) as scored,
      (select count(*)::int from scores
        where scoring_version = ${SCORING_VERSION}
          and total >= ${threshold}
          and coalesce((components ->> 'excluded')::boolean, false) = false) as qualified,
      (select count(*)::int from briefs) as briefed,
      (select count(*)::int from pipeline where status = 'contacted') as contacted,
      (select count(*)::int from pipeline where status = 'replied') as replied,
      (select count(*)::int from pipeline where status = 'call_booked') as calls_booked,
      (select count(*)::int from pipeline where status = 'won') as won,
      (select count(*)::int from pipeline where status = 'dead') as dead
  `);

  const row = rows[0] ?? {};
  return {
    sourced: Number(row.sourced ?? 0),
    enriched: Number(row.enriched ?? 0),
    scored: Number(row.scored ?? 0),
    qualified: Number(row.qualified ?? 0),
    briefed: Number(row.briefed ?? 0),
    contacted: Number(row.contacted ?? 0),
    replied: Number(row.replied ?? 0),
    callsBooked: Number(row.calls_booked ?? 0),
    won: Number(row.won ?? 0),
    dead: Number(row.dead ?? 0),
  };
}

export interface SpendSnapshot {
  serpapiSearchesThisMonth: number;
  apifyCreditsThisMonth: number;
  geminiCallsThisMonth: number;
  briefsThisMonth: number;
}

/** Month-to-date provider spend, for the quota meters. */
export async function getSpend(): Promise<SpendSnapshot> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    select
      coalesce(sum(units) filter (where provider = 'serpapi'), 0)::float as serpapi,
      coalesce(sum(units) filter (where provider = 'apify'), 0)::float   as apify,
      coalesce(sum(units) filter (where provider = 'gemini'), 0)::float  as gemini,
      coalesce(sum(units) filter (where provider = 'claude'), 0)::float  as claude
      from spend_ledger
     where occurred_at >= date_trunc('month', now())
  `);

  const row = rows[0] ?? {};
  return {
    serpapiSearchesThisMonth: Number(row.serpapi ?? 0),
    apifyCreditsThisMonth: Number(row.apify ?? 0),
    geminiCallsThisMonth: Number(row.gemini ?? 0),
    briefsThisMonth: Number(row.claude ?? 0),
  };
}

/** Leads due a follow-up today or overdue, plus today's untouched queue. */
export async function getFollowUps(limit = 20): Promise<LeadRow[]> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    select b.id, b.name, b.city, b.google_category as "category",
           b.phone_e164 as "phoneE164", b.website_url as "websiteUrl",
           b.google_rating as "rating", b.google_review_count as "reviewCount",
           s.total as "score", s.entity_type as "entityType",
           s.contact_tier as "contactTier", (s.components -> 'gaps') as "gaps",
           e.tech_stack as "techStack", e.domain_age_years as "domainAgeYears",
           e.crawl_status as "crawlStatus", e.email,
           p.status::text as "status", p.next_action_at as "nextActionAt",
           (br.id is not null) as "hasBrief", false as "suppressed"
      from pipeline p
      join businesses b on b.id = p.business_id
      left join scores s on s.business_id = b.id and s.scoring_version = ${SCORING_VERSION}
      left join enrichment e on e.business_id = b.id
      left join briefs br on br.business_id = b.id
     where p.next_action_at is not null
       and p.next_action_at <= now()
       and p.status not in ('won', 'dead')
     order by p.next_action_at asc
     limit ${limit}
  `);

  return [...rows].map(toLeadRow);
}

// ---------------------------------------------------------------------------
// Pipeline board
// ---------------------------------------------------------------------------

export async function getBoard(perColumn = 50): Promise<PipelineBoard> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    with ranked as (
      select b.id, b.name, b.city, b.google_category as category,
             b.phone_e164, b.website_url, b.google_rating, b.google_review_count,
             s.total, s.entity_type, s.contact_tier, (s.components -> 'gaps') as gaps,
             e.tech_stack, e.domain_age_years, e.crawl_status, e.email,
             coalesce(p.status::text, 'new') as status,
             p.next_action_at,
             (br.id is not null) as has_brief,
             row_number() over (
               partition by coalesce(p.status::text, 'new')
               order by coalesce(s.total, -1) desc, b.name asc
             ) as rn
        from businesses b
        left join scores s on s.business_id = b.id and s.scoring_version = ${SCORING_VERSION}
        left join enrichment e on e.business_id = b.id
        left join pipeline p on p.business_id = b.id
        left join briefs br on br.business_id = b.id
    )
    select * from ranked where rn <= ${perColumn}
  `);

  const board = Object.fromEntries(
    PIPELINE_STATUSES.map((status) => [status, [] as LeadRow[]]),
  ) as PipelineBoard;

  for (const row of rows) {
    const lead = toLeadRow({
      id: row.id,
      name: row.name,
      city: row.city,
      category: row.category,
      phoneE164: row.phone_e164,
      websiteUrl: row.website_url,
      rating: row.google_rating,
      reviewCount: row.google_review_count,
      score: row.total,
      entityType: row.entity_type,
      contactTier: row.contact_tier,
      gaps: row.gaps,
      techStack: row.tech_stack,
      domainAgeYears: row.domain_age_years,
      crawlStatus: row.crawl_status,
      email: row.email,
      status: row.status,
      nextActionAt: row.next_action_at,
      hasBrief: row.has_brief,
      suppressed: false,
    });
    board[lead.status]?.push(lead);
  }

  return board;
}

// ---------------------------------------------------------------------------

function asNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}
