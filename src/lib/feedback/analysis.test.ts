import { describe, expect, test } from "vitest";

import type { PipelineStatus } from "@/lib/leads/constants";
import type { GapSignal } from "@/lib/score/types";
import {
  demandBand,
  establishmentBand,
  MIN_SEGMENT_SAMPLE,
  qualityBand,
  RETUNE_THRESHOLD,
  summarize,
  type OutcomeRow,
} from "./analysis";

const row = (overrides: Partial<OutcomeRow> = {}): OutcomeRow => ({
  businessId: crypto.randomUUID(),
  status: "contacted",
  total: 70,
  components: {
    demand: 45,
    quality: 20,
    establishment: 0,
    gap: 5,
    chainPenalty: 0,
    notes: [],
    gaps: ["no_booking"],
  },
  entityType: "business",
  contactTier: "phone",
  reviewCount: 210,
  rating: 4.6,
  domainAgeYears: 6,
  wasContacted: true,
  ...overrides,
});

const many = (n: number, overrides: Partial<OutcomeRow> = {}) =>
  Array.from({ length: n }, () => row(overrides));

describe("summarize", () => {
  test("counts only leads that were actually contacted", () => {
    const report = summarize([
      ...many(3, { status: "replied" }),
      ...many(5, { status: "new", wasContacted: false }),
    ]);

    expect(report.worked).toBe(3);
    expect(report.replied).toBe(3);
  });

  test("keeps dead leads in the denominator", () => {
    // A lead that was called and went nowhere is the negative evidence the
    // whole report exists to collect.
    const report = summarize([
      ...many(2, { status: "replied" }),
      ...many(8, { status: "dead" }),
    ]);

    expect(report.worked).toBe(10);
    expect(report.dead).toBe(8);
    expect(report.replyRate).toBeCloseTo(0.2);
  });

  test("treats booked and won as replies, since they are", () => {
    const report = summarize([
      row({ status: "call_booked" }),
      row({ status: "won" }),
      row({ status: "contacted" }),
    ]);

    expect(report.replied).toBe(2);
    expect(report.booked).toBe(2);
    expect(report.won).toBe(1);
  });

  test("an empty pipeline produces a report rather than a crash", () => {
    const report = summarize([]);

    expect(report.worked).toBe(0);
    expect(report.replyRate).toBe(0);
    expect(report.untilRetune).toBe(RETUNE_THRESHOLD);
    expect(report.readyToRetune).toBe(false);
  });

  test("counts down to the point where a re-tune is justified", () => {
    expect(summarize(many(40, { status: "dead" })).untilRetune).toBe(
      RETUNE_THRESHOLD - 40,
    );
    expect(summarize(many(RETUNE_THRESHOLD, { status: "dead" })).readyToRetune).toBe(
      true,
    );
  });
});

describe("lift", () => {
  test("marks a segment that replies more often than average", () => {
    const report = summarize([
      ...many(10, { status: "replied", reviewCount: 300 }),
      ...many(10, { status: "dead", reviewCount: 5 }),
    ]);

    const demand = report.dimensions.find((d) => d.key === "demand");
    const strong = demand?.segments.find((s) => s.label === "200 to 499");
    const weak = demand?.segments.find((s) => s.label === "1 to 24");

    expect(strong?.lift).toBeGreaterThan(1);
    expect(weak?.lift).toBeLessThan(1);
    expect(strong?.reliable).toBe(true);
  });

  test("flags a segment too small to believe", () => {
    const report = summarize([
      ...many(MIN_SEGMENT_SAMPLE - 1, { status: "replied", entityType: "service_provider" }),
      ...many(20, { status: "dead" }),
    ]);

    const entity = report.dimensions.find((d) => d.key === "entity");
    const providers = entity?.segments.find((s) => s.label === "Service provider");

    expect(providers?.worked).toBe(MIN_SEGMENT_SAMPLE - 1);
    expect(providers?.reliable).toBe(false);
  });

  test("compares each gap signal present against absent", () => {
    const withGap: GapSignal[] = ["no_booking", "no_chat"];
    const withoutGap: GapSignal[] = ["no_chat"];

    const report = summarize([
      ...many(6, {
        status: "replied",
        components: { ...row().components, gaps: withGap },
      }),
      ...many(6, {
        status: "dead",
        components: { ...row().components, gaps: withoutGap },
      }),
    ]);

    const gaps = report.dimensions.find((d) => d.key === "gaps");
    const present = gaps?.segments.find((s) => s.label.startsWith("No online booking — present"));
    const absent = gaps?.segments.find((s) => s.label.startsWith("No online booking — absent"));

    expect(present?.replyRate).toBe(1);
    expect(absent?.replyRate).toBe(0);
  });

  test("a dimension where every band performs the same shows no lift", () => {
    const report = summarize([
      ...many(5, { status: "replied", rating: 4.8 }),
      ...many(5, { status: "dead", rating: 4.8 }),
      ...many(5, { status: "replied", rating: 3.2 }),
      ...many(5, { status: "dead", rating: 3.2 }),
    ]);

    const quality = report.dimensions.find((d) => d.key === "quality");
    for (const segment of quality?.segments ?? []) {
      expect(segment.lift).toBeCloseTo(1);
    }
  });
});

describe("bands match the scoring cut points", () => {
  test("demand", () => {
    expect(demandBand(0)).toBe("no reviews");
    expect(demandBand(24)).toBe("1 to 24");
    expect(demandBand(199)).toBe("75 to 199");
    expect(demandBand(499)).toBe("200 to 499");
    expect(demandBand(500)).toBe("500+");
  });

  test("quality", () => {
    expect(qualityBand(null)).toBe("unrated");
    expect(qualityBand(4.5)).toBe("4.5+");
    expect(qualityBand(3.4)).toBe("below 3.5");
  });

  test("establishment", () => {
    expect(establishmentBand(null)).toBe("unknown");
    expect(establishmentBand(5)).toBe("5+ years");
    expect(establishmentBand(0.5)).toBe("under a year");
  });
});

describe("status handling", () => {
  test("every pipeline status is classified without throwing", () => {
    const statuses: PipelineStatus[] = [
      "new",
      "qualified",
      "contacted",
      "replied",
      "call_booked",
      "won",
      "dead",
    ];

    const report = summarize(statuses.map((status) => row({ status })));
    expect(report.worked).toBe(statuses.length);
  });
});
