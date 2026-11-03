import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FinancingProgramme } from "@/generated/prisma/client";
import type { Actor } from "@/server/auth/session";
import { db } from "@/server/db";
import { createProgramme, listProgrammes, updateProgramme, type UpdateProgrammeInput } from "@/server/services/admin";
import { acceptOffer, approveFinancingRequest, generateOffer, getApplicableProgramme } from "@/server/services/financing";
import { acceptedInvoice, actors, expectDomainError, expectValidationError, type DemoUser } from "./helpers";

let as: Record<DemoUser, Actor>;
let godrejProgramme: FinancingProgramme;
let skylineProgramme: FinancingProgramme;

function inputFrom(programme: FinancingProgramme, overrides: Partial<UpdateProgrammeInput> = {}): UpdateProgrammeInput {
  return {
    name: programme.name,
    discountRate: String(programme.discountRateBps / 100),
    status: programme.status,
    effectiveFrom: programme.effectiveFrom.toISOString().slice(0, 10),
    effectiveTo: programme.effectiveTo?.toISOString().slice(0, 10),
    offerValidityDays: String(programme.offerValidityDays),
    terms: programme.terms,
    ...overrides,
  };
}

beforeAll(async () => {
  as = await actors();
  godrejProgramme = await db.financingProgramme.findUniqueOrThrow({ where: { code: "BF-PRG-0001" } });
  skylineProgramme = await db.financingProgramme.findUniqueOrThrow({ where: { code: "BF-PRG-0002" } });
});

afterAll(async () => {
  await updateProgramme(as.admin, godrejProgramme.id, inputFrom(godrejProgramme));
  await updateProgramme(as.admin, skylineProgramme.id, inputFrom(skylineProgramme));
});

describe("seeded programmes", () => {
  it("configures 3% for Godrej, 2.5% for Skyline and 3.5% for Coastal", async () => {
    const programmes = await listProgrammes(as.admin);
    const rates = Object.fromEntries(programmes.map((p) => [p.code, [p.builder.name, p.discountRateBps, p.status]]));
    expect(rates).toMatchObject({
      "BF-PRG-0001": ["Godrej Properties Demo", 300, "ACTIVE"],
      "BF-PRG-0002": ["Skyline Habitat Developers", 250, "ACTIVE"],
      "BF-PRG-0003": [expect.any(String), 350, "ACTIVE"],
    });
    expect((await listProgrammes(as.godrej)).map((p) => p.code)).toEqual(["BF-PRG-0001"]);
    await expectDomainError(listProgrammes(as.prestige), "FORBIDDEN");
  });
});

