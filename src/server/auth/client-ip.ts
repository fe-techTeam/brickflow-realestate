import { isIP } from "node:net";

/**
 * Resolves the client IP from `X-Forwarded-For`.
 *
 * Trust model: the app is only reachable through `TRUSTED_PROXY_HOPS` reverse proxies (default 1:
 * Caddy in docker-compose.prod.yml; the app port is never published). Each trusted proxy appends the
 * address of the peer that connected to it, so the client is the entry `TRUSTED_PROXY_HOPS` places
 * from the right: the right-most address not written by our own infrastructure. Anything further left
 * is client-supplied and ignored. Caddy also discards a client-sent X-Forwarded-For unless the peer is
 * listed in its `trusted_proxies`, so with one hop the header holds exactly the connecting address.
 * Without a proxy, Next.js fills the header with the socket address when it is absent.
 */
export function trustedProxyHops(): number {
  const raw = process.env.TRUSTED_PROXY_HOPS;
  if (raw === undefined || raw.trim() === "") return 1;
  const hops = Number(raw);
  if (!Number.isInteger(hops) || hops < 1 || hops > 10) throw new Error("TRUSTED_PROXY_HOPS must be an integer between 1 and 10");
  return hops;
}

function normaliseIp(value: string): string | null {
  let candidate = value.trim();
  if (candidate.startsWith("[")) candidate = candidate.slice(1, candidate.indexOf("]"));
  else if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(candidate)) candidate = candidate.slice(0, candidate.lastIndexOf(":"));
  if (candidate.toLowerCase().startsWith("::ffff:") && isIP(candidate.slice(7)) === 4) candidate = candidate.slice(7);
  return isIP(candidate) ? candidate.toLowerCase() : null;
}

export function clientIpFromForwardedFor(header: string | null | undefined, hops = trustedProxyHops()): string | null {
  if (!header) return null;
  const entries = header.split(",").map((e) => e.trim()).filter(Boolean);
  if (entries.length === 0) return null;
  // Fewer entries than trusted hops means the chain is shorter than configured; the left-most entry is
  // then the closest thing to a client address, and it was still written by a trusted proxy.
  const index = Math.max(entries.length - hops, 0);
  return normaliseIp(entries[index]!);
}

export function clientIpFromHeaders(headers: Pick<Headers, "get">): string | null {
  return clientIpFromForwardedFor(headers.get("x-forwarded-for"));
}
