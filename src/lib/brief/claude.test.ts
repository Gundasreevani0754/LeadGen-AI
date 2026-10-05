import { describe, expect, test } from "vitest";

import {
  briefBatch,
  extractBriefs,
  parseEnvelope,
  assertSafeModel,
  quoteForCmd,
  sliceJson,
} from "./claude";
import { buildBatchPrompt } from "./prompt";
import type { BriefInput } from "./types";

const lead = (id: string, name: string): BriefInput => ({
  businessId: id,
  name,
  city: "Warangal",
  category: "Dental clinic",
  rating: 4.6,
  reviewCount: 210,
  websiteUrl: "https://smile.example",
  domainAgeYears: 6,
  techStack: ["wordpress"],
  gaps: ["no_booking", "no_chat"],
  score: 78,
  entityType: "business",
  contactTier: "phone",
  unclaimedListing: false,
  hasBooking: false,
  hasChat: false,
  hasOnlinePayment: false,
});

describe("buildBatchPrompt", () => {
  test("includes every lead and its id", () => {
    const prompt = buildBatchPrompt([lead("a", "Alpha"), lead("b", "Beta")]);

    expect(prompt).toContain("id: a");
    expect(prompt).toContain("id: b");
    expect(prompt).toContain("Alpha");
    expect(prompt).toContain("2 entries");
  });

  test("states the facts rather than inviting invention", () => {
    const prompt = buildBatchPrompt([lead("a", "Alpha")]);

    expect(prompt).toContain("Use only the facts given");
    expect(prompt).toContain("Never invent a client name");
    expect(prompt).toContain("online booking: no");
  });
});

describe("assertSafeModel", () => {
  test("accepts the model names the CLI actually takes", () => {
    expect(assertSafeModel("opus")).toBe("opus");
    expect(assertSafeModel("claude-opus-5")).toBe("claude-opus-5");
    expect(assertSafeModel("claude-haiku-4-5-20251001")).toBe(
      "claude-haiku-4-5-20251001",
    );
  });

  test("refuses a name carrying cmd.exe syntax", () => {
    // quoteForCmd escapes for the C runtime's argv parser, but cmd.exe parses
    // the line first and a bare quote re-opens it to the shell.
    expect(() => assertSafeModel('opus" & calc.exe & echo "')).toThrow();
    expect(() => assertSafeModel("opus | whoami")).toThrow();
    expect(() => assertSafeModel("opus && del /q *")).toThrow();
    expect(() => assertSafeModel("opus > out.txt")).toThrow();
    expect(() => assertSafeModel("")).toThrow();
  });
});

describe("quoteForCmd", () => {
  test("leaves a plain argument alone", () => {
    expect(quoteForCmd("--model")).toBe("--model");
  });

  test("survives a JSON schema, which is what broke the first run on Windows", () => {
    const schema = '{"type":"object","properties":{"a":{"type":"string"}}}';
    const quoted = quoteForCmd(schema);

    expect(quoted.startsWith('"')).toBe(true);
    expect(quoted.endsWith('"')).toBe(true);
    // Every inner quote has to reach the CLI escaped, or the JSON arrives broken.
    expect(quoted.slice(1, -1)).toBe(schema.replaceAll('"', '\\"'));
  });

  test("quotes an argument containing spaces", () => {
    expect(quoteForCmd("two words")).toBe('"two words"');
  });

  test("an empty argument stays an argument", () => {
    expect(quoteForCmd("")).toBe('""');
  });
});

