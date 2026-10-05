/**
 * The settings *shape*, with no database behind it.
 *
 * Split out from `settings.ts` because the Settings form is a client component:
 * importing the server module for one constant would drag the Postgres driver
 * into the browser bundle, which Next refuses to build — correctly.
 */

export type ClaudeEffort = "low" | "medium" | "high" | "xhigh" | "max";

export const CLAUDE_EFFORTS: ClaudeEffort[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/**
 * What a model name may contain.
 *
 * Narrower than "a non-empty string" on purpose: this value is settable from
 * the Settings page and ends up on a `cmd.exe` command line in the briefing
 * worker, where `&`, `|`, `>` and a bare `"` are shell syntax rather than
 * characters. Lives here so both the form and the worker share one definition.
 */
export const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export interface Settings {
  scoreThreshold: number;
  serviceProviderMaxRatio: number;
  enrichmentTtlDays: number;
  claudeModel: string;
  claudeEffort: ClaudeEffort;
  claudeDailyBriefCap: number;
  serpapiMonthlyQuota: number;
  apifyMonthlyCredits: number;
}
