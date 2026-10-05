import "server-only";
import { sql } from "drizzle-orm";

import { db } from "@/db";
import type { PipelineStatus } from "@/lib/leads/constants";
import { SCORING_VERSION } from "@/lib/score/score";
import type { ContactTier, EntityType, ScoreComponents } from "@/lib/score/types";
import { summarize, type FeedbackReport, type OutcomeRow } from "./analysis";

/**
 * Loads the join the feedback loop needs: outcomes against score components.
 *
 * `wasContacted` comes from `pipeline_events` rather than from the current
 * status, because a lead that was contacted and then marked dead is exactly the
 * evidence this report exists to collect — reading only the current status would
 * throw away every negative result.
 */

interface OutcomeDbRow {
  businessId: string;
  status: PipelineStatus;
  total: number;
  components: ScoreComponents;
  entityType: EntityType;
  contactTier: ContactTier;
  reviewCount: number | null;
  rating: string | null;
  domainAgeYears: string | null;
  wasContacted: boolean;
}

const WORKED_STATUSES = ["contacted", "replied", "call_booked", "won", "dead"];

export async function loadOutcomes(): Promise<OutcomeRow[]> {
  const rows = await db.execute<OutcomeDbRow & Record<string, unknown>>(sql`
    select b.id                  as "businessId",
           coalesce(p.status::text, 'new') as "status",
           s.total,
           s.components,
           s.entity_type         as "entityType",
           s.contact_tier        as "contactTier",
           b.google_review_count as "reviewCount",
           b.google_rating       as "rating",
           e.domain_age_years    as "domainAgeYears",
           exists (
             select 1 from pipeline_events ev
              where ev.business_id = b.id
                and ev.to_status::text in (${sql.join(
                  WORKED_STATUSES.map((status) => sql`${status}`),
                  sql`, `,
                )})
           ) as "wasContacted"
      from scores s
      join businesses b on b.id = s.business_id
      left join pipeline p on p.business_id = b.id
      left join enrichment e on e.business_id = b.id
     where s.scoring_version = ${SCORING_VERSION}
  `);

  return [...rows].map((row) => ({
    businessId: row.businessId,
    status: row.status,
    total: Number(row.total),
    components: row.components,
    entityType: row.entityType,
    contactTier: row.contactTier,
    reviewCount: row.reviewCount === null ? null : Number(row.reviewCount),
    rating: row.rating === null ? null : Number(row.rating),
    domainAgeYears: row.domainAgeYears === null ? null : Number(row.domainAgeYears),
    wasContacted: Boolean(row.wasContacted),
  }));
}

export async function getFeedbackReport(): Promise<FeedbackReport> {
  return summarize(await loadOutcomes());
}

export interface ActivityEvent {
  id: string;
  fromStatus: PipelineStatus | null;
  toStatus: PipelineStatus;
  note: string | null;
  occurredAt: Date;
}

/** One lead's history, newest first, for the timeline on lead detail. */
export async function getActivity(businessId: string): Promise<ActivityEvent[]> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    select id,
           from_status::text as "fromStatus",
           to_status::text   as "toStatus",
           note,
           occurred_at       as "occurredAt"
      from pipeline_events
     where business_id = ${businessId}::uuid
     order by occurred_at desc
     limit 50
  `);

  return [...rows].map((row) => ({
    id: String(row.id),
    fromStatus: (row.fromStatus as PipelineStatus | null) ?? null,
    toStatus: row.toStatus as PipelineStatus,
    note: row.note === null || row.note === undefined ? null : String(row.note),
    occurredAt: new Date(String(row.occurredAt)),
  }));
}

export interface SuppressionRow {
  id: string;
  phoneE164: string | null;
  rootDomain: string | null;
  reason: string;
  note: string | null;
  createdAt: Date;
  /** The business it came from, when one still matches. */
  businessName: string | null;
  businessId: string | null;
}

/**
 * The suppression list, with the business each entry came from.
 *
 * Suppression is by phone and domain rather than by id, so an entry can outlive
 * the row that created it — which is the point (§15.6), but it does mean the
 * name can be null.
 */
export async function listSuppressions(limit = 200): Promise<SuppressionRow[]> {
  const rows = await db.execute<Record<string, unknown>>(sql`
    select s.id,
           s.phone_e164  as "phoneE164",
           s.root_domain as "rootDomain",
           s.reason::text as "reason",
           s.note,
           s.created_at  as "createdAt",
           b.name        as "businessName",
           b.id          as "businessId"
      from suppressions s
      left join lateral (
        select id, name from businesses
         where (s.phone_e164 is not null and phone_e164 = s.phone_e164)
            or (s.root_domain is not null and root_domain = s.root_domain)
         limit 1
      ) b on true
     order by s.created_at desc
     limit ${limit}
  `);

  return [...rows].map((row) => ({
    id: String(row.id),
    phoneE164: row.phoneE164 === null ? null : String(row.phoneE164),
    rootDomain: row.rootDomain === null ? null : String(row.rootDomain),
    reason: String(row.reason),
    note: row.note === null || row.note === undefined ? null : String(row.note),
    createdAt: new Date(String(row.createdAt)),
    businessName: row.businessName ? String(row.businessName) : null,
    businessId: row.businessId ? String(row.businessId) : null,
  }));
}
