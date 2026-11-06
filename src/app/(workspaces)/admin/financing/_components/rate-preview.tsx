"use client";

import { useId, useState } from "react";
import { ArrowRight } from "lucide-react";
import { Input } from "@/components/ui/input";
import { describeRate } from "@/lib/key-facts";
import { formatBps, formatINR } from "@/lib/money";
import type { PricingQuote } from "@/lib/pricing";
import { cn } from "@/lib/utils";
import { SAMPLE_INVOICE_PAISE, SAMPLE_TENOR_DAYS, sampleQuote, termsFromValues, type PricingValues } from "./pricing-values";

/** Whole rupees where exact, otherwise rupees and paise. */
function inr(paise: bigint): string {
  return formatINR(paise, { showPaise: paise % 100n !== 0n });
}

function Row({ label, value, tone = "default", hint }: { label: string; value: string; tone?: "default" | "deduct" | "total" | "muted"; hint?: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4", tone === "total" ? "border-t border-line-strong/15 pt-3.5" : "py-1.5")}>
      <div className="min-w-0">
        <p className={cn("text-[0.8125rem]", tone === "total" ? "font-semibold text-fg" : tone === "muted" ? "text-muted-foreground" : "text-fg-soft")}>{label}</p>
        {hint && <p className="text-[0.6875rem] text-muted-foreground">{hint}</p>}
      </div>
      <p
        className={cn(
          "tabular font-sans whitespace-nowrap",
          tone === "total" ? "text-[1.5rem] leading-none font-normal tracking-[-0.02em] text-leaf" : "text-sm font-medium text-fg",
          tone === "deduct" && "text-danger",
          tone === "muted" && "text-muted-foreground",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function Breakdown({ quote }: { quote: PricingQuote }) {
  const hasTds = quote.tdsPaise > 0n;
  const hasFee = quote.processingFeePaise > 0n;
  return (
    <div className="mt-4 rounded-lg border border-border/90 bg-card px-4 py-3">
      <Row label="Invoice total" value={formatINR(quote.invoiceTotalPaise)} hint="Builder-approved, GST-inclusive" />
      {hasTds && (
        <>
          <Row label={`TDS at ${formatBps(quote.tdsRateBps)}`} value={`−${formatINR(quote.tdsPaise)}`} tone="deduct" hint={`On taxable value ${inr(quote.taxableValuePaise)}`} />
          <Row label="Financed amount" value={formatINR(quote.financedAmountPaise)} hint="What the builder remits" />
        </>
      )}
      <Row
        label={`Discount, ${describeRate(quote.pricingMode, quote.discountRateBps)}`}
        value={`−${formatINR(quote.discountAmountPaise)}`}
        tone="deduct"
        hint={quote.minimumDiscountApplied ? `Minimum discount applies (computed ${inr(quote.computedDiscountPaise)})` : quote.pricingMode === "ANNUAL_RATE" ? `${quote.tenorDays} days ÷ 365` : undefined}
      />
      {hasFee ? (
        <>
          <Row label="Processing fee" value={`−${formatINR(quote.processingFeePaise)}`} tone="deduct" />
          <Row label={`GST on fee at ${formatBps(quote.feeGstRateBps)}`} value={`−${formatINR(quote.feeGstPaise)}`} tone="deduct" />
        </>
      ) : (
        <Row label="Other charges" value={formatINR(0n)} tone="muted" />
      )}
      <div className="mt-1.5">
        <Row label="Partner receives" value={formatINR(quote.netPayablePaise)} tone="total" />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 border-t border-dashed border-line pt-3 text-xs">
        <div>
          <p className="text-muted-foreground">Builder settles</p>
          <p className="tabular mt-0.5 font-medium text-fg">{inr(quote.settlementAmountPaise)}</p>
        </div>
        <div className="text-right">
          <p className="text-muted-foreground">Annualised rate</p>
          <p className="tabular mt-0.5 font-medium text-fg">{formatBps(quote.annualisedRateBps)}</p>
        </div>
      </div>
    </div>
  );
}

/** Display-only worked example of the programme's pricing; the server recomputes every real value. */
export function RatePreview({ values, current }: { values: PricingValues & { discountRate: string }; current?: PricingValues & { discountRate: string } }) {
  const uid = useId();
  const [now] = useState(() => new Date());
  const [daysInput, setDaysInput] = useState(String(SAMPLE_TENOR_DAYS));
  const days = /^\d{1,3}$/.test(daysInput) && Number(daysInput) >= 1 && Number(daysInput) <= 365 ? Number(daysInput) : SAMPLE_TENOR_DAYS;

  const { terms, problems } = termsFromValues(values);
  const result = terms ? sampleQuote(terms, days, now) : null;
  const currentTerms = current ? termsFromValues(current).terms : null;
  const currentResult = currentTerms ? sampleQuote(currentTerms, days, now) : null;
  const quote = result?.ok ? result.quote : null;
  const previous = currentResult?.ok ? currentResult.quote : null;
  const changed = quote && previous && quote.netPayablePaise !== previous.netPayablePaise;

  return (
    <div aria-live="polite">
      <p className="text-[0.625rem] font-semibold tracking-[0.2em] text-fg-muted uppercase">Worked example</p>
      <div className="mt-2 flex items-end gap-2">
        <span className="tabular font-sans text-[3.25rem] leading-none font-light tracking-[-0.04em] text-fg">
          {terms ? formatBps(terms.discountRateBps, { suffix: false }) : "—"}
        </span>
        <span className="pb-1.5 font-sans text-xl font-light text-fg-muted">%{values.pricingMode === "ANNUAL_RATE" ? " a year" : ""}</span>
      </div>
      <span aria-hidden="true" className="mt-4 block h-px w-14 bg-gradient-to-r from-haze to-transparent" />

      <div className="mt-4 flex flex-wrap items-center gap-2 text-[0.8125rem] text-fg-soft">
        <span>{inr(SAMPLE_INVOICE_PAISE)} invoice, due in</span>
        <label htmlFor={`${uid}-days`} className="sr-only">
          Example days to the due date
        </label>
        <Input
          id={`${uid}-days`}
          value={daysInput}
          onChange={(e) => setDaysInput(e.target.value)}
          inputMode="numeric"
          className="tabular h-8 w-16 bg-card px-2 text-center"
        />
        <span>days</span>
      </div>

      {quote ? (
        <>
          <Breakdown quote={quote} />
          {changed && previous && (
            <p className="tabular mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span>Today {inr(previous.netPayablePaise)}</span>
              <ArrowRight className="size-3 text-fg-muted" aria-hidden="true" />
              <span className="font-medium text-fg">New {inr(quote.netPayablePaise)}</span>
            </p>
          )}
        </>
      ) : (
        <p role="status" className="mt-4 text-[0.8125rem] leading-relaxed text-muted-foreground">
          {result && !result.ok ? result.message : (problems[0] ?? "Enter the agreed rate to see what a channel partner would receive.")}
        </p>
      )}
    </div>
  );
}
