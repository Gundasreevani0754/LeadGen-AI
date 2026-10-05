/**
 * A single number with its label and an optional footnote.
 * Scale contrast is the hierarchy here — the number is large, everything else recedes.
 */
export function Stat({
  label,
  value,
  footnote,
  tone = "neutral",
}: {
  label: string;
  value: string | number;
  footnote?: string;
  tone?: "neutral" | "accent" | "muted";
}) {
  const valueTone =
    tone === "accent"
      ? "text-accent"
      : tone === "muted"
        ? "text-ink-faint"
        : "text-ink";

  return (
    <div className="min-w-0">
      <p className="label-micro mb-1.5">{label}</p>
      <p
        className={`font-display text-[length:var(--text-data)] leading-none ${valueTone}`}
      >
        {value}
      </p>
      {footnote && (
        <p className="mt-1.5 text-xs text-ink-faint">{footnote}</p>
      )}
    </div>
  );
}

/** Horizontal rule-separated group of stats. Ruled, not boxed — keeps it editorial. */
export function StatRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-x-6 gap-y-8 border-y border-rule py-7 sm:grid-cols-3 lg:grid-cols-4">
      {children}
    </div>
  );
}
