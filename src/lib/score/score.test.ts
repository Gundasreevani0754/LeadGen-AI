import { describe, expect, test } from "vitest";

import { classify } from "./classify";
import { resolveContact } from "./contact";
import { applyRatioCap } from "./ratio";
import {
  computeScore,
  scoreDemand,
  scoreEstablishment,
  scoreGap,
  scoreQuality,
} from "./score";
import type { EnrichmentFacts, ScoreFacts } from "./types";

const facts = (overrides: Partial<ScoreFacts> = {}): ScoreFacts => ({
  businessId: "b1",
  name: "Smile Dental Clinic",
  googleCategory: "Dental clinic",
  googleRating: 4.6,
  googleReviewCount: 210,
  businessStatus: "operational",
  phoneE164: "+919876543210",
  countryCode: "IN",
  websiteUrl: "https://smile.example",
  rootDomain: "smile.example",
  unclaimedListing: false,
  enrichment: null,
  chainLocations: 1,
  suppressed: false,
  ...overrides,
});

const enrichment = (overrides: Partial<EnrichmentFacts> = {}): EnrichmentFacts => ({
  email: null,
  whatsappPhone: null,
  linkedinUrl: null,
  instagramUrl: null,
  facebookUrl: null,
  xUrl: null,
  contactFormUrl: null,
  techStack: ["wordpress"],
  hasBooking: false,
  hasChat: false,
  hasOnlinePayment: false,
  domainAgeYears: 6,
  crawlStatus: "ok",
  ...overrides,
});

describe("scoreDemand", () => {
  test("peaks in the 200 to 499 band", () => {
    expect(scoreDemand(300)).toBe(45);
  });

  test("falls back above 500, where chains live", () => {
    expect(scoreDemand(800)).toBe(33);
    expect(scoreDemand(800)).toBeLessThan(scoreDemand(300));
  });

  test("no reviews scores nothing", () => {
    expect(scoreDemand(0)).toBe(0);
    expect(scoreDemand(null)).toBe(0);
  });

  test("is monotonic up to the chain band", () => {
    const bands = [1, 25, 75, 200].map(scoreDemand);
    expect(bands).toEqual([...bands].sort((a, b) => a - b));
  });
});

describe("scoreQuality", () => {
  test("rewards a strong rating", () => {
    expect(scoreQuality(4.8)).toBe(20);
  });

  test("an unrated business is not treated as a bad one", () => {
    expect(scoreQuality(null)).toBe(4);
    expect(scoreQuality(null)).toBeGreaterThan(scoreQuality(2.1));
  });
});

describe("scoreEstablishment", () => {
  test("an older domain scores higher", () => {
    expect(scoreEstablishment(7)).toBe(15);
    expect(scoreEstablishment(0.5)).toBe(4);
  });

  test("an unknown age scores nothing rather than guessing", () => {
    expect(scoreEstablishment(null)).toBe(0);
  });
});

describe("scoreGap", () => {
  test("an uncrawled business gets no gap points", () => {
    expect(scoreGap(facts())).toEqual({ points: 0, gaps: [] });
  });

  test("a bare site collects every gap and caps at 20", () => {
    const result = scoreGap(
      facts({ enrichment: enrichment({ techStack: ["wix"] }), unclaimedListing: true }),
    );

    expect(result.points).toBeLessThanOrEqual(20);
    expect(result.gaps).toContain("no_booking");
    expect(result.gaps).toContain("form_or_phone_only");
    expect(result.gaps).toContain("site_builder_or_no_site");
    expect(result.gaps).toContain("unclaimed_listing");
  });

  test("a site that already books, chats and takes payment has no gap to sell", () => {
    const result = scoreGap(
      facts({
        enrichment: enrichment({
          hasBooking: true,
          hasChat: true,
          hasOnlinePayment: true,
        }),
      }),
    );

    expect(result.points).toBe(0);
    expect(result.gaps).toEqual([]);
  });
});

describe("computeScore", () => {
  test("the ideal profile clears the threshold comfortably", () => {
    const result = computeScore(facts({ enrichment: enrichment() }));

    expect(result.total).toBeGreaterThanOrEqual(65);
    expect(result.entityType).toBe("business");
    expect(result.contactTier).toBe("phone");
    expect(result.excluded).toBe(false);
  });

  test("a chain is penalised", () => {
    const solo = computeScore(facts({ enrichment: enrichment() })).total;
    const chain = computeScore(
      facts({ enrichment: enrichment(), chainLocations: 9 }),
    ).total;

    expect(chain).toBe(solo - 10);
  });

  test("a closed business is excluded", () => {
    const result = computeScore(facts({ businessStatus: "closed_permanently" }));
    expect(result.excluded).toBe(true);
    expect(result.exclusionReason).toBe("not_operational");
  });

  test("a suppressed business is excluded whatever it scores", () => {
    const result = computeScore(facts({ suppressed: true, enrichment: enrichment() }));
    expect(result.excluded).toBe(true);
    expect(result.exclusionReason).toBe("suppressed");
  });

  test("a business with no contact channel at all is excluded", () => {
    const result = computeScore(facts({ phoneE164: null, enrichment: enrichment() }));
    expect(result.contactTier).toBe("none");
    expect(result.exclusionReason).toBe("no_contact_channel");
  });

  test("the total never leaves 0 to 100", () => {
    const worst = computeScore(
      facts({
        googleRating: 1,
        googleReviewCount: 0,
        chainLocations: 20,
        enrichment: enrichment({ domainAgeYears: null }),
      }),
    );

    expect(worst.total).toBeGreaterThanOrEqual(0);
    expect(worst.total).toBeLessThanOrEqual(100);
  });

  test("components are stored separately so the UI can explain the number", () => {
    const result = computeScore(facts({ enrichment: enrichment() }));
    const { demand, quality, establishment, gap, chainPenalty } = result.components;

    expect(demand + quality + establishment + gap + chainPenalty).toBe(result.total);
  });
});

