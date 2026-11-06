"use client";

import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowDownToLine, ArrowRight, BadgeCheck, Check, CircleCheck, Landmark, Loader2, ShieldCheck, XCircle } from "lucide-react";
import { toast } from "sonner";
import { ActionDialog } from "@/components/common/action-dialog";
import { DemoBadge } from "@/components/common/status-badge";
import { useIdempotencyKey } from "@/components/common/use-idempotency-key";
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
    <dl className="overflow-hidden rounded-lg border border-border bg-glass/50">
      {rows.map((row) => (
        <div
          key={row.label}
          className={cn(
            "flex items-baseline justify-between gap-4 px-4 py-2.5",
            row.strong ? "border-t border-line-strong/30 bg-card py-3.5" : "border-t border-border/50 first:border-t-0",
          )}
        >
          <dt className={cn("text-xs", row.strong ? "font-semibold tracking-[0.12em] text-fg uppercase" : "text-muted-foreground")}>{row.label}</dt>
          <dd className={cn("tabular text-right text-sm text-fg", row.strong && "text-[1.375rem] font-light tracking-[-0.01em] text-leaf")}>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function AdviceSeal() {
  return (
    <span className="pointer-events-none absolute -top-3 -right-2 inline-flex size-[4.5rem] -rotate-12 text-fg-muted/90" aria-hidden="true">
      <svg viewBox="0 0 120 120" className="size-full">
        <defs>
          <path id="bf-dialog-seal" d="M60,60 m-44,0 a44,44 0 1,1 88,0 a44,44 0 1,1 -88,0" />
        </defs>
        <circle cx="60" cy="60" r="57" fill="rgba(255,255,255,0.04)" stroke="currentColor" strokeWidth="1.6" />
        <circle cx="60" cy="60" r="52" fill="none" stroke="currentColor" strokeWidth="0.6" />
        <circle cx="60" cy="60" r="33" fill="none" stroke="currentColor" strokeWidth="0.8" />
        <text fill="currentColor" style={{ fontSize: 9.5, letterSpacing: "0.22em", fontWeight: 600 }}>
          <textPath href="#bf-dialog-seal">DEMO RAIL · NO FUNDS MOVED · BRICKFLOW ·</textPath>
        </text>
        <text x="60" y="64" textAnchor="middle" fill="currentColor" style={{ fontSize: 10.5, letterSpacing: "0.14em", fontWeight: 700 }}>
          PAYOUT
        </text>
      </svg>
    </span>
  );
}

/** Banking-style payment advice: from, to and amount. */
function TransferAdvice({
  beneficiaryName,
  bankName,
  account,
  ifsc,
  amountPaise,
  reference,
}: {
  beneficiaryName: string;
  bankName?: string | null;
  account?: string;
  ifsc?: string;
  amountPaise: string;
  reference?: string;
}) {
  return (
    <div className="relative rounded-xl border border-border bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.05))] p-5">
      <AdviceSeal />
      <p className="text-[0.625rem] font-semibold tracking-[0.2em] text-fg-muted uppercase">Payment advice{reference ? ` · ${reference}` : ""}</p>
      <div className="mt-4 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-3 text-xs">
        <div className="min-w-0">
          <p className="text-muted-foreground">From</p>
          <p className="mt-1 font-medium text-fg">Veefin Finance</p>
          <p className="text-muted-foreground">Disbursement pool (demo)</p>
        </div>
        <ArrowRight className="mt-5 size-4 text-fg-muted" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-muted-foreground">To</p>
          <p className="mt-1 truncate font-medium text-fg">{beneficiaryName}</p>
          {bankName !== undefined && <p className="truncate text-muted-foreground">{bankName ?? "—"}</p>}
          {account && (
            <p className="tabular text-muted-foreground">
              {account}
              {ifsc ? ` · ${ifsc}` : ""}
            </p>
          )}
        </div>
      </div>
      <div className="mt-5 flex items-baseline justify-between gap-4 border-t border-dashed border-line-strong/40 pt-4">
        <span className="text-[0.625rem] font-semibold tracking-[0.18em] text-muted-foreground uppercase">Amount</span>
        <span className="tabular text-[1.75rem] leading-none font-light tracking-[-0.02em] text-leaf">{formatINR(amountPaise)}</span>
      </div>
    </div>
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
  const idempotencyKey = useIdempotencyKey();
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
      action={(input: { note?: string }) => approveFinancingRequestAction(summary.requestId, { ...input, idempotencyKey: idempotencyKey() })}
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
  const idempotencyKey = useIdempotencyKey();
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
      action={(input: { reason: string }) => rejectFinancingRequestAction(summary.requestId, { ...input, idempotencyKey: idempotencyKey() })}
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
  const idempotencyKey = useIdempotencyKey();

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await initiateDisbursementAction(summary.requestId, { idempotencyKey: idempotencyKey() });
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      toast.success("Disbursement initiated", { description: `Payment reference ${result.data.reference}` });
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
        <Button variant="accent" size={size} className={cn("font-semibold", className)}>
          <ArrowDownToLine className="size-4" />
          Initiate disbursement
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle className="font-display text-2xl font-normal text-fg">Initiate disbursement</DialogTitle>
            <DemoBadge />
          </div>
          <DialogDescription className="text-sm leading-relaxed">
            Books a payout instruction for {summary.reference}. 
          </DialogDescription>
        </DialogHeader>
        <TransferAdvice
          beneficiaryName={summary.beneficiaryName}
          bankName={summary.bankName}
          account={summary.beneficiaryAccount}
          ifsc={summary.beneficiaryIfsc}
          amountPaise={summary.netPayablePaise}
          reference={summary.reference}
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
          <Button variant="accent" onClick={confirm} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            Initiate payout
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const TRANSFER_STEPS = ["Payout instruction validated", "Transfer submitted on the demo rail", "Bank acknowledgement and UTR received"] as const;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Step 2 of the payout, with a short staged progress visual before the server confirms. */
export function ConfirmTransferButton({
  requestId,
  paymentReference,
  amountPaise,
  beneficiaryName,
  size = "default",
}: {
  requestId: string;
  paymentReference: string;
  amountPaise: string;
  beneficiaryName?: string;
  size?: Size;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(-1);
  const [error, setError] = useState<string | null>(null);
  const processing = step >= 0;
  const idempotencyKey = useIdempotencyKey();

  async function run() {
    setError(null);
    setStep(0);
    await wait(650);
    setStep(1);
    await wait(650);
    setStep(2);
    const result = await completeDisbursementAction(requestId, { idempotencyKey: idempotencyKey() });
    if (!result.ok) {
      setStep(-1);
      setError(result.error);
      toast.error(result.error);
      return;
    }
    setStep(3);
    toast.success(result.message ?? "Transfer confirmed.");
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
          Confirm transfer
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg" showCloseButton={!processing}>
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle className="font-display text-2xl font-normal text-fg">Confirm transfer</DialogTitle>
            <DemoBadge />
          </div>
          <DialogDescription className="text-sm leading-relaxed">
            Confirms payout {paymentReference} of <span className="tabular font-medium text-fg">{formatINR(amountPaise)}</span>, generates a demo UTR and
            opens the builder settlement.
          </DialogDescription>
        </DialogHeader>
        {beneficiaryName && <TransferAdvice beneficiaryName={beneficiaryName} amountPaise={amountPaise} reference={paymentReference} />}
        <ol className="rounded-lg border border-border/80 bg-card px-4 py-1.5" aria-live="polite">
          {TRANSFER_STEPS.map((label, index) => {
            const done = step > index;
            const active = step === index;
            return (
              <li key={label} className="relative flex items-center gap-3 py-2.5 text-sm">
                {index < TRANSFER_STEPS.length - 1 && (
                  <span aria-hidden="true" className={cn("absolute top-[2.1rem] -bottom-2.5 left-3 w-px", done ? "bg-leaf/60" : "bg-border")} />
                )}
                <span
                  className={cn(
                    "relative flex size-6 shrink-0 items-center justify-center rounded-full ring-1 transition-colors duration-300",
                    done ? "bg-leaf text-white ring-leaf" : active ? "bg-night text-fg-muted ring-line-strong" : "bg-card text-muted-foreground ring-border",
                  )}
                >
                  {active && <span aria-hidden="true" className="absolute inset-0 animate-ping rounded-full bg-night/25" />}
                  {done ? <Check className="size-3.5" /> : active ? <Loader2 className="size-3.5 animate-spin" /> : <span className="tabular text-[0.625rem] font-semibold">{index + 1}</span>}
                </span>
                <span className={cn("flex-1 transition-colors", done ? "text-leaf" : active ? "font-medium text-fg" : "text-muted-foreground")}>{label}</span>
                <span className="text-[0.625rem] font-semibold tracking-[0.16em] uppercase">
                  {done ? <span className="text-leaf">Done</span> : active ? <span className="text-fg-muted">Processing</span> : null}
                </span>
              </li>
            );
          })}
        </ol>
        {step === 3 && (
          <p className="flex items-center gap-2 text-sm font-medium text-leaf">
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
  const idempotencyKey = useIdempotencyKey();

  function submit(event: FormEvent) {
    event.preventDefault();
    if (reference.trim().length < 4) {
      setErrors({ reference: "Enter the settlement reference (at least 4 characters)." });
      return;
    }
    setErrors({});
    startTransition(async () => {
      const result = await markSettlementSettledAction(requestId, { reference: reference.trim(), note: note.trim() || undefined, idempotencyKey: idempotencyKey() });
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
            <DialogTitle className="font-display text-2xl font-normal text-fg">Record builder settlement</DialogTitle>
            <DialogDescription className="text-sm leading-relaxed">
              Confirm that {builderName} has paid <span className="tabular font-medium text-fg">{formatINR(amountPaise)}</span> against {requestReference}.
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
