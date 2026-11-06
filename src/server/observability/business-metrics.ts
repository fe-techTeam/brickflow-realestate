import "server-only";
import { FinancingStatus, InvoiceStatus } from "@/generated/prisma/enums";
import { databasePoolStats, db } from "../db";
import { renderGauge } from "./metrics";

const INVOICE_APPROVAL_QUEUE: InvoiceStatus[] = ["SUBMITTED", "UNDER_REVIEW"];

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function ageSeconds(since: Date | null | undefined, now: Date): number {
  return since ? Math.max(0, Math.round((now.getTime() - since.getTime()) / 1000)) : 0;
}

/**
 * Business gauges computed from the database at scrape time. Every status is always emitted (zero when
 * empty) so dashboards and alerts never see a series disappear.
 */
export async function renderBusinessMetrics(now: Date = new Date()): Promise<string> {
  const [invoiceGroups, requestGroups, overdue, oldestInvoice, oldestRequest, lastCheck, head] = await Promise.all([
    db.invoice.groupBy({ by: ["status"], _count: { _all: true } }),
    db.financingRequest.groupBy({ by: ["status"], _count: { _all: true } }),
    // Same rule as settlementStatusFor(): overdue once the due date's UTC day has passed.
    db.settlement.aggregate({ where: { status: { not: "SETTLED" }, dueDate: { lt: startOfUtcDay(now) } }, _count: { _all: true }, _sum: { amountPaise: true } }),
    db.invoice.aggregate({ where: { status: { in: INVOICE_APPROVAL_QUEUE } }, _min: { submittedAt: true } }),
    db.financingRequest.aggregate({ where: { status: "PENDING_APPROVAL" }, _min: { acceptedAt: true } }),
    db.auditChainCheck.findFirst({ orderBy: { checkedAt: "desc" }, select: { status: true, checkedAt: true } }),
    db.auditLog.findFirst({ orderBy: { seq: "desc" }, select: { seq: true } }),
  ]);

  const invoiceCounts = new Map(invoiceGroups.map((g) => [g.status, g._count._all]));
  const requestCounts = new Map(requestGroups.map((g) => [g.status, g._count._all]));
  const blocks = [
    renderGauge(
      "brickflow_invoices",
      "Invoices by status.",
      Object.values(InvoiceStatus).map((status) => ({ labels: { status }, value: invoiceCounts.get(status) ?? 0 })),
    ),
    renderGauge(
      "brickflow_financing_requests",
      "Financing requests by status.",
      Object.values(FinancingStatus).map((status) => ({ labels: { status }, value: requestCounts.get(status) ?? 0 })),
    ),
    renderGauge("brickflow_settlements_overdue", "Unsettled builder settlements past their due date.", [{ value: overdue._count._all }]),
    renderGauge("brickflow_settlements_overdue_amount_paise", "Amount of overdue builder settlements, in paise.", [{ value: Number(overdue._sum.amountPaise ?? 0n) }]),
    renderGauge("brickflow_oldest_pending_approval_age_seconds", "Age of the oldest item waiting for approval (0 when the queue is empty).", [
      { labels: { queue: "invoice" }, value: ageSeconds(oldestInvoice._min.submittedAt, now) },
      { labels: { queue: "financing" }, value: ageSeconds(oldestRequest._min.acceptedAt, now) },
    ]),
    renderGauge("brickflow_audit_log_entries", "Entries in the audit chain (position of the head).", [{ value: Number(head?.seq ?? 0n) }]),
  ];
  if (lastCheck) {
    blocks.push(
      renderGauge("brickflow_audit_chain_intact", "1 when the latest audit chain verification passed, 0 when it found a broken link.", [
        { value: lastCheck.status === "BROKEN" ? 0 : 1 },
      ]),
      renderGauge("brickflow_audit_chain_last_check_timestamp_seconds", "Time of the latest audit chain verification.", [{ value: Math.floor(lastCheck.checkedAt.getTime() / 1000) }]),
    );
  }
  const pool = databasePoolStats();
  if (pool) {
    blocks.push(
      renderGauge("brickflow_db_pool_connections", "Database pool connections by state.", [
        { labels: { state: "total" }, value: pool.total },
        { labels: { state: "idle" }, value: pool.idle },
        { labels: { state: "waiting" }, value: pool.waiting },
      ]),
      renderGauge("brickflow_db_pool_max_connections", "Configured maximum size of the database pool.", [{ value: pool.max }]),
    );
  }
  return blocks.join("\n");
}
