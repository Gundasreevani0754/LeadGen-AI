"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useRef } from "react";

import { PIPELINE_STATUSES, STATUS_LABELS } from "@/lib/leads/constants";

/**
 * Filters live in the URL, so a view the operator likes is a bookmark and the
 * back button does what it looks like it does.
 *
 * The form submits itself on change rather than needing an Apply button — with
 * five filters and a search box, an extra click per adjustment is the difference
 * between a tool that gets used and one that doesn't.
 */
export function FilterBar({ threshold }: { threshold: number }) {
  const params = useSearchParams();
  const router = useRouter();
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  function submit(form: HTMLFormElement) {
    const data = new FormData(form);
    const next = new URLSearchParams();

    for (const [key, value] of data.entries()) {
      const text = String(value).trim();
      if (text && text !== "all") next.set(key, text);
    }

    // Sorting is not part of this form; carry it across untouched.
    for (const key of ["sort", "dir"]) {
      const existing = params.get(key);
      if (existing) next.set(key, existing);
    }

    router.push(next.toString() ? `/leads?${next.toString()}` : "/leads");
  }

  return (
    <form
      onChange={(event) => submit(event.currentTarget)}
      onSubmit={(event) => {
        event.preventDefault();
        submit(event.currentTarget);
      }}
      className="mb-6 flex flex-wrap items-end gap-3 border-b border-rule pb-5"
    >
      <label className="block min-w-[14rem] flex-1">
        <span className="label-micro mb-1.5 block">Search</span>
        <input
          name="q"
          defaultValue={params.get("q") ?? ""}
          placeholder="Name, city or category"
          onChange={(event) => {
            // Debounced so typing does not push a history entry per keystroke.
            const form = event.currentTarget.form;
            if (debounce.current) clearTimeout(debounce.current);
            if (form) debounce.current = setTimeout(() => submit(form), 350);
          }}
          className="w-full rounded-md border border-rule bg-paper-raised px-3 py-2 text-sm placeholder:text-ink-faint"
        />
      </label>

      <Select name="status" label="Status" value={params.get("status")}>
        <option value="all">Any</option>
        {PIPELINE_STATUSES.map((status) => (
          <option key={status} value={status}>
            {STATUS_LABELS[status]}
          </option>
        ))}
      </Select>

      <Select name="entity" label="Type" value={params.get("entity")}>
        <option value="all">Any</option>
        <option value="business">Business</option>
        <option value="service_provider">Provider</option>
      </Select>

      <Select name="tier" label="Contact" value={params.get("tier")}>
        <option value="all">Any</option>
        <option value="phone">Phone</option>
        <option value="email">Email</option>
        <option value="linkedin">LinkedIn</option>
        <option value="social">Social</option>
        <option value="form">Form</option>
        <option value="none">None</option>
      </Select>

      <Select name="briefed" label="Brief" value={params.get("briefed")}>
        <option value="all">Any</option>
        <option value="no">Not briefed</option>
        <option value="yes">Briefed</option>
      </Select>

      <Select name="min" label="Min score" value={params.get("min")}>
        <option value="all">Any</option>
        <option value={String(threshold)}>{threshold}+ (qualified)</option>
        <option value="50">50+</option>
        <option value="80">80+</option>
      </Select>

      {params.toString() && (
        <button
          type="button"
          onClick={() => router.push("/leads")}
          className="pb-2 text-xs text-ink-faint hover:text-ink"
        >
          Reset
        </button>
      )}
    </form>
  );
}

function Select({
  name,
  label,
  value,
  children,
}: {
  name: string;
  label: string;
  value: string | null;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="label-micro mb-1.5 block">{label}</span>
      <select
        name={name}
        defaultValue={value ?? "all"}
        className="rounded-md border border-rule bg-paper-raised px-2.5 py-2 text-sm"
      >
        {children}
      </select>
    </label>
  );
}
