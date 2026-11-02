"use client";

import { createContext, useCallback, useContext, useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, BadgePercent, CalendarClock, CheckCircle2, Landmark, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { AmountRow } from "@/components/common/panels";
import { DemoBadge, StatusBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { formatDateTime } from "@/lib/format";
import { formatBps, formatINR } from "@/lib/money";
import { cn } from "@/lib/utils";
import { acceptOfferAction, generateOfferAction } from "@/server/actions/financing";
import type { OfferDto } from "@/server/dto";

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
      className={cn("font-semibold tracking-[0.06em] uppercase", size === "sm" && "text-[0.6875rem]", size === "xs" && "h-7 px-2.5 text-[0.625rem] tracking-[0.04em]", className)}
      aria-label={`${label} for invoice ${invoice.invoiceNumber}`}
    >
      {busy ? <Loader2 className="animate-spin" /> : <BadgePercent />}
      {label}
    </Button>
  );
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

  const discountLabel = `Agreed discount (${formatBps(offer.discountRateBps)})`;
  const partial = offer.approvedAmountPaise !== offer.invoiceAmountPaise;

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
          "max-h-[92vh] gap-0 overflow-y-auto p-0 sm:max-w-3xl",
          phase.kind === "review" && "[&>[data-slot=dialog-close]]:top-3 [&>[data-slot=dialog-close]]:right-3 [&>[data-slot=dialog-close]]:text-white/80 [&>[data-slot=dialog-close]]:hover:bg-white/10 [&>[data-slot=dialog-close]]:hover:text-white",
        )}
      >
        {phase.kind === "accepted" ? (
          <AcceptedState invoice={invoice} offer={offer} reference={phase.reference} onClose={() => onOpenChange(false)} />
        ) : (
          <>
            <div className="relative overflow-hidden bg-navy px-6 pt-6 pb-5 text-white sm:px-8">
              <div aria-hidden="true" className="pointer-events-none absolute -top-24 -right-24 size-64 rounded-full border border-gold/20" />
              <div className="relative flex flex-wrap items-start justify-between gap-3 pr-8">
                <div className="min-w-0">
                  <p className="eyebrow text-gold">Early payment offer · {offer.reference}</p>
                  <DialogTitle className="mt-2 font-display text-[1.875rem] leading-tight font-semibold text-white">Your discounted amount</DialogTitle>
                  <DialogDescription className="mt-1 text-sm text-white/65">
                    Invoice {invoice.invoiceNumber} · {invoice.builderName}
                    {invoice.projectName ? ` · ${invoice.projectName}` : ""}
                  </DialogDescription>
                </div>
                <DemoBadge className="bg-white/10 text-gold ring-gold/40" />
              </div>
            </div>

            <div className="grid gap-6 px-6 py-6 sm:px-8 md:grid-cols-[1.15fr_1fr]">
              <div>
                <p className="eyebrow mb-1">Payout breakdown</p>
                <div className="divide-y divide-border/70">
                  <AmountRow label="Original invoice amount" value={formatINR(offer.invoiceAmountPaise)} hint="Including GST" />
                  <AmountRow
                    label="Builder-approved amount"
                    value={formatINR(offer.approvedAmountPaise)}
                    hint={partial ? "The builder approved a different amount; the discount applies to it." : "Approved in full"}
                  />
                  <AmountRow label={discountLabel} value={`− ${formatINR(offer.discountAmountPaise)}`} tone="deduct" hint="Deducted upfront" />
                  <AmountRow label="Other charges" value={formatINR(offer.chargesPaise)} hint="No additional charges" />
                  <AmountRow label="Net payable to you" value={formatINR(offer.netPayablePaise)} tone="total" hint="Paid to your registered bank account" />
                </div>
              </div>

              <div className="flex flex-col gap-4">
                <div className="rounded-lg border border-border bg-ivory/70 p-4">
                  <p className="eyebrow mb-3 flex items-center gap-1.5">
                    <Landmark className="size-3.5 text-gold-600" />
                    Financing terms
                  </p>
                  <dl className="grid gap-2.5 text-sm">
                    <div>
                      <dt className="text-xs text-muted-foreground">Programme</dt>
                      <dd className="font-medium text-navy">
                        {offer.terms.programmeName} <span className="text-xs font-normal text-muted-foreground">({offer.terms.programmeCode})</span>
                      </dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Financier</dt>
                      <dd className="font-medium text-navy">{offer.terms.financier}</dd>
                    </div>
                    <div>
                      <dt className="text-xs text-muted-foreground">Terms</dt>
                      <dd className="text-[0.8125rem] leading-relaxed text-slate-ink">{offer.terms.terms}</dd>
                    </div>
                  </dl>
                </div>
                <div className="flex items-start gap-3 rounded-lg border border-gold/30 bg-gold-100/60 p-4">
                  <CalendarClock className="mt-0.5 size-4 shrink-0 text-gold-600" />
                  <div className="text-sm">
                    <p className="font-medium text-navy">Valid until {formatDateTime(offer.validUntil)}</p>
                    <p className="text-xs text-muted-foreground">
                      Generated {formatDateTime(offer.generatedAt)} · {offer.terms.offerValidityDays}-day validity
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="px-6 pb-6 sm:px-8">
              <label
                htmlFor={`consent-${offer.id}`}
                className={cn(
                  "flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors",
                  consent ? "border-heritage/40 bg-sage/50" : "border-border bg-card hover:bg-ivory/50",
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
                  className="mt-0.5"
                  aria-describedby={`consent-text-${offer.id}`}
                />
                <span>
                  <span className="flex items-center gap-1.5 text-sm font-medium text-navy">
                    <ShieldCheck className="size-4 text-heritage" />I agree to the early payment terms
                  </span>
                  <span id={`consent-text-${offer.id}`} className="mt-1 block text-xs leading-relaxed text-muted-foreground">
                    {consentText}
                  </span>
                </span>
              </label>

              {error && (
                <div role="alert" className="mt-4 flex flex-col gap-3 rounded-lg border border-[#ecc6bf] bg-[#f8e7e4] p-4 text-sm text-[#93342a] sm:flex-row sm:items-center sm:justify-between">
                  <p className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    {error.message}
                  </p>
                  {error.regenerate && (
                    <Button type="button" variant="outline" size="sm" onClick={regenerate} disabled={busy} className="shrink-0">
                      {regenerating ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                      Generate fresh offer
                    </Button>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-col-reverse gap-3 border-t border-border bg-ivory/60 px-6 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-8">
              <p className="text-xs text-muted-foreground">Demo transaction — no real funds move.</p>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
                  Not now
                </Button>
                <Button type="button" variant="success" onClick={accept} disabled={busy || !consent}>
                  {accepting ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
                  Accept offer · {formatINR(offer.netPayablePaise)}
                </Button>
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
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
  return (
    <div className="animate-fade-up px-6 py-10 text-center sm:px-10">
      <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-sage text-heritage ring-8 ring-sage/40">
        <CheckCircle2 className="size-7" strokeWidth={1.6} />
      </span>
      <DialogTitle className="mt-6 font-display text-[1.875rem] font-semibold text-navy">Offer accepted</DialogTitle>
      <DialogDescription className="mx-auto mt-2 max-w-md text-sm leading-relaxed">
        Your early payment request for invoice {invoice.invoiceNumber} has been sent to Veefin. You will see each step — approval and the simulated payout — on the
        invoice and under My Transactions.
      </DialogDescription>
      <div className="mx-auto mt-6 grid max-w-md gap-3 rounded-lg border border-border bg-ivory/60 p-4 text-left text-sm sm:grid-cols-2">
        <div>
          <p className="eyebrow">Request reference</p>
          <p className="mt-1 font-medium text-navy">{reference}</p>
        </div>
        <div>
          <p className="eyebrow">Status</p>
          <StatusBadge kind="financing" status="PENDING_APPROVAL" className="mt-1" />
        </div>
        <div className="sm:col-span-2">
          <p className="eyebrow">Net payable to you</p>
          <p className="tabular mt-1 font-display text-2xl font-semibold text-heritage">{formatINR(offer.netPayablePaise)}</p>
        </div>
      </div>
      <div className="mt-8 flex flex-col-reverse justify-center gap-2 sm:flex-row">
        <Button type="button" variant="outline" onClick={onClose}>
          Close
        </Button>
        <Button asChild>
          <Link href={`/partner/invoices/${invoice.id}`} onClick={onClose}>
            View invoice & request
          </Link>
        </Button>
      </div>
    </div>
  );
}
