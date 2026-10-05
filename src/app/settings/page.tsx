import { PageHeader } from "@/components/ui/page-header";
import { listSuppressions } from "@/lib/feedback/queries";
import { envDefaults, getSettings } from "@/lib/settings";
import { SettingsForm } from "./settings-form";
import { Suppressions } from "./suppressions";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [settings, suppressed] = await Promise.all([
    getSettings(),
    listSuppressions(),
  ]);
  const defaults = envDefaults();

  const overridden = (Object.keys(defaults) as (keyof typeof defaults)[]).filter(
    (key) => settings[key] !== defaults[key],
  );

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Thresholds and models"
        description="Stored in the database, not in the environment — a change here reaches the local workers on their next run, with no redeploy."
      />

      <SettingsForm settings={settings} />

      <Suppressions rows={suppressed} />

      <section className="mt-12 max-w-2xl border-t border-rule pt-6">
        <p className="label-micro mb-2">Defaults</p>
        <p className="max-w-prose text-sm text-ink-muted">
          {overridden.length === 0
            ? "Every value above is still the default from .env.local. Saving writes an override that takes precedence from then on."
            : `${overridden.length} ${overridden.length === 1 ? "value overrides" : "values override"} the .env.local defaults: ${overridden.join(", ")}.`}
        </p>
      </section>
    </>
  );
}
