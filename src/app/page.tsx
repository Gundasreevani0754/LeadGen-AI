import Link from "next/link";

import { ContactTierPill, GapChips } from "@/components/ui/chips";
import { Meter } from "@/components/ui/meter";
import { PageHeader } from "@/components/ui/page-header";
import { ScoreBadge } from "@/components/ui/score-badge";
import { Stat, StatRow } from "@/components/ui/stat";
import { getDbSnapshot } from "@/db/health";
import { getBriefQuota } from "@/lib/brief/worker";
import {
  getFollowUps,
  getFunnel,
  getSpend,
  listLeads,
  type LeadRow,
} from "@/lib/leads/queries";
import { getSettings } from "@/lib/settings";

// Every number here is live state; nothing about this page may be cached.
export const dynamic = "force-dynamic";

export default async function OverviewPage() {
  const snapshot = await getDbSnapshot();

  if (!snapshot.connected) {
    return (
      <>
        <PageHeader
          eyebrow="Overview"
          title="Today"
          description="What's queued, what's been spent, and who's waiting on a follow-up."
        />
        <DatabaseDown error={snapshot.error} />
      </>
    );
  }

  const settings = await getSettings();
  const [funnel, spend, quota, queue, followUps] = await Promise.all([
    getFunnel(settings.scoreThreshold),
    getSpend(),
    getBriefQuota(),
    listLeads({
      status: "new",
      minScore: settings.scoreThreshold,
      qualifiedOnly: true,
      sort: "score",
      limit: 8,
    }),
    getFollowUps(8),
  ]);

  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="Today"
        description="What's queued, what's been spent, and who's waiting on a follow-up."
      />

      <StatRow>
        <Stat
          label="Businesses known"
          value={funnel.sourced}
          footnote="Deduped by phone and domain"
        />
        <Stat
          label="Qualified"
          value={funnel.qualified}
          tone="accent"
          footnote={`Scoring ${settings.scoreThreshold}+`}
        />
        <Stat
          label="Briefed"
          value={funnel.briefed}
          footnote={`${quota.usedToday}/${quota.cap} today`}
        />
        <Stat
          label="In pipeline"
          value={funnel.contacted + funnel.replied + funnel.callsBooked + funnel.won}
          footnote="Past the new stage"
        />
      </StatRow>

      <section className="mt-12">
        <h2 className="label-micro mb-5">Quota, month to date</h2>
        <div className="grid gap-x-10 gap-y-7 sm:grid-cols-2 lg:grid-cols-3">
          <Meter
            label="SerpApi searches"
            used={spend.serpapiSearchesThisMonth}
            limit={settings.serpapiMonthlyQuota}
            footnote="Resets on the 1st. One search returns about 20 places."
          />
          <Meter
            label="Apify credits"
            used={spend.apifyCreditsThisMonth}
            limit={settings.apifyMonthlyCredits}
            unit="USD"
            footnote="Overflow source. Auto-pauses; never bills."
          />
          <Meter
            label="Claude briefs today"
            used={quota.usedToday}
            limit={quota.cap}
            footnote={`${quota.remaining} left in today's cap. ${funnel.briefed} written in total.`}
          />
        </div>
      </section>

      <section className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          <div className="mb-4 flex items-baseline justify-between gap-4">
            <h2 className="label-micro">Today&apos;s queue</h2>
            <Link href="/leads" className="text-xs text-ink-muted hover:text-ink">
              All leads →
            </Link>
          </div>

          {queue.length === 0 ? (
            <EmptyQueue
              sourced={funnel.sourced}
              scored={funnel.scored}
              threshold={settings.scoreThreshold}
            />
          ) : (
            <ul className="divide-y divide-rule border-y border-rule">
              {queue.map((lead) => (
                <QueueRow key={lead.id} lead={lead} threshold={settings.scoreThreshold} />
              ))}
            </ul>
          )}
        </div>

        <aside className="min-w-0 space-y-10">
          <div>
            <h2 className="label-micro mb-4">Follow-ups due</h2>
            {followUps.length === 0 ? (
              <p className="text-sm text-ink-muted">
                Nothing due. Set a next action on a lead and it appears here.
              </p>
            ) : (
              <ul className="space-y-3">
                {followUps.map((lead) => (
                  <li key={lead.id} className="text-sm">
                    <Link href={`/leads/${lead.id}`} className="hover:text-accent">
                      {lead.name}
                    </Link>
                    <p className="text-xs text-ink-faint">
                      {lead.nextActionAt
                        ? `due ${lead.nextActionAt.toLocaleDateString()}`
                        : ""}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h2 className="label-micro mb-4">Funnel</h2>
            <dl className="space-y-2 text-sm">
              <FunnelRow label="Sourced" value={funnel.sourced} />
              <FunnelRow label="Enriched" value={funnel.enriched} />
              <FunnelRow label="Scored" value={funnel.scored} />
              <FunnelRow label="Qualified" value={funnel.qualified} accent />
              <FunnelRow label="Briefed" value={funnel.briefed} />
              <FunnelRow label="Contacted" value={funnel.contacted} />
              <FunnelRow label="Replied" value={funnel.replied} />
              <FunnelRow label="Calls booked" value={funnel.callsBooked} />
              <FunnelRow label="Won" value={funnel.won} />
            </dl>
          </div>
        </aside>
      </section>
    </>
  );
}

function QueueRow({ lead, threshold }: { lead: LeadRow; threshold: number }) {
  return (
    <li className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-4 py-3.5">
      <ScoreBadge score={lead.score} threshold={threshold} size="sm" />

      <div className="min-w-0">
        <Link
          href={`/leads/${lead.id}`}
          className="block truncate font-medium hover:text-accent"
        >
          {lead.name}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-faint">
          <span>{lead.city ?? "—"}</span>
          <span aria-hidden>·</span>
          <span>{lead.reviewCount ?? 0} reviews</span>
          {lead.hasBrief && (
            <>
              <span aria-hidden>·</span>
              <span className="text-signal-good">briefed</span>
            </>
          )}
        </div>
        <div className="mt-2">
          <GapChips gaps={lead.gaps} max={3} />
        </div>
      </div>

      <ContactTierPill tier={lead.contactTier} />
    </li>
  );
}

function FunnelRow({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-rule pb-1.5 last:border-0">
      <dt className="text-ink-muted">{label}</dt>
      <dd className={`tabular-nums ${accent ? "font-medium text-accent" : ""}`}>
        {value}
      </dd>
    </div>
  );
}

function EmptyQueue({
  sourced,
  scored,
  threshold,
}: {
  sourced: number;
  scored: number;
  threshold: number;
}) {
  const message =
    sourced === 0
      ? "Nothing sourced yet. Pick a niche and a city in the generator, check what it costs, then run it."
      : scored === 0
        ? "Businesses are sourced but not scored. Run `npm run enrich` to crawl them, which scores them on the way out."
        : `Nothing is sitting at ${threshold} or above and untouched. Either everything qualified has been worked, or the last batch scored low — check the leads table.`;

  return (
    <div className="rounded-lg border border-dashed border-rule-strong bg-paper-sunk/50 p-6">
      <p className="max-w-prose text-sm text-ink-muted">{message}</p>
      <Link
        href={sourced === 0 ? "/generator" : "/leads"}
        className="mt-4 inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper transition-transform duration-150 ease-[var(--ease-out-expo)] hover:-translate-y-px"
      >
        {sourced === 0 ? "Open the generator" : "Open the leads table"}
        <span aria-hidden>→</span>
      </Link>
    </div>
  );
}

function DatabaseDown({ error }: { error: string }) {
  return (
    <section className="rounded-lg border border-accent/30 bg-accent-soft/50 p-6">
      <p className="label-micro mb-2 text-accent-ink">Database unreachable</p>
      <p className="max-w-prose text-sm text-ink">
        The dashboard is running, but it can&apos;t read from Postgres. Everything
        below depends on that connection.
      </p>
      <pre className="mt-4 overflow-x-auto rounded border border-rule bg-paper-raised p-3 text-xs text-ink-muted">
        {error}
      </pre>
      <p className="mt-4 max-w-prose text-sm text-ink-muted">
        Check <code className="text-ink">DATABASE_URL</code> in{" "}
        <code className="text-ink">.env.local</code>, then run{" "}
        <code className="text-ink">npm run verify</code>.
      </p>
    </section>
  );
}
