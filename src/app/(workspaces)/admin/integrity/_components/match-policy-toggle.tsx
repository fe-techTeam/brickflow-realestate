"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { setMatchPolicyAction } from "@/server/actions/invoices";

const OPTIONS = [
  { value: false, label: "Required" },
  { value: true, label: "Optional" },
] as const;

/** Segmented control for a programme's three-way match policy. */
export function MatchPolicyToggle({ programmeId, programmeCode, optional }: { programmeId: string; programmeCode: string; optional: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function choose(next: boolean) {
    if (next === optional || pending) return;
    startTransition(async () => {
      const result = await setMatchPolicyAction(programmeId, { attestationOptional: next });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? "Policy updated.");
      router.refresh();
    });
  }

  return (
    <div role="radiogroup" aria-label={`Three-way match for ${programmeCode}`} className="inline-flex items-center gap-1 rounded-lg border border-line bg-glass-50 p-0.5">
      {OPTIONS.map((option) => {
        const selected = option.value === optional;
        return (
          <button
            key={option.label}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={pending}
            onClick={() => choose(option.value)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none disabled:cursor-wait",
              selected ? "bg-night-solid text-fg ring-1 ring-line-strong" : "text-muted-foreground hover:text-fg",
            )}
          >
            {pending && !selected && <Loader2 className="size-3 animate-spin" />}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
