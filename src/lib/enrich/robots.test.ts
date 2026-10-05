import { describe, expect, test } from "vitest";

import { isAllowed, parseRobots } from "./robots";
import { USER_AGENT_TOKEN } from "./fetcher";

describe("parseRobots", () => {
  test("applies wildcard rules when no group names us", () => {
    const rules = parseRobots("User-agent: *\nDisallow: /admin", USER_AGENT_TOKEN);

    expect(isAllowed(rules, "/admin/login")).toBe(false);
    expect(isAllowed(rules, "/contact")).toBe(true);
  });

  test("a group naming us replaces the wildcard group", () => {
    const text = [
      "User-agent: *",
      "Disallow: /",
      `User-agent: ${USER_AGENT_TOKEN}`,
      "Disallow: /private",
    ].join("\n");

    const rules = parseRobots(text, USER_AGENT_TOKEN);

    expect(isAllowed(rules, "/contact")).toBe(true);
    expect(isAllowed(rules, "/private/x")).toBe(false);
  });

  test("an empty Disallow is not a rule", () => {
    const rules = parseRobots("User-agent: *\nDisallow:", USER_AGENT_TOKEN);
    expect(isAllowed(rules, "/anything")).toBe(true);
  });

  test("the most specific rule wins", () => {
    const text = "User-agent: *\nDisallow: /wp-\nAllow: /wp-content/uploads";
    const rules = parseRobots(text, USER_AGENT_TOKEN);

    expect(isAllowed(rules, "/wp-admin")).toBe(false);
    expect(isAllowed(rules, "/wp-content/uploads/a.png")).toBe(true);
  });

  test("supports wildcards and end anchors", () => {
    const rules = parseRobots("User-agent: *\nDisallow: /*.pdf$", USER_AGENT_TOKEN);

    expect(isAllowed(rules, "/files/price.pdf")).toBe(false);
    expect(isAllowed(rules, "/files/price.pdf.html")).toBe(true);
  });

  test("ignores comments and blank lines", () => {
    const rules = parseRobots("# comment\n\nUser-agent: *\nDisallow: /x # trailing", USER_AGENT_TOKEN);
    expect(isAllowed(rules, "/x")).toBe(false);
  });

  test("an unparseable file allows everything", () => {
    expect(isAllowed(parseRobots("not robots", USER_AGENT_TOKEN), "/")).toBe(true);
  });
});
