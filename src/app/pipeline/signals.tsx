import { MIN_SEGMENT_SAMPLE, type FeedbackReport, type SegmentStat } from "@/lib/feedback/analysis";

/**
 * What is actually converting (§14).
 *
 * The scoring weights in the spec are openly guesses. This is the surface that
 * replaces them with evidence: every dimension is a component of the score, and
 * a component whose bands all reply at the same rate is a component that is not
 * earning its points.
 *
 * Rates on small samples are shown but marked, because the failure mode here is
 * re-tuning a 45-point component on four leads.
 */
export function Signals({ report }: { report: FeedbackReport }) {
  if (report.worked === 0) {
    return (
      <section className="mt-14 border-t border-rule pt-8">
        <h2 className="label-micro mb-3">What is converting</h2>
        <p className="max-w-prose text-sm text-ink-muted">
          Nothing has been contacted yet. Once you start moving leads to{" "}
          <strong>Contacted</strong> and recording what came back, this section
          reports which parts of the score actually predicted a reply — and which
          are just costing you points.
        </p>
      </section>
    );
  }

  return (
    <section className="mt-14 border-t border-rule pt-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="label-micro mb-2">What is converting</h2>
          <p className="max-w-prose text-sm text-ink-muted">
            {report.readyToRetune
              ? `${report.worked} worked leads — enough to re-tune the weights in src/lib/score/score.ts. Bump SCORING_VERSION when you do, so these numbers stay comparable.`
              : `${report.worked} worked leads. ${report.untilRetune} more before these numbers are worth re-tuning on.`}
          </p>
        </div>

        <dl className="flex gap-6 text-sm">
          <Headline label="Replied" value={report.replied} rate={report.replyRate} />
          <Headline label="Calls booked" value={report.booked} rate={report.bookRate} />
          <Headline label="Won" value={report.won} />
        </dl>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        {report.dimensions
          .filter((dimension) => dimension.segments.length > 1)
          .map((dimension) => (
            <div key={dimension.key} className="min-w-0">
              <h3 className="text-sm font-medium">{dimension.title}</h3>
              <p className="mt-0.5 mb-3 text-xs text-ink-faint">{dimension.question}</p>

              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-rule text-left">
                    <th className="label-micro py-1.5 pr-3 font-semibold">Segment</th>
                    <th className="label-micro py-1.5 pr-3 text-right font-semibold">
                      Worked
                    </th>
                    <th className="label-micro py-1.5 pr-3 text-right font-semibold">
                      Replied
                    </th>
                    <th className="label-micro py-1.5 text-right font-semibold">Lift</th>
                  </tr>
                </thead>
                <tbody>
                  {dimension.segments.map((segment) => (
                    <SegmentRow key={segment.label} segment={segment} />
                  ))}
                </tbody>
              </table>
            </div>
          ))}
      </div>

      <p className="mt-8 max-w-prose text-xs text-ink-faint">
        Lift compares a segment&apos;s reply rate with your overall reply rate. Above
        1.0 means that segment replies more often than average. Segments under{" "}
        {MIN_SEGMENT_SAMPLE} leads are greyed out — they are noise, not signal.
      </p>
    </section>
  );
}

function SegmentRow({ segment }: { segment: SegmentStat }) {
  const strong = segment.reliable && segment.lift >= 1.25;
  const weak = segment.reliable && segment.lift <= 0.75;

  return (
    <tr
      className={`border-b border-rule last:border-0 ${
        segment.reliable ? "" : "text-ink-faint"
      }`}
    >
      <td className="py-1.5 pr-3">{segment.label}</td>
      <td className="py-1.5 pr-3 text-right tabular-nums">{segment.worked}</td>
      <td className="py-1.5 pr-3 text-right tabular-nums">
        {segment.replied}
        <span className="text-ink-faint">
          {" "}
          ({Math.round(segment.replyRate * 100)}%)
        </span>
      </td>
      <td
        className={`py-1.5 text-right tabular-nums ${
          strong ? "font-medium text-accent" : weak ? "text-ink-faint" : ""
        }`}
      >
        {segment.worked === 0 ? "—" : `${segment.lift.toFixed(2)}×`}
      </td>
    </tr>
  );
}

function Headline({
  label,
  value,
  rate,
}: {
  label: string;
  value: number;
  rate?: number;
}) {
  return (
    <div>
      <dt className="label-micro mb-1">{label}</dt>
      <dd className="font-display text-2xl leading-none">
        {value}
        {rate !== undefined && (
          <span className="ml-1.5 text-xs text-ink-faint">
            {Math.round(rate * 100)}%
          </span>
        )}
      </dd>
    </div>
  );
}
