/**
 * The shape every provider must emit. Adding a provider means writing one
 * adapter that produces `RawPlace[]` — nothing downstream changes.
 *
 * Fields mirror what Google Maps search results actually contain (verified
 * against a live SerpApi response, see __fixtures__/serpapi-maps.json), not
 * what we wish they contained.
 */
export interface RawPlace {
  /** Google's stable place identifier, when the provider exposes it. */
  providerPlaceId: string | null;
  name: string;
  phoneRaw: string | null;
  websiteUrl: string | null;
  address: string | null;
  countryName: string | null;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  reviewCount: number | null;
  /** Primary category string, e.g. "Dental clinic". */
  category: string | null;
  categories: string[];
  mapsUrl: string | null;
  /** Present when the listing links out to a booking flow. */
  bookOnlineUrl: string | null;
  /** True when the owner has never claimed the Business Profile. */
  unclaimedListing: boolean;
  permanentlyClosed: boolean;
}

export interface SearchQuery {
  niche: string;
  city: string;
  /** Upper bound on results. Providers page internally to reach it. */
  limit: number;
}

export interface SearchOutcome {
  places: RawPlace[];
  /** Provider units actually consumed — searches for SerpApi, credits for Apify. */
  unitsSpent: number;
}

export interface LeadSource {
  readonly name: "serpapi" | "apify";
  /** Results returned per unit of quota. Drives the dry-run estimate. */
  readonly resultsPerUnit: number;
  search(query: SearchQuery): Promise<SearchOutcome>;
  /** Units a search of this size will cost, before running it. */
  estimateUnits(limit: number): number;
}

export class LeadSourceError extends Error {
  constructor(
    readonly provider: string,
    message: string,
    readonly cause?: unknown,
  ) {
    super(`[${provider}] ${message}`);
    this.name = "LeadSourceError";
  }
}
