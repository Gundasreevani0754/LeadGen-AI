import { parsePhoneNumberFromString } from "libphonenumber-js";
import { parse as parseDomain } from "tldts";

/**
 * Normalization for the two dedupe keys. Everything here is pure and tested —
 * a bug in this file silently corrupts dedupe, which is the one thing the
 * operator asked never to get wrong.
 */

/**
 * Hosts that belong to a platform rather than to the business.
 *
 * Google Maps frequently lists a Facebook page, a WhatsApp link, or a directory
 * listing in the `website` field. Treating those as the business's own domain
 * would collide every such business onto one dedupe key and silently discard
 * real leads as "duplicates".
 */
const NON_PROPRIETARY_HOSTS = new Set([
  "facebook.com",
  "fb.com",
  "instagram.com",
  "linkedin.com",
  "twitter.com",
  "x.com",
  "youtube.com",
  "wa.me",
  "whatsapp.com",
  "linktr.ee",
  "google.com",
  "goo.gl",
  "business.site",
  "sites.google.com",
  "justdial.com",
  "indiamart.com",
  "sulekha.com",
  "practo.com",
  "zomato.com",
  "swiggy.com",
  "tripadvisor.com",
  "yelp.com",
  "wixsite.com",
  "blogspot.com",
  "wordpress.com",
]);

/**
 * Converts a phone number to E.164, the canonical dedupe form.
 * `defaultCountry` is used when the number has no international prefix.
 */
export function normalizePhone(
  raw: string | null | undefined,
  defaultCountry = "IN",
): string | null {
  if (!raw) return null;
  try {
    const parsed = parsePhoneNumberFromString(
      raw,
      defaultCountry as Parameters<typeof parsePhoneNumberFromString>[1],
    );
    return parsed?.isValid() ? parsed.number : null;
  } catch {
    return null;
  }
}

/** ISO 3166-1 alpha-2, derived from the phone number itself. */
export function countryFromPhone(
  raw: string | null | undefined,
  defaultCountry = "IN",
): string | null {
  if (!raw) return null;
  try {
    const parsed = parsePhoneNumberFromString(
      raw,
      defaultCountry as Parameters<typeof parsePhoneNumberFromString>[1],
    );
    return parsed?.country ?? null;
  } catch {
    return null;
  }
}

/**
 * The registrable domain, lowercased and without `www`.
 * Returns null for platform URLs (see NON_PROPRIETARY_HOSTS), IP addresses,
 * and anything unparseable — those must not become dedupe keys.
 */
export function extractRootDomain(
  url: string | null | undefined,
): string | null {
  if (!url) return null;

  const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;

  let hostname: string;
  try {
    hostname = new URL(withScheme).hostname;
  } catch {
    return null;
  }

  const parsed = parseDomain(hostname);
  if (!parsed.domain || parsed.isIp) return null;

  const domain = parsed.domain.toLowerCase();
  return NON_PROPRIETARY_HOSTS.has(domain) ? null : domain;
}

/** True when a website URL points at a platform rather than the business's own site. */
export function isPlatformUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return extractRootDomain(url) === null;
}

/** Collapses whitespace and trims. Used before any name comparison. */
export function normalizeName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

/** Lowercased, whitespace-collapsed key for fuzzy (name, city) matching. */
export function nameKey(name: string): string {
  return normalizeName(name).toLowerCase();
}
