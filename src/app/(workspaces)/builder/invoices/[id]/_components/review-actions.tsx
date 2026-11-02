"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, Loader2, MessageSquareWarning, XCircle } from "lucide-react";
import { toast } from "sonner";
import { ActionDialog } from "@/components/common/action-dialog";
import { Button } from "@/components/ui/button";
import type { InvoiceStatus } from "@/generated/prisma/enums";
import { formatINR } from "@/lib/money";
import { markUnderReviewAction, rejectInvoiceAction, requestClarificationAction } from "@/server/actions/invoices";
import { ApproveDialog } from "./approve-dialog";

/** Decision controls for an invoice awaiting the builder (SUBMITTED or UNDER_REVIEW). */
export function ReviewActions({
  invoiceId,
  invoiceNumber,
  cpName,
  amountPaise,
  status,
}: {
  invoiceId: string;
  invoiceNumber: string;
  cpName: string;
  amountPaise: string;
  status: Extract<InvoiceStatus, "SUBMITTED" | "UNDER_REVIEW">;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function markUnderReview() {
    startTransition(async () => {
      const result = await markUnderReviewAction(invoiceId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? "Invoice marked as under review.");
      router.refresh();
    });
  }

  return (
    <div className="grid gap-2.5">
      {status === "SUBMITTED" && (
        <Button variant="outline" className="w-full" onClick={markUnderReview} disabled={pending}>
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}
          Mark under review
        </Button>
      )}
      <ApproveDialog invoiceId={invoiceId} invoiceNumber={invoiceNumber} cpName={cpName} amountPaise={amountPaise} />
      <div className="grid gap-2.5 [&_button]:w-full">
        <ActionDialog
          trigger="Request clarification"
          triggerVariant="secondary"
          triggerIcon={<MessageSquareWarning className="size-4" />}
          title="Request clarification"
          description={
            <>
              {invoiceNumber} will be returned to {cpName} with your message. It comes back to your inbox once they respond, optionally with a corrected PDF.
            </>
          }
          confirmLabel="Send request"
          field={{
            name: "reason",
            label: "What needs clarifying?",
            placeholder: "e.g. Please attach the registered agreement for unit C-0811 and confirm the brokerage slab applied.",
            required: true,
            minLength: 10,
            hint: "Visible to the channel partner. At least 10 characters.",
          }}
          action={requestClarificationAction.bind(null, invoiceId)}
        />
        <ActionDialog
          trigger="Reject invoice"
          triggerVariant="destructive"
          triggerIcon={<XCircle className="size-4" />}
          title={`Reject ${invoiceNumber}`}
          description={
            <>
              Rejecting {formatINR(BigInt(amountPaise))} from {cpName} is final for this invoice; the partner would need to raise a fresh invoice. Use clarification
              instead if something can be corrected.
            </>
          }
          confirmLabel="Reject invoice"
          confirmVariant="destructive"
          field={{
            name: "reason",
            label: "Reason for rejection",
            placeholder: "e.g. Brokerage claimed on unit 1203, which was cancelled before registration.",
            required: true,
            minLength: 10,
            hint: "Visible to the channel partner. At least 10 characters.",
          }}
          action={rejectInvoiceAction.bind(null, invoiceId)}
        />
      </div>
    </div>
  );
}
