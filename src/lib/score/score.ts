import { isSiteBuilder } from "../enrich/tech";
import { classify } from "./classify";
import { resolveContact } from "./contact";
import type {
  GapSignal,
  ScoreComponents,
  ScoreFacts,
  ScoreResult,
} from "./types";

/**
 * The deterministic score (§10). No model call, no randomness, no I/O.
 *
 * Incremented whenever a weight changes, so `scores` keeps both the old and the
 * new number and §14's feedback analysis stays interpretable across a re-tune.
 */
export const SCORING_VERSION = 1;

export const MAX_DEMAND = 45;
export const MAX_QUALITY = 20;
export const MAX_ESTABLISHMENT = 15;
export const MAX_GAP = 20;
export const CHAIN_PENALTY = -10;
/** More locations than this reads as a chain, which rarely buys from a solo agency. */
export const CHAIN_LOCATION_THRESHOLD = 3;

/**
 * Demand — how much work the business is actually handling.
 *
 * The curve peaks at 200–499 reviews and falls back above 500 on purpose: at
 * that volume you are usually looking at a chain or a franchise with a head
 * office, and the person answering the phone cannot buy anything.
 */
export function scoreDemand(reviewCount: number | null): number {
  const reviews = reviewCount ?? 0;
  if (reviews === 0) return 0;
  if (reviews < 25) return 10;
  if (reviews < 75) return 24;
  if (reviews < 200) return 36;
  if (reviews < 500) return 45;
  return 33;
}

/** Quality — an unrated business scores 4, not 0: absence of data is not a bad rating. */
export function scoreQuality(rating: number | null): number {
  if (rating === null) return 4;
  if (rating >= 4.5) return 20;
  if (rating >= 4.0) return 16;
  if (rating >= 3.5) return 11;
  if (rating >= 3.0) return 5;
  return 0;
}

/** Establishment — domain age as a proxy for "this business will still exist in a year". */
export function scoreEstablishment(domainAgeYears: number | null): number {
  if (domainAgeYears === null) return 0;
  if (domainAgeYears >= 5) return 15;
  if (domainAgeYears >= 3) return 13;
  if (domainAgeYears >= 1) return 9;
  return 4;
}

export interface GapScore {
  points: number;
  gaps: GapSignal[];
}

/**
 * Automation gap — the only component that is also the sales pitch.
 *
 * A business that has never been crawled scores zero here rather than being
 * credited with gaps it might not have. Guessing in the operator's favour is how
 * you end up on a call describing a booking system the prospect already owns.
 */
export function scoreGap(facts: ScoreFacts): GapScore {
  const e = facts.enrichment;
  if (!e) return { points: 0, gaps: [] };

  const gaps: GapSignal[] = [];
  let points = 0;

  const crawled = e.crawlStatus === "ok";
  const noSite = e.crawlStatus === "no_site" || !facts.rootDomain;

  // Booking is knowable from the listing alone, so it counts even without a crawl.
  if (!e.hasBooking) {
    gaps.push("no_booking");
    points += 6;
  }

  if (crawled) {
    if (!e.hasChat) {
      gaps.push("no_chat");
      points += 4;
    }
    if (!e.hasOnlinePayment) {
      gaps.push("no_online_payment");
      points += 4;
    }
    if (!e.hasBooking && !e.hasChat && !e.hasOnlinePayment) {
      gaps.push("form_or_phone_only");
      points += 3;
    }
  }

  if (noSite || isSiteBuilder(e.techStack)) {
    gaps.push("site_builder_or_no_site");
    points += 3;
  }

  // Free from the listing, and the clearest sign nobody is minding the shop.
  if (facts.unclaimedListing) gaps.push("unclaimed_listing");

  return { points: Math.min(points, MAX_GAP), gaps };
}

export function computeScore(facts: ScoreFacts): ScoreResult {
  const { entityType, matchedOn } = classify(facts);
  const contact = resolveContact(facts);

  const demand = scoreDemand(facts.googleReviewCount);
  const quality = scoreQuality(facts.googleRating);
  const establishment = scoreEstablishment(facts.enrichment?.domainAgeYears ?? null);
  const gap = scoreGap(facts);

  const isChain = facts.chainLocations > CHAIN_LOCATION_THRESHOLD;
  const chainPenalty = isChain ? CHAIN_PENALTY : 0;

  const notes: string[] = [];
  notes.push(
    matchedOn
      ? `Classified ${entityType} on "${matchedOn}"`
      : `No category signal matched — defaulted to service provider`,
  );
  if (isChain) notes.push(`${facts.chainLocations} locations share this name`);
  if (!facts.enrichment) notes.push("Not crawled yet — establishment and gap score 0");
  else if (facts.enrichment.crawlStatus !== "ok" && facts.enrichment.crawlStatus !== "no_site") {
    notes.push(`Crawl ${facts.enrichment.crawlStatus} — partial gap data`);
  }

  const components: ScoreComponents = {
    demand,
    quality,
    establishment,
    gap: gap.points,
    chainPenalty,
    notes,
    gaps: gap.gaps,
  };

  const raw = demand + quality + establishment + gap.points + chainPenalty;
  const total = clamp(raw, 0, 100);

  const exclusionReason = facts.suppressed
    ? ("suppressed" as const)
    : facts.businessStatus !== "operational"
      ? ("not_operational" as const)
      : contact.tier === "none"
        ? ("no_contact_channel" as const)
        : null;

  return {
    businessId: facts.businessId,
    total,
    components,
    entityType,
    contactTier: contact.tier,
    excluded: exclusionReason !== null,
    exclusionReason,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Labels the UI uses; kept beside the rules so the two can't drift. */
export const GAP_LABELS: Record<GapSignal, string> = {
  no_booking: "No online booking",
  no_chat: "No chat widget",
  no_online_payment: "No online payments",
  form_or_phone_only: "Form or phone only",
  site_builder_or_no_site: "Template site or none",
  unclaimed_listing: "Unclaimed Google listing",
};
