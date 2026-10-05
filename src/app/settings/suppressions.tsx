import Link from "next/link";

import type { SuppressionRow } from "@/lib/feedback/queries";
import { releaseSuppressionAction } from "./actions";

/**
 * The permanent do-not-source list (§15.6).
 *
 * Suppression is keyed by phone and domain rather than by business id, so an
 * entry keeps working after a listing is renamed or re-created. That also means
 * an entry can outlive the row it came from, which is why the name can be blank.
 *
 * Releasing one is deliberately available but quiet: the whole point is that
 * these never resurface by accident.
 */
export function Suppressions({ rows }: { rows: SuppressionRow[] }) {
  if (rows.length === 0) {
    return (
      <section className="mt-12 max-w-2xl border-t border-rule pt-6">
        <p className="label-micro mb-2">Suppressed</p>
        <p className="max-w-prose text-sm text-ink-muted">
          Nothing suppressed. Marking a lead dead, or suppressing it from the leads
          table, adds its phone number and domain here permanently — they are
          filtered out of every future search before a single row is written.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-12 max-w-2xl border-t border-rule pt-6">
      <p className="label-micro mb-2">Suppressed</p>
      <p className="mb-5 max-w-prose text-sm text-ink-muted">
        {rows.length} {rows.length === 1 ? "entry" : "entries"}. These phone numbers
        and domains are filtered out of every search before anything is written, so
        they cannot come back through a different niche or city.
      </p>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-rule-strong text-left">
            {["Business", "Key", "Reason", "When", ""].map((heading) => (
              <th key={heading} className="label-micro py-2 pr-3 font-semibold">
                {heading}
              </th>
            ))}
          </tr>
        </thead>

        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-b border-rule last:border-0">
              <td className="py-2.5 pr-3">
                {row.businessId ? (
                  <Link
                    href={`/leads/${row.businessId}`}
                    className="hover:text-accent"
                  >
                    {row.businessName}
                  </Link>
                ) : (
                  <span className="text-ink-faint">no longer on file</span>
                )}
              </td>
              <td className="py-2.5 pr-3 text-xs text-ink-muted">
                {[row.phoneE164, row.rootDomain].filter(Boolean).join(" · ")}
              </td>
              <td className="py-2.5 pr-3 text-ink-muted">
                {row.reason.replace(/_/g, " ")}
              </td>
              <td className="py-2.5 pr-3 text-ink-faint">
                {row.createdAt.toLocaleDateString()}
              </td>
              <td className="py-2.5 text-right">
                <form action={releaseSuppressionAction}>
                  <input type="hidden" name="suppressionId" value={row.id} />
                  <button className="text-xs text-ink-faint hover:text-accent">
                    Release
                  </button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
