import { describe, expect, test } from "vitest";

import type { LeadDetail } from "@/lib/leads/constants";
import { onePagerFilename, parseAudit, toOnePagerData } from "./data";

const lead = (overrides: Partial<LeadDetail> = {}): LeadDetail =>
  ({
    id: "b1",
    name: "Smile Dental Clinic",
    city: "Warangal",
    category: "Dental clinic",
    phoneE164: "+919876543210",
    websiteUrl: "https://smile.example/",
    rating: 4.6,
    reviewCount: 210,
    score: 78,
    entityType: "business",
    contactTier: "phone",
    gaps: ["no_booking", "no_chat"],
    techStack: ["wordpress", "elementor"],
    domainAgeYears: 6.2,
    crawlStatus: "ok",
    email: "hi@smile.example",
    status: "new",
    nextActionAt: null,
    hasBrief: true,
    suppressed: false,

    address: "Main Road",
    countryCode: "IN",
    googleMapsUrl: null,
    bookOnlineUrl: null,
    unclaimedListing: false,
    businessStatus: "operational",
    firstSeenAt: new Date("2026-09-01"),
    lastSeenAt: new Date("2026-09-18"),
    placeId: null,
    rootDomain: "smile.example",

    whatsappPhone: null,
    linkedinUrl: null,
    instagramUrl: "https://www.instagram.com/smileclinic/",
    facebookUrl: null,
    xUrl: null,
    contactFormUrl: null,
    hasBooking: false,
    hasChat: false,
    hasOnlinePayment: false,
    domainRegisteredAt: "2020-07-01",
    fetchedAt: new Date("2026-09-18"),
    crawlError: null,

    components: {
      demand: 45,
      quality: 20,
      establishment: 15,
      gap: 10,
      chainPenalty: 0,
      notes: [],
      gaps: ["no_booking", "no_chat"],
    },
    ownerNote: null,
    brief: {
      painHypothesis: "Every booking goes through the front desk.",
      openingLine: "Noticed you take every appointment by phone.",
      auditMarkdown: "- Two hours a week on the phone\n- **Missed** evening enquiries",
      model: "opus",
      effort: "medium",
      generatedAt: new Date("2026-09-19"),
      regeneratedCount: 0,
    },
    ...overrides,
  }) as LeadDetail;

describe("toOnePagerData", () => {
  test("carries the brief through to the page", () => {
    const data = toOnePagerData(lead(), 65);

    expect(data.openingLine).toContain("by phone");
    expect(data.painHypothesis).toContain("front desk");
    expect(data.auditBlocks).toHaveLength(1);
    expect(data.qualified).toBe(true);
  });

  test("renders gap labels, not raw signal names", () => {
    expect(toOnePagerData(lead(), 65).gaps).toEqual([
      "No online booking",
      "No chat widget",
    ]);
  });

  test("marks a below-threshold lead as unqualified without hiding it", () => {
    const data = toOnePagerData(lead({ score: 40 }), 65);

    expect(data.qualified).toBe(false);
    expect(data.score).toBe(40);
  });

  test("an excluded lead is never marked qualified, whatever it scored", () => {
    const data = toOnePagerData(
      lead({
        score: 90,
        components: {
          demand: 45,
          quality: 20,
          establishment: 15,
          gap: 10,
          chainPenalty: 0,
          notes: [],
          gaps: [],
          excluded: true,
          exclusionReason: "suppressed",
        },
      }),
      65,
    );

    expect(data.qualified).toBe(false);
  });

  test("says what is unknown rather than inventing a number", () => {
    const data = toOnePagerData(lead({ rating: null, domainAgeYears: null }), 65);
    const values = data.facts.map((fact) => fact.value);

    expect(values).toContain("unrated");
    expect(values).toContain("unknown");
  });

  test("only claims sources it actually used", () => {
    const crawled = toOnePagerData(lead(), 65);
    expect(crawled.sources).toContain("their own website");
    expect(crawled.sources).toContain("domain registry (RDAP)");

    const uncrawled = toOnePagerData(
      lead({ crawlStatus: "no_site", domainAgeYears: null }),
      65,
    );
    expect(uncrawled.sources).toEqual(["Google Maps listing"]);
  });

  test("leaves the brief sections empty when there is no brief", () => {
    const data = toOnePagerData(lead({ brief: null }), 65);

    expect(data.openingLine).toBeNull();
    expect(data.auditBlocks).toEqual([]);
  });

  test("does not repeat a WhatsApp number identical to the phone", () => {
    const data = toOnePagerData(lead({ whatsappPhone: "+919876543210" }), 65);
    const labels = data.contacts.map((contact) => contact.label);

    expect(labels).toContain("Phone");
    expect(labels).not.toContain("WhatsApp");
  });
});

describe("parseAudit", () => {
  test("splits bullets from paragraphs", () => {
    const blocks = parseAudit("Intro line.\n\n- one\n- two");

    expect(blocks[0]).toEqual({ kind: "paragraph", text: "Intro line." });
    expect(blocks[1]).toEqual({ kind: "bullets", items: ["one", "two"] });
  });

  test("strips bold and heading markers the PDF cannot render", () => {
    const blocks = parseAudit("## Weekly cost\n\n**Two hours** lost.");

    expect(blocks[0]).toEqual({ kind: "paragraph", text: "Weekly cost" });
    expect(blocks[1]).toEqual({ kind: "paragraph", text: "Two hours lost." });
  });

  test("caps the block count so the page cannot overflow", () => {
    const long = Array.from({ length: 20 }, (_, i) => `Para ${i}`).join("\n\n");
    expect(parseAudit(long).length).toBeLessThanOrEqual(6);
  });
});

describe("onePagerFilename", () => {
  test("slugifies the business name", () => {
    expect(onePagerFilename("Smile Dental Clinic")).toBe(
      "autotech-one-pager-smile-dental-clinic.pdf",
    );
  });

  test("survives a name that is all punctuation", () => {
    expect(onePagerFilename("!!!")).toBe("autotech-one-pager-lead.pdf");
  });

  test("truncates a very long name", () => {
    const name = "A".repeat(200);
    expect(onePagerFilename(name).length).toBeLessThan(80);
  });
});
