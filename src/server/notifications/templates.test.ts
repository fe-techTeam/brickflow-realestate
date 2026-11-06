import { describe, expect, it } from "vitest";
import { NOTIFICATION_EVENTS, normaliseWhatsappNumber, type NotificationEvent } from "@/lib/notifications";
import type { WorkspaceKey } from "@/lib/workspaces";
import { planSettlementReminder } from "./jobs";
import { renderNotification, whatsappTemplateName, type NotificationEventDataMap } from "./templates";
import { unsubscribeUrl, verifyUnsubscribeToken } from "./unsubscribe";

const invoice = {
  invoiceId: "inv1",
  invoiceNumber: "PRE/2026/001",
  invoiceReference: "BF-INV-2026-000001",
  amountPaise: "50000000",
  approvedAmountPaise: "48000000",
  cpName: "Prestige Realty",
  builderName: "Godrej Homes",
  projectName: "Forest Hills",
  note: "Please attach the booking form.",
};
const offer = {
  offerId: "off1",
  offerReference: "BF-OFR-2026-000001",
  invoiceId: "inv1",
  invoiceNumber: "PRE/2026/001",
  approvedAmountPaise: "50000000",
  netPayablePaise: "48500000",
  discountRateBps: 300,
  validUntil: "2026-11-13T05:00:00.000Z",
  cpName: "Prestige Realty",
  builderName: "Godrej Homes",
};
const request = { requestId: "req1", requestReference: "BF-FIN-2026-000001", invoiceId: "inv1", invoiceNumber: "PRE/2026/001", cpName: "Prestige Realty", builderName: "Godrej Homes" };
const settlement = {
  settlementId: "set1",
  requestId: "req1",
  requestReference: "BF-FIN-2026-000001",
  invoiceId: "inv1",
  invoiceNumber: "PRE/2026/001",
  amountPaise: "50000000",
  dueDate: "2026-11-09",
  builderName: "Godrej Homes",
  financierName: "Veefin Capital",
  cpName: "Prestige Realty",
  daysUntilDue: 3,
};

const SAMPLES: { [E in NotificationEvent]: NotificationEventDataMap[E] } = {
  "invoice.submitted": invoice,
  "invoice.under_review": invoice,
  "invoice.approved": invoice,
  "invoice.rejected": invoice,
  "invoice.clarification_requested": invoice,
  "invoice.resubmitted": invoice,
  "offer.generated": offer,
  "offer.expiring": offer,
  "offer.accepted": { ...request, offerReference: "BF-OFR-2026-000001", netPayablePaise: "48500000" },
  "financing.approved": { ...request, netPayablePaise: "48500000", financierName: "Veefin Capital", note: null },
  "financing.rejected": { ...request, netPayablePaise: "48500000", financierName: "Veefin Capital", note: "Credit limit reached for this builder." },
  "disbursement.initiated": { ...request, paymentReference: "BFPAY-2026-000001", amountPaise: "48500000" },
  "disbursement.completed": { ...request, paymentReference: "BFPAY-2026-000001", amountPaise: "48500000", utr: "UTR123", settlementAmountPaise: "50000000", settlementDueDate: "2027-01-05" },
  "settlement.due_soon": settlement,
  "settlement.due_today": settlement,
  "settlement.overdue": { ...settlement, daysOverdue: 4 },
  "settlement.settled": { ...settlement, settlementReference: "NEFT-1" },
};

const WORKSPACES: (WorkspaceKey | null)[] = ["partner", "builder", "finance", "admin", null];

