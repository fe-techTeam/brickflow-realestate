"use client";

import { createContext, useCallback, useContext, useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowRight, BadgePercent, CalendarClock, Check, Landmark, Loader2, Lock, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { formatDateTime } from "@/lib/format";
import { formatBps } from "@/lib/money";
import { cn } from "@/lib/utils";
import { acceptOfferAction, generateOfferAction } from "@/server/actions/financing";
import type { OfferDto } from "@/server/dto";
import { Money } from "./money";

export interface OfferInvoiceSummary {
  id: string;
  invoiceNumber: string;
  builderName: string;
  projectName?: string;
}

interface OfferCenterValue {
  /** Generates (or reuses) the offer for an invoice and opens the review dialog. */
  launch: (invoice: OfferInvoiceSummary, existing?: OfferDto) => Promise<void>;
  pendingInvoiceId: string | null;
}

const OfferCenterContext = createContext<OfferCenterValue | null>(null);

type Phase = { kind: "review" } | { kind: "accepted"; reference: string };

/** Hosts the single offer dialog for the partner workspace so it survives route refreshes. */
export function OfferCenterProvider({ consentText, children }: { consentText: string; children: ReactNode }) {
  const router = useRouter();
  const [invoice, setInvoice] = useState<OfferInvoiceSummary | null>(null);
  const [offer, setOffer] = useState<OfferDto | null>(null);
  const [open, setOpen] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "review" });
  const [pendingInvoiceId, setPendingInvoiceId] = useState<string | null>(null);

  const launch = useCallback(async (target: OfferInvoiceSummary, existing?: OfferDto) => {
    setPhase({ kind: "review" });
    if (existing && existing.status === "OFFERED") {
      setInvoice(target);
      setOffer(existing);
      setOpen(true);
      return;
    }
    setPendingInvoiceId(target.id);
    try {
      const result = await generateOfferAction(target.id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      setInvoice(target);
      setOffer(result.data);
      setOpen(true);
    } finally {
      setPendingInvoiceId(null);
    }
  }, []);

  const value = useMemo(() => ({ launch, pendingInvoiceId }), [launch, pendingInvoiceId]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next && phase.kind === "accepted") router.refresh();
  }

  return (
    <OfferCenterContext.Provider value={value}>
      {children}
      {invoice && offer && (
        <OfferDialog
          open={open}
          onOpenChange={handleOpenChange}
          invoice={invoice}
          offer={offer}
          consentText={consentText}
          phase={phase}
          onOffer={(next) => {
            setOffer(next);
            setPhase({ kind: "review" });
          }}
          onAccepted={(reference) => setPhase({ kind: "accepted", reference })}
        />
      )}
    </OfferCenterContext.Provider>
  );
}

export function useOfferCenter(): OfferCenterValue {
  const value = useContext(OfferCenterContext);
  if (!value) throw new Error("useOfferCenter must be used inside OfferCenterProvider");
  return value;
}

/** "GET DISCOUNTED AMOUNT" call-to-action. Pass `offer` to reopen an existing open offer without regenerating it. */
export function OfferLauncher({
  invoice,
  offer,
  label = "Get discounted amount",
  variant = "gold",
  size = "sm",
  className,
}: {
  invoice: OfferInvoiceSummary;
  offer?: OfferDto;
  label?: string;
  variant?: "gold" | "default" | "outline" | "success";
  size?: "xs" | "sm" | "default" | "lg";
  className?: string;
}) {
  const { launch, pendingInvoiceId } = useOfferCenter();
  const busy = pendingInvoiceId === invoice.id;
  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      disabled={pendingInvoiceId !== null}
      onClick={() => void launch(invoice, offer)}
      className={cn(
        "font-semibold tracking-[0.08em] uppercase",
        variant === "gold" && "bg-linear-to-b from-[#d2b77f] to-gold text-navy shadow-[0_1px_0_rgba(255,255,255,0.35)_inset,0_8px_20px_-10px_rgba(169,138,82,0.8)] hover:from-gold hover:to-gold-600 hover:text-navy-900",
        size === "sm" && "text-[0.6875rem]",
        size === "lg" && "h-11 px-6 text-[0.75rem]",
        size === "xs" && "h-7 px-2.5 text-[0.625rem] tracking-[0.06em]",
        className,
      )}
      aria-label={`${label} for invoice ${invoice.invoiceNumber}`}
    >
      {busy ? <Loader2 className="animate-spin" /> : <BadgePercent />}
      {label}
    </Button>
  );
}

