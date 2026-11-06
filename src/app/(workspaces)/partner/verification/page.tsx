import type { Metadata } from "next";
import { VerificationView } from "@/components/kyc/verification-view";
import { requireWorkspace } from "@/server/auth/session";
import { getVerificationOverview } from "@/server/services/kyc";

export const metadata: Metadata = { title: "Verification" };

export default async function VerificationPage() {
  const actor = await requireWorkspace("partner");
  return <VerificationView overview={await getVerificationOverview(actor)} />;
}
