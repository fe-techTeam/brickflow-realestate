import type { Metadata } from "next";
import Link from "next/link";
import { Download, ExternalLink, FileText, FolderOpen } from "lucide-react";
import { DataTable, Td, Th, Tr } from "@/components/common/data-table";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState, Section } from "@/components/common/panels";
import { StatusBadge, ToneBadge } from "@/components/common/status-badge";
import { Button } from "@/components/ui/button";
import { DEMO_ORGANISATIONS, DEMO_PROJECTS, SAMPLE_INVOICES } from "@/lib/demo/catalogue";
import { formatDate, formatDateTime } from "@/lib/format";
import { formatINR } from "@/lib/money";
import { requireWorkspace } from "@/server/auth/session";
import { listPartnerDocuments } from "@/server/queries/partner";

export const metadata: Metadata = { title: "Documents" };

function formatBytes(bytes: number): string {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function DocumentsPage() {
  const actor = await requireWorkspace("partner");
  const documents = await listPartnerDocuments(actor);
  const latestByInvoice = new Set<string>();
  const current = new Set<string>();
  for (const doc of documents) {
    if (latestByInvoice.has(doc.invoiceId)) continue;
    latestByInvoice.add(doc.invoiceId);
    current.add(doc.id);
  }

  return (
    <>
      <PageHeader eyebrow="Account" title="Documents" description="Sample invoices for the demonstration and every invoice PDF your organisation has uploaded." />

      <div className="flex flex-col gap-6">
        <Section title="Sample documents" description="Fictional GST brokerage invoices — use them to try the upload and extraction flow">
          <ul className="grid gap-4 md:grid-cols-3">
            {SAMPLE_INVOICES.map((sample) => {
              const builder = DEMO_ORGANISATIONS[sample.builder];
              const project = DEMO_PROJECTS.find((p) => p.key === sample.project);
              return (
                <li key={sample.slug} className="flex flex-col rounded-lg border border-border bg-ivory/40 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-navy text-gold">
                      <FileText className="size-4.5" strokeWidth={1.6} />
                    </span>
                    <ToneBadge meta={{ label: "Sample", tone: "gold" }} />
                  </div>
                  <p className="mt-4 font-display text-lg leading-snug font-semibold text-navy">{sample.invoiceNumber}</p>
                  <p className="mt-1 text-sm text-slate-ink">{sample.title}</p>
                  <dl className="mt-4 grid gap-1.5 text-xs">
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Bill to</dt>
                      <dd className="text-right text-navy">{builder.name}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Project</dt>
                      <dd className="text-right text-navy">{project?.name}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Invoice date</dt>
                      <dd className="text-right text-navy">{formatDate(new Date(`${sample.invoiceDate}T00:00:00.000Z`))}</dd>
                    </div>
                    <div className="flex justify-between gap-3">
                      <dt className="text-muted-foreground">Total (incl. GST)</dt>
                      <dd className="tabular text-right font-semibold text-navy">{formatINR(sample.amountPaise)}</dd>
                    </div>
                  </dl>
                  <div className="mt-5 flex gap-2 pt-1">
                    <Button variant="outline" size="sm" asChild className="flex-1">
                      <a href={`/api/documents/samples/${sample.slug}`} target="_blank" rel="noopener noreferrer">
                        <ExternalLink />
                        View
                      </a>
                    </Button>
                    <Button size="sm" asChild className="flex-1">
                      <a href={`/api/documents/samples/${sample.slug}?download=1`} download>
                        <Download />
                        Download
                      </a>
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        </Section>

        <Section title="Uploaded invoice documents" description={`${documents.length} ${documents.length === 1 ? "file" : "files"} across your invoices`} bodyClassName="py-0">
          {documents.length === 0 ? (
            <EmptyState
              icon={FolderOpen}
              title="No documents uploaded yet"
              description="Invoice PDFs you upload are stored securely and listed here."
              action={
                <Button size="sm" asChild>
                  <Link href="/partner/invoices/new">Upload invoice</Link>
                </Button>
              }
            />
          ) : (
            <DataTable minWidth={960}>
              <thead>
                <tr>
                  <Th>File</Th>
                  <Th>Invoice</Th>
                  <Th>Builder · Project</Th>
                  <Th>Invoice status</Th>
                  <Th>Uploaded</Th>
                  <Th align="right">Actions</Th>
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => (
                  <Tr key={doc.id}>
                    <Td>
                      <div className="flex items-center gap-3">
                        <FileText className="size-4 shrink-0 text-gold-600" />
                        <div className="min-w-0">
                          <p className="max-w-[16rem] truncate font-medium text-navy" title={doc.fileName}>
                            {doc.fileName}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatBytes(doc.sizeBytes)} · {current.has(doc.id) ? "Current version" : "Previous version"}
                          </p>
                        </div>
                      </div>
                    </Td>
                    <Td>
                      <Link href={`/partner/invoices/${doc.invoice.id}`} className="text-navy hover:underline">
                        {doc.invoice.invoiceNumber}
                      </Link>
                      <p className="text-xs whitespace-nowrap text-muted-foreground">{doc.invoice.reference}</p>
                    </Td>
                    <Td>
                      <p>{doc.invoice.builder.name}</p>
                      <p className="text-xs text-muted-foreground">{doc.invoice.project.name}</p>
                    </Td>
                    <Td>
                      <StatusBadge kind="invoice" status={doc.invoice.status} />
                    </Td>
                    <Td className="whitespace-nowrap">{formatDateTime(doc.createdAt)}</Td>
                    <Td align="right">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" size="sm" asChild>
                          <a href={`/api/documents/invoices/${doc.id}`} target="_blank" rel="noopener noreferrer" aria-label={`View ${doc.fileName}`}>
                            <ExternalLink />
                            View
                          </a>
                        </Button>
                        <Button variant="ghost" size="sm" asChild>
                          <a href={`/api/documents/invoices/${doc.id}?download=1`} download aria-label={`Download ${doc.fileName}`}>
                            <Download />
                            Download
                          </a>
                        </Button>
                      </div>
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </Section>
      </div>
    </>
  );
}
