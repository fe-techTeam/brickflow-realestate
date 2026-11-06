"use client";

import { CheckCircle2, TriangleAlert } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

export interface MatchChecklistItem {
  key: string;
  label: string;
  description: string;
  invoiceValue: string;
  reference: string | null;
  consistent: boolean | null;
}

/** Invoice ↔ booking ↔ agreement checklist the builder ticks before approving. */
export function MatchChecklist({
  items,
  ticked,
  onToggle,
  required,
  disabled,
  error,
}: {
  items: MatchChecklistItem[];
  ticked: Set<string>;
  onToggle: (key: string, checked: boolean) => void;
  required: boolean;
  disabled?: boolean;
  error?: string | null;
}) {
  const done = items.filter((i) => ticked.has(i.key)).length;
  return (
    <fieldset className="grid gap-3" aria-describedby={error ? "match-checklist-error" : undefined}>
      <legend className="mb-1 flex w-full items-baseline justify-between gap-3">
        <span className="text-[0.625rem] font-semibold tracking-[0.18em] text-fg-muted uppercase">Three-way match</span>
        <span className="figure text-[0.75rem] text-muted-foreground">
          {done}/{items.length} {required ? "required" : "optional"}
        </span>
      </legend>
      <p className="-mt-1 text-[0.75rem] leading-relaxed text-muted-foreground">
        Check the invoice against your booking register and the registered agreement for sale.
      </p>
      <ul className="grid gap-2">
        {items.map((item) => {
          const id = `match-${item.key.toLowerCase()}`;
          const checked = ticked.has(item.key);
          return (
            <li key={item.key}>
              <label
                htmlFor={id}
                className={cn(
                  "flex cursor-pointer gap-3 rounded-lg border px-3.5 py-3 transition-colors",
                  checked ? "border-leaf/30 bg-leaf-50/60" : "border-line bg-glass-50 hover:border-line-strong",
                  disabled && "cursor-not-allowed opacity-60",
                )}
              >
                <Checkbox id={id} checked={checked} onCheckedChange={(value) => onToggle(item.key, value === true)} disabled={disabled} className="mt-0.5" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[0.8125rem] font-medium text-fg">{item.label}</span>
                  <span className="block text-[0.75rem] leading-snug text-muted-foreground">{item.description}</span>
                  <span className="mt-1.5 block text-[0.75rem] text-fg-soft [overflow-wrap:anywhere]">Invoice: {item.invoiceValue}</span>
                  {item.reference && <span className="block text-[0.75rem] text-muted-foreground">{item.reference}</span>}
                  {item.consistent === true && (
                    <span className="mt-1 flex items-center gap-1 text-[0.6875rem] text-leaf">
                      <CheckCircle2 className="size-3" />
                      Figures agree
                    </span>
                  )}
                  {item.consistent === false && (
                    <span className="mt-1 flex items-center gap-1 text-[0.6875rem] text-warning">
                      <TriangleAlert className="size-3" />
                      Figures differ by more than 1%
                    </span>
                  )}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {error && (
        <p id="match-checklist-error" role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  );
}
