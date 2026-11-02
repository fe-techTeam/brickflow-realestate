import "server-only";
import { formatBps } from "@/lib/money";
import type { Beneficiary } from "@/server/queries/finance";
import type { FinancingRequestListItem } from "@/server/services/financing";
import type { DisbursementSummary, RequestSummary } from "../_components/request-actions";

type SummarySource = Pick<
  FinancingRequestListItem,
  "id" | "reference" | "approvedAmountPaise" | "discountRateBps" | "netPayablePaise"
> & { cp: { name: string }; builder: { name: string }; invoice: { invoiceNumber: string } };

export function toRequestSummary(r: SummarySource): RequestSummary {
  return {
    requestId: r.id,
    reference: r.reference,
    cpName: r.cp.name,
    builderName: r.builder.name,
    invoiceNumber: r.invoice.invoiceNumber,
    approvedAmountPaise: r.approvedAmountPaise.toString(),
    discountLabel: formatBps(r.discountRateBps),
    netPayablePaise: r.netPayablePaise.toString(),
  };
}

export function toDisbursementSummary(r: SummarySource, beneficiary: Beneficiary | undefined): DisbursementSummary {
  return {
    requestId: r.id,
    reference: r.reference,
    netPayablePaise: r.netPayablePaise.toString(),
    beneficiaryName: beneficiary?.name ?? r.cp.name,
    beneficiaryAccount: beneficiary?.accountMasked ?? "—",
    beneficiaryIfsc: beneficiary?.ifsc ?? "DEMO0000001",
    bankName: beneficiary?.bankName ?? null,
  };
}
