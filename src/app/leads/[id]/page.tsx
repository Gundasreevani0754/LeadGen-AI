import Link from "next/link";
import { notFound } from "next/navigation";

import {
  ContactTierPill,
  EntityPill,
  GapChips,
  StatusPill,
  TechChips,
} from "@/components/ui/chips";
import { Markdown } from "@/components/ui/markdown";
import { ScoreBreakdown } from "@/components/ui/score-badge";
import { getBriefQuota } from "@/lib/brief/worker";
import { getActivity, type ActivityEvent } from "@/lib/feedback/queries";
import {
  getLeadDetail,
  getNeighbours,
  PIPELINE_STATUSES,
  STATUS_LABELS,
  type LeadDetail,
} from "@/lib/leads/queries";
import { getSettings } from "@/lib/settings";
import {
  moveStatusAction,
  saveNextActionAction,
  saveNoteAction,
  suppressLeadAction,
} from "../actions";
import { LeadActions } from "./lead-actions";

export const dynamic = "force-dynamic";

/**
 * The one-pager view.
 *
 * Everything the operator needs before picking up the phone, in reading order:
 * who they are, how to reach them, what is broken, why the score is what it is,
 * and what to say. Previous/next at the top means the queue can be worked
 * without returning to the table (§12).
 */
export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [lead, neighbours, settings, quota, activity] = await Promise.all([
    getLeadDetail(id),
    getNeighbours(id),
    getSettings(),
    getBriefQuota(),
    getActivity(id),
  ]);

  if (!lead) notFound();

  const qualified =
    lead.score !== null && lead.score >= settings.scoreThreshold && !lead.components?.excluded;

  return (
    <>
      <nav className="mb-6 flex items-center justify-between gap-4 text-sm">
        <Link href="/leads" className="text-ink-muted hover:text-ink">
          ← All leads
        </Link>
        <div className="flex items-center gap-4">
          {neighbours.previous && (
            <Link
              href={`/leads/${neighbours.previous.id}`}
              className="max-w-[12rem] truncate text-ink-muted hover:text-ink"
              title={neighbours.previous.name}
            >
              ← {neighbours.previous.name}
            </Link>
          )}
          {neighbours.next && (
            <Link
              href={`/leads/${neighbours.next.id}`}
              className="max-w-[12rem] truncate text-ink-muted hover:text-ink"
              title={neighbours.next.name}
            >
              {neighbours.next.name} →
            </Link>
          )}
        </div>
      </nav>

      <header className="mb-8 flex flex-wrap items-start justify-between gap-6 border-b border-rule pb-7">
        <div className="min-w-0">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <StatusPill status={lead.status} />
            <EntityPill entity={lead.entityType} />
            <ContactTierPill tier={lead.contactTier} />
            {lead.suppressed && (
              <span className="text-[11px] text-accent">suppressed</span>
            )}
          </div>

          <h1 className="font-display text-[length:var(--text-hero)] leading-[1.05]">
            {lead.name}
          </h1>

          <p className="mt-2 text-sm text-ink-muted">
            {[lead.category, lead.city, lead.address].filter(Boolean).join(" · ") ||
              "No address on file"}
          </p>
        </div>

        <div className="text-right">
          <p className="label-micro mb-1">Score</p>
          <p
            className={`font-display text-[length:var(--text-data)] leading-none ${
              qualified ? "text-accent" : "text-ink-faint"
            }`}
          >
            {lead.score ?? "—"}
          </p>
          <p className="mt-1 text-xs text-ink-faint">
            {lead.score === null
              ? "Not scored yet"
              : qualified
                ? `At or above ${settings.scoreThreshold}`
                : `Below ${settings.scoreThreshold} — cold pool`}
          </p>
        </div>
      </header>

      <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-12">
          <Brief lead={lead} quota={quota} />

          <section>
            <h2 className="label-micro mb-4">Automation gaps</h2>
            <GapChips gaps={lead.gaps} max={12} />
            {lead.crawlStatus && lead.crawlStatus !== "ok" && (
              <p className="mt-3 max-w-prose text-xs text-ink-faint">
                Crawl status <strong>{lead.crawlStatus}</strong>
                {lead.crawlError ? `: ${lead.crawlError}` : ""}. Gap detection is
                partial for this lead — it loses points it might deserve rather than
                gaining ones it might not.
              </p>
            )}
          </section>

          <section>
            <h2 className="label-micro mb-4">Why this score</h2>
            {lead.components ? (
              <>
                <ScoreBreakdown components={lead.components} />
                {lead.components.notes.length > 0 && (
                  <ul className="mt-5 space-y-1.5 text-xs text-ink-faint">
                    {lead.components.notes.map((note) => (
                      <li key={note}>{note}</li>
                    ))}
                  </ul>
                )}
                {lead.components.excluded && (
                  <p className="mt-4 rounded-md border border-accent/30 bg-accent-soft/50 p-3 text-sm text-accent-ink">
                    Excluded: {lead.components.exclusionReason?.replace(/_/g, " ")}.
                    This lead never reaches the daily board.
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm text-ink-muted">
                Not scored yet. Run <code>npm run score</code>, or re-crawl this lead.
              </p>
            )}
          </section>

          <Health lead={lead} />

          <Activity events={activity} />
        </div>

        <aside className="min-w-0 space-y-10">
          <Contacts lead={lead} />

          <section>
            <h2 className="label-micro mb-4">Actions</h2>
            <LeadActions
              businessId={lead.id}
              hasBrief={lead.brief !== null}
              briefsRemaining={quota.remaining}
            />
          </section>

          <Pipeline lead={lead} />
        </aside>
      </div>
    </>
  );
}

function Brief({
  lead,
  quota,
}: {
  lead: LeadDetail;
  quota: { remaining: number; cap: number };
}) {
  if (!lead.brief) {
    return (
      <section className="rounded-lg border border-dashed border-rule-strong bg-paper-sunk/50 p-6">
        <p className="label-micro mb-2">No brief yet</p>
        <p className="max-w-prose text-sm text-ink-muted">
          Claude has not written about this lead. Generating one uses a brief from
          today&apos;s cap — {quota.remaining} of {quota.cap} remain.
        </p>
      </section>
    );
  }

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="label-micro">The angle</h2>
        <p className="text-[11px] text-ink-faint">
          {lead.brief.model} · effort {lead.brief.effort} ·{" "}
          {lead.brief.generatedAt.toLocaleDateString()}
          {lead.brief.regeneratedCount > 0 &&
            ` · regenerated ${lead.brief.regeneratedCount}×`}
        </p>
      </div>

      <blockquote className="mb-6 border-l-2 border-accent pl-4">
        <p className="font-display text-xl leading-snug">{lead.brief.openingLine}</p>
        <footer className="mt-2 text-xs text-ink-faint">
          What to open with
        </footer>
      </blockquote>

      <div className="mb-6">
        <p className="label-micro mb-2">Pain hypothesis</p>
        <p className="max-w-prose text-sm leading-relaxed">{lead.brief.painHypothesis}</p>
      </div>

      <div>
        <p className="label-micro mb-2">What it is costing them</p>
        <div className="max-w-prose">
          <Markdown text={lead.brief.auditMarkdown} />
        </div>
      </div>
    </section>
  );
}

