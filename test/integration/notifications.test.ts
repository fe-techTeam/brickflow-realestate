import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as unsubscribeGet, POST as unsubscribePost } from "@/app/api/notifications/unsubscribe/route";
import { GET as webhookGet, POST as webhookPost } from "@/app/api/webhooks/whatsapp/route";
import type { Actor } from "@/server/auth/session";
import { db } from "@/server/db";
import { registerJobHandler, unregisterJobHandler } from "@/server/jobs/registry";
import { JobWorker } from "@/server/jobs/worker";
import { NOTIFICATION_JOBS } from "@/server/notifications/constants";
import { buildEmail } from "@/server/notifications/delivery";
import { setEmailProvider, type EmailMessage, type EmailProvider } from "@/server/notifications/email/providers";
import { getInboxSummary, getNotificationSettings, listNotifications, markNotificationsRead, saveNotificationSettings } from "@/server/notifications/inbox";
import { registerNotificationJobs, runOfferExpiringReminder, runSettlementReminders } from "@/server/notifications/jobs";
import { notify } from "@/server/notifications/notify";
import { sendTemplatedEmail } from "@/server/notifications/send-email";
import { unsubscribeUrl } from "@/server/notifications/unsubscribe";
import { setWhatsappProvider, type WhatsappProvider, type WhatsappTemplateMessage } from "@/server/notifications/whatsapp/providers";
import { acceptOffer, approveFinancingRequest, completeDisbursement, generateOffer, initiateDisbursement } from "@/server/services/financing";
import { approveInvoice, rejectInvoice } from "@/server/services/invoices";
import { cancelQueuedJob, listDeliveries, retryJob } from "@/server/services/jobs-admin";
import { actors, auditActions, expectDomainError, isoDate, submitTestInvoice, type DemoUser } from "./helpers";

let as: Record<DemoUser, Actor>;

class FakeEmail implements EmailProvider {
  readonly name = "smtp" as const;
  sent: EmailMessage[] = [];
  failWith: Error | null = null;
  async send(message: EmailMessage) {
    if (this.failWith) throw this.failWith;
    this.sent.push(message);
    return { providerMessageId: `ses-${this.sent.length}` };
  }
  close() {}
}

class FakeWhatsapp implements WhatsappProvider {
  readonly name = "cloud" as const;
  readonly enabled = true;
  sent: WhatsappTemplateMessage[] = [];
  async send(message: WhatsappTemplateMessage) {
    this.sent.push(message);
    return { providerMessageId: `wamid.${this.sent.length}.${Date.now()}` };
  }
}

const email = new FakeEmail();
const whatsapp = new FakeWhatsapp();
const quiet = () => undefined;
const deliverWorker = () => new JobWorker({ types: [NOTIFICATION_JOBS.deliver], logger: quiet, runSchedules: false, backoffBaseMs: 1000 });

async function usersOf(orgId: string) {
  return (await db.organisationUser.findMany({ where: { organisationId: orgId }, select: { userId: true } })).map((m) => m.userId);
}

async function resetPreferences(...userIds: string[]) {
  await db.notificationPreference.deleteMany({ where: { userId: { in: userIds } } });
  await db.notificationProfile.deleteMany({ where: { userId: { in: userIds } } });
}

beforeAll(async () => {
  as = await actors();
  registerNotificationJobs();
  setEmailProvider(email);
  setWhatsappProvider(whatsapp);
  // Earlier suites queue deliveries through the services; start from a clean outbox.
  await db.job.deleteMany({ where: { type: NOTIFICATION_JOBS.deliver } });
  await db.notificationDelivery.deleteMany();
});

beforeEach(() => {
  email.sent = [];
  email.failWith = null;
  whatsapp.sent = [];
});

afterAll(async () => {
  setEmailProvider(null);
  setWhatsappProvider(null);
  await resetPreferences(as.prestige.userId, as.godrej.userId);
});

