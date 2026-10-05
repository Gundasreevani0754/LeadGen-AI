/**
 * Inputs and outputs of the scoring layer.
 *
 * Deliberately a plain data shape with no database types in it: §4 requires this
 * layer to be auditable line by line, which means it has to be runnable from a
 * test fixture without a connection.
 */

export type EntityType = "business" | "service_provider";

export type ContactTier = "phone" | "email" | "linkedin" | "social" | "form" | "none";

export interface ScoreFacts {
  businessId: string;
  name: string;
  googleCategory: string | null;
  googleRating: number | null;
  googleReviewCount: number | null;
  businessStatus: "operational" | "closed_temporarily" | "closed_permanently";
  phoneE164: string | null;
  countryCode: string | null;
  websiteUrl: string | null;
  rootDomain: string | null;
  unclaimedListing: boolean | null;

  /** Null when the business has never been crawled. */
  enrichment: EnrichmentFacts | null;

  /** How many businesses share this name — >3 reads as a chain (§10). */
  chainLocations: number;
  /** True when a phone or domain is on the suppression list. */
  suppressed: boolean;
}

export interface EnrichmentFacts {
  email: string | null;
  whatsappPhone: string | null;
  linkedinUrl: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  xUrl: string | null;
  contactFormUrl: string | null;
  techStack: string[] | null;
  hasBooking: boolean | null;
  hasChat: boolean | null;
  hasOnlinePayment: boolean | null;
  domainAgeYears: number | null;
  crawlStatus: "ok" | "blocked" | "no_site" | "failed" | null;
}

/** Every component stored separately so the UI can explain a 78 (§6, `scores.components`). */
export interface ScoreComponents {
  demand: number;
  quality: number;
  establishment: number;
  gap: number;
  chainPenalty: number;
  /** Human-readable reasons, shown verbatim in the score breakdown. */
  notes: string[];
  /** The individual gap signals, which are also the pitch. */
  gaps: GapSignal[];
}

export type GapSignal =
  | "no_booking"
  | "no_chat"
  | "no_online_payment"
  | "form_or_phone_only"
  | "site_builder_or_no_site"
  | "unclaimed_listing";

export interface ScoreResult {
  businessId: string;
  total: number;
  components: ScoreComponents;
  entityType: EntityType;
  contactTier: ContactTier;
  /** Excluded leads are stored with their reason, never silently dropped. */
  excluded: boolean;
  exclusionReason: ExclusionReason | null;
}

export type ExclusionReason =
  | "not_operational"
  | "no_contact_channel"
  | "suppressed";
