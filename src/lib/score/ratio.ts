import type { EntityType } from "./types";

/**
 * The 70/30 cap (§10), enforced at delivery.
 *
 * Service providers are held, never deleted — they stay in the cold pool and
 * become deliverable again as soon as enough consumer-facing businesses are
 * sourced to make room. The cap protects the operator's calendar, not the data.
 */

export interface RatioCandidate {
  businessId: string;
  total: number;
  entityType: EntityType;
}

export interface RatioResult<T extends RatioCandidate> {
  delivered: T[];
  /** Over-cap service providers, best first, ready for the next batch. */
  held: T[];
  serviceProviderShare: number;
}

/**
 * Admits leads highest score first, letting a service provider through only when
 * doing so keeps the batch within the cap.
 *
 * Checking the ratio *after* the hypothetical admission is what makes small
 * batches behave: one lead alone can never be 30% service provider, so a batch
 * of one is always a real business.
 */
export function applyRatioCap<T extends RatioCandidate>(
  candidates: T[],
  { maxRatio, size }: { maxRatio: number; size?: number },
): RatioResult<T> {
  const ranked = [...candidates].sort((a, b) => b.total - a.total);

  const delivered: T[] = [];
  const held: T[] = [];
  let providers = 0;

  for (const candidate of ranked) {
    if (size !== undefined && delivered.length >= size) {
      held.push(candidate);
      continue;
    }

    if (candidate.entityType === "business") {
      delivered.push(candidate);
      continue;
    }

    const wouldBe = (providers + 1) / (delivered.length + 1);
    if (wouldBe <= maxRatio + 1e-9) {
      delivered.push(candidate);
      providers += 1;
    } else {
      held.push(candidate);
    }
  }

  // A provider rejected early can become admissible once later businesses widen
  // the batch. Reconsider the held pool in score order until nothing more fits,
  // so the cap is a ceiling on the final mix rather than an artefact of order.
  const stillHeld: T[] = [];
  for (const candidate of held) {
    const roomLeft = size === undefined || delivered.length < size;
    const isProvider = candidate.entityType === "service_provider";
    const wouldBe = (providers + (isProvider ? 1 : 0)) / (delivered.length + 1);

    if (roomLeft && (!isProvider || wouldBe <= maxRatio + 1e-9)) {
      delivered.push(candidate);
      if (isProvider) providers += 1;
    } else {
      stillHeld.push(candidate);
    }
  }

  delivered.sort((a, b) => b.total - a.total);

  return {
    delivered,
    held: stillHeld,
    serviceProviderShare: delivered.length === 0 ? 0 : providers / delivered.length,
  };
}
