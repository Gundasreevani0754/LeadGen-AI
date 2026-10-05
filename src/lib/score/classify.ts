import type { EntityType, ScoreFacts } from "./types";

/**
 * BUSINESS vs SERVICE_PROVIDER, decided by *who the business sells to* (§10).
 *
 * A wedding photographer sells to consumers and is a BUSINESS. A video
 * production agency sells to brands and is a SERVICE_PROVIDER. The distinction
 * is not what they make; it is who signs the cheque.
 *
 * Ambiguity resolves to SERVICE_PROVIDER on purpose. That is the conservative
 * side: the 30% cap is what protects the operator's calendar, and a misfiled
 * consumer business merely waits in the cold pool, where it stays findable.
 */

/** Category and name fragments that mean "sells to other businesses". */
const PROVIDER_SIGNALS = [
  "marketing agency",
  "advertising agency",
  "digital marketing",
  "seo ",
  "seo agency",
  "web design",
  "web developer",
  "website design",
  "software company",
  "software development",
  "app developer",
  "it consultant",
  "it services",
  "internet marketing",
  "graphic designer",
  "branding agency",
  "media agency",
  "production company",
  "video production",
  "video editing",
  "consultant",
  "consulting",
  "business management",
  "staffing agency",
  "recruiter",
  "b2b",
  "outsourcing",
  "bpo",
  "call center",
  "automation agency",
  "freelance",
  "coworking",
];

/** Categories that mean "sells to the public from a local operation". */
const BUSINESS_SIGNALS = [
  "restaurant",
  "cafe",
  "coffee",
  "bakery",
  "bar",
  "pub",
  "hotel",
  "resort",
  "guest house",
  "clinic",
  "dentist",
  "dental",
  "doctor",
  "hospital",
  "physiotherap",
  "dermatolog",
  "pediatric",
  "veterinar",
  "pharmacy",
  "optician",
  "optometrist",
  "gym",
  "fitness",
  "yoga",
  "pilates",
  "spa",
  "salon",
  "barber",
  "beauty",
  "nail",
  "massage",
  "school",
  "academy",
  "tutor",
  "coaching cent",
  "preschool",
  "kindergarten",
  "driving school",
  "real estate",
  "property",
  "builder",
  "interior design",
  "furniture",
  "auto repair",
  "car repair",
  "car dealer",
  "car wash",
  "tyre",
  "tire",
  "motorcycle",
  "service station",
  "store",
  "shop",
  "boutique",
  "supermarket",
  "grocery",
  "jewelry",
  "jeweller",
  "electronics",
  "mobile phone",
  "event venue",
  "banquet",
  "wedding",
  "photographer",
  "caterer",
  "catering",
  "florist",
  "travel agency",
  "tour operator",
  "laundry",
  "dry clean",
  "pet ",
  "daycare",
  "plumber",
  "electrician",
  "carpenter",
  "painter",
  "pest control",
  "cleaning service",
  "moving company",
  "packers",
  "lawyer",
  "advocate",
  "chartered accountant",
  "insurance agency",
  "bank",
];

export interface Classification {
  entityType: EntityType;
  /** Which fragment decided it — shown in the UI so a misfile is obvious. */
  matchedOn: string | null;
}

export function classify(facts: Pick<ScoreFacts, "name" | "googleCategory">): Classification {
  const haystack = `${facts.googleCategory ?? ""} ${facts.name}`.toLowerCase();

  // Provider signals win a tie: "wedding photography agency" sells to venues.
  const provider = PROVIDER_SIGNALS.find((signal) => haystack.includes(signal));
  if (provider) return { entityType: "service_provider", matchedOn: provider };

  const business = BUSINESS_SIGNALS.find((signal) => haystack.includes(signal));
  if (business) return { entityType: "business", matchedOn: business };

  return { entityType: "service_provider", matchedOn: null };
}