describe("classify", () => {
  test("a local clinic sells to consumers", () => {
    expect(classify({ name: "Smile Dental", googleCategory: "Dental clinic" }).entityType).toBe(
      "business",
    );
  });

  test("a marketing agency sells to businesses", () => {
    expect(
      classify({ name: "Bright Media", googleCategory: "Marketing agency" }).entityType,
    ).toBe("service_provider");
  });

  test("a wedding photographer is a consumer business", () => {
    expect(
      classify({ name: "Ravi Photography", googleCategory: "Wedding photographer" })
        .entityType,
    ).toBe("business");
  });

  test("a provider signal beats a business signal in the same string", () => {
    expect(
      classify({ name: "Wedding Video Production Agency", googleCategory: "Video production" })
        .entityType,
    ).toBe("service_provider");
  });

  test("an unrecognised category defaults to service provider", () => {
    const result = classify({ name: "Zeta Ventures", googleCategory: null });
    expect(result.entityType).toBe("service_provider");
    expect(result.matchedOn).toBeNull();
  });
});

describe("resolveContact", () => {
  test("phone is the top rung", () => {
    expect(resolveContact(facts()).tier).toBe("phone");
  });

  test("falls through the ladder to a contact form", () => {
    const result = resolveContact(
      facts({
        phoneE164: null,
        enrichment: enrichment({ contactFormUrl: "https://x.example/contact" }),
      }),
    );

    expect(result.tier).toBe("form");
    expect(result.partial).toBe(true);
  });

  test("a social profile keeps a lead contactable rather than dropping it", () => {
    const result = resolveContact(
      facts({
        phoneE164: null,
        enrichment: enrichment({ instagramUrl: "https://instagram.com/x" }),
      }),
    );

    expect(result.tier).toBe("social");
    expect(result.channels).toHaveLength(1);
  });

  test("no channel at all is the only failure", () => {
    expect(resolveContact(facts({ phoneE164: null })).tier).toBe("none");
  });
});

describe("applyRatioCap", () => {
  const lead = (id: string, total: number, provider = false) => ({
    businessId: id,
    total,
    entityType: provider ? ("service_provider" as const) : ("business" as const),
  });

  test("holds providers above the 30% share", () => {
    const candidates = [
      lead("p1", 90, true),
      lead("p2", 88, true),
      lead("p3", 87, true),
      lead("b1", 80),
      lead("b2", 79),
    ];

    const result = applyRatioCap(candidates, { maxRatio: 0.3 });

    expect(result.serviceProviderShare).toBeLessThanOrEqual(0.3);
    expect(result.held.every((entry) => entry.entityType === "service_provider")).toBe(true);
  });

  test("a batch of one is never a provider", () => {
    const result = applyRatioCap([lead("p1", 99, true)], { maxRatio: 0.3 });
    expect(result.delivered).toHaveLength(0);
    expect(result.held).toHaveLength(1);
  });

  test("a provider rejected early is reconsidered once businesses widen the batch", () => {
    const candidates = [
      lead("p1", 95, true),
      lead("b1", 90),
      lead("b2", 85),
      lead("b3", 84),
    ];

    const result = applyRatioCap(candidates, { maxRatio: 0.3 });

    expect(result.delivered.map((entry) => entry.businessId)).toContain("p1");
    expect(result.serviceProviderShare).toBeLessThanOrEqual(0.3);
  });

  test("held providers are not lost", () => {
    const candidates = [lead("p1", 90, true), lead("p2", 89, true), lead("b1", 70)];
    const result = applyRatioCap(candidates, { maxRatio: 0.3 });

    expect(result.delivered.length + result.held.length).toBe(candidates.length);
  });

  test("respects an explicit batch size", () => {
    const candidates = Array.from({ length: 10 }, (_, i) => lead(`b${i}`, 90 - i));
    const result = applyRatioCap(candidates, { maxRatio: 0.3, size: 4 });

    expect(result.delivered).toHaveLength(4);
    expect(result.delivered[0].total).toBe(90);
  });
});
