/**
 * The score, which the spec makes the dominant visual element (§12).
 *
 * Below threshold it goes quiet rather than red: a 41 is not an error, it is a
 * lead that has not earned a phone call yet.
 */
export function ScoreBadge({
  score,
  threshold,
  size = "md",
}: {
  score: number | null;
  threshold: number;
  size?: "sm" | "md" | "lg";
}) {
  if (score === null) {
    return (
      <span className="text-sm text-ink-faint" title="Not scored yet">
        —
      </span>
    );
  }

  const qualified = score >= threshold;
  const sizes = {
    sm: "text-base",
    md: "text-2xl",
    lg: "text-[length:var(--text-data)]",
  };

  return (
    <span
      className={`font-display leading-none tabular-nums ${sizes[size]} ${
        qualified ? "text-accent" : "text-ink-faint"
      }`}
      title={qualified ? `At or above the ${threshold} threshold` : `Below ${threshold}`}
    >
      {score}
    </span>
  );
}

/**
 * Component bars for the lead detail page.
 *
 * Showing the split is the whole point of storing components separately: the
 * operator can see that a 78 is mostly demand and barely any gap, and adjust
 * what they say on the call accordingly.
 */
export function ScoreBreakdown({
  components,
}: {
  components: {
    demand: number;
    quality: number;
    establishment: number;
    gap: number;
    chainPenalty: number;
  };
}) {
  const rows = [
    { label: "Demand", value: components.demand, max: 45, hint: "Review volume" },
    { label: "Quality", value: components.quality, max: 20, hint: "Star rating" },
    {
      label: "Establishment",
      value: components.establishment,
      max: 15,
      hint: "Domain age",
    },
    { label: "Automation gap", value: components.gap, max: 20, hint: "What's missing" },
  ];

  return (
    <div className="space-y-3">
      {rows.map((row) => (
        <div key={row.label} className="grid grid-cols-[9rem_1fr_3rem] items-center gap-3">
          <div className="min-w-0">
            <p className="truncate text-sm">{row.label}</p>
            <p className="text-[11px] text-ink-faint">{row.hint}</p>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-paper-sunk">
            <div
              className="h-full rounded-full bg-ink/70"
              style={{ width: `${Math.round((row.value / row.max) * 100)}%` }}
            />
          </div>
          <p className="text-right text-sm tabular-nums">
            {row.value}
            <span className="text-ink-faint">/{row.max}</span>
          </p>
        </div>
      ))}

      {components.chainPenalty !== 0 && (
        <div className="grid grid-cols-[9rem_1fr_3rem] items-center gap-3 border-t border-rule pt-3">
          <p className="text-sm text-ink-muted">Chain penalty</p>
          <p className="text-[11px] text-ink-faint">
            More than three locations share this name
          </p>
          <p className="text-right text-sm tabular-nums text-accent">
            {components.chainPenalty}
          </p>
        </div>
      )}
    </div>
  );
}
