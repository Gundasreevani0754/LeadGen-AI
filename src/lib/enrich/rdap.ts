import { USER_AGENT } from "./fetcher";
import { guardedFetch } from "./guard";

/**
 * Domain registration age via RDAP — the modern, JSON replacement for WHOIS.
 *
 * `rdap.org` is a free redirector to the authoritative registry, needs no key,
 * and has no published rate limit we get near at one lookup per business per
 * 90 days. Age feeds the Establishment component of the score (§10).
 */

const RDAP_ENDPOINT = "https://rdap.org/domain/";
const TIMEOUT_MS = 10_000;

/** Only the two fields we need out of a large response. */
interface RdapResponse {
  events?: { eventAction?: string; eventDate?: string }[];
}

export interface DomainAge {
  registeredAt: string | null;
  ageYears: number | null;
}

export const UNKNOWN_AGE: DomainAge = { registeredAt: null, ageYears: null };

/**
 * `.in` registry data is frequently withheld, and some TLDs have no RDAP server
 * at all. An unknown age is a normal outcome, not an error — the business simply
 * scores zero on Establishment rather than being dropped.
 */
export async function lookupDomainAge(
  domain: string,
  options: { fetchImpl?: typeof fetch; now?: Date } = {},
): Promise<DomainAge> {
  const { fetchImpl = fetch, now = new Date() } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    // rdap.org is a fixed, trusted endpoint, but it redirects to whichever
    // registry owns the TLD, so the hops go through the same guard as a crawl.
    const response = await guardedFetch(`${RDAP_ENDPOINT}${encodeURIComponent(domain)}`, {
      fetchImpl,
      // Cloudflare fronts rdap.org and answers 403 to a request with no
      // User-Agent — which is exactly what Node's fetch sends by default.
      headers: { accept: "application/rdap+json", "user-agent": USER_AGENT },
      signal: controller.signal,
    });

    if (!response.ok) return UNKNOWN_AGE;
    return parseRdap((await response.json()) as RdapResponse, now);
  } catch {
    return UNKNOWN_AGE;
  } finally {
    clearTimeout(timer);
  }
}

export function parseRdap(body: RdapResponse, now = new Date()): DomainAge {
  const event = body.events?.find(
    (e) => e.eventAction?.toLowerCase() === "registration",
  );
  if (!event?.eventDate) return UNKNOWN_AGE;

  const registered = new Date(event.eventDate);
  if (Number.isNaN(registered.getTime())) return UNKNOWN_AGE;
  // A future registration date means the registry returned something wrong.
  if (registered.getTime() > now.getTime()) return UNKNOWN_AGE;

  const years = (now.getTime() - registered.getTime()) / (365.25 * 24 * 60 * 60 * 1000);

  return {
    registeredAt: registered.toISOString().slice(0, 10),
    ageYears: Math.round(years * 100) / 100,
  };
}
