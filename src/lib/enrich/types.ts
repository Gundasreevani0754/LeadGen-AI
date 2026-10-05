/**
 * Shapes the enrichment pipeline passes around.
 *
 * Nothing here touches the database or the network, so every stage can be
 * tested against a fixture. Persistence lives in `worker.ts`.
 */

export type CrawlStatus = "ok" | "blocked" | "no_site" | "failed";

/** A single page that was actually fetched. */
export interface FetchedPage {
  url: string;
  html: string;
  status: number;
}

/** Contact channels found on the site, before the ladder is applied. */
export interface ContactFindings {
  email: string | null;
  whatsappPhone: string | null;
  linkedinUrl: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  xUrl: string | null;
  contactFormUrl: string | null;
}

export const emptyContacts = (): ContactFindings => ({
  email: null,
  whatsappPhone: null,
  linkedinUrl: null,
  instagramUrl: null,
  facebookUrl: null,
  xUrl: null,
  contactFormUrl: null,
});

/** Platform fingerprints and the automation gaps that become the pitch. */
export interface TechFindings {
  techStack: string[];
  hasBooking: boolean;
  hasChat: boolean;
  hasOnlinePayment: boolean;
}

/** What one business's enrichment produced. Maps 1:1 onto the `enrichment` row. */
export interface EnrichmentResult extends ContactFindings, TechFindings {
  businessId: string;
  domainRegisteredAt: string | null;
  domainAgeYears: number | null;
  crawlStatus: CrawlStatus;
  crawlError: string | null;
  /** Pages actually fetched — used for logging and the Gemini spend estimate. */
  pagesFetched: number;
  /** True when Gemini was called, so the ledger only records real spend. */
  usedGemini: boolean;
}

/** The subset of a business row the enrichment stage needs. */
export interface EnrichTarget {
  id: string;
  name: string;
  websiteUrl: string | null;
  rootDomain: string | null;
  bookOnlineUrl: string | null;
  city: string | null;
}
