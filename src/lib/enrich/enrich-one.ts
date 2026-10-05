import { extractContacts, htmlToText, isComplete } from "./extract";
import { fetchSite, type FetchOptions } from "./fetcher";
import { extractWithGemini, type GeminiOptions } from "./gemini";
import { lookupDomainAge } from "./rdap";
import { detectTech } from "./tech";
import {
  emptyContacts,
  type ContactFindings,
  type EnrichmentResult,
  type EnrichTarget,
} from "./types";

/**
 * Enriches one business end to end: crawl → extract → model fallback → RDAP.
 *
 * Every dependency is injected so the whole pipeline runs against fixtures in a
 * test with no network. Nothing here throws — a failure becomes a `crawl_status`
 * the scorer can reason about (§9).
 */

export interface EnrichOptions {
  fetchOptions?: FetchOptions;
  gemini?: GeminiOptions | null;
  fetchImpl?: typeof fetch;
  now?: Date;
}

export async function enrichBusiness(
  target: EnrichTarget,
  options: EnrichOptions = {},
): Promise<EnrichmentResult> {
  const { gemini = null, fetchImpl = fetch, now = new Date() } = options;

  const base = {
    businessId: target.id,
    ...emptyContacts(),
    techStack: [] as string[],
    hasBooking: Boolean(target.bookOnlineUrl),
    hasChat: false,
    hasOnlinePayment: false,
    domainRegisteredAt: null as string | null,
    domainAgeYears: null as number | null,
    pagesFetched: 0,
    usedGemini: false,
  };

  // No website is a finding, not a failure: it is the strongest automation gap
  // there is, and the listing may still carry a booking link.
  if (!target.websiteUrl || !target.rootDomain) {
    return {
      ...base,
      ...detectTech({ pages: [], listingBookingUrl: target.bookOnlineUrl, hasSite: false }),
      hasBooking: Boolean(target.bookOnlineUrl),
      crawlStatus: "no_site",
      crawlError: null,
    };
  }

  const domainAge = await lookupDomainAge(target.rootDomain, { fetchImpl, now });
  const site = await fetchSite(target.websiteUrl, {
    fetchImpl,
    ...options.fetchOptions,
  });

  if (site.status !== "ok" || site.pages.length === 0) {
    return {
      ...base,
      ...detectTech({ pages: [], listingBookingUrl: target.bookOnlineUrl, hasSite: true }),
      hasBooking: Boolean(target.bookOnlineUrl),
      domainRegisteredAt: domainAge.registeredAt,
      domainAgeYears: domainAge.ageYears,
      crawlStatus: site.status === "blocked" ? "blocked" : "failed",
      crawlError: site.error,
    };
  }

  const contacts = extractContacts(site.pages);
  let usedGemini = false;

  if (gemini && !isComplete(contacts)) {
    const missing = missingFields(contacts);
    const text = site.pages.map((page) => htmlToText(page.html, 6_000)).join("\n---\n");
    const extraction = await extractWithGemini(text.slice(0, 18_000), missing, gemini);

    usedGemini = true;
    for (const [key, value] of Object.entries(extraction.contacts)) {
      const field = key as keyof ContactFindings;
      if (!contacts[field] && value) contacts[field] = value;
    }
  }

  const tech = detectTech({
    pages: site.pages,
    listingBookingUrl: target.bookOnlineUrl,
    hasSite: true,
  });

  return {
    businessId: target.id,
    ...contacts,
    ...tech,
    domainRegisteredAt: domainAge.registeredAt,
    domainAgeYears: domainAge.ageYears,
    crawlStatus: "ok",
    crawlError: null,
    pagesFetched: site.pages.length,
    usedGemini,
  };
}

/** Which contact fields are still empty — the only ones worth paying a model for. */
export function missingFields(contacts: ContactFindings): (keyof ContactFindings)[] {
  const wanted: (keyof ContactFindings)[] = [
    "email",
    "whatsappPhone",
    "linkedinUrl",
    "instagramUrl",
    "facebookUrl",
    "xUrl",
  ];
  return wanted.filter((field) => !contacts[field]);
}
