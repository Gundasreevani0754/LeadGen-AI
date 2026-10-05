/**
 * A deliberately small robots.txt reader.
 *
 * Guardrail §15.7 says crawling is polite. The rules we need are narrow: does
 * this site tell our user-agent to stay out of a path. Wildcards and `Allow`
 * overrides are supported because Wix and Shopify both emit them; anything more
 * exotic (crawl-delay per agent, sitemaps) is ignored on purpose — we already
 * rate-limit ourselves harder than any site would ask.
 */

export interface RobotsRules {
  /** Ordered longest-first so the most specific rule wins, as the spec requires. */
  rules: { path: string; allow: boolean }[];
}

export const ALLOW_ALL: RobotsRules = { rules: [] };

/**
 * Parses robots.txt, keeping only groups that apply to us: our own token and `*`.
 * A more specific agent group replaces the wildcard group entirely, matching the
 * original standard.
 */
export function parseRobots(text: string, userAgentToken: string): RobotsRules {
  const wildcard: { path: string; allow: boolean }[] = [];
  const specific: { path: string; allow: boolean }[] = [];

  let appliesToUs = false;
  let appliesToWildcard = false;
  let inGroupHeader = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;

    const separator = line.indexOf(":");
    if (separator === -1) continue;

    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === "user-agent") {
      // Consecutive user-agent lines share one group of rules.
      if (!inGroupHeader) {
        appliesToUs = false;
        appliesToWildcard = false;
        inGroupHeader = true;
      }
      const agent = value.toLowerCase();
      if (agent === "*") appliesToWildcard = true;
      if (userAgentToken.toLowerCase().includes(agent) && agent !== "*") {
        appliesToUs = true;
      }
      continue;
    }

    inGroupHeader = false;
    if (field !== "disallow" && field !== "allow") continue;
    if (!appliesToUs && !appliesToWildcard) continue;

    // `Disallow:` with an empty value means "allow everything" — not a rule.
    if (field === "disallow" && value === "") continue;

    const rule = { path: value, allow: field === "allow" };
    if (appliesToUs) specific.push(rule);
    else wildcard.push(rule);
  }

  const chosen = specific.length > 0 ? specific : wildcard;
  return { rules: chosen.sort((a, b) => b.path.length - a.path.length) };
}

/** True when the path is not disallowed. Unknown or unparsed robots means allowed. */
export function isAllowed(rules: RobotsRules, pathname: string): boolean {
  for (const rule of rules.rules) {
    if (matchesPattern(rule.path, pathname)) return rule.allow;
  }
  return true;
}

/** robots.txt patterns support `*` as a wildcard and `$` as an end anchor. */
function matchesPattern(pattern: string, pathname: string): boolean {
  if (pattern === "") return false;

  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;

  const escaped = body
    .split("*")
    .map(escapeRegex)
    .join(".*");

  return new RegExp(`^${escaped}${anchored ? "$" : ""}`).test(pathname);
}

/** Escapes every regex metacharacter so a literal path segment matches itself. */
function escapeRegex(literal: string): string {
  const meta = new Set([
    ".",
    "+",
    "?",
    "^",
    "$",
    "{",
    "}",
    "(",
    ")",
    "|",
    "[",
    "]",
    String.fromCharCode(92),
  ]);

  return [...literal]
    .map((char) => (meta.has(char) ? String.fromCharCode(92) + char : char))
    .join("");
}
