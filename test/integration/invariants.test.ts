import { execFileSync } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Actor } from "@/server/auth/session";
import { db } from "@/server/db";
import { runInvariantChecks, type InvariantCode } from "@/server/services/invariants";
import { financedTo } from "./fixtures-financing";
import { actors, type DemoUser } from "./helpers";

let as: Record<DemoUser, Actor>;
let offered: Awaited<ReturnType<typeof financedTo>>;
let pending: Awaited<ReturnType<typeof financedTo>> & { requestId: string };
let disbursed: Awaited<ReturnType<typeof financedTo>> & { requestId: string };

beforeAll(async () => {
  as = await actors();
  offered = await financedTo(as, "OFFER_GENERATED");
  pending = (await financedTo(as, "PENDING_APPROVAL")) as typeof pending;
  disbursed = (await financedTo(as, "DISBURSED")) as typeof disbursed;
});

afterAll(async () => {
  const report = await runInvariantChecks();
  expect(report.violations.filter((v) => v.severity === "error")).toEqual([]);
});

async function codesFor(entityId: string): Promise<InvariantCode[]> {
  const report = await runInvariantChecks();
  return report.violations.filter((v) => v.entityId === entityId).map((v) => v.code);
}

/** Applies a corruption, asserts the expected findings, then always restores the data. */
async function withViolation(corrupt: () => Promise<unknown>, restore: () => Promise<unknown>, check: () => Promise<void>) {
  await corrupt();
  try {
    await check();
  } finally {
    await restore();
  }
}

