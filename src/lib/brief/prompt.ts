import { GAP_LABELS } from "../score/score";
import type { BriefInput } from "./types";

/**
 * One prompt for the whole day's batch.
 *
 * Batching is not an optimisation, it is the design (§11): a `claude -p`
 * invocation loads ~54,700 tokens of environment before it reads the prompt.
 * Fifteen invocations pay that fifteen times; one session pays it once.
 */

export const BRIEF_JSON_SCHEMA = {
  type: "object",
  required: ["briefs"],
  properties: {
    briefs: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "pain_hypothesis", "opening_line", "audit_markdown"],
        properties: {
          id: { type: "string" },
          pain_hypothesis: { type: "string" },
          opening_line: { type: "string" },
          audit_markdown: { type: "string" },
        },
        additionalProperties: false,
      },
    },
  },
  additionalProperties: false,
} as const;

const SYSTEM = `You are writing prospect briefs for a small automation agency called Autotech.
Autotech sells AI agents, workflow automation, chatbots, CRM setup and landing pages to small
and mid-sized local businesses. Its operator calls or messages every prospect personally, about
thirteen a day, so each brief has to be worth the two minutes they spend reading it.

For each business you are given verified facts only: its Google rating and review count, how old
its domain is, what its website is built on, and which automation capabilities it is missing.

Write three things per business:

1. pain_hypothesis — one or two sentences naming the specific operational bottleneck those facts
   imply. Tie it to volume where the review count supports it. Do not describe the website; describe
   what the staff are doing by hand because of it.

2. opening_line — a single sentence the operator could say on a cold call or send as a first message.
   Specific to this business, no flattery, no "I was browsing your website", no exclamation marks.
   It should sound like a person who noticed one concrete thing.

3. audit_markdown — 80 to 150 words of markdown. What the current setup plausibly costs them in a
   week: missed enquiries outside opening hours, time on the phone taking bookings, manual follow-ups.
   Use ranges and say "likely" or "probably" where you are inferring. End with one sentence naming the
   single highest-leverage fix.

Hard rules:
- Use only the facts given. Never invent a client name, a revenue figure, a staff count, a competitor
  or a quote. If a fact is absent, write around it.
- Never claim to have used their booking system, called them, or visited in person.
- No em dashes. No "in today's fast-paced world". No filler openers.
- Return one entry per business, with the id exactly as given.`;

export function buildBatchPrompt(leads: BriefInput[]): string {
  const blocks = leads.map((lead, index) => formatLead(lead, index + 1));

  return `${SYSTEM}

Return JSON of the form {"briefs": [{"id", "pain_hypothesis", "opening_line", "audit_markdown"}]}
with exactly ${leads.length} ${leads.length === 1 ? "entry" : "entries"}, one per business below.

${blocks.join("\n\n")}`;
}

function formatLead(lead: BriefInput, position: number): string {
  const facts: string[] = [
    `id: ${lead.businessId}`,
    `name: ${lead.name}`,
    lead.city ? `city: ${lead.city}` : null,
    lead.category ? `category: ${lead.category}` : null,
    lead.rating !== null ? `google rating: ${lead.rating}` : "google rating: unrated",
    `google reviews: ${lead.reviewCount ?? 0}`,
    lead.websiteUrl ? `website: ${lead.websiteUrl}` : "website: none found",
    lead.domainAgeYears !== null
      ? `domain age: ${lead.domainAgeYears} years`
      : "domain age: unknown",
    lead.techStack.length ? `built with: ${lead.techStack.join(", ")}` : null,
    `online booking: ${lead.hasBooking ? "yes" : "no"}`,
    `chat widget: ${lead.hasChat ? "yes" : "no"}`,
    `online payments: ${lead.hasOnlinePayment ? "yes" : "no"}`,
    lead.unclaimedListing ? "google business profile: unclaimed by the owner" : null,
    lead.gaps.length
      ? `gaps found: ${lead.gaps.map((gap) => GAP_LABELS[gap]).join("; ")}`
      : null,
    `qualification score: ${lead.score}/100`,
  ].filter((line): line is string => line !== null);

  return `--- business ${position} ---\n${facts.join("\n")}`;
}
