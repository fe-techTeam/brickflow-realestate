"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Ban, Loader2, Pause, Play } from "lucide-react";
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
        <Button variant={copy.variant} size="sm" aria-label={`${label} ${programme.code}`}>
          <Icon className="size-3.5" />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-semibold text-navy">
            {label} {programme.code}?
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed">
            {programme.builderName} · {formatBps(programme.discountRateBps)} agreed discount. {copy.effect}
          </DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-ink">
          <li>Accepted financing requests ({programme.requests}) keep their agreed terms.</li>
          <li>
            {programme.openOffers > 0
              ? `${programme.openOffers} open offer${programme.openOffers === 1 ? "" : "s"} will be withdrawn; partners can regenerate if the builder still has an active programme.`
              : "There are no open offers on this programme."}
          </li>
        </ul>
        {error && (
          <div role="alert" className="flex gap-3 rounded-lg border border-[#efd9ae] bg-[#fbf1df] px-4 py-3 text-sm text-[#6d4710]">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <div>
              <p className="font-medium">{/already has an active programme/i.test(error) ? "Only one active programme per builder" : "Status not changed"}</p>
              <p className="mt-0.5">{error}</p>
            </div>
          </div>
        )}
        <DialogFooter>
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
