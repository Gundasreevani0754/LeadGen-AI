import { beforeEach, describe, expect, test } from "vitest";

import { LIMITS, rateLimit, resetRateLimits } from "./rate-limit";

describe("rateLimit", () => {
  beforeEach(() => resetRateLimits());

  test("allows requests up to the limit", () => {
    for (let i = 0; i < 3; i += 1) {
      expect(rateLimit({ key: "k", limit: 3, windowMs: 1000 }).ok).toBe(true);
    }
  });

  test("refuses the one past the limit", () => {
    for (let i = 0; i < 3; i += 1) rateLimit({ key: "k", limit: 3, windowMs: 1000 });

    const blocked = rateLimit({ key: "k", limit: 3, windowMs: 1000 });
    expect(blocked.ok).toBe(false);
    expect(blocked.retryAfter).toBeGreaterThan(0);
  });

  test("reports how many requests are left", () => {
    expect(rateLimit({ key: "k", limit: 3, windowMs: 1000 }).remaining).toBe(2);
    expect(rateLimit({ key: "k", limit: 3, windowMs: 1000 }).remaining).toBe(1);
  });

  test("keys are independent, so one lead cannot block another", () => {
    rateLimit({ key: "a", limit: 1, windowMs: 1000 });

    expect(rateLimit({ key: "a", limit: 1, windowMs: 1000 }).ok).toBe(false);
    expect(rateLimit({ key: "b", limit: 1, windowMs: 1000 }).ok).toBe(true);
  });

  test("the window reopens once it has passed", () => {
    const start = 1_000_000;
    rateLimit({ key: "k", limit: 1, windowMs: 1000, now: start });

    expect(rateLimit({ key: "k", limit: 1, windowMs: 1000, now: start + 500 }).ok).toBe(
      false,
    );
    expect(rateLimit({ key: "k", limit: 1, windowMs: 1000, now: start + 1001 }).ok).toBe(
      true,
    );
  });

  test("retryAfter counts down within the window", () => {
    const start = 1_000_000;
    rateLimit({ key: "k", limit: 1, windowMs: 10_000, now: start });

    const early = rateLimit({ key: "k", limit: 1, windowMs: 10_000, now: start + 1000 });
    const late = rateLimit({ key: "k", limit: 1, windowMs: 10_000, now: start + 9000 });

    expect(early.retryAfter).toBeGreaterThan(late.retryAfter);
  });
});

describe("LIMITS", () => {
  test("every configured limit is a sane positive window", () => {
    for (const [name, config] of Object.entries(LIMITS)) {
      expect(config.limit, name).toBeGreaterThan(0);
      expect(config.windowMs, name).toBeGreaterThan(0);
    }
  });

  test("bulk export is held tighter than a single page", () => {
    expect(LIMITS.onePagerBundle.limit).toBeLessThan(LIMITS.onePager.limit);
  });
});
