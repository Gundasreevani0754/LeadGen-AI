import "server-only";
import { eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { briefs, spendLedger } from "@/db/schema";
import { applyRatioCap } from "@/lib/score/ratio";
import { SCORING_VERSION } from "@/lib/score/score";
import type { GapSignal } from "@/lib/score/types";
import { getSettings } from "@/lib/settings";
import { briefBatch, type ClaudeRunOptions } from "./claude";
import type { BriefInput } from "./types";

/**
 * The Phase 6 worker: pick today's leads, brief them in one Claude session,
 * write the results down, and never spend the same quota twice.
 *
 * The unique index `briefs_one_per_business` is the real guarantee (§7 rule 3).
 * Everything here is the polite version of the same rule, so the constraint is
 * never the thing that has to fire.
 */

interface EligibleRow {
  businessId: string;
  name: string;
  city: string | null;
  category: string | null;
  rating: string | null;
  reviewCount: number | null;
  websiteUrl: string | null;
  unclaimedListing: boolean | null;
  domainAgeYears: string | null;
  techStack: string[] | null;
  hasBooking: boolean | null;
  hasChat: boolean | null;
  hasOnlinePayment: boolean | null;
  total: number;
  entityType: "business" | "service_provider";
  contactTier: string;
  gaps: GapSignal[] | null;
}

/** How many briefs have been generated since midnight — the live cap counter. */
export async function briefsToday(): Promise<number> {
  const rows = await db.execute<{ n: number }>(sql`
    select count(*)::int as n
      from briefs
     where generated_at >= date_trunc('day', now())
  `);
  return rows[0]?.n ?? 0;
}

export interface BriefQuota {
  cap: number;
  usedToday: number;
  remaining: number;
  /** Total briefs ever written — the denominator the operator actually feels. */
  total: number;
}

export async function getBriefQuota(): Promise<BriefQuota> {
  const settings = await getSettings();

  try {
    const rows = await db.execute<{ today: number; total: number }>(sql`
      select
        (select count(*)::int from briefs where generated_at >= date_trunc('day', now())) as today,
        (select count(*)::int from briefs) as total
    `);

    const usedToday = rows[0]?.today ?? 0;
    return {
      cap: settings.claudeDailyBriefCap,
      usedToday,
      remaining: Math.max(0, settings.claudeDailyBriefCap - usedToday),
      total: rows[0]?.total ?? 0,
    };
  } catch (error) {
    // Fail closed. This function exists to stop the worker spending a day's
    // Claude quota in one run; a transient pool timeout reporting "nothing used
    // yet, go ahead" would defeat exactly the thing it guards. Better to skip a
    // briefing run and say why than to spend the quota on a guess.
    console.error("[brief] quota check failed — treating quota as spent:", error);

    return {
      cap: settings.claudeDailyBriefCap,
      usedToday: settings.claudeDailyBriefCap,
      remaining: 0,
      total: 0,
    };
  }
}

/**
 * Leads that have cleared scoring, have no brief, and are still worth writing
 * about. Ordered by score so a capped batch is always the best available.
 */
export async function selectEligible(options: {
  threshold: number;
  limit: number;
  businessId?: string;
  /** Include leads that already have a brief — only for an explicit regenerate. */
  includeBriefed?: boolean;
}): Promise<BriefInput[]> {
  const { threshold, limit, businessId, includeBriefed = false } = options;

  const rows = await db.execute<EligibleRow & Record<string, unknown>>(sql`
    select b.id                   as "businessId",
           b.name,
           b.city,
           b.google_category      as "category",
           b.google_rating        as "rating",
           b.google_review_count  as "reviewCount",
           b.website_url          as "websiteUrl",
           b.unclaimed_listing    as "unclaimedListing",
           e.domain_age_years     as "domainAgeYears",
           e.tech_stack           as "techStack",
           e.has_booking          as "hasBooking",
           e.has_chat             as "hasChat",
           e.has_online_payment   as "hasOnlinePayment",
           s.total,
           s.entity_type          as "entityType",
           s.contact_tier         as "contactTier",
           (s.components -> 'gaps') as "gaps"
      from scores s
      join businesses b on b.id = s.business_id
      left join enrichment e on e.business_id = b.id
      left join briefs br on br.business_id = b.id
      left join pipeline p on p.business_id = b.id
      left join suppressions sup
             on (sup.phone_e164 is not null and sup.phone_e164 = b.phone_e164)
             or (sup.root_domain is not null and sup.root_domain = b.root_domain)
     where s.scoring_version = ${SCORING_VERSION}
       and s.total >= ${threshold}
       and coalesce((s.components ->> 'excluded')::boolean, false) = false
       and s.contact_tier <> 'none'
       and sup.id is null
       and (${includeBriefed ? sql`true` : sql`br.id is null`})
       and (${businessId ? sql`b.id = ${businessId}::uuid` : sql`true`})
       and coalesce(p.status::text, 'new') in ('new', 'qualified')
     order by s.total desc, b.google_review_count desc nulls last
     limit ${Math.max(1, Math.floor(limit))}
  `);

  return [...rows].map(toBriefInput);
}

function toBriefInput(row: EligibleRow): BriefInput {
  return {
    businessId: row.businessId,
    name: row.name,
    city: row.city,
    category: row.category,
    rating: row.rating === null ? null : Number(row.rating),
    reviewCount: row.reviewCount,
    websiteUrl: row.websiteUrl,
    domainAgeYears: row.domainAgeYears === null ? null : Number(row.domainAgeYears),
    techStack: row.techStack ?? [],
    gaps: row.gaps ?? [],
    score: row.total,
    entityType: row.entityType,
    contactTier: row.contactTier,
    unclaimedListing: Boolean(row.unclaimedListing),
    hasBooking: Boolean(row.hasBooking),
    hasChat: Boolean(row.hasChat),
    hasOnlinePayment: Boolean(row.hasOnlinePayment),
  };
}

export interface BriefRunSummary {
  requested: number;
  written: number;
  skippedByCap: number;
  heldByRatio: number;
  warnings: string[];
  model: string;
  effort: string;
  inputTokens: number;
  outputTokens: number;
}

export interface BriefRunOptions {
  /** Upper bound the operator asked for; the daily cap still wins. */
  limit?: number;
  businessId?: string;
  regenerate?: boolean;
  /** Build the batch and return it without calling Claude. */
  dryRun?: boolean;
  claudeOptions?: Partial<ClaudeRunOptions>;
  onBatch?: (leads: BriefInput[]) => void;
}

/**
 * Runs one briefing batch.
 *
 * The daily cap is applied before the call, not after: quota that is not spent
 * today is still there tomorrow, and the operator's rhythm is 10 to 15 leads,
 * not "as many as the plan allows".
 */
export async function runBriefing(
  options: BriefRunOptions = {},
): Promise<BriefRunSummary> {
  const settings = await getSettings();
  const { limit, businessId, regenerate = false, dryRun = false, onBatch } = options;

  const quota = await getBriefQuota();
  const room = regenerate && businessId ? 1 : quota.remaining;
  const wanted = Math.min(limit ?? settings.claudeDailyBriefCap, room);

  const empty: BriefRunSummary = {
    requested: 0,
    written: 0,
    skippedByCap: 0,
    heldByRatio: 0,
    warnings: [],
    model: settings.claudeModel,
    effort: settings.claudeEffort,
    inputTokens: 0,
    outputTokens: 0,
  };

  if (wanted <= 0) {
    return {
      ...empty,
      warnings: [
        `Daily cap reached: ${quota.usedToday}/${quota.cap} briefs already generated today.`,
      ],
    };
  }

  // Pull more than we need so the ratio cap has something to choose between.
  const candidates = await selectEligible({
    threshold: settings.scoreThreshold,
    limit: Math.max(wanted * 4, 20),
    businessId,
    includeBriefed: regenerate,
  });

  if (candidates.length === 0) {
    return { ...empty, warnings: ["No leads are eligible for a brief right now."] };
  }

  const capped = applyRatioCap(
    candidates.map((lead) => ({
      businessId: lead.businessId,
      total: lead.score,
      entityType: lead.entityType,
      lead,
    })),
    { maxRatio: settings.serviceProviderMaxRatio, size: wanted },
  );

  const batch = capped.delivered.map((entry) => entry.lead);
  onBatch?.(batch);

  if (dryRun || batch.length === 0) {
    return {
      ...empty,
      requested: batch.length,
      heldByRatio: capped.held.length,
      warnings: dryRun ? ["Dry run — no Claude session was started."] : [],
    };
  }

  const result = await briefBatch(batch, {
    model: settings.claudeModel,
    effort: settings.claudeEffort,
    ...options.claudeOptions,
  });

  const written = await saveBriefs(result.briefs, {
    model: result.model,
    effort: result.effort,
    sessionId: result.sessionId,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    regenerate,
  });

  return {
    requested: batch.length,
    written,
    skippedByCap: Math.max(0, candidates.length - batch.length - capped.held.length),
    heldByRatio: capped.held.length,
    warnings: result.warnings,
    model: result.model,
    effort: result.effort,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  };
}

/**
 * Writes the batch and records the spend.
 *
 * Token counts are divided across the batch rather than attributed whole to each
 * lead — one session produced them all, and pretending otherwise would make the
 * ledger read fifteen times more expensive than the run actually was.
 */
async function saveBriefs(
  outputs: { businessId: string; painHypothesis: string; openingLine: string; auditMarkdown: string }[],
  meta: {
    model: string;
    effort: string;
    sessionId: string | null;
    inputTokens: number;
    outputTokens: number;
    regenerate: boolean;
  },
): Promise<number> {
  if (outputs.length === 0) return 0;

  const perLead = {
    inputTokens: Math.round(meta.inputTokens / outputs.length),
    outputTokens: Math.round(meta.outputTokens / outputs.length),
  };

  let written = 0;

  for (const output of outputs) {
    const values = {
      businessId: output.businessId,
      painHypothesis: output.painHypothesis,
      openingLine: output.openingLine,
      auditMarkdown: output.auditMarkdown,
      model: meta.model,
      effort: meta.effort,
      sessionId: meta.sessionId,
      inputTokens: perLead.inputTokens,
      outputTokens: perLead.outputTokens,
      generatedAt: new Date(),
    };

    const inserted = meta.regenerate
      ? await db
          .insert(briefs)
          .values(values)
          .onConflictDoUpdate({
            target: briefs.businessId,
            set: {
              ...values,
              regeneratedCount: sql`${briefs.regeneratedCount} + 1`,
            },
          })
          .returning({ id: briefs.id })
      : await db
          .insert(briefs)
          .values(values)
          .onConflictDoNothing()
          .returning({ id: briefs.id });

    if (inserted.length > 0) written += 1;
  }

  if (written > 0) {
    await db.insert(spendLedger).values(
      outputs.map((output) => ({
        provider: "claude",
        operation: "brief",
        units: "1",
        businessId: output.businessId,
      })),
    );
  }

  return written;
}

/** Reads one lead's brief for the lead detail page. */
export async function getBrief(businessId: string) {
  const [row] = await db
    .select()
    .from(briefs)
    .where(eq(briefs.businessId, businessId))
    .limit(1);
  return row ?? null;
}
