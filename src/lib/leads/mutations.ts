import "server-only";
import { eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import { businesses, pipeline, pipelineEvents, suppressions } from "@/db/schema";
import type { PipelineStatus } from "./queries";

/**
 * Every write the dashboard performs.
 *
 * Status changes are double-written: the current state goes to `pipeline`, and
 * the transition goes to `pipeline_events`. The event log is what the scoring
 * feedback loop reads (§14), so losing a transition means losing evidence.
 */

export async function setStatus(
  businessIds: string[],
  status: PipelineStatus,
  note?: string,
): Promise<number> {
  if (businessIds.length === 0) return 0;

  const existing = await db
    .select({ businessId: pipeline.businessId, status: pipeline.status })
    .from(pipeline)
    .where(inArray(pipeline.businessId, businessIds));

  const previous = new Map(existing.map((row) => [row.businessId, row.status]));

  await db
    .insert(pipeline)
    .values(
      businessIds.map((businessId) => ({
        businessId,
        status,
        ownerNote: note,
        updatedAt: new Date(),
      })),
    )
    .onConflictDoUpdate({
      target: pipeline.businessId,
      set: {
        status: sql`excluded.status`,
        updatedAt: sql`excluded.updated_at`,
        ...(note === undefined ? {} : { ownerNote: sql`excluded.owner_note` }),
      },
    });

  await db.insert(pipelineEvents).values(
    businessIds.map((businessId) => ({
      businessId,
      fromStatus: previous.get(businessId) ?? null,
      toStatus: status,
      note: note ?? null,
    })),
  );

  // A lead marked dead must never resurface in any future search (§15.6).
  if (status === "dead") await suppress(businessIds, "dead");

  return businessIds.length;
}

export async function setNote(businessId: string, note: string): Promise<void> {
  await db
    .insert(pipeline)
    .values({ businessId, ownerNote: note, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: pipeline.businessId,
      set: { ownerNote: sql`excluded.owner_note`, updatedAt: sql`excluded.updated_at` },
    });
}

export async function setNextAction(
  businessId: string,
  date: Date | null,
): Promise<void> {
  await db
    .insert(pipeline)
    .values({ businessId, nextActionAt: date, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: pipeline.businessId,
      set: {
        nextActionAt: sql`excluded.next_action_at`,
        updatedAt: sql`excluded.updated_at`,
      },
    });
}

/**
 * Suppression is by phone and domain, not by business id, so a re-listed or
 * renamed business with the same number stays suppressed forever.
 */
export async function suppress(
  businessIds: string[],
  reason: "dead" | "do_not_contact" | "bounced",
  note?: string,
): Promise<number> {
  if (businessIds.length === 0) return 0;

  const rows = await db
    .select({
      phoneE164: businesses.phoneE164,
      rootDomain: businesses.rootDomain,
    })
    .from(businesses)
    .where(inArray(businesses.id, businessIds));

  const values = rows
    .filter((row) => row.phoneE164 || row.rootDomain)
    .map((row) => ({
      phoneE164: row.phoneE164,
      rootDomain: row.rootDomain,
      reason,
      note: note ?? null,
    }));

  if (values.length === 0) return 0;

  // Two businesses can legitimately share a domain; the unique indexes make the
  // second insert a no-op rather than an error.
  await db.insert(suppressions).values(values).onConflictDoNothing();
  return values.length;
}

export async function unsuppress(businessId: string): Promise<void> {
  const [row] = await db
    .select({
      phoneE164: businesses.phoneE164,
      rootDomain: businesses.rootDomain,
    })
    .from(businesses)
    .where(eq(businesses.id, businessId))
    .limit(1);

  if (!row) return;

  await db
    .delete(suppressions)
    .where(
      sql`(${suppressions.phoneE164} is not null and ${suppressions.phoneE164} = ${row.phoneE164})
       or (${suppressions.rootDomain} is not null and ${suppressions.rootDomain} = ${row.rootDomain})`,
    );
}

/** Removes one suppression entry by its own id, from the Settings list. */
export async function releaseSuppression(suppressionId: string): Promise<void> {
  await db.delete(suppressions).where(eq(suppressions.id, suppressionId));
}
