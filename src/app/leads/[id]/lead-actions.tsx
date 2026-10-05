"use client";

import { useActionState } from "react";

import { briefLeadAction, recrawlLeadAction, type ActionState } from "../actions";

/**
 * The lead's actions: the two that spend something, and the download that does not.
 *
 * Both are explicit, both say what they cost, and the regenerate variant says
 * out loud that it is spending quota a second time — the one place where the
 * one-brief-per-lead rule is deliberately broken (§7 rule 3).
 */
export function LeadActions({
  businessId,
  hasBrief,
  briefsRemaining,
}: {
  businessId: string;
  hasBrief: boolean;
  briefsRemaining: number;
}) {
  const [briefState, brief, briefing] = useActionState<ActionState, FormData>(
    briefLeadAction,
    { status: "idle" },
  );
  const [crawlState, recrawl, crawling] = useActionState<ActionState, FormData>(
    recrawlLeadAction,
    { status: "idle" },
  );

  const feedback = briefState.status !== "idle" ? briefState : crawlState;
  const capped = briefsRemaining <= 0 && !hasBrief;

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <form>
          <input type="hidden" name="businessId" value={businessId} />
          {hasBrief && <input type="hidden" name="regenerate" value="1" />}
          <button
            formAction={brief}
            disabled={briefing || capped}
            title={
              capped
                ? "Today's brief cap is spent. It resets at midnight."
                : hasBrief
                  ? "Spends a second brief on this lead and logs the regeneration"
                  : `Uses one of your ${briefsRemaining} remaining briefs today`
            }
            className="rounded-md bg-ink px-3.5 py-2 text-sm font-medium text-paper transition-transform duration-150 ease-[var(--ease-out-expo)] hover:-translate-y-px disabled:translate-y-0 disabled:opacity-40"
          >
            {briefing
              ? "Asking Claude…"
              : hasBrief
                ? "Regenerate brief"
                : "Generate brief"}
          </button>
        </form>

        <a
          href={`/api/leads/${businessId}/one-pager`}
          title="A single-page PDF of this lead, generated from what you see here"
          className="rounded-md border border-rule-strong bg-paper-raised px-3.5 py-2 text-sm hover:bg-paper-sunk"
        >
          One-pager
        </a>

        <form>
          <input type="hidden" name="businessId" value={businessId} />
          <button
            formAction={recrawl}
            disabled={crawling}
            title="Crawls the site again now, ignoring the 90-day TTL, then re-scores"
            className="rounded-md border border-rule-strong bg-paper-raised px-3.5 py-2 text-sm hover:bg-paper-sunk disabled:opacity-50"
          >
            {crawling ? "Crawling…" : "Re-crawl"}
          </button>
        </form>
      </div>

      {feedback.status !== "idle" && (
        <p
          role="status"
          className={`mt-3 rounded-md border p-3 text-sm ${
            feedback.status === "error"
              ? "border-accent/40 bg-accent-soft/60 text-accent-ink"
              : "border-signal-good/30 bg-paper-sunk text-ink"
          }`}
        >
          {feedback.message}
        </p>
      )}
    </div>
  );
}