describe("workflow events", () => {
  it("tells the builder about a submitted invoice in the same transaction, never the submitter", async () => {
    const invoice = await submitTestInvoice(as.prestige, { amount: "250000" });
    const builderUsers = await usersOf(as.godrej.orgId);

    const notifications = await db.notification.findMany({ where: { event: "invoice.submitted", link: `/builder/invoices/${invoice.id}` } });
    expect(notifications.map((n) => n.userId).sort()).toEqual(builderUsers.sort());
    expect(notifications[0]).toMatchObject({ category: "invoices", readAt: null, organisationId: as.godrej.orgId });
    expect(notifications[0]!.title).toContain(invoice.invoiceNumber);
    expect(notifications[0]!.body).toContain("₹2,50,000.00");

    const deliveries = await db.notificationDelivery.findMany({ where: { event: "invoice.submitted", data: { path: ["values", "invoiceId"], equals: invoice.id } } });
    expect(deliveries.map((d) => d.channel)).toEqual(builderUsers.map(() => "EMAIL"));
    expect(deliveries.every((d) => d.status === "QUEUED")).toBe(true);
    const jobs = await db.job.findMany({ where: { idempotencyKey: { in: deliveries.map((d) => `delivery:${d.id}`) } } });
    expect(jobs).toHaveLength(deliveries.length);
    expect(jobs.every((j) => j.type === NOTIFICATION_JOBS.deliver && j.status === "PENDING")).toBe(true);

    expect(await db.notification.count({ where: { userId: as.prestige.userId, event: "invoice.submitted" } })).toBe(0);
  });

  it("tells the partner about review outcomes and carries the builder's reason", async () => {
    const invoice = await submitTestInvoice(as.prestige);
    await rejectInvoice(as.godrej, invoice.id, { reason: "Duplicate of an invoice already paid." });
    const n = await db.notification.findFirstOrThrow({ where: { userId: as.prestige.userId, event: "invoice.rejected", link: `/partner/invoices/${invoice.id}` } });
    expect(n.body).toBe("Reason: Duplicate of an invoice already paid.");
    expect(await db.notification.count({ where: { userId: as.godrej.userId, event: "invoice.rejected" } })).toBe(0);
  });

  it("writes nothing when the business transaction rolls back", async () => {
    const before = await db.notification.count();
    await expect(
      db.$transaction(async (tx) => {
        await notify(tx, { event: "invoice.submitted", recipients: [{ organisationId: as.godrej.orgId }], data: sampleInvoice() });
        throw new Error("rolled back");
      }),
    ).rejects.toThrow("rolled back");
    expect(await db.notification.count()).toBe(before);
  });

  it("is idempotent per dedupe key and skips inactive users", async () => {
    const data = sampleInvoice();
    const first = await db.$transaction((tx) => notify(tx, { event: "invoice.submitted", recipients: [{ organisationId: as.godrej.orgId }], data, dedupeKey: "test-dedupe-1" }));
    const second = await db.$transaction((tx) => notify(tx, { event: "invoice.submitted", recipients: [{ organisationId: as.godrej.orgId }], data, dedupeKey: "test-dedupe-1" }));
    expect(first.notifications).toBeGreaterThan(0);
    expect(second).toMatchObject({ notifications: 0, deliveries: 0 });

    await db.user.update({ where: { id: as.godrej.userId }, data: { status: "INACTIVE" } });
    try {
      const result = await db.$transaction((tx) => notify(tx, { event: "invoice.submitted", recipients: [{ userId: as.godrej.userId }], data }));
      expect(result.recipients).toBe(0);
    } finally {
      await db.user.update({ where: { id: as.godrej.userId }, data: { status: "ACTIVE" } });
    }
  });

  it("filters recipients by role", async () => {
    const result = await db.$transaction((tx) => notify(tx, { event: "invoice.submitted", recipients: [{ organisationId: as.godrej.orgId, roles: ["SUPER_ADMIN"] }], data: sampleInvoice() }));
    expect(result.recipients).toBe(0);
  });
});

