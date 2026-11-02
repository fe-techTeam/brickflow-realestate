import { NextResponse } from "next/server";
import { toDateInputValue } from "@/lib/format";
import { formatBps, paiseToDecimalString } from "@/lib/money";
import { FINANCING_STATUS, INVOICE_STATUS, SETTLEMENT_STATUS } from "@/lib/status";
import { getActor } from "@/server/auth/session";
import { effectiveSettlementStatus } from "@/server/services/financing";
import { listInvoices, type InvoiceListItem } from "@/server/services/invoices";

const HEADERS = [
  "BrickFlow reference",
  "Invoice number",
  "Channel partner",
  "Project",
  "Project code",
  "Invoice date",
  "Due date",
  "Submitted at (IST)",
  "Decided at (IST)",
  "Invoice status",
  "Invoice amount (INR)",
  "GST amount (INR)",
  "Approved amount (INR)",
  "Financing status",
  "Financing request",
  "Discount rate",
  "Net paid to CP (INR)",
  "Disbursement reference (simulated)",
  "Settlement status",
  "Settlement due date",
  "Settled on",
];

const dateTime = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Asia/Kolkata",
});

function formatDateTimeCell(value: Date | null): string {
  return value ? dateTime.format(value).replace(",", "") : "";
}

/**
 * RFC 4180 escaping. Text cells that a spreadsheet would evaluate as a formula (=, +, -, @, tab, CR)
 * are prefixed with an apostrophe to prevent CSV injection.
 */
function csvCell(value: string | number | null | undefined, { text = true } = {}): string {
  if (value === null || value === undefined) return "";
  let out = String(value);
  if (text && /^[=+\-@\t\r]/.test(out)) out = `'${out}`;
  return /[",\r\n]/.test(out) ? `"${out.replace(/"/g, '""')}"` : out;
}

const money = (paise: bigint | null | undefined) => csvCell(paise === null || paise === undefined ? "" : paiseToDecimalString(paise), { text: false });

function row(invoice: InvoiceListItem): string {
  const request = invoice.financingRequest;
  const settlement = request?.settlement ?? null;
  return [
    csvCell(invoice.reference),
    csvCell(invoice.invoiceNumber),
    csvCell(invoice.cp.name),
    csvCell(invoice.project.name),
    csvCell(invoice.project.code),
    csvCell(toDateInputValue(invoice.invoiceDate)),
    csvCell(toDateInputValue(invoice.dueDate)),
    csvCell(formatDateTimeCell(invoice.submittedAt)),
    csvCell(formatDateTimeCell(invoice.decidedAt)),
    csvCell(INVOICE_STATUS[invoice.status].label),
    money(invoice.amountPaise),
    money(invoice.gstAmountPaise),
    money(invoice.approvedAmountPaise),
    csvCell(FINANCING_STATUS[invoice.financingStatus].label),
    csvCell(request?.reference),
    csvCell(request ? formatBps(request.discountRateBps) : ""),
    money(request?.netPayablePaise),
    csvCell(request?.disbursement?.reference),
    csvCell(settlement ? SETTLEMENT_STATUS[effectiveSettlementStatus(settlement)].label : ""),
    csvCell(settlement ? toDateInputValue(settlement.dueDate) : ""),
    csvCell(settlement?.settledAt ? toDateInputValue(settlement.settledAt) : ""),
  ].join(",");
}

export async function GET() {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  if (actor.orgType !== "BUILDER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const invoices = await listInvoices(actor);
    const body = `﻿${[HEADERS.map((h) => csvCell(h)).join(","), ...invoices.map(row)].join("\r\n")}\r\n`;
    const fileName = `brickflow-invoices-${toDateInputValue(new Date())}.csv`;
    return new NextResponse(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${fileName}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[reports] invoice export failed", error);
    return NextResponse.json({ error: "Export failed" }, { status: 500 });
  }
}
