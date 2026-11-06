"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";

/** From/to day pickers bound to the `from` and `to` URL params (India Standard Time calendar days). */
export function DateRangeFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const from = params.get("from") ?? "";
  const to = params.get("to") ?? "";

  function update(key: "from" | "to", value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("cursor");
    const qs = next.toString();
    startTransition(() => router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false }));
  }

  const label = "flex items-center gap-2.5 text-[0.6875rem] font-semibold tracking-[0.14em] text-muted-foreground uppercase";
  return (
    <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <legend className="sr-only">Date range</legend>
      <label className={label}>
        <span className="w-9 sm:w-auto">From</span>
        <Input type="date" value={from} max={to || undefined} onChange={(e) => update("from", e.target.value)} className="h-9 w-[11.75rem] bg-card tabular" />
      </label>
      <label className={label}>
        <span className="w-9 sm:w-auto">To</span>
        <Input type="date" value={to} min={from || undefined} onChange={(e) => update("to", e.target.value)} className="h-9 w-[11.75rem] bg-card tabular" />
      </label>
      {pending && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Updating results" />}
    </fieldset>
  );
}
