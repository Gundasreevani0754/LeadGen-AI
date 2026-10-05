import "server-only";
import { and, count, desc, eq, inArray, or, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  businesses,
  pipeline,
  runResults,
  searchRuns,
  spendLedger,
  suppressions,
} from "@/db/schema";
import {
  emptyIndex,
  prepare,
  splitBatch,
  type KnownIndex,
  type PreparedPlace,
} from "./dedupe";
import { getSource } from "./sources";
import type { LeadSource } from "./sources/types";

export interface RunRequest {
  niche: string;
  city: string;
  limit: number;
  provider: LeadSource["name"];
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

export interface RunPreview {
  unitsRequired: number;
  provider: LeadSource["name"];
  /** How many times this exact niche + city has been sourced before. */
  priorRuns: number;
  lastRunAt: Date | null;
  /** Businesses already on file from previous runs of this query. */
  knownFromQuery: number;
  /** Of the last run's results, how many were already known. */
  lastDuplicateRate: number | null;
}

/**
 * What a run will cost, and what history says about repeating it.
 *
 * A caveat worth stating plainly: for a query that has never been run, there is
 * no way to know the duplicate rate without spending the search — the provider
 * bills on request, not on novelty. The real protection this gives the operator
 * is on *repeat* queries, which is exactly where quota actually gets wasted.
 */
export async function previewRun({
  niche,
  city,
  limit,
  provider,
}: RunRequest): Promise<RunPreview> {
  const source = getSource(provider);

  const prior = await db
    .select({
      id: searchRuns.id,
      startedAt: searchRuns.startedAt,
      returnedCount: searchRuns.returnedCount,
      duplicateCount: searchRuns.duplicateCount,
    })
    .from(searchRuns)
    .where(
      and(
        eq(sql`lower(${searchRuns.niche})`, niche.trim().toLowerCase()),
        eq(sql`lower(${searchRuns.city})`, city.trim().toLowerCase()),
        eq(searchRuns.status, "completed"),
      ),
    )
    .orderBy(desc(searchRuns.startedAt));

  const [known] = await db
    .select({ n: count() })
    .from(runResults)
    .innerJoin(searchRuns, eq(runResults.runId, searchRuns.id))
    .where(
      and(
        eq(sql`lower(${searchRuns.niche})`, niche.trim().toLowerCase()),
        eq(sql`lower(${searchRuns.city})`, city.trim().toLowerCase()),
      ),
    );

  const last = prior[0];

  return {
    unitsRequired: source.estimateUnits(limit),
    provider,
    priorRuns: prior.length,
    lastRunAt: last?.startedAt ?? null,
    knownFromQuery: known?.n ?? 0,
    lastDuplicateRate:
      last && last.returnedCount > 0
        ? last.duplicateCount / last.returnedCount
        : null,
  };
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

export interface RunResult {
  runId: string;
  returned: number;
  fresh: number;
  duplicates: number;
  suppressed: number;
  unitsSpent: number;
}

export async function executeRun(request: RunRequest): Promise<RunResult> {
  const { niche, city, limit, provider } = request;
  const source = getSource(provider);

  const [run] = await db
    .insert(searchRuns)
    .values({
      niche: niche.trim(),
      city: city.trim(),
      provider,
      requestedCount: limit,
      status: "running",
    })
    .returning({ id: searchRuns.id });

  try {
    const { places, unitsSpent } = await source.search({ niche, city, limit });
    const prepared = places.map((place) => prepare(place, city));

    const known = await loadKnownIndex(prepared);
    const suppressionSets = await loadSuppressions();
    const split = splitBatch(prepared, known, suppressionSets);

    const insertedIds = await insertFresh(split.fresh);
    const touchedIds = await touchExisting(split.duplicates.map((d) => d.place));

    await db
      .insert(runResults)
      .values([
        ...insertedIds.map((id) => ({ runId: run.id, businessId: id, wasNew: true })),
        ...touchedIds.map((id) => ({ runId: run.id, businessId: id, wasNew: false })),
      ])
      .onConflictDoNothing();

    await db.insert(spendLedger).values({
      provider,
      operation: "search",
      units: String(unitsSpent),
      runId: run.id,
    });

    await db
      .update(searchRuns)
      .set({
        returnedCount: places.length,
        newCount: split.fresh.length,
        duplicateCount: split.duplicates.length,
        unitsSpent: String(unitsSpent),
        status: "completed",
        finishedAt: new Date(),
      })
      .where(eq(searchRuns.id, run.id));

    return {
      runId: run.id,
      returned: places.length,
      fresh: split.fresh.length,
      duplicates: split.duplicates.length,
      suppressed: split.suppressed.length,
      unitsSpent,
    };
  } catch (error) {
    await db
      .update(searchRuns)
      .set({
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        finishedAt: new Date(),
      })
      .where(eq(searchRuns.id, run.id));
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Database helpers
// ---------------------------------------------------------------------------

/** Loads only the rows whose keys could possibly collide with this batch. */
async function loadKnownIndex(places: PreparedPlace[]): Promise<KnownIndex> {
  const index = emptyIndex();
  if (places.length === 0) return index;

  const placeIds = places.map((p) => p.keys.placeId).filter(isString);
  const phones = places.map((p) => p.keys.phoneE164).filter(isString);
  const domains = places.map((p) => p.keys.rootDomain).filter(isString);

  const conditions = [
    placeIds.length ? inArray(businesses.placeId, placeIds) : null,
    phones.length ? inArray(businesses.phoneE164, phones) : null,
    domains.length ? inArray(businesses.rootDomain, domains) : null,
  ].filter((c) => c !== null);

  if (conditions.length === 0) return index;

  const rows = await db
    .select({
      placeId: businesses.placeId,
      phoneE164: businesses.phoneE164,
      rootDomain: businesses.rootDomain,
      name: businesses.name,
      city: businesses.city,
    })
    .from(businesses)
    .where(or(...conditions));

  for (const row of rows) {
    if (row.placeId) index.placeIds.add(row.placeId);
    if (row.phoneE164) index.phones.add(row.phoneE164);
    if (row.rootDomain) index.domains.add(row.rootDomain);
    if (row.city) {
      index.nameCityKeys.add(
        `${row.name.toLowerCase()}|${row.city.toLowerCase()}`,
      );
    }
  }

  return index;
}

async function loadSuppressions() {
  const rows = await db
    .select({
      phoneE164: suppressions.phoneE164,
      rootDomain: suppressions.rootDomain,
    })
    .from(suppressions);

  return {
    phones: new Set(rows.map((r) => r.phoneE164).filter(isString)),
    domains: new Set(rows.map((r) => r.rootDomain).filter(isString)),
  };
}

async function insertFresh(places: PreparedPlace[]): Promise<string[]> {
  if (places.length === 0) return [];

  const rows = places.map(({ raw, name, city, keys, countryCode }) => ({
    name,
    placeId: keys.placeId,
    phoneRaw: raw.phoneRaw,
    phoneE164: keys.phoneE164,
    websiteUrl: raw.websiteUrl,
    rootDomain: keys.rootDomain,
    address: raw.address,
    city,
    countryCode,
    lat: raw.lat,
    lng: raw.lng,
    googleRating: raw.rating === null ? null : String(raw.rating),
    googleReviewCount: raw.reviewCount,
    googleCategory: raw.category,
    googleMapsUrl: raw.mapsUrl,
    bookOnlineUrl: raw.bookOnlineUrl,
    unclaimedListing: raw.unclaimedListing,
    businessStatus: raw.permanentlyClosed
      ? ("closed_permanently" as const)
      : ("operational" as const),
  }));

  // onConflictDoNothing is the last line of defence: two concurrent runs could
  // race past the in-memory dedupe, and the unique indexes must win, not error.
  const inserted = await db
    .insert(businesses)
    .values(rows)
    .onConflictDoNothing()
    .returning({ id: businesses.id });

  const ids = inserted.map((r) => r.id);

  if (ids.length > 0) {
    await db
      .insert(pipeline)
      .values(ids.map((businessId) => ({ businessId })))
      .onConflictDoNothing();
  }

  return ids;
}

/** Records that a known business was seen again, without overwriting anything. */
async function touchExisting(places: PreparedPlace[]): Promise<string[]> {
  if (places.length === 0) return [];

  const placeIds = places.map((p) => p.keys.placeId).filter(isString);
  const phones = places.map((p) => p.keys.phoneE164).filter(isString);
  const domains = places.map((p) => p.keys.rootDomain).filter(isString);

  const conditions = [
    placeIds.length ? inArray(businesses.placeId, placeIds) : null,
    phones.length ? inArray(businesses.phoneE164, phones) : null,
    domains.length ? inArray(businesses.rootDomain, domains) : null,
  ].filter((c) => c !== null);

  if (conditions.length === 0) return [];

  const updated = await db
    .update(businesses)
    .set({ lastSeenAt: new Date() })
    .where(or(...conditions))
    .returning({ id: businesses.id });

  return updated.map((r) => r.id);
}

const isString = (v: string | null): v is string => typeof v === "string";
