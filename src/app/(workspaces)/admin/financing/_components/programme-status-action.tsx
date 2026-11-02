"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Ban, Loader2, Pause, Play, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import type { ProgrammeStatus } from "@/generated/prisma/enums";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { formatBps } from "@/lib/money";
import { updateProgrammeAction } from "@/server/actions/admin";
import type { ProgrammeRow } from "./types";

const COPY: Record<"ACTIVE" | "SUSPENDED" | "CLOSED", { verb: string; icon: typeof Play; variant: "success" | "outline" | "destructive"; effect: string }> = {
  ACTIVE: {
    verb: "Activate",
    icon: Play,
    variant: "success",
    effect: "Channel partners of this builder can request early payment on eligible invoices, priced at this rate.",
  },
  SUSPENDED: {
    verb: "Suspend",
    icon: Pause,
    variant: "outline",
    effect: "No new offers can be generated or accepted until the programme is reactivated.",
  },
  CLOSED: {
    verb: "Close",
    icon: Ban,
    variant: "destructive",
    effect: "The programme ends and no new offers can be generated. It stays on record for history and can be reopened by editing it.",
  },
};

/** One-click status change (activate / suspend / close) sent through the programme update action. */
export function ProgrammeStatusAction({ programme, target }: { programme: ProgrammeRow; target: "ACTIVE" | "SUSPENDED" | "CLOSED" }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const copy = COPY[target];
  const Icon = copy.icon;
  const label = target === "ACTIVE" && programme.status === "SUSPENDED" ? "Resume" : copy.verb;

  function confirm() {
    setError(null);
    startTransition(async () => {
      const result = await updateProgrammeAction(programme.id, {
        ...programme.values,
        effectiveTo: programme.values.effectiveTo || undefined,
        status: target as ProgrammeStatus,
      });
      if (!result.ok) {
        setError(result.error);
        toast.error(result.error);
        return;
      }
      const withdrawn = result.data.openOffersWithdrawn;
      toast.success(`${programme.code} is now ${target.toLowerCase()}.`, {
        description: withdrawn > 0 ? `${withdrawn} open offer${withdrawn === 1 ? " was" : "s were"} withdrawn.` : "No open offers were affected.",
      });
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (pending) return;
        setOpen(next);
        if (!next) setError(null);
      }}
    >
      <DialogTrigger asChild>
        <Button variant={copy.variant} size="sm" aria-label={`${label} ${programme.code}`} className={copy.variant === "outline" ? "bg-card" : undefined}>
          <Icon className="size-3.5" />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="gap-5 p-6 sm:max-w-lg sm:p-7">
        <DialogHeader className="gap-0 text-left">
          <p className="flex items-center gap-2.5 text-[0.625rem] font-semibold tracking-[0.22em] text-gold-600 uppercase">
            <span aria-hidden="true" className="h-px w-5 bg-gold" />
            Programme status
          </p>
          <DialogTitle className="mt-2.5 font-display text-[1.75rem] leading-tight font-semibold text-navy">
            {label} {programme.code}?
          </DialogTitle>
          <DialogDescription className="mt-2 text-[0.8125rem] leading-relaxed">
            {programme.builderName} · <span className="tabular font-medium text-navy">{formatBps(programme.discountRateBps)}</span> agreed discount. {copy.effect}
          </DialogDescription>
        </DialogHeader>
        <ul className="divide-y divide-border/70 rounded-lg border border-border/80 bg-ivory/50 text-[0.8125rem] text-slate-ink">
          <li className="flex gap-3 px-4 py-3">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-heritage" strokeWidth={1.6} aria-hidden="true" />
            <span>Accepted financing requests ({programme.requests}) keep their agreed terms.</span>
          </li>
          <li className="flex gap-3 px-4 py-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-gold-600" strokeWidth={1.6} aria-hidden="true" />
            <span>
              {programme.openOffers > 0
                ? `${programme.openOffers} open offer${programme.openOffers === 1 ? "" : "s"} will be withdrawn; partners can regenerate if the builder still has an active programme.`
                : "There are no open offers on this programme."}
            </span>
          </li>
        </ul>
        {error && (
          <div role="alert" className="flex gap-3 rounded-lg border-l-2 border-[#c48a2c] bg-[#fbf1df] px-4 py-3 text-sm text-[#6d4710]">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-medium">{/already has an active programme/i.test(error) ? "Only one active programme per builder" : "Status not changed"}</p>
              <p className="mt-0.5">{error}</p>
            </div>
          </div>
        )}
        <DialogFooter className="-mx-6 -mb-6 bg-card px-6 sm:-mx-7 sm:-mb-7 sm:px-7">
          <DialogClose asChild>
            <Button variant="outline" disabled={pending}>
              Cancel
            </Button>
          </DialogClose>
          <Button variant={copy.variant === "outline" ? "default" : copy.variant} onClick={confirm} disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" />}
            {label} programme
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
