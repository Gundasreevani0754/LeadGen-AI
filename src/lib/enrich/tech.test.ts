import { describe, expect, test } from "vitest";

import { detectTech, isSiteBuilder } from "./tech";
import { parseRdap, UNKNOWN_AGE } from "./rdap";
import { validate } from "./gemini";
import type { FetchedPage } from "./types";

const page = (html: string): FetchedPage => ({
  url: "https://x.example/",
  html,
  status: 200,
});

describe("detectTech", () => {
  test("names the platform and the gaps", () => {
    const found = detectTech({
      pages: [page(`<link href="/wp-content/themes/a.css">`)],
      hasSite: true,
    });

    expect(found.techStack).toContain("wordpress");
    expect(found.hasBooking).toBe(false);
    expect(found.hasChat).toBe(false);
    expect(found.hasOnlinePayment).toBe(false);
  });

  test("detects a booking widget", () => {
    const found = detectTech({
      pages: [page(`<script src="https://assets.calendly.com/widget.js"></script>`)],
      hasSite: true,
    });

    expect(found.hasBooking).toBe(true);
    expect(found.techStack).toContain("calendly");
  });

  test("a booking link on the Google listing counts even with no site", () => {
    const found = detectTech({
      pages: [],
      hasSite: false,
      listingBookingUrl: "https://book.example/slot",
    });

    expect(found.hasBooking).toBe(true);
    expect(found.techStack).toContain("none");
  });

  test("an uncategorised site is custom, not unknown", () => {
    const found = detectTech({ pages: [page("<h1>hello</h1>")], hasSite: true });
    expect(found.techStack).toContain("custom");
  });

  test("detects Indian payment gateways", () => {
    const found = detectTech({
      pages: [page(`<script src="https://checkout.razorpay.com/v1/checkout.js">`)],
      hasSite: true,
    });
    expect(found.hasOnlinePayment).toBe(true);
  });
});

describe("isSiteBuilder", () => {
  test("recognises template platforms", () => {
    expect(isSiteBuilder(["wix"])).toBe(true);
    expect(isSiteBuilder(["wordpress"])).toBe(false);
    expect(isSiteBuilder(null)).toBe(false);
  });
});

describe("parseRdap", () => {
  const now = new Date("2026-01-01T00:00:00Z");

  test("reads the registration event and derives age", () => {
    const parsed = parseRdap(
      { events: [{ eventAction: "registration", eventDate: "2016-01-01T00:00:00Z" }] },
      now,
    );

    expect(parsed.registeredAt).toBe("2016-01-01");
    expect(parsed.ageYears).toBeGreaterThan(9.9);
    expect(parsed.ageYears).toBeLessThan(10.1);
  });

  test("an absent registration event is unknown, not an error", () => {
    expect(parseRdap({ events: [{ eventAction: "expiration" }] }, now)).toEqual(UNKNOWN_AGE);
    expect(parseRdap({}, now)).toEqual(UNKNOWN_AGE);
  });

  test("rejects a registration date in the future", () => {
    const parsed = parseRdap(
      { events: [{ eventAction: "registration", eventDate: "2030-01-01T00:00:00Z" }] },
      now,
    );
    expect(parsed).toEqual(UNKNOWN_AGE);
  });
});

describe("gemini validate", () => {
  const source = "Call us or write to hello@clinic.example. We are on https://instagram.com/smile";

  test("keeps a value that appears in the source text", () => {
    expect(validate({ email: "hello@clinic.example" }, source).email).toBe(
      "hello@clinic.example",
    );
  });

  test("drops a value the model invented", () => {
    expect(validate({ email: "info@clinic.example" }, source).email).toBeUndefined();
  });

  test("drops a malformed social url", () => {
    expect(validate({ instagram_url: "instagram" }, source).instagramUrl).toBeUndefined();
  });

  test("treats the string null as absent", () => {
    expect(validate({ email: "null" }, source).email).toBeUndefined();
  });
});
