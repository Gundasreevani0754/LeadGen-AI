import type { ContactTier, EntityType, GapSignal } from "@/lib/score/types";

/**
 * The lead vocabulary shared by the server queries and the client components.
 *
 * `queries.ts` is server-only — it opens a Postgres connection at import time —
 * so anything the table, the board or the filter bar needs at runtime has to
 * live in a module with no database behind it.
 */

export type PipelineStatus =
  | "new"
  | "qualified"
  | "contacted"
  | "replied"
  | "call_booked"
  | "won"
  | "dead";

/** Ordered as the funnel runs, which is also the order of the Kanban columns. */
export const PIPELINE_STATUSES: PipelineStatus[] = [
  "new",
  "qualified",
  "contacted",
  "replied",
  "call_booked",
  "won",
  "dead",
];

export const STATUS_LABELS: Record<PipelineStatus, string> = {
  new: "New",
  qualified: "Qualified",
  contacted: "Contacted",
  replied: "Replied",
  call_booked: "Call booked",
  won: "Won",
  dead: "Dead",
};

/** One row of the leads table, and the base of the lead detail record. */
export interface LeadRow {
  id: string;
  name: string;
  city: string | null;
  category: string | null;
  phoneE164: string | null;
  websiteUrl: string | null;
  rating: number | null;
  reviewCount: number | null;
  score: number | null;
  entityType: EntityType | null;
  contactTier: ContactTier | null;
  gaps: GapSignal[];
  techStack: string[];
  domainAgeYears: number | null;
  crawlStatus: string | null;
  email: string | null;
  status: PipelineStatus;
  nextActionAt: Date | null;
  hasBrief: boolean;
  suppressed: boolean;
}

export type PipelineBoard = Record<PipelineStatus, LeadRow[]>;

export interface LeadDetail extends LeadRow {
  address: string | null;
  countryCode: string | null;
  googleMapsUrl: string | null;
  bookOnlineUrl: string | null;
  unclaimedListing: boolean | null;
  businessStatus: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  placeId: string | null;
  rootDomain: string | null;

  whatsappPhone: string | null;
  linkedinUrl: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  xUrl: string | null;
  contactFormUrl: string | null;
  hasBooking: boolean | null;
  hasChat: boolean | null;
  hasOnlinePayment: boolean | null;
  domainRegisteredAt: string | null;
  fetchedAt: Date | null;
  crawlError: string | null;

  components: ScoreComponentsJson | null;
  ownerNote: string | null;
  brief: {
    painHypothesis: string;
    openingLine: string;
    auditMarkdown: string;
    model: string;
    effort: string;
    generatedAt: Date;
    regeneratedCount: number;
  } | null;
}

export interface ScoreComponentsJson {
  demand: number;
  quality: number;
  establishment: number;
  gap: number;
  chainPenalty: number;
  notes: string[];
  gaps: GapSignal[];
  excluded?: boolean;
  exclusionReason?: string | null;
}