describe("notification templates", () => {
  it("cover every catalogued event", () => {
    expect(Object.keys(SAMPLES).sort()).toEqual(Object.keys(NOTIFICATION_EVENTS).sort());
  });

  it.each(Object.keys(SAMPLES) as NotificationEvent[])("%s renders for every workspace", (event) => {
    for (const workspace of WORKSPACES) {
      const r = renderNotification(event, SAMPLES[event] as never, { workspace });
      expect(r.title.length).toBeGreaterThan(5);
      expect(r.body.length).toBeGreaterThan(5);
      expect(r.email.subject.length).toBeGreaterThan(5);
      expect(r.email.facts.length).toBeGreaterThan(0);
      expect(r.whatsappParams.length).toBeGreaterThan(0);
      expect(r.whatsappParams.every((p) => typeof p === "string" && p.length > 0)).toBe(true);
      if (workspace === null) expect(r.path).toBeNull();
      else expect(r.path).toMatch(new RegExp(`^/${workspace}(/|$)`));
      expect(JSON.stringify(r)).not.toMatch(/undefined|NaN|\[object Object\]/);
    }
  });

  it("formats money from paise exactly and links to the right record", () => {
    const r = renderNotification("invoice.approved", invoice, { workspace: "partner" });
    expect(r.body).toContain("₹4,80,000.00");
    expect(r.path).toBe("/partner/invoices/inv1");
    expect(r.email.note).toEqual({ label: "Builder's comment", text: invoice.note });
    expect(renderNotification("disbursement.completed", SAMPLES["disbursement.completed"], { workspace: "builder" }).path).toBe("/builder/settlements");
    expect(renderNotification("offer.accepted", SAMPLES["offer.accepted"], { workspace: "finance" }).path).toBe("/finance/requests/req1");
  });

  it("names WhatsApp templates after the event", () => {
    expect(whatsappTemplateName("settlement.due_today")).toBe("brickflow_settlement_due_today");
  });
});

describe("settlement reminder plan", () => {
  const due = new Date("2026-11-10T00:00:00.000Z");
  it("sends due-soon within three days, due-today on the day and weekly overdue notices", () => {
    expect(planSettlementReminder("s", due, "2026-11-06")).toBeNull();
    expect(planSettlementReminder("s", due, "2026-11-07")).toEqual({ event: "settlement.due_soon", dedupeKey: "settlement-due-soon:s", daysUntilDue: 3 });
    expect(planSettlementReminder("s", due, "2026-11-09")).toMatchObject({ event: "settlement.due_soon", daysUntilDue: 1 });
    expect(planSettlementReminder("s", due, "2026-11-10")).toEqual({ event: "settlement.due_today", dedupeKey: "settlement-due-today:s" });
    expect(planSettlementReminder("s", due, "2026-11-11")).toEqual({ event: "settlement.overdue", dedupeKey: "settlement-overdue:s:w0", daysOverdue: 1 });
    expect(planSettlementReminder("s", due, "2026-11-17")).toMatchObject({ dedupeKey: "settlement-overdue:s:w0", daysOverdue: 7 });
    expect(planSettlementReminder("s", due, "2026-11-18")).toMatchObject({ dedupeKey: "settlement-overdue:s:w1", daysOverdue: 8 });
  });
});

describe("unsubscribe links", () => {
  it("are signed per user and category", () => {
    const url = new URL(unsubscribeUrl("https://app.example.com", "user1", "offers"));
    expect(url.origin + url.pathname).toBe("https://app.example.com/api/notifications/unsubscribe");
    const token = url.searchParams.get("t")!;
    expect(verifyUnsubscribeToken("user1", "offers", token)).toBe(true);
    expect(verifyUnsubscribeToken("user2", "offers", token)).toBe(false);
    expect(verifyUnsubscribeToken("user1", "invoices", token)).toBe(false);
    expect(verifyUnsubscribeToken("user1", "not-a-category", token)).toBe(false);
    expect(verifyUnsubscribeToken("user1", "offers", `${token.slice(0, -1)}A`)).toBe(false);
    expect(verifyUnsubscribeToken("user1", "offers", "")).toBe(false);
  });
});

describe("normaliseWhatsappNumber", () => {
  it.each([
    ["+91 98765 43210", "+919876543210"],
    ["9876543210", "+919876543210"],
    ["0091-98765-43210", "+919876543210"],
    ["+44 20 7946 0958", "+442079460958"],
    ["12345", null],
    ["+0123456789", null],
    ["98765abc10", null],
    ["2079460958", null],
  ])("%s -> %s", (input, expected) => {
    expect(normaliseWhatsappNumber(input)).toBe(expected);
  });
});
