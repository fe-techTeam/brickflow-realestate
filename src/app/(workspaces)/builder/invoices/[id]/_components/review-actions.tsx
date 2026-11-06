"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Eye, Loader2, MessageSquareText, XCircle } from "lucide-react";
import { toast } from "sonner";
import { ActionDialog } from "@/components/common/action-dialog";
import { Button } from "@/components/ui/button";
import type { InvoiceStatus } from "@/generated/prisma/enums";
import { formatINR } from "@/lib/money";
import { markUnderReviewAction, rejectInvoiceAction, requestClarificationAction } from "@/server/actions/invoices";
import { ApproveDialog } from "./approve-dialog";
import { MatchChecklist, type MatchChecklistItem } from "./match-checklist";

/** Decision controls for an invoice awaiting the builder (SUBMITTED or UNDER_REVIEW). */
export function ReviewActions({
  invoiceId,
  invoiceNumber,
  cpName,
  amountPaise,
  status,
  matchItems,
  matchRequired,
  openDuplicates,
}: {
  invoiceId: string;
  invoiceNumber: string;
  cpName: string;
  amountPaise: string;
  status: Extract<InvoiceStatus, "SUBMITTED" | "UNDER_REVIEW">;
  matchItems: MatchChecklistItem[];
  matchRequired: boolean;
  openDuplicates: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [matchError, setMatchError] = useState<string | null>(null);
  const complete = matchItems.every((item) => ticked.has(item.key));

  function toggle(key: string, checked: boolean) {
    setMatchError(null);
    setTicked((current) => {
      const next = new Set(current);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  }

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
    <div className="grid gap-3">
      <div className="mb-3">
        <MatchChecklist items={matchItems} ticked={ticked} onToggle={toggle} required={matchRequired} error={matchError} />
      </div>
      <ApproveDialog
        invoiceId={invoiceId}
        invoiceNumber={invoiceNumber}
        cpName={cpName}
        amountPaise={amountPaise}
        attestations={matchItems.filter((item) => ticked.has(item.key)).map((item) => item.key)}
        blocked={matchRequired && !complete ? "Tick every three-way match item to approve." : null}
        onBlocked={setMatchError}
        openDuplicates={openDuplicates}
      />
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 [&_button]:h-10 [&_button]:w-full">
        <ActionDialog
          trigger="Request clarification"
          triggerVariant="outline"
          triggerIcon={<MessageSquareText className="size-4 text-[#ffb36b]" />}
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
          trigger="Reject"
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
      {status === "SUBMITTED" && (
        <div className="mt-2 flex items-center justify-between gap-3 border-t border-dashed border-[rgba(255,255,255,0.1)] pt-4">
          <p className="text-[0.75rem] leading-snug text-muted-foreground">Let {cpName} know you have started reviewing.</p>
          <Button variant="ghost" size="sm" className="shrink-0 text-fg" onClick={markUnderReview} disabled={pending}>
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Eye className="size-3.5" />}
            Mark under review
          </Button>
        </div>
      )}
    </div>
  );
}