describe("financing invariants", () => {
  it("hold for the seeded data and every flow the suite has run", async () => {
    const report = await runInvariantChecks();
    expect(report.violations.filter((v) => v.severity === "error")).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("detect a financed invoice without an accepted offer", async () => {
    await withViolation(
      () => db.financingOffer.update({ where: { id: pending.offerId }, data: { status: "SUPERSEDED" } }),
      () => db.financingOffer.update({ where: { id: pending.offerId }, data: { status: "ACCEPTED" } }),
      async () => {
        expect(await codesFor(pending.invoiceId)).toContain("INVOICE_FINANCED_WITHOUT_ACCEPTED_OFFER");
        expect(await codesFor(pending.requestId)).toContain("REQUEST_OFFER_MISMATCH");
      },
    );
  });

  it("detect a financed invoice without a request", async () => {
    await withViolation(
      () => db.invoice.update({ where: { id: offered.invoiceId }, data: { financingStatus: "APPROVED" } }),
      () => db.invoice.update({ where: { id: offered.invoiceId }, data: { financingStatus: "OFFER_GENERATED" } }),
      async () => {
        const codes = await codesFor(offered.invoiceId);
        expect(codes).toContain("INVOICE_FINANCED_WITHOUT_REQUEST");
        expect(codes).toContain("INVOICE_FINANCED_WITHOUT_ACCEPTED_OFFER");
      },
    );
  });

  it("detect financing activity on an invoice the builder has not accepted", async () => {
    await withViolation(
      () => db.invoice.update({ where: { id: pending.invoiceId }, data: { status: "UNDER_REVIEW" } }),
      () => db.invoice.update({ where: { id: pending.invoiceId }, data: { status: "ACCEPTED" } }),
      async () => expect(await codesFor(pending.invoiceId)).toContain("INVOICE_FINANCING_BEFORE_ACCEPTANCE"),
    );
  });

  it("detect two open offers on one invoice", async () => {
    const offer = await db.financingOffer.findUniqueOrThrow({ where: { id: offered.offerId } });
    const { id, reference, ...rest } = offer;
    void id;
    let duplicateId = "";
    await withViolation(
      async () => {
        duplicateId = (await db.financingOffer.create({ data: { ...rest, reference: `${reference}-DUP`, pricingSnapshot: rest.pricingSnapshot ?? undefined } })).id;
      },
      () => db.financingOffer.delete({ where: { id: duplicateId } }),
      async () => expect(await codesFor(offered.invoiceId)).toContain("INVOICE_MULTIPLE_OPEN_OFFERS"),
    );
  });

  it("detect a request whose status disagrees with its invoice", async () => {
    await withViolation(
      () => db.financingRequest.update({ where: { id: pending.requestId }, data: { status: "APPROVED" } }),
      () => db.financingRequest.update({ where: { id: pending.requestId }, data: { status: "PENDING_APPROVAL" } }),
      async () => expect(await codesFor(pending.requestId)).toContain("REQUEST_STATUS_MISMATCH"),
    );
  });

  it("detect a request naming another channel partner", async () => {
    await withViolation(
      () => db.financingRequest.update({ where: { id: pending.requestId }, data: { cpId: as.urbannest.orgId } }),
      () => db.financingRequest.update({ where: { id: pending.requestId }, data: { cpId: as.prestige.orgId } }),
      async () => expect(await codesFor(pending.requestId)).toContain("REQUEST_PARTY_MISMATCH"),
    );
  });

  it("detect request figures that do not add up", async () => {
    const request = await db.financingRequest.findUniqueOrThrow({ where: { id: pending.requestId } });
    await withViolation(
      () => db.financingRequest.update({ where: { id: request.id }, data: { netPayablePaise: request.netPayablePaise + 1n } }),
      () => db.financingRequest.update({ where: { id: request.id }, data: { netPayablePaise: request.netPayablePaise } }),
      async () => {
        const codes = await codesFor(request.id);
        expect(codes).toContain("REQUEST_ARITHMETIC");
        expect(codes).toContain("REQUEST_OFFER_MISMATCH");
      },
    );
  });

  it("detect offer figures that do not add up", async () => {
    const offer = await db.financingOffer.findUniqueOrThrow({ where: { id: offered.offerId } });
    await withViolation(
      () => db.financingOffer.update({ where: { id: offer.id }, data: { financedAmountPaise: offer.financedAmountPaise - 100n } }),
      () => db.financingOffer.update({ where: { id: offer.id }, data: { financedAmountPaise: offer.financedAmountPaise } }),
      async () => expect(await codesFor(offer.id)).toContain("OFFER_ARITHMETIC"),
    );
  });

  it("detect a disbursement amount different from the request net", async () => {
    const disbursement = await db.disbursement.findUniqueOrThrow({ where: { requestId: disbursed.requestId } });
    await withViolation(
      () => db.disbursement.update({ where: { id: disbursement.id }, data: { amountPaise: disbursement.amountPaise + 1n } }),
      () => db.disbursement.update({ where: { id: disbursement.id }, data: { amountPaise: disbursement.amountPaise } }),
      async () => expect(await codesFor(disbursement.id)).toContain("DISBURSEMENT_AMOUNT_MISMATCH"),
    );
  });

  it("detect a disbursed request whose payout is not complete", async () => {
    const disbursement = await db.disbursement.findUniqueOrThrow({ where: { requestId: disbursed.requestId } });
    await withViolation(
      () => db.disbursement.update({ where: { id: disbursement.id }, data: { status: "INITIATED" } }),
      () => db.disbursement.update({ where: { id: disbursement.id }, data: { status: "SUCCESS" } }),
      async () => expect(await codesFor(disbursed.requestId)).toContain("DISBURSEMENT_STATE_MISMATCH"),
    );
  });

  it("detect a settlement amount different from the financed amount", async () => {
    const settlement = await db.settlement.findUniqueOrThrow({ where: { requestId: disbursed.requestId } });
    await withViolation(
      () => db.settlement.update({ where: { id: settlement.id }, data: { amountPaise: settlement.amountPaise - 1n } }),
      () => db.settlement.update({ where: { id: settlement.id }, data: { amountPaise: settlement.amountPaise } }),
      async () => expect(await codesFor(settlement.id)).toContain("SETTLEMENT_AMOUNT_MISMATCH"),
    );
  });

  it("detect a settlement on a request that was never disbursed", async () => {
    let settlementId = "";
    await withViolation(
      async () => {
        settlementId = (
          await db.settlement.create({
            data: { requestId: pending.requestId, builderId: as.godrej.orgId, financierId: as.finance.orgId, amountPaise: 1n, dueDate: new Date("2027-01-01T00:00:00.000Z") },
          })
        ).id;
      },
      () => db.settlement.delete({ where: { id: settlementId } }),
      async () => expect(await codesFor(pending.requestId)).toContain("SETTLEMENT_STATE_MISMATCH"),
    );
  });

  it("detect a settled settlement without a settlement date, and an open one with it", async () => {
    const settlement = await db.settlement.findUniqueOrThrow({ where: { requestId: disbursed.requestId } });
    await withViolation(
      () => db.settlement.update({ where: { id: settlement.id }, data: { status: "SETTLED", reference: "NEFT-TEST-INV" } }),
      () => db.settlement.update({ where: { id: settlement.id }, data: { status: settlement.status, reference: null } }),
      async () => expect(await codesFor(settlement.id)).toContain("SETTLED_WITHOUT_SETTLED_AT"),
    );
    await withViolation(
      () => db.settlement.update({ where: { id: settlement.id }, data: { settledAt: new Date() } }),
      () => db.settlement.update({ where: { id: settlement.id }, data: { settledAt: null } }),
      async () => expect(await codesFor(settlement.id)).toContain("OPEN_SETTLEMENT_WITH_SETTLED_AT"),
    );
  });

  it("detect two active programmes for one builder", async () => {
    let programmeId = "";
    await withViolation(
      async () => {
        programmeId = (
          await db.financingProgramme.create({
            data: {
              code: "BF-PRG-TEST-INV",
              name: "Conflicting programme",
              builderId: as.godrej.orgId,
              financierId: as.finance.orgId,
              discountRateBps: 200,
              status: "ACTIVE",
              effectiveFrom: new Date("2026-04-01T00:00:00.000Z"),
              terms: "Conflicting programme created by the invariant test.",
            },
          })
        ).id;
      },
      () => db.financingProgramme.delete({ where: { id: programmeId } }),
      async () => {
        const report = await runInvariantChecks();
        const finding = report.violations.find((v) => v.code === "MULTIPLE_ACTIVE_PROGRAMMES" && v.entityId === as.godrej.orgId);
        expect(finding?.message).toContain("BF-PRG-0001");
        expect(finding?.message).toContain("BF-PRG-TEST-INV");
        expect(report.ok).toBe(false);
      },
    );
  });

  it("warn about a stored settlement status that is behind the IST calendar", async () => {
    const settlement = await db.settlement.findUniqueOrThrow({ where: { requestId: disbursed.requestId } });
    await withViolation(
      () => db.settlement.update({ where: { id: settlement.id }, data: { dueDate: new Date("2026-01-05T00:00:00.000Z"), status: "NOT_DUE" } }),
      () => db.settlement.update({ where: { id: settlement.id }, data: { dueDate: settlement.dueDate, status: settlement.status } }),
      async () => {
        const report = await runInvariantChecks();
        const finding = report.violations.find((v) => v.entityId === settlement.id);
        expect(finding).toMatchObject({ code: "SETTLEMENT_STATUS_STALE", severity: "warning" });
        expect(report.ok).toBe(true);
      },
    );
  });
});

describe("check:invariants command", () => {
  const root = path.resolve(__dirname, "../..");
  const run = () => {
    try {
      const stdout = execFileSync(process.execPath, [path.join(root, "node_modules", "tsx", "dist", "cli.mjs"), "scripts/check-invariants.ts", "--json"], {
        cwd: root,
        env: { ...process.env },
        encoding: "utf8",
      });
      return { status: 0, stdout };
    } catch (error) {
      const e = error as { status: number; stdout: string };
      return { status: e.status, stdout: e.stdout };
    }
  };

  it("exits 0 on a consistent database and 1 when an invariant is broken", async () => {
    const clean = run();
    expect(clean.status).toBe(0);
    expect(JSON.parse(clean.stdout)).toMatchObject({ ok: true, errors: 0 });

    const disbursement = await db.disbursement.findUniqueOrThrow({ where: { requestId: disbursed.requestId } });
    await withViolation(
      () => db.disbursement.update({ where: { id: disbursement.id }, data: { amountPaise: 1n } }),
      () => db.disbursement.update({ where: { id: disbursement.id }, data: { amountPaise: disbursement.amountPaise } }),
      async () => {
        const broken = run();
        expect(broken.status).toBe(1);
        expect(JSON.parse(broken.stdout).violations).toContainEqual(expect.objectContaining({ code: "DISBURSEMENT_AMOUNT_MISMATCH", entityId: disbursement.id }));
      },
    );
  });
});
