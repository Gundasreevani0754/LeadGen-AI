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
 * SerpApi Google Maps adapter — the primary source.
 *
 * Quota: 250 searches/month on the free plan. One page of 20 results costs one
 * search, so `limit` is rounded up to whole pages and every page is counted.
 */

const RESULTS_PER_PAGE = 20;
const ENDPOINT = "https://serpapi.com/search.json";

/** The subset of the SerpApi response we rely on. */
interface SerpApiLocalResult {
  place_id?: string;
  title?: string;
  phone?: string;
  website?: string;
  address?: string;
  country?: string;
  gps_coordinates?: { latitude?: number; longitude?: number };
  rating?: number;
  reviews?: number;
  type?: string;
  types?: string[];
  place_id_search?: string;
  book_online?: { link?: string } | string;
  unclaimed_listing?: boolean;
  open_state?: string;
  permanently_closed?: boolean;
}

export function mapSerpApiResult(raw: SerpApiLocalResult): RawPlace | null {
  const name = raw.title?.trim();
  if (!name) return null;

  const bookOnline =
    typeof raw.book_online === "string"
      ? raw.book_online
      : (raw.book_online?.link ?? null);

  return {
    providerPlaceId: raw.place_id ?? null,
    name,
    phoneRaw: raw.phone ?? null,
    websiteUrl: raw.website ?? null,
    address: raw.address ?? null,
    countryName: raw.country ?? null,
    lat: raw.gps_coordinates?.latitude ?? null,
    lng: raw.gps_coordinates?.longitude ?? null,
    rating: raw.rating ?? null,
    reviewCount: raw.reviews ?? null,
    category: raw.type ?? raw.types?.[0] ?? null,
    categories: raw.types ?? [],
    mapsUrl: raw.place_id
      ? `https://www.google.com/maps/place/?q=place_id:${raw.place_id}`
      : null,
    bookOnlineUrl: bookOnline,
    unclaimedListing: raw.unclaimed_listing === true,
    permanentlyClosed:
      raw.permanently_closed === true ||
      /permanently closed/i.test(raw.open_state ?? ""),
  };
}

export class SerpApiSource implements LeadSource {
  readonly name = "serpapi" as const;
  readonly resultsPerUnit = RESULTS_PER_PAGE;

  estimateUnits(limit: number): number {
    return Math.max(1, Math.ceil(limit / RESULTS_PER_PAGE));
  }

  async search({ niche, city, limit }: SearchQuery): Promise<SearchOutcome> {
    const pages = this.estimateUnits(limit);
    const places: RawPlace[] = [];
    let unitsSpent = 0;

    for (let page = 0; page < pages; page++) {
      const url = new URL(ENDPOINT);
      url.searchParams.set("engine", "google_maps");
      url.searchParams.set("type", "search");
      url.searchParams.set("q", `${niche} in ${city}`);
      url.searchParams.set("hl", "en");
      url.searchParams.set("start", String(page * RESULTS_PER_PAGE));
      url.searchParams.set("api_key", env.SERPAPI_KEY);

      let payload: { local_results?: SerpApiLocalResult[]; error?: string };
      try {
        const response = await fetch(url, { cache: "no-store" });
        payload = await response.json();
        if (!response.ok) {
          throw new LeadSourceError(
            this.name,
            payload.error ?? `HTTP ${response.status}`,
          );
        }
      } catch (error) {
        if (error instanceof LeadSourceError) throw error;
        throw new LeadSourceError(this.name, "request failed", error);
      }

      // A page request is billed whether or not it returned anything.
      unitsSpent += 1;

      if (payload.error) {
        throw new LeadSourceError(this.name, payload.error);
      }

      const batch = payload.local_results ?? [];
      for (const item of batch) {
        const place = mapSerpApiResult(item);
        if (place) places.push(place);
      }

      // Short page means we've reached the end of the result set.
      if (batch.length < RESULTS_PER_PAGE) break;
    }

    return { places: places.slice(0, limit), unitsSpent };
  }
}
