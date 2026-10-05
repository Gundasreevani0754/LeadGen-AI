"use client";

import { useActionState, useState } from "react";

import {
  previewAction,
  runAction,
  type PreviewState,
  type RunState,
} from "./actions";

/**
 * Two-step by design. Step one reads history and costs nothing; step two spends
 * provider quota. The run button stays disabled until a preview has been shown,
 * so quota is never spent on a query the operator hasn't looked at first.
 *
 * The inputs are controlled deliberately: React resets an uncontrolled form once
 * a form action resolves, which emptied these fields after the free check and
 * then let `required` block the paid run with no visible error.
 */
export function GeneratorForm({
  initialNiche = "",
  initialCity = "",
  initialProvider = "serpapi",
}: {
  initialNiche?: string;
  initialCity?: string;
  initialProvider?: "serpapi" | "apify";
}) {
  const [niche, setNiche] = useState(initialNiche);
  const [city, setCity] = useState(initialCity);

  const [preview, checkQuery, checking] = useActionState<PreviewState, FormData>(
    previewAction,
    { status: "idle" },
  );
  const [run, startRun, running] = useActionState<RunState, FormData>(runAction, {
    status: "idle",
  });

  /**
   * Which panel the right-hand column shows. Set from the click handlers rather
   * than an effect — each button already knows which panel it is heading for.
   * Without it, a completed run would permanently occlude the preview and the
   * operator could never check a second query without reloading.
   */
  const [view, setView] = useState<"preview" | "result">("preview");

  const canRun = preview.status === "ready" && !running;

  return (
    <div className="grid gap-10 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
      <form className="space-y-5">
        <Field
          label="Niche"
          name="niche"
          placeholder="Dental clinic"
          hint="What the business does, as Google Maps would categorise it."
          value={niche}
          onChange={setNiche}
        />
        <Field
          label="City"
          name="city"
          placeholder="Warangal"
          value={city}
          onChange={setCity}
        />

        <div className="grid grid-cols-2 gap-4">
          <label className="block">
            <span className="label-micro mb-1.5 block">Max results</span>
            <select
              name="limit"
              defaultValue="20"
              className="w-full rounded-md border border-rule bg-paper-raised px-3 py-2 text-sm"
            >
              {[20, 40, 60, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="label-micro mb-1.5 block">Source</span>
            <select
              name="provider"
              defaultValue={initialProvider}
              className="w-full rounded-md border border-rule bg-paper-raised px-3 py-2 text-sm"
            >
              <option value="serpapi">SerpApi</option>
              <option value="apify">Apify</option>
            </select>
          </label>
        </div>

        <div className="flex flex-wrap gap-3 pt-2">
          <button
            formAction={checkQuery}
            onClick={() => setView("preview")}
            disabled={checking}
            className="rounded-md border border-rule-strong bg-paper-raised px-4 py-2 text-sm font-medium transition-colors hover:bg-paper-sunk disabled:opacity-50"
          >
            {checking ? "Checking…" : "Check first"}
          </button>

          <button
            formAction={startRun}
            onClick={() => setView("result")}
            disabled={!canRun}
            title={
              canRun ? undefined : "Run a check first so you can see what it costs"
            }
            className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper transition-transform duration-150 ease-[var(--ease-out-expo)] hover:-translate-y-px disabled:translate-y-0 disabled:opacity-40"
          >
            {running ? "Sourcing…" : "Run and spend quota"}
          </button>
        </div>
      </form>

      <div className="min-w-0">
        {preview.status === "error" && <Notice tone="error">{preview.message}</Notice>}
        {view === "result" && run.status === "error" && (
          <Notice tone="error">{run.message}</Notice>
        )}
        {view === "preview" && preview.status === "ready" && (
          <PreviewPanel state={preview} />
        )}
        {view === "result" && run.status === "done" && <ResultPanel state={run} />}
        {preview.status === "idle" && run.status === "idle" && (
          <p className="max-w-prose text-sm text-ink-muted">
            Checking is free — it reads your own history and tells you whether
            you&apos;ve sourced this query before. Nothing is spent until you press
            run.
          </p>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  name,
  placeholder,
  hint,
  value,
  onChange,
}: {
  label: string;
  name: string;
  placeholder: string;
  hint?: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <label className="block">
      <span className="label-micro mb-1.5 block">{label}</span>
      <input
        name={name}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
        className="w-full rounded-md border border-rule bg-paper-raised px-3 py-2 text-sm placeholder:text-ink-faint"
      />
      {hint && <span className="mt-1.5 block text-xs text-ink-faint">{hint}</span>}
    </label>
  );
}

function PreviewPanel({ state }: { state: Extract<PreviewState, { status: "ready" }> }) {
  const { preview, request } = state;
  const repeat = preview.priorRuns > 0;

  return (
    <section className="space-y-6">
      <div>
        <p className="label-micro mb-2">
          {repeat ? "You have run this before" : "New query"}
        </p>
        <p className="font-display text-2xl leading-tight">
          {request.niche} in {request.city}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-5 border-y border-rule py-6 sm:grid-cols-3">
        <Metric
          label={preview.provider === "serpapi" ? "Searches" : "Credits (USD)"}
          value={
            preview.provider === "serpapi"
              ? String(preview.unitsRequired)
              : `~$${(preview.unitsRequired * 0.004).toFixed(2)}`
          }
        />
        <Metric label="Times run before" value={String(preview.priorRuns)} />
        <Metric label="Already on file" value={String(preview.knownFromQuery)} />
      </dl>

      {repeat ? (
        <div className="rounded-lg border border-accent/30 bg-accent-soft/50 p-5">
          <p className="text-sm text-ink">
            You last ran this{" "}
            <strong>{formatWhen(preview.lastRunAt)}</strong> and already have{" "}
            <strong>{preview.knownFromQuery}</strong> businesses from it.
            {preview.lastDuplicateRate !== null && (
              <>
                {" "}
                That run was{" "}
                <strong>{Math.round(preview.lastDuplicateRate * 100)}%</strong>{" "}
                duplicates.
              </>
            )}{" "}
            Running it again will mostly rediscover what you have — the search is
            billed either way.
          </p>
        </div>
      ) : (
        <p className="max-w-prose text-sm text-ink-muted">
          You&apos;ve never sourced this query. There&apos;s no way to know the
          duplicate rate without running it — providers bill on request, not on
          novelty. Duplicates will still be detected and won&apos;t be stored twice.
        </p>
      )}
    </section>
  );
}

function ResultPanel({ state }: { state: Extract<RunState, { status: "done" }> }) {
  const { result } = state;
  const savedPct =
    result.returned > 0 ? Math.round((result.duplicates / result.returned) * 100) : 0;

  return (
    <section className="space-y-6">
      <p className="label-micro">Run complete</p>
      <dl className="grid grid-cols-2 gap-x-6 gap-y-5 border-y border-rule py-6 sm:grid-cols-4">
        <Metric label="Returned" value={String(result.returned)} />
        <Metric label="New" value={String(result.fresh)} accent />
        <Metric label="Already known" value={String(result.duplicates)} />
        <Metric label="Suppressed" value={String(result.suppressed)} />
      </dl>
      <p className="max-w-prose text-sm text-ink-muted">
        {result.fresh === 0
          ? "Nothing new. Every result was already on file — no duplicate rows were written."
          : `${result.fresh} new businesses stored. ${savedPct}% of the results were already known and were not duplicated.`}
      </p>
    </section>
  );
}

function Metric({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div>
      <dt className="label-micro mb-1">{label}</dt>
      <dd
        className={`font-display text-3xl leading-none ${accent ? "text-accent" : ""}`}
      >
        {value}
      </dd>
    </div>
  );
}

function Notice({
  tone,
  children,
}: {
  tone: "error";
  children: React.ReactNode;
}) {
  return (
    <p
      role="alert"
      className={`mb-6 rounded-md border p-4 text-sm ${
        tone === "error"
          ? "border-accent/40 bg-accent-soft/60 text-accent-ink"
          : "border-rule"
      }`}
    >
      {children}
    </p>
  );
}

function formatWhen(date: Date | null): string {
  if (!date) return "previously";
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return date.toLocaleDateString();
}
