"use client";

import { ArrowRight } from "lucide-react";
import { calculateDiscount, MAX_DISCOUNT_RATE_BPS, MIN_DISCOUNT_RATE_BPS } from "@/lib/financing";
import { formatBps, formatINR, parsePercentToBps } from "@/lib/money";
import { cn } from "@/lib/utils";

const SAMPLE_PAISE = 5_00_000_00n;

/** Parses a typed rate into basis points within the permitted range, or null. */
export function rateToBps(rate: string): number | null {
  const bps = parsePercentToBps(rate);
  if (bps === null || bps < MIN_DISCOUNT_RATE_BPS || bps > MAX_DISCOUNT_RATE_BPS) return null;
  return bps;
}

/** Whole rupees where exact, otherwise rupees and paise. */
function inr(paise: bigint): string {
  return formatINR(paise, { showPaise: paise % 100n !== 0n });
}

function Row({ label, value, tone = "default", hint }: { label: string; value: string; tone?: "default" | "deduct" | "total"; hint?: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-4", tone === "total" ? "border-t border-line-strong/15 pt-3.5" : "py-1.5")}>
      <div>
        <p className={cn("text-[0.8125rem] whitespace-nowrap", tone === "total" ? "font-semibold text-fg" : "text-fg-soft")}>{label}</p>
        {hint && <p className="text-[0.6875rem] text-muted-foreground">{hint}</p>}
      </div>
      <p
        className={cn(
          "tabular font-sans whitespace-nowrap",
          tone === "total" ? "text-[1.5rem] leading-none font-normal tracking-[-0.02em] text-leaf" : "text-sm font-medium text-fg",
          tone === "deduct" && "text-danger",
        )}
      >
        {value}
      </p>
    </div>
  );
}

/** Display-only illustration of the discount on a sample invoice; the server recomputes every real value. */
export function RatePreview({ rate, currentBps }: { rate: string; currentBps?: number }) {
  const bps = rateToBps(rate);
  const preview = bps !== null ? calculateDiscount(SAMPLE_PAISE, bps) : null;
  const current = currentBps !== undefined ? calculateDiscount(SAMPLE_PAISE, currentBps) : null;
  const changed = current !== null && bps !== null && bps !== currentBps;

  return (
    <div aria-live="polite">
      <p className="text-[0.625rem] font-semibold tracking-[0.2em] text-fg-muted uppercase">Live preview</p>
      <div className="mt-2 flex items-end gap-2">
        <span className="tabular font-sans text-[3.25rem] leading-none font-light tracking-[-0.04em] text-fg">
          {bps !== null ? formatBps(bps, { suffix: false }) : "—"}
        </span>
        <span className="pb-1.5 font-sans text-xl font-light text-fg-muted">%</span>
      </div>
      <span aria-hidden="true" className="mt-4 block h-px w-14 bg-gradient-to-r from-haze to-transparent" />

      {preview ? (
        <>
          <p className="mt-4 text-[0.8125rem] leading-relaxed text-fg-soft">
            On <span className="tabular font-medium text-fg">{inr(SAMPLE_PAISE)}</span> approved
            <ArrowRight className="mx-1 inline size-3 text-fg-muted" aria-hidden="true" />
            discount <span className="tabular font-medium text-danger">{inr(preview.discountAmountPaise)}</span>
            <ArrowRight className="mx-1 inline size-3 text-fg-muted" aria-hidden="true" />
            partner receives <span className="tabular font-semibold text-leaf">{inr(preview.netPayablePaise)}</span>
          </p>
          <div className="mt-4 rounded-lg border border-border/90 bg-card px-4 py-3">
            <Row label="Approved amount" value={formatINR(SAMPLE_PAISE)} />
            <Row label={`Discount at ${formatBps(preview.discountRateBps)}`} value={`−${formatINR(preview.discountAmountPaise)}`} tone="deduct" />
            <Row label="Other charges" value={formatINR(0n)} hint="None, by design" />
            <div className="mt-1.5">
              <Row label="Partner receives" value={formatINR(preview.netPayablePaise)} tone="total" />
            </div>
          </div>
          {changed && current && (
            <p className="tabular mt-3 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span>
                Today {formatBps(current.discountRateBps)} · {inr(current.netPayablePaise)}
              </span>
              <ArrowRight className="size-3 text-fg-muted" aria-hidden="true" />
              <span className="font-medium text-fg">
                New {formatBps(preview.discountRateBps)} · {inr(preview.netPayablePaise)}
              </span>
            </p>
          )}
        </>
      ) : (
        <p className="mt-4 text-[0.8125rem] leading-relaxed text-muted-foreground">
          Enter a discount between {formatBps(MIN_DISCOUNT_RATE_BPS)} and {formatBps(MAX_DISCOUNT_RATE_BPS)}, up to two decimals, to see what a channel partner
          would receive on a {inr(SAMPLE_PAISE)} approved invoice.
        </p>
      )}
    </div>
  );
}
