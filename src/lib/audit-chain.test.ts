import { createHash, createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ANCHOR_STATEMENT_TYPE, auditHashInput, type AnchorStatement, canonicalJson, computeAuditHash, parseAnchorFile, serialiseAnchorFile, verifyAnchorSignature, type AuditHashFields, type SignedAnchor } from "./audit-chain";
import { AuditKeyConfigError, DEV_AUDIT_KEY_ID, loadAuditKeyring } from "./audit-keys";

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

const KEY_A = randomBytes(32).toString("base64");
const KEY_B = randomBytes(32).toString("base64");
const ringA = loadAuditKeyring({ NODE_ENV: "production", AUDIT_HMAC_KEY: KEY_A, AUDIT_HMAC_KEY_ID: "a1" });
const ringB = loadAuditKeyring({ NODE_ENV: "production", AUDIT_HMAC_KEY: KEY_B, AUDIT_HMAC_KEY_ID: "a1" });

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
  it("is pinned to the documented version-1 serialisation, including the key id", () => {
    expect(auditHashInput(ROW, "k1")).toBe(
      '{"action":"settings.updated","actorName":"Asha Rao","actorOrgId":"org_1","actorRole":"SUPER_ADMIN","actorUserId":"user_1",' +
        '"createdAt":"2026-11-06T10:15:30.123Z","entityId":"platform.supportEmail","entityType":"PlatformSetting","keyId":"k1",' +
        '"metadata":"{\\"platform.supportEmail\\":\\"help@example.com\\"}","prevHash":"' +
        "a".repeat(64) +
        '","seq":"42","summary":"Updated platform settings: Support email","v":1}',
    );
    expect(computeAuditHash(ROW, "a1", ringA)).toMatch(/^[0-9a-f]{64}$/);
    expect(computeAuditHash({ ...ROW }, "a1", ringA)).toBe(computeAuditHash(ROW, "a1", ringA));
  });

  it("is keyed: a plain SHA-256 or a different key produces a different value", () => {
    const keyed = computeAuditHash(ROW, "a1", ringA);
    expect(createHash("sha256").update(auditHashInput(ROW, "a1")).digest("hex")).not.toBe(keyed);
    expect(computeAuditHash(ROW, "a1", ringB)).not.toBe(keyed);
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
    expect(computeAuditHash({ ...ROW, ...change }, "a1", ringA)).not.toBe(computeAuditHash(ROW, "a1", ringA));
  });

  it("distinguishes null from the string \"null\" and empty values", () => {
    expect(computeAuditHash({ ...ROW, metadata: "null" }, "a1", ringA)).not.toBe(computeAuditHash({ ...ROW, metadata: null }, "a1", ringA));
    expect(computeAuditHash({ ...ROW, actorRole: "" }, "a1", ringA)).not.toBe(computeAuditHash({ ...ROW, actorRole: null }, "a1", ringA));
  });

  it("refuses an unknown key id", () => {
    expect(() => computeAuditHash(ROW, "nope", ringA)).toThrow(/"nope" is not configured/);
  });
});

describe("audit keyring", () => {
  it("requires a key in production and refuses short, malformed or development keys", () => {
    expect(() => loadAuditKeyring({ NODE_ENV: "production" })).toThrow(AuditKeyConfigError);
    expect(() => loadAuditKeyring({ NODE_ENV: "production", AUDIT_HMAC_KEY: randomBytes(16).toString("base64") })).toThrow(/at least 32 bytes/);
    expect(() => loadAuditKeyring({ NODE_ENV: "production", AUDIT_HMAC_KEY: "not base64!" })).toThrow(/base64/);
    const devKey = Buffer.from("brickflow-development-only-audit-hmac-key-not-secret").toString("base64");
    expect(() => loadAuditKeyring({ NODE_ENV: "production", AUDIT_HMAC_KEY: devKey })).toThrow(/development key/);
    expect(() => loadAuditKeyring({ NODE_ENV: "production", AUDIT_HMAC_KEY: KEY_A, AUDIT_HMAC_KEY_ID: DEV_AUDIT_KEY_ID })).toThrow(/AUDIT_HMAC_KEY_ID/);
  });

  it("uses the labelled development key outside production", () => {
    const ring = loadAuditKeyring({ NODE_ENV: "test" });
    expect(ring).toMatchObject({ currentKeyId: DEV_AUDIT_KEY_ID, insecure: true });
  });

  it("keeps retired keys for verifying older rows", () => {
    const ring = loadAuditKeyring({ NODE_ENV: "production", AUDIT_HMAC_KEY: KEY_B, AUDIT_HMAC_KEY_ID: "k2", AUDIT_HMAC_PREVIOUS_KEYS: `k1:${KEY_A}` });
    expect(ring.currentKeyId).toBe("k2");
    expect([...ring.keys.keys()].sort()).toEqual(["k1", "k2"]);
    expect(() => loadAuditKeyring({ NODE_ENV: "production", AUDIT_HMAC_KEY: KEY_B, AUDIT_HMAC_PREVIOUS_KEYS: "missing-separator" })).toThrow(/id:base64key/);
  });
});

describe("signed anchors", () => {
  const statement: AnchorStatement = { type: ANCHOR_STATEMENT_TYPE, v: 1, day: "2026-11-06", seq: "120", headHash: "b".repeat(64), keyId: "a1", anchoredAt: "2026-11-06T18:30:00.000Z" };
  // Mirrors the documented signature: HMAC-SHA256 over the canonical statement with the statement's key.
  const sign = (ring: typeof ringA): SignedAnchor => ({
    statement,
    signature: createHmac("sha256", ring.keys.get("a1")!).update(canonicalJson({ ...statement })).digest("hex"),
  });

  it("accepts only statements signed with a known key and unchanged fields", () => {
    const anchor = sign(ringA);
    expect(verifyAnchorSignature(anchor, ringA)).toBe(true);
    expect(verifyAnchorSignature(anchor, ringB)).toBe(false);
    expect(verifyAnchorSignature({ ...anchor, statement: { ...statement, seq: "121" } }, ringA)).toBe(false);
    expect(verifyAnchorSignature({ ...anchor, statement: { ...statement, keyId: "zz" } }, ringA)).toBe(false);
  });

  it("round-trips the exported JSON-lines file and rejects malformed lines", () => {
    const anchor = sign(ringA);
    expect(parseAnchorFile(serialiseAnchorFile([anchor, anchor]))).toEqual([anchor, anchor]);
    expect(() => parseAnchorFile("{not json}")).toThrow(/line 1/);
    expect(() => parseAnchorFile('{"statement":{"day":"x"}}')).toThrow(/not a signed anchor/);
  });
});
