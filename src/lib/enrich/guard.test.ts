import { describe, expect, test } from "vitest";

import {
  BlockedTargetError,
  guardedFetch,
  isPrivateAddress,
  isPublicHost,
} from "./guard";

const resolvesTo = (...addresses: string[]) => async () => addresses;

describe("isPrivateAddress", () => {
  test("blocks loopback and the cloud metadata address", () => {
    expect(isPrivateAddress("127.0.0.1")).toBe(true);
    expect(isPrivateAddress("169.254.169.254")).toBe(true);
    expect(isPrivateAddress("0.0.0.0")).toBe(true);
  });

  test("blocks every RFC 1918 block", () => {
    expect(isPrivateAddress("10.1.2.3")).toBe(true);
    expect(isPrivateAddress("172.16.0.1")).toBe(true);
    expect(isPrivateAddress("172.31.255.255")).toBe(true);
    expect(isPrivateAddress("192.168.1.1")).toBe(true);
  });

  test("allows ordinary public addresses", () => {
    expect(isPrivateAddress("8.8.8.8")).toBe(false);
    expect(isPrivateAddress("172.32.0.1")).toBe(false);
    expect(isPrivateAddress("2606:4700:4700::1111")).toBe(false);
  });

  test("blocks IPv6 loopback, unique-local and link-local", () => {
    expect(isPrivateAddress("::1")).toBe(true);
    expect(isPrivateAddress("fd00::1")).toBe(true);
    expect(isPrivateAddress("fe80::1")).toBe(true);
  });

  test("sees through an IPv4-mapped IPv6 address", () => {
    expect(isPrivateAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isPrivateAddress("::ffff:8.8.8.8")).toBe(false);
  });

  // `dns.lookup` may hand back the hex form rather than the dotted-quad one,
  // depending on platform and resolver. Matching only the dotted form left
  // loopback reachable through a spelling of the same address.
  test("sees through an IPv4-mapped address written in hex", () => {
    expect(isPrivateAddress("::ffff:7f00:1")).toBe(true); // 127.0.0.1
    expect(isPrivateAddress("::ffff:a9fe:a9fe")).toBe(true); // 169.254.169.254
    expect(isPrivateAddress("::ffff:808:808")).toBe(false); // 8.8.8.8
  });

  // 64:ff9b::/96 and 2002::/16 both carry an IPv4 address in their low bits,
  // which the network translates back on the way out.
  test("blocks IPv4 smuggled through NAT64 and 6to4", () => {
    expect(isPrivateAddress("64:ff9b::a9fe:a9fe")).toBe(true);
    expect(isPrivateAddress("64:ff9b::7f00:1")).toBe(true);
    expect(isPrivateAddress("2002:7f00:1::1")).toBe(true);
  });

  test("blocks documentation and site-local space", () => {
    expect(isPrivateAddress("2001:db8::1")).toBe(true);
    expect(isPrivateAddress("fec0::1")).toBe(true);
  });

  test("treats anything unparseable as private", () => {
    expect(isPrivateAddress("not-an-address")).toBe(true);
  });
});

describe("isPublicHost", () => {
  test("rejects localhost by name", async () => {
    await expect(isPublicHost("localhost", resolvesTo("8.8.8.8"))).resolves.toBe(false);
  });

  test("rejects a public name that resolves into the LAN", async () => {
    await expect(isPublicHost("evil.example", resolvesTo("192.168.0.5"))).resolves.toBe(
      false,
    );
  });

  test("rejects when any one of several addresses is private", async () => {
    await expect(
      isPublicHost("mixed.example", resolvesTo("8.8.8.8", "127.0.0.1")),
    ).resolves.toBe(false);
  });

  test("rejects a name that does not resolve", async () => {
    await expect(
      isPublicHost("gone.example", async () => {
        throw new Error("ENOTFOUND");
      }),
    ).resolves.toBe(false);
  });

  test("accepts a normal public host", async () => {
    await expect(isPublicHost("clinic.example", resolvesTo("203.0.113.10"))).resolves.toBe(
      true,
    );
  });
});

describe("guardedFetch", () => {
  const ok = () =>
    new Response("<html></html>", { status: 200, headers: { "content-type": "text/html" } });

  test("fetches a public target", async () => {
    const response = await guardedFetch("https://clinic.example/", {
      fetchImpl: async () => ok(),
      resolve: resolvesTo("203.0.113.10"),
    });

    expect(response.status).toBe(200);
  });

  test("refuses a private target outright", async () => {
    await expect(
      guardedFetch("http://169.254.169.254/latest/meta-data/", {
        fetchImpl: async () => ok(),
        resolve: resolvesTo("169.254.169.254"),
      }),
    ).rejects.toBeInstanceOf(BlockedTargetError);
  });

  test("re-checks the host on every redirect hop", async () => {
    const fetched: string[] = [];

    const attempt = guardedFetch("https://clinic.example/", {
      resolve: async (hostname) =>
        hostname === "clinic.example" ? ["203.0.113.10"] : ["127.0.0.1"],
      fetchImpl: async (input) => {
        fetched.push(String(input));
        return new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1:8080/admin" },
        });
      },
    });

    await expect(attempt).rejects.toBeInstanceOf(BlockedTargetError);
    // The first hop was allowed; the redirect target never got a request.
    expect(fetched).toEqual(["https://clinic.example/"]);
  });

  test("follows a redirect that stays public", async () => {
    const attempt = await guardedFetch("https://clinic.example/", {
      resolve: resolvesTo("203.0.113.10"),
      fetchImpl: async (input) =>
        String(input).endsWith("/home")
          ? ok()
          : new Response(null, { status: 301, headers: { location: "/home" } }),
    });

    expect(attempt.status).toBe(200);
  });

  test("refuses a non-http scheme", async () => {
    await expect(
      guardedFetch("file:///etc/passwd", {
        fetchImpl: async () => ok(),
        resolve: resolvesTo("203.0.113.10"),
      }),
    ).rejects.toBeInstanceOf(BlockedTargetError);
  });

  test("gives up rather than following redirects forever", async () => {
    await expect(
      guardedFetch("https://clinic.example/", {
        resolve: resolvesTo("203.0.113.10"),
        maxRedirects: 2,
        fetchImpl: async () =>
          new Response(null, { status: 302, headers: { location: "/next" } }),
      }),
    ).rejects.toBeInstanceOf(BlockedTargetError);
  });
});
