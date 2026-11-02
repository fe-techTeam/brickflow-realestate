import { NextResponse, type NextRequest } from "next/server";
import { toDateInputValue } from "@/lib/format";
import { bpsToDecimalString, paiseToDecimalString } from "@/lib/money";
import { FINANCING_STATUS, SETTLEMENT_STATUS } from "@/lib/status";
import { getActor } from "@/server/auth/session";
import { listFinanceLedger, parseLedgerFilters } from "@/server/queries/finance";
import { listProgrammes } from "@/server/services/admin";

type Cell = string | number | null | undefined;

/**
 * RFC 4180 escaping. Text cells that a spreadsheet would evaluate as a formula
 * (leading = + - @ tab or CR) are prefixed with an apostrophe to prevent CSV injection.
 */
function csvCell(value: Cell): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvLine(cells: Cell[]): string {
  return cells.map(csvCell).join(",");
}

const iso = (date: Date | null | undefined) => (date ? date.toISOString() : null);

const HEADERS = [
  "Request reference",
  "Request status",
  "Requested at",
  "Channel partner",
  "Builder",
  "Programme",
  "Invoice number",
  "Invoice date",
  "Invoice due date",
  "Approved invoice amount (INR)",
  "Discount rate (%)",
  "Discount amount (INR)",
  "Other charges (INR)",
  "Net payable (INR)",
  "Decision at",
  "Decision note",
  "Payment reference (simulated)",
  "UTR (simulated)",
  "Disbursed at",
  "Disbursed amount (INR)",
  "Settlement status",
  "Settlement due date",
  "Settlement amount (INR)",
  "Settled at",
  "Settlement reference",
];

export async function GET(request: NextRequest) {
  const actor = await getActor();
  if (!actor) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });
  if (actor.orgType !== "FINANCIER") return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  try {
    const [rows, programmes] = await Promise.all([listFinanceLedger(actor, parseLedgerFilters(request.nextUrl.searchParams)), listProgrammes(actor)]);
    const programmeCodes = new Map(programmes.map((p) => [p.id, p.code]));
    const lines = [csvLine(HEADERS)];
    for (const { request: r, settlementStatus } of rows) {
      lines.push(
        csvLine([
          r.reference,
          FINANCING_STATUS[r.status].label,
          iso(r.createdAt),
          r.cp.name,
          r.builder.name,
          programmeCodes.get(r.programmeId),
          r.invoice.invoiceNumber,
          toDateInputValue(r.invoice.invoiceDate),
          toDateInputValue(r.invoice.dueDate),
          paiseToDecimalString(r.approvedAmountPaise),
          bpsToDecimalString(r.discountRateBps),
          paiseToDecimalString(r.discountAmountPaise),
          paiseToDecimalString(r.chargesPaise),
          paiseToDecimalString(r.netPayablePaise),
          iso(r.decidedAt),
          r.decisionNote,
          r.disbursement?.reference,
          r.disbursement?.utr,
          iso(r.disbursement?.completedAt),
          r.disbursement ? paiseToDecimalString(r.disbursement.amountPaise) : null,
          settlementStatus ? SETTLEMENT_STATUS[settlementStatus].label : null,
          toDateInputValue(r.settlement?.dueDate),
          r.settlement ? paiseToDecimalString(r.settlement.amountPaise) : null,
          iso(r.settlement?.settledAt),
          r.settlement?.reference,
        ]),
      );
    }

    const stamp = toDateInputValue(new Date());
    return new NextResponse(`﻿${lines.join("\r\n")}\r\n`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="veefin-financing-requests-${stamp}.csv"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[finance] CSV export failed", error);
    return NextResponse.json({ error: "Export unavailable" }, { status: 500 });
  }
}
