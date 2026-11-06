import { describe, expect, it } from "vitest";
import { auditHashInput, canonicalJson, computeAuditHash, type AuditHashFields } from "./audit-chain";

const ROW: AuditHashFields = {
  seq: 42n,
  createdAt: new Date("2026-11-06T10:15:30.123Z"),
  actorUserId: "user_1",
  actorName: "Asha Rao",
  actorOrgId: "org_1",
  actorRole: "SUPER_ADMIN",
  action: "settings.updated",
  entityType: "PlatformSetting",
  entityId: "platform.supportEmail",
  summary: "Updated platform settings: Support email",
  metadata: '{"platform.supportEmail":"help@example.com"}',
  prevHash: "a".repeat(64),
};

describe("canonicalJson", () => {
  it("sorts keys at every depth and drops whitespace", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { z: true, y: null }], c: "x" } })).toBe('{"a":{"c":"x","d":[3,{"y":null,"z":true}]},"b":1}');
  });

  it("encodes BigInt as a decimal string and Date as ISO 8601 UTC with milliseconds", () => {
    expect(canonicalJson({ n: 9_007_199_254_740_993n, at: new Date(Date.UTC(2026, 0, 2, 3, 4, 5, 6)) })).toBe('{"at":"2026-01-02T03:04:05.006Z","n":"9007199254740993"}');
  });

  it("escapes strings exactly like JSON.stringify, including unicode and control characters", () => {
    const text = 'quote " backslash \\ newline \n tab \t rupee ₹ emoji 🏗';
    expect(canonicalJson(text)).toBe(JSON.stringify(text));
  });

  it("rejects values that could make two rows serialise identically", () => {
    expect(() => canonicalJson({ a: undefined } as never)).toThrow(/undefined/);
    expect(() => canonicalJson(Number.NaN)).toThrow(/non-finite/);
    expect(() => canonicalJson(new Date("invalid"))).toThrow(/invalid Date/);
  });
});

describe("audit hash", () => {
  it("is pinned to the documented version-1 serialisation", () => {
    expect(auditHashInput(ROW)).toBe(
      '{"action":"settings.updated","actorName":"Asha Rao","actorOrgId":"org_1","actorRole":"SUPER_ADMIN","actorUserId":"user_1",' +
        '"createdAt":"2026-11-06T10:15:30.123Z","entityId":"platform.supportEmail","entityType":"PlatformSetting",' +
        '"metadata":"{\\"platform.supportEmail\\":\\"help@example.com\\"}","prevHash":"' +
        "a".repeat(64) +
        '","seq":"42","summary":"Updated platform settings: Support email","v":1}',
    );
    expect(computeAuditHash(ROW)).toMatch(/^[0-9a-f]{64}$/);
    expect(computeAuditHash({ ...ROW })).toBe(computeAuditHash(ROW));
  });

  it.each([
    ["seq", { seq: 43n }],
    ["createdAt", { createdAt: new Date("2026-11-06T10:15:30.124Z") }],
    ["actorUserId", { actorUserId: null }],
    ["actorName", { actorName: "Asha  Rao" }],
    ["actorOrgId", { actorOrgId: "org_2" }],
    ["actorRole", { actorRole: null }],
    ["action", { action: "settings.updated " }],
    ["entityType", { entityType: "User" }],
    ["entityId", { entityId: "platform.defaultCreditPeriodDays" }],
    ["summary", { summary: "Updated platform settings" }],
    ["metadata", { metadata: null }],
    ["prevHash", { prevHash: null }],
  ] as const)("changes when %s changes", (_field, change) => {
    expect(computeAuditHash({ ...ROW, ...change })).not.toBe(computeAuditHash(ROW));
  });

  it("distinguishes null from the string \"null\" and empty values", () => {
    expect(computeAuditHash({ ...ROW, metadata: "null" })).not.toBe(computeAuditHash({ ...ROW, metadata: null }));
    expect(computeAuditHash({ ...ROW, actorRole: "" })).not.toBe(computeAuditHash({ ...ROW, actorRole: null }));
  });
});