function Health({ lead }: { lead: LeadDetail }) {
  const rows: [string, React.ReactNode][] = [
    ["Google rating", lead.rating === null ? "unrated" : `${lead.rating} / 5`],
    ["Reviews", lead.reviewCount ?? 0],
    [
      "Domain age",
      lead.domainAgeYears === null
        ? "unknown"
        : `${lead.domainAgeYears.toFixed(1)} years${
            lead.domainRegisteredAt ? ` (since ${lead.domainRegisteredAt})` : ""
          }`,
    ],
    ["Built with", <TechChips key="stack" stack={lead.techStack} max={8} />],
    ["Online booking", boolText(lead.hasBooking)],
    ["Chat widget", boolText(lead.hasChat)],
    ["Online payments", boolText(lead.hasOnlinePayment)],
    [
      "Google listing",
      lead.unclaimedListing ? "unclaimed by the owner" : "claimed",
    ],
    ["Business status", lead.businessStatus.replace(/_/g, " ")],
    [
      "Last crawled",
      lead.fetchedAt ? lead.fetchedAt.toLocaleDateString() : "never",
    ],
    ["First seen", lead.firstSeenAt.toLocaleDateString()],
    ["Last seen in a search", lead.lastSeenAt.toLocaleDateString()],
  ];

  return (
    <section>
      <h2 className="label-micro mb-4">Health</h2>
      <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-3 border-b border-rule pb-2">
            <dt className="text-sm text-ink-muted">{label}</dt>
            <dd className="text-right text-sm">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function Contacts({ lead }: { lead: LeadDetail }) {
  const channels: { label: string; value: string; href: string }[] = [];

  if (lead.phoneE164) {
    channels.push({ label: "Phone", value: lead.phoneE164, href: `tel:${lead.phoneE164}` });
  }
  if (lead.whatsappPhone) {
    channels.push({
      label: "WhatsApp",
      value: lead.whatsappPhone,
      href: `https://wa.me/${lead.whatsappPhone.replace(/\D/g, "")}`,
    });
  }
  if (lead.email) {
    channels.push({ label: "Email", value: lead.email, href: `mailto:${lead.email}` });
  }
  if (lead.websiteUrl) {
    channels.push({ label: "Website", value: lead.websiteUrl, href: lead.websiteUrl });
  }
  if (lead.contactFormUrl) {
    channels.push({ label: "Contact form", value: "Open", href: lead.contactFormUrl });
  }
  for (const [label, url] of [
    ["Instagram", lead.instagramUrl],
    ["Facebook", lead.facebookUrl],
    ["LinkedIn", lead.linkedinUrl],
    ["X", lead.xUrl],
  ] as const) {
    if (url) channels.push({ label, value: shorten(url), href: url });
  }
  if (lead.googleMapsUrl) {
    channels.push({ label: "Maps", value: "Open listing", href: lead.googleMapsUrl });
  }

  return (
    <section>
      <h2 className="label-micro mb-4">Contact</h2>
      {channels.length === 0 ? (
        <p className="text-sm text-ink-muted">
          No channel found. This lead is excluded until one appears.
        </p>
      ) : (
        <dl className="space-y-2.5">
          {channels.map((channel) => (
            <div key={channel.label} className="flex items-baseline justify-between gap-3">
              <dt className="text-xs text-ink-faint">{channel.label}</dt>
              <dd className="min-w-0 text-right text-sm">
                <a
                  href={channel.href}
                  target={channel.href.startsWith("http") ? "_blank" : undefined}
                  rel="noreferrer"
                  className="block truncate hover:text-accent"
                >
                  {channel.value}
                </a>
              </dd>
            </div>
          ))}
        </dl>
      )}

      {lead.contactTier &&
        ["linkedin", "social", "form"].includes(lead.contactTier) && (
          <p className="mt-3 text-xs text-ink-faint">
            Contact: partial. No phone or email found, but the channels above are real.
          </p>
        )}
    </section>
  );
}

function Pipeline({ lead }: { lead: LeadDetail }) {
  return (
    <section className="space-y-5">
      <h2 className="label-micro">Pipeline</h2>

      <form action={moveStatusAction} className="flex gap-2">
        <input type="hidden" name="businessId" value={lead.id} />
        {/*
          `key` forces a remount when the value changes. These inputs are
          uncontrolled, and React does not re-apply `defaultValue` on re-render —
          without this the select kept showing the previous status after a save,
          which reads as "the change didn't take".
        */}
        <select
          key={lead.status}
          name="status"
          defaultValue={lead.status}
          className="min-w-0 flex-1 rounded-md border border-rule bg-paper-raised px-2.5 py-2 text-sm"
          aria-label="Pipeline status"
        >
          {PIPELINE_STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </select>
        <button className="rounded-md border border-rule-strong px-3 py-2 text-sm hover:bg-paper-sunk">
          Set
        </button>
      </form>

      <form action={saveNextActionAction} className="flex gap-2">
        <input type="hidden" name="businessId" value={lead.id} />
        <input
          key={lead.nextActionAt?.toISOString() ?? "none"}
          type="date"
          name="nextActionAt"
          defaultValue={
            lead.nextActionAt ? lead.nextActionAt.toISOString().slice(0, 10) : ""
          }
          className="min-w-0 flex-1 rounded-md border border-rule bg-paper-raised px-2.5 py-2 text-sm"
          aria-label="Next action date"
        />
        <button className="rounded-md border border-rule-strong px-3 py-2 text-sm hover:bg-paper-sunk">
          Save
        </button>
      </form>

      <form action={saveNoteAction}>
        <input type="hidden" name="businessId" value={lead.id} />
        <label className="block">
          <span className="label-micro mb-1.5 block">Note</span>
          <textarea
            key={lead.ownerNote ?? "empty"}
            name="note"
            rows={4}
            defaultValue={lead.ownerNote ?? ""}
            placeholder="What was said, what to try next."
            className="w-full rounded-md border border-rule bg-paper-raised px-3 py-2 text-sm placeholder:text-ink-faint"
          />
        </label>
        <button className="mt-2 rounded-md border border-rule-strong px-3 py-2 text-sm hover:bg-paper-sunk">
          Save note
        </button>
      </form>

      <form action={suppressLeadAction}>
        <input type="hidden" name="businessId" value={lead.id} />
        {lead.suppressed && <input type="hidden" name="undo" value="1" />}
        <button className="text-xs text-ink-faint hover:text-accent">
          {lead.suppressed
            ? "Remove from suppression list"
            : "Suppress — never source again"}
        </button>
      </form>
    </section>
  );
}

/**
 * The lead's own history.
 *
 * This is the same `pipeline_events` log the feedback report reads (§14), shown
 * where it is useful day to day: what you did, when, and what you wrote down.
 */
function Activity({ events }: { events: ActivityEvent[] }) {
  if (events.length === 0) {
    return (
      <section>
        <h2 className="label-micro mb-4">Activity</h2>
        <p className="text-sm text-ink-muted">
          Nothing logged yet. Every status change is recorded here with the note you
          left at the time.
        </p>
      </section>
    );
  }

  return (
    <section>
      <h2 className="label-micro mb-4">Activity</h2>
      <ol className="space-y-3 border-l border-rule pl-4">
        {events.map((event) => (
          <li key={event.id} className="relative">
            <span
              aria-hidden
              className="absolute top-1.5 -left-[21px] size-1.5 rounded-full bg-rule-strong"
            />
            <p className="text-sm">
              {event.fromStatus ? (
                <>
                  {STATUS_LABELS[event.fromStatus]}{" "}
                  <span className="text-ink-faint">to</span>{" "}
                </>
              ) : (
                <span className="text-ink-faint">Set to </span>
              )}
              <span className="font-medium">{STATUS_LABELS[event.toStatus]}</span>
            </p>
            <p className="text-xs text-ink-faint">
              {event.occurredAt.toLocaleString()}
            </p>
            {event.note && (
              <p className="mt-1 max-w-prose text-sm text-ink-muted">{event.note}</p>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

function boolText(value: boolean | null): string {
  if (value === null) return "unknown";
  return value ? "yes" : "no";
}

function shorten(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname.replace(/\/$/, "")}`;
  } catch {
    return url;
  }
}
