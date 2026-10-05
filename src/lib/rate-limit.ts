/**
 * A small in-process rate limiter for the operations that cost real money or
 * real time — PDF rendering, crawling, and Claude briefs.
 *
 * Deliberately modest about what it is. This app has exactly one user and no
 * public surface, so the threat is not an attacker: it is a double-clicked
 * button, a runaway script, or a browser retrying a slow PDF request and
 * quietly starting a second render. A fixed-window counter in module scope
 * stops all three.
 *
 * It does not survive a restart and is per-instance, so on serverless it limits
 * per warm instance rather than globally. That is honest and still useful; a
 * database-backed limiter would add a query to every request to defend against
 * a threat this deployment does not have.
 */

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the window resets. Only meaningful when `ok` is false. */
  retryAfter: number;
  remaining: number;
}

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();

/** Keeps the map from growing without bound on a long-lived server. */
const MAX_TRACKED_KEYS = 5_000;

export interface RateLimitOptions {
  /** What is being limited — included in the key so limits do not collide. */
  key: string;
  limit: number;
  windowMs: number;
  now?: number;
}

export function rateLimit({
  key,
  limit,
  windowMs,
  now = Date.now(),
}: RateLimitOptions): RateLimitResult {
  const existing = windows.get(key);

  if (!existing || existing.resetAt <= now) {
    if (windows.size >= MAX_TRACKED_KEYS) sweep(now);
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0, remaining: limit - 1 };
  }

  if (existing.count >= limit) {
    return {
      ok: false,
      retryAfter: Math.ceil((existing.resetAt - now) / 1000),
      remaining: 0,
    };
  }

  existing.count += 1;
  return { ok: true, retryAfter: 0, remaining: limit - existing.count };
}

/** Drops expired windows. Called only when the map gets large. */
function sweep(now: number): void {
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
}

/** Test seam — the limiter is module state, which tests must be able to reset. */
export function resetRateLimits(): void {
  windows.clear();
}

/**
 * The limits themselves, in one place.
 *
 * Each is set a few times above what the operator could plausibly do by hand,
 * so the limiter only ever catches a loop or a stuck retry.
 */
export const LIMITS = {
  /** One PDF takes ~2s; ten a minute is far past clicking, well short of a loop. */
  onePager: { limit: 10, windowMs: 60_000 },
  /** A bulk export can be 100 pages, so it is held tighter. */
  onePagerBundle: { limit: 4, windowMs: 60_000 },
  /** Crawling someone else's site: politeness matters more than convenience. */
  recrawl: { limit: 6, windowMs: 60_000 },
  /** Briefs are capped per day anyway; this stops a double-click double-spending. */
  brief: { limit: 4, windowMs: 60_000 },
  /** Sourcing spends provider quota on every call. */
  sourcing: { limit: 6, windowMs: 60_000 },
} as const;
