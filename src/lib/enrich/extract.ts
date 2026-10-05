import { normalizePhone } from "../normalize";
import { emptyContacts, type ContactFindings, type FetchedPage } from "./types";

/**
 * Deterministic extraction from raw HTML.
 *
 * This runs before Gemini and usually finishes the job on its own: most small
 * business sites put their email in a `mailto:` and their socials in the footer.
 * Gemini is then only paid for the pages this misses (§4 — bulk extraction is
 * the model's job, but not when a regex is already correct).
 */

/** Addresses that belong to the site's toolchain, not to the business. */
const EMAIL_NOISE =
  /(sentry|wixpress|example\.com|domain\.com|yourdomain|email\.com|sentry\.io|\.png$|\.jpg$|\.jpeg$|\.gif$|\.webp$|\.svg$)/i;

const EMAIL_PATTERN = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

const SOCIAL_MATCHERS: {
  key: keyof ContactFindings;
  host: RegExp;
  reject?: RegExp;
}[] = [
  { key: "linkedinUrl", host: /(?:^|\.)linkedin\.com$/i },
  {
    key: "instagramUrl",
    host: /(?:^|\.)instagram\.com$/i,
    reject: /^\/(p|reel|explore|accounts)\//i,
  },
  {
    key: "facebookUrl",
    host: /(?:^|\.)(facebook\.com|fb\.com|fb\.me)$/i,
    reject: /^\/(sharer|share|plugins|tr|dialog)/i,
  },
  {
    key: "xUrl",
    host: /(?:^|\.)(twitter\.com|x\.com)$/i,
    reject: /^\/(intent|share|hashtag|home)/i,
  },
];

/** Runs every deterministic extractor over all fetched pages of one site. */
export function extractContacts(pages: FetchedPage[]): ContactFindings {
  const found = emptyContacts();

  for (const page of pages) {
    const hrefs = collectHrefs(page);

    found.email ??= pickEmail(page.html, hrefs);
    found.whatsappPhone ??= pickWhatsApp(page.html, hrefs);
    found.contactFormUrl ??= pickContactForm(page);

    for (const matcher of SOCIAL_MATCHERS) {
      if (found[matcher.key]) continue;
      const url = pickSocial(hrefs, matcher.host, matcher.reject);
      if (url) found[matcher.key] = url;
    }
  }

  return found;
}

function collectHrefs(page: FetchedPage): string[] {
  const hrefs: string[] = [];
  for (const match of page.html.matchAll(/href=["']([^"']+)["']/gi)) {
    hrefs.push(match[1]);
  }
  return hrefs;
}

/**
 * `mailto:` is trusted first — it is the business stating its own address.
 * Free-text matches are a fallback and are filtered hard, because a guessed or
 * scraped-from-a-script address violates guardrail §15.1.
 */
export function pickEmail(html: string, hrefs: string[]): string | null {
  for (const href of hrefs) {
    if (!/^mailto:/i.test(href)) continue;
    const address = decodeURIComponent(href.slice(7).split("?")[0]).trim();
    if (isUsableEmail(address)) return address.toLowerCase();
  }

  const text = stripScripts(html);
  for (const match of text.matchAll(EMAIL_PATTERN)) {
    if (isUsableEmail(match[0])) return match[0].toLowerCase();
  }

  return null;
}

function isUsableEmail(address: string): boolean {
  if (!address || address.length > 254) return false;
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(address)) return false;
  return !EMAIL_NOISE.test(address);
}

/** `wa.me/<number>` and `api.whatsapp.com?phone=` are the two forms in the wild. */
export function pickWhatsApp(html: string, hrefs: string[]): string | null {
  const candidates = [...hrefs, ...matchAllText(html, /https?:\/\/[^\s"'<>]*wa\.me[^\s"'<>]*/gi)];

  for (const href of candidates) {
    let digits: string | null = null;

    const waMe = href.match(/wa\.me\/(?:send\?phone=)?\+?(\d{6,15})/i);
    if (waMe) digits = waMe[1];

    const api = href.match(/(?:api|web)\.whatsapp\.com\/send\?[^"']*phone=\+?(\d{6,15})/i);
    if (api) digits = api[1];

    if (!digits) continue;
    const normalized = normalizePhone(`+${digits}`);
    if (normalized) return normalized;
  }

  return null;
}

/** A page carrying a real form with a message or email field is a contactable rung. */
export function pickContactForm(page: FetchedPage): string | null {
  const hasForm = /<form\b[\s\S]*?<\/form>/i.test(page.html);
  if (!hasForm) return null;

  const formBlocks = page.html.match(/<form\b[\s\S]*?<\/form>/gi) ?? [];
  for (const block of formBlocks) {
    // Search and newsletter boxes are forms too; require a message or email field.
    const isSearch = /type=["']?search|name=["']?(s|q|search)["']/i.test(block);
    const looksLikeContact =
      /type=["']?email|name=["']?(email|message|comment|enquiry|inquiry)/i.test(block) ||
      /<textarea/i.test(block);
    if (!isSearch && looksLikeContact) return page.url;
  }

  return null;
}

function pickSocial(
  hrefs: string[],
  host: RegExp,
  reject?: RegExp,
): string | null {
  for (const href of hrefs) {
    let url: URL;
    try {
      url = new URL(href, "https://placeholder.invalid");
    } catch {
      continue;
    }
    if (url.hostname === "placeholder.invalid") continue;
    if (!host.test(url.hostname)) continue;
    if (url.pathname === "/" || url.pathname === "") continue;
    if (reject?.test(url.pathname)) continue;

    url.search = "";
    url.hash = "";
    return url.toString();
  }
  return null;
}

function matchAllText(html: string, pattern: RegExp): string[] {
  return [...html.matchAll(pattern)].map((m) => m[0]);
}

/**
 * Strips scripts, styles and tags, leaving readable text.
 * Also used to build the Gemini prompt, which is why it collapses whitespace —
 * blank lines are pure token cost.
 */
export function htmlToText(html: string, maxChars = 12_000): string {
  const text = stripScripts(html)
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6])\b[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n\s*/g, "\n")
    .trim();

  return text.slice(0, maxChars);
}

function stripScripts(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
}

/** True once every channel the ladder cares about has been found. */
export function isComplete(contacts: ContactFindings): boolean {
  return Boolean(
    contacts.email &&
      contacts.whatsappPhone &&
      (contacts.instagramUrl || contacts.facebookUrl) &&
      contacts.contactFormUrl,
  );
}
