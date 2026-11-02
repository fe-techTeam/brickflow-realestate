"use client";

import { ArrowRight, Calculator } from "lucide-react";
import { calculateDiscount, MAX_DISCOUNT_RATE_BPS, MIN_DISCOUNT_RATE_BPS } from "@/lib/financing";
import { formatBps, formatINR, parsePercentToBps } from "@/lib/money";

const SAMPLE_PAISE = 5_00_000_00n;

/** Parses a typed rate into basis points within the permitted range, or null. */
export function rateToBps(rate: string): number | null {
  const bps = parsePercentToBps(rate);
  if (bps === null || bps < MIN_DISCOUNT_RATE_BPS || bps > MAX_DISCOUNT_RATE_BPS) return null;
  return bps;
}

/** Display-only illustration of the discount on a sample invoice; the server recomputes every real value. */
export function RatePreview({ rate, currentBps }: { rate: string; currentBps?: number }) {
  const bps = rateToBps(rate);
  const preview = bps !== null ? calculateDiscount(SAMPLE_PAISE, bps) : null;
  const current = currentBps !== undefined ? calculateDiscount(SAMPLE_PAISE, currentBps) : null;
  const changed = current !== null && bps !== null && bps !== currentBps;

  return (
    <div className="rounded-lg border border-heritage/20 bg-sage/40 px-4 py-3.5" aria-live="polite">
      <p className="flex items-center gap-2 text-xs font-semibold tracking-[0.08em] text-heritage uppercase">
        <Calculator className="size-3.5" aria-hidden="true" />
        Live preview
      </p>
      {preview ? (
        <>
          <p className="mt-2 text-sm leading-relaxed text-slate-ink">
            On an approved invoice of <span className="tabular font-medium text-navy">{formatINR(SAMPLE_PAISE, { showPaise: false })}</span> the channel
            partner would receive <span className="tabular font-display text-lg font-semibold text-heritage">{formatINR(preview.netPayablePaise)}</span>
          </p>
          <p className="tabular mt-1 text-xs text-muted-foreground">
            Discount {formatINR(preview.discountAmountPaise)} at {formatBps(preview.discountRateBps)} · no other charges
          </p>
          {changed && current && (
            <p className="tabular mt-2 flex flex-wrap items-center gap-1.5 text-xs text-slate-ink">
              <span>
                Today: {formatBps(current.discountRateBps)} → {formatINR(current.netPayablePaise)}
              </span>
              <ArrowRight className="size-3" aria-hidden="true" />
              <span className="font-medium text-navy">
                New: {formatBps(preview.discountRateBps)} → {formatINR(preview.netPayablePaise)}
              </span>
            </p>
          )}
        </>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          Enter a discount between {formatBps(MIN_DISCOUNT_RATE_BPS)} and {formatBps(MAX_DISCOUNT_RATE_BPS)} (up to two decimals) to preview the payout.
        </p>
      )}
    </div>
  );
}
