import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { Actor } from "@/server/auth/session";
import { db } from "@/server/db";
import { actors, acceptedInvoice, expectDomainError, submitTestInvoice, type DemoUser } from "./helpers";
import { cookieJar } from "./request-context";
import { openSession, SESSION_COOKIE } from "./security-helpers";

vi.mock("next/headers", async () => (await import("./request-context")).nextHeaders);
vi.mock("next/cache", async () => (await import("./request-context")).nextCache);

const adminActions = await import("@/server/actions/admin");
const financingActions = await import("@/server/actions/financing");
const invoiceActions = await import("@/server/actions/invoices");
const securityActions = await import("@/server/actions/security");
const adminService = await import("@/server/services/admin");
const financing = await import("@/server/services/financing");
const invoices = await import("@/server/services/invoices");
const documentRoute = await import("@/app/api/documents/invoices/[documentId]/route");

let as: Record<DemoUser, Actor>;
const key = () => randomUUID();

beforeAll(async () => {
  as = await actors();
});

beforeEach(() => {
  cookieJar.clear();
});

/** Puts a valid session cookie for the seeded user in the fake request, as a signed-in browser would have. */
async function signInAs(user: DemoUser) {
  const { token } = await openSession(as[user], { mfaVerified: true });
  cookieJar.set(SESSION_COOKIE, token);
}

const WORKSPACE_USERS: Record<"partner" | "builder" | "finance" | "admin", DemoUser> = {
  partner: "prestige",
  builder: "godrej",
  finance: "finance",
  admin: "admin",
};

function others(owner: keyof typeof WORKSPACE_USERS): DemoUser[] {
  return (Object.keys(WORKSPACE_USERS) as (keyof typeof WORKSPACE_USERS)[]).filter((w) => w !== owner).map((w) => WORKSPACE_USERS[w]);
}

async function pendingRequest() {
  return db.financingRequest.findFirstOrThrow({ where: { status: "PENDING_APPROVAL", financierId: as.finance.orgId } });
}