describe("preferences", () => {
  beforeEach(() => resetPreferences(as.prestige.userId));

  it("default to in-app and email on, WhatsApp off", async () => {
    const settings = await getNotificationSettings(as.prestige.userId);
    expect(settings.preferences.invoices).toEqual({ IN_APP: true, EMAIL: true, WHATSAPP: false });
    expect(settings.whatsappOptedIn).toBe(false);
  });

  it("are honoured per channel and category", async () => {
    await db.$transaction((tx) => saveNotificationSettings(tx, as.prestige.userId, { preferences: { invoices: { EMAIL: false } } }));
    const invoice = await submitTestInvoice(as.prestige);
    await approveInvoice(as.godrej, invoice.id, {});
    const where = { userId: as.prestige.userId, event: "invoice.approved", data: { path: ["values", "invoiceId"], equals: invoice.id } };
    expect(await db.notificationDelivery.count({ where })).toBe(0);
    expect(await db.notification.count({ where: { userId: as.prestige.userId, event: "invoice.approved", link: `/partner/invoices/${invoice.id}` } })).toBe(1);
  });

  it("require a number and explicit consent before WhatsApp, and then queue WhatsApp deliveries", async () => {
    await expectDomainError(
      db.$transaction((tx) => saveNotificationSettings(tx, as.prestige.userId, { preferences: { invoices: { WHATSAPP: true } }, whatsappNumber: "+91 98765 43210" })),
      "VALIDATION",
      /consent/,
    );
    await expectDomainError(
      db.$transaction((tx) => saveNotificationSettings(tx, as.prestige.userId, { preferences: {}, whatsappNumber: "12345", whatsappConsent: true })),
      "VALIDATION",
      /country code/,
    );
    const saved = await db.$transaction((tx) =>
      saveNotificationSettings(tx, as.prestige.userId, { preferences: { invoices: { WHATSAPP: true } }, whatsappNumber: "98765 43210", whatsappConsent: true }),
    );
    expect(saved).toMatchObject({ whatsappNumber: "+919876543210", whatsappOptedIn: true });
    expect(saved.preferences.invoices.WHATSAPP).toBe(true);

    const invoice = await submitTestInvoice(as.prestige);
    await approveInvoice(as.godrej, invoice.id, {});
    const wa = await db.notificationDelivery.findFirstOrThrow({ where: { userId: as.prestige.userId, channel: "WHATSAPP", data: { path: ["values", "invoiceId"], equals: invoice.id } } });
    expect(wa).toMatchObject({ recipient: "+919876543210", event: "invoice.approved", status: "QUEUED" });

    await deliverWorker().drain();
    expect(whatsapp.sent.find((m) => m.template === "brickflow_invoice_approved")).toMatchObject({ to: "+919876543210", language: "en" });
    expect((await db.notificationDelivery.findUniqueOrThrow({ where: { id: wa.id } })).status).toBe("SENT");

    // Withdrawing consent switches WhatsApp off everywhere.
    const withdrawn = await db.$transaction((tx) => saveNotificationSettings(tx, as.prestige.userId, { preferences: { invoices: { WHATSAPP: true } }, whatsappNumber: "+919876543210", whatsappConsent: false }).catch((e: unknown) => e));
    expect(withdrawn).toMatchObject({ code: "VALIDATION" });
    const off = await db.$transaction((tx) => saveNotificationSettings(tx, as.prestige.userId, { preferences: {}, whatsappNumber: null, whatsappConsent: false }));
    expect(off.preferences.invoices.WHATSAPP).toBe(false);
  });
});

