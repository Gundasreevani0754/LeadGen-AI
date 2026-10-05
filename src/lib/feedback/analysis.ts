import type { PipelineStatus } from "@/lib/leads/constants";
import { GAP_LABELS } from "@/lib/score/score";
import type {
  ContactTier,
  EntityType,
  GapSignal,
  ScoreComponents,
} from "@/lib/score/types";

/**
 * The feedback loop (§14): which score components actually predicted a close.
 *
 * Pure functions over rows the caller loads, so the whole report can be tested
 * against fixtures. The weights in §10 are openly guesses; this is the machinery
 * that replaces them with evidence once enough leads have been worked.
 */

/** Below this, a segment's rate is noise and is reported as such. */
export const MIN_SEGMENT_SAMPLE = 5;
/** The spec's own estimate of when the numbers start to mean something. */
export const RETUNE_THRESHOLD = 100;

export interface OutcomeRow {
  businessId: string;
  status: PipelineStatus;
  total: number;
  components: ScoreComponents;
  entityType: EntityType;
  contactTier: ContactTier;
  reviewCount: number | null;
  rating: number | null;
  domainAgeYears: number | null;
  /** True when this lead ever reached `contacted` or beyond. */
  wasContacted: boolean;
}

export interface SegmentStat {
  label: string;
  worked: number;
  replied: number;
  booked: number;
  won: number;
  replyRate: number;
  bookRate: number;
  /** Reply rate relative to the overall reply rate. 1.0 is average. */
  lift: number;
  /** False when the sample is too small to read anything into. */
  reliable: boolean;
}

export interface Dimension {
  key: string;
  title: string;
  /** What a difference here would mean for the scoring weights. */
  question: string;
  segments: SegmentStat[];
}

export interface FeedbackReport {
  worked: number;
  replied: number;
  booked: number;
  won: number;
  dead: number;
  replyRate: number;
  bookRate: number;
  /** How many more worked leads before the spec says a re-tune is justified. */
  untilRetune: number;
  readyToRetune: boolean;
  dimensions: Dimension[];
}

const REPLIED: PipelineStatus[] = ["replied", "call_booked", "won"];
const BOOKED: PipelineStatus[] = ["call_booked", "won"];

export function summarize(rows: OutcomeRow[]): FeedbackReport {
  // Only contacted leads carry information. A lead nobody called says nothing
  // about whether its score was right.
  const worked = rows.filter((row) => row.wasContacted);

  const replied = worked.filter((row) => REPLIED.includes(row.status)).length;
  const booked = worked.filter((row) => BOOKED.includes(row.status)).length;
  const won = worked.filter((row) => row.status === "won").length;
  const dead = worked.filter((row) => row.status === "dead").length;

  const overallReplyRate = worked.length === 0 ? 0 : replied / worked.length;

  const dimensions: Dimension[] = [
    {
      key: "score",
      title: "Score band",
      question:
        "If a higher score does not reply more often, the threshold is in the wrong place.",
      segments: bucket(worked, overallReplyRate, scoreBand),
    },
    {
      key: "demand",
      title: "Demand — review volume",
      question: "Worth 45 points. Does review count actually predict a reply?",
      segments: bucket(worked, overallReplyRate, (row) => demandBand(row.reviewCount)),
    },
    {
      key: "quality",
      title: "Quality — rating",
      question: "Worth 20 points. Do better-rated businesses engage more?",
      segments: bucket(worked, overallReplyRate, (row) => qualityBand(row.rating)),
    },
    {
      key: "establishment",
      title: "Establishment — domain age",
      question: "Worth 15 points. Do older businesses reply more, or less?",
      segments: bucket(worked, overallReplyRate, (row) =>
        establishmentBand(row.domainAgeYears),
      ),
    },
    {
      key: "entity",
      title: "Business vs service provider",
      question: "The 70/30 cap assumes businesses convert better. Do they?",
      segments: bucket(worked, overallReplyRate, (row) =>
        row.entityType === "business" ? "Business" : "Service provider",
      ),
    },
    {
      key: "contact",
      title: "Channel reached",
      question: "Is a lead reachable only by social media worth the same effort?",
      segments: bucket(worked, overallReplyRate, (row) => tierLabel(row.contactTier)),
    },
    ...gapDimensions(worked, overallReplyRate),
  ];

  return {
    worked: worked.length,
    replied,
    booked,
    won,
    dead,
    replyRate: overallReplyRate,
    bookRate: worked.length === 0 ? 0 : booked / worked.length,
    untilRetune: Math.max(0, RETUNE_THRESHOLD - worked.length),
    readyToRetune: worked.length >= RETUNE_THRESHOLD,
    dimensions,
  };
}