const STEPS = ["Review", "Confirm", "Submitted"] as const;

function StepIndicator({ current, tone = "light" }: { current: 1 | 2 | 3; tone?: "light" | "dark" }) {
  return (
    <ol className="flex items-center gap-2 sm:gap-3" aria-label="Early payment steps">
      {STEPS.map((label, i) => {
        const step = i + 1;
        const done = step < current || current === 3;
        const active = step === current && current !== 3;
        return (
          <li key={label} className="flex items-center gap-2 sm:gap-3" aria-current={active ? "step" : undefined}>
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  "flex size-6 items-center justify-center rounded-full text-[0.6875rem] font-semibold tabular transition-colors",
                  done && "bg-heritage text-white",
                  active && (tone === "dark" ? "bg-gold text-navy ring-4 ring-gold/20" : "bg-navy text-gold ring-4 ring-navy/10"),
                  !done && !active && (tone === "dark" ? "border border-white/25 text-white/50" : "border border-[#d9d2c2] text-muted-foreground"),
                )}
              >
                {done ? <Check className="size-3.5" strokeWidth={2.5} /> : step}
              </span>
              <span
                className={cn(
                  "text-[0.6875rem] font-semibold tracking-[0.14em] uppercase",
                  tone === "dark" ? (active || done ? "text-white" : "text-white/45") : active || done ? "text-navy" : "text-muted-foreground",
                  !active && "max-sm:sr-only",
                )}
              >
                {label}
              </span>
            </span>
            {step < STEPS.length && (
              <span aria-hidden="true" className={cn("h-px w-6 sm:w-10", tone === "dark" ? (done ? "bg-gold/70" : "bg-white/20") : done ? "bg-heritage/50" : "bg-[#d9d2c2]")} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function daysLeft(validUntil: string, now: number): string {
  const ms = new Date(validUntil).getTime() - now;
  if (ms <= 0) return "Expired";
  const hours = Math.floor(ms / 3_600_000);
  if (hours < 24) return `${Math.max(1, hours)} ${hours === 1 ? "hour" : "hours"} left`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? "day" : "days"} left`;
}

function OfferDialog({
  open,
  onOpenChange,
  invoice,
  offer,
  consentText,
  phase,
  onOffer,
  onAccepted,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: OfferInvoiceSummary;
  offer: OfferDto;
  consentText: string;
  phase: Phase;
  onOffer: (offer: OfferDto) => void;
  onAccepted: (reference: string) => void;
}) {
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<{ message: string; regenerate: boolean } | null>(null);
  const [accepting, startAccept] = useTransition();
  const [regenerating, startRegenerate] = useTransition();
  const [openedAt] = useState(() => Date.now());
  const busy = accepting || regenerating;

  function accept() {
    if (!consent) {
      setError({ message: "Please confirm the consent statement to continue.", regenerate: false });
      return;
    }
    setError(null);
    startAccept(async () => {
      const result = await acceptOfferAction(offer.id, { consent: true });
      if (!result.ok) {
        setError({ message: result.error, regenerate: /fresh offer/i.test(result.error) });
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? "Offer accepted.");
      onAccepted(result.data.reference);
    });
  }

  function regenerate() {
    setError(null);
    startRegenerate(async () => {
      const result = await generateOfferAction(invoice.id);
      if (!result.ok) {
        setError({ message: result.error, regenerate: false });
        toast.error(result.error);
        return;
      }
      setConsent(false);
      onOffer(result.data);
      toast.success(`Fresh offer ${result.data.reference} generated.`);
    });
  }

  const partial = offer.approvedAmountPaise !== offer.invoiceAmountPaise;
  const keepBps = 10_000 - offer.discountRateBps;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        if (!next) {
          setConsent(false);
          setError(null);
        }
        onOpenChange(next);
      }}
    >
      <DialogContent
        className={cn(
          "max-h-[94vh] gap-0 overflow-y-auto rounded-[14px] border-0 bg-card p-0 shadow-[0_40px_80px_-30px_rgba(13,30,48,0.55)] ring-1 ring-navy/10 sm:max-w-[58rem]",
          "[&>[data-slot=dialog-close]]:top-4 [&>[data-slot=dialog-close]]:right-4 [&>[data-slot=dialog-close]]:text-white/70 [&>[data-slot=dialog-close]]:hover:bg-white/10 [&>[data-slot=dialog-close]]:hover:text-white",
        )}
      >
        <div className="relative overflow-hidden bg-navy px-6 pt-6 pb-5 text-white sm:px-9 sm:pt-7">
          <div aria-hidden="true" className="absolute inset-0 bg-[radial-gradient(90%_160%_at_0%_0%,#21405f_0%,#142b43_50%,#0d1e30_100%)]" />
          <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-px bg-linear-to-r from-transparent via-gold/60 to-transparent" />
          <div className="relative pr-8">
            <p className="flex items-center gap-3 text-[0.625rem] font-semibold tracking-[0.22em] text-gold uppercase">
              <span aria-hidden="true" className="h-px w-6 bg-gold/70" />
              Early payment · {offer.reference}
            </p>
            <DialogTitle className="mt-2.5 font-display text-[1.75rem] leading-tight font-semibold text-white sm:text-[2rem]">
              {phase.kind === "accepted" ? "Submitted to Veefin" : "Get discounted amount"}
            </DialogTitle>
            <DialogDescription className="mt-1 text-[0.8125rem] text-white/60">
              Invoice {invoice.invoiceNumber} · {invoice.builderName}
              {invoice.projectName ? ` · ${invoice.projectName}` : ""}
            </DialogDescription>
            <div className="mt-6">
              <StepIndicator current={phase.kind === "accepted" ? 3 : consent ? 2 : 1} tone="dark" />
            </div>
          </div>
        </div>

        {phase.kind === "accepted" ? (
          <AcceptedState invoice={invoice} offer={offer} reference={phase.reference} onClose={() => onOpenChange(false)} />
        ) : (
          <>
            <div className="grid gap-8 px-6 pt-7 sm:px-9 md:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] md:gap-10">
              <div className="md:order-2">
                <NetReceivable offer={offer} keepBps={keepBps} />
              </div>

              <div className="md:order-1">
                <p className="text-[0.625rem] font-semibold tracking-[0.2em] text-muted-foreground uppercase">Settlement statement</p>
                <div className="mt-2">
                  <StatementLine label="Original invoice value" hint="Including GST" value={<Money paise={offer.invoiceAmountPaise} />} />
                  <StatementLine
                    label="Builder-approved amount"
                    hint={partial ? "The builder approved a different amount; the discount applies to it." : "Approved in full"}
                    value={<Money paise={offer.approvedAmountPaise} />}
                  />
                  <StatementLine
                    label={
                      <>
                        Agreed discount <span className="ml-1 rounded-sm bg-[#f9ebe8] px-1.5 py-px text-[0.6875rem] font-semibold text-[#93342a] tabular">{formatBps(offer.discountRateBps)}</span>
                      </>
                    }
                    hint="Deducted upfront by the financier"
                    value={<Money paise={offer.discountAmountPaise} sign="minus" />}
                    deduct
                  />
                  <StatementLine label="Other charges" hint="Processing, stamp duty and fees" value={<Money paise={offer.chargesPaise} />} muted />
                </div>
                <div className="mt-1 border-t-[3px] border-double border-navy/25 pt-3.5">
                  <div className="flex items-baseline justify-between gap-4">
                    <span className="text-sm font-semibold text-navy">Net receivable</span>
                    <Money paise={offer.netPayablePaise} size="md" className="font-semibold text-heritage" />
                  </div>
                </div>
              </div>
            </div>

            <div className="px-6 pt-7 pb-5 sm:px-9">
              <div className="rounded-[10px] border border-[#ece6d8] bg-[#faf8f3] px-5 py-5">
                <p className="flex items-center gap-2 text-[0.625rem] font-semibold tracking-[0.2em] text-muted-foreground uppercase">
                  <Landmark className="size-3.5 text-[#8b6f3e]" />
                  Terms &amp; validity
                </p>
                <dl className="mt-4 grid gap-x-8 gap-y-4 text-[0.8125rem] sm:grid-cols-3">
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">Financier</dt>
                    <dd className="mt-0.5 font-medium text-navy">{offer.terms.financier}</dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-xs text-muted-foreground">Programme · {offer.terms.programmeCode}</dt>
                    <dd className="mt-0.5 truncate font-medium text-navy" title={offer.terms.programmeName}>
                      {offer.terms.programmeName}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <CalendarClock className="size-3.5 text-[#8b6f3e]" />
                      Valid until
                    </dt>
                    <dd className="mt-0.5 flex flex-wrap items-center gap-2 font-medium text-navy">
                      {formatDateTime(offer.validUntil)}
                      <span className="rounded-full bg-gold-100 px-2 py-px text-[0.6875rem] font-semibold text-[#7d6235]">{daysLeft(offer.validUntil, openedAt)}</span>
                    </dd>
                  </div>
                  <div className="sm:col-span-3">
                    <dd className="border-l-2 border-gold/60 pl-3.5 text-[0.8125rem] leading-relaxed text-slate-ink">{offer.terms.terms}</dd>
                    <p className="mt-2 pl-4 text-[0.6875rem] text-muted-foreground">
                      Generated {formatDateTime(offer.generatedAt)} · {offer.terms.offerValidityDays}-day validity
                    </p>
                  </div>
                </dl>
              </div>
            </div>

            <div className="px-6 pb-6 sm:px-9">
              <label
                htmlFor={`consent-${offer.id}`}
                className={cn(
                  "flex cursor-pointer items-start gap-3.5 rounded-[10px] border p-4 transition-colors sm:p-5",
                  consent ? "border-heritage/35 bg-[#eef4f0]" : "border-[#e6e0d2] bg-card hover:border-gold/50 hover:bg-[#fdfbf6]",
                )}
              >
                <Checkbox
                  id={`consent-${offer.id}`}
                  checked={consent}
                  onCheckedChange={(v) => {
                    setConsent(v === true);
                    if (v === true) setError(null);
                  }}
                  disabled={busy}
                  className="mt-0.5 size-[18px] data-checked:border-heritage data-checked:bg-heritage"
                  aria-describedby={`consent-text-${offer.id}`}
                />
                <span>
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-navy">
                    <ShieldCheck className="size-4 text-heritage" />I agree to the early payment terms
                  </span>
                  <span id={`consent-text-${offer.id}`} className="mt-1.5 block text-xs leading-relaxed text-muted-foreground">
                    {consentText}
                  </span>
                </span>
              </label>

              {error && (
                <div role="alert" className="mt-4 flex flex-col gap-3 rounded-[10px] border border-[#ecc6bf] bg-[#f9ebe8] p-4 text-sm text-[#93342a] sm:flex-row sm:items-center sm:justify-between">
                  <p className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    {error.message}
                  </p>
                  {error.regenerate && (
                    <Button type="button" variant="outline" size="sm" onClick={regenerate} disabled={busy} className="shrink-0 bg-card">
                      {regenerating ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                      Generate fresh offer
                    </Button>
                  )}
                </div>
              )}
            </div>

            <div className="sticky bottom-0 z-10 flex flex-col-reverse gap-3 border-t border-[#ece6d8] bg-[#faf8f3]/95 px-6 py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-between sm:px-9">
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Lock className="size-3.5" />
                Demo transaction — no real funds move.
              </p>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy} className="h-11 bg-card px-5">
                  Not now
                </Button>
                <Button
                  type="button"
                  variant="success"
                  onClick={accept}
                  disabled={busy || !consent}
                  className="h-11 px-6 shadow-[0_10px_24px_-14px_rgba(23,77,60,0.9)] disabled:opacity-40"
                >
                  {accepting ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
                  Confirm · <Money paise={offer.netPayablePaise} className="font-semibold" />
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StatementLine({ label, hint, value, deduct, muted }: { label: ReactNode; hint?: string; value: ReactNode; deduct?: boolean; muted?: boolean }) {
  return (
    <div className="border-b border-[#f0ebe0] py-3 last:border-b-0">
      <div className="flex items-baseline justify-between gap-4">
        <span className={cn("text-sm", muted ? "text-muted-foreground" : "text-slate-ink")}>{label}</span>
        <span className={cn("text-sm font-medium tabular", deduct ? "text-[#93342a]" : muted ? "text-muted-foreground" : "text-navy")}>{value}</span>
      </div>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Focal figure: champagne-framed net receivable with the paise de-emphasised. */
function NetReceivable({ offer, keepBps }: { offer: OfferDto; keepBps: number }) {
  return (
    <div className="relative flex h-full overflow-hidden rounded-[12px] border border-gold/45 bg-[linear-gradient(180deg,#fcf8ef_0%,#ffffff_70%)] p-1.5 shadow-[0_24px_50px_-34px_rgba(169,138,82,0.75)]">
      <div className="relative flex w-full flex-col justify-center rounded-[9px] border border-gold/25 px-5 pt-7 pb-6 text-center sm:px-8">
        <Corner className="top-2 left-2" />
        <Corner className="top-2 right-2 rotate-90" />
        <Corner className="right-2 bottom-2 rotate-180" />
        <Corner className="bottom-2 left-2 -rotate-90" />
        <p className="text-[0.625rem] font-semibold tracking-[0.24em] text-[#8b6f3e] uppercase">Net receivable</p>
        <Money paise={offer.netPayablePaise} size="display" className="mt-4 block font-normal text-navy" />
        <p className="mt-3 text-xs text-muted-foreground">Paid to your registered bank account on approval</p>
        <div aria-hidden="true" className="mx-auto mt-5 flex max-w-[14rem] items-center gap-3">
          <span className="h-px flex-1 bg-linear-to-r from-transparent to-gold/60" />
          <span className="size-1.5 rotate-45 bg-gold" />
          <span className="h-px flex-1 bg-linear-to-l from-transparent to-gold/60" />
        </div>
        <dl className="mt-5 grid grid-cols-3 gap-2 text-center">
          <div>
            <dt className="text-[0.625rem] tracking-[0.14em] text-muted-foreground uppercase">Approved</dt>
            <dd className="mt-1 text-[0.8125rem] font-medium text-navy">
              <Money paise={offer.approvedAmountPaise} showPaise={false} />
            </dd>
          </div>
          <div className="border-x border-gold/25">
            <dt className="text-[0.625rem] tracking-[0.14em] text-muted-foreground uppercase">Rate</dt>
            <dd className="mt-1 text-[0.8125rem] font-medium text-navy tabular">{formatBps(offer.discountRateBps)} fixed</dd>
          </div>
          <div>
            <dt className="text-[0.625rem] tracking-[0.14em] text-muted-foreground uppercase">You keep</dt>
            <dd className="mt-1 text-[0.8125rem] font-medium text-heritage tabular">{formatBps(keepBps)}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

function Corner({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 12 12" className={cn("absolute size-3 text-gold/70", className)} fill="none">
      <path d="M1 11V3a2 2 0 0 1 2-2h8" stroke="currentColor" strokeWidth="1" />
    </svg>
  );
}

function AcceptedState({
  invoice,
  offer,
  reference,
  onClose,
}: {
  invoice: OfferInvoiceSummary;
  offer: OfferDto;
  reference: string;
  onClose: () => void;
}) {
  const next = [
    { title: "Offer accepted", body: "Your consent and the agreed terms are recorded.", state: "done" as const },
    { title: "Veefin approval", body: `${offer.terms.financier} reviews the request.`, state: "current" as const },
    { title: "Payout", body: "The net amount is paid to your registered account (simulated).", state: "upcoming" as const },
  ];
  return (
    <div className="animate-fade-up">
      <div className="grid gap-8 px-6 py-8 sm:px-9 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] md:gap-10">
        <div>
          <div className="flex items-center gap-4">
            <span className="relative flex size-14 shrink-0 items-center justify-center">
              <span aria-hidden="true" className="absolute inset-0 rounded-full border border-gold/50" />
              <span aria-hidden="true" className="absolute inset-1.5 rounded-full bg-heritage" />
              <Check className="relative size-6 text-white" strokeWidth={2.25} />
            </span>
            <div>
              <p className="text-[0.625rem] font-semibold tracking-[0.2em] text-heritage uppercase">Request submitted</p>
              <p className="mt-1 inline-flex items-center gap-2 rounded-full border border-[#efd9ae] bg-[#fbf3e3] px-3 py-1 text-xs font-medium text-[#8a5a12]">
                <span aria-hidden="true" className="size-1.5 animate-pulse rounded-full bg-[#c48a2c]" />
                Pending approval
              </p>
            </div>
          </div>
          <p className="mt-5 max-w-md text-sm leading-relaxed text-slate-ink">
            Your early payment request for invoice <span className="font-medium text-navy">{invoice.invoiceNumber}</span> has been sent to Veefin. Each step — approval
            and the simulated payout — will appear on the invoice and under My Transactions.
          </p>

          <ol className="mt-7 grid gap-0">
            {next.map((step, i) => (
              <li key={step.title} className="relative flex gap-4 pb-5 last:pb-0">
                {i < next.length - 1 && <span aria-hidden="true" className="absolute top-6 bottom-0 left-[11px] w-px bg-[#e3ddcf]" />}
                <span
                  className={cn(
                    "relative flex size-6 shrink-0 items-center justify-center rounded-full",
                    step.state === "done" && "bg-heritage text-white",
                    step.state === "current" && "border border-[#c48a2c] bg-[#fbf3e3]",
                    step.state === "upcoming" && "border border-[#d9d2c2] bg-card",
                  )}
                >
                  {step.state === "done" ? <Check className="size-3.5" strokeWidth={2.5} /> : <span className={cn("size-1.5 rounded-full", step.state === "current" ? "bg-[#c48a2c]" : "bg-[#cfc6b2]")} />}
                </span>
                <div className="pt-0.5">
                  <p className={cn("text-sm font-medium", step.state === "upcoming" ? "text-muted-foreground" : "text-navy")}>{step.title}</p>
                  <p className="text-xs text-muted-foreground">{step.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </div>

        <div className="relative overflow-hidden rounded-[12px] border border-[#e6e0d2] bg-[#faf8f3]">
          <div aria-hidden="true" className="h-1 bg-linear-to-r from-gold/40 via-gold to-gold/40" />
          <div className="px-6 py-6">
            <p className="text-[0.625rem] font-semibold tracking-[0.2em] text-muted-foreground uppercase">Request reference</p>
            <p className="mt-1.5 text-lg font-semibold tracking-[0.04em] text-navy tabular">{reference}</p>
            <div aria-hidden="true" className="my-5 border-t border-dashed border-[#d9d2c2]" />
            <dl className="grid gap-3 text-[0.8125rem]">
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Invoice</dt>
                <dd className="font-medium text-navy">{invoice.invoiceNumber}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Offer</dt>
                <dd className="font-medium text-navy">{offer.reference}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted-foreground">Discount · {formatBps(offer.discountRateBps)}</dt>
                <dd className="font-medium text-[#93342a]">
                  <Money paise={offer.discountAmountPaise} sign="minus" />
                </dd>
              </div>
            </dl>
            <div className="mt-5 border-t border-[#e6e0d2] pt-4">
              <p className="text-[0.625rem] font-semibold tracking-[0.2em] text-[#8b6f3e] uppercase">Net receivable</p>
              <Money paise={offer.netPayablePaise} size="xl" className="mt-2 block font-medium text-heritage" />
            </div>
          </div>
        </div>
      </div>

      <div className="sticky bottom-0 z-10 flex flex-col-reverse gap-2 border-t border-[#ece6d8] bg-[#faf8f3]/95 px-6 py-4 backdrop-blur sm:flex-row sm:justify-end sm:px-9">
        <Button type="button" variant="outline" onClick={onClose} className="h-11 bg-card px-5">
          Close
        </Button>
        <Button asChild className="h-11 px-6">
          <Link href={`/partner/invoices/${invoice.id}`} onClick={onClose}>
            View invoice & request
            <ArrowRight />
          </Link>
        </Button>
      </div>
    </div>
  );
}
