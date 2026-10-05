import "server-only";

import { env } from "@/env";
import {
  LeadSourceError,
  type LeadSource,
  type RawPlace,
  type SearchOutcome,
  type SearchQuery,
} from "./types";

/**
 * Apify Google Maps adapter — overflow only, used when SerpApi's monthly
 * searches run out.
 *
 * The free plan carries $5 of credits and pauses rather than billing, so the
 * worst case is a failed run, never a charge. Roughly $0.004 per place.
 */

const ACTOR_ID = "compass~crawler-google-places";
const COST_PER_PLACE_USD = 0.004;

/** Apify's dataset item shape for the Google Places crawler. */
interface ApifyPlace {
  placeId?: string;
  title?: string;
  phone?: string;
  website?: string;
  address?: string;
  countryCode?: string;
  location?: { lat?: number; lng?: number };
  totalScore?: number;
  reviewsCount?: number;
  categoryName?: string;
  categories?: string[];
  url?: string;
  bookingLinks?: { url?: string }[];
  claimThisBusiness?: boolean;
  permanentlyClosed?: boolean;
}

export function mapApifyPlace(raw: ApifyPlace): RawPlace | null {
  const name = raw.title?.trim();
  if (!name) return null;

  return {
    providerPlaceId: raw.placeId ?? null,
    name,
    phoneRaw: raw.phone ?? null,
    websiteUrl: raw.website ?? null,
    address: raw.address ?? null,
    countryName: raw.countryCode ?? null,
    lat: raw.location?.lat ?? null,
    lng: raw.location?.lng ?? null,
    rating: raw.totalScore ?? null,
    reviewCount: raw.reviewsCount ?? null,
    category: raw.categoryName ?? raw.categories?.[0] ?? null,
    categories: raw.categories ?? [],
    mapsUrl: raw.url ?? null,
    bookOnlineUrl: raw.bookingLinks?.[0]?.url ?? null,
    // The actor reports whether the listing still invites an owner to claim it.
    unclaimedListing: raw.claimThisBusiness === true,
    permanentlyClosed: raw.permanentlyClosed === true,
  };
}

export class ApifySource implements LeadSource {
  readonly name = "apify" as const;
  /** Credits are per place, so a "unit" here is one place, not one page. */
  readonly resultsPerUnit = 1;

  estimateUnits(limit: number): number {
    return limit;
  }

  async search({ niche, city, limit }: SearchQuery): Promise<SearchOutcome> {
    const url = new URL(
      `https://api.apify.com/v2/acts/${ACTOR_ID}/run-sync-get-dataset-items`,
    );
    url.searchParams.set("token", env.APIFY_TOKEN);

    let items: ApifyPlace[];
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          searchStringsArray: [`${niche} in ${city}`],
          maxCrawledPlacesPerSearch: limit,
          language: "en",
          skipClosedPlaces: true,
        }),
      });

      if (!response.ok) {
        throw new LeadSourceError(
          this.name,
          response.status === 402
            ? "monthly credits exhausted — falls back to SerpApi next month"
            : `HTTP ${response.status}`,
        );
      }
      items = await response.json();
    } catch (error) {
      if (error instanceof LeadSourceError) throw error;
      throw new LeadSourceError(this.name, "actor run failed", error);
    }

    const places = items
      .map(mapApifyPlace)
      .filter((place): place is RawPlace => place !== null);

    return {
      places,
      // Apify bills per place actually returned, not per place requested.
      unitsSpent: Number((places.length * COST_PER_PLACE_USD).toFixed(4)),
    };
  }
}
