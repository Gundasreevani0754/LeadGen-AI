import { lookup } from "node:dns/promises";

/**
 * SSRF guard for the crawler.
 *
 * The URLs we fetch are not ours and are not the operator's: they come from the
 * `website` field of a Google Maps listing, which anyone who can edit a listing
 * can set. A listing pointing at `http://169.254.169.254/` or at a printer on
 * the operator's LAN would otherwise have us fetch it, hand the response to
 * Gemini, and store whatever came back in the database.
 *
 * So every hostname is resolved before it is fetched, and every resolved address
 * must be publicly routable. Redirects are followed manually so each hop gets
 * the same check — a public host that 302s to `127.0.0.1` is the classic bypass.
 */

/** Injected in tests so they neither hit DNS nor depend on the network. */
export type HostResolver = (hostname: string) => Promise<string[]>;

export const resolveHostAddresses: HostResolver = async (hostname) => {
  const records = await lookup(hostname, { all: true });
  return records.map((record) => record.address);
};

/**
 * IPv4 ranges that must never be crawled: loopback, the link-local range that
 * carries cloud metadata endpoints, every RFC 1918 private block, CGNAT,
 * benchmarking, multicast and reserved space.
 */
const BLOCKED_V4: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

export function isPrivateAddress(address: string): boolean {
  const cleaned = address.trim().toLowerCase().replace(/^\[|\]$/g, "");

  // An IPv4-mapped IPv6 address (::ffff:127.0.0.1) is an IPv4 address.
  const mapped = cleaned.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateV4(mapped[1]);

  // The same address can also arrive as hex (::ffff:7f00:1), and an IPv4
  // address can be smuggled through the NAT64 and 6to4 prefixes, which the
  // network unwraps on the way out. Each carries its IPv4 payload in the low
  // 32 bits, so pull it out and judge it as the IPv4 address it will become.
  const embedded = embeddedV4(cleaned);
  if (embedded) return isPrivateV4(embedded);

  if (cleaned.includes(":")) return isPrivateV6(cleaned);
  return isPrivateV4(cleaned);
}

/** The IPv4 address hiding in the low 32 bits of a mapped/NAT64/6to4 address. */
function embeddedV4(address: string): string | null {
  const hextets = expandV6(address);
  if (!hextets) return null;

  const toDotted = (high: number, low: number) =>
    [high >> 8, high & 0xff, low >> 8, low & 0xff].join(".");

  // ::ffff:0:0/96 — IPv4-mapped, hex spelling.
  if (hextets.slice(0, 5).every((h) => h === 0) && hextets[5] === 0xffff) {
    return toDotted(hextets[6], hextets[7]);
  }

  // 64:ff9b::/96 — the well-known NAT64 prefix.
  if (
    hextets[0] === 0x0064 &&
    hextets[1] === 0xff9b &&
    hextets.slice(2, 6).every((h) => h === 0)
  ) {
    return toDotted(hextets[6], hextets[7]);
  }

  // 2002::/16 — 6to4 carries the IPv4 address in the next 32 bits.
  if (hextets[0] === 0x2002) return toDotted(hextets[1], hextets[2]);

  return null;
}

/** Expands an IPv6 address to its eight numeric hextets, or null if malformed. */
function expandV6(address: string): number[] | null {
  if (!address.includes(":")) return null;

  const [head, tail, ...rest] = address.split("::");
  if (rest.length > 0) return null;

  const parse = (part: string) =>
    part === "" ? [] : part.split(":").map((h) => Number.parseInt(h, 16));

  const left = parse(head);
  const right = tail === undefined ? [] : parse(tail);

  if ([...left, ...right].some((h) => !Number.isInteger(h) || h < 0 || h > 0xffff)) {
    return null;
  }

  if (tail === undefined) return left.length === 8 ? left : null;

  const gap = 8 - left.length - right.length;
  if (gap < 1) return null;

  return [...left, ...Array<number>(gap).fill(0), ...right];
}

function isPrivateV4(address: string): boolean {
  const octets = address.split(".");
  if (octets.length !== 4) return true; // Unparseable means "do not fetch".

  const parts = octets.map((octet) => Number(octet));
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const value = parts.reduce((total, part) => total * 256 + part, 0);

  return BLOCKED_V4.some(([network, bits]) => {
    const base = network
      .split(".")
      .map(Number)
      .reduce((total, part) => total * 256 + part, 0);
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) >>> 0 === (base & mask) >>> 0;
  });
}

function isPrivateV6(address: string): boolean {
  if (address === "::" || address === "::1") return true;

  const head = address.replace(/^\[/, "").slice(0, 4);
  // fc00::/7 unique-local, fe80::/10 link-local, fec0::/10 deprecated
  // site-local, 2001:db8::/32 documentation.
  if (/^f[cd]/.test(head)) return true;
  if (/^fe[89ab]/.test(head)) return true;
  if (/^fe[cdef]/.test(head)) return true;
  if (/^2001:0*db8$/.test(address.split("::")[0].split(":").slice(0, 2).join(":"))) {
    return true;
  }

  return false;
}

/**
 * True when every address this hostname resolves to is publicly routable.
 *
 * A DNS failure returns false: if we cannot tell where a name points, we do not
 * fetch it. A literal IP in the URL is checked directly — `lookup` would happily
 * hand it back to us unchanged, but checking it here keeps the intent obvious.
 */
export async function isPublicHost(
  hostname: string,
  resolve: HostResolver = resolveHostAddresses,
): Promise<boolean> {
  if (!hostname) return false;
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return false;

  const literal = hostname.replace(/^\[|\]$/g, "");
  if (/^[\d.]+$/.test(literal) || literal.includes(":")) {
    return !isPrivateAddress(literal);
  }

  try {
    const addresses = await resolve(hostname);
    if (addresses.length === 0) return false;
    return addresses.every((address) => !isPrivateAddress(address));
  } catch {
    return false;
  }
}

export class BlockedTargetError extends Error {
  constructor(readonly url: string) {
    super(`Refused to fetch ${url}: it resolves to a private or reserved address`);
    this.name = "BlockedTargetError";
  }
}

export interface GuardedFetchOptions {
  fetchImpl?: typeof fetch;
  resolve?: HostResolver;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  maxRedirects?: number;
}

/**
 * `fetch` with the guard applied to the initial URL and to every redirect hop.
 *
 * `redirect: "manual"` is the point: the platform's automatic redirect following
 * would jump to the Location header without ever telling us where it went.
 */
export async function guardedFetch(
  url: string,
  options: GuardedFetchOptions = {},
): Promise<Response> {
  const {
    fetchImpl = fetch,
    resolve = resolveHostAddresses,
    headers = {},
    signal,
    maxRedirects = 3,
  } = options;

  let current = url;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const parsed = new URL(current);

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new BlockedTargetError(current);
    }
    if (!(await isPublicHost(parsed.hostname, resolve))) {
      throw new BlockedTargetError(current);
    }

    const response = await fetchImpl(current, {
      headers,
      signal,
      redirect: "manual",
    });

    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      current = new URL(location, current).toString();
      continue;
    }

    return response;
  }

  throw new BlockedTargetError(`${url} (too many redirects)`);
}