/**
 * Each gap signal becomes its own present/absent comparison.
 *
 * This is the most directly actionable part of the report: a gap that does not
 * move the reply rate is a gap worth fewer points, and one that does is worth
 * leading the call with.
 */
function gapDimensions(rows: OutcomeRow[], overall: number): Dimension[] {
  const signals = new Set<GapSignal>();
  for (const row of rows) {
    for (const gap of row.components.gaps ?? []) signals.add(gap);
  }

  if (signals.size === 0) return [];

  const segments: SegmentStat[] = [];
  for (const signal of signals) {
    const present = rows.filter((row) => (row.components.gaps ?? []).includes(signal));
    const absent = rows.filter((row) => !(row.components.gaps ?? []).includes(signal));

    segments.push(stat(`${GAP_LABELS[signal]} — present`, present, overall));
    segments.push(stat(`${GAP_LABELS[signal]} — absent`, absent, overall));
  }

  return [
    {
      key: "gaps",
      title: "Individual gap signals",
      question:
        "A gap that does not change the reply rate is not a pitch, whatever it scores.",
      segments,
    },
  ];
}

function bucket(
  rows: OutcomeRow[],
  overall: number,
  keyOf: (row: OutcomeRow) => string,
): SegmentStat[] {
  const groups = new Map<string, OutcomeRow[]>();

  for (const row of rows) {
    const key = keyOf(row);
    const existing = groups.get(key);
    if (existing) existing.push(row);
    else groups.set(key, [row]);
  }

  return [...groups.entries()]
    .map(([label, group]) => stat(label, group, overall))
    .sort((a, b) => b.replyRate - a.replyRate || b.worked - a.worked);
}

function stat(label: string, rows: OutcomeRow[], overall: number): SegmentStat {
  const replied = rows.filter((row) => REPLIED.includes(row.status)).length;
  const booked = rows.filter((row) => BOOKED.includes(row.status)).length;
  const won = rows.filter((row) => row.status === "won").length;
  const replyRate = rows.length === 0 ? 0 : replied / rows.length;

  return {
    label,
    worked: rows.length,
    replied,
    booked,
    won,
    replyRate,
    bookRate: rows.length === 0 ? 0 : booked / rows.length,
    lift: overall === 0 ? 0 : replyRate / overall,
    reliable: rows.length >= MIN_SEGMENT_SAMPLE,
  };
}

// ---------------------------------------------------------------------------
// Bands — deliberately the same cut points the scorer uses (§10), so a finding
// here maps directly onto a line in `score.ts`.
// ---------------------------------------------------------------------------

function scoreBand(row: OutcomeRow): string {
  if (row.total >= 85) return "85+";
  if (row.total >= 75) return "75 to 84";
  if (row.total >= 65) return "65 to 74";
  return "below 65";
}

export function demandBand(reviews: number | null): string {
  const n = reviews ?? 0;
  if (n === 0) return "no reviews";
  if (n < 25) return "1 to 24";
  if (n < 75) return "25 to 74";
  if (n < 200) return "75 to 199";
  if (n < 500) return "200 to 499";
  return "500+";
}

export function qualityBand(rating: number | null): string {
  if (rating === null) return "unrated";
  if (rating >= 4.5) return "4.5+";
  if (rating >= 4.0) return "4.0 to 4.4";
  if (rating >= 3.5) return "3.5 to 3.9";
  return "below 3.5";
}

export function establishmentBand(years: number | null): string {
  if (years === null) return "unknown";
  if (years >= 5) return "5+ years";
  if (years >= 3) return "3 to 5 years";
  if (years >= 1) return "1 to 3 years";
  return "under a year";
}

function tierLabel(tier: ContactTier): string {
  const labels: Record<ContactTier, string> = {
    phone: "Phone",
    email: "Email",
    linkedin: "LinkedIn",
    social: "Social",
    form: "Contact form",
    none: "No channel",
  };
  return labels[tier];
}
