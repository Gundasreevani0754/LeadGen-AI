import { GAP_LABELS } from "@/lib/score/score";
import type { ContactTier, EntityType, GapSignal } from "@/lib/score/types";
import { STATUS_LABELS, type PipelineStatus } from "@/lib/leads/constants";

/**
 * The small, dense vocabulary the whole app shares.
 *
 * Gaps get the accent treatment because they are the pitch — the reason the
 * operator picks up the phone. Everything else stays quiet so the gaps and the
 * score are the only things that shout.
 */

export function GapChips({
  gaps,
  max = 4,
}: {
  gaps: GapSignal[];
  max?: number;
}) {
  if (gaps.length === 0) {
    return <span className="text-xs text-ink-faint">No gaps found</span>;
  }

  const shown = gaps.slice(0, max);
  const rest = gaps.length - shown.length;

  return (
    <span className="flex flex-wrap gap-1.5">
      {shown.map((gap) => (
        <span
          key={gap}
          className="rounded-full border border-accent/25 bg-accent-soft/60 px-2 py-0.5 text-[11px] leading-tight font-medium text-accent-ink"
        >
          {GAP_LABELS[gap]}
        </span>
      ))}
      {rest > 0 && (
        <span className="px-1 py-0.5 text-[11px] text-ink-faint">+{rest}</span>
      )}
    </span>
  );
}

const TIER_LABELS: Record<ContactTier, string> = {
  phone: "Phone",
  email: "Email",
  linkedin: "LinkedIn",
  social: "Social",
  form: "Form",
  none: "No channel",
};

/** Rungs 3 and below are shown as partial, never as a failure (§9). */
export function ContactTierPill({ tier }: { tier: ContactTier | null }) {
  if (!tier) return <span className="text-xs text-ink-faint">—</span>;

  const partial = tier === "linkedin" || tier === "social" || tier === "form";
  const tone =
    tier === "none"
      ? "border-rule text-ink-faint"
      : partial
        ? "border-signal-warm/40 text-signal-warm"
        : "border-signal-good/40 text-signal-good";

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${tone}`}
      title={partial ? "Contact: partial — reachable, but not by phone or email" : undefined}
    >
      {TIER_LABELS[tier]}
      {partial && <span aria-hidden>·</span>}
    </span>
  );
}

export function EntityPill({ entity }: { entity: EntityType | null }) {
  if (!entity) return null;
  const isProvider = entity === "service_provider";

  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
        isProvider ? "bg-paper-sunk text-ink-muted" : "bg-paper-sunk text-ink"
      }`}
      title={
        isProvider
          ? "Sells to other businesses — capped at 30% of any batch"
          : "Sells to consumers from a local operation"
      }
    >
      {isProvider ? "Provider" : "Business"}
    </span>
  );
}

const STATUS_TONES: Record<PipelineStatus, string> = {
  new: "border-rule text-ink-muted",
  qualified: "border-signal-cool/40 text-signal-cool",
  contacted: "border-signal-warm/45 text-signal-warm",
  replied: "border-signal-warm/60 text-signal-warm",
  call_booked: "border-accent/45 text-accent",
  won: "border-signal-good/50 text-signal-good",
  dead: "border-rule text-ink-faint",
};

export function StatusPill({ status }: { status: PipelineStatus }) {
  return (
    <span
      className={`inline-block rounded-full border px-2 py-0.5 text-[11px] font-medium ${STATUS_TONES[status]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

export function TechChips({ stack, max = 3 }: { stack: string[]; max?: number }) {
  if (stack.length === 0) {
    return <span className="text-xs text-ink-faint">—</span>;
  }

  const shown = stack.slice(0, max);
  return (
    <span className="flex flex-wrap gap-1">
      {shown.map((item) => (
        <span
          key={item}
          className="rounded bg-paper-sunk px-1.5 py-0.5 text-[11px] text-ink-muted"
        >
          {item}
        </span>
      ))}
      {stack.length > max && (
        <span className="text-[11px] text-ink-faint">+{stack.length - max}</span>
      )}
    </span>
  );
}
