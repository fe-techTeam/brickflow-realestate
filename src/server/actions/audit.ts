"use server";

import { revalidatePath } from "next/cache";
import { runAction, type ActionResult } from "../action-result";
import { requireActor } from "../auth/session";
import { verifyAuditChainNow } from "../services/audit-integrity";

export async function verifyAuditChainAction(): Promise<ActionResult<{ status: string; checkedRows: number; brokenSeq: string | null }>> {
  return runAction(async () => {
    const result = await verifyAuditChainNow(await requireActor());
    revalidatePath("/admin/audit");
    return { status: result.status, checkedRows: result.checkedRows, brokenSeq: result.brokenSeq };
  });
}