describe("sliceJson", () => {
  test("finds JSON wrapped in prose", () => {
    expect(sliceJson('Here you go:\n```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  test("returns null when there is no JSON", () => {
    expect(sliceJson("sorry, nothing")).toBeNull();
  });
});

describe("parseEnvelope", () => {
  test("unwraps the CLI json envelope", () => {
    const stdout = JSON.stringify({
      result: '{"briefs":[]}',
      session_id: "s-1",
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const parsed = parseEnvelope(stdout);
    expect(parsed.text).toBe('{"briefs":[]}');
    expect(parsed.sessionId).toBe("s-1");
    expect(parsed.inputTokens).toBe(10);
  });

  test("falls back to raw output when the envelope is absent", () => {
    const parsed = parseEnvelope('{"briefs":[]}');
    expect(parsed.text).toBe('{"briefs":[]}');
    expect(parsed.sessionId).toBeNull();
  });
});

describe("extractBriefs", () => {
  const leads = [lead("a", "Alpha"), lead("b", "Beta")];

  const valid = (id: string) => ({
    id,
    pain_hypothesis: "They book by phone.",
    opening_line: "Noticed you take every booking by phone.",
    audit_markdown: "Roughly two hours a week on the phone.",
  });

  test("accepts the object form", () => {
    const warnings: string[] = [];
    const briefs = extractBriefs(
      JSON.stringify({ briefs: [valid("a"), valid("b")] }),
      leads,
      warnings,
    );

    expect(briefs).toHaveLength(2);
    expect(warnings).toHaveLength(0);
  });

  test("accepts a bare array", () => {
    const briefs = extractBriefs(JSON.stringify([valid("a"), valid("b")]), leads, []);
    expect(briefs).toHaveLength(2);
  });

  test("drops a brief for an id that was never asked about", () => {
    const warnings: string[] = [];
    const briefs = extractBriefs(JSON.stringify([valid("zzz")]), leads, warnings);

    expect(briefs).toHaveLength(0);
    expect(warnings.some((w) => w.includes("unknown id"))).toBe(true);
  });

  test("drops an incomplete brief rather than storing a blank field", () => {
    const warnings: string[] = [];
    const briefs = extractBriefs(
      JSON.stringify([{ id: "a", pain_hypothesis: "x", opening_line: "", audit_markdown: "y" }]),
      leads,
      warnings,
    );

    expect(briefs).toHaveLength(0);
    expect(warnings.some((w) => w.includes("Incomplete"))).toBe(true);
  });

  test("reports leads the model silently skipped", () => {
    const warnings: string[] = [];
    extractBriefs(JSON.stringify([valid("a")]), leads, warnings);
    expect(warnings.some((w) => w.includes("Beta"))).toBe(true);
  });

  test("survives output that is not JSON at all", () => {
    const warnings: string[] = [];
    expect(extractBriefs("I cannot help with that.", leads, warnings)).toEqual([]);
    expect(warnings).not.toHaveLength(0);
  });
});

describe("briefBatch", () => {
  const payload = JSON.stringify({
    result: JSON.stringify({
      briefs: [
        {
          id: "a",
          pain_hypothesis: "Phone-only booking.",
          opening_line: "Noticed every booking goes through your front desk.",
          audit_markdown: "Likely two hours a week.",
        },
      ],
    }),
    session_id: "s-9",
    usage: { input_tokens: 100, output_tokens: 40 },
  });

  test("passes the optional flags when the CLI accepts them", async () => {
    const seen: string[][] = [];

    const result = await briefBatch([lead("a", "Alpha")], {
      model: "opus",
      effort: "medium",
      runner: async (_prompt, args) => {
        seen.push(args);
        return { stdout: payload, stderr: "", code: 0 };
      },
    });

    expect(seen[0]).toContain("--json-schema");
    expect(seen[0]).toContain("--effort");
    expect(result.briefs).toHaveLength(1);
    expect(result.sessionId).toBe("s-9");
  });

  test("drops a flag the installed CLI rejects and retries", async () => {
    const attempts: string[][] = [];

    const result = await briefBatch([lead("a", "Alpha")], {
      model: "opus",
      effort: "medium",
      runner: async (_prompt, args) => {
        attempts.push(args);
        if (args.includes("--effort")) {
          return { stdout: "", stderr: "error: unknown option '--effort'", code: 2 };
        }
        return { stdout: payload, stderr: "", code: 0 };
      },
    });

    expect(attempts).toHaveLength(2);
    expect(attempts[1]).not.toContain("--effort");
    expect(result.briefs).toHaveLength(1);
    expect(result.warnings.some((w) => w.includes("--effort"))).toBe(true);
  });

  test("a real failure is surfaced, not swallowed", async () => {
    await expect(
      briefBatch([lead("a", "Alpha")], {
        model: "opus",
        effort: "medium",
        runner: async () => ({ stdout: "", stderr: "not logged in", code: 1 }),
      }),
    ).rejects.toThrow(/not logged in/);
  });
});
