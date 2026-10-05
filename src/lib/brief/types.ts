import type { GapSignal } from "../score/types";

/**
 * What Claude is allowed to see, and what it must return.
 *
 * Only verified facts go in — never a raw search result, never a guess (§11).
 * Claude writes *about* leads that code has already approved; it never decides
 * which leads those are (§15.8).
 */

export interface BriefInput {
  businessId: string;
  name: string;
  city: string | null;
  category: string | null;
  rating: number | null;
  reviewCount: number | null;
  websiteUrl: string | null;
  domainAgeYears: number | null;
  techStack: string[];
  gaps: GapSignal[];
  score: number;
  entityType: "business" | "service_provider";
  contactTier: string;
  unclaimedListing: boolean;
  hasBooking: boolean;
  hasChat: boolean;
  hasOnlinePayment: boolean;
}

export interface BriefOutput {
  businessId: string;
  painHypothesis: string;
  openingLine: string;
  auditMarkdown: string;
}

export interface BriefBatchResult {
  briefs: BriefOutput[];
  model: string;
  effort: string;
  sessionId: string | null;
  inputTokens: number;
  outputTokens: number;
  /** Non-fatal problems worth printing: leads the model skipped, flags dropped. */
  warnings: string[];
}
