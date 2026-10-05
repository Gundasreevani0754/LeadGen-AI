import type { ContactTier, ScoreFacts } from "./types";

/**
 * The contact fallback ladder (§9).
 *
 * The rule the operator asked for explicitly: a strong lead is never dropped for
 * a missing field. It is dropped only when *no* rung is reachable, because at
 * that point there is genuinely no way to start a conversation.
 */

export interface ContactResult {
  tier: ContactTier;
  /** True below rung 2 — the UI shows "contact: partial" with what does exist. */
  partial: boolean;
  /** Every channel that exists, in ladder order, for the lead detail page. */
  channels: ContactChannel[];
}

export interface ContactChannel {
  kind: ContactTier | "whatsapp";
  value: string;
  /** `tel:`, `mailto:` or an https URL — whatever the UI should link to. */
  href: string;
}

export function resolveContact(facts: ScoreFacts): ContactResult {
  const e = facts.enrichment;
  const channels: ContactChannel[] = [];

  if (facts.phoneE164) {
    channels.push({ kind: "phone", value: facts.phoneE164, href: `tel:${facts.phoneE164}` });
  }
  if (e?.whatsappPhone) {
    channels.push({
      kind: "whatsapp",
      value: e.whatsappPhone,
      href: `https://wa.me/${e.whatsappPhone.replace(/\D/g, "")}`,
    });
  }
  if (e?.email) {
    channels.push({ kind: "email", value: e.email, href: `mailto:${e.email}` });
  }
  if (e?.linkedinUrl) {
    channels.push({ kind: "linkedin", value: e.linkedinUrl, href: e.linkedinUrl });
  }
  for (const url of [e?.instagramUrl, e?.facebookUrl, e?.xUrl]) {
    if (url) channels.push({ kind: "social", value: url, href: url });
  }
  if (e?.contactFormUrl) {
    channels.push({ kind: "form", value: e.contactFormUrl, href: e.contactFormUrl });
  }

  const tier = firstRung(facts);

  return { tier, partial: tier !== "phone" && tier !== "email", channels };
}

function firstRung(facts: ScoreFacts): ContactTier {
  const e = facts.enrichment;
  if (facts.phoneE164 || e?.whatsappPhone) return "phone";
  if (e?.email) return "email";
  if (e?.linkedinUrl) return "linkedin";
  if (e?.instagramUrl || e?.facebookUrl || e?.xUrl) return "social";
  if (e?.contactFormUrl) return "form";
  return "none";
}

/** How the operator should open, given where the business is (§6, `country_code`). */
export function preferredChannel(facts: ScoreFacts): "call" | "whatsapp" | "email" | "none" {
  if (facts.phoneE164 && facts.countryCode === "IN") return "call";
  if (facts.enrichment?.whatsappPhone || facts.phoneE164) return "whatsapp";
  if (facts.enrichment?.email) return "email";
  return "none";
}
