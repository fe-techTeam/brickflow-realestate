import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@/server/auth/session";
import { db } from "@/server/db";
import {
  acceptOffer,
  approveFinancingRequest,
  completeDisbursement,
  generateOffer,
  initiateDisbursement,
  markSettlementSettled,
  rejectFinancingRequest,
} from "@/server/services/financing";
import { purgeIdempotencyKeys } from "@/server/services/financing-idempotency";
import { acceptedInvoice, actors, auditActions, expectDomainError, expectValidationError, type DemoUser } from "./helpers";

let as: Record<DemoUser, Actor>;

beforeAll(async () => {
  as = await actors();
});

const key = () => randomUUID();

async function openOffer() {
  const invoice = await acceptedInvoice(as.prestige, as.godrej);
  const offer = await generateOffer(as.prestige, invoice.id);
  return { invoiceId: invoice.id, offerId: offer.id };
}

async function pendingRequest() {
  const { offerId, invoiceId } = await openOffer();
  const request = await acceptOffer(as.prestige, offerId, { consent: true });
  return { requestId: request.id, invoiceId };
}

function fulfilled<T>(results: PromiseSettledResult<T>[]) {
  return results.filter((r): r is PromiseFulfilledResult<T> => r.status === "fulfilled").map((r) => r.value);
}

describe("idempotent offer acceptance", () => {
  it("returns the same request for a repeated submission", async () => {
    const { offerId, invoiceId } = await openOffer();
    const k = key();
    const first = await acceptOffer(as.prestige, offerId, { consent: true, idempotencyKey: k });
    const second = await acceptOffer(as.prestige, offerId, { consent: true, idempotencyKey: k });
    expect(second.id).toBe(first.id);
    expect(second.reference).toBe(first.reference);
    expect(await db.financingRequest.count({ where: { invoiceId } })).toBe(1);
    expect(await db.financingEvent.count({ where: { requestId: first.id } })).toBe(2);
    expect(await auditActions(first.id)).toEqual(["financing.offer_accepted"]);
  });

  it("replays concurrent submissions with one key as a single acceptance", async () => {
    const { offerId, invoiceId } = await openOffer();
    const k = key();
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => acceptOffer(as.prestige, offerId, { consent: true, idempotencyKey: k })));
    const ok = fulfilled(results);
    expect(ok).toHaveLength(4);
    expect(new Set(ok.map((r) => r.id)).size).toBe(1);
    expect(await db.financingRequest.count({ where: { invoiceId } })).toBe(1);
    expect(await db.financingIdempotencyKey.count({ where: { key: k } })).toBe(1);
  });

  it("lets exactly one of two concurrent acceptances with different keys succeed", async () => {
    const { offerId, invoiceId } = await openOffer();
    const results = await Promise.allSettled([
      acceptOffer(as.prestige, offerId, { consent: true, idempotencyKey: key() }),
      acceptOffer(as.prestige, offerId, { consent: true, idempotencyKey: key() }),
    ]);
    expect(fulfilled(results)).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({ reason: { code: "CONFLICT" } });
    expect(await db.financingRequest.count({ where: { invoiceId } })).toBe(1);
  });

  it("refuses a key reused for a different offer", async () => {
    const a = await openOffer();
    const b = await openOffer();
    const k = key();
    await acceptOffer(as.prestige, a.offerId, { consent: true, idempotencyKey: k });
    await expectDomainError(acceptOffer(as.prestige, b.offerId, { consent: true, idempotencyKey: k }), "CONFLICT", /already used for a different action/);
    expect((await db.financingOffer.findUniqueOrThrow({ where: { id: b.offerId } })).status).toBe("OFFERED");
  });

  it("claims nothing when the attempt fails, so the same key can be retried", async () => {
    const { offerId } = await openOffer();
    const k = key();
    const original = await db.financingOffer.findUniqueOrThrow({ where: { id: offerId } });
    await db.financingOffer.update({ where: { id: offerId }, data: { validUntil: new Date(Date.now() - 1000) } });
    await expectDomainError(acceptOffer(as.prestige, offerId, { consent: true, idempotencyKey: k }), "CONFLICT", /expired/);
    expect(await db.financingIdempotencyKey.count({ where: { key: k } })).toBe(0);

    await db.financingOffer.update({ where: { id: offerId }, data: { validUntil: original.validUntil, status: "OFFERED" } });
    await db.invoice.update({ where: { id: original.invoiceId }, data: { financingStatus: "OFFER_GENERATED" } });
    const request = await acceptOffer(as.prestige, offerId, { consent: true, idempotencyKey: k });
    expect(request.offerId).toBe(offerId);
  });

  it("scopes keys to the user", async () => {
    const mine = await openOffer();
    const theirsInvoice = await acceptedInvoice(as.urbannest, as.coastal, { cp: "urbannest", builder: "coastal" });
    const theirs = await generateOffer(as.urbannest, theirsInvoice.id);
    const k = key();
    const a = await acceptOffer(as.prestige, mine.offerId, { consent: true, idempotencyKey: k });
    const b = await acceptOffer(as.urbannest, theirs.id, { consent: true, idempotencyKey: k });
    expect(a.id).not.toBe(b.id);
  });

  it("validates the key format", async () => {
    const { offerId } = await openOffer();
    await expectValidationError(acceptOffer(as.prestige, offerId, { consent: true, idempotencyKey: "short" }), "idempotencyKey");
    await expectValidationError(acceptOffer(as.prestige, offerId, { consent: true, idempotencyKey: "has spaces in it and more" }), "idempotencyKey");
  });

  it("still enforces authorisation before replaying", async () => {
    const { offerId } = await openOffer();
    const k = key();
    await acceptOffer(as.prestige, offerId, { consent: true, idempotencyKey: k });
    await expectDomainError(acceptOffer(as.urbannest, offerId, { consent: true, idempotencyKey: k }), "NOT_FOUND");
  });
});

