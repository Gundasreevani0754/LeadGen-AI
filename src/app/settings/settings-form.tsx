"use client";

import { useActionState } from "react";

import { CLAUDE_EFFORTS, type Settings } from "@/lib/settings-types";
import { saveSettingsAction, type SettingsState } from "./actions";

/**
 * The tuning knobs, in the order they matter.
 *
 * Each field says what it does in plain language rather than naming the variable
 * it maps to — the operator should not have to read the spec to know what
 * moving the threshold from 65 to 70 will do to tomorrow's queue.
 */
export function SettingsForm({ settings }: { settings: Settings }) {
  const [state, save, saving] = useActionState<SettingsState, FormData>(
    saveSettingsAction,
    { status: "idle" },
  );

  return (
    <form action={save} className="max-w-2xl space-y-10">
      <fieldset className="space-y-5">
        <legend className="label-micro mb-3">Qualification</legend>

        <Field
          label="Score threshold"
          name="scoreThreshold"
          type="number"
          defaultValue={settings.scoreThreshold}
          min={0}
          max={100}
          hint="Leads below this go to the cold pool and never reach the daily board."
        />

        <Field
          label="Max service-provider share"
          name="serviceProviderMaxRatio"
          type="number"
          step="0.05"
          min={0}
          max={1}
          defaultValue={settings.serviceProviderMaxRatio}
          hint="0.30 means at most 30% of any delivered batch may be agencies and freelancers. The rest are held, not deleted."
        />
      </fieldset>

      <fieldset className="space-y-5">
        <legend className="label-micro mb-3">Enrichment</legend>

        <Field
          label="Re-crawl after (days)"
          name="enrichmentTtlDays"
          type="number"
          min={1}
          max={3650}
          defaultValue={settings.enrichmentTtlDays}
          hint="Enrichment inside this window is skipped entirely and costs nothing."
        />
      </fieldset>

      <fieldset className="space-y-5">
        <legend className="label-micro mb-3">Claude briefing</legend>

        <Field
          label="Model"
          name="claudeModel"
          defaultValue={settings.claudeModel}
          hint="Passed straight to `claude -p --model`. Runs on your subscription, not on API credits."
        />

        <label className="block">
          <span className="label-micro mb-1.5 block">Effort</span>
          <select
            name="claudeEffort"
            defaultValue={settings.claudeEffort}
            className="w-full rounded-md border border-rule bg-paper-raised px-3 py-2 text-sm"
          >
            {CLAUDE_EFFORTS.map((effort) => (
              <option key={effort} value={effort}>
                {effort}
              </option>
            ))}
          </select>
          <span className="mt-1.5 block text-xs text-ink-faint">
            Medium is the default. Higher effort spends more of your plan window per brief.
          </span>
        </label>

        <Field
          label="Daily brief cap"
          name="claudeDailyBriefCap"
          type="number"
          min={0}
          max={200}
          defaultValue={settings.claudeDailyBriefCap}
          hint="Matches your outreach rhythm, so briefing never eats quota you need elsewhere."
        />
      </fieldset>

      <fieldset className="space-y-5">
        <legend className="label-micro mb-3">Quota meters</legend>
        <p className="max-w-prose text-xs text-ink-faint">
          These only draw the meters on the Overview. They do not restrict anything —
          the providers enforce their own free-tier limits.
        </p>

        <Field
          label="SerpApi searches per month"
          name="serpapiMonthlyQuota"
          type="number"
          min={0}
          defaultValue={settings.serpapiMonthlyQuota}
        />

        <Field
          label="Apify credits per month (USD)"
          name="apifyMonthlyCredits"
          type="number"
          step="0.5"
          min={0}
          defaultValue={settings.apifyMonthlyCredits}
        />
      </fieldset>

      <div className="flex items-center gap-4 border-t border-rule pt-6">
        <button
          disabled={saving}
          className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-paper transition-transform duration-150 ease-[var(--ease-out-expo)] hover:-translate-y-px disabled:translate-y-0 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save settings"}
        </button>

        {state.status !== "idle" && (
          <p
            role="status"
            className={`text-sm ${
              state.status === "error" ? "text-accent-ink" : "text-ink-muted"
            }`}
          >
            {state.message}
          </p>
        )}
      </div>
    </form>
  );
}

function Field({
  label,
  name,
  hint,
  ...input
}: {
  label: string;
  name: string;
  hint?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      <span className="label-micro mb-1.5 block">{label}</span>
      <input
        name={name}
        {...input}
        className="w-full rounded-md border border-rule bg-paper-raised px-3 py-2 text-sm"
      />
      {hint && <span className="mt-1.5 block text-xs text-ink-faint">{hint}</span>}
    </label>
  );
}
