"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useActionState, useState } from "react";

import {
  ContactTierPill,
  EntityPill,
  GapChips,
  StatusPill,
  TechChips,
} from "@/components/ui/chips";
import { ScoreBadge } from "@/components/ui/score-badge";
import {
  PIPELINE_STATUSES,
  STATUS_LABELS,
  type LeadRow,
} from "@/lib/leads/constants";
import { bulkStatusAction, bulkSuppressAction, type ActionState } from "./actions";

/**
 * The working table.
 *
 * Selection lives in React state rather than in the URL: it is per-session, it
 * does not survive a filter change, and putting it in the URL would make the
 * back button destroy a half-finished selection.
 *
 * Sorting and filtering do live in the URL — they are worth sharing, bookmarking
 * and reloading into.
 */
const EXPORT_FORM_ID = "one-pager-export";

export function LeadsTable({
  leads,
  threshold,
  sort,
  dir,
}: {
  leads: LeadRow[];
  threshold: number;
  sort: string;
  dir: "asc" | "desc";
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [statusState, applyStatus, movingStatus] = useActionState<ActionState, FormData>(
    bulkStatusAction,
    { status: "idle" },
  );
  const [suppressState, applySuppress, suppressing] = useActionState<
    ActionState,
    FormData
  >(bulkSuppressAction, { status: "idle" });

  const allSelected = leads.length > 0 && selected.size === leads.length;
  const feedback = statusState.status !== "idle" ? statusState : suppressState;

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(leads.map((lead) => lead.id)));
  }

  if (leads.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-rule-strong bg-paper-sunk/50 p-6 text-sm text-ink-muted">
        Nothing matches these filters. Clear them, or source a new niche from the
        generator.
      </p>
    );
  }

  return (
    <>
      <form>
      {selected.size > 0 && (
        <div className="sticky top-0 z-10 mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-rule-strong bg-paper-raised px-4 py-3 shadow-[0_1px_3px_oklch(0%_0_0/0.07)]">
          <span className="text-sm font-medium">
            {selected.size} selected
          </span>

          <select
            name="status"
            defaultValue="qualified"
            className="rounded-md border border-rule bg-paper px-2.5 py-1.5 text-sm"
            aria-label="Move selected leads to status"
          >
            {PIPELINE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STATUS_LABELS[status]}
              </option>
            ))}
          </select>

          <button
            formAction={applyStatus}
            disabled={movingStatus}
            className="rounded-md bg-ink px-3 py-1.5 text-sm font-medium text-paper disabled:opacity-50"
          >
            {movingStatus ? "Moving…" : "Move"}
          </button>

          {/*
            Associated with the standalone form below by id rather than by
            nesting. React owns the surrounding form because its other buttons
            carry server actions, and it drops `formMethod` on the way — the
            browser then sent GET and the route answered 405.
          */}
          <button
            form={EXPORT_FORM_ID}
            title="One PDF, one page per selected lead"
            className="rounded-md border border-rule-strong px-3 py-1.5 text-sm hover:bg-paper-sunk"
          >
            One-pagers
          </button>

          <button
            formAction={applySuppress}
            disabled={suppressing}
            title="Marks them dead and suppresses their phone and domain forever"
            className="rounded-md border border-rule-strong px-3 py-1.5 text-sm text-ink-muted hover:text-accent disabled:opacity-50"
          >
            {suppressing ? "Suppressing…" : "Suppress"}
          </button>

          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="ml-auto text-xs text-ink-faint hover:text-ink"
          >
            Clear selection
          </button>
        </div>
      )}

      {feedback.status !== "idle" && (
        <p
          role="status"
          className={`mb-4 rounded-md border p-3 text-sm ${
            feedback.status === "error"
              ? "border-accent/40 bg-accent-soft/60 text-accent-ink"
              : "border-signal-good/30 bg-paper-sunk text-ink"
          }`}
        >
          {feedback.message}
        </p>
      )}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] text-sm">
          <thead>
            <tr className="border-b border-rule-strong text-left">
              <th className="w-8 py-2.5 pr-2">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Select every lead on this page"
                  className="size-3.5 accent-[var(--color-accent)]"
                />
              </th>
              <SortHeader label="Score" column="score" sort={sort} dir={dir} />
              <th className="label-micro py-2.5 pr-4 font-semibold">Business</th>
              <SortHeader label="Reviews" column="reviews" sort={sort} dir={dir} />
              <SortHeader label="Rating" column="rating" sort={sort} dir={dir} />
              <th className="label-micro py-2.5 pr-4 font-semibold">Years</th>
              <th className="label-micro py-2.5 pr-4 font-semibold">Stack</th>
              <th className="label-micro py-2.5 pr-4 font-semibold">Gaps</th>
              <th className="label-micro py-2.5 pr-4 font-semibold">Contact</th>
              <th className="label-micro py-2.5 pr-4 font-semibold">Status</th>
            </tr>
          </thead>

          <tbody>
            {leads.map((lead) => (
              <tr
                key={lead.id}
                className={`border-b border-rule last:border-0 ${
                  selected.has(lead.id) ? "bg-accent-soft/25" : ""
                }`}
              >
                <td className="py-3 pr-2 align-top">
                  <input
                    type="checkbox"
                    name="selected"
                    value={lead.id}
                    checked={selected.has(lead.id)}
                    onChange={() => toggle(lead.id)}
                    aria-label={`Select ${lead.name}`}
                    className="mt-1 size-3.5 accent-[var(--color-accent)]"
                  />
                </td>

                <td className="py-3 pr-4 align-top">
                  <ScoreBadge score={lead.score} threshold={threshold} size="sm" />
                </td>

                <td className="max-w-[20rem] py-3 pr-4 align-top">
                  <Link
                    href={`/leads/${lead.id}`}
                    className="block truncate font-medium hover:text-accent"
                  >
                    {lead.name}
                  </Link>
                  <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-ink-faint">
                    {lead.city ?? "—"}
                    {lead.category && <span aria-hidden>·</span>}
                    {lead.category}
                  </p>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <EntityPill entity={lead.entityType} />
                    {lead.hasBrief && (
                      <span className="text-[11px] text-signal-good">briefed</span>
                    )}
                    {lead.suppressed && (
                      <span className="text-[11px] text-ink-faint">suppressed</span>
                    )}
                  </div>
                </td>

                <td className="py-3 pr-4 align-top tabular-nums">
                  {lead.reviewCount ?? "—"}
                </td>
                <td className="py-3 pr-4 align-top tabular-nums">
                  {lead.rating ?? "—"}
                </td>
                <td className="py-3 pr-4 align-top tabular-nums text-ink-muted">
                  {lead.domainAgeYears === null ? "—" : lead.domainAgeYears.toFixed(1)}
                </td>
                <td className="py-3 pr-4 align-top">
                  <TechChips stack={lead.techStack} max={2} />
                </td>
                <td className="max-w-[16rem] py-3 pr-4 align-top">
                  <GapChips gaps={lead.gaps} max={3} />
                </td>
                <td className="py-3 pr-4 align-top">
                  <ContactTierPill tier={lead.contactTier} />
                </td>
                <td className="py-3 pr-4 align-top">
                  <StatusPill status={lead.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </form>

      {/*
        A plain HTML form, outside the React-managed one, so the browser submits
        it itself rather than React intercepting it. Nested forms are invalid,
        which is why the button above reaches it by id.

        No `target="_blank"`: the response is an attachment, so the browser
        downloads it and leaves this page exactly where it is. Opening a popup
        added nothing and some embedded browsers turn a popup POST into a plain
        GET, which the route correctly refuses.
      */}
      {selected.size > 0 && (
        <form id={EXPORT_FORM_ID} action="/api/one-pagers" method="post">
          {[...selected].map((id) => (
            <input key={id} type="hidden" name="selected" value={id} />
          ))}
        </form>
      )}
    </>
  );
}

/** A column header that toggles direction, preserving every other filter. */
function SortHeader({
  label,
  column,
  sort,
  dir,
}: {
  label: string;
  column: string;
  sort: string;
  dir: "asc" | "desc";
}) {
  const params = useSearchParams();
  const active = sort === column;
  const nextDir = active && dir === "desc" ? "asc" : "desc";

  const href = new URLSearchParams(params.toString());
  href.set("sort", column);
  href.set("dir", nextDir);

  return (
    <th className="label-micro py-2.5 pr-4 font-semibold">
      <Link
        href={`?${href.toString()}`}
        scroll={false}
        className={`inline-flex items-center gap-1 ${active ? "text-ink" : ""}`}
      >
        {label}
        {active && <span aria-hidden>{dir === "desc" ? "↓" : "↑"}</span>}
      </Link>
    </th>
  );
}
