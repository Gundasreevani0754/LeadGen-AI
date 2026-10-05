import { describe, expect, test } from "vitest";

import { emptyIndex, matchAgainst, prepare, splitBatch } from "./dedupe";
import type { RawPlace } from "./sources/types";

const place = (over: Partial<RawPlace> = {}): RawPlace => ({
  providerPlaceId: null,
  name: "Kalpana Care32 Dental Clinic",
  phoneRaw: null,
  websiteUrl: null,
  address: null,
  countryName: "India",
  lat: null,
  lng: null,
  rating: null,
  reviewCount: null,
  category: "Dental clinic",
  categories: ["Dental clinic"],
  mapsUrl: null,
  bookOnlineUrl: null,
  unclaimedListing: false,
  permanentlyClosed: false,
  ...over,
});

const noSuppressions = { phones: new Set<string>(), domains: new Set<string>() };

describe("prepare", () => {
  test("derives all keys from a complete place", () => {
    const p = prepare(
      place({
        providerPlaceId: "ChIJabc",
        phoneRaw: "+91 83286 79049",
        websiteUrl: "https://www.care32.co.in/",
      }),
      "Warangal",
    );

    expect(p.keys.placeId).toBe("ChIJabc");
    expect(p.keys.phoneE164).toBe("+918328679049");
    expect(p.keys.rootDomain).toBe("care32.co.in");
    expect(p.countryCode).toBe("IN");
    expect(p.unkeyable).toBe(false);
  });

  test("a Facebook page does not become a domain key", () => {
    const p = prepare(
      place({ websiteUrl: "https://facebook.com/care32", phoneRaw: "+918328679049" }),
      "Warangal",
    );
    expect(p.keys.rootDomain).toBeNull();
  });

  test("flags a place with no usable key", () => {
    expect(prepare(place(), "Warangal").unkeyable).toBe(true);
  });
});

describe("matchAgainst", () => {
  test("prefers place_id over weaker keys", () => {
    const known = emptyIndex();
    known.placeIds.add("ChIJabc");
    known.phones.add("+918328679049");

    const keys = {
      placeId: "ChIJabc",
      phoneE164: "+918328679049",
      rootDomain: null,
      nameCityKey: null,
    };
    expect(matchAgainst(keys, known)).toBe("place_id");
  });

  test("returns null when nothing is known", () => {
    const keys = {
      placeId: "ChIJnew",
      phoneE164: "+918328679049",
      rootDomain: "care32.co.in",
      nameCityKey: "x|y",
    };
    expect(matchAgainst(keys, emptyIndex())).toBeNull();
  });
});

describe("splitBatch", () => {
  test("treats a business already in the database as a duplicate", () => {
    const known = emptyIndex();
    known.phones.add("+918328679049");

    const batch = [prepare(place({ phoneRaw: "+91 83286 79049" }), "Warangal")];
    const result = splitBatch(batch, known, noSuppressions);

    expect(result.fresh).toHaveLength(0);
    expect(result.duplicates).toHaveLength(1);
    expect(result.duplicates[0].reason).toBe("phone");
  });

  // The operator's core requirement: re-running the same city must not re-pay.
  test("a re-run of the same results yields zero new businesses", () => {
    const raw = [
      place({ providerPlaceId: "A", phoneRaw: "+918328679049" }),
      place({ providerPlaceId: "B", phoneRaw: "+919000000001", name: "Smile Dental" }),
    ];

    const first = splitBatch(
      raw.map((r) => prepare(r, "Warangal")),
      emptyIndex(),
      noSuppressions,
    );
    expect(first.fresh).toHaveLength(2);

    const known = emptyIndex();
    for (const f of first.fresh) {
      if (f.keys.placeId) known.placeIds.add(f.keys.placeId);
      if (f.keys.phoneE164) known.phones.add(f.keys.phoneE164);
    }

    const second = splitBatch(
      raw.map((r) => prepare(r, "Warangal")),
      known,
      noSuppressions,
    );
    expect(second.fresh).toHaveLength(0);
    expect(second.duplicates).toHaveLength(2);
  });

  // Providers really do return the same business twice in one response.
  test("collapses duplicates that appear twice within a single batch", () => {
    const batch = [
      prepare(place({ providerPlaceId: "A", phoneRaw: "+918328679049" }), "Warangal"),
      prepare(
        place({ providerPlaceId: "B", phoneRaw: "+91 83286 79049", name: "Care32 (Branch)" }),
        "Warangal",
      ),
    ];

    const result = splitBatch(batch, emptyIndex(), noSuppressions);
    expect(result.fresh).toHaveLength(1);
    expect(result.duplicates[0].reason).toBe("phone");
  });

  test("never resurfaces a suppressed business", () => {
    const suppressed = {
      phones: new Set(["+918328679049"]),
      domains: new Set<string>(),
    };
    const batch = [prepare(place({ phoneRaw: "+918328679049" }), "Warangal")];

    const result = splitBatch(batch, emptyIndex(), suppressed);
    expect(result.suppressed).toHaveLength(1);
    expect(result.fresh).toHaveLength(0);
  });

  test("two different businesses both survive", () => {
    const batch = [
      prepare(place({ providerPlaceId: "A", phoneRaw: "+918328679049" }), "Warangal"),
      prepare(
        place({ providerPlaceId: "B", phoneRaw: "+919000000001", name: "Smile Dental" }),
        "Warangal",
      ),
    ];
    expect(splitBatch(batch, emptyIndex(), noSuppressions).fresh).toHaveLength(2);
  });
});