describe("idempotent financier decisions", () => {
  it("replays a duplicate approval without a second event or audit entry", async () => {
    const { requestId } = await pendingRequest();
    const k = key();
    await approveFinancingRequest(as.finance, requestId, { note: "Within limits.", idempotencyKey: k });
    await approveFinancingRequest(as.finance, requestId, { note: "Within limits.", idempotencyKey: k });
    expect(await db.financingEvent.count({ where: { requestId, toStatus: "APPROVED" } })).toBe(1);
    expect((await auditActions(requestId)).filter((a) => a === "financing.approved")).toHaveLength(1);
    await expectDomainError(approveFinancingRequest(as.finance, requestId, { note: "Within limits.", idempotencyKey: key() }), "CONFLICT");
  });

  it("refuses the same key with a different note", async () => {
    const { requestId } = await pendingRequest();
    const k = key();
    await approveFinancingRequest(as.finance, requestId, { note: "First note.", idempotencyKey: k });
    await expectDomainError(approveFinancingRequest(as.finance, requestId, { note: "Second note.", idempotencyKey: k }), "CONFLICT", /different action/);
  });

  it("lets exactly one of two concurrent settlements with different keys succeed", async () => {
    const { requestId } = await pendingRequest();
    await approveFinancingRequest(as.finance, requestId, {});
    await initiateDisbursement(as.finance, requestId, {});
    await completeDisbursement(as.finance, requestId, {});
    const results = await Promise.allSettled([
      markSettlementSettled(as.finance, requestId, { reference: "NEFT-RACE-0001", idempotencyKey: key() }),
      markSettlementSettled(as.analyst, requestId, { reference: "NEFT-RACE-0002", idempotencyKey: key() }),
    ]);
    expect(fulfilled(results)).toHaveLength(1);
    const settlement = await db.settlement.findUniqueOrThrow({ where: { requestId } });
    expect(await auditActions(settlement.id)).toEqual(["settlement.settled"]);
  });

  it("lets exactly one of two concurrent approvals succeed", async () => {
    const { requestId, invoiceId } = await pendingRequest();
    const results = await Promise.allSettled([
      approveFinancingRequest(as.finance, requestId, { idempotencyKey: key() }),
      approveFinancingRequest(as.analyst, requestId, { idempotencyKey: key() }),
    ]);
    expect(fulfilled(results)).toHaveLength(1);
    expect(await db.financingEvent.count({ where: { requestId, toStatus: "APPROVED" } })).toBe(1);
    expect((await db.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).financingStatus).toBe("APPROVED");
  });

  it("lets only one of a concurrent approval and rejection win", async () => {
    const { requestId, invoiceId } = await pendingRequest();
    const results = await Promise.allSettled([
      approveFinancingRequest(as.finance, requestId, { idempotencyKey: key() }),
      rejectFinancingRequest(as.analyst, requestId, { reason: "Exposure limit reached for this partner.", idempotencyKey: key() }),
    ]);
    expect(fulfilled(results)).toHaveLength(1);
    const [request, invoice] = await Promise.all([
      db.financingRequest.findUniqueOrThrow({ where: { id: requestId } }),
      db.invoice.findUniqueOrThrow({ where: { id: invoiceId } }),
    ]);
    expect(["APPROVED", "REJECTED"]).toContain(request.status);
    expect(invoice.financingStatus).toBe(request.status);
  });

  it("replays a duplicate rejection", async () => {
    const { requestId } = await pendingRequest();
    const k = key();
    const reason = "Builder exposure limit reached.";
    await rejectFinancingRequest(as.finance, requestId, { reason, idempotencyKey: k });
    await expect(rejectFinancingRequest(as.finance, requestId, { reason, idempotencyKey: k })).resolves.toBeUndefined();
    expect(await db.financingEvent.count({ where: { requestId, toStatus: "REJECTED" } })).toBe(1);
  });
});

