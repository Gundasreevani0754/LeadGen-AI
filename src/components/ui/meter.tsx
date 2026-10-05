/**
 * A quota meter.
 *
 * The bar fills toward a limit the operator cannot exceed without paying, which
 * is the one thing this project is not allowed to do. It turns accent only in
 * the last quarter, so a glance is enough.
 */
export function Meter({
  label,
  used,
  limit,
  unit,
  footnote,
}: {
  label: string;
  used: number;
  limit: number;
  unit?: string;
  footnote?: string;
}) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const tight = pct >= 75;

  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <p className="label-micro">{label}</p>
        <p className="text-xs tabular-nums text-ink-muted">
          <span className={tight ? "font-medium text-accent" : "text-ink"}>
            {formatUnits(used)}
          </span>
          <span className="text-ink-faint">
            {" / "}
            {formatUnits(limit)}
            {unit ? ` ${unit}` : ""}
          </span>
        </p>
      </div>

      <div
        className="h-1.5 overflow-hidden rounded-full bg-paper-sunk"
        role="meter"
        aria-valuenow={used}
        aria-valuemin={0}
        aria-valuemax={limit}
        aria-label={label}
      >
        <div
          className={`h-full rounded-full transition-[width] duration-500 ease-[var(--ease-out-expo)] ${
            tight ? "bg-accent" : "bg-ink/70"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {footnote && <p className="mt-1.5 text-[11px] text-ink-faint">{footnote}</p>}
    </div>
  );
}

function formatUnits(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2);
}
