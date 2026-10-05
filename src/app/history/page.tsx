import Link from "next/link";
import { desc } from "drizzle-orm";

import { PageHeader } from "@/components/ui/page-header";
import { Stat, StatRow } from "@/components/ui/stat";
import { db } from "@/db";
import { searchRuns } from "@/db/schema";

export const dynamic = "force-dynamic";

/**
 * Every run, with what it cost and what it yielded.
 *
 * The duplicate rate column is the one that earns its place: watching it climb
 * on repeat queries is how the operator learns which niches are exhausted,
 * without having to spend a search to find out.
 */
export default async function HistoryPage() {
  const runs = await db
    .select()
    .from(searchRuns)
    .orderBy(desc(searchRuns.startedAt))
    .limit(100);

  const completed = runs.filter((run) => run.status === "completed");
  const returned = sum(completed.map((run) => run.returnedCount));
  const fresh = sum(completed.map((run) => run.newCount));
  const searches = sum(
    completed.filter((run) => run.provider === "serpapi").map((run) => Number(run.unitsSpent)),
  );
  const credits = sum(
    completed.filter((run) => run.provider === "apify").map((run) => Number(run.unitsSpent)),
  );

  return (
    <>
      <PageHeader
        eyebrow="History"
        title="Past runs"
        description="What each run cost and what it actually yielded. Replay any of them from here."
      />

      {runs.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No runs yet. The generator records every one here.
        </p>
      ) : (
        <>
          <StatRow>
            <Stat label="Runs" value={runs.length} />
            <Stat
              label="New businesses"
              value={fresh}
              tone="accent"
              footnote={`From ${returned} results`}
            />
            <Stat
              label="Duplicate rate"
              value={returned > 0 ? `${Math.round(((returned - fresh) / returned) * 100)}%` : "—"}
              footnote="Results you already had"
            />
            <Stat
              label="Spent"
              value={`${searches} + $${credits.toFixed(2)}`}
              footnote="SerpApi searches + Apify credits"
            />
          </StatRow>

          <div className="mt-10 overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead>
                <tr className="border-b border-rule-strong text-left">
                  {[
                    "Query",
                    "When",
                    "Source",
                    "Returned",
                    "New",
                    "Known",
                    "Dupe rate",
                    "Spent",
                    "",
                  ].map((heading) => (
                    <th
                      key={heading}
                      className="label-micro py-2.5 pr-4 font-semibold"
                    >
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {runs.map((run) => {
                  const dupeRate =
                    run.returnedCount > 0
                      ? Math.round((run.duplicateCount / run.returnedCount) * 100)
                      : null;

                  return (
                    <tr key={run.id} className="border-b border-rule last:border-0">
                      <td className="py-3 pr-4">
                        <span className="font-medium">{run.niche}</span>
                        <span className="text-ink-faint"> · {run.city}</span>
                        {run.status === "failed" && (
                          <span
                            className="ml-2 text-xs text-accent"
                            title={run.error ?? undefined}
                          >
                            failed
                          </span>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-ink-muted">
                        {run.startedAt.toLocaleDateString()}
                      </td>
                      <td className="py-3 pr-4 text-ink-muted">{run.provider}</td>
                      <td className="py-3 pr-4 tabular-nums">{run.returnedCount}</td>
                      <td className="py-3 pr-4 font-medium tabular-nums text-accent">
                        {run.newCount}
                      </td>
                      <td className="py-3 pr-4 tabular-nums text-ink-muted">
                        {run.duplicateCount}
                      </td>
                      <td className="py-3 pr-4 tabular-nums text-ink-muted">
                        {dupeRate === null ? "—" : `${dupeRate}%`}
                      </td>
                      <td className="py-3 pr-4 tabular-nums text-ink-muted">
                        {run.provider === "serpapi"
                          ? `${Number(run.unitsSpent)} search`
                          : `$${Number(run.unitsSpent).toFixed(3)}`}
                      </td>
                      <td className="py-3 pr-4 text-right">
                        <Link
                          href={`/generator?niche=${encodeURIComponent(run.niche)}&city=${encodeURIComponent(run.city)}&provider=${run.provider}`}
                          className="text-xs text-ink-muted hover:text-accent"
                        >
                          Replay
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}