describe("server actions are refused outside their workspace", () => {
  it("requires a valid, active session for every action", async () => {
    const invoice = await submitTestInvoice(as.prestige);
    expect(await invoiceActions.approveInvoiceAction(invoice.id, {})).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });

    const { token, session } = await openSession(as.godrej);
    cookieJar.set(SESSION_COOKIE, token);
    await db.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
    expect(await invoiceActions.approveInvoiceAction(invoice.id, {})).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });

    cookieJar.set(SESSION_COOKIE, `${token.slice(0, -4)}AAAA`);
    expect(await invoiceActions.approveInvoiceAction(invoice.id, {})).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    expect((await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe("SUBMITTED");
  });

  it("invoices: only partners submit and only builders review or approve", async () => {
    const invoice = await submitTestInvoice(as.prestige);
    for (const user of others("builder")) {
      await signInAs(user);
      expect(await invoiceActions.approveInvoiceAction(invoice.id, {}), user).toMatchObject({ ok: false, code: "FORBIDDEN" });
      expect(await invoiceActions.rejectInvoiceAction(invoice.id, { reason: "Not permitted to do this" }), user).toMatchObject({ ok: false, code: "FORBIDDEN" });
      expect(await invoiceActions.markUnderReviewAction(invoice.id), user).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    for (const user of others("partner")) {
      await signInAs(user);
      const form = new FormData();
      form.set("builderId", as.godrej.orgId);
      expect(await invoiceActions.submitInvoiceAction(form), user).toMatchObject({ ok: false, code: "FORBIDDEN" });
      expect(await invoiceActions.resubmitInvoiceAction(invoice.id, new FormData()), user).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    expect((await db.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).status).toBe("SUBMITTED");

    await signInAs("godrej");
    expect(await invoiceActions.markUnderReviewAction(invoice.id)).toMatchObject({ ok: true });
  });

  it("financing: only partners generate or accept offers, only the financier decides and pays out", async () => {
    const invoice = await acceptedInvoice(as.prestige, as.godrej);
    for (const user of others("partner")) {
      await signInAs(user);
      expect(await financingActions.generateOfferAction(invoice.id), user).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    await signInAs("prestige");
    const offer = await financingActions.generateOfferAction(invoice.id);
    expect(offer.ok).toBe(true);
    const offerId = offer.ok ? offer.data.id : "";
    for (const user of others("partner")) {
      await signInAs(user);
      expect(await financingActions.acceptOfferAction(offerId, { consent: true, idempotencyKey: key() }), user).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }

    const request = await pendingRequest();
    for (const user of others("finance")) {
      await signInAs(user);
      expect(await financingActions.approveFinancingRequestAction(request.id, { idempotencyKey: key() }), user).toMatchObject({ ok: false, code: "FORBIDDEN" });
      expect(await financingActions.rejectFinancingRequestAction(request.id, { reason: "Not permitted to do this", idempotencyKey: key() }), user).toMatchObject({ ok: false, code: "FORBIDDEN" });
      expect(await financingActions.initiateDisbursementAction(request.id, { idempotencyKey: key() }), user).toMatchObject({ ok: false, code: "FORBIDDEN" });
      expect(await financingActions.completeDisbursementAction(request.id, { idempotencyKey: key() }), user).toMatchObject({ ok: false, code: "FORBIDDEN" });
      expect(await financingActions.markSettlementSettledAction(request.id, { reference: "UTR-0001", idempotencyKey: key() }), user).toMatchObject({ ok: false, code: "FORBIDDEN" });
      expect(await financingActions.addInternalCommentAction(request.id, { body: "Should not be stored" }), user).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    expect((await db.financingRequest.findUniqueOrThrow({ where: { id: request.id } })).status).toBe("PENDING_APPROVAL");
    expect(await db.internalComment.count({ where: { body: "Should not be stored" } })).toBe(0);
  });

  it("admin: only the super admin manages programmes, organisations, users, settings and two-step resets", async () => {
    const programme = await db.financingProgramme.findFirstOrThrow();
    const target = await db.user.findUniqueOrThrow({ where: { email: "partner@urbannest-demo.test" } });
    for (const user of others("admin")) {
      await signInAs(user);
      expect(await adminActions.setUserStatusAction(target.id, "INACTIVE"), user).toMatchObject({ ok: false, code: "FORBIDDEN" });
      expect(await adminActions.setOrganisationStatusAction(as.coastal.orgId, "INACTIVE"), user).toMatchObject({ ok: false, code: "FORBIDDEN" });
      expect(await adminActions.updateSettingsAction({ "platform.supportEmail": "attacker@example.com" }), user).toMatchObject({ ok: false, code: "FORBIDDEN" });
      expect(await adminActions.updateProgrammeAction(programme.id, { name: "x", discountRate: "1", status: "ACTIVE", effectiveFrom: "2026-01-01", offerValidityDays: 7, terms: "x" }), user).toMatchObject({
        ok: false,
        code: "FORBIDDEN",
      });
      expect(await securityActions.resetUserMfaAction(target.id), user).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    expect((await db.user.findUniqueOrThrow({ where: { id: target.id } })).status).toBe("ACTIVE");
    expect((await db.organisation.findUniqueOrThrow({ where: { id: as.coastal.orgId } })).status).toBe("ACTIVE");
    expect((await db.platformSetting.findUnique({ where: { key: "platform.supportEmail" } }))?.value).not.toBe("attacker@example.com");
  });
});

describe("services enforce the permission map", () => {
  it("invoices", async () => {
    const invoice = await submitTestInvoice(as.prestige);
    for (const user of others("builder")) {
      await expectDomainError(invoices.approveInvoice(as[user], invoice.id, {}), "FORBIDDEN");
      await expectDomainError(invoices.requestClarification(as[user], invoice.id, { reason: "Please clarify the amount" }), "FORBIDDEN");
    }
    for (const user of others("partner")) {
      await expectDomainError(invoices.listInvoiceableBuilders(as[user]), "FORBIDDEN");
      await expectDomainError(invoices.resubmitInvoice(as[user], invoice.id, { note: "Responding as someone else" }, null), "FORBIDDEN");
    }
    // Another partner and another builder cannot even see it.
    await expectDomainError(invoices.getInvoiceDetail(as.urbannest, invoice.id), "NOT_FOUND");
    await expectDomainError(invoices.approveInvoice(as.skyline, invoice.id, {}), "NOT_FOUND");
  });

  it("financing", async () => {
    const request = await pendingRequest();
    for (const user of others("finance")) {
      await expectDomainError(financing.approveFinancingRequest(as[user], request.id, {}), "FORBIDDEN");
      await expectDomainError(financing.initiateDisbursement(as[user], request.id), "FORBIDDEN");
    }
    for (const user of others("partner")) await expectDomainError(financing.listOpenOffers(as[user]), "FORBIDDEN");
    // A partner sees only its own requests.
    await expectDomainError(financing.getFinancingRequestDetail(as.urbannest, request.id), "NOT_FOUND");
  });

  it("admin", async () => {
    for (const user of others("admin")) {
      await expectDomainError(adminService.listUsers(as[user]), "FORBIDDEN");
      await expectDomainError(adminService.updateSettings(as[user], {}), "FORBIDDEN");
    }
    await expectDomainError(adminService.listOrganisations(as.prestige), "FORBIDDEN");
    await expectDomainError(adminService.listProgrammes(as.prestige), "FORBIDDEN");
  });

  it("denies an actor whose role does not match its organisation type", async () => {
    const forged: Actor = { ...as.prestige, role: "SUPER_ADMIN" };
    await expectDomainError(adminService.listUsers(forged), "FORBIDDEN");
    await expectDomainError(invoices.listInvoices(forged), "FORBIDDEN");
    const builderAsPartner: Actor = { ...as.godrej, role: "CP_ADMIN" };
    await expectDomainError(invoices.listInvoiceableBuilders(builderAsPartner), "FORBIDDEN");
  });
});

describe("documents", () => {
  async function getDocument(documentId: string) {
    const request = new NextRequest(`http://localhost/api/documents/invoices/${documentId}`);
    return documentRoute.GET(request, { params: Promise.resolve({ documentId }) });
  }

  it("serves an invoice PDF only to the parties that may see it", async () => {
    const invoice = await submitTestInvoice(as.prestige);
    const document = await db.invoiceDocument.findFirstOrThrow({ where: { invoiceId: invoice.id } });

    expect((await getDocument(document.id)).status).toBe(401);
    for (const user of ["prestige", "godrej", "admin"] as const) {
      await signInAs(user);
      const response = await getDocument(document.id);
      expect(response.status, user).toBe(200);
      expect(response.headers.get("content-type")).toBe("application/pdf");
    }
    // Other partner, other builder, and the financier before the invoice is approved.
    for (const user of ["urbannest", "skyline", "finance"] as const) {
      await signInAs(user);
      expect((await getDocument(document.id)).status, user).toBe(404);
    }
    await expectDomainError(invoices.getDocumentForActor(as.urbannest, document.id), "NOT_FOUND");
  });
});
