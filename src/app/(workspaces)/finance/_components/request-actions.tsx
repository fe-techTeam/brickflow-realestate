"use client";

import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownToLine, BadgeCheck, Check, CircleCheck, Landmark, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { toast } from "sonner";
import { ActionDialog } from "@/components/common/action-dialog";
import { DemoBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { formatINR } from "@/lib/money";
import { cn } from "@/lib/utils";
import {
  approveFinancingRequestAction,
  completeDisbursementAction,
  initiateDisbursementAction,
  markSettlementSettledAction,
  rejectFinancingRequestAction,
} from "@/server/actions/financing";

type Size = "default" | "sm";

function SummaryRows({ rows }: { rows: { label: string; value: ReactNode; strong?: boolean }[] }) {
  return (
    <dl className="divide-y divide-border/70 rounded-lg border border-border bg-ivory/50 px-4">
      {rows.map((row) => (
        <div key={row.label} className="flex items-baseline justify-between gap-4 py-2.5">
          <dt className="text-xs text-muted-foreground">{row.label}</dt>
          <dd className={cn("tabular text-right text-sm text-navy", row.strong && "font-display text-xl font-semibold text-heritage")}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export interface RequestSummary {
  requestId: string;
  reference: string;
  cpName: string;
  builderName: string;
  invoiceNumber: string;
  approvedAmountPaise: string;
  discountLabel: string;
  netPayablePaise: string;
}

export function ApproveRequestButton({ summary, size = "default" }: { summary: RequestSummary; size?: Size }) {
  return (
    <ActionDialog
      trigger="Approve"
      triggerVariant="success"
      triggerSize={size}
      triggerIcon={<BadgeCheck className="size-4" />}
      title="Approve financing request"
      description={`Approve ${summary.reference} for early payment to ${summary.cpName}. The request moves to the disbursement queue.`}
      confirmLabel="Approve request"
      confirmVariant="success"
      field={{ name: "note", label: "Approval note", placeholder: "Optional — e.g. within programme limits; KYC on file.", hint: "Recorded on the request timeline and audit log." }}
      action={approveFinancingRequestAction.bind(null, summary.requestId)}
    >
      <SummaryRows
        rows={[
          { label: "Invoice", value: summary.invoiceNumber },
          { label: "Builder-approved amount", value: formatINR(summary.approvedAmountPaise) },
          { label: "Agreed discount", value: summary.discountLabel },
          { label: "Net payable to CP", value: formatINR(summary.netPayablePaise), strong: true },
        ]}
      />
    </ActionDialog>
  );
}

export function RejectRequestButton({ summary, size = "default" }: { summary: RequestSummary; size?: Size }) {
  return (
    <ActionDialog
      trigger="Reject"
      triggerVariant="destructive"
      triggerSize={size}
      triggerIcon={<XCircle className="size-4" />}
      title="Reject financing request"
      description={`Rejecting ${summary.reference} is final for invoice ${summary.invoiceNumber}. The channel partner and builder will see the decision.`}
      confirmLabel="Reject request"
      confirmVariant="destructive"
      field={{
        name: "reason",
        label: "Reason for rejection",
        required: true,
        minLength: 10,
        placeholder: "Explain the credit decision, e.g. exposure limit for the builder reached.",
      }}
      action={rejectFinancingRequestAction.bind(null, summary.requestId)}
    />
  );
}

export interface DisbursementSummary {
  requestId: string;
  reference: string;
  netPayablePaise: string;
  beneficiaryName: string;
  beneficiaryAccount: string;
  beneficiaryIfsc: string;
  bankName: string | null;
}

export function InitiateDisbursementButton({ summary, size = "default", className }: { summary: DisbursementSummary; size?: Size; className?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await initiateDisbursementAction(summary.requestId);
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Simulated disbursement initiated", { description: `Payment reference ${result.data.reference}` });
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        setError(null);
      }}>
      <DialogTrigger asChild>
        <Button variant="gold" size={size} className={cn("tracking-wide uppercase", className)}>
          <ArrowDownToLine className="size-4" />
          Initiate disbursement
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle className="font-display text-2xl font-semibold text-navy">Initiate disbursement</DialogTitle>
            <DemoBadge />
          </div>
          <DialogDescription className="text-sm leading-relaxed">
            Books a payout instruction for {summary.reference}. This is a <strong>simulated payout</strong> — no bank is contacted and no real funds
            move.
          </DialogDescription>
        </DialogHeader>
        <SummaryRows
          rows={[
            { label: "Beneficiary", value: summary.beneficiaryName },
            { label: "Bank", value: summary.bankName ?? "—" },
            { label: "Account", value: summary.beneficiaryAccount },
            { label: "IFSC", value: summary.beneficiaryIfsc },
            { label: "Amount", value: formatINR(summary.netPayablePaise), strong: true },
          ]}
        />
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={pending}>
              Cancel
            </Button>
          </DialogClose>
          <Button variant="gold" onClick={confirm} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            Initiate simulated payout
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const TRANSFER_STEPS = ["Payout instruction validated", "Transfer submitted on the demo rail", "Bank acknowledgement and UTR received"] as const;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Step 2 of the simulated payout, with a short staged progress visual before the server confirms. */
export function ConfirmTransferButton({
  requestId,
  paymentReference,
  amountPaise,
  size = "default",
}: {
  requestId: string;
  paymentReference: string;
  amountPaise: string;
  size?: Size;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const processing = step >= 0;

  async function run() {
    setError(null);
    setStep(0);
    await wait(650);
    setStep(1);
    await wait(650);
    setStep(2);
    const result = await completeDisbursementAction(requestId);
    if (!result.ok) {
      setStep(-1);
      setError(result.error);
      toast.error(result.error);
      return;
    }
    setStep(3);
    toast.success(result.message ?? "Simulated transfer confirmed.");
    await wait(500);
    setOpen(false);
    setStep(-1);
    router.refresh();
  }

  return (
    <Dialog open={open} onOpenChange={(next) => {
        if (processing) return;
        setOpen(next);
        setError(null);
      }}>
      <DialogTrigger asChild>
        <Button size={size}>
          <ShieldCheck className="size-4" />
          Confirm simulated transfer
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg" showCloseButton={!processing}>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle className="font-display text-2xl font-semibold text-navy">Confirm simulated transfer</DialogTitle>
            <DemoBadge />
          </div>
          <DialogDescription className="text-sm leading-relaxed">
            Confirms payout {paymentReference} of <span className="tabular font-medium text-navy">{formatINR(amountPaise)}</span>, generates a demo UTR and
            opens the builder settlement. No real funds move.
          </DialogDescription>
        </DialogHeader>
        <ol className="space-y-3 rounded-lg border border-border bg-ivory/50 p-4" aria-live="polite">
          {TRANSFER_STEPS.map((label, index) => {
            const done = step > index;
            const active = step === index;
            return (
              <li key={label} className="flex items-center gap-3 text-sm">
                <span
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-full ring-1 transition-colors duration-300",
                    done ? "bg-heritage text-white ring-heritage" : active ? "bg-card text-navy ring-navy/30" : "bg-card text-muted-foreground ring-border",
                  )}
                >
                  {done ? <Check className="size-3.5" /> : active ? <Loader2 className="size-3.5 animate-spin" /> : <span className="text-[0.625rem] font-semibold">{index + 1}</span>}
                </span>
                <span className={cn("transition-colors", done ? "text-heritage" : active ? "font-medium text-navy" : "text-muted-foreground")}>{label}</span>
              </li>
            );
          })}
        </ol>
        {step === 3 && (
          <p className="flex items-center gap-2 text-sm font-medium text-heritage">
            <CircleCheck className="size-4" /> Transfer confirmed
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={processing}>
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={run} disabled={processing}>
            {processing && <Loader2 className="size-4 animate-spin" />}
            {processing ? "Processing…" : "Confirm transfer"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MarkSettledButton({
  requestId,
  requestReference,
  builderName,
  amountPaise,
  size = "default",
}: {
  requestId: string;
  requestReference: string;
  builderName: string;
  amountPaise: string;
  size?: Size;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [pending, startTransition] = useTransition();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (reference.trim().length < 4) {
      setErrors({ reference: "Enter the settlement reference (at least 4 characters)." });
      return;
    }
    setErrors({});
    startTransition(async () => {
      const result = await markSettlementSettledAction(requestId, { reference: reference.trim(), note: note.trim() || undefined });
      if (!result.ok) {
        setErrors({ reference: result.fieldErrors?.reference?.[0], note: result.fieldErrors?.note?.[0], form: result.error });
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? "Settlement recorded.");
      setOpen(false);
      setReference("");
      setNote("");
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        setErrors({});
      }}>
      <DialogTrigger asChild>
        <Button variant="success" size={size}>
          <Landmark className="size-4" />
          Mark settled
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form onSubmit={submit} className="grid gap-4" noValidate>
          <DialogHeader>
            <DialogTitle className="font-display text-2xl font-semibold text-navy">Record builder settlement</DialogTitle>
            <DialogDescription className="text-sm leading-relaxed">
              Confirm that {builderName} has paid <span className="tabular font-medium text-navy">{formatINR(amountPaise)}</span> against {requestReference}.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor={`settle-ref-${requestId}`}>
              Settlement reference<span className="text-destructive"> *</span>
            </Label>
            <Input
              id={`settle-ref-${requestId}`}
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g. NEFT / RTGS reference"
              maxLength={60}
              autoComplete="off"
              aria-invalid={Boolean(errors.reference)}
              aria-describedby={errors.reference ? `settle-ref-error-${requestId}` : undefined}
              disabled={pending}
              className="h-9"
            />
            {errors.reference && (
              <p id={`settle-ref-error-${requestId}`} className="text-xs text-destructive">
                {errors.reference}
              </p>
            )}
          </div>
          <div className="grid gap-2">
            <Label htmlFor={`settle-note-${requestId}`}>Note</Label>
            <Textarea
              id={`settle-note-${requestId}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional — e.g. received in full on the due date."
              rows={3}
              maxLength={500}
              disabled={pending}
            />
            {errors.note && <p className="text-xs text-destructive">{errors.note}</p>}
          </div>
          {errors.form && !errors.reference && (
            <p role="alert" className="text-sm text-destructive">
              {errors.form}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" variant="success" disabled={pending}>
              {pending && <Loader2 className="size-4 animate-spin" />}
              Record settlement
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
