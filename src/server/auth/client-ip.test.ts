import { afterEach, describe, expect, it } from "vitest";
import { clientIpFromForwardedFor, clientIpFromHeaders, trustedProxyHops } from "./client-ip";

afterEach(() => {
  delete process.env.TRUSTED_PROXY_HOPS;
});

describe("client IP from X-Forwarded-For", () => {
  it("takes the right-most entry behind one trusted proxy (Caddy)", () => {
    expect(clientIpFromForwardedFor("198.51.100.23", 1)).toBe("198.51.100.23");
    // Anything the client put in the header itself sits further left and is ignored.
    expect(clientIpFromForwardedFor("10.0.0.1, 1.2.3.4, 198.51.100.23", 1)).toBe("198.51.100.23");
  });

  it("skips one more entry for each additional trusted hop", () => {
    expect(clientIpFromForwardedFor("6.6.6.6, 198.51.100.23, 203.0.113.9", 2)).toBe("198.51.100.23");
  });

  it("falls back to the left-most entry when the chain is shorter than configured", () => {
    expect(clientIpFromForwardedFor("198.51.100.23", 3)).toBe("198.51.100.23");
  });

  it("normalises IPv6, IPv4-mapped and port-suffixed addresses", () => {
    expect(clientIpFromForwardedFor("2001:DB8::1", 1)).toBe("2001:db8::1");
    expect(clientIpFromForwardedFor("::ffff:192.0.2.10", 1)).toBe("192.0.2.10");
    expect(clientIpFromForwardedFor("192.0.2.10:51234", 1)).toBe("192.0.2.10");
    expect(clientIpFromForwardedFor("[2001:db8::2]:443", 1)).toBe("2001:db8::2");
  });

  it("returns null for missing or invalid values", () => {
    expect(clientIpFromForwardedFor(null, 1)).toBeNull();
    expect(clientIpFromForwardedFor("", 1)).toBeNull();
    expect(clientIpFromForwardedFor(" , ", 1)).toBeNull();
    expect(clientIpFromForwardedFor("1.2.3.4, not-an-ip", 1)).toBeNull();
    expect(clientIpFromForwardedFor("<script>", 1)).toBeNull();
  });

  it("reads TRUSTED_PROXY_HOPS (default 1) and rejects invalid values", () => {
    expect(trustedProxyHops()).toBe(1);
    process.env.TRUSTED_PROXY_HOPS = "2";
    expect(trustedProxyHops()).toBe(2);
    expect(clientIpFromHeaders(new Headers({ "x-forwarded-for": "9.9.9.9, 198.51.100.23, 203.0.113.9" }))).toBe("198.51.100.23");
    for (const bad of ["0", "-1", "1.5", "eleven", "11"]) {
      process.env.TRUSTED_PROXY_HOPS = bad;
      expect(() => trustedProxyHops()).toThrow(/TRUSTED_PROXY_HOPS/);
    }
  });
});