describe("delivery", () => {
  beforeEach(() => resetPreferences(as.prestige.userId, as.godrej.userId));

  it("sends queued email through the provider and records the provider message id", async () => {
    const invoice = await submitTestInvoice(as.prestige, { amount: "123456.78" });
    await deliverWorker().drain();
    const sent = email.sent.find((m) => m.subject.includes(invoice.invoiceNumber));
    expect(sent).toBeDefined();
    expect(sent!.to).toBe(as.godrej.email);
    expect(sent!.html).toContain("₹1,23,456.78");
    expect(sent!.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(sent!.headers?.["List-Unsubscribe"]).toMatch(/^<http:\/\/localhost:3000\/api\/notifications\/unsubscribe\?u=.+&c=invoices&t=.+>$/);
    expect(sent!.html).toContain("http://localhost:3000/builder/invoices/");

    const delivery = await db.notificationDelivery.findFirstOrThrow({ where: { userId: as.godrej.userId, data: { path: ["values", "invoiceId"], equals: invoice.id } } });
    expect(delivery).toMatchObject({ status: "SENT", provider: "smtp", attempts: 1, error: null });
    expect(delivery.providerMessageId).toMatch(/^ses-\d+$/);
    expect(sent!.messageId).toBe(`${delivery.id}@localhost`);

    // Running the same delivery again sends nothing.
    await db.job.updateMany({ where: { idempotencyKey: `delivery:${delivery.id}` }, data: { status: "PENDING", runAt: new Date() } });
    const before = email.sent.length;
    await deliverWorker().drain();
    expect(email.sent.length).toBe(before);
  });

  it("retries transient failures, then fails the delivery and dead-letters the job", async () => {
    const invoice = await submitTestInvoice(as.prestige);
    const delivery = await db.notificationDelivery.findFirstOrThrow({ where: { userId: as.godrej.userId, data: { path: ["values", "invoiceId"], equals: invoice.id } } });
    await db.job.updateMany({ where: { idempotencyKey: `delivery:${delivery.id}` }, data: { maxAttempts: 2 } });

    email.failWith = Object.assign(new Error("Connection timeout"), { permanent: false });
    await deliverWorker().drain();
    expect(await db.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).toMatchObject({ status: "QUEUED", attempts: 1, error: "Connection timeout" });
    const job = await db.job.findUniqueOrThrow({ where: { idempotencyKey: `delivery:${delivery.id}` } });
    expect(job.status).toBe("RETRY");

    await db.job.update({ where: { id: job.id }, data: { runAt: new Date() } });
    await deliverWorker().drain();
    expect(await db.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).toMatchObject({ status: "FAILED", attempts: 2 });
    expect((await db.job.findUniqueOrThrow({ where: { id: job.id } })).status).toBe("DEAD");

    // An operator retry after the outage sends it.
    email.failWith = null;
    await retryJob(as.admin, job.id);
    await deliverWorker().drain();
    expect(await db.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).toMatchObject({ status: "SENT", attempts: 3, error: null });
    expect(await auditActions(job.id)).toEqual(["job.retried"]);
  });

  it("does not retry permanent rejections", async () => {
    const invoice = await submitTestInvoice(as.prestige);
    const delivery = await db.notificationDelivery.findFirstOrThrow({ where: { userId: as.godrej.userId, data: { path: ["values", "invoiceId"], equals: invoice.id } } });
    email.failWith = Object.assign(new Error("550 Mailbox unavailable"), { permanent: true });
    await deliverWorker().drain();
    expect(await db.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).toMatchObject({ status: "FAILED", attempts: 1 });
    expect(await db.job.findUniqueOrThrow({ where: { idempotencyKey: `delivery:${delivery.id}` } })).toMatchObject({ status: "DEAD", attempts: 1 });
  });

  it("skips a queued delivery when the recipient switches the channel off before it is sent", async () => {
    const invoice = await submitTestInvoice(as.prestige);
    await db.$transaction((tx) => saveNotificationSettings(tx, as.godrej.userId, { preferences: { invoices: { EMAIL: false } } }));
    await deliverWorker().drain();
    const delivery = await db.notificationDelivery.findFirstOrThrow({ where: { userId: as.godrej.userId, data: { path: ["values", "invoiceId"], equals: invoice.id } } });
    expect(delivery).toMatchObject({ status: "SKIPPED", error: "Recipient switched this channel off" });
    expect(email.sent.some((m) => m.subject.includes(invoice.invoiceNumber))).toBe(false);
  });
});

describe("sendTemplatedEmail (password reset)", () => {
  it("queues, sends without an unsubscribe link and redacts the one-time link afterwards", async () => {
    const resetUrl = "http://localhost:3000/reset-password?token=one-time-secret";
    const { deliveryId, created } = await sendTemplatedEmail("Asha@Example.com", "password-reset", { name: "Asha", resetUrl, expiresInMinutes: 30 }, { idempotencyKey: "reset-1" });
    expect(created).toBe(true);
    const again = await sendTemplatedEmail("asha@example.com", "password-reset", { name: "Asha", resetUrl, expiresInMinutes: 30 }, { idempotencyKey: "reset-1" });
    expect(again).toEqual({ deliveryId, created: false });

    const queued = await db.notificationDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
    expect(queued).toMatchObject({ recipient: "asha@example.com", template: "password-reset", event: "account.password-reset", userId: null });
    const message = buildEmail(queued);
    expect(message.headers).toBeUndefined();
    expect(message.text).toContain(resetUrl);
    expect(message.html).toContain("Reset your password");

    await deliverWorker().drain();
    const sent = await db.notificationDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
    expect(sent.status).toBe("SENT");
    expect(JSON.stringify(sent.data)).not.toContain("one-time-secret");
    expect(email.sent.find((m) => m.to === "asha@example.com")!.text).toContain(resetUrl);
  });

  it("rejects links to another origin, bad addresses and invalid data", async () => {
    await expect(sendTemplatedEmail("a@example.com", "password-reset", { resetUrl: "https://evil.example.com/reset", expiresInMinutes: 30 })).rejects.toThrow(/APP_URL origin/);
    await expect(sendTemplatedEmail("not-an-email", "password-reset", { resetUrl: "http://localhost:3000/r", expiresInMinutes: 30 })).rejects.toThrow();
    await expect(sendTemplatedEmail("a@example.com", "password-reset", { resetUrl: "http://localhost:3000/r", expiresInMinutes: 0 })).rejects.toThrow();
  });

  it("takes part in the caller's transaction", async () => {
    await expect(
      db.$transaction(async (tx) => {
        await sendTemplatedEmail("rollback@example.com", "password-reset", { resetUrl: "http://localhost:3000/r", expiresInMinutes: 10 }, { tx });
        throw new Error("abort");
      }),
    ).rejects.toThrow("abort");
    expect(await db.notificationDelivery.count({ where: { recipient: "rollback@example.com" } })).toBe(0);
  });
});

describe("timed reminders", () => {
  it("schedules the offer-expiry reminder 24 hours before the offer lapses and sends it once", async () => {
    const invoice = await submitTestInvoice(as.prestige);
    await approveInvoice(as.godrej, invoice.id, {});
    const offer = await generateOffer(as.prestige, invoice.id);
    const job = await db.job.findUniqueOrThrow({ where: { idempotencyKey: `offer-expiring:${offer.id}` } });
    expect(job.type).toBe(NOTIFICATION_JOBS.offerExpiring);
    expect(job.runAt.getTime()).toBe(offer.validUntil.getTime() - 24 * 60 * 60 * 1000);

    const at = new Date(job.runAt.getTime() + 1000);
    expect(await runOfferExpiringReminder(offer.id, at)).toBe(true);
    await runOfferExpiringReminder(offer.id, at);
    expect(await db.notification.count({ where: { userId: as.prestige.userId, event: "offer.expiring", dedupeKey: { startsWith: `offer-expiring:${offer.id}:` } } })).toBe(1);

    // Once accepted (or lapsed) nothing is sent.
    await acceptOffer(as.prestige, offer.id, { consent: true });
    expect(await runOfferExpiringReminder(offer.id, at)).toBe(false);
    expect(await runOfferExpiringReminder("missing-offer", at)).toBe(false);
  });

  it("walks a financed invoice to settlement reminders for the builder and the financier", async () => {
    const invoice = await submitTestInvoice(as.prestige, { dueDate: isoDate(2) });
    await approveInvoice(as.godrej, invoice.id, {});
    const offer = await generateOffer(as.prestige, invoice.id);
    const request = await acceptOffer(as.prestige, offer.id, { consent: true });
    expect(await db.notification.count({ where: { event: "offer.accepted", link: `/finance/requests/${request.id}` } })).toBeGreaterThan(0);

    await approveFinancingRequest(as.finance, request.id, {});
    expect(await db.notification.count({ where: { userId: as.prestige.userId, event: "financing.approved", link: `/partner/invoices/${invoice.id}` } })).toBe(1);
    await initiateDisbursement(as.finance, request.id);
    expect(await db.notification.count({ where: { userId: as.prestige.userId, event: "disbursement.initiated", link: "/partner/disbursements" } })).toBeGreaterThan(0);
    await completeDisbursement(as.finance, request.id);
    expect(await db.notification.count({ where: { userId: as.godrej.userId, event: "disbursement.completed", link: "/builder/settlements" } })).toBeGreaterThan(0);

    const first = await runSettlementReminders(new Date());
    expect(first.notified).toBeGreaterThanOrEqual(1);
    const settlement = await db.settlement.findUniqueOrThrow({ where: { requestId: request.id } });
    const dueSoon = await db.notification.findMany({ where: { event: "settlement.due_soon", dedupeKey: { startsWith: `settlement-due-soon:${settlement.id}:` } } });
    const recipients = new Set(dueSoon.map((n) => n.userId));
    expect(recipients.has(as.godrej.userId)).toBe(true);
    expect(recipients.has(as.finance.userId)).toBe(true);

    await runSettlementReminders(new Date());
    expect(await db.notification.count({ where: { event: "settlement.due_soon", dedupeKey: { startsWith: `settlement-due-soon:${settlement.id}:` } } })).toBe(dueSoon.length);
  });
});

describe("in-app inbox", () => {
  it("counts unread and only lets the owner mark notifications read", async () => {
    const before = await getInboxSummary(as.prestige.userId);
    const invoice = await submitTestInvoice(as.prestige);
    await approveInvoice(as.godrej, invoice.id, {});
    const summary = await getInboxSummary(as.prestige.userId);
    expect(summary.unread).toBe(before.unread + 1);
    const newest = summary.items[0]!;
    expect(newest).toMatchObject({ event: "invoice.approved", read: false });

    expect(await markNotificationsRead(as.godrej.userId, [newest.id])).toBe(0);
    expect(await markNotificationsRead(as.prestige.userId, [newest.id])).toBe(1);
    expect(await markNotificationsRead(as.prestige.userId, [newest.id])).toBe(0);
    expect((await getInboxSummary(as.prestige.userId)).unread).toBe(before.unread);

    await markNotificationsRead(as.prestige.userId, "all");
    const page = await listNotifications(as.prestige.userId, { unreadOnly: true });
    expect(page).toMatchObject({ unread: 0, total: 0, items: [] });
  });
});

describe("WhatsApp delivery-status webhook", () => {
  const secret = "test-app-secret";
  beforeAll(() => {
    process.env.WHATSAPP_APP_SECRET = secret;
    process.env.WHATSAPP_VERIFY_TOKEN = "verify-me";
  });
  afterAll(() => {
    delete process.env.WHATSAPP_APP_SECRET;
    delete process.env.WHATSAPP_VERIFY_TOKEN;
  });

  function post(body: string, signature?: string) {
    return webhookPost(
      new NextRequest("http://localhost:3000/api/webhooks/whatsapp", {
        method: "POST",
        body,
        headers: { "Content-Type": "application/json", ...(signature ? { "X-Hub-Signature-256": signature } : {}) },
      }),
    );
  }
  const sign = (body: string) => `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
  const statusBody = (id: string, status: string, extra: object = {}) =>
    JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "WABA", changes: [{ field: "messages", value: { statuses: [{ id, status, timestamp: "1762400000", recipient_id: "919876543210", ...extra }] } }] }] });

  it("answers the subscription handshake", async () => {
    const ok = await webhookGet(new NextRequest("http://localhost:3000/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42"));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("42");
    const bad = await webhookGet(new NextRequest("http://localhost:3000/api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=42"));
    expect(bad.status).toBe(403);
  });

  it("rejects unsigned or tampered callbacks and applies signed ones, moving forward only", async () => {
    const delivery = await db.notificationDelivery.create({
      data: { channel: "WHATSAPP", event: "invoice.approved", template: "invoice.approved", recipient: "+919876543210", data: {}, status: "SENT", providerMessageId: `wamid.hook.${Date.now()}` },
    });
    const id = delivery.providerMessageId!;

    expect((await post(statusBody(id, "delivered"))).status).toBe(401);
    expect((await post(statusBody(id, "delivered"), sign(statusBody(id, "read")))).status).toBe(401);
    expect((await db.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).status).toBe("SENT");

    const read = statusBody(id, "read");
    const response = await post(read, sign(read));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, updated: 1 });
    const afterRead = await db.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
    expect(afterRead.status).toBe("READ");
    expect(afterRead.readAt?.toISOString()).toBe(new Date(1762400000 * 1000).toISOString());

    const late = statusBody(id, "delivered");
    expect(await (await post(late, sign(late))).json()).toEqual({ received: true, updated: 0 });
    expect((await db.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).status).toBe("READ");
  });

  it("records failures reported by WhatsApp", async () => {
    const delivery = await db.notificationDelivery.create({
      data: { channel: "WHATSAPP", event: "invoice.approved", template: "invoice.approved", recipient: "+919876543210", data: {}, status: "SENT", providerMessageId: `wamid.fail.${Date.now()}` },
    });
    const body = statusBody(delivery.providerMessageId!, "failed", { errors: [{ code: 131026, title: "Message undeliverable", error_data: { details: "Recipient is not on WhatsApp" } }] });
    await post(body, sign(body));
    expect(await db.notificationDelivery.findUniqueOrThrow({ where: { id: delivery.id } })).toMatchObject({ status: "FAILED", error: "WhatsApp 131026 Recipient is not on WhatsApp" });
  });

  it("answers 413 to an oversize chunked body without buffering it, before checking the signature", async () => {
    let pulled = 0;
    let cancelled = false;
    const endless = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          pulled += 1;
          controller.enqueue(new Uint8Array(64 * 1024).fill(123));
        },
        cancel() {
          cancelled = true;
        },
      },
      { highWaterMark: 0 },
    );
    const response = await webhookPost(
      new NextRequest("http://localhost:3000/api/webhooks/whatsapp", {
        method: "POST",
        body: endless,
        headers: { "Content-Type": "application/json", "X-Hub-Signature-256": `sha256=${"0".repeat(64)}` },
        duplex: "half",
      } as ConstructorParameters<typeof NextRequest>[1]),
    );
    expect(response.status).toBe(413);
    expect(cancelled).toBe(true);
    expect(pulled).toBeLessThanOrEqual(18);
  });

  it("accepts a signed body just under the limit and rejects a bad signature on it", async () => {
    const padding = " ".repeat(1024 * 1024 - 200);
    const body = `{"object":"whatsapp_business_account","entry":[]}${padding}`;
    expect(body.length).toBeLessThan(1024 * 1024);
    expect((await post(body, sign(body))).status).toBe(200);
    expect((await post(body, sign(`${body}x`))).status).toBe(401);
  });

  it("returns 503 when no app secret is configured", async () => {
    delete process.env.WHATSAPP_APP_SECRET;
    try {
      expect((await post("{}", "sha256=00")).status).toBe(503);
    } finally {
      process.env.WHATSAPP_APP_SECRET = secret;
    }
  });
});

describe("unsubscribe link", () => {
  beforeEach(() => resetPreferences(as.prestige.userId));

  it("confirms on GET, switches off one category on POST and rejects forged links", async () => {
    const url = unsubscribeUrl("http://localhost:3000", as.prestige.userId, "offers");
    const page = await unsubscribeGet(new NextRequest(url));
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("<form method=\"post\"");
    expect((await getNotificationSettings(as.prestige.userId)).preferences.offers.EMAIL).toBe(true);

    const done = await unsubscribePost(new NextRequest(url, { method: "POST", body: "List-Unsubscribe=One-Click" }));
    expect(done.status).toBe(200);
    const settings = await getNotificationSettings(as.prestige.userId);
    expect(settings.preferences.offers.EMAIL).toBe(false);
    expect(settings.preferences.invoices.EMAIL).toBe(true);

    const forged = url.replace(/([?&]c=)offers/, "$1invoices");
    expect((await unsubscribePost(new NextRequest(forged, { method: "POST" }))).status).toBe(400);
    expect((await getNotificationSettings(as.prestige.userId)).preferences.invoices.EMAIL).toBe(true);
  });
});

describe("admin job operations", () => {
  it("are limited to super admins and audited", async () => {
    unregisterJobHandler("test.admin-op");
    registerJobHandler("test.admin-op", async () => undefined);
    const job = await db.job.create({ data: { type: "test.admin-op", payload: {}, status: "DEAD", attempts: 8, lastError: "x" } });
    await expectDomainError(retryJob(as.prestige, job.id), "FORBIDDEN");
    await expectDomainError(cancelQueuedJob(as.finance, job.id), "FORBIDDEN");
    await expectDomainError(listDeliveries(as.godrej), "FORBIDDEN");
    await expectDomainError(retryJob(as.admin, "missing"), "NOT_FOUND");

    await cancelQueuedJob(as.admin, job.id);
    await expectDomainError(cancelQueuedJob(as.admin, job.id), "CONFLICT");
    await retryJob(as.admin, job.id);
    expect(await db.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: "PENDING", attempts: 0 });
    expect(await auditActions(job.id)).toEqual(["job.cancelled", "job.retried"]);
    await db.job.delete({ where: { id: job.id } });
    unregisterJobHandler("test.admin-op");
  });

  it("masks recipients in the delivery log", async () => {
    const { deliveries } = await listDeliveries(as.admin, { take: 50 });
    expect(deliveries.length).toBeGreaterThan(0);
    for (const d of deliveries) expect(d.recipient).toContain("•");
  });
});

function sampleInvoice() {
  return {
    invoiceId: "sample",
    invoiceNumber: "SAMPLE/1",
    invoiceReference: "BF-INV-SAMPLE",
    amountPaise: "100000",
    cpName: "Prestige",
    builderName: "Godrej",
    projectName: "Forest Hills",
  };
}
