import { BlockedTargetError, guardedFetch, type HostResolver } from "./guard";
import { ALLOW_ALL, isAllowed, parseRobots, type RobotsRules } from "./robots";
import type { FetchedPage } from "./types";

/**
 * A polite, single-threaded site fetcher.
 *
 * One domain at a time, a fixed delay between requests, an identifying
 * User-Agent, and a hard cap on pages and bytes. These limits exist so a
 * 500-lead overnight run never looks like an attack from the site's side.
 *
 * Every request goes through `guardedFetch`, because the URLs come from Google
 * Maps listings rather than from us — see `guard.ts`.
 */

export const USER_AGENT =
  "AutotechLeadBot/1.0 (+https://autotech.example/bot; internal prospecting; contact via site)";
/** The token a site would write in robots.txt to address us. */
export const USER_AGENT_TOKEN = "autotechleadbot";

export const CRAWL_DELAY_MS = 2_000;
export const REQUEST_TIMEOUT_MS = 15_000;
export const MAX_PAGES_PER_SITE = 4;
export const MAX_BYTES_PER_PAGE = 1_500_000;

/** Paths worth trying beyond the homepage, in the order they earn their request. */
export const CANDIDATE_PATHS = [
  "/contact",
  "/contact-us",
  "/about",
  "/about-us",
  "/book",
  "/book-now",
  "/appointment",
  "/appointments",
];

export interface SiteFetchResult {
  pages: FetchedPage[];
  status: "ok" | "blocked" | "failed";
  error: string | null;
  /** Origin the pages were actually fetched from, after any redirect. */
  origin: string | null;
}

export interface FetchOptions {
  /** Injected so tests never touch the network and runs can be throttled. */
  fetchImpl?: typeof fetch;
  /** Injected so tests never touch DNS. Defaults to a real lookup. */
  resolveHost?: HostResolver;
  delayMs?: number;
  maxPages?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Fetches the homepage plus whichever candidate pages exist and are allowed.
 *
 * Failure is reported, never thrown: a site that blocks us still gets scored
 * (§9) and simply loses the enrichment-derived points.
 */
export async function fetchSite(
  websiteUrl: string,
  options: FetchOptions = {},
): Promise<SiteFetchResult> {
  const {
    fetchImpl = fetch,
    resolveHost,
    delayMs = CRAWL_DELAY_MS,
    maxPages = MAX_PAGES_PER_SITE,
    sleep = defaultSleep,
  } = options;

  let origin: string;
  let homeUrl: string;
  try {
    const parsed = new URL(
      /^https?:\/\//i.test(websiteUrl) ? websiteUrl : `https://${websiteUrl}`,
    );
    origin = parsed.origin;
    homeUrl = parsed.toString();
  } catch {
    return { pages: [], status: "failed", error: "Unparseable URL", origin: null };
  }

  const robots = await loadRobots(origin, fetchImpl, resolveHost);

  if (!isAllowed(robots, new URL(homeUrl).pathname)) {
    return {
      pages: [],
      status: "blocked",
      error: "robots.txt disallows the homepage",
      origin,
    };
  }

  const pages: FetchedPage[] = [];
  const home = await getPage(homeUrl, fetchImpl, resolveHost);

  if (!home.page) {
    return {
      pages: [],
      status: home.blocked ? "blocked" : "failed",
      error: home.error,
      origin,
    };
  }
  pages.push(home.page);

  const targets = discoverTargets(home.page, origin).filter((url) =>
    isAllowed(robots, new URL(url).pathname),
  );

  for (const url of targets) {
    if (pages.length >= maxPages) break;
    await sleep(delayMs);
    const next = await getPage(url, fetchImpl, resolveHost);
    if (next.page) pages.push(next.page);
  }

  return { pages, status: "ok", error: null, origin };
}

async function loadRobots(
  origin: string,
  fetchImpl: typeof fetch,
  resolve: HostResolver | undefined,
): Promise<RobotsRules> {
  try {
    const response = await withTimeout((signal) =>
      guardedFetch(`${origin}/robots.txt`, {
        fetchImpl,
        resolve,
        headers: { "user-agent": USER_AGENT },
        signal,
      }),
    );
    if (!response.ok) return ALLOW_ALL;
    return parseRobots(await response.text(), USER_AGENT_TOKEN);
  } catch {
    // An unreachable robots.txt is not consent to crawl aggressively, but it is
    // also not a prohibition. We stay within our own hard limits either way.
    return ALLOW_ALL;
  }
}

async function getPage(
  url: string,
  fetchImpl: typeof fetch,
  resolve: HostResolver | undefined,
): Promise<{ page: FetchedPage | null; error: string | null; blocked: boolean }> {
  try {
    const response = await withTimeout((signal) =>
      guardedFetch(url, {
        fetchImpl,
        resolve,
        headers: {
          "user-agent": USER_AGENT,
          accept: "text/html,application/xhtml+xml",
        },
        signal,
      }),
    );

    if (response.status === 403 || response.status === 429) {
      return { page: null, error: `HTTP ${response.status}`, blocked: true };
    }
    if (!response.ok) {
      return { page: null, error: `HTTP ${response.status}`, blocked: false };
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !contentType.includes("html")) {
      return { page: null, error: `Not HTML (${contentType})`, blocked: false };
    }

    const html = (await response.text()).slice(0, MAX_BYTES_PER_PAGE);
    return {
      page: { url: response.url || url, html, status: response.status },
      error: null,
      blocked: false,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A blocked target is a refusal, not a transport failure — record it as one
    // so the lead's crawl_status says why nothing was fetched.
    return {
      page: null,
      error: message,
      blocked: error instanceof BlockedTargetError,
    };
  }
}

/**
 * Picks the follow-up pages worth a request: links on the homepage whose href or
 * text suggests contact/about/booking, then the conventional paths as a fallback.
 */
export function discoverTargets(home: FetchedPage, origin: string): string[] {
  const found = new Set<string>();
  const linkPattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]{0,120}?)<\/a>/gi;
  const interesting = /(contact|about|book|appoint|reach|enquir|inquir)/i;

  for (const match of home.html.matchAll(linkPattern)) {
    const [, href, label] = match;
    if (!interesting.test(href) && !interesting.test(stripTags(label))) continue;

    const absolute = toAbsolute(href, home.url);
    if (!absolute) continue;
    if (!absolute.startsWith(origin)) continue;
    if (absolute.replace(/\/$/, "") === home.url.replace(/\/$/, "")) continue;

    found.add(absolute);
  }

  for (const path of CANDIDATE_PATHS) {
    found.add(`${origin}${path}`);
  }

  return [...found];
}

export function toAbsolute(href: string, base: string): string | null {
  if (/^(mailto:|tel:|javascript:|#)/i.test(href)) return null;
  try {
    const url = new URL(href, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    return url.toString();
  } catch {
    return null;
  }
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, " ");
}

/** AbortSignal.timeout isn't available on every runtime we may run this worker on. */
async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  ms = REQUEST_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}
