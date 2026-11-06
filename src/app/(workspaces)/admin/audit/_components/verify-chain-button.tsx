"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { verifyAuditChainAction } from "@/server/actions/audit";

export function VerifyChainButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function verify() {
    startTransition(async () => {
      const result = await verifyAuditChainAction();
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      const { status, checkedRows, brokenSeq } = result.data;
      if (status === "BROKEN") toast.error(`Audit chain broken at entry ${brokenSeq}`, { description: "The first broken link is shown in the integrity panel." });
      else if (status === "EMPTY") toast.success("No audit entries to verify yet.");
      else toast.success("Audit chain verified", { description: `${checkedRows.toLocaleString("en-IN")} entries checked, every link intact.` });
      router.refresh();
    });
  }

  return (
    <Button variant="outline" size="sm" onClick={verify} disabled={pending} aria-busy={pending}>
      {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />}
      {pending ? "Verifying…" : "Verify now"}
    </Button>
  );
}
