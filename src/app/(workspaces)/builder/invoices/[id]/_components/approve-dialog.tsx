"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatINR, paiseToDecimalString, parseRupeesToPaise } from "@/lib/money";
import { approveInvoiceAction } from "@/server/actions/invoices";

const COMMENT_LIMIT = 1000;

type AmountCheck = { ok: true; paise: bigint } | { ok: false; message: string };

function checkAmount(raw: string, invoicePaise: bigint): AmountCheck {
  if (!raw.trim()) return { ok: false, message: "Enter the amount you are approving." };
  const paise = parseRupeesToPaise(raw);
  if (paise === null) return { ok: false, message: "Enter a valid amount with up to 2 decimals." };
  if (paise <= 0n) return { ok: false, message: "The approved amount must be greater than zero." };
  if (paise > invoicePaise) return { ok: false, message: `Cannot exceed the invoice amount of ${formatINR(invoicePaise)}.` };
  return { ok: true, paise };
}

/** Approval with an editable approved amount (defaults to the invoice total, may be lower, never higher) and an optional comment. */
export function ApproveDialog({ invoiceId, invoiceNumber, cpName, amountPaise }: { invoiceId: string; invoiceNumber: string; cpName: string; amountPaise: string }) {
  const router = useRouter();
  const invoicePaise = BigInt(amountPaise);
  const fullAmount = paiseToDecimalString(invoicePaise);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(fullAmount);
  const [comment, setComment] = useState("");
  const [touched, setTouched] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const check = checkAmount(amount, invoicePaise);
  const amountError = touched && !check.ok ? check.message : serverError;
  const shortfall = check.ok ? invoicePaise - check.paise : 0n;

  function reset() {
    setAmount(fullAmount);
    setComment("");
    setTouched(false);
    setServerError(null);
  }

  function submit() {
    setTouched(true);
    setServerError(null);
    if (!check.ok) return;
    startTransition(async () => {
      const result = await approveInvoiceAction(invoiceId, { approvedAmount: paiseToDecimalString(check.paise), comment: comment.trim() || undefined });
      if (!result.ok) {
        setServerError(result.fieldErrors?.approvedAmount?.[0] ?? result.fieldErrors?.comment?.[0] ?? result.error);
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? "Invoice approved.");
      setOpen(false);
      reset();
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="success" className="w-full">
          <CheckCircle2 className="size-4" />
          Approve invoice
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-semibold text-navy">Approve {invoiceNumber}</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            Confirm the amount you accept as payable to {cpName}. Once approved, the partner may take early payment from Veefin on this amount; you settle it on the
            original due date.
          </DialogDescription>
        </DialogHeader>

        <form
          id="approve-invoice-form"
          className="grid gap-5"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <div className="flex items-baseline justify-between rounded-md bg-ivory px-4 py-3">
            <span className="text-xs text-muted-foreground">Invoice amount (incl. GST)</span>
            <span className="tabular font-display text-xl font-semibold text-navy">{formatINR(invoicePaise)}</span>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="approved-amount">
              Approved amount (₹)<span className="text-destructive"> *</span>
            </Label>
            <div className="flex gap-2">
              <Input
                id="approved-amount"
                inputMode="decimal"
                autoComplete="off"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setServerError(null);
                }}
                onBlur={() => setTouched(true)}
                aria-invalid={Boolean(amountError)}
                aria-describedby="approved-amount-hint"
                disabled={pending}
                className="tabular h-10 text-base"
              />
              {amount !== fullAmount && (
                <Button type="button" variant="outline" className="h-10" onClick={() => setAmount(fullAmount)} disabled={pending}>
                  Full amount
                </Button>
              )}
            </div>
            <p id="approved-amount-hint" role={amountError ? "alert" : undefined} className={amountError ? "text-sm text-destructive" : "text-xs text-muted-foreground"}>
              {amountError ??
                (check.ok && shortfall > 0n
                  ? `Partial approval: ${formatINR(shortfall)} less than invoiced. State the reason in the comment.`
                  : "Defaults to the full invoice amount. You may approve a lower amount, never a higher one.")}
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="approval-comment">Comment for the channel partner</Label>
            <Textarea
              id="approval-comment"
              rows={3}
              maxLength={COMMENT_LIMIT}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="e.g. Verified against the booking register and registered agreements."
              disabled={pending}
            />
            <p className="text-right text-[0.6875rem] text-muted-foreground tabular">
              Optional · {comment.length}/{COMMENT_LIMIT}
            </p>
          </div>
        </form>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={pending}>
              Cancel
            </Button>
          </DialogClose>
          <Button type="submit" form="approve-invoice-form" variant="success" disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {check.ok ? `Approve ${formatINR(check.paise)}` : "Approve"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
