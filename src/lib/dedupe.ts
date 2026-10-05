import {
  countryFromPhone,
  extractRootDomain,
  nameKey,
  normalizeName,
  normalizePhone,
} from "./normalize";
import type { RawPlace } from "./sources/types";

/**
 * Pure dedupe logic. No database, no network — so it can be tested exhaustively.
 * The persistence layer in ingest.ts supplies what already exists and applies
 * the decisions this module makes.
 */

export interface DedupeKeys {
  placeId: string | null;
  phoneE164: string | null;
  rootDomain: string | null;
  nameCityKey: string | null;
}

export interface PreparedPlace {
  raw: RawPlace;
  name: string;
  /** The city this place was searched in, preserved in its original casing. */
  city: string;
  keys: DedupeKeys;
  countryCode: string | null;
  /** True when no key at all could be derived — such a place cannot be deduped. */
  unkeyable: boolean;
}

/** Derives every dedupe key for one raw place. */
export function prepare(raw: RawPlace, city: string): PreparedPlace {
  const name = normalizeName(raw.name);
  const phoneE164 = normalizePhone(raw.phoneRaw);
  const rootDomain = extractRootDomain(raw.websiteUrl);
  const placeId = raw.providerPlaceId ?? null;

  const keys: DedupeKeys = {
    placeId,
    phoneE164,
    rootDomain,
    // Only used when nothing stronger exists.
    nameCityKey: `${nameKey(name)}|${nameKey(city)}`,
  };

  return {
    raw,
    name,
    city: normalizeName(city),
    keys,
    countryCode: countryFromPhone(raw.phoneRaw),
    unkeyable: !placeId && !phoneE164 && !rootDomain,
  };
}

/** What the caller already has in the database, indexed for lookup. */
export interface KnownIndex {
  placeIds: Set<string>;
  phones: Set<string>;
  domains: Set<string>;
  nameCityKeys: Set<string>;
}

export const emptyIndex = (): KnownIndex => ({
  placeIds: new Set<string>(),
  phones: new Set<string>(),
  domains: new Set<string>(),
  nameCityKeys: new Set<string>(),
});

export type MatchReason = "place_id" | "phone" | "domain" | "name_city" | null;

/** Which key, if any, matches something already known. Strongest key first. */
export function matchAgainst(
  keys: DedupeKeys,
  known: KnownIndex,
): MatchReason {
  if (keys.placeId && known.placeIds.has(keys.placeId)) return "place_id";
  if (keys.phoneE164 && known.phones.has(keys.phoneE164)) return "phone";
  if (keys.rootDomain && known.domains.has(keys.rootDomain)) return "domain";
  if (keys.nameCityKey && known.nameCityKeys.has(keys.nameCityKey)) {
    return "name_city";
  }
  return null;
}

export interface SplitResult {
  fresh: PreparedPlace[];
  duplicates: { place: PreparedPlace; reason: MatchReason }[];
  suppressed: PreparedPlace[];
}

/**
 * Splits a batch into what is genuinely new, what we already have, and what the
 * operator has permanently suppressed.
 *
 * Crucially, keys from places accepted earlier in the batch are folded into the
 * index as we go — a single provider response often lists the same business
 * twice (different branches sharing a phone, or a renamed duplicate listing),
 * and without this they would both be treated as new and collide on insert.
 */
export function splitBatch(
  places: PreparedPlace[],
  known: KnownIndex,
  suppressed: { phones: Set<string>; domains: Set<string> },
): SplitResult {
  const result: SplitResult = { fresh: [], duplicates: [], suppressed: [] };

  const seen: KnownIndex = {
    placeIds: new Set(known.placeIds),
    phones: new Set(known.phones),
    domains: new Set(known.domains),
    nameCityKeys: new Set(known.nameCityKeys),
  };

  for (const place of places) {
    const { phoneE164, rootDomain } = place.keys;

    const isSuppressed =
      (phoneE164 && suppressed.phones.has(phoneE164)) ||
      (rootDomain && suppressed.domains.has(rootDomain));

    if (isSuppressed) {
      result.suppressed.push(place);
      continue;
    }

    const reason = matchAgainst(place.keys, seen);
    if (reason) {
      result.duplicates.push({ place, reason });
      continue;
    }

    result.fresh.push(place);

    if (place.keys.placeId) seen.placeIds.add(place.keys.placeId);
    if (phoneE164) seen.phones.add(phoneE164);
    if (rootDomain) seen.domains.add(rootDomain);
    if (place.keys.nameCityKey) seen.nameCityKeys.add(place.keys.nameCityKey);
  }

  return result;
}
