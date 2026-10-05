import { describe, expect, test } from "vitest";

import {
  countryFromPhone,
  extractRootDomain,
  isPlatformUrl,
  nameKey,
  normalizePhone,
} from "./normalize";

describe("normalizePhone", () => {
  test("converts an Indian number with spaces to E.164", () => {
    expect(normalizePhone("+91 83286 79049")).toBe("+918328679049");
  });

  test("applies the default country to a bare national number", () => {
    expect(normalizePhone("083286 79049", "IN")).toBe("+918328679049");
  });

  test("gives the same key for the same number written differently", () => {
    const variants = [
      "+91 83286 79049",
      "+918328679049",
      "08328679049",
      "83286 79049",
      "8328679049",
    ];
    const keys = new Set(variants.map((v) => normalizePhone(v)));
    expect(keys.size).toBe(1);
    expect([...keys][0]).toBe("+918328679049");
  });

  test("returns null for an invalid number rather than a junk key", () => {
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("not a phone")).toBeNull();
  });

  test("returns null for empty input", () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone("")).toBeNull();
  });
});

describe("countryFromPhone", () => {
  test("derives IN from an Indian number", () => {
    expect(countryFromPhone("+91 83286 79049")).toBe("IN");
  });

  test("derives US from a US number", () => {
    expect(countryFromPhone("+1 415 555 2671")).toBe("US");
  });
});

describe("extractRootDomain", () => {
  test("strips scheme, www, path and query", () => {
    expect(extractRootDomain("https://www.care32.co.in/contact?ref=maps")).toBe(
      "care32.co.in",
    );
  });

  test("handles a multi-part public suffix", () => {
    expect(extractRootDomain("https://clinic.example.co.uk")).toBe(
      "example.co.uk",
    );
  });

  test("accepts a bare hostname with no scheme", () => {
    expect(extractRootDomain("care32.co.in")).toBe("care32.co.in");
  });

  test("lowercases the result", () => {
    expect(extractRootDomain("HTTPS://WWW.Care32.CO.IN")).toBe("care32.co.in");
  });

  // This is the important one: without it, every business whose Maps listing
  // points at a Facebook page would collide onto a single dedupe key.
  test("rejects platform URLs so they never become dedupe keys", () => {
    expect(extractRootDomain("https://facebook.com/somedentist")).toBeNull();
    expect(extractRootDomain("https://www.instagram.com/somedentist")).toBeNull();
    expect(extractRootDomain("https://wa.me/918328679049")).toBeNull();
    expect(extractRootDomain("https://mysalon.business.site")).toBeNull();
    expect(extractRootDomain("https://justdial.com/listing/123")).toBeNull();
  });

  test("rejects IP addresses and unparseable input", () => {
    expect(extractRootDomain("http://192.168.1.1")).toBeNull();
    expect(extractRootDomain("::::")).toBeNull();
    expect(extractRootDomain(null)).toBeNull();
  });
});

describe("isPlatformUrl", () => {
  test("flags a platform page but not a real site", () => {
    expect(isPlatformUrl("https://facebook.com/clinic")).toBe(true);
    expect(isPlatformUrl("https://care32.co.in")).toBe(false);
  });
});

describe("nameKey", () => {
  test("collapses whitespace and lowercases for comparison", () => {
    expect(nameKey("  Kalpana   Care32  Dental Clinic ")).toBe(
      "kalpana care32 dental clinic",
    );
  });
});