describe("changing the discount rate", () => {
  let acceptedRequestId: string;
  let openOfferId: string;
  let openInvoiceId: string;

  it("is refused for anyone but the super admin", async () => {
    for (const actor of [as.finance, as.godrej, as.prestige]) {
      await expectDomainError(updateProgramme(actor, godrejProgramme.id, inputFrom(godrejProgramme, { discountRate: "1" })), "FORBIDDEN");
    }
    expect((await db.financingProgramme.findUniqueOrThrow({ where: { id: godrejProgramme.id } })).discountRateBps).toBe(300);
  });

  it("validates the new rate", async () => {
    await expectValidationError(updateProgramme(as.admin, godrejProgramme.id, inputFrom(godrejProgramme, { discountRate: "0" })), "discountRate");
    await expectValidationError(updateProgramme(as.admin, godrejProgramme.id, inputFrom(godrejProgramme, { discountRate: "30.01" })), "discountRate");
    await expectValidationError(updateProgramme(as.admin, godrejProgramme.id, inputFrom(godrejProgramme, { discountRate: "2.555" })), "discountRate");
    await expectDomainError(updateProgramme(as.admin, "missing-programme", inputFrom(godrejProgramme)), "NOT_FOUND");
  });

  it("supersedes open offers but never reprices an accepted request", async () => {
    const accepted = await acceptedInvoice(as.prestige, as.godrej, { amount: "500000" });
    const acceptedOffer = await generateOffer(as.prestige, accepted.id);
    acceptedRequestId = (await acceptOffer(as.prestige, acceptedOffer.id, { consent: true })).id;
    await approveFinancingRequest(as.finance, acceptedRequestId, {});

    const open = await acceptedInvoice(as.prestige, as.godrej, { amount: "500000" });
    openInvoiceId = open.id;
    openOfferId = (await generateOffer(as.prestige, open.id)).id;

    const result = await updateProgramme(as.admin, godrejProgramme.id, inputFrom(godrejProgramme, { discountRate: "2.75" }));
    expect(result.programme.discountRateBps).toBe(275);
    expect(result.openOffersWithdrawn).toBeGreaterThanOrEqual(1);

    const request = await db.financingRequest.findUniqueOrThrow({ where: { id: acceptedRequestId }, include: { offer: true } });
    expect(request).toMatchObject({
      status: "APPROVED",
      discountRateBps: 300,
      approvedAmountPaise: 5_00_000_00n,
      discountAmountPaise: 15_000_00n,
      netPayablePaise: 4_85_000_00n,
    });
    expect(request.offer).toMatchObject({ status: "ACCEPTED", discountRateBps: 300, netPayablePaise: 4_85_000_00n });

    expect((await db.financingOffer.findUniqueOrThrow({ where: { id: openOfferId } })).status).toBe("SUPERSEDED");
    expect((await db.invoice.findUniqueOrThrow({ where: { id: openInvoiceId } })).financingStatus).toBe("NOT_REQUESTED");

    const audit = await db.auditLog.findFirstOrThrow({ where: { entityId: godrejProgramme.id, action: "programme.rate_changed" }, orderBy: { createdAt: "desc" } });
    expect(audit.summary).toContain("from 3% to 2.75%");
    expect(JSON.parse(audit.metadata!)).toMatchObject({ before: { discountRateBps: 300 }, after: { discountRateBps: 275 } });
  });

  it("refuses to accept a superseded offer", async () => {
    await expectDomainError(acceptOffer(as.prestige, openOfferId, { consent: true }), "CONFLICT", /no longer available/);
  });

  it("prices new offers at the new rate", async () => {
    const offer = await generateOffer(as.prestige, openInvoiceId);
    expect(offer.id).not.toBe(openOfferId);
    expect(offer).toMatchObject({ discountRateBps: 275, discountAmountPaise: 13_750_00n, netPayablePaise: 4_86_250_00n });
    expect(JSON.parse(offer.termsSnapshot)).toMatchObject({ discountRateBps: 275 });

    const request = await acceptOffer(as.prestige, offer.id, { consent: true });
    expect(request).toMatchObject({ discountRateBps: 275, netPayablePaise: 4_86_250_00n });
  });

  it("withdraws an offer whose rate no longer matches the live programme", async () => {
    const invoice = await acceptedInvoice(as.prestige, as.godrej);
    const offer = await generateOffer(as.prestige, invoice.id);
    await db.financingProgramme.update({ where: { id: godrejProgramme.id }, data: { discountRateBps: 280 } });
    try {
      await expectDomainError(acceptOffer(as.prestige, offer.id, { consent: true }), "CONFLICT", /terms for this builder have changed/);
      expect((await db.financingOffer.findUniqueOrThrow({ where: { id: offer.id } })).status).toBe("SUPERSEDED");
      expect((await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).financingStatus).toBe("NOT_REQUESTED");
    } finally {
      await db.financingProgramme.update({ where: { id: godrejProgramme.id }, data: { discountRateBps: 275 } });
    }
  });
});

describe("programme availability", () => {
  it("blocks new offers while the builder's programme is suspended", async () => {
    const invoice = await acceptedInvoice(as.prestige, as.skyline, { builder: "skyline" });
    await updateProgramme(as.admin, skylineProgramme.id, inputFrom(skylineProgramme, { status: "SUSPENDED" }));
    expect(await getApplicableProgramme(as.skyline.orgId)).toBeNull();
    await expectDomainError(generateOffer(as.prestige, invoice.id), "CONFLICT", /No active financing programme/);

    await updateProgramme(as.admin, skylineProgramme.id, inputFrom(skylineProgramme));
    await expect(generateOffer(as.prestige, invoice.id)).resolves.toMatchObject({ discountRateBps: 250 });
  });

  it("allows only one active programme per builder", async () => {
    const input = {
      name: "Second Godrej programme",
      builderId: as.godrej.orgId,
      financierId: as.finance.orgId,
      discountRate: "2",
      effectiveFrom: "2026-04-01",
      offerValidityDays: "7",
      terms: "Alternative terms that must not coexist with the active programme.",
    };
    await expectDomainError(createProgramme(as.admin, { ...input, status: "ACTIVE" }), "CONFLICT", /already has an active programme/);
    await expectDomainError(createProgramme(as.finance, { ...input, status: "DRAFT" }), "FORBIDDEN");

    const draft = await createProgramme(as.admin, { ...input, status: "DRAFT" });
    expect(draft.code).toMatch(/^BF-PRG-\d{4}$/);
    expect(draft).toMatchObject({ status: "DRAFT", discountRateBps: 200 });
    await expectDomainError(updateProgramme(as.admin, draft.id, inputFrom(draft, { status: "ACTIVE" })), "CONFLICT");
    expect((await getApplicableProgramme(as.godrej.orgId))!.code).toBe("BF-PRG-0001");
  });
});