describe("idempotent payouts and settlement", () => {
  it("books one disbursement for duplicate and concurrent initiations", async () => {
    const { requestId } = await pendingRequest();
    await approveFinancingRequest(as.finance, requestId, {});
    const k = key();
    const results = await Promise.allSettled([
      initiateDisbursement(as.finance, requestId, { idempotencyKey: k }),
      initiateDisbursement(as.finance, requestId, { idempotencyKey: k }),
    ]);
    const ok = fulfilled(results);
    expect(ok).toHaveLength(2);
    expect(ok[0]!.id).toBe(ok[1]!.id);
    expect(await db.disbursement.count({ where: { requestId } })).toBe(1);
    await expectDomainError(initiateDisbursement(as.finance, requestId, { idempotencyKey: key() }), "CONFLICT", /Only approved requests/);
    const replay = await initiateDisbursement(as.finance, requestId, { idempotencyKey: k });
    expect(replay.id).toBe(ok[0]!.id);
  });

  it("completes a transfer once and opens one settlement", async () => {
    const { requestId } = await pendingRequest();
    await approveFinancingRequest(as.finance, requestId, {});
    await initiateDisbursement(as.finance, requestId, {});
    const k = key();
    const results = await Promise.allSettled([
      completeDisbursement(as.finance, requestId, { idempotencyKey: k }),
      completeDisbursement(as.finance, requestId, { idempotencyKey: k }),
    ]);
    expect(fulfilled(results)).toHaveLength(2);
    expect(await db.settlement.count({ where: { requestId } })).toBe(1);
    expect(await db.financingEvent.count({ where: { requestId, toStatus: "DISBURSED" } })).toBe(1);
    const disbursement = await db.disbursement.findUniqueOrThrow({ where: { requestId } });
    await completeDisbursement(as.finance, requestId, { idempotencyKey: k });
    expect((await db.disbursement.findUniqueOrThrow({ where: { requestId } })).utr).toBe(disbursement.utr);
  });

  it("records a settlement once for duplicate and concurrent submissions", async () => {
    const { requestId } = await pendingRequest();
    await approveFinancingRequest(as.finance, requestId, {});
    await initiateDisbursement(as.finance, requestId, {});
    await completeDisbursement(as.finance, requestId, {});
    const settlement = await db.settlement.findUniqueOrThrow({ where: { requestId } });
    const k = key();
    const results = await Promise.allSettled([
      markSettlementSettled(as.finance, requestId, { reference: "NEFT-IDEM-0001", idempotencyKey: k }),
      markSettlementSettled(as.finance, requestId, { reference: "NEFT-IDEM-0001", idempotencyKey: k }),
    ]);
    expect(fulfilled(results)).toHaveLength(2);
    await expectDomainError(markSettlementSettled(as.analyst, requestId, { reference: "NEFT-IDEM-0002", idempotencyKey: key() }), "CONFLICT", /already marked/);
    expect(await auditActions(settlement.id)).toEqual(["settlement.settled"]);
    const settled = await db.settlement.findUniqueOrThrow({ where: { id: settlement.id } });
    expect(settled.status).toBe("SETTLED");
    expect(settled.settledAt).not.toBeNull();
  });
});

describe("replay record housekeeping", () => {
  it("purges records older than the cut-off", async () => {
    const stale = await db.financingIdempotencyKey.create({
      data: { actorUserId: as.prestige.userId, scope: "offer.accept", key: key(), fingerprint: "x", createdAt: new Date("2020-01-01T00:00:00.000Z") },
    });
    const purged = await purgeIdempotencyKeys(new Date("2021-01-01T00:00:00.000Z"));
    expect(purged).toBeGreaterThanOrEqual(1);
    expect(await db.financingIdempotencyKey.findUnique({ where: { id: stale.id } })).toBeNull();
  });
});
