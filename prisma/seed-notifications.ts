/**
 * Demo data for jobs and notifications: clears queued jobs, deliveries, preferences and in-app
 * notifications, then derives a realistic in-app inbox for every seeded user from the workflow state
 * the main seed created. Nothing is queued for email or WhatsApp.
 */
import type { NotificationEvent } from "../src/lib/notifications";
import { NOTIFICATION_EVENTS } from "../src/lib/notifications";
import { workspaceForOrgType } from "../src/lib/workspaces";
import type { PrismaClient, RoleKey } from "../src/generated/prisma/client";
import { renderNotification, type NotificationEventDataMap } from "../src/server/notifications/templates";

const DAY = 24 * 60 * 60 * 1000;
const READ_AFTER_DAYS = 3;

interface Draft<E extends NotificationEvent = NotificationEvent> {
  event: E;
  organisationId: string;
  roles: RoleKey[];
  data: NotificationEventDataMap[E];
  at: Date;
}

function draft<E extends NotificationEvent>(event: E, organisationId: string, roles: RoleKey[], data: NotificationEventDataMap[E], at: Date): Draft {
  return { event, organisationId, roles, data, at } as Draft;
}

export async function seedNotificationData(db: PrismaClient, now: Date): Promise<void> {
  await db.$transaction([
    db.notification.deleteMany(),
    db.notificationDelivery.deleteMany(),
    db.notificationPreference.deleteMany(),
    db.notificationProfile.deleteMany(),
    db.job.deleteMany(),
  ]);

  const invoices = await db.invoice.findMany({
    where: { status: { in: ["SUBMITTED", "UNDER_REVIEW", "CLARIFICATION_REQUESTED", "ACCEPTED", "REJECTED"] } },
    include: { cp: { select: { name: true } }, builder: { select: { name: true } }, project: { select: { name: true } } },
  });
  const drafts: Draft[] = [];
  for (const inv of invoices) {
    const data = {
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      invoiceReference: inv.reference,
      amountPaise: inv.amountPaise.toString(),
      approvedAmountPaise: inv.approvedAmountPaise?.toString() ?? null,
      cpName: inv.cp.name,
      builderName: inv.builder.name,
      projectName: inv.project.name,
      note: inv.latestReviewNote,
    };
    if (inv.status === "SUBMITTED" || inv.status === "UNDER_REVIEW") drafts.push(draft("invoice.submitted", inv.builderId, ["BUILDER_ACCOUNTS"], data, inv.submittedAt ?? inv.createdAt));
    if (inv.status === "CLARIFICATION_REQUESTED") drafts.push(draft("invoice.clarification_requested", inv.cpId, ["CP_ADMIN"], data, inv.updatedAt));
    if (inv.status === "REJECTED") drafts.push(draft("invoice.rejected", inv.cpId, ["CP_ADMIN"], data, inv.decidedAt ?? inv.updatedAt));
    if (inv.status === "ACCEPTED" && inv.financingStatus === "NOT_REQUESTED") drafts.push(draft("invoice.approved", inv.cpId, ["CP_ADMIN"], data, inv.decidedAt ?? inv.updatedAt));
  }

  const requests = await db.financingRequest.findMany({
    include: {
      invoice: { select: { id: true, invoiceNumber: true } },
      offer: { select: { reference: true } },
      cp: { select: { name: true } },
      builder: { select: { name: true } },
      financier: { select: { name: true } },
      disbursement: true,
      settlement: true,
    },
  });
  for (const r of requests) {
    const base = { requestId: r.id, requestReference: r.reference, invoiceId: r.invoice.id, invoiceNumber: r.invoice.invoiceNumber, cpName: r.cp.name, builderName: r.builder.name };
    if (r.status === "PENDING_APPROVAL") {
      drafts.push(draft("offer.accepted", r.financierId, ["FINANCE_OPS"], { ...base, offerReference: r.offer.reference, netPayablePaise: r.netPayablePaise.toString() }, r.acceptedAt));
    }
    if (r.status === "APPROVED" && r.decidedAt) {
      drafts.push(
        draft("financing.approved", r.cpId, ["CP_ADMIN"], { ...base, netPayablePaise: r.netPayablePaise.toString(), financierName: r.financier.name, note: r.decisionNote }, r.decidedAt),
      );
    }
    if (r.disbursement?.status === "SUCCESS" && r.disbursement.completedAt) {
      drafts.push(
        draft(
          "disbursement.completed",
          r.cpId,
          ["CP_ADMIN"],
          { ...base, paymentReference: r.disbursement.reference, amountPaise: r.disbursement.amountPaise.toString(), utr: r.disbursement.utr },
          r.disbursement.completedAt,
        ),
      );
    }
    const s = r.settlement;
    if (s && s.status !== "SETTLED") {
      const days = Math.round((Date.UTC(s.dueDate.getUTCFullYear(), s.dueDate.getUTCMonth(), s.dueDate.getUTCDate()) - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) / DAY);
      const data = {
        settlementId: s.id,
        requestId: r.id,
        requestReference: r.reference,
        invoiceId: r.invoice.id,
        invoiceNumber: r.invoice.invoiceNumber,
        amountPaise: s.amountPaise.toString(),
        dueDate: s.dueDate.toISOString().slice(0, 10),
        builderName: r.builder.name,
        financierName: r.financier.name,
        cpName: r.cp.name,
      };
      if (days < 0) drafts.push(draft("settlement.overdue", r.builderId, ["BUILDER_ACCOUNTS"], { ...data, daysOverdue: -days }, new Date(now.getTime() - 2 * 60 * 60 * 1000)));
      else if (days <= 3) drafts.push(draft("settlement.due_soon", r.builderId, ["BUILDER_ACCOUNTS"], { ...data, daysUntilDue: Math.max(days, 1) }, new Date(now.getTime() - 3 * 60 * 60 * 1000)));
    }
  }

  const memberships = await db.organisationUser.findMany({ include: { role: true, organisation: { select: { type: true } } } });
  const rows = drafts.flatMap((d) =>
    memberships
      .filter((m) => m.organisationId === d.organisationId && d.roles.includes(m.role.key))
      .map((m) => {
        const rendered = renderNotification(d.event, d.data as never, { workspace: workspaceForOrgType(m.organisation.type).key });
        const at = d.at.getTime() > now.getTime() ? now : d.at;
        return {
          userId: m.userId,
          organisationId: m.organisationId,
          event: d.event,
          category: NOTIFICATION_EVENTS[d.event].category,
          title: rendered.title,
          body: rendered.body,
          link: rendered.path,
          readAt: now.getTime() - at.getTime() > READ_AFTER_DAYS * DAY ? at : null,
          createdAt: at,
        };
      }),
  );
  if (rows.length) await db.notification.createMany({ data: rows });
}
