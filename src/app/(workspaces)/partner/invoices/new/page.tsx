import type { Metadata } from "next";
import { PageHeader } from "@/components/common/page-header";
import { toDateInputValue } from "@/lib/format";
import { requireWorkspace } from "@/server/auth/session";
import { getUploadBuilders } from "@/server/queries/partner";
import { UploadInvoiceForm } from "./_components/upload-invoice-form";

export const metadata: Metadata = { title: "Upload Invoice" };

export default async function UploadInvoicePage() {
  const actor = await requireWorkspace("partner");
  const { builders, partnerGstin } = await getUploadBuilders(actor);

  return (
    <>
      <PageHeader
        eyebrow="Invoices"
        title="Upload invoice"
        description="Submit a brokerage tax invoice to a builder for approval. Approved invoices become eligible for early payment."
        back={{ href: "/partner/invoices", label: "My Invoices" }}
      />
      <UploadInvoiceForm builders={builders} partnerGstin={partnerGstin} today={toDateInputValue(new Date())} />
    </>
  );
}
